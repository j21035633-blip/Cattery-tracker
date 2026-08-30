"""End-to-end notification engine tests, against a real MongoDB.

The deduplication guarantees here are enforced by MongoDB indexes and upserts
rather than by Postgres constraints, so these exercise the real server —
running them against a fake would prove nothing.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.db.base import utcnow
from app.models import Cat, CleaningTask, FeedingEvent, Notification, User
from app.services import notifications as service
from app.services import scheduling
from app.services.due import build_due_summary
from tests.conftest import make_user, register

API = "/api/v1"


async def add_overdue_cleaning(
    user: User, *, hours_late: int, name: str = "Scoop litter"
) -> CleaningTask:
    return await CleaningTask(
        user_id=user.id,
        name=name,
        zone="Main room",
        interval_hours=24,
        next_due_at=utcnow() - timedelta(hours=hours_late),
    ).insert()


@pytest.fixture
async def maya() -> User:
    return await make_user()


@pytest.fixture
async def ravi() -> User:
    return await make_user(email="ravi@example.com", phone="+14155552672")


class TestOverdueAlerts:
    async def test_no_alert_before_the_threshold(self, maya) -> None:
        # Cleaning's default threshold is 6 hours.
        await add_overdue_cleaning(maya, hours_late=2)
        assert await service.send_overdue_alerts(maya) == []

    async def test_alert_once_past_the_threshold(self, maya) -> None:
        await add_overdue_cleaning(maya, hours_late=8)

        alerts = await service.send_overdue_alerts(maya)

        assert len(alerts) == 1
        assert alerts[0].type.value == "overdue"
        assert alerts[0].task_type.value == "cleaning"
        assert "Scoop litter" in alerts[0].title

    async def test_the_same_item_never_alerts_twice(self, maya) -> None:
        task = await add_overdue_cleaning(maya, hours_late=8)

        first = await service.send_overdue_alerts(maya)
        second = await service.send_overdue_alerts(maya)

        assert len(first) == 1
        assert second == [], "the overdue_alerted_at latch holds"

        refreshed = await CleaningTask.get(task.id)
        assert refreshed.overdue_alerted_at is not None

    async def test_the_dedupe_index_blocks_a_duplicate_even_without_the_latch(
        self, maya
    ) -> None:
        """Belt and braces: clearing the latch must still not produce a second
        notification, because the dedupe key is unique per account."""
        task = await add_overdue_cleaning(maya, hours_late=8)
        assert len(await service.send_overdue_alerts(maya)) == 1

        await CleaningTask.get_motor_collection().update_one(
            {"_id": task.id}, {"$set": {"overdue_alerted_at": None}}
        )
        assert await service.send_overdue_alerts(maya) == []
        assert await Notification.find(Notification.user_id == maya.id).count() == 1

    async def test_a_custom_threshold_takes_effect(self, maya) -> None:
        await add_overdue_cleaning(maya, hours_late=2)

        # Default 6h: nothing fires.
        assert await service.send_overdue_alerts(maya) == []

        preference = maya.preference_for("cleaning")
        preference.overdue_threshold_minutes = 60
        maya.notification_preferences = list(maya.notification_preferences)
        await maya.save()

        alerts = await service.send_overdue_alerts(maya)
        assert len(alerts) == 1, "the account's own threshold decides"

    async def test_alerts_never_cross_tenants(self, maya, ravi) -> None:
        await add_overdue_cleaning(maya, hours_late=8)

        assert await service.send_overdue_alerts(ravi) == []
        assert len(await service.send_overdue_alerts(maya)) == 1

    async def test_completing_an_item_clears_the_latch(self, maya) -> None:
        task = await add_overdue_cleaning(maya, hours_late=8)
        await service.send_overdue_alerts(maya)

        event = scheduling.complete_cleaning_task(task)
        await event.insert()
        await task.save()

        refreshed = await CleaningTask.get(task.id)
        assert refreshed.overdue_alerted_at is None, "a re-opened task can alert again"


class TestDailyDigest:
    async def test_digest_is_recorded_once_per_local_day(self, maya) -> None:
        await add_overdue_cleaning(maya, hours_late=8)

        first = await service.send_daily_digest(maya, force=True)
        second = await service.send_daily_digest(maya, force=True)

        assert first is not None
        assert second is None, "the dedupe key blocks a second digest today"
        assert first.dedupe_key.startswith("digest:")
        assert await Notification.find(Notification.user_id == maya.id).count() == 1

    async def test_digest_body_lists_the_overdue_item(self, maya) -> None:
        await add_overdue_cleaning(maya, hours_late=8, name="Deep clean")

        digest = await service.send_daily_digest(maya, force=True)

        assert "Deep clean" in digest.body
        assert digest.payload["counts"]["overdue"] == 1

    async def test_a_task_type_excluded_from_the_digest_is_left_out(self, maya) -> None:
        await add_overdue_cleaning(maya, hours_late=8, name="Deep clean")

        preference = maya.preference_for("cleaning")
        preference.include_in_digest = False
        maya.notification_preferences = list(maya.notification_preferences)
        await maya.save()

        digest = await service.send_daily_digest(maya, force=True)

        assert "Deep clean" not in digest.body
        assert digest.payload["counts"]["overdue"] == 0

    async def test_two_accounts_each_get_their_own_digest_on_the_same_day(
        self, maya, ravi
    ) -> None:
        assert await service.send_daily_digest(maya, force=True) is not None
        assert await service.send_daily_digest(ravi, force=True) is not None
        assert await Notification.find().count() == 2


class TestMissedFeedings:
    async def test_yesterdays_pending_feedings_become_missed(self, maya) -> None:
        cat = await Cat(user_id=maya.id, name="Biscuit").insert()
        await FeedingEvent(
            user_id=maya.id, cat_id=cat.id, due_at=utcnow() - timedelta(days=2)
        ).insert()
        today_event = await FeedingEvent(
            user_id=maya.id, cat_id=cat.id, due_at=utcnow() + timedelta(hours=1)
        ).insert()

        marked = await service.mark_missed_feedings(maya)

        assert marked == 1
        refreshed = await FeedingEvent.get(today_event.id)
        assert refreshed.status.value == "pending", "today's slot is untouched"

    async def test_marking_missed_is_tenant_scoped(self, maya, ravi) -> None:
        ravi_cat = await Cat(user_id=ravi.id, name="Pepper").insert()
        await FeedingEvent(
            user_id=ravi.id, cat_id=ravi_cat.id, due_at=utcnow() - timedelta(days=2)
        ).insert()

        assert await service.mark_missed_feedings(maya) == 0
        assert await service.mark_missed_feedings(ravi) == 1


class TestDueSummaryEndpoint:
    async def test_reports_overdue_today_and_upcoming(self, client) -> None:
        headers = await register(client)
        created = await client.post(
            f"{API}/cleaning-tasks",
            json={"name": "Scoop litter", "zone": "Main room", "interval_hours": 24},
            headers=headers,
        )
        assert created.status_code == 201

        summary = (await client.get(f"{API}/due-summary", headers=headers)).json()
        assert set(summary["counts"]) == {"overdue", "today", "upcoming"}
        assert summary["timezone"] == "Europe/Berlin"
        assert sum(summary["counts"].values()) == 1

    async def test_summary_is_tenant_scoped(self, client) -> None:
        maya = await register(client)
        ravi = await register(client, email="ravi@example.com", phone="+14155552672")
        await client.post(
            f"{API}/cleaning-tasks",
            json={"name": "Scoop litter", "zone": "Main room", "interval_hours": 24},
            headers=maya,
        )

        ravi_summary = (await client.get(f"{API}/due-summary", headers=ravi)).json()
        assert sum(ravi_summary["counts"].values()) == 0

    async def test_digest_preview_does_not_record_anything(self, client) -> None:
        headers = await register(client)

        preview = (
            await client.get(f"{API}/due-summary/digest-preview", headers=headers)
        ).json()
        assert "title" in preview and "body" in preview

        listed = (await client.get(f"{API}/notifications", headers=headers)).json()
        assert listed["total"] == 0, "preview must not create a notification"


class TestNotificationCentre:
    async def test_list_read_and_unread_count(self, client) -> None:
        headers = await register(client)
        await client.post(
            f"{API}/cleaning-tasks",
            json={"name": "Scoop litter", "zone": "Main room", "interval_hours": 24},
            headers=headers,
        )
        assert (
            await client.post(f"{API}/due-summary/send-digest", headers=headers)
        ).status_code == 200

        assert (
            await client.get(f"{API}/notifications/unread-count", headers=headers)
        ).json()["unread"] == 1

        notification = (await client.get(f"{API}/notifications", headers=headers)).json()[
            "items"
        ][0]

        read = await client.post(
            f"{API}/notifications/{notification['id']}/read", headers=headers
        )
        assert read.json()["is_read"] is True
        assert (
            await client.get(f"{API}/notifications/unread-count", headers=headers)
        ).json()["unread"] == 0

    async def test_read_all_and_unread_filter(self, client) -> None:
        headers = await register(client)
        await client.post(f"{API}/due-summary/send-digest", headers=headers)

        unread = await client.get(f"{API}/notifications?unread_only=true", headers=headers)
        assert unread.json()["total"] == 1

        result = await client.post(f"{API}/notifications/read-all", headers=headers)
        assert result.json()["updated"] == 1

        unread_after = await client.get(
            f"{API}/notifications?unread_only=true", headers=headers
        )
        assert unread_after.json()["total"] == 0


class TestDeviceRegistration:
    async def test_registering_is_idempotent(self, client) -> None:
        headers = await register(client)
        body = {
            "expo_push_token": "ExponentPushToken[abc123def456]",
            "platform": "ios",
            "device_name": "Maya's iPhone",
        }

        for _ in range(2):
            created = await client.post(f"{API}/devices", json=body, headers=headers)
            assert created.status_code == 201

        devices = (await client.get(f"{API}/devices", headers=headers)).json()
        assert len(devices) == 1, "re-registering updates rather than duplicates"

    async def test_a_non_expo_token_is_rejected(self, client) -> None:
        headers = await register(client)
        response = await client.post(
            f"{API}/devices",
            json={"expo_push_token": "fcm-raw-token-value", "platform": "android"},
            headers=headers,
        )
        assert response.status_code == 422

    async def test_a_device_moves_to_the_account_that_registers_it(self, client) -> None:
        maya = await register(client)
        ravi = await register(client, email="ravi@example.com", phone="+14155552672")
        body = {"expo_push_token": "ExponentPushToken[shared000]", "platform": "android"}

        await client.post(f"{API}/devices", json=body, headers=maya)
        await client.post(f"{API}/devices", json=body, headers=ravi)

        assert len((await client.get(f"{API}/devices", headers=maya)).json()) == 0
        assert len((await client.get(f"{API}/devices", headers=ravi)).json()) == 1


class TestBuildDueSummary:
    async def test_buckets_are_ordered_by_due_time(self, maya) -> None:
        now = utcnow()
        for hours_late, name in ((10, "later"), (30, "earliest")):
            await CleaningTask(
                user_id=maya.id,
                name=name,
                zone="Z",
                interval_hours=24,
                next_due_at=now - timedelta(hours=hours_late),
            ).insert()

        summary = await build_due_summary(maya, now=now)
        assert [item.title.split(" — ")[0] for item in summary.overdue] == [
            "earliest",
            "later",
        ]

    async def test_notification_documents_carry_the_owning_tenant(self, maya) -> None:
        await add_overdue_cleaning(maya, hours_late=8)
        alerts = await service.send_overdue_alerts(maya)

        stored = await Notification.get(alerts[0].id)
        assert stored.user_id == maya.id
