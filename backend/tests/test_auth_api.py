"""End-to-end auth tests, against a real MongoDB."""

from __future__ import annotations

from tests.conftest import signup_payload

SIGNUP = "/api/v1/auth/signup"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestSignup:
    async def test_creates_account_seeded_with_defaults(self, client) -> None:
        response = await client.post(SIGNUP, json=signup_payload())
        assert response.status_code == 201, response.text

        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"] and body["refresh_token"]

        user = body["user"]
        assert user["email"] == "maya@example.com"
        assert user["phone"] == "+14155552671"
        assert user["plan"] == "free"
        assert user["digest_time"] == "08:00:00"
        assert user["timezone"] == "Europe/Berlin"
        assert "password" not in user and "hashed_password" not in user

        thresholds = {
            p["task_type"]: p["overdue_threshold_minutes"]
            for p in user["notification_preferences"]
        }
        assert thresholds["feeding"] == 120
        assert thresholds["cleaning"] == 360
        assert thresholds["vet"] == 1440

    async def test_email_is_matched_case_insensitively(self, client) -> None:
        await client.post(SIGNUP, json=signup_payload())
        duplicate = await client.post(
            SIGNUP, json=signup_payload(email="MAYA@Example.com", phone="+14155550000")
        )
        assert duplicate.status_code == 409

    async def test_duplicate_phone_is_rejected(self, client) -> None:
        await client.post(SIGNUP, json=signup_payload())
        duplicate = await client.post(
            SIGNUP, json=signup_payload(email="other@example.com")
        )
        assert duplicate.status_code == 409
        assert "phone" in duplicate.json()["detail"]

    async def test_invalid_phone_is_rejected(self, client) -> None:
        response = await client.post(SIGNUP, json=signup_payload(phone="415-555-2671"))
        assert response.status_code == 422


class TestLogin:
    async def test_returns_a_working_token(self, client) -> None:
        await client.post(SIGNUP, json=signup_payload())
        response = await client.post(
            LOGIN, json={"email": "maya@example.com", "password": "correct-horse-9"}
        )
        assert response.status_code == 200

        token = response.json()["access_token"]
        me = await client.get(ME, headers=auth(token))
        assert me.status_code == 200
        assert me.json()["email"] == "maya@example.com"

    async def test_wrong_password_is_401(self, client) -> None:
        await client.post(SIGNUP, json=signup_payload())
        response = await client.post(
            LOGIN, json={"email": "maya@example.com", "password": "wrong-password-1"}
        )
        assert response.status_code == 401

    async def test_unknown_email_gives_the_same_error_as_a_wrong_password(
        self, client
    ) -> None:
        await client.post(SIGNUP, json=signup_payload())
        unknown = await client.post(
            LOGIN, json={"email": "nobody@example.com", "password": "correct-horse-9"}
        )
        wrong = await client.post(
            LOGIN, json={"email": "maya@example.com", "password": "wrong-password-1"}
        )
        # Identical responses: the endpoint must not reveal which emails exist.
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json()


class TestProtectedRoutes:
    async def test_missing_token_is_401(self, client) -> None:
        assert (await client.get(ME)).status_code == 401

    async def test_garbage_token_is_401(self, client) -> None:
        assert (await client.get(ME, headers=auth("not.a.jwt"))).status_code == 401


class TestRefreshRotation:
    async def test_refresh_issues_a_new_pair(self, client) -> None:
        signup = (await client.post(SIGNUP, json=signup_payload())).json()

        response = await client.post(
            REFRESH, json={"refresh_token": signup["refresh_token"]}
        )
        assert response.status_code == 200
        rotated = response.json()
        assert rotated["refresh_token"] != signup["refresh_token"]

        me = await client.get(ME, headers=auth(rotated["access_token"]))
        assert me.status_code == 200

    async def test_a_used_refresh_token_cannot_be_replayed(self, client) -> None:
        signup = (await client.post(SIGNUP, json=signup_payload())).json()
        await client.post(REFRESH, json={"refresh_token": signup["refresh_token"]})

        replay = await client.post(
            REFRESH, json={"refresh_token": signup["refresh_token"]}
        )
        assert replay.status_code == 401

    async def test_logout_revokes_the_refresh_token(self, client) -> None:
        signup = (await client.post(SIGNUP, json=signup_payload())).json()

        logout = await client.post(
            LOGOUT,
            json={"refresh_token": signup["refresh_token"]},
            headers=auth(signup["access_token"]),
        )
        assert logout.status_code == 200

        refresh = await client.post(
            REFRESH, json={"refresh_token": signup["refresh_token"]}
        )
        assert refresh.status_code == 401


class TestChangePassword:
    async def test_rotates_credentials_and_revokes_other_sessions(self, client) -> None:
        signup = (await client.post(SIGNUP, json=signup_payload())).json()

        response = await client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": "correct-horse-9",
                "new_password": "battery-staple-7",
            },
            headers=auth(signup["access_token"]),
        )
        assert response.status_code == 200

        old_login = await client.post(
            LOGIN, json={"email": "maya@example.com", "password": "correct-horse-9"}
        )
        assert old_login.status_code == 401

        new_login = await client.post(
            LOGIN, json={"email": "maya@example.com", "password": "battery-staple-7"}
        )
        assert new_login.status_code == 200

        # The session that existed before the change is dead.
        stale = await client.post(REFRESH, json={"refresh_token": signup["refresh_token"]})
        assert stale.status_code == 401

    async def test_wrong_current_password_is_rejected(self, client) -> None:
        signup = (await client.post(SIGNUP, json=signup_payload())).json()
        response = await client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "nope-nope-11", "new_password": "battery-staple-7"},
            headers=auth(signup["access_token"]),
        )
        assert response.status_code == 400
