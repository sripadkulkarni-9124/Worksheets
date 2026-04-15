# VED v2 — AI Worksheet Corrector

AI-powered worksheet grading app. Upload a student worksheet image, get instant annotations, per-question feedback, hints, step-by-step solutions, and a chat tutor.

## Stack
- **Backend**: Flask + Google Gemini 2.5 Flash
- **Frontend**: React + Vite + TypeScript + Zustand

## Run locally

```bash
# Backend
pip install -r requirements.txt
python3 app.py

# Frontend (in another terminal)
cd frontend
npm install
npm run dev     # dev server at :5173 proxied to Flask :5000
# OR
npm run build   # build into static/dist, served by Flask at :5000
```

## Features
- Upload worksheet images or PDFs
- AI auto-detects questions, evaluates answers without an answer key
- Canvas hand-drawn annotations (ticks, crosses, colour-coded by error type)
- SVG hit-map: hover/click questions for glassmorphic tooltips
- Per-question Q&A panel with hints and step-by-step solutions
- Re-upload flow with attempt history toggle
- Streaming AI chat tutor scoped to each question
- Voice input + TTS
- Mobile responsive
