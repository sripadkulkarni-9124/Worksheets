export interface SolutionStep {
  title: string
  points: string[]
}

export interface ErrorDetail {
  error_type: string
  pin_point?: [number, number]
  pin_point_norm?: [number, number]
  highlight_box?: [number, number, number, number]
  highlight_box_norm?: [number, number, number, number]
  description?: string
  stepRef?: number          // 1-based step number this error references
  student_attempt?: string  // what student wrote at this step
  correct_attempt?: string  // what they should have written
  id?: string                // stable id for cross-panel linking
}

export interface EvaluatedQuestion {
  number: number
  questionText: string
  studentAnswer: string | null
  correctAnswer: string
  status: 'correct' | 'incorrect' | 'partially_correct' | 'unanswered'
  feedback: string
  vedInsight: string
  steps: SolutionStep[]
  marks_possible?: number
  marks_awarded?: number
  errorTag?: string  // short label like "Misread", "Formula", "Unsimplified"
  bbox_norm?: [number, number, number, number]
  box_2d?: [number, number, number, number]
  bbox?: [number, number]
  errors?: ErrorDetail[]
}

export interface EvaluationResult {
  worksheetTitle: string
  subject: string
  chapter: string
  topic: string
  questions: EvaluatedQuestion[]
}

export interface AutoMark {
  type: 'bbox' | 'error_highlight' | 'error_pin' | 'highlight_box' | 'score_pill' | 'badge' | 'tick' | 'cross'
  x: number   // 0-1 relative (left edge)
  y: number   // 0-1 relative (top edge)
  w?: number  // 0-1 relative width
  h?: number  // 0-1 relative height
  color?: string
  status?: 'correct' | 'incorrect' | 'partially_correct' | 'partial' | 'unanswered'
  label?: string
  filled?: boolean
  error_type?: string
  description?: string
  pin_x?: number    // 0-1 normalized
  pin_y?: number    // 0-1 normalized
  label_x?: number  // 0-1 label position
  label_y?: number  // 0-1 label position
  score_text?: string
  qi?: number
  marks_awarded?: number
  marks_possible?: number
}

export interface SessionPage {
  imageDataUrl: string
  result: EvaluationResult
  autoMarks: AutoMark[]
}

export interface EvaluationSession {
  id: string
  // Multi-page
  pages?: SessionPage[]
  // Legacy single-page (mirrors pages[0])
  imageDataUrl: string
  result: EvaluationResult
  autoMarks: AutoMark[]
  timestamp: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

/* ─── Worksheet Templates (teacher-uploaded question set) ─── */

export interface TemplateQuestion {
  number: number
  questionText: string
  correctAnswer: string
  marks_possible: number
  solution_steps?: string[]
}

export interface WorksheetTemplate {
  id: string
  title: string
  subject?: string
  chapter?: string
  topic?: string
  questions: TemplateQuestion[]
  timestamp?: string
}

export interface TemplateSummary {
  id: string
  title: string
  subject?: string
  chapter?: string
  topic?: string
  question_count: number
  timestamp: string
}
