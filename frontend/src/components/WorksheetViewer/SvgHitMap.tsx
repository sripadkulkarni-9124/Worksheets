import { useState, useCallback, useRef } from 'react';
import { useStore } from '../../store';
import { ANNOTATION_COLORS, type NormalizedBBox, type Question } from '../../types';
import GlassmorphicTooltip from '../shared/GlassmorphicTooltip';

interface Props {
  questions: Question[];
  boxes: NormalizedBBox[];
  width: number;
  height: number;
}

export default function SvgHitMap({ questions, boxes, width, height }: Props) {
  const selectQuestion = useStore((s) => s.selectQuestion);
  const setMobileTab = useStore((s) => s.setMobileTab);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseEnter = useCallback(
    (idx: number, e: React.MouseEvent) => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setHoveredIdx(idx);
      // Position tooltip near cursor
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setHoveredIdx(null), 200);
  }, []);

  const handleClick = useCallback(
    (q: Question) => {
      selectQuestion(q.question_number);
      setMobileTab('qa');
    },
    [selectQuestion, setMobileTab],
  );

  // Long-press for mobile
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback(
    (idx: number, e: React.TouchEvent) => {
      const touch = e.touches[0];
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPos({
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        });
      }
      longPressTimer.current = setTimeout(() => {
        setHoveredIdx(idx);
      }, 500);
    },
    [],
  );

  const handleTouchEnd = useCallback(
    (q: Question) => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      if (hoveredIdx !== null) {
        // Was showing tooltip from long-press, dismiss it
        setHoveredIdx(null);
      } else {
        // Short tap → select question
        handleClick(q);
      }
    },
    [hoveredIdx, handleClick],
  );

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {questions.map((q, i) => {
          const box = boxes[i];
          const px = (box.x / 100) * width;
          const py = (box.y / 100) * height;
          const pw = (box.w / 100) * width;
          const ph = (box.h / 100) * height;
          const color = ANNOTATION_COLORS[q.annotation_type]?.color || '#fff';

          return (
            <rect
              key={q.question_number}
              x={px}
              y={py}
              width={pw}
              height={ph}
              fill="transparent"
              stroke={hoveredIdx === i ? color : 'transparent'}
              strokeWidth={hoveredIdx === i ? 2 : 0}
              strokeOpacity={0.5}
              rx={4}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => handleMouseEnter(i, e)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleClick(q)}
              onTouchStart={(e) => handleTouchStart(i, e)}
              onTouchEnd={() => handleTouchEnd(q)}
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoveredIdx !== null && questions[hoveredIdx] && (
        <div
          onMouseEnter={() => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          <GlassmorphicTooltip
            question={questions[hoveredIdx]}
            position={tooltipPos}
            containerWidth={width}
          />
        </div>
      )}
    </div>
  );
}
