import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Line, Group, Text, Circle } from 'react-konva'
import Konva from 'konva'
import { AutoMark, EvaluatedQuestion } from '../types'

/* ---------- Constants ---------- */

const STATUS_COLORS: Record<string, string> = {
  correct:           '#22C55E',
  incorrect:         '#EF4444',
  partially_correct: '#F97316',
  partial:           '#F97316',
  unanswered:        '#9CA3AF',
}

function hexToRgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

/* ---------- Props ---------- */

interface Props {
  imageDataUrl: string
  autoMarks: AutoMark[]
  activeQ: number
  onQuestionClick: (i: number) => void
  showFeedback: boolean
  questions: EvaluatedQuestion[]
  containerSize: { width: number; height: number }
}

/* =================================================================
   AnnotationStage — IntelGrader-style pinpoint error annotations

   Architecture:
     - Score strip at top (Q1 3/3, Q2 0/2 pills)
     - Error pins: red dot → dashed leader line → label pill
     - Highlight boxes: thin red rect around wrong values
     - Tick/cross near question numbers
   ================================================================= */

export default function AnnotationStage({
  imageDataUrl,
  autoMarks,
  activeQ,
  onQuestionClick,
  showFeedback,
  questions,
  containerSize,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  /* ---------- Image loading ---------- */
  useEffect(() => {
    if (!imageDataUrl) { setImage(null); return }
    const img = new window.Image()
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
    img.src = imageDataUrl
    return () => { img.onload = null; img.onerror = null }
  }, [imageDataUrl])

  /* ---------- Canvas dimensions (contain fit) ---------- */
  const STRIP_H = 44 // pixels for score strip at top
  const { imageWidth, imageHeight, offsetX, offsetY } = useMemo(() => {
    if (!image || !containerSize.width || !containerSize.height)
      return { imageWidth: 0, imageHeight: 0, offsetX: 0, offsetY: 0 }
    const natW = image.naturalWidth || image.width
    const natH = image.naturalHeight || image.height
    const aspect = natW / natH
    const availH = containerSize.height - STRIP_H
    const containerAspect = containerSize.width / availH
    let iw: number, ih: number
    if (aspect > containerAspect) {
      iw = containerSize.width
      ih = iw / aspect
    } else {
      ih = availH
      iw = ih * aspect
    }
    const ox = Math.floor((containerSize.width - iw) / 2)
    const oy = STRIP_H // image starts below strip
    return { imageWidth: Math.floor(iw), imageHeight: Math.floor(ih), offsetX: ox, offsetY: oy }
  }, [image, containerSize.width, containerSize.height])

  /* ---------- Coordinate helpers ---------- */
  const px = useCallback((norm: number) => norm * imageWidth, [imageWidth])
  const py = useCallback((norm: number) => norm * imageHeight, [imageHeight])

  /* ---------- Responsive sizes ---------- */
  const sw = useMemo(() => Math.max(1.5, imageWidth / 400), [imageWidth])
  const dotR = useMemo(() => Math.max(4, imageWidth * 0.008), [imageWidth])
  const fontSize = useMemo(() => Math.max(10, Math.min(13, imageWidth * 0.02)), [imageWidth])

  /* ---------- Parse marks into buckets ---------- */
  const buckets = useMemo(() => {
    const pins: AutoMark[] = []
    const highlights: AutoMark[] = []
    const pills: AutoMark[] = []
    const ticks: AutoMark[] = []
    const crosses: AutoMark[] = []
    // Legacy support
    const bboxes: (AutoMark & { qi: number })[] = []

    let bi = 0
    for (const m of autoMarks) {
      if (m.type === 'error_pin') pins.push(m)
      else if (m.type === 'highlight_box') highlights.push(m)
      else if (m.type === 'score_pill') pills.push(m)
      else if (m.type === 'tick') ticks.push(m)
      else if (m.type === 'cross') crosses.push(m)
      // Legacy bbox/badge support
      else if (m.type === 'bbox') bboxes.push({ ...m, qi: bi++ })
    }
    return { pins, highlights, pills, ticks, crosses, bboxes }
  }, [autoMarks])

  /* ---------- Score ---------- */
  const score = useMemo(() => {
    if (!questions.length) return null
    const correct = questions.filter(q => q.status === 'correct').length
    const partial = questions.filter(q => q.status === 'partially_correct').length
    const total = questions.length
    const got = correct + partial * 0.5
    return { got, total, pct: Math.round((got / total) * 100) }
  }, [questions])

  /* ---------- Click handler ---------- */
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = e.target.id()
    if (!id) return
    if (id.startsWith('pill-')) {
      const qi = parseInt(id.replace('pill-', ''))
      if (!isNaN(qi)) onQuestionClick(qi)
    } else if (id.startsWith('bbox-')) {
      const qi = parseInt(id.replace('bbox-', ''))
      if (!isNaN(qi)) onQuestionClick(qi)
    }
  }, [onQuestionClick])

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return
    const id = e.target.id()
    stage.container().style.cursor =
      (id?.startsWith('pill-') || id?.startsWith('bbox-')) ? 'pointer' : 'default'
  }, [])

  /* ========== RENDER ========== */

  if (!imageWidth) return null

  // Score strip pill layout
  const pillW = Math.max(60, Math.min(85, (containerSize.width - 40) / Math.max(questions.length, 1) - 8))
  const pillH = 26
  const pillGap = 6
  const totalPillsW = buckets.pills.length * (pillW + pillGap) - pillGap
  const pillStartX = Math.floor((containerSize.width - totalPillsW) / 2)

  return (
    <div style={{
      width: containerSize.width,
      height: containerSize.height,
      overflow: 'hidden',
    }}>
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onClick={handleStageClick}
        onMouseMove={handleMouseMove}
      >
        {/* Layer 0: Score strip background */}
        <Layer>
          <Rect
            x={0} y={0}
            width={containerSize.width} height={STRIP_H}
            fill="#1A2332"
          />
          {/* Score pills */}
          {buckets.pills.map((pill, i) => {
            const qi = pill.qi ?? i
            const isActive = qi === activeQ
            const status = pill.status || 'unanswered'
            const color = STATUS_COLORS[status] || '#9CA3AF'
            const pillX = pillStartX + i * (pillW + pillGap)
            const pillY = (STRIP_H - pillH) / 2

            return (
              <Group key={`pill-${i}`} x={pillX} y={pillY}>
                {/* Pill background */}
                <Rect
                  id={`pill-${qi}`}
                  width={pillW} height={pillH}
                  fill={hexToRgba(color, isActive ? 0.3 : 0.15)}
                  stroke={isActive ? color : hexToRgba(color, 0.4)}
                  strokeWidth={isActive ? 2 : 1}
                  cornerRadius={pillH / 2}
                  listening={true}
                />
                {/* Label + score */}
                <Text
                  text={`${pill.label || ''} ${pill.score_text || ''}`}
                  x={0} y={0}
                  width={pillW} height={pillH}
                  align="center" verticalAlign="middle"
                  fontSize={11} fontStyle="bold"
                  fontFamily="-apple-system, sans-serif"
                  fill={color}
                  listening={false}
                />
              </Group>
            )
          })}

          {/* Overall score at right */}
          {score && (
            <Text
              text={`${score.got}/${score.total} (${score.pct}%)`}
              x={containerSize.width - 120} y={0}
              width={110} height={STRIP_H}
              align="right" verticalAlign="middle"
              fontSize={13} fontStyle="bold"
              fontFamily="-apple-system, sans-serif"
              fill={score.pct >= 70 ? '#22C55E' : score.pct >= 40 ? '#F97316' : '#EF4444'}
            />
          )}
        </Layer>

        {/* Layer 1: Image */}
        <Layer x={offsetX} y={offsetY}>
          {image && <KonvaImage image={image} x={0} y={0} width={imageWidth} height={imageHeight} />}
        </Layer>

        {/* Layer 2: Highlight boxes — thin red rects around wrong values */}
        <Layer x={offsetX} y={offsetY} listening={false}>
          {buckets.highlights.map((h, i) => {
            if (h.w === undefined || h.h === undefined) return null
            const color = h.color || '#EF4444'
            return (
              <Rect
                key={`hl-${i}`}
                x={px(h.x)} y={py(h.y)}
                width={px(h.w)} height={py(h.h)}
                fill={hexToRgba(color, 0.12)}
                stroke={color}
                strokeWidth={Math.max(1.5, sw)}
                cornerRadius={3}
              />
            )
          })}
        </Layer>

        {/* Layer 3: Error pins — dot + dashed line + label pill */}
        <Layer x={offsetX} y={offsetY} listening={false}>
          {buckets.pins.map((pin, i) => {
            if (pin.pin_x === undefined || pin.pin_y === undefined) return null
            if (pin.label_x === undefined || pin.label_y === undefined) return null
            const color = pin.color || '#EF4444'
            const pinPx = px(pin.pin_x)
            const pinPy = py(pin.pin_y)
            const labelPx = px(pin.label_x)
            const labelPy = py(pin.label_y)
            const labelText = pin.error_type || 'Error'
            const labelPadX = 10
            const labelPadY = 5
            const estTextW = labelText.length * (fontSize * 0.6) + labelPadX * 2
            const labelH = fontSize + labelPadY * 2

            return (
              <Group key={`pin-${i}`}>
                {/* Dashed leader line */}
                <Line
                  points={[pinPx, pinPy, labelPx, labelPy + labelH / 2]}
                  stroke={color}
                  strokeWidth={Math.max(1, sw * 0.7)}
                  dash={[4, 3]}
                  opacity={0.7}
                />
                {/* Pin dot */}
                <Circle
                  x={pinPx} y={pinPy}
                  radius={dotR}
                  fill={color}
                  shadowColor={color}
                  shadowBlur={6}
                  shadowOpacity={0.5}
                />
                {/* Label pill background */}
                <Rect
                  x={labelPx} y={labelPy}
                  width={estTextW} height={labelH}
                  fill="rgba(255,255,255,0.95)"
                  stroke={color}
                  strokeWidth={1}
                  cornerRadius={labelH / 2}
                  shadowColor="rgba(0,0,0,0.15)"
                  shadowBlur={4}
                  shadowOffsetY={1}
                />
                {/* Label text */}
                <Text
                  x={labelPx + labelPadX} y={labelPy + labelPadY}
                  text={labelText}
                  fontSize={fontSize}
                  fontStyle="600"
                  fontFamily="-apple-system, 'Segoe UI', sans-serif"
                  fill={color}
                />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 4: Tick / Cross near question numbers */}
        <Layer x={offsetX} y={offsetY} listening={false}>
          {buckets.ticks.map((t, i) => {
            const cx = px(t.x), cy = py(t.y)
            const s = Math.max(8, imageWidth * 0.012)
            return (
              <Line
                key={`tick-${i}`}
                points={[
                  cx - s * 0.35, cy,
                  cx, cy + s * 0.35,
                  cx + s * 0.45, cy - s * 0.35,
                ]}
                stroke={t.color || '#22C55E'}
                strokeWidth={Math.max(2, s * 0.2)}
                lineCap="round" lineJoin="round"
              />
            )
          })}
          {buckets.crosses.map((c, i) => {
            const cx = px(c.x), cy = py(c.y)
            const s = Math.max(6, imageWidth * 0.01)
            return (
              <Group key={`cross-${i}`}>
                <Line
                  points={[cx - s, cy - s, cx + s, cy + s]}
                  stroke="#EF4444" strokeWidth={Math.max(2, s * 0.2)}
                  lineCap="round"
                />
                <Line
                  points={[cx + s, cy - s, cx - s, cy + s]}
                  stroke="#EF4444" strokeWidth={Math.max(2, s * 0.2)}
                  lineCap="round"
                />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 5: Legacy bbox support (for old sessions) */}
        {buckets.bboxes.length > 0 && (
          <Layer x={offsetX} y={offsetY}>
            {buckets.bboxes.map((b) => {
              if (b.w === undefined || b.h === undefined) return null
              const status = questions[b.qi]?.status || b.status || 'unanswered'
              const color = STATUS_COLORS[status] || '#9CA3AF'
              const isActive = b.qi === activeQ
              return (
                <Rect
                  key={`bbox-${b.qi}`}
                  id={`bbox-${b.qi}`}
                  x={px(b.x)} y={py(b.y)}
                  width={px(b.w)} height={py(b.h)}
                  stroke={color}
                  strokeWidth={isActive ? sw * 2.5 : sw * 1.5}
                  dash={[10, 6]}
                  fill={hexToRgba(color, 0.07)}
                  cornerRadius={4}
                  shadowColor={isActive ? color : 'transparent'}
                  shadowBlur={isActive ? 14 : 0}
                  listening={true}
                />
              )
            })}
          </Layer>
        )}
      </Stage>
    </div>
  )
}
