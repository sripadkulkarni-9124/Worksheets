import { useState, useEffect } from 'react';

const STAGES = [
  { label: 'Converting pages...', icon: '📄' },
  { label: 'Sending to Ved...', icon: '📤' },
  { label: 'Analyzing answers...', icon: '🔍' },
  { label: 'Preparing feedback...', icon: '✏️' },
];

export default function LoadingOverlay() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = STAGES.map((_, i) =>
      setTimeout(() => setStage(i), i * 3000),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Animated spinner */}
        <div style={styles.spinnerWrapper}>
          <div style={styles.ring} />
          <div style={styles.ringInner} />
          <span style={styles.spinnerIcon}>{STAGES[stage].icon}</span>
        </div>

        {/* Stage label */}
        <p style={styles.label}>{STAGES[stage].label}</p>

        {/* Progress dots */}
        <div style={styles.dots}>
          {STAGES.map((_, i) => (
            <div
              key={i}
              style={{
                ...styles.dot,
                background:
                  i <= stage ? '#f59e0b' : 'rgba(255,255,255,0.15)',
                transform: i === stage ? 'scale(1.3)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(10, 5, 20, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    animation: 'fadeIn 0.3s ease',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
    padding: 40,
  },
  spinnerWrapper: {
    width: 80,
    height: 80,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '3px solid rgba(245, 158, 11, 0.15)',
    borderTopColor: '#f59e0b',
    animation: 'spin 1s linear infinite',
  },
  ringInner: {
    position: 'absolute',
    inset: 8,
    borderRadius: '50%',
    border: '2px solid rgba(245, 158, 11, 0.1)',
    borderBottomColor: '#fbbf24',
    animation: 'spin 1.5s linear infinite reverse',
  },
  spinnerIcon: {
    fontSize: 28,
    zIndex: 1,
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--text-1)',
    animation: 'pulse 2s ease-in-out infinite',
  },
  dots: {
    display: 'flex',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    transition: 'all 0.3s ease',
  },
};
