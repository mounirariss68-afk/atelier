/**
 * EngagementPnl — per-engagement P&L, EAC engine, change-order register
 * and audit trail (Task #414, Wave 2; Task #431).
 *
 * Surfaces:
 *   - Header: contract value, BAC, EAC, VAC, forecast vs planned margin
 *   - Cost waterfall: labour cost / expenses / subs vs budget vs incurred
 *   - EAC engine: ETC method (manual override or extrapolation), rationale
 *   - Change orders register: backed by `atelier_change_order` via
 *     `<ChangeOrdersSection/>`. Posting through that workflow re-baselines
 *     the engagement budget on the server.
 *   - Audit trail of every re-baseline / ETC update
 *
 * Persona-gated writes mirror the server: founding_partner / partner /
 * finance / senior_manager can author and submit; only leadership /
 * finance can approve.
 */
import * as React from "react";
import { useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton, BackLink } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Calculator, History } from "lucide-react";
import { ChangeOrdersSection } from "@/components/tabs/ChangeOrdersSection";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

type Rag = "green" | "amber" | "red";

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
  audit: Array<{
    id: string;
    at: string;
    actorUserId: string | null;
    action: string;
    detail: string;
  }>;
  realization: {
    sold: {
      priceUsd: number;
      hours: number;
      effectiveRateUsd: number;
      marginPct: number;
    } | null;
    delivered: {
      revenueRecognised: number;
      hoursBillable: number;
      effectiveRateUsd: number;
      directCost: number;
      grossMarginPct: number;
    };
    realizationRate: number | null;
    leakage: {
      totalUsd: number;
      rateVarianceUsd: number;
      hoursOverrunUsd: number;
      scopeWriteOffsUsd: number;
      expenseNonRecoveryUsd: number;
    } | null;
    currentBaseline: {
      contractValueUsd: number;
      budgetAtCompletionUsd: number;
      baselinedAt: string;
      postedChangeOrderCount: number;
      postedChangeOrderValueUsd: number;
    } | null;
  } | null;
}

interface AuditEntry {
  id: string;
  engagementId: string;
  at: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  detail: string;
}

interface AuditResp {
  engagementId: string;
  items: AuditEntry[];
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

export default function EngagementPnl(): React.ReactElement {
  const { engagementId } = useParams<{ engagementId: string }>();
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();

  const role = me?.role ?? "";
  const canWrite =
    role === "founding_partner" ||
    role === "partner" ||
    role === "finance" ||
    role === "senior_manager";

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

  const auditQ = useQuery<AuditResp>({
    queryKey: ["finance", "engagement-pnl", engagementId, "audit"],
    queryFn: async () => {
      const r = await fetch(
        `${API_BASE}/finance/engagement-pnl/${engagementId}/audit`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      if (!r.ok) throw new Error(`audit_${r.status}`);
      return (await r.json()) as AuditResp;
    },
    enabled: !!engagementId,
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", engagementId] });
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", engagementId, "audit"] });
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", "register"] });
    qc.invalidateQueries({ queryKey: ["finance", "engagement-pnl", "summary"] });
  }, [qc, engagementId]);

  // When the change-orders panel mutates state (most importantly: a
  // Finance user posts a CO, which re-baselines the budget on the
  // server), refresh the P&L payload so the new contract value / EAC /
  // VAC tiles update.
  React.useEffect(() => {
    const unsub = qc.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "invalidate") {
        const key = event.query.queryKey;
        if (Array.isArray(key) && key[0] === "change-orders" && key[1] === engagementId) {
          invalidate();
        }
      }
    });
    return () => unsub();
  }, [qc, engagementId, invalidate]);

  const [showEtcForm, setShowEtcForm] = React.useState(false);

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
    <div>
      <PageHero>
        <BackLink href="/finance/plan/engagement-health" className="mb-4">Back to engagement health</BackLink>
        <SectionHead
          eyebrow={`Finance · Plan · ${data.budget.sector}`}
          headline={data.engagementName}
          lede={`P&L · EAC engine · change orders. As of ${data.cost.asOf}. Baseline last set ${data.budget.baselinedAt.slice(0, 10)}.`}
        />
      </PageHero>
      <div className="px-6 py-10 max-w-[1280px] mx-auto">

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

      {data.realization && (
        <Card className="mt-6 p-6" data-testid="engagement-realization-card">
          <SectionHead
            eyebrow="Commercial realization"
            headline="Sold versus delivered"
            lede="The original signed position stays fixed. Posted change orders update the current operating baseline without rewriting it."
          />
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile
              label="Original sold"
              value={fmtUsd(data.realization.sold?.priceUsd ?? 0)}
              sub={`${(data.realization.sold?.hours ?? 0).toLocaleString()}h · ${fmtUsd(data.realization.sold?.effectiveRateUsd ?? 0)}/h`}
            />
            <KpiTile
              label="Current baseline"
              value={fmtUsd(data.realization.currentBaseline?.contractValueUsd ?? data.budget.contractValueUsd)}
              sub={`${data.realization.currentBaseline?.postedChangeOrderCount ?? 0} posted changes · ${fmtUsd(data.realization.currentBaseline?.postedChangeOrderValueUsd ?? 0)}`}
            />
            <KpiTile
              label="Realization"
              value={data.realization.realizationRate == null ? "—" : fmtPct(data.realization.realizationRate)}
              sub={`${fmtUsd(data.realization.delivered.revenueRecognised)} recognized`}
            />
            <KpiTile
              label="Total leakage"
              value={fmtUsd(data.realization.leakage?.totalUsd ?? 0)}
              tone={(data.realization.leakage?.totalUsd ?? 0) > 0 ? "red" : "green"}
              sub="rate · hours · write-offs · expenses"
            />
          </div>
          {data.realization.leakage && (
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <LeakageItem label="Rate variance" value={data.realization.leakage.rateVarianceUsd} />
              <LeakageItem label="Hours overrun" value={data.realization.leakage.hoursOverrunUsd} />
              <LeakageItem label="Scope write-offs" value={data.realization.leakage.scopeWriteOffsUsd} />
              <LeakageItem label="Expense non-recovery" value={data.realization.leakage.expenseNonRecoveryUsd} />
            </div>
          )}
        </Card>
      )}

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

      {/* Change orders — backed by atelier_change_order workflow.
          Finance "Post" re-baselines the engagement budget server-side. */}
      <div className="mt-6">
        <ChangeOrdersSection engId={data.engagementId} />
      </div>

      {/* Audit timeline — change-order workflow + ETC overrides + re-baselines.
          Sourced from a dedicated /audit endpoint with actor names resolved. */}
      <Card className="mt-6 p-6" data-testid="card-audit-timeline">
        <SectionHead
          eyebrow="Audit"
          headline={
            <span className="inline-flex items-center gap-2">
              <History className="w-5 h-5 text-gold" />
              Change-order timeline
            </span>
          }
          lede="Every re-baseline, ETC override and change-order state change for this engagement, newest first."
        />
        <div className="mt-4">
          {auditQ.isLoading && (
            <div className="font-mono text-sm text-text-mute">Loading timeline…</div>
          )}
          {auditQ.isError && (
            <div className="font-mono text-sm text-danger">Failed to load audit timeline.</div>
          )}
          {auditQ.data && auditQ.data.items.length === 0 && (
            <div className="font-mono text-sm text-text-mute">No audit entries yet.</div>
          )}
          {auditQ.data && auditQ.data.items.length > 0 && (
            <ol className="space-y-3" data-testid="list-audit-timeline">
              {auditQ.data.items.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-gold/40 pl-3 py-1"
                  data-testid={`audit-row-${a.id}`}
                >
                  <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
                    {a.at.slice(0, 16).replace("T", " ")}
                  </span>
                  <MonoChip>{a.action}</MonoChip>
                  <span className="text-sm text-text flex-1 min-w-[12rem]">{a.detail}</span>
                  <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
                    by {a.actorName}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
      </div>
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
}): React.ReactElement {
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

function LeakageItem({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-lg border border-border-soft px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">{label}</div>
      <div className={value > 0 ? "mt-1 font-semibold text-danger" : "mt-1 font-semibold text-text"}>
        {fmtUsd(value)}
      </div>
    </div>
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
}): React.ReactElement {
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
}): React.ReactElement {
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
