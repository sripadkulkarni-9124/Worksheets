# VED Annotation System — Bugs, Failed Approaches & Fixes

## Coordinate System Evolution

### Attempt 1: 0-1000 Normalized (ymin, xmin, ymax, xmax)
- **What**: Gemini asked to return coords in 0-1000 space as `ymin/xmin/ymax/xmax`
- **Problem**: Small elements (checkboxes, True/False ticks) got wildly imprecise coords. Error highlights landed on wrong rows.
- **Discarded because**: Precision too low for small answer areas.

### Attempt 2: Custom 0-1 Relative (x, y, w, h)
- **What**: Prompt asked Gemini for `{x, y, w, h}` as floats 0.0–1.0
- **Problem**: **All coordinates compressed into top ~50% of image.** Q1 started at y=0.07 (header zone), Q5 ended at y=0.52. Full page content should span y=0.13–0.95.
- **Root cause**: Gemini 2.5 Flash doesn't reliably produce custom coordinate formats. When asked for 0-1 floats, it returns values that are systematically scaled wrong — approximately half the correct y-values.
- **Evidence**: Backend logs showed `Q1: y=0.071 h=0.086` but actual Q1 boundary starts at ~y=0.13 on 1200×1600 image.

### Attempt 3 (CURRENT): Gemini Native 0-1000 `[ymin, xmin, ymax, xmax]` arrays
- **What**: Switched prompt to request Gemini's **native bounding box format** — arrays of 4 integers 0–1000.
- **Result**: Coordinates now correct. Q1: y=130 (13%), Q5: y=750–920 (75–92%). Full page coverage.
- **Why this works**: `[ymin, xmin, ymax, xmax]` in 0-1000 is Gemini vision's internal representation. Model is trained to output this format accurately. Custom formats get mangled.

---

## Bug: Annotations Shifted Upward by ~1 Question Height

### Symptom
Every annotation (borders, badges, ticks) rendered one question higher than correct position. Header got Q1's green border. Q1 area got Q2's red border. Etc.

### Investigation
1. Checked Konva Stage origin — image at (0,0), overlays use same origin. **Not a rendering offset.**
2. Checked `rx()`/`ry()` helpers — multiply 0-1 by canvas dimensions. **Math correct.**
3. Checked container padding, CSS offsets — **none found.**
4. Dumped backend logs: Gemini returned `Q1: y=0.071` when actual boundary is at y≈0.15. **Gemini coords were wrong.**

### Root Cause
Custom 0-1 coordinate format. See "Attempt 2" above. Gemini compressed all y-values to roughly half their true positions.

### Fix
Switched to native `[ymin, xmin, ymax, xmax]` 0-1000 format. Added `_convert_1000_to_01()` converter in `routes/annotate.py` that handles both array format and dict format (with auto-detection of 0-1 vs 0-1000 scale).

---

## Bug: Border Color vs Badge Status Mismatch

### Symptom
Q2 had GREEN dashed border but ORANGE badge (~). Border and badge should always match.

### Root Cause
Two sources of truth: Gemini annotate returned its own `status` field per question, which could disagree with the evaluate result. Backend used annotate's status for bbox color but evaluate's status for badge.

### Fix
Single source of truth: `q["status"]` from evaluate result used for ALL marks (bbox, badge, tick/cross, error highlight). Annotate response only provides coordinates, not status judgments.

In `AnnotationStage.tsx`, added `getStatusForQi(qi)` that reads from `questions[qi].status` (evaluate result). All renderers (bbox, badge, callout) use this instead of `mark.color` or `mark.status`.

---

## Bug: Badges and Borders Clipped at Right Edge

### Symptom
Colored dashed borders extended to image right edge. Badge circles (positioned at right edge of bbox) got cut off by canvas boundary.

### Fix (two-part)

**Backend**: Added `MAX_RIGHT = 0.92` — clamp bbox right edge so badge has room:
```python
clamped_w = min(qbox["w"], MAX_RIGHT - qbox["x"])
```

**Frontend**: Added `BADGE_GUTTER_PX = 56` — Konva Stage is 56px wider than image. Image left-aligned, badges extend into gutter. Light gray background on gutter area.

```typescript
const imageWidth = containerSize.width - BADGE_GUTTER_PX
const stageWidth = imageWidth + BADGE_GUTTER_PX
```

---

## Bug: Answer Box Highlights Misaligned

### Symptom
Orange semi-transparent rectangle on wrong answers covered random areas instead of actual answer region. E.g., covered clock diagram instead of student's written answer.

### Root Cause
Gemini's answer_box coordinates for small/complex regions (diagrams, checkboxes) are imprecise.

### Fix
Added validation — only render error_highlight if:
1. `answer_box` is geometrically INSIDE `question_box` (with 2% tolerance)
2. `answer_box` area < 50% of `question_box` area (it's a sub-region, not whole question)

```python
if _is_inside(abox, qbox) and _box_area(abox) < _box_area(qbox) * 0.5:
    # render highlight
```

If validation fails, error highlight silently skipped. Tick/cross still placed using fallback position inside question box.

---

## Bug: Missing Question 5 Annotation

### Symptom
Q5 (diagram labeling question) had no colored border or badge.

### Root Cause
In old 0-1 custom format, Gemini returned Q5 coords that got filtered out by `_enforce_box_gaps()` (box too small after gap enforcement) or `_clamp_box()` (zero-width after clamping).

### Fix
1. New prompt explicitly says: "Your response MUST contain exactly {num_q} entries"
2. Added validation logging: when detected boxes < expected, log which Q numbers are missing
3. `_validate_and_fix_detections()` filters too-narrow (<0.3w) and too-large (>0.98w, >0.7h) boxes but keeps everything else
4. Minimum box sizes enforced: w≥0.05, h≥0.03

---

## Bug: Question Number Mismatch Between Evaluate and Annotate

### Symptom
Evaluate returned questions numbered `[1, 2, 3.1, 3.2, 4.1, 4.2, 5]`. Annotate also returned `[1, 2, 3.1, 3.2, 4.1, 4.2, 5]` — but Q3.1 and Q3.2 had identical `question_box` coords (same dashed border encloses both sub-questions).

### Impact
Two overlapping bboxes for Q3 area — one with `h=0.028` (gap-enforced to near-zero) and one with full height. Same for Q4.

### Current State
Not fully fixed. `_enforce_box_gaps()` shrinks first duplicate to minimum height. Visual result: thin sliver bbox for Q3.1, full bbox for Q3.2. Acceptable but not perfect.

### Potential Fix
Merge sub-question detections that share same `question_box` into one bbox. Apply combined status (worst status wins for border color).

---

## Bug: Angled Photo — Annotations Don't Trace Skewed Borders

### Symptom
Worksheet photographed at angle. Printed dashed borders are slanted. Konva draws axis-aligned rectangles. Left edge diverges from printed border, worse toward bottom.

### Failed Approach Considered: 4-Corner Polygon Detection
Ask Gemini for 4 corner points instead of axis-aligned bbox. Draw `Konva.Line` polygons.
- **Rejected because**: Gemini's 4-corner accuracy on skewed photos is worse than bbox accuracy. 8 coordinates per question = more error. Fill/highlight rendering harder with arbitrary quads.

### Fix: Backend Perspective Correction (OpenCV)
- `utils/perspective.py` — OpenCV-based paper boundary detection + perspective warp
- `routes/preprocess.py` — `POST /api/preprocess` endpoint
- Flow: capture → preprocess (dewarp) → evaluate → annotate → save
- Same corrected image used for Gemini AND frontend display
- Axis-aligned Konva rectangles now align with straightened printed borders
- Fallback: if paper boundary not found or skew <1°, use original image unchanged

**Detection method**: Multi-threshold Canny edge detection → contour finding → largest 4-sided contour with area >20% of image → order points → perspective transform.

**Result**: 1200×1600 angled photo → 1041×1525 corrected image. 1.5° skew corrected.

---

## Bug: Tailwind CSS Not Loading

### Symptom
Entire app rendered as unstyled text. No dark background, no cards, no layout.

### Investigation
- `index.css` has `@tailwind` directives ✓
- `tailwind.config.js` content paths correct ✓
- `postcss.config.js` has tailwindcss plugin ✓
- `main.tsx` imports `./index.css` ✓
- `node_modules/tailwindcss` exists ✓
- PostCSS processing test: 34KB output ✓
- `curl localhost:5173/src/index.css`: 36KB CSS served correctly ✓

### Root Cause
Stale Vite dev server. HMR broke after multiple file edits during session. CSS module loaded but styles not injected.

### Fix
Kill and restart Vite: `lsof -ti:5173 | xargs kill -9 && npx vite`

**Note**: This recurred multiple times during development. Frontend dev server fragile under rapid multi-file edits.

---

## Bug: Backend AutoMark Model Stale

### Symptom
`models.py` `AutoMark` had `x2, y2` fields (legacy), missing `w, h, status, label, marks_awarded, marks_possible`.

### Impact
No runtime error because routes used `list[dict]` not `list[AutoMark]`. But model was wrong documentation of the actual data shape.

### Fix
Updated `AutoMark` to match actual mark structure:
```python
class AutoMark(BaseModel):
    type: Literal['bbox', 'error_highlight', 'badge', 'tick', 'cross']
    x: float; y: float
    w: Optional[float]; h: Optional[float]
    color: Optional[str]; status: Optional[str]
    label: Optional[str]; error_type: Optional[str]
    marks_awarded: Optional[float]; marks_possible: Optional[float]
```

---

## Bug: Python .format() KeyError on Curly Braces

### Symptom
`PROMPT.format(q_context=...)` threw `KeyError` on `"number"`.

### Root Cause
Prompt template contained JSON examples with `{"number": ...}`. Python `.format()` interpreted `{number}` as a format placeholder.

### Fix
Double-escape all curly braces in JSON examples: `{{"number": ...}}`.

---

## Bug: Backend ModuleNotFoundError for fastapi

### Symptom
`python3 -m uvicorn main:app` failed with `ModuleNotFoundError: No module named 'fastapi'`.

### Root Cause
System python3 (via nvm shim) != python3 with pip packages installed.

### Fix
Use full path: `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 -m uvicorn main:app`

---

## Summary of Current Architecture

```
Photo → /api/preprocess (OpenCV dewarp)
     → /api/evaluate (Gemini 2.5 Flash — grades all questions)
     → /api/annotate (Gemini 2.5 Flash — native 0-1000 bbox detection)
     → /api/sessions (save corrected image + results + marks)
     → Evaluate.tsx → AnnotationStage.tsx (Konva 8-layer canvas)
```

Coordinates: Gemini returns `[ymin, xmin, ymax, xmax]` in 0-1000 → backend converts to `{x, y, w, h}` in 0-1 → frontend maps to pixels via `rx(rel) = rel * imageWidth`.
