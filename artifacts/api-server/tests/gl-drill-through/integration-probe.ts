/**
 * Task #1082 — GL drill-through target-lookup integration probe (scratch DB).
 *
 * Covers the two gaps the URL-contract unit test cannot see:
 *   1. A `journaled` bank transaction is NOT in the default triage queue,
 *      but the targeted lookup (GET /wallet/cash/triage/:id) still returns
 *      it — so the cash deep-link lands on the exact transaction even after
 *      it was resolved. Unknown ids → 404 (missing notice).
 *   2. A revrec posting line from a period OUTSIDE the 50-most-recent
 *      postings window resolves via GET /revrec/posting-lines/:id to its
 *      period + schedule row. Unknown / soft-deleted lines → 404.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/gl-drill-through/integration-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierBankTransaction,
    atelierRevenuePeriodPosting, atelierRevenuePeriodPostingLine,
  } = D as any;
  const { inArray, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe1082_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: `atelier_persona=${fpId}` },
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { status: res.status, body };
  };

  const txnId = `btxn_${runTag}_journaled`;
  const oldPostingId = `rpp_${runTag}_old`;
  const oldLineId = `rppl_${runTag}_old`;
  const adjLineId = `rppl_${runTag}_adj`;

  try {
    await db.insert(atelierUsers).values({
      id: fpId, orgId: "aico", name: "Probe1082 Partner", initials: "PP",
      email: `${runTag}_fp@example.test`, role: "founding_partner",
      roleLabel: "Founding Partner", title: "Founding Partner",
    } as any);

    // ── 1. journaled bank transaction ─────────────────────────
    await db.insert(atelierBankTransaction).values({
      id: txnId, orgId: "aico", bankAccountId: `bacct_${runTag}`,
      statementImportId: `simp_${runTag}`, postedDate: "2026-06-01",
      amount: -1234.56, currency: "USD", kind: "payment",
      counterpartyNameRaw: "Probe1082 Vendor", matchedState: "journaled",
    } as any);

    const queue = await api("/wallet/cash/triage");
    check("default triage queue excludes journaled txn",
      queue.status === 200 && !(queue.body?.data?.rows ?? []).some((t: any) => t.id === txnId),
      { status: queue.status });

    const hit = await api(`/wallet/cash/triage/${txnId}`);
    check("targeted lookup returns the journaled txn",
      hit.status === 200 && hit.body?.data?.txn?.id === txnId && hit.body.data.txn.matchedState === "journaled",
      hit);

    const miss = await api(`/wallet/cash/triage/btxn_${runTag}_nope`);
    check("targeted txn lookup 404s on unknown id", miss.status === 404, miss);

    // ── 2. old revrec posting line beyond the 50-posting window ──
    // 55 newer postings push the old one out of GET /revrec/period-postings.
    const newer = Array.from({ length: 55 }, (_, i) => ({
      id: `rpp_${runTag}_n${i}`, orgId: "aico",
      periodLabel: `2030-${String((i % 12) + 1).padStart(2, "0")}x${Math.floor(i / 12)}`,
      rationaleText: "probe filler",
    }));
    await db.insert(atelierRevenuePeriodPosting).values(newer as any);
    await db.insert(atelierRevenuePeriodPosting).values({
      id: oldPostingId, orgId: "aico", periodLabel: "2020-01", rationaleText: "probe old",
    } as any);
    await db.insert(atelierRevenuePeriodPostingLine).values([
      { id: oldLineId, orgId: "aico", postingId: oldPostingId, engagementId: `eng_${runTag}`,
        scheduleId: `rsch_${runTag}`, method: "straight_line", recognisedAmount: 100 },
      { id: adjLineId, orgId: "aico", postingId: oldPostingId, engagementId: `eng_${runTag}`,
        scheduleId: null, kind: "adjustment", method: "straight_line", recognisedAmount: -10 },
    ] as any);

    const list = await api("/revrec/period-postings");
    check("old posting is outside the 50-posting list window",
      list.status === 200 && !(list.body?.postings ?? []).some((p: any) => p.id === oldPostingId),
      { status: list.status, count: list.body?.postings?.length });

    const line = await api(`/revrec/posting-lines/${oldLineId}`);
    check("old-period line resolves to period + schedule",
      line.status === 200 && line.body?.line?.periodLabel === "2020-01" && line.body?.line?.scheduleId === `rsch_${runTag}`,
      line);

    const adj = await api(`/revrec/posting-lines/${adjLineId}`);
    check("adjustment line resolves with null scheduleId (client shows missing notice)",
      adj.status === 200 && adj.body?.line?.scheduleId === null, adj);

    const lineMiss = await api(`/revrec/posting-lines/rppl_${runTag}_nope`);
    check("unknown posting line 404s", lineMiss.status === 404, lineMiss);
  } finally {
    await db.delete(atelierRevenuePeriodPostingLine).where(inArray(atelierRevenuePeriodPostingLine.id, [oldLineId, adjLineId]));
    await db.delete(atelierRevenuePeriodPosting).where(like(atelierRevenuePeriodPosting.id, `rpp_${runTag}_%`));
    await db.delete(atelierBankTransaction).where(inArray(atelierBankTransaction.id, [txnId]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId]));
    server.close();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nAll gl-drill-through integration checks passed.");
}

void main().catch((err) => { console.error(err); process.exit(1); });