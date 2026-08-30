"""Authentication use-cases: signup, login, refresh rotation, revocation."""

from __future__ import annotations

from datetime import UTC, datetime

from beanie import PydanticObjectId
from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.core import security
from app.models import RefreshToken, User, default_preferences
from app.schemas.auth import SignupRequest, TokenPair

INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect email or password",
    headers={"WWW-Authenticate": "Bearer"},
)


def normalise_email(email: str) -> str:
    return email.strip().lower()


def _now() -> datetime:
    return datetime.now(UTC)


async def get_user_by_email(email: str) -> User | None:
    return await User.find_one(User.email == normalise_email(email))


async def create_user(payload: SignupRequest) -> User:
    """Create the account, seeded with the default notification preferences.

    Preferences are embedded in the user document, so this is a single atomic
    insert — no transaction, and no half-created account if the process dies
    mid-signup (which the two-table Postgres version needed care to avoid).
    """
    user = User(
        email=normalise_email(payload.email),
        phone=payload.phone,
        hashed_password=security.hash_password(payload.password),
        full_name=payload.full_name,
        timezone=payload.timezone,
        notification_preferences=default_preferences(),
    )
    if payload.digest_time is not None:
        user.digest_time = payload.digest_time

    try:
        await user.insert()
    except DuplicateKeyError as exc:
        raise _signup_conflict(exc) from exc
    return user


def _signup_conflict(exc: DuplicateKeyError) -> HTTPException:
    # The driver reports which unique index rejected the write.
    details = str(getattr(exc, "details", "") or exc)
    field = "phone number" if "phone" in details else "email address"
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"An account with that {field} already exists",
    )


async def authenticate(email: str, password: str) -> User:
    user = await get_user_by_email(email)
    if user is None:
        # Hash anyway so a missing account and a wrong password take the same
        # time — otherwise the endpoint becomes an account-existence oracle.
        security.hash_password(password)
        raise INVALID_CREDENTIALS
    if not security.verify_password(password, user.hashed_password):
        raise INVALID_CREDENTIALS
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled"
        )
    if security.needs_rehash(user.hashed_password):
        user.hashed_password = security.hash_password(password)
    user.last_login_at = _now()
    await user.save()
    return user


async def issue_token_pair(user: User, *, user_agent: str | None = None) -> TokenPair:
    access_token, expires_at = security.create_access_token(user.id)
    raw_refresh, token_hash, refresh_expires_at = security.create_refresh_token()
    await RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=refresh_expires_at,
        user_agent=(user_agent or "")[:255] or None,
    ).insert()
    return TokenPair(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_at=expires_at,
    )


async def rotate_refresh_token(
    raw_token: str, *, user_agent: str | None = None
) -> tuple[User, TokenPair]:
    """Single-use refresh: the presented token is revoked as a new pair is issued."""
    token_hash = security.hash_refresh_token(raw_token)
    now = _now()

    # Revoke and read in one atomic step, so two requests racing with the same
    # refresh token cannot both be issued a new pair.
    stored = await RefreshToken.find_one(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked_at == None,  # noqa: E711 - Beanie builds the query from this
        RefreshToken.expires_at > now,
    )
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    result = await RefreshToken.get_motor_collection().update_one(
        {"_id": stored.id, "revoked_at": None},
        {"$set": {"revoked_at": now, "updated_at": now}},
    )
    if result.modified_count != 1:
        # Another request revoked it between the read and the write.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    user = await User.get(stored.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is unavailable"
        )

    pair = await issue_token_pair(user, user_agent=user_agent)
    return user, pair


async def revoke_refresh_token(user: User, raw_token: str) -> None:
    await RefreshToken.get_motor_collection().update_one(
        {
            "user_id": user.id,
            "token_hash": security.hash_refresh_token(raw_token),
            "revoked_at": None,
        },
        {"$set": {"revoked_at": _now(), "updated_at": _now()}},
    )


async def revoke_all_refresh_tokens(user_id: PydanticObjectId) -> int:
    result = await RefreshToken.get_motor_collection().update_many(
        {"user_id": user_id, "revoked_at": None},
        {"$set": {"revoked_at": _now(), "updated_at": _now()}},
    )
    return result.modified_count


async def change_password(user: User, current_password: str, new_password: str) -> None:
    if not security.verify_password(current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    user.hashed_password = security.hash_password(new_password)
    await user.save()
    # Every other device is signed out; the caller gets a fresh pair.
    await revoke_all_refresh_tokens(user.id)
