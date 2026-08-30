"""Plan entitlements.

Billing is not live yet: every account — free or pro — gets unlimited access.
The limits live here so switching a number on the free tier later is a one-line
change and every call site already asks the right question.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import Plan

UNLIMITED = None


@dataclass(frozen=True, slots=True)
class PlanLimits:
    max_cats: int | None
    max_schedules_per_cat: int | None
    push_notifications: bool


# TODO(billing): tighten the free tier when subscriptions launch.
PLAN_LIMITS: dict[Plan, PlanLimits] = {
    Plan.FREE: PlanLimits(
        max_cats=UNLIMITED, max_schedules_per_cat=UNLIMITED, push_notifications=True
    ),
    Plan.PRO: PlanLimits(
        max_cats=UNLIMITED, max_schedules_per_cat=UNLIMITED, push_notifications=True
    ),
}


def limits_for(plan: Plan) -> PlanLimits:
    return PLAN_LIMITS[plan]


def within_limit(plan: Plan, limit_name: str, current_count: int) -> bool:
    """True when one more of `limit_name` is allowed under `plan`."""
    limit = getattr(limits_for(plan), limit_name)
    return limit is None or current_count < limit
