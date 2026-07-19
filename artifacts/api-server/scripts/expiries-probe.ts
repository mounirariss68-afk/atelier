/** Task #264 probe — registry expiries endpoint (self-cleaning). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const { db, atelierLegalEntities, atelierAuditEvents } = await import("@workspace/db");
  const { eq, like } = await import("drizzle-orm");
  (app as any).use((err: any, _req: any, res: any, _next: any) => { console.error("ROUTE_ERR", err); res.status(500).json({ e: String(err) }); });
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  let created: string[] = [];
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  try {
    // create entity with expiring registration + lease inside window
    const mk = async (body: any) => {
      const r = await fetch(`${base}/finance/entities`, { method: "POST", headers: hdrs, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(j)}`);
      created.push(j.entity.id);
      return j.entity;
    };
    const e1 = await mk({
      legalNameEn: "__T264 Probe FZ-LLC", shortName: "T264", country: "AE",
      registrations: [
        { type: "trade_license", label: "DET Trade License", number: "111", issuer: "DET", expiresOn: iso(25) },
        { type: "establishment_card", label: "Establishment Card", number: "222", expiresOn: iso(80) },
        { type: "commercial_register", label: "Far Away", number: "333", expiresOn: iso(200) },
        { type: "other", label: "Old Permit", number: "444", expiresOn: iso(-10) },
      ],
      lease: { contractNo: "EJ-1", ejariTenantNo: "T-9", startDate: iso(-300), endDate: iso(60) },
    });
    const e2 = await mk({ legalNameEn: "__T264 Archived Co", shortName: "T264B", country: "AE",
      registrations: [{ type: "trade_license", label: "Lic", number: "999", expiresOn: iso(10) }] });
    await fetch(`${base}/finance/entities/${e2.id}/archive`, { method: "POST", headers: hdrs });

    const get = async (q = "") => {
      const r = await fetch(`${base}/finance/entities/expiries${q}`, { headers: hdrs });
      return { status: r.status, j: await r.json() };
    };
    const d = await get();
    check("default 200 + windowDays=90", d.status === 200 && d.j.windowDays === 90, d);
    const mine = (d.j.items as any[]).filter(x => x.entityId === e1.id);
    check("registration in 25d present (critical)", mine.some(x => x.kind === "registration" && x.daysOut >= 24 && x.severity === "critical" && x.label === "DET Trade License"));
    check("registration in 80d present (upcoming)", mine.some(x => x.label === "Establishment Card" && x.severity === "upcoming"));
    check("lease end in 60d present as Ejari lease end", mine.some(x => x.kind === "lease" && x.label === "Ejari lease end"));
    check("expired 10d ago present (overdue)", mine.some(x => x.severity === "overdue" && x.label === "Old Permit"));
    check("200d-out registration excluded", !mine.some(x => x.label === "Far Away"));
    check("archived entity excluded", !(d.j.items as any[]).some(x => x.entityId === e2.id));
    check("sorted by daysOut", (d.j.items as any[]).every((x, i, a) => i === 0 || a[i - 1].daysOut <= x.daysOut));

    const w30 = await get("?windowDays=30");
    const mine30 = (w30.j.items as any[]).filter(x => x.entityId === e1.id);
    check("windowDays=30 respected", w30.j.windowDays === 30 && mine30.some(x => x.label === "DET Trade License") && !mine30.some(x => x.label === "Establishment Card"));
    const clamp = await get("?windowDays=9999");
    check("window clamped to 365", clamp.j.windowDays === 365);

    const noauth = await fetch(`${base}/finance/entities/expiries`);
    check("unauthenticated 401", noauth.status === 401);
  } finally {
    for (const id of created) await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, id));
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.payloadSummary, "%__T264%"));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
