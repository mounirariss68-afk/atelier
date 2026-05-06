// Citizen Services data is fully static (seed-driven), so this is a thin
// wrapper exposing the seed via React context for parity with the other
// demos. No fetching or query layer.

import { createContext, useContext, useState, useCallback, type ReactNode, createElement } from "react";
import {
  ACTIVE_CASES, RESOLVED_CASES, CITIZENS, MINISTRIES, REGIONS, SERVICES, OFFICER, DIRECTOR,
  type Case,
} from "@/data/citizen-services-seed";
import {
  getRecommendations, getAlerts, getOfficerKpis, getDirectorHeatmap,
  getMinistryVolume, getAuditLog, getKnowledgeRefs,
  type AgentRecommendation,
} from "@/data/citizen-services-agent";

interface CscData {
  cases: Case[];
  resolvedCases: typeof RESOLVED_CASES;
  citizens: typeof CITIZENS;
  ministries: typeof MINISTRIES;
  regions: typeof REGIONS;
  services: typeof SERVICES;
  officer: typeof OFFICER;
  director: typeof DIRECTOR;
  recommendations: AgentRecommendation[];
  alerts: ReturnType<typeof getAlerts>;
  kpis: ReturnType<typeof getOfficerKpis>;
  heatmap: ReturnType<typeof getDirectorHeatmap>;
  ministryVolume: ReturnType<typeof getMinistryVolume>;
  auditLog: ReturnType<typeof getAuditLog>;
  knowledge: ReturnType<typeof getKnowledgeRefs>;
  resolvedRecommendations: Record<string, "approved" | "edited" | "dismissed" | undefined>;
  resolveRecommendation: (id: string, action: "approved" | "edited" | "dismissed") => void;
}

const Ctx = createContext<CscData | null>(null);

export function CitizenServicesDataProvider({ children }: { children: ReactNode }) {
  const [resolvedRecommendations, setResolved] = useState<Record<string, "approved" | "edited" | "dismissed" | undefined>>({});
  const resolveRecommendation = useCallback((id: string, action: "approved" | "edited" | "dismissed") => {
    setResolved((p) => ({ ...p, [id]: action }));
  }, []);

  const value: CscData = {
    cases: ACTIVE_CASES,
    resolvedCases: RESOLVED_CASES,
    citizens: CITIZENS,
    ministries: MINISTRIES,
    regions: REGIONS,
    services: SERVICES,
    officer: OFFICER,
    director: DIRECTOR,
    recommendations: getRecommendations(),
    alerts: getAlerts(),
    kpis: getOfficerKpis(),
    heatmap: getDirectorHeatmap(),
    ministryVolume: getMinistryVolume(),
    auditLog: getAuditLog(),
    knowledge: getKnowledgeRefs(),
    resolvedRecommendations,
    resolveRecommendation,
  };
  return createElement(Ctx.Provider, { value }, children);
}

export function useCitizenServicesData(): CscData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCitizenServicesData must be used within CitizenServicesDataProvider");
  return v;
}
