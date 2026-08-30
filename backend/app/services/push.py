"""Expo push delivery.

Talks to the Expo push service, which is what an EAS-built app receives
notifications through. No Expo credentials are needed for sending: the device's
`ExponentPushToken[...]` is the address. `EXPO_ACCESS_TOKEN` is optional and only
required if the project has "enhanced push security" switched on.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo accepts at most 100 messages per request.
MAX_BATCH = 100

# Expo's per-receipt errors that mean "stop sending to this token".
DEAD_TOKEN_ERRORS = {"DeviceNotRegistered"}


@dataclass(slots=True)
class PushResult:
    sent: int
    failed: int
    dead_tokens: list[str]
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.failed == 0


def build_message(
    token: str, *, title: str, body: str, data: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "to": token,
        "title": title,
        "body": body,
        "sound": "default",
        # Lets the app badge the notification centre without a round trip.
        "data": data or {},
        "channelId": "default",
    }


async def send_push(
    tokens: list[str], *, title: str, body: str, data: dict[str, Any] | None = None
) -> PushResult:
    """Send one notification to many devices.

    Never raises: push is best-effort, and a delivery failure must not roll back
    the in-app notification that was already recorded.
    """
    if not tokens:
        return PushResult(sent=0, failed=0, dead_tokens=[])

    settings = get_settings()
    headers = {"accept": "application/json", "content-type": "application/json"}
    if settings.expo_access_token:
        headers["authorization"] = f"Bearer {settings.expo_access_token}"

    sent = 0
    failed = 0
    dead: list[str] = []

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for start in range(0, len(tokens), MAX_BATCH):
                batch = tokens[start : start + MAX_BATCH]
                messages = [
                    build_message(token, title=title, body=body, data=data)
                    for token in batch
                ]
                response = await client.post(EXPO_PUSH_URL, json=messages, headers=headers)
                response.raise_for_status()
                receipts = response.json().get("data", [])

                for token, receipt in zip(batch, receipts, strict=False):
                    if receipt.get("status") == "ok":
                        sent += 1
                        continue
                    failed += 1
                    error = (receipt.get("details") or {}).get("error")
                    if error in DEAD_TOKEN_ERRORS:
                        dead.append(token)
                    logger.warning("expo push rejected: %s", receipt.get("message"))
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("expo push request failed: %s", exc)
        return PushResult(
            sent=sent, failed=len(tokens) - sent, dead_tokens=dead, error=str(exc)
        )

    return PushResult(sent=sent, failed=failed, dead_tokens=dead)
