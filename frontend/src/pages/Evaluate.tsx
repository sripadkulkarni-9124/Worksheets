import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSession, annotateWorksheet, updateSessionMarks } from '../api'
import { EvaluationSession, EvaluatedQuestion } from '../types'
import AnnotationStage from '../components/AnnotationStage'
import ErrorBoundary from '../components/ErrorBoundary'
import EvalPanel from '../components/EvalPanel/EvalPanel'
import ReattemptModal from '../components/ReattemptModal'
import AskVedChat from '../components/AskVedChat'
import CaptureModal from '../components/CaptureModal'
import { preprocessImage, evaluateWorksheet, saveSession } from '../api'
import MathText from '../components/MathText'

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
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [highlightedStep, setHighlightedStep] = useState<number | null>(null)
  const [activePage, setActivePage] = useState(0)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showReattempt, setShowReattempt] = useState(false)
  const [showCapture, setShowCapture] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState('')
  const [annotating, setAnnotating] = useState(false)
  const [annotWarning, setAnnotWarning] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // Reset active question when switching pages
  useEffect(() => { setActiveQ(0) }, [activePage])
  // Clear annotation highlight when active Q changes
  useEffect(() => { setActiveAnnotationId(null); setHighlightedStep(null) }, [activeQ])

  const handleAnnotationSelect = useCallback((annId: string | null, stepRef: number | null) => {
    if (annId === null || activeAnnotationId === annId) {
      setActiveAnnotationId(null); setHighlightedStep(null)
    } else {
      setActiveAnnotationId(annId); setHighlightedStep(stepRef)
    }
  }, [activeAnnotationId])

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

  // Sync activeQ to scroll position in right panel — topmost visible card wins
  useEffect(() => {
    const root = rightPanelRef.current
    if (!root) return
    const onScroll = () => {
      if (Date.now() - lastProgrammaticScrollRef.current < 600) return
      const rootRect = root.getBoundingClientRect()
      const anchor = rootRect.top + 80
      let bestIdx = 0
      let bestDist = Infinity
      qCardRefs.current.forEach((el, i) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const d = Math.abs(r.top - anchor)
        if (r.top <= anchor + 20 && d < bestDist) { bestDist = d; bestIdx = i }
      })
      setActiveQ(prev => prev === bestIdx ? prev : bestIdx)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [session])

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
        // Count score_pills only (one per question) — bbox also emits one per Q but don't double-count
        const existingPills = (data.autoMarks || []).filter((m: { type: string }) => m.type === 'score_pill')
        const pillCount = existingPills.length
        // Fallback: old sessions may have bbox but no score_pill
        const bboxCount = (data.autoMarks || []).filter((m: { type: string }) => m.type === 'bbox').length
        const markCount = pillCount || bboxCount
        const needsReannotate = markCount === 0 || markCount !== questions.length
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
            await updateSessionMarks(id, marks, 0)
            setSession(prev => {
              if (!prev) return prev
              const newPages = prev.pages ? [...prev.pages] : undefined
              if (newPages && newPages[0]) newPages[0] = { ...newPages[0], autoMarks: marks }
              return { ...prev, autoMarks: marks, ...(newPages ? { pages: newPages } : {}) }
            })
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

  const rightPanelRef = useRef<HTMLDivElement>(null)
  const qCardRefs = useRef<(HTMLDivElement | null)[]>([])
  const lastProgrammaticScrollRef = useRef<number>(0)

  const handleQuestionClick = useCallback((qi: number) => {
    setActiveQ(qi)
    lastProgrammaticScrollRef.current = Date.now()
    const node = qCardRefs.current[qi]
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

  const handleCaptureMulti = useCallback(async (files: Array<{ base64: string; mimeType: string; dataUrl: string }>) => {
    setShowCapture(false)
    setProcessing(true)
    const collected: Array<{ imageDataUrl: string; result: unknown; autoMarks: unknown[] }> = []
    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingStep(`Processing page ${i + 1} of ${files.length}...`)
        const f = files[i]
        let imgB64 = f.base64, imgMime = f.mimeType, imgDataUrl = f.dataUrl
        try {
          const pp = await preprocessImage(f.base64, f.mimeType)
          if (pp.corrected) { imgB64 = pp.imageBase64; imgMime = pp.mimeType; imgDataUrl = pp.dataUrl }
        } catch { /* use original */ }
        const evalResult = await evaluateWorksheet(imgB64, imgMime)
        const questions = evalResult.questions || []
        let autoMarks: unknown[] = []
        if (questions.length > 0) {
          try {
            const annotResult = await annotateWorksheet(imgB64, imgMime, questions)
            autoMarks = annotResult.marks || []
          } catch { autoMarks = [] }
        }
        collected.push({ imageDataUrl: imgDataUrl, result: evalResult, autoMarks })
      }
      if (collected.length === 0) return
      setProcessingStep('Saving session...')
      const { saveSessionMulti } = await import('../api')
      const { id: newId } = await saveSessionMulti(collected)
      navigate(`/evaluate/${newId}`)
    } catch (err) {
      console.error('Multi-file processing failed:', err)
    } finally {
      setProcessing(false)
      setProcessingStep('')
    }
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen  flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white/60">Loading session...</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen  flex items-center justify-center">
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

  // Multi-page support: use pages[activePage] if present, else fall back to flat fields
  const pages = (session.pages && session.pages.length > 0)
    ? session.pages
    : [{ imageDataUrl: session.imageDataUrl, result: session.result, autoMarks: session.autoMarks }]
  const pageCount = pages.length
  const safePageIdx = Math.min(activePage, pageCount - 1)
  const currentPage = pages[safePageIdx]
  const result = currentPage.result
  const imageDataUrl = currentPage.imageDataUrl
  const autoMarks = currentPage.autoMarks
  const questions: EvaluatedQuestion[] = result.questions || []
  const activeQuestion = questions[activeQ] || questions[0]

  // Aggregate score across all pages
  const aggScore = (() => {
    let correct = 0, total = 0
    for (const p of pages) {
      const qs = p.result?.questions || []
      total += qs.length
      correct += qs.filter(q => q.status === 'correct').length
    }
    return { correct, total, pct: total > 0 ? Math.round((correct / total) * 100) : 0 }
  })()

  // No-match guard — template didn't match student's work
  if (!loading && questions.length === 0) {
    return (
      <div className="min-h-[100dvh]  flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8">
          <div className="text-4xl">🤔</div>
          <h2 className="text-white text-xl font-bold">No matching answers found</h2>
          <p className="text-white/70 text-sm leading-relaxed">
            VED couldn't match any question from <span className="text-amber-300 font-medium">"{result.worksheetTitle || 'the selected question set'}"</span> to the student's handwritten work.
          </p>
          <div className="text-white/50 text-xs space-y-1 bg-white/5 rounded-lg p-3 text-left">
            <p>Possible causes:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Template doesn't match the worksheet the student solved</li>
              <li>Handwriting was too unclear to OCR</li>
              <li>Student used different question numbering</li>
            </ul>
          </div>
          {imageDataUrl && (
            <img src={imageDataUrl} alt="Captured" className="mx-auto max-h-40 rounded-lg border border-white/10" />
          )}
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={() => navigate('/')} className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/15">
              ← Back to Home
            </button>
            <button onClick={() => setShowCapture(true)} className="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm hover:bg-orange-400">
              Retake Photo
            </button>
          </div>
        </div>
      </div>
    )
  }

  // (per-page score available via questions.filter; aggScore above aggregates across pages)
  const cfg = activeQuestion ? STATUS_CONFIG[activeQuestion.status] : STATUS_CONFIG.unanswered

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="ved-header px-5 py-3 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 transition-colors flex items-center justify-center text-white"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate drop-shadow">{result.worksheetTitle}</p>
            <p className="text-white/70 text-xs">{result.subject} • {result.chapter}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {annotating && (
              <div className="flex items-center gap-1.5 text-amber-100 text-xs">
                <div className="w-3 h-3 border border-amber-100 border-t-transparent rounded-full animate-spin" />
                Annotating...
              </div>
            )}
            <div className={`px-3 py-1.5 rounded-xl text-sm font-bold backdrop-blur ${aggScore.pct >= 70 ? 'bg-green-500/30 text-green-50' : aggScore.pct >= 40 ? 'bg-amber-500/30 text-amber-50' : 'bg-red-500/30 text-red-50'}`}
                 title={pageCount > 1 ? `Aggregate across ${pageCount} pages` : 'Score'}>
              {aggScore.pct}% ({aggScore.correct}/{aggScore.total})
              {pageCount > 1 && <span className="ml-1 text-[10px] opacity-80">• {pageCount}p</span>}
            </div>
            <button
              onClick={() => setShowCapture(true)}
              className="px-3 py-1.5 rounded-xl bg-white/20 text-white text-xs font-medium hover:bg-white/30 transition-colors backdrop-blur"
            >
              Scan Again
            </button>
          </div>
        </div>
      </div>

      {/* (page switcher moved to bottom of LEFT panel below) */}

      {/* Two-panel body — stacks on mobile, side-by-side on md+ */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 p-3 gap-3">
        {/* LEFT: Worksheet image + Konva stage */}
        <div className="ved-panel--worksheet rounded-3xl w-full h-[55vh] md:h-auto md:w-[52%] flex flex-col min-h-0 overflow-hidden">
          <div className="ved-glass-strip flex items-center justify-between px-4 py-2.5 border-b border-white/30 flex-shrink-0">
            <p className="text-slate-700 text-xs font-semibold uppercase tracking-wide">Annotated Worksheet</p>
            <button
              onClick={() => setShowFeedback(f => !f)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                showFeedback
                  ? 'bg-amber-500/40 text-amber-900 border border-amber-500/50'
                  : 'bg-white/50 text-slate-700 border border-white/60 hover:bg-white/70'
              }`}
            >
              {showFeedback ? 'Hide Markings' : 'Show Markings'}
            </button>
          </div>

          {/* Stage container */}
          <div ref={leftPanelRef} className="flex-1 overflow-hidden relative">
            {containerSize.width > 0 && containerSize.height > 0 && (
              <ErrorBoundary name="AnnotationStage">
                <AnnotationStage
                  imageDataUrl={imageDataUrl}
                  autoMarks={autoMarks || []}
                  activeQ={activeQ}
                  onQuestionClick={handleQuestionClick}
                  onAnnotationClick={handleAnnotationSelect}
                  activeAnnotationId={activeAnnotationId}
                  showFeedback={showFeedback}
                  questions={questions}
                  containerSize={containerSize}
                />
              </ErrorBoundary>
            )}
          </div>

          {/* Page switcher — only when >1 page, at bottom of left panel */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-white/30 bg-white/40 backdrop-blur flex-shrink-0">
              <button
                onClick={() => setActivePage(p => Math.max(0, p - 1))}
                disabled={safePageIdx === 0}
                className="w-9 h-9 rounded-full bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center shadow"
                title="Previous page"
              >
                ←
              </button>
              <span className="text-slate-800 text-sm font-semibold">
                Worksheet {safePageIdx + 1}
                {pageCount > 1 && <span className="text-slate-500 text-xs ml-1.5">of {pageCount}</span>}
              </span>
              <button
                onClick={() => setActivePage(p => Math.min(pageCount - 1, p + 1))}
                disabled={safePageIdx >= pageCount - 1}
                className="w-9 h-9 rounded-full bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center shadow"
                title="Next page"
              >
                →
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: EvalPanel per design handoff */}
        <EvalPanel
          questions={questions}
          activeQ={activeQ}
          activeAnnotationId={activeAnnotationId}
          highlightedStep={highlightedStep}
          onQuestionSelect={setActiveQ}
          onAnnotationSelect={handleAnnotationSelect}
          onNextQuestion={() => setActiveQ(q => Math.min(questions.length - 1, q + 1))}
          onPractice={() => setShowReattempt(true)}
          onAskVed={() => setShowChat(true)}
        />
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
