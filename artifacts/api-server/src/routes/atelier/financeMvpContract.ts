/**
 * Finance MVP public contract (Task #1374).
 *
 * Keep this deliberately small: these are the values the MVP UI can safely
 * depend on. Accounting-specific modules may grow independently.
 */
export const FINANCE_MVP_ENTITY_STATES = [
  "planned",
  "in_formation",
  "active",
  "dormant",
  "winding_down",
  "archived",
] as const;

export const FINANCE_MVP_SOURCE_TYPES = [
  "expense",
  "supplier_bill",
  "customer_invoice",
  "receipt",
  "bank_transaction",
  "shareholder_contribution",
] as const;

export const FINANCE_MVP_CATEGORIES = [
  "setup",
  "professional_fees",
  "software",
  "travel",
  "office",
  "marketing",
  "client_delivery",
  "tax",
  "payroll",
  "other",
] as const;

export const FINANCE_MVP_PERIOD_DIMENSIONS = ["month", "quarter", "year"] as const;
export const FINANCE_MVP_APPROVAL_STATES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "paid",
  "voided",
] as const;

export type FinanceMvpPeriodDimension = (typeof FINANCE_MVP_PERIOD_DIMENSIONS)[number];

export interface FinanceMvpCurrencyBucket {
  currency: string;
  amount: number;
}

export interface FinanceMvpMetric {
  /** Values are never summed across unlike currencies. */
  buckets: FinanceMvpCurrencyBucket[];
  display?: { currency: string; amount: number; source: "fx_table" | "peg" | "identity" };
}

export interface FinanceMvpSummary {
  contractVersion: "finance-mvp.v1";
  period: { dimension: FinanceMvpPeriodDimension; from: string; to: string };
  scope: { kind: "overall" | "entity"; entityId: string | null };
  actualOnly: true;
  revenue: FinanceMvpMetric;
  directCosts: FinanceMvpMetric;
  operatingExpenses: FinanceMvpMetric;
  netResult: FinanceMvpMetric;
  cash: FinanceMvpMetric;
  openLiabilities: FinanceMvpMetric;
  projectClientGrossMargin: Array<{
    projectId: string | null;
    projectName: string;
    clientId: string | null;
    clientName: string;
    revenue: FinanceMvpMetric;
    directCosts: FinanceMvpMetric;
    grossMargin: FinanceMvpMetric;
    /** Null when unlike currencies cannot be compared without display conversion. */
    grossMarginPct: number | null;
  }>;
  reconciliation: {
    bankTransactions: number;
    matchedTransactions: number;
    unmatchedTransactions: number;
    completenessPct: number;
  };
}

export const FINANCE_MVP_CONTRACT = {
  version: "finance-mvp.v1",
  entityStates: FINANCE_MVP_ENTITY_STATES,
  sourceTypes: FINANCE_MVP_SOURCE_TYPES,
  categories: FINANCE_MVP_CATEGORIES,
  periodDimensions: FINANCE_MVP_PERIOD_DIMENSIONS,
  approvalStates: FINANCE_MVP_APPROVAL_STATES,
  summaryPath: "/finance/mvp/summary",
} as const;