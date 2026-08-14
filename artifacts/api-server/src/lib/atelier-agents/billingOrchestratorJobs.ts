/**
 * Task #1099 — Billing Orchestrator runs on the durable background-job
 * registry, mirroring the GL Bookkeeper pattern (bookkeeperAuto.ts):
 *
 *   - Every entry point (daily cron, milestone-event fire-and-forget,
 *     manual "Run now") claims the SAME durable lock before running, so
 *     overlapping runs are impossible: shared lockKey
 *     "billing_orchestrator" + singleton targetId per org, guarded by the
 *     partial unique index on running jobs (atomic claim).
 *   - Dead claims are reaped (BILLING_ORCH_STALE_MS) before every attempt,
 *     so a crashed run can't wedge the cadence forever.
 *   - Cron runs are rate-limited (skip when a run finished very recently),
 *     like the Bookkeeper auto sweep.
 *
 * The orchestrator itself stays idempotent (idempotency keys make double
 * billing impossible) — this registry is the concurrency/visibility layer,
 * not the correctness layer.
 */
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db, atelierBackgroundJobs } from "@workspace/db";
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  reapStaleRunningJob,
} from "../background-jobs.js";
import {
  runBillingOrchestrator,
  type BillingOrchestratorInput,
} from "./billing-orchestrator.js";

export const BILLING_ORCH_JOB_KINDS = [
  "billing_orchestrator_auto",
  "billing_orchestrator_manual",
  "billing_orchestrator_event",
] as const;
export type BillingOrchJobKind = (typeof BILLING_ORCH_JOB_KINDS)[number];

/** Shared concurrency key — all three entry points are mutually exclusive. */
export const BILLING_ORCH_LOCK_KEY = "billing_orchestrator";
/** Singleton target: at most one orchestrator run per org at a time. */
export const BILLING_ORCH_TARGET = "_singleton_";
/** A run "running" longer than this is presumed dead and reaped. */
export const BILLING_ORCH_STALE_MS = 15 * 60 * 1000;
/** System actor recorded as the starter of cron/event runs. */
export const BILLING_ORCH_SYSTEM_ACTOR = "ag_billing_orchestrator";
/** Cron runs skip when a run finished more recently than this. */
const AUTO_MIN_INTERVAL_MS = 5 * 60 * 1000;

const MODE_OF_KIND: Record<BillingOrchJobKind, "auto" | "manual" | "event"> = {
  billing_orchestrator_auto: "auto",
  billing_orchestrator_manual: "manual",
  billing_orchestrator_event: "event",
};

/** Latest orchestrator job row for an org — the status endpoint's SoT. */
export async function getLatestBillingOrchestratorJob(orgId: string) {
  const [row] = await db
    .select()
    .from(atelierBackgroundJobs)
    .where(and(
      eq(atelierBackgroundJobs.orgId, orgId),
      inArray(atelierBackgroundJobs.kind, [...BILLING_ORCH_JOB_KINDS]),
      eq(atelierBackgroundJobs.targetId, BILLING_ORCH_TARGET),
    ))
    .orderBy(desc(atelierBackgroundJobs.createdAt))
    .limit(1);
  return row ?? null;
}

export function billingOrchJobMode(kind: string): "auto" | "manual" | "event" {
  return MODE_OF_KIND[kind as BillingOrchJobKind] ?? "manual";
}

export interface LaunchBillingOrchestratorArgs {
  orgId: string;
  kind: BillingOrchJobKind;
  /** Job starter (a real user for manual runs; the system actor otherwise). */
  userId: string;
  label: string;
  input: BillingOrchestratorInput;
  triggeredByUserId: string | null;
  actorLabel?: string;
  /**
   * true (cron/event): await the run, rethrow failures to the caller.
   * false (manual route): claim the lock, kick the run off in the
   * background and return immediately — the page polls the status route.
   */
  wait: boolean;
}

export type LaunchBillingOrchestratorResult =
  | { started: true; jobId: string }
  | { started: false; reason: "already_running" | "ran_recently" };

/**
 * Claim the shared orchestrator lock and run. Returns
 * `{ started:false }` WITHOUT running when another run holds the lock
 * (manual → 409; cron/event → skip-log).
 */
export async function launchBillingOrchestratorRun(
  args: LaunchBillingOrchestratorArgs,
): Promise<LaunchBillingOrchestratorResult> {
  // Rate-limit cron sweeps only — a manual click or milestone event should
  // always be able to run right after a scheduled pass.
  if (args.kind === "billing_orchestrator_auto") {
    const latest = await getLatestBillingOrchestratorJob(args.orgId);
    if (
      latest &&
      latest.status !== "running" &&
      Date.now() - new Date(latest.createdAt).getTime() < AUTO_MIN_INTERVAL_MS
    ) {
      return { started: false, reason: "ran_recently" };
    }
  }

  // Free a dead claim first, or the running-unique index blocks forever.
  await reapStaleRunningJob(
    [...BILLING_ORCH_JOB_KINDS],
    BILLING_ORCH_TARGET,
    args.orgId,
    BILLING_ORCH_STALE_MS,
  );

  const jobId = await startBackgroundJob({
    orgId: args.orgId,
    userId: args.userId,
    kind: args.kind,
    lockKey: BILLING_ORCH_LOCK_KEY,
    targetType: "billing_orchestrator",
    targetId: BILLING_ORCH_TARGET,
    label: args.label,
    resultHref: "/finance/billing/worklist",
  });
  if (!jobId) return { started: false, reason: "already_running" };

  const exec = async (): Promise<void> => {
    const out = await runBillingOrchestrator({
      orgId: args.orgId,
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      actorLabel: args.actorLabel,
    });
    await completeBackgroundJob(jobId, {
      result: {
        runId: out.runId,
        rulesScanned: out.output.rulesScanned,
        triggersCreated: out.output.triggersCreated,
        invoicesDrafted: out.output.invoicesDrafted,
        triggersSkipped: out.output.triggersSkipped,
        rationaleSummary: out.output.rationaleSummary,
      },
    });
    // Task #1118 — while this run held the lock, milestone-event launches
    // were skipped and durably armed the per-org pending flag. Consume it
    // now so those milestones still draft today.
    await consumePendingBillingEvent(args.orgId).catch((err) => {
      console.warn("[billing-orchestrator] post-run pending-event consume failed:", err);
    });
  };

  // Even a FAILED run must consume: it held the lock, so milestone-event
  // launches during it were skipped either way (never throws).
  const consumeAfterFailure = () =>
    consumePendingBillingEvent(args.orgId).catch((err) => {
      console.warn("[billing-orchestrator] post-failure pending-event consume failed:", err);
    });

  if (args.wait) {
    try {
      await exec();
    } catch (err) {
      await failBackgroundJob(jobId, err instanceof Error ? err.message : String(err));
      await consumeAfterFailure();
      throw err;
    }
  } else {
    void exec().catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await failBackgroundJob(jobId, msg);
      console.warn("[billing-orchestrator] background run failed:", msg);
      await consumeAfterFailure();
    });
  }
  return { started: true, jobId };
}

// ===========================================================================
// Task #1118 — a milestone-event launch skipped because another run holds
// the lock must still be drafted the same day, not wait for tomorrow's
// cron sweep. The pending signal is DURABLE and race-free:
//
//   - A skipped event launch "arms" a per-org pending flag: one
//     deterministic-id row (upsert ⇒ atomic cross-instance coalescing),
//     status "pending", `updatedAt` = arm time.
//   - The flag is consumed by launching an UNSCOPED event run through the
//     same lock, then acknowledged (status → "done") with a compare-and-set
//     on the arm time. If a new event re-armed the flag after we read it,
//     the ack no-ops and the flag stays pending — it is retained until a
//     run that STARTED after the arm has acknowledged it.
//   - Consume points: immediately after arming (closes the gap where the
//     blocking run finished before the flag was armed), on every run's
//     completion AND failure (the run held the lock, so events during it
//     were skipped either way), and in the boot chores (a restart may have
//     killed the run whose completion would have consumed it).
//   - If the consume launch loses the lock to a competing run, nothing is
//     acked; that competing run's completion consume retries. Single-flight
//     is untouched — every launch goes through the same durable lock, and
//     the chained run is unscoped, so it covers milestones from ALL
//     engagements armed while blocked.
//
// The orchestrator is idempotent, so an extra chained run is harmless; the
// daily cron remains the final backstop. The pending row never uses status
// "running", so the running-unique index, the boot sweep, and the user-
// facing job indicator all ignore it.
// ===========================================================================

/** Kind for the per-org pending flag row (not part of BILLING_ORCH_JOB_KINDS). */
export const BILLING_ORCH_EVENT_PENDING_KIND = "billing_orchestrator_event_pending";
/** Deterministic id ⇒ at most one flag row per org, upserted atomically. */
export function billingEventPendingId(orgId: string): string {
  return `bgjob_billing_evpending_${orgId}`;
}

export type LaunchBillingOrchestratorEventResult =
  | LaunchBillingOrchestratorResult
  | { started: false; reason: "deferred_pending" };

/**
 * Milestone-event entry point: try to launch immediately; if another run
 * holds the lock, durably arm the pending flag and try one consume (in
 * case the blocker finished in between). Fire-and-forget either way.
 */
export async function launchBillingOrchestratorEventRun(
  args: Omit<LaunchBillingOrchestratorArgs, "kind" | "wait">,
): Promise<LaunchBillingOrchestratorEventResult> {
  const first = await launchBillingOrchestratorRun({
    ...args,
    kind: "billing_orchestrator_event",
    wait: false,
  });
  if (first.started || first.reason !== "already_running") return first;
  await armPendingBillingEvent(args.orgId);
  // The blocking run may have completed between our failed claim and the
  // arm — its completion consume would then have seen no flag. Consume once
  // now; if a run is (still) in flight, its completion consume takes over.
  await consumePendingBillingEvent(args.orgId).catch((err) => {
    console.warn("[billing-orchestrator] post-arm pending-event consume failed:", err);
  });
  console.log(
    `[billing-orchestrator] milestone-event launch deferred — pending flag armed for org ${args.orgId}`,
  );
  return { started: false, reason: "deferred_pending" };
}

/** Durably arm (or re-arm) the per-org pending flag. */
export async function armPendingBillingEvent(orgId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(atelierBackgroundJobs)
    .values({
      id: billingEventPendingId(orgId),
      orgId,
      startedByUserId: BILLING_ORCH_SYSTEM_ACTOR,
      kind: BILLING_ORCH_EVENT_PENDING_KIND,
      lockKey: BILLING_ORCH_EVENT_PENDING_KIND,
      targetType: "billing_orchestrator",
      targetId: BILLING_ORCH_TARGET,
      label: "Pending milestone-event billing run",
      status: "pending",
    })
    .onConflictDoUpdate({
      target: atelierBackgroundJobs.id,
      set: { status: "pending", updatedAt: now, error: null, finishedAt: null },
    });
}

/**
 * Acknowledge the pending flag armed at/before `armedAt`. Compare-and-set:
 * returns false (flag stays pending) when it was re-armed after `armedAt`.
 */
export async function ackPendingBillingEvent(orgId: string, armedAt: Date): Promise<boolean> {
  const now = new Date();
  const acked = await db
    .update(atelierBackgroundJobs)
    .set({ status: "done", finishedAt: now })
    .where(and(
      eq(atelierBackgroundJobs.id, billingEventPendingId(orgId)),
      eq(atelierBackgroundJobs.status, "pending"),
      lte(atelierBackgroundJobs.updatedAt, armedAt),
    ))
    .returning({ id: atelierBackgroundJobs.id });
  return acked.length > 0;
}

/**
 * If the pending flag is armed, launch an unscoped event run through the
 * shared lock and (only when the launch actually started) ack the flag via
 * CAS on the arm time. Returns true when a chained run started.
 */
export async function consumePendingBillingEvent(orgId: string): Promise<boolean> {
  const [flag] = await db
    .select()
    .from(atelierBackgroundJobs)
    .where(eq(atelierBackgroundJobs.id, billingEventPendingId(orgId)));
  if (!flag || flag.status !== "pending") return false;
  const armedAt = new Date(flag.updatedAt);
  const chained = await launchBillingOrchestratorRun({
    orgId,
    kind: "billing_orchestrator_event",
    userId: BILLING_ORCH_SYSTEM_ACTOR,
    label: "Billing run — deferred milestone event",
    input: { source: "milestone_event" },
    triggeredByUserId: null,
    wait: false,
  });
  if (!chained.started) {
    // Lock held by a competing run — leave the flag pending; that run's
    // completion consume retries. Nothing is lost.
    return false;
  }
  // Ack only what we witnessed: a re-arm after our read keeps the flag
  // pending so the chained run's own completion consume covers it.
  const acked = await ackPendingBillingEvent(orgId, armedAt);
  console.log(
    `[billing-orchestrator] pending milestone-event consumed — chained run ${chained.jobId}` +
      (acked ? "" : " (flag re-armed meanwhile; retained)"),
  );
  return true;
}

/**
 * Boot recovery (Task #1118): a restart can kill an in-flight run whose
 * completion consume would have cleared the pending flag. Consume any
 * still-armed flags now. Runs AFTER the background-job boot sweep (which
 * frees orphaned run locks; it ignores this flag — never "running").
 */
export async function recoverMissedBillingMilestoneEvents(): Promise<number> {
  const flags = await db
    .select({ orgId: atelierBackgroundJobs.orgId })
    .from(atelierBackgroundJobs)
    .where(and(
      eq(atelierBackgroundJobs.kind, BILLING_ORCH_EVENT_PENDING_KIND),
      eq(atelierBackgroundJobs.status, "pending"),
    ));
  let launched = 0;
  for (const { orgId } of flags) {
    if (!orgId) continue;
    if (await consumePendingBillingEvent(orgId)) launched++;
  }
  return launched;
}
