from __future__ import annotations

from datetime import date, datetime
from typing import Any

from beanie import PydanticObjectId
from pydantic import BaseModel, Field, field_validator

from app.models.enums import DevicePlatform, NotificationType, TaskType
from app.schemas.common import ORMModel


class NotificationRead(ORMModel):
    id: PydanticObjectId
    user_id: PydanticObjectId
    type: NotificationType
    task_type: TaskType | None
    title: str
    body: str
    payload: dict[str, Any]
    is_read: bool
    read_at: datetime | None
    push_sent_at: datetime | None
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int


class MarkReadResult(BaseModel):
    updated: int


class DueItemRead(BaseModel):
    """One actionable item, normalised across feeding / cleaning / vet."""

    task_type: TaskType
    entity_id: PydanticObjectId
    title: str
    due_at: datetime
    cat_id: PydanticObjectId | None
    cat_name: str | None
    is_overdue: bool
    overdue_by_minutes: int
    breaches_threshold: bool


class DueSummaryRead(BaseModel):
    """Answer to "what's due today?"."""

    local_date: date
    timezone: str
    counts: dict[str, int]
    overdue: list[DueItemRead]
    today: list[DueItemRead]
    upcoming: list[DueItemRead]


class DeviceTokenRegister(BaseModel):
    expo_push_token: str = Field(min_length=10, max_length=255)
    platform: DevicePlatform
    device_name: str | None = Field(default=None, max_length=120)

    @field_validator("expo_push_token")
    @classmethod
    def _check_shape(cls, value: str) -> str:
        # Guards against an FCM/APNs token being registered by mistake — those
        # are rejected by Expo at send time, silently, per device.
        value = value.strip()
        if not (
            value.startswith("ExponentPushToken[")
            or value.startswith("ExpoPushToken[")
        ):
            raise ValueError(
                "expected an Expo push token like ExponentPushToken[xxxxxxxx]"
            )
        return value


class DeviceTokenRead(ORMModel):
    id: PydanticObjectId
    expo_push_token: str
    platform: DevicePlatform
    device_name: str | None
    is_active: bool
    last_seen_at: datetime | None
    created_at: datetime


class DigestPreview(BaseModel):
    title: str
    body: str
    counts: dict[str, int]
