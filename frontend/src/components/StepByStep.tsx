import { useState } from 'react'
import { SolutionStep } from '../types'

interface Props {
  steps: SolutionStep[]
  finalAnswer?: string
}

/* Inline chip highlight — wraps numbers, simple expressions ("6 : 3", "2+1=3 balls"). */
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
        className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-[#fef7ea] text-[#8a3f1f] text-[12px] font-semibold whitespace-nowrap border border-[#e8dfcb]"
      >
        {match[0]}
      </span>,
    )
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts
}

export default function StepByStep({ steps, finalAnswer }: Props) {
  // Outer collapse — default closed
  const [sectionOpen, setSectionOpen] = useState(false)
  // Which step is expanded (single-open accordion). null = all collapsed.
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  if (!steps || steps.length === 0) return null

  return (
    <div className="rounded-2xl bg-[#fff9f2] border border-[#f0d9c7] overflow-hidden">
      {/* Outer toggle */}
      <button
        onClick={() => setSectionOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fbeee5]/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#d97757]" />
          <span className="text-[#2b2b2b] font-bold text-sm">Step-by-Step Solution</span>
          <span className="text-[#8a3f1f]/60 text-xs ml-1">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-[#8a3f1f]/50 transition-transform ${sectionOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {sectionOpen && (
        <>
          {/* Steps accordion — single open at a time */}
          <div className="border-t border-[#f0d9c7]">
            {steps.map((step, si) => {
              const isOpen = openIdx === si
              return (
                <div key={si} className={`${si > 0 ? 'border-t border-[#f0d9c7]' : ''}`}>
                  <button
                    onClick={() => setOpenIdx(isOpen ? null : si)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#fbeee5]/40 transition-colors"
                  >
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#fbeee5] flex items-center justify-center">
                      <span className="text-[#d97757] text-xs font-bold">{si + 1}</span>
                    </span>
                    <span className="flex-1 text-[#2b2b2b] font-bold text-sm leading-snug">
                      {step.title}
                    </span>
                    <svg
                      className={`w-4 h-4 text-[#8a3f1f]/50 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isOpen && step.points && step.points.length > 0 && (
                    <div className="px-4 pb-3 pl-14 space-y-1">
                      {step.points.map((pt, pi) => (
                        <p key={pi} className="text-[#2b2b2b]/85 text-[13px] leading-relaxed">
                          {withChips(pt)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Final Answer — shown when section is open */}
          {finalAnswer && (
            <div className="px-4 py-3 bg-[#fbeee5] border-t border-[#f0d9c7]">
              <p className="text-[#8a3f1f]/60 text-[10px] font-bold uppercase tracking-wider mb-1">
                Final Answer
              </p>
              <p className="text-[#8a3f1f] text-lg font-bold leading-tight">
                {finalAnswer}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
