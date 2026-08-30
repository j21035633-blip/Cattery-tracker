"""The notification engine: in-app notification centre + native push.

Two triggers, per SKILL.md:

* **Daily digest** — once per day at the account's local `digest_time`
  (08:00 default). Summarises today's feedings, cleaning due today,
  vet/vaccination deadlines this week, and flags anything overdue.
* **Overdue alerts** — a periodic sweep (every 15–30 minutes) that alerts on any
  task past its per-task-type threshold, once per item.

No Telegram, no WhatsApp, no email: in-app documents plus Expo push only.

Deduplication uses an upsert with `$setOnInsert` against the unique partial
index on `(user_id, dedupe_key)`. That is what replaces the Postgres
`ON CONFLICT DO NOTHING`, and it is what makes a double-run of the sweep — or a
sweep racing a manual "send digest now" — safe.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from beanie import PydanticObjectId

from app.db.base import utcnow
from app.models import (
    CleaningTask,
    DeviceToken,
    EventStatus,
    FeedingEvent,
    Notification,
    NotificationType,
    TaskType,
    User,
    VetRecord,
)
from app.services import push
from app.services.due import DueItem, DueSummary, build_due_summary

# Which collection carries the `overdue_alerted_at` latch for each task type.
_ALERT_LATCH_MODEL = {
    TaskType.FEEDING: FeedingEvent,
    TaskType.CLEANING: CleaningTask,
    TaskType.VET: VetRecord,
    TaskType.VACCINATION: VetRecord,
    TaskType.MEDICATION: VetRecord,
}


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

async def active_push_tokens(user: User) -> list[str]:
    if not user.push_enabled:
        return []
    devices = await DeviceToken.find(
        DeviceToken.user_id == user.id,
        DeviceToken.is_active == True,  # noqa: E712 - Beanie builds the query from this
    ).to_list()
    return [device.expo_push_token for device in devices]


async def deactivate_tokens(user: User, tokens: list[str]) -> None:
    """Retire tokens Expo reported as unregistered (app deleted, etc.)."""
    if not tokens:
        return
    await DeviceToken.get_motor_collection().update_many(
        {"user_id": user.id, "expo_push_token": {"$in": tokens}},
        {"$set": {"is_active": False, "updated_at": utcnow()}},
    )


# ---------------------------------------------------------------------------
# Creating notifications
# ---------------------------------------------------------------------------

async def record_notification(
    user: User,
    *,
    notification_type: NotificationType,
    title: str,
    body: str,
    task_type: TaskType | None = None,
    payload: dict | None = None,
    dedupe_key: str | None = None,
) -> Notification | None:
    """Insert an in-app notification, or return None if it already exists.

    With a `dedupe_key`, the write is an upsert guarded by the unique partial
    index, so two concurrent sweeps cannot both insert.
    """
    now = utcnow()
    document = {
        "user_id": user.id,
        "type": notification_type.value,
        "task_type": task_type.value if task_type else None,
        "title": title[:160],
        "body": body,
        "payload": payload or {},
        "dedupe_key": dedupe_key,
        "is_read": False,
        "read_at": None,
        "push_sent_at": None,
        "push_error": None,
        "created_at": now,
        "updated_at": now,
    }

    collection = Notification.get_motor_collection()
    if dedupe_key is None:
        result = await collection.insert_one(document)
        return await Notification.get(result.inserted_id)

    result = await collection.update_one(
        {"user_id": user.id, "dedupe_key": dedupe_key},
        {"$setOnInsert": document},
        upsert=True,
    )
    if result.upserted_id is None:
        return None  # Already recorded for this key.
    return await Notification.get(result.upserted_id)


async def deliver_push(
    user: User, notification: Notification, *, title: str, body: str
) -> None:
    """Best-effort push for a notification that is already recorded in-app."""
    tokens = await active_push_tokens(user)
    if not tokens:
        return

    result = await push.send_push(
        tokens,
        title=title,
        body=body,
        data={
            "notification_id": str(notification.id),
            "type": notification.type.value,
            **(notification.payload or {}),
        },
    )
    if result.sent:
        notification.push_sent_at = utcnow()
    if result.error:
        notification.push_error = result.error[:500]
    if result.sent or result.error:
        await notification.save()
    await deactivate_tokens(user, result.dead_tokens)


# ---------------------------------------------------------------------------
# Daily digest
# ---------------------------------------------------------------------------

def digest_dedupe_key(local_day: date) -> str:
    return f"digest:{local_day.isoformat()}"


def _format_item(item: DueItem, tz_name: str) -> str:
    from zoneinfo import ZoneInfo

    local_time = item.due_at.astimezone(ZoneInfo(tz_name)).strftime("%H:%M")
    who = f" ({item.cat_name})" if item.cat_name else ""
    return f"{local_time} · {item.title}{who}"


def compose_digest(summary: DueSummary) -> tuple[str, str]:
    """Build the digest title and body. Returns `(title, body)`."""
    counts = summary.counts()
    if counts["overdue"]:
        title = f"{counts['overdue']} overdue · {counts['today']} due today"
    elif counts["today"]:
        title = f"{counts['today']} due today"
    else:
        title = "Nothing due today"

    lines: list[str] = []
    if summary.overdue:
        lines.append("Overdue")
        lines += [
            f"  • {_format_item(item, summary.timezone)}"
            f" — {_humanise_minutes(item.overdue_by_minutes)} late"
            for item in summary.overdue
        ]
    if summary.today:
        lines.append("Today")
        lines += [f"  • {_format_item(item, summary.timezone)}" for item in summary.today]
    if summary.upcoming:
        lines.append("This week")
        lines += [
            f"  • {item.due_at.date().isoformat()} · {item.title}"
            for item in summary.upcoming
        ]
    if not lines:
        lines.append("Nothing scheduled — enjoy the quiet.")
    return title, "\n".join(lines)


def _humanise_minutes(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} min"
    hours, remainder = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h" if not remainder else f"{hours}h {remainder}m"
    days, leftover_hours = divmod(hours, 24)
    return f"{days}d" if not leftover_hours else f"{days}d {leftover_hours}h"


def digest_is_due(user: User, *, now: datetime, last_sent_for: date | None) -> bool:
    """True when the account's local digest time has passed for a day not yet sent."""
    if not user.digest_enabled:
        return False
    from app.services import scheduling

    local_now = now.astimezone(scheduling.user_tz(user))
    if local_now.time() < user.digest_time:
        return False
    return last_sent_for != local_now.date()


async def last_digest_day(user: User) -> date | None:
    latest = (
        await Notification.find(
            Notification.user_id == user.id,
            Notification.type == NotificationType.DAILY_DIGEST,
            Notification.dedupe_key != None,  # noqa: E711
        )
        .sort(-Notification.created_at)
        .limit(1)
        .to_list()
    )
    if not latest or not latest[0].dedupe_key:
        return None
    key = latest[0].dedupe_key
    if not key.startswith("digest:"):
        return None
    try:
        return date.fromisoformat(key.removeprefix("digest:"))
    except ValueError:  # pragma: no cover - defensive
        return None


async def send_daily_digest(
    user: User, *, now: datetime | None = None, force: bool = False
) -> Notification | None:
    """Compose and record today's digest. Returns None when it is not due yet."""
    now = now or utcnow()
    if not force and not digest_is_due(
        user, now=now, last_sent_for=await last_digest_day(user)
    ):
        return None

    summary = await build_due_summary(user, now=now)
    # Honour per-task-type digest opt-outs.
    summary.overdue = [i for i in summary.overdue if _in_digest(user, i.task_type)]
    summary.today = [i for i in summary.today if _in_digest(user, i.task_type)]
    summary.upcoming = [i for i in summary.upcoming if _in_digest(user, i.task_type)]

    title, body = compose_digest(summary)
    notification = await record_notification(
        user,
        notification_type=NotificationType.DAILY_DIGEST,
        title=title,
        body=body,
        payload={
            "counts": summary.counts(),
            "local_date": summary.local_date.isoformat(),
            "screen": "digest",
        },
        dedupe_key=digest_dedupe_key(summary.local_date),
    )
    if notification is None:
        return None  # Already sent for this local day.

    await deliver_push(user, notification, title=f"Daily digest · {title}", body=body)
    return notification


def _in_digest(user: User, task_type: TaskType) -> bool:
    return user.preference_for(task_type).include_in_digest


# ---------------------------------------------------------------------------
# Overdue alerts
# ---------------------------------------------------------------------------

def overdue_dedupe_key(item: DueItem) -> str:
    return f"overdue:{item.task_type.value}:{item.entity_id}"


async def _latch_alert(user: User, item: DueItem, now: datetime) -> None:
    """Stamp `overdue_alerted_at` so the next sweep does not alert again."""
    model = _ALERT_LATCH_MODEL[item.task_type]
    await model.get_motor_collection().update_one(
        {"_id": item.entity_id, "user_id": user.id},
        {"$set": {"overdue_alerted_at": now, "updated_at": now}},
    )


async def send_overdue_alerts(
    user: User, *, now: datetime | None = None
) -> list[Notification]:
    """Alert on every item past its threshold that has not been alerted yet."""
    now = now or utcnow()
    summary = await build_due_summary(user, now=now)

    created: list[Notification] = []
    for item in summary.overdue:
        if not item.breaches_threshold or item.already_alerted:
            continue

        preference = user.preference_for(item.task_type)
        wants_in_app = preference.in_app_enabled
        wants_push = preference.push_enabled and user.push_enabled

        # Latch regardless of channel preferences: the item has been handled for
        # this sweep, and re-enabling a channel should not replay old alerts.
        await _latch_alert(user, item, now)
        if not wants_in_app and not wants_push:
            continue

        late = _humanise_minutes(item.overdue_by_minutes)
        title = f"Overdue: {item.title}"
        body = f"{item.title} was due {late} ago."
        notification = await record_notification(
            user,
            notification_type=NotificationType.OVERDUE,
            task_type=item.task_type,
            title=title,
            body=body,
            payload={
                "screen": item.task_type.value,
                "entity_id": str(item.entity_id),
                "cat_id": str(item.cat_id) if item.cat_id else None,
                "due_at": item.due_at.isoformat(),
                "overdue_by_minutes": item.overdue_by_minutes,
            },
            dedupe_key=overdue_dedupe_key(item),
        )
        if notification is None:
            continue

        created.append(notification)
        if wants_push:
            await deliver_push(user, notification, title=title, body=body)
    return created


async def mark_missed_feedings(user: User, *, now: datetime | None = None) -> int:
    """Close out pending feedings whose local day has ended.

    Kept separate from alerting: an event stays `pending` (and therefore
    actionable) all day, and only becomes `missed` once the day is over.
    """
    from app.services import scheduling

    now = now or utcnow()
    day_start, _ = scheduling.local_day_bounds(user, scheduling.local_today(user, now))

    result = await FeedingEvent.get_motor_collection().update_many(
        {
            "user_id": user.id,
            "status": EventStatus.PENDING.value,
            "due_at": {"$lt": day_start},
        },
        {"$set": {"status": EventStatus.MISSED.value, "updated_at": now}},
    )
    return result.modified_count


# ---------------------------------------------------------------------------
# Notification centre helpers
# ---------------------------------------------------------------------------

async def unread_count(user_id: PydanticObjectId) -> int:
    return await Notification.find(
        Notification.user_id == user_id,
        Notification.is_read == False,  # noqa: E712
    ).count()


async def mark_all_read(user_id: PydanticObjectId) -> int:
    now = utcnow()
    result = await Notification.get_motor_collection().update_many(
        {"user_id": user_id, "is_read": False},
        {"$set": {"is_read": True, "read_at": now, "updated_at": now}},
    )
    return result.modified_count


async def prune_old_notifications(user: User, *, keep_days: int = 90) -> int:
    """Housekeeping so the notification centre does not grow without bound."""
    cutoff = utcnow() - timedelta(days=keep_days)
    result = await Notification.get_motor_collection().delete_many(
        {"user_id": user.id, "created_at": {"$lt": cutoff}, "is_read": True}
    )
    return result.deleted_count
