/**
 * Task #1202 — Scheduled entity-allocation AI sweep.
 *
 * The untagged GL feed (GET /gl/untagged) runs a rules-only inline propose
 * pass. Items that rules cannot decide (bank transactions on entity-less
 * accounts, travel expenses with missing trip context, etc.) land as
 * `needs_input` and wait until someone POSTs /gl/allocations/sweep with
 * { allowAi: true }. That manual trigger means AI-backed proposals are
 * missing when finance opens the tab.
 *
 * This module runs a daily scheduled sweep that re-runs the allocation
 * engine with AI over all untagged / needs_input records across every org,
 * so proposals are ready before anyone looks at the Needs Attention tab.
 *
 * Safety invariants (must never be violated):
 *   — Results land only as `proposed` or `needs_input`, never auto-approved.
 *   — `legalEntityId` is NOT written for invoice / contractor_payment /
 *     bank_transaction kinds — only `allocProposedEntityId` is set (the
 *     shared proposeGlRecordAllocation helper owns that invariant).
 *   — For expenses / partner_firm_invoices the engine sets `entityId` /
 *     `legalEntityId` as the PROPOSED value, but `allocStatus` remains
 *     `proposed` — the Bookkeeper will not post until a human calls
 *     /gl/allocations/:kind/:id/decide.
 *   — Each org sweep is claimed via the durable background-job registry
 *     (partial unique index on running jobs keyed by lockKey + orgId) so
 *     overlapping auto ticks or a manual POST /gl/allocations/sweep cannot
 *     double-propose.
 *
 * Concurrency model (mirrors bookkeeperAuto.ts):
 *   — One job row per org, kind `gl_entity_allocation_auto`,
 *     lockKey `gl_entity_allocation_sweep`.
 *   — Rate-limited: we skip an org if its most recent sweep finished
 *     less than AUTO_MIN_INTERVAL_MS ago.
 *   — Stale running rows (> STALE_MS) are reaped before a new attempt so
 *     a crashed process never blocks future runs indefinitely.
 */

import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  atelierLegalEntities,
  atelierBackgroundJobs,
  atelierExpenses,
  atelierPartnerFirmInvoices,
  atelierInvoice,
  atelierContractorPayments,
  atelierBankTransaction,
  atelierAuditEvents,
} from "@workspace/db";
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  reapStaleRunningJob,
  heartbeatBackgroundJob,
} from "../background-jobs.js";
import {
  proposeExpenseAllocation,
  proposeSupplierInvoiceAllocation,
  proposeGlRecordAllocation,
} from "../atelier-entity-allocation.js";
import { desc } from "drizzle-orm";

// ── Constants ────────────────────────────────────────────────────────

export const ENTITY_ALLOC_JOB_KIND = "gl_entity_allocation_auto" as const;
/** Used by the manual POST /gl/allocations/sweep route to claim the same lock. */
export const ENTITY_ALLOC_MANUAL_JOB_KIND = "gl_entity_allocation_manual" as const;
export const ENTITY_ALLOC_LOCK_KEY = "gl_entity_allocation_sweep";
/**
 * No-heartbeat window before a running sweep is considered dead.
 * The timer fires every HEARTBEAT_INTERVAL_MS (3 min) regardless of record
 * throughput, so 8 min gives 2.5× margin even if one interval is delayed.
 */
export const ENTITY_ALLOC_STALE_MS = 8 * 60 * 1000; // 8 min since last heartbeat
/**
 * Timer heartbeat cadence — must be well under ENTITY_ALLOC_STALE_MS so the
 * lease stays alive across slow individual AI calls (worst case ~60 s each).
 */
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000; // 3 min
/** Do not re-sweep an org automatically more often than once per 23 hours. */
const AUTO_MIN_INTERVAL_MS = 23 * 60 * 60 * 1000;
/** Sweep cadence — once per day. */
const AUTO_TICK_MS = 24 * 60 * 60 * 1000;
/** Initial delay after boot (let boot chores and bookkeeper settle first). */
const INITIAL_DELAY_MS = 3 * 60 * 1000; // 3 min

/** Keyset page size — small enough to keep memory bounded, large enough to
 *  amortise round-trip cost per page. All pages are processed on every run. */
const PAGE_SIZE = 100;

/** System actor id recorded on audit rows written by this sweep. */
export const ALLOC_SWEEP_ACTOR = "ag_entity_alloc_sweep";

// ── Helpers ──────────────────────────────────────────────────────────

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Latest sweep background job for an org — either auto or manual — so the
 * rate-limit check correctly accounts for a recently completed manual sweep
 * and a stale manual run does not strand the lock for the auto sweep.
 */
async function getLatestSweepJob(orgId: string) {
  const [row] = await db
    .select()
    .from(atelierBackgroundJobs)
    .where(and(
      eq(atelierBackgroundJobs.orgId, orgId),
      inArray(atelierBackgroundJobs.kind, [ENTITY_ALLOC_JOB_KIND, ENTITY_ALLOC_MANUAL_JOB_KIND]),
    ))
    .orderBy(desc(atelierBackgroundJobs.createdAt))
    .limit(1);
  return row ?? null;
}

// ── Per-org sweep ────────────────────────────────────────────────────

async function sweepOrg(orgId: string): Promise<"swept" | "skipped"> {
  // Rate-limit: skip if the latest sweep is still running or finished recently.
  const latest = await getLatestSweepJob(orgId);
  if (latest) {
    if (latest.status === "running") {
      // Use updatedAt for running jobs — heartbeating sweeps keep it fresh, so
      // we correctly skip while they are alive even past the original createdAt window.
      const freshMs = Date.now() - new Date(latest.updatedAt).getTime();
      if (freshMs < ENTITY_ALLOC_STALE_MS) return "skipped";
    } else {
      const ageMs = Date.now() - new Date(latest.createdAt).getTime();
      if (ageMs < AUTO_MIN_INTERVAL_MS) return "skipped";
    }
  }

  // Free any dead auto OR manual claim — both hold the same lock, and a
  // crashed manual run would strand the auto sweep indefinitely if omitted.
  // { useUpdatedAt: true } ensures heartbeating sweeps are never reaped while
  // actively making progress.
  await reapStaleRunningJob(
    [ENTITY_ALLOC_JOB_KIND, ENTITY_ALLOC_MANUAL_JOB_KIND],
    orgId, orgId, ENTITY_ALLOC_STALE_MS,
    { useUpdatedAt: true },
  );

  const jobId = await startBackgroundJob({
    orgId,
    userId: ALLOC_SWEEP_ACTOR,
    kind: ENTITY_ALLOC_JOB_KIND,
    lockKey: ENTITY_ALLOC_LOCK_KEY,
    targetType: "org",
    targetId: orgId,
    label: "Entity allocation AI sweep",
    resultHref: "/finance/ledger",
  });
  if (!jobId) return "skipped"; // lost the atomic-start race (manual sweep in progress)

  let proposed = 0;
  let needsInput = 0;
  let scanned = 0;

  // ── Keyset pagination helper ──────────────────────────────────────────
  // Fetches all eligible rows for a given kind in stable id-order, one
  // PAGE_SIZE batch at a time. Using `id > lastId ORDER BY id` means:
  //   • every row is visited exactly once per run regardless of total count
  //   • rows that become eligible mid-sweep (after the cursor) are included
  //   • rows that a previous page already proposed are naturally skipped
  //     by the engine (approved/overridden guard inside each propose fn)
  async function* pageIds(
    fetchPage: (afterId: string) => Promise<Array<{ id: string }>>,
  ): AsyncGenerator<string> {
    let afterId = "";
    for (;;) {
      const rows = await fetchPage(afterId);
      for (const r of rows) yield r.id;
      if (rows.length < PAGE_SIZE) break;
      afterId = rows[rows.length - 1].id;
    }
  }

  // ── Timer-based heartbeat ─────────────────────────────────────────────
  // Fires every HEARTBEAT_INTERVAL_MS (3 min) independently of record
  // throughput, so a single slow AI call (worst-case ~60 s) never causes
  // the lease to lapse. Cleared in `finally` so it always stops on exit.
  const heartbeatTimer = setInterval(() => {
    heartbeatBackgroundJob(jobId).catch(() => null);
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // ── Expenses ─────────────────────────────────────────────────────────
    for await (const id of pageIds((after) =>
      db.select({ id: atelierExpenses.id })
        .from(atelierExpenses)
        .where(and(
          eq(atelierExpenses.orgId, orgId),
          or(isNull(atelierExpenses.allocStatus), eq(atelierExpenses.allocStatus, "needs_input")),
          inArray(atelierExpenses.status, ["draft", "submitted", "approved", "reimbursed"]),
          isNull(atelierExpenses.deletedAt),
          gt(atelierExpenses.id, after),
        ))
        .orderBy(asc(atelierExpenses.id))
        .limit(PAGE_SIZE),
    )) {
      scanned++;
      const r = await proposeExpenseAllocation(id, { allowAi: true, actorId: ALLOC_SWEEP_ACTOR }).catch(() => null);
      if (r?.status === "proposed") proposed++;
      else if (r?.status === "needs_input") needsInput++;
    }

    // ── Supplier / partner-firm invoices ──────────────────────────────────
    for await (const id of pageIds((after) =>
      db.select({ id: atelierPartnerFirmInvoices.id })
        .from(atelierPartnerFirmInvoices)
        .where(and(
          eq(atelierPartnerFirmInvoices.orgId, orgId),
          or(isNull(atelierPartnerFirmInvoices.allocStatus), eq(atelierPartnerFirmInvoices.allocStatus, "needs_input")),
          isNull(atelierPartnerFirmInvoices.deletedAt),
          gt(atelierPartnerFirmInvoices.id, after),
        ))
        .orderBy(asc(atelierPartnerFirmInvoices.id))
        .limit(PAGE_SIZE),
    )) {
      scanned++;
      const r = await proposeSupplierInvoiceAllocation(id, { allowAi: true, actorId: ALLOC_SWEEP_ACTOR }).catch(() => null);
      if (r?.status === "proposed") proposed++;
      else if (r?.status === "needs_input") needsInput++;
    }

    // ── Client invoices ───────────────────────────────────────────────────
    for await (const id of pageIds((after) =>
      db.select({ id: atelierInvoice.id })
        .from(atelierInvoice)
        .where(and(
          eq(atelierInvoice.orgId, orgId),
          or(isNull(atelierInvoice.allocStatus), eq(atelierInvoice.allocStatus, "needs_input")),
          isNull(atelierInvoice.legalEntityId),
          inArray(atelierInvoice.status, ["issued", "paid"]),
          isNull(atelierInvoice.deletedAt),
          gt(atelierInvoice.id, after),
        ))
        .orderBy(asc(atelierInvoice.id))
        .limit(PAGE_SIZE),
    )) {
      scanned++;
      const r = await proposeGlRecordAllocation("invoice", id, { allowAi: true, actorId: ALLOC_SWEEP_ACTOR }).catch(() => null);
      if (r?.status === "proposed") proposed++;
      else if (r?.status === "needs_input") needsInput++;
    }

    // ── Contractor payments ───────────────────────────────────────────────
    for await (const id of pageIds((after) =>
      db.select({ id: atelierContractorPayments.id })
        .from(atelierContractorPayments)
        .where(and(
          eq(atelierContractorPayments.orgId, orgId),
          or(isNull(atelierContractorPayments.allocStatus), eq(atelierContractorPayments.allocStatus, "needs_input")),
          isNull(atelierContractorPayments.legalEntityId),
          eq(atelierContractorPayments.status, "paid"),
          isNull(atelierContractorPayments.deletedAt),
          gt(atelierContractorPayments.id, after),
        ))
        .orderBy(asc(atelierContractorPayments.id))
        .limit(PAGE_SIZE),
    )) {
      scanned++;
      const r = await proposeGlRecordAllocation("contractor_payment", id, { allowAi: true, actorId: ALLOC_SWEEP_ACTOR }).catch(() => null);
      if (r?.status === "proposed") proposed++;
      else if (r?.status === "needs_input") needsInput++;
    }

    // ── Bank transactions ─────────────────────────────────────────────────
    for await (const id of pageIds((after) =>
      db.select({ id: atelierBankTransaction.id })
        .from(atelierBankTransaction)
        .where(and(
          eq(atelierBankTransaction.orgId, orgId),
          or(isNull(atelierBankTransaction.allocStatus), eq(atelierBankTransaction.allocStatus, "needs_input")),
          isNull(atelierBankTransaction.legalEntityId),
          isNull(atelierBankTransaction.deletedAt),
          gt(atelierBankTransaction.id, after),
        ))
        .orderBy(asc(atelierBankTransaction.id))
        .limit(PAGE_SIZE),
    )) {
      scanned++;
      const r = await proposeGlRecordAllocation("bank_transaction", id, { allowAi: true, actorId: ALLOC_SWEEP_ACTOR }).catch(() => null);
      if (r?.status === "proposed") proposed++;
      else if (r?.status === "needs_input") needsInput++;
    }

    // Write a single audit row for the sweep so the audit log is queryable.
    // orgId is set EXPLICITLY — background connections have no request-scoped
    // RLS context and the column's DB default falls back to 'aico', which would
    // mis-attribute sweeps for other organisations to the wrong tenant.
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId,
      entityType: "gl",
      entityId: "entity_allocation_auto_sweep",
      actorType: "agent",
      actorId: ALLOC_SWEEP_ACTOR,
      actorLabel: "Entity Allocation Sweep (auto)",
      action: "allocation.propose",
      payload: { scanned, proposed, needsInput, allowAi: true },
      payloadSummary: `Auto AI sweep: ${proposed} proposed, ${needsInput} need input (of ${scanned} scanned).`,
    }).catch(() => null); // audit failures must never abort the sweep

    await completeBackgroundJob(jobId, { result: { scanned, proposed, needsInput } });
    return "swept";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failBackgroundJob(jobId, msg).catch(() => null);
    console.warn(`[gl.entity_alloc] auto sweep failed for org ${orgId}:`, msg);
    return "skipped";
  } finally {
    // Always stop the heartbeat timer so it doesn't fire after job completion.
    clearInterval(heartbeatTimer);
  }
}

// ── Tick: sweep every org with active legal entities ─────────────────

export async function runEntityAllocationAutoTick(): Promise<{ orgs: number; swept: number }> {
  const orgRows = await db
    .selectDistinct({ orgId: atelierLegalEntities.orgId })
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.status, "active"));
  let swept = 0;
  for (const { orgId } of orgRows) {
    try {
      if ((await sweepOrg(orgId)) === "swept") swept++;
    } catch (err) {
      console.warn(`[gl.entity_alloc] tick error for org ${orgId}:`, err);
    }
  }
  return { orgs: orgRows.length, swept };
}

// ── Lifecycle ────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let kickoff: NodeJS.Timeout | null = null;

export function startEntityAllocationAutoJob(): void {
  if (timer) return;
  if (process.env.NODE_ENV === "test") return; // no background DB/AI calls in tests
  kickoff = setTimeout(() => {
    void runEntityAllocationAutoTick().catch((err) => {
      console.warn("[gl.entity_alloc] initial auto sweep failed:", err);
    });
  }, INITIAL_DELAY_MS);
  if (typeof kickoff.unref === "function") kickoff.unref();
  timer = setInterval(() => {
    void runEntityAllocationAutoTick().catch((err) => {
      console.warn("[gl.entity_alloc] auto sweep failed:", err);
    });
  }, AUTO_TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopEntityAllocationAutoJob(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (kickoff) { clearTimeout(kickoff); kickoff = null; }
}
