import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DD_INTAKE_URL,
  isLogsInitialized,
  isRumInitialized,
  isRumProfilingEnabled,
  isSessionReplayActive,
} from "../observability/rum";

type State = "ok" | "error" | "off" | "checking";

interface Check {
  id: string;
  label: string;
  state: State;
  detail: string;
}

interface AppMeta {
  service: string;
  env: string;
  version: string;
}

const PILL_TEXT: Record<State, string> = {
  ok: "Operational",
  error: "Error",
  off: "Off",
  checking: "Checking…",
};

const BLOCKED_HINT =
  "Requests to browser-intake-datadoghq.com are being blocked — most likely an ad/tracker blocker " +
  "(uBlock Origin, Brave Shields, AdGuard, Pi-hole) or a corporate network policy. Disable it for this site to capture telemetry.";

// Probe whether the Datadog browser intake is reachable from THIS browser.
// A no-cors request resolves (opaque) on any real response; it throws when the
// request is blocked at the network/extension layer. A timeout counts as blocked.
async function intakeReachable(timeoutMs = 3000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(DD_INTAKE_URL, { method: "GET", mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const CLIENT_INITIAL: Check[] = [
  { id: "rum", label: "RUM", state: "checking", detail: "" },
  { id: "replay", label: "Session Replay", state: "checking", detail: "" },
  { id: "logs", label: "Browser Logs", state: "checking", detail: "" },
  { id: "rum_profiling", label: "RUM Profiling", state: "checking", detail: "" },
  { id: "flags", label: "Feature Flags", state: "checking", detail: "" },
];

function mapServerState(status: string): State {
  return status === "on" ? "ok" : status === "error" ? "error" : "off";
}

export default function Status() {
  const navigate = useNavigate();
  const [client, setClient] = useState<Check[]>(CLIENT_INITIAL);
  const [server, setServer] = useState<Check[]>([]);
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [flags, setFlags] = useState<{ transferLatencyMs: number; transferFailRate: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setClient(CLIENT_INITIAL);
    setServer([]);

    // --- Browser (this session) ---
    const reachable = await intakeReachable();
    const rumInit = isRumInitialized();
    const logsInit = isLogsInitialized();

    const rum: Check = !rumInit
      ? { id: "rum", label: "RUM", state: "off", detail: "RUM SDK is not initialized in this build." }
      : reachable
        ? { id: "rum", label: "RUM", state: "ok", detail: "Initialized and reaching Datadog intake." }
        : { id: "rum", label: "RUM", state: "error", detail: BLOCKED_HINT };

    const replay: Check = !rumInit
      ? { id: "replay", label: "Session Replay", state: "off", detail: "Requires RUM, which is not initialized." }
      : !reachable
        ? { id: "replay", label: "Session Replay", state: "error", detail: BLOCKED_HINT }
        : {
            id: "replay",
            label: "Session Replay",
            state: "ok",
            detail: isSessionReplayActive() ? "Recording this session." : "Enabled (recording once the session is sampled).",
          };

    const logs: Check = !logsInit
      ? { id: "logs", label: "Browser Logs", state: "off", detail: "Browser Logs SDK is not initialized in this build." }
      : reachable
        ? { id: "logs", label: "Browser Logs", state: "ok", detail: "Initialized and reaching Datadog intake." }
        : { id: "logs", label: "Browser Logs", state: "error", detail: BLOCKED_HINT };

    const profiling: Check = isRumProfilingEnabled()
      ? { id: "rum_profiling", label: "RUM Profiling", state: "ok", detail: "Browser profiling is enabled." }
      : { id: "rum_profiling", label: "RUM Profiling", state: "off", detail: "Enable via enableExperimentalFeatures: ['profiling'] + profilingSampleRate." };

    const featureFlags: Check = {
      id: "flags",
      label: "Feature Flags",
      state: "off",
      detail: "OpenFeature provider not wired yet (planned).",
    };

    setClient([rum, replay, logs, profiling, featureFlags]);

    // --- Backend & Agent ---
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      setMeta(data.app ?? null);
      setFlags(data.flags ?? null);
      setServer(
        (data.products ?? []).map((p: { id: string; label: string; status: string; detail: string }) => ({
          id: p.id,
          label: p.label,
          state: mapServerState(p.status),
          detail: p.detail,
        })),
      );
    } catch {
      setServer([{ id: "api", label: "Backend API", state: "error", detail: "Status endpoint is unreachable." }]);
      setMeta(null);
      setFlags(null);
    }

    setBusy(false);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const renderRows = (rows: Check[]) =>
    rows.map((c) => (
      <div key={c.id} className="status-row">
        <div className="status-meta">
          <span className="status-label">{c.label}</span>
          {c.detail ? <span className="status-detail">{c.detail}</span> : null}
        </div>
        <span className={`status-pill ${c.state}`}>{PILL_TEXT[c.state]}</span>
      </div>
    ));

  const flagsText = flags
    ? flags.transferLatencyMs === 0 && flags.transferFailRate === 0
      ? "None active — transfers run clean."
      : `Latency +${flags.transferLatencyMs}ms · fail rate ${Math.round(flags.transferFailRate * 100)}%`
    : null;

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back</button>

      <div className="status-head">
        <h1>Datadog Observability</h1>
        <p className="muted">
          Live runtime status from this browser session and the backend — not build config. If an
          ad/tracker blocker or network policy stops telemetry, it shows here.
        </p>
        {meta ? (
          <p className="status-appmeta muted">
            {meta.service} · {meta.env} · v{meta.version}
          </p>
        ) : null}
      </div>

      <div className="status-sub">Browser (this session)</div>
      <div className="status-list glass">{renderRows(client)}</div>

      <div className="status-sub">Backend &amp; Agent</div>
      <div className="status-list glass">
        {server.length === 0 ? <p className="muted contact-empty">Checking…</p> : renderRows(server)}
      </div>

      {flagsText ? (
        <div className="status-flags glass">
          <span className="status-label">Active demo flags</span>
          <span className="status-detail">{flagsText}</span>
        </div>
      ) : null}

      <button className="btn btn-secondary" onClick={run} disabled={busy}>
        {busy ? "Checking…" : "Re-check"}
      </button>
    </section>
  );
}
