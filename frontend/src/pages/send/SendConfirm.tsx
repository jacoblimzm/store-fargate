import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { currency } from "../../format";
import { useSendFlow } from "./SendLayout";

export default function SendConfirm() {
  const navigate = useNavigate();
  const { recipient, amount, note } = useSendFlow();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Guarded entry: need a recipient and a valid amount.
  if (!recipient || !(Number(amount) > 0)) return <Navigate to="/send/recipient" replace />;

  const amt = Number(amount);

  const confirm = async () => {
    if (!recipient.handle) return;
    setError("");
    setBusy(true);
    try {
      await api.transfer(recipient.handle, amount, note || undefined);
      // Leaving /send unmounts SendLayout, so the flow state is discarded — no
      // explicit reset needed (resetting here would trip the step guard first).
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="send-body">
      <h2 className="send-step-title">Confirm payment</h2>
      <div className="summary glass">
        <div className="summary-row"><span>To</span><span>{recipient.name} · @{recipient.handle}</span></div>
        <div className="summary-row"><span>Note</span><span>{note || "—"}</span></div>
        <div className="summary-row"><span>Amount</span><span>{currency(amt)}</span></div>
        <div className="summary-row"><span>Fee</span><span>{currency(0)}</span></div>
        <div className="summary-sep" />
        <div className="summary-row total"><span>Total</span><span>{currency(amt)}</span></div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn btn-primary" disabled={busy} onClick={confirm}>
        {busy ? "Sending…" : `Send ${currency(amt)}`}
      </button>
    </div>
  );
}
