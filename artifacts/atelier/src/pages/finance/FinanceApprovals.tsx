/**
 * FinanceApprovals — the unified finance approvals inbox (Task #1091).
 *
 * One queue for everything waiting on a founder / finance approver:
 * payment runs, supplier invoices, self-billing drafts, close accruals
 * and sign-offs, payroll runs, collections drafts and journal reviews.
 * Aggregation only — every row deep-links (client-side) into the surface
 * that actually owns the action. Partner-only items stay VISIBLE to
 * finance viewers but render muted with a "Partner approval" tag.
 *
 * The autopilot settings card exposes the three founder-editable
 * thresholds (blueprint §4 confidence policy, decision D1); inline edit
 * is partner-tier only (canEdit from the settings endpoint).
 */

import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  useAtelierGetFinanceApprovalsInbox,
  useAtelierGetFinanceAutopilotSettings,
  useAtelierUpdateFinanceAutopilotSettings,
  getAtelierGetFinanceAutopilotSettingsQueryKey,
  type AtelierApprovalInboxItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, PillButton } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Bot, Clock, Inbox } from "lucide-react";
import { bucketNeedsRef, type BucketType } from "./toolingSpend.helpers";

const TOOLING_API = `${import.meta.env?.BASE_URL ?? "/"}api/atelier/finance/tooling`;

/* ── helpers ─────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  payment_run: "Payment runs",
  supplier_invoice: "Supplier invoices",
  self_billing_draft: "Self-billing drafts",
  close_accrual: "Close accruals",
  ct_provision: "CT provisions",
  close_signoff: "Close sign-offs",
  payroll_run: "Payroll runs",
  collections_draft: "Collections drafts",
  journal_review: "Journal review",
  vendor_project_unmapped: "Tooling projects to map",
  vendor_cost_split: "Tooling cost splits",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Native-currency money — never client-side FX (display rule §). */
function fmtMoney(amount: AtelierApprovalInboxItem["amount"]): string | null {
  if (!amount) return null;
  return `${amount.currency} ${amount.value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ── row ─────────────────────────────────────────────────── */

function ApprovalRow({ item }: { item: AtelierApprovalInboxItem }) {
  const [, navigate] = useLocation();
  const money = fmtMoney(item.amount);
  const muted = !item.actionable;
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 px-1 border-b border-border-soft/60 last:border-b-0 ${
        muted ? "opacity-60" : ""
      }`}
      data-testid={`approval-row-${item.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-sm text-text">{item.title}</span>
          {item.agent && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-gold"
              title={`Posted by ${item.agent.name} · run ${item.agent.runId}`}
              data-testid={`approval-agent-${item.id}`}
            >
              <Bot className="w-3 h-3" /> {item.agent.name}
            </span>
          )}
          {item.stale && (
            <MonoChip tone="red" data-testid={`approval-stale-${item.id}`}>
              stale
            </MonoChip>
          )}
          {muted && (
            <MonoChip tone="amber" data-testid={`approval-partner-${item.id}`}>
              Partner approval
            </MonoChip>
          )}
        </div>
        {item.subtitle && <div className="text-[11px] text-text-mute truncate">{item.subtitle}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {money && <span className="font-mono text-xs text-text whitespace-nowrap">{money}</span>}
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-faint">
          <Clock className="w-3 h-3" /> {timeAgo(item.submittedAt)}
        </span>
        {item.actionable ? (
          <button
            type="button"
            onClick={() => navigate(item.href)}
            className="text-xs text-gold hover:underline whitespace-nowrap"
            data-testid={`approval-review-${item.id}`}
          >
            Review →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(item.href)}
            className="text-xs text-text-faint hover:text-text-mute whitespace-nowrap"
            data-testid={`approval-view-${item.id}`}
          >
            View →
          </button>
        )}
      </div>
    </div>
  );
}

/* ── inline tooling project mapper (Task #1268) ───────────────
 * Rendered inside the "Tooling projects to map" group so the reviewer can
 * answer "who does this project belong to?" right here, without leaving
 * the inbox. Reuses the frozen /finance/tooling wire contract (raw fetch,
 * same as the Tooling spend console). */

const INLINE_BUCKETS: Array<{ type: BucketType; label: string }> = [
  { type: "engagement", label: "Client delivery" },
  { type: "opportunity", label: "Business development" },
  { type: "account", label: "Client (account)" },
  { type: "internal", label: "Internal" },
  { type: "ip_development", label: "IP development" },
  { type: "overhead", label: "Overhead" },
];

interface InlineUnmappedRow {
  vendorKey: string;
  projectKey: string;
  projectLabel: string;
  invoiceCount: number;
  totalUsd: number;
}
interface InlineTargets {
  engagements: Array<{ id: string; name: string }>;
  opportunities: Array<{ id: string; name: string; accountName: string }>;
  accounts: Array<{ id: string; name: string }>;
}

async function toolingGet<T>(path: string): Promise<T> {
  const r = await fetch(`${TOOLING_API}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return (await r.json()) as T;
}

function InlineToolingMapper({ onMapped }: { onMapped: () => void }) {
  const unmappedQ = useQuery<{ ok: boolean; data: { rows: InlineUnmappedRow[] } }>({
    queryKey: ["finance", "tooling", "unmapped"],
    queryFn: () => toolingGet("/unmapped"),
  });
  const targetsQ = useQuery<{ ok: boolean; data: InlineTargets }>({
    queryKey: ["finance", "tooling", "targets"],
    queryFn: () => toolingGet("/targets"),
  });
  const rows = unmappedQ.data?.ok ? unmappedQ.data.data.rows : [];
  const targets: InlineTargets = targetsQ.data?.ok
    ? { ...targetsQ.data.data, accounts: targetsQ.data.data.accounts ?? [] }
    : { engagements: [], opportunities: [], accounts: [] };

  if (unmappedQ.isLoading) {
    return <div className="py-2 text-[11px] text-text-mute">Loading unmapped projects…</div>;
  }
  if (unmappedQ.isError) {
    return <div className="py-2 text-[11px] text-danger">Could not load the unmapped projects.</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="py-2 text-[11px] text-text-mute" data-testid="inline-mapper-empty">
        All projects are mapped — this item will clear on the next refresh.
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-2" data-testid="inline-tooling-mapper">
      {rows.map((row) => (
        <InlineMapRow key={`${row.vendorKey}:${row.projectKey}`} row={row} targets={targets} onMapped={onMapped} />
      ))}
    </div>
  );
}

function InlineMapRow({
  row,
  targets,
  onMapped,
}: {
  row: InlineUnmappedRow;
  targets: InlineTargets;
  onMapped: () => void;
}) {
  const { toast } = useToast();
  const [bucketType, setBucketType] = React.useState<BucketType>("engagement");
  const [bucketRef, setBucketRef] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const needsRef = bucketNeedsRef(bucketType);
  const canSubmit = (!needsRef || !!bucketRef) && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${TOOLING_API}/map`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorKey: row.vendorKey,
          projectKey: row.projectKey,
          bucketType,
          bucketRef: needsRef ? bucketRef : null,
        }),
      });
      if (!r.ok) throw new Error(`http_${r.status}`);
      toast({ title: "Project mapped", description: row.projectLabel });
      onMapped();
    } catch (e) {
      toast({ title: "Mapping failed", variant: "destructive", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const refOptions =
    bucketType === "engagement"
      ? targets.engagements.map((e) => ({ id: e.id, label: e.name }))
      : bucketType === "opportunity"
        ? targets.opportunities.map((o) => ({ id: o.id, label: `${o.name} · ${o.accountName}` }))
        : bucketType === "account"
          ? (targets.accounts ?? []).map((a) => ({ id: a.id, label: a.name }))
          : [];

  return (
    <div
      className="rounded border border-border-soft/60 p-2"
      data-testid={`inline-map-row-${row.vendorKey}-${row.projectKey}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text">{row.projectLabel}</span>
        <span className="font-mono text-[10px] uppercase text-text-faint">{row.vendorKey}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <select
          className="bg-bg-deep border border-border-soft rounded px-1.5 py-1 text-[11px]"
          value={bucketType}
          onChange={(e) => {
            setBucketType(e.target.value as BucketType);
            setBucketRef(null);
          }}
          data-testid={`inline-map-bucket-${row.vendorKey}-${row.projectKey}`}
        >
          {INLINE_BUCKETS.map((b) => (
            <option key={b.type} value={b.type}>
              {b.label}
            </option>
          ))}
        </select>
        {needsRef && (
          <select
            className="bg-bg-deep border border-border-soft rounded px-1.5 py-1 text-[11px] max-w-[220px]"
            value={bucketRef ?? ""}
            onChange={(e) => setBucketRef(e.target.value || null)}
            data-testid={`inline-map-target-${row.vendorKey}-${row.projectKey}`}
          >
            <option value="">Pick target…</option>
            {refOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <PillButton
          onClick={submit}
          disabled={!canSubmit}
          data-testid={`inline-map-submit-${row.vendorKey}-${row.projectKey}`}
        >
          {busy ? "Mapping…" : "Map"}
        </PillButton>
      </div>
    </div>
  );
}

/* ── autopilot settings card ─────────────────────────────── */

function AutopilotCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useAtelierGetFinanceAutopilotSettings();
  const settings = data?.data.settings;
  const canEdit = data?.data.canEdit ?? false;

  const [editing, setEditing] = React.useState(false);
  const [conf, setConf] = React.useState("");
  const [supMax, setSupMax] = React.useState("");
  const [jrnMax, setJrnMax] = React.useState("");

  React.useEffect(() => {
    if (settings) {
      setConf(String(settings.journalAutoConfidence));
      setSupMax(String(settings.supplierInvoiceAutoMaxAed));
      setJrnMax(String(settings.journalAutoMaxAed));
    }
  }, [settings]);

  const update = useAtelierUpdateFinanceAutopilotSettings({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierGetFinanceAutopilotSettingsQueryKey() });
        setEditing(false);
        toast({ title: "Autopilot thresholds saved." });
      },
      onError: (err) => {
        toast({
          title: "Could not save thresholds",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  if (!settings) return null;

  const save = () => {
    update.mutate({
      data: {
        journalAutoConfidence: Number(conf),
        supplierInvoiceAutoMaxAed: Number(supMax),
        journalAutoMaxAed: Number(jrnMax),
      },
    });
  };

  const Row = ({
    label,
    display,
    value,
    onChange,
    step,
  }: {
    label: string;
    display: string;
    value: string;
    onChange: (v: string) => void;
    step: string;
  }) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border-soft/60 last:border-b-0">
      <span className="text-sm text-text-mute">{label}</span>
      {editing ? (
        <Input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-32 h-8 text-right font-mono text-sm"
        />
      ) : (
        <span className="font-mono text-sm text-text">{display}</span>
      )}
    </div>
  );

  return (
    <Card className="p-4" data-testid="finance-autopilot-card">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Eyebrow>Autopilot thresholds</Eyebrow>
          {!settings.customised && <MonoChip data-testid="autopilot-defaults">Using defaults</MonoChip>}
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            className="text-xs text-gold hover:underline"
            onClick={() => setEditing(true)}
            data-testid="autopilot-edit"
          >
            Edit
          </button>
        )}
      </div>
      <div>
        <Row
          label="Auto-approve supplier invoices up to (AED)"
          display={settings.supplierInvoiceAutoMaxAed.toLocaleString("en-US")}
          value={supMax}
          onChange={setSupMax}
          step="100"
        />
        <Row
          label="Auto-post journals only when confidence is at least"
          display={`${Math.round(settings.journalAutoConfidence * 100)}%`}
          value={conf}
          onChange={setConf}
          step="0.01"
        />
        <Row
          label="Auto-post journals up to (AED)"
          display={settings.journalAutoMaxAed.toLocaleString("en-US")}
          value={jrnMax}
          onChange={setJrnMax}
          step="100"
        />
      </div>
      {editing && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            className="text-xs text-text-mute hover:text-text"
            onClick={() => {
              setEditing(false);
              setConf(String(settings.journalAutoConfidence));
              setSupMax(String(settings.supplierInvoiceAutoMaxAed));
              setJrnMax(String(settings.journalAutoMaxAed));
            }}
            data-testid="autopilot-cancel"
          >
            Cancel
          </button>
          <PillButton onClick={save} disabled={update.isPending} data-testid="autopilot-save">
            {update.isPending ? "Saving…" : "Save"}
          </PillButton>
        </div>
      )}
      <p className="mt-2 text-[10px] font-mono text-text-faint">
        Confidence uses the 0–1 score on parsed fields. "Auto" always posts with a full audit trail and a
        one-click reverse.
      </p>
    </Card>
  );
}

/* ── page ────────────────────────────────────────────────── */

export default function FinanceApprovals() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useAtelierGetFinanceApprovalsInbox();
  const onToolingMapped = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["finance", "tooling"] });
    void refetch();
  }, [qc, refetch]);
  const inbox = data?.data;
  const items = inbox?.items ?? [];

  // Group by kind, preserving first-seen order.
  const byKind = React.useMemo(() => {
    const groups: Array<{ kind: string; items: AtelierApprovalInboxItem[] }> = [];
    const index = new Map<string, number>();
    for (const it of items) {
      let i = index.get(it.kind);
      if (i === undefined) {
        i = groups.length;
        index.set(it.kind, i);
        groups.push({ kind: it.kind, items: [] });
      }
      groups[i].items.push(it);
    }
    return groups;
  }, [items]);

  const wallet = inbox?.walletApprovals;
  const walletCount = wallet ? wallet.timesheets + wallet.leave + wallet.expenses : 0;
  const hasNothing = !isLoading && items.length === 0 && walletCount === 0;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Approvals"
          headline="Approvals inbox"
          lede="One queue for everything waiting on you — payment runs, supplier invoices, close sign-offs, payroll and journal review. Each item deep-links into the surface that owns the action."
        />
      </PageHero>

      <div className="container-atelier py-10 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {isLoading && <Card className="p-6 text-text-mute">Loading approvals…</Card>}

          {hasNothing && (
            <Card className="p-10 text-center" data-testid="approvals-empty">
              <Inbox className="w-8 h-8 mx-auto text-text-faint" />
              <p className="mt-3 text-sm text-text-mute">Nothing waiting on you.</p>
            </Card>
          )}

          {byKind.map((group) => {
            const totals = inbox?.totals?.[group.kind];
            return (
              <Card key={group.kind} className="p-4" data-testid={`approvals-group-${group.kind}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Eyebrow>{kindLabel(group.kind)}</Eyebrow>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint">
                    {totals
                      ? `${totals.actionable}/${totals.count} actionable`
                      : `${group.items.length}`}
                  </span>
                </div>
                <div>
                  {group.items.map((it) => (
                    <ApprovalRow key={it.id} item={it} />
                  ))}
                </div>
                {group.kind === "vendor_project_unmapped" && (
                  <InlineToolingMapper onMapped={onToolingMapped} />
                )}
              </Card>
            );
          })}
        </div>

        <div className="space-y-4">
          {wallet && walletCount > 0 && (
            <Link href={wallet.href}>
              <Card className="p-4 hover:border-gold/40 cursor-pointer transition-colors" data-testid="approvals-wallet-card">
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>Expense &amp; time approvals</Eyebrow>
                  <ArrowRight className="w-3.5 h-3.5 text-text-faint" />
                </div>
                <div className="text-2xl font-light text-text mt-2">{walletCount}</div>
                <div className="text-[11px] text-text-mute mt-1">
                  {wallet.timesheets} timesheet{wallet.timesheets === 1 ? "" : "s"} ·{" "}
                  {wallet.leave} leave · {wallet.expenses} expense
                  {wallet.expenses === 1 ? "" : "s"}
                </div>
              </Card>
            </Link>
          )}

          <AutopilotCard />
        </div>
      </div>
    </div>
  );
}
