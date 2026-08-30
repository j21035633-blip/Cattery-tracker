"""Cascading deletes.

Postgres did this with `ON DELETE CASCADE`. MongoDB has no foreign keys, so the
cascade is hand-written in `app.services.cascade` — which means it can be
incomplete in a way the database will never catch. These tests exist to catch
it instead.
"""

from __future__ import annotations

from app.models import (
    ALL_DOCUMENT_MODELS,
    TENANT_DOCUMENT_MODELS,
    Cat,
    CleaningEvent,
    CleaningTask,
    DeviceToken,
    FeedingEvent,
    FeedingSchedule,
    Notification,
    NotificationType,
    RefreshToken,
    TenantDocument,
    User,
    VetRecord,
    WeightLog,
)
from app.services import cascade
from tests.conftest import make_user, register

API = "/api/v1"


async def populate(user: User) -> Cat:
    """Give an account one document in every tenant collection."""
    from datetime import timedelta

    from app.db.base import utcnow

    cat = await Cat(user_id=user.id, name="Biscuit").insert()
    schedule = await FeedingSchedule(
        user_id=user.id, cat_id=cat.id, label="Breakfast", scheduled_time="07:30:00"
    ).insert()
    await FeedingEvent(
        user_id=user.id, cat_id=cat.id, schedule_id=schedule.id, due_at=utcnow()
    ).insert()
    task = await CleaningTask(
        user_id=user.id,
        name="Scoop litter",
        zone="Main room",
        interval_hours=24,
        next_due_at=utcnow() + timedelta(hours=24),
    ).insert()
    await CleaningEvent(user_id=user.id, task_id=task.id, due_at=utcnow()).insert()
    await VetRecord(
        user_id=user.id,
        cat_id=cat.id,
        record_type="vaccination",
        title="Rabies booster",
        due_at=utcnow(),
    ).insert()
    await WeightLog(user_id=user.id, cat_id=cat.id, weight_grams=4200).insert()
    await Notification(
        user_id=user.id, type=NotificationType.SYSTEM, title="Hello", body="Welcome"
    ).insert()
    await DeviceToken(
        user_id=user.id, expo_push_token=f"ExponentPushToken[{user.id}]", platform="ios"
    ).insert()
    await RefreshToken(
        user_id=user.id, token_hash=f"hash-{user.id}", expires_at=utcnow() + timedelta(days=1)
    ).insert()
    return cat


async def count_all_for(user: User) -> dict[str, int]:
    counts = {}
    for model in (*TENANT_DOCUMENT_MODELS, Cat):
        counts[model.get_settings().name] = await model.find(
            model.user_id == user.id
        ).count()
    return counts


class TestCascadeCoverage:
    def test_every_tenant_collection_is_in_the_cascade_list(self) -> None:
        """A tenant document missing from `TENANT_DOCUMENT_MODELS` would be
        silently orphaned when its account is deleted. This is the check the
        database used to perform for us."""
        registered_tenant_models = {
            model
            for model in ALL_DOCUMENT_MODELS
            if issubclass(model, TenantDocument)
        }
        covered = set(TENANT_DOCUMENT_MODELS) | {Cat}

        missing = registered_tenant_models - covered
        assert not missing, (
            f"these tenant collections would be orphaned on account deletion: "
            f"{sorted(m.__name__ for m in missing)}"
        )

    def test_the_cascade_list_has_no_stale_entries(self) -> None:
        assert set(TENANT_DOCUMENT_MODELS) <= set(ALL_DOCUMENT_MODELS)


class TestDeleteAccount:
    async def test_removes_every_document_in_the_tenant(self) -> None:
        user = await make_user()
        await populate(user)

        before = await count_all_for(user)
        assert all(count > 0 for count in before.values()), before

        await cascade.delete_account(user)

        after = await count_all_for(user)
        assert all(count == 0 for count in after.values()), after
        assert await User.get(user.id) is None

    async def test_leaves_other_tenants_untouched(self) -> None:
        maya = await make_user()
        ravi = await make_user(email="ravi@example.com", phone="+14155552672")
        await populate(maya)
        await populate(ravi)

        await cascade.delete_account(maya)

        ravi_counts = await count_all_for(ravi)
        assert all(count > 0 for count in ravi_counts.values()), ravi_counts
        assert await User.get(ravi.id) is not None

    async def test_the_api_delete_cascades_too(self, client) -> None:
        headers = await register(client)
        user = await User.find_one(User.email == "maya@example.com")
        await populate(user)

        assert (await client.delete(f"{API}/users/me", headers=headers)).status_code == 204

        after = await count_all_for(user)
        assert all(count == 0 for count in after.values()), after


class TestDeleteCat:
    async def test_removes_the_cats_records_only(self) -> None:
        user = await make_user()
        keeper = await populate(user)

        other = await Cat(user_id=user.id, name="Pepper").insert()
        await WeightLog(user_id=user.id, cat_id=other.id, weight_grams=3900).insert()

        await cascade.delete_cat(keeper)

        assert await Cat.get(keeper.id) is None
        assert await FeedingSchedule.find(FeedingSchedule.cat_id == keeper.id).count() == 0
        assert await FeedingEvent.find(FeedingEvent.cat_id == keeper.id).count() == 0
        assert await VetRecord.find(VetRecord.cat_id == keeper.id).count() == 0
        assert await WeightLog.find(WeightLog.cat_id == keeper.id).count() == 0

        # The other cat and its history survive.
        assert await Cat.get(other.id) is not None
        assert await WeightLog.find(WeightLog.cat_id == other.id).count() == 1

    async def test_cleaning_tasks_survive_a_cat_deletion(self) -> None:
        """Cleaning is attached to a zone, not a cat, so it must not be swept up."""
        user = await make_user()
        cat = await populate(user)

        await cascade.delete_cat(cat)

        assert await CleaningTask.find(CleaningTask.user_id == user.id).count() == 1
        assert await CleaningEvent.find(CleaningEvent.user_id == user.id).count() == 1

    async def test_deleting_a_cat_via_the_api_cascades(self, client) -> None:
        headers = await register(client)
        user = await User.find_one(User.email == "maya@example.com")
        cat = await populate(user)

        response = await client.delete(f"{API}/cats/{cat.id}", headers=headers)
        assert response.status_code == 204

        assert await FeedingSchedule.find(FeedingSchedule.cat_id == cat.id).count() == 0
        assert await WeightLog.find(WeightLog.cat_id == cat.id).count() == 0

    async def test_a_cat_cannot_be_deleted_across_tenants(self, client) -> None:
        maya = await make_user()
        cat = await populate(maya)
        ravi_headers = await register(
            client, email="ravi@example.com", phone="+14155552672"
        )

        response = await client.delete(f"{API}/cats/{cat.id}", headers=ravi_headers)
        assert response.status_code == 404
        assert await Cat.get(cat.id) is not None, "nothing may be deleted"


class TestDetachRatherThanDelete:
    async def test_deleting_a_schedule_keeps_its_events(self, client) -> None:
        headers = await register(client)
        user = await User.find_one(User.email == "maya@example.com")
        cat = await populate(user)
        schedule = await FeedingSchedule.find_one(FeedingSchedule.cat_id == cat.id)

        response = await client.delete(
            f"{API}/feeding-schedules/{schedule.id}", headers=headers
        )
        assert response.status_code == 204

        events = await FeedingEvent.find(FeedingEvent.user_id == user.id).to_list()
        assert len(events) == 1, "history is kept"
        assert events[0].schedule_id is None, "but detached from the deleted schedule"

    async def test_deleting_a_cleaning_task_keeps_its_history(self, client) -> None:
        headers = await register(client)
        user = await User.find_one(User.email == "maya@example.com")
        await populate(user)
        task = await CleaningTask.find_one(CleaningTask.user_id == user.id)

        response = await client.delete(f"{API}/cleaning-tasks/{task.id}", headers=headers)
        assert response.status_code == 204

        events = await CleaningEvent.find(CleaningEvent.user_id == user.id).to_list()
        assert len(events) == 1
        assert events[0].task_id is None
