"""Flask server for real-time answer sheet annotator + mentor chatbot."""

import os
import json
import uuid
import re
import traceback
import logging
from io import BytesIO
from pathlib import Path

from flask import Flask, request, jsonify, send_file, render_template, Response
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
import fitz  # PyMuPDF

from prompts import (
    EXTRACT_ANSWER_KEY_SYSTEM, EXTRACT_ANSWER_KEY_USER,
    EVALUATE_SYSTEM, EVALUATE_USER, MENTOR_SYSTEM, MENTOR_CONTEXT,
    EVALUATE_STANDALONE_SYSTEM, EVALUATE_STANDALONE_USER,
    PRACTICE_QUESTION_SYSTEM, PRACTICE_QUESTION_USER,
    QUICK_ACTIONS, ANNOTATION_TYPES,
)
from annotator import annotate_image

load_dotenv()

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder="static/dist/assets", static_url_path="/assets")
CORS(app)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
ANSWER_KEYS_DIR = Path("saved_answer_keys")
ANSWER_KEYS_DIR.mkdir(exist_ok=True)

# ── Gemini client (persisted to temp dir so it survives watchdog restarts) ──
import tempfile

_TEMP_DIR = Path(tempfile.gettempdir()) / "ved_app"
_TEMP_DIR.mkdir(exist_ok=True)
_KEY_FILE = _TEMP_DIR / "api_key.txt"

MODEL_NAME = "gemini-2.5-flash"
TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts"


def _load_client():
    """Load Gemini client from .env, then persisted key file as fallback."""
    # 1. Try GEMINI_API_KEY from .env
    env_key = os.getenv("GEMINI_API_KEY", "").strip()
    if env_key:
        try:
            c = genai.Client(api_key=env_key)
            logger.info("Loaded Gemini client from .env GEMINI_API_KEY")
            # Also persist so the frontend check-key endpoint works
            _KEY_FILE.write_text(env_key, encoding="utf-8")
            return c
        except Exception as e:
            logger.warning(f".env GEMINI_API_KEY invalid: {e}")

    # 2. Fallback: persisted key file (survives server restarts)
    if _KEY_FILE.exists():
        key = _KEY_FILE.read_text(encoding="utf-8").strip()
        if key:
            try:
                c = genai.Client(api_key=key)
                logger.info("Restored Gemini client from persisted key")
                return c
            except Exception as e:
                logger.warning(f"Persisted key invalid: {e}")
    return None


client = _load_client()

# ── Session store (persisted to temp dir — outside project to avoid watchdog) ──
_SESSION_FILE = _TEMP_DIR / "sessions.json"


def _load_sessions() -> dict:
    if _SESSION_FILE.exists():
        try:
            return json.loads(_SESSION_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_sessions():
    try:
        _SESSION_FILE.write_text(
            json.dumps(sessions, default=str, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


sessions: dict = _load_sessions()


def _get_session(sid: str) -> dict:
    if sid not in sessions:
        sessions[sid] = {
            "answer_key": None,
            "images": [],
            "evaluation": None,
            "annotated": [],
            "chat_history": [],
        }
        _save_sessions()
    return sessions[sid]


# ── Helpers ───────────────────────────────────────────────────────────────────

def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    """Convert each PDF page to a PNG image bytes."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []
    for page in doc:
        pix = page.get_pixmap(dpi=200)
        images.append(pix.tobytes("png"))
    doc.close()
    return images


def _strip_json_fencing(raw: str) -> str:
    """Remove markdown code fencing from Gemini JSON output."""
    raw = raw.strip()
    raw = re.sub(r'^```(?:json)?\s*\n?', '', raw)
    raw = re.sub(r'\n?```\s*$', '', raw)
    return raw.strip()


def _optimize_image(img_bytes: bytes) -> bytes:
    """Resize image to max 2048px and convert to JPEG to reduce payload size."""
    try:
        img = Image.open(BytesIO(img_bytes))
        # Orientation correction if needed
        if hasattr(img, '_getexif') and img._getexif():
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
        
        max_size = 2048
        if max(img.size) > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        out = BytesIO()
        img.save(out, format="JPEG", quality=85)
        return out.getvalue()
    except Exception as e:
        logger.error(f"Image optimization failed: {e}")
        return img_bytes


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_file("static/dist/index.html")


@app.route("/api/session/<sid>", methods=["GET"])
def get_session_state(sid):
    """Retrieve partial state for an existing session to restore UI."""
    if sid not in sessions:
        return jsonify({"error": "Session not found"}), 404
    sess = sessions[sid]
    return jsonify({
        "session_id": sid,
        "has_answer_key": sess["answer_key"] is not None,
        "answer_key": sess["answer_key"],
        "image_count": len(sess["images"]),
        "image_urls": [f"/api/image/{Path(p).name}" for p in sess["images"]],
        "evaluation": sess["evaluation"],
        "annotated_urls": [f"/api/annotated/{Path(p).name}" for p in sess["annotated"]],
        "chat_history": sess["chat_history"],
    })


@app.route("/api/check-key", methods=["GET"])
def check_key():
    """Check if a Gemini API key is already connected."""
    return jsonify({"connected": client is not None})


@app.route("/api/set-key", methods=["POST"])
def set_key():
    """Set Gemini API key at runtime — persisted to temp dir (not project)."""
    global client
    key = request.json.get("api_key", "").strip()
    if not key:
        return jsonify({"error": "No API key provided"}), 400

    try:
        test_client = genai.Client(api_key=key)
        test_client.models.list()  # validate
        client = test_client
        # Persist to temp dir so key survives watchdog restarts
        _KEY_FILE.write_text(key, encoding="utf-8")
        logger.info("Gemini API key connected and persisted")
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Invalid API key: {e}")
        return jsonify({"error": f"Invalid API key: {e}"}), 400


@app.route("/api/answer-keys", methods=["GET"])
def list_answer_keys():
    """List saved answer keys."""
    keys = []
    for f in sorted(ANSWER_KEYS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            subject = data.get("subject", "Unknown")
            total = data.get("total_marks", "?")
            qcount = len(data.get("questions", []))
            keys.append({
                "filename": f.name,
                "label": f"{subject} — {qcount} Qs, {total} marks",
                "subject": subject,
            })
        except (json.JSONDecodeError, OSError):
            continue
    return jsonify({"answer_keys": keys})


@app.route("/api/answer-keys/<filename>", methods=["GET"])
def load_answer_key(filename):
    """Load a saved answer key."""
    path = ANSWER_KEYS_DIR / filename
    if not path.exists():
        return jsonify({"error": "Not found"}), 404
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return jsonify({"answer_key": data})
    except (json.JSONDecodeError, OSError):
        return jsonify({"error": "Invalid file"}), 500


def _save_answer_key(answer_key: dict):
    """Auto-save an extracted answer key for reuse."""
    subject = answer_key.get("subject", "unknown").replace(" ", "_").lower()
    qcount = len(answer_key.get("questions", []))
    total = answer_key.get("total_marks", 0)
    name = f"{subject}_{qcount}q_{total}m.json"
    path = ANSWER_KEYS_DIR / name
    path.write_text(json.dumps(answer_key, indent=2, ensure_ascii=False), encoding="utf-8")


@app.route("/api/upload", methods=["POST"])
def upload():
    """Upload answer key and/or answer sheet images."""
    sid = request.form.get("session_id") or str(uuid.uuid4())
    sess = _get_session(sid)

    # Handle answer key
    ak_text = request.form.get("answer_key_text")
    if ak_text:
        try:
            sess["answer_key"] = json.loads(ak_text)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid answer key JSON text"}), 400

    # Handle answer sheet images / PDFs
    files = request.files.getlist("answer_sheets")
    for f in files:
        data = f.read()
        if f.filename.lower().endswith(".pdf"):
            for i, img_bytes in enumerate(pdf_to_images(data)):
                # Use uuid so re-uploads never overwrite previous attempt files
                path = UPLOAD_DIR / f"{sid}_{uuid.uuid4().hex[:8]}_page_{i}.png"
                path.write_bytes(img_bytes)
                sess["images"].append(str(path))
        else:
            ext = Path(f.filename).suffix or ".png"
            path = UPLOAD_DIR / f"{sid}_{uuid.uuid4().hex[:8]}{ext}"
            path.write_bytes(data)
            sess["images"].append(str(path))

    _save_sessions()
    return jsonify({
        "session_id": sid,
        "has_answer_key": sess["answer_key"] is not None,
        "image_count": len(sess["images"]),
        "image_urls": [f"/api/image/{Path(p).name}" for p in sess["images"]],
    })


@app.route("/api/clear", methods=["POST"])
def clear_session():
    """Clear specific parts of the session state."""
    sid = request.json.get("session_id")
    target = request.json.get("target") # "answer_key" or "answer_sheets"
    if not sid or sid not in sessions:
        return jsonify({"error": "Invalid session"}), 400
    
    sess = sessions[sid]
    if target == "answer_key":
        sess["answer_key"] = None
    elif target == "answer_sheets":
        sess["images"] = []
        sess["evaluation"] = None
        sess["annotated"] = []
    elif target == "all":
        sess["images"] = []
        sess["evaluation"] = None
        sess["annotated"] = []
        sess["answer_key"] = None
        sess["chat_history"] = []

    _save_sessions()
    return jsonify({"success": True})


@app.route("/api/extract-answer-key", methods=["POST"])
def extract_answer_key():
    """Extract answer key from PDF/image using Gemini."""
    if not client:
        return jsonify({"error": "Please enter your Gemini API key first"}), 400

    sid = request.form.get("session_id") or str(uuid.uuid4())
    sess = _get_session(sid)

    ak_file = request.files.get("answer_key_file")
    if not ak_file:
        return jsonify({"error": "No file provided"}), 400

    data = ak_file.read()
    filename = ak_file.filename.lower()

    try:
        images_bytes = pdf_to_images(data) if filename.endswith(".pdf") else [data]
        parts = [types.Part.from_text(text=EXTRACT_ANSWER_KEY_USER)]
        for img_bytes in images_bytes:
            opt_bytes = _optimize_image(img_bytes)
            parts.append(types.Part.from_bytes(data=opt_bytes, mime_type="image/jpeg"))

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=parts,
            config=types.GenerateContentConfig(
                system_instruction=EXTRACT_ANSWER_KEY_SYSTEM,
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )

        raw_text = ""
        if response.text:
            raw_text = response.text
        elif response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    raw_text = part.text
                    break

        if not raw_text:
            return jsonify({"error": "Gemini returned empty response. Try again."}), 500

        raw = _strip_json_fencing(raw_text)
        answer_key = json.loads(raw)
        sess["answer_key"] = answer_key
        _save_answer_key(answer_key)
        _save_sessions()

        return jsonify({"session_id": sid, "answer_key": answer_key, "has_answer_key": True})
    except Exception as e:
        logger.error(f"Extraction failed: {traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/evaluate", methods=["POST"])
def evaluate():
    """Run Gemini evaluation on uploaded images."""
    if not client:
        return jsonify({"error": "Please enter your Gemini API key first"}), 400

    sid = request.json.get("session_id")
    if not sid or sid not in sessions:
        return jsonify({"error": "Invalid session"}), 400

    sess = sessions[sid]
    if not sess["answer_key"] or not sess["images"]:
        return jsonify({"error": "Missing answer key or sheets"}), 400

    try:
        logger.info(f"Evaluating session {sid} with model {MODEL_NAME}, {len(sess['images'])} images")
        prompt_text = EVALUATE_USER.format(answer_key=json.dumps(sess["answer_key"], indent=2))
        parts = [types.Part.from_text(text=prompt_text)]

        for img_path in sess["images"]:
            opt_bytes = _optimize_image(Path(img_path).read_bytes())
            parts.append(types.Part.from_bytes(data=opt_bytes, mime_type="image/jpeg"))

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=parts,
            config=types.GenerateContentConfig(
                system_instruction=EVALUATE_SYSTEM,
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )

        # Extract text from response — handle thinking models that may have empty text
        raw_text = ""
        if response.text:
            raw_text = response.text
        elif response.candidates:
            # Try to get text from candidate parts
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    raw_text = part.text
                    break

        if not raw_text:
            logger.error(f"Gemini returned empty response. Finish reason: {response.candidates[0].finish_reason if response.candidates else 'no candidates'}")
            return jsonify({"error": "Gemini returned an empty response. Try again or reduce the number of pages."}), 500

        logger.info(f"Gemini response length: {len(raw_text)} chars")
        raw = _strip_json_fencing(raw_text)
        evaluation = json.loads(raw)
        sess["evaluation"] = evaluation

        # Annotations
        sess["annotated"] = []
        for i, img_path in enumerate(sess["images"]):
            img_bytes = Path(img_path).read_bytes()
            ann_bytes = annotate_image(img_bytes, evaluation.get("questions", []), i + 1)
            ann_path = UPLOAD_DIR / f"annotated_{Path(img_path).name}"
            ann_path.write_bytes(ann_bytes)
            sess["annotated"].append(str(ann_path))

        sess["chat_history"] = []
        _save_sessions()

        logger.info(f"Evaluation done: {evaluation.get('overall_score', '?')}, {len(sess['annotated'])} annotated images")
        return jsonify({
            "evaluation": evaluation,
            "annotated_urls": [f"/api/annotated/{Path(p).name}" for p in sess["annotated"]],
        })
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse failed. Raw text: {raw_text[:500] if raw_text else 'EMPTY'}")
        return jsonify({"error": f"Gemini returned invalid JSON. Retrying may help. Detail: {e}"}), 500
    except Exception as e:
        logger.error(f"Evaluation failed: {traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/evaluate-standalone", methods=["POST"])
def evaluate_standalone():
    """Evaluate uploaded images WITHOUT an answer key — AI detects questions and determines correct answers."""
    if not client:
        return jsonify({"error": "Please enter your Gemini API key first"}), 400

    sid = request.json.get("session_id")
    if not sid or sid not in sessions:
        return jsonify({"error": "Invalid session"}), 400

    sess = sessions[sid]
    if not sess["images"]:
        return jsonify({"error": "No answer sheets uploaded"}), 400

    try:
        logger.info(f"Standalone evaluation for session {sid}, {len(sess['images'])} images")
        parts = [types.Part.from_text(text=EVALUATE_STANDALONE_USER)]

        for img_path in sess["images"]:
            opt_bytes = _optimize_image(Path(img_path).read_bytes())
            parts.append(types.Part.from_bytes(data=opt_bytes, mime_type="image/jpeg"))

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=parts,
            config=types.GenerateContentConfig(
                system_instruction=EVALUATE_STANDALONE_SYSTEM,
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )

        raw_text = ""
        if response.text:
            raw_text = response.text
        elif response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "text") and part.text:
                    raw_text = part.text
                    break

        if not raw_text:
            return jsonify({"error": "Gemini returned empty response. Try again."}), 500

        raw = _strip_json_fencing(raw_text)
        evaluation = json.loads(raw)

        # Deduplicate questions by question_number — keep last occurrence (most confident)
        if "questions" in evaluation:
            seen = {}
            for q in evaluation["questions"]:
                seen[str(q.get("question_number", ""))] = q
            evaluation["questions"] = list(seen.values())

        sess["evaluation"] = evaluation

        # Generate annotated images
        sess["annotated"] = []
        for i, img_path in enumerate(sess["images"]):
            img_bytes = Path(img_path).read_bytes()
            ann_bytes = annotate_image(img_bytes, evaluation.get("questions", []), i + 1)
            ann_path = UPLOAD_DIR / f"annotated_{Path(img_path).name}"
            ann_path.write_bytes(ann_bytes)
            sess["annotated"].append(str(ann_path))

        sess["chat_history"] = []
        _save_sessions()

        logger.info(f"Standalone eval done: {evaluation.get('overall_score', '?')}")
        return jsonify({
            "evaluation": evaluation,
            "annotated": [f"/api/annotated/{Path(p).name}" for p in sess["annotated"]],
        })
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse failed: {raw_text[:500] if raw_text else 'EMPTY'}")
        return jsonify({"error": f"Invalid JSON from Gemini. Try again. Detail: {e}"}), 500
    except Exception as e:
        logger.error(f"Standalone evaluation failed: {traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/practice-question", methods=["POST"])
def practice_question():
    """Generate a similar practice question for a given question number."""
    if not client:
        return jsonify({"error": "API key required"}), 400

    sid = request.json.get("session_id")
    qnum = request.json.get("question_number")
    sess = sessions.get(sid)
    if not sess or not sess.get("evaluation"):
        return jsonify({"error": "No evaluation found"}), 400

    # Find the question
    question = None
    for q in sess["evaluation"].get("questions", []):
        if str(q.get("question_number")) == str(qnum):
            question = q
            break

    if not question:
        return jsonify({"error": f"Question {qnum} not found"}), 404

    try:
        prompt = PRACTICE_QUESTION_USER.format(
            question_text=question.get("correct_answer", ""),
            correct_answer=question.get("correct_answer", ""),
            subject="general",
        )

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=PRACTICE_QUESTION_SYSTEM,
                temperature=0.8,
                response_mime_type="application/json",
            ),
        )

        raw = _strip_json_fencing(response.text or "")
        result = json.loads(raw)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Practice question failed: {traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/chat", methods=["POST"])
def chat():
    """Mentor chatbot endpoint with streaming."""
    if not client:
        return jsonify({"error": "API key required"}), 400

    sid = request.json.get("session_id")
    message = request.json.get("message", "").strip()
    current_page = request.json.get("current_page", 0)
    question_number = request.json.get("question_number")  # optional: scope chat to a specific question
    sess = sessions.get(sid)
    if not sess or not message:
        return jsonify({"error": "Invalid session or message"}), 400

    page_context = f"\n\nViewing page {current_page+1} of {len(sess['images'])}."

    # Add question-specific context if scoped to a question
    question_context = ""
    if question_number and sess.get("evaluation"):
        for q in sess["evaluation"].get("questions", []):
            if str(q.get("question_number")) == str(question_number):
                question_context = f"""
\n\nThe student is asking about Question {question_number} specifically:
- Student's answer: {q.get('student_answer', 'unknown')}
- Correct answer: {q.get('correct_answer', 'unknown')}
- Status: {q.get('annotation_type', 'unknown')}
- Error: {q.get('error_description', '')}
- Step-by-step solution: {q.get('step_by_step_solution', 'not available')}
Focus your guidance on this specific question."""
                break

    context = MENTOR_CONTEXT.format(
        answer_key=json.dumps(sess.get("answer_key") or {}),
        evaluation=json.dumps(sess.get("evaluation") or {})
    ) + page_context + question_context

    history = sess["chat_history"]
    contents = [types.Content(role=m["role"], parts=[types.Part.from_text(text=m["parts"][0])]) for m in history]
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

    def generate():
        try:
            full_reply = ""
            stream = client.models.generate_content_stream(
                model=MODEL_NAME,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=MENTOR_SYSTEM + "\n" + context,
                    temperature=0.7,
                ),
            )
            for chunk in stream:
                if chunk.text:
                    full_reply += chunk.text
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            history.append({"role": "user", "parts": [message]})
            history.append({"role": "model", "parts": [full_reply]})
            _save_sessions()
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/api/chat-with-image", methods=["POST"])
def chat_with_image():
    """Chat about a specific region of the answer sheet.

    Accepts session_id, message, page_index, and selection (x%, y%, w%, h%).
    Crops the image region, sends it to Gemini with the message and chat context.
    """
    if not client:
        return jsonify({"error": "API key required"}), 400

    sid = request.json.get("session_id")
    message = request.json.get("message", "").strip()
    page_index = request.json.get("page_index", 0)
    selection = request.json.get("selection")  # {x, y, w, h} as percentages

    sess = sessions.get(sid)
    if not sess or not message:
        return jsonify({"error": "Invalid session or message"}), 400

    if page_index < 0 or page_index >= len(sess["images"]):
        return jsonify({"error": "Invalid page index"}), 400

    try:
        # Load and crop the image region
        img_path = sess["images"][page_index]
        img = Image.open(Path(img_path))
        iw, ih = img.size

        cropped_bytes = None
        if selection:
            sx = int(selection["x"] / 100 * iw)
            sy = int(selection["y"] / 100 * ih)
            sw = int(selection["w"] / 100 * iw)
            sh = int(selection["h"] / 100 * ih)
            # Clamp to image bounds
            sx = max(0, sx)
            sy = max(0, sy)
            ex = min(iw, sx + sw)
            ey = min(ih, sy + sh)

            if ex > sx and ey > sy:
                cropped = img.crop((sx, sy, ex, ey))
                buf = BytesIO()
                cropped.save(buf, format="JPEG", quality=85)
                cropped_bytes = buf.getvalue()

        if not cropped_bytes:
            # Fallback: send the full page
            cropped_bytes = _optimize_image(Path(img_path).read_bytes())

        # Build context
        page_context = f"\n\nThe student is asking about page {page_index + 1} of {len(sess['images'])}."
        if selection:
            page_context += f" They selected a region at ({selection['x']:.0f}%, {selection['y']:.0f}%) size ({selection['w']:.0f}% x {selection['h']:.0f}%)."

        context = MENTOR_CONTEXT.format(
            answer_key=json.dumps(sess.get("answer_key") or {}),
            evaluation=json.dumps(sess.get("evaluation") or {}),
        ) + page_context

        history = sess["chat_history"]
        contents = [
            types.Content(
                role=m["role"],
                parts=[types.Part.from_text(text=m["parts"][0])],
            )
            for m in history
        ]

        # Add user message with the cropped image
        contents.append(types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=message),
                types.Part.from_bytes(data=cropped_bytes, mime_type="image/jpeg"),
            ],
        ))

        def generate():
            try:
                full_reply = ""
                stream = client.models.generate_content_stream(
                    model=MODEL_NAME,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=MENTOR_SYSTEM + "\n" + context,
                        temperature=0.7,
                    ),
                )
                for chunk in stream:
                    if chunk.text:
                        full_reply += chunk.text
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                history.append({"role": "user", "parts": [message]})
                history.append({"role": "model", "parts": [full_reply]})
                _save_sessions()
                yield f"data: {json.dumps({'done': True})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(generate(), mimetype="text/event-stream")
    except Exception as e:
        logger.error(f"Chat with image failed: {traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/quick-action", methods=["POST"])
def quick_action():
    action = request.json.get("action")
    question = request.json.get("question", "")
    if action in QUICK_ACTIONS:
        return jsonify({"prompt": QUICK_ACTIONS[action].format(q=question)})
    return jsonify({"error": "Unknown action"}), 400


@app.route("/api/annotated/<filename>")
def serve_annotated(filename):
    path = UPLOAD_DIR / filename
    return send_file(path, mimetype="image/png") if path.exists() else (jsonify({"error": "Not found"}), 404)


@app.route("/api/image/<filename>")
def serve_image(filename):
    path = UPLOAD_DIR / filename
    return send_file(path) if path.exists() else (jsonify({"error": "Not found"}), 404)


@app.route("/api/annotation-types", methods=["GET"])
def get_annotation_types():
    """Return annotation type definitions for the legend."""
    return jsonify(ANNOTATION_TYPES)


import base64
import struct
import wave


@app.route("/api/tts", methods=["POST"])
def text_to_speech():
    """Convert text to speech using Gemini 2.5 Flash TTS.

    Accepts: { "text": "...", "voice": "Kore" }
    Returns: WAV audio file.
    """
    if not client:
        return jsonify({"error": "API key required"}), 400

    text = request.json.get("text", "").strip()
    voice = request.json.get("voice", "Kore")  # Kore = friendly, clear voice
    if not text:
        return jsonify({"error": "No text provided"}), 400

    # Truncate very long text (TTS works best under ~500 chars)
    if len(text) > 1000:
        text = text[:1000] + "..."

    try:
        response = client.models.generate_content(
            model=TTS_MODEL_NAME,
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice,
                        )
                    )
                ),
            ),
        )

        # Extract raw PCM audio bytes
        audio_data = response.candidates[0].content.parts[0].inline_data.data

        # Convert PCM to WAV (24kHz, mono, 16-bit)
        buf = BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(24000)
            wf.writeframes(audio_data)
        buf.seek(0)

        return send_file(buf, mimetype="audio/wav", download_name="ved_speech.wav")
    except Exception as e:
        logger.error(f"TTS failed: {traceback.format_exc()}")
        return jsonify({"error": f"TTS failed: {str(e)}"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(
        debug=True,
        port=port,
        use_reloader=False,  # prevent watchdog restarts that kill the API key
    )
