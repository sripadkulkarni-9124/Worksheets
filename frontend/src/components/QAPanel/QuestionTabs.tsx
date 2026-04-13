import { useStore } from '../../store';
import { ANNOTATION_COLORS, type Question } from '../../types';

interface Props {
  questions: Question[];
}

export default function QuestionTabs({ questions }: Props) {
  const selectedQuestion = useStore((s) => s.selectedQuestion);
  const selectQuestion = useStore((s) => s.selectQuestion);

  return (
    <div style={styles.container}>
      {questions.map((q) => {
        const isActive = q.question_number === selectedQuestion;
        const colors = ANNOTATION_COLORS[q.annotation_type];

        return (
          <button
            key={q.question_number}
            onClick={() => selectQuestion(q.question_number)}
            style={{
              ...styles.tab,
              background: isActive ? colors.color : 'rgba(255,255,255,0.06)',
              color: isActive ? '#fff' : 'var(--text-2)',
              borderColor: isActive ? colors.color : 'rgba(255,255,255,0.1)',
              fontWeight: isActive ? 700 : 500,
              transform: isActive ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            Q{q.question_number}
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    paddingBottom: 4,
    scrollbarWidth: 'none',
  },
  tab: {
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 13,
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
};
