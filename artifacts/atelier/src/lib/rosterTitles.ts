import * as React from "react";

// Task #509 (T4) — shared client for the titles-definition registry.
// Roster endpoints are raw fetch (not openapi codegen).

export interface RosterTitle {
  id: string;
  title: string;
  seniority: string;
  rank: number;
  workerTypes: Array<"employee" | "contractor" | "partner_firm_resource">;
  status: "active" | "deprecated";
  notes: string | null;
}

/** Legacy fallback list used when the titles registry is empty (no seeding). */
export const FALLBACK_SENIORITIES = [
  "analyst",
  "consultant",
  "senior_consultant",
  "manager",
  "principal",
  "partner",
];

export async function fetchRosterTitles(includeDeprecated = false): Promise<RosterTitle[]> {
  const qs = includeDeprecated ? "?status=all" : "";
  const r = await fetch(`/api/atelier/roster/titles${qs}`, { credentials: "include" });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.titles ?? []) as RosterTitle[];
}

/** Hook returning the active titles registry (rank-desc as served). */
export function useRosterTitles(includeDeprecated = false): {
  titles: RosterTitle[];
  loading: boolean;
  reload: () => void;
} {
  const [titles, setTitles] = React.useState<RosterTitle[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchRosterTitles(includeDeprecated)
      .then((rows) => alive && setTitles(rows))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [includeDeprecated, nonce]);

  return { titles, loading, reload: () => setNonce((n) => n + 1) };
}
