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
import { and, desc, eq, inArray } from "drizzle-orm";
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
  };

  if (args.wait) {
    try {
      await exec();
    } catch (err) {
      await failBackgroundJob(jobId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  } else {
    void exec().catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await failBackgroundJob(jobId, msg);
      console.warn("[billing-orchestrator] background run failed:", msg);
    });
  }
  return { started: true, jobId };
}
