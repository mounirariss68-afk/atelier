/**
 * FinancialsTab — per-engagement Financials surface (Task #442).
 *
 * Header strip · Action Center · Billing Steward + bill-approval queues ·
 * Billing schedule (revrec milestones) · Collections · P&L (with EAC +
 * leakage breakdown).
 *
 * Reads the consolidated /finance/engagement-financials/:engId endpoint
 * for header / action-center / steward / approvals / collections, plus
 * /finance/engagement-pnl/:id for the P&L block and /revrec/milestones
 * for the billing schedule.
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { Card, MonoChip, PillButton, SectionHead } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";

const API = "/api/atelier";

type Rag = "green" | "amber" | "red";

interface FinancialsResp {
  engagement: {
    id: string;
    name: string;
    accountName: string | null;
    pricingModel: string;
    billingModel: string;
    startDate: string | null;
    endDate: string | null;
  };
  header: {
    contractValueUsd: number;
    recognisedRevenueUsd: number;
    billedUsd: number;
    collectedUsd: number;
    pctBilled: number;
    pctCollected: number;
    grossMarginToDatePct: number;
    forecastFinalMarginPct: number;
    ragStatus: Rag;
    eacUsd: number;
    vacUsd: number;
    pctComplete: number;
    plannedManDays: number;
    actualManDays: number;
    elapsedWeeks: number;
    plannedWeeks: number | null;
  };
  leakage: {
    writeOffUsd: number;
    overrunUsd: number;
    realizationLossUsd: number;
    totalUsd: number;
  };
  invoices: Array<{
    id: string;
    invoiceNumber: string | null;
    status: string;
    currency: string;
    total: number;
    amountPaid: number;
    dueDate: string | null;
    issuedAt: string | null;
    paidAt: string | null;
    notes: string | null;
    createdAt: string;
  }>;
  overdueInvoices: Array<{
    id: string;
    invoiceNumber: string | null;
    total: number;
    amountPaid: number;
    dueDate: string | null;
    daysOverdue: number;
  }>;
  collections: {
    arOutstandingUsd: number;
    dsoDays: number;
    aging: {
      current: number;
      d1_30: number;
      d31_60: number;
      d61_90: number;
      d90plus: number;
    };
  };
  acceptances: Array<{
    id: string;
    title: string;
    status: string;
    signedAt: string | null;
  }>;
  stewardQueue: Array<{
    id: string;
    title: string;
    signedAt: string | null;
    milestoneId: string | null;
  }>;
  approvals: {
    pendingLeadApproval: Array<{ id: string; total: number; currency: string; notes: string | null; createdAt: string }>;
    pendingFinanceApproval: Array<{ id: string; total: number; currency: string; notes: string | null; createdAt: string }>;
  };
  actionCenter: Array<{
    id: string;
    severity: "info" | "warn" | "urgent";
    label: string;
    detail: string;
    action:
      | { kind: "run_steward"; engId: string }
      | { kind: "scroll"; targetId: string }
      | { kind: "open_invoice"; invoiceId: string }
      | { kind: "open_pnl_deepdive"; engId: string }
      | null;
    actionLabel: string | null;
  }>;
  permissions: {
    canRunSteward: boolean;
    canLeadApprove: boolean;
    canFinanceApprove: boolean;
  };
}

interface MilestoneRow {
  id: string;
  sequence: number;
  name: string;
  status: string;
  plannedAmount: number | null;
  plannedDate: string | null;
}

const fmtUsd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const SEVERITY_TONE: Record<"info" | "warn" | "urgent", "default" | "amber" | "red"> = {
  info: "default",
  warn: "amber",
  urgent: "red",
};

const RAG_TONE: Record<Rag, "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red",
};

const STATUS_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  draft: "default",
  pending_lead_approval: "amber",
  pending_finance_approval: "amber",
  issued: "gold",
  partial: "amber",
  paid: "green",
  void: "red",
  overdue: "red",
};

export function FinancialsTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const [, setLocation] = useLocation();

  const fin = useQuery<FinancialsResp>({
    queryKey: ["engagement-financials", engId],
    queryFn: async () => {
      const r = await fetch(`${API}/finance/engagement-financials/${engId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`fin_${r.status}`);
      return (await r.json()) as FinancialsResp;
    },
    enabled: !!engId,
  });

  const milestones = useQuery<{ milestones: MilestoneRow[] }>({
    queryKey: ["revrec-milestones", engId],
    queryFn: async () => {
      const r = await fetch(`${API}/revrec/milestones?engagementId=${engId}`, {
        credentials: "include",
      });
      if (!r.ok) return { milestones: [] };
      return (await r.json()) as { milestones: MilestoneRow[] };
    },
    enabled: !!engId,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["engagement-financials", engId] });
    qc.invalidateQueries({ queryKey: ["deliverable-acceptances", engId] });
  }, [qc, engId]);

  const stewardRun = useMutation({
    mutationFn: async () => {
      const r = await fetch(
        `${API}/finance/engagement-financials/${engId}/billing-steward/run`,
        { method: "POST", credentials: "include" },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `steward_${r.status}`);
      return j as { drafted: Array<{ id: string; total: number }>; message: string };
    },
    onSuccess: (j) => {
      toast({ title: "Billing Steward", description: j.message });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Steward failed", description: e.message }),
  });

  const leadApprove = useMutation({
    mutationFn: async (args: { invoiceId: string; rationale: string; evidenceUrl?: string }) => {
      const r = await fetch(
        `${API}/finance/engagement-financials/bills/${args.invoiceId}/lead-approve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rationale: args.rationale, evidenceUrl: args.evidenceUrl }),
        },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `lead_${r.status}`);
      return j;
    },
    onSuccess: () => {
      toast({ title: "Lead approval recorded" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message }),
  });

  const financeApprove = useMutation({
    mutationFn: async (args: { invoiceId: string; rationale: string; evidenceUrl?: string }) => {
      const r = await fetch(
        `${API}/finance/engagement-financials/bills/${args.invoiceId}/finance-approve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rationale: args.rationale, evidenceUrl: args.evidenceUrl }),
        },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `fin_${r.status}`);
      return j;
    },
    onSuccess: () => {
      toast({ title: "Finance approval recorded — bill returned to draft for issuance" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message }),
  });

  if (fin.isLoading) {
    return <Card className="p-6 text-text-mute">Loading financials…</Card>;
  }
  if (fin.isError || !fin.data) {
    return (
      <Card className="p-6 text-danger">
        Failed to load engagement financials.
      </Card>
    );
  }

  const d = fin.data;
  const h = d.header;
  const ms = milestones.data?.milestones ?? [];

  return (
    <div className="space-y-6" data-testid="financials-tab">
      {/* Header strip */}
      <Card className="p-5" data-testid="financials-header">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow={`${d.engagement.accountName ?? ""} · ${d.engagement.billingModel.replace(/_/g, " ")}`}
            headline="Engagement Financials"
            lede="Header strip pulls from canonical revenue / cost / EAC sources. RAG follows the firm's forecast-margin + VAC-slip convention."
          />
          <div className="flex flex-wrap gap-2 items-center">
            <MonoChip tone={RAG_TONE[h.ragStatus]}>RAG · {h.ragStatus}</MonoChip>
            <MonoChip>{d.engagement.billingModel.replace(/_/g, " ")}</MonoChip>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-sm">
          <Stat label="Contract value" value={fmtUsd(h.contractValueUsd)} />
          <Stat
            label="Recognised revenue"
            value={fmtUsd(h.recognisedRevenueUsd)}
            sub={`${fmtPct(h.pctComplete)} complete`}
          />
          <Stat
            label="Billed"
            value={fmtUsd(h.billedUsd)}
            sub={`${fmtPct(h.pctBilled)} of contract`}
          />
          <Stat
            label="Collected"
            value={fmtUsd(h.collectedUsd)}
            sub={`${fmtPct(h.pctCollected)} of contract`}
          />
          <Stat
            label="Margin to date"
            value={fmtPct(h.grossMarginToDatePct)}
            chip={
              <MonoChip
                tone={
                  h.grossMarginToDatePct >= 0.4
                    ? "green"
                    : h.grossMarginToDatePct >= 0.3
                      ? "amber"
                      : "red"
                }
              >
                fc {fmtPct(h.forecastFinalMarginPct)}
              </MonoChip>
            }
          />
          <Stat
            label="Time vs plan"
            value={
              h.plannedWeeks != null
                ? `${h.elapsedWeeks.toFixed(1)} / ${h.plannedWeeks.toFixed(1)} wk`
                : `${h.elapsedWeeks.toFixed(1)} wk`
            }
            sub={`${h.actualManDays} / ${h.plannedManDays} man-days`}
          />
        </div>
      </Card>

      {/* Action Center */}
      {d.actionCenter.length > 0 && (
        <Card className="p-5 border-gold/30" data-testid="action-center">
          <h3 className="mb-3 text-sm font-semibold text-text-mute uppercase tracking-wider">
            Action Center
          </h3>
          <ul className="space-y-2">
            {d.actionCenter.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm" data-testid={`action-item-${a.id}`}>
                <MonoChip tone={SEVERITY_TONE[a.severity]}>{a.severity}</MonoChip>
                <div className="flex-1">
                  <div className="font-semibold">{a.label}</div>
                  <div className="text-text-mute text-xs">{a.detail}</div>
                </div>
                {a.action && a.actionLabel && (
                  <ActionButton
                    item={a}
                    engId={engId}
                    onScroll={(id) =>
                      document
                        .querySelector(`[data-testid="${id}"]`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    onRunSteward={() => stewardRun.mutate()}
                    setLocation={setLocation}
                    busy={stewardRun.isPending}
                    canRunSteward={d.permissions.canRunSteward}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Billing Steward */}
      <Card className="p-5" data-testid="billing-steward">
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-text-mute uppercase tracking-wider">
              Billing Steward
            </h3>
            <p className="text-xs text-text-mute mt-1">
              Auto-drafts a bill from each client-signed deliverable acceptance.
              Two-step approval: Engagement Lead → Finance.
            </p>
          </div>
          <PillButton
            onClick={() => stewardRun.mutate()}
            disabled={!d.permissions.canRunSteward || stewardRun.isPending}
            data-testid="btn-steward-run"
          >
            {stewardRun.isPending ? "Running…" : "Run Billing Steward"}
          </PillButton>
        </div>
        {d.stewardQueue.length === 0 ? (
          <p className="text-xs text-text-mute">
            No signed acceptances waiting to be billed.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.stewardQueue.map((q) => (
              <li key={q.id} className="flex items-center gap-2">
                <MonoChip tone="green">signed</MonoChip>
                <span className="flex-1 truncate">{q.title}</span>
                <span className="text-xs text-text-mute font-mono">
                  {q.signedAt ? new Date(q.signedAt).toLocaleDateString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {(d.approvals.pendingLeadApproval.length > 0 ||
          d.approvals.pendingFinanceApproval.length > 0) && (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <ApprovalQueue
              title="Awaiting Lead approval"
              empty="No bills awaiting Lead."
              rows={d.approvals.pendingLeadApproval}
              actionLabel="Approve as Lead"
              canAct={d.permissions.canLeadApprove}
              busy={leadApprove.isPending}
              onAct={(id, rationale, evidenceUrl) =>
                leadApprove.mutate({ invoiceId: id, rationale, evidenceUrl })
              }
              testid="queue-lead"
            />
            <ApprovalQueue
              title="Awaiting Finance approval"
              empty="No bills awaiting Finance."
              rows={d.approvals.pendingFinanceApproval}
              actionLabel="Approve as Finance"
              canAct={d.permissions.canFinanceApprove}
              busy={financeApprove.isPending}
              onAct={(id, rationale, evidenceUrl) =>
                financeApprove.mutate({ invoiceId: id, rationale, evidenceUrl })
              }
              testid="queue-finance"
            />
          </div>
        )}
      </Card>

      {/* Billing schedule */}
      <Card className="p-5" data-testid="billing-schedule">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-mute uppercase tracking-wider">
            Billing schedule · revenue milestones
          </h3>
          <Link href="/wallet/revrec" className="text-xs text-gold underline">
            Open rev-rec →
          </Link>
        </div>
        {ms.length === 0 ? (
          <p className="text-xs text-text-mute">
            No milestones defined for this engagement.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-text-mute text-xs">
              <tr>
                <th className="py-1 w-10">#</th>
                <th className="py-1">Milestone</th>
                <th className="py-1">Status</th>
                <th className="py-1">Planned</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ms.map((m) => (
                <tr key={m.id} className="border-t border-white/5">
                  <td className="py-2 font-mono text-text-mute">{m.sequence}</td>
                  <td className="py-2">{m.name}</td>
                  <td className="py-2">
                    <MonoChip
                      tone={
                        m.status === "earned" || m.status === "invoiceable"
                          ? "green"
                          : m.status === "client_accepted"
                            ? "gold"
                            : "default"
                      }
                    >
                      {m.status}
                    </MonoChip>
                  </td>
                  <td className="py-2 text-xs text-text-mute font-mono">
                    {m.plannedDate ?? "—"}
                  </td>
                  <td className="py-2 text-right font-mono">
                    {m.plannedAmount != null ? fmtUsd(m.plannedAmount) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Collections */}
      <Card className="p-5" data-testid="collections">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-mute uppercase tracking-wider">
            Collections · invoices
          </h3>
          <Link href="/wallet/invoices" className="text-xs text-gold underline">
            Open invoice ledger →
          </Link>
        </div>
        <div className="mb-3 grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
          <div className="col-span-2">
            <div className="text-text-mute uppercase tracking-wider">AR outstanding</div>
            <div className="font-mono text-base font-semibold">
              {fmtUsd(d.collections.arOutstandingUsd)}
            </div>
            <div className="text-text-mute mt-0.5">DSO {d.collections.dsoDays}d</div>
          </div>
          <AgingCell label="Current" value={d.collections.aging.current} tone="default" />
          <AgingCell label="1–30d" value={d.collections.aging.d1_30} tone="default" />
          <AgingCell label="31–60d" value={d.collections.aging.d31_60} tone="amber" />
          <AgingCell label="61–90d" value={d.collections.aging.d61_90} tone="amber" />
          <AgingCell label="90d+" value={d.collections.aging.d90plus} tone="red" />
        </div>
        {d.overdueInvoices.length > 0 && (
          <div className="mb-3 rounded border border-red-500/40 bg-red-500/5 p-3 text-sm">
            <div className="font-semibold text-red-300">
              {d.overdueInvoices.length} overdue invoice(s)
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-text-mute font-mono">
              {d.overdueInvoices.map((o) => (
                <li key={o.id}>
                  {o.invoiceNumber ?? o.id} · {fmtUsd(o.total - o.amountPaid)} ·{" "}
                  {o.daysOverdue}d overdue
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.invoices.length === 0 ? (
          <p className="text-xs text-text-mute">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-text-mute text-xs">
              <tr>
                <th className="py-1">Invoice</th>
                <th className="py-1">Status</th>
                <th className="py-1">Issued</th>
                <th className="py-1">Due</th>
                <th className="py-1 text-right">Total</th>
                <th className="py-1 text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {d.invoices.map((inv) => (
                <React.Fragment key={inv.id}>
                  <tr id={`bill-${inv.id}`} className="border-t border-white/5">
                    <td className="py-2 font-mono text-xs">
                      <Link href={`/wallet/invoices/${inv.id}`} className="text-gold underline">
                        {inv.invoiceNumber ?? inv.id}
                      </Link>
                    </td>
                    <td className="py-2">
                      <MonoChip tone={STATUS_TONE[inv.status] ?? "default"}>
                        {inv.status.replace(/_/g, " ")}
                      </MonoChip>
                    </td>
                    <td className="py-2 text-xs text-text-mute font-mono">
                      {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2 text-xs text-text-mute font-mono">
                      {inv.dueDate ?? "—"}
                    </td>
                    <td className="py-2 text-right font-mono">{fmtUsd(inv.total)}</td>
                    <td className="py-2 text-right font-mono">{fmtUsd(inv.amountPaid)}</td>
                  </tr>
                  <tr className="border-t border-white/5 bg-white/[0.02]">
                    <td colSpan={6} className="py-2 px-1">
                      <CollectionsActions invoiceId={inv.id} engId={engId} />
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* P&L + leakage */}
      <Card className="p-5" data-testid="pnl-leakage">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-mute uppercase tracking-wider">
            P&amp;L · EAC projection &amp; leakage
          </h3>
          <Link
            href={`/finance/reports/engagement-economics/${engId}`}
            className="text-xs text-gold underline"
          >
            Deep-dive (legacy view) →
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
          <Stat label="EAC (forecast)" value={fmtUsd(h.eacUsd)} />
          <Stat
            label="VAC (variance)"
            value={fmtUsd(h.vacUsd)}
            chip={
              <MonoChip tone={h.vacUsd >= 0 ? "green" : "red"}>
                {h.vacUsd >= 0 ? "under plan" : "over plan"}
              </MonoChip>
            }
          />
          <Stat label="Forecast margin" value={fmtPct(h.forecastFinalMarginPct)} />
          <Stat label="% complete" value={fmtPct(h.pctComplete)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Write-off (forecast)" value={fmtUsd(d.leakage.writeOffUsd)} />
          <Stat label="Cost over-run" value={fmtUsd(d.leakage.overrunUsd)} />
          <Stat label="Realisation loss" value={fmtUsd(d.leakage.realizationLossUsd)} />
          <Stat
            label="Total leakage"
            value={fmtUsd(d.leakage.totalUsd)}
            chip={
              <MonoChip tone={d.leakage.totalUsd > 0 ? "red" : "green"}>
                {d.leakage.totalUsd > 0 ? "exposure" : "clean"}
              </MonoChip>
            }
          />
        </div>
        <p className="mt-3 text-xs text-text-mute">
          Leakage = forecast write-off (BAC vs incurred-against-billed) + EAC over-run
          + unrealised WIP. Drill into the legacy EngagementEconomics view for the
          partner-firm passthrough roll-up, plan-vs-actual by seniority, and the
          Utilisation Analyst commentary.
        </p>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  chip,
}: {
  label: string;
  value: string;
  sub?: string;
  chip?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-text-mute uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{value}</div>
      {chip ? <div className="mt-1">{chip}</div> : null}
      {sub ? <div className="mt-1 text-xs text-text-mute">{sub}</div> : null}
    </div>
  );
}

function ActionButton({
  item,
  engId,
  onScroll,
  onRunSteward,
  setLocation,
  busy,
  canRunSteward,
}: {
  item: FinancialsResp["actionCenter"][number];
  engId: string;
  onScroll: (id: string) => void;
  onRunSteward: () => void;
  setLocation: (path: string) => void;
  busy: boolean;
  canRunSteward: boolean;
}) {
  const a = item.action;
  if (!a || !item.actionLabel) return null;
  const onClick = () => {
    if (a.kind === "run_steward") onRunSteward();
    else if (a.kind === "scroll") onScroll(a.targetId);
    else if (a.kind === "open_invoice")
      setLocation(`/wallet/invoices/${a.invoiceId}`);
    else if (a.kind === "open_pnl_deepdive")
      setLocation(`/finance/reports/engagement-economics/${engId}`);
  };
  const disabled =
    (a.kind === "run_steward" && (busy || !canRunSteward)) || false;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={`action-btn-${item.id}`}
      className="shrink-0 rounded-md border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold hover:bg-gold/20 disabled:opacity-40"
    >
      {a.kind === "run_steward" && busy ? "Running…" : item.actionLabel}
    </button>
  );
}

function AgingCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "amber" | "red";
}) {
  return (
    <div>
      <div className="text-text-mute uppercase tracking-wider">{label}</div>
      <div
        className={
          "font-mono " +
          (tone === "red"
            ? "text-red-300"
            : tone === "amber"
              ? "text-yellow-300"
              : "text-text")
        }
      >
        {fmtUsd(value)}
      </div>
    </div>
  );
}

function ApprovalQueue({
  title,
  empty,
  rows,
  actionLabel,
  canAct,
  busy,
  onAct,
  testid,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; total: number; currency: string; notes: string | null; createdAt: string }>;
  actionLabel: string;
  canAct: boolean;
  busy: boolean;
  onAct: (id: string, rationale: string, evidenceUrl?: string) => void;
  testid: string;
}) {
  return (
    <div data-testid={testid}>
      <div className="text-xs text-text-mute uppercase tracking-wider mb-2">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-mute">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <ApprovalRow
              key={r.id}
              row={r}
              actionLabel={actionLabel}
              canAct={canAct}
              busy={busy}
              onAct={onAct}
              testid={testid}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalRow({
  row,
  actionLabel,
  canAct,
  busy,
  onAct,
  testid,
}: {
  row: { id: string; total: number; currency: string; notes: string | null; createdAt: string };
  actionLabel: string;
  canAct: boolean;
  busy: boolean;
  onAct: (id: string, rationale: string, evidenceUrl?: string) => void;
  testid: string;
}) {
  const [rationale, setRationale] = React.useState("");
  const [evidenceUrl, setEvidenceUrl] = React.useState("");
  return (
    <li className="rounded border border-white/10 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-xs text-text-mute truncate">
          {row.id} · {row.currency} {fmtUsd(row.total)}
        </div>
      </div>
      {row.notes ? (
        <div className="text-xs text-text-mute whitespace-pre-line">{row.notes}</div>
      ) : null}
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Rationale (required) — what did you verify before approving?"
        rows={2}
        className="w-full rounded border border-white/10 bg-black/20 p-2 text-xs"
        data-testid={`input-${testid}-rationale`}
      />
      <input
        value={evidenceUrl}
        onChange={(e) => setEvidenceUrl(e.target.value)}
        placeholder="Evidence URL (optional, e.g. signed acceptance link)"
        className="w-full rounded border border-white/10 bg-black/20 p-2 text-xs font-mono"
        data-testid={`input-${testid}-evidence`}
      />
      <div className="flex justify-end">
        <PillButton
          variant="ghost"
          onClick={() => onAct(row.id, rationale.trim(), evidenceUrl.trim() || undefined)}
          disabled={!canAct || busy || rationale.trim().length === 0}
          data-testid={`btn-${testid}-approve`}
        >
          {actionLabel}
        </PillButton>
      </div>
    </li>
  );
}

/* ────────────────── Collections action row (Task #442) ──────────────────
 * Per-invoice action strip: Send reminder · Log commitment · Mark
 * disputed · Escalate. Each button POSTs to the matching collections
 * endpoint and invalidates the financials query so AR aging + the
 * action center recompute. Uses a small inline form instead of a modal
 * to keep the table readable.
 */
function CollectionsActions({
  invoiceId,
  engId,
}: {
  invoiceId: string;
  engId: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState<
    null | "reminder" | "commitment" | "dispute" | "escalate"
  >(null);
  const [busy, setBusy] = React.useState(false);
  const [reminderMsg, setReminderMsg] = React.useState("");
  const [promisedDate, setPromisedDate] = React.useState("");
  const [promisedAmt, setPromisedAmt] = React.useState("");
  const [commitNote, setCommitNote] = React.useState("");
  const [disputeReason, setDisputeReason] = React.useState("");
  const [escalateNote, setEscalateNote] = React.useState("");

  async function call(
    path: string,
    body: Record<string, unknown>,
    successMsg: string,
  ) {
    setBusy(true);
    try {
      const r = await fetch(
        `${API}/finance/engagement-financials/invoices/${invoiceId}/${path}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `${path}_${r.status}`);
      }
      qc.invalidateQueries({ queryKey: ["engagement-financials", engId] });
      qc.invalidateQueries({
        queryKey: ["engagement-financials-acc", engId],
      });
      setOpen(null);
      setReminderMsg("");
      setPromisedDate("");
      setPromisedAmt("");
      setCommitNote("");
      setDisputeReason("");
      setEscalateNote("");
      toast({ title: "Collections", description: successMsg });
    } catch (e) {
      toast({
        title: "Action failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          type="button"
          className="rounded border border-border-soft px-2 py-1 hover:bg-bg-elevate"
          onClick={() => setOpen(open === "reminder" ? null : "reminder")}
          data-testid={`btn-coll-remind-${invoiceId}`}
        >
          Send reminder
        </button>
        <button
          type="button"
          className="rounded border border-border-soft px-2 py-1 hover:bg-bg-elevate"
          onClick={() => setOpen(open === "commitment" ? null : "commitment")}
          data-testid={`btn-coll-commit-${invoiceId}`}
        >
          Log commitment
        </button>
        <button
          type="button"
          className="rounded border border-amber-500/40 px-2 py-1 text-amber-300 hover:bg-amber-500/10"
          onClick={() => setOpen(open === "dispute" ? null : "dispute")}
          data-testid={`btn-coll-dispute-${invoiceId}`}
        >
          Mark disputed
        </button>
        <button
          type="button"
          className="rounded border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10"
          onClick={() => setOpen(open === "escalate" ? null : "escalate")}
          data-testid={`btn-coll-escalate-${invoiceId}`}
        >
          Escalate
        </button>
      </div>
      {open === "reminder" && (
        <div className="rounded border border-border-soft bg-bg-deep p-2 space-y-2">
          <input
            value={reminderMsg}
            onChange={(e) => setReminderMsg(e.target.value)}
            placeholder="Optional message to include in reminder…"
            className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <PillButton variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              onClick={() =>
                call(
                  "send-reminder",
                  { channel: "email", message: reminderMsg },
                  "Reminder sent.",
                )
              }
              disabled={busy}
            >
              Send
            </PillButton>
          </div>
        </div>
      )}
      {open === "commitment" && (
        <div className="rounded border border-border-soft bg-bg-deep p-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={promisedDate}
              onChange={(e) => setPromisedDate(e.target.value)}
              className="rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"
            />
            <input
              type="number"
              value={promisedAmt}
              onChange={(e) => setPromisedAmt(e.target.value)}
              placeholder="Promised amount (USD)"
              className="rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"
            />
          </div>
          <input
            value={commitNote}
            onChange={(e) => setCommitNote(e.target.value)}
            placeholder="Optional note about who promised what…"
            className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <PillButton variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              onClick={() =>
                call(
                  "log-commitment",
                  {
                    promisedDate,
                    promisedAmountUsd: Number(promisedAmt) || 0,
                    note: commitNote,
                  },
                  "Commitment logged.",
                )
              }
              disabled={busy || !promisedDate}
            >
              Log
            </PillButton>
          </div>
        </div>
      )}
      {open === "dispute" && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 space-y-2">
          <textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="Why is the client disputing this invoice?"
            rows={2}
            className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <PillButton variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              onClick={() =>
                call(
                  "mark-disputed",
                  { reason: disputeReason },
                  "Marked disputed.",
                )
              }
              disabled={busy || !disputeReason.trim()}
            >
              Mark disputed
            </PillButton>
          </div>
        </div>
      )}
      {open === "escalate" && (
        <div className="rounded border border-red-500/40 bg-red-500/5 p-2 space-y-2">
          <textarea
            value={escalateNote}
            onChange={(e) => setEscalateNote(e.target.value)}
            placeholder="Context for founding partners…"
            rows={2}
            className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <PillButton variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              onClick={() =>
                call(
                  "escalate",
                  { note: escalateNote },
                  "Escalated to founding partners.",
                )
              }
              disabled={busy}
            >
              Escalate
            </PillButton>
          </div>
        </div>
      )}
    </div>
  );
}

export default FinancialsTab;
