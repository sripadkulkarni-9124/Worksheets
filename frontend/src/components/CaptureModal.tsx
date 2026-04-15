import React, { useRef, useState, useCallback, useEffect } from 'react'

interface Props {
  onCapture: (base64: string, mimeType: string, dataUrl: string) => void
  onClose: () => void
}

export default function CaptureModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [mode, setMode] = useState<'camera' | 'file'>('camera')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewMime, setPreviewMime] = useState<string>('image/jpeg')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)

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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const mime = file.type || 'image/jpeg'
    setPreviewMime(mime)
    const reader = new FileReader()
    reader.onload = ev => {
      setPreview(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

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
              <div
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border-2 border-dashed border-white/20 hover:border-orange-400/60 transition-colors aspect-[4/3] flex flex-col items-center justify-center cursor-pointer bg-white/5"
              >
                <div className="text-5xl mb-3">📄</div>
                <p className="text-white/60 text-sm">Click to browse</p>
                <p className="text-white/30 text-xs mt-1">JPG, PNG, WebP, HEIC</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
