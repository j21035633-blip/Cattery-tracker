"""Test fixtures.

Every test runs against a **real MongoDB**. There is no mock and no skip path:
the behaviour that matters most here — unique and partial indexes, upsert
deduplication, `$setOnInsert`, aggregation pipelines — is server behaviour, and
a fake would prove nothing about it.

Point `MONGODB_URL` at any server; the suite uses `TEST_MONGODB_DB_NAME` and
wipes it between tests, so it never touches development data.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("ENVIRONMENT", "test")

pytest_plugins = ("pytest_asyncio",)


def _test_settings():
    from app.core.config import get_settings

    return get_settings()


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database():
    """Connect once and register the document models for the whole session.

    `init_beanie` builds the indexes, so they exist exactly as production would
    have them — which is what makes the uniqueness tests meaningful.
    """
    from beanie import init_beanie
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.models import ALL_DOCUMENT_MODELS

    settings = _test_settings()
    client = AsyncIOMotorClient(
        settings.mongodb_url, tz_aware=True, serverSelectionTimeoutMS=5000
    )

    try:
        await client.admin.command("ping")
    except Exception as exc:  # pragma: no cover - surfaced as a hard failure
        pytest.fail(
            f"MongoDB is not reachable at {settings.mongodb_url}: {exc}\n"
            "Start one with `docker compose up -d mongo` or see backend/README.md.",
            pytrace=False,
        )

    # Start from nothing, so a leftover database from an interrupted run cannot
    # make a test pass or fail spuriously.
    await client.drop_database(settings.test_mongodb_db_name)
    db = client[settings.test_mongodb_db_name]
    await init_beanie(database=db, document_models=list(ALL_DOCUMENT_MODELS))

    yield db

    await client.drop_database(settings.test_mongodb_db_name)
    client.close()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def clean_collections(database) -> AsyncIterator[None]:
    """Empty every collection between tests, keeping the indexes.

    Dropping the database instead would drop the indexes with it, and
    re-running `init_beanie` per test is both slow and would stop the tests
    from exercising the indexes that production actually has.
    """
    from app.models import ALL_DOCUMENT_MODELS

    for model in ALL_DOCUMENT_MODELS:
        await model.get_motor_collection().delete_many({})
    yield


@pytest_asyncio.fixture(loop_scope="session")
async def client(database) -> AsyncIterator:
    """HTTP client bound to the ASGI app.

    `ASGITransport` does not run lifespan events, so the app's own `init_db`
    (which would target the development database) never fires — the `database`
    fixture above has already initialised Beanie against the test database.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client


def signup_payload(**overrides) -> dict:
    payload = {
        "email": "maya@example.com",
        "phone": "+14155552671",
        "password": "correct-horse-9",
        "full_name": "Maya Okonkwo",
        "timezone": "Europe/Berlin",
    }
    payload.update(overrides)
    return payload


async def register(client, **overrides) -> dict[str, str]:
    """Sign up and return ready-to-use auth headers."""
    response = await client.post("/api/v1/auth/signup", json=signup_payload(**overrides))
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def make_user(**overrides):
    """Create an account directly, bypassing HTTP."""
    from app.schemas.auth import SignupRequest
    from app.services.auth import create_user

    return await create_user(SignupRequest(**signup_payload(**overrides)))
