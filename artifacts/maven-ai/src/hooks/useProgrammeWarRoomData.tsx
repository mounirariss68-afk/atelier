import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { PROGRAMMES, DEPENDENCIES, type Programme, type Dependency } from "@/data/programme-war-room-seed";
import { generateRecommendations, type AgentRecommendation, type RecStatus } from "@/data/programme-war-room-agent";

interface PwrData {
  programmes: Programme[];
  dependencies: Dependency[];
  recommendations: AgentRecommendation[];
  setRecommendationStatus: (id: string, status: RecStatus) => void;
  selectedProgrammeId: string | null;
  setSelectedProgrammeId: (id: string | null) => void;
}

const Ctx = createContext<PwrData | null>(null);

export function PwrDataProvider({ children }: { children: ReactNode }) {
  const [recs, setRecs] = useState<AgentRecommendation[]>(() => generateRecommendations());
  const [selectedProgrammeId, setSelectedProgrammeId] = useState<string | null>("erp-oracle");

  const setRecommendationStatus = useCallback((id: string, status: RecStatus) => {
    setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }, []);

  const value: PwrData = {
    programmes: PROGRAMMES,
    dependencies: DEPENDENCIES,
    recommendations: recs,
    setRecommendationStatus,
    selectedProgrammeId,
    setSelectedProgrammeId,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePwrData(): PwrData {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePwrData must be used inside PwrDataProvider");
  return v;
}
