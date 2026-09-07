import { Navigate, useNavigate } from "react-router-dom";
import { useSendFlow } from "./SendLayout";

const QUICK = ["100", "500", "1000"];

export default function SendAmount() {
  const navigate = useNavigate();
  const { recipient, amount, note, setAmount, setNote } = useSendFlow();

  // Guarded entry: no recipient chosen -> back to step 1.
  if (!recipient) return <Navigate to="/send/recipient" replace />;

  const valid = Number(amount) > 0;

  return (
    <div className="send-body">
      <h2 className="send-step-title">Transfer details</h2>
      <p className="muted">To @{recipient.handle} · {recipient.name}</p>

      <div className="amount-box glass">
        <span className="amount-label">Amount</span>
        <div className="amount-entry">
          <span className="amount-currency">₱</span>
          <input
            className="amount-input"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            autoFocus
          />
        </div>
      </div>

      <div className="amount-quick">
        {QUICK.map((q) => (
          <button key={q} className={`chip${amount === q ? " active" : ""}`} onClick={() => setAmount(q)}>
            ₱ {q}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Note (optional)</span>
        <input type="text" placeholder="What's it for?" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <button className="btn btn-primary" disabled={!valid} onClick={() => navigate("/send/confirm")}>
        Review
      </button>
    </div>
  );
}
