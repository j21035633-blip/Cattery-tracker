"""Notification centre, push device registration, and the due-today query."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from beanie import PydanticObjectId
from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, PageParams
from app.db.tenancy import get_owned_or_404, paginate, tenant_query
from app.models import DeviceToken, Notification, NotificationType
from app.schemas.common import Page
from app.schemas.notification import (
    DeviceTokenRead,
    DeviceTokenRegister,
    DigestPreview,
    DueItemRead,
    DueSummaryRead,
    MarkReadResult,
    NotificationRead,
    UnreadCount,
)
from app.services import notifications as notification_service
from app.services import scheduling
from app.services.due import DueItem, build_due_summary

router = APIRouter(tags=["notifications"])


def _to_read(item: DueItem) -> DueItemRead:
    return DueItemRead(
        task_type=item.task_type,
        entity_id=item.entity_id,
        title=item.title,
        due_at=item.due_at,
        cat_id=item.cat_id,
        cat_name=item.cat_name,
        is_overdue=item.is_overdue,
        overdue_by_minutes=item.overdue_by_minutes,
        breaches_threshold=item.breaches_threshold,
    )


# ---------------------------------------------------------------------------
# Notification centre
# ---------------------------------------------------------------------------

@router.get(
    "/notifications",
    response_model=Page[NotificationRead],
    summary="Notification centre, newest first",
)
async def list_notifications(
    current_user: CurrentUser,
    page: PageParams,
    unread_only: Annotated[bool, Query()] = False,
    notification_type: Annotated[NotificationType | None, Query(alias="type")] = None,
    created_since: Annotated[datetime | None, Query()] = None,
) -> Page[NotificationRead]:
    query = tenant_query(Notification, current_user.id)
    if unread_only:
        query = query.find(Notification.is_read == False)  # noqa: E712
    if notification_type is not None:
        query = query.find(Notification.type == notification_type)
    if created_since is not None:
        query = query.find(Notification.created_at >= created_since)

    rows, total = await paginate(
        query.sort(-Notification.created_at), limit=page.limit, offset=page.offset
    )
    return Page[NotificationRead](
        items=[NotificationRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get(
    "/notifications/unread-count",
    response_model=UnreadCount,
    summary="Badge count for the clients",
)
async def unread_count(current_user: CurrentUser) -> UnreadCount:
    return UnreadCount(unread=await notification_service.unread_count(current_user.id))


@router.post(
    "/notifications/read-all", response_model=MarkReadResult, summary="Mark all as read"
)
async def read_all(current_user: CurrentUser) -> MarkReadResult:
    return MarkReadResult(updated=await notification_service.mark_all_read(current_user.id))


@router.post("/notifications/{notification_id}/read", response_model=NotificationRead)
async def mark_read(
    notification_id: PydanticObjectId, current_user: CurrentUser
) -> NotificationRead:
    notification = await get_owned_or_404(Notification, notification_id, current_user.id)
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = scheduling.utcnow()
        await notification.save()
    return NotificationRead.model_validate(notification)


@router.post("/notifications/{notification_id}/unread", response_model=NotificationRead)
async def mark_unread(
    notification_id: PydanticObjectId, current_user: CurrentUser
) -> NotificationRead:
    notification = await get_owned_or_404(Notification, notification_id, current_user.id)
    notification.is_read = False
    notification.read_at = None
    await notification.save()
    return NotificationRead.model_validate(notification)


@router.delete(
    "/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_notification(
    notification_id: PydanticObjectId, current_user: CurrentUser
) -> Response:
    notification = await get_owned_or_404(Notification, notification_id, current_user.id)
    await notification.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# What's due
# ---------------------------------------------------------------------------

@router.get(
    "/due-summary",
    response_model=DueSummaryRead,
    summary="What's due today, what's upcoming, what's overdue",
)
async def due_summary(current_user: CurrentUser) -> DueSummaryRead:
    """The on-demand version of the daily digest, in the account's timezone."""
    summary = await build_due_summary(current_user)
    return DueSummaryRead(
        local_date=summary.local_date,
        timezone=summary.timezone,
        counts=summary.counts(),
        overdue=[_to_read(item) for item in summary.overdue],
        today=[_to_read(item) for item in summary.today],
        upcoming=[_to_read(item) for item in summary.upcoming],
    )


@router.get(
    "/due-summary/digest-preview",
    response_model=DigestPreview,
    summary="Exactly what today's digest would say",
)
async def digest_preview(current_user: CurrentUser) -> DigestPreview:
    """Lets the settings screen show the effect of a threshold change without
    waiting for 8 AM, and never records or sends anything."""
    summary = await build_due_summary(current_user)
    title, body = notification_service.compose_digest(summary)
    return DigestPreview(title=title, body=body, counts=summary.counts())


@router.post(
    "/due-summary/send-digest",
    response_model=NotificationRead | None,
    summary="Send today's digest now (idempotent for the local day)",
)
async def send_digest_now(current_user: CurrentUser) -> NotificationRead | None:
    notification = await notification_service.send_daily_digest(current_user, force=True)
    if notification is None:
        return None  # Already sent for this local day.
    return NotificationRead.model_validate(notification)


# ---------------------------------------------------------------------------
# Push devices
# ---------------------------------------------------------------------------

@router.get(
    "/devices", response_model=list[DeviceTokenRead], summary="Registered push devices"
)
async def list_devices(current_user: CurrentUser) -> list[DeviceTokenRead]:
    rows = (
        await tenant_query(DeviceToken, current_user.id)
        .sort(-DeviceToken.created_at)
        .to_list()
    )
    return [DeviceTokenRead.model_validate(row) for row in rows]


@router.post(
    "/devices",
    response_model=DeviceTokenRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register (or re-activate) this device for push",
)
async def register_device(
    payload: DeviceTokenRegister, current_user: CurrentUser
) -> DeviceTokenRead:
    """Idempotent — the app calls this on every launch.

    A token is globally unique: if the same physical device previously belonged
    to another account (shared phone, app reinstall after a switch), the
    document is reassigned to the caller rather than duplicated, so the previous
    owner stops receiving pushes on a device they no longer use.
    """
    # Deliberately not tenant-scoped: the lookup has to see the other account's
    # document in order to move it. This is the one query in the codebase that
    # crosses tenants, and it only ever reassigns ownership to the caller.
    existing = await DeviceToken.find_one(
        DeviceToken.expo_push_token == payload.expo_push_token
    )

    now = scheduling.utcnow()
    if existing is not None:
        existing.user_id = current_user.id
        existing.platform = payload.platform
        existing.device_name = payload.device_name
        existing.is_active = True
        existing.last_seen_at = now
        await existing.save()
        return DeviceTokenRead.model_validate(existing)

    device = DeviceToken(
        user_id=current_user.id,
        expo_push_token=payload.expo_push_token,
        platform=payload.platform,
        device_name=payload.device_name,
        last_seen_at=now,
    )
    await device.insert()
    return DeviceTokenRead.model_validate(device)


@router.delete(
    "/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Stop pushing to a device (called on sign-out)",
)
async def unregister_device(
    device_id: PydanticObjectId, current_user: CurrentUser
) -> Response:
    device = await get_owned_or_404(DeviceToken, device_id, current_user.id)
    await device.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
