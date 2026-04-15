import { useState } from 'react';

interface Props {
  solution: string;
}

export default function StepBySolution({ solution }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={styles.container}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.toggle}
      >
        <span style={styles.icon}>🧠</span>
        <span style={styles.label}>Step-by-Step Solution</span>
        <span
          style={{
            ...styles.chevron,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          }}
        >
          ▼
        </span>
      </button>

      {expanded && (
        <div style={styles.content}>
          {solution.split('\n').map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return null;

            // Check if it's a step header (e.g., "Step 1:", "**Step 1:**")
            const stepMatch = trimmed.match(/^\*{0,2}(Step \d+[:.]).?\*{0,2}\s*(.*)/i);
            if (stepMatch) {
              return (
                <div key={i} style={styles.step}>
                  <p style={styles.stepHeader}>{stepMatch[1]}</p>
                  {stepMatch[2] && <p style={styles.stepText}>{stepMatch[2]}</p>}
                </div>
              );
            }

            // Bullet points
            if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
              return (
                <p key={i} style={styles.bullet}>
                  • {trimmed.replace(/^[-*•]\s*/, '')}
                </p>
              );
            }

            // Regular text
            return <p key={i} style={styles.text}>{trimmed}</p>;
          })}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderRadius: 14,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  toggle: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  icon: { fontSize: 16 },
  label: {
    flex: 1,
    fontFamily: 'var(--font-display)',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-1)',
  },
  chevron: {
    fontSize: 10,
    color: 'var(--text-3)',
    transition: 'transform 0.2s ease',
  },
  content: {
    padding: '0 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: 12,
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  stepHeader: {
    fontFamily: 'var(--font-display)',
    fontSize: 13,
    fontWeight: 700,
    color: '#fbbf24',
  },
  stepText: {
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--text-2)',
  },
  bullet: {
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--text-2)',
    paddingLeft: 12,
  },
  text: {
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--text-2)',
  },
};
