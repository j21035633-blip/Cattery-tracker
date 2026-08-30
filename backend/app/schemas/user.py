from __future__ import annotations

import re
from datetime import datetime, time

from beanie import PydanticObjectId
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import Plan, TaskType
from app.schemas.common import ORMModel

# E.164: leading +, country code 1-9, up to 15 digits total.
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")

PASSWORD_MIN_LENGTH = 10


def normalise_phone(value: str) -> str:
    """Strip spaces, dashes and parentheses, then require E.164."""
    cleaned = re.sub(r"[\s()\-.]", "", value.strip())
    if not E164_RE.match(cleaned):
        raise ValueError(
            "phone must be in international E.164 format, e.g. +14155552671"
        )
    return cleaned


def validate_timezone(value: str) -> str:
    """Require a real IANA name — the daily digest resolves local time with it."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown IANA timezone: {value}") from exc
    return value


def validate_password_strength(value: str) -> str:
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"password must be at least {PASSWORD_MIN_LENGTH} characters")
    if value.isdigit() or value.isalpha():
        raise ValueError("password must mix letters with numbers or symbols")
    return value


class NotificationPreferenceRead(ORMModel):
    task_type: TaskType
    overdue_threshold_minutes: int
    in_app_enabled: bool
    push_enabled: bool
    include_in_digest: bool


class NotificationPreferenceUpdate(BaseModel):
    task_type: TaskType
    # 5 minutes to 14 days: below that the sweep would alert on itself, above it
    # the alert is no longer an alert.
    overdue_threshold_minutes: int | None = Field(default=None, ge=5, le=20160)
    in_app_enabled: bool | None = None
    push_enabled: bool | None = None
    include_in_digest: bool | None = None


class UserRead(ORMModel):
    id: PydanticObjectId
    email: EmailStr
    phone: str
    full_name: str | None
    plan: Plan
    is_active: bool
    is_email_verified: bool
    timezone: str
    digest_enabled: bool
    digest_time: time
    push_enabled: bool
    last_login_at: datetime | None
    created_at: datetime
    notification_preferences: list[NotificationPreferenceRead] = []


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    phone: str | None = None
    timezone: str | None = Field(default=None, max_length=64)
    digest_enabled: bool | None = None
    digest_time: time | None = None
    push_enabled: bool | None = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return normalise_phone(value) if value is not None else None

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, value: str | None) -> str | None:
        return validate_timezone(value) if value is not None else None
