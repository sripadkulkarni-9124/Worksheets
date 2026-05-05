from sqlmodel import SQLModel, create_engine
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from pathlib import Path

DB_PATH = Path(__file__).parent / "ved_sessions.db"
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"
engine = create_async_engine(DATABASE_URL)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _column_exists(conn, table: str, column: str) -> bool:
    result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
    rows = result.fetchall()
    return any(r[1] == column for r in rows)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        # Lightweight SQLite migrations — add missing columns
        if not await _column_exists(conn, "session", "pages_json"):
            await conn.exec_driver_sql(
                "ALTER TABLE session ADD COLUMN pages_json TEXT DEFAULT '[]'"
            )


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
