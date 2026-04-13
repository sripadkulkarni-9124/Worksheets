import { useCallback, useRef, useState } from 'react';
import { useStore } from '../../store';
import { uploadSheets, evaluateStandalone } from '../../api';
import VedOrb from '../shared/VedOrb';

export default function UploadFlow() {
  const sessionId = useStore((s) => s.sessionId);
  const apiKeyConnected = useStore((s) => s.apiKeyConnected);
  const setImageUrls = useStore((s) => s.setImageUrls);
  const setEvaluation = useStore((s) => s.setEvaluation);
  const setIsEvaluating = useStore((s) => s.setIsEvaluating);
  const uploadedFiles = useStore((s) => s.uploadedFiles);
  const setUploadedFiles = useStore((s) => s.setUploadedFiles);

  const attemptCount = useStore((s) => s.attemptCount);
  const previousScorePercent = useStore((s) => s.previousScorePercent);

  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      const valid = fileArr.filter(
        (f) =>
          f.type.startsWith('image/') ||
          f.type === 'application/pdf',
      );
      if (valid.length === 0) {
        setError('Please upload images (JPG, PNG) or PDF files.');
        return;
      }
      setError('');
      setUploadedFiles(valid);

      // Generate previews
      const urls = valid.map((f) => {
        if (f.type.startsWith('image/')) return URL.createObjectURL(f);
        return ''; // PDF placeholder
      });
      setPreviews(urls);
    },
    [setUploadedFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleEvaluate = async () => {
    if (!uploadedFiles.length) return;
    setError('');
    setIsEvaluating(true);
    try {
      // Upload files
      const uploadResult = await uploadSheets(sessionId, uploadedFiles);
      setImageUrls(uploadResult.image_urls);

      // Evaluate without answer key
      const result = await evaluateStandalone(sessionId);
      setEvaluation(result.evaluation);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
    } finally {
      setIsEvaluating(false);
    }
  };

  const removeFile = (idx: number) => {
    const newFiles = uploadedFiles.filter((_, i) => i !== idx);
    const newPreviews = previews.filter((_, i) => i !== idx);
    setUploadedFiles(newFiles);
    setPreviews(newPreviews);
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Header */}
        <div style={styles.header}>
          <VedOrb size={48} />
          <h1 style={styles.title}>VED</h1>
          {attemptCount > 1 ? (
            <>
              <div style={styles.attemptBadge}>
                Attempt {attemptCount}
              </div>
              <p style={styles.subtitle}>
                Great job fixing your answers! Upload the corrected worksheet.
              </p>
              {previousScorePercent !== null && (
                <p style={styles.prevScore}>
                  Previous score: {previousScorePercent}% — let's beat it!
                </p>
              )}
            </>
          ) : (
            <p style={styles.subtitle}>
              Upload your worksheet and let Ved check your work
            </p>
          )}
        </div>

        {/* Drop zone */}
        <div
          style={{
            ...styles.dropZone,
            borderColor: isDragging
              ? '#f59e0b'
              : uploadedFiles.length > 0
                ? '#22c55e'
                : 'rgba(255,255,255,0.15)',
            background: isDragging
              ? 'rgba(245, 158, 11, 0.08)'
              : 'rgba(255,255,255,0.03)',
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadedFiles.length === 0 ? (
            <>
              <div style={styles.dropIcon}>📄</div>
              <p style={styles.dropText}>
                Drop your worksheet here or click to upload
              </p>
              <p style={styles.dropHint}>
                Supports JPG, PNG, PDF (max 10MB)
              </p>
            </>
          ) : (
            <div style={styles.previewGrid}>
              {previews.map((url, i) => (
                <div key={i} style={styles.previewItem}>
                  {url ? (
                    <img src={url} alt="" style={styles.previewImg} />
                  ) : (
                    <div style={styles.pdfPlaceholder}>PDF</div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    style={styles.removeBtn}
                  >
                    x
                  </button>
                  <span style={styles.fileName}>
                    {uploadedFiles[i]?.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        {/* Camera button (mobile) */}
        <div style={styles.buttonRow}>
          <button
            onClick={() => cameraInputRef.current?.click()}
            style={styles.cameraBtn}
          >
            📷 Take Photo
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            style={styles.uploadBtn}
          >
            📁 Choose File
          </button>
        </div>

        {/* Error */}
        {error && <p style={styles.error}>{error}</p>}

        {/* Evaluate button */}
        {uploadedFiles.length > 0 && (
          <button
            onClick={handleEvaluate}
            disabled={!apiKeyConnected}
            style={{
              ...styles.evaluateBtn,
              opacity: apiKeyConnected ? 1 : 0.5,
            }}
          >
            {apiKeyConnected
              ? '✨ Check My Work'
              : '🔑 Connect API Key First'}
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    maxWidth: 520,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
  },
  header: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 36,
    fontWeight: 700,
    color: '#f59e0b',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: 'var(--text-2)',
    fontSize: 16,
  },
  attemptBadge: {
    padding: '4px 14px',
    borderRadius: 20,
    background: 'rgba(245, 158, 11, 0.15)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'var(--font-display)',
  },
  prevScore: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: 500,
  },
  dropZone: {
    width: '100%',
    minHeight: 200,
    border: '2px dashed rgba(255,255,255,0.15)',
    borderRadius: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    gap: 12,
  },
  dropIcon: { fontSize: 48 },
  dropText: {
    fontSize: 16,
    fontWeight: 500,
    color: 'var(--text-1)',
  },
  dropHint: {
    fontSize: 13,
    color: 'var(--text-3)',
  },
  previewGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  previewItem: {
    position: 'relative',
    width: 100,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  previewImg: {
    width: 100,
    height: 100,
    objectFit: 'cover',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
  },
  pdfPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-3)',
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: '#ef4444',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: '2px solid rgba(15,10,25,0.9)',
  },
  fileName: {
    fontSize: 11,
    color: 'var(--text-3)',
    maxWidth: 100,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    width: '100%',
  },
  cameraBtn: {
    flex: 1,
    padding: '14px 20px',
    borderRadius: 14,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-1)',
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  uploadBtn: {
    flex: 1,
    padding: '14px 20px',
    borderRadius: 14,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-1)',
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
  },
  evaluateBtn: {
    width: '100%',
    padding: '16px 24px',
    borderRadius: 16,
    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
    color: '#1a1a2e',
    fontSize: 17,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    boxShadow: '0 4px 20px rgba(245, 158, 11, 0.3)',
    letterSpacing: '-0.01em',
  },
};
