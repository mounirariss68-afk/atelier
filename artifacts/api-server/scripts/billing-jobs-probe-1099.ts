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
  launchBillingOrchestratorEventRun,
  armPendingBillingEvent,
  ackPendingBillingEvent,
  consumePendingBillingEvent,
  recoverMissedBillingMilestoneEvents,
  getLatestBillingOrchestratorJob,
  billingEventPendingId,
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

  // 5. Task #1118 — a milestone-event launch skipped while a run holds the
  //    lock durably arms a per-org pending flag that is consumed (chained
  //    unscoped event run through the same lock) on run completion, CAS-
  //    acknowledged, and recovered at boot. All state is in the DB.
  const FLAG_ID = billingEventPendingId(ORG);
  const readFlag = async () => {
    const [f] = await db.select().from(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.id, FLAG_ID));
    return f ?? null;
  };
  const waitChained = async (afterMs: number) => {
    const t0 = Date.now();
    let chained: Awaited<ReturnType<typeof getLatestBillingOrchestratorJob>> = null;
    for (;;) {
      const latest = await getLatestBillingOrchestratorJob(ORG);
      if (
        latest &&
        latest.kind === "billing_orchestrator_event" &&
        latest.label === "Billing run — deferred milestone event" &&
        new Date(latest.createdAt).getTime() >= afterMs
      ) { chained = latest; if (latest.status !== "running") break; }
      if (Date.now() - t0 > 120_000) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return chained;
  };
  await db.delete(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.id, FLAG_ID));

  // 5a. Event launch while a run is in flight → arms the durable flag.
  const blocker = await launchBillingOrchestratorRun({
    orgId: ORG, kind: "billing_orchestrator_manual", userId: BILLING_ORCH_SYSTEM_ACTOR,
    label: "probe manual E (blocker)", input: { source: "manual" }, triggeredByUserId: null, wait: false,
  });
  check("blocker run starts", blocker.started === true, blocker);
  const phase5aStart = Date.now();
  const ev = await launchBillingOrchestratorEventRun({
    orgId: ORG, userId: BILLING_ORCH_SYSTEM_ACTOR,
    label: "probe event F (deferred)", input: { engagementId: "eng_probe1118", source: "milestone_event" }, triggeredByUserId: null,
  });
  if (ev.started) {
    console.log("SKIP — blocker finished too fast to exercise deferral");
    await waitSettled();
  } else {
    check("event launch deferred to durable pending flag", ev.reason === "deferred_pending", ev);
    // Coalescing: a second skipped event upserts the SAME flag row.
    const ev2 = await launchBillingOrchestratorEventRun({
      orgId: ORG, userId: BILLING_ORCH_SYSTEM_ACTOR,
      label: "probe event F2", input: { source: "milestone_event" }, triggeredByUserId: null,
    });
    const flagRows = await db.select().from(atelierBackgroundJobs).where(and(
      eq(atelierBackgroundJobs.orgId, ORG),
      eq(atelierBackgroundJobs.kind, "billing_orchestrator_event_pending"),
    ));
    check("duplicate events coalesce onto one durable flag row",
      ev2.started === false && flagRows.length === 1 && flagRows[0]?.status === "pending",
      { ev2, flagRows: flagRows.length, status: flagRows[0]?.status });

    // 5b. Blocker completion consumes the flag: chained unscoped event run
    //     starts, settles done, and the flag is acknowledged.
    const chained = await waitChained(phase5aStart);
    check("completion consume chained a follow-up event run", !!chained, chained);
    check("chained event run settles to done", chained?.status === "done", chained?.status);
    const flagAfter = await readFlag();
    check("pending flag acknowledged after chained run started", flagAfter?.status === "done", flagAfter?.status);
  }
  await waitSettled();

  // 5c. CAS ack: a flag re-armed AFTER the consumer read it must survive
  //     a stale acknowledgement (transition-at-claim timing).
  await armPendingBillingEvent(ORG);
  const armed = await readFlag();
  const staleAck = await ackPendingBillingEvent(ORG, new Date(new Date(armed!.updatedAt).getTime() - 1000));
  check("stale ack no-ops (flag re-armed after read)", staleAck === false && (await readFlag())?.status === "pending", staleAck);
  const freshAck = await ackPendingBillingEvent(ORG, new Date(armed!.updatedAt));
  check("fresh ack clears the flag", freshAck === true && (await readFlag())?.status === "done", freshAck);

  // 5d. Competing run steals the post-completion gap: consume while a run
  //     is in flight must NOT ack; the flag is retained and consumed by
  //     that run's completion.
  const blocker2 = await launchBillingOrchestratorRun({
    orgId: ORG, kind: "billing_orchestrator_manual", userId: BILLING_ORCH_SYSTEM_ACTOR,
    label: "probe manual G (competing)", input: { source: "manual" }, triggeredByUserId: null, wait: false,
  });
  check("competing run starts", blocker2.started === true, blocker2);
  const phase5dStart = Date.now();
  await armPendingBillingEvent(ORG);
  const consumedWhileLocked = await consumePendingBillingEvent(ORG);
  const flagWhileLocked = await readFlag();
  if (blocker2.started && consumedWhileLocked === false) {
    check("consume during in-flight run retains the flag",
      flagWhileLocked?.status === "pending", flagWhileLocked?.status);
    const chained2 = await waitChained(phase5dStart);
    check("competing run's completion consumes the retained flag", !!chained2 && chained2.status === "done", chained2?.status);
    check("retained flag acknowledged after handoff", (await readFlag())?.status === "done", (await readFlag())?.status);
  } else {
    // Competing run finished before our consume — the consume itself
    // launched the chained run (also valid); just settle.
    console.log("SKIP — competing run finished before consume; direct-consume path taken");
    await waitSettled();
    await ackPendingBillingEvent(ORG, new Date());
  }
  await waitSettled();

  // 5e. Restart recovery: an armed flag with NO run in flight (process died
  //     before the completion consume) is consumed at boot.
  await armPendingBillingEvent(ORG);
  const recovered = await recoverMissedBillingMilestoneEvents();
  check("boot recovery consumes an orphaned pending flag", recovered >= 1, recovered);
  const recoveredJob = await waitSettled(120_000);
  check("recovery run settles to done", recoveredJob.status === "done", recoveredJob.status);
  check("flag acknowledged after recovery", (await readFlag())?.status === "done", (await readFlag())?.status);

  // Cleanup the flag row.
  await db.delete(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.id, FLAG_ID));

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
