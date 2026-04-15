from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Session as DBSession, ChatEntry
import json
import uuid
from datetime import datetime

router = APIRouter()


class SaveSessionRequest(BaseModel):
    imageDataUrl: str
    result: dict
    autoMarks: list[dict] = []


class SaveChatRequest(BaseModel):
    sessionId: str
    questionNum: int
    role: str
    content: str


@router.post("/sessions")
async def save_session(req: SaveSessionRequest, db: AsyncSession = Depends(get_db)):
    session_id = str(uuid.uuid4())
    session = DBSession(
        id=session_id,
        image_data_url=req.imageDataUrl,
        result_json=json.dumps(req.result),
        auto_marks_json=json.dumps(req.autoMarks),
        timestamp=datetime.utcnow().isoformat()
    )
    db.add(session)
    await db.commit()
    return {"id": session_id}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DBSession).where(DBSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": session.id,
        "imageDataUrl": session.image_data_url,
        "result": json.loads(session.result_json),
        "autoMarks": json.loads(session.auto_marks_json),
        "timestamp": session.timestamp
    }


@router.get("/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DBSession).order_by(DBSession.timestamp.desc()).limit(10))
    sessions = result.scalars().all()
    return [{"id": s.id, "result": json.loads(s.result_json), "timestamp": s.timestamp} for s in sessions]


@router.patch("/sessions/{session_id}/marks")
async def update_marks(session_id: str, marks: list[dict], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DBSession).where(DBSession.id == session_id))
    session = result.scalar_one_or_none()
    if session:
        session.auto_marks_json = json.dumps(marks)
        await db.commit()
    return {"ok": True}


@router.post("/chat-messages")
async def save_chat(req: SaveChatRequest, db: AsyncSession = Depends(get_db)):
    entry = ChatEntry(
        session_id=req.sessionId,
        question_num=req.questionNum,
        role=req.role,
        content=req.content,
        timestamp=datetime.utcnow().isoformat()
    )
    db.add(entry)
    await db.commit()
    return {"ok": True}


@router.get("/chat-messages/{session_id}/{question_num}")
async def get_chat(session_id: str, question_num: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatEntry).where(
            ChatEntry.session_id == session_id,
            ChatEntry.question_num == question_num
        )
    )
    entries = result.scalars().all()
    return [{"id": str(e.id), "role": e.role, "content": e.content, "timestamp": e.timestamp} for e in entries]
