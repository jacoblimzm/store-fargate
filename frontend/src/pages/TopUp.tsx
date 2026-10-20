import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { currency } from "../format";
import { rumAction } from "../observability/rum";
import type { TopUpResult } from "../types";

const QUICK = ["50", "100", "500"];
const SOURCES = ["Debit card", "Linked bank"];

export default function TopUp() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState(SOURCES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<TopUpResult | null>(null);

  const valid = Number(amount) > 0;

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await api.topUp(amount, source);
      rumAction("topup.completed", { amount: Number(amount), source, balance: res.balance });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top up failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <section className="view">
        <div className="receive-hero glass">
          <div className="topup-success-icon" aria-hidden="true">✓</div>
          <div className="section-label">Top up successful</div>
          <div className="topup-success-amount">{currency(done.amount)}</div>
          <p className="muted">New balance {currency(done.balance)}</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/", { replace: true })}>
          Done
        </button>
      </section>
    );
  }

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back</button>
      <h2 className="send-step-title">Top up wallet</h2>

      <div className="amount-box glass">
        <span className="amount-label">Amount</span>
        <div className="amount-entry">
          <span className="amount-currency">$</span>
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
            $ {q}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Top up from</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      {error ? <p className="error">{error}</p> : null}

      <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
        {busy ? "Topping up…" : valid ? `Top up ${currency(Number(amount))}` : "Top up"}
      </button>
    </section>
  );
}
