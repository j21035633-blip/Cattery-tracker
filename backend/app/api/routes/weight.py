"""Weight logs and the per-cat trend summary."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from beanie import PydanticObjectId
from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, PageParams
from app.db.tenancy import assert_owned, get_owned_or_404, paginate, tenant_query
from app.models import Cat, WeightLog
from app.schemas.common import Page
from app.schemas.weight import (
    WeightLogCreate,
    WeightLogRead,
    WeightLogUpdate,
    WeightTrend,
)
from app.services import scheduling

router = APIRouter(tags=["weight"])


@router.get(
    "/weight-logs",
    response_model=Page[WeightLogRead],
    summary="List weight measurements, most recent first",
)
async def list_logs(
    current_user: CurrentUser,
    page: PageParams,
    cat_id: Annotated[PydanticObjectId | None, Query()] = None,
    measured_from: Annotated[datetime | None, Query()] = None,
    measured_to: Annotated[datetime | None, Query()] = None,
) -> Page[WeightLogRead]:
    query = tenant_query(WeightLog, current_user.id)
    if cat_id is not None:
        query = query.find(WeightLog.cat_id == cat_id)
    if measured_from is not None:
        query = query.find(WeightLog.measured_at >= measured_from)
    if measured_to is not None:
        query = query.find(WeightLog.measured_at < measured_to)

    rows, total = await paginate(
        query.sort(-WeightLog.measured_at), limit=page.limit, offset=page.offset
    )
    return Page[WeightLogRead](
        items=[WeightLogRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "/weight-logs", response_model=WeightLogRead, status_code=status.HTTP_201_CREATED
)
async def create_log(
    payload: WeightLogCreate, current_user: CurrentUser
) -> WeightLogRead:
    await assert_owned(Cat, payload.cat_id, current_user.id)

    data = payload.model_dump()
    data["measured_at"] = data.get("measured_at") or scheduling.utcnow()
    log = WeightLog(user_id=current_user.id, **data)
    await log.insert()
    return WeightLogRead.model_validate(log)


@router.get("/weight-logs/{log_id}", response_model=WeightLogRead)
async def read_log(
    log_id: PydanticObjectId, current_user: CurrentUser
) -> WeightLogRead:
    log = await get_owned_or_404(WeightLog, log_id, current_user.id)
    return WeightLogRead.model_validate(log)


@router.patch("/weight-logs/{log_id}", response_model=WeightLogRead)
async def update_log(
    log_id: PydanticObjectId, payload: WeightLogUpdate, current_user: CurrentUser
) -> WeightLogRead:
    log = await get_owned_or_404(WeightLog, log_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(log, field, value)
    await log.save()
    return WeightLogRead.model_validate(log)


@router.delete(
    "/weight-logs/{log_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_log(log_id: PydanticObjectId, current_user: CurrentUser) -> Response:
    log = await get_owned_or_404(WeightLog, log_id, current_user.id)
    await log.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/cats/{cat_id}/weight-trend",
    response_model=WeightTrend,
    summary="Aggregates for a cat's weight chart",
)
async def weight_trend(
    cat_id: PydanticObjectId,
    current_user: CurrentUser,
    measured_from: Annotated[datetime | None, Query()] = None,
    measured_to: Annotated[datetime | None, Query()] = None,
) -> WeightTrend:
    await assert_owned(Cat, cat_id, current_user.id)

    match: dict = {"user_id": current_user.id, "cat_id": cat_id}
    if measured_from is not None or measured_to is not None:
        window: dict = {}
        if measured_from is not None:
            window["$gte"] = measured_from
        if measured_to is not None:
            window["$lt"] = measured_to
        match["measured_at"] = window

    # One aggregation instead of the two round trips the SQL version needed:
    # $first/$last read the endpoints straight off the sorted group.
    pipeline = [
        {"$match": match},
        {"$sort": {"measured_at": 1}},
        {
            "$group": {
                "_id": None,
                "samples": {"$sum": 1},
                "first_measured_at": {"$first": "$measured_at"},
                "latest_measured_at": {"$last": "$measured_at"},
                "first_grams": {"$first": "$weight_grams"},
                "latest_grams": {"$last": "$weight_grams"},
                "min_grams": {"$min": "$weight_grams"},
                "max_grams": {"$max": "$weight_grams"},
            }
        },
    ]
    result = await WeightLog.get_motor_collection().aggregate(pipeline).to_list(1)

    if not result:
        return WeightTrend(
            cat_id=cat_id,
            samples=0,
            first_measured_at=None,
            latest_measured_at=None,
            latest_grams=None,
            change_grams=None,
            min_grams=None,
            max_grams=None,
        )

    row = result[0]
    return WeightTrend(
        cat_id=cat_id,
        samples=row["samples"],
        first_measured_at=row["first_measured_at"],
        latest_measured_at=row["latest_measured_at"],
        latest_grams=row["latest_grams"],
        # Endpoint values, so the trend reflects first -> latest, not min -> max.
        change_grams=row["latest_grams"] - row["first_grams"],
        min_grams=row["min_grams"],
        max_grams=row["max_grams"],
    )
