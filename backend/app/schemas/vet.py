from __future__ import annotations

from datetime import datetime

from beanie import PydanticObjectId
from pydantic import BaseModel, Field, model_validator

from app.models.enums import VetRecordType
from app.schemas.common import ORMModel


class VetRecordBase(BaseModel):
    record_type: VetRecordType
    title: str = Field(min_length=1, max_length=160)
    description: str | None = None
    vet_name: str | None = Field(default=None, max_length=120)
    clinic_name: str | None = Field(default=None, max_length=120)
    occurred_at: datetime | None = Field(
        default=None, description="When the visit/dose happened."
    )
    due_at: datetime | None = Field(
        default=None, description="When the next one is owed; drives reminders."
    )
    reminder_days_before: int = Field(default=7, ge=0, le=365)


class VetRecordCreate(VetRecordBase):
    cat_id: PydanticObjectId

    @model_validator(mode="after")
    def _needs_a_date(self) -> VetRecordCreate:
        if self.occurred_at is None and self.due_at is None:
            raise ValueError("a vet record needs occurred_at, due_at, or both")
        return self


class VetRecordUpdate(BaseModel):
    record_type: VetRecordType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    vet_name: str | None = Field(default=None, max_length=120)
    clinic_name: str | None = Field(default=None, max_length=120)
    occurred_at: datetime | None = None
    due_at: datetime | None = None
    completed_at: datetime | None = None
    reminder_days_before: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None


class VetRecordRead(ORMModel, VetRecordBase):
    id: PydanticObjectId
    user_id: PydanticObjectId
    cat_id: PydanticObjectId
    completed_at: datetime | None
    overdue_alerted_at: datetime | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class VetRecordComplete(BaseModel):
    completed_at: datetime | None = Field(default=None, description="Defaults to now.")
    next_due_at: datetime | None = Field(
        default=None,
        description="Schedule the follow-up in one call, e.g. next year's booster.",
    )
    notes: str | None = None
