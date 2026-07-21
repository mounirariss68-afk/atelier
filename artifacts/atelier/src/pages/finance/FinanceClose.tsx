/**
 * FinanceClose — period close workflow UI (Task #432).
 *
 * Per legal entity: monthly / quarterly / yearly close cycles with the
 * Close Controller's phased checklist (auto-checks + manual items),
 * approval-gated accrual proposals, the two-distinct-partner sign-off
 * that locks the period, and the year-end retained-earnings rollover.
 *
 * Raw fetch (finance-page convention, see BillingWorklist.tsx) — the
 * bespoke close routes are not in the OpenAPI spec.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton, Eyebrow } from "@/components/ui/primitives";
import { useFinanceEntities } from "@/lib/v5-hooks";
import { useToast } from "@/hooks/use-toast";
import { Lock, Unlock, PlayCircle, CheckCircle2, XCircle, AlertTriangle, RefreshCw, BookOpenCheck } from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

async function jfetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new Error(b?.message || b?.error || `HTTP ${res.status}`);
  }
  return body;
}

interface CycleRow {
  id: string;
  entityId: string;
  periodType: "month" | "quarter" | "year";
  periodLabel: string;
  status: string;
  firstSignoffUserId: string | null;
  secondSignoffUserId: string | null;
  signedOffAt: string | null;
  summary: {
    itemsPassed?: number;
    itemsBlocked?: number;
    itemsManualOpen?: number;
    readyForSignoff?: boolean;
    blockers?: Array<{ itemKey: string; title: string; message: string }>;
    lastControllerRunAt?: string;
  } | null;
}
interface ItemRow {
  id: string;
  phase: string;
  itemKey: string;
  title: string;
  ownerRole: string;
  status: string;
  autoCheck: boolean;
  detail: { message?: string } | null;
  note: string | null;
  lastCheckedAt: string | null;
}
interface AccrualRow {
  id: string;
  memo: string;
  rationaleText: string;
  currency: string;
  amount: number;
  status: string;
  journalEntryId: string | null;
  lines: Array<{ accountCode: string; debit: number; credit: number; memo?: string }>;
}
interface CycleDetail {
  cycle: CycleRow;
  items: ItemRow[];
  accruals: AccrualRow[];
  lock: { lockedModules: string[]; lockedAt: string } | null;
}

const PHASES: Array<{ key: string; label: string }> = [
  { key: "pre_close", label: "Pre-close" },
  { key: "execution", label: "Execution" },
  { key: "post_close", label: "Post-close" },
];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function defaultPeriodFor(t: "month" | "quarter" | "year"): string {
  const now = new Date();
  if (t === "month") return currentMonth();
  if (t === "quarter") return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  return String(now.getFullYear());
}

function statusChip(status: string) {
  if (status === "signed_off") return <MonoChip tone="default">signed off</MonoChip>;
  if (status === "ready") return <MonoChip tone="gold">ready</MonoChip>;
  return <MonoChip tone="amber">open</MonoChip>;
}
function itemIcon(status: string) {
  if (status === "done" || status === "na") return <CheckCircle2 className="w-3.5 h-3.5 text-gold shrink-0" />;
  if (status === "blocked") return <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  return <XCircle className="w-3.5 h-3.5 text-text-faint shrink-0" />;
}

export default function FinanceClose() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const meQ = useAtelierGetMe();
  const me = (meQ.data as { data?: { role?: string } } | undefined)?.data;
  const isPartner = me?.role === "founding_partner" || me?.role === "partner";
  const entities = useFinanceEntities();
  const [entityId, setEntityId] = React.useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("entity") ?? "";
  });
  const entity = entities.find((e) => e.id === entityId) ?? entities[0];
  const [periodType, setPeriodType] = React.useState<"month" | "quarter" | "year">("month");
  const [newPeriod, setNewPeriod] = React.useState<string>(defaultPeriodFor("month"));
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const cyclesQ = useQuery({
    queryKey: ["close-cycles", entity?.id],
    enabled: !!entity,
    queryFn: async () =>
      (await jfetch(`/close/cycles?entityId=${entity!.id}`)) as { data: { rows: CycleRow[] } },
  });
  const cycles = cyclesQ.data?.data.rows ?? [];
  const selected = cycles.find((c) => c.id === selectedId) ?? cycles[0];

  const detailQ = useQuery({
    queryKey: ["close-cycle", selected?.id],
    enabled: !!selected,
    queryFn: async () => (await jfetch(`/close/cycles/${selected!.id}`)) as { data: CycleDetail },
  });
  const detail = detailQ.data?.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["close-cycles"] });
    void qc.invalidateQueries({ queryKey: ["close-cycle"] });
    void qc.invalidateQueries({ queryKey: ["collections-drafts"] });
  };
  const act = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    try {
      await fn();
      toast({ title: okMsg });
      refresh();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const startCycle = () =>
    act("start", async () => {
      const out = (await jfetch("/close/cycles", {
        method: "POST",
        body: JSON.stringify({ entityId: entity!.id, periodType, periodLabel: newPeriod.trim() }),
      })) as { data: { id: string } };
      setSelectedId(out.data.id);
    }, `Close cycle ${newPeriod} started`);

  return (
    <div className="animate-in fade-in" data-testid="page-finance-close">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Close"
          headline="Period close"
          lede="Per-entity close cycles — the Close Controller runs deterministic checks, proposes approval-gated accruals, and two distinct partners sign off to lock the period."
        />
        {entities.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2" data-testid="close-entity-picker">
            {entities.map((e) => (
              <button
                key={e.id}
                onClick={() => { setEntityId(e.id); setSelectedId(null); }}
                className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                  entity?.id === e.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
                }`}
                data-testid={`close-entity-${e.id}`}
              >
                {e.shortName}
              </button>
            ))}
          </div>
        )}
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {entities.length === 0 ? (
          <Card className="p-10 text-center" data-testid="finance-close-empty">
            <Lock className="w-6 h-6 text-text-faint mx-auto" />
            <div className="text-sm text-text mt-3">No legal entities yet</div>
            <p className="text-xs text-text-mute mt-2 max-w-md mx-auto">
              Set up legal entities in the registry first — close cycles are opened per entity and period.
            </p>
            <div className="mt-4"><Eyebrow>Set up legal entities first</Eyebrow></div>
          </Card>
        ) : (
          <>
            {/* Start a cycle */}
            <Card className="p-4" data-testid="close-start-panel">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">Period type</div>
                  <div className="flex gap-1">
                    {(["month", "quarter", "year"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => { setPeriodType(t); setNewPeriod(defaultPeriodFor(t)); }}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-widest ${periodType === t ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"}`}
                        data-testid={`close-ptype-${t}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">
                    Period ({periodType === "month" ? "YYYY-MM" : periodType === "quarter" ? "YYYY-Qn" : "YYYY"})
                  </div>
                  <input
                    value={newPeriod}
                    onChange={(e) => setNewPeriod(e.target.value)}
                    className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-xs font-mono text-text w-28"
                    data-testid="input-close-period"
                  />
                </div>
                <PillButton onClick={startCycle} disabled={busy !== null || !entity} data-testid="button-start-close">
                  <PlayCircle className="w-3.5 h-3.5 mr-1" /> Start close
                </PillButton>
              </div>
            </Card>

            <div className="grid lg:grid-cols-3 gap-4">
              {/* Cycle list */}
              <Card className="p-4" data-testid="close-cycle-list">
                <div className="text-xs font-mono uppercase tracking-widest text-text-faint mb-3">
                  Cycles · {entity?.shortName}
                </div>
                {cycles.length === 0 ? (
                  <div className="text-xs text-text-mute italic py-4">No close cycles yet for this entity.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {cycles.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => setSelectedId(c.id)}
                          className={`w-full text-left border rounded p-2 text-xs transition-colors ${selected?.id === c.id ? "border-gold/60 bg-bg-elevate" : "border-border-soft hover:bg-bg-elevate"}`}
                          data-testid={`close-cycle-${c.periodLabel}`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-text">{c.periodLabel}</span>
                            {statusChip(c.status)}
                          </div>
                          <div className="text-[10px] text-text-faint font-mono mt-0.5">
                            {c.periodType} · {c.summary?.itemsBlocked != null
                              ? `${c.summary.itemsBlocked} blocked · ${c.summary.itemsManualOpen ?? 0} manual open`
                              : "controller not run yet"}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Cycle detail */}
              <div className="lg:col-span-2 space-y-4">
                {!detail ? (
                  <Card className="p-8 text-center text-xs text-text-mute" data-testid="close-detail-empty">
                    {cycles.length === 0 ? "Start a close cycle to see its checklist here." : "Select a cycle."}
                  </Card>
                ) : (
                  <>
                    <Card className="p-4" data-testid="close-detail-head">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-text font-mono">
                            {detail.cycle.periodLabel} <span className="text-text-faint">· {detail.cycle.periodType} close</span>
                          </div>
                          <div className="text-[11px] text-text-mute mt-0.5">
                            {detail.cycle.status === "signed_off"
                              ? `Signed off ${detail.cycle.signedOffAt?.slice(0, 10) ?? ""} — period locked`
                              : detail.cycle.summary?.readyForSignoff
                                ? "All checks pass — ready for two-partner sign-off"
                                : `${detail.cycle.summary?.blockers?.length ?? "?"} blocker(s) — sign-off is hard-blocked`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {detail.lock && detail.lock.lockedModules.length > 0 ? (
                            <MonoChip tone="default"><Lock className="w-3 h-3 inline mr-1" />{detail.lock.lockedModules.join(" · ")}</MonoChip>
                          ) : (
                            <MonoChip tone="amber"><Unlock className="w-3 h-3 inline mr-1" />unlocked</MonoChip>
                          )}
                          {detail.cycle.status !== "signed_off" && (
                            <>
                              <PillButton
                                onClick={() => act("run", () => jfetch(`/close/cycles/${detail.cycle.id}/run`, { method: "POST" }), "Close Controller run complete")}
                                disabled={busy !== null}
                                data-testid="button-run-controller"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${busy === "run" ? "animate-spin" : ""}`} /> Run controller
                              </PillButton>
                              <PillButton
                                onClick={() => act("signoff", () => jfetch(`/close/cycles/${detail.cycle.id}/signoff`, { method: "POST" }), "Sign-off recorded")}
                                disabled={busy !== null || !isPartner}
                                title={!isPartner ? "Partner tier required" : undefined}
                                data-testid="button-signoff"
                              >
                                <BookOpenCheck className="w-3.5 h-3.5 mr-1" />
                                {detail.cycle.firstSignoffUserId ? "Second sign-off (locks period)" : "First sign-off"}
                              </PillButton>
                            </>
                          )}
                          {detail.cycle.periodType === "year" && detail.cycle.status !== "signed_off" && (
                            <PillButton
                              onClick={() => act("rollover", () => jfetch("/close/rollover", { method: "POST", body: JSON.stringify({ entityId: detail.cycle.entityId, year: detail.cycle.periodLabel }) }), "Retained-earnings rollover posted")}
                              disabled={busy !== null || !isPartner}
                              data-testid="button-year-rollover"
                            >
                              Post year-end rollover
                            </PillButton>
                          )}
                        </div>
                      </div>
                      {detail.cycle.firstSignoffUserId && !detail.cycle.secondSignoffUserId && (
                        <div className="mt-2 text-[11px] text-gold font-mono" data-testid="close-awaiting-second">
                          First sign-off recorded — a second, different partner must sign off to lock the period.
                        </div>
                      )}
                    </Card>

                    {/* Checklist */}
                    <Card className="p-4" data-testid="close-checklist">
                      <div className="text-xs font-mono uppercase tracking-widest text-text-faint mb-3">Checklist</div>
                      {PHASES.map((ph) => {
                        const items = detail.items.filter((i) => i.phase === ph.key);
                        if (items.length === 0) return null;
                        return (
                          <div key={ph.key} className="mb-4 last:mb-0">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">{ph.label}</div>
                            <ul className="space-y-1.5">
                              {items.map((it) => (
                                <li key={it.id} className="border border-border-soft rounded p-2 text-xs" data-testid={`close-item-${it.itemKey}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2 min-w-0">
                                      {itemIcon(it.status)}
                                      <div className="min-w-0">
                                        <div className="text-text">{it.title}</div>
                                        {it.detail?.message && (
                                          <div className="text-[10px] text-text-mute mt-0.5">{it.detail.message}</div>
                                        )}
                                        {it.note && <div className="text-[10px] text-text-faint italic mt-0.5">note: {it.note}</div>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <MonoChip tone={it.status === "done" || it.status === "na" ? "default" : it.status === "blocked" ? "red" : "amber"}>
                                        {it.autoCheck ? `auto · ${it.status}` : it.status}
                                      </MonoChip>
                                      {!it.autoCheck && detail.cycle.status !== "signed_off" && (
                                        it.status === "open" || it.status === "blocked" ? (
                                          <>
                                            <button
                                              onClick={() => act(`item-${it.id}`, () => jfetch(`/close/cycles/${detail.cycle.id}/items/${it.id}`, { method: "POST", body: JSON.stringify({ status: "done" }) }), "Item completed")}
                                              className="text-[10px] font-mono uppercase text-gold hover:underline px-1"
                                              data-testid={`button-item-done-${it.itemKey}`}
                                            >
                                              done
                                            </button>
                                            <button
                                              onClick={() => act(`item-${it.id}`, () => jfetch(`/close/cycles/${detail.cycle.id}/items/${it.id}`, { method: "POST", body: JSON.stringify({ status: "na" }) }), "Item marked N/A")}
                                              className="text-[10px] font-mono uppercase text-text-mute hover:underline px-1"
                                              data-testid={`button-item-na-${it.itemKey}`}
                                            >
                                              n/a
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => act(`item-${it.id}`, () => jfetch(`/close/cycles/${detail.cycle.id}/items/${it.id}`, { method: "POST", body: JSON.stringify({ status: "open" }) }), "Item reopened")}
                                            className="text-[10px] font-mono uppercase text-text-mute hover:underline px-1"
                                            data-testid={`button-item-reopen-${it.itemKey}`}
                                          >
                                            reopen
                                          </button>
                                        )
                                      )}
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </Card>

                    {/* Accrual proposals */}
                    <Card className="p-4" data-testid="close-accruals">
                      <div className="text-xs font-mono uppercase tracking-widest text-text-faint mb-3">Accrual proposals</div>
                      {detail.accruals.length === 0 ? (
                        <div className="text-xs text-text-mute italic">No accrual proposals — the Close Controller proposes them when it finds unrecorded costs.</div>
                      ) : (
                        <ul className="space-y-2">
                          {detail.accruals.map((a) => (
                            <li key={a.id} className="border border-border-soft rounded p-3 text-xs" data-testid={`close-accrual-${a.id}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-text">{a.memo}</div>
                                  <div className="text-[10px] text-text-mute mt-1">{a.rationaleText}</div>
                                  <div className="font-mono text-[10px] text-text-faint mt-1">
                                    {a.lines.map((l, i) => (
                                      <div key={i}>{l.debit > 0 ? `Dr ${l.accountCode} ${a.currency} ${l.debit}` : `Cr ${l.accountCode} ${a.currency} ${l.credit}`}</div>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <MonoChip tone={a.status === "approved" ? "default" : a.status === "rejected" ? "red" : "amber"}>{a.status}</MonoChip>
                                  {a.status === "proposed" && detail.cycle.status !== "signed_off" && (
                                    <div className="flex gap-1">
                                      <PillButton
                                        onClick={() => act(`acc-${a.id}`, () => jfetch(`/close/accruals/${a.id}/approve`, { method: "POST", body: JSON.stringify({}) }), "Accrual approved — journal posted")}
                                        disabled={busy !== null || !isPartner}
                                        title={!isPartner ? "Partner tier required" : undefined}
                                        data-testid={`button-accrual-approve-${a.id}`}
                                      >
                                        Approve · post
                                      </PillButton>
                                      <PillButton
                                        onClick={() => act(`accr-${a.id}`, () => jfetch(`/close/accruals/${a.id}/reject`, { method: "POST", body: JSON.stringify({}) }), "Accrual rejected")}
                                        disabled={busy !== null || !isPartner}
                                        data-testid={`button-accrual-reject-${a.id}`}
                                      >
                                        Reject
                                      </PillButton>
                                    </div>
                                  )}
                                  {a.journalEntryId && <div className="text-[10px] font-mono text-text-faint">{a.journalEntryId}</div>}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  </>
                )}
              </div>
            </div>

            <CollectionsPanel isPartner={isPartner} busy={busy} act={act} />
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Collections (dunning drafts) ───────────────────────

interface DraftRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string | null;
  stepIndex: number;
  template: string | null;
  subject: string;
  bodyText: string;
  daysOverdue: number;
  outstandingUsd: number;
  escalation: boolean;
  requireApproval: boolean;
  status: string;
  sentVia: string | null;
}

function CollectionsPanel(props: {
  isPartner: boolean;
  busy: string | null;
  act: (key: string, fn: () => Promise<unknown>, okMsg: string) => Promise<void>;
}) {
  const { isPartner, busy, act } = props;
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const draftsQ = useQuery({
    queryKey: ["collections-drafts"],
    queryFn: async () => (await jfetch("/collections/drafts?status=draft")) as { data: { rows: DraftRow[] } },
  });
  const drafts = draftsQ.data?.data.rows ?? [];

  return (
    <Card className="p-4" data-testid="collections-panel">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-text-faint">Collections · draft chases</div>
          <div className="text-[11px] text-text-mute mt-0.5">
            The Collections Agent drafts ladder steps for overdue invoices — nothing sends without your approval.
          </div>
        </div>
        <PillButton
          onClick={() => act("col-run", () => jfetch("/collections/run", { method: "POST", body: JSON.stringify({}) }), "Collections Agent run complete")}
          disabled={busy !== null}
          data-testid="button-collections-run"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${busy === "col-run" ? "animate-spin" : ""}`} /> Run Collections Agent
        </PillButton>
      </div>
      {drafts.length === 0 ? (
        <div className="text-xs text-text-mute italic" data-testid="collections-empty">
          No draft chases. Run the agent to scan overdue invoices against the dunning ladder.
        </div>
      ) : (
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li key={d.id} className="border border-border-soft rounded p-3 text-xs" data-testid={`collections-draft-${d.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-text">
                    {d.escalation ? "Escalation — " : `Step ${d.stepIndex + 1} — `}
                    {d.customerName ?? "Client"} · {d.invoiceNumber ?? d.invoiceId}
                  </div>
                  <div className="text-[10px] text-text-mute mt-0.5">
                    {d.daysOverdue}d overdue · USD {d.outstandingUsd.toLocaleString()} outstanding
                    {d.escalation ? " · ladder exhausted (internal)" : d.template ? ` · ${d.template}` : ""}
                  </div>
                  <button
                    onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    className="text-[10px] font-mono uppercase text-gold hover:underline mt-1"
                    data-testid={`button-draft-preview-${d.id}`}
                  >
                    {expanded === d.id ? "hide draft" : "preview draft"}
                  </button>
                  {expanded === d.id && (
                    <div className="mt-2 bg-bg-elevate rounded p-2 font-mono text-[10px] text-text-mute whitespace-pre-wrap">
                      <div className="text-text mb-1">{d.subject}</div>
                      {d.bodyText}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {d.escalation && <MonoChip tone="red">escalation</MonoChip>}
                  <div className="flex gap-1">
                    <PillButton
                      onClick={() => act(`send-${d.id}`, () => jfetch(`/collections/drafts/${d.id}/approve-send`, { method: "POST", body: JSON.stringify({}) }), d.escalation ? "Escalation acknowledged" : "Chase approved and sent")}
                      disabled={busy !== null || (d.requireApproval && !isPartner)}
                      title={d.requireApproval && !isPartner ? "Partner approval required" : undefined}
                      data-testid={`button-draft-send-${d.id}`}
                    >
                      {d.escalation ? "Acknowledge" : "Approve · send"}
                    </PillButton>
                    <PillButton
                      onClick={() => act(`dis-${d.id}`, () => jfetch(`/collections/drafts/${d.id}/dismiss`, { method: "POST", body: JSON.stringify({}) }), "Draft dismissed")}
                      disabled={busy !== null}
                      data-testid={`button-draft-dismiss-${d.id}`}
                    >
                      Dismiss
                    </PillButton>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
