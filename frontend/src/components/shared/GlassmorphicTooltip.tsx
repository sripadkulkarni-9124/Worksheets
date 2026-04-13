import { useState } from 'react';
import { ANNOTATION_COLORS, type Question } from '../../types';

interface Props {
  question: Question;
  position: { x: number; y: number };
  containerWidth: number;
}

const STATUS_ICONS: Record<string, string> = {
  correct: '✅',
  wrong: '❌',
  calculation_error: '⚠️',
  conceptual_error: '💡',
  missing_step: '↗️',
  partial_credit: '⚖️',
};

const STATUS_LABELS: Record<string, string> = {
  correct: 'Correct!',
  wrong: 'Incorrect',
  calculation_error: 'Calculation Error',
  conceptual_error: 'Concept Gap',
  missing_step: 'Missing Step',
  partial_credit: 'Partial Credit',
};

export default function GlassmorphicTooltip({ question, position, containerWidth }: Props) {
  const [hintLevel, setHintLevel] = useState(0);
  const colors = ANNOTATION_COLORS[question.annotation_type] || ANNOTATION_COLORS.wrong;
  const icon = STATUS_ICONS[question.annotation_type] || '❓';
  const label = STATUS_LABELS[question.annotation_type] || question.annotation_type;

  // Position: show to the right of cursor, or left if near right edge
  const tooltipWidth = 280;
  const showLeft = position.x + tooltipWidth + 20 > containerWidth;
  const left = showLeft ? position.x - tooltipWidth - 10 : position.x + 10;
  const top = Math.max(10, position.y - 20);

  const feedback =
    hintLevel === 0
      ? question.error_description || question.hint
      : question.hint;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: tooltipWidth,
        zIndex: 40,
        animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        transformOrigin: showLeft ? 'right top' : 'left top',
      }}
    >
      <div style={styles.card}>
        {/* Colored accent bar */}
        <div
          style={{
            ...styles.accentBar,
            background: colors.color,
          }}
        />

        <div style={styles.content}>
          {/* Header */}
          <div style={styles.header}>
            <span style={{ fontSize: 22 }}>{icon}</span>
            <div>
              <p style={{ ...styles.label, color: colors.color }}>{label}</p>
              <p style={styles.qLabel}>
                Q{question.question_number} &middot; {question.marks_obtained}/{question.marks_total}
              </p>
            </div>
          </div>

          {/* Feedback */}
          <p style={styles.feedback}>{feedback}</p>

          {/* Hint button */}
          {!question.is_correct && hintLevel === 0 && question.hint && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setHintLevel(1);
              }}
              style={styles.hintBtn}
            >
              💡 Need another hint?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(15, 10, 25, 0.85)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    display: 'flex',
  },
  accentBar: {
    width: 4,
    flexShrink: 0,
  },
  content: {
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    flex: 1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  qLabel: {
    fontSize: 12,
    color: 'var(--text-3)',
    fontWeight: 500,
  },
  feedback: {
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--text-2)',
  },
  hintBtn: {
    alignSelf: 'flex-start',
    padding: '6px 12px',
    borderRadius: 8,
    background: 'rgba(245, 158, 11, 0.12)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
