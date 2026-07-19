/** Task #272 probe — per-entity cash policy feeds the 13-week forecast (self-cleaning). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const { db, atelierLegalEntities, atelierAuditEvents } = await import("@workspace/db");
  const { eq, like } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  let created: string[] = [];
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  try {
    // 1) create entity WITH a cash policy (huge min-cash so a breach must fire)
    const r1 = await fetch(`${base}/finance/entities`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({
        legalNameEn: "__T272 CashPolicy LLC", shortName: "T272", country: "AE", baseCurrency: "USD",
        cashPolicy: { openingBalance: 250000, openingBalanceAsOf: "2026-07-01", minCashPolicy: 10000000, covenantFloor: 5000000, notes: "probe" },
      }),
    });
    const j1 = await r1.json();
    check("create 201 with cashPolicy echoed", r1.status === 201 && j1.entity?.cashPolicy?.openingBalance === 250000 && j1.entity.cashPolicy.minCashPolicy === 10000000 && j1.entity.cashPolicy.covenantFloor === 5000000, j1);
    created.push(j1.entity.id);

    // 2) GET round-trips the policy
    const g = await fetch(`${base}/finance/entities/${j1.entity.id}`, { headers: hdrs }).then(r => r.json());
    check("GET returns cashPolicy", g.entity?.cashPolicy?.openingBalanceAsOf === "2026-07-01", g.entity?.cashPolicy);

    // 3) forecast reflects the policy: minCashLine >= 10M USD, covenantLine set, breaches fire
    const f = await fetch(`${base}/finance/plan/cash-13w`, { headers: hdrs });
    const fj = await f.json();
    check("cash-13w 200", f.status === 200, fj);
    const fc = fj.forecast ?? fj;
    check("minCashLine includes entity policy (>=10M)", (fc.minCashLine ?? 0) >= 10_000_000, { minCashLine: fc.minCashLine });
    check("covenantLine present (>=5M)", fc.covenantLine != null && fc.covenantLine >= 5_000_000, { covenantLine: fc.covenantLine });
    check("openingBalance includes 250k", (fc.openingBalance ?? 0) !== 0, { openingBalance: fc.openingBalance });
    const brs = fc.breaches ?? [];
    check("min_cash breach fires", brs.some((b: any) => b.kind === "min_cash"), brs.slice(0, 3));
    check("covenant breach fires", brs.some((b: any) => b.kind === "covenant"), brs.slice(0, 3));
    const wk = (fc.weeks ?? [])[0];
    check("week flags belowMinCash", wk?.belowMinCash === true, wk);

    // 4) PATCH policy to null clears it and warnings drop
    const p = await fetch(`${base}/finance/entities/${j1.entity.id}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ cashPolicy: null }) });
    const pj = await p.json();
    check("PATCH null clears cashPolicy", p.status === 200 && pj.entity.cashPolicy === null, pj.entity?.cashPolicy);
    const f2 = await fetch(`${base}/finance/plan/cash-13w`, { headers: hdrs }).then(r => r.json());
    const fc2 = f2.forecast ?? f2;
    check("cleared policy removes this entity's floors", (fc2.minCashLine ?? 0) < 10_000_000, { minCashLine: fc2.minCashLine });

    // 5) invalid policy rejected
    const bad = await fetch(`${base}/finance/entities/${j1.entity.id}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ cashPolicy: { minCashPolicy: -5 } }) });
    check("negative minCash rejected 400", bad.status === 400);
  } finally {
    for (const id of created) {
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, id));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, id));
    }
    await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.legalNameEn, "__T272%"));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROBE_ERR", e); process.exit(1); });
