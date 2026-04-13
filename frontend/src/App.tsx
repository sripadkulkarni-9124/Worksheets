import { useEffect } from 'react';
import { useStore } from './store';
import { setApiKey, checkApiKey } from './api';
import UploadFlow from './components/Upload/UploadFlow';
import Layout from './components/Layout';
import ApiKeyBar from './components/ApiKeyBar';
import LoadingOverlay from './components/shared/LoadingOverlay';
import ConfettiOverlay from './components/shared/ConfettiOverlay';

export default function App() {
  const view = useStore((s) => s.view);
  const isEvaluating = useStore((s) => s.isEvaluating);
  const showConfetti = useStore((s) => s.showConfetti);
  const apiKeyConnected = useStore((s) => s.apiKeyConnected);

  // Check if backend already has an API key, or restore from localStorage
  useEffect(() => {
    // First check if backend already has a key (e.g. from old app session)
    checkApiKey().then((connected) => {
      if (connected) {
        useStore.getState().setApiKeyConnected(true);
        return;
      }
      // Fallback: try restoring from localStorage
      const saved = localStorage.getItem('gemini_api_key');
      if (saved) {
        setApiKey(saved)
          .then(() => useStore.getState().setApiKeyConnected(true))
          .catch(() => {});
      }
    });
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* API Key bar - shown until connected */}
      {!apiKeyConnected && <ApiKeyBar />}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {view === 'upload' ? <UploadFlow /> : <Layout />}

        {/* Loading overlay during evaluation */}
        {isEvaluating && <LoadingOverlay />}

        {/* Confetti on perfect score */}
        {showConfetti && <ConfettiOverlay />}
      </div>
    </div>
  );
}
