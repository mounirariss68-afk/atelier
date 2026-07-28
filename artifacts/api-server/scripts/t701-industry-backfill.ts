/**
 * Task #701 — one-time assisted industry backfill for pre-#698 accounts.
 *
 * For every ACTIVE account whose industry_code is null or not a valid
 * Cognirise taxonomy code (raw NAICS leaked by the old auto-run), this:
 *   1. triggers the governed POST /accounts/:id/cartographer/refresh
 *   2. waits for the run to finish (polls atelier_agent_runs)
 *   3. approves ONLY the resulting "industry" proposal via the partner
 *      decision route (founding partner persona) — all other proposals are
 *      left pending for normal partner review.
 * Never a silent bulk write: every value lands via the proposal applier and
 * is audited as a partner approval.
 */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss"; // founding partner

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const { db, atelierAccounts, atelierAgentRuns } = await import("@workspace/db");
  const { and, eq, isNull, desc, gt } = await import("drizzle-orm");
  const { INDUSTRIES } = await import("../src/lib/data/atelier-reference-data.js");
  const valid = new Set(INDUSTRIES.map((i: any) => i.code));

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };

  const rows = await db
    .select()
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  const targets = rows.filter(
    (a: any) =>
      (a.status ?? "active") === "active" &&
      (!a.industryCode || !valid.has(a.industryCode)),
  );
  console.log(`Targets (${targets.length}):`, targets.map((a: any) => `${a.name} [${a.industryCode ?? "null"}]`));

  let failures = 0;
  for (const a of targets) {
    const startedAt = new Date();
    console.log(`\n=== ${a.name} (${a.id}) — triggering refresh…`);
    const r = await fetch(`${base}/accounts/${a.id}/cartographer/refresh`, {
      method: "POST", headers: hdrs, body: JSON.stringify({}),
    });
    if (r.status !== 200) {
      console.log(`FAIL refresh trigger ${r.status}`, await r.text());
      failures++;
      continue;
    }
    // Wait for the background run to finish (run row created after start).
    let runStatus: string | null = null;
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 10000));
      const [run] = await db
        .select({ status: atelierAgentRuns.status, msg: atelierAgentRuns.statusMessage })
        .from(atelierAgentRuns)
        .where(
          and(
            eq(atelierAgentRuns.targetType, "account"),
            eq(atelierAgentRuns.targetId, a.id),
            eq(atelierAgentRuns.agentId, "account_cartographer"),
            gt(atelierAgentRuns.createdAt, startedAt),
          ),
        )
        .orderBy(desc(atelierAgentRuns.createdAt))
        .limit(1);
      if (run && run.status !== "running") { runStatus = run.status; break; }
      process.stdout.write(`  … ${run?.status ?? "starting"} ${run?.msg ?? ""}\n`);
    }
    console.log(`  run finished: ${runStatus}`);
    if (runStatus !== "complete" && runStatus !== "completed" && runStatus !== "succeeded") {
      console.log(`FAIL run for ${a.name} status=${runStatus}`);
      failures++;
      continue;
    }
    // Proposals are queued in a tx AFTER the run row completes — poll briefly.
    let industryProposal: any = null;
    for (let i = 0; i < 12 && !industryProposal; i++) {
      const [fresh] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, a.id));
      const pending = ((fresh?.pendingProfileUpdates as any[]) ?? []).filter((u) => u.status === "pending");
      industryProposal = pending.find((u) => u.field === "industry") ?? null;
      if (!industryProposal) await new Promise((res) => setTimeout(res, 5000));
    }
    if (!industryProposal) {
      console.log(`NO industry proposal for ${a.name} (agent output unmappable?) — leaving as-is`);
      failures++;
      continue;
    }
    console.log(`  industry proposal:`, JSON.stringify(industryProposal.proposedValue ?? industryProposal.value ?? industryProposal));
    const d = await fetch(
      `${base}/accounts/${a.id}/profile-updates/${industryProposal.id}/decision`,
      { method: "POST", headers: hdrs, body: JSON.stringify({ decision: "approve" }) },
    );
    if (d.status !== 200) {
      console.log(`FAIL decision ${d.status}`, await d.text());
      failures++;
      continue;
    }
    const [after] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, a.id));
    console.log(`  APPROVED → industry_code=${after?.industryCode} sub=${after?.subIndustryCode}`);
    if (!after?.industryCode || !valid.has(after.industryCode)) {
      console.log(`FAIL post-approve validity check for ${a.name}`);
      failures++;
    }
  }

  console.log(`\nDONE. failures=${failures}`);
  server.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
