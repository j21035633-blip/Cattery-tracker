from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal

from beanie import PydanticObjectId
from pydantic import BaseModel, Field, field_validator

from app.models.enums import EventStatus
from app.schemas.common import ORMModel

# ISO weekdays: 1 = Monday … 7 = Sunday, matching `datetime.isoweekday()`.
ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]


def _validate_days(value: list[int]) -> list[int]:
    if not value:
        raise ValueError("days_of_week cannot be empty")
    if any(day < 1 or day > 7 for day in value):
        raise ValueError("days_of_week entries must be 1 (Monday) through 7 (Sunday)")
    return sorted(set(value))


class FeedingScheduleBase(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    scheduled_time: time
    days_of_week: list[int] = Field(default_factory=lambda: list(ALL_DAYS))
    food_type: str | None = Field(default=None, max_length=120)
    portion_amount: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    portion_unit: str | None = Field(default=None, max_length=20)
    notes: str | None = None

    @field_validator("days_of_week")
    @classmethod
    def _check_days(cls, value: list[int]) -> list[int]:
        return _validate_days(value)


class FeedingScheduleCreate(FeedingScheduleBase):
    cat_id: PydanticObjectId


class FeedingScheduleUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    scheduled_time: time | None = None
    days_of_week: list[int] | None = None
    food_type: str | None = Field(default=None, max_length=120)
    portion_amount: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    portion_unit: str | None = Field(default=None, max_length=20)
    notes: str | None = None
    is_active: bool | None = None

    @field_validator("days_of_week")
    @classmethod
    def _check_days(cls, value: list[int] | None) -> list[int] | None:
        return _validate_days(value) if value is not None else None


class FeedingScheduleRead(ORMModel, FeedingScheduleBase):
    id: PydanticObjectId
    user_id: PydanticObjectId
    cat_id: PydanticObjectId
    is_active: bool
    created_at: datetime
    updated_at: datetime


class FeedingEventCreate(BaseModel):
    """An ad-hoc feeding, or a manually added slot outside any schedule."""

    cat_id: PydanticObjectId
    due_at: datetime
    schedule_id: PydanticObjectId | None = None
    status: EventStatus = EventStatus.PENDING
    completed_at: datetime | None = None
    notes: str | None = None


class FeedingEventUpdate(BaseModel):
    due_at: datetime | None = None
    status: EventStatus | None = None
    completed_at: datetime | None = None
    notes: str | None = None


class FeedingEventRead(ORMModel):
    id: PydanticObjectId
    user_id: PydanticObjectId
    cat_id: PydanticObjectId
    schedule_id: PydanticObjectId | None
    due_at: datetime
    completed_at: datetime | None
    status: EventStatus
    overdue_alerted_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class FeedingEventComplete(BaseModel):
    completed_at: datetime | None = Field(
        default=None, description="Defaults to now. Use it to backfill a late entry."
    )
    notes: str | None = None


class GenerateEventsRequest(BaseModel):
    """Materialise pending events from the active schedules for a date range."""

    start_date: datetime | None = Field(
        default=None, description="Defaults to the caller's local today."
    )
    days: int = Field(default=1, ge=1, le=31)


class GenerateEventsResult(BaseModel):
    created: int
    skipped_existing: int
    range_start: datetime
    range_end: datetime
