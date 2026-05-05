import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
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
  onAnnotationClick?: (annId: string, stepRef: number | null) => void
  activeAnnotationId?: string | null
  showFeedback: boolean
  questions: EvaluatedQuestion[]
  containerSize: { width: number; height: number }
}

/* =================================================================
   AnnotationStage — Bbox + IntelGrader error pins + badges
   ================================================================= */

export default function AnnotationStage({
  imageDataUrl,
  autoMarks,
  activeQ,
  onQuestionClick,
  onAnnotationClick,
  activeAnnotationId,
  showFeedback,
  questions,
  containerSize,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const activeBboxRef = useRef<Konva.Rect | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [openPinIdx, setOpenPinIdx] = useState<number | null>(null)

  /* ---------- One-shot pulse on activeQ change (idea #3) ----------
     Flash the shadow blur + opacity on the newly-active bbox, then decay.
     Pure cosmetic — doesn't touch x/y/scale so it can't fight React props. */
  useEffect(() => {
    const node = activeBboxRef.current
    if (!node) return
    // Start bright
    node.shadowBlur(55)
    node.shadowOpacity(1)
    node.strokeWidth(node.strokeWidth() * 1.25)
    const tween = new Konva.Tween({
      node,
      shadowBlur: 28,
      shadowOpacity: 0.9,
      duration: 0.6,
      easing: Konva.Easings.EaseOut,
    })
    tween.play()
    return () => { tween.destroy() }
  }, [activeQ])

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
  const STRIP_H = 0  // top pills strip removed — pills live in right panel now
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
    const oy = STRIP_H + Math.floor((availH - ih) / 2)
    if (import.meta.env.DEV) {
      console.log(`[STAGE] nat=${natW}x${natH} container=${containerSize.width}x${containerSize.height} ` +
        `fitted=${Math.floor(iw)}x${Math.floor(ih)} offset=(${ox},${oy})`)
    }
    return { imageWidth: Math.floor(iw), imageHeight: Math.floor(ih), offsetX: ox, offsetY: oy }
  }, [image, containerSize.width, containerSize.height])

  /* ---------- Coordinate helpers ---------- */
  const px = useCallback((norm: number) => norm * imageWidth, [imageWidth])
  const py = useCallback((norm: number) => norm * imageHeight, [imageHeight])

  /* ---------- Responsive sizes ---------- */
  const sw = useMemo(() => Math.max(1.5, imageWidth / 400), [imageWidth])
  const dotR = useMemo(() => Math.max(4, imageWidth * 0.008), [imageWidth])
  const fontSize = useMemo(() => Math.max(10, Math.min(13, imageWidth * 0.02)), [imageWidth])
  const badgeR = useMemo(() => Math.max(12, imageWidth * 0.022), [imageWidth])

  /* ---------- Parse marks into buckets ---------- */
  const buckets = useMemo(() => {
    const bboxes: (AutoMark & { qi: number })[] = []
    const pins: AutoMark[] = []
    const highlights: AutoMark[] = []
    const pills: AutoMark[] = []
    const badges: (AutoMark & { qi: number })[] = []

    for (const m of autoMarks) {
      if (m.type === 'bbox') bboxes.push({ ...m, qi: m.qi ?? bboxes.length })
      else if (m.type === 'error_pin') pins.push(m)
      else if (m.type === 'highlight_box') highlights.push(m)
      else if (m.type === 'score_pill') pills.push(m)
      else if (m.type === 'badge') badges.push({ ...m, qi: m.qi ?? badges.length })
    }
    return { bboxes, pins, highlights, pills, badges }
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

  /* ---------- Click/Tap handler (works for mouse + touch) ---------- */
  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const id = e.target.id()
    if (!id) { setOpenPinIdx(null); return }
    if (id.startsWith('pin-hit-') || (id.startsWith('pin-') && !id.startsWith('pin-hit-'))) {
      const idx = parseInt(id.replace(/^(pin-hit|pin)-/, ''))
      if (!isNaN(idx)) {
        setOpenPinIdx(prev => prev === idx ? null : idx)
        // Bidirectional: tell parent which annotation got clicked
        if (onAnnotationClick) {
          const pin = buckets.pins[idx]
          if (pin) {
            const annId = `err-${idx}`
            onAnnotationClick(annId, null)
          }
        }
      }
      return
    }
    if (id.startsWith('pill-') || id.startsWith('bbox-') || id.startsWith('badge-hit-')) {
      const qi = parseInt(id.replace(/^(pill|bbox|badge-hit)-/, ''))
      if (!isNaN(qi)) onQuestionClick(qi)
    }
    setOpenPinIdx(null)
  }, [onQuestionClick, onAnnotationClick, buckets.pins])

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return
    const id = e.target.id()
    const isClickable =
      id?.startsWith('pill-') || id?.startsWith('bbox-') ||
      id?.startsWith('badge-hit-') || id?.startsWith('pin-') || id?.startsWith('pin-hit-')
    stage.container().style.cursor = isClickable ? 'pointer' : 'default'
  }, [])

  /* ========== RENDER ========== */

  if (!imageWidth) return null

  // Score strip pill layout — reserve right-edge space for total score text
  const TOTAL_TEXT_W = 130
  const stripAvail = Math.max(60, containerSize.width - TOTAL_TEXT_W - 16)
  const pillH = 26
  const pillGap = 6
  const nPills = Math.max(buckets.pills.length, 1)
  const pillW = Math.max(42, Math.min(85, (stripAvail - pillGap * (nPills - 1)) / nPills))
  const totalPillsW = nPills * (pillW + pillGap) - pillGap
  const pillStartX = Math.max(8, Math.floor((stripAvail - totalPillsW) / 2) + 8)

  return (
    <div style={{
      width: containerSize.width,
      height: containerSize.height,
      overflow: 'hidden',
      touchAction: 'manipulation',
      position: 'relative',
    }}>
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onMouseMove={handleMouseMove}
      >
        {/* Top pills strip removed — Q-pills live in right-panel header */}

        {/* Layer 1: Image */}
        <Layer x={offsetX} y={offsetY}>
          {image && <KonvaImage image={image} x={0} y={0} width={imageWidth} height={imageHeight} />}
        </Layer>

        {/* Layer 2: Bbox — FOCUS MODE (only active Q renders full bbox; others hidden) */}
        <Layer x={offsetX} y={offsetY}>
          {buckets.bboxes.map((b) => {
            if (b.w === undefined || b.h === undefined) return null
            const bw = px(b.w), bh = py(b.h)
            if (bw <= 0 || bh <= 0) return null
            const qi = b.qi ?? 0
            if (qi !== activeQ) return null  // hide non-active
            const status = questions[qi]?.status || b.status || 'unanswered'
            const color = STATUS_COLORS[status] || '#9CA3AF'
            return (
              <Rect
                key={`bbox-${qi}`}
                id={`bbox-${qi}`}
                ref={(node) => { activeBboxRef.current = node }}
                x={px(b.x)} y={py(b.y)}
                width={bw} height={bh}
                stroke={color}
                strokeWidth={Math.max(3.5, sw * 3)}
                dash={[14, 4]}
                fill={hexToRgba(color, 0.12)}
                cornerRadius={4}
                shadowColor={color}
                shadowBlur={28}
                shadowOpacity={0.9}
                listening={true}
              />
            )
          })}
        </Layer>

        {/* Layer 3: Highlight boxes — only for active question */}
        <Layer x={offsetX} y={offsetY} listening={false}>
          {buckets.highlights.map((h, i) => {
            if (h.w === undefined || h.h === undefined) return null
            const hw = px(h.w), hh = py(h.h)
            if (hw <= 0 || hh <= 0) return null
            // Match by label "Q<n>"
            const labelNum = h.label ? parseInt(h.label.replace(/^Q/, '')) : null
            const activeNum = questions[activeQ]?.number
            if (labelNum != null && activeNum != null && labelNum !== activeNum) return null
            const color = h.color || '#EF4444'
            return (
              <Rect
                key={`hl-${i}`}
                x={px(h.x)} y={py(h.y)}
                width={hw} height={hh}
                fill={hexToRgba(color, 0.12)}
                stroke={color}
                strokeWidth={Math.max(1.5, sw)}
                cornerRadius={3}
              />
            )
          })}
        </Layer>

        {/* Layer 4: Error pins — dot + dashed line + label pill (clickable → routes to Q) */}
        <Layer x={offsetX} y={offsetY}>
          {buckets.pins.map((pin, i) => {
            if (pin.pin_x === undefined || pin.pin_y === undefined) return null
            if (pin.label_x === undefined || pin.label_y === undefined) return null
            // Filter to active question — compare by qi or label "Q<n>"
            const qi = pin.qi ?? -1
            const labelNum = pin.label ? parseInt(pin.label.replace(/^Q/, '')) : null
            const activeNum = questions[activeQ]?.number
            const isActive = qi === activeQ || (labelNum != null && activeNum != null && labelNum === activeNum)
            if (!isActive) return null
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

            const isOpen = openPinIdx === i
            return (
              <Group key={`pin-${i}`}>
                {/* Dashed leader line — non-interactive */}
                <Line
                  points={[pinPx, pinPy, labelPx, labelPy + labelH / 2]}
                  stroke={color}
                  strokeWidth={Math.max(1, sw * 0.7)}
                  dash={[4, 3]}
                  opacity={0.7}
                  listening={false}
                />
                {/* Pin dot — clickable */}
                <Circle
                  id={`pin-${i}`}
                  x={pinPx} y={pinPy}
                  radius={isOpen ? dotR * 1.4 : dotR}
                  fill={color}
                  shadowColor={color}
                  shadowBlur={isOpen ? 10 : 6}
                  shadowOpacity={0.6}
                />
                {/* Oversized invisible hit target around pin for easier tap */}
                <Circle
                  id={`pin-hit-${i}`}
                  x={pinPx} y={pinPy}
                  radius={dotR + 10}
                  fill="transparent"
                />
                {/* Label pill — clickable */}
                <Rect
                  id={`pin-${i}`}
                  x={labelPx} y={labelPy}
                  width={estTextW} height={labelH}
                  fill={isOpen ? color : 'rgba(255,255,255,0.95)'}
                  stroke={color}
                  strokeWidth={isOpen ? 2 : 1}
                  cornerRadius={labelH / 2}
                  shadowColor="rgba(0,0,0,0.15)"
                  shadowBlur={4}
                  shadowOffsetY={1}
                />
                <Text
                  x={labelPx + labelPadX} y={labelPy + labelPadY}
                  text={labelText}
                  fontSize={fontSize}
                  fontStyle="600"
                  fontFamily="-apple-system, 'Segoe UI', sans-serif"
                  fill={isOpen ? '#fff' : color}
                  listening={false}
                />
              </Group>
            )
          })}
        </Layer>

        {/* Layer 5: Badges — circle with ✓/✗/~ per question */}
        <Layer x={offsetX} y={offsetY}>
          {buckets.badges.map((bg) => {
            const qi = bg.qi ?? 0
            const status = questions[qi]?.status || bg.status || 'unanswered'
            const color = STATUS_COLORS[status] || '#9CA3AF'
            const symbol = BADGE_SYMBOLS[status] || '\u2014'
            const cx = px(bg.x), cy = py(bg.y)
            const awarded = bg.marks_awarded ?? 0
            const possible = bg.marks_possible ?? 1
            const isActive = qi === activeQ
            return (
              <Group key={`badge-${qi}`} x={cx} y={cy} scaleX={isActive ? 1.2 : 1} scaleY={isActive ? 1.2 : 1}>
                <Circle
                  radius={badgeR} fill={color}
                  shadowColor={isActive ? color : 'rgba(0,0,0,0.25)'}
                  shadowBlur={isActive ? 14 : 6}
                  shadowOpacity={isActive ? 0.8 : 1}
                  shadowOffsetY={2}
                  stroke={isActive ? '#ffffff' : undefined}
                  strokeWidth={isActive ? 2 : 0}
                />
                <Text
                  text={symbol}
                  fontSize={badgeR * 1.1} fontStyle="bold"
                  fontFamily="-apple-system, sans-serif"
                  fill="#fff"
                  width={badgeR * 2} height={badgeR * 2}
                  offsetX={badgeR} offsetY={badgeR}
                  align="center" verticalAlign="middle"
                />
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
                <Circle
                  id={`badge-hit-${qi}`}
                  radius={badgeR + 5} fill="transparent" listening={true}
                />
              </Group>
            )
          })}
        </Layer>
      </Stage>

      {/* HTML tooltip overlays — filtered to active question */}
      {buckets.pins.map((pin, i) => {
        const isOpen = openPinIdx === i
        const show = showFeedback || isOpen
        if (!show) return null
        if (pin.label_x === undefined || pin.label_y === undefined) return null
        // Focus: only active question's tooltips
        const qi = pin.qi ?? -1
        const labelNum = pin.label ? parseInt(pin.label.replace(/^Q/, '')) : null
        const activeNum = questions[activeQ]?.number
        const isActive = qi === activeQ || (labelNum != null && activeNum != null && labelNum === activeNum)
        if (!isActive) return null
        const color = pin.color || '#EF4444'
        const left = offsetX + px(pin.label_x)
        const top = offsetY + py(pin.label_y) + 28
        const maxW = Math.min(showFeedback ? 240 : 300, containerSize.width - 24)
        const clampedLeft = Math.max(8, Math.min(left, containerSize.width - maxW - 8))
        return (
          <div
            key={`tip-${i}`}
            style={{
              position: 'absolute',
              left: clampedLeft,
              top,
              maxWidth: maxW,
              zIndex: isOpen ? 30 : 20,
              borderColor: color,
            }}
            className="rounded-xl bg-white shadow-2xl border-2 text-slate-900 text-xs p-2.5 pointer-events-auto"
            onClick={(e) => { e.stopPropagation(); setOpenPinIdx(i) }}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span
                className="font-bold uppercase tracking-wide"
                style={{ color, fontSize: 10 }}
              >
                {pin.error_type || 'Error'}
              </span>
              {isOpen && !showFeedback && (
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenPinIdx(null) }}
                  className="text-slate-400 hover:text-slate-700 leading-none text-base -mt-0.5"
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>
            <div className="text-slate-800 leading-snug">
              {pin.description || pin.error_type || 'No detail.'}
            </div>
            {pin.label && (
              <div className="mt-1.5 pt-1.5 border-t border-slate-200 text-[10px] text-slate-500">
                {pin.label}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
