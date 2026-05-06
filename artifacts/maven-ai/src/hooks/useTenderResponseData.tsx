import { createContext, useContext, type ReactNode } from "react";
import {
  TENDERS, ACTIVE_QUESTIONS, ACTIVE_TENDER_ID, LIBRARY, SMES, COMPLIANCE_GATES,
  AUDIT_LOG, type Tender, type TenderQuestion, type LibraryEntry, type Sme, type ComplianceGate,
  type AuditEntry,
} from "@/data/tender-response-seed";

export interface TenderResponseData {
  tenders: Tender[];
  activeTender: Tender;
  activeQuestions: TenderQuestion[];
  library: LibraryEntry[];
  smes: Sme[];
  complianceGates: ComplianceGate[];
  auditLog: AuditEntry[];
}

const DATA: TenderResponseData = {
  tenders: TENDERS,
  activeTender: TENDERS.find((t) => t.id === ACTIVE_TENDER_ID)!,
  activeQuestions: ACTIVE_QUESTIONS,
  library: LIBRARY,
  smes: SMES,
  complianceGates: COMPLIANCE_GATES,
  auditLog: AUDIT_LOG,
};

const Ctx = createContext<TenderResponseData>(DATA);

export function TenderResponseDataProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={DATA}>{children}</Ctx.Provider>;
}

export function useTenderResponseData() {
  return useContext(Ctx);
}
