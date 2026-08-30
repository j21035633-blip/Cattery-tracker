"""Vet visits, vaccinations and medication schedules."""

from __future__ import annotations

from datetime import datetime

import pymongo
from beanie import PydanticObjectId
from pymongo import IndexModel

from app.db.base import TenantDocument
from app.models.enums import VetRecordType


class VetRecord(TenantDocument):
    cat_id: PydanticObjectId
    record_type: VetRecordType
    title: str
    description: str | None = None
    vet_name: str | None = None
    clinic_name: str | None = None

    # When it happened (past) and when the next one is owed (future). A
    # vaccination typically has both.
    occurred_at: datetime | None = None
    due_at: datetime | None = None
    completed_at: datetime | None = None
    reminder_days_before: int = 7
    overdue_alerted_at: datetime | None = None
    is_active: bool = True

    class Settings(TenantDocument.Settings):
        name = "vet_records"
        indexes = [
            IndexModel([("user_id", pymongo.ASCENDING), ("due_at", pymongo.ASCENDING)]),
            IndexModel([("user_id", pymongo.ASCENDING), ("cat_id", pymongo.ASCENDING)]),
            IndexModel([("user_id", pymongo.ASCENDING), ("completed_at", pymongo.ASCENDING)]),
        ]
