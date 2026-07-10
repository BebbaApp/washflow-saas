import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Loader2, AlertTriangle, SwitchCamera } from "lucide-react";

interface Props {
  onCapture: (dataUrl: string) => void;
  busy?: boolean;
  ctaLabel?: string;
}

type Facing = "user" | "environment";

function friendlyCameraError(e: any): string {
  const name = e?.name || "";
  const msg = e?.message || String(e);
  if (name === "NotAllowedError" || /permission/i.test(msg) || /denied/i.test(msg)) {
    return "Camera permission was denied. Tap the camera/lock icon in your browser's address bar, allow camera access for this site, then tap Retry.";
  }
  if (name === "NotFoundError" || /not found/i.test(msg)) {
    return "No camera was detected on this device.";
  }
  if (name === "NotReadableError" || /in use/i.test(msg)) {
    return "The camera is being used by another app. Close other camera apps and tap Retry.";
  }
  if (name === "SecurityError" || /secure/i.test(msg) || /https/i.test(msg)) {
    return "Camera requires a secure (HTTPS) connection. Open the app via its https:// URL and try again.";
  }
  if (name === "OverconstrainedError") {
    return "This device's camera doesn't support the requested settings. Try switching camera.";
  }
  return msg || "Could not access camera.";
}

export function CameraCapture({ onCapture, busy, ctaLabel = "Capture" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [starting, setStarting] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  }, []);

  const startCamera = useCallback(async (preferred: Facing = facing) => {
    stopCamera();
    setError(null);
    setStarting(true);

    // Secure-context / API availability check
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera API is not available in this browser. Please use a modern browser over HTTPS.");
      setStarting(false);
      return;
    }
    if (window.isSecureContext === false) {
      setError("Camera requires a secure (HTTPS) connection. Open the app via its https:// URL.");
      setStarting(false);
      return;
    }

    // Try preferred facing, then the opposite, then a generic request
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: preferred }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { facingMode: preferred === "user" ? "environment" : "user" }, audio: false },
      { video: true, audio: false },
    ];

    let lastErr: any = null;
    for (const c of attempts) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(c);
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => { /* ignore autoplay race */ });
        }
        setStreaming(true);
        setStarting(false);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    setError(friendlyCameraError(lastErr));
    setStarting(false);
  }, [facing, stopCamera]);

  useEffect(() => {
    void startCamera(facing);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!w || !h) return;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (facing === "user") {
      ctx.translate(w, 0); ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.8);
    setPreview(url);
  };

  const confirm = () => { if (preview) onCapture(preview); };
  const retake = () => {
    setPreview(null);
    void startCamera(facing);
  };
  const switchCam = () => {
    const next: Facing = facing === "user" ? "environment" : "user";
    setFacing(next);
    void startCamera(next);
  };

  const handleFileCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (result) {
        stopCamera();
        setError(null);
        setPreview(result);
      }
    };
    reader.onerror = () => setError("Could not read the selected photo. Please try again.");
    reader.readAsDataURL(file);
  };

  if (error && !preview) {
    return (
      <div className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture={facing === "user" ? "user" : "environment"}
          className="hidden"
          onChange={handleFileCapture}
        />
        <div className="text-sm text-destructive p-4 rounded-lg bg-destructive/10 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">Camera error</p>
            <p className="text-destructive/90">{error}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void startCamera(facing)}
            disabled={starting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50"
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Retry
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={starting}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90"
          >
            <Camera className="w-4 h-4" /> Open camera
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture={facing === "user" ? "user" : "environment"}
        className="hidden"
        onChange={handleFileCapture}
      />
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-secondary">
        <video
          ref={setVideoRef}
          muted
          playsInline
          autoPlay
          className={`w-full h-full object-cover ${facing === "user" ? "scale-x-[-1]" : ""} ${preview ? "opacity-0" : ""}`}
        />
        {preview && <img src={preview} className="absolute inset-0 w-full h-full object-cover" alt="Captured selfie" />}
        {!streaming && !preview && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
        {!preview && streaming && (
          <button
            type="button"
            onClick={switchCam}
            className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70"
            aria-label="Switch camera"
          >
            <SwitchCamera className="w-4 h-4" />
          </button>
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
