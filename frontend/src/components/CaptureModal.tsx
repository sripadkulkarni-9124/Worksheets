import React, { useRef, useState, useCallback, useEffect } from 'react'

interface Props {
  onCapture: (base64: string, mimeType: string, dataUrl: string) => void
  onCaptureMulti?: (files: Array<{ base64: string; mimeType: string; dataUrl: string }>) => void
  onClose: () => void
}

export default function CaptureModal({ onCapture, onCaptureMulti, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [mode, setMode] = useState<'camera' | 'file'>('camera')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewMime, setPreviewMime] = useState<string>('image/jpeg')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)

  // Staged files — pick, review, then submit as a batch
  type StagedFile = { id: string; name: string; dataUrl: string; base64: string; mimeType: string }
  const [staged, setStaged] = useState<StagedFile[]>([])

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraActive(true)
      }
    } catch (err) {
      setCameraError('Camera not available. Please use file upload.')
      setMode('file')
    }
  }, [])

  useEffect(() => {
    if (mode === 'camera') {
      startCamera()
    } else {
      stopStream()
    }
    return () => stopStream()
  }, [mode, startCamera, stopStream])

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setPreview(dataUrl)
    setPreviewMime('image/jpeg')
    stopStream()
  }, [stopStream])

  /* Read file + bake EXIF orientation into pixels via canvas.
     Without this, phone photos render rotated in browser (EXIF auto-rotate) but
     Gemini/Konva use raw pixel dims → bbox coords mismatch actual display.
     We draw through createImageBitmap({ imageOrientation: 'from-image' }) so the
     output canvas is the visually-correct orientation in real pixels. */
  const readAndNormalize = useCallback(async (f: File): Promise<StagedFile> => {
    const maxDim = 2000 // cap huge camera files — preserves quality, shrinks >4K
    const blob = f.slice(0, f.size, f.type || 'image/jpeg')
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch {
      // Browser doesn't support imageOrientation option — fall back to <img>
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = URL.createObjectURL(blob)
      })
      bitmap = img as unknown as ImageBitmap
    }
    const w = (bitmap as ImageBitmap).width || (bitmap as unknown as HTMLImageElement).naturalWidth
    const h = (bitmap as ImageBitmap).height || (bitmap as unknown as HTMLImageElement).naturalHeight
    const scale = Math.min(1, maxDim / Math.max(w, h))
    const outW = Math.round(w * scale)
    const outH = Math.round(h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, outW, outH)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const base64 = dataUrl.split(',')[1]
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      dataUrl,
      base64,
      mimeType: 'image/jpeg',
    }
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    const input = e.target
    if (files.length === 0) return

    Promise.all(files.map(readAndNormalize)).then(newStaged => {
      setStaged(prev => [...prev, ...newStaged])
      input.value = ''
    }).catch(err => {
      console.error('File read failed:', err)
      input.value = ''
    })
  }, [readAndNormalize])

  const removeStaged = useCallback((id: string) => {
    setStaged(prev => prev.filter(s => s.id !== id))
  }, [])

  const submitStaged = useCallback(() => {
    if (staged.length === 0) return
    const payload = staged.map(s => ({ base64: s.base64, mimeType: s.mimeType, dataUrl: s.dataUrl }))
    if (payload.length === 1) {
      onCapture(payload[0].base64, payload[0].mimeType, payload[0].dataUrl)
    } else if (onCaptureMulti) {
      onCaptureMulti(payload)
    } else {
      // No multi handler — fall back to single-file (page 0)
      onCapture(payload[0].base64, payload[0].mimeType, payload[0].dataUrl)
    }
    setStaged([])
  }, [staged, onCapture, onCaptureMulti])

  const confirm = useCallback(() => {
    if (!preview) return
    const parts = preview.split(',')
    const base64 = parts[1]
    onCapture(base64, previewMime, preview)
  }, [preview, previewMime, onCapture])

  const retake = useCallback(() => {
    setPreview(null)
    if (mode === 'camera') startCamera()
  }, [mode, startCamera])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative bg-[#1A2332] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-white font-semibold text-lg">Scan Worksheet</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Mode tabs */}
        {!preview && (
          <div className="flex border-b border-white/10">
            <button
              onClick={() => setMode('camera')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'camera'
                  ? 'text-orange-400 border-b-2 border-orange-400'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              Camera
            </button>
            <button
              onClick={() => setMode('file')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'file'
                  ? 'text-orange-400 border-b-2 border-orange-400'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              Upload File
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-5">
          {preview ? (
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden bg-black aspect-[4/3] flex items-center justify-center">
                <img src={preview} alt="Preview" className="max-w-full max-h-full object-contain" />
              </div>
              <p className="text-white/60 text-sm text-center">
                Looks good? Tap Confirm to evaluate.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={retake}
                  className="flex-1 py-3 rounded-xl border border-white/20 text-white/80 hover:border-white/40 transition-colors text-sm font-medium"
                >
                  Retake
                </button>
                <button
                  onClick={confirm}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  Confirm &amp; Evaluate
                </button>
              </div>
            </div>
          ) : mode === 'camera' ? (
            <div className="space-y-4">
              {cameraError ? (
                <div className="rounded-xl bg-red-900/30 border border-red-500/30 p-4 text-red-300 text-sm text-center">
                  {cameraError}
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden bg-black aspect-[4/3] relative">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                  />
                  {!cameraActive && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {/* Viewfinder overlay */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-orange-400 rounded-tl" />
                    <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-orange-400 rounded-tr" />
                    <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-orange-400 rounded-bl" />
                    <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-orange-400 rounded-br" />
                  </div>
                </div>
              )}
              {!cameraError && (
                <button
                  onClick={capture}
                  disabled={!cameraActive}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Capture
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {staged.length === 0 ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border-2 border-dashed border-white/20 hover:border-orange-400/60 transition-colors aspect-[4/3] flex flex-col items-center justify-center cursor-pointer bg-white/5"
                >
                  <div className="text-5xl mb-3">📄</div>
                  <p className="text-white/60 text-sm">Click to browse</p>
                  <p className="text-white/30 text-xs mt-1">
                    JPG, PNG, WebP, HEIC — <span className="text-orange-300">select one or multiple</span>
                  </p>
                </div>
              ) : (
                <>
                  {/* Thumbnail grid */}
                  <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                    {staged.map((s, i) => (
                      <div key={s.id} className="relative group rounded-lg overflow-hidden bg-black aspect-square">
                        <img src={s.dataUrl} alt={s.name} className="w-full h-full object-cover" />
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold">
                          {i + 1}
                        </div>
                        <button
                          onClick={() => removeStaged(s.id)}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/90 text-white text-xs flex items-center justify-center hover:bg-red-500 transition-colors"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-lg border-2 border-dashed border-white/20 hover:border-orange-400/60 text-white/50 hover:text-orange-300 transition-colors flex flex-col items-center justify-center aspect-square"
                      title="Add more"
                    >
                      <div className="text-2xl">＋</div>
                      <div className="text-[10px] mt-0.5">Add</div>
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">
                      {staged.length} page{staged.length > 1 ? 's' : ''} staged
                    </span>
                    <button
                      onClick={() => setStaged([])}
                      className="text-white/40 hover:text-red-400 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <button
                    onClick={submitStaged}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                  >
                    Submit &amp; Evaluate ({staged.length} page{staged.length > 1 ? 's' : ''})
                  </button>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  )
}
