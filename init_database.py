#!/usr/bin/env python3
"""
Initialize database with default admin user
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from schemas.schemas import Base, UserModel

async def init_database():
    """Initialize database and create default admin user"""
    
    # Create engine and session
    engine = create_async_engine("sqlite+aiosqlite:///database.db")
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Create default admin user
    async with async_session() as session:
        # Check if admin already exists
        from sqlalchemy import select
        query = select(UserModel).where(UserModel.login == "admin")
        result = await session.execute(query)
        existing_admin = result.scalar_one_or_none()
        
        if not existing_admin:
            admin_user = UserModel(
                first_name="Admin",
                last_name="User",
                patronymic="",
                login="admin",
                password="admin",  # In production, use hashed passwords
                address="Admin Address",
                flat=1,
                is_admin=True
            )
            session.add(admin_user)
            await session.commit()
            print("✅ Default admin user created (login: admin, password: admin)")
        else:
            print("ℹ️  Admin user already exists")
        
        # Create a test regular user
        query = select(UserModel).where(UserModel.login == "user")
        result = await session.execute(query)
        existing_user = result.scalar_one_or_none()
        
        if not existing_user:
            test_user = UserModel(
                first_name="Test",
                last_name="User",
                patronymic="",
                login="user",
                password="user",
                address="Test Address",
                flat=2,
                is_admin=False
            )
            session.add(test_user)
            await session.commit()
            print("✅ Default test user created (login: user, password: user)")
        else:
            print("ℹ️  Test user already exists")
    
    await engine.dispose()
    print("✅ Database initialization complete!")

if __name__ == "__main__":
    print("Initializing database...")
    asyncio.run(init_database())