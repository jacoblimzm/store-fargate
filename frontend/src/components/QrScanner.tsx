import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

interface Props {
  // Called with the decoded QR text (e.g. "dcash:@odysseus").
  onResult: (text: string) => void;
  onClose: () => void;
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name || "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was blocked. Allow camera access in your browser, or upload a photo instead.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found. Upload a photo of the QR instead.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and try again.";
    default:
      return "Couldn't start the camera. Upload a photo of the QR instead.";
  }
}

export default function QrScannerModal({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const handledRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState("");

  // Fire the result exactly once, then let the parent close us.
  const deliver = (text: string) => {
    if (handledRef.current || !text) return;
    handledRef.current = true;
    onResult(text);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    const scanner = new QrScanner(video, (res) => deliver(res.data), {
      preferredCamera: "environment",
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
      maxScansPerSecond: 5,
    });

    QrScanner.hasCamera()
      .then((hasCamera) => {
        if (cancelled) return;
        if (!hasCamera) {
          setStarting(false);
          setError("No camera found. Upload a photo of the QR instead.");
          return;
        }
        return scanner.start().then(() => {
          if (!cancelled) setStarting(false);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setStarting(false);
        setError(cameraErrorMessage(err));
      });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const res = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
      deliver(res.data);
    } catch {
      setError("Couldn't find a QR code in that image. Try another photo.");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Scan QR Code">
      <div className="scanner-card glass">
        <div className="scanner-head">
          <span className="scanner-title">Scan QR Code</span>
          <button type="button" className="scanner-close" onClick={onClose} aria-label="Close scanner">
            &times;
          </button>
        </div>

        <div className="scanner-stage">
          <video ref={videoRef} className="scanner-video" muted playsInline />
          <div className="scanner-reticle" aria-hidden="true" />
          {starting && !error ? <div className="scanner-status muted">Starting camera…</div> : null}
        </div>

        {error ? (
          <p className="error scanner-msg">{error}</p>
        ) : (
          <p className="scanner-msg muted">Point at someone's DCash QR to add &amp; pay them.</p>
        )}

        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          Upload a photo instead
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
    </div>
  );
}
