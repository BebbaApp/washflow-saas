import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Loader2 } from "lucide-react";

interface Props {
  onCapture: (dataUrl: string) => void;
  busy?: boolean;
  ctaLabel?: string;
}

export function CameraCapture({ onCapture, busy, ctaLabel = "Capture" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreaming(true);
        }
      } catch (e: any) {
        setError(e?.message || "Could not access camera");
      }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const snap = () => {
    const v = videoRef.current; const c = canvasRef.current;
    if (!v || !c) return;
    const w = v.videoWidth, h = v.videoHeight;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Mirror to feel like a selfie
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.8);
    setPreview(url);
  };

  const confirm = () => { if (preview) onCapture(preview); };
  const retake = () => setPreview(null);

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
        {preview ? (
          <img src={preview} className="w-full h-full object-cover" alt="Captured selfie" />
        ) : (
          <video ref={videoRef} muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
        )}
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
