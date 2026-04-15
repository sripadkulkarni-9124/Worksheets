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
    type: Literal['bbox', 'error_highlight', 'badge', 'tick', 'cross']
    x: float          # 0-1 relative left edge
    y: float          # 0-1 relative top edge
    w: Optional[float] = None   # 0-1 relative width
    h: Optional[float] = None   # 0-1 relative height
    color: Optional[str] = None
    status: Optional[Literal['correct', 'incorrect', 'partially_correct', 'partial', 'unanswered']] = None
    label: Optional[str] = None
    error_type: Optional[str] = None
    marks_awarded: Optional[float] = None
    marks_possible: Optional[float] = None


class Session(SQLModel, table=True):
    id: str = Field(primary_key=True)
    image_data_url: str
    result_json: str
    auto_marks_json: str = Field(default='[]')
    timestamp: str


class ChatMessage(BaseModel):
    id: str
    role: Literal['user', 'assistant']
    content: str
    timestamp: str


class ChatEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str
    question_num: int
    role: str
    content: str
    timestamp: str
