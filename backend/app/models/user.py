"""Account, session and push-device documents."""

from __future__ import annotations

from datetime import datetime, time

import pymongo
from beanie import Indexed
from pydantic import BaseModel, EmailStr, Field
from pymongo import IndexModel

from app.db.base import TenantDocument, TimestampedDocument
from app.models.enums import DevicePlatform, Plan, TaskType

# Defaults from SKILL.md: feeding 2h, cleaning 6h, vet 24h. Vaccination follows
# vet; medication is tighter because a missed dose matters sooner.
DEFAULT_OVERDUE_THRESHOLD_MINUTES: dict[TaskType, int] = {
    TaskType.FEEDING: 120,
    TaskType.CLEANING: 360,
    TaskType.VET: 1440,
    TaskType.VACCINATION: 1440,
    TaskType.MEDICATION: 60,
}


class NotificationPreference(BaseModel):
    """Per-task-type overdue threshold and channel toggles.

    Embedded in the owning `User` rather than kept in its own collection. Three
    reasons: signup becomes a single atomic insert (no transaction needed for a
    user and its five preference rows, which matters because a standalone
    mongod has no multi-document transactions); the digest and the overdue sweep
    always need these alongside the account anyway; and a preference physically
    cannot be orphaned or attached to the wrong tenant.

    The API shape is unchanged — the endpoints still read and patch them
    individually.
    """

    task_type: TaskType
    overdue_threshold_minutes: int
    in_app_enabled: bool = True
    push_enabled: bool = True
    include_in_digest: bool = True


def default_preferences() -> list[NotificationPreference]:
    return [
        NotificationPreference(task_type=task_type, overdue_threshold_minutes=minutes)
        for task_type, minutes in DEFAULT_OVERDUE_THRESHOLD_MINUTES.items()
    ]


class User(TimestampedDocument):
    """The tenant root. Not a `TenantDocument` — it *is* the tenant."""

    # Stored lowercased/trimmed; see `services.auth.normalise_email`.
    email: Indexed(EmailStr, unique=True)  # type: ignore[valid-type]
    phone: Indexed(str, unique=True)  # type: ignore[valid-type]
    hashed_password: str
    full_name: str | None = None

    plan: Plan = Plan.FREE
    is_active: bool = True
    is_email_verified: bool = False

    # IANA name; the digest scheduler resolves the account's local 08:00 with it.
    timezone: str = "UTC"
    digest_enabled: bool = True
    digest_time: time = time(8, 0)
    push_enabled: bool = True

    notification_preferences: list[NotificationPreference] = Field(
        default_factory=default_preferences
    )

    last_login_at: datetime | None = None

    class Settings(TimestampedDocument.Settings):
        name = "users"

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.email}>"

    def preference_for(self, task_type: TaskType) -> NotificationPreference:
        """The account's preference, falling back to the shipped default.

        The fallback matters for accounts created before a task type existed.
        """
        for preference in self.notification_preferences:
            if preference.task_type == task_type:
                return preference
        return NotificationPreference(
            task_type=task_type,
            overdue_threshold_minutes=DEFAULT_OVERDUE_THRESHOLD_MINUTES[task_type],
        )


class RefreshToken(TenantDocument):
    """One document per issued refresh token, stored as a SHA-256 digest."""

    token_hash: Indexed(str, unique=True)  # type: ignore[valid-type]
    expires_at: datetime
    revoked_at: datetime | None = None
    user_agent: str | None = None

    class Settings(TenantDocument.Settings):
        name = "refresh_tokens"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("expires_at", pymongo.ASCENDING)]),
        ]

    def is_usable(self, now: datetime) -> bool:
        return self.revoked_at is None and self.expires_at > now


class DeviceToken(TenantDocument):
    """Expo push token for a signed-in device (used by the EAS push sender)."""

    expo_push_token: Indexed(str, unique=True)  # type: ignore[valid-type]
    platform: DevicePlatform
    device_name: str | None = None
    is_active: bool = True
    last_seen_at: datetime | None = None

    class Settings(TenantDocument.Settings):
        name = "device_tokens"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("is_active", pymongo.ASCENDING)]),
        ]
