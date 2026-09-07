import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Contact } from "../../types";

interface SendFlow {
  recipient: Contact | null;
  amount: string;
  note: string;
  setRecipient: (c: Contact) => void;
  setAmount: (a: string) => void;
  setNote: (n: string) => void;
  reset: () => void;
}

const SendFlowCtx = createContext<SendFlow | undefined>(undefined);

export function useSendFlow(): SendFlow {
  const ctx = useContext(SendFlowCtx);
  if (!ctx) throw new Error("useSendFlow must be used within SendLayout");
  return ctx;
}

const STEPS = ["Recipient", "Amount", "Confirm"];

function Stepper({ current }: { current: number }) {
  return (
    <div className="send-stepper">
      {STEPS.map((label, i) => (
        <div key={label} className="send-step">
          {i > 0 ? <span className={`send-step-line${i <= current ? " on" : ""}`} /> : null}
          <span className={`send-step-dot${i < current ? " done" : i === current ? " active" : ""}`} />
          <span className={`send-step-label${i === current ? " active" : ""}`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function SendLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [recipient, setRecipientState] = useState<Contact | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const current = pathname.endsWith("/amount") ? 1 : pathname.endsWith("/confirm") ? 2 : 0;

  const value: SendFlow = {
    recipient,
    amount,
    note,
    setRecipient: setRecipientState,
    setAmount,
    setNote,
    reset: () => {
      setRecipientState(null);
      setAmount("");
      setNote("");
    },
  };

  return (
    <section className="view">
      <div className="send-head">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}>‹</button>
        <span className="send-title">Send Money</span>
        <button className="icon-btn" aria-label="Close" onClick={() => navigate("/")}>✕</button>
      </div>
      <Stepper current={current} />
      <SendFlowCtx.Provider value={value}>{children ?? <Outlet />}</SendFlowCtx.Provider>
    </section>
  );
}
