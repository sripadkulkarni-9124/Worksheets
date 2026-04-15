export interface SolutionStep {
  title: string
  points: string[]
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
  bbox_norm?: [number, number, number, number]  // [ymin, xmin, ymax, xmax] 0-1 from evaluate
  box_2d?: [number, number, number, number]    // raw Gemini [ymin, xmin, ymax, xmax] 0-1000
  bbox?: [number, number]                       // legacy [y_start, y_end]
}

export interface EvaluationResult {
  worksheetTitle: string
  subject: string
  chapter: string
  topic: string
  questions: EvaluatedQuestion[]
}

export interface AutoMark {
  type: 'bbox' | 'error_highlight' | 'badge' | 'tick' | 'cross'
  x: number   // 0-1 relative (left edge)
  y: number   // 0-1 relative (top edge)
  w?: number  // 0-1 relative width
  h?: number  // 0-1 relative height
  color?: string
  status?: 'correct' | 'incorrect' | 'partially_correct' | 'partial' | 'unanswered'
  label?: string
  filled?: boolean
  error_type?: string
  marks_awarded?: number
  marks_possible?: number
}

export interface EvaluationSession {
  id: string
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
