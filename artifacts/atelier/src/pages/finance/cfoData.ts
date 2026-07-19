/**
 * cfoData — data hooks + helpers for the CFO dashboard (Task #413).
 *
 * Thin React hooks that fetch the existing wallet/AR/WIP/margin/treasury/
 * utilization endpoints and expose them with a uniform shape. Live tiles
 * are wired to these; tiles whose data depends on later waves (EAC, three-
 * statement, full 13-week cash, controls catalogue, etc.) are rendered as
 * Wave-N placeholders in the dashboard component itself.
 */

import * as React from "react";

interface ArAging {
  buckets: Array<{ bucket: string; totalUsd: number }>;
  totalOutstandingUsd: number;
  invoiceCount: number;
  rows: Array<{
    invoice: { id: string; invoiceNumber: string | null; billTo: { name?: string }; currency: string; total: number; amountPaid: number; dueDate: string | null };
    daysOverdue: number;
    outstanding: number;
    bucket: string;
  }>;
}

export function useArAging() {
  const [data, setData] = React.useState<ArAging | null>(null);
  React.useEffect(() => {
    void fetch("/api/atelier/wallet/ar/aging", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null));
  }, []);
  return data;
}

interface WipLatest {
  engagements: Array<{ engagement_id: string; hours_burned: number; expense_burned: number; recognised_revenue: number; invoiced_amount: number; unbilled_amount: number; currency: string }>;
  firm: { recognised: number; invoiced: number; unbilled: number; count: number };
}

export function useWipLatest() {
  const [data, setData] = React.useState<WipLatest | null>(null);
  React.useEffect(() => {
    void fetch("/api/atelier/wip/snapshots/latest", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null));
  }, []);
  return data;
}

interface MarginFirm {
  firm: { revenueRecognised: number; directCost: number; grossMarginAmount: number; grossMarginPct: number; leakageAmount: number; engagementCount: number };
  slips: Array<{ engagementId: string; realizationRate: number; leakageAmount: number }>;
  asOf: string | null;
}

export function useMarginFirm() {
  const [data, setData] = React.useState<MarginFirm | null>(null);
  React.useEffect(() => {
    void fetch("/api/atelier/margin/firm", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null));
  }, []);
  return data;
}

export interface CashForecastWeek { weekIndex: number; weekStart: string; expectedIn: number; expectedOut: number; openingBalance: number; closingBalance: number; isCashGap: boolean }
interface CashForecastResp { weeks: CashForecastWeek[]; cashGapWeeks: number[] }

export function useCashForecast() {
  const [data, setData] = React.useState<CashForecastResp | null>(null);
  React.useEffect(() => {
    void fetch("/api/atelier/cli/execute", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName: "cash_forecast_13w", input: {} }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => setData(j?.data ?? null))
      .catch(() => setData(null));
  }, []);
  return data;
}

interface UtilFirm {
  period: { weeks: number; weekIsos: string[] };
  realizationRatePct: number;
  fullRateInvoicedHours: number;
  fullRateAvailableHours: number;
  partnerSummary: Array<{ partnerId: string; partnerName: string; utilPct: number; targetPct: number; peopleCount: number }>;
  sectorSummary: Array<{ sector: string; plannedMarginPct: number; realizedMarginPct: number; engagementCount: number; revenueUsd: number }>;
  engagementRollup: Array<{ engagementId: string; engagementName: string; accountName: string; sector: string; realizedMarginPct: number; targetMarginPct: number; belowTarget: boolean; leakageHours: number }>;
}

export function useUtilFirm() {
  const [data, setData] = React.useState<UtilFirm | null>(null);
  React.useEffect(() => {
    void fetch("/api/atelier/ledger/utilization/firm", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null));
  }, []);
  return data;
}

/* ============================================================
   Inbox builder — extends Task #372's red/amber/gold producer
   types with the new CFO surfaces (AR > 90, leakage slips, etc.)
   ============================================================ */

export interface NextAction {
  id: string;
  section: string;
  href: string;
  title: string;
  detail: string;
  due: string;
  tone: "red" | "amber" | "gold" | "default";
  daysOut: number;
}

export interface EntityExpiryLike {
  id: string;
  entityId: string;
  entityShortName: string;
  kind: "registration" | "lease";
  label: string;
  expiresOn: string;
  daysOut: number;
  severity: "overdue" | "critical" | "upcoming";
}

export function buildCfoInbox(
  ar: ArAging | null,
  margin: MarginFirm | null,
  cash: CashForecastResp | null,
  expiries: EntityExpiryLike[] = [],
): NextAction[] {
  const out: NextAction[] = [];

  // Task #264 — registry expiries (trade licences, establishment cards,
  // Ejari lease ends) from the legal-entity registry. Overdue and
  // ≤30-day items demand action; further-out ones stay on the
  // compliance calendar only.
  for (const x of expiries) {
    if (x.severity === "upcoming") continue;
    out.push({
      id: `exp-${x.id}`,
      section: "Entities",
      href: `/finance/entities`,
      title: x.severity === "overdue"
        ? `${x.kind === "lease" ? "Lease" : "Registration"} expired — ${x.label}`
        : `${x.kind === "lease" ? "Lease" : "Registration"} renewal — ${x.label}`,
      detail: `${x.entityShortName} · expires ${x.expiresOn}`,
      due: x.daysOut < 0 ? `${Math.abs(x.daysOut)}d overdue` : `${x.daysOut}d`,
      tone: x.severity === "overdue" ? "red" : "amber",
      daysOut: x.daysOut,
    });
  }

  // From AR — invoices > 90 days overdue
  if (ar) {
    for (const r of ar.rows) {
      if (r.daysOverdue > 90) {
        out.push({
          id: `ar90-${r.invoice.id}`,
          section: "Bill & Collect",
          href: `/wallet/collections?invoiceId=${r.invoice.id}`,
          title: `AR > 90d — ${r.invoice.billTo?.name ?? "Customer"}`,
          detail: `${r.invoice.invoiceNumber ?? r.invoice.id} · ${r.invoice.currency} ${r.outstanding.toFixed(0)}`,
          due: `${r.daysOverdue}d overdue`,
          tone: r.daysOverdue > 120 ? "red" : "amber",
          daysOut: -r.daysOverdue,
        });
      }
    }
  }

  // From margin — engagements with realisation slips
  if (margin && margin.slips.length > 0) {
    for (const s of margin.slips.slice(0, 3)) {
      out.push({
        id: `slip-${s.engagementId}`,
        section: "Engagement",
        href: `/finance/reports/engagement-economics/${s.engagementId}`,
        title: `Realisation slip — ${s.engagementId}`,
        detail: `${(s.realizationRate * 100).toFixed(0)}% realisation · $${Math.round(s.leakageAmount).toLocaleString()} leaked`,
        due: "this period",
        tone: s.realizationRate < 0.7 ? "red" : "amber",
        daysOut: 0,
      });
    }
  }

  // From cash — projected gap weeks in next 4
  if (cash && cash.cashGapWeeks.length > 0) {
    const near = cash.cashGapWeeks.filter((w) => w <= 4);
    if (near.length > 0) {
      out.push({
        id: `cashgap-${near.join("-")}`,
        section: "Treasury",
        href: `/wallet/treasury`,
        title: `Projected cash gap`,
        detail: `Week${near.length === 1 ? "" : "s"} ${near.join(", ")} of 13-week forecast`,
        due: `w${near[0]}`,
        tone: near[0] <= 2 ? "red" : "amber",
        daysOut: near[0] * 7,
      });
    }
  }

  out.sort((a, b) => {
    const toneOrder = { red: 0, amber: 1, gold: 2, default: 3 } as const;
    if (toneOrder[a.tone] !== toneOrder[b.tone]) return toneOrder[a.tone] - toneOrder[b.tone];
    return a.daysOut - b.daysOut;
  });
  return out.slice(0, 10);
}
