import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Spark } from "./ui/Spark";
import { ServiceIcon } from "./ui/ServiceIcon";

interface Msg {
  id: number;
  text: string;
  kind: "user" | "bot";
  pending?: boolean;
  error?: boolean;
  image?: string;
  audio?: string;
}

const SUGGESTIONS = [
  "What's my current balance?",
  "Where did I spend the most recently?",
  "How do I send money to a contact?",
];

let nextId = 1;

const MAX_RECORD_MS = 60_000; // auto-stop long recordings
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

// Encode mono Float32 PCM as a 16-bit WAV blob.
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  let o = 0;
  writeString(o, "RIFF"); o += 4;
  view.setUint32(o, 36 + samples.length * 2, true); o += 4;
  writeString(o, "WAVE"); o += 4;
  writeString(o, "fmt "); o += 4;
  view.setUint32(o, 16, true); o += 4; // PCM chunk size
  view.setUint16(o, 1, true); o += 2; // PCM format
  view.setUint16(o, 1, true); o += 2; // mono
  view.setUint32(o, sampleRate, true); o += 4;
  view.setUint32(o, sampleRate * 2, true); o += 4; // byte rate
  view.setUint16(o, 2, true); o += 2; // block align
  view.setUint16(o, 16, true); o += 2; // bits/sample
  writeString(o, "data"); o += 4;
  view.setUint32(o, samples.length * 2, true); o += 4;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

// Decode any browser audio blob (webm/opus recording, mp3/m4a/wav upload) and
// re-encode to 16kHz mono WAV — the format OpenAI's input_audio accepts.
async function blobToWavDataUrl(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(arrayBuf);
  ctx.close();
  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return blobToDataUrl(encodeWav(rendered.getChannelData(0), targetRate));
}

export default function Advisor() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);
  const [attachErr, setAttachErr] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const attachWrapRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

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
    if (!trimmed && !image && !audio) return; // text, image, and/or audio in one send
    const img = image;
    const aud = audio;
    setText("");
    setImage(null);
    setAudio(null);
    setAttachErr("");
    const userMsg: Msg = {
      id: nextId++,
      text: trimmed,
      kind: "user",
      image: img || undefined,
      audio: aud || undefined,
    };
    const pendingMsg: Msg = { id: nextId++, text: "Thinking…", kind: "bot", pending: true };
    setMessages((m) => [...m, userMsg, pendingMsg]);
    try {
      const { reply } = await api.chat(trimmed, img || undefined, aud || undefined);
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

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      setAttachErr("Use PNG, JPEG, WEBP, or GIF.");
      return;
    }
    if (file.size > 3.5 * 1024 * 1024) {
      setAttachErr("Image too large (max 3.5MB).");
      return;
    }
    setAttachErr("");
    setAudio(null); // one attachment at a time
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const onPickAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setAttachErr("That's not an audio file.");
      return;
    }
    setAttachErr("");
    try {
      const dataUrl = await blobToWavDataUrl(file);
      if (Math.ceil((dataUrl.length * 3) / 4) > MAX_AUDIO_BYTES) {
        setAttachErr("Audio too long (keep it under ~60s).");
        return;
      }
      setImage(null);
      setAudio(dataUrl);
    } catch {
      setAttachErr("Couldn't read that audio file.");
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    if (recTimerRef.current) {
      window.clearTimeout(recTimerRef.current);
      recTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    setAttachErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAttachErr("Recording isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) return;
        try {
          const dataUrl = await blobToWavDataUrl(blob);
          if (Math.ceil((dataUrl.length * 3) / 4) > MAX_AUDIO_BYTES) {
            setAttachErr("Recording too long (max ~60s).");
            return;
          }
          setImage(null);
          setAudio(dataUrl);
        } catch {
          setAttachErr("Couldn't process the recording.");
        }
      };
      rec.start();
      setRecording(true);
      recTimerRef.current = window.setTimeout(stopRecording, MAX_RECORD_MS);
    } catch {
      setAttachErr("Microphone access was denied.");
    }
  };

  // Close the attachment menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (attachWrapRef.current && !attachWrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
              {m.image ? <img className="advisor-msg-img" src={m.image} alt="attachment" /> : null}
              {m.audio ? <audio className="advisor-msg-audio" src={m.audio} controls /> : null}
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

        {image ? (
          <div className="advisor-attach-preview">
            <img src={image} alt="attachment preview" />
            <button type="button" aria-label="Remove image" onClick={() => setImage(null)}>×</button>
          </div>
        ) : null}
        {audio ? (
          <div className="advisor-attach-preview audio">
            <audio src={audio} controls />
            <button type="button" aria-label="Remove audio" onClick={() => setAudio(null)}>×</button>
          </div>
        ) : null}
        {recording ? (
          <div className="advisor-recording">
            <span className="advisor-rec-dot" aria-hidden="true" />
            <span>Recording…</span>
            <button type="button" className="advisor-rec-stop" onClick={stopRecording}>Stop</button>
          </div>
        ) : null}
        {attachErr ? <p className="advisor-attach-error">{attachErr}</p> : null}

        <form
          className="advisor-input"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <div className="advisor-attach-wrap" ref={attachWrapRef}>
            <button
              type="button"
              className="advisor-attach"
              aria-label="Add attachment"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Add an attachment"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {/* paperclip */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />
              </svg>
            </button>
            {menuOpen ? (
              <div className="advisor-attach-menu glass" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2.5" />
                    <circle cx="8.5" cy="9.5" r="1.8" />
                    <path d="M21 16l-5-4-9 7" />
                  </svg>
                  <span>Photo</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    if (recording) stopRecording();
                    else startRecording();
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                  <span>Record voice</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    audioFileRef.current?.click();
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <span>Audio file</span>
                </button>
              </div>
            ) : null}
          </div>
          <input
            type="text"
            placeholder="Ask Advisor"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            className="advisor-send"
            aria-label="Send message"
            disabled={!text.trim() && !image && !audio}
          >
            <ServiceIcon name="send" size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={onPickImage}
          />
          <input
            ref={audioFileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={onPickAudio}
          />
        </form>
        <p className="advisor-disclaimer">Advisor can make mistakes.</p>
      </section>
    </div>
  );
}
