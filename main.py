from fastapi import FastAPI

from routers import ops
from database import database
from authorization import auth

app = FastAPI(
    title="Site backend"
)

app.include_router(ops.router)
app.include_router(database.router)
app.include_router(auth.router)

app.get("/")
async def root():
    return {
        "message": "dev in progress"
    }