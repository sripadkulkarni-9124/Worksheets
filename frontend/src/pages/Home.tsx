import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import CaptureModal from '../components/CaptureModal'
import {
  preprocessImage, evaluateWorksheet, annotateWorksheet, saveSession, saveSessionMulti, listSessions,
  uploadTemplate, listTemplates, deleteTemplate,
} from '../api'
import { EvaluationResult, TemplateSummary } from '../types'

interface SessionSummary {
  id: string
  result: EvaluationResult
  timestamp: string
}

const SUBJECTS = [
  {
    name: 'Mathematics',
    icon: '📐',
    gradient: 'from-blue-600 to-purple-600',
    bgGrad: 'from-blue-900/30 to-purple-900/30',
    topics: ['Algebra', 'Geometry', 'Calculus'],
  },
  {
    name: 'Physics',
    icon: '⚛️',
    gradient: 'from-cyan-600 to-blue-600',
    bgGrad: 'from-cyan-900/30 to-blue-900/30',
    topics: ['Mechanics', 'Optics', 'Electricity'],
  },
  {
    name: 'Chemistry',
    icon: '🧪',
    gradient: 'from-green-600 to-teal-600',
    bgGrad: 'from-green-900/30 to-teal-900/30',
    topics: ['Organic', 'Inorganic', 'Physical'],
  },
]

function getScore(result: EvaluationResult): { correct: number; total: number } {
  const qs = result.questions || []
  return {
    correct: qs.filter(q => q.status === 'correct').length,
    total: qs.length,
  }
}

function formatDate(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ts
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    correct: 'bg-green-500/20 text-green-300',
    incorrect: 'bg-red-500/20 text-red-300',
    partially_correct: 'bg-amber-500/20 text-amber-300',
    unanswered: 'bg-gray-500/20 text-gray-400',
  }
  return map[status] || map.unanswered
}

export default function Home() {
  const navigate = useNavigate()
  const [showCapture, setShowCapture] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)

  /* ─── Templates (teacher-uploaded question sets) ─── */
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [promptVersion, setPromptVersion] = useState<'v1' | 'v2'>(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('promptVersion') as 'v1' | 'v2')) || 'v2'
  )
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('promptVersion', promptVersion)
  }, [promptVersion])
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshTemplates = useCallback(() => {
    listTemplates()
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
  }, [])

  useEffect(() => { refreshTemplates() }, [refreshTemplates])

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-uploading same file
    if (!file) return
    setUploadMsg('Reading file...')
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      // Minimal client-side validation
      if (!parsed.title || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error('JSON must have "title" and non-empty "questions" array')
      }
      for (const q of parsed.questions) {
        if (typeof q.number !== 'number' || !q.questionText || !q.correctAnswer) {
          throw new Error(`Each question needs number, questionText, correctAnswer`)
        }
        if (typeof q.marks_possible !== 'number') q.marks_possible = 1
      }
      setUploadMsg('Uploading...')
      const result = await uploadTemplate(parsed)
      setUploadMsg(`✓ Uploaded: ${result.title} (${result.question_count} questions)`)
      setSelectedTemplateId(result.id)
      refreshTemplates()
      setTimeout(() => setUploadMsg(null), 3500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploadMsg(`✗ ${msg}`)
      setTimeout(() => setUploadMsg(null), 5000)
    }
  }, [refreshTemplates])

  const handleDeleteTemplate = useCallback(async (id: string) => {
    if (!confirm('Delete this question set?')) return
    try {
      await deleteTemplate(id)
      if (selectedTemplateId === id) setSelectedTemplateId(null)
      refreshTemplates()
    } catch {
      // ignore
    }
  }, [selectedTemplateId, refreshTemplates])

  const handleStartScan = useCallback(() => {
    if (promptVersion === 'v2' && !selectedTemplateId) {
      setUploadMsg('✗ Select a question set first (v2 requires template)')
      setTimeout(() => setUploadMsg(null), 3000)
      return
    }
    setShowCapture(true)
  }, [selectedTemplateId, promptVersion])

  // Stopwatch for processing overlay
  useEffect(() => {
    if (!processing) { setElapsed(0); return }
    const t0 = Date.now()
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [processing])

  useEffect(() => {
    listSessions()
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false))
  }, [])

  /* ── Multi-page scan flow ── */
  type CapturedPage = { imageDataUrl: string; result: unknown; autoMarks: unknown[] }

  const processAndCollectPage = useCallback(async (base64: string, mimeType: string, dataUrl: string): Promise<CapturedPage | null> => {
    try {
      setProcessingStep('Straightening worksheet...')
      let imgB64 = base64
      let imgMime = mimeType
      let imgDataUrl = dataUrl
      try {
        const pp = await preprocessImage(base64, mimeType)
        if (pp.corrected) {
          imgB64 = pp.imageBase64
          imgMime = pp.mimeType
          imgDataUrl = pp.dataUrl
        }
      } catch { /* preprocess failed — use original */ }

      setProcessingStep('Analyzing worksheet...')
      const evalResult = await evaluateWorksheet(imgB64, imgMime, selectedTemplateId || undefined, promptVersion)

      setProcessingStep('Generating annotations...')
      const questions = evalResult.questions || []
      let autoMarks: unknown[] = []
      if (questions.length > 0) {
        try {
          const annotResult = await annotateWorksheet(imgB64, imgMime, questions)
          autoMarks = annotResult.marks || []
        } catch { autoMarks = [] }
      }
      return { imageDataUrl: imgDataUrl, result: evalResult, autoMarks }
    } catch (err) {
      console.error('Processing failed:', err)
      return null
    }
  }, [selectedTemplateId, promptVersion])

  const finalizeAndSave = useCallback(async (pages: CapturedPage[]) => {
    if (pages.length === 0) {
      setProcessing(false); setProcessingStep(''); return
    }
    setProcessingStep('Saving session...')
    try {
      const { id } = pages.length === 1
        ? await saveSession(pages[0].imageDataUrl, pages[0].result, pages[0].autoMarks)
        : await saveSessionMulti(pages)
      navigate(`/evaluate/${id}`)
    } catch (err) {
      console.error('Save failed:', err)
      setProcessing(false); setProcessingStep('')
    }
  }, [navigate])

  const handleCapture = useCallback(async (base64: string, mimeType: string, dataUrl: string) => {
    setShowCapture(false)
    setProcessing(true)
    const page = await processAndCollectPage(base64, mimeType, dataUrl)
    if (!page) {
      setProcessing(false); setProcessingStep(''); return
    }
    // Single capture → auto-save + navigate. No intermediate dialog.
    await finalizeAndSave([page])
  }, [processAndCollectPage, finalizeAndSave])

  const handleCaptureMulti = useCallback(async (files: Array<{ base64: string; mimeType: string; dataUrl: string }>) => {
    setShowCapture(false)
    setProcessing(true)
    const collected: CapturedPage[] = []
    for (let i = 0; i < files.length; i++) {
      setProcessingStep(`Processing page ${i + 1} of ${files.length}...`)
      const f = files[i]
      const page = await processAndCollectPage(f.base64, f.mimeType, f.dataUrl)
      if (page) collected.push(page)
    }
    if (collected.length === 0) {
      setProcessing(false); setProcessingStep(''); return
    }
    await finalizeAndSave(collected)
  }, [processAndCollectPage, finalizeAndSave])

  const subjectCount = (name: string) => {
    return sessions.filter(s => s.result?.subject === name).length
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="ved-header px-6 py-5">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                  V
                </div>
                <span className="text-white font-bold text-lg tracking-tight drop-shadow">VED</span>
              </div>
              <p className="text-white/80 text-sm drop-shadow">AI Worksheet Evaluator</p>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs">Total Sessions</p>
              <p className="text-white font-bold text-2xl drop-shadow">{sessions.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Hero CTA */}
        <div className="ved-panel--questions rounded-3xl p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-slate-800 font-bold text-2xl mb-1">Scan a Worksheet</h1>
              <p className="text-slate-600 text-sm max-w-xs">
                {promptVersion === 'v2'
                  ? "Select a question set below, then scan the student's handwritten work."
                  : "V1 scans full worksheet without a template."}
              </p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <label className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Prompt</label>
                <div className="inline-flex rounded-lg bg-white/60 border border-slate-200 overflow-hidden text-xs">
                  {(['v1', 'v2'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setPromptVersion(v)}
                      className={`px-3 py-1.5 font-medium transition-colors ${
                        promptVersion === v
                          ? 'bg-orange-500 text-white'
                          : 'text-slate-600 hover:bg-white/80'
                      }`}
                    >
                      {v.toUpperCase()}
                    </button>
                  ))}
                </div>
                <span className="text-slate-500 text-[10px]">
                  {promptVersion === 'v1' ? 'full-worksheet • no template' : 'template-driven • CBSE K-12'}
                </span>
              </div>
            </div>
            <button
              onClick={handleStartScan}
              disabled={promptVersion === 'v2' && !selectedTemplateId}
              className={`flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg transition-transform ${
                promptVersion === 'v1' || selectedTemplateId
                  ? 'bg-gradient-to-br from-orange-500 to-orange-400 shadow-orange-500/40 hover:scale-105 active:scale-95'
                  : 'bg-slate-200 opacity-60 cursor-not-allowed'
              }`}
            >
              📷
            </button>
          </div>
        </div>

        {/* Question Sets (Templates) */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white text-sm font-semibold uppercase tracking-wider drop-shadow">Question Sets</h2>
            <button
              onClick={handleUploadClick}
              className="px-3 py-1.5 rounded-xl bg-white/25 backdrop-blur text-white text-xs font-medium hover:bg-white/35 transition-colors border border-white/30"
            >
              + Upload JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          {uploadMsg && (
            <div className={`mb-3 px-3 py-2 rounded-lg text-xs backdrop-blur ${
              uploadMsg.startsWith('✓') ? 'bg-green-500/30 text-green-50' :
              uploadMsg.startsWith('✗') ? 'bg-red-500/30 text-red-50' :
              'bg-white/20 text-white'
            }`}>
              {uploadMsg}
            </div>
          )}
          {templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/30 bg-white/5 backdrop-blur p-8 text-center">
              <p className="text-white/90 text-sm">No question sets uploaded yet.</p>
              <p className="text-white/70 text-xs mt-1">Upload a JSON with title + questions to begin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map(t => {
                const isSelected = t.id === selectedTemplateId
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTemplateId(t.id)}
                    className={`rounded-xl p-4 cursor-pointer transition-all border-2 backdrop-blur ${
                      isSelected
                        ? 'bg-white/90 border-orange-500 shadow-lg shadow-orange-500/20'
                        : 'bg-white/25 border-white/30 hover:bg-white/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm truncate ${isSelected ? 'text-slate-800' : 'text-white drop-shadow'}`}>{t.title}</p>
                        <p className={`text-xs mt-0.5 ${isSelected ? 'text-slate-500' : 'text-white/80'}`}>
                          {[t.subject, t.chapter].filter(Boolean).join(' • ') || 'No subject'}
                        </p>
                        <p className={`text-xs mt-1 ${isSelected ? 'text-slate-600' : 'text-white/90'}`}>{t.question_count} questions</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id) }}
                        className={`text-xs px-2 py-1 transition-colors ${isSelected ? 'text-slate-400 hover:text-red-500' : 'text-white/60 hover:text-red-200'}`}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Subject cards */}
        <div>
          <h2 className="text-white text-sm font-semibold uppercase tracking-wider mb-4 drop-shadow">Subjects</h2>
          <div className="grid grid-cols-3 gap-4">
            {SUBJECTS.map(sub => {
              const count = subjectCount(sub.name)
              const pct = Math.min(100, count * 20)
              return (
                <div
                  key={sub.name}
                  className="rounded-2xl bg-white/20 backdrop-blur border border-white/30 p-4 cursor-pointer hover:bg-white/30 transition-colors"
                  onClick={handleStartScan}
                >
                  <div className="text-3xl mb-3">{sub.icon}</div>
                  <p className="text-white font-semibold text-sm mb-1 drop-shadow">{sub.name}</p>
                  <div className="space-y-1">
                    {sub.topics.slice(0, 2).map(t => (
                      <p key={t} className="text-white/75 text-xs">{t}</p>
                    ))}
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white/70 text-xs">{count} sessions</span>
                    </div>
                    <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${sub.gradient} rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent sessions */}
        <div>
          <h2 className="text-white text-sm font-semibold uppercase tracking-wider mb-4 drop-shadow">Recent Worksheets</h2>
          {loadingSessions ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/30 bg-white/5 backdrop-blur p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-white/90 text-sm">No worksheets yet</p>
              <p className="text-white/70 text-xs mt-1">Scan your first worksheet to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => {
                const score = getScore(s.result)
                const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0
                const statuses = (s.result.questions || []).map(q => q.status)
                return (
                  <div
                    key={s.id}
                    onClick={() => navigate(`/evaluate/${s.id}`)}
                    className="rounded-xl bg-white/75 backdrop-blur border border-white/50 hover:bg-white/90 transition-all cursor-pointer p-4 shadow-lg shadow-black/5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-800 font-semibold text-sm truncate">{s.result.worksheetTitle || 'Untitled Worksheet'}</p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {s.result.subject} • {s.result.topic || s.result.chapter} • {formatDate(s.timestamp)}
                        </p>
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {statuses.slice(0, 6).map((st, i) => (
                            <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(st)}`}>
                              Q{i + 1}
                            </span>
                          ))}
                          {statuses.length > 6 && (
                            <span className="text-xs text-slate-500">+{statuses.length - 6} more</span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className={`text-xl font-bold ${pct >= 70 ? 'text-green-600' : pct >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                          {pct}%
                        </div>
                        <p className="text-slate-500 text-xs">{score.correct}/{score.total}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* FAB */}
      <button
        onClick={handleStartScan}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white text-2xl shadow-xl shadow-orange-500/40 hover:scale-110 active:scale-95 transition-transform z-40"
      >
        +
      </button>

      {/* Capture modal */}
      {showCapture && (
        <CaptureModal
          onCapture={handleCapture}
          onCaptureMulti={handleCaptureMulti}
          onClose={() => setShowCapture(false)}
        />
      )}

      {/* Processing overlay */}
      {processing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
          <div className="space-y-6 text-center">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-orange-500/30" />
              <div className="absolute inset-0 rounded-full border-4 border-orange-500 border-t-transparent animate-spin" />
              <div className="absolute inset-3 rounded-full bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-2xl">
                🤖
              </div>
            </div>
            <div>
              <p className="text-white font-bold text-xl mb-1">VED is working...</p>
              <p className="text-white/60 text-sm animate-pulse">{processingStep}</p>
            </div>
            <div className="font-mono text-orange-400 text-2xl font-bold tabular-nums">
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </div>
            <div className="flex gap-2 justify-center">
              {['Analyzing', 'Evaluating', 'Annotating'].map((s, i) => (
                <div
                  key={s}
                  className="w-2 h-2 rounded-full bg-orange-400 animate-bounce"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
