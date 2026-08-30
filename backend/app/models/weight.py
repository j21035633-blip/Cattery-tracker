"""Weight measurements per cat."""

from __future__ import annotations

from datetime import datetime

import pymongo
from beanie import PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

from app.db.base import TenantDocument, utcnow

# 100 g to 40 kg: wide enough for a newborn kitten and a very large cat, tight
# enough to catch a grams/kilograms mix-up. Postgres enforced the lower bound
# with a CHECK constraint; MongoDB has none, so the bound is declared here on
# the document and re-checked in the request schema.
MIN_WEIGHT_GRAMS = 100
MAX_WEIGHT_GRAMS = 40_000


class WeightLog(TenantDocument):
    cat_id: PydanticObjectId
    # Stored in grams so the clients can render kg or lb without float drift.
    weight_grams: int = Field(gt=0, le=MAX_WEIGHT_GRAMS)
    measured_at: datetime = Field(default_factory=utcnow)
    notes: str | None = None

    class Settings(TenantDocument.Settings):
        name = "weight_logs"
        indexes = [
            IndexModel(
                [
                    ("user_id", pymongo.ASCENDING),
                    ("cat_id", pymongo.ASCENDING),
                    ("measured_at", pymongo.DESCENDING),
                ]
            ),
        ]
