"""Application settings, loaded from the environment (12-factor / Railway friendly)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: Literal["local", "test", "production"] = "local"
    project_name: str = "Cattery Tracker API"
    api_v1_prefix: str = "/api/v1"

    secret_key: str = Field(min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    # Railway's MongoDB plugin injects MONGO_URL; MONGODB_URL wins if both are set.
    mongodb_url: str = "mongodb://127.0.0.1:27017"
    mongo_url: str | None = None
    mongodb_db_name: str = "cattery"
    # Integration tests run against this database and drop it between tests, so
    # it must never point at the development one.
    test_mongodb_db_name: str = "cattery_test"

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8081"]

    # --- Notifications ---
    # Optional: only needed when the Expo project enforces enhanced push security.
    expo_access_token: str | None = None
    # How often the overdue sweep runs. SKILL.md asks for every 15-30 minutes.
    overdue_sweep_interval_minutes: int = 15
    digest_check_interval_minutes: int = 15
    notification_retention_days: int = 90

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        # Accept both a JSON array and a plain comma-separated string.
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _prefer_explicit_mongodb_url(self) -> Settings:
        # Only fall back to the provider's MONGO_URL when MONGODB_URL was left
        # at its local default, so an explicit setting always wins.
        if self.mongo_url and self.mongodb_url == "mongodb://127.0.0.1:27017":
            self.mongodb_url = self.mongo_url
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
