const BASE = '/api'

async function handleResponse(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[API] ${res.status} ${res.statusText}: ${text}`)
    throw new Error(`API error ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

export async function preprocessImage(imageBase64: string, mimeType: string) {
  const res = await fetch(`${BASE}/preprocess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType })
  })
  return handleResponse(res)
}

export async function evaluateWorksheet(imageBase64: string, mimeType: string, templateId?: string, promptVersion?: 'v1' | 'v2') {
  const body: Record<string, unknown> = { imageBase64, mimeType }
  if (templateId) body.templateId = templateId
  if (promptVersion) body.promptVersion = promptVersion
  const res = await fetch(`${BASE}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return handleResponse(res)
}

/* ─── Worksheet Templates ─── */

export async function uploadTemplate(payload: {
  title: string
  subject?: string
  chapter?: string
  topic?: string
  questions: Array<{
    number: number
    questionText: string
    correctAnswer: string
    marks_possible: number
    solution_steps?: string[]
  }>
}) {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return handleResponse(res)
}

export async function listTemplates() {
  const res = await fetch(`${BASE}/templates`)
  return handleResponse(res)
}

export async function fetchTemplate(id: string) {
  const res = await fetch(`${BASE}/templates/${id}`)
  return handleResponse(res)
}

export async function deleteTemplate(id: string) {
  const res = await fetch(`${BASE}/templates/${id}`, { method: 'DELETE' })
  return handleResponse(res)
}

export async function annotateWorksheet(imageBase64: string, mimeType: string, questions: unknown[]) {
  const res = await fetch(`${BASE}/annotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, questions })
  })
  return handleResponse(res)
}

export async function sendChat(payload: {
  message: string
  questionText: string
  correctAnswer: string
  studentAnswer: string | null
  status: string
  history: unknown[]
}) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return handleResponse(res)
}

export async function submitReattempt(questionText: string, correctAnswer: string, studentAnswer: string) {
  const res = await fetch(`${BASE}/reattempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionText, correctAnswer, studentAnswer })
  })
  return handleResponse(res)
}

export async function saveSession(imageDataUrl: string, result: unknown, autoMarks: unknown[]) {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, result, autoMarks })
  })
  return handleResponse(res)
}

export async function saveSessionMulti(pages: Array<{ imageDataUrl: string; result: unknown; autoMarks: unknown[] }>) {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages })
  })
  return handleResponse(res)
}

export async function appendSessionPage(sessionId: string, imageDataUrl: string, result: unknown, autoMarks: unknown[]) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, result, autoMarks })
  })
  return handleResponse(res)
}

export async function fetchSession(id: string) {
  const res = await fetch(`${BASE}/sessions/${id}`)
  return handleResponse(res)
}

export async function listSessions() {
  const res = await fetch(`${BASE}/sessions`)
  return handleResponse(res)
}

export async function updateSessionMarks(id: string, marks: unknown[], page: number = 0) {
  const res = await fetch(`${BASE}/sessions/${id}/marks?page=${page}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(marks)
  })
  return handleResponse(res)
}

export async function saveChatMessage(sessionId: string, questionNum: number, role: string, content: string) {
  const res = await fetch(`${BASE}/chat-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, questionNum, role, content })
  })
  return handleResponse(res)
}

export async function fetchChatMessages(sessionId: string, questionNum: number) {
  const res = await fetch(`${BASE}/chat-messages/${sessionId}/${questionNum}`)
  return handleResponse(res)
}
