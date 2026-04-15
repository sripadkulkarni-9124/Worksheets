"""
Gemini client — uses google-genai (new SDK) for thinking support.
Provides both the model client and prompts.
"""

from google import genai
from google.genai import types
import os
from dotenv import load_dotenv

load_dotenv()

_client = None


def get_client() -> genai.Client | None:
    global _client
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    if not _client:
        _client = genai.Client(api_key=api_key)
    return _client


MODEL = "gemini-2.5-flash"


EVALUATE_PROMPT = """You are VED, an expert AI educational evaluator. Carefully analyze this student worksheet image.

STEP 1 — READ THE IMAGE CAREFULLY:
- Look at every printed question number and question text
- Find every blank, box, or lined area where the student wrote their answer
- Read handwritten text carefully — look at letter shapes, not just outlines
- If a box/blank is empty or has no writing, mark as unanswered
- Do NOT confuse printed text with handwritten answers

STEP 2 — LOCATE EACH QUESTION ON THE IMAGE:
- For each question, find where its block starts (top edge) and ends (bottom edge) on the image
- Return bbox: [y_start, y_end] — integers from 0 to 1000
- 0 = top of image, 1000 = bottom of image
- y_start = top of that question's printed dashed border or header
- y_end = bottom of that question's printed dashed border (just before next question starts)
- Each question has ONE bbox covering the entire question area (including sub-parts)
- Boxes must NOT overlap: each y_end < next y_start

STEP 3 — EVALUATE EACH ANSWER:
- Compare the student's handwritten answer to the mathematically/scientifically correct answer
- "correct": answer is right (allow minor spelling variation)
- "partially_correct": concept is right but incomplete, unsimplified, or minor error
- "incorrect": wrong answer
- "unanswered": blank, empty, or no writing detected

STEP 4 — GENERATE EDUCATIONAL CONTENT:
- correctAnswer: the full, simplified, proper answer
- feedback: 1-2 sentences, encouraging, specific to this student's attempt
- vedInsight: one memorable insight or tip (1-2 sentences)
- steps: clear step-by-step solution (2-4 steps, each with 1-3 bullet points)

Return ONLY valid JSON — no markdown, no backticks, no explanation:
{
  "worksheetTitle": "exact title from worksheet or inferred",
  "subject": "Mathematics|Physics|Chemistry|Biology|Science",
  "chapter": "chapter name from worksheet or inferred",
  "topic": "specific topic",
  "questions": [
    {
      "number": 1,
      "questionText": "complete question text as printed",
      "studentAnswer": "exactly what student wrote, or null if blank",
      "correctAnswer": "complete correct answer",
      "status": "correct|incorrect|partially_correct|unanswered",
      "feedback": "specific, encouraging 1-2 sentence feedback",
      "vedInsight": "key learning insight for this concept",
      "steps": [{"title": "Step 1: Action", "points": ["point 1", "point 2"]}],
      "bbox": [y_start, y_end]
    }
  ]
}"""

CHAT_SYSTEM = """You are VED, a friendly AI tutor helping a student understand their worksheet answers.
Be encouraging, Socratic, and educational. Guide them to understand, don't just give answers.
Keep responses concise (2-4 sentences). Use simple language for school students."""
