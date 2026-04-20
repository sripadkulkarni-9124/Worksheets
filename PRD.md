# VED — AI Worksheet Evaluator
## Product Requirements Document

| Field | Value |
|-------|-------|
| **Product** | VED (Visual Educational Dashboard) |
| **Version** | 2.0 |
| **Status** | Active development |
| **Owner** | Product Team |
| **Engineering Lead** | _TBD_ |
| **Design Lead** | _TBD_ |
| **Last Updated** | 2026-04-20 |
| **Repo** | https://github.com/sripadkulkarni-9124/Worksheets |

---

## 1. Overview

### 1.1 Problem Statement
Teachers spend 5–15 minutes grading each student worksheet manually. For a class of 40 students across 5 subjects, this is 15–20 hours per week of repetitive evaluation work. Students get delayed feedback (next class, sometimes next week), by which time the learning opportunity is lost.

Parents and self-learners also want to evaluate homework but lack answer keys or expertise to identify *where* a student went wrong — not just *that* they were wrong.

### 1.2 Solution
VED is a web app that uses AI vision + reasoning (Gemini 2.5 Flash) to:
1. **Scan** a photographed worksheet (camera or upload)
2. **Auto-correct perspective** (student takes photo at an angle)
3. **Identify every question** and read handwritten answers
4. **Grade** each answer vs. ground truth derived by the AI
5. **Pinpoint specific errors** with IntelGrader-style annotations — a red dot at the exact wrong digit/sign/word, a dashed leader line, and a floating label ("Calculation Error", "Concept Error", etc.)
6. **Explain** with step-by-step solutions, feedback, and an interactive chat tutor

### 1.3 Target Users

| Persona | Need | Primary Use |
|---------|------|-------------|
| **Teacher (K-12)** | Bulk grading, consistent rubric | Scan 40 worksheets per class, review flagged errors |
| **Parent** | Check child's homework without an answer key | Daily quick scan, review with child |
| **Student (self-learner)** | Immediate feedback + guided correction | Self-check practice worksheets |
| **Tutor** | Structured diagnostics per student | Review session prep, error pattern analysis |

### 1.4 Scope

**In scope (v2.0):**
- Single-page worksheet evaluation (math, physics, chemistry, biology)
- Handwritten + printed answer detection
- Pinpoint error annotations
- Per-question step-by-step solutions
- AI chat tutor scoped per question
- Session persistence for review
- Mobile-responsive web app

**Out of scope (this PRD):**
- Bulk upload / batch grading
- Multi-page worksheet stitching
- Rubric customization per teacher
- Analytics dashboards (class trends)
- LMS / Google Classroom integration
- Offline mode
- Non-Latin scripts (Hindi, Chinese, Arabic)

---

## 2. Goals & Success Metrics

### 2.1 Primary Goals
1. Reduce worksheet grading time per page from ~10 min to **< 30 seconds** of teacher review.
2. Error localization accuracy: **≥ 85%** of pinpoint markers within 5% of actual error coordinate.
3. Evaluation latency: **< 15s** from capture to annotated display.

### 2.2 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| End-to-end latency (capture → rendered annotation) | < 15s p95 | Client-side timing |
| Correct question count (no sub-part splitting) | ≥ 95% | Manual QA on test set |
| Bbox alignment with printed borders | Within ±2% | Pixel diff on labeled set |
| Error pin accuracy (within 5% of true error spot) | ≥ 85% | Manual QA |
| Session completion rate | ≥ 80% | analytics funnel |
| User-reported "helpful" feedback | ≥ 4.0 / 5 | In-app rating prompt |
| Crash-free sessions | ≥ 99.5% | Sentry / equivalent |

---

## 3. User Journeys

### 3.1 Primary Journey: Scan → Review

```
Student/Teacher                         VED                             Gemini
     │                                   │                                 │
     │─── opens app ─────────────────────▶                                 │
     │◀── landing + recent sessions ─────│                                 │
     │                                   │                                 │
     │─── taps "Scan Worksheet" ─────────▶                                 │
     │◀── CaptureModal opens (camera) ───│                                 │
     │                                   │                                 │
     │─── snaps photo ───────────────────▶                                 │
     │◀── preview + Confirm button ──────│                                 │
     │                                   │                                 │
     │─── confirms ──────────────────────▶ POST /preprocess                │
     │                                   │     (OpenCV dewarp)             │
     │                                   │                                 │
     │◀── "Straightening worksheet..." ──│                                 │
     │                                   │─── POST /evaluate ─────────────▶│
     │◀── "Analyzing worksheet..." ──────│                           Gemini reads
     │                                   │                           grades, locates
     │                                   │◀── JSON (questions+errors) ─────│
     │                                   │     _sanitize_bboxes()          │
     │                                   │                                 │
     │◀── "Generating annotations..." ───│─── POST /annotate               │
     │                                   │     (local, no Gemini)          │
     │                                   │                                 │
     │◀── redirect to /evaluate/:id ─────│─── save session (SQLite)        │
     │                                   │                                 │
     │  ┌─────────────────────────────────────────────────────┐            │
     │  │  LEFT: worksheet + bbox + error pins + badges       │            │
     │  │  RIGHT: question detail + feedback + steps + chat   │            │
     │  └─────────────────────────────────────────────────────┘            │
     │                                   │                                 │
     │─── clicks Q3 error pin ───────────▶                                 │
     │◀── right panel scrolls to Q3 ─────│                                 │
     │                                   │                                 │
     │─── types "why is it 4 not 22?" ──▶ POST /chat (streaming)          │
     │                                   │─── streaming chat ─────────────▶│
     │◀── streaming AI tutor response ◀──│◀── tokens ──────────────────────│
```

### 3.2 Secondary Journeys
- Resume previous session: Home page → click recent session card → loads stored image + marks
- Re-scan if annotation is wrong: click "Scan Again" → full new flow
- Browse by subject: Home page → filter sessions by Mathematics / Physics / etc.

---

## 4. Functional Requirements

### 4.1 Capture (F1–F5)

| ID | Requirement | Priority |
|----|-------------|----------|
| F1 | User can capture worksheet via device rear camera (`facingMode: environment`) at 1280×960 ideal resolution | Must |
| F2 | User can upload worksheet file (JPG/PNG/HEIC/WebP, max 10MB) | Must |
| F3 | Captured/uploaded image is converted to JPEG at 92% quality | Must |
| F4 | User sees preview before confirming, can retake | Must |
| F5 | Viewfinder overlay shows 4 corner guides | Should |

### 4.2 Perspective Correction (F6–F9)

| ID | Requirement | Priority |
|----|-------------|----------|
| F6 | System detects paper boundary via OpenCV Canny + contour approximation | Must |
| F7 | Paper area must be ≥ 20% of image to be considered valid | Must |
| F8 | If skew < 1°, skip correction (return original) | Must |
| F9 | If paper not detected, fall back gracefully without correction | Must |

### 4.3 Evaluation (F10–F20)

| ID | Requirement | Priority |
|----|-------------|----------|
| F10 | Identify worksheet title, subject, chapter, topic | Must |
| F11 | Count main questions correctly; never split sub-parts (3.1, 3.2) into separate entries | Must |
| F12 | Read student's handwritten answer per question (or combine sub-part answers into one `studentAnswer`) | Must |
| F13 | Assign status ∈ {correct, partially_correct, incorrect, unanswered} | Must |
| F14 | Emit `box_2d` matching printed border as integers on 0-1000 scale | Must |
| F15 | Emit `errors[]` array per wrong/partial question, each with `error_type`, `pin_point`, `highlight_box`, `description` | Must |
| F16 | Generate `correctAnswer`, `feedback` (1-2 sentences), `vedInsight` (tip), `steps[]` (2-4 steps with 1-3 bullets each) | Must |
| F17 | Emit `marks_possible` + `marks_awarded` per question | Must |
| F18 | Retry once with 1s backoff on JSON parse failure | Must |
| F19 | Thinking budget = 4096 tokens, temperature = 0.5, JSON mode enabled | Must |
| F20 | Boxes must not overlap vertically; post-process fixes overlap by midpoint-split | Must |

### 4.4 Annotation Rendering (F21–F32)

| ID | Requirement | Priority |
|----|-------------|----------|
| F21 | Image rendered at `contain-fit` (preserve aspect, always fully visible) | Must |
| F22 | Score strip at top: 44px tall, one pill per question (`Q1 3/3`, `Q2 0/2`), color by status | Must |
| F23 | Per question: dashed bbox outline matching printed border, color by status | Must |
| F24 | For wrong/partial: red/orange dot at `pin_point`, dashed leader line, white label pill with error type text | Must |
| F25 | For wrong/partial with specific value error: thin colored rect around wrong value (`highlight_box`) | Must |
| F26 | Per question: badge circle at top-right with ✓/✗/~ and marks awarded/possible | Must |
| F27 | Score summary in top-right of score strip: X/Y (Z%) | Must |
| F28 | Click on pill or bbox scrolls right panel to that question | Must |
| F29 | Active question bbox: thicker stroke + shadow glow | Should |
| F30 | Annotations never overflow container (min-h-0 + overflow-hidden) | Must |
| F31 | Image vertically centered below score strip | Should |
| F32 | All annotation layers use same offset as image layer (no drift) | Must |

### 4.5 Question Detail Panel (F33–F40)

| ID | Requirement | Priority |
|----|-------------|----------|
| F33 | Right panel shows one question at a time | Must |
| F34 | Question navigation tabs (Q1, Q2, ...) color-coded by status | Must |
| F35 | Display status badge, marks X/Y, question text, student's answer, correct answer | Must |
| F36 | Step-by-step solution with expandable cards | Must |
| F37 | "Ved Insight" quote block | Should |
| F38 | Chat tutor panel scoped per question | Must |
| F39 | Streaming chat responses (token-by-token rendering) | Should |
| F40 | Voice input + TTS for chat | Could |

### 4.6 Session Management (F41–F45)

| ID | Requirement | Priority |
|----|-------------|----------|
| F41 | Auto-save session after evaluation with UUID | Must |
| F42 | Home page lists recent sessions: title, subject, date, score | Must |
| F43 | Click session card → opens `/evaluate/:id` with stored image + marks | Must |
| F44 | Re-annotate if stored marks count != question count (migration path) | Must |
| F45 | Delete session (future) | Could |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Target |
|--------|--------|
| End-to-end latency (capture → render) | < 15s p95 |
| Perspective correction | < 1s |
| Gemini evaluation | 5–10s typical |
| Annotation marks generation | < 100ms |
| First render of annotated image | < 500ms after marks arrive |
| FPS during annotation interaction | 60 FPS |

### 5.2 Accuracy (validated on internal test set of 50 worksheets)

| Metric | Target |
|--------|--------|
| Question count correctness | ≥ 95% |
| Answer reading accuracy (clean handwriting) | ≥ 90% |
| Grade correctness | ≥ 92% |
| Bbox alignment within ±2% of printed border | ≥ 85% |
| Pin point within 5% of true error location | ≥ 85% |

### 5.3 Reliability

- Graceful degradation: if Gemini returns malformed JSON, retry once; on second fail, show user-friendly error and "Retry" button.
- If image upload fails, preserve user's captured image in local state (don't force re-capture).
- Session storage is durable — reloading `/evaluate/:id` always shows last saved state.

### 5.4 Security

- Gemini API key stored server-side only (`backend/.env`, never in client bundle).
- All API routes proxied through backend — no direct client-to-Gemini calls.
- No user authentication in v2.0 (out of scope). Session IDs are UUIDs, but anyone with the URL can view. **To be designed in v3.0.**
- CORS configured for frontend origin only.
- Uploaded images stay in-memory during processing; only dataUrl persisted in SQLite.

### 5.5 Privacy

- Worksheet images may contain student names/handwriting. **Data policy TBD** (likely: delete sessions older than 30 days unless pinned).
- No PII sent to Gemini besides the image itself.
- No analytics or telemetry on worksheet content in v2.0.

### 5.6 Browser & Device Support

| Platform | Support |
|----------|---------|
| Chrome ≥ 108 | ✅ Full |
| Safari ≥ 16 | ✅ Full |
| Firefox ≥ 108 | ✅ Full |
| Mobile Safari (iOS 16+) | ✅ Full |
| Chrome Android (latest-1) | ✅ Full |
| IE / Edge Legacy | ❌ Not supported |

Minimum screen width: **360px**.

---

## 6. Data Model

### 6.1 EvaluatedQuestion (TypeScript)

```ts
interface EvaluatedQuestion {
  number: number
  questionText: string
  studentAnswer: string | null
  correctAnswer: string
  status: 'correct' | 'incorrect' | 'partially_correct' | 'unanswered'
  feedback: string
  vedInsight: string
  steps: { title: string, points: string[] }[]
  marks_possible?: number
  marks_awarded?: number
  bbox_norm?: [ymin, xmin, ymax, xmax]      // 0-1 scale
  box_2d?: [ymin, xmin, ymax, xmax]          // raw 0-1000 from Gemini
  errors?: ErrorDetail[]
}

interface ErrorDetail {
  error_type: string
  pin_point?: [y, x]
  pin_point_norm?: [y, x]                    // 0-1 scale
  highlight_box?: [ymin, xmin, ymax, xmax]
  highlight_box_norm?: [ymin, xmin, ymax, xmax]
  description?: string
}
```

### 6.2 AutoMark (rendering)

```ts
type AutoMark =
  | { type: 'bbox';           qi, x, y, w, h, color, status, label }
  | { type: 'score_pill';     qi, label, score_text, status, color }
  | { type: 'error_pin';      pin_x, pin_y, label_x, label_y, error_type, color }
  | { type: 'highlight_box';  x, y, w, h, color }
  | { type: 'badge';          qi, x, y, status, color, marks_awarded, marks_possible }
```

### 6.3 EvaluationResult

```ts
interface EvaluationResult {
  worksheetTitle: string
  subject: 'Mathematics' | 'Physics' | 'Chemistry' | 'Biology' | 'Science'
  chapter: string
  topic: string
  questions: EvaluatedQuestion[]
}
```

### 6.4 Session (SQLite)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,             -- UUID
  image_data_url TEXT NOT NULL,    -- base64 jpeg (~1-5MB each)
  result_json TEXT NOT NULL,       -- EvaluationResult as JSON
  auto_marks_json TEXT NOT NULL,   -- AutoMark[] as JSON
  timestamp TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  question_num INTEGER NOT NULL,
  role TEXT NOT NULL,              -- 'user' | 'assistant'
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_chat_session_q ON chat_messages(session_id, question_num);
```

### 6.5 Coordinate Contract

- **Gemini output** — integers on 0-1000 scale, origin top-left, `[ymin, xmin, ymax, xmax]`
- **Backend storage** — floats on 0-1 scale, same order
- **Frontend render** — `px(norm) = norm × imageWidth`; `py(norm) = norm × imageHeight`
- Same base64 bytes used throughout pipeline — capture, Gemini input, storage, display — so no resize mismatch possible.

---

## 7. API Contracts

All endpoints return JSON. All errors use HTTP status codes + `{ "detail": "message" }`.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `POST` | `/api/preprocess` | `{ imageBase64, mimeType }` | `{ imageBase64, mimeType, dataUrl, corrected: bool }` |
| `POST` | `/api/evaluate` | `{ imageBase64, mimeType }` | `{ success, worksheetTitle, subject, chapter, topic, questions[] }` |
| `POST` | `/api/annotate` | `{ imageBase64, mimeType, questions[] }` | `{ marks: AutoMark[] }` |
| `POST` | `/api/sessions` | `{ imageDataUrl, result, autoMarks }` | `{ id: UUID }` |
| `GET` | `/api/sessions` | – | `[{ id, result, timestamp }]` |
| `GET` | `/api/sessions/:id` | – | `{ id, imageDataUrl, result, autoMarks, timestamp }` |
| `PATCH` | `/api/sessions/:id/marks` | `AutoMark[]` | `{ ok: true }` |
| `POST` | `/api/chat` | `{ message, questionText, correctAnswer, studentAnswer, status, history }` | Streaming text/event-stream |
| `POST` | `/api/reattempt` | `{ questionText, correctAnswer, studentAnswer }` | `{ evaluation }` |
| `POST` | `/api/chat-messages` | `{ sessionId, questionNum, role, content }` | `{ id }` |
| `GET` | `/api/chat-messages/:sessionId/:questionNum` | – | `ChatMessage[]` |

---

## 8. UX Requirements

### 8.1 Design Principles
- **Pinpoint, don't overwhelm** — show only the minimum needed markers; users shouldn't feel like their worksheet was graffitied on.
- **Color coding must be learnable** — green=correct, red=incorrect, orange=partial, gray=unanswered. Consistent across score strip, bbox, pins, badges.
- **Error labels are verbs or nouns** — "Calculation Error", "Concept Error", "Missing Step" — student-readable, not jargon.
- **Trust but verify** — show Gemini's confidence indirectly via the quality of the annotation; never expose raw model outputs.

### 8.2 Responsive Layout

**Desktop (≥ 1024px):** 2-panel split, 52% / 48%, both scroll independently.

**Tablet (768–1023px):** 2-panel split, 48% / 52%, smaller fonts, condensed badges.

**Mobile (< 768px):** Single-panel, tabs at bottom — "Worksheet" / "Question" — user taps to switch. Score strip remains fixed at top.

### 8.3 States

| State | Behavior |
|-------|----------|
| Initial (no session) | Home with recent + CTA to scan |
| Loading (evaluating) | Full-screen overlay with spinner, step label, timer |
| Success (annotated) | 2-panel view |
| Error (Gemini failed) | Inline alert with "Retry" button preserving captured image |
| Empty (0 questions detected) | Message: "Couldn't detect questions. Try a clearer photo." |

---

## 9. Acceptance Criteria (Handover)

Engineering can consider this handover complete when:

- [ ] All functional requirements F1–F45 are implemented and have passing tests.
- [ ] Non-functional targets (performance, accuracy) validated on 50-worksheet test set.
- [ ] Coordinate contract (Section 6.5) documented and honored across all layers.
- [ ] No direct Gemini calls from client.
- [ ] `backend/.env.example` documents all required keys.
- [ ] `README.md` and `TECH.md` reflect the shipped system.
- [ ] Analytics hooks present (events: `session_start`, `session_complete`, `evaluation_failed`, `chat_message_sent`) — even if no provider wired yet.
- [ ] Sentry / error reporting stub in place for exception tracking.

---

## 10. Open Questions

1. **Session ownership / auth** — who owns a session? Anonymous URL share, or user accounts?
2. **Retention policy** — how long to keep images & sessions? (GDPR / COPPA for minors.)
3. **Rate limiting** — per-user / per-IP quotas on Gemini calls?
4. **Cost model** — Gemini per-call cost budget. Expected volume?
5. **Multi-language** — when do we support Hindi/Tamil/Bengali handwriting?
6. **Rubric override** — should teachers be able to edit Gemini's verdict inline?
7. **Export** — PDF report of graded worksheet for parent share?
8. **Scale-out** — move storage from SQLite to Postgres + S3 (blob for images)?

---

## 11. Appendix

### A. Gemini Prompt Contract
Full prompt lives in `backend/gemini_client.py::EVALUATE_PROMPT`. 6-step structured prompt:
1. Count questions (no sub-part split)
2. Read image & answers
3. Locate (box_2d on 0-1000, match printed borders)
4. Evaluate status
5. Pinpoint errors (errors[] with pin_point + highlight_box)
6. Generate educational content (feedback, steps, insight, marks)

### B. Render Layer Stack (AnnotationStage.tsx)
| Layer | Purpose | Listening |
|-------|---------|-----------|
| 0 | Score strip (pills + overall score) | yes |
| 1 | Image (Konva Image) | no |
| 2 | Bbox dashed outlines | yes |
| 3 | Highlight boxes | no |
| 4 | Error pins (dot + line + label) | no |
| 5 | Badges (circle + symbol + score) | yes |

### C. Known Limitations
- Some worksheets have Gemini returning near-full-width bboxes. Prompt mitigates but not 100%.
- Low-contrast handwriting (pencil on white) reduces accuracy ~15%.
- Heavy occlusion (student's hand in photo) breaks perspective detection.
- No multi-page support yet — one image per evaluation.

---

**End of PRD**

_Revision history maintained in Git commit log._
