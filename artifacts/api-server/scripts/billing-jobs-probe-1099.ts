/**
 * Task #1099 probe — Billing Orchestrator on the durable job registry.
 *  1. Two concurrent launches → exactly one starts, the loser gets
 *     already_running.
 *  2. The run settles to "done" with a result summary (status endpoint SoT).
 *  3. A stale running claim is reaped so a fresh launch can proceed.
 *  4. Cron-kind launches are rate-limited right after a finished run.
 * Fixture-scoped, rerun-safe: only touches billing_orchestrator_* job rows
 * plus real (idempotent) orchestrator runs for org "aico".
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, atelierBackgroundJobs } from "@workspace/db";
import {
  launchBillingOrchestratorRun,
  getLatestBillingOrchestratorJob,
  BILLING_ORCH_JOB_KINDS,
  BILLING_ORCH_LOCK_KEY,
  BILLING_ORCH_TARGET,
  BILLING_ORCH_SYSTEM_ACTOR,
} from "../src/lib/atelier-agents/billingOrchestratorJobs.js";

const ORG = "aico";
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${ok ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function waitSettled(timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const job = await getLatestBillingOrchestratorJob(ORG);
    if (job && job.status !== "running") return job;
    if (Date.now() - t0 > timeoutMs) throw new Error("run did not settle in time");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  // 1. Concurrent launches — only one may claim the lock.
  const [a, b] = await Promise.all([
    launchBillingOrchestratorRun({
      orgId: ORG, kind: "billing_orchestrator_manual", userId: BILLING_ORCH_SYSTEM_ACTOR,
      label: "probe manual A", input: { source: "manual" }, triggeredByUserId: null, wait: false,
    }),
    launchBillingOrchestratorRun({
      orgId: ORG, kind: "billing_orchestrator_event", userId: BILLING_ORCH_SYSTEM_ACTOR,
      label: "probe event B", input: { source: "milestone_event" }, triggeredByUserId: null, wait: false,
    }),
  ]);
  const startedCount = [a, b].filter((x) => x.started).length;
  check("exactly one concurrent launch starts", startedCount === 1, { a, b });

  // 2. Settles to done with result summary.
  const settled = await waitSettled();
  check("run settles to done", settled.status === "done", settled.status);
  const result = settled.result as Record<string, unknown> | null;
  check("result carries rationaleSummary", typeof result?.rationaleSummary === "string", result);

  // 3. Stale reap: plant a dead running claim, then a fresh launch succeeds
  //    and the dead claim is marked failed.
  const staleId = `bgjob_probe1099_${Date.now().toString(36)}`;
  await db.insert(atelierBackgroundJobs).values({
    id: staleId, orgId: ORG, startedByUserId: BILLING_ORCH_SYSTEM_ACTOR,
    kind: "billing_orchestrator_manual", lockKey: BILLING_ORCH_LOCK_KEY,
    targetType: "billing_orchestrator", targetId: BILLING_ORCH_TARGET,
    label: "probe stale claim", status: "running",
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
  });
  const c = await launchBillingOrchestratorRun({
    orgId: ORG, kind: "billing_orchestrator_manual", userId: BILLING_ORCH_SYSTEM_ACTOR,
    label: "probe manual C (after stale)", input: { source: "manual" }, triggeredByUserId: null, wait: true,
  });
  check("fresh launch proceeds after reaping stale claim", c.started === true, c);
  const [staleRow] = await db.select().from(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.id, staleId));
  check("stale claim reaped to failed", staleRow?.status === "failed", staleRow?.status);

  // 4. Auto (cron) rate limit right after a finished run.
  const d = await launchBillingOrchestratorRun({
    orgId: ORG, kind: "billing_orchestrator_auto", userId: BILLING_ORCH_SYSTEM_ACTOR,
    label: "probe auto D", input: { source: "cron" }, triggeredByUserId: null, wait: true,
  });
  check("auto launch rate-limited after recent run", d.started === false && d.reason === "ran_recently", d);

  // Cleanup probe fixture rows (keep real run rows: they're legitimate runs).
  await db.delete(atelierBackgroundJobs).where(and(
    eq(atelierBackgroundJobs.orgId, ORG),
    inArray(atelierBackgroundJobs.kind, [...BILLING_ORCH_JOB_KINDS]),
    eq(atelierBackgroundJobs.label, "probe stale claim"),
  ));

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
