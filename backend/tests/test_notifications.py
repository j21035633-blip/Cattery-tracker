"""Unit tests for digest composition, thresholds and push shaping. No database."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest
from beanie import PydanticObjectId

from app.models import TaskType, User, VetRecord
from app.models.enums import VetRecordType
from app.services import notifications as service
from app.services import push
from app.services.due import DueItem, DueSummary, _make_item, _vet_task_type


def make_user(tz: str = "Europe/Berlin", digest_time: time = time(8, 0)) -> User:
    user = User(
        email="maya@example.com",
        phone="+14155552671",
        hashed_password="x",
        timezone=tz,
    )
    user.id = PydanticObjectId()
    user.digest_time = digest_time
    user.digest_enabled = True
    user.push_enabled = True
    return user


def make_item(
    *,
    task_type: TaskType = TaskType.FEEDING,
    title: str = "Feed Biscuit",
    due_at: datetime,
    now: datetime,
    threshold_minutes: int = 120,
    already_alerted: bool = False,
    cat_name: str | None = "Biscuit",
) -> DueItem:
    cat_id = PydanticObjectId()
    return _make_item(
        task_type=task_type,
        entity_id=PydanticObjectId(),
        title=title,
        due_at=due_at,
        cat_id=cat_id,
        cat_names={cat_id: cat_name} if cat_name else {},
        now=now,
        threshold=timedelta(minutes=threshold_minutes),
        already_alerted=already_alerted,
    )


class TestOverdueThresholds:
    def test_an_item_is_overdue_immediately_but_alerts_only_past_the_threshold(
        self,
    ) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        # Due an hour ago, with the 2-hour feeding threshold.
        item = make_item(due_at=now - timedelta(hours=1), now=now, threshold_minutes=120)

        assert item.is_overdue, "the app should show it as late right away"
        assert not item.breaches_threshold, "but no alert until 2 hours have passed"

    def test_past_the_threshold_it_alerts(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        item = make_item(due_at=now - timedelta(hours=3), now=now, threshold_minutes=120)

        assert item.breaches_threshold
        assert item.overdue_by_minutes == 180

    def test_a_future_item_is_neither(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        item = make_item(due_at=now + timedelta(hours=1), now=now)

        assert not item.is_overdue
        assert not item.breaches_threshold
        assert item.overdue_by_minutes == 0

    def test_a_custom_threshold_changes_when_it_alerts(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        due = now - timedelta(minutes=45)

        assert not make_item(due_at=due, now=now, threshold_minutes=120).breaches_threshold
        assert make_item(due_at=due, now=now, threshold_minutes=30).breaches_threshold

    @pytest.mark.parametrize(
        ("record_type", "expected"),
        [
            (VetRecordType.VACCINATION, TaskType.VACCINATION),
            (VetRecordType.MEDICATION, TaskType.MEDICATION),
            (VetRecordType.APPOINTMENT, TaskType.VET),
            (VetRecordType.TREATMENT, TaskType.VET),
            (VetRecordType.NOTE, TaskType.VET),
        ],
    )
    def test_vet_records_map_to_their_own_threshold_families(
        self, record_type: VetRecordType, expected: TaskType
    ) -> None:
        record = VetRecord(
            user_id=PydanticObjectId(),
            cat_id=PydanticObjectId(),
            record_type=record_type,
            title="x",
        )
        assert _vet_task_type(record) is expected


class TestDigestComposition:
    def _summary(self, now: datetime) -> DueSummary:
        summary = DueSummary(local_date=date(2026, 1, 15), timezone="Europe/Berlin")
        summary.overdue = [
            make_item(
                title="Feed Biscuit",
                due_at=now - timedelta(hours=3),
                now=now,
            )
        ]
        summary.today = [
            make_item(
                title="Feed Pepper",
                due_at=datetime(2026, 1, 15, 17, 0, tzinfo=UTC),
                now=now,
                cat_name="Pepper",
            )
        ]
        summary.upcoming = [
            make_item(
                task_type=TaskType.VACCINATION,
                title="Rabies booster",
                due_at=datetime(2026, 1, 19, 9, 0, tzinfo=UTC),
                now=now,
                cat_name="Biscuit",
            )
        ]
        return summary

    def test_title_leads_with_the_overdue_count(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        title, _ = service.compose_digest(self._summary(now))
        assert title == "1 overdue · 1 due today"

    def test_body_has_all_three_sections(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        _, body = service.compose_digest(self._summary(now))

        assert "Overdue" in body
        assert "Today" in body
        assert "This week" in body
        assert "Feed Biscuit" in body
        assert "Rabies booster" in body
        assert "3h late" in body

    def test_times_are_rendered_in_the_accounts_timezone(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        _, body = service.compose_digest(self._summary(now))
        # 17:00 UTC is 18:00 in Berlin in January.
        assert "18:00 · Feed Pepper" in body
        assert "17:00 · Feed Pepper" not in body

    def test_an_empty_day_still_reads_sensibly(self) -> None:
        summary = DueSummary(local_date=date(2026, 1, 15), timezone="Europe/Berlin")
        title, body = service.compose_digest(summary)

        assert title == "Nothing due today"
        assert "Nothing scheduled" in body

    def test_title_without_overdue_items(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        summary = self._summary(now)
        summary.overdue = []
        title, _ = service.compose_digest(summary)
        assert title == "1 due today"


class TestHumaniseMinutes:
    @pytest.mark.parametrize(
        ("minutes", "expected"),
        [
            (5, "5 min"),
            (59, "59 min"),
            (60, "1h"),
            (150, "2h 30m"),
            (1440, "1d"),
            (1500, "1d 1h"),
        ],
    )
    def test_readable_durations(self, minutes: int, expected: str) -> None:
        assert service._humanise_minutes(minutes) == expected


class TestDigestScheduling:
    def test_not_due_before_the_local_digest_time(self) -> None:
        user = make_user("Europe/Berlin", digest_time=time(8, 0))
        # 06:00 UTC is 07:00 in Berlin — too early.
        now = datetime(2026, 1, 15, 6, 0, tzinfo=UTC)
        assert not service.digest_is_due(user, now=now, last_sent_for=None)

    def test_due_once_the_local_time_has_passed(self) -> None:
        user = make_user("Europe/Berlin", digest_time=time(8, 0))
        # 08:00 UTC is 09:00 in Berlin.
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        assert service.digest_is_due(user, now=now, last_sent_for=None)

    def test_not_sent_twice_on_the_same_local_day(self) -> None:
        user = make_user("Europe/Berlin", digest_time=time(8, 0))
        now = datetime(2026, 1, 15, 12, 0, tzinfo=UTC)
        assert not service.digest_is_due(user, now=now, last_sent_for=date(2026, 1, 15))
        assert service.digest_is_due(user, now=now, last_sent_for=date(2026, 1, 14))

    def test_the_users_timezone_decides_the_day(self) -> None:
        # 20:00 UTC on the 14th is 09:00 on the 15th in Auckland.
        user = make_user("Pacific/Auckland", digest_time=time(8, 0))
        now = datetime(2026, 1, 14, 20, 0, tzinfo=UTC)

        assert service.digest_is_due(user, now=now, last_sent_for=date(2026, 1, 14))
        assert not service.digest_is_due(user, now=now, last_sent_for=date(2026, 1, 15))

    def test_a_disabled_digest_is_never_due(self) -> None:
        user = make_user()
        user.digest_enabled = False
        now = datetime(2026, 1, 15, 12, 0, tzinfo=UTC)
        assert not service.digest_is_due(user, now=now, last_sent_for=None)

    def test_a_custom_digest_time_is_respected(self) -> None:
        user = make_user("Europe/Berlin", digest_time=time(20, 0))
        # 09:00 Berlin — well before the 20:00 they chose.
        assert not service.digest_is_due(
            user, now=datetime(2026, 1, 15, 8, 0, tzinfo=UTC), last_sent_for=None
        )
        # 21:00 Berlin.
        assert service.digest_is_due(
            user, now=datetime(2026, 1, 15, 20, 0, tzinfo=UTC), last_sent_for=None
        )


class TestDedupeKeys:
    def test_the_digest_key_is_one_per_local_day(self) -> None:
        assert service.digest_dedupe_key(date(2026, 1, 15)) == "digest:2026-01-15"
        assert service.digest_dedupe_key(date(2026, 1, 15)) != service.digest_dedupe_key(
            date(2026, 1, 16)
        )

    def test_the_overdue_key_is_one_per_item(self) -> None:
        now = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        item = make_item(due_at=now - timedelta(hours=3), now=now)

        key = service.overdue_dedupe_key(item)
        assert key == f"overdue:feeding:{item.entity_id}"
        assert key == service.overdue_dedupe_key(item), "stable across sweeps"

        other = make_item(due_at=now - timedelta(hours=3), now=now)
        assert service.overdue_dedupe_key(other) != key


class TestPushMessages:
    def test_message_shape_matches_the_expo_api(self) -> None:
        message = push.build_message(
            "ExponentPushToken[abc123]",
            title="Overdue: Feed Biscuit",
            body="Feed Biscuit was due 3h ago.",
            data={"screen": "feeding"},
        )
        assert message["to"] == "ExponentPushToken[abc123]"
        assert message["title"] == "Overdue: Feed Biscuit"
        assert message["sound"] == "default"
        assert message["channelId"] == "default"
        assert message["data"] == {"screen": "feeding"}

    async def test_sending_to_no_devices_is_a_no_op(self) -> None:
        result = await push.send_push([], title="x", body="y")
        assert result.sent == 0
        assert result.ok
