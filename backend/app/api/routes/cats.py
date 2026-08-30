"""Cat profile CRUD."""

from __future__ import annotations

import re
from typing import Annotated

from beanie import PydanticObjectId
from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, PageParams
from app.core.plans import within_limit
from app.db.tenancy import count_owned, get_owned_or_404, paginate, tenant_query
from app.models import Cat
from app.schemas.cat import CatCreate, CatRead, CatUpdate
from app.schemas.common import Page
from app.services import cascade

router = APIRouter(prefix="/cats", tags=["cats"])


@router.get("", response_model=Page[CatRead], summary="List the account's cats")
async def list_cats(
    current_user: CurrentUser,
    page: PageParams,
    is_active: Annotated[bool | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=80)] = None,
) -> Page[CatRead]:
    query = tenant_query(Cat, current_user.id)
    if is_active is not None:
        query = query.find(Cat.is_active == is_active)
    if search:
        # Escaped so a user searching for "a.b" or "(" cannot inject a regex.
        query = query.find({"name": {"$regex": re.escape(search), "$options": "i"}})

    rows, total = await paginate(
        query.sort(+Cat.name), limit=page.limit, offset=page.offset
    )
    return Page[CatRead](
        items=[CatRead.model_validate(row) for row in rows],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "", response_model=CatRead, status_code=status.HTTP_201_CREATED, summary="Add a cat"
)
async def create_cat(payload: CatCreate, current_user: CurrentUser) -> CatRead:
    if not within_limit(
        current_user.plan, "max_cats", await count_owned(Cat, current_user.id)
    ):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Your plan's cat limit has been reached",
        )

    cat = Cat(user_id=current_user.id, **payload.model_dump())
    await cat.insert()
    return CatRead.model_validate(cat)


@router.get("/{cat_id}", response_model=CatRead)
async def read_cat(cat_id: PydanticObjectId, current_user: CurrentUser) -> CatRead:
    cat = await get_owned_or_404(Cat, cat_id, current_user.id)
    return CatRead.model_validate(cat)


@router.patch("/{cat_id}", response_model=CatRead)
async def update_cat(
    cat_id: PydanticObjectId, payload: CatUpdate, current_user: CurrentUser
) -> CatRead:
    cat = await get_owned_or_404(Cat, cat_id, current_user.id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)
    await cat.save()
    return CatRead.model_validate(cat)


@router.delete(
    "/{cat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a cat and everything recorded for it",
)
async def delete_cat(cat_id: PydanticObjectId, current_user: CurrentUser) -> Response:
    # Schedules, events, vet records and weight logs are removed explicitly —
    # MongoDB has no cascading delete. Use PATCH {"is_active": false} to retire
    # a cat while keeping its history.
    cat = await get_owned_or_404(Cat, cat_id, current_user.id)
    await cascade.delete_cat(cat)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
