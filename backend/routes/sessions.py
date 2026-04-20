from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Session as DBSession, ChatEntry
import json
import uuid
import re
from datetime import datetime

router = APIRouter()

# Caps to prevent abuse
MAX_DATAURL_BYTES = 15 * 1024 * 1024        # 15MB dataUrl (images)
MAX_RESULT_BYTES = 500 * 1024                # 500KB JSON for result
MAX_MARKS = 500                              # reasonable mark count
MAX_CHAT_CONTENT = 4000                      # chars
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _validate_uuid(s: str, name: str = "id"):
    if not UUID_RE.match(s):
        raise HTTPException(status_code=400, detail=f"Invalid {name} format")


class SaveSessionRequest(BaseModel):
    imageDataUrl: str = Field(..., min_length=20)
    result: dict
    autoMarks: list[dict] = Field(default_factory=list)


class SaveChatRequest(BaseModel):
    sessionId: str
    questionNum: int = Field(..., ge=0, le=100)
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=MAX_CHAT_CONTENT)


@router.post("/sessions")
async def save_session(req: SaveSessionRequest, db: AsyncSession = Depends(get_db)):
    # Payload caps
    if len(req.imageDataUrl) > MAX_DATAURL_BYTES:
        raise HTTPException(status_code=413, detail="imageDataUrl too large")
    result_str = json.dumps(req.result)
    if len(result_str) > MAX_RESULT_BYTES:
        raise HTTPException(status_code=413, detail="result too large")
    if len(req.autoMarks) > MAX_MARKS:
        raise HTTPException(status_code=413, detail=f"autoMarks exceeds {MAX_MARKS}")

    session_id = str(uuid.uuid4())
    session = DBSession(
        id=session_id,
        image_data_url=req.imageDataUrl,
        result_json=result_str,
        auto_marks_json=json.dumps(req.autoMarks),
        timestamp=datetime.utcnow().isoformat()
    )
    db.add(session)
    await db.commit()
    return {"id": session_id}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    _validate_uuid(session_id, "session_id")
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
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    # Exclude heavy image_data_url + auto_marks_json from list query
    result = await db.execute(
        select(DBSession.id, DBSession.result_json, DBSession.timestamp)
        .order_by(DBSession.timestamp.desc())
        .limit(limit).offset(offset)
    )
    rows = result.all()
    return [
        {"id": r[0], "result": json.loads(r[1]), "timestamp": r[2]}
        for r in rows
    ]


@router.patch("/sessions/{session_id}/marks")
async def update_marks(session_id: str, marks: list[dict], db: AsyncSession = Depends(get_db)):
    _validate_uuid(session_id, "session_id")
    if len(marks) > MAX_MARKS:
        raise HTTPException(status_code=413, detail=f"marks exceeds {MAX_MARKS}")
    result = await db.execute(select(DBSession).where(DBSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.auto_marks_json = json.dumps(marks)
    await db.commit()
    return {"ok": True}


@router.post("/chat-messages")
async def save_chat(req: SaveChatRequest, db: AsyncSession = Depends(get_db)):
    _validate_uuid(req.sessionId, "sessionId")
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
    _validate_uuid(session_id, "session_id")
    if question_num < 0 or question_num > 100:
        raise HTTPException(status_code=400, detail="Invalid question_num")
    result = await db.execute(
        select(ChatEntry).where(
            ChatEntry.session_id == session_id,
            ChatEntry.question_num == question_num
        ).order_by(ChatEntry.id.asc())
    )
    entries = result.scalars().all()
    return [{"id": str(e.id), "role": e.role, "content": e.content, "timestamp": e.timestamp} for e in entries]
