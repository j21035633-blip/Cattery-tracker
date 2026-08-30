"""Feeding schedules and the concrete feeding events generated from them."""

from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal

import pymongo
from beanie import PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

from app.db.base import TenantDocument
from app.models.enums import EventStatus


class FeedingSchedule(TenantDocument):
    """A recurring feeding slot, e.g. "Breakfast, 07:30, every day"."""

    cat_id: PydanticObjectId
    label: str
    # Stored as an ISO string; BSON has no time type.
    scheduled_time: time
    # ISO weekdays, 1 = Monday … 7 = Sunday. All seven means "every day".
    days_of_week: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6, 7])
    food_type: str | None = None
    # Stored as a string so the exact decimal survives; Decimal128 cannot be
    # parsed back by Pydantic.
    portion_amount: Decimal | None = None
    portion_unit: str | None = None
    notes: str | None = None
    is_active: bool = True

    class Settings(TenantDocument.Settings):
        name = "feeding_schedules"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("cat_id", pymongo.ASCENDING)]),
            IndexModel([("user_id", pymongo.ASCENDING), ("is_active", pymongo.ASCENDING)]),
        ]


class FeedingEvent(TenantDocument):
    """One materialised feeding occurrence: due, then completed / missed / skipped."""

    cat_id: PydanticObjectId
    # Nulled rather than cascaded when a schedule is deleted, so completed
    # feeding history survives a schedule change.
    schedule_id: PydanticObjectId | None = None

    due_at: datetime
    completed_at: datetime | None = None
    status: EventStatus = EventStatus.PENDING
    # Set once an overdue alert has fired, so the sweep never double-alerts.
    overdue_alerted_at: datetime | None = None
    notes: str | None = None

    class Settings(TenantDocument.Settings):
        name = "feeding_events"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("due_at", pymongo.ASCENDING)]),
            IndexModel(
                [
                    ("user_id", pymongo.ASCENDING),
                    ("status", pymongo.ASCENDING),
                    ("due_at", pymongo.ASCENDING),
                ]
            ),
            # Makes schedule materialisation idempotent: re-running the generator
            # for a day cannot create duplicate events. Partial, because many
            # ad-hoc events legitimately share a null schedule_id.
            IndexModel(
                [("schedule_id", pymongo.ASCENDING), ("due_at", pymongo.ASCENDING)],
                unique=True,
                partialFilterExpression={"schedule_id": {"$type": "objectId"}},
                name="uq_feeding_events_schedule_due",
            ),
        ]
