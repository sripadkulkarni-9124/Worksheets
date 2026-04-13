interface Props {
  onAction: (text: string) => void;
}

const ACTIONS = [
  { label: '🔍 More explanation', prompt: 'Can you explain this question in more detail?' },
  { label: '🎯 Similar question', prompt: 'Give me a similar practice question to try' },
  { label: '📝 Step-by-step review', prompt: 'Walk me through the solution step by step' },
  { label: '🌟 Study tips', prompt: 'What should I study to improve on this topic?' },
];

export default function QuickActions({ onAction }: Props) {
  return (
    <div style={styles.container}>
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.prompt)}
          style={styles.chip}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  chip: {
    padding: '8px 14px',
    borderRadius: 20,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-2)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap' as const,
  },
};
