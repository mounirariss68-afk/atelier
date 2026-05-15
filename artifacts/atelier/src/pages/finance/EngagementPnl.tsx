/**
 * EngagementPnl — per-engagement P&L, EAC engine, change-order register
 * and audit trail (Task #414, Wave 2).
 *
 * Surfaces:
 *   - Header: contract value, BAC, EAC, VAC, forecast vs planned margin
 *   - Cost waterfall: labour cost / expenses / subs vs budget vs incurred
 *   - EAC engine: ETC method (manual override or extrapolation), rationale
 *   - Change-order register with submit / approve / reject actions
 *   - Audit trail of every re-baseline / ETC update
 *
 * Persona-gated writes mirror the server: founding_partner / partner /
 * finance / senior_manager can author and submit; only leadership /
 * finance can approve.
 */
import * as React from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton, BackLink } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Plus, Send, Check, X, Calculator, History } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api/atelier`;

type Rag = "green" | "amber" | "red";
type CoStatus = "draft" | "submitted" | "approved" | "rejected";

interface ChangeOrder {
  id: string;
  engagementId: string;
  number: string;
  description: string;
  valueUsd: number;
  hoursImpact: number;
  costImpactUsd: number;
  status: CoStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  raisedByUserId: string;
  approvedByUserId: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface EacResult {
  contractValueUsd: number;
  bacUsd: number;
  ctdUsd: number;
  etcUsd: number;
  etcMethod: "manual" | "extrapolation";
  eacUsd: number;
  vacUsd: number;
  vacPctOfBac: number;
  forecastFinalMarginPct: number;
  plannedMarginPct: number;
  marginSlippagePct: number;
  pctComplete: number;
  pctBilled: number;
  ragStatus: Rag;
}

interface PnlResp {
  engagementId: string;
  engagementName: string;
  budget: {
    contractValueUsd: number;
    budgetLabourHours: number;
    budgetLabourCostUsd: number;
    budgetExpensesUsd: number;
    budgetSubsUsd: number;
    budgetAtCompletionUsd: number;
    baselinedAt: string;
    sector: string;
  };
  cost: {
    asOf: string;
    labourHoursToDate: number;
    labourCostToDateUsd: number;
    expensesToDateUsd: number;
    subsToDateUsd: number;
    costToDateUsd: number;
    revenueRecognisedToDateUsd: number;
    invoicedToDateUsd: number;
    cashCollectedToDateUsd: number;
    pctComplete: number;
  };
  etc: {
    method: "manual" | "extrapolation";
    manualEtcUsd: number | null;
    rationale: string;
    updatedAt: string;
    updatedByUserId: string | null;
  };
  eac: EacResult;
  derived: {
    grossMarginToDatePct: number;
    wipUsd: number;
    arUsd: number;
    lockupUsd: number;
  };
  people: {
    partnerOwnerId: string;
    partnerOwnerName: string;
    engagementLeadId: string;
    engagementLeadName: string;
  };
  changeOrders: ChangeOrder[];
  audit: Array<{
    id: string;
    at: string;
    actorUserId: string | null;
    action: string;
    detail: string;
  }>;
}

const fmtUsd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPctSigned = (n: number) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const RAG_TONE: Record<Rag, "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red",
};

const CO_TONE: Record<CoStatus, "default" | "gold" | "amber" | "green" | "red"> = {
  draft: "default",
  submitted: "amber",
  approved: "green",
  rejected: "red",
};

export default function EngagementPnl(): JSX.Element {
  const { engagementId } = useParams<{ engagementId: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();

  const role = me?.role ?? "";
  const canWrite =
    role === "founding_partner" ||
    role === "partner" ||
    role === "finance" ||
    role === "senior_manager";
  const canApprove = role === "founding_partner" || role === "partner" || role === "finance";

  const q = useQuery<PnlResp>({
    queryKey: ["finance", "engagement-pnl", engagementId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/finance/engagement-pnl/${engagementId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`pnl_${r.status}`);
      return (await r.json()) as PnlResp;
    },
    enabled: !!engagementId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", engagementId] });
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", "register"] });
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", "summary"] });
  };

  const post = async (path: string, body?: unknown): Promise<unknown> => {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `http_${r.status}`);
    }
    return r.json();
  };

  const [showCoForm, setShowCoForm] = React.useState(false);
  const [showEtcForm, setShowEtcForm] = React.useState(false);

  const submitMut = useMutation({
    mutationFn: (id: string) => post(`/finance/engagement-pnl/change-orders/${id}/submit`),
    onSuccess: () => {
      toast({ title: "Change order submitted" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => post(`/finance/engagement-pnl/change-orders/${id}/approve`),
    onSuccess: () => {
      toast({ title: "Change order approved", description: "Engagement re-baselined." });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: (args: { id: string; reason: string }) =>
      post(`/finance/engagement-pnl/change-orders/${args.id}/reject`, { reason: args.reason }),
    onSuccess: () => {
      toast({ title: "Change order rejected" });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  if (q.isLoading) {
    return (
      <div className="px-6 py-10 max-w-[1280px] mx-auto">
        <div className="font-mono text-sm text-text-mute">Loading engagement P&L…</div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="px-6 py-10 max-w-[1280px] mx-auto">
        <div className="font-mono text-sm text-danger">Failed to load engagement P&L.</div>
        <BackLink href="/finance/plan/engagement-health" className="mt-3">Back to register</BackLink>
      </div>
    );
  }

  const data = q.data;
  const eac = data.eac;

  return (
    <div className="px-6 py-10 max-w-[1280px] mx-auto">
      <BackLink href="/finance/plan/engagement-health">Back to engagement health</BackLink>

      <PageHero className="mt-4">
        <SectionHead
          eyebrow={`Finance · Plan · ${data.budget.sector}`}
          headline={data.engagementName}
          lede={`P&L · EAC engine · change orders. As of ${data.cost.asOf}. Baseline last set ${data.budget.baselinedAt}.`}
        />
      </PageHero>

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="people-strip">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-faint mr-2">Partner owner</span>
          <span className="text-text" data-testid="text-partner-owner">{data.people.partnerOwnerName}</span>
        </div>
        <div>
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-faint mr-2">Delivery lead</span>
          <span className="text-text" data-testid="text-delivery-lead">{data.people.engagementLeadName}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiTile label="Contract value" value={fmtUsd(data.budget.contractValueUsd)} />
        <KpiTile label="BAC" value={fmtUsd(data.budget.budgetAtCompletionUsd)} />
        <KpiTile label="CTD" value={fmtUsd(data.cost.costToDateUsd)} />
        <KpiTile label="EAC" value={fmtUsd(eac.eacUsd)} />
        <KpiTile
          label="VAC"
          value={fmtUsd(eac.vacUsd)}
          tone={eac.vacUsd < 0 ? "red" : eac.vacUsd === 0 ? "default" : "green"}
          sub={fmtPctSigned(eac.vacPctOfBac)}
        />
        <KpiTile
          label="Forecast margin"
          value={fmtPct(eac.forecastFinalMarginPct)}
          tone={eac.ragStatus}
          sub={`plan ${fmtPct(eac.plannedMarginPct)} · ${fmtPctSigned(eac.marginSlippagePct)}`}
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <MonoChip tone={RAG_TONE[eac.ragStatus]} data-testid="chip-eng-rag">
          {eac.ragStatus.toUpperCase()}
        </MonoChip>
        <span className="text-sm text-text-mute">
          {fmtPct(eac.pctComplete)} complete · {fmtPct(eac.pctBilled)} billed
        </span>
      </div>

      {/* Revenue / cash / lockup tiles */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Revenue recognised"
          value={fmtUsd(data.cost.revenueRecognisedToDateUsd)}
          sub={`invoiced ${fmtUsd(data.cost.invoicedToDateUsd)} · cash ${fmtUsd(data.cost.cashCollectedToDateUsd)}`}
          testId="tile-rev-rec"
        />
        <KpiTile
          label="Gross margin to date"
          value={fmtPct(data.derived.grossMarginToDatePct)}
          tone={
            data.derived.grossMarginToDatePct >= 0.40
              ? "green"
              : data.derived.grossMarginToDatePct >= 0.30
                ? "amber"
                : "red"
          }
          sub={`(rev rec − CTD) / rev rec`}
          testId="tile-gm-td"
        />
        <KpiTile
          label="WIP"
          value={fmtUsd(data.derived.wipUsd)}
          sub="recognised but unbilled"
          tone={data.derived.wipUsd > 0 ? "amber" : "default"}
          testId="tile-wip"
        />
        <KpiTile
          label="Lockup"
          value={fmtUsd(data.derived.lockupUsd)}
          sub={`WIP ${fmtUsd(data.derived.wipUsd)} + AR ${fmtUsd(data.derived.arUsd)}`}
          tone={data.derived.lockupUsd > data.budget.contractValueUsd * 0.20 ? "red" : data.derived.lockupUsd > 0 ? "amber" : "default"}
          testId="tile-lockup"
        />
      </div>

      {/* Cost waterfall */}
      <Card className="mt-8 p-6">
        <SectionHead eyebrow="P&L · Cost composition" headline="Budget vs incurred vs forecast" />
        <div className="mt-5 space-y-4">
          <CostBar
            label="Labour (at cost rate)"
            sub={`${data.cost.labourHoursToDate.toLocaleString()} / ${data.budget.budgetLabourHours.toLocaleString()} h`}
            budget={data.budget.budgetLabourCostUsd}
            incurred={data.cost.labourCostToDateUsd}
          />
          <CostBar
            label="Expenses"
            budget={data.budget.budgetExpensesUsd}
            incurred={data.cost.expensesToDateUsd}
          />
          <CostBar
            label="Subcontractors"
            budget={data.budget.budgetSubsUsd}
            incurred={data.cost.subsToDateUsd}
          />
          <div className="border-t border-border-soft pt-4">
            <CostBar
              label="Total cost (BAC vs CTD + ETC = EAC)"
              budget={data.budget.budgetAtCompletionUsd}
              incurred={data.cost.costToDateUsd}
              forecast={eac.etcUsd}
              emphasis
            />
          </div>
        </div>
      </Card>

      {/* EAC engine */}
      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <SectionHead
            eyebrow="EAC engine"
            headline={
              <span className="inline-flex items-center gap-2">
                <Calculator className="w-5 h-5 text-gold" />
                Estimate to Complete
              </span>
            }
          />
          {canWrite && (
            <PillButton
              variant={showEtcForm ? "ghost" : "primary"}
              onClick={() => setShowEtcForm((v) => !v)}
              data-testid="button-toggle-etc"
            >
              {showEtcForm ? "Cancel" : "Update ETC"}
            </PillButton>
          )}
        </div>
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Method</div>
            <div className="mt-1 text-lg font-semibold capitalize">{data.etc.method}</div>
            <div className="mt-1 text-xs text-text-mute">
              {data.etc.method === "manual"
                ? "Lead's bottoms-up estimate."
                : "Extrapolated: CTD × (remaining / done) using % complete."}
            </div>
          </Card>
          <Card className="p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">ETC</div>
            <div className="mt-1 text-lg font-semibold">{fmtUsd(eac.etcUsd)}</div>
            <div className="mt-1 text-xs text-text-mute">CTD {fmtUsd(eac.ctdUsd)} → EAC {fmtUsd(eac.eacUsd)}</div>
          </Card>
          <Card className="p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Last updated</div>
            <div className="mt-1 text-sm">{data.etc.updatedAt.slice(0, 10)}</div>
            <div className="mt-1 text-xs text-text-mute italic">"{data.etc.rationale}"</div>
          </Card>
        </div>

        {showEtcForm && canWrite && (
          <EtcForm
            engagementId={data.engagementId}
            current={data.etc}
            onClose={() => setShowEtcForm(false)}
            onDone={invalidate}
          />
        )}
      </Card>

      {/* Change orders */}
      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <SectionHead eyebrow="Change orders" headline="Register & re-baselining" />
          {canWrite && (
            <PillButton
              onClick={() => setShowCoForm((v) => !v)}
              variant={showCoForm ? "ghost" : "primary"}
              data-testid="button-toggle-co-form"
            >
              {showCoForm ? "Cancel" : (<><Plus className="w-4 h-4 mr-1" /> New change order</>)}
            </PillButton>
          )}
        </div>

        {showCoForm && canWrite && (
          <ChangeOrderForm
            engagementId={data.engagementId}
            onClose={() => setShowCoForm(false)}
            onDone={invalidate}
          />
        )}

        <div className="mt-4 space-y-3">
          {data.changeOrders.length === 0 && (
            <div className="font-mono text-sm text-text-mute">No change orders yet.</div>
          )}
          {data.changeOrders.map((co) => (
            <Card key={co.id} className="p-4" data-testid={`co-row-${co.id}`}>
              <div className="flex flex-wrap items-center gap-3">
                <MonoChip>{co.number}</MonoChip>
                <MonoChip tone={CO_TONE[co.status]}>{co.status.replace("_", " ")}</MonoChip>
                <span className="font-mono text-xs text-text-faint">
                  Δ value {co.valueUsd >= 0 ? "+" : ""}{fmtUsd(co.valueUsd)} · Δ hours {co.hoursImpact >= 0 ? "+" : ""}{co.hoursImpact} · Δ cost {co.costImpactUsd >= 0 ? "+" : ""}{fmtUsd(co.costImpactUsd)}
                </span>
                <div className="ml-auto flex gap-1.5">
                  {co.status === "draft" && canWrite && (
                    <button
                      onClick={() => submitMut.mutate(co.id)}
                      disabled={submitMut.isPending}
                      className="inline-flex items-center gap-1 rounded border border-gold/40 bg-gold/10 hover:bg-gold/20 text-gold text-xs font-mono px-2.5 py-1.5 disabled:opacity-50"
                      data-testid={`button-submit-${co.id}`}
                    >
                      <Send className="w-3 h-3" /> Submit
                    </button>
                  )}
                  {co.status === "submitted" && canApprove && (
                    <>
                      <button
                        onClick={() => approveMut.mutate(co.id)}
                        disabled={approveMut.isPending}
                        className="inline-flex items-center gap-1 rounded border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-mono px-2.5 py-1.5 disabled:opacity-50"
                        data-testid={`button-approve-${co.id}`}
                      >
                        <Check className="w-3 h-3" /> Approve & re-baseline
                      </button>
                      <button
                        onClick={() => {
                          const reason = window.prompt("Rejection reason");
                          if (reason && reason.trim()) {
                            rejectMut.mutate({ id: co.id, reason: reason.trim() });
                          }
                        }}
                        disabled={rejectMut.isPending}
                        className="inline-flex items-center gap-1 rounded border border-border hover:border-danger/50 hover:text-danger text-text-mute text-xs font-mono px-2.5 py-1.5"
                        data-testid={`button-reject-${co.id}`}
                      >
                        <X className="w-3 h-3" /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 text-sm text-text">{co.description}</div>
              {co.rejectionReason && (
                <div className="mt-1 text-xs text-danger">Rejected: {co.rejectionReason}</div>
              )}
              <div className="mt-1 text-[11px] font-mono text-text-faint">
                Created {co.createdAt.slice(0, 10)}
                {co.submittedAt ? ` · submitted ${co.submittedAt.slice(0, 10)}` : ""}
                {co.approvedAt ? ` · approved ${co.approvedAt.slice(0, 10)}` : ""}
              </div>
            </Card>
          ))}
        </div>
      </Card>

      {/* Audit */}
      <Card className="mt-6 p-6">
        <SectionHead
          eyebrow="Audit"
          headline={
            <span className="inline-flex items-center gap-2">
              <History className="w-5 h-5 text-gold" />
              Re-baselines & ETC updates
            </span>
          }
        />
        <div className="mt-4 space-y-2">
          {data.audit.length === 0 && (
            <div className="font-mono text-sm text-text-mute">No audit entries yet.</div>
          )}
          {data.audit.map((a) => (
            <div key={a.id} className="flex flex-wrap items-baseline gap-3 border-l-2 border-gold/40 pl-3 py-1">
              <span className="font-mono text-[11px] text-text-faint">{a.at.slice(0, 16).replace("T", " ")}</span>
              <MonoChip>{a.action}</MonoChip>
              <span className="text-sm text-text">{a.detail}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "green" | "amber" | "red";
  testId?: string;
}): JSX.Element {
  const toneClass =
    tone === "red"
      ? "text-danger"
      : tone === "amber"
      ? "text-amber"
      : tone === "green"
      ? "text-green-400"
      : "text-text";
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] font-mono text-text-faint">{sub}</div>}
    </Card>
  );
}

function CostBar({
  label,
  sub,
  budget,
  incurred,
  forecast = 0,
  emphasis = false,
}: {
  label: string;
  sub?: string;
  budget: number;
  incurred: number;
  forecast?: number;
  emphasis?: boolean;
}): JSX.Element {
  const total = Math.max(budget, incurred + forecast);
  const incurredPct = total > 0 ? (incurred / total) * 100 : 0;
  const forecastPct = total > 0 ? (forecast / total) * 100 : 0;
  const budgetPct = total > 0 ? (budget / total) * 100 : 0;
  const variance = budget - (incurred + forecast);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div>
          <span className={`text-sm ${emphasis ? "font-semibold text-text" : "text-text-mute"}`}>{label}</span>
          {sub && <span className="ml-2 text-[11px] font-mono text-text-faint">{sub}</span>}
        </div>
        <div className={`font-mono text-xs ${emphasis ? "text-text" : "text-text-mute"}`}>
          {fmtUsd(incurred)}
          {forecast > 0 ? ` + ${fmtUsd(forecast)}` : ""} <span className="text-text-faint">/ {fmtUsd(budget)}</span>
          <span className={`ml-2 ${variance < 0 ? "text-danger" : "text-text-faint"}`}>
            {variance >= 0 ? "+" : ""}{fmtUsd(variance)}
          </span>
        </div>
      </div>
      <div className="relative h-2 rounded bg-bg-elevate overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-gold/70" style={{ width: `${incurredPct}%` }} />
        <div
          className="absolute inset-y-0 bg-gold/30"
          style={{ left: `${incurredPct}%`, width: `${forecastPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-text-faint"
          style={{ left: `${budgetPct}%` }}
          title="Budget marker"
        />
      </div>
    </div>
  );
}

function EtcForm({
  engagementId,
  current,
  onClose,
  onDone,
}: {
  engagementId: string;
  current: PnlResp["etc"];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [method, setMethod] = React.useState<"manual" | "extrapolation">(current.method);
  const [manualEtcUsd, setManualEtcUsd] = React.useState(String(current.manualEtcUsd ?? ""));
  const [rationale, setRationale] = React.useState(current.rationale);
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/finance/engagement-pnl/${engagementId}/etc`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          manualEtcUsd: method === "manual" ? Number(manualEtcUsd || 0) : null,
          rationale,
        }),
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "ETC updated" });
      onDone();
      onClose();
    } catch (e) {
      toast({ title: "ETC update failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded border border-border-soft bg-bg-elevate/40 p-4 space-y-3">
      <div className="flex gap-2">
        {(["manual", "extrapolation"] as const).map((m) => (
          <PillButton
            key={m}
            variant={method === m ? "primary" : "ghost"}
            onClick={() => setMethod(m)}
            data-testid={`button-etc-method-${m}`}
          >
            {m === "manual" ? "Manual override" : "Extrapolation"}
          </PillButton>
        ))}
      </div>
      {method === "manual" && (
        <div>
          <label className="font-mono text-[11px] uppercase tracking-wider text-text-faint">ETC (USD)</label>
          <input
            type="number"
            value={manualEtcUsd}
            onChange={(e) => setManualEtcUsd(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm font-mono text-text"
            data-testid="input-etc-amount"
          />
        </div>
      )}
      <div>
        <label className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Rationale</label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm text-text"
          placeholder="Why this ETC? Audit trail entry."
          data-testid="textarea-etc-rationale"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <PillButton variant="ghost" onClick={onClose}>Cancel</PillButton>
        <PillButton onClick={submit} disabled={busy} data-testid="button-save-etc">
          Save & re-forecast
        </PillButton>
      </div>
    </div>
  );
}

function ChangeOrderForm({
  engagementId,
  onClose,
  onDone,
}: {
  engagementId: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [description, setDescription] = React.useState("");
  const [valueUsd, setValueUsd] = React.useState("0");
  const [hoursImpact, setHoursImpact] = React.useState("0");
  const [costImpactUsd, setCostImpactUsd] = React.useState("0");
  const [busy, setBusy] = React.useState(false);
  const { toast } = useToast();

  const submit = async () => {
    if (!description.trim()) {
      toast({ title: "Description required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/finance/engagement-pnl/${engagementId}/change-orders`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          valueUsd: Number(valueUsd || 0),
          hoursImpact: Number(hoursImpact || 0),
          costImpactUsd: Number(costImpactUsd || 0),
        }),
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Change order drafted" });
      onDone();
      onClose();
    } catch (e) {
      toast({ title: "Create failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded border border-border-soft bg-bg-elevate/40 p-4 space-y-3">
      <div>
        <label className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm text-text"
          placeholder="What's changing in scope, timeline or team?"
          data-testid="textarea-co-description"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Δ contract value (USD)</label>
          <input
            type="number"
            value={valueUsd}
            onChange={(e) => setValueUsd(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm font-mono text-text"
            data-testid="input-co-value"
          />
        </div>
        <div>
          <label className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Δ labour hours</label>
          <input
            type="number"
            value={hoursImpact}
            onChange={(e) => setHoursImpact(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm font-mono text-text"
            data-testid="input-co-hours"
          />
        </div>
        <div>
          <label className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Δ cost impact (USD)</label>
          <input
            type="number"
            value={costImpactUsd}
            onChange={(e) => setCostImpactUsd(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm font-mono text-text"
            data-testid="input-co-cost"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <PillButton variant="ghost" onClick={onClose}>Cancel</PillButton>
        <PillButton onClick={submit} disabled={busy} data-testid="button-save-co">
          Draft change order
        </PillButton>
      </div>
    </div>
  );
}
