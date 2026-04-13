import type { Evaluation, Session } from './types';

const BASE = '';  // proxied by Vite in dev

// ── Session ──

export async function getSession(sessionId: string): Promise<Session> {
  const res = await fetch(`${BASE}/api/session/${sessionId}`);
  if (!res.ok) throw new Error('Failed to load session');
  return res.json();
}

// ── API Key ──

export async function checkApiKey(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/check-key`);
    const data = await res.json();
    return data.connected === true;
  } catch {
    return false;
  }
}

export async function setApiKey(key: string): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/api/set-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key }),
  });
  if (!res.ok) throw new Error('Invalid API key');
  return res.json();
}

// ── Upload answer sheets ──

export async function uploadSheets(
  sessionId: string,
  files: File[],
): Promise<{ image_urls: string[]; session_id: string }> {
  const form = new FormData();
  form.append('session_id', sessionId);
  for (const f of files) {
    form.append('answer_sheets', f);
  }
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

// ── Standalone evaluation (no answer key) ──

export async function evaluateStandalone(
  sessionId: string,
): Promise<{ evaluation: Evaluation; annotated: string[] }> {
  const res = await fetch(`${BASE}/api/evaluate-standalone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Evaluation failed' }));
    throw new Error(err.error || 'Evaluation failed');
  }
  return res.json();
}

// ── Chat (SSE streaming) ──

export function streamChat(
  sessionId: string,
  message: string,
  currentPage: number,
  questionNumber?: string,
  onChunk: (text: string) => void = () => {},
  onDone: () => void = () => {},
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      current_page: currentPage,
      question_number: questionNumber,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        onDone();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) onChunk(data.text);
              if (data.done) onDone();
            } catch {
              // non-JSON SSE line
              const text = line.slice(6);
              if (text && text !== '[DONE]') onChunk(text);
            }
          }
        }
      }
      onDone();
    })
    .catch(() => {
      onDone();
    });

  return controller;
}

// ── Chat with image (cropped region) ──

export function streamChatWithImage(
  sessionId: string,
  message: string,
  imageBlob: Blob,
  selection: { x: number; y: number; w: number; h: number },
  currentPage: number,
  onChunk: (text: string) => void = () => {},
  onDone: () => void = () => {},
): AbortController {
  const controller = new AbortController();

  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('message', message);
  form.append('image', imageBlob, 'selection.jpg');
  form.append('selection', JSON.stringify(selection));
  form.append('current_page', String(currentPage));

  fetch(`${BASE}/api/chat-with-image`, {
    method: 'POST',
    body: form,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        onDone();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) onChunk(data.text);
              if (data.done) onDone();
            } catch {
              const text = line.slice(6);
              if (text && text !== '[DONE]') onChunk(text);
            }
          }
        }
      }
      onDone();
    })
    .catch(() => onDone());

  return controller;
}

// ── Practice question ──

export async function getPracticeQuestion(
  sessionId: string,
  questionNumber: string,
): Promise<{ question: string; hint: string }> {
  const res = await fetch(`${BASE}/api/practice-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, question_number: questionNumber }),
  });
  if (!res.ok) throw new Error('Failed to generate practice question');
  return res.json();
}

// ── TTS ──

export async function textToSpeech(text: string): Promise<Blob> {
  const res = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: 'Kore' }),
  });
  if (!res.ok) throw new Error('TTS failed');
  return res.blob();
}

// ── Annotation types ──

export async function getAnnotationTypes(): Promise<
  Record<string, { color: string; icon: string }>
> {
  const res = await fetch(`${BASE}/api/annotation-types`);
  return res.json();
}

// ── Clear session ──

export async function clearSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, target: 'all' }),
  });
}

// ── Image URL helper ──

export function imageUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${BASE}${path}`;
}
