# VED — AI Worksheet Evaluator

AI-powered worksheet grading app. Upload student worksheet → perspective-corrected → Gemini evaluates → pinpoint error annotations with dashed bboxes, error pins, and badges overlaid on the image.

![Status](https://img.shields.io/badge/status-active-green)
![Stack](https://img.shields.io/badge/stack-FastAPI%20%2B%20React-blue)
![Model](https://img.shields.io/badge/model-Gemini%202.5%20Flash-orange)

## Stack

- **Backend**: FastAPI + Uvicorn, Python 3.11, `google-genai` SDK, SQLite, OpenCV
- **Frontend**: React 18 + Vite 5 + TypeScript, `react-konva` canvas, TailwindCSS
- **AI**: Gemini 2.5 Flash (`thinking_budget=4096`, `temperature=0.5`, JSON mode)

## Run Locally

```bash
# Backend (port 8000)
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
echo "GEMINI_API_KEY=your_key" > .env
./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (port 5173 default, proxies /api to :8000)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Pipeline

```
CaptureModal                    — camera/file → base64 JPEG
      │
      ▼
POST /api/preprocess            — OpenCV perspective-correct paper
      │
      ▼
POST /api/evaluate              — Gemini reads worksheet:
                                     - counts questions
                                     - reads student answers
                                     - emits box_2d per question (0-1000)
                                     - emits errors[] with pin_point + highlight_box
                                     - grades + writes feedback/steps
      │
      ▼
POST /api/annotate              — no Gemini call. Converts normalized
                                  coords to mark objects: bbox, score_pill,
                                  error_pin, highlight_box, badge
      │
      ▼
POST /api/sessions              — save to SQLite
      │
      ▼
GET  /evaluate/:id              — AnnotationStage (Konva) renders 6 layers:
                                    0. Score strip (Q1 3/3, Q2 0/2 pills)
                                    1. Image (contain-fit, centered)
                                    2. Bbox dashed outlines per question
                                    3. Highlight boxes (tight rect on errors)
                                    4. Error pins (dot → dashed line → label)
                                    5. Badges (✓/✗/~ circles with score)
```

## Features

- **Auto perspective correction** — OpenCV finds paper contour via multi-threshold Canny, dewarps with `warpPerspective`. Skips if skew < 1°.
- **Contain-fit rendering** — image always fits container, aspect preserved, vertical-centered below score strip.
- **Pinpoint error annotations (IntelGrader-style)** — red dot at exact error spot, dashed leader line to floating white label pill ("Concept Error", "Calculation Error" etc.).
- **Full-question dashed bbox** — color-coded by status, matches printed borders.
- **Per-question badge** — circle with ✓/✗/~ and marks awarded/possible.
- **Score strip** — top bar with Q1 3/3, Q2 0/2 pills, color by status.
- **Multi-error support** — Gemini returns `errors[]` array, each with own pin + highlight.
- **Session persistence** — SQLite stores image dataUrl + result + marks.
- **AI chat tutor** — scoped per question, streaming responses.

## Documentation

- [TECH.md](./TECH.md) — architecture, coordinate system, file layout, requirements
- [ANNOTATION_BUGS_AND_FIXES.md](./ANNOTATION_BUGS_AND_FIXES.md) — historical annotation bugs & fixes

## Requirements

- Python ≥ 3.11
- Node ≥ 18
- Gemini API key (https://aistudio.google.com/app/apikey)
- macOS/Linux (OpenCV wheel available)

## Environment

```bash
# backend/.env
GEMINI_API_KEY=your_key_here
```

## Repo

https://github.com/sripadkulkarni-9124/Worksheets
