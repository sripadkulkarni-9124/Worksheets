from fastapi import APIRouter
from pydantic import BaseModel
import json

router = APIRouter()


class ReattemptRequest(BaseModel):
    questionText: str
    correctAnswer: str
    studentAnswer: str


@router.post("/reattempt")
async def reattempt(req: ReattemptRequest):
    from gemini_client import get_client, MODEL
    from google.genai import types

    client = get_client()
    if not client:
        match = req.studentAnswer.strip().lower() == req.correctAnswer.strip().lower()
        return {
            "status": "correct" if match else "incorrect",
            "feedback": "Correct!" if match else f"Not quite. Answer is {req.correctAnswer}."
        }

    prompt = f"""Evaluate student reattempt.
Question: "{req.questionText}"
Correct: "{req.correctAnswer}"
Student: "{req.studentAnswer}"
Return ONLY JSON: {{"status": "correct|incorrect|partially_correct", "feedback": "1-2 sentence feedback"}}"""

    try:
        result = client.models.generate_content(
            model=MODEL, contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3,
            )
        )
        text = result.text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)
    except (json.JSONDecodeError, Exception) as e:
        print(f"[ERROR] reattempt: {e}")
        match = req.studentAnswer.strip().lower() == req.correctAnswer.strip().lower()
        return {
            "status": "correct" if match else "incorrect",
            "feedback": "Correct!" if match else f"Not quite. The correct answer is {req.correctAnswer}."
        }
