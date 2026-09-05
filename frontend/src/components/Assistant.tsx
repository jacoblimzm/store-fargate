import { useRef, useState } from "react";
import { api } from "../api/client";

interface Msg {
  id: number;
  text: string;
  kind: "user" | "bot";
  pending?: boolean;
  error?: boolean;
}

let nextId = 1;

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { id: 0, text: "Hi! I'm your DCash assistant. How can I help?", kind: "bot" },
  ]);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    const userMsg: Msg = { id: nextId++, text: value, kind: "user" };
    const pendingMsg: Msg = { id: nextId++, text: "Thinking…", kind: "bot", pending: true };
    setMessages((m) => [...m, userMsg, pendingMsg]);
    scrollToEnd();
    try {
      const { reply } = await api.chat(value);
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, text: reply || "(no response)", pending: false } : msg)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, text: message, pending: false, error: true } : msg)),
      );
    }
    scrollToEnd();
  };

  if (!open) {
    return (
      <button className="chat-fab" aria-label="Open assistant" onClick={() => setOpen(true)}>
        <span aria-hidden="true">✨</span>
      </button>
    );
  }

  return (
    <section className="chat-panel" aria-live="polite">
      <header className="chat-header">
        <span className="chat-title"><span className="brand-mark">◆</span> Assistant</span>
        <button className="btn btn-ghost chat-close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
      </header>
      <div className="chat-log" ref={logRef}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.kind}${m.pending ? " pending" : ""}${m.error ? " error" : ""}`}>
            {m.text}
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          type="text"
          placeholder="Ask about your accounts…"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary chat-send">Send</button>
      </form>
    </section>
  );
}
