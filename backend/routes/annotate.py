"""
Annotation mark generator — converts evaluate results (with bbox) into canvas marks.
No Gemini call. Uses fixed X layout + bbox [y_start, y_end] from evaluate.
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# Fixed X layout on 0-1 scale
X_LEFT  = 0.01   # left edge of border rect
X_WIDTH = 0.84   # border rect width (1% to 85%)
TICK_X  = 0.88   # tick/cross X position (right margin)
BADGE_X = 0.88   # badge X position

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

        # bbox from evaluate: [y_start, y_end] on 0-1000 scale
        bbox = q.get("bbox", [])
        if not bbox or len(bbox) < 2:
            # Fallback: even distribution
            num_q = len(req.questions)
            slot = 0.886 / num_q
            y0 = 0.084 + qi * slot
            y1 = y0 + slot - 0.01
        else:
            y0 = bbox[0] / 1000.0
            y1 = bbox[1] / 1000.0

        h = y1 - y0
        mid_y = y0 + h / 2

        # 1. BBOX — colored border rect (1% to 85% width)
        marks.append({
            "type": "bbox",
            "x": X_LEFT, "y": y0,
            "w": X_WIDTH, "h": h,
            "color": color, "status": status, "label": f"Q{qnum}",
        })

        # 2. BADGE — right margin, vertically centered
        marks.append({
            "type": "badge",
            "x": BADGE_X, "y": mid_y,
            "status": status, "color": color, "label": f"Q{qnum}",
            "marks_awarded": q.get("marks_obtained", q.get("marks_awarded", 0)),
            "marks_possible": q.get("max_marks", q.get("marks_possible", 1)),
        })

        # 3. TICK or CROSS — at 88% width, vertically centered
        if status == "correct":
            marks.append({"type": "tick", "x": TICK_X, "y": mid_y, "color": color})
        elif status in ("incorrect", "unanswered"):
            marks.append({"type": "cross", "x": TICK_X, "y": mid_y, "color": color})
        elif status in ("partially_correct", "partial"):
            marks.append({"type": "tick", "x": TICK_X, "y": mid_y, "color": "#F97316"})

        # 4. DASHED ELLIPSE over answer area (bottom 30% of block) for wrong answers
        if status in ("incorrect", "partially_correct", "partial"):
            ellipse_y = y0 + h * 0.65  # center of bottom 30%
            ellipse_h = h * 0.25
            marks.append({
                "type": "error_highlight",
                "x": X_LEFT + 0.02, "y": ellipse_y - ellipse_h / 2,
                "w": X_WIDTH - 0.04, "h": ellipse_h,
                "color": color, "status": status,
                "label": q.get("feedback", ""),
            })

    print(f"[ANNOTATE] Generated {len(marks)} marks for {len(req.questions)} questions (from evaluate bbox)")
    for m in marks:
        if m["type"] == "bbox":
            print(f"  {m['label']}: y={m['y']:.3f} h={m['h']:.3f} bottom={m['y']+m['h']:.3f} status={m['status']}")

    return {"marks": marks}
