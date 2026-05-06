// In-memory data provider for the Procurement Negotiation Agent · Category
// Manager Desk demo. Unlike the Tasama and Arçelik shells (which fetch from
// /api endpoints) the procurement seed is fully static — no API endpoints
// exist for this slug yet — so the provider is a thin pass-through.

import { createContext, useContext, type ReactNode } from "react";
import {
  EVENTS, SUPPLIERS, LINE_ITEMS, BIDS, AUDIT_LOG, COUNTER_DRAFTS,
  NOTIFICATIONS, PERSONA,
  type SourcingEvent, type Supplier, type LineItem, type Bid,
  type AuditEntry, type CounterBidDraft, type DeskNotification, type Persona,
} from "@/data/procurement-negotiation-seed";

export interface ProcurementData {
  persona: Persona;
  events: SourcingEvent[];
  suppliers: Supplier[];
  lineItems: LineItem[];
  bids: Bid[];
  audit: AuditEntry[];
  counterDrafts: CounterBidDraft[];
  notifications: DeskNotification[];
}

const SNAPSHOT: ProcurementData = {
  persona: PERSONA,
  events: EVENTS,
  suppliers: SUPPLIERS,
  lineItems: LINE_ITEMS,
  bids: BIDS,
  audit: AUDIT_LOG,
  counterDrafts: COUNTER_DRAFTS,
  notifications: NOTIFICATIONS,
};

const Ctx = createContext<ProcurementData>(SNAPSHOT);

export function ProcurementDataProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={SNAPSHOT}>{children}</Ctx.Provider>;
}

export function useProcurementData(): ProcurementData {
  return useContext(Ctx);
}

export function getProcurementSnapshot(): ProcurementData {
  return SNAPSHOT;
}
