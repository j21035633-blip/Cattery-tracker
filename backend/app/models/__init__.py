"""Document package.

`ALL_DOCUMENT_MODELS` is what `init_beanie` registers. A document missing from
this tuple has no collection mapping and no indexes, and every query against it
fails at runtime — so add new documents here.
"""

from app.db.base import TenantDocument, TimestampedDocument, utcnow
from app.models.cat import Cat
from app.models.cleaning import CleaningEvent, CleaningTask
from app.models.enums import (
    DevicePlatform,
    EventStatus,
    NotificationChannel,
    NotificationType,
    Plan,
    Sex,
    TaskType,
    VetRecordType,
)
from app.models.feeding import FeedingEvent, FeedingSchedule
from app.models.notification import Notification
from app.models.user import (
    DEFAULT_OVERDUE_THRESHOLD_MINUTES,
    DeviceToken,
    NotificationPreference,
    RefreshToken,
    User,
    default_preferences,
)
from app.models.vet import VetRecord
from app.models.weight import MAX_WEIGHT_GRAMS, MIN_WEIGHT_GRAMS, WeightLog

ALL_DOCUMENT_MODELS = (
    User,
    RefreshToken,
    DeviceToken,
    Cat,
    FeedingSchedule,
    FeedingEvent,
    CleaningTask,
    CleaningEvent,
    VetRecord,
    WeightLog,
    Notification,
)

# Every tenant-owned collection, in the order a cascade delete should visit
# them: children before the account itself.
TENANT_DOCUMENT_MODELS = (
    FeedingEvent,
    FeedingSchedule,
    CleaningEvent,
    CleaningTask,
    VetRecord,
    WeightLog,
    Notification,
    DeviceToken,
    RefreshToken,
)

__all__ = [
    "ALL_DOCUMENT_MODELS",
    "DEFAULT_OVERDUE_THRESHOLD_MINUTES",
    "MAX_WEIGHT_GRAMS",
    "MIN_WEIGHT_GRAMS",
    "TENANT_DOCUMENT_MODELS",
    "Cat",
    "CleaningEvent",
    "CleaningTask",
    "DevicePlatform",
    "DeviceToken",
    "EventStatus",
    "FeedingEvent",
    "FeedingSchedule",
    "Notification",
    "NotificationChannel",
    "NotificationPreference",
    "NotificationType",
    "Plan",
    "RefreshToken",
    "Sex",
    "TaskType",
    "TenantDocument",
    "TimestampedDocument",
    "User",
    "VetRecord",
    "VetRecordType",
    "WeightLog",
    "default_preferences",
    "utcnow",
]
