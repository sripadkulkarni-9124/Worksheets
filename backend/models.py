from typing import Literal, Optional
from pydantic import BaseModel
from sqlmodel import SQLModel, Field


class SolutionStep(BaseModel):
    title: str
    points: list[str]


class EvaluatedQuestion(BaseModel):
    number: int
    questionText: str
    studentAnswer: Optional[str] = None
    correctAnswer: str
    status: Literal['correct', 'incorrect', 'partially_correct', 'unanswered']
    feedback: str
    vedInsight: str
    steps: list[SolutionStep]


class EvaluationResult(BaseModel):
    worksheetTitle: str
    subject: str
    chapter: str
    topic: str
    questions: list[EvaluatedQuestion]


class AutoMark(BaseModel):
    """Unified mark shape — matches frontend `types.ts` AutoMark union."""
    type: Literal[
        'bbox', 'error_highlight', 'error_pin', 'highlight_box',
        'score_pill', 'badge', 'tick', 'cross'
    ]
    # Standard rect coords (0-1 normalized)
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    # Error pin specific (0-1 normalized)
    pin_x: Optional[float] = None
    pin_y: Optional[float] = None
    label_x: Optional[float] = None
    label_y: Optional[float] = None
    # Styling / metadata
    color: Optional[str] = None
    status: Optional[Literal['correct', 'incorrect', 'partially_correct', 'partial', 'unanswered']] = None
    label: Optional[str] = None
    filled: Optional[bool] = None
    error_type: Optional[str] = None
    description: Optional[str] = None
    # Score pill specific
    score_text: Optional[str] = None
    qi: Optional[int] = None
    # Badge specific
    marks_awarded: Optional[float] = None
    marks_possible: Optional[float] = None


class Session(SQLModel, table=True):
    id: str = Field(primary_key=True)
    image_data_url: str
    result_json: str
    auto_marks_json: str = Field(default='[]')
    timestamp: str = Field(index=True)  # indexed for list ordering


class ChatMessage(BaseModel):
    id: str
    role: Literal['user', 'assistant']
    content: str
    timestamp: str


class ChatEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    question_num: int = Field(index=True)
    role: str
    content: str
    timestamp: str
