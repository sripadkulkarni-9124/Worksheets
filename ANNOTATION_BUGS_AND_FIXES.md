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

---

# Session 2 — IntelGrader-style Rewrite + Stabilization

## Bug: `_stabilize_bboxes` Redistributed Y Positions Evenly

### Symptom
Bboxes did not align with printed dashed question borders even after switching to native 0-1000 format. They were evenly distributed regardless of Gemini's actual output.

### Root Cause
`_stabilize_bboxes()` in `evaluate.py` took Gemini's y-values and **redistributed them evenly across [60, 975] window**, discarding the actual positions Gemini detected.

### Fix
Replaced with `_sanitize_bboxes()` that keeps Gemini's raw positions. Only fixes:
- Clamps to `[0, 1000]`
- Swaps `ymin/ymax` if inverted (min height 50)
- Auto-detects 0-100 scale (multiplies ×10)
- Interpolates missing boxes from neighbors (avg_h)
- Fixes overlaps by splitting gap at midpoint between adjacent boxes

Output: `bbox_norm = [ymin, xmin, ymax, xmax]` on 0-1 scale.

---

## Feature: Pinpoint Error Location (IntelGrader Style)

### Motivation
Dashed bbox around full question wasn't granular enough. User wanted red dot at the EXACT wrong digit/sign + dashed leader line + floating label pill ("Calculation Error", "Concept Error", etc.) like intelgrader.com.

### Implementation

**Gemini prompt** — added STEP 5 — PINPOINT ERRORS. Per wrong/partial question, return `errors[]` array, each with:
- `error_type`: short label ("Calculation Error", "Concept Error", "Sign Error", "Missing Step", "Wrong Formula", "Missing Root", "Result Error")
- `pin_point`: `[y, x]` on 0-1000 — exact pixel of the mistake
- `highlight_box`: `[ymin, xmin, ymax, xmax]` on 0-1000 — tight rect around wrong value (nullable)
- `description`: 1 sentence explanation

**evaluate.py** — `_sanitize_bboxes` now normalizes each error's `pin_point_norm` and `highlight_box_norm` to 0-1 scale.

**annotate.py** — rewrote to emit new mark types:
- `bbox` — dashed outline per question (all statuses), matches printed border
- `score_pill` — Q1 3/3 pill for top strip
- `error_pin` — dot at `pin_x, pin_y` + dashed leader line + label pill at `label_x, label_y`
- `highlight_box` — thin colored rect around wrong value
- `badge` — ✓/✗/~ circle at top-right of bbox with marks awarded/possible

**AnnotationStage.tsx** — 6 Konva layers:
| Layer | Purpose |
|-------|---------|
| 0 | Score strip (44px top bar with pills) |
| 1 | Image (contain-fit, centered) |
| 2 | Bbox dashed outlines |
| 3 | Highlight boxes |
| 4 | Error pins (Circle + Line + Rect + Text group) |
| 5 | Badges (Circle + symbol + score text + hit area) |

Tick/cross polylines removed (replaced by badges).

---

## Bug: Gemini Split Sub-parts into Separate Questions

### Symptom
Q3 had sub-parts 3.1, 3.2 → Gemini returned 7 questions instead of 3. Each sub-part got own entry, bbox, badge.

### Fix
Added **STEP 1 — COUNT THE QUESTIONS** to prompt:
- Count ONLY main printed question numbers
- Sub-parts like 1.a, 1.b, 3.1, 3.2 are NOT separate questions
- NEVER split sub-parts into separate question entries
- For questions with sub-parts, combine ALL sub-part answers into ONE `studentAnswer`

Verified via backend logs: new scan returns 3 questions, old scan had 7.

---

## Bug: Bbox Width Wider Than Printed Border

### Symptom
Gemini returned `x=[0.028, 0.975]` for every question — nearly full image width. But printed dashed borders are indented ~5-8% from page edges. Bboxes extended ~3-5% beyond printed border on each side.

### Attempted Fix 1: x-inset Heuristic (REMOVED)
Added logic in `_sanitize_bboxes`: if all boxes share same x range (variance < 30) spanning > 900 on 0-1000, shrink by 15 (1.5%) each side.

### Why Removed
Fragile. Triggered on legitimate full-width worksheets too. Hardcoded inset didn't match different worksheet templates. Made boxes too narrow in some cases.

### Current Fix
Prompt hardening. Explicit wording:
```
box_2d — MUST match the PRINTED dashed/solid border around the question
  - Align box edges EXACTLY on the printed border lines, not outside them
  - ymin = top border line, ymax = bottom border line
  - xmin = left border line, xmax = right border line
  - Do NOT extend the box beyond the printed borders
```
Result after prompt fix: `x=[0.056, 0.947]` — much closer to printed borders.

---

## Bug: Reannotate Loop on Every Page Load

### Symptom
Every time `/evaluate/:id` loaded, backend re-ran `/api/annotate` even though marks were already saved. Log showed repeated `[ANNOTATE] Generated 19 marks` on every page refresh.

### Root Cause
`Evaluate.tsx` line 114 compared total mark count to question count:
```ts
const existingPills = autoMarks.filter(m => m.type === 'score_pill' || m.type === 'bbox')
const needsReannotate = existingPills.length !== questions.length
```
But backend now emits BOTH a `bbox` AND a `score_pill` per question. So `existingPills.length = 2 × questions.length` → mismatch → reannotate every time.

### Fix
Count only `score_pill` (one per question). Fallback to `bbox` count for old sessions without pills:
```ts
const pillCount = autoMarks.filter(m => m.type === 'score_pill').length
const bboxCount = autoMarks.filter(m => m.type === 'bbox').length
const markCount = pillCount || bboxCount
const needsReannotate = markCount === 0 || markCount !== questions.length
```

---

## Bug: Image Overflowed Container

### Symptom
On some worksheet aspects the worksheet image was larger than the left panel, bbox outlines and badges cut off. Container didn't clip child Stage.

### Root Cause
Left panel div had `flex flex-col` but no `min-h-0` or `overflow-hidden`. Flex children can grow past their parent in column layout unless `min-h-0` is set.

### Fix
Added `min-h-0 overflow-hidden` to left panel:
```tsx
<div className="w-[52%] flex flex-col border-r border-white/10 bg-[#111827] min-h-0 overflow-hidden">
```

Also fixed vertical centering — previously image started right below 44px strip, leaving empty space at bottom if image was short. Now:
```tsx
const oy = STRIP_H + Math.floor((availH - ih) / 2)
```

---

## Bug: Badge Circles Clipped at Image Right Edge

### Symptom
Badge circles positioned at `xmax + 0.02` landed at `x ≈ 1.0` on normalized scale, then got cut off by Stage width.

### Fix
Clamp badge x to 0.96 max in annotate.py:
```python
badge_x = min(xmax + 0.02, 0.96)
```

---

## Config Changes Across Session

| Change | File | Reason |
|--------|------|--------|
| Added STEP 1 (count questions, no sub-part split) | `gemini_client.py` | Fix Q3 split into 3.1/3.2 |
| Added STEP 5 (pinpoint errors with pin_point + highlight_box) | `gemini_client.py` | Enable IntelGrader-style markers |
| Added `marks_possible` + `marks_awarded` to output | `gemini_client.py` | Per-question score display |
| Replaced `_stabilize_bboxes` with `_sanitize_bboxes` | `evaluate.py` | Keep raw Gemini positions, only fix issues |
| Added `errors[].pin_point_norm` + `errors[].highlight_box_norm` normalization | `evaluate.py` | Support pinpoint markers |
| Rewrote `annotate.py` — new mark types: `error_pin`, `highlight_box`, `score_pill` | `annotate.py` | IntelGrader-style rendering |
| Added `badge` mark back (had been removed in favor of tick/cross polylines) | `annotate.py` | Per user: keep badges, drop tick marks |
| Clamped badge x to 0.96 | `annotate.py` | Prevent right-edge clipping |
| Removed `tick` / `cross` polyline marks | `annotate.py` | Replaced by badges |
| Removed x-inset heuristic | `evaluate.py` | Too aggressive, prompt handles it now |
| Added `min-h-0 overflow-hidden` to left panel | `Evaluate.tsx` | Fix flex container overflow |
| Vertical-center image below score strip | `AnnotationStage.tsx` | Fix empty bottom space |
| Fixed reannotate loop (count `score_pill` only) | `Evaluate.tsx` | Prevent re-call on every page load |
| Added `ErrorDetail` interface, extended `AutoMark` union | `types.ts` | New mark types |
| Added `marks_possible`, `marks_awarded`, `errors[]` to `EvaluatedQuestion` | `types.ts` | Match Gemini output |

---

## Open Issues

1. **Bbox width still slightly wider than printed border** on some worksheets (e.g. colorful templates with thicker borders). Prompt improvement partial. Future: CV2 border detection to snap to actual printed edges.
2. **Error pin label positioning**: currently labels float to the right at fixed offset (0.12). If multiple errors per question, labels can overlap. Future: collision detection + re-layout.
3. **Badge placement** outside image area when xmax near 1.0. Currently clamped to 0.96 but ideally should reposition (e.g. inside bbox at top-right corner).
4. **Legacy sessions** don't have score_pill marks → re-annotation triggered on load. Fine for now, may want migration script for bulk update.
