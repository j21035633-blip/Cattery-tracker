"""Shared FastAPI dependencies.

`CurrentUser` is the only sanctioned source of a tenant id for queries — never
read a `user_id` from the request body or path.

There is no database-session dependency any more: Beanie holds the client in
module state after `init_db`, so documents are queried directly.
"""

# No `from __future__ import annotations` here on purpose: PEP 563 turns the
# nested `Annotated[int, Query(...)]` inside `Pagination.__init__` into a string
# that FastAPI cannot resolve, and every list endpoint 500s at request time.

from typing import Annotated

from beanie import PydanticObjectId
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import TokenError, decode_access_token
from app.models import User

bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ] = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise _CREDENTIALS_ERROR
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = PydanticObjectId(payload["sub"])
    except (TokenError, KeyError, ValueError, TypeError) as exc:
        raise _CREDENTIALS_ERROR from exc

    user = await User.get(user_id)
    if user is None:
        raise _CREDENTIALS_ERROR
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled"
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


class Pagination:
    """`?limit=&offset=` for every list endpoint."""

    def __init__(
        self,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> None:
        self.limit = limit
        self.offset = offset


PageParams = Annotated[Pagination, Depends(Pagination)]
