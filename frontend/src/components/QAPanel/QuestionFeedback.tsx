import { ANNOTATION_COLORS, type Question } from '../../types';

interface Props {
  question: Question;
}

const STATUS_MESSAGES: Record<string, string> = {
  correct: 'Nice work 👏 You got it right,',
  wrong: 'Not quite right — let\'s work through it,',
  calculation_error: 'Almost there! Small calculation slip,',
  conceptual_error: 'The approach needs a rethink,',
  missing_step: 'Good start, but a step is missing,',
  partial_credit: 'Partially correct — keep going!',
};

export default function QuestionFeedback({ question }: Props) {
  const colors = ANNOTATION_COLORS[question.annotation_type];
  const statusMsg = STATUS_MESSAGES[question.annotation_type] || '';

  return (
    <div style={styles.container}>
      {/* Status message */}
      <p style={styles.statusMsg}>{statusMsg}</p>

      {/* Correct answer badge */}
      <div style={styles.answerBadge}>
        <span style={{ color: question.is_correct ? 'var(--correct)' : 'var(--text-2)', fontSize: 16 }}>
          {question.is_correct ? '✅' : '❌'}
        </span>
        <div>
          <p style={styles.answerLabel}>Correct Answer</p>
          <p style={styles.answerValue}>{question.correct_answer}</p>
        </div>
      </div>

      {/* Student answer (if wrong) */}
      {!question.is_correct && question.student_answer && (
        <div style={{ ...styles.answerBadge, borderColor: colors.color + '40' }}>
          <span style={{ fontSize: 16 }}>✍️</span>
          <div>
            <p style={styles.answerLabel}>Your Answer</p>
            <p style={{ ...styles.answerValue, color: colors.color }}>
              {question.student_answer}
            </p>
          </div>
        </div>
      )}

      {/* Marks */}
      <div style={styles.marks}>
        <span style={styles.marksValue}>
          {question.marks_obtained}/{question.marks_total}
        </span>
        <span style={styles.marksLabel}>marks</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  statusMsg: {
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-1)',
    lineHeight: 1.4,
  },
  answerBadge: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 14px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  answerLabel: {
    fontSize: 12,
    color: 'var(--text-3)',
    fontWeight: 500,
    marginBottom: 2,
  },
  answerValue: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-1)',
    lineHeight: 1.4,
  },
  marks: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  marksValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-1)',
  },
  marksLabel: {
    fontSize: 13,
    color: 'var(--text-3)',
  },
};
