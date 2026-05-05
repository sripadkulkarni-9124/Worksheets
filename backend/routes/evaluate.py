from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import WorksheetTemplate, TemplateQuestion
import base64
import json
import asyncio

router = APIRouter()

# Max decoded image size (10MB). Base64 is ~1.33x bigger, so ~13.3MB incoming.
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


def _validate_image(b64: str, mime: str) -> bytes:
    """Validate size + MIME, return decoded bytes. Raises HTTPException on failure."""
    if mime.lower() not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {mime}. Allowed: {', '.join(ALLOWED_MIMES)}"
        )
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large ({len(raw)//1024}KB). Max {MAX_IMAGE_BYTES//1024//1024}MB."
        )
    if len(raw) < 100:
        raise HTTPException(status_code=400, detail="Image payload too small")
    return raw


class EvaluateRequest(BaseModel):
    imageBase64: str
    mimeType: str = "image/jpeg"
    # New: template-driven evaluation. Provide either templateId (stored) or questions (inline).
    templateId: str | None = None
    questions: list[dict] | None = None
    worksheetTitle: str | None = None
    subject: str | None = None
    chapter: str | None = None
    topic: str | None = None
    grade: int | None = None
    pageNumber: int | None = None
    promptVersion: str | None = None  # "v1" | "v2" (default v2)


async def _call_gemini_with_retry(client, model, contents, config, max_retries=1):
    last_error = None
    raw_text = ""
    for attempt in range(max_retries + 1):
        try:
            result = client.models.generate_content(
                model=model, contents=contents, config=config
            )
            raw_text = result.text.replace("```json", "").replace("```", "").strip()
            data = json.loads(raw_text)
            usage = result.usage_metadata
            print(f"[TOKENS] evaluate: prompt={usage.prompt_token_count} "
                  f"output={usage.candidates_token_count} total={usage.total_token_count}")
            return data
        except json.JSONDecodeError as e:
            last_error = e
            print(f"[ERROR] evaluate JSON (attempt {attempt + 1}): {e}")
            print(f"[ERROR] Raw: {raw_text[:500]}")
            if attempt < max_retries:
                await asyncio.sleep(1)
        except Exception as e:
            last_error = e
            print(f"[ERROR] evaluate (attempt {attempt + 1}): {e}")
            if attempt < max_retries:
                await asyncio.sleep(1)
    raise last_error or Exception("Gemini evaluate failed after retries")


def _sanitize_bboxes(questions: list[dict]) -> list[dict]:
    """
    Sanitize Gemini's box_2d output — keep raw positions, only fix issues.

    Gemini returns box_2d: [ymin, xmin, ymax, xmax] on 0-1000 scale.
    We convert to bbox_norm: [ymin, xmin, ymax, xmax] on 0-1 scale.

    Only fixes: clamp to [0,1000], ensure ymin < ymax / xmin < xmax,
    fix overlaps, fallback for missing boxes.
    """
    num_q = len(questions)
    if num_q == 0:
        return questions

    # ── Parse raw boxes ──
    # Supports three shapes from Gemini:
    #   (1) v2 object:   bbox = {x, y, w, h} normalized 0-1     → scale ×1000
    #   (2) legacy list: box_2d = [ymin, xmin, ymax, xmax] 0-1000
    #   (3) legacy list: bbox   = [y_start, y_end] 0-100
    raw_boxes = []  # (ymin, xmin, ymax, xmax) on 0-1000 scale, or None
    for q in questions:
        bb = q.get("bbox") if isinstance(q.get("bbox"), dict) else (q.get("box_2d") or q.get("bbox"))
        if isinstance(bb, dict) and all(k in bb for k in ("x", "y", "w", "h")):
            x = float(bb["x"]); y = float(bb["y"])
            w = float(bb["w"]); h = float(bb["h"])
            raw_boxes.append((y * 1000, x * 1000, (y + h) * 1000, (x + w) * 1000))
        elif bb and isinstance(bb, list) and len(bb) >= 4:
            raw_boxes.append(tuple(float(v) for v in bb[:4]))
        elif bb and isinstance(bb, list) and len(bb) == 2:
            raw_boxes.append((float(bb[0]), 10.0, float(bb[1]), 850.0))
        else:
            raw_boxes.append(None)

    # Auto-detect 0-100 scale
    all_vals = [v for box in raw_boxes if box for v in box]
    if all_vals and max(all_vals) <= 100:
        print(f"[EVALUATE] Auto-detected 0-100 scale, multiplying by 10")
        raw_boxes = [
            tuple(v * 10 for v in box) if box else None
            for box in raw_boxes
        ]

    # Log raw
    print(f"[EVALUATE] Raw Gemini boxes ({sum(1 for b in raw_boxes if b)}/{num_q} valid):")
    for i, box in enumerate(raw_boxes):
        if box:
            ymin, xmin, ymax, xmax = box
            print(f"  Q{questions[i].get('number','?')}: [y:{ymin:.0f}-{ymax:.0f}, x:{xmin:.0f}-{xmax:.0f}]")

    # ── Clamp and fix ordering ──
    for i, box in enumerate(raw_boxes):
        if box is None:
            continue
        ymin, xmin, ymax, xmax = box
        ymin = max(0, min(1000, ymin))
        ymax = max(0, min(1000, ymax))
        xmin = max(0, min(1000, xmin))
        xmax = max(0, min(1000, xmax))
        if ymin >= ymax:
            ymin, ymax = ymax, ymin
        if ymin == ymax:
            ymax = ymin + 50
        if xmin >= xmax:
            xmin, xmax = xmax, xmin
        if xmin == xmax:
            xmax = xmin + 100
        raw_boxes[i] = (ymin, xmin, ymax, xmax)

    # ── Fill missing boxes by interpolation ──
    valid_indices = [i for i, b in enumerate(raw_boxes) if b is not None]
    if len(valid_indices) == 0:
        # No boxes at all — even distribution, full width
        slot_h = 900 / num_q
        for i in range(num_q):
            ymin = 50 + i * slot_h
            ymax = ymin + slot_h - 10
            raw_boxes[i] = (ymin, 10, ymax, 850)
    elif len(valid_indices) < num_q:
        # Some missing — interpolate from neighbors
        known_heights = [raw_boxes[i][2] - raw_boxes[i][0] for i in valid_indices]
        avg_h = sum(known_heights) / len(known_heights)
        for i in range(num_q):
            if raw_boxes[i] is not None:
                continue
            # Find nearest valid neighbor
            prev_end = None
            next_start = None
            for j in range(i - 1, -1, -1):
                if raw_boxes[j]:
                    prev_end = raw_boxes[j][2]
                    break
            for j in range(i + 1, num_q):
                if raw_boxes[j]:
                    next_start = raw_boxes[j][0]
                    break
            if prev_end is not None:
                ymin = prev_end + 5
            elif next_start is not None:
                ymin = next_start - avg_h - 5
            else:
                ymin = 50
            ymin = max(0, ymin)
            ymax = min(1000, ymin + avg_h)
            raw_boxes[i] = (ymin, 10, ymax, 850)

    # ── Fix overlaps (push down) ──
    # Sort by ymin, fix overlaps
    indexed = list(enumerate(raw_boxes))
    indexed.sort(key=lambda x: x[1][0])
    for k in range(1, len(indexed)):
        prev_idx, prev_box = indexed[k - 1]
        curr_idx, curr_box = indexed[k]
        if curr_box[0] < prev_box[2] + 2:
            gap = (prev_box[2] + curr_box[0]) / 2
            new_prev = (prev_box[0], prev_box[1], gap - 1, prev_box[3])
            new_curr = (gap + 1, curr_box[1], curr_box[2], curr_box[3])
            indexed[k - 1] = (prev_idx, new_prev)
            indexed[k] = (curr_idx, new_curr)

    # Write back
    for idx, box in indexed:
        raw_boxes[idx] = box

    # ── Convert to 0-1 normalized and assign ──
    for i in range(num_q):
        ymin, xmin, ymax, xmax = raw_boxes[i]
        questions[i]["bbox_norm"] = [ymin / 1000, xmin / 1000, ymax / 1000, xmax / 1000]

        # Normalize answer_box too (legacy, kept for compat)
        ab = questions[i].get("answer_box")
        if ab and isinstance(ab, list) and len(ab) >= 4:
            questions[i]["answer_box_norm"] = [float(v) / 1000 for v in ab[:4]]
        else:
            questions[i]["answer_box_norm"] = None

        # Normalize errors array — supports v2 {location, highlight} object shape
        # and legacy {pin_point, highlight_box} list shape
        errors = questions[i].get("errors", [])
        if isinstance(errors, list):
            for err in errors:
                loc = err.get("location")
                if isinstance(loc, dict) and "x" in loc and "y" in loc:
                    err["pin_point_norm"] = [float(loc["y"]), float(loc["x"])]
                else:
                    pp = err.get("pin_point")
                    if pp and isinstance(pp, list) and len(pp) >= 2:
                        err["pin_point_norm"] = [float(pp[0]) / 1000, float(pp[1]) / 1000]
                    else:
                        err["pin_point_norm"] = None

                hl = err.get("highlight")
                if isinstance(hl, dict) and all(k in hl for k in ("x", "y", "w", "h")):
                    x = float(hl["x"]); y = float(hl["y"])
                    w = float(hl["w"]); h = float(hl["h"])
                    err["highlight_box_norm"] = [y, x, y + h, x + w]
                else:
                    hb = err.get("highlight_box")
                    if hb and isinstance(hb, list) and len(hb) >= 4:
                        err["highlight_box_norm"] = [float(v) / 1000 for v in hb[:4]]
                    else:
                        err["highlight_box_norm"] = None

                # New v2 fields — pass through, coerce stepRef to int
                if "stepRef" in err and err["stepRef"] is not None:
                    try:
                        err["stepRef"] = int(err["stepRef"])
                    except (TypeError, ValueError):
                        err["stepRef"] = None
            questions[i]["errors"] = errors

    # ── Log ──
    print(f"[EVALUATE] Sanitized bboxes ({num_q} questions):")
    for q in questions:
        bb = q.get("bbox_norm", [0, 0, 0, 0])
        errs = q.get("errors", [])
        err_str = f" errors={len(errs)}" if errs else ""
        print(f"  Q{q.get('number', '?')}: y=[{bb[0]:.3f}, {bb[2]:.3f}] "
              f"x=[{bb[1]:.3f}, {bb[3]:.3f}]{err_str}")
        for e in errs:
            pp = e.get("pin_point_norm")
            pp_str = f"pin=[{pp[0]:.3f},{pp[1]:.3f}]" if pp else "no-pin"
            print(f"    {e.get('error_type','?')}: {pp_str}")

    return questions


async def _load_template_questions(req: EvaluateRequest, db: AsyncSession) -> tuple[list[dict], dict]:
    """
    Resolve the question set for this evaluation call.
    Returns (questions_list, meta_dict).
    meta_dict: {worksheetTitle, subject, chapter, topic}
    """
    if req.templateId:
        result = await db.execute(select(WorksheetTemplate).where(WorksheetTemplate.id == req.templateId))
        tpl = result.scalar_one_or_none()
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")
        qs = json.loads(tpl.questions_json)
        meta = {
            "worksheetTitle": tpl.title,
            "subject": tpl.subject,
            "chapter": tpl.chapter,
            "topic": tpl.topic,
        }
        return qs, meta

    if req.questions:
        # Validate inline
        validated = []
        for q in req.questions:
            try:
                tq = TemplateQuestion(**q)
                validated.append(tq.model_dump())
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid question: {e}")
        meta = {
            "worksheetTitle": req.worksheetTitle or "Untitled Worksheet",
            "subject": req.subject,
            "chapter": req.chapter,
            "topic": req.topic,
        }
        return validated, meta

    raise HTTPException(
        status_code=400,
        detail="Must provide either templateId or questions array",
    )


@router.post("/evaluate")
async def evaluate(req: EvaluateRequest, db: AsyncSession = Depends(get_db)):
    from gemini_client import get_client, MODEL, EVALUATE_PROMPT, EVALUATE_PROMPT_V2
    from google.genai import types

    client = get_client()
    if not client:
        raise HTTPException(status_code=503, detail="Gemini API key not configured. Set GEMINI_API_KEY in .env")

    raw_bytes = _validate_image(req.imageBase64, req.mimeType)

    version = (req.promptVersion or "v2").lower()

    # Template is required for v2 only; v1 reads full worksheet directly.
    if version == "v1":
        template_questions = []
        meta = {
            "worksheetTitle": req.worksheetTitle or "Untitled Worksheet",
            "subject": req.subject,
            "chapter": req.chapter,
            "topic": req.topic,
        }
    else:
        template_questions, meta = await _load_template_questions(req, db)

    if version == "v1":
        full_prompt = EVALUATE_PROMPT
    else:
        input_json = {
            "grade": req.grade or 0,
            "subject": (meta.get("subject") or req.subject or "").lower() or "unknown",
            "page_number": req.pageNumber or 1,
            "questions": template_questions,
        }
        questions_json_str = json.dumps(input_json, ensure_ascii=False, indent=2)
        full_prompt = (
            EVALUATE_PROMPT_V2
            + "\n\n---\nPROVIDED INPUT JSON:\n"
            + questions_json_str
        )
    print(f"[EVALUATE] Using prompt version={version}")

    image_part = types.Part.from_bytes(data=raw_bytes, mime_type=req.mimeType)

    config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_budget=4096),
        response_mime_type="application/json",
        temperature=0.3,  # lower for deterministic OCR + grading
    )

    try:
        data = await _call_gemini_with_retry(
            client, MODEL, [full_prompt, image_part], config
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="AI returned invalid response. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)}")

    # Sanitize bboxes — keep Gemini positions, just fix issues
    if "questions" in data and isinstance(data["questions"], list):
        data["questions"] = _sanitize_bboxes(data["questions"])

    matched = len(data.get("questions", []))
    if matched == 0:
        print(f"[EVALUATE] No handwritten answers matched the template "
              f"({len(template_questions)} provided). Likely mismatched template.")

    # Attach meta (worksheet title, subject etc.) from template/inline input
    return {"success": True, **meta, **data}
