import { useEffect, useMemo, useRef, useState } from 'react'
import { EvaluatedQuestion, ErrorDetail } from '../../types'
import { normalizeStatus } from './stateConfig'
import MathText from '../MathText'

const T = {
  font: {
    sans: "'DM Sans', system-ui, sans-serif",
    serif: "'Instrument Serif', Georgia, serif",
    mono: "'JetBrains Mono', monospace",
  },
  color: {
    surface: '#FFFFFF',
    text: { primary: '#1F2937', secondary: '#6B7280', tertiary: '#9CA3AF', muted: '#CBD5E1' },
    border: { light: '#F3F4F6', medium: '#E5E7EB' },
    status: {
      correct: { ring: '#10B981', dot: '#10B981', soft: '#D1FAE5', text: '#065F46', main: '#059669' },
      incorrect: { ring: '#EF4444', dot: '#EF4444', soft: '#FEE2E2', text: '#991B1B', main: '#DC2626' },
      partial: { ring: '#F59E0B', dot: '#F59E0B', soft: '#FEF3C7', text: '#92400E', main: '#D97706' },
    },
    accent: '#F97316',
    insight: { bg: '#FFF7ED', border: '#FED7AA', text: '#9A3412' },
  },
  shadow: {
    card: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
  },
}

type Status = 'correct' | 'incorrect' | 'partial'

interface StepView {
  num: number
  title: string
  detail: string
  isErr: boolean
  awarded: number
  maxMarks: number
  studentDid: string | null
  shouldBe: string | null
  skipped: boolean
}

/* Inline chip highlight — wrap numbers / simple expressions / ratios */
function withChips(text: string): (string | JSX.Element)[] {
  if (!text) return [text]
  const pattern = /(\d+(?:\s*[:+\-=×÷/*]\s*\d+)+(?:\s*[a-zA-Z]+)?|\d+\s+(?:balls|slices|items|cm|mm|m|kg|g|cones|triangles|circles)\b)/g
  const parts: (string | JSX.Element)[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index))
    parts.push(
      <span
        key={`chip-${key++}`}
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          margin: '0 2px',
          borderRadius: 5,
          background: '#FFF7ED',
          color: '#9A3412',
          fontFamily: T.font.mono,
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          border: '1px solid #FED7AA',
        }}
      >
        {match[0]}
      </span>,
    )
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts
}

function deriveSteps(q: EvaluatedQuestion): StepView[] {
  const errs: ErrorDetail[] = q.errors || []
  const rawSteps = q.steps || []
  if (rawSteps.length === 0) return []
  const status = normalizeStatus(q.status)
  const totalMax = q.marks_possible ?? 1
  const totalAwarded = q.marks_awarded ?? (status === 'correct' ? totalMax : 0)
  const n = rawSteps.length
  const perStepMax = totalMax / n
  const stepTexts = rawSteps.map(s => `${s.title} ${(s.points || []).join(' ')}`.toLowerCase())
  const errorByStep = new Map<number, ErrorDetail>()
  errs.forEach(e => {
    let idx = (e.stepRef ?? 0) - 1
    if (idx < 0 || idx >= n) {
      const desc = (e.description || e.error_type || '').toLowerCase()
      const words = desc.split(/\W+/).filter(w => w.length > 3)
      let bestIdx = 0, bestScore = 0
      stepTexts.forEach((t, i) => {
        const score = words.reduce((sum, w) => sum + (t.includes(w) ? 1 : 0), 0)
        if (score > bestScore) { bestScore = score; bestIdx = i }
      })
      idx = bestIdx
    }
    if (!errorByStep.has(idx)) errorByStep.set(idx, e)
  })
  let firstErrorIdx = -1
  for (let i = 0; i < n; i++) if (errorByStep.has(i)) { firstErrorIdx = i; break }
  const errorStepCount = errorByStep.size

  return rawSteps.map((s, i) => {
    const err = errorByStep.get(i)
    const isErr = !!err
    const before = firstErrorIdx === -1 || i < firstErrorIdx
    const after = !before && !isErr && status !== 'correct'
    let awarded = 0
    if (status === 'correct') awarded = perStepMax
    else if (isErr) awarded = 0
    else if (before) awarded = perStepMax
    else if (after) {
      if (status === 'partial') {
        const nonErr = n - errorStepCount
        awarded = nonErr > 0 ? Math.min(totalAwarded / nonErr, perStepMax) : 0
      }
    }
    // Prefer Gemini-emitted fields; fall back to heuristic
    const studentDid = isErr
      ? (err?.student_attempt || err?.description || err?.error_type || null)
      : null
    const shouldBe = isErr
      ? (err?.correct_attempt || (s.points || [])[0] || s.title)
      : null

    return {
      num: i + 1,
      title: s.title.replace(/^Step\s*\d+\s*:?\s*/i, '').trim() || s.title,
      detail: (s.points || []).join(' '),
      isErr,
      awarded: Math.round(awarded * 10) / 10,
      maxMarks: Math.round(perStepMax * 10) / 10,
      studentDid,
      shouldBe,
      skipped: after && status !== 'correct',
    }
  })
}

interface Props {
  questions: EvaluatedQuestion[]
  activeQ: number
  activeAnnotationId: string | null
  highlightedStep: number | null
  onQuestionSelect: (qi: number) => void
  onAnnotationSelect: (annId: string | null, stepRef: number | null) => void
  onNextQuestion: () => void
  onPractice: () => void
  onAskVed: () => void
}

export default function EvalPanel({
  questions,
  activeQ,
  highlightedStep,
  onQuestionSelect,
  onNextQuestion,
  onAskVed,
}: Props) {
  const q = questions[activeQ]
  const status: Status = useMemo(() => normalizeStatus(q?.status) as Status, [q?.status])
  const sc = T.color.status[status]
  const steps = useMemo(() => (q ? deriveSteps(q) : []), [q])

  const [showSteps, setShowSteps] = useState(true)
  const stepRefs = useRef<Record<number, HTMLDivElement | null>>({})

  useEffect(() => { setShowSteps(true) }, [activeQ])
  useEffect(() => {
    if (highlightedStep !== null && stepRefs.current[highlightedStep]) {
      setTimeout(() => stepRefs.current[highlightedStep]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    }
  }, [highlightedStep])

  if (!q) return null

  const studentAnswer = q.studentAnswer || '—'
  const correctAnswer = q.correctAnswer || ''
  const showYours = status !== 'correct'

  return (
    <div
      style={{
        flex: 1,
        background: T.color.surface,
        borderRadius: 24,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: T.shadow.card,
        fontFamily: T.font.sans,
        minHeight: 0,
        position: 'relative',
      }}
    >
      {/* Header — Questions title + Q pills with status dots */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 22px 14px',
          borderBottom: `1px solid ${T.color.border.light}`,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, color: T.color.text.primary, margin: 0 }}>
          Questions
        </h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {questions.map((qi, idx) => {
            const qStatus = normalizeStatus(qi.status) as Status
            const c = T.color.status[qStatus]
            const isAct = idx === activeQ
            return (
              <button
                key={idx}
                onClick={() => onQuestionSelect(idx)}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: `2px solid ${isAct ? c.ring : T.color.border.medium}`,
                  background: isAct ? `${c.ring}10` : 'transparent',
                  color: isAct ? c.main : T.color.text.tertiary,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: T.font.sans,
                  transition: 'all 0.15s',
                }}
              >
                Q{qi.number}
                {/* Status dot top-right */}
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: c.dot,
                    border: '2px solid #fff',
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '20px 24px 96px' }}>
        {/* Question text */}
        <p
          style={{
            margin: '0 0 20px',
            fontSize: 14,
            lineHeight: '22px',
            color: T.color.text.primary,
          }}
        >
          <span style={{ fontWeight: 600 }}>{q.number}{')'}.</span>{' '}
          <MathText>{q.questionText}</MathText>
        </p>

        {/* YOUR ANSWER (only when wrong) */}
        {showYours && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: T.color.status.incorrect.main,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: T.color.status.incorrect.soft,
                  color: T.color.status.incorrect.main,
                  fontSize: 11,
                }}
              >
                ✕
              </span>
              YOUR ANSWER
            </div>
            <div
              style={{
                fontFamily: T.font.serif,
                fontSize: 28,
                color: T.color.status.incorrect.main,
                lineHeight: 1.1,
                paddingLeft: 26,
              }}
            >
              <MathText>{studentAnswer}</MathText>
            </div>
          </div>
        )}

        {/* CORRECT ANSWER */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: T.color.status.correct.main,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: 5,
                background: T.color.status.correct.soft,
                color: T.color.status.correct.main,
                fontSize: 11,
              }}
            >
              ✓
            </span>
            CORRECT ANSWER
          </div>
          <div
            style={{
              fontFamily: T.font.serif,
              fontSize: 28,
              color: T.color.status.correct.main,
              lineHeight: 1.1,
              paddingLeft: 26,
              fontWeight: 500,
            }}
          >
            {!showYours && <span style={{ color: T.color.text.primary, fontFamily: T.font.sans, fontSize: 22, fontWeight: 600, marginRight: 8 }}>The answer is</span>}
            <MathText>{correctAnswer}</MathText>
          </div>
        </div>

        {/* SEE HOW IT'S DONE */}
        {steps.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <button
              onClick={() => setShowSteps(s => !s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                marginBottom: showSteps ? 12 : 0,
                fontFamily: T.font.sans,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.color.accent }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: T.color.text.primary,
                }}
              >
                SEE HOW IT'S DONE
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: T.color.text.tertiary,
                  transform: showSteps ? 'rotate(180deg)' : 'rotate(0)',
                  transition: 'transform 0.15s',
                }}
              >
                ▾
              </span>
            </button>

            {showSteps && (
              <div
                style={{
                  border: `1px solid ${T.color.border.medium}`,
                  borderRadius: 14,
                  padding: '16px 14px',
                  background: '#fff',
                }}
              >
                {steps.map((step, i) => {
                  const isLast = i === steps.length - 1
                  const isCorrect = step.awarded === step.maxMarks && !step.isErr
                  const isHighlighted = highlightedStep === step.num
                  const showInline = step.isErr || isHighlighted || step.awarded > 0

                  return (
                    <div
                      key={step.num}
                      ref={el => { stepRefs.current[step.num] = el }}
                      style={{ display: 'flex', gap: 12, paddingBottom: isLast ? 0 : 14 }}
                    >
                      {/* Numbered circle */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: step.isErr
                              ? T.color.status.incorrect.main
                              : isCorrect
                              ? T.color.status.correct.main
                              : '#E5E7EB',
                            color: '#fff',
                            fontFamily: T.font.sans,
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: isHighlighted ? `0 0 0 4px ${T.color.status.incorrect.main}25` : 'none',
                          }}
                        >
                          {step.num}
                        </div>
                        {!isLast && (
                          <div
                            style={{
                              width: 1.5,
                              flex: 1,
                              minHeight: 14,
                              background: step.isErr || isCorrect ? '#E5E7EB' : '#F3F4F6',
                              marginTop: 4,
                            }}
                          />
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, paddingTop: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              fontSize: 13.5,
                              fontWeight: 600,
                              color: step.isErr ? T.color.status.incorrect.main : T.color.text.primary,
                            }}
                          >
                            {step.title}
                          </span>
                          <span
                            style={{
                              fontFamily: T.font.mono,
                              fontSize: 10,
                              fontWeight: 600,
                              color: isCorrect ? T.color.status.correct.main :
                                step.awarded === 0 ? T.color.status.incorrect.main :
                                T.color.status.partial.main,
                            }}
                          >
                            {step.awarded}/{step.maxMarks}
                          </span>
                        </div>

                        {/* Yours / Correct boxes — only for error steps */}
                        {step.isErr && step.studentDid && (
                          <div
                            style={{
                              marginTop: 6,
                              borderRadius: 8,
                              overflow: 'hidden',
                              border: '1px solid #FECACA',
                            }}
                          >
                            <div style={{ padding: '6px 10px', background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
                              <div
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                  color: T.color.status.incorrect.main,
                                  marginBottom: 2,
                                }}
                              >
                                Yours ✕
                              </div>
                              <div style={{ fontSize: 12, lineHeight: '17px', color: '#991B1B', fontWeight: 500 }}>
                                {withChips(step.studentDid)}
                              </div>
                            </div>
                            {step.shouldBe && (
                              <div style={{ padding: '6px 10px', background: '#F0FDF4' }}>
                                <div
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    color: T.color.status.correct.main,
                                    marginBottom: 2,
                                  }}
                                >
                                  Correct ✓
                                </div>
                                <div style={{ fontSize: 12, lineHeight: '17px', color: '#065F46', fontWeight: 500 }}>
                                  {withChips(step.shouldBe)}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Detail (non-error steps only, when relevant) */}
                        {!step.isErr && showInline && step.detail && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12.5,
                              lineHeight: '20px',
                              color: T.color.text.secondary,
                            }}
                          >
                            {withChips(step.detail)}
                          </div>
                        )}

                        {step.skipped && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: T.color.text.tertiary,
                              fontStyle: 'italic',
                            }}
                          >
                            Skipped — depends on prior step
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* VED INSIGHT card */}
        {q.vedInsight && (
          <div
            style={{
              background: T.color.insight.bg,
              border: `1px solid ${T.color.insight.border}`,
              borderRadius: 14,
              padding: '14px 16px',
              marginBottom: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 8,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: T.color.insight.text,
              }}
            >
              <span style={{ fontSize: 13 }}>✦</span>
              VED <span style={{ fontWeight: 700 }}>INSIGHT</span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: '21px',
                color: T.color.text.primary,
                fontStyle: 'italic',
              }}
            >
              "<MathText>{q.vedInsight}</MathText>"
            </p>
          </div>
        )}

        {/* WATCH IT EXPLAINED */}
        {status !== 'correct' && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.color.accent }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: T.color.text.primary,
                }}
              >
                WATCH IT EXPLAINED
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 8,
                    border: `1px solid ${T.color.border.medium}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 60,
                      height: 40,
                      borderRadius: 6,
                      background: 'linear-gradient(135deg, #F97316, #EA580C)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: '#fff', fontSize: 12 }}>▶</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.color.text.primary }}>
                      What is a ratio? — with candy jars
                    </div>
                    <div style={{ fontSize: 11, color: T.color.text.tertiary, marginTop: 2 }}>
                      2:34 · By Geetha Ma'am
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating Ask Ved */}
      <button
        onClick={onAskVed}
        style={{
          position: 'absolute',
          bottom: 18,
          right: 18,
          padding: '12px 20px',
          borderRadius: 14,
          border: 'none',
          cursor: 'pointer',
          background: 'linear-gradient(135deg, #F97316, #EA580C)',
          color: '#fff',
          fontFamily: T.font.sans,
          fontSize: 14,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 6px 20px rgba(249,115,22,0.35)',
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 16 }}>✦</span>
        Ask Ved
      </button>

      {/* Hidden — keep next/practice handlers reachable via keyboard */}
      <button onClick={onNextQuestion} style={{ display: 'none' }}>next</button>
    </div>
  )
}
