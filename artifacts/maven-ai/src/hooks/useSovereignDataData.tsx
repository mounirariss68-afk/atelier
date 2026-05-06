import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { DATA_PRODUCTS, type DataProduct } from "@/data/sovereign-data-seed";
import { generateRecommendations, type AgentRecommendation, type RecStatus } from "@/data/sovereign-data-agent";

interface SdsData {
  products: DataProduct[];
  recommendations: AgentRecommendation[];
  setRecommendationStatus: (id: string, status: RecStatus) => void;
  selectedProductId: string | null;
  setSelectedProductId: (id: string | null) => void;
}

const Ctx = createContext<SdsData | null>(null);

export function SdsDataProvider({ children }: { children: ReactNode }) {
  const [recs, setRecs] = useState<AgentRecommendation[]>(() => generateRecommendations());
  const [selectedProductId, setSelectedProductId] = useState<string | null>("citizen-sentiment-dashboard");

  const setRecommendationStatus = useCallback((id: string, status: RecStatus) => {
    setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }, []);

  const value: SdsData = {
    products: DATA_PRODUCTS,
    recommendations: recs,
    setRecommendationStatus,
    selectedProductId,
    setSelectedProductId,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSdsData(): SdsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSdsData must be used inside SdsDataProvider");
  return v;
}
