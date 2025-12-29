from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc, func
from datetime import datetime
import logging

from schemas.schemas import MessageModel, MessageSchema, ConversationSchema, UserModel
from utils.timezone import get_moscow_time

logger = logging.getLogger(__name__)

class MessageManager:
    """Manages chat messages and conversation history"""
    
    def __init__(self):
        pass
    
    async def save_message(
        self, 
        session: AsyncSession,
        sender_id: str, 
        recipient_id: str, 
        content: str,
        message_type: str = "user_message"
    ) -> MessageModel:
        """Save a message to the database"""
        try:
            message = MessageModel(
                sender_id=sender_id,
                recipient_id=recipient_id,
                content=content,
                message_type=message_type,
                timestamp=get_moscow_time(),
                is_read=False
            )
            
            session.add(message)
            await session.commit()
            await session.refresh(message)
            
            logger.info(f"Message saved: {sender_id} -> {recipient_id} ({message_type})")
            return message
            
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to save message: {e}")
            raise
    
    async def get_conversation_history(
        self,
        session: AsyncSession,
        user1_id: str,
        user2_id: str,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = False
    ) -> List[MessageSchema]:
        """Get conversation history between two users"""
        try:
            # Base query
            base_conditions = [
                or_(
                    and_(MessageModel.sender_id == user1_id, MessageModel.recipient_id == user2_id),
                    and_(MessageModel.sender_id == user2_id, MessageModel.recipient_id == user1_id)
                )
            ]
            
            # Add archive filter if needed
            if not include_archived:
                base_conditions.append(MessageModel.is_archived == False)
            
            query = select(MessageModel).where(
                and_(*base_conditions)
            ).order_by(desc(MessageModel.timestamp)).limit(limit).offset(offset)
            
            result = await session.execute(query)
            messages = result.scalars().all()
            
            # Convert to schemas and reverse order (oldest first)
            message_schemas = [
                MessageSchema(
                    id=msg.id,
                    sender_id=msg.sender_id,
                    recipient_id=msg.recipient_id,
                    content=msg.content,
                    timestamp=msg.timestamp,
                    is_read=msg.is_read,
                    message_type=msg.message_type,
                    is_archived=msg.is_archived
                ) for msg in reversed(messages)
            ]
            
            archive_status = "including archived" if include_archived else "non-archived only"
            logger.info(f"Retrieved {len(message_schemas)} messages ({archive_status}) for conversation {user1_id} <-> {user2_id}")
            return message_schemas
            
        except Exception as e:
            logger.error(f"Failed to get conversation history: {e}")
            raise
    
    async def get_user_conversations(
        self,
        session: AsyncSession,
        user_id: str,
        is_admin: bool = False
    ) -> List[ConversationSchema]:
        """Get list of conversations for a user"""
        try:
            if is_admin:
                # Admin sees all conversations with users
                query = select(
                    MessageModel.sender_id,
                    MessageModel.recipient_id,
                    MessageModel.content,
                    MessageModel.timestamp,
                    func.count(MessageModel.id).label('unread_count')
                ).where(
                    or_(
                        MessageModel.recipient_id == user_id,
                        MessageModel.sender_id == user_id
                    )
                ).group_by(
                    MessageModel.sender_id,
                    MessageModel.recipient_id
                ).order_by(desc(MessageModel.timestamp))
            else:
                # Regular user sees only conversations with admins
                admin_query = select(UserModel.login).where(UserModel.is_admin == True)
                admin_result = await session.execute(admin_query)
                admin_logins = [row[0] for row in admin_result.fetchall()]
                
                if not admin_logins:
                    return []
                
                query = select(
                    MessageModel.sender_id,
                    MessageModel.recipient_id,
                    MessageModel.content,
                    MessageModel.timestamp,
                    func.count(MessageModel.id).label('unread_count')
                ).where(
                    or_(
                        and_(MessageModel.sender_id == user_id, MessageModel.recipient_id.in_(admin_logins)),
                        and_(MessageModel.recipient_id == user_id, MessageModel.sender_id.in_(admin_logins))
                    )
                ).group_by(
                    MessageModel.sender_id,
                    MessageModel.recipient_id
                ).order_by(desc(MessageModel.timestamp))
            
            result = await session.execute(query)
            conversations_data = result.fetchall()
            
            # Process conversations to get unique participants
            conversations = {}
            for row in conversations_data:
                sender_id, recipient_id, content, timestamp, unread_count = row
                
                # Determine the other participant
                other_user = recipient_id if sender_id == user_id else sender_id
                
                if other_user not in conversations:
                    # Get participant name
                    user_query = select(UserModel).where(UserModel.login == other_user)
                    user_result = await session.execute(user_query)
                    user_data = user_result.scalar_one_or_none()
                    
                    participant_name = other_user
                    if user_data:
                        participant_name = f"{user_data.first_name} {user_data.last_name}"
                    
                    conversations[other_user] = ConversationSchema(
                        participant_id=other_user,
                        participant_name=participant_name,
                        last_message=content,
                        last_message_time=timestamp,
                        unread_count=0  # Will be calculated separately
                    )
                else:
                    # Update if this message is more recent
                    if timestamp > conversations[other_user].last_message_time:
                        conversations[other_user].last_message = content
                        conversations[other_user].last_message_time = timestamp
            
            # Calculate unread counts
            for participant_id in conversations.keys():
                unread_query = select(func.count(MessageModel.id)).where(
                    and_(
                        MessageModel.sender_id == participant_id,
                        MessageModel.recipient_id == user_id,
                        MessageModel.is_read == False
                    )
                )
                unread_result = await session.execute(unread_query)
                unread_count = unread_result.scalar() or 0
                conversations[participant_id].unread_count = unread_count
            
            conversation_list = list(conversations.values())
            conversation_list.sort(key=lambda x: x.last_message_time, reverse=True)
            
            logger.info(f"Retrieved {len(conversation_list)} conversations for user {user_id}")
            return conversation_list
            
        except Exception as e:
            logger.error(f"Failed to get user conversations: {e}")
            raise
    
    async def mark_messages_as_read(
        self,
        session: AsyncSession,
        user_id: str,
        sender_id: str
    ) -> int:
        """Mark messages from a specific sender as read"""
        try:
            from sqlalchemy import update
            
            query = update(MessageModel).where(
                and_(
                    MessageModel.sender_id == sender_id,
                    MessageModel.recipient_id == user_id,
                    MessageModel.is_read == False
                )
            ).values(is_read=True)
            
            result = await session.execute(query)
            await session.commit()
            
            marked_count = result.rowcount
            logger.info(f"Marked {marked_count} messages as read for {user_id} from {sender_id}")
            return marked_count
            
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to mark messages as read: {e}")
            raise
    
    async def get_unread_messages(
        self,
        session: AsyncSession,
        user_id: str,
        limit: int = 100
    ) -> List[MessageSchema]:
        """Get all unread messages for a user (excluding archived messages)"""
        try:
            query = select(MessageModel).where(
                and_(
                    MessageModel.recipient_id == user_id,
                    MessageModel.is_read == False,
                    MessageModel.is_archived == False  # Exclude archived messages
                )
            ).order_by(MessageModel.timestamp).limit(limit)
            
            result = await session.execute(query)
            messages = result.scalars().all()
            
            # Convert to schemas
            message_schemas = [
                MessageSchema(
                    id=msg.id,
                    sender_id=msg.sender_id,
                    recipient_id=msg.recipient_id,
                    content=msg.content,
                    timestamp=msg.timestamp,
                    is_read=msg.is_read,
                    message_type=msg.message_type,
                    is_archived=msg.is_archived
                ) for msg in messages
            ]
            
            logger.info(f"Retrieved {len(message_schemas)} unread non-archived messages for user {user_id}")
            return message_schemas
            
        except Exception as e:
            logger.error(f"Failed to get unread messages: {e}")
            raise

    async def get_unread_count(
        self,
        session: AsyncSession,
        user_id: str
    ) -> int:
        """Get total unread message count for a user"""
        try:
            query = select(func.count(MessageModel.id)).where(
                and_(
                    MessageModel.recipient_id == user_id,
                    MessageModel.is_read == False
                )
            )
            
            result = await session.execute(query)
            count = result.scalar() or 0
            
            logger.info(f"User {user_id} has {count} unread messages")
            return count
            
        except Exception as e:
            logger.error(f"Failed to get unread count: {e}")
            return 0
    
    async def delete_conversation(
        self,
        session: AsyncSession,
        user_id: str,
        other_user_id: str
    ) -> int:
        """Delete all messages in a conversation (admin only)"""
        try:
            from sqlalchemy import delete
            
            query = delete(MessageModel).where(
                or_(
                    and_(MessageModel.sender_id == user_id, MessageModel.recipient_id == other_user_id),
                    and_(MessageModel.sender_id == other_user_id, MessageModel.recipient_id == user_id)
                )
            )
            
            result = await session.execute(query)
            await session.commit()
            
            deleted_count = result.rowcount
            logger.info(f"Deleted {deleted_count} messages from conversation {user_id} <-> {other_user_id}")
            return deleted_count
            
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to delete conversation: {e}")
            raise
    
    async def get_recent_messages(
        self,
        session: AsyncSession,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get recent messages across all conversations (admin only)"""
        try:
            query = select(MessageModel, UserModel).join(
                UserModel, MessageModel.sender_id == UserModel.login
            ).order_by(desc(MessageModel.timestamp)).limit(limit)
            
            result = await session.execute(query)
            rows = result.fetchall()
            
            messages = []
            for message, user in rows:
                messages.append({
                    "id": message.id,
                    "sender_id": message.sender_id,
                    "sender_name": f"{user.first_name} {user.last_name}",
                    "recipient_id": message.recipient_id,
                    "content": message.content,
                    "timestamp": message.timestamp,
                    "message_type": message.message_type,
                    "is_read": message.is_read
                })
            
            logger.info(f"Retrieved {len(messages)} recent messages")
            return messages
            
        except Exception as e:
            logger.error(f"Failed to get recent messages: {e}")
            raise


# Global message manager instance
message_manager = MessageManager()