/**
 * Task #722 — one-off Procurement Navigator backfill for existing accounts.
 *
 * For every ACTIVE account that has no approved procurement guide yet, this
 * triggers the governed async run route (founding-partner persona), waits
 * for the background research to finish, and leaves the result as a PENDING
 * REVIEW draft in the account's Procurement tab (propose-then-approve — the
 * backfill never auto-applies research to the account record).
 *
 * Safe to re-run: accounts with an approved guide or an undecided pending
 * draft are skipped. Per-account error isolation + a courtesy delay between
 * runs (live Perplexity + Anthropic calls).
 *
 * NOTE (task-branch reality): DB data from task branches never merges — this
 * must be (re)run on main, and again for production after Publish.
 *
 * Run: pnpm exec tsx scripts/t722-procurement-backfill.ts
 */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss"; // founding partner
const DELAY_BETWEEN_ACCOUNTS_MS = 15_000;
const RUN_TIMEOUT_MS = 12 * 60 * 1000;

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const { db, atelierAccounts } = await import("@workspace/db");
  const { isNull } = await import("drizzle-orm");

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  const status = async (id: string) => {
    const r = await fetch(`${base}/accounts/${id}/agents/procurement-navigator/status`, {
      headers: hdrs,
    });
    return r.ok ? ((await r.json()) as any) : null;
  };

  const rows = await db
    .select()
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  const active = rows.filter((a: any) => (a.status ?? "active") === "active");
  console.log(`Active accounts: ${active.length}`);

  let failures = 0;
  let skipped = 0;
  let drafted = 0;
  for (const a of active) {
    try {
      const p = a.procurement as any;
      if (p?.guide) {
        console.log(`SKIP ${a.name} — already has an approved guide`);
        skipped++;
        continue;
      }
      const pre = await status(a.id);
      if (pre?.status === "drafted") {
        console.log(`SKIP ${a.name} — undecided draft already pending review`);
        skipped++;
        continue;
      }
      console.log(`\n=== ${a.name} (${a.id}) — starting Procurement Navigator…`);
      const r = await fetch(`${base}/accounts/${a.id}/agents/procurement-navigator/run`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({}),
      });
      if (r.status !== 202) {
        console.log(`FAIL start ${r.status}`, await r.text());
        failures++;
        continue;
      }
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      let s: any = null;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 10_000));
        s = await status(a.id);
        if (s && s.status !== "running") break;
        process.stdout.write(`  … ${s?.phase ?? "running"} ${s?.progressPct ?? ""}%\n`);
      }
      if (s?.status === "drafted") {
        const g = s.draft?.guide;
        console.log(
          `  DRAFTED → jurisdiction=${g?.jurisdiction} channel=${g?.channel?.name} sources=${g?.sources?.length} steps=${g?.steps?.length} (pending partner review)`,
        );
        drafted++;
      } else {
        console.log(`FAIL ${a.name} — final status=${s?.status} ${s?.phase ?? ""}`);
        failures++;
      }
    } catch (err) {
      console.log(`FAIL ${a.name} —`, err instanceof Error ? err.message : err);
      failures++;
    }
    await new Promise((res) => setTimeout(res, DELAY_BETWEEN_ACCOUNTS_MS));
  }

  console.log(`\nDONE. drafted=${drafted} skipped=${skipped} failures=${failures}`);
  server.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
