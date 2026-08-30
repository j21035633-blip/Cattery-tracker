"""Beanie document base classes and the tenancy contract.

Two things every collection in this app gets:

* timestamps that maintain themselves, and
* for tenant-owned data, a required `user_id`.

BSON has no `time`, `date` or `Decimal` type, so those are encoded on the way
in and parsed back by Pydantic on the way out. The `datetime` identity encoder
is load-bearing: `datetime` subclasses `date`, so without it the `date` encoder
also captures every timestamp and stores it as a **string** — which silently
turns every `due_at` range query into a string comparison.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any

from beanie import Document, Insert, PydanticObjectId, Replace, SaveChanges, before_event
from pydantic import Field, model_validator

BSON_ENCODERS: dict[type, Any] = {
    datetime: lambda value: value,  # keep native BSON dates; must stay first
    date: lambda value: value.isoformat(),
    time: lambda value: value.isoformat(),
    Decimal: str,  # exact round-trip; Decimal128 cannot be parsed back by Pydantic
}


def truncate_to_millis(value: datetime) -> datetime:
    """Drop sub-millisecond precision.

    BSON stores datetimes as milliseconds since the epoch, so microseconds are
    lost on write. Without normalising, the object the API returns from a POST
    carries microseconds that the very next GET will not — the same record
    appears to change on its own. Truncating on the way in makes what a client
    is told exactly what is stored.
    """
    return value.replace(microsecond=(value.microsecond // 1000) * 1000)


def utcnow() -> datetime:
    return truncate_to_millis(datetime.now(UTC))


class TimestampedDocument(Document):
    """Adds `created_at` / `updated_at` that keep themselves current."""

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @before_event(Insert, Replace, SaveChanges)
    def _touch(self) -> None:
        self.updated_at = utcnow()

    @model_validator(mode="after")
    def _match_bson_datetime_precision(self) -> TimestampedDocument:
        # Applies to client-supplied timestamps too, not just our own clock.
        for name, value in list(self.__dict__.items()):
            if type(value) is datetime and value.microsecond % 1000:
                self.__dict__[name] = truncate_to_millis(value)
        return self

    class Settings:
        bson_encoders = BSON_ENCODERS
        # Only send changed fields on save_changes(), so two concurrent updates
        # to different fields of one document do not clobber each other.
        use_state_management = True


class TenantDocument(TimestampedDocument):
    """A document owned by exactly one account.

    `user_id` is mandatory and indexed. Postgres enforced this with a foreign
    key; MongoDB has none, so the guarantee now lives in two places: this
    required field, and the query helpers in `app.db.tenancy`, which are the
    only sanctioned way to read tenant data.
    """

    user_id: PydanticObjectId

    class Settings(TimestampedDocument.Settings):
        pass
