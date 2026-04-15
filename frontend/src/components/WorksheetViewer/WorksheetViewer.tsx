import { useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../../store';
import { imageUrl } from '../../api';
import ReuploadStrip from './ReuploadStrip';
import CanvasAnnotations from './CanvasAnnotations';
import SvgHitMap from './SvgHitMap';
import PageThumbnails from './PageThumbnails';
import ScoreRing from './ScoreRing';
import type { NormalizedBBox, Question } from '../../types';

/** Convert [y_start%, y_end%] bounding box to normalized {x, y, w, h} percentages */
function normalizeBBox(q: Question): NormalizedBBox {
  const [yStart, yEnd] = q.bounding_box;
  const INSET = 0.4; // % gap so adjacent boxes don't share borders
  return {
    x: 2,
    y: yStart + INSET,
    w: 96,
    h: Math.max(yEnd - yStart - INSET * 2, 3),
  };
}

export default function WorksheetViewer() {
  const liveImageUrls = useStore((s) => s.imageUrls);
  const liveEvaluation = useStore((s) => s.evaluation);
  const currentPage = useStore((s) => s.currentPage);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const scorePercent = useStore((s) => s.scorePercent);
  const attempts = useStore((s) => s.attempts);
  const attemptCount = useStore((s) => s.attemptCount);
  const viewingAttemptIndex = useStore((s) => s.viewingAttemptIndex);
  const viewAttempt = useStore((s) => s.viewAttempt);

  // Determine what to show: past attempt or live
  const viewingPast = viewingAttemptIndex !== null;
  const pastAttempt = viewingPast
    ? attempts.find((a) => a.index === viewingAttemptIndex)
    : null;

  const imageUrls = viewingPast && pastAttempt ? pastAttempt.imageUrls : liveImageUrls;
  const evaluation = viewingPast && pastAttempt ? pastAttempt.evaluation : liveEvaluation;

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgDims, setImgDims] = useState({ width: 0, height: 0 });

  // Current page image
  const currentUrl = imageUrls[currentPage];

  // Reset dimensions when URL changes — prevents stale canvas dims from showing old annotations
  useEffect(() => {
    setImgDims({ width: 0, height: 0 });
  }, [currentUrl]);
  const totalPages = imageUrls.length;

  // Questions for this page with normalized bboxes — deduplicated by question_number
  const pageQuestions = (() => {
    const qs = evaluation?.questions.filter(
      (q) => q.page_number === currentPage + 1,
    ) || [];
    // Remove duplicates keeping last occurrence (latest data wins)
    const seen = new Map<string, typeof qs[0]>();
    for (const q of qs) seen.set(q.question_number, q);
    return Array.from(seen.values());
  })();

  const normalizedBoxes = pageQuestions.map((q) => normalizeBBox(q));

  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setImgDims({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
    }
  }, []);

  // Re-measure on resize
  useEffect(() => {
    const handleResize = () => {
      if (imgRef.current) {
        setImgDims({
          width: imgRef.current.clientWidth,
          height: imgRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentPage > 0) {
        setCurrentPage(currentPage - 1);
      } else if (e.key === 'ArrowRight' && currentPage < totalPages - 1) {
        setCurrentPage(currentPage + 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentPage, totalPages, setCurrentPage]);

  if (!currentUrl) {
    return (
      <div style={styles.empty}>
        <p style={{ color: 'var(--text-3)', fontSize: 15 }}>
          No worksheet loaded
        </p>
      </div>
    );
  }

  const currentScorePct = viewingPast && pastAttempt
    ? pastAttempt.scorePercent
    : scorePercent();

  return (
    <div style={styles.container} ref={containerRef}>
      {/* Attempt toggle bar (only if there are past attempts) */}
      {attempts.length > 0 && (
        <div style={styles.attemptBar}>
          {attempts.map((a) => (
            <button
              key={a.index}
              onClick={() => viewAttempt(a.index)}
              style={{
                ...styles.attemptTab,
                background: viewingAttemptIndex === a.index
                  ? 'rgba(245, 158, 11, 0.2)'
                  : 'rgba(255,255,255,0.04)',
                borderColor: viewingAttemptIndex === a.index
                  ? 'rgba(245, 158, 11, 0.4)'
                  : 'rgba(255,255,255,0.08)',
                color: viewingAttemptIndex === a.index ? '#fbbf24' : 'var(--text-3)',
              }}
            >
              #{a.index} ({a.scorePercent}%)
            </button>
          ))}
          <button
            onClick={() => viewAttempt(null)}
            style={{
              ...styles.attemptTab,
              background: viewingAttemptIndex === null
                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                : 'rgba(255,255,255,0.04)',
              borderColor: viewingAttemptIndex === null
                ? '#f59e0b'
                : 'rgba(255,255,255,0.08)',
              color: viewingAttemptIndex === null ? '#1a1a2e' : 'var(--text-3)',
              fontWeight: viewingAttemptIndex === null ? 700 : 500,
            }}
          >
            Latest #{attemptCount}
          </button>
        </div>
      )}

      {/* Viewing past attempt banner */}
      {viewingPast && pastAttempt && (
        <div style={styles.pastBanner}>
          <span>Viewing Attempt #{pastAttempt.index} ({pastAttempt.scorePercent}%)</span>
          <button onClick={() => viewAttempt(null)} style={styles.backToLatest}>
            ← Back to latest
          </button>
        </div>
      )}

      {/* Score ring (top-right) */}
      {evaluation && (
        <div style={styles.scoreCorner}>
          <ScoreRing percent={currentScorePct} size={56} />
        </div>
      )}

      {/* Image wrapper with annotation layers */}
      <div style={styles.imageWrapper}>
        <div style={styles.imageContainer}>
          <img
            ref={imgRef}
            src={imageUrl(currentUrl)}
            alt={`Worksheet page ${currentPage + 1}`}
            onLoad={handleImageLoad}
            style={styles.image}
            draggable={false}
          />

          {/* Canvas annotation overlay — key forces remount when URL changes so animation restarts */}
          {evaluation && imgDims.width > 0 && (
            <CanvasAnnotations
              key={currentUrl}
              questions={pageQuestions}
              boxes={normalizedBoxes}
              width={imgDims.width}
              height={imgDims.height}
            />
          )}

          {/* SVG hit map overlay */}
          {evaluation && imgDims.width > 0 && (
            <SvgHitMap
              key={currentUrl}
              questions={pageQuestions}
              boxes={normalizedBoxes}
              width={imgDims.width}
              height={imgDims.height}
            />
          )}
        </div>
      </div>

      {/* Page navigation */}
      {totalPages > 1 && (
        <div style={styles.pageNav}>
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            style={styles.pageBtn}
          >
            &#8249;
          </button>
          <span style={styles.pageLabel}>
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={() =>
              setCurrentPage(Math.min(totalPages - 1, currentPage + 1))
            }
            disabled={currentPage === totalPages - 1}
            style={styles.pageBtn}
          >
            &#8250;
          </button>
        </div>
      )}

      {/* Thumbnails strip */}
      {totalPages > 1 && (
        <PageThumbnails
          urls={imageUrls}
          currentPage={currentPage}
          onSelect={setCurrentPage}
        />
      )}

      {/* Inline re-upload strip (only on latest attempt) */}
      {evaluation && !viewingPast && <ReuploadStrip />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attemptBar: {
    display: 'flex',
    gap: 6,
    padding: '8px 12px',
    overflowX: 'auto',
    flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    scrollbarWidth: 'none' as const,
  },
  attemptTab: {
    padding: '5px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  pastBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '6px 12px',
    background: 'rgba(245, 158, 11, 0.08)',
    borderBottom: '1px solid rgba(245, 158, 11, 0.15)',
    fontSize: 13,
    color: '#fbbf24',
    fontWeight: 500,
    flexShrink: 0,
  },
  backToLatest: {
    padding: '3px 10px',
    borderRadius: 6,
    background: 'rgba(245, 158, 11, 0.15)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  scoreCorner: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
  },
  imageWrapper: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: 16,
  },
  imageContainer: {
    position: 'relative',
    display: 'inline-block',
    maxWidth: '100%',
  },
  image: {
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 160px)',
    objectFit: 'contain',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    display: 'block',
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: '10px 0',
    flexShrink: 0,
  },
  pageBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-1)',
    fontSize: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  pageLabel: {
    fontSize: 14,
    color: 'var(--text-2)',
    fontWeight: 500,
  },
};
