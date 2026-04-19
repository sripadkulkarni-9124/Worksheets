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

STEP 1 — COUNT THE QUESTIONS:
- Count ONLY the main printed question numbers on the worksheet (e.g. "Question 1", "Question 2", etc.)
- Sub-parts like 1.a, 1.b, 3.1, 3.2 are NOT separate questions — they belong to their parent question
- If the worksheet has Question 1 through Question 5, you return EXACTLY 5 questions
- NEVER split sub-parts into separate question entries

STEP 2 — READ THE IMAGE CAREFULLY:
- Look at every printed question number and question text
- Find every blank, box, or lined area where the student wrote their answer
- Read handwritten text carefully — look at letter shapes, not just outlines
- If a box/blank is empty or has no writing, mark as unanswered
- Do NOT confuse printed text with handwritten answers
- For questions with sub-parts (3.1, 3.2), combine ALL sub-part answers into ONE studentAnswer

STEP 3 — LOCATE EACH QUESTION ON THE IMAGE:
For each question, return bounding box as [ymin, xmin, ymax, xmax] integers 0-1000:
  box_2d — the FULL question block (printed border, header to bottom edge)
    - Must cover ALL sub-parts (e.g. Q3 box covers 3.1 AND 3.2)
    - ONE box per main question number

Coordinate system: 0,0 = top-left; 1000,1000 = bottom-right
Boxes must NOT overlap vertically

STEP 4 — EVALUATE EACH ANSWER:
- Compare the student's handwritten answer to the mathematically/scientifically correct answer
- "correct": answer is right (allow minor spelling variation)
- "partially_correct": concept is right but incomplete, unsimplified, or minor error
- "incorrect": wrong answer
- "unanswered": blank, empty, or no writing detected

STEP 5 — PINPOINT ERRORS (for incorrect / partially_correct only):
For each wrong or partial answer, identify EVERY specific error the student made.
Return an "errors" array. Each error has:
  - error_type: short label like "Calculation Error", "Concept Error", "Sign Error",
    "Missing Step", "Wrong Formula", "Incomplete Answer", "Missing Root",
    "Result Error", "Unit Error", "Copy Error", "Simplification Error"
  - pin_point: [y, x] on 0-1000 — the EXACT pixel where the mistake is on the image
    (center of the wrong digit, wrong sign, wrong word, etc.)
  - highlight_box: [ymin, xmin, ymax, xmax] on 0-1000 — tight box around the specific
    wrong value/expression (e.g. just around "22-4" if they wrote 22 instead of 4).
    Can be null if no specific value to highlight.
  - description: 1 sentence explaining what went wrong at this spot

For correct/unanswered questions, set "errors": []

STEP 6 — GENERATE EDUCATIONAL CONTENT:
- correctAnswer: the full, simplified, proper answer
- feedback: 1-2 sentences, encouraging, specific to this student's attempt
- vedInsight: one memorable insight or tip (1-2 sentences)
- steps: clear step-by-step solution (2-4 steps, each with 1-3 bullet points)
- marks_possible: total marks for this question (from worksheet, or 1 if not printed)
- marks_awarded: marks student earned (0 for incorrect/unanswered, partial for partially_correct)

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
      "marks_possible": 3,
      "marks_awarded": 1,
      "feedback": "specific, encouraging 1-2 sentence feedback",
      "vedInsight": "key learning insight for this concept",
      "steps": [{"title": "Step 1: Action", "points": ["point 1", "point 2"]}],
      "box_2d": [ymin, xmin, ymax, xmax],
      "errors": [
        {
          "error_type": "Calculation Error",
          "pin_point": [y, x],
          "highlight_box": [ymin, xmin, ymax, xmax],
          "description": "Calculated 2^2 as 22 instead of 4"
        }
      ]
    }
  ]
}"""

CHAT_SYSTEM = """You are VED, a friendly AI tutor helping a student understand their worksheet answers.
Be encouraging, Socratic, and educational. Guide them to understand, don't just give answers.
Keep responses concise (2-4 sentences). Use simple language for school students."""
