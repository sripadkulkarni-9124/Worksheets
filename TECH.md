# VED Technical Documentation

## 1. System Overview

VED is a full-stack worksheet evaluation app. A student's handwritten worksheet is photographed, perspective-corrected, sent to Gemini 2.5 Flash for vision+reasoning, and rendered back with pinpoint error annotations overlaid on the original image.

**Design goal:** pixel-accurate error localization. The image sent to Gemini and the image rendered in the UI are byte-identical — same base64, same bytes, same aspect. Gemini's coordinate output (0-1000) is normalized to 0-1 floats and multiplied by rendered image dimensions on the frontend, so no resize mismatch is possible.

## 2. Requirements

### Functional

| # | Requirement | Status |
|---|-------------|--------|
| F1 | Upload worksheet via camera or file picker | ✅ |
| F2 | Auto-dewarp photographed paper (perspective correction) | ✅ |
| F3 | Detect and count questions (merge sub-parts like 3.1/3.2) | ✅ |
| F4 | Read handwritten student answers | ✅ |
| F5 | Grade each answer: correct / partially_correct / incorrect / unanswered | ✅ |
| F6 | Emit full-question bbox on 0-1000 scale | ✅ |
| F7 | Emit per-error `pin_point` + `highlight_box` + `error_type` label | ✅ |
| F8 | Render bbox outlines, pinpoint error markers, score pills, badges | ✅ |
| F9 | Per-question step-by-step solution + feedback + vedInsight | ✅ |
| F10 | Session persistence (SQLite) | ✅ |
| F11 | AI chat tutor scoped per question | ✅ |

### Non-functional

| # | Requirement | Target |
|---|-------------|--------|
| NF1 | Evaluation latency | < 15s end-to-end |
| NF2 | Image size sent to Gemini | = image bytes stored = image bytes rendered |
| NF3 | Bbox alignment accuracy | Match printed dashed borders within ±2% |
| NF4 | Render FPS | 60 FPS for annotation layers |
| NF5 | Mobile responsive | 360px+ width |
| NF6 | Retry on Gemini JSON parse fail | 1 retry with 1s backoff |

## 3. Architecture

### Components

```
┌──────────────────────────────────────────────────────────────────┐
│                         Frontend (:5173 / :8001)                   │
├──────────────────────────────────────────────────────────────────┤
│  Pages:                                                           │
│    Home.tsx         — landing + recent sessions + capture CTA     │
│    Evaluate.tsx     — 2-panel view: stage + Q&A                   │
│                                                                   │
│  Components:                                                      │
│    CaptureModal     — camera/file → base64                        │
│    AnnotationStage  — Konva canvas w/ 6 layers                    │
│    QAPanel          — right-side question detail                  │
│    Chat             — streaming chat tutor                        │
│                                                                   │
│  api.ts             — fetch wrappers for all endpoints            │
│  types.ts           — TypeScript interfaces (AutoMark,            │
│                       EvaluatedQuestion, ErrorDetail)              │
└──────────────────────────────────────────────────────────────────┘
                               │ Vite proxy /api → :8000
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         Backend (:8000)                            │
├──────────────────────────────────────────────────────────────────┤
│  main.py            — FastAPI app, route registration             │
│                                                                   │
│  routes/                                                          │
│    preprocess.py    — POST /preprocess  (OpenCV dewarp)           │
│    evaluate.py      — POST /evaluate    (Gemini + sanitize)       │
│    annotate.py      — POST /annotate    (marks generator)         │
│    sessions.py      — CRUD sessions                               │
│    chat.py          — POST /chat        (streaming Gemini)        │
│    reattempt.py     — POST /reattempt                             │
│                                                                   │
│  utils/                                                           │
│    perspective.py   — cv2 paper detection + warpPerspective       │
│    boundary_detector.py — (optional) page border detection        │
│                                                                   │
│  gemini_client.py   — genai.Client + EVALUATE_PROMPT + CHAT_SYS  │
│  database.py        — SQLite schema + CRUD                        │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Gemini 2.5 Flash    │
                    │  JSON mode           │
                    │  thinking_budget=4096│
                    │  temperature=0.5     │
                    └──────────────────────┘
```

## 4. Data Pipeline

### Capture
- `getUserMedia({ facingMode: 'environment', width: 1280, height: 960 })`
- Draw video frame to `<canvas>` → `canvas.toDataURL('image/jpeg', 0.92)`
- Output: `{ base64, mimeType, dataUrl }`

### Preprocess — `/preprocess`
- `cv2.imdecode` → grayscale
- Paper contour: 3 block sizes × 3 Canny thresholds, dilate, `approxPolyDP(ε=0.02×peri)`, area ≥ 20% of image
- Order corners (TL/TR/BR/BL)
- Skew check: skip if `< 1°`
- `getPerspectiveTransform` → `warpPerspective(img, M, (W,H))`
- Re-encode JPEG q=92
- Returns corrected base64 + dataUrl

### Evaluate — `/evaluate`
- Client: `google.genai.Client`
- Config: `GenerateContentConfig(thinking_config=ThinkingConfig(thinking_budget=4096), response_mime_type="application/json", temperature=0.5)`
- Input: `[EVALUATE_PROMPT, Part.from_bytes(image)]`
- Retry once on `json.JSONDecodeError`
- `_sanitize_bboxes()` post-processes:
  - Parse `box_2d` (or legacy `bbox`)
  - Auto-detect 0-100 scale (multiply ×10)
  - Clamp to `[0, 1000]`, swap ymin/ymax if inverted
  - Interpolate missing boxes from neighbors (avg_h)
  - Fix overlaps by splitting gap at midpoint
  - Normalize `errors[].pin_point` and `errors[].highlight_box` to 0-1
- Output: questions with `bbox_norm`, `errors[].pin_point_norm`, `errors[].highlight_box_norm`

### Annotate — `/annotate`
- No Gemini call. Pure math on sanitized questions.
- Per question emits:
  - `bbox`: full question dashed outline (all statuses)
  - `score_pill`: Q1 3/3 pill for top strip
  - `error_pin`: dot + dashed leader + label pill (wrong/partial only, per error)
  - `highlight_box`: tight rect around specific wrong value (wrong/partial only)
  - `badge`: ✓/✗/~ circle at top-right of bbox
- All coords normalized 0-1 floats.

### Render — `AnnotationStage.tsx`
- Contain-fit:
  ```
  aspect = natW / natH
  availH = containerH - STRIP_H (44)
  containerAspect = containerW / availH
  aspect > containerAspect → iw = containerW, ih = iw / aspect  (fit width)
  else                     → ih = availH, iw = ih * aspect       (fit height)
  ox = (containerW - iw) / 2
  oy = STRIP_H + (availH - ih) / 2  (center vertically below strip)
  ```
- Konva layers:
  | # | Layer | Listening | Purpose |
  |---|-------|-----------|---------|
  | 0 | Score strip | yes (pills) | Top bar with Q1 3/3 pills |
  | 1 | Image | no | `<KonvaImage>` at offsetX, offsetY |
  | 2 | Bbox outlines | yes (rects) | Dashed color border per question |
  | 3 | Highlight boxes | no | Thin rect around wrong values |
  | 4 | Error pins | no | Circle + dashed Line + Rect + Text |
  | 5 | Badges | yes (hit circle) | ✓/✗/~ circles with marks |

## 5. Coordinate System

### Contract

- **Gemini output**: `[ymin, xmin, ymax, xmax]` integers on **0-1000** scale (top-left origin).
- **Backend storage**: normalized to **0-1** floats in `bbox_norm`, `pin_point_norm`, `highlight_box_norm`.
- **Frontend render**: `px(norm) = norm * imageWidth`, `py(norm) = norm * imageHeight`.
- All layers share offset `(offsetX, offsetY)` — annotations always align with image regardless of container size or image aspect.

### Why It Works

Same base64 flows through every step:
- CaptureModal produces JPEG.
- preprocess may dewarp (produces new JPEG of computed size ≥ 800×600).
- Same bytes go to `/evaluate` and `/annotate` and are stored as `dataUrl`.
- Frontend loads `dataUrl` into `<img>` → `naturalWidth/naturalHeight` drives contain-fit.
- Normalization is relative, so any uniform scaling preserves alignment.

## 6. Gemini Prompt

Structure — 6 steps in `gemini_client.py`:

1. **COUNT QUESTIONS** — main numbers only, never split sub-parts
2. **READ IMAGE** — combine sub-part answers into one `studentAnswer`
3. **LOCATE** — emit `box_2d` matching PRINTED border exactly (not content area)
4. **EVALUATE** — status ∈ {correct, partially_correct, incorrect, unanswered}
5. **PINPOINT ERRORS** — for wrong/partial, emit `errors[]` with `error_type`, `pin_point`, `highlight_box`, `description`
6. **GENERATE CONTENT** — correctAnswer, feedback, vedInsight, steps, marks_awarded/possible

Output schema:
```json
{
  "worksheetTitle": "...",
  "subject": "...",
  "chapter": "...",
  "topic": "...",
  "questions": [
    {
      "number": 1,
      "questionText": "...",
      "studentAnswer": "...",
      "correctAnswer": "...",
      "status": "incorrect",
      "marks_possible": 3,
      "marks_awarded": 1,
      "feedback": "...",
      "vedInsight": "...",
      "steps": [{"title": "...", "points": ["..."]}],
      "box_2d": [ymin, xmin, ymax, xmax],
      "errors": [
        {
          "error_type": "Calculation Error",
          "pin_point": [y, x],
          "highlight_box": [ymin, xmin, ymax, xmax],
          "description": "..."
        }
      ]
    }
  ]
}
```

## 7. Mark Types (AutoMark)

| Type | Purpose | Required Fields |
|------|---------|-----------------|
| `bbox` | Dashed outline around full question | `x, y, w, h, qi, status, color` |
| `score_pill` | Top-strip score pill | `qi, label, score_text, status, color` |
| `error_pin` | Dot + leader line + label pill | `pin_x, pin_y, label_x, label_y, error_type, color` |
| `highlight_box` | Thin rect around wrong value | `x, y, w, h, color` |
| `badge` | Circle with ✓/✗/~ + score | `x, y, qi, status, color, marks_awarded, marks_possible` |

Legacy types kept for old sessions: `error_highlight`, `tick`, `cross`.

## 8. Database Schema (SQLite)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  image_data_url TEXT,    -- base64 dataUrl (1-5MB)
  result_json TEXT,        -- full evaluation result
  auto_marks_json TEXT,    -- marks array
  timestamp TEXT
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  question_num INTEGER,
  role TEXT,
  content TEXT,
  timestamp TEXT
);
```

## 9. API Reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/preprocess` | Perspective-correct image |
| `POST` | `/api/evaluate` | Gemini evaluation |
| `POST` | `/api/annotate` | Generate marks |
| `POST` | `/api/sessions` | Save session |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Fetch session |
| `PATCH` | `/api/sessions/:id/marks` | Update marks (re-annotation) |
| `POST` | `/api/chat` | Streaming tutor chat |
| `POST` | `/api/reattempt` | Submit reattempt answer |
| `POST` | `/api/chat-messages` | Save chat message |
| `GET` | `/api/chat-messages/:sessionId/:questionNum` | Fetch messages |

## 10. Known Issues / TODO

- Gemini bbox x-coords sometimes default to near-full-width (0.028-0.975). Mitigated by explicit prompt; previously had x-inset heuristic (removed).
- Fine-grained PATs need `Contents: Read and Write` for git push — classic PAT with `repo` scope works out of box.
- No offline mode. Every scan needs Gemini API.
- No batch grading UI (one worksheet at a time).
- Mobile camera quality varies by device — no auto-exposure/focus lock.

## 11. File Layout

```
worksheet_V2/
├── backend/
│   ├── main.py                 # FastAPI entry
│   ├── gemini_client.py        # Gemini client + prompts
│   ├── database.py             # SQLite
│   ├── requirements.txt
│   ├── routes/
│   │   ├── preprocess.py
│   │   ├── evaluate.py         # ★ Sanitize bboxes + errors
│   │   ├── annotate.py         # ★ Mark generator
│   │   ├── sessions.py
│   │   ├── chat.py
│   │   └── reattempt.py
│   ├── utils/
│   │   ├── perspective.py      # ★ OpenCV dewarp
│   │   └── boundary_detector.py
│   └── ved.db                  # SQLite file
│
├── frontend/
│   ├── vite.config.ts          # proxy /api → :8000
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── api.ts
│   │   ├── types.ts            # ★ AutoMark, ErrorDetail
│   │   ├── store.ts            # Zustand
│   │   ├── pages/
│   │   │   ├── Home.tsx        # ★ Orchestrates capture→evaluate→annotate
│   │   │   └── Evaluate.tsx    # 2-panel stage + Q&A
│   │   └── components/
│   │       ├── CaptureModal.tsx
│   │       ├── AnnotationStage.tsx   # ★ Konva canvas, 6 layers
│   │       ├── Upload/
│   │       ├── WorksheetViewer/
│   │       ├── QAPanel/
│   │       ├── Chat/
│   │       └── shared/
│
├── README.md
├── TECH.md                     # this file
└── ANNOTATION_BUGS_AND_FIXES.md
```

★ = touched frequently during annotation work.
