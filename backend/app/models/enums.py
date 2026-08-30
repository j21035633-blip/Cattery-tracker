"""Enumerations shared by documents and schemas.

`StrEnum` so each value stores as a plain BSON string and serialises to the same
string in JSON — no enum type to migrate, unlike the Postgres version.
"""

from __future__ import annotations

from enum import StrEnum


class Plan(StrEnum):
    FREE = "free"
    PRO = "pro"


class Sex(StrEnum):
    MALE = "male"
    FEMALE = "female"
    UNKNOWN = "unknown"


class TaskType(StrEnum):
    """Task families that have configurable overdue thresholds."""

    FEEDING = "feeding"
    CLEANING = "cleaning"
    VET = "vet"
    VACCINATION = "vaccination"
    MEDICATION = "medication"


class EventStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    MISSED = "missed"
    SKIPPED = "skipped"


class VetRecordType(StrEnum):
    APPOINTMENT = "appointment"
    VACCINATION = "vaccination"
    MEDICATION = "medication"
    TREATMENT = "treatment"
    NOTE = "note"


class NotificationType(StrEnum):
    DAILY_DIGEST = "daily_digest"
    OVERDUE = "overdue"
    UPCOMING = "upcoming"
    SYSTEM = "system"


class NotificationChannel(StrEnum):
    IN_APP = "in_app"
    PUSH = "push"


class DevicePlatform(StrEnum):
    IOS = "ios"
    ANDROID = "android"
    WEB = "web"

