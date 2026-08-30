"""Litter / cleaning rotation tasks and their completion log."""

from __future__ import annotations

from datetime import datetime

import pymongo
from beanie import PydanticObjectId
from pymongo import IndexModel

from app.db.base import TenantDocument
from app.models.enums import EventStatus


class CleaningTask(TenantDocument):
    """A recurring cleaning job attached to a zone (litter box, room, pen…).

    Rotation is expressed as `zone` + `rotation_order`: the digest walks a
    tenant's zones in that order so reminders spread across zones instead of
    all firing on the same day.
    """

    name: str
    zone: str
    rotation_order: int = 0
    interval_hours: int
    next_due_at: datetime
    last_completed_at: datetime | None = None
    overdue_alerted_at: datetime | None = None
    notes: str | None = None
    is_active: bool = True

    class Settings(TenantDocument.Settings):
        name = "cleaning_tasks"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("next_due_at", pymongo.ASCENDING)]),
            IndexModel([("user_id", pymongo.ASCENDING), ("zone", pymongo.ASCENDING)]),
        ]


class CleaningEvent(TenantDocument):
    """History of cleaning completions, for the "who cleaned what" view."""

    task_id: PydanticObjectId | None = None
    due_at: datetime
    completed_at: datetime | None = None
    status: EventStatus = EventStatus.PENDING
    notes: str | None = None

    class Settings(TenantDocument.Settings):
        name = "cleaning_events"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("due_at", pymongo.DESCENDING)]),
            IndexModel([("user_id", pymongo.ASCENDING), ("task_id", pymongo.ASCENDING)]),
        ]
