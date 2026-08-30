"""Vet visits, vaccinations and medication schedules."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

import pymongo
from beanie import PydanticObjectId
from beanie.odm.utils.parsing import parse_obj
from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, PageParams
from app.db.tenancy import assert_owned, get_owned_or_404, tenant_query
from app.models import Cat, VetRecord, VetRecordType
from app.schemas.common import Page
from app.schemas.vet import (
    VetRecordComplete,
    VetRecordCreate,
    VetRecordRead,
    VetRecordUpdate,
)
from app.services import scheduling

router = APIRouter(prefix="/vet-records", tags=["vet"])


# Undated records (plain notes) must sort last, the way Postgres `NULLS LAST`
# put them. MongoDB sorts null *before* every value on an ascending sort, and
# re-sorting in Python would only reorder the page in hand — a note would still
# occupy a slot on page 1. So the ordering is computed server-side, and the
# count comes from the same pipeline via $facet.
_FAR_FUTURE = datetime(9999, 12, 31, tzinfo=UTC)


async def _page_due_first(
    filter_query: dict, *, limit: int, offset: int
) -> tuple[list[VetRecord], int]:
    pipeline = [
        {"$match": filter_query},
        {"$addFields": {"_due_sort": {"$ifNull": ["$due_at", _FAR_FUTURE]}}},
        {"$sort": {"_due_sort": pymongo.ASCENDING, "created_at": pymongo.ASCENDING}},
        {
            "$facet": {
                "items": [{"$skip": offset}, {"$limit": limit}, {"$unset": "_due_sort"}],
                "total": [{"$count": "value"}],
            }
        },
    ]
    result = await VetRecord.get_motor_collection().aggregate(pipeline).to_list(1)
    facet = result[0] if result else {"items": [], "total": []}
    records = [parse_obj(VetRecord, document) for document in facet["items"]]
    total = facet["total"][0]["value"] if facet["total"] else 0
    return records, total


@router.get("", response_model=Page[VetRecordRead], summary="List vet records")
async def list_records(
    current_user: CurrentUser,
    page: PageParams,
    cat_id: Annotated[PydanticObjectId | None, Query()] = None,
    record_type: Annotated[VetRecordType | None, Query()] = None,
    due_from: Annotated[datetime | None, Query()] = None,
    due_to: Annotated[datetime | None, Query()] = None,
    outstanding: Annotated[
        bool | None, Query(description="True: only records not yet completed")
    ] = None,
) -> Page[VetRecordRead]:
    query = tenant_query(VetRecord, current_user.id)
    if cat_id is not None:
        query = query.find(VetRecord.cat_id == cat_id)
    if record_type is not None:
        query = query.find(VetRecord.record_type == record_type)
    if due_from is not None:
        query = query.find(VetRecord.due_at >= due_from)
    if due_to is not None:
        query = query.find(VetRecord.due_at < due_to)
    if outstanding is not None:
        query = query.find({"completed_at": None if outstanding else {"$ne": None}})

    rows, total = await _page_due_first(
        query.get_filter_query(), limit=page.limit, offset=page.offset
    )
    return Page[VetRecordRead](
        items=[VetRecordRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post("", response_model=VetRecordRead, status_code=status.HTTP_201_CREATED)
async def create_record(
    payload: VetRecordCreate, current_user: CurrentUser
) -> VetRecordRead:
    await assert_owned(Cat, payload.cat_id, current_user.id)

    record = VetRecord(user_id=current_user.id, **payload.model_dump())
    await record.insert()
    return VetRecordRead.model_validate(record)


@router.get("/{record_id}", response_model=VetRecordRead)
async def read_record(
    record_id: PydanticObjectId, current_user: CurrentUser
) -> VetRecordRead:
    record = await get_owned_or_404(VetRecord, record_id, current_user.id)
    return VetRecordRead.model_validate(record)


@router.patch("/{record_id}", response_model=VetRecordRead)
async def update_record(
    record_id: PydanticObjectId, payload: VetRecordUpdate, current_user: CurrentUser
) -> VetRecordRead:
    record = await get_owned_or_404(VetRecord, record_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(record, field, value)
    await record.save()
    return VetRecordRead.model_validate(record)


@router.post(
    "/{record_id}/complete",
    response_model=list[VetRecordRead],
    summary="Mark done, optionally booking the follow-up",
)
async def complete_record(
    record_id: PydanticObjectId, payload: VetRecordComplete, current_user: CurrentUser
) -> list[VetRecordRead]:
    """Returns the completed record, plus the follow-up when `next_due_at` is
    given. The follow-up is a new document so last year's booster stays in
    history."""
    record = await get_owned_or_404(VetRecord, record_id, current_user.id)
    follow_up = scheduling.complete_vet_record(
        record, completed_at=payload.completed_at, next_due_at=payload.next_due_at
    )
    if payload.notes:
        record.description = payload.notes
    await record.save()

    records = [record]
    if follow_up is not None:
        await follow_up.insert()
        records.append(follow_up)
    return [VetRecordRead.model_validate(item) for item in records]


@router.delete(
    "/{record_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def delete_record(
    record_id: PydanticObjectId, current_user: CurrentUser
) -> Response:
    record = await get_owned_or_404(VetRecord, record_id, current_user.id)
    await record.delete()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
