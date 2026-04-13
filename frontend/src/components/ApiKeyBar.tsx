import { useState } from 'react';
import { setApiKey } from '../api';
import { useStore } from '../store';

export default function ApiKeyBar() {
  const [key, setKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setConnected = useStore((s) => s.setApiKeyConnected);

  const handleConnect = async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError('');
    try {
      await setApiKey(key.trim());
      localStorage.setItem('gemini_api_key', key.trim());
      setConnected(true);
    } catch {
      setError('Invalid API key. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.bar}>
      <div style={styles.inner}>
        <span style={styles.icon}>🔑</span>
        <input
          type="password"
          placeholder="Enter your Gemini API key..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          style={styles.input}
        />
        <button
          onClick={handleConnect}
          disabled={loading || !key.trim()}
          style={{
            ...styles.btn,
            opacity: loading || !key.trim() ? 0.5 : 1,
          }}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    background: 'rgba(15, 10, 25, 0.95)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '12px 20px',
    flexShrink: 0,
  },
  inner: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    maxWidth: 600,
    margin: '0 auto',
  },
  icon: { fontSize: 18 },
  input: {
    flex: 1,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: '10px 14px',
    color: '#f0ece4',
    fontSize: 14,
  },
  btn: {
    background: '#f59e0b',
    color: '#1a1a2e',
    fontWeight: 600,
    fontSize: 14,
    padding: '10px 20px',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap' as const,
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
    textAlign: 'center' as const,
    marginTop: 8,
  },
};
