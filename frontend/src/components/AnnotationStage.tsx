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

const BADGE_SYMBOLS: Record<string, string> = {
  correct:           '\u2713',
  incorrect:         '\u2717',
  partially_correct: '~',
  partial:           '~',
  unanswered:        '\u2014',
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
   AnnotationStage — Konva canvas overlay

   Architecture:
     Stage fills container width.
     Image rendered at (0,0) full width.
     Annotations drawn via marks {x, y, w, h} on 0-1 scale.
     Pixel: x_px = x_norm * imageWidth, y_px = y_norm * imageHeight
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
  const feedbackLayerRef = useRef<Konva.Layer>(null)
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
  const { imageWidth, imageHeight, offsetX, offsetY } = useMemo(() => {
    if (!image || !containerSize.width || !containerSize.height)
      return { imageWidth: 0, imageHeight: 0, offsetX: 0, offsetY: 0 }
    const natW = image.naturalWidth || image.width
    const natH = image.naturalHeight || image.height
    const aspect = natW / natH
    const containerAspect = containerSize.width / containerSize.height
    let iw: number, ih: number
    if (aspect > containerAspect) {
      // Image wider than container — fit to width
      iw = containerSize.width
      ih = iw / aspect
    } else {
      // Image taller than container — fit to height
      ih = containerSize.height
      iw = ih * aspect
    }
    // Center in container
    const ox = Math.floor((containerSize.width - iw) / 2)
    const oy = Math.floor((containerSize.height - ih) / 2)
    return { imageWidth: Math.floor(iw), imageHeight: Math.floor(ih), offsetX: ox, offsetY: oy }
  }, [image, containerSize.width, containerSize.height])

  /* ---------- Coordinate helpers ---------- */
  const px = useCallback((norm: number) => norm * imageWidth, [imageWidth])
  const py = useCallback((norm: number) => norm * imageHeight, [imageHeight])

  /* ---------- Responsive sizes ---------- */
  const sw = useMemo(() => Math.max(2, imageWidth / 350), [imageWidth])
  const badgeR = useMemo(() => Math.max(14, imageWidth * 0.026), [imageWidth])
  const symSize = useMemo(() => Math.max(18, imageWidth * 0.022), [imageWidth])

  // No scroll needed — image always fits
  const needsScroll = false

  /* ---------- Parse marks into buckets ---------- */
  const buckets = useMemo(() => {
    const bboxes: (AutoMark & { qi: number })[] = []
    const errors: AutoMark[] = []
    const badges: (AutoMark & { qi: number })[] = []
    const ticks: AutoMark[] = []
    const crosses: AutoMark[] = []

    let bi = 0, bgi = 0
    for (const m of autoMarks) {
      if (m.type === 'bbox') bboxes.push({ ...m, qi: bi++ })
      else if (m.type === 'error_highlight') errors.push(m)
      else if (m.type === 'badge') badges.push({ ...m, qi: bgi++ })
      else if (m.type === 'tick') ticks.push(m)
      else if (m.type === 'cross') crosses.push(m)
    }
    return { bboxes, errors, badges, ticks, crosses }
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

  /* ---------- Feedback callouts (imperative — drawn after render) ---------- */
  useEffect(() => {
    if (!feedbackLayerRef.current || !imageWidth) return
    feedbackLayerRef.current.destroyChildren()
    if (!showFeedback) { feedbackLayerRef.current.batchDraw(); return }

    buckets.bboxes.forEach((b) => {
      if (b.w === undefined || b.h === undefined) return
      const q = questions[b.qi]
      if (!q) return

      const bx = px(b.x), by = py(b.y), bw = px(b.w)
      const color = STATUS_COLORS[q.status] || '#9CA3AF'
      const label = q.status === 'correct' ? `\u2713 ${q.correctAnswer}` :
                    q.status === 'incorrect' ? `\u2717 Correct: ${q.correctAnswer}` :
                    q.status === 'partially_correct' ? `\u25D1 ${q.correctAnswer}` : '\u2014 Unanswered'
      const fb = q.feedback || ''
      const boxW = Math.min(bw * 0.88, 260)
      const boxH = fb ? 44 : 30
      const boxX = bx + 8
      const boxY = by - boxH - 6

      const group = new Konva.Group({ x: boxX, y: boxY + 12, opacity: 0 })
      group.add(new Konva.Rect({
        width: boxW, height: boxH, fill: '#1A2332',
        stroke: color, strokeWidth: 1.5, cornerRadius: 6,
        shadowColor: color, shadowBlur: 6, shadowOpacity: 0.4,
      }))
      group.add(new Konva.Text({
        x: 8, y: 7, text: label.slice(0, 35), fontSize: 11,
        fontFamily: '-apple-system, sans-serif', fontStyle: 'bold', fill: '#fff',
        width: boxW - 16, ellipsis: true,
      }))
      if (fb) {
        group.add(new Konva.Text({
          x: 8, y: 24, text: fb.slice(0, 50), fontSize: 9,
          fontFamily: '-apple-system, sans-serif', fill: '#fff', opacity: 0.55,
          width: boxW - 16, ellipsis: true,
        }))
      }
      feedbackLayerRef.current!.add(group)

      // Animate in
      setTimeout(() => {
        new Konva.Tween({
          node: group, y: boxY, opacity: 1, duration: 0.3,
          easing: Konva.Easings.EaseOut,
        }).play()
      }, b.qi * 100 + 200)
    })
    feedbackLayerRef.current.batchDraw()
  }, [showFeedback, buckets.bboxes, questions, imageWidth, imageHeight, px, py])

  /* ---------- Click handler ---------- */
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = e.target.id()
    if (!id) return
    if (id.startsWith('bbox-')) {
      const qi = parseInt(id.replace('bbox-', ''))
      if (!isNaN(qi)) onQuestionClick(qi)
    } else if (id.startsWith('badge-hit-')) {
      const qi = parseInt(id.replace('badge-hit-', ''))
      if (!isNaN(qi)) onQuestionClick(qi)
    }
  }, [onQuestionClick])

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return
    const id = e.target.id()
    stage.container().style.cursor =
      (id?.startsWith('bbox-') || id?.startsWith('badge-hit-')) ? 'pointer' : 'default'
  }, [])

  /* ========== RENDER ========== */

  if (!imageWidth) return null

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
        {/* Layer 0: Image */}
        <Layer x={offsetX} y={offsetY}>
          {image && <KonvaImage image={image} x={0} y={0} width={imageWidth} height={imageHeight} />}
        </Layer>

        {/* Layer 1: Bbox rects — one per question */}
        <Layer x={offsetX} y={offsetY}>
          {buckets.bboxes.map((b) => {
            if (b.w === undefined || b.h === undefined) return null
            const status = questions[b.qi]?.status || b.status || 'unanswered'
            const color = STATUS_COLORS[status] || '#9CA3AF'
            const isActive = b.qi === activeQ
            const isFilled = b.filled || status === 'incorrect' || status === 'partially_correct' || status === 'partial'
            return (
              <Rect
                key={`bbox-${b.qi}`}
                id={`bbox-${b.qi}`}
                x={px(b.x)} y={py(b.y)}
                width={px(b.w)} height={py(b.h)}
                stroke={color}
                strokeWidth={isActive ? sw * 2.5 : sw * 1.5}
                dash={isFilled ? undefined : [10, 6]}
                fill={isFilled ? hexToRgba(color, 0.25) : hexToRgba(color, 0.07)}
                cornerRadius={4}
                shadowColor={isActive ? color : 'transparent'}
                shadowBlur={isActive ? 14 : 0}
                listening={true}
              />
            )
          })}
        </Layer>

        {/* Layer 3: Tick / Cross */}
        <Layer x={offsetX} y={offsetY}>
          {buckets.ticks.map((t, i) => {
            const cx = px(t.x), cy = py(t.y)
            const s = symSize
            return (
              <Line
                key={`tick-${i}`}
                points={[
                  cx - s * 0.35, cy,
                  cx, cy + s * 0.35,
                  cx + s * 0.45, cy - s * 0.35,
                ]}
                stroke={t.color || '#22C55E'}
                strokeWidth={Math.max(3, s * 0.16)}
                lineCap="round" lineJoin="round"
              />
            )
          })}
          {buckets.crosses.map((c, i) => {
            const cx = px(c.x), cy = py(c.y)
            const s = symSize * 0.35
            return (
              <Group key={`cross-${i}`}>
                <Line
                  points={[cx - s, cy - s, cx + s, cy + s]}
                  stroke="#EF4444" strokeWidth={Math.max(2.5, symSize * 0.14)}
                  lineCap="round"
                />
                <Line
                  points={[cx + s, cy - s, cx - s, cy + s]}
                  stroke="#EF4444" strokeWidth={Math.max(2.5, symSize * 0.14)}
                  lineCap="round"
                />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 4: Badges */}
        <Layer x={offsetX} y={offsetY}>
          {buckets.badges.map((bg) => {
            const cx = px(bg.x), cy = py(bg.y)
            const status = questions[bg.qi]?.status || 'unanswered'
            const color = STATUS_COLORS[status] || '#9CA3AF'
            const symbol = BADGE_SYMBOLS[status] || '\u2014'
            const awarded = bg.marks_awarded ?? 0
            const possible = bg.marks_possible ?? 1
            return (
              <Group key={`badge-${bg.qi}`} x={cx} y={cy}>
                {/* Circle */}
                <Circle
                  radius={badgeR} fill={color}
                  shadowColor="rgba(0,0,0,0.25)" shadowBlur={6} shadowOffsetY={2}
                />
                {/* Symbol */}
                <Text
                  text={symbol}
                  fontSize={badgeR * 1.1} fontStyle="bold"
                  fontFamily="-apple-system, sans-serif"
                  fill="#fff"
                  width={badgeR * 2} height={badgeR * 2}
                  offsetX={badgeR} offsetY={badgeR}
                  align="center" verticalAlign="middle"
                />
                {/* Score text */}
                <Text
                  text={`${awarded}/${possible}`}
                  fontSize={badgeR * 0.6} fontStyle="bold"
                  fontFamily="-apple-system, sans-serif"
                  fill={color}
                  width={badgeR * 3}
                  offsetX={badgeR * 1.5}
                  y={badgeR + 4}
                  align="center"
                />
                {/* Hit area */}
                <Circle
                  id={`badge-hit-${bg.qi}`}
                  radius={badgeR + 5} fill="transparent" listening={true}
                />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 5: Feedback callouts (imperative) */}
        <Layer ref={feedbackLayerRef} x={offsetX} y={offsetY} />

        {/* Layer 6: Score summary */}
        <Layer x={offsetX} y={offsetY}>
          {score && (() => {
            const cardW = Math.min(130, imageWidth * 0.24)
            const cardH = 52
            const cardX = imageWidth - cardW - 10
            const cardY = 8
            const barW = cardW - 20
            const barColor = score.pct >= 70 ? '#22C55E' : score.pct >= 40 ? '#F97316' : '#EF4444'
            return (
              <Group x={cardX} y={cardY}>
                <Rect
                  width={cardW} height={cardH} fill="rgba(255,255,255,0.95)"
                  cornerRadius={8}
                  shadowColor="rgba(0,0,0,0.12)" shadowBlur={8} shadowOffsetY={2}
                />
                <Text
                  text={`Score: ${score.got}/${score.total}`}
                  x={10} y={8} fontSize={12} fontStyle="bold"
                  fontFamily="-apple-system, sans-serif" fill="#1f2937"
                />
                <Rect x={10} y={26} width={barW} height={5} fill="#e5e7eb" cornerRadius={3} />
                <Rect x={10} y={26} width={barW * (score.pct / 100)} height={5} fill={barColor} cornerRadius={3} />
                <Text
                  text={`${score.pct}%`}
                  x={10} y={36} fontSize={10} fontStyle="bold"
                  fontFamily="-apple-system, sans-serif" fill={barColor}
                />
              </Group>
            )
          })()}
        </Layer>
      </Stage>
    </div>
  )
}
