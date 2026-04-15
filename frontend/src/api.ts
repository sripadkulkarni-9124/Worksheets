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

export async function evaluateWorksheet(imageBase64: string, mimeType: string) {
  const res = await fetch(`${BASE}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType })
  })
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

export async function fetchSession(id: string) {
  const res = await fetch(`${BASE}/sessions/${id}`)
  return handleResponse(res)
}

export async function listSessions() {
  const res = await fetch(`${BASE}/sessions`)
  return handleResponse(res)
}

export async function updateSessionMarks(id: string, marks: unknown[]) {
  const res = await fetch(`${BASE}/sessions/${id}/marks`, {
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
