"""Feeding schedules and feeding events."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from beanie import PydanticObjectId
from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, PageParams
from app.db.tenancy import assert_owned, get_owned_or_404, paginate, tenant_query
from app.models import Cat, EventStatus, FeedingEvent, FeedingSchedule
from app.schemas.common import Page
from app.schemas.feeding import (
    FeedingEventComplete,
    FeedingEventCreate,
    FeedingEventRead,
    FeedingEventUpdate,
    FeedingScheduleCreate,
    FeedingScheduleRead,
    FeedingScheduleUpdate,
    GenerateEventsRequest,
    GenerateEventsResult,
)
from app.services import scheduling

router = APIRouter(tags=["feeding"])


# --------------------------------------------------------------------------
# Schedules
# --------------------------------------------------------------------------

@router.get(
    "/feeding-schedules",
    response_model=Page[FeedingScheduleRead],
    summary="List feeding schedules",
)
async def list_schedules(
    current_user: CurrentUser,
    page: PageParams,
    cat_id: Annotated[PydanticObjectId | None, Query()] = None,
    is_active: Annotated[bool | None, Query()] = None,
) -> Page[FeedingScheduleRead]:
    query = tenant_query(FeedingSchedule, current_user.id)
    if cat_id is not None:
        query = query.find(FeedingSchedule.cat_id == cat_id)
    if is_active is not None:
        query = query.find(FeedingSchedule.is_active == is_active)

    rows, total = await paginate(
        query.sort(+FeedingSchedule.scheduled_time), limit=page.limit, offset=page.offset
    )
    return Page[FeedingScheduleRead](
        items=[FeedingScheduleRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "/feeding-schedules",
    response_model=FeedingScheduleRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_schedule(
    payload: FeedingScheduleCreate, current_user: CurrentUser
) -> FeedingScheduleRead:
    # Stands in for the composite foreign key Postgres had: 404s if the cat
    # belongs to another tenant, so cat_id cannot be probed or borrowed.
    await assert_owned(Cat, payload.cat_id, current_user.id)

    schedule = FeedingSchedule(user_id=current_user.id, **payload.model_dump())
    await schedule.insert()
    return FeedingScheduleRead.model_validate(schedule)


@router.get("/feeding-schedules/{schedule_id}", response_model=FeedingScheduleRead)
async def read_schedule(
    schedule_id: PydanticObjectId, current_user: CurrentUser
) -> FeedingScheduleRead:
    schedule = await get_owned_or_404(FeedingSchedule, schedule_id, current_user.id)
    return FeedingScheduleRead.model_validate(schedule)


@router.patch("/feeding-schedules/{schedule_id}", response_model=FeedingScheduleRead)
async def update_schedule(
    schedule_id: PydanticObjectId,
    payload: FeedingScheduleUpdate,
    current_user: CurrentUser,
) -> FeedingScheduleRead:
    schedule = await get_owned_or_404(FeedingSchedule, schedule_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(schedule, field, value)
    await schedule.save()
    return FeedingScheduleRead.model_validate(schedule)


@router.delete(
    "/feeding-schedules/{schedule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a schedule (its past events are kept)",
)
async def delete_schedule(
    schedule_id: PydanticObjectId, current_user: CurrentUser
) -> Response:
    schedule = await get_owned_or_404(FeedingSchedule, schedule_id, current_user.id)
    # Detach rather than delete the events, so completed feeding history
    # survives a schedule change (Postgres did this with ON DELETE SET NULL).
    await FeedingEvent.get_motor_collection().update_many(
        {"user_id": current_user.id, "schedule_id": schedule.id},
        {"$set": {"schedule_id": None, "updated_at": scheduling.utcnow()}},
    )
    await schedule.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------

@router.get(
    "/feeding-events", response_model=Page[FeedingEventRead], summary="List feeding events"
)
async def list_events(
    current_user: CurrentUser,
    page: PageParams,
    cat_id: Annotated[PydanticObjectId | None, Query()] = None,
    event_status: Annotated[EventStatus | None, Query(alias="status")] = None,
    due_from: Annotated[datetime | None, Query()] = None,
    due_to: Annotated[datetime | None, Query()] = None,
) -> Page[FeedingEventRead]:
    query = tenant_query(FeedingEvent, current_user.id)
    if cat_id is not None:
        query = query.find(FeedingEvent.cat_id == cat_id)
    if event_status is not None:
        query = query.find(FeedingEvent.status == event_status)
    if due_from is not None:
        query = query.find(FeedingEvent.due_at >= due_from)
    if due_to is not None:
        query = query.find(FeedingEvent.due_at < due_to)

    rows, total = await paginate(
        query.sort(+FeedingEvent.due_at), limit=page.limit, offset=page.offset
    )
    return Page[FeedingEventRead](
        items=[FeedingEventRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "/feeding-events",
    response_model=FeedingEventRead,
    status_code=status.HTTP_201_CREATED,
    summary="Record an ad-hoc feeding or add a one-off slot",
)
async def create_event(
    payload: FeedingEventCreate, current_user: CurrentUser
) -> FeedingEventRead:
    await assert_owned(Cat, payload.cat_id, current_user.id)
    if payload.schedule_id is not None:
        await assert_owned(FeedingSchedule, payload.schedule_id, current_user.id)

    event = FeedingEvent(user_id=current_user.id, **payload.model_dump())
    await event.insert()
    return FeedingEventRead.model_validate(event)


@router.get("/feeding-events/{event_id}", response_model=FeedingEventRead)
async def read_event(
    event_id: PydanticObjectId, current_user: CurrentUser
) -> FeedingEventRead:
    event = await get_owned_or_404(FeedingEvent, event_id, current_user.id)
    return FeedingEventRead.model_validate(event)


@router.patch("/feeding-events/{event_id}", response_model=FeedingEventRead)
async def update_event(
    event_id: PydanticObjectId, payload: FeedingEventUpdate, current_user: CurrentUser
) -> FeedingEventRead:
    event = await get_owned_or_404(FeedingEvent, event_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    await event.save()
    return FeedingEventRead.model_validate(event)


@router.post(
    "/feeding-events/{event_id}/complete",
    response_model=FeedingEventRead,
    summary="Mark a feeding as done",
)
async def complete_event(
    event_id: PydanticObjectId, payload: FeedingEventComplete, current_user: CurrentUser
) -> FeedingEventRead:
    event = await get_owned_or_404(FeedingEvent, event_id, current_user.id)
    scheduling.complete_feeding_event(event, completed_at=payload.completed_at)
    if payload.notes:
        event.notes = payload.notes
    await event.save()
    return FeedingEventRead.model_validate(event)


@router.post(
    "/feeding-events/{event_id}/skip",
    response_model=FeedingEventRead,
    summary="Skip a feeding without marking it missed",
)
async def skip_event(
    event_id: PydanticObjectId, payload: FeedingEventComplete, current_user: CurrentUser
) -> FeedingEventRead:
    event = await get_owned_or_404(FeedingEvent, event_id, current_user.id)
    scheduling.skip_feeding_event(event, notes=payload.notes)
    await event.save()
    return FeedingEventRead.model_validate(event)


@router.delete(
    "/feeding-events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_event(
    event_id: PydanticObjectId, current_user: CurrentUser
) -> Response:
    event = await get_owned_or_404(FeedingEvent, event_id, current_user.id)
    await event.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/feeding-events/generate",
    response_model=GenerateEventsResult,
    summary="Materialise pending events from the active schedules",
)
async def generate_events(
    payload: GenerateEventsRequest, current_user: CurrentUser
) -> GenerateEventsResult:
    """Idempotent — re-running for an already generated day creates nothing.

    The nightly job calls this for every account; clients can call it to fill
    in a day immediately after editing a schedule.
    """
    start_date = (
        payload.start_date.astimezone(scheduling.user_tz(current_user)).date()
        if payload.start_date
        else scheduling.local_today(current_user)
    )
    created, skipped = await scheduling.materialise_feeding_events(
        current_user, start_date=start_date, days=payload.days
    )

    range_start, _ = scheduling.local_day_bounds(current_user, start_date)
    _, range_end = scheduling.local_day_bounds(
        current_user, start_date + timedelta(days=payload.days - 1)
    )
    return GenerateEventsResult(
        created=created,
        skipped_existing=skipped,
        range_start=range_start,
        range_end=range_end,
    )
