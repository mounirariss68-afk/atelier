import * as React from "react";

/**
 * Task #1082 — ledger drill-through deep-links.
 *
 * Reads a row id from the page's query string (e.g. `?txn=<id>` on
 * /wallet/cash, `?focus=<id>` on the payables pages) so the page can
 * scroll to and highlight the exact row a GL journal/exception linked to.
 *
 * Returns the target id (read once on mount) plus a `missing` flag the
 * page sets via `reportMissing()` once its data has loaded and the target
 * genuinely isn't there (deleted / out of scope) — shown as a dismissible
 * notice instead of silently landing on an unfocused list.
 */
/** Pure param pick (first present name wins) — exported for tests. */
export function pickFocusParam(search: string, paramNames: string[]): string | null {
  const p = new URLSearchParams(search);
  for (const name of paramNames) {
    const v = p.get(name);
    if (v) return v;
  }
  return null;
}

export function useDeepLinkFocus(...paramNames: string[]): {
  focusId: string | null;
  missing: boolean;
  reportMissing: () => void;
  dismissMissing: () => void;
} {
  const focusId = React.useMemo(
    () => pickFocusParam(window.location.search, paramNames),
    // Read once on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [missing, setMissing] = React.useState(false);
  const reported = React.useRef(false);
  const reportMissing = React.useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    setMissing(true);
  }, []);
  const dismissMissing = React.useCallback(() => setMissing(false), []);
  return { focusId, missing, reportMissing, dismissMissing };
}

/** Class string for a highlighted (deep-linked) row/card. */
/** Pure focus-outcome decision shared by list pages — exported for tests.
 *  Returns what a list page should do once its data request has settled:
 *  "scroll" when the focused row is present, "missing" when the target is
 *  absent (INCLUDING an empty list), and null while not loaded / no focus. */
export function focusOutcome(
  loaded: boolean,
  ids: readonly string[],
  focusId: string | null,
): "scroll" | "missing" | null {
  if (!focusId || !loaded) return null;
  return ids.includes(focusId) ? "scroll" : "missing";
}

export const deepLinkFocusClass =
  "ring-2 ring-gold/70 ring-offset-1 ring-offset-bg rounded";

/** Scroll a deep-linked element into view once it exists. */
export function scrollFocusIntoView(el: HTMLElement | null): void {
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}
