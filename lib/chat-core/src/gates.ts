/**
 * Pure decision gates shared by both chat clients. Extracted from the
 * web CLI hook (Tasks #24/#500) so mobile inherits identical semantics.
 */

/**
 * Confirm-gate decision at click time:
 *   - "noop_in_flight": a confirm is already streaming — the click is a
 *     duplicate and must be ignored (never abort the in-flight confirm).
 *   - "wait_for_turn_id": the server turn id hasn't landed yet — defer
 *     the confirm until it does (with explicit feedback on timeout)
 *     instead of silently returning.
 *   - "start": proceed with the confirm request.
 */
export function confirmGate(args: {
  confirming: boolean;
  serverTurnId: string | null | undefined;
}): "noop_in_flight" | "wait_for_turn_id" | "start" {
  if (args.confirming) return "noop_in_flight";
  if (!args.serverTurnId) return "wait_for_turn_id";
  return "start";
}

/**
 * Abort → status mapping. An AbortError on the SSE stream only means
 * "Cancelled" when the user explicitly asked to cancel. Supersede
 * aborts (a newer submit taking the slot) and duplicate-confirm aborts
 * must be dropped silently — publishing "cancelled" for those was a
 * client-side hallucination while the server write might still be
 * committing.
 */
export function abortOutcome(args: {
  isActiveTurn: boolean;
  userCancelRequested: boolean;
}): "publish_cancelled" | "drop" {
  if (!args.isActiveTurn) return "drop";
  return args.userCancelRequested ? "publish_cancelled" : "drop";
}

/**
 * Stream-consumer navigation gate. Fires `onNavigate` exactly once per
 * unique destination per turn, and skips entirely when the stream is
 * no longer active so a stale turn cannot yank the user around after a
 * newer submit().
 */
export function tryFireNavigation(args: {
  prevNavPath: string | null;
  navigateTo: { path: string; when: "on_propose" | "on_commit" } | null | undefined;
  isActive: () => boolean;
  onNavigate?: (path: string, when: "on_propose" | "on_commit") => void;
}): { navigatedTo: string | null; fired: boolean } {
  const { prevNavPath, navigateTo, isActive, onNavigate } = args;
  if (!isActive() || !navigateTo) {
    return { navigatedTo: prevNavPath, fired: false };
  }
  if (navigateTo.path === prevNavPath) {
    return { navigatedTo: prevNavPath, fired: false };
  }
  try {
    onNavigate?.(navigateTo.path, navigateTo.when);
  } catch {
    /* swallow — navigation must never break the stream */
  }
  return { navigatedTo: navigateTo.path, fired: true };
}

/** Device IANA timezone sent with each turn so the server interprets
 * typed times ("move my 7am") the way the user sees them. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
