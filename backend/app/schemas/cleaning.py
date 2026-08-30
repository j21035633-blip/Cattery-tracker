from __future__ import annotations

from datetime import datetime

from beanie import PydanticObjectId
from pydantic import BaseModel, Field

from app.models.enums import EventStatus
from app.schemas.common import ORMModel


class CleaningTaskBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    zone: str = Field(
        min_length=1, max_length=80, description="Litter box, room or pen this covers"
    )
    # 1 hour to 90 days.
    interval_hours: int = Field(ge=1, le=2160)
    rotation_order: int = Field(
        default=0,
        ge=0,
        description="Position in the zone rotation; the digest walks zones in this order.",
    )
    notes: str | None = None


class CleaningTaskCreate(CleaningTaskBase):
    next_due_at: datetime | None = Field(
        default=None, description="Defaults to now + interval_hours."
    )


class CleaningTaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    zone: str | None = Field(default=None, min_length=1, max_length=80)
    interval_hours: int | None = Field(default=None, ge=1, le=2160)
    rotation_order: int | None = Field(default=None, ge=0)
    next_due_at: datetime | None = None
    notes: str | None = None
    is_active: bool | None = None


class CleaningTaskRead(ORMModel, CleaningTaskBase):
    id: PydanticObjectId
    user_id: PydanticObjectId
    next_due_at: datetime
    last_completed_at: datetime | None
    overdue_alerted_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CleaningTaskComplete(BaseModel):
    completed_at: datetime | None = Field(
        default=None, description="Defaults to now. Use it to backfill a late entry."
    )
    notes: str | None = None


class CleaningEventRead(ORMModel):
    id: PydanticObjectId
    user_id: PydanticObjectId
    task_id: PydanticObjectId | None
    due_at: datetime
    completed_at: datetime | None
    status: EventStatus
    notes: str | None
    created_at: datetime


class CleaningTaskCompleteResult(BaseModel):
    task: CleaningTaskRead
    event: CleaningEventRead
