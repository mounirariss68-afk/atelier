/**
 * Task #1119 — rerun-safe probe for retire-async-jobs-1119.ts.
 *
 * Seeds tagged fixture rows (ids prefixed `t1119probe`), runs the
 * retirement sweep, and asserts ONLY against those fixture ids — never
 * absolute table counts — so reruns on a reused DB stay green:
 *   1. Orphaned queued async_plan job → status error, retire message set.
 *   2. Its stuck async_dispatched turn → status error + statusMessage.
 *   3. A terminal (success) turn referenced by an orphaned running job
 *      keeps its status (only the job is retired).
 *   4. A terminal (success) async_plan job is untouched.
 *   5. Second run no-ops on the already-retired fixture rows.
 * Teardown deletes all fixture rows (jobs, turns, audit rows) in finally.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/retire-async-jobs-1119-probe.ts
 */
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, atelierCliJobs, atelierCliTurns, atelierAuditEvents } from "@workspace/db";
import { retireOrphanAsyncJobs, RETIRE_MESSAGE } from "./retire-async-jobs-1119.js";

const TAG = `t1119probe_${Date.now().toString(36)}`;
const failures: string[] = [];
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${ok ? "" : ` (${JSON.stringify(extra)})`}`);
  if (!ok) failures.push(name);
}

async function main() {
  // Need an existing org id for the ORG column; grab any turn/user org.
  const [anyOrg] = await db
    .select({ orgId: atelierCliTurns.orgId })
    .from(atelierCliTurns)
    .limit(1);
  const orgId =
    anyOrg?.orgId ??
    (await db.execute(sql`select org_id from atelier_users limit 1`).then(
      (r) => (r.rows[0] as { org_id?: string } | undefined)?.org_id,
    ));
  if (!orgId) throw new Error("no org available to seed probe fixtures");

  const stuckTurnId = `clit_${TAG}_stuck`;
  const doneTurnId = `clit_${TAG}_done`;
  const orphanJobA = `clij_${TAG}_a`;
  const orphanJobB = `clij_${TAG}_b`;
  const doneJob = `clij_${TAG}_c`;

  try {
    await db.insert(atelierCliTurns).values([
      {
        id: stuckTurnId,
        orgId,
        sessionId: `clis_${TAG}`,
        userId: `u_${TAG}`,
        status: "async_dispatched",
        prompt: "probe fixture — stuck async turn",
      },
      {
        id: doneTurnId,
        orgId,
        sessionId: `clis_${TAG}`,
        userId: `u_${TAG}`,
        status: "success",
        prompt: "probe fixture — completed turn",
      },
    ]);
    await db.insert(atelierCliJobs).values([
      {
        id: orphanJobA,
        orgId,
        turnId: stuckTurnId,
        sessionId: `clis_${TAG}`,
        userId: `u_${TAG}`,
        kind: "async_plan",
        status: "queued",
        idempotencyKey: `${TAG}:a`,
      },
      {
        id: orphanJobB,
        orgId,
        turnId: doneTurnId,
        sessionId: `clis_${TAG}`,
        userId: `u_${TAG}`,
        kind: "async_plan",
        status: "running",
        idempotencyKey: `${TAG}:b`,
      },
      {
        id: doneJob,
        orgId,
        turnId: doneTurnId,
        sessionId: `clis_${TAG}`,
        userId: `u_${TAG}`,
        kind: "async_plan",
        status: "success",
        idempotencyKey: `${TAG}:c`,
      },
    ]);

    const first = await retireOrphanAsyncJobs();
    check(
      "run 1 retires both orphaned fixture jobs",
      first.retiredJobIds.includes(orphanJobA) && first.retiredJobIds.includes(orphanJobB),
      first.retiredJobIds.filter((id) => id.includes(TAG)),
    );
    check(
      "run 1 does not retire the terminal fixture job",
      !first.retiredJobIds.includes(doneJob),
    );

    const jobs = await db
      .select()
      .from(atelierCliJobs)
      .where(inArray(atelierCliJobs.id, [orphanJobA, orphanJobB, doneJob]));
    const byId = new Map(jobs.map((j) => [j.id, j]));
    check(
      "orphaned jobs → error with retire message + finishedAt",
      [orphanJobA, orphanJobB].every(
        (id) =>
          byId.get(id)?.status === "error" &&
          byId.get(id)?.error === RETIRE_MESSAGE &&
          byId.get(id)?.finishedAt != null,
      ),
      jobs.map((j) => ({ id: j.id, status: j.status, error: j.error })),
    );
    check("terminal job untouched", byId.get(doneJob)?.status === "success");

    const turns = await db
      .select()
      .from(atelierCliTurns)
      .where(inArray(atelierCliTurns.id, [stuckTurnId, doneTurnId]));
    const turnById = new Map(turns.map((t) => [t.id, t]));
    check(
      "stuck async_dispatched turn → error + statusMessage",
      turnById.get(stuckTurnId)?.status === "error" &&
        turnById.get(stuckTurnId)?.statusMessage === RETIRE_MESSAGE,
      turnById.get(stuckTurnId)?.status,
    );
    check(
      "terminal turn keeps its status even though its job was retired",
      turnById.get(doneTurnId)?.status === "success",
      turnById.get(doneTurnId)?.status,
    );

    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.action, "cli.async_jobs.retired"));
    check(
      "system audit row written covering the fixture jobs",
      audits.some((a) => {
        const p = a.payload as { jobIds?: string[] } | null;
        return (
          a.actorType === "system" &&
          (p?.jobIds ?? []).includes(orphanJobA) &&
          (p?.jobIds ?? []).includes(orphanJobB)
        );
      }),
    );

    // Rerun: the fixture rows are already terminal → not retired again.
    const second = await retireOrphanAsyncJobs();
    check(
      "run 2 no-ops on already-retired fixture rows",
      !second.retiredJobIds.some((id) => id.includes(TAG)) &&
        !second.erroredTurnIds.some((id) => id.includes(TAG)),
      second,
    );
  } finally {
    await db.delete(atelierCliJobs).where(like(atelierCliJobs.id, `%${TAG}%`));
    await db.delete(atelierCliTurns).where(like(atelierCliTurns.id, `%${TAG}%`));
    // Only audit rows whose payload references our tagged fixtures.
    await db
      .delete(atelierAuditEvents)
      .where(sql`${atelierAuditEvents.action} = 'cli.async_jobs.retired' AND ${atelierAuditEvents.payload}::text LIKE ${`%${TAG}%`}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
