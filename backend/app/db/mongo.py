"""MongoDB connection lifecycle.

Beanie keeps the active client in module state once `init_beanie` has run, so
documents can be queried without threading a session through every call — the
FastAPI `DbSession` dependency the SQLAlchemy version needed is gone.
"""

from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def create_client(mongodb_url: str) -> AsyncIOMotorClient:
    return AsyncIOMotorClient(
        mongodb_url,
        # Without this, timestamps come back naive and every comparison against
        # an aware `utcnow()` raises TypeError at runtime.
        tz_aware=True,
        serverSelectionTimeoutMS=5_000,
    )


async def init_db(
    *, mongodb_url: str | None = None, database_name: str | None = None
) -> AsyncIOMotorDatabase:
    """Connect and register every document model. Safe to call once per process."""
    from beanie import init_beanie

    from app.models import ALL_DOCUMENT_MODELS

    global _client
    settings = get_settings()
    url = mongodb_url or settings.mongodb_url
    name = database_name or settings.mongodb_db_name

    _client = create_client(url)
    database = _client[name]
    # Creates the collections' indexes, including the unique and partial ones
    # that replace the Postgres constraints.
    await init_beanie(database=database, document_models=list(ALL_DOCUMENT_MODELS))
    logger.info("connected to MongoDB database %r", name)
    return database


def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("init_db() has not been called")
    return _client


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


async def ping() -> None:
    """Raises if the server is unreachable; used by the readiness probe."""
    await get_client().admin.command("ping")
