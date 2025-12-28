from fastapi.params import Depends
from fastapi import APIRouter
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker, AsyncSession
from typing import Annotated



router = APIRouter()

engine = create_async_engine("sqlite+aiosqlite:///database.db")

new_async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_session():
    async with new_async_session() as session:
        yield session

SessionDep = Annotated[AsyncSession, Depends(get_session)]
