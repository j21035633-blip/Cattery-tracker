"""What is due, upcoming, or overdue for one account.

Single source of truth for both the in-app "what's due today?" view and the
daily digest, so the two can never disagree.

Thresholds come from the account's embedded notification preferences, per task
type, exactly as SKILL.md specifies.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from beanie import PydanticObjectId

from app.db.base import utcnow
from app.models import (
    Cat,
    CleaningTask,
    EventStatus,
    FeedingEvent,
    TaskType,
    User,
    VetRecord,
    VetRecordType,
)
from app.services import scheduling

# How far ahead "upcoming" looks. SKILL.md asks the digest to cover
# vet/vaccination deadlines for the week.
UPCOMING_WINDOW_DAYS = 7


@dataclass(slots=True)
class DueItem:
    """One actionable thing, normalised across the four task families."""

    task_type: TaskType
    entity_id: PydanticObjectId
    title: str
    due_at: datetime
    cat_id: PydanticObjectId | None = None
    cat_name: str | None = None
    is_overdue: bool = False
    overdue_by_minutes: int = 0
    # True once the item has passed its per-task-type alert threshold.
    breaches_threshold: bool = False
    already_alerted: bool = False

    @property
    def sort_key(self) -> datetime:
        return self.due_at


@dataclass(slots=True)
class DueSummary:
    local_date: date
    timezone: str
    overdue: list[DueItem] = field(default_factory=list)
    today: list[DueItem] = field(default_factory=list)
    upcoming: list[DueItem] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.overdue or self.today or self.upcoming)

    def counts(self) -> dict[str, int]:
        return {
            "overdue": len(self.overdue),
            "today": len(self.today),
            "upcoming": len(self.upcoming),
        }


def thresholds_for(user: User) -> dict[TaskType, timedelta]:
    """The account's overdue thresholds, keyed by task type.

    Preferences are embedded in the user document, so this needs no query;
    `preference_for` falls back to the shipped default for any task type the
    account predates.
    """
    return {
        task_type: timedelta(minutes=user.preference_for(task_type).overdue_threshold_minutes)
        for task_type in TaskType
    }


def _vet_task_type(record: VetRecord) -> TaskType:
    """Vaccinations and medications have their own thresholds; the rest are `vet`."""
    if record.record_type is VetRecordType.VACCINATION:
        return TaskType.VACCINATION
    if record.record_type is VetRecordType.MEDICATION:
        return TaskType.MEDICATION
    return TaskType.VET


async def _cat_names(user: User) -> dict[PydanticObjectId, str]:
    cats = await Cat.find(Cat.user_id == user.id).project(None).to_list()
    return {cat.id: cat.name for cat in cats}


async def build_due_summary(user: User, *, now: datetime | None = None) -> DueSummary:
    """Everything the account owes across feeding, cleaning and vet care.

    Every query is filtered by `user.id`; nothing here can read another tenant.
    """
    now = now or utcnow()
    thresholds = thresholds_for(user)
    cat_names = await _cat_names(user)

    today = scheduling.local_today(user, now)
    day_start, day_end = scheduling.local_day_bounds(user, today)
    horizon = day_end + timedelta(days=UPCOMING_WINDOW_DAYS - 1)

    summary = DueSummary(local_date=today, timezone=user.timezone)
    items: list[DueItem] = []

    # -- Feeding -----------------------------------------------------------
    feeding_events = await FeedingEvent.find(
        FeedingEvent.user_id == user.id,
        FeedingEvent.status == EventStatus.PENDING,
        FeedingEvent.due_at < horizon,
    ).to_list()
    for event in feeding_events:
        items.append(
            _make_item(
                task_type=TaskType.FEEDING,
                entity_id=event.id,
                title=f"Feed {cat_names.get(event.cat_id, 'Cat')}",
                due_at=event.due_at,
                cat_id=event.cat_id,
                cat_names=cat_names,
                now=now,
                threshold=thresholds[TaskType.FEEDING],
                already_alerted=event.overdue_alerted_at is not None,
            )
        )

    # -- Cleaning ----------------------------------------------------------
    cleaning_tasks = await CleaningTask.find(
        CleaningTask.user_id == user.id,
        CleaningTask.is_active == True,  # noqa: E712 - Beanie builds the query from this
        CleaningTask.next_due_at < horizon,
    ).to_list()
    for task in cleaning_tasks:
        items.append(
            _make_item(
                task_type=TaskType.CLEANING,
                entity_id=task.id,
                title=f"{task.name} — {task.zone}",
                due_at=task.next_due_at,
                cat_id=None,
                cat_names=cat_names,
                now=now,
                threshold=thresholds[TaskType.CLEANING],
                already_alerted=task.overdue_alerted_at is not None,
            )
        )

    # -- Vet / vaccination / medication -------------------------------------
    vet_records = await VetRecord.find(
        VetRecord.user_id == user.id,
        VetRecord.is_active == True,  # noqa: E712
        VetRecord.completed_at == None,  # noqa: E711
        VetRecord.due_at != None,  # noqa: E711
        VetRecord.due_at < horizon,
    ).to_list()
    for record in vet_records:
        task_type = _vet_task_type(record)
        items.append(
            _make_item(
                task_type=task_type,
                entity_id=record.id,
                title=record.title,
                due_at=record.due_at,
                cat_id=record.cat_id,
                cat_names=cat_names,
                now=now,
                threshold=thresholds[task_type],
                already_alerted=record.overdue_alerted_at is not None,
            )
        )

    # -- Bucket ------------------------------------------------------------
    for item in items:
        if item.is_overdue:
            summary.overdue.append(item)
        elif day_start <= item.due_at < day_end:
            summary.today.append(item)
        else:
            summary.upcoming.append(item)

    for bucket in (summary.overdue, summary.today, summary.upcoming):
        bucket.sort(key=lambda entry: entry.sort_key)
    return summary


def _make_item(
    *,
    task_type: TaskType,
    entity_id: PydanticObjectId,
    title: str,
    due_at: datetime,
    cat_id: PydanticObjectId | None,
    cat_names: dict[PydanticObjectId, str],
    now: datetime,
    threshold: timedelta,
    already_alerted: bool,
) -> DueItem:
    # The client is opened tz_aware, so stored dates come back aware; be
    # defensive in case a document was written by something that was not.
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=UTC)

    overdue_by = now - due_at
    return DueItem(
        task_type=task_type,
        entity_id=entity_id,
        title=title,
        due_at=due_at,
        cat_id=cat_id,
        cat_name=cat_names.get(cat_id) if cat_id else None,
        is_overdue=overdue_by > timedelta(0),
        overdue_by_minutes=max(0, int(overdue_by.total_seconds() // 60)),
        breaches_threshold=overdue_by > threshold,
        already_alerted=already_alerted,
    )
