import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import CaptureModal from '../components/CaptureModal'
import { preprocessImage, evaluateWorksheet, annotateWorksheet, saveSession, listSessions } from '../api'
import { EvaluationResult } from '../types'

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

  const handleCapture = useCallback(async (base64: string, mimeType: string, dataUrl: string) => {
    setShowCapture(false)
    setProcessing(true)

    try {
      // Step 1: Perspective-correct the image
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
      } catch {
        // Preprocess failed, use original
      }

      // Step 2: Evaluate with (possibly corrected) image
      setProcessingStep('Analyzing worksheet...')
      const evalResult = await evaluateWorksheet(imgB64, imgMime)

      // Step 3: Annotate with same corrected image
      setProcessingStep('Generating annotations...')
      const questions = evalResult.questions || []
      let autoMarks: unknown[] = []
      if (questions.length > 0) {
        try {
          const annotResult = await annotateWorksheet(imgB64, imgMime, questions)
          autoMarks = annotResult.marks || []
        } catch {
          autoMarks = []
        }
      }

      // Step 4: Save session with corrected image
      setProcessingStep('Saving session...')
      const { id } = await saveSession(imgDataUrl, evalResult, autoMarks)
      navigate(`/evaluate/${id}`)
    } catch (err) {
      console.error('Processing failed:', err)
      setProcessing(false)
      setProcessingStep('')
    }
  }, [navigate])

  const subjectCount = (name: string) => {
    return sessions.filter(s => s.result?.subject === name).length
  }

  return (
    <div className="min-h-screen bg-[#0F1923] text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1A2332] to-[#1e2d42] border-b border-white/10 px-6 py-5">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white font-bold text-sm">
                  V
                </div>
                <span className="text-orange-400 font-bold text-lg tracking-tight">VED</span>
              </div>
              <p className="text-white/50 text-sm">AI Worksheet Evaluator</p>
            </div>
            <div className="text-right">
              <p className="text-white/30 text-xs">Total Sessions</p>
              <p className="text-white font-bold text-2xl">{sessions.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Hero CTA */}
        <div className="rounded-2xl bg-gradient-to-br from-orange-600/20 to-orange-500/10 border border-orange-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-white font-bold text-2xl mb-1">Scan a Worksheet</h1>
              <p className="text-white/60 text-sm max-w-xs">
                Upload or capture your worksheet. AI evaluates every answer instantly.
              </p>
            </div>
            <button
              onClick={() => setShowCapture(true)}
              className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-3xl shadow-lg shadow-orange-500/30 hover:scale-105 active:scale-95 transition-transform"
            >
              📷
            </button>
          </div>
        </div>

        {/* Subject cards */}
        <div>
          <h2 className="text-white/70 text-sm font-medium uppercase tracking-wider mb-4">Subjects</h2>
          <div className="grid grid-cols-3 gap-4">
            {SUBJECTS.map(sub => {
              const count = subjectCount(sub.name)
              const pct = Math.min(100, count * 20)
              return (
                <div
                  key={sub.name}
                  className={`rounded-2xl bg-gradient-to-br ${sub.bgGrad} border border-white/10 p-4 cursor-pointer hover:border-white/20 transition-colors`}
                  onClick={() => setShowCapture(true)}
                >
                  <div className="text-3xl mb-3">{sub.icon}</div>
                  <p className="text-white font-semibold text-sm mb-1">{sub.name}</p>
                  <div className="space-y-1">
                    {sub.topics.slice(0, 2).map(t => (
                      <p key={t} className="text-white/40 text-xs">{t}</p>
                    ))}
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-white/30 text-xs">{count} sessions</span>
                    </div>
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
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
          <h2 className="text-white/70 text-sm font-medium uppercase tracking-wider mb-4">Recent Worksheets</h2>
          {loadingSessions ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-white/50 text-sm">No worksheets yet</p>
              <p className="text-white/30 text-xs mt-1">Scan your first worksheet to get started</p>
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
                    className="rounded-xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/8 transition-all cursor-pointer p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate">{s.result.worksheetTitle || 'Untitled Worksheet'}</p>
                        <p className="text-white/40 text-xs mt-0.5">
                          {s.result.subject} • {s.result.topic || s.result.chapter} • {formatDate(s.timestamp)}
                        </p>
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {statuses.slice(0, 6).map((st, i) => (
                            <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(st)}`}>
                              Q{i + 1}
                            </span>
                          ))}
                          {statuses.length > 6 && (
                            <span className="text-xs text-white/30">+{statuses.length - 6} more</span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className={`text-xl font-bold ${pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                          {pct}%
                        </div>
                        <p className="text-white/40 text-xs">{score.correct}/{score.total}</p>
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
        onClick={() => setShowCapture(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-400 flex items-center justify-center text-white text-2xl shadow-xl shadow-orange-500/40 hover:scale-110 active:scale-95 transition-transform z-40"
      >
        +
      </button>

      {/* Capture modal */}
      {showCapture && (
        <CaptureModal
          onCapture={handleCapture}
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
