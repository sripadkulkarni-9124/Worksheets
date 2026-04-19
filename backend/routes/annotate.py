"""
Annotation mark generator — IntelGrader-style pinpoint error annotations.
No Gemini call. Uses Gemini's error pins + bounding boxes from evaluate.

Generates:
  - error_pin: dot + dashed leader line + label pill for each specific error
  - highlight_box: small tight rect around wrong value/expression
  - score_strip: Q1 3/3, Q2 0/2 etc. pills for top strip
  - tick/cross: small symbol near question number area
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

STATUS_COLOR = {
    "correct":           "#22C55E",
    "incorrect":         "#EF4444",
    "partially_correct": "#F97316",
    "partial":           "#F97316",
    "unanswered":        "#9CA3AF",
}

# Label offset from pin — how far right the label floats
LABEL_OFFSET_X = 0.12
LABEL_OFFSET_Y = -0.015


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
    num_q = len(req.questions)

    for qi, q in enumerate(req.questions):
        qnum = _qnum(q.get("number", qi + 1))
        status = q.get("status", "unanswered")
        color = STATUS_COLOR.get(status, "#9CA3AF")
        marks_awarded = q.get("marks_obtained", q.get("marks_awarded", 0))
        marks_possible = q.get("max_marks", q.get("marks_possible", 1))

        # bbox_norm: [ymin, xmin, ymax, xmax] on 0-1 scale (full question block)
        bb = q.get("bbox_norm", [])
        if bb and len(bb) == 4:
            ymin, xmin, ymax, xmax = bb
        else:
            slot = 0.886 / num_q
            ymin = 0.084 + qi * slot
            ymax = ymin + slot - 0.01
            xmin = 0.01
            xmax = 0.85

        is_wrong = status in ("incorrect", "partially_correct", "partial")

        # ── SCORE STRIP pill ──
        marks.append({
            "type": "score_pill",
            "qi": qi,
            "label": f"Q{qnum}",
            "score_text": f"{marks_awarded}/{marks_possible}",
            "status": status,
            "color": color,
        })

        # ── ERROR PINS — one per specific error ──
        errors = q.get("errors", [])
        if is_wrong and errors:
            for ei, err in enumerate(errors):
                pin_norm = err.get("pin_point_norm")
                if not pin_norm or len(pin_norm) < 2:
                    continue

                pin_y, pin_x = pin_norm[0], pin_norm[1]
                error_type = err.get("error_type", "Error")
                description = err.get("description", "")

                # Label position — float to right of pin, stagger vertically
                label_x = min(pin_x + LABEL_OFFSET_X, 0.92)
                label_y = pin_y + LABEL_OFFSET_Y + ei * 0.03

                marks.append({
                    "type": "error_pin",
                    "pin_x": pin_x,
                    "pin_y": pin_y,
                    "label_x": label_x,
                    "label_y": label_y,
                    "error_type": error_type,
                    "description": description,
                    "color": color,
                    "status": status,
                    "label": f"Q{qnum}",
                })

                # Highlight box — tight around wrong value
                hb = err.get("highlight_box_norm")
                if hb and len(hb) == 4:
                    hy, hx, hy2, hx2 = hb
                    marks.append({
                        "type": "highlight_box",
                        "x": hx, "y": hy,
                        "w": hx2 - hx, "h": hy2 - hy,
                        "color": color,
                        "status": status,
                        "label": f"Q{qnum}",
                    })

        elif is_wrong and not errors:
            # Fallback: no specific errors from Gemini — use answer_box or bbox center
            ab = q.get("answer_box_norm")
            if ab and len(ab) == 4:
                ay, ax, ay2, ax2 = ab
                pin_y = (ay + ay2) / 2
                pin_x = (ax + ax2) / 2
            else:
                pin_y = (ymin + ymax) / 2
                pin_x = (xmin + xmax) / 2

            label_x = min(pin_x + LABEL_OFFSET_X, 0.92)
            label_y = pin_y + LABEL_OFFSET_Y

            error_label = "Incorrect" if status == "incorrect" else "Partially Correct"
            marks.append({
                "type": "error_pin",
                "pin_x": pin_x,
                "pin_y": pin_y,
                "label_x": label_x,
                "label_y": label_y,
                "error_type": error_label,
                "description": q.get("feedback", ""),
                "color": color,
                "status": status,
                "label": f"Q{qnum}",
            })

        # ── TICK or CROSS near question number ──
        # Place near top-left of question bbox
        sym_x = xmin + 0.01
        sym_y = ymin + 0.01
        if status == "correct":
            marks.append({"type": "tick", "x": sym_x, "y": sym_y, "color": color})
        elif status in ("incorrect", "unanswered"):
            marks.append({"type": "cross", "x": sym_x, "y": sym_y, "color": color})
        elif is_wrong:
            marks.append({"type": "tick", "x": sym_x, "y": sym_y, "color": "#F97316"})

    # Log
    pin_count = sum(1 for m in marks if m["type"] == "error_pin")
    hb_count = sum(1 for m in marks if m["type"] == "highlight_box")
    print(f"[ANNOTATE] Generated {len(marks)} marks: {pin_count} pins, {hb_count} highlights, {num_q} score pills")
    for m in marks:
        if m["type"] == "error_pin":
            print(f"  pin {m['label']}: ({m['pin_x']:.3f},{m['pin_y']:.3f}) → {m['error_type']}")

    return {"marks": marks}
