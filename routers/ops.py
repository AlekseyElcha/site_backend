from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select

from database.database import SessionDep, engine
from schemas.schemas import UserModel, UserUpdateSchema, UserSchema
from schemas.schemas import Base
from authorization.auth import admin_required, security


router = APIRouter(prefix="/ops")

@router.post("/setup", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def setup_database():
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    except:
        raise HTTPException(status_code=500, detail="Ошибка при сбросе базы данных")


@router.get("/all_users", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def get_all_users(session: SessionDep):
    query = select(UserModel)
    result = await session.execute(query)
    users = result.scalars().all()
    return {
        "users": users,
        "message": "Список всех пользователей."
    }


# @router.post("/add_user")
# async def add_user_to_database(session: SessionDep, user: UserSchema):
#     new_user = UserModel(
#         first_name=user.first_name,
#         last_name=user.last_name,
#         patronymic=user.patronymic,
#         login=user.login,
#         is_admin=user.is_admin,
#         password=user.password,
#         address=user.address,
#         flat=user.flat
#     )
#     session.add(new_user)
#     await session.commit()
#     return new_user

@router.patch("/edit_user/{user_id}", dependencies=[Depends(security.access_token_required)])
async def edit_user(
        user_id: int,
        data: UserUpdateSchema,
        session: SessionDep
    ):
    query = select(UserModel).where(UserModel.id == user_id)
    result = await session.execute(query)
    user_to_edit = result.scalar_one_or_none()

    if user_to_edit is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(user_to_edit, field, value)

    await session.commit()
    await session.refresh(user_to_edit)
    return {
        "success": True,
        "message": "Данные пользователя обновлены"
    }