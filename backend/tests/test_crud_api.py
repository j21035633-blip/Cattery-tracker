"""End-to-end CRUD tests, against a real MongoDB."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from tests.conftest import signup_payload

API = "/api/v1"


async def register(client, **overrides) -> dict[str, str]:
    """Sign up and return ready-to-use auth headers."""
    body = (await client.post(f"{API}/auth/signup", json=signup_payload(**overrides))).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


async def add_cat(client, headers, name: str = "Biscuit") -> dict:
    response = await client.post(f"{API}/cats", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
async def maya(client) -> dict[str, str]:
    return await register(client)


@pytest.fixture
async def ravi(client) -> dict[str, str]:
    return await register(client, email="ravi@example.com", phone="+14155552672")


class TestCatCrud:
    async def test_create_read_update_delete(self, client, maya) -> None:
        created = (
            await client.post(
                f"{API}/cats",
                json={"name": "Biscuit", "breed": "Maine Coon", "sex": "female"},
                headers=maya,
            )
        ).json()
        assert created["name"] == "Biscuit"
        assert created["is_active"] is True

        cat_id = created["id"]
        assert (await client.get(f"{API}/cats/{cat_id}", headers=maya)).status_code == 200

        patched = await client.patch(
            f"{API}/cats/{cat_id}", json={"color": "tabby"}, headers=maya
        )
        assert patched.json()["color"] == "tabby"
        assert patched.json()["name"] == "Biscuit", "PATCH must not clear other fields"

        assert (
            await client.delete(f"{API}/cats/{cat_id}", headers=maya)
        ).status_code == 204
        assert (await client.get(f"{API}/cats/{cat_id}", headers=maya)).status_code == 404

    async def test_list_filters_and_paginates(self, client, maya) -> None:
        for name in ("Biscuit", "Pepper", "Mochi"):
            await add_cat(client, maya, name)

        page = (await client.get(f"{API}/cats?limit=2", headers=maya)).json()
        assert page["total"] == 3
        assert len(page["items"]) == 2
        assert [c["name"] for c in page["items"]] == ["Biscuit", "Mochi"], "sorted by name"

        found = (await client.get(f"{API}/cats?search=pep", headers=maya)).json()
        assert [c["name"] for c in found["items"]] == ["Pepper"]

    async def test_future_birthday_is_rejected(self, client, maya) -> None:
        tomorrow = (datetime.now(UTC) + timedelta(days=1)).date().isoformat()
        response = await client.post(
            f"{API}/cats", json={"name": "Biscuit", "date_of_birth": tomorrow}, headers=maya
        )
        assert response.status_code == 422

    async def test_a_cat_is_invisible_to_another_account(self, client, maya, ravi) -> None:
        cat = await add_cat(client, maya)

        assert (await client.get(f"{API}/cats/{cat['id']}", headers=ravi)).status_code == 404
        assert (
            await client.patch(
                f"{API}/cats/{cat['id']}", json={"name": "Stolen"}, headers=ravi
            )
        ).status_code == 404
        assert (
            await client.delete(f"{API}/cats/{cat['id']}", headers=ravi)
        ).status_code == 404
        assert (await client.get(f"{API}/cats", headers=ravi)).json()["total"] == 0


class TestFeedingSchedules:
    async def test_create_and_list_for_a_cat(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        created = await client.post(
            f"{API}/feeding-schedules",
            json={
                "cat_id": cat["id"],
                "label": "Breakfast",
                "scheduled_time": "07:30:00",
                "days_of_week": [1, 3, 5],
                "portion_amount": "60.00",
                "portion_unit": "g",
            },
            headers=maya,
        )
        assert created.status_code == 201, created.text
        assert created.json()["days_of_week"] == [1, 3, 5]

        listed = (
            await client.get(f"{API}/feeding-schedules?cat_id={cat['id']}", headers=maya)
        ).json()
        assert listed["total"] == 1

    async def test_cannot_schedule_against_another_accounts_cat(
        self, client, maya, ravi
    ) -> None:
        cat = await add_cat(client, maya)
        response = await client.post(
            f"{API}/feeding-schedules",
            json={"cat_id": cat["id"], "label": "Breakfast", "scheduled_time": "07:30:00"},
            headers=ravi,
        )
        # 404, not 403: Ravi learns nothing about whether that cat exists.
        assert response.status_code == 404

    async def test_empty_days_of_week_is_rejected(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        response = await client.post(
            f"{API}/feeding-schedules",
            json={
                "cat_id": cat["id"],
                "label": "Breakfast",
                "scheduled_time": "07:30:00",
                "days_of_week": [],
            },
            headers=maya,
        )
        assert response.status_code == 422


class TestFeedingEventGeneration:
    async def test_generation_is_idempotent(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        await client.post(
            f"{API}/feeding-schedules",
            json={
                "cat_id": cat["id"],
                "label": "Breakfast",
                "scheduled_time": "07:30:00",
                "days_of_week": [1, 2, 3, 4, 5, 6, 7],
            },
            headers=maya,
        )

        first = (
            await client.post(f"{API}/feeding-events/generate", json={"days": 3}, headers=maya)
        ).json()
        assert first["created"] == 3
        assert first["skipped_existing"] == 0

        second = (
            await client.post(f"{API}/feeding-events/generate", json={"days": 3}, headers=maya)
        ).json()
        assert second["created"] == 0
        assert second["skipped_existing"] == 3, "re-running a day creates nothing"

        events = (await client.get(f"{API}/feeding-events", headers=maya)).json()
        assert events["total"] == 3

    async def test_inactive_schedules_do_not_generate(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        schedule = (
            await client.post(
                f"{API}/feeding-schedules",
                json={"cat_id": cat["id"], "label": "Breakfast", "scheduled_time": "07:30:00"},
                headers=maya,
            )
        ).json()
        await client.patch(
            f"{API}/feeding-schedules/{schedule['id']}",
            json={"is_active": False},
            headers=maya,
        )

        result = (
            await client.post(f"{API}/feeding-events/generate", json={"days": 3}, headers=maya)
        ).json()
        assert result["created"] == 0

    async def test_generation_only_touches_the_callers_schedules(
        self, client, maya, ravi
    ) -> None:
        maya_cat = await add_cat(client, maya)
        await client.post(
            f"{API}/feeding-schedules",
            json={
                "cat_id": maya_cat["id"],
                "label": "Breakfast",
                "scheduled_time": "07:30:00",
            },
            headers=maya,
        )

        result = (
            await client.post(f"{API}/feeding-events/generate", json={"days": 1}, headers=ravi)
        ).json()
        assert result["created"] == 0
        assert (await client.get(f"{API}/feeding-events", headers=ravi)).json()["total"] == 0


class TestFeedingEventActions:
    async def test_complete_and_skip(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        due = datetime(2026, 1, 15, 6, 30, tzinfo=UTC).isoformat()
        event = (
            await client.post(
                f"{API}/feeding-events",
                json={"cat_id": cat["id"], "due_at": due},
                headers=maya,
            )
        ).json()
        assert event["status"] == "pending"

        completed = (
            await client.post(
                f"{API}/feeding-events/{event['id']}/complete", json={}, headers=maya
            )
        ).json()
        assert completed["status"] == "completed"
        assert completed["completed_at"] is not None

        skipped = (
            await client.post(
                f"{API}/feeding-events/{event['id']}/skip",
                json={"notes": "at the vet"},
                headers=maya,
            )
        ).json()
        assert skipped["status"] == "skipped"
        assert skipped["completed_at"] is None

    async def test_cannot_complete_another_accounts_event(self, client, maya, ravi) -> None:
        cat = await add_cat(client, maya)
        event = (
            await client.post(
                f"{API}/feeding-events",
                json={
                    "cat_id": cat["id"],
                    "due_at": datetime(2026, 1, 15, 6, 30, tzinfo=UTC).isoformat(),
                },
                headers=maya,
            )
        ).json()

        response = await client.post(
            f"{API}/feeding-events/{event['id']}/complete", json={}, headers=ravi
        )
        assert response.status_code == 404


class TestCleaning:
    async def test_completion_logs_history_and_rolls_forward(self, client, maya) -> None:
        task = (
            await client.post(
                f"{API}/cleaning-tasks",
                json={"name": "Scoop litter", "zone": "Main room", "interval_hours": 24},
                headers=maya,
            )
        ).json()
        original_due = datetime.fromisoformat(task["next_due_at"])

        result = (
            await client.post(
                f"{API}/cleaning-tasks/{task['id']}/complete", json={}, headers=maya
            )
        ).json()

        assert result["event"]["due_at"] == task["next_due_at"]
        assert result["event"]["status"] == "completed"
        assert datetime.fromisoformat(result["task"]["next_due_at"]) > original_due
        assert result["task"]["last_completed_at"] is not None

        history = (await client.get(f"{API}/cleaning-events", headers=maya)).json()
        assert history["total"] == 1

    async def test_next_due_defaults_to_one_interval_out(self, client, maya) -> None:
        before = datetime.now(UTC)
        task = (
            await client.post(
                f"{API}/cleaning-tasks",
                json={"name": "Deep clean", "zone": "Pen A", "interval_hours": 168},
                headers=maya,
            )
        ).json()
        due = datetime.fromisoformat(task["next_due_at"])
        assert timedelta(hours=167) < due - before < timedelta(hours=169)

    async def test_tasks_are_tenant_scoped(self, client, maya, ravi) -> None:
        task = (
            await client.post(
                f"{API}/cleaning-tasks",
                json={"name": "Scoop litter", "zone": "Main room", "interval_hours": 24},
                headers=maya,
            )
        ).json()

        assert (
            await client.get(f"{API}/cleaning-tasks/{task['id']}", headers=ravi)
        ).status_code == 404
        assert (
            await client.post(
                f"{API}/cleaning-tasks/{task['id']}/complete", json={}, headers=ravi
            )
        ).status_code == 404
        assert (await client.get(f"{API}/cleaning-tasks", headers=ravi)).json()["total"] == 0


class TestVetRecords:
    async def test_completing_with_a_follow_up_creates_a_second_record(
        self, client, maya
    ) -> None:
        cat = await add_cat(client, maya)
        record = (
            await client.post(
                f"{API}/vet-records",
                json={
                    "cat_id": cat["id"],
                    "record_type": "vaccination",
                    "title": "Rabies booster",
                    "due_at": datetime(2026, 1, 15, 9, 0, tzinfo=UTC).isoformat(),
                },
                headers=maya,
            )
        ).json()

        returned = (
            await client.post(
                f"{API}/vet-records/{record['id']}/complete",
                json={"next_due_at": datetime(2027, 1, 15, 9, 0, tzinfo=UTC).isoformat()},
                headers=maya,
            )
        ).json()

        assert len(returned) == 2
        completed, follow_up = returned
        assert completed["completed_at"] is not None
        assert follow_up["completed_at"] is None
        assert follow_up["title"] == "Rabies booster"
        assert follow_up["id"] != completed["id"], "history is preserved"

        outstanding = (
            await client.get(f"{API}/vet-records?outstanding=true", headers=maya)
        ).json()
        assert outstanding["total"] == 1

    async def test_a_record_needs_a_date(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        response = await client.post(
            f"{API}/vet-records",
            json={"cat_id": cat["id"], "record_type": "note", "title": "Checkup notes"},
            headers=maya,
        )
        assert response.status_code == 422

    async def test_cannot_file_a_record_against_another_accounts_cat(
        self, client, maya, ravi
    ) -> None:
        cat = await add_cat(client, maya)
        response = await client.post(
            f"{API}/vet-records",
            json={
                "cat_id": cat["id"],
                "record_type": "appointment",
                "title": "Checkup",
                "due_at": datetime(2026, 1, 15, 9, 0, tzinfo=UTC).isoformat(),
            },
            headers=ravi,
        )
        assert response.status_code == 404


class TestWeightLogs:
    async def test_logging_and_trend(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        for day, grams in ((1, 4000), (8, 4200), (15, 4150)):
            response = await client.post(
                f"{API}/weight-logs",
                json={
                    "cat_id": cat["id"],
                    "weight_grams": grams,
                    "measured_at": datetime(2026, 1, day, 9, 0, tzinfo=UTC).isoformat(),
                },
                headers=maya,
            )
            assert response.status_code == 201, response.text

        trend = (
            await client.get(f"{API}/cats/{cat['id']}/weight-trend", headers=maya)
        ).json()
        assert trend["samples"] == 3
        assert trend["latest_grams"] == 4150
        assert trend["min_grams"] == 4000
        assert trend["max_grams"] == 4200
        # First -> latest, not min -> max.
        assert trend["change_grams"] == 150

    async def test_trend_for_a_cat_with_no_measurements(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        trend = (
            await client.get(f"{API}/cats/{cat['id']}/weight-trend", headers=maya)
        ).json()
        assert trend["samples"] == 0
        assert trend["change_grams"] is None

    async def test_implausible_weights_are_rejected(self, client, maya) -> None:
        cat = await add_cat(client, maya)
        for grams in (0, 50, 100_000):
            response = await client.post(
                f"{API}/weight-logs",
                json={"cat_id": cat["id"], "weight_grams": grams},
                headers=maya,
            )
            assert response.status_code == 422, f"{grams} g should be rejected"

    async def test_weight_trend_is_tenant_scoped(self, client, maya, ravi) -> None:
        cat = await add_cat(client, maya)
        await client.post(
            f"{API}/weight-logs",
            json={"cat_id": cat["id"], "weight_grams": 4200},
            headers=maya,
        )

        assert (
            await client.get(f"{API}/cats/{cat['id']}/weight-trend", headers=ravi)
        ).status_code == 404
        assert (await client.get(f"{API}/weight-logs", headers=ravi)).json()["total"] == 0
