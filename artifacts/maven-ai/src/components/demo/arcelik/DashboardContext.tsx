import { createContext, useContext, useState, type ReactNode } from "react";
import type { ProductCategory } from "@/data/arcelik-seed";

export type Period = "this-week" | "this-month" | "3-months" | "6-months";
export type MarketplaceFilter = "all" | "n11" | "trendyol" | "hepsiburada";

interface Filters {
  cities: string[];
  categories: ProductCategory[];
  competitors: string[];
  period: Period;
  marketplace: MarketplaceFilter;
}

interface DashboardContextValue {
  filters: Filters;
  update: (f: Partial<Filters>) => void;
}

const Ctx = createContext<DashboardContextValue>(null!);

export const useDashboardFilters = () => useContext(Ctx);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [filters, set] = useState<Filters>({
    cities: [],
    categories: [],
    competitors: [],
    period: "this-month",
    marketplace: "all",
  });

  return (
    <Ctx.Provider value={{ filters, update: (p) => set((prev) => ({ ...prev, ...p })) }}>
      {children}
    </Ctx.Provider>
  );
}
