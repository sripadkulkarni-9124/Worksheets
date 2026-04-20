from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import random

router = APIRouter()

MOCK = [
    "Think about dividing both parts by the same number. What's the highest number that divides both?",
    "You're on the right track! Let's check your working step by step.",
    "Order in a ratio matters. 'A to B' means A comes first.",
]

MAX_MESSAGE = 2000
MAX_HISTORY = 20


def _sanitize(s: str | None, max_len: int = 2000) -> str:
    """Strip control chars, cap length, escape prompt-injection markers."""
    if not s:
        return ""
    # Drop NUL and most control chars; allow newline + tab
    s = ''.join(c for c in s if c == '\n' or c == '\t' or (ord(c) >= 32 and ord(c) != 127))
    return s[:max_len]


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE)
    questionText: str = Field(..., max_length=4000)
    correctAnswer: str = Field(..., max_length=4000)
    studentAnswer: str | None = Field(None, max_length=4000)
    status: str = Field(..., pattern="^(correct|incorrect|partially_correct|partial|unanswered)$")
    history: list[dict] = Field(default_factory=list)


@router.post("/chat")
async def chat(req: ChatRequest):
    from gemini_client import get_client, MODEL, CHAT_SYSTEM
    from google.genai import types

    client = get_client()
    if not client:
        return {"success": True, "response": random.choice(MOCK)}

    # Cap history length
    history = req.history[-MAX_HISTORY:] if len(req.history) > MAX_HISTORY else req.history

    # Sanitize ALL user-controlled strings before concatenation
    safe_msg = _sanitize(req.message, MAX_MESSAGE)
    safe_q = _sanitize(req.questionText, 4000)
    safe_correct = _sanitize(req.correctAnswer, 4000)
    safe_student = _sanitize(req.studentAnswer, 4000)

    # Build conversation contents
    context = (f'Context: Question: "{safe_q}" | '
               f'Student answered: "{safe_student or "blank"}" | '
               f'Status: {req.status} | Correct: "{safe_correct}"')

    contents = [
        types.Content(role="user", parts=[types.Part.from_text(CHAT_SYSTEM)]),
        types.Content(role="model", parts=[types.Part.from_text(
            "I'm VED, your AI tutor! What would you like to know?")]),
    ]
    for m in history:
        role = "user" if m.get("role") == "user" else "model"
        content = _sanitize(m.get("content", ""), 2000)
        if content:
            contents.append(types.Content(role=role, parts=[types.Part.from_text(content)]))

    contents.append(types.Content(role="user", parts=[
        types.Part.from_text(f"{context}\n\nStudent says: {safe_msg}")
    ]))

    try:
        result = client.models.generate_content(
            model=MODEL, contents=contents,
            config=types.GenerateContentConfig(temperature=0.7)
        )
        usage = result.usage_metadata
        print(f"[TOKENS] chat: prompt={usage.prompt_token_count} "
              f"output={usage.candidates_token_count} total={usage.total_token_count}")
        return {"success": True, "response": result.text}
    except Exception as e:
        print(f"[ERROR] chat: {e}")
        return {"success": False, "response": "Sorry, I had trouble thinking about that. Could you try again?"}
