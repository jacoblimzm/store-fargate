import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { isRumInitialized, rumAction, rumError } from "../observability/rum";
import type { LabResult } from "../types";

// Datadog UI base for trace deep-links (RUM/APM live on the same site).
const APM_TRACE_URL = (traceId: string) => `https://app.datadoghq.com/apm/trace/${traceId}`;

type Kind = "api" | "rum" | "chat";

interface Scenario {
  key: string;
  label: string;
  hint: string;
  kind: Kind;
  scenario: string;
  prompt?: string;
  fire?: () => void;
}

interface Group {
  title: string;
  items: Scenario[];
}

const GROUPS: Group[] = [
  {
    title: "Performance",
    items: [
      { key: "slow", label: "Slow endpoint", hint: "~2s latency → APM", kind: "api", scenario: "slow" },
      { key: "slow_query", label: "Slow query", hint: "APM db span + DBM", kind: "api", scenario: "slow_query" },
      { key: "memory", label: "Memory hog", hint: "~512MB ×12s → infra", kind: "api", scenario: "memory" },
      { key: "cpu", label: "CPU burn", hint: "~5s heavy → Profiler", kind: "api", scenario: "cpu" },
    ],
  },
  {
    title: "Errors",
    items: [
      { key: "payment_error", label: "Payment error", hint: "→ Error Tracking", kind: "api", scenario: "payment_error" },
      { key: "error_batch", label: "Error batch ×5", hint: "→ Error Tracking", kind: "api", scenario: "error_batch" },
      { key: "funnel", label: "Funnel exit", hint: "RUM action", kind: "rum", scenario: "lab_funnel_exit", fire: () => rumAction("lab_funnel_exit", { step: "lab" }) },
    ],
  },
  {
    title: "Data & metrics",
    items: [
      { key: "dbm_write", label: "DB write", hint: "write path → DBM", kind: "api", scenario: "dbm_write" },
      { key: "metrics", label: "Custom metric", hint: "→ DogStatsD", kind: "api", scenario: "metrics" },
    ],
  },
  {
    title: "Frontend",
    items: [
      { key: "rum_action", label: "Custom RUM action", hint: "→ RUM", kind: "rum", scenario: "lab_custom_action", fire: () => rumAction("lab_custom_action", { source: "lab" }) },
      { key: "rum_error", label: "RUM frontend error", hint: "→ RUM / Error Tracking", kind: "rum", scenario: "lab_frontend_error", fire: () => rumError(new Error("Lab: synthetic RUM error")) },
    ],
  },
  {
    title: "AI",
    items: [
      { key: "llm_read", label: "Ask the Advisor", hint: "→ LLM Observability", kind: "chat", scenario: "llm_read", prompt: "What's my current balance?" },
      { key: "prompt_injection", label: "Prompt injection", hint: "→ AI Guard", kind: "api", scenario: "prompt_injection" },
    ],
  },
];

interface LogEntry extends LabResult {
  id: number;
  label: string;
  ts: string;
}

let logId = 1;

export default function Lab() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flashToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const record = (label: string, res: LabResult) => {
    setLog((prev) => [{ ...res, id: logId++, label, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 8));
    flashToast(`${label}: ${res.status}`);
  };

  const run = async (item: Scenario) => {
    setBusy(item.key);
    try {
      let res: LabResult;
      if (item.kind === "api") {
        res = await api.lab(item.scenario);
      } else if (item.kind === "chat") {
        const { reply } = await api.chat(item.prompt || "Hello");
        res = { scenario: item.scenario, configured: true, status: "replied", detail: reply || "(no response)" };
      } else {
        item.fire?.();
        res = {
          scenario: item.scenario,
          configured: isRumInitialized(),
          status: isRumInitialized() ? "emitted" : "off",
          detail: isRumInitialized() ? "Fired a client-side RUM event." : "RUM SDK not initialized.",
        };
      }
      record(item.label, res);
    } catch (err) {
      record(item.label, {
        scenario: item.scenario,
        configured: false,
        status: "error",
        detail: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setBusy(null);
    }
  };

  const pill = (res: LogEntry) => {
    if (res.status === "error" || res.status === "blocked") return "error";
    if (!res.configured || res.status === "skipped" || res.status === "off") return "off";
    return "ok";
  };

  return (
    <section className="view">
      <div className="lab-head">
        <h1>Observability Lab</h1>
        <p className="muted">Fire a Datadog signal on demand, then watch it land in the platform.</p>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title} className="lab-group">
          <div className="section-label">{group.title}</div>
          <div className="lab-rows glass">
            {group.items.map((item) => (
              <button
                key={item.key}
                className="lab-row"
                disabled={busy === item.key}
                onClick={() => run(item)}
              >
                <span className="lab-row-meta">
                  <span className="lab-row-label">{item.label}</span>
                  <span className="lab-row-hint muted">{item.hint}</span>
                </span>
                <span className="lab-row-go" aria-hidden="true">{busy === item.key ? "…" : "Run"}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="section-label">Console</div>
      <div className="lab-console glass">
        {log.length === 0 ? (
          <p className="muted lab-console-empty">Run a scenario to see the response + trace link here.</p>
        ) : (
          log.map((entry) => (
            <div key={entry.id} className="lab-log">
              <div className="lab-log-head">
                <span className={`status-pill ${pill(entry)}`}>{entry.status}</span>
                <span className="lab-log-label">{entry.label}</span>
                <span className="lab-log-ts muted">{entry.ts}</span>
              </div>
              <p className="lab-log-detail">{entry.detail}</p>
              {entry.traceId ? (
                <a className="lab-log-trace" href={APM_TRACE_URL(entry.traceId)} target="_blank" rel="noreferrer">
                  APM trace · {entry.scenario} · Open in Datadog ↗
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>

      {toast ? <div className="lab-toast glass" role="status">{toast}</div> : null}
    </section>
  );
}
