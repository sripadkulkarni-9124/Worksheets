/* State-driven config for the EvalPanel — matches design handoff doc.
   All visual properties derive from a normalized status. */

export type EvalStatus = 'correct' | 'incorrect' | 'partial'

export function normalizeStatus(s?: string): EvalStatus {
  if (s === 'correct') return 'correct'
  if (s === 'partially_correct' || s === 'partial') return 'partial'
  return 'incorrect'
}

export interface StateConfig {
  key: EvalStatus
  verdict: string
  verdictColor: string
  bannerBg: string
  bannerBorder: string
  marksBg: string
  ctaGradient: string
  ctaShadow: string
  errorNumBg: string
  errorNumBorder: string
  errorNumText: string
  errorConnector: string
  errorDetailText: string
  stepsLabel: string
  showVideo: boolean
  showPractice: boolean
  showCorrectAnswer: boolean
  expandStepsByDefault: boolean
  highlightErrorStep: boolean
}

const COMMON = {
  errorNumBg: '#FEE2E2',
  errorNumBorder: '#FECACA',
  errorNumText: '#DC2626',
  errorConnector: '#FECACA',
  errorDetailText: '#92400E',
}

export const STATE_CONFIG: Record<EvalStatus, StateConfig> = {
  incorrect: {
    key: 'incorrect',
    verdict: 'Not quite right',
    verdictColor: '#DC2626',
    bannerBg: '#FEF2F2',
    bannerBorder: '#FECACA',
    marksBg: 'rgba(220,38,38,0.1)',
    ctaGradient: 'linear-gradient(135deg, #F97316, #EA580C)',
    ctaShadow: '0 3px 12px rgba(249,115,22,0.2)',
    ...COMMON,
    stepsLabel: 'How to solve it',
    showVideo: true,
    showPractice: true,
    showCorrectAnswer: true,
    expandStepsByDefault: true,
    highlightErrorStep: true,
  },
  correct: {
    key: 'correct',
    verdict: 'Nailed it!',
    verdictColor: '#059669',
    bannerBg: '#ECFDF5',
    bannerBorder: '#A7F3D0',
    marksBg: 'rgba(5,150,105,0.1)',
    ctaGradient: 'linear-gradient(135deg, #10B981, #059669)',
    ctaShadow: '0 3px 12px rgba(16,185,129,0.2)',
    ...COMMON,
    stepsLabel: 'See the method',
    showVideo: false,
    showPractice: false,
    showCorrectAnswer: false,
    expandStepsByDefault: false,
    highlightErrorStep: false,
  },
  partial: {
    key: 'partial',
    verdict: 'Almost there',
    verdictColor: '#D97706',
    bannerBg: '#FFFBEB',
    bannerBorder: '#FDE68A',
    marksBg: 'rgba(217,119,6,0.1)',
    ctaGradient: 'linear-gradient(135deg, #F59E0B, #D97706)',
    ctaShadow: '0 3px 12px rgba(245,158,11,0.2)',
    ...COMMON,
    stepsLabel: 'Where it went off track',
    showVideo: true,
    showPractice: true,
    showCorrectAnswer: true,
    expandStepsByDefault: true,
    highlightErrorStep: true,
  },
}

/* Q nav pill colors — by status */
export function pillColor(status?: string): string {
  switch (normalizeStatus(status)) {
    case 'correct': return '#059669'
    case 'partial': return '#D97706'
    default: return '#DC2626'
  }
}
