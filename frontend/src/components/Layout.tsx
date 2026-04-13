import { useStore } from '../store';
import WorksheetViewer from './WorksheetViewer/WorksheetViewer';
import QAPanel from './QAPanel/QAPanel';
import ChatPanel from './Chat/ChatPanel';
import ChatFAB from './Chat/ChatFAB';

export default function Layout() {
  const isChatOpen = useStore((s) => s.isChatOpen);
  const mobileTab = useStore((s) => s.mobileTab);

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div style={styles.header}>
        <button onClick={() => useStore.getState().setView('upload')} style={styles.backBtn}>
          <span style={{ fontSize: 18 }}>&#8592;</span> Back
        </button>
        <h2 style={styles.headerTitle}>Worksheet Review</h2>
        <button
          onClick={async () => {
            const { sessionId } = useStore.getState();
            // Clear backend session images before resetting frontend
            await fetch('/api/clear', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, target: 'all' }),
            }).catch(() => {});
            useStore.getState().reset();
          }}
          style={styles.newBtn}
        >
          New
        </button>
      </div>

      {/* Mobile tab bar */}
      <div style={styles.mobileTabs}>
        {(['worksheet', 'qa', 'chat'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => useStore.getState().setMobileTab(tab)}
            style={{
              ...styles.mobileTab,
              color: mobileTab === tab ? '#f59e0b' : 'var(--text-3)',
              borderBottomColor: mobileTab === tab ? '#f59e0b' : 'transparent',
            }}
          >
            {tab === 'worksheet' ? '📄 Sheet' : tab === 'qa' ? '📊 Review' : '💬 Chat'}
          </button>
        ))}
      </div>

      {/* Main split panel */}
      <div style={styles.panels}>
        {/* Left: Worksheet Viewer */}
        <div
          style={{
            ...styles.leftPanel,
            display: 'var(--show-worksheet)',
          }}
          className="panel-worksheet"
        >
          <WorksheetViewer />
        </div>

        {/* Right: QA Panel */}
        <div
          style={{
            ...styles.rightPanel,
            display: 'var(--show-qa)',
          }}
          className="panel-qa"
        >
          <QAPanel />
        </div>

        {/* Chat panel (slides over or shows on mobile tab) */}
        {isChatOpen && (
          <div style={styles.chatOverlay}>
            <ChatPanel />
          </div>
        )}
      </div>

      {/* Chat FAB */}
      {!isChatOpen && <ChatFAB />}

      {/* Responsive CSS */}
      <style>{`
        @media (min-width: 769px) {
          .panel-worksheet { display: flex !important; flex: 1; min-width: 0; }
          .panel-qa { display: flex !important; width: 420px; flex-shrink: 0; }
        }
        @media (max-width: 768px) {
          .panel-worksheet { display: ${mobileTab === 'worksheet' ? 'flex' : 'none'} !important; flex: 1; }
          .panel-qa { display: ${mobileTab === 'qa' ? 'flex' : 'none'} !important; flex: 1; }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#f59e0b',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
  },
  headerTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-1)',
  },
  newBtn: {
    color: 'var(--text-2)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    padding: '6px 14px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  mobileTabs: {
    display: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  mobileTab: {
    flex: 1,
    padding: '10px 0',
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'center',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'all 0.2s',
  },
  panels: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    gap: 1,
    position: 'relative',
  },
  leftPanel: {
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'rgba(10, 6, 18, 0.5)',
  },
  rightPanel: {
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'rgba(15, 10, 25, 0.85)',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
  },
  chatOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 420,
    maxWidth: '100%',
    zIndex: 50,
    background: 'rgba(15, 10, 25, 0.95)',
    backdropFilter: 'blur(16px)',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
    animation: 'slideUp 0.25s ease',
    display: 'flex',
  },
};
