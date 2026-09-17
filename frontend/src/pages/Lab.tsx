import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { isRumInitialized, rumAction, rumError } from "../observability/rum";
import type { LabResult } from "../types";

// Datadog UI base for trace deep-links (RUM/APM live on the same site).
const APM_TRACE_URL = (traceId: string) => `https://app.datadoghq.com/apm/trace/${traceId}`;

type Kind = "api" | "rum" | "chat" | "vuln";

interface Scenario {
  key: string;
  label: string;
  hint: string;
  kind: Kind;
  scenario: string;
  prompt?: string;
  payload?: string;
  fire?: () => void;
}

interface Group {
  title: string;
  accent: string;
  items: Scenario[];
}

const GROUPS: Group[] = [
  {
    title: "APM",
    accent: "#9b6dff",
    items: [
      { key: "slow", label: "Slow endpoint", hint: "~2s latency → APM", kind: "api", scenario: "slow" },
      { key: "memory", label: "Memory hog", hint: "~512MB ×12s → infra", kind: "api", scenario: "memory" },
      { key: "cpu", label: "CPU burn", hint: "~5s heavy → Profiler", kind: "api", scenario: "cpu" },
    ],
  },
  {
    title: "Database",
    accent: "#4aa8ff",
    items: [
      { key: "slow_query", label: "Slow query", hint: "seq scan ~1M rows → DBM", kind: "api", scenario: "slow_query" },
      { key: "dbm_write", label: "DB write", hint: "write path → DBM", kind: "api", scenario: "dbm_write" },
      { key: "lock_contention", label: "Lock contention", hint: "blocked/blocking → DBM", kind: "api", scenario: "lock_contention" },
    ],
  },
  {
    title: "Metrics",
    accent: "#4fd18b",
    items: [
      { key: "metrics", label: "Custom metric", hint: "→ DogStatsD", kind: "api", scenario: "metrics" },
    ],
  },
  {
    title: "Errors",
    accent: "#ff6b81",
    items: [
      { key: "payment_error", label: "Payment error", hint: "→ Error Tracking", kind: "api", scenario: "payment_error" },
      { key: "error_batch", label: "Error batch ×5", hint: "→ Error Tracking", kind: "api", scenario: "error_batch" },
      { key: "funnel", label: "Funnel exit", hint: "RUM action", kind: "rum", scenario: "lab_funnel_exit", fire: () => rumAction("lab_funnel_exit", { step: "lab" }) },
    ],
  },
  {
    title: "Frontend",
    accent: "#ffb454",
    items: [
      { key: "rum_action", label: "Custom RUM action", hint: "→ RUM", kind: "rum", scenario: "lab_custom_action", fire: () => rumAction("lab_custom_action", { source: "lab" }) },
      { key: "rum_error", label: "RUM frontend error", hint: "→ RUM / Error Tracking", kind: "rum", scenario: "lab_frontend_error", fire: () => rumError(new Error("Lab: synthetic RUM error")) },
    ],
  },
  {
    title: "AI",
    accent: "#c47bff",
    items: [
      { key: "llm_read", label: "Ask the Advisor", hint: "→ LLM Observability", kind: "chat", scenario: "llm_read", prompt: "What's my current balance?" },
      { key: "prompt_injection", label: "Prompt injection", hint: "→ AI Guard", kind: "api", scenario: "prompt_injection" },
    ],
  },
  {
    title: "Security (flag-gated)",
    accent: "#ff8c42",
    items: [
      { key: "sqli", label: "SQL injection", hint: "SAST + IAST → App Sec", kind: "vuln", scenario: "sql_injection", payload: "' OR '1'='1" },
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
      } else if (item.kind === "vuln") {
        try {
          const rows = await api.vulnSearch(item.payload || "");
          const n = Array.isArray(rows) ? rows.length : 0;
          res = {
            scenario: item.scenario,
            configured: true,
            status: `leaked ${n} row${n === 1 ? "" : "s"}`,
            detail: `payload: ${item.payload} → ${JSON.stringify(rows).slice(0, 400)}`,
          };
        } catch (e) {
          const status = (e as { status?: number })?.status;
          res =
            status === 404
              ? { scenario: item.scenario, configured: false, status: "gated (404)", detail: "Endpoint is off — flip the `vuln-lab-enabled` flag ON in Datadog to arm it." }
              : { scenario: item.scenario, configured: false, status: "error", detail: e instanceof Error ? e.message : "failed" };
        }
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
        <div key={group.title} className="lab-group" style={{ "--group-accent": group.accent } as React.CSSProperties}>
          <div className="section-label lab-group-label">{group.title}</div>
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
                <span className="lab-row-go">
                  {busy === item.key ? <span className="lab-spinner" role="status" aria-label="Running" /> : "Run"}
                </span>
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
