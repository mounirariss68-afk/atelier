/**
 * LedgerPage — Finance GL backbone (Task #428).
 *
 * Tabs: Trial balance · Journal · Chart of accounts · Exceptions ·
 * Untagged. Runs the rule-based Bookkeeper posting agent per period,
 * seeds the default chart per entity, and lets finance fix entity
 * tags on money-moving records.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierReverseRepostJournal,
  type AtelierReverseRepostJournalBodyLinesItem,
} from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Bot } from "lucide-react";
import {
  useFinanceEntities,
  useGlAccounts,
  useGlJournal,
  useGlTrialBalance,
  useGlExceptions,
  useGlUntagged,
  useGlBookkeeperStatus,
  postJson,
  type BookkeeperRunResult,
  type GlJournalEntryRow,
} from "@/lib/v5-hooks";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Small "open source document" link rendered where a destination exists. */
function SourceLink({ href, testId }: { href: string; testId: string }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="text-xs font-mono text-gold hover:underline whitespace-nowrap"
      data-testid={testId}
    >
      open source ↗
    </Link>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const TABS = ["trial-balance", "journal", "accounts", "exceptions", "untagged"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  "trial-balance": "Trial balance",
  journal: "Journal",
  accounts: "Chart of accounts",
  exceptions: "Exceptions",
  untagged: "Untagged",
};

export default function LedgerPage() {
  const qc = useQueryClient();
  const entities = useFinanceEntities();
  const [tab, setTab] = React.useState<Tab>("trial-balance");
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState<string>(currentPeriod());
  const [running, setRunning] = React.useState(false);
  const [runResult, setRunResult] = React.useState<BookkeeperRunResult | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const { data: statusData } = useGlBookkeeperStatus(period);
  const lastRun = statusData?.data.lastRun ?? null;

  const effEntity = entityId ?? entities[0]?.id ?? null;

  const refetchAll = React.useCallback(() => {
    void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("atelier-gl") });
  }, [qc]);

  async function runBookkeeper() {
    setRunning(true); setRunError(null); setRunResult(null);
    try {
      const res = await postJson<{ ok: boolean; data: BookkeeperRunResult }>(
        "/gl/bookkeeper/run",
        { periodLabel: period },
      );
      setRunResult(res.data);
      refetchAll();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-ledger">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Record"
            headline="General ledger"
            lede="Per-entity chart of accounts, append-only journal with entity · account · engagement dimensions, and the rule-based Bookkeeper posting agent. Exceptions, not guesses."
          />
          <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
            <select
              value={effEntity ?? ""}
              onChange={(e) => setEntityId(e.target.value || null)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-gl-entity"
            >
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="YYYY-MM"
              className="bg-bg-elevate border border-border rounded px-2 py-1 w-24"
              data-testid="input-gl-period"
            />
            <button
              onClick={() => void runBookkeeper()}
              disabled={running || !/^\d{4}-\d{2}$/.test(period)}
              className="bg-gold/15 border border-gold/40 text-gold rounded px-3 py-1 hover:bg-gold/25 disabled:opacity-50"
              data-testid="button-run-bookkeeper"
            >
              {running ? "Posting…" : "Run Bookkeeper"}
            </button>
            <span className="text-text-mute w-full text-right" data-testid="text-bookkeeper-last-run">
              {lastRun === null
                ? "Posts automatically — no run yet for this period."
                : lastRun.status === "running"
                  ? `${lastRun.mode === "auto" ? "Auto-post" : "Manual run"} in progress…`
                  : lastRun.status === "failed"
                    ? `Last ${lastRun.mode} run failed ${lastRun.finishedAt ? timeAgo(lastRun.finishedAt) : ""}`.trim()
                    : `Last ${lastRun.mode === "auto" ? "auto-post" : "manual run"} ${lastRun.finishedAt ? timeAgo(lastRun.finishedAt) : ""}${lastRun.entriesCreated != null ? ` · ${lastRun.entriesCreated} posted` : ""}`}
            </span>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {runError && (
          <Card className="p-3 border-red-500/40 text-red-400 text-sm font-mono" data-testid="text-run-error">
            {runError}
          </Card>
        )}
        {runResult && (
          <Card className="p-3 text-sm" data-testid="card-run-result">
            <div className="flex items-center gap-2 flex-wrap font-mono text-xs">
              <MonoChip tone="green">{runResult.entriesCreated} posted</MonoChip>
              <MonoChip>{runResult.entriesSkippedExisting} already posted</MonoChip>
              <MonoChip>{runResult.tagsBackfilled} tags backfilled</MonoChip>
              <MonoChip tone={runResult.exceptionsOpen > 0 ? "amber" : "green"}>
                {runResult.exceptionsOpen} exceptions
              </MonoChip>
            </div>
            <p className="text-text-mute mt-2">{runResult.rationaleSummary}</p>
          </Card>
        )}

        <div className="flex gap-1 border-b border-border text-sm font-mono" data-testid="gl-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 border-b-2 -mb-px ${tab === t ? "border-gold text-gold" : "border-transparent text-text-mute hover:text-text"}`}
              data-testid={`tab-${t}`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === "trial-balance" && <TrialBalanceTab entityId={effEntity} period={period} />}
        {tab === "journal" && <JournalTab entityId={effEntity} period={period} />}
        {tab === "accounts" && <AccountsTab entityId={effEntity} />}
        {tab === "exceptions" && <ExceptionsTab onChanged={refetchAll} />}
        {tab === "untagged" && <UntaggedTab entities={entities} onChanged={refetchAll} />}
      </div>
    </div>
  );
}

function TrialBalanceTab({ entityId, period }: { entityId: string | null; period: string }) {
  const { data, isLoading } = useGlTrialBalance(entityId, /^\d{4}-\d{2}$/.test(period) ? period : "");
  if (!entityId) return <Card className="p-6 text-text-mute">Add a legal entity first.</Card>;
  if (isLoading) return <Card className="p-6 text-text-mute">Loading trial balance…</Card>;
  const rows = data?.data.rows ?? [];
  const totals = data?.data.totals ?? { debit: 0, credit: 0 };
  return (
    <Card className="p-0 overflow-x-auto" data-testid="table-trial-balance">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-mono uppercase text-text-faint border-b border-border">
            <th className="px-3 py-2">Code</th><th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Ccy</th>
            <th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-6 text-text-mute">No journal activity yet for this entity/period. Run the Bookkeeper to post from invoices, expenses and bank activity.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.accountCode}:${r.currency}`} className="border-b border-border/40" data-testid={`tb-row-${r.accountCode}`}>
              <td className="px-3 py-1.5 font-mono">{r.accountCode}</td>
              <td className="px-3 py-1.5">{r.accountName}</td>
              <td className="px-3 py-1.5 font-mono text-text-mute">{r.currency}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(Number(r.debit))}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmt(Number(r.credit))}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="font-mono text-sm border-t border-border">
              <td className="px-3 py-2" colSpan={3}>
                {data?.data.balanced
                  ? <MonoChip tone="green">Balanced</MonoChip>
                  : <MonoChip tone="red">Out of balance</MonoChip>}
              </td>
              <td className="px-3 py-2 text-right" data-testid="tb-total-debit">{fmt(totals.debit)}</td>
              <td className="px-3 py-2 text-right" data-testid="tb-total-credit">{fmt(totals.credit)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </Card>
  );
}

/** Short id reference for reverse/repost linkage chips. */
function shortRef(id: string): string {
  return id.length > 10 ? `…${id.slice(-6)}` : id;
}

function JournalTab({ entityId, period }: { entityId: string | null; period: string }) {
  const { data: me } = useAtelierGetMe();
  const isPartnerTier = me?.role === "partner" || me?.role === "founding_partner";
  // Task #1091 — agent-provenance filter toggle (wires ?postedByAgent=1).
  const [agentsOnly, setAgentsOnly] = React.useState(false);
  const { data, isLoading } = useGlJournal({
    entityId,
    period: /^\d{4}-\d{2}$/.test(period) ? period : undefined,
    postedByAgent: agentsOnly ? "1" : undefined,
  });
  const [open, setOpen] = React.useState<string | null>(null);
  const [fixTarget, setFixTarget] = React.useState<GlJournalEntryRow | null>(null);
  if (isLoading) return <Card className="p-6 text-text-mute">Loading journal…</Card>;
  const rows = data?.data.rows ?? [];
  return (
    <div className="space-y-2" data-testid="list-journal">
      <div className="flex items-center justify-end">
        <label className="inline-flex items-center gap-2 text-xs font-mono text-text-mute cursor-pointer" data-testid="toggle-posted-by-agent">
          <input
            type="checkbox"
            checked={agentsOnly}
            onChange={(e) => setAgentsOnly(e.target.checked)}
            className="accent-gold"
          />
          <span className="inline-flex items-center gap-1"><Bot className="w-3.5 h-3.5" /> Posted by agents</span>
        </label>
      </div>
      {rows.length === 0 && <Card className="p-6 text-text-mute">No journal entries for this filter.</Card>}
      {rows.map((e) => {
        const byAgent = !!e.agentRunId;
        return (
          <Card key={e.id} className="p-3" data-testid={`journal-entry-${e.id}`}>
            <div
              role="button"
              tabIndex={0}
              className="w-full text-left cursor-pointer"
              onClick={() => setOpen(open === e.id ? null : e.id)}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") setOpen(open === e.id ? null : e.id); }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <MonoChip>{e.entryDate}</MonoChip>
                  <MonoChip tone={e.kind === "manual" ? "gold" : "default"}>{e.sourceKind}</MonoChip>
                  {byAgent && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-gold"
                      title={`Posted by ${e.agentName ?? "agent"} · run ${e.agentRunId}`}
                      data-testid={`journal-agent-${e.id}`}
                    >
                      <Bot className="w-3 h-3" /> {e.agentName ?? "agent"}
                    </span>
                  )}
                  {e.reversesEntryId && (
                    <MonoChip tone="red" data-testid={`journal-reverses-${e.id}`}>
                      reverses {shortRef(e.reversesEntryId)}
                    </MonoChip>
                  )}
                  {e.repostOfEntryId && (
                    <MonoChip tone="amber" data-testid={`journal-repost-${e.id}`}>
                      repost of {shortRef(e.repostOfEntryId)}
                    </MonoChip>
                  )}
                  <span className="truncate">{e.memo}</span>
                  {e.sourceHref && <SourceLink href={e.sourceHref} testId={`link-journal-source-${e.id}`} />}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {byAgent && isPartnerTier && (
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); setFixTarget(e); }}
                      className="text-xs text-gold hover:underline whitespace-nowrap"
                      data-testid={`journal-fix-${e.id}`}
                    >
                      Fix this
                    </button>
                  )}
                  <span className="font-mono text-sm">{e.currency} {fmt(e.totalDebit)}</span>
                </div>
              </div>
            </div>
            {open === e.id && (
              <table className="w-full text-xs font-mono mt-2 border-t border-border/40">
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border/20">
                      <td className="px-2 py-1">{l.accountCode} {l.accountName}</td>
                      <td className="px-2 py-1 text-text-mute">{l.engagementId ?? ""}</td>
                      <td className="px-2 py-1 text-right">{l.debit > 0 ? fmt(l.debit) : ""}</td>
                      <td className="px-2 py-1 text-right">{l.credit > 0 ? fmt(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
      {fixTarget && (
        <FixJournalDialog entry={fixTarget} onClose={() => setFixTarget(null)} />
      )}
    </div>
  );
}

/**
 * FixJournalDialog — Task #1091 "reverse-and-repost". Posted journals are
 * never edited in place: this creates the reversing journal + a corrected
 * repost as one audited operation (partner tier). Prefilled with the
 * original lines/memo for correction.
 */
function FixJournalDialog({ entry, onClose }: { entry: GlJournalEntryRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [memo, setMemo] = React.useState(entry.memo ?? "");
  const [lines, setLines] = React.useState<AtelierReverseRepostJournalBodyLinesItem[]>(
    entry.lines.map((l) => ({
      accountCode: l.accountCode,
      engagementId: l.engagementId ?? undefined,
      debit: l.debit || 0,
      credit: l.credit || 0,
      memo: l.memo ?? undefined,
    })),
  );

  const mutation = useAtelierReverseRepostJournal({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("atelier-gl") });
        toast({ title: "Journal reversed and reposted." });
        onClose();
      },
      onError: (err) => {
        const status = (err as { status?: number } | null)?.status;
        toast({
          title: "Could not fix journal",
          description:
            status === 409
              ? "This period is signed off — reopen it first."
              : err instanceof Error
                ? err.message
                : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const setLine = (i: number, patch: Partial<AtelierReverseRepostJournalBodyLinesItem>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.011 && totalDebit > 0;

  const submit = () => {
    mutation.mutate({
      id: entry.id,
      data: {
        memo,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          engagementId: l.engagementId || undefined,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: l.memo || undefined,
        })),
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-fix-journal">
        <DialogHeader>
          <DialogTitle>Fix this journal</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-text-mute">
          The original entry is reversed and a corrected replacement is posted as one audited operation.
          Correct the lines below.
        </p>
        <div className="space-y-1 mt-2">
          <label className="text-[11px] font-mono uppercase text-text-faint">Correction memo</label>
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} data-testid="fix-journal-memo" />
        </div>
        <table className="w-full text-xs mt-3">
          <thead>
            <tr className="text-left text-[10px] font-mono uppercase text-text-faint border-b border-border">
              <th className="py-1">Account</th><th>Engagement</th>
              <th className="text-right">Debit</th><th className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border/30">
                <td className="py-1 pr-2">
                  <Input value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} className="h-8" data-testid={`fix-line-account-${i}`} />
                </td>
                <td className="pr-2">
                  <Input value={l.engagementId ?? ""} onChange={(e) => setLine(i, { engagementId: e.target.value })} className="h-8" />
                </td>
                <td className="pr-2">
                  <Input type="number" value={String(l.debit ?? 0)} onChange={(e) => setLine(i, { debit: Number(e.target.value) })} className="h-8 text-right font-mono" data-testid={`fix-line-debit-${i}`} />
                </td>
                <td>
                  <Input type="number" value={String(l.credit ?? 0)} onChange={(e) => setLine(i, { credit: Number(e.target.value) })} className="h-8 text-right font-mono" data-testid={`fix-line-credit-${i}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between mt-2 font-mono text-xs">
          <span className={balanced ? "text-success" : "text-amber-400"}>
            {balanced ? "Balanced" : "Debits must equal credits"}
          </span>
          <span className="text-text-mute">
            Dr {entry.currency} {fmt(totalDebit)} · Cr {entry.currency} {fmt(totalCredit)}
          </span>
        </div>
        <div className="flex items-center justify-end gap-2 mt-3">
          <button type="button" className="text-xs text-text-mute hover:text-text" onClick={onClose}>Cancel</button>
          <PillButton
            onClick={submit}
            disabled={mutation.isPending || !balanced || memo.trim().length < 3}
            data-testid="fix-journal-submit"
          >
            {mutation.isPending ? "Posting…" : "Reverse & repost"}
          </PillButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountsTab({ entityId }: { entityId: string | null }) {
  const { data, isLoading } = useGlAccounts(entityId);
  if (!entityId) return <Card className="p-6 text-text-mute">Add a legal entity first.</Card>;
  if (isLoading) return <Card className="p-6 text-text-mute">Loading chart…</Card>;
  const rows = (data?.data.rows ?? []).filter((r) => r.legalEntityId === entityId);
  return (
    <div className="space-y-3">
      <Card className="p-0 overflow-x-auto" data-testid="table-accounts">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-mono uppercase text-text-faint border-b border-border">
              <th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th><th className="px-3 py-2">Normal side</th><th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-text-mute">Loading the default chart of accounts…</td></tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-border/40" data-testid={`account-row-${a.code}`}>
                <td className="px-3 py-1.5 font-mono">{a.code}</td>
                <td className="px-3 py-1.5">{a.name}</td>
                <td className="px-3 py-1.5 font-mono text-text-mute">{a.type}</td>
                <td className="px-3 py-1.5 font-mono text-text-mute">{a.normalSide}</td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1">
                    {a.isSystem && <MonoChip tone="gold">system</MonoChip>}
                    {!a.active && <MonoChip tone="red">inactive</MonoChip>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ExceptionsTab({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = React.useState<"open" | "resolved">("open");
  const { data, isLoading } = useGlExceptions(status);
  const [busy, setBusy] = React.useState<string | null>(null);
  async function resolve(id: string) {
    setBusy(id);
    try {
      await postJson(`/gl/exceptions/${id}/resolve`, { note: "Resolved from ledger UI" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }
  const rows = data?.data.rows ?? [];
  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-xs font-mono">
        {(["open", "resolved"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1 rounded border ${status === s ? "border-gold text-gold" : "border-border text-text-mute"}`}
            data-testid={`filter-exceptions-${s}`}>
            {s}
          </button>
        ))}
      </div>
      {isLoading ? <Card className="p-6 text-text-mute">Loading exceptions…</Card> : (
        <div className="space-y-2" data-testid="list-exceptions">
          {rows.length === 0 && <Card className="p-6 text-text-mute">No {status} exceptions. The Bookkeeper posts cleanly or surfaces what it can't post here.</Card>}
          {rows.map((x) => (
            <Card key={x.id} className="p-3 flex items-start justify-between gap-3 flex-wrap" data-testid={`exception-${x.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <MonoChip tone="amber">{x.code}</MonoChip>
                  <MonoChip>{x.sourceKind}</MonoChip>
                  <span className="text-xs font-mono text-text-mute">{x.periodLabel}</span>
                </div>
                <p className="text-sm mt-1">{x.message}</p>
                {x.sourceLabel && (
                  x.sourceHref ? (
                    <Link
                      href={x.sourceHref}
                      className="block text-xs font-mono text-gold hover:underline mt-0.5"
                      data-testid={`link-exception-source-${x.id}`}
                    >
                      {x.sourceLabel} ↗
                    </Link>
                  ) : (
                    <p className="text-xs font-mono text-text-faint mt-0.5">{x.sourceLabel}</p>
                  )
                )}
              </div>
              {x.status === "open" && (
                <button
                  onClick={() => void resolve(x.id)}
                  disabled={busy === x.id}
                  className="text-xs font-mono border border-border rounded px-3 py-1.5 hover:border-gold/50 disabled:opacity-50"
                  data-testid={`button-resolve-${x.id}`}
                >
                  {busy === x.id ? "…" : "Mark resolved"}
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UntaggedTab({ entities, onChanged }: {
  entities: Array<{ id: string; shortName: string }>;
  onChanged: () => void;
}) {
  const { data, isLoading, refetch } = useGlUntagged();
  const [busy, setBusy] = React.useState<string | null>(null);
  async function tag(kind: string, id: string, legalEntityId: string) {
    if (!legalEntityId) return;
    setBusy(id);
    try {
      await postJson("/gl/tag", { kind, id, legalEntityId });
      await refetch();
      onChanged();
    } finally {
      setBusy(null);
    }
  }
  if (isLoading) return <Card className="p-6 text-text-mute">Scanning for untagged records…</Card>;
  const rows = data?.data.rows ?? [];
  return (
    <div className="space-y-2" data-testid="list-untagged">
      {rows.length === 0 && <Card className="p-6 text-text-mute">Everything that moves money carries a legal-entity tag. Nothing to fix.</Card>}
      {rows.map((r) => (
        <Card key={`${r.kind}:${r.id}`} className="p-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`untagged-${r.id}`}>
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <MonoChip>{r.kind.replace(/_/g, " ")}</MonoChip>
            {r.sourceHref ? (
              <Link
                href={r.sourceHref}
                className="truncate text-gold hover:underline"
                data-testid={`link-untagged-source-${r.id}`}
              >
                {r.label} ↗
              </Link>
            ) : (
              <span className="truncate">{r.label}</span>
            )}
            <span className="font-mono text-xs text-text-mute">{r.currency} {fmt(r.amount)}</span>
          </div>
          <select
            defaultValue=""
            disabled={busy === r.id}
            onChange={(e) => void tag(r.kind, r.id, e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-xs font-mono"
            data-testid={`select-tag-${r.id}`}
          >
            <option value="" disabled>Assign entity…</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
          </select>
        </Card>
      ))}
    </div>
  );
}
