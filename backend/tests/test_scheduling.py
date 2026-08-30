"""Unit tests for time-zone maths and the completion rules. No database."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest
from beanie import PydanticObjectId

from app.models import CleaningTask, EventStatus, FeedingEvent, User, VetRecord
from app.models.enums import VetRecordType
from app.services import scheduling


def make_user(tz: str = "Europe/Berlin") -> User:
    user = User(
        email="maya@example.com",
        phone="+14155552671",
        hashed_password="x",
        timezone=tz,
    )
    # Documents that never reach the database still need an id for the helpers
    # that key off it.
    user.id = PydanticObjectId()
    return user


class TestTimezoneMaths:
    def test_local_time_converts_to_the_right_utc_instant(self) -> None:
        user = make_user("Europe/Berlin")
        # Berlin is UTC+1 in January.
        assert scheduling.to_utc(user, date(2026, 1, 15), time(7, 30)) == datetime(
            2026, 1, 15, 6, 30, tzinfo=UTC
        )
        # …and UTC+2 in July.
        assert scheduling.to_utc(user, date(2026, 7, 15), time(7, 30)) == datetime(
            2026, 7, 15, 5, 30, tzinfo=UTC
        )

    def test_a_local_day_is_24_hours_except_across_a_dst_boundary(self) -> None:
        user = make_user("Europe/Berlin")

        ordinary_start, ordinary_end = scheduling.local_day_bounds(user, date(2026, 1, 15))
        assert ordinary_end - ordinary_start == timedelta(hours=24)

        # 29 March 2026 is the European spring-forward day: 23 hours long.
        short_start, short_end = scheduling.local_day_bounds(user, date(2026, 3, 29))
        assert short_end - short_start == timedelta(hours=23)

    def test_day_bounds_track_the_users_timezone_not_the_servers(self) -> None:
        berlin = scheduling.local_day_bounds(make_user("Europe/Berlin"), date(2026, 1, 15))
        auckland = scheduling.local_day_bounds(
            make_user("Pacific/Auckland"), date(2026, 1, 15)
        )
        assert berlin[0] != auckland[0], "same calendar day, different instants"

    def test_local_today_uses_the_accounts_offset(self) -> None:
        user = make_user("Pacific/Auckland")
        # 22:00 UTC on the 14th is already the 15th in Auckland (UTC+13 in January).
        now = datetime(2026, 1, 14, 22, 0, tzinfo=UTC)
        assert scheduling.local_today(user, now) == date(2026, 1, 15)

    def test_an_invalid_stored_timezone_falls_back_to_utc(self) -> None:
        user = make_user("Not/AZone")
        assert scheduling.to_utc(user, date(2026, 1, 15), time(7, 30)) == datetime(
            2026, 1, 15, 7, 30, tzinfo=UTC
        )


class TestFeedingCompletion:
    def test_completing_sets_status_and_clears_the_alert_latch(self) -> None:
        event = FeedingEvent(
            user_id=PydanticObjectId(),
            cat_id=PydanticObjectId(),
            due_at=datetime(2026, 1, 15, 6, 30, tzinfo=UTC),
            status=EventStatus.PENDING,
            overdue_alerted_at=datetime(2026, 1, 15, 9, 0, tzinfo=UTC),
        )
        done_at = datetime(2026, 1, 15, 9, 15, tzinfo=UTC)

        scheduling.complete_feeding_event(event, completed_at=done_at)

        assert event.status is EventStatus.COMPLETED
        assert event.completed_at == done_at
        assert event.overdue_alerted_at is None

    def test_completing_without_a_time_uses_now(self) -> None:
        event = FeedingEvent(
            user_id=PydanticObjectId(),
            cat_id=PydanticObjectId(),
            due_at=datetime(2026, 1, 15, 6, 30, tzinfo=UTC),
        )
        before = scheduling.utcnow()
        scheduling.complete_feeding_event(event)
        assert before <= event.completed_at <= scheduling.utcnow()

    def test_skipping_is_not_completing(self) -> None:
        event = FeedingEvent(
            user_id=PydanticObjectId(),
            cat_id=PydanticObjectId(),
            due_at=datetime(2026, 1, 15, 6, 30, tzinfo=UTC),
        )
        scheduling.skip_feeding_event(event, notes="at the vet")

        assert event.status is EventStatus.SKIPPED
        assert event.completed_at is None
        assert event.notes == "at the vet"


class TestCleaningCompletion:
    def _task(self, *, interval_hours: int = 24, next_due_at: datetime) -> CleaningTask:
        task = CleaningTask(
            user_id=PydanticObjectId(),
            name="Scoop litter",
            zone="Main room",
            interval_hours=interval_hours,
            next_due_at=next_due_at,
        )
        task.id = PydanticObjectId()
        return task

    def test_completion_logs_an_event_and_rolls_the_task_forward(self) -> None:
        due = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)
        task = self._task(next_due_at=due)
        done_at = datetime(2026, 1, 15, 9, 30, tzinfo=UTC)

        event = scheduling.complete_cleaning_task(task, completed_at=done_at)

        assert event.due_at == due, "the event records the slot that was owed"
        assert event.completed_at == done_at
        assert event.status is EventStatus.COMPLETED
        assert task.last_completed_at == done_at
        assert task.next_due_at == done_at + timedelta(hours=24)
        assert task.overdue_alerted_at is None

    def test_next_due_advances_from_completion_not_from_the_missed_slot(self) -> None:
        # Three days late on a daily task: the next slot is tomorrow, not three
        # days ago — otherwise a backlog of overdue slots piles up.
        task = self._task(next_due_at=datetime(2026, 1, 12, 8, 0, tzinfo=UTC))
        done_at = datetime(2026, 1, 15, 9, 30, tzinfo=UTC)

        scheduling.complete_cleaning_task(task, completed_at=done_at)

        assert task.next_due_at == datetime(2026, 1, 16, 9, 30, tzinfo=UTC)
        assert task.next_due_at > done_at

    def test_the_event_inherits_the_tasks_tenant(self) -> None:
        task = self._task(next_due_at=datetime(2026, 1, 15, 8, 0, tzinfo=UTC))
        event = scheduling.complete_cleaning_task(task)
        assert event.user_id == task.user_id


class TestVetCompletion:
    def _record(self) -> VetRecord:
        record = VetRecord(
            user_id=PydanticObjectId(),
            cat_id=PydanticObjectId(),
            record_type=VetRecordType.VACCINATION,
            title="Rabies booster",
            vet_name="Dr Adeyemi",
            due_at=datetime(2026, 1, 15, 8, 0, tzinfo=UTC),
            reminder_days_before=14,
            overdue_alerted_at=datetime(2026, 1, 16, 8, 0, tzinfo=UTC),
        )
        record.id = PydanticObjectId()
        return record

    def test_completing_without_a_follow_up_returns_nothing_new(self) -> None:
        record = self._record()
        done_at = datetime(2026, 1, 15, 10, 0, tzinfo=UTC)

        assert scheduling.complete_vet_record(record, completed_at=done_at) is None
        assert record.completed_at == done_at
        assert record.overdue_alerted_at is None

    def test_a_follow_up_is_a_new_row_so_history_survives(self) -> None:
        record = self._record()
        next_year = datetime(2027, 1, 15, 8, 0, tzinfo=UTC)

        follow_up = scheduling.complete_vet_record(record, next_due_at=next_year)

        assert follow_up is not None
        assert follow_up is not record
        assert follow_up.due_at == next_year
        assert follow_up.completed_at is None
        assert record.completed_at is not None, "the original stays completed"

    def test_the_follow_up_copies_tenant_cat_and_details(self) -> None:
        record = self._record()
        follow_up = scheduling.complete_vet_record(
            record, next_due_at=datetime(2027, 1, 15, 8, 0, tzinfo=UTC)
        )

        assert follow_up.user_id == record.user_id
        assert follow_up.cat_id == record.cat_id
        assert follow_up.record_type == record.record_type
        assert follow_up.title == record.title
        assert follow_up.vet_name == record.vet_name
        assert follow_up.reminder_days_before == record.reminder_days_before


class TestScheduleDaySelection:
    """`materialise_feeding_events` needs a DB, but its day filter is pure."""

    @pytest.mark.parametrize(
        ("day", "iso_weekday"),
        [
            (date(2026, 1, 12), 1),  # Monday
            (date(2026, 1, 17), 6),  # Saturday
            (date(2026, 1, 18), 7),  # Sunday
        ],
    )
    def test_iso_weekday_matches_the_schema_convention(
        self, day: date, iso_weekday: int
    ) -> None:
        # days_of_week stores 1=Monday…7=Sunday, matching date.isoweekday().
        assert day.isoweekday() == iso_weekday
