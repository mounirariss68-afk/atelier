/**
 * Task #1105 — prove the finance-autopilot single-flight guard never lets a
 * scheduled run and a manual trigger double-materialise.
 *
 * The shared guard under test: `runAgentExclusive` (used by BOTH the cron
 * scheduler and the manual routes) acquires the durable background-jobs
 * lock with a STABLE per-agent lockKey ("agent:<name>") + a STABLE singleton
 * target ("_singleton_"), so the partial-unique running index admits at most
 * one running instance per agent per org — regardless of date.
 *
 * Checks:
 *   1. Two CONCURRENT runAgentExclusive calls on the same agent+org: exactly
 *      ONE runs `work`, the other returns { ran:false, "already_running" }.
 *      Work counter shows single materialisation.
 *   2. The winner's running row uses the stable lockKey + singleton target
 *      (NOT a per-date target — the bug the review flagged).
 *   3. Route-shaped: while a run holds the lock (a running job row pre-
 *      inserted with the shared lockKey+target), POST /collections/run
 *      returns 409 "already_running" and does NOT create a run.
 *   4. Stale reaping: a "running" row older than the stale window is reaped
 *      so a fresh acquisition proceeds instead of 409-ing forever.
 *   5. Different agents don't block each other (per-agent lock, not global).
 *
 * Run: pnpm exec tsx tests/autopilot-concurrency/run.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierBackgroundJobs, atelierCollectionsDraft } = D as any;
  const { and, eq, inArray } = await import("drizzle-orm");
  const { runAgentExclusive, agentLockKey, AGENT_SINGLETON_TARGET } =
    await import("../../src/lib/atelier-agents/exclusive-runs.js");

  const STAMP = Date.now();
  const ORG = `aico_conc_${STAMP}`;
  const FP_ID = `p_conc_fp_${STAMP}`;

  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  try {
    await db.insert(atelierUsers).values({
      id: FP_ID, orgId: ORG, email: `${FP_ID}@example.com`, name: "Conc FP",
      initials: "CF", role: "founding_partner", roleLabel: "FP", title: "FP",
      permissions: [], bdActive: false,
    }).onConflictDoNothing();

    // ── 1 & 2: two concurrent acquisitions, exactly one runs. ──
    let workRuns = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowWork = async () => { workRuns++; await gate; return { runId: `run_${workRuns}` }; };

    const p1 = runAgentExclusive({ agent: "collections_agent", orgId: ORG, userId: FP_ID, label: "concA", work: slowWork });
    const p2 = runAgentExclusive({ agent: "collections_agent", orgId: ORG, userId: FP_ID, label: "concB", work: slowWork });
    // Give both a moment to race the unique index, then let the winner finish.
    await new Promise((r) => setTimeout(r, 150));
    check("(1) only ONE of two concurrent runs executed work()", workRuns === 1, { workRuns });
    // Inspect the running row BEFORE releasing.
    const running = await db.select().from(atelierBackgroundJobs).where(and(
      eq(atelierBackgroundJobs.orgId, ORG),
      eq(atelierBackgroundJobs.kind, "collections_agent"),
      eq(atelierBackgroundJobs.status, "running"),
    ));
    check("(2) exactly one running job row exists", running.length === 1, running.map((r: any) => r.id));
    check("(2) running row uses stable per-agent lockKey", running[0]?.lockKey === agentLockKey("collections_agent"), running[0]?.lockKey);
    check("(2) running row uses stable singleton target (not a date)", running[0]?.targetId === AGENT_SINGLETON_TARGET, running[0]?.targetId);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const ranCount = [r1, r2].filter((r) => r.ran).length;
    const blocked = [r1, r2].find((r) => !r.ran);
    check("(1) exactly one call returned ran:true", ranCount === 1, { r1: r1.ran, r2: r2.ran });
    check("(1) the loser returned already_running", (blocked as any)?.reason === "already_running", blocked);

    // ── 3: route-shaped 409 while the lock is held. ──
    // Pre-insert a running job with the SHARED lockKey + singleton target
    // (simulating an in-flight scheduled or manual run), then hit the route.
    await db.insert(atelierBackgroundJobs).values({
      id: `bgjob_hold_${STAMP}`, orgId: ORG, startedByUserId: FP_ID,
      kind: "collections_agent", lockKey: agentLockKey("collections_agent"),
      targetType: "autopilot_agent", targetId: AGENT_SINGLETON_TARGET,
      label: "held", status: "running",
    });
    const draftsBefore = await db.select().from(atelierCollectionsDraft).where(eq(atelierCollectionsDraft.orgId, ORG));
    const res = await fetch(`${API}/collections/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${FP_ID}` },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => null);
    check("(3) manual /collections/run returns 409 while a run holds the lock", res.status === 409, { status: res.status, body });
    check("(3) 409 body is already_running", body?.error === "already_running", body);
    const draftsAfter = await db.select().from(atelierCollectionsDraft).where(eq(atelierCollectionsDraft.orgId, ORG));
    check("(3) blocked manual run created NO new drafts", draftsAfter.length === draftsBefore.length, { before: draftsBefore.length, after: draftsAfter.length });
    // release the held lock
    await db.update(atelierBackgroundJobs).set({ status: "done", finishedAt: new Date() })
      .where(eq(atelierBackgroundJobs.id, `bgjob_hold_${STAMP}`));

    // ── 4: stale reaping lets a fresh acquisition proceed. ──
    await db.insert(atelierBackgroundJobs).values({
      id: `bgjob_stale_${STAMP}`, orgId: ORG, startedByUserId: FP_ID,
      kind: "collections_agent", lockKey: agentLockKey("collections_agent"),
      targetType: "autopilot_agent", targetId: AGENT_SINGLETON_TARGET,
      label: "stale", status: "running",
      // 40 min old — beyond the 30 min stale window.
      createdAt: new Date(Date.now() - 40 * 60_000),
    });
    let staleWorkRan = false;
    const rStale = await runAgentExclusive({
      agent: "collections_agent", orgId: ORG, userId: FP_ID, label: "afterStale",
      staleMs: 30 * 60_000,
      work: async () => { staleWorkRan = true; return { runId: "afterStale" }; },
    });
    check("(4) fresh run proceeds after a stale lock is reaped", rStale.ran === true && staleWorkRan, rStale);

    // ── 5: different agents don't block each other. ──
    // Hold collections lock, acquire self-billing concurrently → both run.
    await db.insert(atelierBackgroundJobs).values({
      id: `bgjob_collhold_${STAMP}`, orgId: ORG, startedByUserId: FP_ID,
      kind: "collections_agent", lockKey: agentLockKey("collections_agent"),
      targetType: "autopilot_agent", targetId: AGENT_SINGLETON_TARGET,
      label: "collhold", status: "running",
    });
    let sbRan = false;
    const rSb = await runAgentExclusive({
      agent: "self_billing_clerk", orgId: ORG, userId: FP_ID, label: "sb",
      work: async () => { sbRan = true; return { runId: "sb" }; },
    });
    check("(5) self-billing runs while collections lock is held (per-agent lock)", rSb.ran === true && sbRan, rSb);
    await db.update(atelierBackgroundJobs).set({ status: "done", finishedAt: new Date() })
      .where(eq(atelierBackgroundJobs.id, `bgjob_collhold_${STAMP}`));
  } finally {
    try {
      await db.delete(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.orgId, ORG));
      await db.delete(atelierCollectionsDraft).where(eq(atelierCollectionsDraft.orgId, ORG));
      await db.delete(atelierUsers).where(eq(atelierUsers.orgId, ORG));
    } catch (e) { console.warn("cleanup warning", e); }
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end?.();
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
  console.log("\nAll autopilot-concurrency checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
