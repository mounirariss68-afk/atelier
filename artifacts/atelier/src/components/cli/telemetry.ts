/**
 * Task #342 — Atelier CLI assistant-discoverability telemetry.
 *
 * Emits a `cli.opened` event with a `source` field so we can measure
 * which launchers actually convert. There is no first-class telemetry
 * pipeline in this app yet, so we do two things:
 *
 *   1. console.info — picked up by any log-aggregator wired to the
 *      browser console (e.g. the Replit dev console + e2e captures).
 *   2. fire-and-forget POST to `/api/atelier/cli/events` — server-side
 *      sink that records the event into the structured request log.
 *
 * Both sinks accept the exact same payload so a future analytics
 * destination can ingest either side without a schema change.
 */

export type CliOpenedSource =
  | "header"
  | "shortcut"
  | "home_input"
  | "home_chip"
  | "floating_bubble"
  | "slash_command"
  | "deep_link"
  | "empty_state_chip"
  | "first_run_tooltip";

export interface CliOpenedEvent {
  event: "cli.opened";
  source: CliOpenedSource;
  prompt?: string | null;
  surface?: string | null;
  ts: number;
}

export function emitCliOpened(
  source: CliOpenedSource,
  extras: { prompt?: string | null; surface?: string | null } = {},
): void {
  const payload: CliOpenedEvent = {
    event: "cli.opened",
    source,
    prompt: extras.prompt ?? null,
    surface: extras.surface ?? null,
    // Field is `ts` (not `at`) so the server route's logged shape and
    // the client payload match. Server reads `body.ts` in cliRoutes.ts.
    ts: Date.now(),
  };
  try {
    // eslint-disable-next-line no-console
    console.info("[telemetry] cli.opened", payload);
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/atelier/cli/events", blob);
    } else {
      void fetch("/api/atelier/cli/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* swallow — telemetry is best-effort */
      });
    }
  } catch {
    /* ignore */
  }
}
