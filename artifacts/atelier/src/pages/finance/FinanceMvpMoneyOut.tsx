/**
 * FinanceMvpMoneyOut — /finance/money-out
 *
 * Founder-facing hub for expenses, supplier bills, receipts, approvals,
 * reimbursements, and payment preparation. Links to existing working detail flows.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, MonoChip, BackLink } from "@/components/ui/primitives";
import { ArrowRight, Receipt, FileText, CheckSquare, CreditCard, RefreshCw, Send } from "lucide-react";

const API_BASE = "/api/atelier";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface ExpenseSummary {
  totalCount: number;
  pendingApproval: number;
  approved: number;
  rejected: number;
  totalUsd: number;
}

interface SupplierInvoiceSummary {
  totalCount: number;
  pendingReview: number;
  approved: number;
  totalUsd: number;
}

interface PaymentRunSummary {
  openRuns: number;
  readyToSign: number;
  totalUsd: number;
}

// -----------------------------------------------------------------------
// Hooks — lightweight summaries
// -----------------------------------------------------------------------

function useExpenseSummary() {
  return useQuery<ExpenseSummary>({
    queryKey: ["mvp-expense-summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/wallet/expenses?scope=all`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      const items: Array<{ status: string; usdAmount: number }> = j.expenses ?? [];
      return {
        totalCount: items.length,
        pendingApproval: items.filter((e) => e.status === "submitted").length,
        approved: items.filter((e) => e.status === "approved").length,
        rejected: items.filter((e) => e.status === "rejected").length,
        totalUsd: items.reduce((s, e) => s + (e.usdAmount ?? 0), 0),
      };
    },
    staleTime: 30_000,
    retry: false,
  });
}

function useSupplierInvoiceSummary() {
  return useQuery<SupplierInvoiceSummary>({
    queryKey: ["mvp-supplier-invoice-summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/finance/payables/supplier-invoices`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      const items: Array<{ status: string; usdAmount: number }> = j.items ?? [];
      return {
        totalCount: items.length,
        pendingReview: items.filter((i) => i.status === "submitted" || i.status === "under_review").length,
        approved: items.filter((i) => i.status === "approved").length,
        totalUsd: items.reduce((s, i) => s + (i.usdAmount ?? 0), 0),
      };
    },
    staleTime: 30_000,
    retry: false,
  });
}

function usePaymentRunSummary() {
  return useQuery<PaymentRunSummary>({
    queryKey: ["mvp-payment-run-summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/finance/payables/payment-runs`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      const items: Array<{ status: string; totalUsd?: number }> = j.items ?? [];
      return {
        openRuns: items.filter((r) => r.status !== "paid" && r.status !== "cancelled").length,
        readyToSign: items.filter((r) => r.status === "pending_signatures").length,
        totalUsd: items.filter((r) => r.status !== "paid" && r.status !== "cancelled")
          .reduce((s, r) => s + (r.totalUsd ?? 0), 0),
      };
    },
    staleTime: 30_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------
// Hub card component
// -----------------------------------------------------------------------

function HubCard({
  icon: Icon,
  title,
  description,
  href,
  badge,
  badgeTone = "default",
  secondaryHref,
  secondaryLabel,
  "data-testid": testId,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  badge?: string;
  badgeTone?: "default" | "amber" | "red" | "green";
  secondaryHref?: string;
  secondaryLabel?: string;
  "data-testid"?: string;
}) {
  return (
    <Card className="p-5 flex flex-col gap-4 card-hover" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gold/10 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-gold" />
          </div>
          <div className="text-sm font-medium text-text">{title}</div>
        </div>
        {badge && <MonoChip tone={badgeTone}>{badge}</MonoChip>}
      </div>
      <p className="text-xs text-text-mute leading-relaxed">{description}</p>
      <div className="mt-auto flex items-center gap-4">
        <Link
          href={href}
          className="text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1 font-mono"
          data-testid={`${testId}-link`}
        >
          Open <ArrowRight className="w-3 h-3" />
        </Link>
        {secondaryHref && secondaryLabel && (
          <Link
            href={secondaryHref}
            className="text-xs text-text-mute hover:text-gold inline-flex items-center gap-1 font-mono"
          >
            {secondaryLabel} <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Summary strip
// -----------------------------------------------------------------------

function SummaryStrip({
  expenses,
  invoices,
  runs,
}: {
  expenses: ExpenseSummary | undefined;
  invoices: SupplierInvoiceSummary | undefined;
  runs: PaymentRunSummary | undefined;
}) {
  const fmtUsd = (n: number) =>
    `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="money-out-summary">
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Expenses pending</div>
        <div className="text-2xl font-light text-text mt-1">
          {expenses ? expenses.pendingApproval : "—"}
        </div>
        <div className="text-xs text-text-mute mt-0.5">Awaiting approval</div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Bills to review</div>
        <div className="text-2xl font-light text-text mt-1">
          {invoices ? invoices.pendingReview : "—"}
        </div>
        <div className="text-xs text-text-mute mt-0.5">Supplier invoices</div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Open payments</div>
        <div className="text-2xl font-light text-text mt-1">
          {runs ? runs.openRuns : "—"}
        </div>
        <div className="text-xs text-text-mute mt-0.5">
          {runs && runs.totalUsd > 0 ? fmtUsd(runs.totalUsd) : "No payments queued"}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Ready to sign</div>
        <div className={`text-2xl font-light mt-1 ${runs && runs.readyToSign > 0 ? "text-warn" : "text-text"}`}>
          {runs ? runs.readyToSign : "—"}
        </div>
        <div className="text-xs text-text-mute mt-0.5">Payment runs awaiting signatory</div>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function FinanceMvpMoneyOut() {
  const { data: expenses } = useExpenseSummary();
  const { data: invoices } = useSupplierInvoiceSummary();
  const { data: runs } = usePaymentRunSummary();

  return (
    <div className="animate-in fade-in" data-testid="page-mvp-money-out">
      <PageHero>
        <BackLink href="/finance">Finance overview</BackLink>
        <SectionHead
          eyebrow="Finance · Money out"
          headline="Money out"
          lede="Everything your team spends — from coffee receipts to supplier invoices. Capture, approve, and pay in a controlled flow."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-8">

        {/* Summary strip */}
        <SummaryStrip expenses={expenses} invoices={invoices} runs={runs} />

        {/* Primary actions */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Capture</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HubCard
              icon={Receipt}
              title="Submit an expense"
              description="Submit a receipt for a meal, travel, office supply, or any business expense. Expenses are policy-checked automatically and routed for approval."
              href="/wallet/expenses/new"
              data-testid="hub-new-expense"
            />
            <HubCard
              icon={FileText}
              title="Upload a supplier bill"
               description="Upload a supplier PDF. CogniDocs reads the key fields for you to check before the bill is submitted for approval and payment."
              href="/finance/payables/supplier-invoices"
              badge={invoices && invoices.pendingReview > 0 ? `${invoices.pendingReview} to review` : undefined}
              badgeTone="amber"
              data-testid="hub-supplier-invoices"
            />
            <HubCard
              icon={CreditCard}
              title="View all expenses"
              description="Browse the full expense register, filter by status, and track what has been approved, rejected, or is still pending."
              href="/wallet/expenses"
              badge={expenses && expenses.pendingApproval > 0 ? `${expenses.pendingApproval} pending` : undefined}
              badgeTone="amber"
              data-testid="hub-all-expenses"
            />
          </div>
        </div>

        {/* Approve */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Approve</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HubCard
              icon={CheckSquare}
              title="Approvals inbox"
              description="Expenses, bills, and payment requests waiting for your sign-off. Approve or reject with a reason — the submitter is notified automatically."
              href="/finance/approvals"
              badge={
                expenses && expenses.pendingApproval > 0
                  ? `${expenses.pendingApproval} waiting`
                  : undefined
              }
              badgeTone="amber"
              data-testid="hub-approvals"
            />
            <HubCard
              icon={FileText}
              title="Partner invoices"
              description="Invoices submitted by partner firms through their portal. Review and approve or reject — approved invoices join the next payment run automatically."
              href="/finance/payables/partner-invoices"
              data-testid="hub-partner-invoices"
            />
          </div>
        </div>

        {/* Pay */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Pay</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HubCard
              icon={Send}
              title="Payment runs"
              description="Group approved invoices into a payment batch, get dual-signatory approval, and export the bank payment file. No actual bank transfers are initiated here — the file goes to your bank."
              href="/finance/payables/payment-runs"
              badge={runs && runs.readyToSign > 0 ? `${runs.readyToSign} ready to sign` : undefined}
              badgeTone={runs && runs.readyToSign > 0 ? "amber" : "default"}
              data-testid="hub-payment-runs"
            />
            <HubCard
              icon={RefreshCw}
              title="Reimbursements"
              description="Approved expenses are reimbursed through payment runs. Self-billed invoices are generated automatically for contractors and partner firms from their approved timesheets."
              href="/finance/payables/self-billing"
              secondaryHref="/wallet/expenses"
              secondaryLabel="View expenses"
              data-testid="hub-reimbursements"
            />
          </div>
        </div>

        {/* Explainer */}
        <Card className="p-5 border-border-soft bg-bg-elevate/20" data-testid="money-out-explainer">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">How money out works</div>
          <div className="grid sm:grid-cols-3 gap-4 text-xs text-text-mute">
            <div className="space-y-1">
              <div className="text-text font-medium">1. Capture</div>
              <p className="leading-relaxed">Submit expenses with receipts, or upload supplier invoices. Every item is policy-checked and categorised.</p>
            </div>
            <div className="space-y-1">
              <div className="text-text font-medium">2. Approve</div>
              <p className="leading-relaxed">A partner reviews and approves or rejects with a reason. Approved items are queued for payment.</p>
            </div>
            <div className="space-y-1">
              <div className="text-text font-medium">3. Pay</div>
              <p className="leading-relaxed">Approved items are grouped into payment runs, signed by two authorised signatories, and a bank file is exported. No bank transfers happen inside this app.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
