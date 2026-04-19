export interface SolutionStep {
  title: string
  points: string[]
}

export interface ErrorDetail {
  error_type: string
  pin_point?: [number, number]        // raw [y, x] 0-1000
  pin_point_norm?: [number, number]   // normalized [y, x] 0-1
  highlight_box?: [number, number, number, number]
  highlight_box_norm?: [number, number, number, number]
  description?: string
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
