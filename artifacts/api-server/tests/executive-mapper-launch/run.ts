/**
 * Task #868 — Executive Mapper launch-registry lifecycle.
 *
 * The launch state is owned by the chain module and registered SYNCHRONOUSLY
 * inside runExecutiveMapperAndQueue, so EVERY entry point (manual route,
 * account-creation auto-run, post-Cartographer chain, chat dispatch) exposes
 * the same "running" state during the pre-run-row window, and exactly one
 * terminal state afterwards. This drives the account page's header chip and
 * settle toast via the shared workspace status.
 *
 * Run with: pnpm --filter @workspace/api-server run test:exec-mapper-launch
 * Uses the dev DATABASE_URL; seeds a throwaway account and cleans it up.
 */
import { db, atelierAccounts, atelierAuditEvents, atelierUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  runExecutiveMapperAndQueue,
  getExecutiveMapperLaunch,
  __testBackdateExecutiveMapperLaunch,
} from "../../src/lib/atelier-agents/executive-mapper-chain.js";
import { atelierAgentRuns } from "@workspace/db";
import type { runExecutiveMapper } from "../../src/lib/atelier-agents/runner.js";

type RunImpl = typeof runExecutiveMapper;

let pass = 0;
let fail = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${msg}`);
  } else {
    fail++;
    console.error(`  \u2717 ${msg}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tag = Date.now().toString(36);
const ACCT_ID = `acc_emlaunch_${tag}`;

const emptyOutput = {
  decisionMakers: [],
  sourceSignals: [],
  openQuestions: ["probe: nothing swept"],
};

async function main(): Promise<void> {
  console.log("Executive Mapper launch registry \u2014 lifecycle");
  const [anyUser] = await db.select({ orgId: atelierUsers.orgId }).from(atelierUsers).limit(1);
  if (!anyUser) throw new Error("no users seeded — cannot pick an orgId");

  await db.insert(atelierAccounts).values({
    id: ACCT_ID,
    orgId: anyUser.orgId,
    slug: `emlaunch-${tag}`,
    name: `Exec Mapper Launch Probe Co ${tag}`,
    status: "active",
    country: "UAE",
    sector: "Technology",
  } as typeof atelierAccounts.$inferInsert);

  try {
    check((await getExecutiveMapperLaunch(ACCT_ID)) === null, "no launch entry before any run");

    // --- success lifecycle: pre-row "running" -> exactly one "succeeded" ---
    const slowOk: RunImpl = (async () => {
      await sleep(150);
      return { runId: `run_probe_${tag}`, output: emptyOutput };
    }) as unknown as RunImpl;

    const p1 = runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk });
    // SYNCHRONOUS registration: a status read issued in the same tick as the
    // fire-and-forget launch (the 202 response / fresh workspace poll) must
    // already see "running" — this is the pre-run-row window.
    check(
      (await getExecutiveMapperLaunch(ACCT_ID))?.status === "running",
      "launch reads 'running' synchronously, before any run row exists",
    );

    // Overlapping start (button pressed mid-run) rejects and does NOT clobber
    // the in-flight entry.
    let overlapErr = "";
    await runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk }).catch(
      (e: unknown) => { overlapErr = e instanceof Error ? e.message : String(e); },
    );
    check(overlapErr === "executive-mapper-already-running", "overlapping start rejects as already-running");
    check(
      (await getExecutiveMapperLaunch(ACCT_ID))?.status === "running",
      "rejected overlap leaves the in-flight 'running' entry intact",
    );

    const result = await p1;
    const settled = await getExecutiveMapperLaunch(ACCT_ID);
    check(settled?.status === "succeeded", "launch settles to 'succeeded' after the pipeline finishes");
    check(settled?.proposedCount === result.proposedCount, "settled entry carries the proposed count");
    check(settled?.runId === result.runId, "settled entry carries the run id");

    // --- failure lifecycle ---
    const boom: RunImpl = (async () => {
      await sleep(20);
      throw new Error("probe-boom");
    }) as unknown as RunImpl;
    let failErr = "";
    const p2 = runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: boom }).catch(
      (e: unknown) => { failErr = e instanceof Error ? e.message : String(e); },
    );
    check(
      (await getExecutiveMapperLaunch(ACCT_ID))?.status === "running",
      "a NEW run after a settled one re-registers 'running'",
    );
    await p2;
    const failed = await getExecutiveMapperLaunch(ACCT_ID);
    check(failErr === "probe-boom", "failing pipeline rethrows to the caller");
    check(failed?.status === "failed" && failed.error === "probe-boom", "launch settles to 'failed' with the error message");

    // A failed run must not wedge the in-flight claim: a retry starts cleanly.
    const p3 = runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk });
    check((await getExecutiveMapperLaunch(ACCT_ID))?.status === "running", "retry after failure claims the slot again");
    await p3;
    check((await getExecutiveMapperLaunch(ACCT_ID))?.status === "succeeded", "retry settles to 'succeeded'");

    // --- Task #1046: >2h-but-HEARTBEATING run stays live ---
    // A launch whose startedAt is past the cutoff but whose durable run row
    // is still stamping progress must NOT be declared dead or reclaimed.
    let release1: () => void = () => {};
    const hang1: RunImpl = ((): unknown =>
      new Promise((resolve) => {
        release1 = () => resolve({ runId: `run_hb_${tag}`, output: emptyOutput });
      })) as unknown as RunImpl;
    const pHb = runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: hang1 });
    __testBackdateExecutiveMapperLaunch(ACCT_ID, Date.now() - 3 * 60 * 60 * 1000);
    const HB_RUN_ID = `agr_hb_${tag}`;
    await db.insert(atelierAgentRuns).values({
      id: HB_RUN_ID,
      orgId: (await db.select({ orgId: atelierAccounts.orgId }).from(atelierAccounts).where(eq(atelierAccounts.id, ACCT_ID)))[0]!.orgId,
      agentId: "executive_mapper",
      targetType: "account",
      targetId: ACCT_ID,
      status: "running",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      updatedAt: new Date(), // fresh heartbeat
    } as typeof atelierAgentRuns.$inferInsert);
    check(
      (await getExecutiveMapperLaunch(ACCT_ID))?.status === "running",
      "old-but-heartbeating launch still reads 'running' (heartbeat wins over start time)",
    );
    let hbOverlapErr = "";
    await runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk }).catch(
      (e: unknown) => { hbOverlapErr = e instanceof Error ? e.message : String(e); },
    );
    check(
      hbOverlapErr === "executive-mapper-already-running",
      "old-but-heartbeating run is NOT reclaimed by a relaunch",
    );
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.id, HB_RUN_ID));
    release1();
    await pHb;
    check((await getExecutiveMapperLaunch(ACCT_ID))?.status === "succeeded", "heartbeating run settles normally once released");

    // --- Task #1046: stale takeover + old-promise settlement is inert ---
    let releaseOld: (err: Error) => void = () => {};
    const hangOld: RunImpl = ((): unknown =>
      new Promise((_resolve, reject) => {
        releaseOld = (err: Error) => reject(err);
      })) as unknown as RunImpl;
    const pOld = runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: hangOld }).catch(() => {});
    __testBackdateExecutiveMapperLaunch(ACCT_ID, Date.now() - 3 * 60 * 60 * 1000);
    // No fresh run row exists (stub runImpl writes none) → the wedged slot is
    // reclaimable, even after a status read normalized the entry to failed.
    const normalized = await getExecutiveMapperLaunch(ACCT_ID);
    check(normalized?.status === "failed", "silent >2h launch with no heartbeat normalizes to 'failed'");
    const takeover = await runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk });
    const afterTakeover = await getExecutiveMapperLaunch(ACCT_ID);
    check(afterTakeover?.status === "succeeded", "relaunch reclaims the wedged slot and succeeds");
    check(afterTakeover?.runId === takeover.runId, "state is owned by the NEW launch");
    // Old promise finally settles — must not clobber the new launch's state.
    releaseOld(new Error("old-wedged-run-finally-died"));
    await pOld;
    const afterOldSettles = await getExecutiveMapperLaunch(ACCT_ID);
    check(
      afterOldSettles?.status === "succeeded" && afterOldSettles.runId === takeover.runId,
      "late settlement of the ousted promise does NOT overwrite the new launch",
    );
    // And the slot is not wedged by the ousted promise's cleanup: a fresh run starts cleanly.
    await runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk });
    check((await getExecutiveMapperLaunch(ACCT_ID))?.status === "succeeded", "slot stays healthy after the ousted promise settles");
  } finally {
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.targetId, ACCT_ID));
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, ACCT_ID));
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, ACCT_ID));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
