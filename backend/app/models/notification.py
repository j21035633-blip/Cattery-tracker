"""In-app notification centre documents (each also records a push attempt)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pymongo
from pydantic import Field
from pymongo import IndexModel

from app.db.base import TenantDocument
from app.models.enums import NotificationType, TaskType


class Notification(TenantDocument):
    type: NotificationType
    task_type: TaskType | None = None
    title: str
    body: str

    # Deep-link target for the web/mobile clients, e.g. {"screen": "cat", ...}.
    payload: dict[str, Any] = Field(default_factory=dict)
    dedupe_key: str | None = None

    is_read: bool = False
    read_at: datetime | None = None
    push_sent_at: datetime | None = None
    push_error: str | None = None

    class Settings(TenantDocument.Settings):
        name = "notifications"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)]),
            # Powers the unread badge without scanning a tenant's whole history.
            IndexModel(
                [("user_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)],
                partialFilterExpression={"is_read": False},
                name="ix_notifications_unread",
            ),
            # One digest per tenant per local day, and one alert per overdue
            # item: the sweep relies on this to stay idempotent if it runs twice.
            IndexModel(
                [("user_id", pymongo.ASCENDING), ("dedupe_key", pymongo.ASCENDING)],
                unique=True,
                partialFilterExpression={"dedupe_key": {"$type": "string"}},
                name="uq_notifications_dedupe_key",
            ),
        ]
