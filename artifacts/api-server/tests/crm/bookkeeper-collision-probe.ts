/**
 * Task #1083 — prove Bookkeeper auto-posting never double-posts when runs collide.
 *
 * The duplicate defenses under test:
 *   - atelier_background_jobs uq_atelier_bgjobs_running partial unique index
 *     (one running job per org+lockKey+target) → startBackgroundJob returns
 *     null for the loser of a concurrent claim race.
 *   - atelier_gl_journal_entry uq_atelier_gljrn_source (org, sourceKind,
 *     sourceRef) → re-runs skip already-posted sources.
 *
 * Checks:
 *   1. Two CONCURRENT claim attempts on the same (org, period) target —
 *      exactly one wins, the other gets null (atomic guard, no window).
 *   2. While a fresh run is "running", POST /gl/bookkeeper/run → 409
 *      run_in_progress (manual click can't overlap an in-flight run).
 *   3. Two concurrent HTTP runs: statuses ⊆ {200, 409}, at least one
 *      succeeds, and the journal has ZERO duplicate (sourceKind, sourceRef)
 *      entries — the invoice posted exactly once.
 *   4. A re-run of the same period skips existing entries (idempotent),
 *      journal count unchanged.
 *   5. A period locked for the GL module is skipped by the auto tick:
 *      no job row is claimed, no journal rows appear.
 *   6. A stale "running" job (older than BOOKKEEPER_STALE_MS) is reaped and
 *      a new manual run proceeds (200) instead of 409-ing forever.
 *
 * Deterministic: the Bookkeeper is a rule-based agent (no LLM call); all
 * rows live in a probe-unique org and are cleaned up in `finally`.
 *
 * Run: pnpm exec tsx tests/crm/bookkeeper-collision-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierLegalEntities,
    atelierInvoice,
    atelierGlAccount,
    atelierGlJournalEntry,
    atelierGlJournalLine,
    atelierGlPostingException,
    atelierBackgroundJobs,
    atelierPeriodCloseLock,
    atelierAgentRuns,
    atelierAuditEvents,
  } = D;
  const { and, eq, sql, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const { seedChartForEntity } = await import("../../src/lib/atelier-agents/bookkeeper.js");
  const {
    BOOKKEEPER_JOB_KINDS,
    BOOKKEEPER_LOCK_KEY,
    BOOKKEEPER_STALE_MS,
    bookkeeperJobTargetId,
    runBookkeeperAutoTick,
  } = await import("../../src/lib/atelier-agents/bookkeeperAuto.js");
  const { startBackgroundJob, failBackgroundJob } = await import("../../src/lib/background-jobs.js");

  const runTag = `bkcol_${Date.now().toString(36)}`;
  const ORG = `org_${runTag}`; // probe-unique org isolates scans & the auto tick
  const userId = `u_${runTag}`;
  const entId = `lent_${runTag}`;
  const invId = `inv_${runTag}`;
  const PERIOD = new Date().toISOString().slice(0, 7); // current YYYY-MM — the auto tick sweeps it
  const TARGET = bookkeeperJobTargetId(ORG, PERIOD);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${userId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  const journalRows = () =>
    db.select().from(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.orgId, ORG));
  const dupSources = async () => {
    const rows = await db
      .select({
        sourceKind: atelierGlJournalEntry.sourceKind,
        sourceRef: atelierGlJournalEntry.sourceRef,
        n: sql<number>`count(*)`,
      })
      .from(atelierGlJournalEntry)
      .where(eq(atelierGlJournalEntry.orgId, ORG))
      .groupBy(atelierGlJournalEntry.sourceKind, atelierGlJournalEntry.sourceRef)
      .having(sql`count(*) > 1`);
    return rows;
  };
  const jobsForTarget = () =>
    db.select().from(atelierBackgroundJobs).where(and(
      eq(atelierBackgroundJobs.orgId, ORG),
      inArray(atelierBackgroundJobs.kind, [...BOOKKEEPER_JOB_KINDS]),
      eq(atelierBackgroundJobs.targetId, TARGET),
    ));

  try {
    // ── fixtures: finance persona, one active entity + chart, one issued invoice ──
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: ORG,
      name: "Bookkeeper Collision Probe",
      initials: "BC",
      email: `${runTag}@example.test`,
      role: "finance",
      roleLabel: "Finance",
      title: "Finance",
    } as any);
    await db.insert(atelierLegalEntities).values({
      id: entId,
      orgId: ORG,
      legalNameEn: "Collision Probe FZ-LLC",
      shortName: "CollisionProbe",
      country: "AE",
      status: "active",
      baseCurrency: "USD",
    } as any);
    await seedChartForEntity({ orgId: ORG, legalEntityId: entId, createdByUserId: userId });
    await db.insert(atelierInvoice).values({
      id: invId,
      orgId: ORG,
      legalEntityId: entId,
      jurisdiction: "AE",
      invoiceNumber: `INV-${runTag}`,
      currency: "USD",
      status: "issued",
      subtotal: 1000,
      vatAmount: 0,
      total: 1000,
      issuedAt: new Date(), // inside PERIOD
    } as any);

    // ── 1. concurrent claim race: exactly one winner ──
    const claimArgs = {
      orgId: ORG,
      userId,
      kind: "gl_bookkeeper_manual",
      lockKey: BOOKKEEPER_LOCK_KEY,
      targetType: "gl_period",
      targetId: TARGET,
      label: `probe claim ${PERIOD}`,
    } as const;
    const [claimA, claimB] = await Promise.all([
      startBackgroundJob({ ...claimArgs }),
      startBackgroundJob({ ...claimArgs }),
    ]);
    const winners = [claimA, claimB].filter((id) => id !== null);
    check("1. concurrent claim race has exactly one winner", winners.length === 1, { claimA, claimB });

    // ── 2. manual run while a fresh run is in flight → 409 ──
    const whileRunning = await api("POST", "/gl/bookkeeper/run", { periodLabel: PERIOD });
    check(
      "2. POST /gl/bookkeeper/run during a live run → 409 run_in_progress",
      whileRunning.status === 409 && whileRunning.body?.error === "run_in_progress",
      whileRunning,
    );
    // release the probe claim so real runs can proceed
    if (winners[0]) await failBackgroundJob(winners[0], "probe release");

    // ── 3. two concurrent HTTP runs: ⊆ {200,409}, ≥1 success, no dup journal sources ──
    const [r1, r2] = await Promise.all([
      api("POST", "/gl/bookkeeper/run", { periodLabel: PERIOD }),
      api("POST", "/gl/bookkeeper/run", { periodLabel: PERIOD }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    check(
      "3a. concurrent runs return only 200/409 with at least one success",
      statuses.every((s) => s === 200 || s === 409) && statuses.includes(200),
      { r1: { status: r1.status, body: r1.body }, r2: { status: r2.status, body: r2.body } },
    );
    const dups1 = await dupSources();
    check("3b. journal has zero duplicate (sourceKind, sourceRef) entries", dups1.length === 0, dups1);
    const invEntries1 = (await journalRows()).filter(
      (e) => e.sourceKind === "invoice" && e.sourceRef === invId,
    );
    check("3c. the probe invoice posted exactly once", invEntries1.length === 1, invEntries1.length);

    // ── 4. sequential re-run is idempotent ──
    const rerun = await api("POST", "/gl/bookkeeper/run", { periodLabel: PERIOD });
    const rerunOk =
      rerun.status === 200 &&
      rerun.body?.data?.entriesCreated === 0 &&
      (rerun.body?.data?.entriesSkippedExisting ?? 0) >= 1;
    check("4a. re-run creates nothing and skips existing sources", rerunOk, rerun.body?.data ?? rerun);
    const countAfterRerun = (await journalRows()).length;
    const dups2 = await dupSources();
    check("4b. journal still duplicate-free after re-run", dups2.length === 0, dups2);

    // ── 5. locked period is skipped by the auto tick ──
    await db.insert(atelierPeriodCloseLock).values({
      id: `pcl_${runTag}`,
      orgId: ORG,
      periodLabel: PERIOD,
      lockedModules: ["gl"],
      lockedByUserId: userId,
    } as any);
    // clear prior job history so the lock (not the rate limit) is what skips
    await db.delete(atelierBackgroundJobs).where(and(
      eq(atelierBackgroundJobs.orgId, ORG),
      eq(atelierBackgroundJobs.targetId, TARGET),
    ));
    await runBookkeeperAutoTick();
    const jobsAfterTick = await jobsForTarget();
    const countAfterTick = (await journalRows()).length;
    check(
      "5a. auto tick claims no job for the locked period",
      jobsAfterTick.length === 0,
      jobsAfterTick.map((j) => ({ kind: j.kind, status: j.status })),
    );
    check("5b. auto tick posts nothing into the locked period", countAfterTick === countAfterRerun, {
      before: countAfterRerun, after: countAfterTick,
    });
    // manual route also refuses the locked period (route-level guard)
    const lockedManual = await api("POST", "/gl/bookkeeper/run", { periodLabel: PERIOD });
    check(
      "5c. manual run on a locked period → 409 period_locked",
      lockedManual.status === 409 && lockedManual.body?.error === "period_locked",
      lockedManual,
    );
    await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.id, `pcl_${runTag}`));

    // ── 6. stale running job is reaped; a new run proceeds ──
    const staleId = `bgjob_stale_${runTag}`;
    await db.insert(atelierBackgroundJobs).values({
      id: staleId,
      orgId: ORG,
      startedByUserId: userId,
      kind: "gl_bookkeeper_auto",
      lockKey: BOOKKEEPER_LOCK_KEY,
      targetType: "gl_period",
      targetId: TARGET,
      label: "dead auto run",
      status: "running",
      createdAt: new Date(Date.now() - BOOKKEEPER_STALE_MS - 5 * 60 * 1000),
    } as any);
    const afterStale = await api("POST", "/gl/bookkeeper/run", { periodLabel: PERIOD });
    check("6a. new manual run proceeds past a stale running job (200)", afterStale.status === 200, afterStale);
    const [staleRow] = await db.select().from(atelierBackgroundJobs)
      .where(eq(atelierBackgroundJobs.id, staleId));
    check(
      "6b. the stale running job was reaped (status=failed)",
      staleRow?.status === "failed",
      staleRow?.status,
    );
    const dups3 = await dupSources();
    check("6c. journal still duplicate-free after the reaped re-run", dups3.length === 0, dups3);
  } finally {
    // cleanup — everything lives in the probe org
    await db.delete(atelierGlJournalLine).where(eq(atelierGlJournalLine.orgId, ORG));
    await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.orgId, ORG));
    await db.delete(atelierGlPostingException).where(eq(atelierGlPostingException.orgId, ORG));
    await db.delete(atelierGlAccount).where(eq(atelierGlAccount.orgId, ORG));
    await db.delete(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.orgId, ORG));
    await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.orgId, ORG));
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.orgId, ORG));
    await db.delete(atelierAuditEvents).where(sql`actor_id = ${userId} or entity_id like ${"%" + runTag + "%"}`);
    await db.delete(atelierInvoice).where(eq(atelierInvoice.orgId, ORG));
    await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.orgId, ORG));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    server.close();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`✗ bookkeeper-collision probe: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✓ bookkeeper-collision probe: all checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("bookkeeper-collision probe crashed:", err);
  process.exit(1);
});
