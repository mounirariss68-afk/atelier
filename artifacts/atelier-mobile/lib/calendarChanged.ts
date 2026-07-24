// Task #629 — lightweight changed-since polling for the server-side
// calendar cache. GET /me/calendar/changed returns the timestamp of the
// last calendar mutation the server saw (webhook, delta sync, or a local
// write-through). We poll that cheap endpoint and invalidate every cached
// GET /me/calendar query when it moves, so the Meetings tab and the
// reminder companion re-fetch within a minute of an Outlook-side change
// instead of waiting for the 15-minute refetch interval.
//
// The route is intentionally NOT in the OpenAPI spec (raw fetch, same as
// the internal-meeting lifecycle routes).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { apiJson } from "@/lib/api";

const POLL_MS = 60_000;

/** Matches every cached GET /me/calendar query regardless of window. */
function isCalendarQueryKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && key[0] === "/api/atelier/me/calendar";
}

/**
 * Poll the changed-since signal while `enabled`; invalidate all calendar
 * queries when the server-side changedAt moves. Pauses while the app is
 * backgrounded and re-checks immediately on foreground.
 */
export function useCalendarChangedPoll(enabled: boolean) {
  const queryClient = useQueryClient();
  const lastSeen = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const check = async () => {
      if (!alive || inFlight.current) return;
      if (AppState.currentState !== "active") return;
      inFlight.current = true;
      try {
        const res = await apiJson<{ changedAt: string | null }>(
          "/api/atelier/me/calendar/changed",
        );
        if (!alive) return;
        const next = res.changedAt ?? null;
        if (lastSeen.current !== null && next !== null && next !== lastSeen.current) {
          queryClient.invalidateQueries({
            predicate: (q) => isCalendarQueryKey(q.queryKey),
          });
        }
        if (next !== null || lastSeen.current === null) lastSeen.current = next;
      } catch {
        // Transient network/API failure — try again on the next tick.
      } finally {
        inFlight.current = false;
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, queryClient]);
}
