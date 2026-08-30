"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.db.mongo import close_db, init_db, ping

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Beanie has to be initialised before any request touches a document, and
    # this is also what creates the collections' indexes — including the unique
    # and partial ones that replace the old Postgres constraints. There is no
    # migration step any more.
    await init_db()
    yield
    await close_db()


app = FastAPI(
    title=settings.project_name,
    version="0.2.0",
    description=(
        "Multi-tenant cattery management API. Every tenant-owned document "
        "carries `user_id`; requests are scoped to the account in the bearer token."
    ),
    openapi_url=None if settings.is_production else "/openapi.json",
    docs_url=None if settings.is_production else "/docs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["meta"], summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


@app.get("/health/db", tags=["meta"], summary="Readiness probe (checks MongoDB)")
async def health_db() -> dict[str, str]:
    await ping()
    return {"status": "ok", "database": "reachable"}
