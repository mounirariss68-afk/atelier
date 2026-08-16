/**
 * Atelier — Finance GL: Bookkeeper agent (Task #428).
 *
 * Rule-based like the Revenue Recognizer: deterministic, idempotent,
 * auditable. Converts operational events (invoices, revrec posting
 * lines, expenses, contractor payments, partner-firm invoices, bank
 * transactions) into balanced append-only journal entries per legal
 * entity and period. Anything it cannot post safely becomes an
 * exception row — it never invents accounts or posts ambiguous items.
 *
 * Posting rules are documented in prompts/atelier/bookkeeper.v1.md.
 */

import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierGlPostingException,
  atelierInvoice,
  atelierExpenses,
  atelierExpenseGlMappings,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierSelfBilledInvoices,
  atelierBankTransaction,
  atelierBankAccount,
  atelierRevenuePeriodPosting,
  atelierRevenuePeriodPostingLine,
  atelierPeriodCloseLock,
  atelierAuditEvents,
} from "@workspace/db";
import { runAgent } from "./runAgent.js";
import { writeAllocationAudit } from "../atelier-entity-allocation.js";
import { invoiceAccountResolves } from "../invoiceAccountGuard.js";
import { evaluateAutoPost, FINANCE_AUTOPILOT_DEFAULTS } from "../atelier-finance-autopolicy.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// -------
// Default professional-services chart of accounts
// -------
export interface ChartAccountDef {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  normalSide: "debit" | "credit";
  isSystem: boolean;
}

export const DEFAULT_CHART: ChartAccountDef[] = [
  { code: "1000", name: "Cash & bank", type: "asset", normalSide: "debit", isSystem: true },
  { code: "1100", name: "Accounts receivable", type: "asset", normalSide: "debit", isSystem: true },
  { code: "1200", name: "Unbilled WIP", type: "asset", normalSide: "debit", isSystem: false },
  { code: "1300", name: "Prepaid expenses", type: "asset", normalSide: "debit", isSystem: false },
  // Task #1135 — salary advances are an asset drawn down by payroll
  // deductions/settlement offsets, never an expense.
  { code: "1150", name: "Salary advances receivable", type: "asset", normalSide: "debit", isSystem: true },
  { code: "1400", name: "VAT receivable", type: "asset", normalSide: "debit", isSystem: true },
  // Task #1092 — pre-formation cost pools: quarantine clearing account
  // (asset — stays out of opex/P&L by construction) plus the settlement
  // receivable/write-off accounts used by the settle flow.
  { code: "1500", name: "Pre-incorporation costs — recoverable", type: "asset", normalSide: "debit", isSystem: true },
  // 1550 (NOT 1150 — that is salary advances) carries the settlement
  // recharge; charts seeded before it existed are backfilled at settle time.
  { code: "1550", name: "Intercompany receivable — pre-formation recharge", type: "asset", normalSide: "debit", isSystem: true },
  { code: "1160", name: "Related-party receivable — founders", type: "asset", normalSide: "debit", isSystem: true },
  { code: "2000", name: "Accounts payable", type: "liability", normalSide: "credit", isSystem: false },
  { code: "2100", name: "Accrued liabilities & reimbursements", type: "liability", normalSide: "credit", isSystem: true },
  { code: "2200", name: "Deferred revenue", type: "liability", normalSide: "credit", isSystem: true },
  { code: "2300", name: "VAT payable", type: "liability", normalSide: "credit", isSystem: true },
  { code: "2400", name: "Corporate tax payable", type: "liability", normalSide: "credit", isSystem: false },
  // Task #655 — statutory payroll accounts (payroll run + EOSB postings).
  { code: "2150", name: "Employee withholdings payable", type: "liability", normalSide: "credit", isSystem: true },
  { code: "2160", name: "Social security contributions payable", type: "liability", normalSide: "credit", isSystem: true },
  { code: "2500", name: "End-of-service benefits provision", type: "liability", normalSide: "credit", isSystem: true },
  { code: "3000", name: "Owners' equity", type: "equity", normalSide: "credit", isSystem: false },
  { code: "3100", name: "Retained earnings", type: "equity", normalSide: "credit", isSystem: false },
  { code: "4000", name: "Consulting fees revenue", type: "revenue", normalSide: "credit", isSystem: true },
  { code: "4100", name: "Expenses recharged to clients", type: "revenue", normalSide: "credit", isSystem: false },
  { code: "4900", name: "Other income", type: "revenue", normalSide: "credit", isSystem: false },
  { code: "5000", name: "Subcontractor & partner-firm costs", type: "expense", normalSide: "debit", isSystem: true },
  { code: "5100", name: "Direct engagement expenses", type: "expense", normalSide: "debit", isSystem: true },
  { code: "6000", name: "Salaries & benefits", type: "expense", normalSide: "debit", isSystem: false },
  // Task #655 — names keep "Payroll"/"benefits" so GL statements classify
  // them into the payroll P&L bucket (financeGlStatements.classifyFlow).
  { code: "6010", name: "Payroll — employer social contributions", type: "expense", normalSide: "debit", isSystem: true },
  { code: "6020", name: "Payroll — end-of-service benefits expense", type: "expense", normalSide: "debit", isSystem: true },
  { code: "6100", name: "Travel & entertainment", type: "expense", normalSide: "debit", isSystem: true },
  { code: "6200", name: "Software & subscriptions", type: "expense", normalSide: "debit", isSystem: false },
  { code: "6300", name: "Office & facilities", type: "expense", normalSide: "debit", isSystem: false },
  { code: "6400", name: "Professional fees", type: "expense", normalSide: "debit", isSystem: false },
  { code: "6500", name: "Marketing & business development", type: "expense", normalSide: "debit", isSystem: false },
  { code: "6600", name: "Bank charges & FX", type: "expense", normalSide: "debit", isSystem: true },
  { code: "6900", name: "Other operating expenses", type: "expense", normalSide: "debit", isSystem: true },
  // Task #1092 — write-off bucket for abandoned pre-formation pools.
  { code: "6920", name: "Abandoned market-entry costs", type: "expense", normalSide: "debit", isSystem: true },
  // Task #654 — corporate-tax provision (Dr 6950 / Cr 2400). Kept outside
  // the 6xxx operating range semantics: pre-tax profit computations must
  // exclude this code.
  { code: "6950", name: "Corporate tax expense", type: "expense", normalSide: "debit", isSystem: false },
];

/** Legacy flat expense-category → fallback account code. */
const CATEGORY_FALLBACK: Record<string, string> = {
  flight: "6100", flights: "6100", hotel: "6100", hotels: "6100",
  taxi: "6100", transport: "6100", meal: "6100", meals: "6100",
  per_diem: "6100", mileage: "6100", travel: "6100", entertainment: "6100",
  software: "6200", saas: "6200", subscriptions: "6200",
  office: "6300", supplies: "6300",
  legal: "6400", professional: "6400", accounting: "6400",
  marketing: "6500", gift: "6500", bd: "6500",
  bank: "6600", fees: "6600",
  other: "6900",
};

/**
 * Idempotently seed the default chart for a legal entity. Existing
 * codes are left untouched (finance may have renamed them).
 */
export async function seedChartForEntity(args: {
  orgId: string;
  legalEntityId: string;
  createdByUserId?: string | null;
}): Promise<{ created: number; existing: number }> {
  const existing = await db
    .select({ code: atelierGlAccount.code })
    .from(atelierGlAccount)
    .where(and(
      eq(atelierGlAccount.orgId, args.orgId),
      eq(atelierGlAccount.legalEntityId, args.legalEntityId),
    ));
  const have = new Set(existing.map((r) => r.code));
  let created = 0;
  for (const a of DEFAULT_CHART) {
    if (have.has(a.code)) continue;
    await db.insert(atelierGlAccount).values({
      id: rid("glacct"),
      orgId: args.orgId,
      legalEntityId: args.legalEntityId,
      code: a.code,
      name: a.name,
      type: a.type,
      normalSide: a.normalSide,
      isSystem: a.isSystem,
      createdByUserId: args.createdByUserId ?? null,
    }).onConflictDoNothing();
    created++;
  }
  return { created, existing: have.size };
}

/**
 * Task #1081 — auto-seed the default chart wherever it's missing.
 * Seeds idempotently and, when anything was actually created, writes the
 * same `gl.chart_seed` audit entry the old manual button produced so
 * finance can see when/why a chart appeared.
 */
export async function ensureChartSeeded(args: {
  orgId: string;
  legalEntityId: string;
  entityLabel: string;
  actor:
    | { kind: "human"; userId: string; label: string }
    | { kind: "agent"; runId: string; label: string };
  reason: string;
}): Promise<{ created: number; existing: number }> {
  const out = await seedChartForEntity({
    orgId: args.orgId,
    legalEntityId: args.legalEntityId,
    createdByUserId: args.actor.kind === "human" ? args.actor.userId : null,
  });
  if (out.created > 0) {
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "gl_account",
      entityId: args.legalEntityId,
      actorType: args.actor.kind,
      actorId: args.actor.kind === "human" ? args.actor.userId : args.actor.runId,
      actorLabel: args.actor.label,
      action: "gl.chart_seed",
      payload: { entityId: args.legalEntityId, reason: args.reason, ...out },
      payloadSummary: `Auto-seeded default chart for ${args.entityLabel} (${out.created} created) — ${args.reason}`,
    });
  }
  return out;
}

/** True when the period's close lock covers the GL module. */
export async function isGlPeriodLocked(orgId: string, periodLabel: string): Promise<boolean> {
  const [lock] = await db
    .select()
    .from(atelierPeriodCloseLock)
    .where(and(
      eq(atelierPeriodCloseLock.orgId, orgId),
      eq(atelierPeriodCloseLock.periodLabel, periodLabel),
      isNull(atelierPeriodCloseLock.deletedAt),
    ))
    .limit(1);
  return !!lock && (lock.lockedModules ?? []).includes("gl");
}

// -------
// Bookkeeper run
// -------
export interface BookkeeperInput {
  periodLabel: string; // YYYY-MM
  entityId?: string; // restrict to one entity
}

interface ExceptionRecord {
  code: string;
  sourceKind: string;
  sourceRef: string;
  message: string;
  legalEntityId?: string | null;
  sourceLabel?: string | null;
  details?: Record<string, unknown>;
}

export interface BookkeeperOutput {
  periodLabel: string;
  entitiesConsidered: number;
  sourcesScanned: number;
  entriesCreated: number;
  entriesSkippedExisting: number;
  tagsBackfilled: number;
  exceptionsOpen: number;
  exceptions: Array<{ code: string; sourceKind: string; sourceRef: string; message: string }>;
  rationaleSummary: string;
}

function periodBounds(periodLabel: string): { from: string; to: string } {
  const y = Number(periodLabel.slice(0, 4));
  const m = Number(periodLabel.slice(5, 7));
  const from = `${periodLabel}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const to = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { from, to };
}
function tsInPeriod(ts: Date | null, from: string, to: string): boolean {
  if (!ts) return false;
  const d = ts.toISOString().slice(0, 10);
  return d >= from && d < to;
}

export async function runBookkeeper(args: {
  orgId: string;
  input: BookkeeperInput;
  triggeredByUserId: string | null;
  actorLabel?: string;
}): Promise<{ runId: string; output: BookkeeperOutput }> {
  const { orgId } = args;
  const { periodLabel, entityId } = args.input;
  const res = await runAgent<BookkeeperInput, BookkeeperOutput>(
    {
      agentId: "ag_bookkeeper",
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: "gl_period",
      targetId: `${orgId}:${periodLabel}`,
      targetLabel: `GL posting run ${periodLabel}`,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const output = await executeBookkeeper(orgId, periodLabel, entityId, ctx.runId, ctx.progress);
      return { output, confidence: output.exceptionsOpen === 0 ? "green" : "amber" };
    },
  );
  return { runId: res.runId, output: res.output };
}

async function executeBookkeeper(
  orgId: string,
  periodLabel: string,
  onlyEntityId: string | undefined,
  agentRunId: string,
  progress: (pct: number, msg: string) => Promise<void>,
): Promise<BookkeeperOutput> {
  if (await isGlPeriodLocked(orgId, periodLabel)) {
    throw new Error(`period-locked: ${periodLabel} close lock covers the GL module`);
  }
  const { from, to } = periodBounds(periodLabel);

  const entities = (await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, orgId), eq(atelierLegalEntities.status, "active"))))
    .filter((e) => !onlyEntityId || e.id === onlyEntityId);
  const entityIds = new Set(entities.map((e) => e.id));
  const defaultEntityId = entities.length === 1 ? entities[0].id : null;

  // Task #1092 — pre-formation entities: costs tagged to them are
  // quarantined in the home (UAE) entity's ledger on the 1500 clearing
  // account, with the journal line stamped for per-pool attribution.
  const preFormationEntities = await db
    .select({
      id: atelierLegalEntities.id,
      shortName: atelierLegalEntities.shortName,
      legalNameEn: atelierLegalEntities.legalNameEn,
    })
    .from(atelierLegalEntities)
    .where(and(
      eq(atelierLegalEntities.orgId, orgId),
      // Quarantine is keyed on the UNSETTLED pool, not just current
      // status: an entity activated before its tagged costs were
      // bookkept keeps pre-formation treatment until finance settles
      // the pool — otherwise pending costs would leak into opex and
      // settlement could stamp a zero clearing balance.
      // jsonb: the key may be present with JSON null — treat both
      // SQL NULL and 'null'::jsonb as "no settlement stamped yet".
      // A settled pool is NEVER eligible (even while still
      // in_formation) — new costs must not land in a clearing bucket
      // whose settlement path is already closed.
      sql`coalesce(${atelierLegalEntities.formation} -> 'settlement', 'null'::jsonb) = 'null'::jsonb`,
      or(
        eq(atelierLegalEntities.status, "in_formation"),
        isNotNull(atelierLegalEntities.formation),
      ),
    ));
  const preFormationById = new Map(
    preFormationEntities.map((e) => [e.id, e.shortName || e.legalNameEn]),
  );
  // Settled-but-not-yet-active pools: tagging is closed. New costs
  // surface as exceptions instead of quarantining (stranded balance)
  // or leaking into opex.
  const settledPools = await db
    .select({
      id: atelierLegalEntities.id,
      shortName: atelierLegalEntities.shortName,
      legalNameEn: atelierLegalEntities.legalNameEn,
    })
    .from(atelierLegalEntities)
    .where(and(
      eq(atelierLegalEntities.orgId, orgId),
      eq(atelierLegalEntities.status, "in_formation"),
      sql`coalesce(${atelierLegalEntities.formation} -> 'settlement', 'null'::jsonb) <> 'null'::jsonb`,
    ));
  const settledPoolById = new Map(
    settledPools.map((e) => [e.id, e.shortName || e.legalNameEn]),
  );
  const allActive = await db
    .select({ id: atelierLegalEntities.id, country: atelierLegalEntities.country })
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, orgId), eq(atelierLegalEntities.status, "active")));
  const homeEntityId = allActive.length === 1
    ? allActive[0].id
    : (allActive.filter((e) => e.country?.toUpperCase() === "AE").length === 1
        ? allActive.find((e) => e.country?.toUpperCase() === "AE")!.id
        : null);


  // Task #1081 — auto-seed the default chart for any active in-scope
  // entity that has none, before resolving postings. Idempotent; the
  // audit entry is attributed to this run.
  if (entities.length > 0) {
    const chartCounts = await db
      .select({
        legalEntityId: atelierGlAccount.legalEntityId,
        n: sql<number>`count(*)`,
      })
      .from(atelierGlAccount)
      .where(and(
        eq(atelierGlAccount.orgId, orgId),
        inArray(atelierGlAccount.legalEntityId, [...entityIds]),
        isNull(atelierGlAccount.deletedAt),
      ))
      .groupBy(atelierGlAccount.legalEntityId);
    const haveChart = new Set(chartCounts.filter((r) => Number(r.n) > 0).map((r) => r.legalEntityId));
    for (const e of entities) {
      if (haveChart.has(e.id)) continue;
      await ensureChartSeeded({
        orgId,
        legalEntityId: e.id,
        entityLabel: e.shortName || e.legalNameEn,
        actor: { kind: "agent", runId: agentRunId, label: "Bookkeeper" },
        reason: `Bookkeeper run ${periodLabel} found no chart of accounts for this entity`,
      });
    }
  }

  // Chart lookup per entity.
  const accounts = entityIds.size > 0
    ? await db.select().from(atelierGlAccount).where(and(
        eq(atelierGlAccount.orgId, orgId),
        inArray(atelierGlAccount.legalEntityId, [...entityIds]),
        eq(atelierGlAccount.active, true),
      ))
    : [];
  const acctByEntityCode = new Map<string, typeof accounts[number]>();
  for (const a of accounts) acctByEntityCode.set(`${a.legalEntityId}:${a.code}`, a);

  // Expense GL mappings per entity.
  const glMaps = entityIds.size > 0
    ? await db.select().from(atelierExpenseGlMappings).where(and(
        eq(atelierExpenseGlMappings.orgId, orgId),
        inArray(atelierExpenseGlMappings.entityId, [...entityIds]),
        isNull(atelierExpenseGlMappings.deletedAt),
      ))
    : [];
  const glMapByKey = new Map<string, typeof glMaps[number]>();
  for (const m of glMaps) glMapByKey.set(`${m.entityId}:${m.subCategoryCode}`, m);

  const exceptions: ExceptionRecord[] = [];
  let sourcesScanned = 0;
  let entriesCreated = 0;
  let entriesSkippedExisting = 0;
  let tagsBackfilled = 0;
  const postedSourceKeys: Array<{ sourceKind: string; sourceRef: string }> = [];

  // Existing entries for idempotency (period-agnostic: source unique).
  const existingEntries = await db
    .select({ sourceKind: atelierGlJournalEntry.sourceKind, sourceRef: atelierGlJournalEntry.sourceRef })
    .from(atelierGlJournalEntry)
    .where(eq(atelierGlJournalEntry.orgId, orgId));
  const existingKeys = new Set(existingEntries.map((e) => `${e.sourceKind}:${e.sourceRef}`));

  interface LineSpec {
    code: string;
    engagementId?: string | null;
    /** Task #1092 — stamps the line as belonging to a pre-formation pool. */
    preFormationEntityId?: string | null;
    debit?: number;
    credit?: number;
    memo?: string;
  }

  async function postEntry(spec: {
    legalEntityId: string;
    sourceKind: string;
    sourceRef: string;
    sourceLabel: string;
    entryDate: string;
    memo: string;
    currency: string;
    lines: LineSpec[];
  }): Promise<boolean> {
    const key = `${spec.sourceKind}:${spec.sourceRef}`;
    if (existingKeys.has(key)) {
      entriesSkippedExisting++;
      return false;
    }
    if (!entityIds.has(spec.legalEntityId)) {
      exceptions.push({
        code: "untagged_entity", sourceKind: spec.sourceKind, sourceRef: spec.sourceRef,
        message: `Tagged legal entity ${spec.legalEntityId} is not an active entity in the registry.`,
        sourceLabel: spec.sourceLabel,
      });
      return false;
    }
    // Resolve accounts, flipping negative amounts to the opposite side.
    const resolved: Array<{ acct: typeof accounts[number]; engagementId: string | null; preFormationEntityId: string | null; debit: number; credit: number; memo: string | null }> = [];
    for (const l of spec.lines) {
      let debit = round2(l.debit ?? 0);
      let credit = round2(l.credit ?? 0);
      if (debit < 0) { credit = round2(credit - debit); debit = 0; }
      else if (credit < 0) { debit = round2(debit - credit); credit = 0; }
      if (debit === 0 && credit === 0) continue;
      const acct = acctByEntityCode.get(`${spec.legalEntityId}:${l.code}`);
      if (!acct) {
        exceptions.push({
          code: "missing_account", sourceKind: spec.sourceKind, sourceRef: spec.sourceRef,
          message: `Account ${l.code} not found in the chart for this entity. Seed or add it, then re-run.`,
          legalEntityId: spec.legalEntityId, sourceLabel: spec.sourceLabel,
          details: { accountCode: l.code },
        });
        return false;
      }
      resolved.push({ acct, engagementId: l.engagementId ?? null, preFormationEntityId: l.preFormationEntityId ?? null, debit, credit, memo: l.memo ?? null });
    }
    if (resolved.length === 0) return false;
    const totalDebit = round2(resolved.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(resolved.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.011) {
      exceptions.push({
        code: "unbalanced", sourceKind: spec.sourceKind, sourceRef: spec.sourceRef,
        message: `Computed entry does not balance (Dr ${totalDebit} vs Cr ${totalCredit}); nothing was written.`,
        legalEntityId: spec.legalEntityId, sourceLabel: spec.sourceLabel,
        details: { totalDebit, totalCredit },
      });
      return false;
    }
    const entryId = rid("gljrn");
    // Task #1091 — the auto-post engine is the SOLE authorization for
    // posting without a human. Deterministic Bookkeeper journals are the
    // always-auto matrix row; routing through the engine keeps that
    // authorization in one place and yields the recorded reason.
    const autoDecision = evaluateAutoPost({ kind: "bookkeeper_journal", thresholds: FINANCE_AUTOPILOT_DEFAULTS });
    if (!autoDecision.auto) {
      // Unreachable by matrix, but never post unauthorized: surface as an
      // exception instead of silently writing.
      exceptions.push({
        code: "auto_post_denied", sourceKind: spec.sourceKind, sourceRef: spec.sourceRef,
        message: `Auto-post engine withheld authorization: ${autoDecision.reasons.join("; ")}`,
        legalEntityId: spec.legalEntityId, sourceLabel: spec.sourceLabel,
        details: { reasons: autoDecision.reasons },
      });
      return false;
    }
    await db.transaction(async (tx) => {
      await tx.insert(atelierGlJournalEntry).values({
        id: entryId, orgId, legalEntityId: spec.legalEntityId,
        periodLabel, entryDate: spec.entryDate, kind: "posting",
        sourceKind: spec.sourceKind, sourceRef: spec.sourceRef,
        memo: spec.memo, currency: spec.currency,
        // Task #1091 — agent provenance: snapshot the agent name so the
        // journal list "postedByAgent" filter is queryable without joining
        // a possibly-reaped run row.
        totalDebit, totalCredit, agentRunId, agentName: "Bookkeeper",
      });
      for (const l of resolved) {
        await tx.insert(atelierGlJournalLine).values({
          id: rid("gljl"), orgId, journalEntryId: entryId,
          accountId: l.acct.id, accountCode: l.acct.code, accountName: l.acct.name,
          engagementId: l.engagementId, preFormationEntityId: l.preFormationEntityId,
          debit: l.debit, credit: l.credit, memo: l.memo,
        });
      }
    });
    existingKeys.add(key);
    entriesCreated++;
    postedSourceKeys.push({ sourceKind: spec.sourceKind, sourceRef: spec.sourceRef });
    return true;
  }

  /** Resolve entity for a record; backfills via `applyTag` when defaulted. */
  async function resolveEntity(
    tagged: string | null | undefined,
    applyTag: (entityId: string) => Promise<void>,
  ): Promise<string | null> {
    if (tagged) return tagged;
    if (defaultEntityId) {
      await applyTag(defaultEntityId);
      tagsBackfilled++;
      return defaultEntityId;
    }
    return null;
  }

  // ── 1. Invoices issued in period ─────────────────────────
  await progress(10, "Posting issued invoices");
  const invoices = (await db.select().from(atelierInvoice).where(and(
    eq(atelierInvoice.orgId, orgId),
    inArray(atelierInvoice.status, ["issued", "paid"]),
    isNull(atelierInvoice.deletedAt),
    // Task #1079 — skip invoices whose parent account no longer exists
    // (orphaned test rows must never reach the Bookkeeper source scan).
    invoiceAccountResolves(),
  ))).filter((i) => !i.voidedAt && tsInPeriod(i.issuedAt, from, to));
  for (const inv of invoices) {
    sourcesScanned++;
    const ent = await resolveEntity(inv.legalEntityId, async (eid) => {
      await db.update(atelierInvoice).set({ legalEntityId: eid, updatedAt: new Date() })
        .where(eq(atelierInvoice.id, inv.id));
    });
    if (!ent) {
      exceptions.push({
        code: "untagged_entity", sourceKind: "invoice", sourceRef: inv.id,
        message: `Invoice ${inv.invoiceNumber ?? inv.id} has no legal entity tag and no single-entity default applies.`,
        sourceLabel: inv.invoiceNumber ?? inv.id,
      });
      continue;
    }
    await postEntry({
      legalEntityId: ent, sourceKind: "invoice", sourceRef: inv.id,
      sourceLabel: inv.invoiceNumber ?? inv.id,
      entryDate: inv.issuedAt!.toISOString().slice(0, 10),
      memo: `Invoice ${inv.invoiceNumber ?? inv.id} issued`,
      currency: inv.currency,
      lines: [
        { code: "1100", debit: inv.total, engagementId: inv.engagementId, memo: "Invoice total" },
        { code: "2200", credit: inv.subtotal, engagementId: inv.engagementId, memo: "Deferred until recognised" },
        ...(inv.vatAmount > 0.001 ? [{ code: "2300", credit: inv.vatAmount, memo: "Output VAT" }] : []),
      ],
    });
  }

  // ── 2. Revenue recognition posting lines ─────────────────
  await progress(30, "Posting recognised revenue");
  const [revPosting] = await db.select().from(atelierRevenuePeriodPosting).where(and(
    eq(atelierRevenuePeriodPosting.orgId, orgId),
    eq(atelierRevenuePeriodPosting.periodLabel, periodLabel),
    isNull(atelierRevenuePeriodPosting.deletedAt),
  )).limit(1);
  if (revPosting?.postedAt) {
    const revLines = await db.select().from(atelierRevenuePeriodPostingLine).where(and(
      eq(atelierRevenuePeriodPostingLine.orgId, orgId),
      eq(atelierRevenuePeriodPostingLine.postingId, revPosting.id),
      isNull(atelierRevenuePeriodPostingLine.deletedAt),
    ));
    for (const line of revLines) {
      sourcesScanned++;
      if (Math.abs(line.recognisedAmount) < 0.005) continue;
      if (!defaultEntityId) {
        exceptions.push({
          code: "untagged_entity", sourceKind: "revrec_line", sourceRef: line.id,
          message: "Revenue recognition line cannot be attributed to a legal entity (no single-entity default). Tag the engagement's invoicing entity and re-run.",
          sourceLabel: `Revrec ${periodLabel} · ${line.engagementId}`,
        });
        continue;
      }
      await postEntry({
        legalEntityId: defaultEntityId, sourceKind: "revrec_line", sourceRef: line.id,
        sourceLabel: `Revrec ${periodLabel} · ${line.engagementId}`,
        entryDate: `${periodLabel}-28`,
        memo: `Revenue recognised (${line.method}${line.kind === "adjustment" ? ", adjustment" : ""})`,
        currency: line.currency,
        lines: [
          { code: "2200", debit: line.recognisedAmount, engagementId: line.engagementId, memo: "Release deferred revenue" },
          { code: "4000", credit: line.recognisedAmount, engagementId: line.engagementId, memo: "Consulting fees" },
        ],
      });
    }
  }

  // ── 3. Expenses approved in period ───────────────────────
  await progress(50, "Posting approved expenses");
  const expenses = (await db.select().from(atelierExpenses).where(and(
    eq(atelierExpenses.orgId, orgId),
    inArray(atelierExpenses.status, ["approved", "reimbursed"]),
    isNull(atelierExpenses.deletedAt),
  ))).filter((x) => tsInPeriod(x.approvedAt, from, to) || (!x.approvedAt && x.expenseDate >= from && x.expenseDate < to));
  for (const x of expenses) {
    sourcesScanned++;
    // Task #1092 — pre-formation quarantine: an expense tagged to an
    // in-formation entity posts to the HOME entity's ledger on the
    // 1500 clearing account (never opex), stamped for the pool. This
    // runs BEFORE the allocation lifecycle — the explicit pre-formation
    // tag is the decided allocation.
    if (x.entityId && settledPoolById.has(x.entityId)) {
      const pfLbl = `${x.merchant ?? x.category} · ${x.expenseDate}`;
      exceptions.push({
        code: "preformation_pool_settled", sourceKind: "expense", sourceRef: x.id,
        message: `Expense (${pfLbl}) is tagged to "${settledPoolById.get(x.entityId)}", whose pre-formation pool is already settled — retag it before it can post.`,
        sourceLabel: pfLbl,
      });
      continue;
    }
    if (x.entityId && preFormationById.has(x.entityId)) {
      const pfLbl = `${x.merchant ?? x.category} · ${x.expenseDate}`;
      const poolName = preFormationById.get(x.entityId)!;
      if (!homeEntityId || !entityIds.has(homeEntityId)) {
        exceptions.push({
          code: "untagged_entity", sourceKind: "expense", sourceRef: x.id,
          message: `Expense (${pfLbl}) is tagged to pre-formation entity "${poolName}" but no home (UAE) ledger entity is resolvable in this run.`,
          sourceLabel: pfLbl,
        });
        continue;
      }
      const grossPf = round2(x.usdAmount);
      if (grossPf <= 0) continue;
      await postEntry({
        legalEntityId: homeEntityId, sourceKind: "expense", sourceRef: x.id,
        sourceLabel: pfLbl,
        entryDate: (x.approvedAt ?? new Date()).toISOString().slice(0, 10),
        memo: `Pre-formation (${poolName}) expense ${pfLbl}`,
        currency: "USD",
        lines: [
          { code: "1500", debit: grossPf, preFormationEntityId: x.entityId, memo: `Pre-incorporation \u2014 ${poolName}` },
          { code: "2100", credit: grossPf, memo: "Owed to submitter / card" },
        ],
      });
      continue;
    }
    // Task #1095 — post only human-decided allocations. `proposed` /
    // `needs_input` rows surface as an allocation_pending exception (a
    // "needs allocation" queue) instead of silently posting a prefill.
    if (x.allocStatus === "proposed" || x.allocStatus === "needs_input" ||
        (x.allocStatus == null && !x.entityId)) {
      const lbl = `${x.merchant ?? x.category} · ${x.expenseDate}`;
      exceptions.push({
        code: "allocation_pending", sourceKind: "expense", sourceRef: x.id,
        message:
          x.allocStatus === "proposed"
            ? `Expense (${lbl}) has a proposed entity allocation awaiting finance approval${x.allocJustification ? ` — ${x.allocJustification}` : ""}.`
            : x.allocStatus === "needs_input"
              ? `Expense (${lbl}) needs a manual entity allocation — the allocation engine could not decide.`
              : `Expense (${lbl}) has no entity allocation — run the allocation sweep or decide it manually.`,
        sourceLabel: lbl,
        details: { allocStatus: x.allocStatus, allocRuleId: x.allocRuleId, allocJustification: x.allocJustification },
      });
      continue;
    }
    if (x.allocStatus == null && x.entityId) {
      // Legacy row tagged before the allocation lifecycle existed: honor the
      // explicit tag as an approved allocation, audited once, then post.
      await db.update(atelierExpenses).set({
        allocStatus: "approved", allocRuleId: "legacy_tag", allocDecidedBy: "human",
        allocJustification: "Legacy entity tag predates the allocation lifecycle; honored as approved.",
        allocConfidence: 1, updatedAt: new Date(),
      }).where(and(eq(atelierExpenses.id, x.id), isNull(atelierExpenses.allocStatus)));
      await writeAllocationAudit({
        entityType: "expense", entityId: x.id, orgId: x.orgId, actorId: null, actorLabel: "Bookkeeper",
        action: "allocation.approve",
        changes: [{ field: "allocStatus", from: null, to: "approved" }],
        ruleId: "legacy_tag", justification: "Legacy entity tag honored as approved.",
        confidence: 1, decidedBy: "human",
        summary: `Legacy entity tag on expense ${x.id} honored as an approved allocation.`,
      });
    }
    const ent = await resolveEntity(x.entityId, async (eid) => {
      await db.update(atelierExpenses).set({ entityId: eid, updatedAt: new Date() })
        .where(eq(atelierExpenses.id, x.id));
    });
    const label = `${x.merchant ?? x.category} · ${x.expenseDate}`;
    if (!ent) {
      exceptions.push({
        code: "untagged_entity", sourceKind: "expense", sourceRef: x.id,
        message: `Expense (${label}) has no legal entity tag and no single-entity default applies.`,
        sourceLabel: label,
      });
      continue;
    }
    // Account: per-entity GL mapping on sub-category, else category fallback.
    let expenseCode: string | null = null;
    let mappingVat: string | null = null;
    if (x.subCategoryCode) {
      const m = glMapByKey.get(`${ent}:${x.subCategoryCode}`);
      if (m) { expenseCode = m.glCode; mappingVat = m.vatTreatment; }
    }
    if (!expenseCode) {
      if (x.engagementId && x.clientBillable) expenseCode = "5100";
      else expenseCode = CATEGORY_FALLBACK[(x.category ?? "other").toLowerCase()] ?? null;
    }
    if (!expenseCode) {
      exceptions.push({
        code: "unmapped_category", sourceKind: "expense", sourceRef: x.id,
        message: `No GL mapping for sub-category "${x.subCategoryCode ?? "—"}" / category "${x.category}" on this entity. Add a mapping in the expense taxonomy and re-run.`,
        legalEntityId: ent, sourceLabel: label,
        details: { category: x.category, subCategoryCode: x.subCategoryCode },
      });
      continue;
    }
    const gross = round2(x.usdAmount);
    if (gross <= 0) continue;
    const recoverable =
      mappingVat === "recoverable" ||
      (mappingVat == null && (x.vatTreatment === "uae_5" || x.vatTreatment === "ksa_15"));
    const vatUsd = recoverable && x.vatAmount > 0
      ? round2(x.fxRate && x.fxRate !== 0 ? x.vatAmount / x.fxRate : x.vatAmount)
      : 0;
    const net = round2(gross - vatUsd);
    await postEntry({
      legalEntityId: ent, sourceKind: "expense", sourceRef: x.id,
      sourceLabel: label,
      entryDate: (x.approvedAt ?? new Date()).toISOString().slice(0, 10),
      memo: `Expense ${label}`,
      currency: "USD",
      lines: [
        { code: expenseCode, debit: net, engagementId: x.engagementId, memo: x.description ?? x.category },
        ...(vatUsd > 0 ? [{ code: "1400", debit: vatUsd, memo: "Recoverable VAT" }] : []),
        { code: "2100", credit: gross, memo: "Owed to submitter / card" },
      ],
    });
  }

  // ── 4. Contractor payments + partner-firm invoices paid ──
  await progress(70, "Posting paid contractor & partner-firm costs");
  // Task #430 — proposals covered by a paid self-billed invoice are
  // posted via the invoice (source self_billed_invoice), not here, to
  // avoid double posting the same subcontractor cost.
  const sbisAll = await db.select().from(atelierSelfBilledInvoices).where(and(
    eq(atelierSelfBilledInvoices.orgId, orgId),
    isNull(atelierSelfBilledInvoices.deletedAt),
  ));
  const coveredProposalIds = new Set<string>();
  for (const inv of sbisAll) {
    for (const pid of inv.contractorPaymentIds ?? []) coveredProposalIds.add(pid);
    for (const pid of inv.partnerFirmInvoiceIds ?? []) coveredProposalIds.add(pid);
  }
  const paidSbis = sbisAll.filter((inv) => inv.status === "paid" && tsInPeriod(inv.paidAt, from, to));
  for (const inv of paidSbis) {
    sourcesScanned++;
    const ent = await resolveEntity(inv.legalEntityId, async (eid) => {
      await db.update(atelierSelfBilledInvoices).set({ legalEntityId: eid, updatedAt: new Date() })
        .where(eq(atelierSelfBilledInvoices.id, inv.id));
    });
    const label = `${inv.invoiceNumber} · ${inv.supplierName} · ${inv.weekIso}`;
    if (!ent) {
      exceptions.push({
        code: "untagged_entity", sourceKind: "self_billed_invoice", sourceRef: inv.id,
        message: `Self-billed invoice (${label}) has no legal entity tag and no single-entity default applies.`,
        sourceLabel: label,
      });
      continue;
    }
    if (inv.totalUsd <= 0) continue;
    const vatUsd = round2(inv.vatAmount * (inv.fxRate || 1));
    const netUsd = round2(inv.totalUsd - vatUsd);
    const firstEng = (inv.lines ?? [])[0]?.engagementId ?? null;
    await postEntry({
      legalEntityId: ent, sourceKind: "self_billed_invoice", sourceRef: inv.id,
      sourceLabel: label,
      entryDate: inv.paidAt!.toISOString().slice(0, 10),
      memo: `Self-billed invoice ${label}`,
      currency: "USD",
      lines: [
        { code: "5000", debit: netUsd, engagementId: firstEng, memo: label },
        ...(vatUsd > 0 ? [{ code: "1400", debit: vatUsd, memo: "Recoverable VAT (RCTI)" }] : []),
        { code: "1000", credit: inv.totalUsd, memo: "Cash out" },
      ],
    });
  }
  const cps = (await db.select().from(atelierContractorPayments).where(and(
    eq(atelierContractorPayments.orgId, orgId),
    eq(atelierContractorPayments.status, "paid"),
    isNull(atelierContractorPayments.deletedAt),
  ))).filter((p) => tsInPeriod(p.paidAt, from, to) && !coveredProposalIds.has(p.id));
  for (const p of cps) {
    sourcesScanned++;
    const ent = await resolveEntity(p.legalEntityId, async (eid) => {
      await db.update(atelierContractorPayments).set({ legalEntityId: eid, updatedAt: new Date() })
        .where(eq(atelierContractorPayments.id, p.id));
    });
    const label = `${p.payeeName} · ${p.weekIso}`;
    if (!ent) {
      exceptions.push({
        code: "untagged_entity", sourceKind: "contractor_payment", sourceRef: p.id,
        message: `Contractor payment (${label}) has no legal entity tag and no single-entity default applies.`,
        sourceLabel: label,
      });
      continue;
    }
    if (p.usdAmount <= 0) continue;
    await postEntry({
      legalEntityId: ent, sourceKind: "contractor_payment", sourceRef: p.id,
      sourceLabel: label,
      entryDate: p.paidAt!.toISOString().slice(0, 10),
      memo: `Contractor payment ${label}`,
      currency: "USD",
      lines: [
        { code: "5000", debit: p.usdAmount, engagementId: p.engagementId, memo: label },
        { code: "1000", credit: p.usdAmount, memo: "Cash out" },
      ],
    });
  }
  const pfis = (await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    eq(atelierPartnerFirmInvoices.status, "paid"),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  ))).filter((p) => tsInPeriod(p.paidAt, from, to) && !coveredProposalIds.has(p.id));
  for (const p of pfis) {
    sourcesScanned++;
    // Task #1092 — pre-formation quarantine for supplier invoices,
    // BEFORE the allocation lifecycle (explicit tag = decided).
    if (p.legalEntityId && settledPoolById.has(p.legalEntityId)) {
      const pfLbl = `${p.partnerFirmName} · ${p.weekIso}`;
      exceptions.push({
        code: "preformation_pool_settled", sourceKind: "partner_firm_invoice", sourceRef: p.id,
        message: `Supplier invoice (${pfLbl}) is tagged to "${settledPoolById.get(p.legalEntityId)}", whose pre-formation pool is already settled — retag it before it can post.`,
        sourceLabel: pfLbl,
      });
      continue;
    }
    if (p.legalEntityId && preFormationById.has(p.legalEntityId)) {
      const pfLbl = `${p.partnerFirmName} · ${p.weekIso}`;
      const poolName = preFormationById.get(p.legalEntityId)!;
      if (!homeEntityId || !entityIds.has(homeEntityId)) {
        exceptions.push({
          code: "untagged_entity", sourceKind: "partner_firm_invoice", sourceRef: p.id,
          message: `Supplier invoice (${pfLbl}) is tagged to pre-formation entity "${poolName}" but no home (UAE) ledger entity is resolvable in this run.`,
          sourceLabel: pfLbl,
        });
        continue;
      }
      if (p.usdAmount <= 0) continue;
      await postEntry({
        legalEntityId: homeEntityId, sourceKind: "partner_firm_invoice", sourceRef: p.id,
        sourceLabel: pfLbl,
        entryDate: p.paidAt!.toISOString().slice(0, 10),
        memo: `Pre-formation (${poolName}) supplier invoice ${pfLbl}`,
        currency: "USD",
        lines: [
          { code: "1500", debit: p.usdAmount, preFormationEntityId: p.legalEntityId, memo: `Pre-incorporation \u2014 ${poolName}` },
          { code: "1000", credit: p.usdAmount, memo: "Cash out" },
        ],
      });
      continue;
    }
    // Task #1095 — see the expense loop: prefis with an undecided
    // allocation queue up instead of posting.
    if (p.allocStatus === "proposed" || p.allocStatus === "needs_input" ||
        (p.allocStatus == null && !p.legalEntityId)) {
      const lbl = `${p.partnerFirmName} · ${p.weekIso}`;
      exceptions.push({
        code: "allocation_pending", sourceKind: "partner_firm_invoice", sourceRef: p.id,
        message:
          p.allocStatus === "proposed"
            ? `Partner-firm invoice (${lbl}) has a proposed entity allocation awaiting finance approval${p.allocJustification ? ` — ${p.allocJustification}` : ""}.`
            : p.allocStatus === "needs_input"
              ? `Partner-firm invoice (${lbl}) needs a manual entity allocation.`
              : `Partner-firm invoice (${lbl}) has no entity allocation — run the allocation sweep or decide it manually.`,
        sourceLabel: lbl,
        details: { allocStatus: p.allocStatus, allocRuleId: p.allocRuleId, allocJustification: p.allocJustification },
      });
      continue;
    }
    if (p.allocStatus == null && p.legalEntityId) {
      // Legacy tagged invoice: honor the explicit tag as approved, audited.
      await db.update(atelierPartnerFirmInvoices).set({
        allocStatus: "approved", allocRuleId: "legacy_tag", allocDecidedBy: "human",
        allocJustification: "Legacy entity tag predates the allocation lifecycle; honored as approved.",
        allocConfidence: 1, updatedAt: new Date(),
      }).where(and(eq(atelierPartnerFirmInvoices.id, p.id), isNull(atelierPartnerFirmInvoices.allocStatus)));
      await writeAllocationAudit({
        entityType: "partner_firm_invoice", entityId: p.id, orgId: p.orgId, actorId: null, actorLabel: "Bookkeeper",
        action: "allocation.approve",
        changes: [{ field: "allocStatus", from: null, to: "approved" }],
        ruleId: "legacy_tag", justification: "Legacy entity tag honored as approved.",
        confidence: 1, decidedBy: "human",
        summary: `Legacy entity tag on partner-firm invoice ${p.id} honored as an approved allocation.`,
      });
    }
    const ent = await resolveEntity(p.legalEntityId, async (eid) => {
      await db.update(atelierPartnerFirmInvoices).set({ legalEntityId: eid, updatedAt: new Date() })
        .where(eq(atelierPartnerFirmInvoices.id, p.id));
    });
    const label = `${p.partnerFirmName} · ${p.weekIso}`;
    if (!ent) {
      exceptions.push({
        code: "untagged_entity", sourceKind: "partner_firm_invoice", sourceRef: p.id,
        message: `Partner-firm invoice (${label}) has no legal entity tag and no single-entity default applies.`,
        sourceLabel: label,
      });
      continue;
    }
    if (p.usdAmount <= 0) continue;
    await postEntry({
      legalEntityId: ent, sourceKind: "partner_firm_invoice", sourceRef: p.id,
      sourceLabel: label,
      entryDate: p.paidAt!.toISOString().slice(0, 10),
      memo: `Partner-firm invoice ${label}`,
      currency: "USD",
      lines: [
        { code: "5000", debit: p.usdAmount, engagementId: p.engagementId, memo: label },
        { code: "1000", credit: p.usdAmount, memo: "Cash out" },
      ],
    });
  }

  // ── 5. Bank transactions ─────────────────────────────────
  await progress(85, "Posting bank transactions");
  const bankAccounts = await db.select().from(atelierBankAccount)
    .where(and(eq(atelierBankAccount.orgId, orgId), isNull(atelierBankAccount.deletedAt)));
  const bankEntityById = new Map(bankAccounts.map((b) => [b.id, b.legalEntityId]));
  const txns = await db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.orgId, orgId),
    gte(atelierBankTransaction.postedDate, from),
    lt(atelierBankTransaction.postedDate, to),
    isNull(atelierBankTransaction.deletedAt),
  ));
  for (const t of txns) {
    sourcesScanned++;
    const bankEntity = bankEntityById.get(t.bankAccountId) ?? null;
    const ent = await resolveEntity(t.legalEntityId ?? bankEntity, async () => {}) ??
      null;
    if (t.legalEntityId == null && ent) {
      await db.update(atelierBankTransaction)
        .set({ legalEntityId: ent, updatedAt: new Date() })
        .where(eq(atelierBankTransaction.id, t.id));
      tagsBackfilled++;
    }
    const label = `${t.counterpartyNameRaw ?? "Bank txn"} · ${t.postedDate}`;
    if (!ent) {
      exceptions.push({
        code: "untagged_entity", sourceKind: "bank_transaction", sourceRef: t.id,
        message: `Bank transaction (${label}) has no legal entity: tag the bank account or the transaction.`,
        sourceLabel: label,
      });
      continue;
    }
    const amt = round2(Math.abs(t.amount));
    if (amt < 0.005) continue;
    if (t.kind === "receipt" && t.amount > 0) {
      await postEntry({
        legalEntityId: ent, sourceKind: "bank_transaction", sourceRef: t.id,
        sourceLabel: label, entryDate: t.postedDate,
        memo: `Bank receipt ${label}`, currency: t.currency,
        lines: [
          { code: "1000", debit: amt, memo: "Cash in" },
          { code: "1100", credit: amt, memo: "Clears receivable" },
        ],
      });
    } else if (t.kind === "fee") {
      await postEntry({
        legalEntityId: ent, sourceKind: "bank_transaction", sourceRef: t.id,
        sourceLabel: label, entryDate: t.postedDate,
        memo: `Bank fee ${label}`, currency: t.currency,
        lines: [
          { code: "6600", debit: amt, memo: "Bank charge" },
          { code: "1000", credit: amt, memo: "Cash out" },
        ],
      });
    } else if (!existingKeys.has(`bank_transaction:${t.id}`)) {
      exceptions.push({
        code: "ambiguous", sourceKind: "bank_transaction", sourceRef: t.id,
        message: `Bank transaction kind "${t.kind}" is ambiguous (could duplicate a payment already posted); review and post manually if needed.`,
        legalEntityId: ent, sourceLabel: label,
        details: { kind: t.kind, amount: t.amount, currency: t.currency },
      });
    }
  }

  // ── 6. Persist exceptions (upsert per source+code) ───────
  await progress(95, "Recording exceptions");
  for (const ex of exceptions) {
    await db.insert(atelierGlPostingException).values({
      id: rid("glex"), orgId,
      legalEntityId: ex.legalEntityId ?? null,
      periodLabel,
      sourceKind: ex.sourceKind, sourceRef: ex.sourceRef,
      sourceLabel: ex.sourceLabel ?? null,
      code: ex.code, message: ex.message,
      details: ex.details ?? {}, status: "open", agentRunId,
    }).onConflictDoUpdate({
      target: [
        atelierGlPostingException.orgId,
        atelierGlPostingException.sourceKind,
        atelierGlPostingException.sourceRef,
        atelierGlPostingException.code,
      ],
      set: {
        message: sql`excluded.message`,
        periodLabel,
        status: "open",
        agentRunId,
        resolvedAt: null,
        resolvedByUserId: null,
        updatedAt: new Date(),
      },
    });
  }
  // Auto-resolve open exceptions for sources that now posted cleanly.
  for (const k of postedSourceKeys) {
    await db.update(atelierGlPostingException).set({
      status: "resolved", resolvedAt: new Date(),
      resolutionNote: "Auto-resolved: source posted successfully on a later run.",
      updatedAt: new Date(),
    }).where(and(
      eq(atelierGlPostingException.orgId, orgId),
      eq(atelierGlPostingException.sourceKind, k.sourceKind),
      eq(atelierGlPostingException.sourceRef, k.sourceRef),
      eq(atelierGlPostingException.status, "open"),
    ));
  }

  const openCount = exceptions.length;
  return {
    periodLabel,
    entitiesConsidered: entities.length,
    sourcesScanned,
    entriesCreated,
    entriesSkippedExisting,
    tagsBackfilled,
    exceptionsOpen: openCount,
    exceptions: exceptions.slice(0, 50).map((e) => ({
      code: e.code, sourceKind: e.sourceKind, sourceRef: e.sourceRef, message: e.message,
    })),
    rationaleSummary:
      `Scanned ${sourcesScanned} source records across ${entities.length} entities for ${periodLabel}: ` +
      `${entriesCreated} journal entries created, ${entriesSkippedExisting} already posted (skipped), ` +
      `${tagsBackfilled} entity tags backfilled, ${openCount} exceptions surfaced for finance review.`,
  };
}

