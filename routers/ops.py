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
@router.get("/user_info/{user_id}", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def get_user_info(
        user_id: int,
        session: SessionDep
    ):
    query = select(UserModel).where(UserModel.id == user_id)
    result = await session.execute(query)
    user_data = result.scalar_one_or_none()
    if user_data is None:
        raise HTTPException(status_code=404, detail="Ошибка при извлечении данных из базы")
    return user_data


@router.get("/user_info_by_login/{login}", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def get_user_info_by_login(
        login: str,
        session: SessionDep
    ):
    """Get user information by login"""
    from sqlalchemy import select, func
    from schemas.schemas import MessageModel
    
    # Get user data
    query = select(UserModel).where(UserModel.login == login)
    result = await session.execute(query)
    user_data = result.scalar_one_or_none()
    
    if user_data is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    
    # Get message statistics
    sent_messages_query = select(func.count(MessageModel.id)).where(MessageModel.sender_id == login)
    sent_result = await session.execute(sent_messages_query)
    sent_messages = sent_result.scalar() or 0
    
    received_messages_query = select(func.count(MessageModel.id)).where(MessageModel.recipient_id == login)
    received_result = await session.execute(received_messages_query)
    received_messages = received_result.scalar() or 0
    
    unread_messages_query = select(func.count(MessageModel.id)).where(
        MessageModel.recipient_id == login,
        MessageModel.is_read == False
    )
    unread_result = await session.execute(unread_messages_query)
    unread_messages = unread_result.scalar() or 0
    
    # Get last activity (last message timestamp)
    last_activity_query = select(MessageModel.timestamp).where(
        (MessageModel.sender_id == login) | (MessageModel.recipient_id == login)
    ).order_by(MessageModel.timestamp.desc()).limit(1)
    last_activity_result = await session.execute(last_activity_query)
    last_activity = last_activity_result.scalar_one_or_none()
    
    # Prepare response
    user_info = {
        "id": user_data.id,
        "login": user_data.login,
        "first_name": user_data.first_name,
        "last_name": user_data.last_name,
        "patronymic": user_data.patronymic,
        "address": user_data.address,
        "flat": user_data.flat,
        "is_admin": user_data.is_admin,
        "total_messages": sent_messages + received_messages,
        "sent_messages": sent_messages,
        "received_messages": received_messages,
        "unread_messages": unread_messages,
        "last_activity": last_activity.isoformat() if last_activity else None
    }
    
    return user_info


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


@router.post("/archive_conversation/{user_login}", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def archive_conversation(
        user_login: str,
        session: SessionDep
    ):
    """Archive all messages in conversation with a user"""
    from sqlalchemy import update, or_
    from schemas.schemas import MessageModel
    
    # Get current admin info from token
    current_user = Depends(security.access_token_required)
    
    try:
        # Update all messages between admin and user to archived
        update_query = update(MessageModel).where(
            or_(
                (MessageModel.sender_id == user_login),
                (MessageModel.recipient_id == user_login)
            )
        ).values(is_archived=True)
        
        result = await session.execute(update_query)
        await session.commit()
        
        archived_count = result.rowcount
        
        return {
            "success": True,
            "message": f"Беседа с пользователем {user_login} архивирована",
            "archived_messages": archived_count
        }
        
    except Exception as e:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка архивирования беседы: {str(e)}")


@router.get("/archived_conversations", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def get_archived_conversations(session: SessionDep):
    """Get list of users with archived conversations"""
    from sqlalchemy import select, func, distinct
    from schemas.schemas import MessageModel, UserModel
    
    try:
        # Get users who have archived messages
        query = select(
            distinct(MessageModel.sender_id).label('user_login')
        ).where(
            MessageModel.is_archived == True
        ).union(
            select(
                distinct(MessageModel.recipient_id).label('user_login')
            ).where(
                MessageModel.is_archived == True
            )
        )
        
        result = await session.execute(query)
        archived_user_logins = [row[0] for row in result.fetchall()]
        
        # Get user details for archived conversations
        archived_users = []
        for login in archived_user_logins:
            user_query = select(UserModel).where(UserModel.login == login)
            user_result = await session.execute(user_query)
            user = user_result.scalar_one_or_none()
            
            if user and not user.is_admin:  # Exclude admins
                archived_users.append({
                    "user_id": user.login,
                    "name": f"{user.first_name} {user.last_name}",
                    "is_archived": True
                })
        
        return {
            "archived_users": archived_users,
            "count": len(archived_users)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения архивированных бесед: {str(e)}")


@router.post("/unarchive_conversation/{user_login}", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def unarchive_conversation(
        user_login: str,
        session: SessionDep
    ):
    """Unarchive all messages in conversation with a user"""
    from sqlalchemy import update, or_
    from schemas.schemas import MessageModel
    
    try:
        # Update all messages between admin and user to not archived
        update_query = update(MessageModel).where(
            or_(
                (MessageModel.sender_id == user_login),
                (MessageModel.recipient_id == user_login)
            )
        ).values(is_archived=False)
        
        result = await session.execute(update_query)
        await session.commit()
        
        unarchived_count = result.rowcount
        
        return {
            "success": True,
            "message": f"Беседа с пользователем {user_login} разархивирована",
            "unarchived_messages": unarchived_count
        }
        
    except Exception as e:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка разархивирования беседы: {str(e)}")


@router.post("/clear_user_cache", dependencies=[Depends(security.access_token_required), Depends(admin_required)])
async def clear_user_cache():
    """Clear invalid users from connection manager cache"""
    from websocket.connection_manager import manager
    
    try:
        manager.clear_invalid_users()
        return {
            "success": True,
            "message": "Кэш пользователей очищен"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка очистки кэша: {str(e)}")