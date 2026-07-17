import * as React from "react";

export interface EmployeeOption {
  id: string;
  fullName: string;
}

/**
 * Employee picker options for the HR performance forms — reads the live
 * roster directory (employees only; reviews & goals are employee-only).
 */
export function useEmployeeOptions(): { options: EmployeeOption[]; loading: boolean } {
  const [options, setOptions] = React.useState<EmployeeOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/atelier/roster/people`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const people = Array.isArray(d.people) ? d.people : [];
        setOptions(
          people
            .filter((p: { workerType?: string }) => p.workerType === "employee")
            .map((p: { id: string; fullName: string }) => ({ id: p.id, fullName: p.fullName })),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { options, loading };
}
