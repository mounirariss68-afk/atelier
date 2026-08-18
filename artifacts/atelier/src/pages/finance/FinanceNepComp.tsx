/**
 * FinanceNepComp — Task #1298: non-salaried NEP compensation.
 *
 * Founder/HR/Finance surface for effective-dated NEP comp plans (day rate,
 * margin-share tiers, origination window, conversion thresholds), the
 * per-engagement margin-share entitlement statements, and the rolling
 * 12-month conversion tracker. Writes are founder/Finance only (server
 * enforced). Entitlements are never auto-paid: approval here only queues
 * them for the maker-checker payment-run build in Pay.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListNepCompPlans,
  getAtelierListNepCompPlansQueryKey,
  useAtelierCreateNepCompPlan,
  useAtelierGetNepCompPlanDetail,
  getAtelierGetNepCompPlanDetailQueryKey,
  useAtelierConvertNepCompPlan,
  useAtelierEndNepCompPlan,
  useAtelierRecomputeNepEntitlements,
  useAtelierAcceptNepEntitlement,
  useAtelierApproveNepEntitlement,
  useAtelierVoidNepEntitlement,
  type AtelierNepCompPlan,
  type AtelierNepEntitlement,
} from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton, Eyebrow } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { RefreshCw, Plus, CheckCircle2, XCircle, HandCoins, TrendingUp } from "lucide-react";

const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

const STATUS_TONE: Record<string, string> = {
  accruing: "text-text-faint",
  payable: "text-amber-500",
  approved: "text-sky-500",
  scheduled: "text-indigo-400",
  paid: "text-emerald-500",
  void: "text-text-faint line-through",
};

function StatementCard({ e }: { e: AtelierNepEntitlement }) {
  const stmt = e.statement as
    | { lines?: Array<{ kind: string; label: string; amountUsd: number }>; tierReason?: string }
    | null
    | undefined;
  return (
    <div className="mt-2 rounded-md border border-border bg-surface-2 p-3 text-xs">
      {(stmt?.lines ?? []).map((l) => (
        <div key={l.kind} className={`flex justify-between py-0.5 ${l.kind === "project_profit" || l.kind === "margin_share" ? "font-semibold border-t border-border mt-1 pt-1" : ""}`}>
          <span>{l.label}</span>
          <span className="font-mono">{usd(l.amountUsd)}</span>
        </div>
      ))}
      {stmt?.tierReason ? <p className="mt-2 text-text-faint">{stmt.tierReason}</p> : null}
    </div>
  );
}

function PlanForm({ contractorId, onDone }: { contractorId?: string; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useAtelierCreateNepCompPlan();
  const [f, setF] = React.useState({
    contractorId: contractorId ?? "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    currency: "USD",
    dayRateAmount: "",
    marginSharePctSale: "20",
    marginSharePctOriginationOnly: "10",
    originationWindowMonths: "24",
    conversionRevenueThresholdUsd: "2000000",
    conversionMarginThresholdPct: "40",
    postConversionSalaryAmount: "",
    notes: "",
  });
  const set = (k: string) => (ev: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: ev.target.value }));
  const submit = () => {
    create.mutate(
      {
        data: {
          contractorId: f.contractorId.trim(),
          effectiveFrom: f.effectiveFrom,
          currency: f.currency,
          dayRateAmount: Number(f.dayRateAmount),
          marginSharePctSale: Number(f.marginSharePctSale),
          marginSharePctOriginationOnly: Number(f.marginSharePctOriginationOnly),
          originationWindowMonths: Number(f.originationWindowMonths),
          conversionRevenueThresholdUsd: Number(f.conversionRevenueThresholdUsd),
          conversionMarginThresholdPct: Number(f.conversionMarginThresholdPct),
          postConversionSalaryAmount: f.postConversionSalaryAmount ? Number(f.postConversionSalaryAmount) : null,
          postConversionSalaryCurrency: f.postConversionSalaryAmount ? f.currency : null,
          notes: f.notes || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Plan saved", description: "Day rate synced to the contractor roster row." });
          void qc.invalidateQueries({ queryKey: getAtelierListNepCompPlansQueryKey() });
          onDone();
        },
        onError: (err: unknown) =>
          toast({ title: "Could not save plan", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
      },
    );
  };
  const fields: Array<[string, keyof typeof f]> = [
    ["Contractor ID", "contractorId"],
    ["Effective from (YYYY-MM-DD)", "effectiveFrom"],
    ["Currency", "currency"],
    ["Day rate", "dayRateAmount"],
    ["Margin share % — originated + material contribution", "marginSharePctSale"],
    ["Margin share % — origination only", "marginSharePctOriginationOnly"],
    ["Origination window (months)", "originationWindowMonths"],
    ["Conversion revenue threshold (USD, rolling 12m)", "conversionRevenueThresholdUsd"],
    ["Conversion margin threshold (%)", "conversionMarginThresholdPct"],
    ["Post-conversion salary (optional)", "postConversionSalaryAmount"],
    ["Notes", "notes"],
  ];
  return (
    <Card className="p-4">
      <SectionHead headline="New plan / revision" lede="Effective-dated: a new row with a later effective date revises terms without losing history." />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map(([label, key]) => (
          <label key={key} className="text-xs">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-faint">{label}</span>
            <Input value={f[key]} onChange={set(key)} disabled={key === "contractorId" && Boolean(contractorId)} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <PillButton onClick={submit} disabled={create.isPending}>
          <Plus className="h-3.5 w-3.5" /> Save plan
        </PillButton>
        <PillButton variant="ghost" onClick={onDone}>Cancel</PillButton>
      </div>
    </Card>
  );
}

function ContractorDetail({ contractorId }: { contractorId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useAtelierGetNepCompPlanDetail(contractorId);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierGetNepCompPlanDetailQueryKey(contractorId) });
    void qc.invalidateQueries({ queryKey: getAtelierListNepCompPlansQueryKey() });
  };
  const onErr = (err: unknown) =>
    toast({ title: "Action failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
  const recompute = useAtelierRecomputeNepEntitlements();
  const accept = useAtelierAcceptNepEntitlement();
  const approve = useAtelierApproveNepEntitlement();
  const voidEnt = useAtelierVoidNepEntitlement();
  const convert = useAtelierConvertNepCompPlan();
  const end = useAtelierEndNepCompPlan();
  const [revising, setRevising] = React.useState(false);

  if (isLoading) return <Card className="p-4 text-sm text-text-faint">Loading…</Card>;
  if (!data) return <Card className="p-4 text-sm text-text-faint">No plan found.</Card>;
  const plan = data.currentPlan ?? null;
  const conv = data.conversion ?? null;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionHead
          headline={`${data.contractor.fullName} — plan terms`}
          lede={plan ? `Effective ${plan.effectiveFrom} · status ${plan.status}` : "No effective plan"}
        />
        {plan ? (
          <div className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between"><span className="text-text-faint">Charge-out day rate</span><span className="font-mono">{plan.currency} {plan.dayRateAmount.toLocaleString()}/day</span></div>
            <div className="flex justify-between"><span className="text-text-faint">Margin share — sale tier</span><span className="font-mono">{pct(plan.marginSharePctSale)}</span></div>
            <div className="flex justify-between"><span className="text-text-faint">Margin share — origination only</span><span className="font-mono">{pct(plan.marginSharePctOriginationOnly)}</span></div>
            <div className="flex justify-between"><span className="text-text-faint">Origination window</span><span className="font-mono">{plan.originationWindowMonths} months</span></div>
            <div className="flex justify-between"><span className="text-text-faint">Conversion revenue threshold</span><span className="font-mono">{usd(plan.conversionRevenueThresholdUsd)} / rolling 12m</span></div>
            <div className="flex justify-between"><span className="text-text-faint">Conversion margin threshold</span><span className="font-mono">{pct(plan.conversionMarginThresholdPct)}</span></div>
            <div className="flex justify-between"><span className="text-text-faint">Post-conversion salary</span><span className="font-mono">{plan.postConversionSalaryAmount ? `${plan.postConversionSalaryCurrency ?? plan.currency} ${plan.postConversionSalaryAmount.toLocaleString()}/yr` : "agreed at conversion"}</span></div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <PillButton onClick={() => setRevising((v) => !v)}><Plus className="h-3.5 w-3.5" /> Revise terms</PillButton>
          <PillButton
            variant="ghost"
            disabled={recompute.isPending}
            onClick={() => recompute.mutate({ data: { contractorId } }, { onSuccess: invalidate, onError: onErr })}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recompute entitlements
          </PillButton>
          {plan?.status === "pre_conversion" ? (
            <PillButton
              variant="ghost"
              disabled={convert.isPending}
              onClick={() => {
                if (!window.confirm("Mark this NEP as CONVERTED to employment? New engagements stop accruing margin share; employment comp takes over.")) return;
                convert.mutate({ contractorId, data: {} }, { onSuccess: invalidate, onError: onErr });
              }}
            >
              <TrendingUp className="h-3.5 w-3.5" /> Mark converted
            </PillButton>
          ) : null}
          {plan?.status !== "ended" ? (
            <PillButton
              variant="ghost"
              disabled={end.isPending}
              onClick={() => {
                if (!window.confirm("End this NEP compensation plan?")) return;
                end.mutate({ contractorId, data: {} }, { onSuccess: invalidate, onError: onErr });
              }}
            >
              <XCircle className="h-3.5 w-3.5" /> End plan
            </PillButton>
          ) : null}
        </div>
      </Card>

      {revising ? <PlanForm contractorId={contractorId} onDone={() => { setRevising(false); invalidate(); }} /> : null}

      {conv ? (
        <Card className="p-4">
          <SectionHead headline="Conversion tracker" lede={`Rolling 12 months ${conv.windowStart} → ${conv.windowEnd}`} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-text-faint">Attributable revenue (collected)</div>
              <div className="mt-1 font-mono text-lg">{usd(conv.attributableRevenueUsd)}</div>
              <div className={`mt-1 text-xs ${conv.revenueMet ? "text-emerald-500" : "text-text-faint"}`}>
                threshold {usd(conv.revenueThresholdUsd)} — {conv.revenueMet ? "met" : "not met"}
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-text-faint">Realised delivered gross margin</div>
              <div className="mt-1 font-mono text-lg">{conv.realisedMarginPct == null ? "—" : pct(conv.realisedMarginPct)}</div>
              <div className={`mt-1 text-xs ${conv.marginMet ? "text-emerald-500" : "text-text-faint"}`}>
                threshold {pct(conv.marginThresholdPct)} — {conv.marginMet ? "met" : "not met"}
              </div>
            </div>
          </div>
          {conv.bothMet ? (
            <p className="mt-3 rounded-md border border-emerald-600/40 bg-emerald-500/10 p-2 text-sm text-emerald-500">
              Both thresholds met — conversion to full-time employment may be initiated (manual Conversion Addendum).
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-4">
        <SectionHead headline="Margin-share entitlements" lede="One statement per attributable engagement. Payable only after full fee collection AND recorded client acceptance; due 30 days after the later of the two. Approval queues the item for the next payment run — never auto-paid." />
        <div className="mt-3 space-y-3">
          {(data.entitlements ?? []).length === 0 ? (
            <p className="text-sm text-text-faint">No entitlements yet — recompute after engagements are invoiced.</p>
          ) : null}
          {(data.entitlements ?? []).map((e) => (
            <div key={e.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">{e.engagementName ?? e.engagementId}</span>
                  <span className="ml-2 text-xs text-text-faint">{e.accountName ?? ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MonoChip>{e.tier === "sale" ? `sale ${e.tierPct}%` : e.tier === "origination_only" ? `origination ${e.tierPct}%` : "no tier"}</MonoChip>
                  <span className={`font-mono text-sm ${STATUS_TONE[e.status] ?? ""}`}>{e.status}</span>
                  <span className="font-mono text-sm font-semibold">{usd(e.amountUsd)}</span>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-text-faint">
                <span>collected: {e.fullyCollected ? "yes" : "no"}</span>
                <span>accepted: {e.clientAcceptedAt ? new Date(e.clientAcceptedAt).toLocaleDateString() : "no"}</span>
                {e.dueDate ? <span>due: {e.dueDate}</span> : null}
                {e.paidAt ? <span>paid: {new Date(e.paidAt).toLocaleDateString()} ({e.remittanceRef ?? "—"})</span> : null}
              </div>
              <StatementCard e={e} />
              <div className="mt-2 flex gap-2">
                {!e.clientAcceptedAt && e.status !== "void" && e.status !== "paid" ? (
                  <PillButton variant="ghost" disabled={accept.isPending} onClick={() => accept.mutate({ id: e.id }, { onSuccess: invalidate, onError: onErr })}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Record client acceptance
                  </PillButton>
                ) : null}
                {e.status === "payable" ? (
                  <PillButton disabled={approve.isPending} onClick={() => approve.mutate({ id: e.id }, { onSuccess: invalidate, onError: onErr })}>
                    <HandCoins className="h-3.5 w-3.5" /> Approve for payment run
                  </PillButton>
                ) : null}
                {e.status === "accruing" || e.status === "payable" || e.status === "approved" ? (
                  <PillButton
                    variant="ghost"
                    disabled={voidEnt.isPending}
                    onClick={() => {
                      const reason = window.prompt("Reason for voiding this entitlement?");
                      if (reason == null) return;
                      voidEnt.mutate({ id: e.id, data: { reason } }, { onSuccess: invalidate, onError: onErr });
                    }}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Void
                  </PillButton>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <SectionHead headline="Plan history" lede="Every effective-dated revision, newest first." />
        <div className="mt-2 divide-y divide-border text-sm">
          {(data.planHistory ?? []).map((p: AtelierNepCompPlan) => (
            <div key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-mono text-xs">{p.effectiveFrom}</span>
              <span>{p.currency} {p.dayRateAmount.toLocaleString()}/day · {p.marginSharePctSale}% / {p.marginSharePctOriginationOnly}% · window {p.originationWindowMonths}m</span>
              <MonoChip>{p.status}</MonoChip>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function FinanceNepComp() {
  const { data, isLoading, error } = useAtelierListNepCompPlans();
  // Task #1298 — deep-link from the roster person page:
  // /finance/nep-comp?contractorId=<id> preselects that contractor.
  const initialContractor = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("contractorId");
    } catch {
      return null;
    }
  }, []);
  const [selected, setSelected] = React.useState<string | null>(initialContractor);
  const [creating, setCreating] = React.useState(false);
  const plans = data?.items ?? [];
  const contractors = React.useMemo(() => {
    const m = new Map<string, { id: string; name: string; status: string }>();
    for (const p of plans) {
      if (!m.has(p.contractorId)) m.set(p.contractorId, { id: p.contractorId, name: p.contractorName ?? p.contractorId, status: p.status });
    }
    return [...m.values()];
  }, [plans]);
  React.useEffect(() => {
    if (!selected && contractors.length > 0) setSelected(contractors[0].id);
  }, [contractors, selected]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <PageHero>
        <Eyebrow>Manage · Finance · NEP Comp</Eyebrow>
        <h1 className="headline mt-3">NEP compensation</h1>
        <p className="lede mt-3 max-w-3xl">
          Origination-based, non-salaried compensation for non-equity partners:
          charge-out time charges, margin share on Project Profit, and the
          conversion-to-employment tracker.
        </p>
      </PageHero>
      {error ? (
        <Card className="p-4 text-sm text-destructive">NEP compensation is visible to founders, HR and Finance only.</Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {contractors.map((c) => (
              <PillButton key={c.id} variant={selected === c.id ? undefined : "ghost"} onClick={() => setSelected(c.id)}>
                {c.name} <MonoChip>{c.status}</MonoChip>
              </PillButton>
            ))}
            <PillButton variant="ghost" onClick={() => setCreating((v) => !v)}>
              <Plus className="h-3.5 w-3.5" /> New NEP plan
            </PillButton>
          </div>
          {creating ? <PlanForm onDone={() => setCreating(false)} /> : null}
          {isLoading ? <Card className="p-4 text-sm text-text-faint">Loading…</Card> : null}
          {!isLoading && contractors.length === 0 && !creating ? (
            <Card className="p-4 text-sm text-text-faint">No NEP compensation plans yet. Create one with “New NEP plan”.</Card>
          ) : null}
          {selected ? <ContractorDetail contractorId={selected} /> : null}
        </>
      )}
    </div>
  );
}
