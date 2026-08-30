"""Deleting an account or a cat, and everything that hangs off it.

Postgres did this with `ON DELETE CASCADE`. MongoDB has no foreign keys, so the
cascade is explicit — and being explicit means the ordering matters:

**Children are always deleted before their parent.** If the process dies
part-way, the parent still exists, so the caller can simply retry and finish the
job. Deleting the parent first would leave documents that nothing points at and
that no query would ever surface again.

Every delete is scoped by `user_id`, so a cascade cannot reach another tenant.
"""

from __future__ import annotations

import logging

from beanie import PydanticObjectId

from app.models import (
    TENANT_DOCUMENT_MODELS,
    Cat,
    FeedingEvent,
    FeedingSchedule,
    User,
    VetRecord,
    WeightLog,
)

logger = logging.getLogger(__name__)

# Cat-owned collections, children first.
CAT_OWNED_MODELS = (FeedingEvent, FeedingSchedule, VetRecord, WeightLog)


async def delete_cat(cat: Cat) -> dict[str, int]:
    """Delete a cat and every record that belongs to it.

    Returns per-collection deleted counts, which the tests assert on.
    """
    deleted: dict[str, int] = {}
    for model in CAT_OWNED_MODELS:
        result = await model.get_motor_collection().delete_many(
            {"user_id": cat.user_id, "cat_id": cat.id}
        )
        deleted[model.get_settings().name] = result.deleted_count

    await cat.delete()
    deleted["cats"] = 1
    return deleted


async def delete_account(user: User) -> dict[str, int]:
    """Delete an account and its entire tenant.

    `TENANT_DOCUMENT_MODELS` is ordered children-first and covers every
    collection carrying a `user_id`; a document type missing from it would be
    silently orphaned, which is why the test suite asserts the collection list
    matches every registered tenant model.
    """
    user_id: PydanticObjectId = user.id
    deleted: dict[str, int] = {}

    for model in TENANT_DOCUMENT_MODELS:
        result = await model.get_motor_collection().delete_many({"user_id": user_id})
        deleted[model.get_settings().name] = result.deleted_count

    cats = await Cat.get_motor_collection().delete_many({"user_id": user_id})
    deleted["cats"] = cats.deleted_count

    await user.delete()
    deleted["users"] = 1

    logger.info("deleted tenant %s: %s", user_id, deleted)
    return deleted
