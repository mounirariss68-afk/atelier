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
} from "../../src/lib/atelier-agents/executive-mapper-chain.js";
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
    check(getExecutiveMapperLaunch(ACCT_ID) === null, "no launch entry before any run");

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
      getExecutiveMapperLaunch(ACCT_ID)?.status === "running",
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
      getExecutiveMapperLaunch(ACCT_ID)?.status === "running",
      "rejected overlap leaves the in-flight 'running' entry intact",
    );

    const result = await p1;
    const settled = getExecutiveMapperLaunch(ACCT_ID);
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
      getExecutiveMapperLaunch(ACCT_ID)?.status === "running",
      "a NEW run after a settled one re-registers 'running'",
    );
    await p2;
    const failed = getExecutiveMapperLaunch(ACCT_ID);
    check(failErr === "probe-boom", "failing pipeline rethrows to the caller");
    check(failed?.status === "failed" && failed.error === "probe-boom", "launch settles to 'failed' with the error message");

    // A failed run must not wedge the in-flight claim: a retry starts cleanly.
    const p3 = runExecutiveMapperAndQueue(ACCT_ID, null, { runImpl: slowOk });
    check(getExecutiveMapperLaunch(ACCT_ID)?.status === "running", "retry after failure claims the slot again");
    await p3;
    check(getExecutiveMapperLaunch(ACCT_ID)?.status === "succeeded", "retry settles to 'succeeded'");
  } finally {
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
