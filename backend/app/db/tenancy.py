"""Helpers that make the multi-tenant filter hard to forget.

**Read this before touching a query.** The Postgres version had three layers of
isolation. MongoDB removes one of them: there are no foreign keys, so the
composite `(cat_id, user_id) -> cats(id, user_id)` constraint that made a
cross-tenant reference *unrepresentable* has no equivalent. What is left:

1. `user_id` is required and indexed on every tenant document (`TenantDocument`).
2. These helpers, which always put `user_id` in the predicate.
3. `assert_owned()`, called before storing any reference to another document,
   which is what now replaces the composite foreign key.

Rule for this codebase: **no route handler calls `Model.find()` directly on a
tenant collection.** Go through `tenant_query` / `get_owned_or_404`, and a
document belonging to another tenant returns 404 rather than 403 — we do not
confirm the existence of other tenants' data.
"""

from __future__ import annotations

from typing import TypeVar

from beanie import PydanticObjectId
from beanie.odm.queries.find import FindMany
from fastapi import HTTPException, status

from app.db.base import TenantDocument

ModelT = TypeVar("ModelT", bound=TenantDocument)


def _require_tenant_model(model: type[TenantDocument]) -> None:
    if not issubclass(model, TenantDocument):
        raise TypeError(f"{model.__name__} is not a tenant-owned document")


def tenant_query(
    model: type[ModelT], user_id: PydanticObjectId, *conditions
) -> FindMany[ModelT]:
    """`find({user_id: ...})`, ready to be refined with more conditions."""
    _require_tenant_model(model)
    return model.find(model.user_id == user_id, *conditions)


async def get_owned(
    model: type[ModelT], obj_id: PydanticObjectId, user_id: PydanticObjectId
) -> ModelT | None:
    _require_tenant_model(model)
    return await model.find_one(model.id == obj_id, model.user_id == user_id)


async def get_owned_or_404(
    model: type[ModelT], obj_id: PydanticObjectId, user_id: PydanticObjectId
) -> ModelT:
    document = await get_owned(model, obj_id, user_id)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{model.__name__} not found",
        )
    return document


async def assert_owned(
    model: type[ModelT], obj_id: PydanticObjectId, user_id: PydanticObjectId
) -> ModelT:
    """Validate a cross-document reference before storing it.

    This is the application-level stand-in for the composite foreign key the
    Postgres schema had. Call it for **every** id that arrives in a request body
    and gets written into another document (`cat_id`, `schedule_id`, …). Without
    it, nothing stops a request from attaching another tenant's cat to a row of
    its own.
    """
    return await get_owned_or_404(model, obj_id, user_id)


async def count_owned(model: type[ModelT], user_id: PydanticObjectId) -> int:
    """How many documents of `model` this tenant owns (for plan-limit checks)."""
    return await tenant_query(model, user_id).count()


async def paginate(
    query: FindMany[ModelT], *, limit: int, offset: int
) -> tuple[list[ModelT], int]:
    """Run `query` windowed, plus a count over the same predicate.

    The count reuses the caller's query object, so the tenant filter cannot be
    lost between the two round trips.
    """
    total = await query.count()
    items = await query.skip(offset).limit(limit).to_list()
    return items, total


def apply_updates(document: TenantDocument, updates: dict) -> TenantDocument:
    """Apply a PATCH payload's set fields onto a document.

    Values are assigned as their rich Python types (`date`, `Decimal`, …); the
    BSON encoders in `app.db.base` convert them on write.
    """
    for field, value in updates.items():
        setattr(document, field, value)
    return document
