/**
 * FinanceMvpMoneyIn — /finance/money-in
 *
 * Founder-facing hub for shareholder contributions and future customer
 * invoices/receipts. Explicitly states when there is no trading revenue.
 */

import * as React from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, MonoChip, BackLink } from "@/components/ui/primitives";
import { ArrowRight, TrendingUp, Users, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLegalEntities } from "@/lib/v5-hooks";

const API_BASE = "/api/atelier";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface InvoiceSummary {
  totalCount: number;
  openCount: number;
  overdueCount: number;
  totalOutstandingUsd: number;
  totalPaidUsd: number;
}

export interface MoneyInInvoiceRow {
  status: "draft" | "issued" | "paid" | "voided" | string;
  total: number | string | null;
  amountPaid: number | string | null;
  dueDate: string | null;
}

export function summarizeMoneyInInvoices(
  items: MoneyInInvoiceRow[],
  today = new Date().toISOString().slice(0, 10),
): InvoiceSummary {
  const live = items.filter((invoice) => invoice.status === "issued" || invoice.status === "paid");
  const remaining = (invoice: MoneyInInvoiceRow) =>
    Math.max(0, Number(invoice.total ?? 0) - Number(invoice.amountPaid ?? 0));
  const open = live.filter((invoice) => invoice.status === "issued" && remaining(invoice) > 0);
  return {
    totalCount: live.length,
    openCount: open.length,
    overdueCount: open.filter((invoice) => !!invoice.dueDate && invoice.dueDate < today).length,
    totalOutstandingUsd: open.reduce((sum, invoice) => sum + remaining(invoice), 0),
    totalPaidUsd: live.reduce((sum, invoice) => sum + Number(invoice.amountPaid ?? 0), 0),
  };
}

interface FundingRow {
  id: string;
  entityId: string;
  entryType: "contribution" | "repayment" | "reversal";
  contributionType: "equity" | "shareholder_loan";
  contributorName: string;
  amount: number;
  currency: string;
  transactionDate: string;
  status: string;
}

async function writeFunding(path: string, body?: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message ?? payload.error ?? `Request failed (${res.status})`);
  return payload;
}

function FundingRegister() {
  const client = useQueryClient();
  const { entities } = useLegalEntities();
  const { data, isLoading, isError } = useQuery<{ items: FundingRow[] }>({
    queryKey: ["mvp-shareholder-funding"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/finance/shareholder-funding`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const [showForm, setShowForm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({
    entityId: "",
    contributionType: "equity",
    contributorName: "",
    amount: "",
    currency: "AED",
    transactionDate: new Date().toISOString().slice(0, 10),
  });
  React.useEffect(() => {
    if (!draft.entityId && entities[0]) setDraft((d) => ({ ...d, entityId: entities[0].id }));
  }, [draft.entityId, entities]);
  const create = useMutation({
    mutationFn: () => writeFunding("/finance/shareholder-funding", {
      ...draft,
      amount: Number(draft.amount),
      idempotencyKey: `finance-ui-${crypto.randomUUID()}`,
    }),
    onSuccess: async () => {
      setError(null);
      setShowForm(false);
      setDraft((d) => ({ ...d, contributorName: "", amount: "" }));
      await client.invalidateQueries({ queryKey: ["mvp-shareholder-funding"] });
      await client.invalidateQueries({ queryKey: ["mvp-summary"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save the contribution."),
  });
  const confirm = useMutation({
    mutationFn: (id: string) => writeFunding(`/finance/shareholder-funding/${id}/confirm`),
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["mvp-shareholder-funding"] });
      await client.invalidateQueries({ queryKey: ["mvp-summary"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not confirm the contribution."),
  });
  const rows = (data?.items ?? []).filter((row) => row.entryType === "contribution");
  const entityName = (id: string) => entities.find((entity) => entity.id === id)?.shortName || "Entity";

  return (
    <Card className="overflow-hidden" data-testid="shareholder-funding-register">
      <div className="p-5 border-b border-border-soft flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text">Shareholder investment register</div>
          <p className="text-xs text-text-mute mt-1">Record founder equity and shareholder loans separately from customer revenue.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((open) => !open)}>
          {showForm ? "Cancel" : "Record contribution"}
        </Button>
      </div>
      {showForm && (
        <form
          className="p-5 border-b border-border-soft grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          onSubmit={(event) => { event.preventDefault(); setError(null); create.mutate(); }}
        >
          <label className="text-xs text-text-mute">Entity
            <select className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-text" value={draft.entityId} onChange={(e) => setDraft({ ...draft, entityId: e.target.value })} required>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.shortName || entity.legalNameEn}</option>)}
            </select>
          </label>
          <label className="text-xs text-text-mute">Type
            <select className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-text" value={draft.contributionType} onChange={(e) => setDraft({ ...draft, contributionType: e.target.value })}>
              <option value="equity">Equity contribution</option>
              <option value="shareholder_loan">Shareholder loan</option>
            </select>
          </label>
          <label className="text-xs text-text-mute">Contributor
            <Input className="mt-1" value={draft.contributorName} onChange={(e) => setDraft({ ...draft, contributorName: e.target.value })} required />
          </label>
          <label className="text-xs text-text-mute">Amount
            <Input className="mt-1" type="number" min="0.01" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required />
          </label>
          <label className="text-xs text-text-mute">Currency
            <Input className="mt-1 uppercase" maxLength={3} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} required />
          </label>
          <label className="text-xs text-text-mute">Date
            <Input className="mt-1" type="date" value={draft.transactionDate} onChange={(e) => setDraft({ ...draft, transactionDate: e.target.value })} required />
          </label>
          <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
            <Button type="submit" disabled={create.isPending || !entities.length}>{create.isPending ? "Saving…" : "Save for confirmation"}</Button>
            <span className="text-xs text-text-faint">A partner confirms the entry before it becomes final.</span>
          </div>
          {error && <div role="alert" className="sm:col-span-2 lg:col-span-3 text-xs text-danger">{error}</div>}
        </form>
      )}
      <div className="divide-y divide-border-soft">
        {error && !showForm && <div role="alert" className="p-4 text-xs text-danger">{error}</div>}
        {isLoading && <div className="p-5 text-xs text-text-mute">Loading contributions…</div>}
        {isError && <div className="p-5 text-xs text-danger">Could not load the investment register.</div>}
        {!isLoading && !isError && rows.length === 0 && <div className="p-5 text-xs text-text-mute">No shareholder contributions have been recorded yet.</div>}
        {rows.map((row) => (
          <div key={row.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-text">{row.contributorName} · {entityName(row.entityId)}</div>
              <div className="text-xs text-text-mute mt-1">{row.transactionDate} · {row.contributionType === "equity" ? "Equity" : "Shareholder loan"}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-text">{row.currency} {Number(row.amount).toLocaleString()}</span>
              <MonoChip tone={row.status === "confirmed" ? "green" : "amber"}>{row.status.replaceAll("_", " ")}</MonoChip>
              {row.status === "pending" && <Button size="sm" variant="outline" onClick={() => confirm.mutate(row.id)} disabled={confirm.isPending}>Confirm</Button>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

function useInvoiceSummary() {
  return useQuery<InvoiceSummary>({
    queryKey: ["mvp-invoice-summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/wallet/invoices`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
       return summarizeMoneyInInvoices(j.invoices ?? j.items ?? []);
    },
    staleTime: 30_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------
// No revenue state
// -----------------------------------------------------------------------

function NoRevenueState() {
  return (
    <Card className="p-8 border-border-soft" data-testid="money-in-no-revenue">
      <div className="flex items-start gap-4">
        <Info className="w-5 h-5 text-text-faint shrink-0 mt-0.5" />
        <div className="space-y-2">
          <div className="text-sm font-medium text-text">No trading revenue yet</div>
          <p className="text-xs text-text-mute leading-relaxed max-w-xl">
            This workspace has no customer invoices or revenue receipts recorded. That is normal for a
            pre-revenue company. When you start billing clients, invoices and receipts will appear here.
          </p>
          <p className="text-xs text-text-mute leading-relaxed max-w-xl">
            In the meantime, you can record shareholder contributions and founder investments — money
            that has come into the company from its owners rather than from customers.
          </p>
        </div>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Hub card
// -----------------------------------------------------------------------

function HubCard({
  icon: Icon,
  title,
  description,
  href,
  badge,
  badgeTone = "default",
  note,
  "data-testid": testId,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  badge?: string;
  badgeTone?: "default" | "amber" | "red" | "green";
  note?: string;
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
      {note && (
        <div className="text-[11px] text-text-faint leading-relaxed border-l-2 border-border pl-3 italic">
          {note}
        </div>
      )}
      <div className="mt-auto">
        <Link
          href={href}
          className="text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1 font-mono"
          data-testid={`${testId}-link`}
        >
          Open <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Invoice summary strip
// -----------------------------------------------------------------------

function InvoiceStrip({ summary }: { summary: InvoiceSummary }) {
  const fmtUsd = (n: number) =>
    `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="money-in-invoice-strip">
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Invoices sent</div>
        <div className="text-2xl font-light text-text mt-1">{summary.totalCount}</div>
        <div className="text-xs text-text-mute mt-0.5">Total all time</div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Outstanding</div>
        <div className={`text-2xl font-light mt-1 ${summary.openCount > 0 ? "text-warn" : "text-text"}`}>
          {summary.openCount}
        </div>
        <div className="text-xs text-text-mute mt-0.5">
          {summary.totalOutstandingUsd > 0 ? fmtUsd(summary.totalOutstandingUsd) : "All collected"}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Overdue</div>
        <div className={`text-2xl font-light mt-1 ${summary.overdueCount > 0 ? "text-danger" : "text-text"}`}>
          {summary.overdueCount}
        </div>
        <div className="text-xs text-text-mute mt-0.5">Past due date</div>
      </Card>
      <Card className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Collected</div>
        <div className="text-2xl font-light text-success mt-1">
          {summary.totalPaidUsd > 0 ? fmtUsd(summary.totalPaidUsd) : "—"}
        </div>
        <div className="text-xs text-text-mute mt-0.5">Paid invoices</div>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function FinanceMvpMoneyIn() {
  const { data: invoices, isLoading } = useInvoiceSummary();

  const hasRevenue = !isLoading && invoices && invoices.totalCount > 0;

  return (
    <div className="animate-in fade-in" data-testid="page-mvp-money-in">
      <PageHero>
        <BackLink href="/finance">Finance overview</BackLink>
        <SectionHead
          eyebrow="Finance · Money in"
          headline="Money in"
          lede="Shareholder contributions, customer invoices, and receipts. Everything that comes into the business."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-8">

        {/* No revenue notice — always show pre-revenue context */}
        {!hasRevenue && !isLoading && <NoRevenueState />}

        {/* Invoice summary — only if invoices exist */}
        {hasRevenue && invoices && <InvoiceStrip summary={invoices} />}

        {/* Shareholder contributions */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Founder and shareholder money</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HubCard
              icon={Users}
              title="Shareholder contributions"
              description="Record money founders or shareholders have put into the company — equity injections, director loans, or capital contributions. These appear in the entity's opening balance and equity section."
               href="/finance/money-in#funding-register"
              note="These are not revenue. They are owner investments in the business."
              data-testid="hub-contributions"
            />
            <HubCard
              icon={TrendingUp}
              title="Cash position"
              description="View the current cash balance across all linked bank accounts. Import a bank statement to keep this up to date."
              href="/wallet/cash"
              data-testid="hub-cash-position"
            />
          </div>
        </div>

        <div id="funding-register" className="space-y-3 scroll-mt-24">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Investment register</div>
          <FundingRegister />
        </div>

        {/* Customer invoices */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Customer invoices</div>

          {!hasRevenue && (
            <Card className="p-4 border-border-soft bg-bg-elevate/20" data-testid="money-in-no-customer-invoices">
              <div className="text-sm text-text-mute">
                No customer invoices yet.{" "}
                <span className="text-text-faint">
                  When your first client engagement is billed, invoices will appear here and in the
                  AR aging report.
                </span>
              </div>
            </Card>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HubCard
              icon={FileText}
              title="Invoices"
              description="Create and send client invoices. Track which are open, paid, or overdue. Issue credit notes when needed."
              href="/wallet/invoices"
              badge={invoices && invoices.openCount > 0 ? `${invoices.openCount} open` : undefined}
              badgeTone={invoices && invoices.overdueCount > 0 ? "red" : "amber"}
              data-testid="hub-invoices"
            />
            <HubCard
              icon={TrendingUp}
              title="AR aging"
              description="Aged receivables by client and invoice. See what is current, 30 days, 60 days, and 90+ days overdue. Used to chase payments."
              href="/wallet/ar"
              badge={invoices && invoices.overdueCount > 0 ? `${invoices.overdueCount} overdue` : undefined}
              badgeTone="red"
              data-testid="hub-ar-aging"
            />
            <HubCard
              icon={FileText}
              title="Cash application"
              description="Match incoming bank receipts to open invoices. Keeps your AR balance accurate and triggers revenue recognition."
              href="/wallet/cash"
              data-testid="hub-cash-application"
            />
          </div>
        </div>

        {/* Explainer */}
        <Card className="p-5 border-border-soft bg-bg-elevate/20" data-testid="money-in-explainer">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">The difference between contributions and revenue</div>
          <div className="grid sm:grid-cols-2 gap-6 text-xs text-text-mute">
            <div className="space-y-2">
              <div className="text-text font-medium">Shareholder contributions</div>
              <p className="leading-relaxed">
                Money put into the company by its founders or shareholders. This is equity — it does not
                appear as revenue in the P&L. It goes directly into equity on the balance sheet.
                Examples: founder bank transfer to company account, investor subscription for shares.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-text font-medium">Trading revenue</div>
              <p className="leading-relaxed">
                Money earned by delivering services or products to customers. This appears in the P&L
                as revenue once it is recognised. It requires a client invoice or a signed contract.
                Examples: consulting fee for a completed project, subscription payment from a client.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
