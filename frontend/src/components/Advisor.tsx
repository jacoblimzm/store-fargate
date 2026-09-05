import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Spark } from "./ui/Spark";

interface Msg {
  id: number;
  text: string;
  kind: "user" | "bot";
  pending?: boolean;
  error?: boolean;
}

const SUGGESTIONS = [
  "What's my current balance?",
  "Where did I spend the most recently?",
  "How do I send money to a contact?",
];

let nextId = 1;

export default function Advisor() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  };

  useEffect(() => {
    if (open) scrollToEnd();
  }, [open, messages]);

  const ask = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setText("");
    const userMsg: Msg = { id: nextId++, text: trimmed, kind: "user" };
    const pendingMsg: Msg = { id: nextId++, text: "Thinking…", kind: "bot", pending: true };
    setMessages((m) => [...m, userMsg, pendingMsg]);
    try {
      const { reply } = await api.chat(trimmed);
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, text: reply || "(no response)", pending: false } : msg)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, text: message, pending: false, error: true } : msg)),
      );
    }
  };

  if (!open) {
    return (
      <button className="advisor-fab" aria-label="Open Advisor" onClick={() => setOpen(true)}>
        <Spark size={24} />
      </button>
    );
  }

  const showSuggestions = messages.length === 0;

  return (
    <div className="advisor-overlay" role="dialog" aria-modal="true" aria-label="Advisor">
      <div className="advisor-backdrop" onClick={() => setOpen(false)} />
      <section className="advisor-panel glass">
        <header className="advisor-header">
          <button className="advisor-icon-btn" aria-label="Close Advisor" onClick={() => setOpen(false)}>✕</button>
          <span className="advisor-title">Advisor</span>
          <button
            className="advisor-icon-btn"
            aria-label="New chat"
            onClick={() => setMessages([])}
            title="New chat"
          >
            ＋
          </button>
        </header>

        <div className="advisor-log" ref={logRef}>
          <div className="advisor-intro">
            <span className="advisor-intro-label"><Spark size={16} /> Advisor</span>
            <p className="advisor-intro-text">Hey! What's on your mind?</p>
          </div>

          {messages.map((m) => (
            <div key={m.id} className={`advisor-msg ${m.kind}${m.pending ? " pending" : ""}${m.error ? " error" : ""}`}>
              {m.text}
            </div>
          ))}

          {showSuggestions ? (
            <div className="advisor-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="advisor-suggestion glass" onClick={() => ask(s)}>
                  <span>{s}</span>
                  <span className="advisor-suggestion-send" aria-hidden="true">↑</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <form
          className="advisor-input"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <span className="advisor-input-spark" aria-hidden="true"><Spark size={16} /></span>
          <input
            type="text"
            placeholder="Ask Advisor"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </form>
        <p className="advisor-disclaimer">Advisor can make mistakes.</p>
      </section>
    </div>
  );
}
