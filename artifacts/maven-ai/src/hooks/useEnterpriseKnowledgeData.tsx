import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import {
  generateRecommendations, generateAuditLog,
  type AgentRecommendation, type RecStatus, type AuditEntry,
} from "@/data/enterprise-knowledge-agent";
import { PERSONAS, SOURCES, type PersonaId, type Source } from "@/data/enterprise-knowledge-seed";

interface EkcData {
  sources: Source[];
  personas: typeof PERSONAS;
  personaId: PersonaId;
  setPersonaId: (id: PersonaId) => void;
  recommendations: AgentRecommendation[];
  setRecommendationStatus: (id: string, status: RecStatus) => void;
  auditLog: AuditEntry[];
  appendAudit: (entry: AuditEntry) => void;
  openSourceId: string | null;
  setOpenSourceId: (id: string | null) => void;
}

const Ctx = createContext<EkcData | null>(null);

export function EkcDataProvider({ children }: { children: ReactNode }) {
  const [personaId, setPersonaId] = useState<PersonaId>("cfo");
  const [recs, setRecs] = useState<AgentRecommendation[]>(() => generateRecommendations());
  const [audit, setAudit] = useState<AuditEntry[]>(() => generateAuditLog());
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);

  const setRecommendationStatus = useCallback((id: string, status: RecStatus) => {
    setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }, []);

  const appendAudit = useCallback((entry: AuditEntry) => {
    setAudit((prev) => [entry, ...prev]);
  }, []);

  const value: EkcData = {
    sources: SOURCES,
    personas: PERSONAS,
    personaId,
    setPersonaId,
    recommendations: recs,
    setRecommendationStatus,
    auditLog: audit,
    appendAudit,
    openSourceId,
    setOpenSourceId,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEkcData(): EkcData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEkcData must be used inside EkcDataProvider");
  return v;
}
