from typing import Dict, List
from fastapi import WebSocket
import json
from datetime import datetime
import logging

from utils.timezone import get_moscow_time_iso

logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages WebSocket connections for chat functionality"""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_info: Dict[str, dict] = {}  # Store user info for connected users
        self.all_users: Dict[str, dict] = {}  # Store info for all users who ever connected
    
    async def connect(self, user_id: str, websocket: WebSocket, user_data: dict = None):
        """Accept a WebSocket connection and store user information"""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        if user_data:
            self.user_info[user_id] = user_data
            # Also store in all_users for persistent history
            self.all_users[user_id] = user_data
        
        logger.info(f"User {user_id} connected. Total connections: {len(self.active_connections)}")
        
        # Notify admins about new user connection (if user is not admin)
        if user_data and not user_data.get('is_admin', False):
            await self._notify_admins_user_connected(user_id, user_data)
    
    def disconnect(self, user_id: str):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.user_info:
            del self.user_info[user_id]
        
        logger.info(f"User {user_id} disconnected. Total connections: {len(self.active_connections)}")
    
    async def send_personal_message(self, message: str, user_id: str):
        """Send a message to a specific user"""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_text(message)
                return True
            except Exception as e:
                logger.error(f"Failed to send message to {user_id}: {e}")
                # Remove disconnected user
                self.disconnect(user_id)
                return False
        return False
    
    async def send_to_admin(self, message: str, sender_id: str, session=None):
        """Send a message from user to all connected administrators"""
        admin_count = 0
        message_data = {
            "type": "user_message",
            "from": sender_id,
            "from_name": self._get_user_display_name(sender_id),
            "message": message,
            "timestamp": get_moscow_time_iso()
        }
        
        # Send to online admins
        for user_id, websocket in self.active_connections.items():
            user_data = self.user_info.get(user_id, {})
            if user_data.get('is_admin', False):
                try:
                    await websocket.send_text(json.dumps(message_data))
                    admin_count += 1
                except Exception as e:
                    logger.error(f"Failed to send message to admin {user_id}: {e}")
                    self.disconnect(user_id)
        
        # If no online admins and we have a session, save message for offline admins
        if admin_count == 0 and session:
            try:
                from websocket.message_manager import message_manager
                # Get all admin users
                from sqlalchemy import select
                from schemas.schemas import UserModel
                
                admin_query = select(UserModel.login).where(UserModel.is_admin == True)
                result = await session.execute(admin_query)
                admin_logins = [row[0] for row in result.fetchall()]
                
                # Save message for each admin
                for admin_login in admin_logins:
                    await message_manager.save_message(
                        session, sender_id, admin_login, message, "user_message"
                    )
                    logger.info(f"Saved offline message from {sender_id} to admin {admin_login}")
                
            except Exception as e:
                logger.error(f"Failed to save offline message to admins: {e}")
        
        logger.info(f"Message from {sender_id} sent to {admin_count} online admins")
        return admin_count > 0 or session is not None
    
    async def send_to_user(self, message: str, user_id: str, sender_id: str = "admin", session=None):
        """Send a message from admin to a specific user"""
        message_data = {
            "type": "admin_message",
            "from": sender_id,
            "from_name": self._get_user_display_name(sender_id),
            "message": message,
            "timestamp": get_moscow_time_iso()
        }
        
        success = False
        
        # Try to send to online user
        if user_id in self.active_connections:
            success = await self.send_personal_message(json.dumps(message_data), user_id)
            
            # Also send copy to admin for history (if sender is admin)
            if success and sender_id != user_id:
                history_data = message_data.copy()
                history_data["type"] = "admin_sent"
                history_data["to"] = user_id
                history_data["to_name"] = self._get_user_display_name(user_id)
                
                # Send to all admins
                for admin_id, websocket in self.active_connections.items():
                    admin_data = self.user_info.get(admin_id, {})
                    if admin_data.get('is_admin', False):
                        try:
                            await websocket.send_text(json.dumps(history_data))
                        except Exception as e:
                            logger.error(f"Failed to send history to admin {admin_id}: {e}")
        
        # If user is offline or sending failed, save message to database
        if not success and session:
            try:
                from websocket.message_manager import message_manager
                await message_manager.save_message(
                    session, sender_id, user_id, message, "admin_message"
                )
                logger.info(f"Saved offline message from {sender_id} to user {user_id}")
                success = True
            except Exception as e:
                logger.error(f"Failed to save offline message: {e}")
        
        return success
    
    async def broadcast(self, message: str, sender_id: str = "admin", exclude_admins: bool = True):
        """Send a broadcast message to all connected users (excluding admins by default)"""
        message_data = {
            "type": "broadcast",
            "from": sender_id,
            "from_name": self._get_user_display_name(sender_id),
            "message": message,
            "timestamp": get_moscow_time_iso()
        }
        
        sent_count = 0
        for user_id, websocket in self.active_connections.items():
            user_data = self.user_info.get(user_id, {})
            
            # Skip admins if exclude_admins is True
            if exclude_admins and user_data.get('is_admin', False):
                continue
            
            try:
                await websocket.send_text(json.dumps(message_data))
                sent_count += 1
            except Exception as e:
                logger.error(f"Failed to broadcast to {user_id}: {e}")
                self.disconnect(user_id)
        
        logger.info(f"Broadcast message sent to {sent_count} users")
        return sent_count
    
    def get_connected_users(self, exclude_admins: bool = True) -> List[dict]:
        """Get list of connected users with their information"""
        users = []
        for user_id, user_data in self.user_info.items():
            if exclude_admins and user_data.get('is_admin', False):
                continue
            
            users.append({
                "user_id": user_id,
                "name": self._get_user_display_name(user_id),
                "is_admin": user_data.get('is_admin', False),
                "connected": user_id in self.active_connections
            })
        
        return users
    
    def get_all_users(self, exclude_admins: bool = True) -> List[dict]:
        """Get list of all users (including disconnected) with their information"""
        print(f"[DEBUG] get_all_users called, exclude_admins={exclude_admins}")
        print(f"[DEBUG] all_users keys: {list(self.all_users.keys())}")
        print(f"[DEBUG] active_connections keys: {list(self.active_connections.keys())}")
        
        users = []
        for user_id, user_data in self.all_users.items():
            print(f"[DEBUG] Processing user {user_id}: {user_data}")
            
            if exclude_admins and user_data.get('is_admin', False):
                print(f"[DEBUG] Skipping admin user: {user_id}")
                continue
            
            # Skip users with incomplete data (likely old/invalid entries)
            if not user_data.get('first_name') or not user_data.get('last_name'):
                print(f"[DEBUG] Skipping user with incomplete data: {user_id}")
                continue
            
            user_info = {
                "user_id": user_id,
                "name": self._get_user_display_name_from_data(user_data),
                "is_admin": user_data.get('is_admin', False),
                "connected": user_id in self.active_connections
            }
            print(f"[DEBUG] Adding user: {user_info}")
            users.append(user_info)
        
        print(f"[DEBUG] Returning {len(users)} users")
        return users
    
    def get_connected_admins(self) -> List[dict]:
        """Get list of connected administrators"""
        admins = []
        for user_id, user_data in self.user_info.items():
            if user_data.get('is_admin', False):
                admins.append({
                    "user_id": user_id,
                    "name": self._get_user_display_name(user_id),
                    "connected": user_id in self.active_connections
                })
        
        return admins
    
    def is_user_connected(self, user_id: str) -> bool:
        """Check if a user is currently connected"""
        return user_id in self.active_connections
    
    def is_admin(self, user_id: str) -> bool:
        """Check if a user is an administrator"""
        user_data = self.user_info.get(user_id, {})
        return user_data.get('is_admin', False)
    
    def _get_user_display_name(self, user_id: str) -> str:
        """Get display name for a user"""
        user_data = self.user_info.get(user_id, {})
        return self._get_user_display_name_from_data(user_data) or user_id
    
    def _get_user_display_name_from_data(self, user_data: dict) -> str:
        """Get display name from user data"""
        if user_data:
            first_name = user_data.get('first_name', '')
            last_name = user_data.get('last_name', '')
            if first_name and last_name:
                return f"{first_name} {last_name}"
        return ""
    
    def clear_invalid_users(self):
        """Clear users with incomplete data from memory"""
        users_to_remove = []
        for user_id, user_data in self.all_users.items():
            # Remove users without proper name data
            if not user_data.get('first_name') or not user_data.get('last_name'):
                users_to_remove.append(user_id)
        
        for user_id in users_to_remove:
            print(f"[DEBUG] Removing invalid user from memory: {user_id}")
            del self.all_users[user_id]
            if user_id in self.user_info:
                del self.user_info[user_id]
        
        print(f"[DEBUG] Cleared {len(users_to_remove)} invalid users from memory")
    
    async def _notify_admins_user_connected(self, user_id: str, user_data: dict):
        """Notify all admins when a new user connects"""
        notification = {
            "type": "user_connected",
            "user_id": user_id,
            "user_name": self._get_user_display_name(user_id),
            "timestamp": get_moscow_time_iso()
        }
        
        for admin_id, websocket in self.active_connections.items():
            admin_data = self.user_info.get(admin_id, {})
            if admin_data.get('is_admin', False):
                try:
                    await websocket.send_text(json.dumps(notification))
                except Exception as e:
                    logger.error(f"Failed to notify admin {admin_id} about user connection: {e}")


# Global connection manager instance
manager = ConnectionManager()