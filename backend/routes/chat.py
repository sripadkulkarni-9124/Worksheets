from fastapi import APIRouter
from pydantic import BaseModel
import random

router = APIRouter()

MOCK = [
    "Think about dividing both parts by the same number. What's the highest number that divides both?",
    "You're on the right track! Let's check your working step by step.",
    "Order in a ratio matters. 'A to B' means A comes first.",
]


class ChatRequest(BaseModel):
    message: str
    questionText: str
    correctAnswer: str
    studentAnswer: str | None
    status: str
    history: list[dict] = []


@router.post("/chat")
async def chat(req: ChatRequest):
    from gemini_client import get_client, MODEL, CHAT_SYSTEM
    from google.genai import types

    client = get_client()
    if not client:
        return {"success": True, "response": random.choice(MOCK)}

    # Build conversation contents
    context = (f'Context: Question: "{req.questionText}" | '
               f'Student answered: "{req.studentAnswer or "blank"}" | '
               f'Status: {req.status} | Correct: "{req.correctAnswer}"')

    contents = [
        types.Content(role="user", parts=[types.Part.from_text(CHAT_SYSTEM)]),
        types.Content(role="model", parts=[types.Part.from_text(
            "I'm VED, your AI tutor! What would you like to know?")]),
    ]
    for m in req.history:
        role = "user" if m["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(m["content"])]))

    contents.append(types.Content(role="user", parts=[
        types.Part.from_text(f"{context}\n\nStudent says: {req.message}")
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
