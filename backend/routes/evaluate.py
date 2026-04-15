from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json
import asyncio

router = APIRouter()


class EvaluateRequest(BaseModel):
    imageBase64: str
    mimeType: str = "image/jpeg"


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
    raw_boxes = []  # (ymin, xmin, ymax, xmax) or None
    for q in questions:
        bb = q.get("box_2d") or q.get("bbox")
        if bb and isinstance(bb, list) and len(bb) >= 4:
            raw_boxes.append(tuple(float(v) for v in bb[:4]))
        elif bb and isinstance(bb, list) and len(bb) == 2:
            # Legacy [y_start, y_end] — add default X
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

        # Normalize answer_box too (exact spot of student's answer)
        ab = questions[i].get("answer_box")
        if ab and isinstance(ab, list) and len(ab) >= 4:
            questions[i]["answer_box_norm"] = [float(v) / 1000 for v in ab[:4]]
        else:
            questions[i]["answer_box_norm"] = None

    # ── Log ──
    print(f"[EVALUATE] Sanitized bboxes ({num_q} questions):")
    for q in questions:
        bb = q.get("bbox_norm", [0, 0, 0, 0])
        ab = q.get("answer_box_norm")
        ab_str = f" ans=[{ab[0]:.3f},{ab[1]:.3f},{ab[2]:.3f},{ab[3]:.3f}]" if ab else ""
        print(f"  Q{q.get('number', '?')}: y=[{bb[0]:.3f}, {bb[2]:.3f}] "
              f"x=[{bb[1]:.3f}, {bb[3]:.3f}]{ab_str}")

    return questions


@router.post("/evaluate")
async def evaluate(req: EvaluateRequest):
    from gemini_client import get_client, MODEL, EVALUATE_PROMPT
    from google.genai import types

    client = get_client()
    if not client:
        raise HTTPException(status_code=503, detail="Gemini API key not configured. Set GEMINI_API_KEY in .env")

    image_part = types.Part.from_bytes(
        data=__import__('base64').b64decode(req.imageBase64),
        mime_type=req.mimeType
    )

    config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_budget=4096),
        response_mime_type="application/json",
        temperature=0.5,
    )

    try:
        data = await _call_gemini_with_retry(
            client, MODEL, [EVALUATE_PROMPT, image_part], config
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="AI returned invalid response. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)}")

    # Sanitize bboxes — keep Gemini positions, just fix issues
    if "questions" in data and isinstance(data["questions"], list):
        data["questions"] = _sanitize_bboxes(data["questions"])

    return {"success": True, **data}
