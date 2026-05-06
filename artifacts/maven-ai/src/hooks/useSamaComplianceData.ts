import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import {
  buildSeedObligations,
  buildSeedControls,
  buildSeedCirculars,
  buildSeedReturns,
  buildSeedAuditEvents,
  buildParagraphTraces,
  type Obligation,
  type Control,
  type Circular,
  type RegulatoryReturn,
  type AuditEvent,
  type ParagraphTrace,
} from "@/data/sama-compliance-seed";

export interface SamaData {
  obligations: Obligation[];
  controls: Control[];
  circulars: Circular[];
  returns: RegulatoryReturn[];
  auditEvents: AuditEvent[];
  paragraphTraces: ParagraphTrace[];
}

const EMPTY: SamaData = {
  obligations: [],
  controls: [],
  circulars: [],
  returns: [],
  auditEvents: [],
  paragraphTraces: [],
};

const SamaCtx = createContext<SamaData>(EMPTY);

export function SamaComplianceDataProvider({ children }: { children: ReactNode }) {
  const value = useMemo<SamaData>(() => ({
    obligations: buildSeedObligations(),
    controls: buildSeedControls(),
    circulars: buildSeedCirculars(),
    returns: buildSeedReturns(),
    auditEvents: buildSeedAuditEvents(),
    paragraphTraces: buildParagraphTraces(),
  }), []);
  return createElement(SamaCtx.Provider, { value }, children);
}

export function useSamaComplianceData(): SamaData {
  return useContext(SamaCtx);
}
