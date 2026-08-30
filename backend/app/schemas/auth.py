from __future__ import annotations

from datetime import datetime, time

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import (
    PASSWORD_MIN_LENGTH,
    UserRead,
    normalise_phone,
    validate_password_strength,
    validate_timezone,
)


class SignupRequest(BaseModel):
    email: EmailStr
    phone: str = Field(description="International E.164 format, e.g. +14155552671")
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    timezone: str = Field(default="UTC", max_length=64)
    digest_time: time | None = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str) -> str:
        return normalise_phone(value)

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return validate_password_strength(value)

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, value: str) -> str:
        return validate_timezone(value)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = Field(
        default=None,
        description="Omit to revoke every session for the account.",
    )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return validate_password_strength(value)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime


class AuthResponse(TokenPair):
    user: UserRead
