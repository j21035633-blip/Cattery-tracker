"""Account profile and notification preferences for the signed-in user."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import CurrentUser
from app.schemas.user import (
    NotificationPreferenceRead,
    NotificationPreferenceUpdate,
    UserRead,
    UserUpdate,
)
from app.services import cascade

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def read_me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)


@router.patch("/me", response_model=UserRead, summary="Update profile / digest settings")
async def update_me(payload: UserUpdate, current_user: CurrentUser) -> UserRead:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await current_user.save()
    return UserRead.model_validate(current_user)


@router.get(
    "/me/notification-preferences",
    response_model=list[NotificationPreferenceRead],
    summary="Per-task-type overdue thresholds",
)
async def list_notification_preferences(
    current_user: CurrentUser,
) -> list[NotificationPreferenceRead]:
    """Preferences are embedded in the account document, so this is not a query."""
    return [
        NotificationPreferenceRead.model_validate(preference)
        for preference in sorted(
            current_user.notification_preferences, key=lambda p: p.task_type.value
        )
    ]


@router.patch(
    "/me/notification-preferences",
    response_model=NotificationPreferenceRead,
    summary="Adjust the threshold or channels for one task type",
)
async def update_notification_preference(
    payload: NotificationPreferenceUpdate, current_user: CurrentUser
) -> NotificationPreferenceRead:
    preference = next(
        (
            item
            for item in current_user.notification_preferences
            if item.task_type == payload.task_type
        ),
        None,
    )
    if preference is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No preference for task type '{payload.task_type}'",
        )

    updates = payload.model_dump(exclude_unset=True, exclude={"task_type"})
    for field, value in updates.items():
        if value is not None:
            setattr(preference, field, value)

    # The list is a mutable field on the document; mark it changed so Beanie's
    # state tracking writes it back.
    current_user.notification_preferences = list(current_user.notification_preferences)
    await current_user.save()
    return NotificationPreferenceRead.model_validate(preference)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete the account and every document belonging to it",
)
async def delete_me(current_user: CurrentUser) -> Response:
    # MongoDB has no ON DELETE CASCADE; `cascade.delete_account` walks every
    # tenant collection, children first, so a partial failure can be retried.
    await cascade.delete_account(current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
