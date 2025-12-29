import os
from fastapi import APIRouter, Response, HTTPException, Depends, Form
from authx import AuthX, AuthXConfig
from dotenv import load_dotenv
from sqlalchemy import select
import jwt
from typing import Optional, Dict, Any

from schemas.schemas import UserModel, UserAddSchema, LoginSchema
from database.database import SessionDep



router = APIRouter(prefix="/auth")

load_dotenv()
config = AuthXConfig()
config.JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
config.JWT_TOKEN_LOCATION = ["cookies", "headers"]
config.JWT_ALGORITHM = "HS256"
config.JWT_COOKIE_CSRF_PROTECT = False
security = AuthX(config=config)

def verify_jwt_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify and decode JWT token manually
    """
    try:
        # Decode the token using the same secret and algorithm
        payload = jwt.decode(
            token, 
            os.getenv("JWT_SECRET_KEY"), 
            algorithms=["HS256"]
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

@router.post("/login")
async def login(login: str = Form(), password: str = Form(), response: Response = None, session: SessionDep = None):
    query = select(UserModel).where(UserModel.login == login).where(UserModel.password == password)
    result = await session.execute(query)
    data = result.scalar_one_or_none()
    if data:
        is_admin = int(data.is_admin)
        is_adm = 1 if is_admin else 0
        user_data = {
            "login": data.login,
            "is_admin": is_adm
        }
        token = security.create_access_token(uid=login, data=user_data)
        security.set_access_cookies(token, response)
        
        # Return complete user data for frontend
        return {
            "success": True,
            "access_token": token,
            "user": {
                "id": data.id,
                "login": data.login,
                "first_name": data.first_name,
                "last_name": data.last_name,
                "patronymic": data.patronymic,
                "address": data.address,
                "flat": data.flat,
                "is_admin": bool(data.is_admin)
            }
        }

    raise HTTPException(status_code=404, detail="Неверный логин или пароль")


@router.post("/login_json")
async def login_json(login_data: LoginSchema, response: Response = None, session: SessionDep = None):
    """Login endpoint with email validation using Pydantic schema"""
    query = select(UserModel).where(UserModel.login == login_data.login).where(UserModel.password == login_data.password)
    result = await session.execute(query)
    data = result.scalar_one_or_none()
    if data:
        is_admin = int(data.is_admin)
        is_adm = 1 if is_admin else 0
        user_data = {
            "login": data.login,
            "is_admin": is_adm
        }
        token = security.create_access_token(uid=login_data.login, data=user_data)
        security.set_access_cookies(token, response)
        
        # Return complete user data for frontend
        return {
            "success": True,
            "access_token": token,
            "user": {
                "id": data.id,
                "login": data.login,
                "first_name": data.first_name,
                "last_name": data.last_name,
                "patronymic": data.patronymic,
                "address": data.address,
                "flat": data.flat,
                "is_admin": bool(data.is_admin)
            }
        }

    raise HTTPException(status_code=404, detail="Неверный логин или пароль")


async def admin_required(user = Depends(security.access_token_required)):
    try:
        is_admin = user.get("is_admin")
    except AttributeError:
        is_admin = getattr(user, 'is_admin', False)
    if not is_admin:
        raise HTTPException(status_code=403, detail="Требуются права администратора")
    return user


# @router.post("/")
# async def create_account(user_data: UserSchema, session: SessionDep):
#     try:
#         data = UserModel(**user_data.model_dump(exclude={"id"}))
#         session.add(data)
#         await session.commit()
#         await session.refresh(data)
#     except Exception as e:
#         await session.rollback()
#         raise HTTPException(status_code=500, detail="Ошибка при создании аккаунта")

@router.post("/create_account")
async def create_account(user: UserAddSchema, session: SessionDep):
    try:
        new_user = UserModel(
            first_name=user.first_name,
            last_name=user.last_name,
            patronymic=user.patronymic,
            login=user.login,
            is_admin=user.is_admin,
            password=user.password,
            address=user.address,
            flat=user.flat
        )
        session.add(new_user)
        await session.commit()
        await session.refresh(new_user)
    except Exception as e:
        await session.rollback()
        raise HTTPException(status_code=500, detail="Ошибка при создании аккаунта")
    return {
        "new_user": {
            "id": new_user.id,
            "first_name": new_user.first_name,
            "last_name": new_user.last_name,
            "patronymic": new_user.patronymic,
            "login": new_user.login,
            "is_admin": new_user.is_admin,
            "address": new_user.address,
            "flat": new_user.flat
        },
        "message": "Аккаунт успешно создан!"
    }
