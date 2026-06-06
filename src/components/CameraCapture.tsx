import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Loader2 } from "lucide-react";

interface Props {
  onCapture: (dataUrl: string) => void;
  busy?: boolean;
  ctaLabel?: string;
}

export function CameraCapture({ onCapture, busy, ctaLabel = "Capture" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => { /* ignore autoplay race */ });
      }
      setStreaming(true);
    } catch (e: any) {
      setError(e?.message || "Could not access camera");
    }
  }, [stopCamera]);

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Callback ref: every time the <video> element mounts (initial render AND
  // after Retake), re-bind the existing stream so the live feed resumes.
  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      try {
        if (node.srcObject !== streamRef.current) node.srcObject = streamRef.current;
        void node.play().catch(() => { /* ignore */ });
        setStreaming(true);
      } catch { /* ignore */ }
    }
  }, []);

  const snap = () => {
    const v = videoRef.current; const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth, h = v.videoHeight;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.8);
    setPreview(url);
  };

  const confirm = () => { if (preview) onCapture(preview); };
  const retake = () => {
    setPreview(null);
    void startCamera();
  };

  if (error) {
    return (
      <div className="text-sm text-destructive p-4 rounded-lg bg-destructive/10">
        Camera error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-secondary">
        <video ref={setVideoRef} muted playsInline autoPlay className={cnVideo(preview)} />
        {preview && <img src={preview} className="absolute inset-0 w-full h-full object-cover" alt="Captured selfie" />}
        {!streaming && !preview && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <div className="flex gap-2">
        {preview ? (
          <>
            <button
              onClick={retake}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90"
            >
              <RefreshCw className="w-4 h-4" /> Retake
            </button>
            <button
              onClick={confirm}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {ctaLabel}
            </button>
          </>
        ) : (
          <button
            onClick={snap}
            disabled={!streaming || busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" /> Take Selfie
          </button>
        )}
      </div>
    </div>
  );
}
