import { useStore } from '../../store';
import QuestionTabs from './QuestionTabs';
import QuestionFeedback from './QuestionFeedback';
import VedInsightCard from './VedInsightCard';
import StepBySolution from './StepBySolution';

export default function QAPanel() {
  const evaluation = useStore((s) => s.evaluation);
  const selectedQuestion = useStore((s) => s.selectedQuestion);
  // Deduplicate by question_number (guard against Gemini returning duplicates)
  const allQuestions = evaluation?.questions || [];
  const questions = Array.from(
    new Map(allQuestions.map((q) => [q.question_number, q])).values()
  );
  const selected = questions.find(
    (q) => q.question_number === selectedQuestion,
  );

  if (!evaluation) {
    return (
      <div style={styles.empty}>
        <p style={{ color: 'var(--text-3)', fontSize: 15 }}>
          Submit a worksheet to see results
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>Questions</h3>
        <QuestionTabs questions={questions} />
      </div>

      {/* Selected question content */}
      <div style={styles.content}>
        {selected ? (
          <>
            <QuestionFeedback question={selected} />
            <VedInsightCard question={selected} />
            {selected.step_by_step_solution && (
              <StepBySolution solution={selected.step_by_step_solution} />
            )}

            {/* Practice button */}
            <button
              style={styles.practiceBtn}
              onClick={() => {
                useStore.getState().setChatQuestionContext(selected.question_number);
                useStore.getState().setChatOpen(true);
              }}
            >
              🔄 Practice Similar Question
            </button>
          </>
        ) : (
          <p style={{ color: 'var(--text-3)', padding: 20 }}>
            Select a question above to see feedback
          </p>
        )}
      </div>

      {/* Summary */}
      {evaluation.summary && (
        <div style={styles.summary}>
          <p style={styles.summaryText}>{evaluation.summary}</p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  header: {
    padding: '16px 20px 0',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-1)',
    marginBottom: 12,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  practiceBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-1)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'center' as const,
  },
  summary: {
    padding: '12px 20px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  summaryText: {
    fontSize: 13,
    color: 'var(--text-3)',
    lineHeight: 1.5,
  },
};
