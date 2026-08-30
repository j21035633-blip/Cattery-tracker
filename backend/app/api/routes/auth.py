"""Signup / login / refresh / logout."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Request, status

from app.api.deps import CurrentUser
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SignupRequest,
    TokenPair,
)
from app.schemas.common import Message
from app.schemas.user import UserRead
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

UserAgent = Annotated[str | None, Header(alias="User-Agent")]


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and sign in",
    responses={409: {"model": Message, "description": "Email or phone already in use"}},
)
async def signup(payload: SignupRequest, user_agent: UserAgent = None) -> AuthResponse:
    user = await auth_service.create_user(payload)
    pair = await auth_service.issue_token_pair(user, user_agent=user_agent)
    return AuthResponse(**pair.model_dump(), user=UserRead.model_validate(user))


@router.post("/login", response_model=AuthResponse, summary="Sign in with email + password")
async def login(payload: LoginRequest, user_agent: UserAgent = None) -> AuthResponse:
    user = await auth_service.authenticate(payload.email, payload.password)
    pair = await auth_service.issue_token_pair(user, user_agent=user_agent)
    return AuthResponse(**pair.model_dump(), user=UserRead.model_validate(user))


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Exchange a refresh token for a new pair",
)
async def refresh(payload: RefreshRequest, user_agent: UserAgent = None) -> TokenPair:
    _, pair = await auth_service.rotate_refresh_token(
        payload.refresh_token, user_agent=user_agent
    )
    return pair


@router.post("/logout", response_model=Message, summary="Revoke one or all sessions")
async def logout(payload: LogoutRequest, current_user: CurrentUser) -> Message:
    if payload.refresh_token:
        await auth_service.revoke_refresh_token(current_user, payload.refresh_token)
        return Message(detail="Signed out on this device")
    await auth_service.revoke_all_refresh_tokens(current_user.id)
    return Message(detail="Signed out everywhere")


@router.post(
    "/change-password",
    response_model=AuthResponse,
    summary="Change password and re-issue tokens",
)
async def change_password(
    payload: ChangePasswordRequest, current_user: CurrentUser, request: Request
) -> AuthResponse:
    await auth_service.change_password(
        current_user, payload.current_password, payload.new_password
    )
    pair = await auth_service.issue_token_pair(
        current_user, user_agent=request.headers.get("user-agent")
    )
    return AuthResponse(**pair.model_dump(), user=UserRead.model_validate(current_user))


@router.get("/me", response_model=UserRead, summary="The signed-in account")
async def read_me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
