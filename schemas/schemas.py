from pydantic import BaseModel, Field, EmailStr, validator
from typing import Optional
from datetime import datetime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import ForeignKey

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


class LoginSchema(BaseModel):
    login: EmailStr
    password: str

class UserSchema(BaseModel):
    id: int
    first_name: str
    last_name: str
    patronymic: str
    login: EmailStr
    password: str
    address: str
    flat: int
    is_admin: bool

class UserAddSchema(BaseModel):
    first_name: str
    last_name: str
    patronymic: str
    login: EmailStr
    password: str
    address: str
    flat: int
    is_admin: bool


class UserUpdateSchema(BaseModel):
    login: Optional[EmailStr] = Field(default=UserModel.login)
    password: Optional[str] = Field(default=UserModel.password)
    first_name: Optional[str] = Field(default=UserModel.first_name)
    last_name: Optional[str] = Field(default=UserModel.last_name)
    patronymic: Optional[str] = Field(default=UserModel.patronymic)
    address: Optional[str] = Field(default=UserModel.address)
    flat: Optional[int] = Field(default=UserModel.flat)
    is_admin: Optional[bool] = Field(default=False)


# Chat Message Models
class MessageModel(Base):
    __tablename__ = "messages"
    
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.login"))
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.login"))
    content: Mapped[str]
    timestamp: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    is_read: Mapped[bool] = mapped_column(default=False)
    message_type: Mapped[str] = mapped_column(default="user_message")  # user_message, admin_message, broadcast
    is_archived: Mapped[bool] = mapped_column(default=False)  # For archiving conversations


class MessageSchema(BaseModel):
    id: int
    sender_id: str
    recipient_id: str
    content: str
    timestamp: datetime
    is_read: bool
    message_type: str
    is_archived: bool = False


class MessageCreateSchema(BaseModel):
    recipient_id: str
    content: str
    message_type: str = "user_message"


class ConversationSchema(BaseModel):
    participant_id: str
    participant_name: str
    last_message: str
    last_message_time: datetime
    unread_count: int