from __future__ import annotations

from datetime import datetime

from beanie import PydanticObjectId
from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

# 100 g to 40 kg: wide enough for a newborn kitten and a very large cat, tight
# enough to catch a grams/kilograms mix-up.
MIN_WEIGHT_GRAMS = 100
MAX_WEIGHT_GRAMS = 40_000


class WeightLogCreate(BaseModel):
    cat_id: PydanticObjectId
    weight_grams: int = Field(ge=MIN_WEIGHT_GRAMS, le=MAX_WEIGHT_GRAMS)
    measured_at: datetime | None = Field(default=None, description="Defaults to now.")
    notes: str | None = None


class WeightLogUpdate(BaseModel):
    weight_grams: int | None = Field(
        default=None, ge=MIN_WEIGHT_GRAMS, le=MAX_WEIGHT_GRAMS
    )
    measured_at: datetime | None = None
    notes: str | None = None


class WeightLogRead(ORMModel):
    id: PydanticObjectId
    user_id: PydanticObjectId
    cat_id: PydanticObjectId
    weight_grams: int
    measured_at: datetime
    notes: str | None
    created_at: datetime

    @property
    def weight_kg(self) -> float:
        return round(self.weight_grams / 1000, 3)


class WeightTrend(BaseModel):
    """Summary for a cat's weight chart."""

    cat_id: PydanticObjectId
    samples: int
    first_measured_at: datetime | None
    latest_measured_at: datetime | None
    latest_grams: int | None
    change_grams: int | None = Field(
        default=None, description="Latest minus earliest in the window."
    )
    min_grams: int | None
    max_grams: int | None
