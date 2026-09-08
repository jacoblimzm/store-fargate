import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api/client";
import QrScannerModal from "../components/QrScanner";
import type { MyQr } from "../types";

export default function Receive() {
  const navigate = useNavigate();
  const [qr, setQr] = useState<MyQr | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.myQr().then(setQr).catch(() => setQr(null));
  }, []);

  const onScanned = async (text: string) => {
    setScanning(false);
    setError("");
    try {
      await api.scanContact(text);
      navigate("/contacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that code");
    }
  };

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back</button>

      <div className="receive-hero glass">
        <div className="section-label">Receive money</div>
        {qr ? (
          <>
            <div className="qr-frame qr-frame-lg">
              <QRCodeSVG
                value={qr.payload}
                size={220}
                bgColor="#ffffff"
                fgColor="#0b0b12"
                level="M"
                marginSize={4}
              />
            </div>
            <div className="qr-handle">@{qr.handle}</div>
            <p className="muted qr-hint">Have someone scan this to add you and send you cash instantly.</p>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <button className="btn btn-primary" onClick={() => { setError(""); setScanning(true); }}>
        Scan QR Code
      </button>
      <button className="btn btn-secondary" onClick={() => navigate("/contacts")}>
        View contacts
      </button>

      {scanning ? <QrScannerModal onResult={onScanned} onClose={() => setScanning(false)} /> : null}
    </section>
  );
}
