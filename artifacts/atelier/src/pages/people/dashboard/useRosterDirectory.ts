import * as React from "react";

export interface RosterDirectoryRow {
  id: string;
  fullName: string;
  workerType: "employee" | "contractor" | "partner_firm_resource";
  seniority: string | null;
  country: string | null;
  status: string;
  /** ISO date the person started — used for tenure-band aggregation. */
  startDate: string | null;
  /** Self-identified gender from the roster (PersonWire). May be
   *  "unspecified" when not captured. */
  gender: string | null;
}

interface State {
  rows: RosterDirectoryRow[] | null;
  error: string | null;
}

/**
 * Hook wrapper around the existing /api/atelier/roster/people endpoint.
 * Returns the live people directory used by RosterPeople.tsx so the
 * dashboard can derive headcount composition (location, seniority)
 * from real per-person records instead of role-template proxies.
 */
export function useRosterDirectory(): State {
  const [state, setState] = React.useState<State>({ rows: null, error: null });
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/atelier/roster/people`, { credentials: "include" })
      .then(async (r) => {
        // Fail loud on non-OK responses (401/403/500) — a JSON error body
        // parsed as `{}` used to silently render as headcount 0.
        if (!r.ok) throw new Error(`roster directory HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setState({ rows: d.people ?? [], error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ rows: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
