import { useState } from 'react'
import { EvaluatedQuestion } from '../types'
import { submitReattempt } from '../api'

interface Props {
  question: EvaluatedQuestion
  onClose: () => void
  onResult: (status: string, feedback: string) => void
}

export default function ReattemptModal({ question, onClose, onResult }: Props) {
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ status: string; feedback: string } | null>(null)

  const handleSubmit = async () => {
    if (!answer.trim()) return
    setLoading(true)
    try {
      const res = await submitReattempt(question.questionText, question.correctAnswer, answer.trim())
      setResult(res)
      onResult(res.status, res.feedback)
    } catch {
      setResult({ status: 'incorrect', feedback: 'Error evaluating answer. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const statusConfig = {
    correct: { bg: 'bg-green-900/40', border: 'border-green-500/40', text: 'text-green-300', icon: '✓' },
    incorrect: { bg: 'bg-red-900/40', border: 'border-red-500/40', text: 'text-red-300', icon: '✗' },
    partially_correct: { bg: 'bg-amber-900/40', border: 'border-amber-500/40', text: 'text-amber-300', icon: '◑' },
  }

  const cfg = result ? (statusConfig[result.status as keyof typeof statusConfig] || statusConfig.incorrect) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1A2332] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-orange-400 text-lg">✏️</span>
            <h2 className="text-white font-semibold">Reattempt Question</h2>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors text-2xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Question */}
          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
            <p className="text-white/50 text-xs font-medium uppercase mb-1">Question {question.number}</p>
            <p className="text-white text-sm">{question.questionText}</p>
          </div>

          {/* Answer input */}
          {!result && (
            <>
              <div>
                <label className="text-white/60 text-xs font-medium uppercase tracking-wide block mb-2">
                  Your Answer
                </label>
                <textarea
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  placeholder="Type your answer here..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder-white/30 focus:outline-none focus:border-orange-400/60 resize-none"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={!answer.trim() || loading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Evaluating...
                  </>
                ) : (
                  'Submit Answer'
                )}
              </button>
            </>
          )}

          {/* Result */}
          {result && cfg && (
            <div className={`rounded-xl ${cfg.bg} border ${cfg.border} p-4 space-y-3`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-white/10 flex items-center justify-center ${cfg.text} text-xl font-bold`}>
                  {cfg.icon}
                </div>
                <div>
                  <p className={`${cfg.text} font-semibold text-sm capitalize`}>
                    {result.status.replace('_', ' ')}
                  </p>
                  <p className="text-white/60 text-xs">Reattempt evaluated</p>
                </div>
              </div>
              <p className="text-white/80 text-sm">{result.feedback}</p>
              {result.status !== 'correct' && (
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-white/40 text-xs mb-1">Correct Answer</p>
                  <p className="text-green-300 text-sm font-medium">{question.correctAnswer}</p>
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-white/10 text-white/80 hover:bg-white/15 transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
