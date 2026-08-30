"""The indexes that carry the constraints Postgres used to enforce.

Uniqueness, deduplication and idempotency all rest on MongoDB indexes now. An
index that silently failed to build would not break any happy path — it would
just quietly stop enforcing anything — so each one is asserted to exist *and*
to actually reject the write it is supposed to reject.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from pymongo.errors import DuplicateKeyError

from app.db.base import utcnow
from app.models import (
    Cat,
    DeviceToken,
    FeedingEvent,
    FeedingSchedule,
    Notification,
    NotificationType,
    RefreshToken,
    User,
)
from tests.conftest import make_user, signup_payload


async def index_names(model) -> set[str]:
    info = await model.get_motor_collection().index_information()
    return set(info)


async def index_keys(model) -> list[list[tuple]]:
    info = await model.get_motor_collection().index_information()
    return [value["key"] for value in info.values()]


class TestUniqueAccountFields:
    async def test_email_is_unique(self) -> None:
        await make_user()
        with pytest.raises(DuplicateKeyError):
            await User(
                email="maya@example.com",
                phone="+14155559999",
                hashed_password="x",
            ).insert()

    async def test_phone_is_unique(self) -> None:
        """The user asked for phone to stay unique when the backend was on
        Postgres; the MongoDB port must not quietly drop that."""
        await make_user()
        with pytest.raises(DuplicateKeyError):
            await User(
                email="someone-else@example.com",
                phone="+14155552671",
                hashed_password="x",
            ).insert()

    async def test_the_signup_endpoint_reports_which_field_collided(self, client) -> None:
        await client.post("/api/v1/auth/signup", json=signup_payload())

        duplicate_phone = await client.post(
            "/api/v1/auth/signup", json=signup_payload(email="other@example.com")
        )
        assert duplicate_phone.status_code == 409
        assert "phone" in duplicate_phone.json()["detail"]

        duplicate_email = await client.post(
            "/api/v1/auth/signup", json=signup_payload(phone="+14155559999")
        )
        assert duplicate_email.status_code == 409
        assert "email" in duplicate_email.json()["detail"]


class TestUniqueTokens:
    async def test_refresh_token_hash_is_unique(self) -> None:
        user = await make_user()
        expires = utcnow() + timedelta(days=1)
        await RefreshToken(user_id=user.id, token_hash="abc", expires_at=expires).insert()

        with pytest.raises(DuplicateKeyError):
            await RefreshToken(
                user_id=user.id, token_hash="abc", expires_at=expires
            ).insert()

    async def test_expo_push_token_is_unique_across_tenants(self) -> None:
        maya = await make_user()
        ravi = await make_user(email="ravi@example.com", phone="+14155552672")
        await DeviceToken(
            user_id=maya.id, expo_push_token="ExponentPushToken[shared]", platform="ios"
        ).insert()

        # Globally unique on purpose: one physical device belongs to one account.
        with pytest.raises(DuplicateKeyError):
            await DeviceToken(
                user_id=ravi.id,
                expo_push_token="ExponentPushToken[shared]",
                platform="android",
            ).insert()


class TestFeedingEventDedupe:
    """Replaces the Postgres `UNIQUE (schedule_id, due_at)`."""

    async def test_the_same_schedule_slot_cannot_be_inserted_twice(self) -> None:
        user = await make_user()
        cat = await Cat(user_id=user.id, name="Biscuit").insert()
        schedule = await FeedingSchedule(
            user_id=user.id, cat_id=cat.id, label="Breakfast", scheduled_time="07:30:00"
        ).insert()
        due = utcnow()

        await FeedingEvent(
            user_id=user.id, cat_id=cat.id, schedule_id=schedule.id, due_at=due
        ).insert()
        with pytest.raises(DuplicateKeyError):
            await FeedingEvent(
                user_id=user.id, cat_id=cat.id, schedule_id=schedule.id, due_at=due
            ).insert()

    async def test_ad_hoc_events_with_no_schedule_are_not_deduped(self) -> None:
        """The index is partial. A plain unique index would treat two null
        schedule_ids as duplicates and block a second ad-hoc feeding."""
        user = await make_user()
        cat = await Cat(user_id=user.id, name="Biscuit").insert()
        due = utcnow()

        await FeedingEvent(user_id=user.id, cat_id=cat.id, due_at=due).insert()
        await FeedingEvent(user_id=user.id, cat_id=cat.id, due_at=due).insert()

        assert await FeedingEvent.find(FeedingEvent.user_id == user.id).count() == 2


class TestNotificationDedupe:
    async def test_a_dedupe_key_is_unique_per_account(self) -> None:
        user = await make_user()
        await Notification(
            user_id=user.id,
            type=NotificationType.DAILY_DIGEST,
            title="t",
            body="b",
            dedupe_key="digest:2026-01-15",
        ).insert()

        with pytest.raises(DuplicateKeyError):
            await Notification(
                user_id=user.id,
                type=NotificationType.DAILY_DIGEST,
                title="t",
                body="b",
                dedupe_key="digest:2026-01-15",
            ).insert()

    async def test_two_accounts_may_share_a_dedupe_key(self) -> None:
        maya = await make_user()
        ravi = await make_user(email="ravi@example.com", phone="+14155552672")

        for user in (maya, ravi):
            await Notification(
                user_id=user.id,
                type=NotificationType.DAILY_DIGEST,
                title="t",
                body="b",
                dedupe_key="digest:2026-01-15",
            ).insert()

        assert await Notification.find().count() == 2

    async def test_notifications_without_a_dedupe_key_are_never_blocked(self) -> None:
        user = await make_user()
        for _ in range(3):
            await Notification(
                user_id=user.id, type=NotificationType.SYSTEM, title="t", body="b"
            ).insert()

        assert await Notification.find(Notification.user_id == user.id).count() == 3


class TestTenantIndexesExist:
    @pytest.mark.parametrize(
        "model",
        [Cat, FeedingEvent, FeedingSchedule, Notification, RefreshToken, DeviceToken],
    )
    async def test_every_tenant_collection_indexes_user_id(self, model) -> None:
        """Each tenant query filters on user_id, so it needs to be indexed or
        every list endpoint degrades to a collection scan as data grows."""
        keys = await index_keys(model)
        assert any(
            key[0][0] == "user_id" for key in keys if key
        ), f"{model.__name__} has no index leading with user_id: {keys}"
