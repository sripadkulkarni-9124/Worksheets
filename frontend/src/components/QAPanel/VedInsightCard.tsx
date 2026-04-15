import type { Question } from '../../types';

interface Props {
  question: Question;
}

export default function VedInsightCard({ question }: Props) {
  const message = question.is_correct
    ? question.hint || 'Great work! You understood this concept well.'
    : question.error_description || question.hint;

  if (!message) return null;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.icon}>✨</span>
        <span style={styles.label}>Ved Insight</span>
      </div>
      <p style={styles.message}>
        &ldquo;{message}&rdquo;
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(245, 158, 11, 0.06)',
    border: '1px solid rgba(245, 158, 11, 0.15)',
    borderRadius: 14,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  icon: { fontSize: 16 },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: 14,
    fontWeight: 700,
    color: '#fbbf24',
  },
  message: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--text-2)',
    fontStyle: 'italic',
  },
};
