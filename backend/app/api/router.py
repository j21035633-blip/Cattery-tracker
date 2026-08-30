from fastapi import APIRouter

from app.api.routes import (
    auth,
    cats,
    cleaning,
    feeding,
    notifications,
    users,
    vet,
    weight,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(cats.router)
api_router.include_router(feeding.router)
api_router.include_router(cleaning.router)
api_router.include_router(vet.router)
api_router.include_router(weight.router)
api_router.include_router(notifications.router)
