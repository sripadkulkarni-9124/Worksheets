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


# ── Stable bbox normalization ──
# Content area on 0-1000 scale (where question boxes live)
CONTENT_TOP    = 60    # top of first question area
CONTENT_BOTTOM = 975   # bottom of last question area
MIN_GAP        = 12    # minimum gap between consecutive boxes

def _stabilize_bboxes(questions: list[dict]) -> list[dict]:
    """
    Stabilize Gemini's bbox output using proportional redistribution.

    Strategy:
    1. Parse raw bboxes, auto-detect scale
    2. Extract Gemini's RELATIVE proportions (which box is bigger/smaller)
    3. Redistribute into a FIXED content window [CONTENT_TOP, CONTENT_BOTTOM]
       using those proportions — this eliminates absolute offset drift
    4. Enforce minimum gaps, clamp to bounds
    5. Fall back to even distribution if no bbox data
    """
    num_q = len(questions)
    if num_q == 0:
        return questions

    # ── Step 1: Parse raw bboxes ──
    raw_boxes = []  # list of (y_start, y_end) or None
    for q in questions:
        bb = q.get("bbox")
        if bb and isinstance(bb, list) and len(bb) >= 2:
            raw_boxes.append((float(bb[0]), float(bb[1])))
        else:
            raw_boxes.append(None)

    # Auto-detect 0-100 scale
    all_vals = [v for pair in raw_boxes if pair for v in pair]
    scale = 1
    if all_vals and max(all_vals) <= 100:
        scale = 10
        print(f"[EVALUATE] Auto-detected 0-100 bbox scale, multiplying by 10")
        raw_boxes = [(s * scale, e * scale) if pair else None
                     for pair, (s, e) in zip(raw_boxes, [(b or (0, 0)) for b in raw_boxes])]
        # Fix: re-parse with scale
        raw_boxes = []
        for q in questions:
            bb = q.get("bbox")
            if bb and isinstance(bb, list) and len(bb) >= 2:
                raw_boxes.append((float(bb[0]) * scale, float(bb[1]) * scale))
            else:
                raw_boxes.append(None)

    valid_boxes = [(i, s, e) for i, pair in enumerate(raw_boxes)
                   if pair and pair[1] > pair[0]
                   for s, e in [pair]]

    print(f"[EVALUATE] Raw Gemini bboxes ({len(valid_boxes)}/{num_q} valid):")
    for i, s, e in valid_boxes:
        print(f"  Q{questions[i].get('number','?')}: [{s:.0f}, {e:.0f}] h={e-s:.0f}")

    # ── Step 2: Compute proportional heights ──
    content_span = CONTENT_BOTTOM - CONTENT_TOP
    total_gaps = (num_q - 1) * MIN_GAP
    usable_span = content_span - total_gaps

    if len(valid_boxes) >= 2:
        # Use Gemini's relative heights as weights
        heights = []
        for i in range(num_q):
            match = next((s, e) for j, s, e in valid_boxes if j == i) if any(j == i for j, _, _ in valid_boxes) else None
            if match:
                heights.append(match[1] - match[0])
            else:
                # Missing box — use median of known heights
                known_h = [e - s for _, s, e in valid_boxes]
                heights.append(sorted(known_h)[len(known_h) // 2])

        # Check if heights are roughly uniform (max/min ratio < 2x)
        # If so, use even distribution — more stable than Gemini's noisy heights
        h_sorted = sorted(heights)
        if h_sorted[0] > 0 and h_sorted[-1] / h_sorted[0] < 2.0:
            weights = [1.0 / num_q] * num_q
            print(f"[EVALUATE] Heights roughly uniform (ratio {h_sorted[-1]/h_sorted[0]:.1f}x) — using even distribution")
        else:
            # Genuinely different sizes — blend Gemini proportions with even (50/50)
            # This dampens outliers while preserving real size differences
            total_h = sum(heights)
            if total_h <= 0:
                weights = [1.0 / num_q] * num_q
            else:
                even_w = 1.0 / num_q
                gemini_w = [h / total_h for h in heights]
                weights = [(g * 0.5 + even_w * 0.5) for g in gemini_w]
                # Re-normalize
                ws = sum(weights)
                weights = [w / ws for w in weights]
            print(f"[EVALUATE] Height weights (blended): {[f'{w:.2f}' for w in weights]}")
    else:
        # No valid boxes or only 1 — even distribution
        weights = [1.0 / num_q] * num_q
        print(f"[EVALUATE] Using even distribution (insufficient bbox data)")

    # ── Step 3: Redistribute into fixed content window ──
    final_boxes = []
    y_cursor = CONTENT_TOP
    for i in range(num_q):
        box_h = usable_span * weights[i]
        # Enforce minimum height (at least 3% of content area)
        box_h = max(box_h, content_span * 0.03)
        y_start = y_cursor
        y_end = y_start + box_h
        final_boxes.append([y_start, y_end])
        y_cursor = y_end + MIN_GAP

    # ── Step 4: If we overshot, scale back proportionally ──
    if final_boxes and final_boxes[-1][1] > CONTENT_BOTTOM:
        overshoot = final_boxes[-1][1] - CONTENT_BOTTOM
        # Shrink all boxes proportionally
        shrink_per_box = overshoot / num_q
        y_cursor = CONTENT_TOP
        for i in range(num_q):
            box_h = (final_boxes[i][1] - final_boxes[i][0]) - shrink_per_box
            box_h = max(box_h, content_span * 0.03)
            final_boxes[i] = [y_cursor, y_cursor + box_h]
            y_cursor = final_boxes[i][1] + MIN_GAP

    # ── Step 5: Clamp final box to CONTENT_BOTTOM ──
    if final_boxes and final_boxes[-1][1] > CONTENT_BOTTOM:
        final_boxes[-1][1] = CONTENT_BOTTOM

    # ── Step 6: Assign back to questions ──
    # Sort questions by original bbox order (top to bottom) if available
    if valid_boxes:
        # Create index mapping: question index → vertical position
        order = list(range(num_q))
        # Sort by raw y_start (valid ones), put missing at end
        def sort_key(i):
            match = next(((s,) for j, s, e in valid_boxes if j == i), None)
            return match[0] if match else 9999
        order.sort(key=sort_key)
    else:
        order = list(range(num_q))

    for rank, qi in enumerate(order):
        questions[qi]["bbox"] = final_boxes[rank]

    # ── Log ──
    print(f"[EVALUATE] Stabilized bboxes ({num_q} questions):")
    for q in questions:
        bb = q.get("bbox", [0, 0])
        print(f"  Q{q.get('number', '?')}: [{bb[0]:.0f}, {bb[1]:.0f}] "
              f"→ y={bb[0]/1000:.3f}-{bb[1]/1000:.3f} h={((bb[1]-bb[0])/1000):.3f}")

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

    # Stabilize bboxes
    if "questions" in data and isinstance(data["questions"], list):
        data["questions"] = _stabilize_bboxes(data["questions"])

    return {"success": True, **data}
