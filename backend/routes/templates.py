"""
Worksheet template routes — teacher uploads a JSON of questions + answers.
Student scans reference a saved template.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import WorksheetTemplate, TemplatePayload
import json
import uuid
import re
from datetime import datetime

router = APIRouter()

MAX_QUESTIONS = 50
MAX_QTEXT = 2000
MAX_ANSWER = 1000
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _validate_uuid(s: str, name: str = "id"):
    if not UUID_RE.match(s):
        raise HTTPException(status_code=400, detail=f"Invalid {name} format")


def _validate_payload(p: TemplatePayload):
    if not p.questions:
        raise HTTPException(status_code=400, detail="questions array cannot be empty")
    if len(p.questions) > MAX_QUESTIONS:
        raise HTTPException(status_code=413, detail=f"Too many questions (max {MAX_QUESTIONS})")
    nums = set()
    for q in p.questions:
        if q.number in nums:
            raise HTTPException(status_code=400, detail=f"Duplicate question number {q.number}")
        nums.add(q.number)
        if len(q.questionText) > MAX_QTEXT:
            raise HTTPException(status_code=413, detail=f"Q{q.number}: questionText too long")
        if len(q.correctAnswer) > MAX_ANSWER:
            raise HTTPException(status_code=413, detail=f"Q{q.number}: correctAnswer too long")
        if q.marks_possible < 0 or q.marks_possible > 100:
            raise HTTPException(status_code=400, detail=f"Q{q.number}: invalid marks_possible")


@router.post("/templates")
async def create_template(payload: TemplatePayload, db: AsyncSession = Depends(get_db)):
    _validate_payload(payload)
    template_id = str(uuid.uuid4())
    questions_json = json.dumps([q.model_dump() for q in payload.questions])
    tpl = WorksheetTemplate(
        id=template_id,
        title=payload.title[:200],
        subject=(payload.subject or "")[:100] or None,
        chapter=(payload.chapter or "")[:200] or None,
        topic=(payload.topic or "")[:200] or None,
        questions_json=questions_json,
        timestamp=datetime.utcnow().isoformat(),
    )
    db.add(tpl)
    await db.commit()
    return {"id": template_id, "title": tpl.title, "question_count": len(payload.questions)}


@router.get("/templates")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    result = await db.execute(
        select(
            WorksheetTemplate.id, WorksheetTemplate.title,
            WorksheetTemplate.subject, WorksheetTemplate.chapter, WorksheetTemplate.topic,
            WorksheetTemplate.questions_json, WorksheetTemplate.timestamp,
        )
        .order_by(WorksheetTemplate.timestamp.desc())
        .limit(limit).offset(offset)
    )
    rows = result.all()
    out = []
    for r in rows:
        try:
            qcount = len(json.loads(r[5]))
        except Exception:
            qcount = 0
        out.append({
            "id": r[0], "title": r[1], "subject": r[2], "chapter": r[3],
            "topic": r[4], "question_count": qcount, "timestamp": r[6],
        })
    return out


@router.get("/templates/{template_id}")
async def get_template(template_id: str, db: AsyncSession = Depends(get_db)):
    _validate_uuid(template_id, "template_id")
    result = await db.execute(select(WorksheetTemplate).where(WorksheetTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return {
        "id": tpl.id,
        "title": tpl.title,
        "subject": tpl.subject,
        "chapter": tpl.chapter,
        "topic": tpl.topic,
        "questions": json.loads(tpl.questions_json),
        "timestamp": tpl.timestamp,
    }


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, db: AsyncSession = Depends(get_db)):
    _validate_uuid(template_id, "template_id")
    result = await db.execute(select(WorksheetTemplate).where(WorksheetTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(tpl)
    await db.commit()
    return {"ok": True}
