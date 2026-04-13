// ── Evaluation types ──

export type AnnotationType =
  | 'correct'
  | 'wrong'
  | 'calculation_error'
  | 'conceptual_error'
  | 'missing_step'
  | 'partial_credit';

export interface BoundingBox {
  /** [y_start%, y_end%] as percentage of image height */
  0: number;
  1: number;
}

export interface Question {
  question_number: string;
  student_answer: string;
  correct_answer: string;
  is_correct: boolean;
  annotation_type: AnnotationType;
  error_description: string;
  marks_obtained: number;
  marks_total: number;
  page_number: number;
  bounding_box: [number, number];
  hint: string;
  step_by_step_solution?: string;
}

export interface Evaluation {
  questions: Question[];
  overall_score: string;
  summary: string;
}

// ── Chat types ──

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  questionNumber?: string;
  timestamp: number;
}

// ── Annotation rendering ──

export interface AnnotationColor {
  color: string;
  icon: string;
}

export const ANNOTATION_COLORS: Record<AnnotationType, AnnotationColor> = {
  correct:          { color: '#22c55e', icon: '✓' },
  wrong:            { color: '#ef4444', icon: '✗' },
  calculation_error:{ color: '#f97316', icon: '⚠' },
  conceptual_error: { color: '#a855f7', icon: '💡' },
  missing_step:     { color: '#3b82f6', icon: '↳' },
  partial_credit:   { color: '#eab308', icon: '~' },
};

// ── Normalized bounding box for rendering ──

export interface NormalizedBBox {
  x: number;  // % of width
  y: number;  // % of height
  w: number;  // % of width
  h: number;  // % of height
}

// ── Session ──

export interface Session {
  answer_key: unknown | null;
  images: string[];
  evaluation: Evaluation | null;
  annotated: string[];
  chat_history: Array<{ role: string; parts: string[] }>;
}

// ── Attempt history ──

export interface Attempt {
  index: number;
  imageUrls: string[];
  evaluation: Evaluation;
  scorePercent: number;
  timestamp: number;
}

// ── App view state ──

export type AppView = 'upload' | 'review';
export type MobileTab = 'worksheet' | 'qa' | 'chat';
