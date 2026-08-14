/**
 * Task #1091 / #1105 — shared single-flight guard for the finance-autopilot
 * agents (Self-Billing Clerk, Collections Agent, Revenue Recognizer).
 *
 * WHY: the cron schedulers already wrapped their runs in the durable
 * background-jobs registry, but the MANUAL routes (POST
 * /finance/payables/self-billing/run, POST /collections/run, POST
 * /revrec/schedules/compute) called the runners directly — so a manual
 * trigger could race a scheduled run and double-materialise drafts /
 * schedules. Worse, the scheduler keyed the lock on a per-DATE targetId, so
 * two runs on different days (or a manual run on a different asOf) never
 * blocked each other.
 *
 * FIX: BOTH the cron job and the manual route go through
 * `runAgentExclusive`, which acquires the SAME durable lock using:
 *   - a STABLE, per-agent lockKey  (e.g. "agent:self-billing-clerk"), and
 *   - a STABLE, per-agent singleton targetId ("_singleton_"),
 * so the partial-unique running index (org, lockKey, targetId) admits AT
 * MOST ONE running instance of a given agent per org, regardless of date or
 * request shape. The loser of the race does NOT run: the manual route
 * surfaces a 409 ("already running"); the cron tick logs and skips.
 *
 * Stale-run reaping still applies (a dead lock from a crashed run can't
 * wedge the cadence): each acquire first reaps a running row older than
 * `staleMs` for the same lockKey+target.
 */
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  reapStaleRunningJob,
} from "../background-jobs.js";

/** Per-agent identity for the single-flight guard. */
export type AutopilotAgentKey =
  | "self_billing_clerk"
  | "collections_agent"
  | "revenue_recognizer";

/** Stable per-agent lock key — NOT date-derived (that was the bug). */
export function agentLockKey(agent: AutopilotAgentKey): string {
  return `agent:${agent}`;
}

/** Stable per-agent singleton target — one running row per agent per org. */
export const AGENT_SINGLETON_TARGET = "_singleton_";

/** A run in progress older than this is presumed dead and reaped. */
export const AGENT_STALE_MS = 30 * 60_000;

export interface RunAgentExclusiveArgs<T> {
  agent: AutopilotAgentKey;
  orgId: string;
  /** Who triggered it (a real user for manual runs; the system for cron). */
  userId: string;
  label: string;
  resultHref?: string | null;
  /** The actual agent work. Runs ONLY when the lock was acquired. */
  work: () => Promise<T>;
  staleMs?: number;
}

export type RunAgentExclusiveResult<T> =
  | { ran: true; jobId: string; result: T }
  | { ran: false; reason: "already_running" };

/**
 * Acquire the per-agent singleton lock, run `work`, and release the lock.
 * Returns `{ ran:false, reason:"already_running" }` WITHOUT running when
 * another instance holds the lock — callers turn that into a 409 (manual)
 * or a skip-log (cron).
 */
export async function runAgentExclusive<T>(
  args: RunAgentExclusiveArgs<T>,
): Promise<RunAgentExclusiveResult<T>> {
  const lockKey = agentLockKey(args.agent);
  const target = AGENT_SINGLETON_TARGET;
  // Reap a dead lock first so a crashed run can't wedge the cadence. We reap
  // by the SAME kind we insert under (args.agent) so the running-index match
  // is exact.
  await reapStaleRunningJob([args.agent], target, args.orgId, args.staleMs ?? AGENT_STALE_MS);
  const jobId = await startBackgroundJob({
    orgId: args.orgId,
    userId: args.userId,
    kind: args.agent,
    lockKey,
    targetType: "autopilot_agent",
    targetId: target,
    label: args.label,
    resultHref: args.resultHref ?? null,
  });
  if (!jobId) return { ran: false, reason: "already_running" };
  try {
    const result = await args.work();
    await completeBackgroundJob(jobId, { resultHref: args.resultHref ?? null });
    return { ran: true, jobId, result };
  } catch (err) {
    await failBackgroundJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
