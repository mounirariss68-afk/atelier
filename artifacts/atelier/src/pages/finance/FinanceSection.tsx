/**
 * FinanceSection — section landing pages for the Finance lens (Task #372).
 *
 * Each section (Record, Bill & Collect, Pay, Close, Plan, Report, Comply)
 * gets a thin landing page that names the sub-surfaces inside it. The
 * sub-pages themselves are mostly re-mounts of existing pages (Wallet,
 * Ledger economics, Forecast, Pricing, Reports) plus a small number of
 * shell-phase placeholders for capabilities that don't ship in this
 * task (chart of accounts, recurring journals, etc.).
 *
 * The L2C Wave 3 (#362) and Wave 4 (#363) surfaces are linked under
 * Bill & Collect / Close / Plan as they already exist under /wallet/*.
 */

import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { ArrowRight } from "lucide-react";

export interface SubPage {
  label: string;
  href: string;
  blurb: string;
  status?: "live" | "coming_soon";
}

export interface SectionDef {
  id: string;
  eyebrow: string;
  headline: string;
  lede: string;
  subPages: SubPage[];
}

export const FINANCE_SECTIONS: Record<string, SectionDef> = {
  ledger: {
    id: "ledger",
    eyebrow: "Finance · Record",
    headline: "Chart of accounts, journals, sub-ledgers",
    lede:
      "Record-to-report. Chart of accounts and dimensions (entity · cost-centre · project · client), manual / recurring / accrual / FX-revaluation journals, and AR / AP / fixed-assets / inter-company sub-ledgers.",
    subPages: [
      { label: "Chart of accounts", href: "/finance/ledger", blurb: "Account hierarchy + dimensions per entity.", status: "coming_soon" },
      { label: "Journals", href: "/finance/ledger", blurb: "Manual, recurring, accruals, FX revaluation.", status: "coming_soon" },
      { label: "Inter-company", href: "/finance/ledger", blurb: "IC matching, eliminations, cost-plus mark-ups.", status: "coming_soon" },
    ],
  },
  billing: {
    id: "billing",
    eyebrow: "Finance · Bill & Collect",
    headline: "Order-to-cash",
    lede:
      "Rate cards, e-invoice clearance, AR aging & dunning, cash application and credit notes, revenue recognition (POC, milestone, subscription).",
    subPages: [
      { label: "Rate cards & margin policy", href: "/finance/billing/rate-cards", blurb: "Day-rates by seniority and the AMBER/RED margin gates.", status: "live" },
      { label: "Invoices", href: "/wallet/invoices", blurb: "Invoice register and clearance status (ZATCA / FTA).", status: "live" },
      { label: "AR aging", href: "/wallet/ar", blurb: "Open balances by age bucket and account.", status: "live" },
      { label: "Collections", href: "/wallet/collections", blurb: "Dunning sequences and promise-to-pay tracking.", status: "live" },
      { label: "Cash application", href: "/wallet/cash", blurb: "Match incoming bank receipts to open invoices.", status: "live" },
      { label: "Revenue recognition", href: "/wallet/revrec", blurb: "POC / milestone / subscription rev-rec.", status: "live" },
      { label: "WIP & client-billable", href: "/wallet/wip", blurb: "Unbilled WIP roll-up.", status: "live" },
      { label: "Margin", href: "/wallet/margin", blurb: "Realised margin vs target by engagement.", status: "live" },
    ],
  },
  payables: {
    id: "payables",
    eyebrow: "Finance · Pay",
    headline: "Procure-to-pay",
    lede:
      "Vendors, PO / non-PO invoices and 3-way match, employee expenses (policy, VAT recovery, approvals, cards), VAT / WHT, payment runs and treasury.",
    subPages: [
      { label: "Vendors", href: "/finance/payables/vendors", blurb: "Vendor master with KYC, beneficial ownership, sanctions screen, bank-detail change controls.", status: "live" },
      { label: "Purchase orders", href: "/finance/payables/po", blurb: "POs, GRNs, 3-way match against invoices.", status: "live" },
      { label: "Payment runs", href: "/finance/payables/payment-runs", blurb: "Maker-checker + dual-signatory payment runs with bank-file output.", status: "live" },
      { label: "WHT register", href: "/finance/payables/wht", blurb: "Withholding-tax certificate tracking and per-jurisdiction remittance.", status: "live" },
      { label: "Subcontractors", href: "/finance/payables/subcontractors", blurb: "Pay-when-paid links between subcontractor invoices and client AR receipts.", status: "live" },
      { label: "Expenses", href: "/wallet/expenses", blurb: "Submitted, approved, and paid expense reports.", status: "live" },
      { label: "Expense policy", href: "/wallet/policy", blurb: "Per-diem caps, receipt thresholds, VAT recovery rules.", status: "live" },
      { label: "Approvals queue", href: "/wallet/approvals", blurb: "Manager / partner expense approvals.", status: "live" },
      { label: "Corporate cards", href: "/wallet/cards", blurb: "Card register, statements, dispute tracker.", status: "live" },
      { label: "VAT / WHT (legacy)", href: "/wallet/vat", blurb: "Input VAT recovery and legacy WHT view.", status: "live" },
      { label: "Treasury", href: "/wallet/treasury", blurb: "Cash position, FX exposure, payment runs.", status: "live" },
    ],
  },
  close: {
    id: "close",
    eyebrow: "Finance · Close",
    headline: "Period close",
    lede:
      "Period close checklist with owners, reconciliations (bank, AR, AP, IC, payroll), adjusting / closing entries, audit trail and sign-offs.",
    subPages: [
      { label: "Bank reconciliation", href: "/wallet/cash/recon", blurb: "Match bank statements to ledger cash.", status: "live" },
      { label: "Close checklist", href: "/finance/close", blurb: "Owner-by-owner close tasks per entity.", status: "coming_soon" },
      { label: "Adjusting entries", href: "/finance/close", blurb: "Period-end accruals, deferrals, FX reval.", status: "coming_soon" },
      { label: "Sign-offs & audit trail", href: "/finance/close", blurb: "Two-Partner sign-off and immutable trail.", status: "coming_soon" },
    ],
  },
  plan: {
    id: "plan",
    eyebrow: "Finance · Plan",
    headline: "FP&A",
    lede:
      "Budget and re-forecasts, driver-based models (headcount × rate × utilisation), 13-week cash forecast, renewals, scenarios vs actuals, long-range forecast.",
    subPages: [
      { label: "Long-range forecast", href: "/finance/plan/long-range", blurb: "Pipeline weighted forecast roll-ups (by partner / offering / sector / quarter).", status: "live" },
      { label: "13-week cash forecast", href: "/finance/plan/cash-13w", blurb: "Direct-method receipts and disbursements over the next 13 weeks with min-cash and covenant overlays.", status: "live" },
      { label: "Backlog & pipeline coverage", href: "/finance/plan/backlog", blurb: "Signed backlog plus probability-weighted pipeline against the next two quarters of revenue plan.", status: "live" },
      { label: "Renewals", href: "/finance/plan", blurb: "Subscription / framework renewal calendar.", status: "coming_soon" },
      { label: "Scenarios", href: "/finance/plan", blurb: "What-if vs base case (utilisation, rate, FX).", status: "coming_soon" },
    ],
  },
  reports: {
    id: "reports",
    eyebrow: "Finance · Report",
    headline: "Management & statutory reporting",
    lede:
      "P&L · Balance Sheet · Cash Flow per entity and consolidated, firm and engagement economics, utilization, board / management pack, saved & scheduled reports.",
    subPages: [
      { label: "Saved & scheduled reports", href: "/reports", blurb: "Templates, run history, PDF/CSV exports, schedules.", status: "live" },
      { label: "Firm economics", href: "/finance/reports/firm-economics", blurb: "Realisation, utilisation, margin by sector / partner.", status: "live" },
      { label: "Utilization", href: "/finance/reports/utilization", blurb: "Per-person utilisation vs target with rolling 4w / YTD.", status: "live" },
      { label: "P&L · BS · CF", href: "/finance/reports", blurb: "Statutory three-statement view per entity / consolidated.", status: "coming_soon" },
      { label: "Board / management pack", href: "/finance/reports", blurb: "Standing monthly board pack.", status: "coming_soon" },
    ],
  },
  comply: {
    id: "comply",
    eyebrow: "Finance · Comply",
    headline: "Tax, statutory and controls",
    lede:
      "Tax filings calendar (VAT, CT, WHT, payroll tax), statutory filings & annual accounts, transfer pricing & related-party, internal controls / SOX-lite, segregation of duties.",
    subPages: [
      { label: "Tax filings calendar", href: "/finance/entities", blurb: "Per-entity next VAT / CT / WHT filing dates.", status: "live" },
      { label: "Internal controls", href: "/finance/comply/controls", blurb: "Control catalogue, evidence cadence, exceptions, SoD matrix.", status: "live" },
      { label: "Statutory filings", href: "/finance/comply/statutory", blurb: "Annual accounts, beneficial ownership, country-by-country, MISA / DIFC / ADGM.", status: "live" },
      { label: "Transfer pricing", href: "/finance/comply/tp", blurb: "TP method per IC link, master / local file, related-party schedule.", status: "live" },
      { label: "Insurance", href: "/finance/comply/insurance", blurb: "PI, D&O, employer's liability, cyber cover and renewal calendar.", status: "live" },
    ],
  },
};

export default function FinanceSection({ sectionId }: { sectionId: string }) {
  const def = FINANCE_SECTIONS[sectionId];
  if (!def) {
    return (
      <PageHero>
        <Eyebrow>Finance</Eyebrow>
        <h1 className="headline mt-3">Section not found</h1>
        <p className="lede mt-3">No Finance section called <code className="font-mono">{sectionId}</code>.</p>
      </PageHero>
    );
  }
  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow={def.eyebrow.startsWith("Manage · Finance") ? def.eyebrow : `Manage · Finance · ${def.eyebrow.replace(/^Finance\s*·\s*/, "")}`}
          headline={def.headline}
          lede={def.lede}
        />
      </PageHero>
      <div className="container-atelier py-10 space-y-4">
        <SectionHead headline="In this section" />
        <div className="grid sm:grid-cols-2 gap-3" data-testid={`finance-section-${def.id}-subpages`}>
          {def.subPages.map((sub) => {
            const isLive = sub.status !== "coming_soon";
            const card = (
              <Card
                className={`p-4 h-full flex flex-col gap-2 ${
                  isLive ? "hover:border-gold/40 cursor-pointer" : "opacity-70"
                } transition-colors`}
                data-testid={`finance-subpage-${def.id}-${sub.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <div className="flex items-center justify-between">
                  <Eyebrow>{sub.label}</Eyebrow>
                  {isLive ? (
                    <ArrowRight className="w-3.5 h-3.5 text-text-faint" />
                  ) : (
                    <MonoChip>soon</MonoChip>
                  )}
                </div>
                <p className="text-sm text-text-mute leading-snug">{sub.blurb}</p>
              </Card>
            );
            return isLive ? (
              <Link key={sub.label} href={sub.href}>{card}</Link>
            ) : (
              <div key={sub.label}>{card}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
