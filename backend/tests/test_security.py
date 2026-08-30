"""Unit tests for hashing, JWTs and the multi-tenant guard rails.

These need no database.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from beanie import PydanticObjectId

from app.core import security
from app.core.config import get_settings
from app.core.plans import limits_for, within_limit
from app.models.enums import Plan


class TestPasswordHashing:
    def test_hash_is_salted_and_verifiable(self) -> None:
        first = security.hash_password("correct-horse-9")
        second = security.hash_password("correct-horse-9")

        assert first != second, "identical passwords must not produce identical hashes"
        assert security.verify_password("correct-horse-9", first)
        assert security.verify_password("correct-horse-9", second)

    def test_wrong_password_is_rejected(self) -> None:
        stored = security.hash_password("correct-horse-9")
        assert not security.verify_password("correct-horse-8", stored)

    def test_password_is_not_recoverable_from_the_hash(self) -> None:
        assert "correct-horse-9" not in security.hash_password("correct-horse-9")

    def test_long_password_is_not_silently_truncated(self) -> None:
        # bcrypt would ignore everything past 72 bytes; argon2 must not.
        base = "a" * 80
        stored = security.hash_password(base + "TAIL-1")
        assert not security.verify_password(base + "TAIL-2", stored)
        assert security.verify_password(base + "TAIL-1", stored)

    def test_garbage_hash_is_rejected_rather_than_raising(self) -> None:
        assert not security.verify_password("anything", "not-a-hash")


class TestAccessTokens:
    def test_round_trip_carries_the_user_id(self) -> None:
        user_id = PydanticObjectId()
        token, expires_at = security.create_access_token(user_id)

        payload = security.decode_access_token(token)
        assert payload["sub"] == str(user_id)
        assert payload["typ"] == "access"
        assert expires_at > datetime.now(UTC)

    def test_tokens_are_unique_per_issue(self) -> None:
        user_id = PydanticObjectId()
        first, _ = security.create_access_token(user_id)
        second, _ = security.create_access_token(user_id)
        assert first != second, "each token needs its own jti"

    def test_token_signed_with_another_key_is_rejected(self) -> None:
        forged = jwt.encode(
            {
                "sub": str(PydanticObjectId()),
                "typ": "access",
                "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            },
            "attacker-key",
            algorithm="HS256",
        )
        with pytest.raises(security.TokenError):
            security.decode_access_token(forged)

    def test_expired_token_is_rejected(self) -> None:
        settings = get_settings()
        expired = jwt.encode(
            {
                "sub": str(PydanticObjectId()),
                "typ": "access",
                "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp()),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(security.TokenError):
            security.decode_access_token(expired)

    def test_unsigned_alg_none_token_is_rejected(self) -> None:
        forged = jwt.encode(
            {"sub": str(PydanticObjectId()), "typ": "access", "exp": 9999999999},
            key="",
            algorithm="none",
        )
        with pytest.raises(security.TokenError):
            security.decode_access_token(forged)

    def test_refresh_token_cannot_be_used_as_an_access_token(self) -> None:
        settings = get_settings()
        refresh_shaped = jwt.encode(
            {
                "sub": str(PydanticObjectId()),
                "typ": "refresh",
                "exp": int((datetime.now(UTC) + timedelta(days=1)).timestamp()),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(security.TokenError):
            security.decode_access_token(refresh_shaped)


class TestRefreshTokens:
    def test_only_the_digest_is_storable(self) -> None:
        raw, digest, expires_at = security.create_refresh_token()

        assert raw != digest
        assert len(digest) == 64
        assert security.hash_refresh_token(raw) == digest
        assert expires_at > datetime.now(UTC)

    def test_each_token_is_unique(self) -> None:
        first, _, _ = security.create_refresh_token()
        second, _, _ = security.create_refresh_token()
        assert first != second


class TestPlanLimits:
    @pytest.mark.parametrize("plan", list(Plan))
    def test_every_plan_is_unlimited_until_billing_launches(self, plan: Plan) -> None:
        limits = limits_for(plan)
        assert limits.max_cats is None
        assert limits.max_schedules_per_cat is None
        assert within_limit(plan, "max_cats", current_count=10_000)
