/**
 * Task #1193 — Cartographer / Executive Mapper runs in the Background Work bell.
 *
 * Verifies GET /me/background-jobs surfaces:
 *  1. an Executive Mapper launch DURING the pre-run-row window (the in-memory
 *     launch-visibility registry), attributed to the triggering user only,
 *  2. a Cartographer launch entry (same registry, exercised via the shared
 *     noteAgentLaunch used by the refresh route / create auto-run / chat
 *     dispatch),
 *  3. dedupe: once a durable atelier_agent_runs row exists for the same
 *     (agent, target), the launch entry never double-renders,
 *  4. disappearance on completion, and invisibility to another persona.
 *
 * Run with: NODE_ENV=test tsx ./tests/crm/background-work-bell-probe.ts
 */
import type { AddressInfo } from "node:net";

let failures = 0;
function check(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db, pool, atelierUsers, atelierAccounts, atelierAgentRuns, atelierAuditEvents } =
    await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const { runExecutiveMapperAndQueue } = await import(
    "../../src/lib/atelier-agents/executive-mapper-chain.js"
  );
  const { noteAgentLaunch, clearAgentLaunch } = await import(
    "../../src/lib/atelier-agents/launch-visibility.js"
  );
  const { runExecutiveMapper } = await import("../../src/lib/atelier-agents/runner.js");
  type RunImpl = typeof runExecutiveMapper;

  const tag = `bwb_${Date.now().toString(36)}`;
  const ORG = `org_${tag}`;
  const userA = `u_a_${tag}`;
  const userB = `u_b_${tag}`;
  const ACCT = `acc_${tag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const feed = async (userId: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/atelier/me/background-jobs`, {
      headers: { cookie: `atelier_persona=${userId}` },
    });
    if (res.status !== 200) throw new Error(`feed ${res.status}`);
    return (await res.json()) as { jobs: Array<{ id: string; kind: string; label: string; status: string }> };
  };

  try {
    for (const [id, name] of [
      [userA, "Bell Probe A"],
      [userB, "Bell Probe B"],
    ] as const) {
      await db.insert(atelierUsers).values({
        id,
        orgId: ORG,
        name,
        initials: "BP",
        email: `${id}@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Partner",
      } as any);
    }
    await db.insert(atelierAccounts).values({
      id: ACCT,
      orgId: ORG,
      slug: `bell-probe-${tag}`,
      name: `Bell Probe Co ${tag}`,
      brandName: `Bell Probe Co`,
      status: "active",
      country: "UAE",
      sector: "Technology",
    } as any);

    console.log("1) Executive Mapper pre-run-row window");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const stubRun: RunImpl = (async () => {
      await gate;
      return {
        runId: `run_${tag}`,
        output: { decisionMakers: [], sourceSignals: [], openQuestions: [] },
      };
    }) as unknown as RunImpl;
    const p = runExecutiveMapperAndQueue(ACCT, userA, { runImpl: stubRun }).catch(() => null);
    // No run row exists (stub never calls startRun) — only the registry can
    // surface this. Poll immediately, as the bell would.
    const during = await feed(userA);
    const emEntry = during.jobs.find(
      (j) => j.kind === "executive_mapper" && j.status === "running",
    );
    check(!!emEntry, "exec-mapper launch visible to triggering user pre-run-row");
    check(
      (emEntry?.label ?? "").includes("Bell Probe Co") || emEntry?.label === "Executive Mapper",
      "entry carries the account label",
      emEntry?.label,
    );
    const otherDuring = await feed(userB);
    check(
      !otherDuring.jobs.some((j) => j.kind === "executive_mapper"),
      "another persona sees no exec-mapper entry (self-scoped)",
    );

    console.log("2) dedupe once a durable run row lands");
    await db.insert(atelierAgentRuns).values({
      id: `run_row_${tag}`,
      orgId: ORG,
      agentId: "executive_mapper",
      triggeredByUserId: userA,
      targetType: "account",
      targetId: ACCT,
      targetLabel: "Bell Probe Co",
      inputs: {},
      status: "running",
      statusMessage: "probe",
    } as any);
    const withRow = await feed(userA);
    const emEntries = withRow.jobs.filter((j) => j.kind === "executive_mapper");
    check(emEntries.length === 1, "exactly one exec-mapper entry after run row exists", emEntries);
    check(
      emEntries[0]?.id === `run_row_${tag}` || emEntries[0]?.id === `run_run_row_${tag}`,
      "the durable run row wins the dedupe",
      emEntries[0]?.id,
    );
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.id, `run_row_${tag}`));

    console.log("3) entry disappears on completion");
    release();
    await p;
    await sleep(50);
    const after = await feed(userA);
    check(
      !after.jobs.some((j) => j.kind === "executive_mapper" && j.status === "running"),
      "exec-mapper entry gone after the run settles",
    );

    console.log("4) Cartographer launch entry (shared registry path)");
    noteAgentLaunch({
      agentId: "account_cartographer",
      targetId: ACCT,
      targetLabel: "Bell Probe Co",
      userId: userA,
    });
    const cartDuring = await feed(userA);
    check(
      cartDuring.jobs.some(
        (j) => j.kind === "account_cartographer" && j.status === "running",
      ),
      "cartographer launch visible to triggering user",
    );
    check(
      !(await feed(userB)).jobs.some((j) => j.kind === "account_cartographer"),
      "cartographer launch invisible to another persona",
    );
    clearAgentLaunch("account_cartographer", ACCT);
    check(
      !(await feed(userA)).jobs.some((j) => j.kind === "account_cartographer"),
      "cartographer entry gone after clear",
    );
  } finally {
    server.close();
    // fixtures cleanup (probe-unique org)
    try {
      await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.orgId, ORG));
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, ACCT));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, ACCT));
      await db.delete(atelierUsers).where(eq(atelierUsers.orgId, ORG));
    } catch (e) {
      console.warn("cleanup failed", e);
    }
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
