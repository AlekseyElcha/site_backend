from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class UserModel(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    first_name: Mapped[str]
    last_name: Mapped[str]
    patronymic: Mapped[str]
    login: Mapped[str] = mapped_column(unique=True)
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

class UserAddSchema(BaseModel):
    first_name: str
    last_name: str
    patronymic: str
    login: str
    password: str
    address: str
    flat: int
    is_admin: bool


class UserUpdateSchema(BaseModel):
    login: Optional[str] = Field(default=None)
    password: Optional[str] = Field(default=None)
    first_name: Optional[str] = Field(default=None)
    last_name: Optional[str] = Field(default=None)
    patronymic: Optional[str] = Field(default=None)
    address: Optional[str] = Field(default=None)
    flat: Optional[int] = Field(default=None)
    is_admin: Optional[bool] = Field(default=False)