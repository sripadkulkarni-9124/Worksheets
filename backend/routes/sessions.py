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


class PagePayload(BaseModel):
    imageDataUrl: str = Field(..., min_length=20)
    result: dict
    autoMarks: list[dict] = Field(default_factory=list)


class SaveSessionRequest(BaseModel):
    # New multi-page mode — preferred
    pages: list[PagePayload] | None = None
    # Legacy single-page fields — still accepted
    imageDataUrl: str | None = Field(default=None)
    result: dict | None = None
    autoMarks: list[dict] = Field(default_factory=list)


class SaveChatRequest(BaseModel):
    sessionId: str
    questionNum: int = Field(..., ge=0, le=100)
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=MAX_CHAT_CONTENT)


def _build_pages_list(req: SaveSessionRequest) -> list[dict]:
    """Normalize payload to a pages[] list. Validates each page."""
    pages: list[dict] = []
    if req.pages:
        for p in req.pages:
            pages.append({
                "imageDataUrl": p.imageDataUrl,
                "result": p.result,
                "autoMarks": p.autoMarks,
            })
    elif req.imageDataUrl and req.result is not None:
        pages.append({
            "imageDataUrl": req.imageDataUrl,
            "result": req.result,
            "autoMarks": req.autoMarks or [],
        })
    if not pages:
        raise HTTPException(status_code=400, detail="No pages provided")
    if len(pages) > 20:
        raise HTTPException(status_code=413, detail="Max 20 pages per session")
    total_bytes = 0
    for i, p in enumerate(pages):
        if len(p["imageDataUrl"]) > MAX_DATAURL_BYTES:
            raise HTTPException(status_code=413, detail=f"Page {i+1} imageDataUrl too large")
        rs = json.dumps(p["result"])
        if len(rs) > MAX_RESULT_BYTES:
            raise HTTPException(status_code=413, detail=f"Page {i+1} result too large")
        if len(p["autoMarks"]) > MAX_MARKS:
            raise HTTPException(status_code=413, detail=f"Page {i+1} autoMarks exceeds {MAX_MARKS}")
        total_bytes += len(p["imageDataUrl"])
    if total_bytes > MAX_DATAURL_BYTES * 4:
        raise HTTPException(status_code=413, detail="Total pages size exceeds limit")
    return pages


@router.post("/sessions")
async def save_session(req: SaveSessionRequest, db: AsyncSession = Depends(get_db)):
    pages = _build_pages_list(req)
    session_id = str(uuid.uuid4())
    # Legacy columns get first page for back-compat
    first = pages[0]
    session = DBSession(
        id=session_id,
        image_data_url=first["imageDataUrl"],
        result_json=json.dumps(first["result"]),
        auto_marks_json=json.dumps(first["autoMarks"]),
        pages_json=json.dumps(pages),
        timestamp=datetime.utcnow().isoformat()
    )
    db.add(session)
    await db.commit()
    return {"id": session_id, "page_count": len(pages)}


def _load_pages(session: DBSession) -> list[dict]:
    """Return pages[] — parses pages_json; falls back to legacy single-page fields."""
    try:
        pages = json.loads(session.pages_json or "[]")
        if isinstance(pages, list) and pages:
            return pages
    except Exception:
        pass
    # Legacy fallback
    return [{
        "imageDataUrl": session.image_data_url,
        "result": json.loads(session.result_json or "{}"),
        "autoMarks": json.loads(session.auto_marks_json or "[]"),
    }]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    _validate_uuid(session_id, "session_id")
    result = await db.execute(select(DBSession).where(DBSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    pages = _load_pages(session)
    first = pages[0]
    return {
        "id": session.id,
        "pages": pages,
        # Back-compat — first page flattened at top level
        "imageDataUrl": first["imageDataUrl"],
        "result": first["result"],
        "autoMarks": first["autoMarks"],
        "timestamp": session.timestamp,
    }


class AppendPageRequest(BaseModel):
    imageDataUrl: str = Field(..., min_length=20)
    result: dict
    autoMarks: list[dict] = Field(default_factory=list)


@router.post("/sessions/{session_id}/pages")
async def append_page(session_id: str, req: AppendPageRequest, db: AsyncSession = Depends(get_db)):
    _validate_uuid(session_id, "session_id")
    if len(req.imageDataUrl) > MAX_DATAURL_BYTES:
        raise HTTPException(status_code=413, detail="imageDataUrl too large")
    rs = json.dumps(req.result)
    if len(rs) > MAX_RESULT_BYTES:
        raise HTTPException(status_code=413, detail="result too large")
    if len(req.autoMarks) > MAX_MARKS:
        raise HTTPException(status_code=413, detail=f"autoMarks exceeds {MAX_MARKS}")
    result = await db.execute(select(DBSession).where(DBSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    pages = _load_pages(session)
    if len(pages) >= 20:
        raise HTTPException(status_code=413, detail="Max 20 pages per session")
    pages.append({
        "imageDataUrl": req.imageDataUrl,
        "result": req.result,
        "autoMarks": req.autoMarks,
    })
    session.pages_json = json.dumps(pages)
    await db.commit()
    return {"ok": True, "page_count": len(pages)}


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
async def update_marks(
    session_id: str,
    marks: list[dict],
    db: AsyncSession = Depends(get_db),
    page: int = Query(0, ge=0, le=20),
):
    _validate_uuid(session_id, "session_id")
    if len(marks) > MAX_MARKS:
        raise HTTPException(status_code=413, detail=f"marks exceeds {MAX_MARKS}")
    result = await db.execute(select(DBSession).where(DBSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    pages = _load_pages(session)
    if page >= len(pages):
        raise HTTPException(status_code=400, detail=f"Page index {page} out of range (have {len(pages)})")
    pages[page]["autoMarks"] = marks
    session.pages_json = json.dumps(pages)
    # Legacy column mirrors page 0
    if page == 0:
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
