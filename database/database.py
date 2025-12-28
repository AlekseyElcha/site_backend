from fastapi.params import Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from typing import Annotated

engine = create_async_engine("sqlite+aiosqlite:///database.db")

new_async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_session():
    async with new_async_session() as session:
        yield session

SessionDep = Annotated[AsyncSession, Depends(get_session)]

class Base(DeclarativeBase):
    pass

class UserModel(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str]
    last_name: Mapped[str]
    patronymic: Mapped[str]
    login: Mapped[str]
    password: Mapped[str]
    address: Mapped[str]
    flat: Mapped[int]
    is_admin: Mapped[bool]

class UserSchema(BaseModel):
    id: int
    first_name: str
    last_name: str
    patronymic: str
    login: str
    password: str
    address: str
    flat: int
    is_admin: bool

