import os
from fastapi import APIRouter, Response, HTTPException, Depends
from authx import AuthX, AuthXConfig
from dotenv import load_dotenv
from sqlalchemy import select

from schemas.schemas import UserModel, UserAddSchema
from database.database import SessionDep



router = APIRouter(prefix="/auth")

load_dotenv()
config = AuthXConfig()
config.JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
config.JWT_TOKEN_LOCATION = ["cookies"]
config.JWT_ALGORITHM = "HS256"
config.JWT_COOKIE_CSRF_PROTECT = False
security = AuthX(config=config)

@router.post("/login")
async def login(login: str, password: str, response: Response, session: SessionDep):
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
        return {
            "access_token": token,
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
async def create_account(session: SessionDep, user: UserAddSchema):
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
    except:
        raise HTTPException(status_code=500, detail="Ошибка при создании аккаунта")
    return {
        "new_user": new_user,
        "message": "Аккаунт успешно создан!"
    }
