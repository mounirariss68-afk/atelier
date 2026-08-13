/**
 * Task #1046 — dead agent-run cleanup.
 *
 * `atelier_agent_runs` rows are driven by in-process promises; when the
 * server dies mid-run, the row stays "running" forever. Unlike the durable
 * background-job registry (lib/background-jobs.ts) there was no boot sweep,
 * so the Background Work bell showed dead runs ("Masdar — Working on it")
 * indefinitely, and duplicate-run guards blocked relaunches.
 *
 * Two defenses (mirroring the background-jobs pattern):
 *  1. `sweepInterruptedAgentRuns(bootTime)` — boot chore that fails every
 *     "running" row created before this process started. Self-heals
 *     production on the next publish/restart.
 *  2. `agentRunIsFresh()` — read-time WHERE condition for any surface that
 *     treats status="running" as "actually in flight" (bell pseudo-jobs,
 *     duplicate-run guards). A row whose `updated_at` hasn't moved for
 *     AGENT_RUN_STALE_MS is treated as dead even before the sweep runs —
 *     this is what fixes production, where the agent cannot write data.
 *
 * Cutoff rationale: every live run heartbeats `updated_at` via its progress
 * callbacks (see runner.ts setProgress), and the longest legitimate chains
 * (multi-pass POV drafts) report progress far more often than hourly, so a
 * 2h-silent "running" row can only be an orphan.
 */
import { db, atelierAgentRuns } from "@workspace/db";
import { and, eq, gt, lt, or, isNull, type SQL } from "drizzle-orm";

export const AGENT_RUN_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Condition: this "running" row is plausibly still alive. Combine with
 * `eq(status, "running")` in duplicate-run guards / bell reads so a dead
 * row can neither show as working nor block a relaunch.
 * (updated_at is NOT NULL in practice — runner stamps it on insert — but
 * treat a null defensively as "fresh only if recently created".)
 */
export function agentRunIsFresh(now: Date = new Date()): SQL {
  const cutoff = new Date(now.getTime() - AGENT_RUN_STALE_MS);
  return or(
    gt(atelierAgentRuns.updatedAt, cutoff),
    and(isNull(atelierAgentRuns.updatedAt), gt(atelierAgentRuns.createdAt, cutoff)),
  )!;
}

/**
 * Row-level version of the same rule, for read surfaces that already have
 * the row in hand (status loaders, monitor list/detail). A "running" row
 * whose heartbeat (updated_at, falling back to created_at) is older than
 * AGENT_RUN_STALE_MS is dead — report it as "error" instead of live.
 */
export function agentRunRowIsStale(
  row: { status: string; updatedAt?: Date | null; createdAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (row.status !== "running") return false;
  const heartbeat = row.updatedAt ?? row.createdAt;
  if (!heartbeat) return true;
  return now.getTime() - heartbeat.getTime() >= AGENT_RUN_STALE_MS;
}

/**
 * Same 2h rule for in-memory launch entries (the per-feature maps that
 * cover the pre-run-row window). A promise wedged in-process past the
 * cutoff must neither report "running" nor keep relaunch guards locked.
 */
export function launchEntryIsStale(startedAt: number, now: number = Date.now()): boolean {
  return now - startedAt >= AGENT_RUN_STALE_MS;
}

/**
 * Durable-heartbeat check for the contested cases above: before declaring a
 * long-lived in-memory launch dead, confirm the run row (if any) has also
 * stopped heartbeating. A >2h run that is still stamping progress is alive.
 */
export async function hasFreshRunningRun(agentId: string, targetId: string): Promise<boolean> {
  const [live] = await db
    .select({ id: atelierAgentRuns.id })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, agentId),
        eq(atelierAgentRuns.targetId, targetId),
        eq(atelierAgentRuns.status, "running"),
        isNull(atelierAgentRuns.deletedAt),
        agentRunIsFresh(),
      ),
    )
    .limit(1);
  return Boolean(live);
}

export const INTERRUPTED_RUN_MESSAGE =
  "Interrupted by a server restart — please start it again.";

/** Status to render for a run row, with stale "running" mapped to "error". */
export function effectiveAgentRunStatus(row: {
  status: string;
  updatedAt?: Date | null;
  createdAt?: Date | null;
}): string {
  return agentRunRowIsStale(row) ? "error" : row.status;
}

/**
 * Boot sweep — any row still "running" that predates this process's start
 * was orphaned by the previous process (agent runs never survive a restart;
 * they are plain in-process promises). Mark them "error" (the runner's
 * terminal failure status) with a friendly message so the bell, the agents
 * monitor, and relaunch guards all resolve. `bootTime` must be captured by
 * the entrypoint before the server accepts traffic (same contract as
 * sweepInterruptedBackgroundJobs).
 */
export async function sweepInterruptedAgentRuns(bootTime: Date): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(atelierAgentRuns)
    .set({
      status: "error",
      statusMessage: INTERRUPTED_RUN_MESSAGE,
      updatedAt: now,
    })
    .where(
      and(
        eq(atelierAgentRuns.status, "running"),
        lt(atelierAgentRuns.createdAt, bootTime),
      ),
    )
    .returning({ id: atelierAgentRuns.id });
  return rows.length;
}
