/**
 * Task #1119 — retire orphaned async_plan background jobs.
 *
 * Context: Task #1116 removed the background auto-commit runner for
 * unapproved chat writes. Any pre-existing `atelier_cli_jobs` rows of
 * kind `async_plan` still in status queued/running now have NO runner
 * and would sit "in progress" forever. Their parent turns may likewise
 * be stuck in the retired `async_dispatched` (or `streaming`) status.
 *
 * This script is the committed, reviewable form of the cleanup. It is
 * idempotent and safe to re-run (including on production at go-live):
 *   1. Enumerates atelier_cli_jobs rows with kind='async_plan' AND
 *      status IN ('queued','running'). Terminal rows (success/error/
 *      cancelled) are historical records and are NOT touched.
 *   2. In one transaction:
 *        - marks each such job status='error',
 *          error='runner removed — approval required', finishedAt=now.
 *        - for each affected job's turn: if the turn is still in a
 *          non-terminal/stuck state for this pathway ('async_dispatched'
 *          or 'streaming'), sets it to status='error' with a matching
 *          statusMessage so it renders as a sensible terminal state.
 *          Turns already terminal (success/error/cancelled/…) are left
 *          alone — the historical async_dispatched rows whose jobs DID
 *          complete keep their status and render as before.
 *      Dependency policy: atelier_cli_jobs has no dependent tables
 *      (nothing references job ids); turns are updated, never deleted.
 *   3. Writes one system-actor audit row per affected org
 *      (action `cli.async_jobs.retired`, see auditContract.ts).
 *   4. No-ops (and writes no audit row) when there is nothing to retire.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/retire-async-jobs-1119.ts
 *
 * Executed against the development database on 2026-08-14 (0 orphaned
 * rows — the dev DB was already clean; the committed script exists for
 * the production re-run at go-live). Rerun-safe probe:
 * scripts/retire-async-jobs-1119-probe.ts.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, atelierCliJobs, atelierCliTurns, atelierAuditEvents } from "@workspace/db";

export const RETIRE_MESSAGE = "runner removed — approval required";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function retireOrphanAsyncJobs(): Promise<{
  retiredJobIds: string[];
  erroredTurnIds: string[];
}> {
  const orphans = await db
    .select()
    .from(atelierCliJobs)
    .where(
      and(
        eq(atelierCliJobs.kind, "async_plan"),
        inArray(atelierCliJobs.status, ["queued", "running"]),
      ),
    );

  console.log(`Orphaned async_plan jobs (queued/running): ${orphans.length}`);
  if (orphans.length === 0) {
    console.log("Nothing to retire — no orphaned async_plan job rows.");
    return { retiredJobIds: [], erroredTurnIds: [] };
  }
  for (const j of orphans) {
    console.log(`  job=${j.id} turn=${j.turnId} status=${j.status} created=${j.createdAt?.toISOString()}`);
  }

  const jobIds = orphans.map((j) => j.id);
  const turnIds = Array.from(new Set(orphans.map((j) => j.turnId)));
  const erroredTurnIds: string[] = [];

  await db.transaction(async (tx) => {
    const now = new Date();
    // 1. Jobs → error (terminal).
    await tx
      .update(atelierCliJobs)
      .set({ status: "error", error: RETIRE_MESSAGE, finishedAt: now, updatedAt: now })
      .where(inArray(atelierCliJobs.id, jobIds));

    // 2. Stuck parent turns → error. Only the states this retired
    //    pathway could leave behind; terminal turns are untouched.
    const stuckTurns = await tx
      .select({ id: atelierCliTurns.id, orgId: atelierCliTurns.orgId, status: atelierCliTurns.status })
      .from(atelierCliTurns)
      .where(
        and(
          inArray(atelierCliTurns.id, turnIds),
          inArray(atelierCliTurns.status, ["async_dispatched", "streaming"]),
        ),
      );
    if (stuckTurns.length > 0) {
      await tx
        .update(atelierCliTurns)
        .set({
          status: "error",
          statusMessage: RETIRE_MESSAGE,
          finishedAt: now,
          updatedAt: now,
        })
        .where(inArray(atelierCliTurns.id, stuckTurns.map((t) => t.id)));
      erroredTurnIds.push(...stuckTurns.map((t) => t.id));
    }

    // 3. One system audit row per affected org.
    const byOrg = new Map<string, typeof orphans>();
    for (const j of orphans) {
      const arr = byOrg.get(j.orgId) ?? [];
      arr.push(j);
      byOrg.set(j.orgId, arr);
    }
    for (const [orgId, jobs] of byOrg) {
      await tx.insert(atelierAuditEvents).values({
        id: rid("aud"),
        orgId,
        entityType: "cli_job",
        entityId: jobs[0]!.id,
        actorType: "system",
        actorId: "system",
        actorLabel: "System cleanup (Task #1119)",
        action: "cli.async_jobs.retired",
        payload: {
          reason: RETIRE_MESSAGE,
          jobIds: jobs.map((j) => j.id),
          turnIds: jobs.map((j) => j.turnId),
          turnsMarkedError: stuckTurns
            .filter((t) => t.orgId === orgId)
            .map((t) => ({ id: t.id, priorStatus: t.status })),
        },
        payloadSummary: `Retired ${jobs.length} orphaned async_plan job(s) — background runner removed (Task #1116).`,
      });
    }

    console.log(
      `Retired ${jobIds.length} job(s); marked ${stuckTurns.length} stuck turn(s) error.`,
    );
  });
  return { retiredJobIds: jobIds, erroredTurnIds };
}

// Run directly (not when imported by the probe).
if (process.argv[1] && process.argv[1].endsWith("retire-async-jobs-1119.ts")) {
  retireOrphanAsyncJobs()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("retire-async-jobs-1119 failed:", err);
      process.exit(1);
    });
}
