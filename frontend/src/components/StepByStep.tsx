import { useState } from 'react'
import { SolutionStep } from '../types'

interface Props {
  steps: SolutionStep[]
}

export default function StepByStep({ steps }: Props) {
  const [open, setOpen] = useState(false)

  if (!steps || steps.length === 0) return null

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-lg">📋</span>
          <span className="text-white font-medium text-sm">Step-by-Step Solution</span>
          <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full">
            {steps.length} steps
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
          {steps.map((step, si) => (
            <div key={si} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-blue-500/30 border border-blue-400/50 flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-300 text-xs font-bold">{si + 1}</span>
                </div>
                <span className="text-blue-300 text-sm font-semibold">{step.title}</span>
              </div>
              <div className="ml-7 space-y-1">
                {step.points.map((pt, pi) => (
                  <div key={pi} className="flex items-start gap-2">
                    <span className="text-white/30 text-xs mt-0.5 flex-shrink-0">•</span>
                    <span className="text-white/75 text-sm">{pt}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
