"""Background jobs: the overdue sweep and the daily digest.

Run as its own process (see the `worker` line in the Procfile):

    python -m app.worker

Both jobs are idempotent and safe to run more often than needed — the digest is
deduped per account per local day by a unique partial index, and each overdue
item latches `overdue_alerted_at` once. That also makes them safe to re-run
after a crash, and safe to trigger manually while debugging.

Accounts are processed one at a time, and a failure on one is logged and
skipped, so one bad document cannot stop the sweep for everyone else.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from dataclasses import dataclass
from datetime import datetime

from beanie import PydanticObjectId

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.mongo import close_db, init_db
from app.models import User
from app.services import notifications as notification_service

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s"
)
logger = logging.getLogger("cattery.worker")


@dataclass(slots=True)
class SweepReport:
    accounts: int = 0
    alerts: int = 0
    digests: int = 0
    missed_marked: int = 0
    failures: int = 0

    def __str__(self) -> str:
        return (
            f"{self.accounts} accounts · {self.alerts} overdue alerts · "
            f"{self.digests} digests · {self.missed_marked} marked missed · "
            f"{self.failures} failures"
        )


async def _active_user_ids() -> list[PydanticObjectId]:
    users = await User.find(User.is_active == True).to_list()  # noqa: E712
    return [user.id for user in users]


async def run_for_user(user: User, *, now: datetime, report: SweepReport) -> None:
    report.missed_marked += await notification_service.mark_missed_feedings(user, now=now)
    alerts = await notification_service.send_overdue_alerts(user, now=now)
    report.alerts += len(alerts)

    digest = await notification_service.send_daily_digest(user, now=now)
    if digest is not None:
        report.digests += 1


async def run_sweep(now: datetime | None = None) -> SweepReport:
    """One pass over every active account."""
    now = now or utcnow()
    report = SweepReport()

    for user_id in await _active_user_ids():
        try:
            # Re-read per account: a sweep can take a while, and the account may
            # have changed its thresholds or been deleted since the listing.
            user = await User.get(user_id)
            if user is None:
                continue
            await run_for_user(user, now=now, report=report)
            report.accounts += 1
        except Exception:
            report.failures += 1
            logger.exception("sweep failed for user %s", user_id)

    logger.info("sweep complete: %s", report)
    return report


async def run_retention(keep_days: int) -> int:
    """Delete read notifications older than the retention window."""
    removed = 0
    for user_id in await _active_user_ids():
        user = await User.get(user_id)
        if user is None:
            continue
        removed += await notification_service.prune_old_notifications(
            user, keep_days=keep_days
        )
    return removed


async def main() -> None:
    settings = get_settings()
    interval = max(1, settings.overdue_sweep_interval_minutes) * 60
    stop = asyncio.Event()

    def _request_stop() -> None:
        logger.info("shutdown requested; finishing the current pass")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:  # pragma: no cover - Windows
            signal.signal(sig, lambda *_: _request_stop())

    await init_db()
    logger.info("worker started; sweeping every %s minutes", interval // 60)

    passes = 0
    try:
        while not stop.is_set():
            await run_sweep()
            passes += 1
            # Retention is cheap but pointless to run every 15 minutes.
            if passes % max(1, (24 * 60) // (interval // 60)) == 0:
                removed = await run_retention(settings.notification_retention_days)
                logger.info("retention pass removed %s notifications", removed)

            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except TimeoutError:
                continue
    finally:
        await close_db()
        logger.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
