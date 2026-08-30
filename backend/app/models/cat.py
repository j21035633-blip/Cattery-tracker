"""Cat profile — the tenant's root domain object."""

from __future__ import annotations

from datetime import date

import pymongo
from pymongo import IndexModel

from app.db.base import TenantDocument
from app.models.enums import Sex


class Cat(TenantDocument):
    name: str
    breed: str | None = None
    color: str | None = None
    sex: Sex = Sex.UNKNOWN
    # Stored as an ISO string; BSON has no date type. See app/db/base.py.
    date_of_birth: date | None = None
    microchip_id: str | None = None
    photo_url: str | None = None
    notes: str | None = None
    is_active: bool = True

    class Settings(TenantDocument.Settings):
        name = "cats"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("name", pymongo.ASCENDING)]),
            IndexModel([("user_id", pymongo.ASCENDING), ("is_active", pymongo.ASCENDING)]),
        ]
