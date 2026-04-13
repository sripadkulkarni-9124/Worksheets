import { useEffect, useRef, useState } from 'react';
import { ANNOTATION_COLORS, type NormalizedBBox, type Question } from '../../types';

interface Props {
  questions: Question[];
  boxes: NormalizedBBox[];
  width: number;
  height: number;
}

/** Add slight jitter to a coordinate for hand-drawn effect */
function jitter(v: number, amount = 2): number {
  return v + (Math.random() - 0.5) * amount;
}

/** Draw a hand-drawn tick mark */
function drawTick(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Two strokes for the tick
  ctx.beginPath();
  ctx.moveTo(jitter(cx - size * 0.4), jitter(cy));
  ctx.lineTo(jitter(cx - size * 0.1), jitter(cy + size * 0.4));
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(jitter(cx - size * 0.1), jitter(cy + size * 0.4));
  ctx.lineTo(jitter(cx + size * 0.5), jitter(cy - size * 0.3));
  ctx.stroke();
}

/** Draw a hand-drawn cross */
function drawCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(jitter(cx - size * 0.3), jitter(cy - size * 0.3));
  ctx.lineTo(jitter(cx + size * 0.3), jitter(cy + size * 0.3));
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(jitter(cx + size * 0.3), jitter(cy - size * 0.3));
  ctx.lineTo(jitter(cx - size * 0.3), jitter(cy + size * 0.3));
  ctx.stroke();
}

/** Draw a warning squiggle */
function drawSquiggle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  ctx.beginPath();
  const startX = cx - size * 0.4;
  ctx.moveTo(startX, cy);
  for (let i = 0; i < 4; i++) {
    const x = startX + (i + 0.5) * (size * 0.2);
    const dir = i % 2 === 0 ? -1 : 1;
    ctx.quadraticCurveTo(x, cy + dir * size * 0.2, startX + (i + 1) * (size * 0.2), cy);
  }
  ctx.stroke();
}

export default function CanvasAnnotations({ questions, boxes, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [revealCount, setRevealCount] = useState(0);

  // Staggered reveal animation
  useEffect(() => {
    setRevealCount(0);
    if (questions.length === 0) return;

    let frame: number;
    let start: number | null = null;
    const STAGGER_MS = 300;

    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const count = Math.min(
        Math.floor(elapsed / STAGGER_MS) + 1,
        questions.length,
      );
      setRevealCount(count);
      if (count < questions.length) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [questions]);

  // Draw annotations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < Math.min(revealCount, questions.length); i++) {
      const q = questions[i];
      const box = boxes[i];
      const colors = ANNOTATION_COLORS[q.annotation_type] || ANNOTATION_COLORS.wrong;

      // Convert percentage to pixels
      const x = (box.x / 100) * width;
      const y = (box.y / 100) * height;
      const w = (box.w / 100) * width;
      const h = (box.h / 100) * height;

      // Semi-transparent fill
      ctx.fillStyle = colors.color + '10'; // ~6% opacity
      ctx.fillRect(x, y, w, h);

      // Left border
      ctx.fillStyle = colors.color + 'CC'; // ~80% opacity
      ctx.fillRect(x, y, 4, h);

      // Top line
      ctx.strokeStyle = colors.color + '40';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Bottom line
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();

      // Margin icon (right side) — clamped so it never bleeds outside image
      const iconX = Math.min(x + w - 24, width - 28);
      const iconY = Math.max(y + 16, y + 8);
      const iconSize = 14;

      if (q.is_correct || q.annotation_type === 'correct') {
        drawTick(ctx, iconX, iconY, iconSize, colors.color);
      } else if (q.annotation_type === 'wrong') {
        drawCross(ctx, iconX, iconY, iconSize, colors.color);
      } else {
        drawSquiggle(ctx, iconX, iconY, iconSize, colors.color);
      }

      // Question label badge
      const label = `Q${q.question_number}`;
      ctx.font = '600 11px "IBM Plex Sans", sans-serif';
      const labelWidth = ctx.measureText(label).width + 12;

      ctx.fillStyle = colors.color + 'DD';
      const badgeRadius = 4;
      const bx = x + 8;
      const by = y + 4;
      ctx.beginPath();
      ctx.roundRect(bx, by, labelWidth, 20, badgeRadius);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.fillText(label, bx + 6, by + 14);

      // Marks badge
      const marks = `${q.marks_obtained}/${q.marks_total}`;
      ctx.font = '500 10px "IBM Plex Sans", sans-serif';
      const marksWidth = ctx.measureText(marks).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(bx + labelWidth + 4, by, marksWidth, 20, badgeRadius);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(marks, bx + labelWidth + 9, by + 14);
    }
  }, [questions, boxes, width, height, revealCount]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
