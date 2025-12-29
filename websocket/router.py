from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException, Depends
from fastapi.websockets import WebSocketState
from typing import Optional
import json
import logging
from datetime import datetime

from websocket.connection_manager import manager
from websocket.message_manager import message_manager
from database.database import SessionDep, get_session
from authorization.auth import security, verify_jwt_token
from schemas.schemas import UserModel
from sqlalchemy import select
from utils.timezone import get_moscow_time_iso

logger = logging.getLogger(__name__)

router = APIRouter()

async def get_websocket_user(token: str, session: SessionDep) -> Optional[dict]:
    try:
        payload = verify_jwt_token(token)
        if not payload:
            return None
        
        user_id = payload.get("sub")
        if not user_id:
            return None

        query = select(UserModel).where(UserModel.login == user_id)
        result = await session.execute(query)
        user = result.scalar_one_or_none()
        
        if not user:
            return None
        
        return {
            "login": user.login,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "patronymic": user.patronymic,
            "is_admin": user.is_admin,
            "id": user.id
        }
        
    except Exception as e:
        logger.error(f"WebSocket authentication error: {e}")
        return None

@router.websocket("/ws/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: str,
    token: str = Query(..., description="JWT authentication token")
):

    session_gen = get_session()
    session = await session_gen.__anext__()
    
    try:
        user_data = await get_websocket_user(token, session)
        if not user_data or user_data["login"] != user_id:
            await websocket.close(code=4001, reason="Authentication failed")
            return
        await manager.connect(user_id, websocket, user_data)

        welcome_message = {
            "type": "welcome",
            "message": f"Welcome, {user_data['first_name']}!",
            "user_data": {
                "login": user_data["login"],
                "name": f"{user_data['first_name']} {user_data['last_name']}",
                "is_admin": user_data["is_admin"]
            },
            "timestamp": get_moscow_time_iso()
        }
        await websocket.send_text(json.dumps(welcome_message))
        
        # Send unread messages to user (both regular users and admins)
        try:
            unread_messages = await message_manager.get_unread_messages(session, user_id)
            if unread_messages:
                logger.info(f"Sending {len(unread_messages)} unread messages to {user_id}")
                
                for message in unread_messages:
                    # Get sender name from database if not in memory
                    sender_name = manager._get_user_display_name(message.sender_id)
                    if sender_name == message.sender_id:  # If no display name found in memory
                        # Try to get from database
                        try:
                            from sqlalchemy import select
                            from schemas.schemas import UserModel
                            
                            user_query = select(UserModel).where(UserModel.login == message.sender_id)
                            user_result = await session.execute(user_query)
                            user_db = user_result.scalar_one_or_none()
                            
                            if user_db:
                                sender_name = f"{user_db.first_name} {user_db.last_name}"
                            
                        except Exception as db_error:
                            logger.warning(f"Could not get sender name from DB: {db_error}")
                            sender_name = message.sender_id
                    
                    offline_message = {
                        "type": "offline_message",
                        "from": message.sender_id,
                        "from_name": sender_name,
                        "message": message.content,
                        "timestamp": message.timestamp.isoformat(),
                        "message_type": message.message_type,
                        "message_id": message.id
                    }
                    
                    await websocket.send_text(json.dumps(offline_message))
                
                # Mark all messages as read after sending (more efficient)
                unique_senders = set(msg.sender_id for msg in unread_messages)
                for sender_id in unique_senders:
                    await message_manager.mark_messages_as_read(session, user_id, sender_id)
                
                # Send summary
                summary_message = {
                    "type": "offline_messages_summary",
                    "count": len(unread_messages),
                    "message": f"Вы получили {len(unread_messages)} сообщений, пока были оффлайн",
                    "timestamp": get_moscow_time_iso()
                }
                await websocket.send_text(json.dumps(summary_message))
                
        except Exception as e:
            logger.error(f"Error sending unread messages to {user_id}: {e}")
            import traceback
            traceback.print_exc()
        
        # If admin, send connected users list
        if user_data["is_admin"]:
            print(f"[DEBUG] Admin {user_id} connected, getting all users...")
            # Send all users (including disconnected ones)
            all_users = manager.get_all_users(exclude_admins=True)
            print(f"[DEBUG] Found {len(all_users)} users to send to admin")
            for user in all_users:
                print(f"[DEBUG] User: {user}")
            
            users_message = {
                "type": "connected_users",
                "users": all_users,
                "timestamp": get_moscow_time_iso()
            }
            print(f"[DEBUG] Sending message: {users_message}")
            await websocket.send_text(json.dumps(users_message))
        
        # Main message loop
        while True:
            try:
                data = await websocket.receive_text()
                await handle_websocket_message(websocket, user_id, user_data, data, session)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"Error handling message from {user_id}: {e}")
                error_message = {
                    "type": "error",
                    "message": "Failed to process message",
                    "timestamp": get_moscow_time_iso()
                }
                try:
                    await websocket.send_text(json.dumps(error_message))
                except:
                    break
    
    except Exception as e:
        logger.error(f"WebSocket connection error for {user_id}: {e}")
    
    finally:
        # Cleanup
        manager.disconnect(user_id)
        try:
            await session.close()
        except:
            pass

async def handle_websocket_message(
    websocket: WebSocket,
    user_id: str,
    user_data: dict,
    data: str,
    session: SessionDep
):
    """Handle incoming WebSocket messages"""
    
    try:
        message_data = json.loads(data)
        message_type = message_data.get("type", "message")
        
        if message_type == "user_to_admin":
            await handle_user_to_admin_message(user_id, user_data, message_data, session)
            
        elif message_type == "admin_to_user":
            await handle_admin_to_user_message(user_id, user_data, message_data, session)
            
        elif message_type == "get_conversation_history":
            await handle_get_conversation_history(websocket, user_id, user_data, message_data, session)
            
        elif message_type == "get_conversations":
            await handle_get_conversations(websocket, user_id, user_data, session)
            
        elif message_type == "mark_as_read":
            await handle_mark_as_read(user_id, message_data, session)
            
        elif message_type == "get_connected_users":
            await handle_get_connected_users(websocket, user_id, user_data)
            
        elif message_type == "broadcast":
            await handle_broadcast_message(user_id, user_data, message_data, session)
            
        elif message_type == "ping":
            # Heartbeat/ping response
            pong_message = {
                "type": "pong",
                "timestamp": get_moscow_time_iso()
            }
            await websocket.send_text(json.dumps(pong_message))
            
        else:
            # Handle simple text messages (backward compatibility)
            if user_data["is_admin"]:
                # Admin sending to all users
                await manager.broadcast(data, user_id, exclude_admins=True)
            else:
                # User sending to admin
                await manager.send_to_admin(data, user_id, session)
                # Message is now saved inside send_to_admin if needed
    
    except json.JSONDecodeError:
        # Handle non-JSON messages
        if user_data["is_admin"]:
            await manager.broadcast(data, user_id, exclude_admins=True)
        else:
            await manager.send_to_admin(data, user_id, session)
            # Message is now saved inside send_to_admin if needed
    
    except Exception as e:
        logger.error(f"Error handling message type {message_type}: {e}")
        raise

async def handle_user_to_admin_message(
    user_id: str,
    user_data: dict,
    message_data: dict,
    session: SessionDep
):
    """Handle user to admin message"""
    message = message_data.get("message", "")
    if not message:
        return
    
    # Send to all connected admins
    await manager.send_to_admin(message, user_id, session)
    
    # Message is now saved inside send_to_admin if needed

async def handle_admin_to_user_message(
    user_id: str,
    user_data: dict,
    message_data: dict,
    session: SessionDep
):
    """Handle admin to user message"""
    if not user_data["is_admin"]:
        return
    
    target_user = message_data.get("to_user", "")
    message = message_data.get("message", "")
    
    if not target_user or not message:
        return
    
    # Send to target user
    success = await manager.send_to_user(message, target_user, user_id, session)
    
    # Message is now saved inside send_to_user if needed

async def handle_get_conversation_history(
    websocket: WebSocket,
    user_id: str,
    user_data: dict,
    message_data: dict,
    session: SessionDep
):
    """Handle request for conversation history"""
    with_user = message_data.get("with_user", "")
    limit = message_data.get("limit", 50)
    offset = message_data.get("offset", 0)
    
    if not with_user:
        return
    
    # Check permissions
    if not user_data["is_admin"] and with_user != "admin":
        return
    
    # For admins, always include archived messages to show full context
    include_archived = user_data.get("is_admin", False)
    
    messages = await message_manager.get_conversation_history(
        session, user_id, with_user, limit, offset, include_archived
    )
    
    # Convert messages to JSON-serializable format
    serialized_messages = []
    for msg in messages:
        msg_dict = msg.dict()
        # Convert datetime to ISO string
        if isinstance(msg_dict.get('timestamp'), datetime):
            msg_dict['timestamp'] = msg_dict['timestamp'].isoformat()
        serialized_messages.append(msg_dict)
    
    response = {
        "type": "conversation_history",
        "with_user": with_user,
        "messages": serialized_messages,
        "timestamp": get_moscow_time_iso()
    }
    
    await websocket.send_text(json.dumps(response))

async def handle_get_conversations(
    websocket: WebSocket,
    user_id: str,
    user_data: dict,
    session: SessionDep
):
    """Handle request for user's conversations list"""
    conversations = await message_manager.get_user_conversations(
        session, user_id, user_data["is_admin"]
    )
    
    # Convert conversations to JSON-serializable format
    serialized_conversations = []
    for conv in conversations:
        conv_dict = conv.dict()
        # Convert datetime to ISO string
        if isinstance(conv_dict.get('last_message_time'), datetime):
            conv_dict['last_message_time'] = conv_dict['last_message_time'].isoformat()
        serialized_conversations.append(conv_dict)
    
    response = {
        "type": "conversations_list",
        "conversations": serialized_conversations,
        "timestamp": get_moscow_time_iso()
    }
    
    await websocket.send_text(json.dumps(response))

async def handle_mark_as_read(
    user_id: str,
    message_data: dict,
    session: SessionDep
):
    """Handle mark messages as read"""
    sender_id = message_data.get("sender_id", "")
    if not sender_id:
        return
    
    await message_manager.mark_messages_as_read(session, user_id, sender_id)

async def handle_get_connected_users(
    websocket: WebSocket,
    user_id: str,
    user_data: dict
):
    """Handle request for connected users list (admin only)"""
    if not user_data["is_admin"]:
        return
    
    # Send all users (including disconnected ones)
    users = manager.get_all_users(exclude_admins=True)
    response = {
        "type": "connected_users",
        "users": users,
        "timestamp": get_moscow_time_iso()
    }
    
    await websocket.send_text(json.dumps(response))

async def handle_broadcast_message(
    user_id: str,
    user_data: dict,
    message_data: dict,
    session: SessionDep
):
    """Handle broadcast message (admin only)"""
    if not user_data["is_admin"]:
        return
    
    message = message_data.get("message", "")
    if not message:
        return
    
    # Send broadcast
    sent_count = await manager.broadcast(message, user_id, exclude_admins=True)
    
    if sent_count > 0:
        # Save broadcast message to database (with special recipient "broadcast")
        await message_manager.save_message(
            session, user_id, "broadcast", message, "broadcast"
        )