"""Unit tests for signup validation and the tenant query helper."""

from __future__ import annotations

import pytest
from beanie import PydanticObjectId
from pydantic import ValidationError

from app.db.tenancy import tenant_query
from app.models import Cat, User
from app.models.enums import TaskType
from app.schemas.auth import SignupRequest
from app.schemas.user import UserUpdate, normalise_phone
from app.services.auth import default_preferences, normalise_email


class TestPhoneNormalisation:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("+14155552671", "+14155552671"),
            ("+1 (415) 555-2671", "+14155552671"),
            ("  +44 20 7946 0958 ", "+442079460958"),
        ],
    )
    def test_accepts_and_canonicalises_e164(self, raw: str, expected: str) -> None:
        assert normalise_phone(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "4155552671",  # no country code
            "+0155552671",  # country code cannot start with 0
            "+1415",  # too short
            "+1415555267100000",  # too long
            "not-a-phone",
        ],
    )
    def test_rejects_everything_else(self, raw: str) -> None:
        with pytest.raises(ValueError):
            normalise_phone(raw)


class TestSignupValidation:
    def test_valid_payload(self) -> None:
        request = SignupRequest(
            email="Maya@Example.COM",
            phone="+1 415 555 2671",
            password="correct-horse-9",
        )
        assert request.phone == "+14155552671"
        # Emails are lowercased in the service, not the schema, so that the
        # value the caller typed is still available for error messages.
        assert normalise_email(request.email) == "maya@example.com"

    @pytest.mark.parametrize(
        "password",
        [
            "short1!",  # under 10 characters
            "abcdefghijkl",  # letters only
            "1234567890123",  # digits only
        ],
    )
    def test_weak_passwords_are_rejected(self, password: str) -> None:
        with pytest.raises(ValidationError):
            SignupRequest(email="a@b.com", phone="+14155552671", password=password)

    def test_malformed_email_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SignupRequest(
                email="not-an-email", phone="+14155552671", password="correct-horse-9"
            )

    def test_unknown_timezone_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UserUpdate(timezone="Mars/Olympus_Mons")

    def test_known_timezone_is_accepted(self) -> None:
        assert UserUpdate(timezone="Asia/Kuala_Lumpur").timezone == "Asia/Kuala_Lumpur"


class TestDefaultNotificationPreferences:
    def test_one_entry_per_task_type_with_skill_defaults(self) -> None:
        # Embedded in the user document now, so this takes no owner id.
        preferences = default_preferences()
        by_type = {p.task_type: p.overdue_threshold_minutes for p in preferences}

        assert set(by_type) == set(TaskType)
        assert by_type[TaskType.FEEDING] == 120  # 2 hours
        assert by_type[TaskType.CLEANING] == 360  # 6 hours
        assert by_type[TaskType.VET] == 1440  # 24 hours


class TestTenantQuery:
    def test_always_filters_by_user_id(self) -> None:
        user_id = PydanticObjectId()
        query = tenant_query(Cat, user_id).get_filter_query()
        assert query["user_id"] == user_id

    def test_refuses_a_document_without_a_tenant_field(self) -> None:
        # `users` is the tenant root, so scoping it by user_id is a bug.
        with pytest.raises(TypeError):
            tenant_query(User, PydanticObjectId())
