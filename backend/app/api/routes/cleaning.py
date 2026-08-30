"""Litter / cleaning rotation tasks and their completion log."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from beanie import PydanticObjectId
from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, PageParams
from app.db.tenancy import get_owned_or_404, paginate, tenant_query
from app.models import CleaningEvent, CleaningTask
from app.schemas.cleaning import (
    CleaningEventRead,
    CleaningTaskComplete,
    CleaningTaskCompleteResult,
    CleaningTaskCreate,
    CleaningTaskRead,
    CleaningTaskUpdate,
)
from app.schemas.common import Page
from app.services import scheduling

router = APIRouter(tags=["cleaning"])


@router.get(
    "/cleaning-tasks",
    response_model=Page[CleaningTaskRead],
    summary="List cleaning tasks, soonest due first",
)
async def list_tasks(
    current_user: CurrentUser,
    page: PageParams,
    zone: Annotated[str | None, Query(max_length=80)] = None,
    is_active: Annotated[bool | None, Query()] = None,
    due_before: Annotated[datetime | None, Query()] = None,
) -> Page[CleaningTaskRead]:
    query = tenant_query(CleaningTask, current_user.id)
    if zone is not None:
        query = query.find(CleaningTask.zone == zone)
    if is_active is not None:
        query = query.find(CleaningTask.is_active == is_active)
    if due_before is not None:
        query = query.find(CleaningTask.next_due_at < due_before)

    rows, total = await paginate(
        # Rotation order breaks ties so zones cycle predictably.
        query.sort(+CleaningTask.next_due_at, +CleaningTask.rotation_order),
        limit=page.limit,
        offset=page.offset,
    )
    return Page[CleaningTaskRead](
        items=[CleaningTaskRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "/cleaning-tasks",
    response_model=CleaningTaskRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    payload: CleaningTaskCreate, current_user: CurrentUser
) -> CleaningTaskRead:
    data = payload.model_dump()
    next_due_at = data.pop("next_due_at", None) or (
        scheduling.utcnow() + timedelta(hours=payload.interval_hours)
    )
    task = CleaningTask(user_id=current_user.id, next_due_at=next_due_at, **data)
    await task.insert()
    return CleaningTaskRead.model_validate(task)


@router.get("/cleaning-tasks/{task_id}", response_model=CleaningTaskRead)
async def read_task(
    task_id: PydanticObjectId, current_user: CurrentUser
) -> CleaningTaskRead:
    task = await get_owned_or_404(CleaningTask, task_id, current_user.id)
    return CleaningTaskRead.model_validate(task)


@router.patch("/cleaning-tasks/{task_id}", response_model=CleaningTaskRead)
async def update_task(
    task_id: PydanticObjectId, payload: CleaningTaskUpdate, current_user: CurrentUser
) -> CleaningTaskRead:
    task = await get_owned_or_404(CleaningTask, task_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    await task.save()
    return CleaningTaskRead.model_validate(task)


@router.post(
    "/cleaning-tasks/{task_id}/complete",
    response_model=CleaningTaskCompleteResult,
    summary="Log a cleaning and roll the task forward",
)
async def complete_task(
    task_id: PydanticObjectId, payload: CleaningTaskComplete, current_user: CurrentUser
) -> CleaningTaskCompleteResult:
    """`next_due_at` advances from when it was actually done, not from the old
    due time, so a few missed days do not leave a backlog of overdue slots."""
    task = await get_owned_or_404(CleaningTask, task_id, current_user.id)
    event = scheduling.complete_cleaning_task(
        task, completed_at=payload.completed_at, notes=payload.notes
    )
    # The event first: if the process dies between the two writes, the history
    # is recorded and the task simply stays due, which is the safe direction.
    await event.insert()
    await task.save()
    return CleaningTaskCompleteResult(
        task=CleaningTaskRead.model_validate(task),
        event=CleaningEventRead.model_validate(event),
    )


@router.delete(
    "/cleaning-tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_task(
    task_id: PydanticObjectId, current_user: CurrentUser
) -> Response:
    task = await get_owned_or_404(CleaningTask, task_id, current_user.id)
    # Detach the history rather than deleting it, matching the schedule case.
    await CleaningEvent.get_motor_collection().update_many(
        {"user_id": current_user.id, "task_id": task.id},
        {"$set": {"task_id": None, "updated_at": scheduling.utcnow()}},
    )
    await task.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/cleaning-events",
    response_model=Page[CleaningEventRead],
    summary="Cleaning history, most recent first",
)
async def list_events(
    current_user: CurrentUser,
    page: PageParams,
    task_id: Annotated[PydanticObjectId | None, Query()] = None,
    due_from: Annotated[datetime | None, Query()] = None,
    due_to: Annotated[datetime | None, Query()] = None,
) -> Page[CleaningEventRead]:
    query = tenant_query(CleaningEvent, current_user.id)
    if task_id is not None:
        query = query.find(CleaningEvent.task_id == task_id)
    if due_from is not None:
        query = query.find(CleaningEvent.due_at >= due_from)
    if due_to is not None:
        query = query.find(CleaningEvent.due_at < due_to)

    rows, total = await paginate(
        query.sort(-CleaningEvent.due_at), limit=page.limit, offset=page.offset
    )
    return Page[CleaningEventRead](
        items=[CleaningEventRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )
