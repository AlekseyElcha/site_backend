from fastapi import FastAPI, HTTPException
from sqlalchemy import select
from pydantic import BaseModel


from database.database import SessionDep, UserModel, UserSchema, engine, Base
from schemas.schemas import UserUpdateSchema

app = FastAPI()

@app.post("/setup")
async def setup_database():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


@app.get("/all_users")
async def get_all_users(session: SessionDep):
    query = select(UserModel)
    result = await session.execute(query)
    users = result.scalars().all()
    return users


@app.post("/add_user")
async def add_user_to_database(session: SessionDep, user: UserSchema):
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
    return new_user

@app.patch("/edit_user/{user_id}")
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

