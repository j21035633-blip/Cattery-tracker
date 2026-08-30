"""Multi-tenant isolation against a real MongoDB.

These are the tests that must never be allowed to regress. They matter more
here than they did on Postgres: the composite foreign key that made a
cross-tenant reference *unrepresentable* has no MongoDB equivalent, so the
guarantee now rests on `app.db.tenancy` and on every write path calling
`assert_owned`. These tests are what hold that line.
"""

from __future__ import annotations

import pytest
from beanie import PydanticObjectId

from app.db.tenancy import assert_owned, count_owned, get_owned, paginate, tenant_query
from app.models import Cat, User, WeightLog
from tests.conftest import make_user, register

API = "/api/v1"


@pytest.fixture
async def maya() -> User:
    return await make_user()


@pytest.fixture
async def ravi() -> User:
    return await make_user(email="ravi@example.com", phone="+14155552672")


class TestQueryScoping:
    async def test_tenant_query_hides_other_accounts_documents(self, maya, ravi) -> None:
        await Cat(user_id=maya.id, name="Biscuit").insert()
        await Cat(user_id=ravi.id, name="Pepper").insert()

        maya_cats = await tenant_query(Cat, maya.id).to_list()
        ravi_cats = await tenant_query(Cat, ravi.id).to_list()

        assert [c.name for c in maya_cats] == ["Biscuit"]
        assert [c.name for c in ravi_cats] == ["Pepper"]

    async def test_get_owned_returns_none_across_tenants(self, maya, ravi) -> None:
        cat = await Cat(user_id=maya.id, name="Biscuit").insert()

        assert await get_owned(Cat, cat.id, maya.id) is not None
        # Ravi knows the id but must still get nothing back.
        assert await get_owned(Cat, cat.id, ravi.id) is None

    async def test_count_owned_is_scoped(self, maya, ravi) -> None:
        await Cat(user_id=maya.id, name="Biscuit").insert()
        await Cat(user_id=maya.id, name="Mochi").insert()
        await Cat(user_id=ravi.id, name="Pepper").insert()

        assert await count_owned(Cat, maya.id) == 2
        assert await count_owned(Cat, ravi.id) == 1

    async def test_paginate_counts_only_the_callers_documents(self, maya, ravi) -> None:
        for index in range(5):
            await Cat(user_id=maya.id, name=f"Maya cat {index}").insert()
        for index in range(3):
            await Cat(user_id=ravi.id, name=f"Ravi cat {index}").insert()

        items, total = await paginate(tenant_query(Cat, maya.id), limit=2, offset=0)
        assert len(items) == 2
        assert total == 5, "the count must not leak the other tenant's documents"

    async def test_tenant_query_refuses_the_tenant_root(self) -> None:
        # `users` is the tenant itself, so scoping it by user_id is a bug.
        with pytest.raises(TypeError):
            tenant_query(User, PydanticObjectId())


class TestReferenceOwnership:
    """`assert_owned` is what replaces the composite foreign key."""

    async def test_assert_owned_rejects_another_tenants_document(self, maya, ravi) -> None:
        cat = await Cat(user_id=maya.id, name="Biscuit").insert()

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as caught:
            await assert_owned(Cat, cat.id, ravi.id)
        assert caught.value.status_code == 404

    async def test_assert_owned_accepts_the_owner(self, maya) -> None:
        cat = await Cat(user_id=maya.id, name="Biscuit").insert()
        assert (await assert_owned(Cat, cat.id, maya.id)).id == cat.id

    async def test_api_refuses_a_borrowed_cat_id_on_every_write_path(
        self, client, maya
    ) -> None:
        """The end-to-end version: each endpoint that stores a `cat_id` must
        reject one belonging to another account."""
        cat = await Cat(user_id=maya.id, name="Biscuit").insert()
        ravi_headers = await register(
            client, email="ravi@example.com", phone="+14155552672"
        )

        attempts = [
            (
                "/feeding-schedules",
                {"cat_id": str(cat.id), "label": "Breakfast", "scheduled_time": "07:30:00"},
            ),
            (
                "/feeding-events",
                {"cat_id": str(cat.id), "due_at": "2026-01-15T06:30:00Z"},
            ),
            (
                "/vet-records",
                {
                    "cat_id": str(cat.id),
                    "record_type": "appointment",
                    "title": "Checkup",
                    "due_at": "2026-01-15T09:00:00Z",
                },
            ),
            ("/weight-logs", {"cat_id": str(cat.id), "weight_grams": 4200}),
        ]
        for path, body in attempts:
            response = await client.post(f"{API}{path}", json=body, headers=ravi_headers)
            assert response.status_code == 404, f"{path} accepted another tenant's cat"

        # And nothing was written.
        for path in ("/feeding-schedules", "/feeding-events", "/vet-records", "/weight-logs"):
            listed = await client.get(f"{API}{path}", headers=ravi_headers)
            assert listed.json()["total"] == 0


class TestApiIsolation:
    async def test_one_accounts_token_never_returns_another_accounts_profile(
        self, client
    ) -> None:
        maya = await register(client)
        ravi = await register(client, email="ravi@example.com", phone="+14155552672")

        for headers, expected_email in (
            (maya, "maya@example.com"),
            (ravi, "ravi@example.com"),
        ):
            response = await client.get(f"{API}/users/me", headers=headers)
            assert response.json()["email"] == expected_email

    async def test_token_for_a_deleted_account_stops_working(self, client) -> None:
        headers = await register(client)
        assert (await client.delete(f"{API}/users/me", headers=headers)).status_code == 204
        assert (await client.get(f"{API}/users/me", headers=headers)).status_code == 401

    async def test_preferences_update_only_touches_the_callers_account(
        self, client
    ) -> None:
        maya = await register(client)
        ravi = await register(client, email="ravi@example.com", phone="+14155552672")

        response = await client.patch(
            f"{API}/users/me/notification-preferences",
            json={"task_type": "feeding", "overdue_threshold_minutes": 45},
            headers=maya,
        )
        assert response.status_code == 200
        assert response.json()["overdue_threshold_minutes"] == 45

        ravi_prefs = await client.get(
            f"{API}/users/me/notification-preferences", headers=ravi
        )
        feeding = next(p for p in ravi_prefs.json() if p["task_type"] == "feeding")
        assert feeding["overdue_threshold_minutes"] == 120, "unchanged for other tenants"

    async def test_notifications_are_tenant_scoped(self, client) -> None:
        maya = await register(client)
        ravi = await register(client, email="ravi@example.com", phone="+14155552672")
        await client.post(f"{API}/due-summary/send-digest", headers=maya)

        maya_list = (await client.get(f"{API}/notifications", headers=maya)).json()
        ravi_list = (await client.get(f"{API}/notifications", headers=ravi)).json()
        assert maya_list["total"] == 1
        assert ravi_list["total"] == 0

        notification_id = maya_list["items"][0]["id"]
        stolen = await client.post(
            f"{API}/notifications/{notification_id}/read", headers=ravi
        )
        assert stolen.status_code == 404


class TestUnknownIds:
    async def test_a_random_object_id_is_not_owned_by_anyone(self, maya) -> None:
        assert await get_owned(Cat, PydanticObjectId(), maya.id) is None

    async def test_a_malformed_id_is_rejected_not_crashed(self, client) -> None:
        headers = await register(client)
        response = await client.get(f"{API}/cats/not-an-object-id", headers=headers)
        assert response.status_code == 422


class TestWeightBounds:
    async def test_the_document_itself_rejects_an_absurd_weight(self, maya) -> None:
        """Postgres had a CHECK constraint; MongoDB has none, so the bound lives
        on the document and must actually be enforced."""
        cat = await Cat(user_id=maya.id, name="Biscuit").insert()

        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            WeightLog(user_id=maya.id, cat_id=cat.id, weight_grams=0)
        with pytest.raises(ValidationError):
            WeightLog(user_id=maya.id, cat_id=cat.id, weight_grams=100_000)
