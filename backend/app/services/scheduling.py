"""Turning schedules into concrete, due-dated work.

Everything here is tenant-scoped: each function takes the `User` whose data it
operates on and never widens beyond it. The notification engine reuses these
same helpers, so "what the app shows" and "what the digest says" cannot drift.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pymongo import UpdateOne

from app.db.base import utcnow
from app.models import (
    CleaningEvent,
    CleaningTask,
    EventStatus,
    FeedingEvent,
    FeedingSchedule,
    User,
    VetRecord,
)


def user_tz(user: User) -> ZoneInfo:
    """The account's timezone, falling back to UTC if it was never set."""
    try:
        return ZoneInfo(user.timezone)
    except Exception:  # pragma: no cover - defensive; timezone is validated on write
        return ZoneInfo("UTC")


def local_today(user: User, now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(user_tz(user)).date()


def to_utc(user: User, day: date, at: time) -> datetime:
    """Combine a local calendar day and wall-clock time into a UTC instant.

    On a DST spring-forward day the nominal time may not exist locally; ZoneInfo
    resolves it forward, which is the behaviour a "07:30 breakfast" reminder
    wants (fire once, slightly shifted, rather than not at all).
    """
    return datetime.combine(day, at, tzinfo=user_tz(user)).astimezone(UTC)


def local_day_bounds(user: User, day: date) -> tuple[datetime, datetime]:
    """`[start, end)` in UTC for one of the account's local days."""
    start = to_utc(user, day, time.min)
    end = to_utc(user, day + timedelta(days=1), time.min)
    return start, end


async def materialise_feeding_events(
    user: User, *, start_date: date, days: int = 1
) -> tuple[int, int]:
    """Create pending `FeedingEvent` documents from the account's active schedules.

    Idempotent, via an upsert keyed on `(schedule_id, due_at)` with
    `$setOnInsert`: re-running for an already generated day writes nothing, and
    never overwrites an event the user has since completed. This replaces the
    Postgres `INSERT ... ON CONFLICT DO NOTHING`; the unique partial index on
    the same pair is the backstop. Returns `(created, skipped)`.
    """
    schedules = await FeedingSchedule.find(
        FeedingSchedule.user_id == user.id,
        FeedingSchedule.is_active == True,  # noqa: E712 - Beanie builds the query from this
    ).to_list()
    if not schedules:
        return 0, 0

    now = utcnow()
    operations: list[UpdateOne] = []
    for offset in range(days):
        day = start_date + timedelta(days=offset)
        for schedule in schedules:
            if day.isoweekday() not in schedule.days_of_week:
                continue
            due_at = to_utc(user, day, schedule.scheduled_time)
            operations.append(
                UpdateOne(
                    {"schedule_id": schedule.id, "due_at": due_at},
                    {
                        "$setOnInsert": {
                            "user_id": user.id,
                            "cat_id": schedule.cat_id,
                            "schedule_id": schedule.id,
                            "due_at": due_at,
                            "status": EventStatus.PENDING.value,
                            "completed_at": None,
                            "overdue_alerted_at": None,
                            "notes": None,
                            "created_at": now,
                            "updated_at": now,
                        }
                    },
                    upsert=True,
                )
            )

    if not operations:
        return 0, 0

    result = await FeedingEvent.get_motor_collection().bulk_write(
        operations, ordered=False
    )
    created = len(result.upserted_ids)
    return created, len(operations) - created


def complete_feeding_event(
    event: FeedingEvent, *, completed_at: datetime | None = None
) -> FeedingEvent:
    event.completed_at = completed_at or utcnow()
    event.status = EventStatus.COMPLETED
    # Clear the alert latch so a re-opened event can alert again.
    event.overdue_alerted_at = None
    return event


def skip_feeding_event(event: FeedingEvent, *, notes: str | None = None) -> FeedingEvent:
    event.status = EventStatus.SKIPPED
    event.completed_at = None
    event.overdue_alerted_at = None
    if notes:
        event.notes = notes
    return event


def next_cleaning_due(task: CleaningTask, *, from_time: datetime) -> datetime:
    """Recurring cleaning advances from when it was actually done.

    Advancing from the old `next_due_at` instead would pile up a backlog of
    already-overdue occurrences after a few missed days.
    """
    return from_time + timedelta(hours=task.interval_hours)


def complete_cleaning_task(
    task: CleaningTask, *, completed_at: datetime | None = None, notes: str | None = None
) -> CleaningEvent:
    """Log the completion and roll the task forward. Returns the new event."""
    done_at = completed_at or utcnow()
    event = CleaningEvent(
        user_id=task.user_id,
        task_id=task.id,
        due_at=task.next_due_at,
        completed_at=done_at,
        status=EventStatus.COMPLETED,
        notes=notes,
    )
    task.last_completed_at = done_at
    task.next_due_at = next_cleaning_due(task, from_time=done_at)
    task.overdue_alerted_at = None
    return event


def complete_vet_record(
    record: VetRecord,
    *,
    completed_at: datetime | None = None,
    next_due_at: datetime | None = None,
) -> VetRecord | None:
    """Close out a visit/dose; optionally book the follow-up as a new record.

    A new row (rather than moving `due_at`) keeps the history: last year's
    booster stays visible after this year's is scheduled.
    """
    record.completed_at = completed_at or utcnow()
    record.overdue_alerted_at = None

    if next_due_at is None:
        return None
    return VetRecord(
        user_id=record.user_id,
        cat_id=record.cat_id,
        record_type=record.record_type,
        title=record.title,
        description=record.description,
        vet_name=record.vet_name,
        clinic_name=record.clinic_name,
        due_at=next_due_at,
        reminder_days_before=record.reminder_days_before,
    )
