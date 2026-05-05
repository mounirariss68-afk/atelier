import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PayrollRole } from "@/data/tasama-seed";

export type Period = "this-week" | "this-month" | "3-months" | "6-months";

export interface ManagerFilters {
  period: Period;
  clientId: "all" | string;
  role: "all" | PayrollRole;
}

interface ContextValue {
  filters: ManagerFilters;
  update: (patch: Partial<ManagerFilters>) => void;
  reset: () => void;
}

const DEFAULT: ManagerFilters = {
  period: "this-month",
  clientId: "all",
  role: "all",
};

const Ctx = createContext<ContextValue>({
  filters: DEFAULT,
  update: () => {},
  reset: () => {},
});

export function TasamaDashboardProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<ManagerFilters>(DEFAULT);
  const update = useCallback((patch: Partial<ManagerFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);
  const reset = useCallback(() => setFilters(DEFAULT), []);
  const value = useMemo(() => ({ filters, update, reset }), [filters, update, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useManagerFilters() {
  return useContext(Ctx);
}
