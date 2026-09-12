// Datadog RUM + browser Logs, initialised from the npm SDKs (replaces the old
// CDN snippet). applicationId/clientToken are public client-side identifiers,
// so they are safe to ship in the bundle. The fuller observability module
// (Profiling, duration vitals, journey actions) is layered on in a later phase.
import { datadogRum } from "@datadog/browser-rum";
import { datadogLogs } from "@datadog/browser-logs";
import type { User } from "../types";

const APPLICATION_ID = "0825fc8e-71d5-4b31-ab30-9f410a1d725e";
const CLIENT_TOKEN = "pubb5dbe291b1849d5594315a0b66022b55";
const SERVICE = "pay2play-frontend";
const SITE = "datadoghq.com";
const VERSION = import.meta.env.VITE_APP_VERSION || "0.1.0";

export function initObservability(): void {
  datadogRum.init({
    applicationId: APPLICATION_ID,
    clientToken: CLIENT_TOKEN,
    site: SITE,
    service: SERVICE,
    env: "production",
    version: VERSION,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: "allow",
    // Same-origin /api/* calls get APM trace headers injected so RUM sessions
    // link end-to-end to backend traces.
    allowedTracingUrls: [
      { match: window.location.origin, propagatorTypes: ["datadog", "tracecontext"] },
    ],
  });
  datadogRum.startSessionReplayRecording();

  datadogLogs.init({
    clientToken: CLIENT_TOKEN,
    site: SITE,
    service: SERVICE,
    env: "production",
    version: VERSION,
    sessionSampleRate: 100,
    forwardErrorsToLogs: true,
  });
}

export function setRumUser(user: User): void {
  datadogRum.setUser({
    id: String(user.id),
    name: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
  });
}

export function clearRumUser(): void {
  datadogRum.clearUser();
}

// Start a named RUM view on client-side navigation so each route is a distinct
// view — this is what feeds Journey Monitoring funnels.
export function startRumView(name: string): void {
  datadogRum.startView({ name });
}

// --- Runtime status helpers (used by the Datadog Status page) -------------
// These reflect the *live* state in this browser session, not build config.
export const DD_SITE = SITE;

// The browser intake host telemetry is delivered to; ad/tracker blockers and
// restrictive networks commonly block this domain.
export const DD_INTAKE_URL = `https://browser-intake-${SITE}/`;

export function isRumInitialized(): boolean {
  try {
    return !!datadogRum.getInitConfiguration();
  } catch {
    return false;
  }
}

export function isLogsInitialized(): boolean {
  try {
    return !!datadogLogs.getInitConfiguration();
  } catch {
    return false;
  }
}

export function isSessionReplayActive(): boolean {
  try {
    // Returns a deep link once replay is recording for the current session.
    return !!datadogRum.getSessionReplayLink?.();
  } catch {
    return false;
  }
}

// Fire a custom RUM action / error from the Observability Lab.
export function rumAction(name: string, context?: Record<string, unknown>): void {
  try {
    datadogRum.addAction(name, context);
  } catch {
    /* no-op if RUM not initialized */
  }
}

export function rumError(error: Error, context?: Record<string, unknown>): void {
  try {
    datadogRum.addError(error, context);
  } catch {
    /* no-op if RUM not initialized */
  }
}

export function isRumProfilingEnabled(): boolean {
  try {
    const cfg = datadogRum.getInitConfiguration() as { enableExperimentalFeatures?: string[] } | undefined;
    return !!cfg?.enableExperimentalFeatures?.includes("profiling");
  } catch {
    return false;
  }
}
