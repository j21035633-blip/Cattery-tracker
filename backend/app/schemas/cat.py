from __future__ import annotations

from datetime import date, datetime

from beanie import PydanticObjectId
from pydantic import BaseModel, Field, field_validator

from app.models.enums import Sex
from app.schemas.common import ORMModel


def _validate_not_future(value: date | None) -> date | None:
    if value is not None and value > date.today():
        raise ValueError("date of birth cannot be in the future")
    return value


class CatBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    breed: str | None = Field(default=None, max_length=80)
    color: str | None = Field(default=None, max_length=60)
    sex: Sex = Sex.UNKNOWN
    date_of_birth: date | None = None
    microchip_id: str | None = Field(default=None, max_length=40)
    photo_url: str | None = Field(default=None, max_length=500)
    notes: str | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _check_dob(cls, value: date | None) -> date | None:
        return _validate_not_future(value)


class CatCreate(CatBase):
    pass


class CatUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    breed: str | None = Field(default=None, max_length=80)
    color: str | None = Field(default=None, max_length=60)
    sex: Sex | None = None
    date_of_birth: date | None = None
    microchip_id: str | None = Field(default=None, max_length=40)
    photo_url: str | None = Field(default=None, max_length=500)
    notes: str | None = None
    is_active: bool | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _check_dob(cls, value: date | None) -> date | None:
        return _validate_not_future(value)


class CatRead(ORMModel, CatBase):
    id: PydanticObjectId
    user_id: PydanticObjectId
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @property
    def age_days(self) -> int | None:
        if self.date_of_birth is None:
            return None
        return (date.today() - self.date_of_birth).days
