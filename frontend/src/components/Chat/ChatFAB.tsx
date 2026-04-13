import { useStore } from '../../store';

export default function ChatFAB() {
  const setChatOpen = useStore((s) => s.setChatOpen);

  return (
    <button
      onClick={() => setChatOpen(true)}
      style={styles.fab}
      title="Ask Ved"
    >
      <span style={styles.icon}>✨</span>
      <span style={styles.label}>Ask Ved</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 20px',
    borderRadius: 50,
    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
    color: '#1a1a2e',
    fontSize: 15,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(245, 158, 11, 0.3)',
    transition: 'all 0.25s ease',
    zIndex: 30,
    animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  icon: { fontSize: 18 },
  label: { letterSpacing: '-0.01em' },
};
