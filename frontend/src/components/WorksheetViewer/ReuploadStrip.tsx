import { useRef } from 'react';
import { useStore } from '../../store';

export default function ReuploadStrip() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isEvaluating = useStore((s) => s.isEvaluating);
  const attemptCount = useStore((s) => s.attemptCount);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const valid = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
    );
    if (valid.length === 0) return;
    useStore.getState().saveAttemptAndReupload(valid);
  };

  return (
    <div style={styles.strip}>
      <p style={styles.label}>
        Fixed your answers?
      </p>
      <div style={styles.buttons}>
        <button
          onClick={() => cameraInputRef.current?.click()}
          disabled={isEvaluating}
          style={styles.btn}
        >
          📷 Snap
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isEvaluating}
          style={styles.btn}
        >
          📁 Upload
        </button>
      </div>
      {attemptCount > 1 && (
        <span style={styles.badge}>Attempt {attemptCount}</span>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  strip: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    flexShrink: 0,
    background: 'rgba(245, 158, 11, 0.05)',
    borderTop: '1px solid rgba(245, 158, 11, 0.12)',
  },
  label: {
    fontSize: 13,
    color: 'var(--text-2)',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  },
  buttons: {
    display: 'flex',
    gap: 6,
  },
  btn: {
    padding: '7px 14px',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
    color: '#1a1a2e',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap' as const,
  },
  badge: {
    marginLeft: 'auto',
    padding: '3px 10px',
    borderRadius: 12,
    background: 'rgba(245, 158, 11, 0.12)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: 600,
  },
};
