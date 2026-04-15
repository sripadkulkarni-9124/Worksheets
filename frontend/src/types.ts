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
  bbox?: [number, number]  // [y_start, y_end] on 0-1000 scale from Gemini
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
