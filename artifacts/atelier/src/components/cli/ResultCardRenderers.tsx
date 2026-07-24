/**
 * Task #348 — Real result-card renderers for the assistant transcript.
 *
 * Each `tool_result` frame from the orchestrator carries the raw `data`
 * payload returned by a CLI capability. The catalog tags every read with
 * a `resultCard` shape (kpi_strip / ranked_list / time_series /
 * entity_card / audit_timeline). This file owns the visual treatment
 * for each shape so "show pipeline by stage" becomes a real KPI strip
 * instead of a JSON dump.
 *
 * The renderers stay defensive about the payload — capabilities differ
 * subtly (e.g. kpi_strip may carry `stages[]` from pipeline.by_stage or
 * a flat object of numbers from forecast.summary), so each renderer
 * accepts `unknown` and degrades gracefully when fields are missing.
 */

import * as React from "react";
import {
  ExternalLink,
  Building2,
  User,
  Target,
  FileText,
  FileCheck2,
  ClipboardCheck,
  CalendarClock,
  Package,
  AlertTriangle,
  Lightbulb,
  Receipt,
  Clock,
  UserCheck,
  CheckCircle2,
  Map as MapIcon,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreateAccount } from "@/components/CreateAccountContext";
import type { CliCapability, CliLocale } from "./types";
import { s } from "./locale";

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return null;
}
function asStr(v: unknown): string {
  return v == null ? "" : String(v);
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000)
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (!Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000)
    return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}

function humanLabel(key: string): string {
  return key
    .replace(/[_.]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Usd\b/, "USD")
    .replace(/Pct\b/, "%")
    .replace(/^./, (c) => c.toUpperCase());
}

function relativeTime(iso: string, locale: CliLocale): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return locale === "ar" ? "الآن" : "now";
  if (mins < 60) return locale === "ar" ? `منذ ${mins} د` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return locale === "ar" ? `منذ ${hrs} س` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return locale === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}

const SEV_DOT: Record<string, string> = {
  red: "bg-danger",
  amber: "bg-warning",
  green: "bg-success",
  error: "bg-danger",
  blocked: "bg-danger",
  running: "bg-warning",
  complete: "bg-success",
  success: "bg-success",
};

/* ───────────── Task #539 — unified value formatting ───────────── */

const MONEY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/** Currency-aware money formatter. Known symbols hug the number;
 * everything else (AED, SAR, …) gets an ISO-code suffix. Large values
 * collapse to k/M so cards stay compact. */
function fmtMoney(n: number, currency?: string | null): string {
  const cur = (currency ?? "USD").toUpperCase();
  const sym = MONEY_SYMBOL[cur];
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  else if (abs >= 1_000) body = `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  else body = `${Math.round(n * 100) / 100}`;
  return sym ? `${sym}${body}` : `${body} ${cur}`;
}

/** Percent formatter for values already on a 0–100 scale. */
function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function looksLikeDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s.trim());
}

/** Absolute date formatter (e.g. "19 Jun 2026"). Falls back to the raw
 * string when it isn't parseable so we never show "Invalid Date". */
function fmtDate(iso: string, locale: CliLocale): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(t));
  } catch {
    return iso;
  }
}

/* ───────────── Task #539 — shared card primitives ───────────── */

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "mute"> = {
  approved: "success",
  approve: "success",
  active: "success",
  complete: "success",
  completed: "success",
  created: "success",
  accepted: "success",
  won: "success",
  dispatched: "success",
  success: "success",
  green: "success",
  champion: "success",
  supporter: "success",
  rejected: "danger",
  reject: "danger",
  blocker: "danger",
  lost: "danger",
  red: "danger",
  error: "danger",
  blocked: "danger",
  pending: "warning",
  submitted: "warning",
  amber: "warning",
  skeptic: "warning",
  draft: "mute",
  neutral: "mute",
  unknown: "mute",
};

function StatusPill({ value }: { value: string }) {
  const tone = STATUS_TONE[value.toLowerCase()] ?? "mute";
  const cls =
    tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : tone === "danger"
        ? "border-danger/30 bg-danger/10 text-danger"
        : tone === "warning"
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-border-soft bg-bg-deep text-text-mute";
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider whitespace-nowrap",
        cls,
      )}
      data-testid="cli-status-pill"
    >
      {humanLabel(value)}
    </span>
  );
}

function OpenLink({ href, locale }: { href: string; locale: CliLocale }) {
  return (
    <a
      href={href}
      className="text-[11px] inline-flex items-center gap-1 text-text-mute hover:text-gold shrink-0"
      data-testid="cli-open-link"
    >
      {locale === "ar" ? "افتح" : "Open"}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

/** Renders the first `initial` children and reveals the rest behind a
 * "show more" toggle. `as` controls the wrapper element so the same
 * affordance works for bullet lists (ul) and attribute grids (dl). */
function ShowMoreList<T>({
  items,
  initial,
  locale,
  render,
  as = "ul",
  className,
}: {
  items: T[];
  initial: number;
  locale: CliLocale;
  render: (item: T, index: number) => React.ReactNode;
  as?: "ul" | "dl" | "div";
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? items : items.slice(0, initial);
  const Wrap = as;
  const hidden = items.length - initial;
  return (
    <div>
      <Wrap className={className}>{shown.map(render)}</Wrap>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[10px] font-mono text-gold hover:underline"
          data-testid="cli-show-more"
        >
          {expanded
            ? locale === "ar"
              ? "عرض أقل"
              : "Show less"
            : locale === "ar"
              ? `عرض ${hidden} المزيد`
              : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 py-4 text-center"
      data-testid="cli-empty-state"
    >
      <Icon className="w-5 h-5 text-text-faint" aria-hidden />
      <div className="text-xs text-text-mute">{title}</div>
      {hint && <div className="text-[10px] text-text-faint">{hint}</div>}
    </div>
  );
}

/** Lightweight shimmer used while a card's payload is still resolving. */
function CardSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" data-testid="cli-card-skeleton">
      <div className="h-3 w-1/3 rounded bg-border-soft" />
      <div className="h-3 w-2/3 rounded bg-border-soft" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-8 rounded bg-border-soft" />
        <div className="h-8 rounded bg-border-soft" />
      </div>
    </div>
  );
}

/** Two-column attribute grid with a built-in show-more affordance. */
function FieldGrid({
  rows,
  locale,
  initial = 6,
}: {
  rows: Array<{ label: string; value: React.ReactNode }>;
  locale: CliLocale;
  initial?: number;
}) {
  if (rows.length === 0) return null;
  return (
    <ShowMoreList
      items={rows}
      initial={initial}
      locale={locale}
      as="dl"
      className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]"
      render={(r, i) => (
        <React.Fragment key={`${r.label}-${i}`}>
          <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px] self-center">
            {r.label}
          </dt>
          <dd className="text-text truncate" title={typeof r.value === "string" ? r.value : undefined}>
            {r.value}
          </dd>
        </React.Fragment>
      )}
    />
  );
}

/* ───────────── Task #549 — long-form note blocks ───────────── */

// Free-text fields that read poorly in the truncating two-column grid
// (RAID mitigation, deliverable re-draft notes). They get a full-width
// wrapped block instead so the whole text is visible on the card.
const NOTE_KEYS = new Set(["mitigation", "notes"]);

const NOTE_LABELS: Record<string, { en: string; ar: string }> = {
  mitigation: { en: "Mitigation", ar: "خطة التخفيف" },
  notes: { en: "Notes", ar: "ملاحظات" },
};

function NoteBlock({
  noteKey,
  text,
  locale,
}: {
  noteKey: string;
  text: string;
  locale: CliLocale;
}) {
  const key = noteKey.toLowerCase();
  const lbl = NOTE_LABELS[key];
  const label = lbl ? (locale === "ar" ? lbl.ar : lbl.en) : humanLabel(noteKey);
  return (
    <div className="mt-2" data-testid="cli-note-block" data-note-key={key}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-0.5">
        {label}
      </div>
      <div className="text-[12px] text-text leading-relaxed whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}

/* ───────────────────────── write_success ───────────────────────── */

// Task #573 — committed write turns end with a single, calm success card
// (green check + the same one-line summary the user confirmed + an
// optional link to the destination). Replaces the raw entity_card debug
// echo of {stage,verb,payload,…}.
function WriteSuccess({ data, locale }: { data: Json; locale: CliLocale }) {
  const ar = locale === "ar";
  const summary = asStr(data.summary);
  const nav = asObj(data.navigateTo);
  const href = asStr(nav.path);
  const label = summary || (ar ? "تم تنفيذ التغيير." : "Change applied.");
  return (
    <div
      className="bg-success/10 border border-success/40 rounded-md p-3 flex items-start gap-2"
      data-testid="cli-write-success"
    >
      <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
      <div className="flex-1 text-xs text-text leading-relaxed">{label}</div>
      {href && <OpenLink href={href} locale={locale} />}
    </div>
  );
}

/* ───────────────── duplicate-opportunity cards (Task #39) ───────────────── */

type DupMatch = { id?: string; name?: string; salesStage?: string | null; exact?: boolean };

function asDupMatch(v: unknown): DupMatch | null {
  const o = asObj(v);
  if (!o.id && !o.name) return null;
  return {
    id: asStr(o.id),
    name: asStr(o.name),
    salesStage: o.salesStage == null ? null : asStr(o.salesStage),
    exact: o.exact === true,
  };
}

/**
 * Prominent warning block rendered inside the confirm card when the
 * opportunity_create proposal carries `diff.duplicateWarning`. Confirming
 * a card that shows this warning is the explicit duplicate override, so
 * the warning must never be buried in the summary text alone.
 */
export function DuplicateWarningBlock({
  warning,
  locale,
}: {
  warning: unknown;
  locale: CliLocale;
}) {
  const w = asObj(warning);
  const exact = asDupMatch(w.exact);
  const similar = asArr(w.similar)
    .map(asDupMatch)
    .filter((d): d is DupMatch => d !== null)
    // The exact match already has its own callout — don't repeat it.
    .filter((d) => !exact || d.id !== exact.id);
  if (!exact && similar.length === 0) return null;
  const danger = !!exact;
  return (
    <div
      className={cn(
        "rounded p-2 space-y-1.5 border",
        danger ? "bg-danger/10 border-danger/50" : "bg-warning/10 border-warning/50",
      )}
      data-testid="cli-duplicate-warning"
      data-dup-kind={danger ? "exact" : "similar"}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider",
          danger ? "text-danger" : "text-warning",
        )}
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {s("dupWarnTitle", locale)}
      </div>
      {exact && (
        <div className="text-[11px] text-text leading-relaxed" data-testid="cli-duplicate-exact">
          {s("dupWarnExact", locale)}
        </div>
      )}
      {similar.length > 0 && (
        <>
          <div className="text-[11px] text-text-mute">{s("dupWarnSimilar", locale)}</div>
          <ul className="text-[11px] text-text space-y-0.5">
            {similar.map((d, i) => (
              <li
                key={d.id || i}
                className="flex items-center gap-2"
                data-testid="cli-duplicate-similar-row"
              >
                <span className="truncate">
                  · {d.name}
                  {d.salesStage ? ` (${s("dupStage", locale)}: ${humanLabel(d.salesStage)})` : ""}
                </span>
                {d.id && <OpenLink href={`/opportunities/${d.id}`} locale={locale} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {exact?.id && (
        <div className="flex items-center gap-2 text-[11px] text-text" data-testid="cli-duplicate-existing">
          <span className="truncate">
            · {exact.name}
            {exact.salesStage ? ` (${s("dupStage", locale)}: ${humanLabel(exact.salesStage)})` : ""}
          </span>
          <OpenLink href={`/opportunities/${exact.id}`} locale={locale} />
        </div>
      )}
    </div>
  );
}

/**
 * Friendly rejection card for the `duplicate_opportunity` errorCode —
 * a bare commit was blocked because an open deal with the same name
 * already exists. Links straight to the existing deal instead of
 * dumping the raw error string.
 */
export function DuplicateRejectionCard({
  data,
  locale,
}: {
  data: unknown;
  locale: CliLocale;
}) {
  const d = asObj(data);
  const dup = asObj(d.duplicate);
  const existing = asDupMatch(dup.existing);
  const href = existing?.id ? `/opportunities/${existing.id}` : asStr(asObj(d.navigateTo).path);
  return (
    <div
      className="bg-warning/10 border border-warning/50 rounded-md p-3 space-y-1.5"
      data-testid="cli-duplicate-rejection"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-warning">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {s("dupRejectTitle", locale)}
      </div>
      <div className="text-xs text-text leading-relaxed">{s("dupRejectBody", locale)}</div>
      {existing && (
        <div className="flex items-center gap-2 text-[11px] text-text">
          <span className="truncate">
            · {existing.name}
            {existing.salesStage
              ? ` (${s("dupStage", locale)}: ${humanLabel(existing.salesStage)})`
              : ""}
          </span>
        </div>
      )}
      {href && (
        <a
          href={href}
          className="inline-flex items-center gap-1 text-[11px] text-gold hover:underline"
          data-testid="cli-duplicate-rejection-link"
        >
          {s("dupRejectOpen", locale)}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

/* ─────────────────────────── dispatcher ─────────────────────────── */

export function ToolResultCardList({
  toolResults,
  capabilities,
  locale,
  onPickDisambig,
  onRunSlash,
}: {
  toolResults: NonNullable<import("./types").CliTurn["toolResults"]>;
  capabilities: CliCapability[];
  locale: CliLocale;
  /** Task #411 — entity_resolution click-to-pick handler. */
  onPickDisambig?: (id: string, label: string) => void;
  /** Task #411 round-6 — gate_report partner-override slash dispatcher. */
  onRunSlash?: (cmd: string) => void;
}) {
  // Task #645 — one action must never render two identical cards: drop
  // exact-duplicate tool results (same tool, outcome and payload) before
  // mapping to cards.
  const seenCardKeys = new Set<string>();
  const dedupedResults = toolResults.filter((tr) => {
    let key: string;
    try {
      key = `${tr.tool}|${tr.ok}|${tr.errorCode ?? ""}|${JSON.stringify(tr.data ?? null)}`;
    } catch {
      key = `${tr.tool}|${tr.ok}|${tr.errorCode ?? ""}`;
    }
    if (seenCardKeys.has(key)) return false;
    seenCardKeys.add(key);
    return true;
  });
  return (
    <div className="space-y-2.5" data-testid="cli-tool-results">
      {dedupedResults.map((tr, i) => {
        const cap = capabilities.find((c) => c.toolName === tr.tool) ?? null;
        // Task #411 — orchestrator coordinator tools (resolve_entity,
        // evaluate_gate) emit shape-tagged payloads via the data
        // envelope itself. Prefer the per-result shape hint over the
        // capability default so a single tool can carry both flavours.
        const dataObj =
          tr.data && typeof tr.data === "object"
            ? (tr.data as Record<string, unknown>)
            : {};
        const dataShape = (dataObj.shape ?? null) as string | null;
        const shape = dataShape ?? cap?.resultCard ?? null;

        // Task #573 — a clean, unambiguous entity resolution is already
        // implied by the confirm summary / result card. Only show the
        // resolution card when the resolver needs the user to
        // disambiguate (options present) or when it found nothing.
        if (shape === "entity_resolution" && tr.ok) {
          const opts = dataObj.options;
          const hasOptions = Array.isArray(opts) && opts.length > 0;
          const entity = dataObj.entity as Record<string, unknown> | undefined;
          if (!hasOptions && entity && entity.id) return null;
        }

        // Task #573 — committed writes render as one clean success card,
        // not the raw {stage,verb,payload,…} entity_card debug echo.
        if (shape === "write_success" && tr.ok) {
          return <WriteSuccess key={`${tr.tool}-${i}`} data={dataObj} locale={locale} />;
        }

        // Task #39 — a blocked duplicate commit gets a friendly card
        // that links to the existing deal, not a raw error dump.
        if (!tr.ok && tr.errorCode === "duplicate_opportunity") {
          return (
            <DuplicateRejectionCard key={`${tr.tool}-${i}`} data={tr.data} locale={locale} />
          );
        }

        return (
          <ToolResultCard
            key={`${tr.tool}-${i}`}
            tool={tr.tool}
            ok={tr.ok}
            data={tr.data}
            errorMessage={tr.errorMessage}
            shape={shape}
            locale={locale}
            onPickDisambig={onPickDisambig}
            onRunSlash={onRunSlash}
          />
        );
      })}
    </div>
  );
}

function ToolResultCard({
  tool,
  ok,
  data,
  errorMessage,
  shape,
  locale,
  onPickDisambig,
  onRunSlash,
}: {
  tool: string;
  ok: boolean;
  data: unknown;
  errorMessage?: string;
  shape: string | null;
  locale: CliLocale;
  onPickDisambig?: (id: string, label: string) => void;
  onRunSlash?: (cmd: string) => void;
}) {
  // Task #573 — derive a concise, meaningful title from the tool name
  // (e.g. `account_snapshot` → "Account snapshot"). The capability
  // `description` was previously sliced at the first period, which
  // produced long, sentence-fragment titles that read as debug noise.
  const titleLabel = humanLabel(tool);
  return (
    <div
      className="bg-bg-elevate border border-border rounded-md overflow-hidden"
      data-testid="cli-tool-result-card"
      data-tool={tool}
      data-shape={shape ?? "unknown"}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-soft text-[11px] font-mono text-text-faint">
        <span className="truncate" title={titleLabel}>
          {titleLabel}
        </span>
        <span className="ml-2 inline-flex items-center gap-1.5 shrink-0">
          <span className="uppercase tracking-wider text-text-mute">
            {shape ?? tool}
          </span>
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              ok ? "bg-success" : "bg-danger",
            )}
            aria-hidden
          />
        </span>
      </div>
      <div className="p-3">
        {!ok ? (
          <div className="text-xs text-danger" data-testid="cli-tool-error">
            {errorMessage ?? (locale === "ar" ? "فشلت الأداة" : "tool failed")}
          </div>
        ) : (
          <ShapeBody shape={shape} data={asObj(data)} locale={locale} onPickDisambig={onPickDisambig} onRunSlash={onRunSlash} />
        )}
      </div>
    </div>
  );
}

function ShapeBody({
  shape,
  data,
  locale,
  onPickDisambig,
  onRunSlash,
}: {
  shape: string | null;
  data: Json;
  locale: CliLocale;
  onPickDisambig?: (id: string, label: string) => void;
  onRunSlash?: (cmd: string) => void;
}) {
  switch (shape) {
    // Task #411 — orchestrator policy renderers.
    case "gate_report":
      return <GateReport data={data} locale={locale} onRunSlash={onRunSlash} />;
    case "entity_resolution":
      return <EntityResolution data={data} locale={locale} onPickDisambig={onPickDisambig} />;
    case "kpi_strip":
      return <KpiStrip data={data} locale={locale} />;
    case "ranked_list":
      return <RankedList data={data} locale={locale} />;
    case "time_series":
      return <TimeSeries data={data} locale={locale} />;
    case "entity_card":
      return <EntityCard data={data} locale={locale} />;
    case "audit_timeline":
      return <AuditTimeline data={data} locale={locale} />;
    case "change_order_card":
      return <ChangeOrderCard data={data} locale={locale} />;
    case "deliverable_acceptance_card":
      return <DeliverableAcceptanceCard data={data} locale={locale} />;
    case "invoice_card":
      return <InvoiceCard data={data} locale={locale} />;
    case "ar_aging_grid":
      return <ArAgingGrid data={data} locale={locale} />;
    case "dunning_card":
      return <DunningCard data={data} locale={locale} />;
    case "cash_receipt_card":
      return <CashReceiptCard data={data} locale={locale} />;
    case "bank_recon_card":
      return <BankReconCard data={data} locale={locale} />;
    case "cash_forecast_strip":
      return <CashForecastStrip data={data} locale={locale} />;
    case "renewal_card":
      return <RenewalCard data={data} locale={locale} />;
    case "agent_run":
      return <AgentRunCard data={data} locale={locale} />;
    // Task #560 — chat account-creation proposal card.
    case "account_proposal":
      return <AccountProposalCard data={data} locale={locale} />;
    // Task #539 — CRM result cards (previously fell through to raw JSON).
    case "account_card":
    case "contact_card":
    case "opportunity_card":
    case "charter_card":
    case "section_card":
    case "proposal_card":
    case "qualifier_card":
    case "meeting_card":
    case "deliverable_card":
    case "raid_item":
    case "raid_batch":
    case "pov_card":
    case "expense_card":
    case "expense_batch":
    case "timesheet_card":
    case "profile_update_decision":
    case "cartographer_run":
      return <CrmEntityCard shape={shape} data={data} locale={locale} />;
    case "qualification_rubric":
      return <QualificationRubric data={data} locale={locale} />;
    default:
      return <FallbackJson data={data} />;
  }
}

/* ─────────────── Task #560 — account-creation proposal ─────────────── */

function AccountProposalCard({
  data,
  locale,
}: {
  data: Json;
  locale: CliLocale;
}) {
  const { openWithPrefill } = useCreateAccount();
  const ar = locale === "ar";
  const draft = asObj(data.draft);
  const brief = asObj(draft.researchBrief);
  const degraded = data.degraded === true;

  const name = asStr(draft.name) || (ar ? "حساب جديد" : "New account");
  const summary = asStr(draft.refreshedSummary);
  const sector = asStr(draft.sector);
  const country = asStr(draft.country);
  const hqCity = asStr(draft.hqCity);
  const tier = asStr(draft.tier);

  const priorities = asArr(draft.strategicPriorities)
    .map((p) => (typeof p === "string" ? p : asStr(asObj(p).text)))
    .filter((t) => t.trim().length > 0)
    .slice(0, 5);

  const whyNow =
    asStr(brief.whyNowHypothesis) || asStr(brief.singleMostImportant);
  const mandateAngles = asArr(brief.mandateAngles)
    .map((m) => asObj(m))
    .filter((m) => asStr(m.title).trim().length > 0)
    .slice(0, 3);

  const signalCount = asArr(draft.sourceSignals).length;
  const dmCount = asArr(draft.decisionMakers).length;

  const facts: Array<{ label: string; value: string }> = [
    { label: ar ? "القطاع" : "Sector", value: sector },
    { label: ar ? "الدولة" : "Country", value: country },
    { label: ar ? "المقر" : "HQ", value: hqCity },
    { label: ar ? "الفئة" : "Tier", value: tier },
  ].filter((f) => f.value.trim().length > 0);

  // Task #587 — carry the FULL reviewed research through the dialog so create
  // persists exactly what's shown here (no second Cartographer run). The
  // decision-makers become the editable "Proposed stakeholders" list.
  const decisionMakers = asArr(draft.decisionMakers)
    .map((d) => asObj(d))
    .filter((d) => asStr(d.fullName).trim().length > 0)
    .map((d) => ({
      fullName: asStr(d.fullName).trim(),
      title: asStr(d.title) || null,
      seniority: (asStr(d.seniority) || null) as
        | "board_chair" | "board_member" | "c_suite" | "vp" | "director" | "manager" | "ic" | null,
      buyerPersona: asStr(d.buyerPersona) || null,
      sourceUrl: asStr(d.sourceUrl) || null,
      confidence: asStr(d.confidence) === "verified" ? "verified" : "inferred",
      reportsToName: asStr(d.reportsToName) || null,
      rationale: asStr(d.rationale) || null,
    })) as Array<{
      fullName: string;
      title: string | null;
      seniority: "board_chair" | "board_member" | "c_suite" | "vp" | "director" | "manager" | "ic" | null;
      buyerPersona: string | null;
      sourceUrl: string | null;
      confidence: "verified" | "inferred";
      reportsToName: string | null;
      rationale: string | null;
    }>;
  const strategicPriorityRefs = asArr(draft.strategicPriorities)
    .map((p) => asObj(p))
    .map((p) => ({
      text: asStr(p.text),
      sourceUrls: asArr(p.sourceUrls).map((u) => asStr(u)).filter(Boolean),
    }))
    .filter((p) => p.text.trim().length > 0);

  // Task #601 — firmographic enrichment carried onto the dialog so the
  // partner reviews/edits real values instead of blank defaults.
  const annualRevenueObj = asObj(draft.annualRevenue);
  const annualRevenue =
    Object.keys(annualRevenueObj).length > 0
      ? {
          amount:
            typeof annualRevenueObj.amount === "number"
              ? annualRevenueObj.amount
              : null,
          currency: asStr(annualRevenueObj.currency) || null,
          asOf: asStr(annualRevenueObj.asOf) || null,
          sourceUrl: asStr(annualRevenueObj.sourceUrl) || null,
          note: asStr(annualRevenueObj.note) || null,
        }
      : null;
  const holdingObj = asObj(draft.holdingStructure);
  const holdingStructure =
    Object.keys(holdingObj).length > 0
      ? {
          isHoldingCompany: holdingObj.isHoldingCompany === true,
          isMultiBrand: holdingObj.isMultiBrand === true,
          brands: asArr(holdingObj.brands)
            .map((b) => asStr(b))
            .filter((b) => b.trim().length > 0),
          note: asStr(holdingObj.note) || null,
        }
      : null;
  const countryPresence = asArr(draft.countryPresence)
    .map((c) => asObj(c))
    .map((c) => ({
      country: asStr(c.country).trim(),
      role: (asStr(c.role) || null) as
        | "hq" | "subsidiary" | "branch" | "office" | null,
      note: asStr(c.note) || null,
    }))
    .filter((c) => c.country.length > 0);

  const onReview = () =>
    openWithPrefill({
      name: asStr(draft.name),
      brandName: asStr(draft.brandName) || null,
      sector: sector || null,
      country: country || null,
      hqCity: hqCity || null,
      tier: tier || null,
      size: asStr(draft.size) || null,
      employeeCount:
        typeof draft.employeeCount === "number" ? draft.employeeCount : null,
      primaryCurrency: asStr(draft.primaryCurrency) || null,
      annualRevenue,
      holdingStructure,
      countryPresence,
      // Task #601 — carry the branch-vs-HQ answer (stamped on the draft by the
      // orchestrator's clarification flow) so it survives into the dialog.
      entityRole:
        (asStr(draft.entityRole) || null) as
          | "hq" | "subsidiary" | "branch" | "office" | null,
      industryCode: asStr(draft.industryCode) || null,
      subIndustryCode: asStr(draft.subIndustryCode) || null,
      strategicPriorities: asArr(draft.strategicPriorities) as Array<
        { text?: string; sourceUrls?: string[] } | string
      >,
      cogniriseHypothesis: asStr(draft.cogniriseHypothesis) || null,
      research: {
        refreshedSummary: summary || null,
        industryCode: asStr(draft.industryCode) || null,
        subIndustryCode: asStr(draft.subIndustryCode) || null,
        strategicPriorityRefs,
        sourceSignals: asArr(draft.sourceSignals),
        researchBrief: Object.keys(brief).length > 0 ? brief : null,
        decisionMakers,
      },
    });

  return (
    <div
      className="rounded-xl border border-gold/40 bg-bg-elevate/60 p-4"
      dir={ar ? "rtl" : "ltr"}
      data-testid="card-account-proposal"
    >
      <div className="flex items-start gap-2">
        <MapIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-text-mute">
            {ar ? "اقتراح حساب" : "Account proposal"}
          </div>
          <div className="truncate text-base font-semibold text-text">{name}</div>
        </div>
      </div>

      {degraded ? (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm leading-relaxed text-text">
          {ar
            ? "تعذّر إكمال البحث الآلي. المسودة أدناه تحتوي فقط على ما أدخلته — أكمل بقية التفاصيل عبر «مراجعة وإنشاء»."
            : "Automated research couldn't complete. The draft below has only what you entered — add the rest on Review & Create."}
        </p>
      ) : null}

      {summary ? (
        <p className="mt-2 text-sm leading-relaxed text-text-mute">{summary}</p>
      ) : null}

      {facts.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-text-mute">
                {f.label}
              </dt>
              <dd className="truncate text-sm text-text">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {priorities.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-text-mute">
            {ar ? "الأولويات الاستراتيجية" : "Strategic priorities"}
          </div>
          <ul className="mt-1 space-y-1">
            {priorities.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-text">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {whyNow ? (
        <div className="mt-3 rounded-lg border border-gold/20 bg-gold/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-gold">
            {ar ? "لماذا الآن" : "Why now"}
          </div>
          <p className="mt-0.5 text-sm text-text">{whyNow}</p>
        </div>
      ) : null}

      {mandateAngles.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-text-mute">
            {ar ? "زوايا التكليف" : "Mandate angles"}
          </div>
          <ul className="mt-1 space-y-1.5">
            {mandateAngles.map((m, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-text">{asStr(m.title)}</span>
                {asStr(m.whyNow) ? (
                  <span className="text-text-mute"> — {asStr(m.whyNow)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-[11px] text-text-mute">
          {ar
            ? `${signalCount} إشارة · ${dmCount} صانع قرار`
            : `${signalCount} signal${signalCount === 1 ? "" : "s"} · ${dmCount} decision-maker${dmCount === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={onReview}
          data-testid="button-review-create-account"
          className="rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-bg-base transition hover:bg-gold/90"
        >
          {ar ? "مراجعة وإنشاء" : "Review & Create"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Task #539 — CRM entity cards ─────────────── */

interface CrmMeta {
  en: string;
  ar: string;
  Icon: LucideIcon;
}

const CRM_META: Record<string, CrmMeta> = {
  account_card: { en: "Account", ar: "حساب", Icon: Building2 },
  contact_card: { en: "Contact", ar: "جهة اتصال", Icon: User },
  opportunity_card: { en: "Opportunity", ar: "فرصة", Icon: Target },
  charter_card: { en: "Charter", ar: "ميثاق", Icon: FileCheck2 },
  section_card: { en: "Proposal section", ar: "قسم العرض", Icon: FileText },
  proposal_card: { en: "Proposal", ar: "عرض", Icon: FileText },
  qualifier_card: { en: "Qualification", ar: "تأهيل", Icon: ClipboardCheck },
  meeting_card: { en: "Meeting", ar: "اجتماع", Icon: CalendarClock },
  deliverable_card: { en: "Deliverable", ar: "مُخرَج", Icon: Package },
  raid_item: { en: "RAID item", ar: "عنصر RAID", Icon: AlertTriangle },
  raid_batch: { en: "RAID items", ar: "عناصر RAID", Icon: AlertTriangle },
  pov_card: { en: "Point of view", ar: "وجهة نظر", Icon: Lightbulb },
  expense_card: { en: "Expense", ar: "مصروف", Icon: Receipt },
  expense_batch: { en: "Expenses", ar: "مصروفات", Icon: Receipt },
  timesheet_card: { en: "Timesheet", ar: "جدول زمني", Icon: Clock },
  profile_update_decision: { en: "Profile update", ar: "تحديث الملف", Icon: UserCheck },
  cartographer_run: { en: "Cartographer", ar: "رسم الخرائط", Icon: MapIcon },
};

// Keys consumed by the header/footer chrome — excluded from the
// auto-generated attribute grid so they don't render twice.
const CRM_SKIP_KEYS = new Set([
  "id",
  "name",
  "title",
  "label",
  "merchant",
  "href",
  "navigateTo",
  "shape",
  "status",
  "decision",
  "disposition",
  "count",
  "createdCount",
  "ids",
  "attachmentIds",
  "preview",
  "missingFields",
  "dispatched",
  "currency",
]);

const CRM_ID_KEYS = [
  "id",
  "contactId",
  "opportunityId",
  "accountId",
  "versionId",
  "weekId",
  "raidId",
  "updateId",
  "sectionId",
  "engagementId",
] as const;

function crmFormatField(key: string, value: unknown, currency: string | null, locale: CliLocale): React.ReactNode {
  const n = asNum(value);
  if (n != null) {
    if (/amount|dealsize|deal_size|value|total|price|cost|budget|fee/i.test(key)) {
      return fmtMoney(n, currency);
    }
    if (/pct|percent|probability/i.test(key)) return fmtPct(n);
    return fmtNum(n);
  }
  const s = asStr(value);
  if (looksLikeDate(s)) return fmtDate(s, locale);
  return s;
}

function CrmEntityCard({
  shape,
  data,
  locale,
}: {
  shape: string;
  data: Json;
  locale: CliLocale;
}) {
  const ar = locale === "ar";
  const meta = CRM_META[shape] ?? {
    en: humanLabel(shape.replace(/_card$/, "")),
    ar: humanLabel(shape.replace(/_card$/, "")),
    Icon: FileText,
  };
  const Icon = meta.Icon;
  const kindLabel = ar ? meta.ar : meta.en;

  const title =
    asStr(data.name) || asStr(data.title) || asStr(data.merchant) || asStr(data.label);
  let id = "";
  for (const k of CRM_ID_KEYS) {
    if (data[k]) {
      id = asStr(data[k]);
      break;
    }
  }

  const nav = asObj(data.navigateTo);
  const href = asStr(data.href) || asStr(nav.path);
  const currency = asStr(data.currency) || null;

  // Status pill — prefer explicit status, then a decision/disposition,
  // then a dispatched flag (Cartographer).
  let status = asStr(data.status) || asStr(data.decision) || asStr(data.disposition);
  if (!status && data.dispatched === true) status = "dispatched";

  // Batch count (raid_batch / expense_batch).
  const count = asNum(data.count) ?? asNum(data.createdCount);

  // Special-case stage transitions so "from → to" reads as one row.
  const fromStage = asStr(data.fromStage) || asStr(data.from);
  const toStage = asStr(data.toStage) || asStr(data.to);

  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  // Task #549 — collect free-text note fields (mitigation / notes) for a
  // full-width wrapped block instead of a truncated grid cell.
  const noteRows: Array<{ key: string; text: string }> = [];
  if (fromStage && toStage) {
    rows.push({
      label: ar ? "المرحلة" : "Stage",
      value: (
        <span className="font-mono text-[11px]">
          {humanLabel(fromStage)} <span className="text-text-faint">→</span>{" "}
          <span className="text-gold">{humanLabel(toStage)}</span>
        </span>
      ),
    });
  }
  for (const [k, v] of Object.entries(data)) {
    if (CRM_SKIP_KEYS.has(k)) continue;
    if (k === "fromStage" || k === "toStage" || k === "from" || k === "to") continue;
    if (v == null || v === "") continue;
    if (typeof v === "object") continue; // arrays/objects handled elsewhere
    if (NOTE_KEYS.has(k.toLowerCase()) && typeof v === "string" && v.trim() !== "") {
      noteRows.push({ key: k, text: v });
      continue;
    }
    rows.push({ label: humanLabel(k), value: crmFormatField(k, v, currency, locale) });
  }

  // Money summary for single-expense cards (amount + currency).
  const amount = asNum(data.amount);
  const hasBody =
    title || id || rows.length > 0 || noteRows.length > 0 || status || count != null || amount != null;

  if (!hasBody) {
    return (
      <EmptyState
        icon={Icon}
        title={ar ? `لا توجد تفاصيل ${kindLabel}` : `No ${meta.en.toLowerCase()} details`}
      />
    );
  }

  return (
    <div data-testid="cli-crm-card" data-crm-shape={shape}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-4 h-4 text-gold mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
              {kindLabel}
            </div>
            <div className="text-sm font-semibold truncate" title={title || undefined}>
              {title ||
                (amount != null
                  ? fmtMoney(amount, currency)
                  : count != null
                    ? ar
                      ? `${count} عنصر`
                      : `${count} item${count === 1 ? "" : "s"}`
                    : kindLabel)}
            </div>
            {id && (
              <div className="text-[11px] font-mono text-text-faint truncate" title={id}>
                {id}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {status && <StatusPill value={status} />}
          {href && <OpenLink href={href} locale={locale} />}
        </div>
      </div>

      {title && amount != null && (
        <div className="mt-1.5 font-display text-lg">{fmtMoney(amount, currency)}</div>
      )}

      {count != null && (
        <div className="mt-1.5 text-[11px] font-mono text-text-mute">
          {ar
            ? `${count} عنصر تم إنشاؤها`
            : `${count} item${count === 1 ? "" : "s"} created`}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-2">
          <FieldGrid rows={rows} locale={locale} />
        </div>
      )}

      {noteRows.map((n) => (
        <NoteBlock key={n.key} noteKey={n.key} text={n.text} locale={locale} />
      ))}
    </div>
  );
}

/* ─────────────── Task #539 — qualification rubric ─────────────── */

function QualificationRubric({ data, locale }: { data: Json; locale: CliLocale }) {
  const ar = locale === "ar";
  const overall = asNum(data.overallScore);
  const dims = asArr(data.dimensions).map(asObj);
  const summary = asStr(data.summary);

  if (dims.length === 0 && overall == null && !summary) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={ar ? "لا يوجد تقييم تأهيل" : "No qualification scored yet"}
        hint={ar ? "أرفق مستنداً لتسجيله." : "Attach a document to score it."}
      />
    );
  }

  // Detect the score scale from the values present (0–5, 0–10, or 0–100).
  const allScores = [
    ...dims.map((d) => asNum(d.score) ?? 0),
    overall ?? 0,
  ];
  const peak = Math.max(...allScores, 0);
  const scale = peak <= 5 ? 5 : peak <= 10 ? 10 : 100;

  return (
    <div className="space-y-3" data-testid="cli-qualification-rubric">
      {overall != null && (
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
            {ar ? "النتيجة الإجمالية" : "Overall score"}
          </span>
          <span className="font-display text-xl text-text">
            {overall}
            <span className="text-text-faint text-sm"> / {scale}</span>
          </span>
        </div>
      )}

      {dims.length > 0 && (
        <ShowMoreList
          items={dims}
          initial={6}
          locale={locale}
          as="div"
          className="space-y-2"
          render={(d, i) => {
            const name = asStr(d.name) || `Dimension ${i + 1}`;
            const score = asNum(d.score);
            const evidence = asStr(d.evidence);
            const pctWidth = score != null ? Math.max(2, Math.min(100, (score / scale) * 100)) : 0;
            const tone =
              score == null
                ? "bg-border"
                : score / scale >= 0.66
                  ? "bg-success"
                  : score / scale >= 0.33
                    ? "bg-warning"
                    : "bg-danger";
            return (
              <div key={i}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-text truncate">{name}</span>
                  {score != null && (
                    <span className="font-mono text-text-mute shrink-0 ms-2">
                      {score} / {scale}
                    </span>
                  )}
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-bg-deep overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", tone)}
                    style={{ width: `${pctWidth}%` }}
                  />
                </div>
                {evidence && (
                  <div className="mt-1 text-[11px] text-text-mute leading-relaxed">
                    {evidence}
                  </div>
                )}
              </div>
            );
          }}
        />
      )}

      {summary && (
        <div className="border-t border-border-soft pt-2 text-xs text-text leading-relaxed">
          {summary}
        </div>
      )}
    </div>
  );
}

/* ─────────── Task #492 — prefill_from_specialist (agent_run) ─────────── */

function AgentRunCard({ data, locale }: { data: Json; locale: CliLocale }) {
  const ar = locale === "ar";
  const specialist = asObj(data.specialist);
  const draft = asObj(data.draft);
  const missing = asArr(data.missingRequiredFields).map(asStr).filter(Boolean);
  const cost = asNum(specialist.costUsd);
  const mode = asStr(specialist.mode);
  const specName = asStr(specialist.name) || asStr(specialist.id);

  const priorities = asArr(draft.strategicPriorities);
  const signals = asArr(draft.sourceSignals);
  const dms = asArr(draft.decisionMakers);
  const hypothesis = asStr(draft.cogniriseHypothesis);
  const summary = asStr(draft.refreshedSummary);

  const firmoFields: Array<[string, string]> = [
    ["name", "Name"],
    ["country", "Country"],
    ["sector", "Sector"],
    ["hqCity", "HQ"],
    ["tier", "Tier"],
    ["industryCode", "Industry"],
    ["subIndustryCode", "Sub-industry"],
  ];
  const firmoRows = firmoFields
    .map(([k, label]) => [label, asStr(draft[k])] as const)
    .filter(([, v]) => v !== "");

  const hasAnyDraft =
    firmoRows.length > 0 ||
    priorities.length > 0 ||
    signals.length > 0 ||
    dms.length > 0 ||
    hypothesis !== "" ||
    summary !== "";

  return (
    <div className="space-y-3" data-testid="cli-agent-run-card">
      {/* Specialist banner */}
      <div className="flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden />
          <span className="text-text-mute uppercase tracking-wider">
            {ar ? "متخصص" : "Specialist"}
          </span>
          <span className="text-text">{specName || "(specialist)"}</span>
          {mode && (
            <span className="px-1.5 py-0.5 rounded border border-border-soft text-text-mute">
              {mode}
            </span>
          )}
        </div>
        {cost != null && (
          <span className="text-text-faint">{fmtUsd(cost)}</span>
        )}
      </div>

      {!hasAnyDraft ? (
        <div className="text-xs text-text-mute italic">
          {ar ? "لم يُرجع المتخصص أي مسودة." : "Specialist returned no draft."}
        </div>
      ) : (
        <>
          {/* Firmographics */}
          {firmoRows.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
              {firmoRows.map(([label, value]) => (
                <div
                  key={label}
                  className="bg-bg-deep border border-border-soft rounded px-2 py-1.5"
                >
                  <div className="text-text-faint uppercase text-[10px]">{label}</div>
                  <div className="text-text">{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Refreshed summary */}
          {summary && (
            <div className="text-xs text-text leading-relaxed">{summary}</div>
          )}

          {/* Strategic priorities */}
          {priorities.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
                {ar ? "أولويات استراتيجية" : "Strategic priorities"}
              </div>
              <ul className="space-y-1.5">
                {priorities.map((p, i) => {
                  const po = asObj(p);
                  const text = asStr(po.text) || asStr(p);
                  const urls = asArr(po.sourceUrls).map(asStr).filter(Boolean);
                  return (
                    <li key={i} className="text-xs">
                      <div className="flex gap-1.5">
                        <span className="text-text-faint shrink-0">·</span>
                        <span className="text-text">{text}</span>
                      </div>
                      {urls.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5 ms-3">
                          {urls.map((u, j) => (
                            <a
                              key={j}
                              href={u}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] font-mono text-gold hover:underline"
                              title={u}
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              {hostOf(u)}
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Source signals */}
          {signals.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
                {ar ? "إشارات المصادر" : "Source signals"}
              </div>
              <ul className="space-y-1">
                {signals.slice(0, 6).map((s, i) => {
                  const so = asObj(s);
                  const title = asStr(so.title) || asStr(so.url);
                  const url = asStr(so.url);
                  const kind = asStr(so.kind);
                  const conf = asNum(so.confidence);
                  return (
                    <li
                      key={i}
                      className="flex items-baseline justify-between gap-2 text-[11px]"
                    >
                      <a
                        href={url || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-text hover:text-gold hover:underline"
                        title={url || title}
                      >
                        {title || "(untitled)"}
                      </a>
                      <span className="shrink-0 font-mono text-text-faint text-[10px]">
                        {kind}
                        {conf != null && ` · ${(conf * 100).toFixed(0)}%`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Decision makers */}
          {dms.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
                {ar ? "صنّاع القرار" : "Decision makers"}
              </div>
              <ul className="space-y-0.5">
                {dms.slice(0, 8).map((d, i) => {
                  const dmo = asObj(d);
                  const name = asStr(dmo.name);
                  const title = asStr(dmo.title);
                  const conf = asNum(dmo.confidence);
                  return (
                    <li
                      key={i}
                      className="flex items-baseline justify-between gap-2 text-[11px]"
                    >
                      <span className="truncate">
                        <span className="text-text">{name || "(name)"}</span>
                        {title && (
                          <span className="text-text-mute"> · {title}</span>
                        )}
                      </span>
                      {conf != null && (
                        <span className="shrink-0 font-mono text-text-faint text-[10px]">
                          {(conf * 100).toFixed(0)}%
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Cognirise hypothesis */}
          {hypothesis && (
            <div className="border-t border-border-soft pt-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-0.5">
                {ar ? "فرضية Cognirise" : "Cognirise hypothesis"}
              </div>
              <div className="text-xs text-text leading-relaxed italic">
                {hypothesis}
              </div>
            </div>
          )}
        </>
      )}

      {/* Missing fields */}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
          <span className="text-text-faint uppercase tracking-wider">
            {ar ? "مطلوب" : "Needs"}
          </span>
          {missing.map((m) => (
            <span
              key={m}
              className="px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning"
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 24);
  }
}

/* ─────────────────── Task #363 — L2C Wave 4 cards ─────────────────── */

function CashReceiptCard({ data, locale: _locale }: { data: Json; locale: CliLocale }) {
  const r = asObj(data.receipt ?? data);
  const apps = asArr(data.applicationIds);
  const recommended = asStr(data.recommended);
  const candidates = asArr(data.candidates);
  const total = asNum(r.totalAmount) ?? 0;
  const applied = asNum(r.appliedAmount) ?? 0;
  return (
    <div className="space-y-2" data-testid="cli-cash-receipt-card">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-sm">{asStr(r.id) || "(receipt)"}</div>
        <div className="font-display text-lg">${fmtNum(total)}</div>
      </div>
      <div className="text-[11px] font-mono text-text-mute">
        applied {fmtNum(applied)} · remaining {fmtNum(total - applied)}
        {apps.length > 0 && ` · ${apps.length} application${apps.length === 1 ? "" : "s"}`}
      </div>
      {recommended && (
        <div className="text-[11px] font-mono">
          <span className="uppercase text-text-faint">recommended</span>{" "}
          <span className="text-gold">{recommended}</span>
        </div>
      )}
      {candidates.length > 0 && (
        <ul className="space-y-1">
          {candidates.slice(0, 5).map((c, i) => {
            const co = asObj(c);
            return (
              <li key={i} className="flex items-center justify-between text-[11px] font-mono">
                <span className="truncate">{asStr(co.invoiceNumber) || asStr(co.invoiceId)} — {asStr(co.rationale)}</span>
                <span className="ml-2 text-text-mute">{fmtNum(asNum(co.appliedAmount) ?? 0)} ({((asNum(co.confidence) ?? 0) * 100).toFixed(0)}%)</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BankReconCard({ data, locale: _locale }: { data: Json; locale: CliLocale }) {
  const id = asStr(data.id);
  const status = asStr(data.status);
  const variance = asNum(data.variance) ?? 0;
  const receipts = asNum(data.computedReceipts) ?? 0;
  const payments = asNum(data.computedPayments) ?? 0;
  return (
    <div className="space-y-1.5" data-testid="cli-bank-recon-card">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-sm">{id || "(recon)"}</div>
        <span className={cn("text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border",
          status === "finalised" ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30")}>
          {status || "open"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
        <div className="bg-bg-deep border border-border-soft rounded p-1.5">
          <div className="text-text-faint uppercase">receipts</div>
          <div>${fmtNum(receipts)}</div>
        </div>
        <div className="bg-bg-deep border border-border-soft rounded p-1.5">
          <div className="text-text-faint uppercase">payments</div>
          <div>${fmtNum(payments)}</div>
        </div>
        <div className={cn("bg-bg-deep border rounded p-1.5", Math.abs(variance) > 0.01 ? "border-danger/30" : "border-border-soft")}>
          <div className="text-text-faint uppercase">variance</div>
          <div className={cn(Math.abs(variance) > 0.01 ? "text-danger" : "text-success")}>${fmtNum(variance)}</div>
        </div>
      </div>
    </div>
  );
}

function CashForecastStrip({ data, locale }: { data: Json; locale: CliLocale }) {
  const weeks = asArr(data.weeks) as Json[];
  const gaps = asArr(data.cashGapWeeks);
  if (weeks.length === 0) {
    return <div className="text-xs text-text-mute italic">{locale === "ar" ? "لا توجد لقطة" : "No snapshot."}</div>;
  }
  const max = Math.max(1, ...weeks.map((w) => Math.abs(asNum(w.closingBalance) ?? 0)));
  return (
    <div data-testid="cli-cash-forecast-strip" className="space-y-2">
      <div className="grid grid-cols-13 gap-0.5" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
        {weeks.map((w, i) => {
          const close = asNum(w.closingBalance) ?? 0;
          const gap = !!w.isCashGap;
          const h = Math.max(4, Math.round((Math.abs(close) / max) * 40));
          return (
            <div key={i} className="flex flex-col items-center">
              <div className="text-[9px] font-mono text-text-faint">w{asNum(w.weekIndex) ?? i}</div>
              <div className={cn("w-full rounded", gap ? "bg-danger" : close >= 0 ? "bg-gold" : "bg-warning")} style={{ height: `${h}px` }} title={`${asStr(w.weekStart)}: ${close}`} />
            </div>
          );
        })}
      </div>
      <div className="text-[11px] font-mono text-text-mute">
        13 weeks · {gaps.length} gap{gaps.length === 1 ? "" : "s"}
        {gaps.length > 0 && <span className="text-danger ml-2">cash-gap weeks: {gaps.join(", ")}</span>}
      </div>
    </div>
  );
}

function RenewalCard({ data, locale }: { data: Json; locale: CliLocale }) {
  const r = asObj(data.renewal ?? data);
  const cur = asNum(r.currentArrUsd) ?? 0;
  const proposed = asNum(r.proposedArrUsd) ?? 0;
  const nrr = asNum(r.nrrDeltaPct) ?? 0;
  const risk = asStr(r.riskTier) || "green";
  const status = asStr(r.status) || "open";
  return (
    <div className="space-y-2" data-testid="cli-renewal-card">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-sm">{asStr(r.id)}</div>
        <span className={cn("text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border",
          risk === "red" ? "bg-danger/15 text-danger border-danger/30" :
          risk === "amber" ? "bg-warning/15 text-warning border-warning/30" :
          "bg-success/15 text-success border-success/30")}>{risk}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
        <div className="bg-bg-deep border border-border-soft rounded p-1.5">
          <div className="text-text-faint uppercase">current ARR</div>
          <div>${fmtNum(cur)}</div>
        </div>
        <div className="bg-bg-deep border border-border-soft rounded p-1.5">
          <div className="text-text-faint uppercase">proposed</div>
          <div>${fmtNum(proposed)}</div>
        </div>
        <div className={cn("bg-bg-deep border rounded p-1.5", nrr < 0 ? "border-danger/30" : "border-border-soft")}>
          <div className="text-text-faint uppercase">NRR Δ</div>
          <div className={cn(nrr >= 0 ? "text-success" : "text-danger")}>{nrr >= 0 ? "+" : ""}{nrr}%</div>
        </div>
      </div>
      <div className="text-[11px] font-mono text-text-mute">
        {locale === "ar" ? "حالة" : "status"}: {status}
        {r.renewalDueAt && <span className="ml-2">due {asStr(r.renewalDueAt)}</span>}
      </div>
    </div>
  );
}

/* ─────────────────────── change_order_card ─────────────────────── */

const CO_STATUS_TONE: Record<string, string> = {
  draft: "bg-bg-elevate-2 text-text-mute",
  partner_approved: "bg-gold/15 text-gold border-gold/30",
  client_proposed: "bg-warning/15 text-warning border-warning/30",
  client_accepted: "bg-success/15 text-success border-success/30",
  posted: "bg-success/20 text-success border-success/40",
  client_rejected: "bg-danger/15 text-danger border-danger/30",
  withdrawn: "bg-bg-elevate-2 text-text-faint",
};

function ChangeOrderCard({ data, locale }: { data: Json; locale: CliLocale }) {
  const co = asObj(data.changeOrder ?? data);
  const id = asStr(co.id);
  const status = asStr(co.status);
  const kind = asStr(co.kind);
  const summary = asStr(co.summary);
  const valueDelta = asNum(co.valueDeltaUsd);
  const engagementId = asStr(co.engagementId);
  const evidenceUrl = asStr(co.evidenceUrl);
  return (
    <div data-testid="change-order-card" className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug">{summary || "—"}</div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5 truncate">
            {id} · {kind}
          </div>
        </div>
        <span
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border",
            CO_STATUS_TONE[status] ?? "bg-bg-elevate-2 text-text-mute",
          )}
        >
          {status || "?"}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {valueDelta != null && (
          <>
            <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
              {locale === "ar" ? "Δ القيمة" : "Value Δ"}
            </dt>
            <dd
              className={cn(
                valueDelta > 0
                  ? "text-success"
                  : valueDelta < 0
                    ? "text-danger"
                    : "text-text",
              )}
            >
              {valueDelta > 0 ? "+" : ""}
              {fmtUsd(valueDelta)}
            </dd>
          </>
        )}
        {engagementId && (
          <>
            <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
              {locale === "ar" ? "الارتباط" : "Engagement"}
            </dt>
            <dd className="text-text font-mono text-[11px] truncate" title={engagementId}>
              <a
                href={`/clients/deliver/engagements/${engagementId}`}
                className="hover:text-gold inline-flex items-center gap-1"
              >
                {engagementId} <ExternalLink className="w-3 h-3" />
              </a>
            </dd>
          </>
        )}
      </dl>
      {evidenceUrl && (
        <div className="text-[11px] text-text-mute truncate">
          <a
            href={evidenceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline inline-flex items-center gap-1"
          >
            {locale === "ar" ? "دليل القبول" : "Evidence"}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Task #362 — L2C Wave 3 cards ─────────────────── */

function InvoiceCard({ data, locale: _locale }: { data: Json; locale: CliLocale }) {
  const inv = asObj(data.invoice ?? data);
  const lines = asArr(data.lines);
  const subs = asArr(data.submissions);
  const number = asStr(inv.invoiceNumber) || "(draft)";
  const status = asStr(inv.status) || "draft";
  const total = asNum(inv.total) ?? 0;
  const subtotal = asNum(inv.subtotal) ?? 0;
  const vat = asNum(inv.vatAmount) ?? 0;
  const currency = asStr(inv.currency) || "USD";
  const billTo = asObj(inv.billTo);
  return (
    <div className="space-y-2" data-testid="cli-invoice-card">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-mono text-sm">{number}</div>
          <div className="text-xs text-text-mute">{asStr(billTo.name) || "—"} · {asStr(inv.jurisdiction)}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-lg">{currency} {fmtNum(total)}</div>
          <div className="text-[10px] font-mono uppercase text-text-faint">{status}</div>
        </div>
      </div>
      <div className="text-[11px] font-mono text-text-mute">
        subtotal {fmtNum(subtotal)} · vat {fmtNum(vat)} · {lines.length} lines
      </div>
      {subs.length > 0 && (
        <div className="text-[11px] font-mono text-text-mute">
          {subs.map((s, i) => {
            const so = asObj(s);
            return <span key={i} className="mr-2">{asStr(so.channel).toUpperCase()}:{asStr(so.status)}</span>;
          })}
        </div>
      )}
    </div>
  );
}

/* ──────────────────── deliverable_acceptance_card ──────────────────── */

const DA_STATUS_TONE: Record<string, string> = {
  pending: "bg-bg-elevate-2 text-text-mute",
  submitted_to_client: "bg-warning/15 text-warning border-warning/30",
  client_signed: "bg-success/20 text-success border-success/40",
  client_rejected: "bg-danger/15 text-danger border-danger/30",
  withdrawn: "bg-bg-elevate-2 text-text-faint",
};

function DeliverableAcceptanceCard({ data, locale }: { data: Json; locale: CliLocale }) {
  const a = asObj(data.acceptance ?? data);
  const id = asStr(a.id);
  const status = asStr(a.status);
  const title = asStr(a.title);
  const attestation = asStr(a.attestationText);
  const signerName = asStr(a.clientSignerName);
  const signerEmail = asStr(a.clientSignerEmail);
  const signedAt = asStr(a.signedAt);
  const evidenceUrl = asStr(a.evidenceUrl);
  const milestoneId = asStr(a.milestoneId);
  const engagementId = asStr(a.engagementId);
  return (
    <div data-testid="deliverable-acceptance-card" className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug">{title || "—"}</div>
          <div className="text-[11px] font-mono text-text-faint mt-0.5 truncate">
            {id}
          </div>
        </div>
        <span
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border",
            DA_STATUS_TONE[status] ?? "bg-bg-elevate-2 text-text-mute",
          )}
        >
          {status || "?"}
        </span>
      </div>
      {attestation && (
        <p className="text-[12px] text-text leading-snug line-clamp-3 italic">
          “{attestation}”
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {signerName && (
          <>
            <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
              {locale === "ar" ? "الموقّع" : "Signer"}
            </dt>
            <dd className="text-text truncate" title={signerEmail}>
              {signerName}
            </dd>
          </>
        )}
        {signedAt && (
          <>
            <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
              {locale === "ar" ? "وُقّع في" : "Signed"}
            </dt>
            <dd className="text-text font-mono text-[11px]">
              {new Date(signedAt).toLocaleDateString()}
            </dd>
          </>
        )}
        {milestoneId && (
          <>
            <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
              {locale === "ar" ? "المعلم" : "Milestone"}
            </dt>
            <dd className="text-text font-mono text-[11px] truncate" title={milestoneId}>
              {milestoneId}
            </dd>
          </>
        )}
        {engagementId && (
          <>
            <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
              {locale === "ar" ? "الارتباط" : "Engagement"}
            </dt>
            <dd className="text-text font-mono text-[11px] truncate">
              <a href={`/clients/deliver/engagements/${engagementId}`} className="hover:text-gold">
                {engagementId}
              </a>
            </dd>
          </>
        )}
      </dl>
      {evidenceUrl && (
        <div className="text-[11px] text-text-mute truncate">
          <a
            href={evidenceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline inline-flex items-center gap-1"
          >
            {locale === "ar" ? "دليل التوقيع" : "Signed evidence"}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

function ArAgingGrid({ data, locale: _locale }: { data: Json; locale: CliLocale }) {
  const buckets = asArr(data.buckets);
  const total = asNum(data.totalOutstandingUsd) ?? 0;
  const count = asNum(data.invoiceCount) ?? 0;
  return (
    <div className="space-y-2" data-testid="cli-ar-aging-grid">
      <div className="grid grid-cols-5 gap-1.5">
        {buckets.map((b, i) => {
          const o = asObj(b);
          const label = asStr(o.bucket).replace(/^d/, "").replace("_", "–").replace("plus", "+");
          const v = asNum(o.totalUsd) ?? 0;
          return (
            <div key={i} className="bg-bg-deep border border-border-soft rounded p-1.5">
              <div className="text-[10px] font-mono uppercase text-text-faint">{label}</div>
              <div className="text-sm font-mono">${fmtNum(v)}</div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] font-mono text-text-mute">
        ${fmtNum(total)} outstanding · {count} invoices
      </div>
    </div>
  );
}

function DunningCard({ data, locale: _locale }: { data: Json; locale: CliLocale }) {
  const ev = asObj(data.event);
  const inv = asObj(data.invoice);
  const promises = asArr(data.promises);
  return (
    <div className="space-y-1.5" data-testid="cli-dunning-card">
      <div className="font-mono text-sm">
        {asStr(inv.invoiceNumber) || "(draft)"} · step {(asNum(ev.stepIndex) ?? 0) + 1} <span className="text-text-mute">({asStr(ev.template) || "—"})</span>
      </div>
      <div className="text-[11px] font-mono text-text-mute">
        outstanding {asStr(inv.currency)} {fmtNum((asNum(inv.total) ?? 0) - (asNum(inv.amountPaid) ?? 0))}
        {promises.length > 0 && ` · ${promises.length} promise${promises.length === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}

/* ─────────────────────────── kpi_strip ─────────────────────────── */

function KpiStrip({ data, locale }: { data: Json; locale: CliLocale }) {
  // pipeline.by_stage variant: { stages: [{ stage, count, weightedValueUsd, agedRedCount }] }
  const stages = asArr(data.stages) as Json[];
  if (stages.length > 0) {
    const max = Math.max(
      1,
      ...stages.map((s) => asNum(s.weightedValueUsd) ?? asNum(s.count) ?? 0),
    );
    return (
      <div data-testid="kpi-strip-stages">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {stages.map((s) => {
            const stage = asStr(s.stage);
            const count = asNum(s.count) ?? 0;
            const weighted = asNum(s.weightedValueUsd) ?? 0;
            const aged = asNum(s.agedRedCount) ?? 0;
            const fillPct = Math.max(2, Math.round((weighted / max) * 100));
            return (
              <div
                key={stage}
                className="bg-bg-deep border border-border-soft rounded p-2 flex flex-col gap-1"
                data-testid="kpi-stage"
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint truncate">
                  {stage.replace(/_/g, " ")}
                </div>
                <div className="text-lg font-semibold leading-none">
                  {count}
                </div>
                <div className="text-[11px] text-text-mute">
                  {fmtUsd(weighted)}
                </div>
                <div
                  className="h-1 rounded-full bg-bg-elevate-2 overflow-hidden"
                  aria-hidden
                >
                  <div
                    className="h-full bg-gold"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
                {aged > 0 && (
                  <div className="text-[10px] font-mono text-danger">
                    {aged} {locale === "ar" ? "متقادم" : "aged"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Generic: render each numeric / short-string field as a tile.
  const tiles = Object.entries(data).filter(([, v]) => {
    if (asNum(v) !== null) return true;
    if (typeof v === "string" && v.length > 0 && v.length <= 24) return true;
    return false;
  });
  if (tiles.length === 0) return <FallbackJson data={data} />;
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
      data-testid="kpi-strip-flat"
    >
      {tiles.map(([k, v]) => {
        const n = asNum(v);
        const isUsd = /usd|amount|value/i.test(k);
        const isPct = /pct|percent|%/i.test(k);
        const display =
          n != null
            ? isUsd
              ? fmtUsd(n)
              : isPct
                ? `${n.toFixed(1)}%`
                : fmtNum(n)
            : asStr(v);
        return (
          <div
            key={k}
            className="bg-bg-deep border border-border-soft rounded p-2"
            data-testid="kpi-tile"
          >
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint truncate">
              {humanLabel(k)}
            </div>
            <div className="text-base font-semibold mt-0.5">{display}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── ranked_list ─────────────────────────── */

function RankedList({ data, locale }: { data: Json; locale: CliLocale }) {
  const items = asArr(data.items) as Json[];
  const total = asNum(data.total);
  if (items.length === 0) {
    return (
      <div className="text-xs text-text-mute italic" data-testid="ranked-empty">
        {locale === "ar" ? "لا توجد عناصر" : "No items."}
      </div>
    );
  }
  // Detect a numeric "rank" field used to draw a bar.
  const numericKey =
    items.some((it) => asNum(it.weightedValueUsd) !== null)
      ? "weightedValueUsd"
      : items.some((it) => asNum(it.usdAmount) !== null)
        ? "usdAmount"
        : items.some((it) => asNum(it.totalHours) !== null)
          ? "totalHours"
          : items.some((it) => asNum(it.ageDays) !== null)
            ? "ageDays"
            : null;
  const max = numericKey
    ? Math.max(1, ...items.map((it) => asNum(it[numericKey]) ?? 0))
    : 0;

  return (
    <div data-testid="ranked-list">
      {total != null && total > items.length && (
        <div className="text-[11px] text-text-faint mb-1.5">
          {locale === "ar"
            ? `يعرض ${items.length} من ${total}`
            : `Showing ${items.length} of ${total}`}
        </div>
      )}
      <ul className="space-y-1">
        {items.slice(0, 20).map((it, idx) => {
          const id = asStr(it.id);
          const label = asStr(it.label) || id || `#${idx + 1}`;
          const href = asStr(it.href);
          const sev = asStr(it.severity || it.policyStatus || it.raidStatus || it.status).toLowerCase();
          const dot = SEV_DOT[sev];
          const meta = renderItemMeta(it, locale);
          const n = numericKey ? asNum(it[numericKey]) : null;
          const fillPct =
            n != null && max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0;
          const Container: React.ElementType = href ? "a" : "div";
          const containerProps = href
            ? {
                href,
                className:
                  "block bg-bg-deep border border-border-soft hover:border-gold/50 rounded px-2 py-1.5 transition-colors",
              }
            : {
                className:
                  "block bg-bg-deep border border-border-soft rounded px-2 py-1.5",
              };
          return (
            <li key={id || idx} data-testid="ranked-row">
              <Container {...containerProps}>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-mono text-text-faint mt-0.5 w-5 shrink-0 text-end">
                    {idx + 1}
                  </span>
                  {dot && (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 mt-1.5 rounded-full shrink-0",
                        dot,
                      )}
                      aria-hidden
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm leading-snug truncate">{label}</div>
                    {meta && (
                      <div className="text-[11px] font-mono text-text-faint mt-0.5">
                        {meta}
                      </div>
                    )}
                  </div>
                  {href && (
                    <ExternalLink className="w-3 h-3 text-text-faint mt-1 shrink-0" />
                  )}
                </div>
                {n != null && (
                  <div
                    className="h-1 mt-1.5 rounded-full bg-bg-elevate-2 overflow-hidden"
                    aria-hidden
                  >
                    <div
                      className="h-full bg-gold"
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                )}
              </Container>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function renderItemMeta(it: Json, locale: CliLocale): string | null {
  const parts: string[] = [];
  const pushIf = (cond: unknown, s: string) => {
    if (cond != null && cond !== "" && cond !== false) parts.push(s);
  };
  if (asNum(it.weightedValueUsd) != null)
    pushIf(true, fmtUsd(asNum(it.weightedValueUsd)!));
  else if (asNum(it.usdAmount) != null)
    pushIf(true, fmtUsd(asNum(it.usdAmount)!));
  if (asNum(it.totalHours) != null)
    pushIf(true, `${asNum(it.totalHours)}h`);
  if (asNum(it.daysInStage) != null)
    pushIf(true, `${asNum(it.daysInStage)}d in stage`);
  if (asNum(it.ageDays) != null)
    pushIf(true, locale === "ar" ? `منذ ${asNum(it.ageDays)} يوم` : `${asNum(it.ageDays)}d old`);
  if (typeof it.salesStage === "string") pushIf(true, asStr(it.salesStage));
  else if (typeof it.plmStage === "string") pushIf(true, asStr(it.plmStage));
  if (typeof it.plannedEndDate === "string")
    pushIf(true, `→ ${asStr(it.plannedEndDate)}`);
  if (typeof it.dueDate === "string" && it.dueDate)
    pushIf(true, `due ${asStr(it.dueDate)}`);
  if (typeof it.expiryDate === "string" && it.expiryDate)
    pushIf(true, `exp ${asStr(it.expiryDate)}`);
  if (typeof it.nextMilestone === "string" && it.nextMilestone)
    pushIf(true, asStr(it.nextMilestone));
  if (typeof it.message === "string" && it.message)
    pushIf(true, asStr(it.message));
  if (typeof it.kind === "string") pushIf(true, asStr(it.kind));
  if (Array.isArray(it.flags) && it.flags.length > 0)
    pushIf(true, `⚑ ${(it.flags as unknown[]).length}`);
  if (Array.isArray(it.findings) && it.findings.length > 0)
    pushIf(true, `${(it.findings as unknown[]).length} findings`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/* ─────────────────────────── time_series ─────────────────────────── */

function TimeSeries({ data, locale }: { data: Json; locale: CliLocale }) {
  const series = asArr(data.series) as Json[];
  if (series.length === 0) {
    return (
      <div className="text-xs text-text-mute italic" data-testid="series-empty">
        {locale === "ar" ? "لا بيانات في السلسلة" : "No series data."}
      </div>
    );
  }
  // Pull the first numeric field as the value (hours / value / amount).
  const valueKey =
    ["hours", "value", "amount", "billable"].find((k) =>
      series.some((row) => asNum(row[k]) !== null),
    ) ?? null;
  const labelKey =
    ["weekIso", "week", "date", "x", "label"].find((k) =>
      series.some((row) => typeof row[k] === "string"),
    ) ?? null;
  const points = series.map((row, i) => ({
    label: labelKey ? asStr(row[labelKey]) : `#${i + 1}`,
    value: valueKey ? (asNum(row[valueKey]) ?? 0) : 0,
    cumulative: asNum(row.cumulativeHours),
  }));
  const max = Math.max(1, ...points.map((p) => p.value));
  const total =
    asNum(data.totalHours) ??
    points.reduce((a, p) => a + p.value, 0);

  // Inline SVG bar chart — keeps dependencies zero and renders on the
  // brand palette. Width tracks the parent via viewBox + preserveAspectRatio.
  const W = 360;
  const H = 84;
  const pad = 4;
  const barGap = 2;
  const barW = Math.max(2, (W - pad * 2 - barGap * (points.length - 1)) / points.length);
  return (
    <div data-testid="time-series">
      <div className="flex items-end justify-between text-[11px] text-text-mute mb-1">
        <span className="font-mono">
          {points[0].label} → {points[points.length - 1].label}
        </span>
        <span>
          {locale === "ar" ? "الإجمالي" : "Total"}:{" "}
          <span className="text-text font-semibold">{fmtNum(total)}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-20"
        preserveAspectRatio="none"
        role="img"
        aria-label="time series chart"
      >
        {points.map((p, i) => {
          const x = pad + i * (barW + barGap);
          const h = Math.max(1, Math.round((p.value / max) * (H - pad * 2)));
          const y = H - pad - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={h}
              className="fill-gold/80"
              data-testid="series-bar"
            >
              <title>
                {p.label}: {fmtNum(p.value)}
              </title>
            </rect>
          );
        })}
      </svg>
      {/* Compact tabular fallback for screen readers & precise reads. */}
      <details className="mt-1.5 text-[11px] text-text-mute">
        <summary className="cursor-pointer hover:text-text">
          {locale === "ar" ? "عرض القيم" : "Show values"}
        </summary>
        <div className="mt-1 max-h-32 overflow-y-auto font-mono">
          {points.map((p, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span>{p.label}</span>
              <span>
                {fmtNum(p.value)}
                {p.cumulative != null && (
                  <span className="text-text-faint"> · Σ {fmtNum(p.cumulative)}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ─────────────────────────── entity_card ─────────────────────────── */

// Task #450 — prominent utilization signal for person_workload cards:
// total allocation % + over/fully/under-allocated indicator with a bar.
function CapacityBanner({
  totalPct,
  hiddenCount,
  locale,
}: {
  totalPct: number;
  hiddenCount: number;
  locale: CliLocale;
}) {
  const over = totalPct > 100;
  const full = totalPct === 100;
  const availablePct = Math.max(0, 100 - totalPct);
  const label = over
    ? locale === "ar"
      ? `محمّل زيادة بنسبة ${fmtNum(totalPct - 100)}٪`
      : `Overallocated by ${fmtNum(totalPct - 100)}%`
    : full
      ? locale === "ar"
        ? "مخصص بالكامل"
        : "Fully allocated"
      : locale === "ar"
        ? `متاح بنسبة ${fmtNum(availablePct)}٪`
        : `${fmtNum(availablePct)}% available`;
  const tone = over ? "danger" : full ? "warning" : "success";
  const toneText =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success";
  const toneBar =
    tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-success";
  const toneBox =
    tone === "danger"
      ? "border-danger/30 bg-danger/10"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10"
        : "border-success/30 bg-success/10";
  const barPct = Math.min(100, Math.max(0, totalPct));
  return (
    <div
      data-testid="workload-capacity-banner"
      className={`mt-2 rounded-lg border p-2.5 ${toneBox}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums">
          {fmtNum(totalPct)}%
          <span className="ml-1 text-[11px] font-normal text-text-faint">
            {locale === "ar" ? "إجمالي التخصيص" : "total allocation"}
          </span>
        </span>
        <span className={`text-xs font-semibold ${toneText}`}>{label}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border-soft">
        <div className={`h-full rounded-full ${toneBar}`} style={{ width: `${barPct}%` }} />
      </div>
      {hiddenCount > 0 && (
        <div className="mt-1.5 text-[11px] text-text-faint">
          {locale === "ar"
            ? "قد يكون التخصيص الفعلي أعلى — بعض الحسابات خارج نطاق صلاحياتك."
            : "Actual load may be higher — some accounts are outside your visibility."}
        </div>
      )}
    </div>
  );
}

function EntityCard({ data, locale }: { data: Json; locale: CliLocale }) {
  const name = asStr(data.name) || asStr(data.label) || asStr(data.id);
  const nav = asObj(data.navigateTo);
  const href = asStr(data.href) || asStr(nav.path);
  const currency = asStr(data.currency) || null;
  // Task #539 — `navigateTo`/`shape`/`kind` are chrome, not attributes;
  // surfacing them in the grid produced "[object Object]" rows.
  const skip = new Set([
    "id",
    "name",
    "label",
    "href",
    "weeks",
    "events",
    "navigateTo",
    "shape",
    "currency",
  ]);
  const kind = asStr(data.kind);
  // Task #450 — person_workload capacity signal. When the payload carries
  // engagement staffings + a totalAllocationPct, surface utilization
  // prominently as a banner + bar instead of burying it in the grid.
  const totalAlloc = asNum(data.totalAllocationPct);
  const showCapacity =
    totalAlloc != null && Array.isArray(data.engagementStaffings) && data.linkedUser === true;
  if (showCapacity) {
    skip.add("totalAllocationPct");
    skip.add("capacityStatus");
    skip.add("availablePct");
  }
  // Task #422 — nested plain objects (e.g. me.leave's `balance`) used to
  // string-coerce to "[object Object]". Flatten one level of scalar-valued
  // sub-objects into their own grid rows; skip anything deeper.
  const allRows: [string, unknown][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (skip.has(k) || k === "kind" || v == null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v as Json).filter(
        ([sk, sv]) =>
          sv != null && sv !== "" && typeof sv !== "object" && sk.toLowerCase() !== "year",
      );
      if (entries.length > 0 && entries.length <= 12) {
        for (const [sk, sv] of entries) allRows.push([`${k} ${sk}`, sv]);
      }
      continue;
    }
    allRows.push([k, v]);
  }
  // Task #549 — pull free-text note fields (mitigation / notes) out of the
  // grid so they render as full-width wrapped blocks instead of truncating.
  const noteRows = allRows.filter(
    ([k, v]) => NOTE_KEYS.has(k.toLowerCase()) && typeof v === "string" && v.trim() !== "",
  );
  const rows = allRows.filter(([k]) => !NOTE_KEYS.has(k.toLowerCase()));
  // utilization.person ships a `weeks` array — render a tiny sparkline.
  const weeks = asArr(data.weeks) as Json[];
  const flags = asArr(data.flags) as unknown[];

  return (
    <div data-testid="entity-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold truncate">{name || "—"}</span>
            {kind && (
              <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-text-faint border border-border-soft rounded px-1 py-px">
                {humanLabel(kind)}
              </span>
            )}
          </div>
          {data.id != null && (
            <div className="text-[11px] font-mono text-text-faint truncate">
              {asStr(data.id)}
            </div>
          )}
        </div>
        {href && <OpenLink href={href} locale={locale} />}
      </div>
      {showCapacity && totalAlloc != null && (
        <CapacityBanner
          totalPct={totalAlloc}
          hiddenCount={asNum(data.hiddenAccountCount) ?? 0}
          locale={locale}
        />
      )}
      {rows.length > 0 && (
        <div className="mt-2">
          <FieldGrid
            locale={locale}
            initial={8}
            rows={rows.map(([k, v]) => {
              if (Array.isArray(v)) {
                return { label: humanLabel(k), value: v.length === 0 ? "—" : `${v.length}` };
              }
              const n = asNum(v);
              const isUsd = /usd|amount|value|deal|price|cost|budget|fee/i.test(k);
              const isPct = /pct|percent|%|probability/i.test(k);
              const s = asStr(v);
              const display =
                n != null
                  ? isUsd
                    ? fmtMoney(n, currency)
                    : isPct
                      ? fmtPct(n)
                      : fmtNum(n)
                  : looksLikeDate(s)
                    ? fmtDate(s, locale)
                    : s;
              return { label: humanLabel(k), value: display };
            })}
          />
        </div>
      )}
      {noteRows.map(([k, v]) => (
        <NoteBlock key={k} noteKey={k} text={asStr(v)} locale={locale} />
      ))}
      {weeks.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
            {locale === "ar" ? "آخر الأسابيع" : "Recent weeks"}
          </div>
          <Sparkline
            points={weeks
              .slice()
              .reverse()
              .map((w) => ({
                label: asStr(w.weekIso),
                value: asNum(w.billable) ?? 0,
              }))}
          />
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {flags.slice(0, 6).map((f, i) => (
            <span
              key={i}
              className="text-[10px] font-mono bg-warning/15 text-warning border border-warning/30 rounded px-1.5 py-0.5"
            >
              ⚑ {asStr(f)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Sparkline({
  points,
}: {
  points: Array<{ label: string; value: number }>;
}) {
  if (points.length === 0) return null;
  const W = 200;
  const H = 32;
  const max = Math.max(1, ...points.map((p) => p.value));
  const pad = 2;
  const barGap = 1;
  const barW = Math.max(2, (W - pad * 2 - barGap * (points.length - 1)) / points.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-8"
      preserveAspectRatio="none"
      role="img"
      aria-label="sparkline"
    >
      {points.map((p, i) => {
        const x = pad + i * (barW + barGap);
        const h = Math.max(1, Math.round((p.value / max) * (H - pad * 2)));
        const y = H - pad - h;
        return (
          <rect key={i} x={x} y={y} width={barW} height={h} className="fill-gold/70">
            <title>
              {p.label}: {p.value}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

/* ─────────────────────────── audit_timeline ─────────────────────────── */

function AuditTimeline({ data, locale }: { data: Json; locale: CliLocale }) {
  const events = asArr(data.events) as Json[];
  if (events.length === 0) {
    return (
      <div className="text-xs text-text-mute italic" data-testid="audit-empty">
        {locale === "ar" ? "لا أحداث" : "No events."}
      </div>
    );
  }
  return (
    <ol
      className="relative border-s border-border-soft ms-1.5 ps-3 space-y-2"
      data-testid="audit-timeline"
    >
      {events.slice(0, 20).map((e, i) => {
        const ts = asStr(e.ts);
        const action = asStr(e.action);
        const actor = asStr(e.actor);
        const actorType = asStr(e.actorType);
        const summary = asStr(e.summary);
        const auditId = asStr(e.id);
        const isAgent = actorType === "agent";
        return (
          <li key={auditId || i} className="relative" data-testid="audit-row">
            <span
              className={cn(
                "absolute -start-[17px] top-1.5 w-2 h-2 rounded-full border border-bg-deep",
                isAgent ? "bg-gold" : "bg-text-mute",
              )}
              aria-hidden
            />
            <div className="flex items-baseline gap-2 text-[11px]">
              <span className="font-mono text-text-faint shrink-0">
                {ts ? relativeTime(ts, locale) : ""}
              </span>
              <span className="font-mono text-gold truncate">{action}</span>
              {actor && (
                <span className="text-text-mute truncate">· {actor}</span>
              )}
            </div>
            {summary && (
              <div className="text-[12px] text-text leading-snug mt-0.5">
                {summary}
              </div>
            )}
            {auditId && (
              <a
                href={`/admin?audit=${encodeURIComponent(auditId)}`}
                className="text-[10px] font-mono text-text-faint hover:text-gold inline-flex items-center gap-0.5 mt-0.5"
                data-testid="audit-link"
              >
                <ExternalLink className="w-3 h-3" />
                {locale === "ar" ? "السجل" : "audit"}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────── gate_report (Task #411) ─────────────────────────── */

function GateReport({
  data,
  locale,
  onRunSlash,
}: {
  data: Json;
  locale: CliLocale;
  onRunSlash?: (cmd: string) => void;
}) {
  const ar = locale === "ar";
  const fromStage = asStr((data as Json).fromStage);
  const toStage = asStr((data as Json).toStage);
  const passed = (data as Json).passed === true;
  const blockers = asArr((data as Json).blockers).map(asStr).filter(Boolean);
  const evidence = asArr((data as Json).evidence) as Json[];
  const partnerOverrideAvailable = (data as Json).partnerOverrideAvailable === true;
  const opportunityId = asStr((data as Json).opportunityId) || asStr((data as Json).id);

  // Round-6 — RED/AMBER/GREEN triage. RED = blocked by hard
  // blockers; AMBER = passed but partner override required
  // (deliberate human gate); GREEN = passed cleanly. Drives both
  // the dot color and the status pill copy.
  const status: "red" | "amber" | "green" = passed
    ? partnerOverrideAvailable
      ? "amber"
      : "green"
    : "red";
  const statusCopy = ar
    ? { red: "محظور", amber: "بانتظار التجاوز", green: "ناجح" }
    : { red: "blocked", amber: "override required", green: "passed" };
  const dotClass = status === "green" ? "bg-success" : status === "amber" ? "bg-warning" : "bg-danger";
  const pillClass =
    status === "green"
      ? "bg-success/10 text-success"
      : status === "amber"
        ? "bg-warning/10 text-warning"
        : "bg-danger/10 text-danger";

  return (
    <div className="space-y-2" data-testid="cli-gate-report" data-status={status}>
      <div className="flex items-center gap-2">
        <span className={cn("inline-block h-2 w-2 rounded-full", dotClass)} aria-hidden />
        <div className="text-xs font-medium">
          {ar ? "تقرير البوابة" : "Gate report"}: {fromStage || "—"} → {toStage || "—"}
        </div>
        <span className={cn("text-[11px] px-1.5 py-0.5 rounded", pillClass)}>
          {statusCopy[status]}
        </span>
      </div>
      {blockers.length > 0 && (
        <ul className="text-[12px] list-disc ms-4 space-y-0.5 text-text">
          {blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {evidence.length > 0 && (
        <details className="text-[11px] text-text-mute">
          <summary className="cursor-pointer">{ar ? "الأدلة" : "Evidence"} ({evidence.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {evidence.slice(0, 8).map((e, i) => (
              <li key={i} className="font-mono">
                {asStr(e.label) || asStr(e.code)}: {asStr(e.value)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {partnerOverrideAvailable && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="cli-gate-report-override"
            onClick={() => {
              if (!onRunSlash) return;
              const arg = opportunityId ? ` ${opportunityId}` : "";
              const cmd = (ar ? "/تجاوز_شريك" : "/partner_override") + arg + (toStage ? ` ${toStage}` : "");
              onRunSlash(cmd);
            }}
            disabled={!onRunSlash}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded border",
              "border-warning/40 text-warning hover:bg-warning/10",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {ar ? "تجاوز الشريك" : "Partner override"}
          </button>
          <span className="text-[11px] text-text-mute">
            {ar
              ? "عمل بشري متعمد للشركاء فقط."
              : "Partner-only deliberate action."}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── entity_resolution (Task #411) ─────────────────────────── */

function EntityResolution({
  data,
  locale,
  onPickDisambig,
}: {
  data: Json;
  locale: CliLocale;
  onPickDisambig?: (id: string, label: string) => void;
}) {
  const ar = locale === "ar";
  // Three shapes possible:
  //  - { entity: { id, label, kind, secondary? } }
  //  - { options: [ { id, label, secondary? } ], prompt? }
  //  - { kind, query, none: true }
  const entity = (data as Json).entity as Json | undefined;
  const options = asArr((data as Json).options) as Json[];
  const promptText = asStr((data as Json).prompt);
  if (entity && entity.id) {
    return (
      <div className="text-xs" data-testid="cli-entity-resolution">
        <span className="text-text-mute">{ar ? "تم الحلّ:" : "Resolved:"} </span>
        <span className="font-medium">{String(asStr(entity.label) || asStr(entity.id))}</span>
        {entity.secondary != null && (
          <span className="text-text-mute"> · {String(asStr(entity.secondary))}</span>
        )}
        <span className="ms-2 font-mono text-text-mute">{String(asStr(entity.id))}</span>
      </div>
    );
  }
  if (options.length > 0) {
    return (
      <div className="space-y-1.5" data-testid="cli-entity-resolution-options">
        {promptText && <div className="text-xs text-text-mute">{promptText}</div>}
        <ul className="space-y-1">
          {options.map((o, i) => {
            const id = asStr(o.id);
            const label = asStr(o.label) || id;
            return (
              <li key={`${id}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPickDisambig?.(id, label)}
                  className="w-full text-start text-xs px-2 py-1.5 rounded border border-border-soft hover:bg-bg-deep hover:border-border-strong transition"
                  data-testid={`cli-entity-option-${i}`}
                >
                  <div className="font-medium">{String(label)}</div>
                  {o.secondary != null && (
                    <div className="text-[11px] text-text-mute">{String(asStr(o.secondary))}</div>
                  )}
                  <div className="text-[10px] font-mono text-text-mute mt-0.5">{String(id)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <div className="text-xs text-text-mute" data-testid="cli-entity-resolution-none">
      {ar ? "لم يتم العثور على تطابق." : "No match found."}
    </div>
  );
}

/* ─────────────────────────── fallback ─────────────────────────── */

function FallbackJson({ data }: { data: Json }) {
  return (
    <pre
      className="text-[11px] font-mono text-text-mute bg-bg-deep border border-border-soft rounded p-2 overflow-x-auto max-h-48"
      data-testid="cli-result-fallback-json"
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
