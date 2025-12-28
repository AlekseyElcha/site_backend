from pydantic import BaseModel, Field
from typing import Optional

class UserUpdateSchema(BaseModel):
    login: Optional[str] = Field(default=None)
    password: Optional[str] = Field(default=None)
    first_name: Optional[str] = Field(default=None)
    last_name: Optional[str] = Field(default=None)
    patronymic: Optional[str] = Field(default=None)
    address: Optional[str] = Field(default=None)
    flat: Optional[int] = Field(default=None)
    is_admin: Optional[bool] = Field(default=False)