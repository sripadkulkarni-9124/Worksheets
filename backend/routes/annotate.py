"""
Annotation mark generator — converts evaluate results (with bbox_norm) into canvas marks.
No Gemini call. Uses Gemini's actual bounding box positions from evaluate.
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# Badge/tick offset from bbox right edge
BADGE_OFFSET = 0.03  # 3% right of bbox right edge

STATUS_COLOR = {
    "correct":           "#22C55E",
    "incorrect":         "#EF4444",
    "partially_correct": "#F97316",
    "partial":           "#F97316",
    "unanswered":        "#9CA3AF",
}


class AnnotateRequest(BaseModel):
    imageBase64: str
    mimeType: str = "image/jpeg"
    questions: list[dict]


def _qnum(val) -> str:
    s = str(val)
    return s[:-2] if s.endswith('.0') else s


@router.post("/annotate")
async def annotate(req: AnnotateRequest):
    if not req.questions:
        return {"marks": []}

    marks: list[dict] = []

    for qi, q in enumerate(req.questions):
        qnum = _qnum(q.get("number", qi + 1))
        status = q.get("status", "unanswered")
        color = STATUS_COLOR.get(status, "#9CA3AF")

        # bbox_norm: [ymin, xmin, ymax, xmax] on 0-1 scale (full question block)
        bb = q.get("bbox_norm", [])
        if bb and len(bb) == 4:
            ymin, xmin, ymax, xmax = bb
        else:
            num_q = len(req.questions)
            slot = 0.886 / num_q
            ymin = 0.084 + qi * slot
            ymax = ymin + slot - 0.01
            xmin = 0.01
            xmax = 0.85

        # answer_box_norm: [ymin, xmin, ymax, xmax] tight around student's answer
        ab = q.get("answer_box_norm")

        # ── ONE BBOX per question ──
        # Wrong/partial → use answer_box (tight around wrong answer) with filled highlight
        # Correct → use full question box_2d with border only
        is_wrong = status in ("incorrect", "partially_correct", "partial")

        if is_wrong and ab and len(ab) == 4:
            # Tight box around wrong answer
            by, bx, by2, bx2 = ab
        else:
            # Full question block
            by, bx, by2, bx2 = ymin, xmin, ymax, xmax

        bw = bx2 - bx
        bh = by2 - by
        mid_y = by + bh / 2
        badge_x = min(bx2 + BADGE_OFFSET, 0.96)

        marks.append({
            "type": "bbox",
            "x": bx, "y": by,
            "w": bw, "h": bh,
            "color": color, "status": status, "label": f"Q{qnum}",
            "filled": is_wrong,  # filled highlight for wrong, border-only for correct
        })

        # BADGE — right of bbox
        marks.append({
            "type": "badge",
            "x": badge_x, "y": mid_y,
            "status": status, "color": color, "label": f"Q{qnum}",
            "marks_awarded": q.get("marks_obtained", q.get("marks_awarded", 0)),
            "marks_possible": q.get("max_marks", q.get("marks_possible", 1)),
        })

        # TICK or CROSS
        if status == "correct":
            marks.append({"type": "tick", "x": badge_x, "y": mid_y, "color": color})
        elif status in ("incorrect", "unanswered"):
            marks.append({"type": "cross", "x": badge_x, "y": mid_y, "color": color})
        elif status in ("partially_correct", "partial"):
            marks.append({"type": "tick", "x": badge_x, "y": mid_y, "color": "#F97316"})

    print(f"[ANNOTATE] Generated {len(marks)} marks for {len(req.questions)} questions")
    for m in marks:
        if m["type"] == "bbox":
            print(f"  {m['label']}: x={m['x']:.3f} y={m['y']:.3f} w={m['w']:.3f} h={m['h']:.3f} status={m['status']}")

    return {"marks": marks}
