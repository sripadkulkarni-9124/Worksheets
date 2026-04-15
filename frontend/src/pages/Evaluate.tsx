import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSession, annotateWorksheet, updateSessionMarks } from '../api'
import { EvaluationSession, EvaluatedQuestion } from '../types'
import AnnotationStage from '../components/AnnotationStage'
import StepByStep from '../components/StepByStep'
import ReattemptModal from '../components/ReattemptModal'
import AskVedChat from '../components/AskVedChat'
import CaptureModal from '../components/CaptureModal'
import { preprocessImage, evaluateWorksheet, saveSession } from '../api'

const STATUS_CONFIG = {
  correct: {
    label: 'Correct',
    icon: '✓',
    bg: 'bg-green-900/30',
    border: 'border-green-500/30',
    text: 'text-green-400',
    dot: 'bg-green-500',
    badge: 'bg-green-500/20 text-green-300',
  },
  incorrect: {
    label: 'Incorrect',
    icon: '✗',
    bg: 'bg-red-900/30',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-500',
    badge: 'bg-red-500/20 text-red-300',
  },
  partially_correct: {
    label: 'Partial',
    icon: '◑',
    bg: 'bg-amber-900/30',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/20 text-amber-300',
  },
  unanswered: {
    label: 'Unanswered',
    icon: '—',
    bg: 'bg-gray-900/30',
    border: 'border-gray-500/30',
    text: 'text-gray-400',
    dot: 'bg-gray-500',
    badge: 'bg-gray-500/20 text-gray-400',
  },
}

export default function Evaluate() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<EvaluationSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeQ, setActiveQ] = useState(0)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showReattempt, setShowReattempt] = useState(false)
  const [showCapture, setShowCapture] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState('')
  const [annotating, setAnnotating] = useState(false)
  const [annotWarning, setAnnotWarning] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // Stopwatch for processing overlay
  useEffect(() => {
    if (!processing) { setElapsed(0); return }
    const t0 = Date.now()
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [processing])

  const leftPanelRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // Measure container size — use getBoundingClientRect (more reliable than contentRect for overflow:hidden)
  useLayoutEffect(() => {
    const div = leftPanelRef.current
    if (!div) return
    const measure = () => {
      const { width, height } = div.getBoundingClientRect()
      if (width > 0 || height > 0) {
        setContainerSize({ width: Math.floor(width), height: Math.floor(height) })
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(div)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [loading])

  // Load session
  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetchSession(id)
      .then(async (data) => {
        if (!data) {
          setError('Session not found')
          return
        }
        setSession(data)

        // Re-annotate if marks missing, count mismatch, or inconsistent widths (stale data)
        const questions = data.result?.questions || []
        const existingBboxes = (data.autoMarks || []).filter((m: { type: string; w?: number }) => m.type === 'bbox')
        const bboxCount = existingBboxes.length
        const needsReannotate = bboxCount === 0 || bboxCount !== questions.length
        if (questions.length > 0 && needsReannotate) {
          setAnnotating(true)
          try {
            // We need the base64 from the dataUrl
            const parts = data.imageDataUrl.split(',')
            const base64 = parts[1] || ''
            const mimeMatch = data.imageDataUrl.match(/data:([^;]+);/)
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
            const annotResult = await annotateWorksheet(base64, mimeType, questions)
            const marks = annotResult.marks || []
            await updateSessionMarks(id, marks)
            setSession(prev => prev ? { ...prev, autoMarks: marks } : prev)
            // Check if fewer bboxes than questions
            const detectedBboxes = marks.filter((m: { type: string }) => m.type === 'bbox').length
            if (detectedBboxes < questions.length) {
              setAnnotWarning(`Detected ${detectedBboxes} of ${questions.length} question boundaries. Some annotations may be missing.`)
            }
          } catch {
            setAnnotWarning('Annotation failed. Showing results without visual annotations.')
          } finally {
            setAnnotating(false)
          }
        }
      })
      .catch((err) => {
        console.error('[Evaluate] Failed to load session:', err)
        setError('Failed to load session')
      })
      .finally(() => setLoading(false))
  }, [id])

  const handleQuestionClick = useCallback((qi: number) => {
    setActiveQ(qi)
  }, [])

  const handleCapture = useCallback(async (base64: string, mimeType: string, dataUrl: string) => {
    setShowCapture(false)
    setProcessing(true)

    try {
      // Perspective-correct first
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
      } catch { /* use original */ }

      setProcessingStep('Analyzing worksheet...')
      const evalResult = await evaluateWorksheet(imgB64, imgMime)

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

      setProcessingStep('Saving session...')
      const { id: newId } = await saveSession(imgDataUrl, evalResult, autoMarks)
      navigate(`/evaluate/${newId}`)
    } catch (err) {
      console.error('Processing failed:', err)
    } finally {
      setProcessing(false)
      setProcessingStep('')
    }
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F1923] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/60">Loading session...</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#0F1923] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">{error || 'Session not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/15 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    )
  }

  const { result, imageDataUrl, autoMarks } = session
  const questions: EvaluatedQuestion[] = result.questions || []
  const activeQuestion = questions[activeQ] || questions[0]

  const scoreCorrect = questions.filter(q => q.status === 'correct').length
  const scorePct = questions.length > 0 ? Math.round((scoreCorrect / questions.length) * 100) : 0
  const cfg = activeQuestion ? STATUS_CONFIG[activeQuestion.status] : STATUS_CONFIG.unanswered

  return (
    <div className="h-screen bg-[#0F1923] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1A2332] to-[#1e2d42] border-b border-white/10 px-5 py-3 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 transition-colors flex items-center justify-center text-white/70"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate">{result.worksheetTitle}</p>
            <p className="text-white/40 text-xs">{result.subject} • {result.chapter}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {annotating && (
              <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                Annotating...
              </div>
            )}
            <div className={`px-3 py-1.5 rounded-xl text-sm font-bold ${scorePct >= 70 ? 'bg-green-500/20 text-green-300' : scorePct >= 40 ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'}`}>
              {scorePct}% ({scoreCorrect}/{questions.length})
            </div>
            <button
              onClick={() => setShowCapture(true)}
              className="px-3 py-1.5 rounded-xl bg-orange-500/20 text-orange-300 text-xs font-medium hover:bg-orange-500/30 transition-colors"
            >
              Scan Again
            </button>
          </div>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* LEFT: Worksheet image + Konva stage */}
        <div className="w-[52%] flex flex-col border-r border-white/10 bg-[#111827]">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 flex-shrink-0">
            <p className="text-white/50 text-xs font-medium uppercase tracking-wide">Annotated Worksheet</p>
            <button
              onClick={() => setShowFeedback(f => !f)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                showFeedback
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                  : 'bg-white/5 text-white/50 border border-white/10 hover:text-white/70'
              }`}
            >
              {showFeedback ? 'Hide Feedback' : 'Show Feedback'}
            </button>
          </div>

          {/* Stage container */}
          <div ref={leftPanelRef} className="flex-1 overflow-hidden relative">
            {containerSize.width > 0 && containerSize.height > 0 && (
              <AnnotationStage
                imageDataUrl={imageDataUrl}
                autoMarks={autoMarks || []}
                activeQ={activeQ}
                onQuestionClick={handleQuestionClick}
                showFeedback={showFeedback}
                questions={questions}
                containerSize={containerSize}
              />
            )}
          </div>

          {/* Page nav bar */}
          <div className="px-4 py-2.5 border-t border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto">
              {questions.map((q, i) => {
                const qcfg = STATUS_CONFIG[q.status]
                return (
                  <button
                    key={i}
                    onClick={() => setActiveQ(i)}
                    className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      i === activeQ
                        ? `${qcfg.dot} text-white scale-110 shadow-lg`
                        : `bg-white/10 text-white/50 hover:bg-white/15`
                    }`}
                  >
                    {i + 1}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Question details panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0F1923]">
          {/* Q tabs */}
          <div className="flex border-b border-white/10 overflow-x-auto flex-shrink-0 scrollbar-hide">
            {questions.map((q, i) => {
              const qcfg = STATUS_CONFIG[q.status]
              return (
                <button
                  key={i}
                  onClick={() => setActiveQ(i)}
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b-2 ${
                    i === activeQ
                      ? 'text-white border-orange-400 bg-white/5'
                      : 'text-white/40 border-transparent hover:text-white/60 hover:bg-white/3'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${qcfg.dot}`} />
                  Q{q.number}
                </button>
              )
            })}
          </div>

          {/* Question detail scroll */}
          {activeQuestion && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Question text */}
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wide font-medium mb-2">
                  Question {activeQuestion.number}
                </p>
                <p className="text-white text-base font-medium leading-relaxed">
                  {activeQuestion.questionText}
                </p>
              </div>

              {/* Status banner */}
              <div className={`rounded-xl ${cfg.bg} border ${cfg.border} px-4 py-3 flex items-center gap-3`}>
                <div className={`w-8 h-8 rounded-full bg-white/10 flex items-center justify-center ${cfg.text} font-bold text-lg`}>
                  {cfg.icon}
                </div>
                <div className="flex-1">
                  <p className={`${cfg.text} font-semibold text-sm`}>{cfg.label}</p>
                  {activeQuestion.studentAnswer && (
                    <p className="text-white/50 text-xs mt-0.5">
                      Student wrote: <span className="text-white/70 italic">"{activeQuestion.studentAnswer}"</span>
                    </p>
                  )}
                </div>
                {/* Marks badge */}
                {(() => {
                  const bboxMark = (autoMarks || []).find(
                    (m: { type: string; label?: string }) => m.type === 'badge' && m.label === `Q${activeQuestion.number}`
                  ) as { marks_awarded?: number; marks_possible?: number } | undefined
                  if (bboxMark && bboxMark.marks_possible) {
                    return (
                      <div className="text-right flex-shrink-0">
                        <p className={`${cfg.text} font-bold text-lg`}>{bboxMark.marks_awarded ?? 0}/{bboxMark.marks_possible}</p>
                        <p className="text-white/30 text-xs">marks</p>
                      </div>
                    )
                  }
                  return null
                })()}
              </div>

              {/* Correct answer */}
              <div className="rounded-xl bg-green-900/20 border border-green-500/25 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-green-400 text-sm">✓</span>
                  <p className="text-green-300 text-xs font-semibold uppercase tracking-wide">Correct Answer</p>
                </div>
                <p className="text-white font-medium">{activeQuestion.correctAnswer}</p>
              </div>

              {/* VED Insight */}
              <div className="rounded-xl bg-purple-900/20 border border-purple-500/25 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                    V
                  </div>
                  <p className="text-purple-300 text-xs font-semibold uppercase tracking-wide">VED Insight</p>
                </div>
                <p className="text-white/80 text-sm leading-relaxed">{activeQuestion.vedInsight}</p>
              </div>

              {/* Feedback */}
              <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-400 text-sm">💡</span>
                  <p className="text-white/60 text-xs font-semibold uppercase tracking-wide">Feedback</p>
                </div>
                <p className="text-white/80 text-sm leading-relaxed">{activeQuestion.feedback}</p>
              </div>

              {/* Step by step */}
              <StepByStep steps={activeQuestion.steps} />

              {/* Action buttons */}
              <div className="flex gap-3 pt-2 pb-4">
                <button
                  onClick={() => setShowReattempt(true)}
                  className="flex-1 py-3 rounded-xl border border-orange-500/40 text-orange-300 text-sm font-medium hover:bg-orange-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <span>✏️</span>
                  Reattempt
                </button>
                <button
                  onClick={() => setShowChat(true)}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">V</div>
                  Ask VED
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Warning toast */}
      {annotWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md animate-pulse">
          <div className="bg-amber-900/90 border border-amber-500/50 rounded-xl px-5 py-3 flex items-center gap-3 shadow-xl">
            <span className="text-amber-400 text-lg">⚠️</span>
            <p className="text-amber-200 text-sm flex-1">{annotWarning}</p>
            <button onClick={() => setAnnotWarning(null)} className="text-amber-400/60 hover:text-amber-300 text-lg">&times;</button>
          </div>
        </div>
      )}

      {/* Overlays */}
      {showChat && activeQuestion && id && (
        <AskVedChat
          question={activeQuestion}
          sessionId={id}
          onClose={() => setShowChat(false)}
        />
      )}

      {showReattempt && activeQuestion && (
        <ReattemptModal
          question={activeQuestion}
          onClose={() => setShowReattempt(false)}
          onResult={(status, feedback) => {
            console.log('Reattempt result:', status, feedback)
          }}
        />
      )}

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
              {[0, 1, 2].map(i => (
                <div
                  key={i}
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
