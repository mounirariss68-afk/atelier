/** Task #660 probe — payroll linkage edit surface (self-cleaning). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const { db, atelierUsers, atelierEmployees, atelierContractors, atelierLegalEntities, atelierAuditEvents } = await import("@workspace/db");
  const { eq, like, and, isNull } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  const empId = "emp___t660probe";
  const ctId = "ct___t660probe";
  const restrictedId = "p_test___t660";
  try {
    const [me] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PERSONA));
    if (!me) throw new Error("persona not found");
    const [ent] = await db.select().from(atelierLegalEntities)
      .where(and(eq(atelierLegalEntities.orgId, me.orgId), eq(atelierLegalEntities.status, "active")));
    if (!ent) throw new Error("no active legal entity");

    await db.insert(atelierEmployees).values({
      id: empId, orgId: me.orgId, fullName: "Probe Payroll", email: "probe.t660@cognirise.ai",
      role: "consultant", seniority: "consultant", title: "Probe", status: "active",
      employmentStatus: "active", startDate: "2025-01-01", nationality: "AE",
    } as any);
    await db.insert(atelierContractors).values({
      id: ctId, orgId: me.orgId, fullName: "Probe Contractor", email: "probe.ct660@cognirise.ai",
      status: "active",
    } as any);
    await db.insert(atelierUsers).values({
      id: restrictedId, orgId: me.orgId, role: "employee", name: "Probe Restricted",
      email: "probe.rest660@cognirise.ai", initials: "PR", roleLabel: "Employee", title: "Probe",
    } as any);

    // 1. entity list
    const el = await fetch(`${base}/roster/legal-entities`, { headers: hdrs });
    const elj = await el.json();
    check("legal-entities 200 with entity", el.status === 200 && (elj.entities ?? []).some((e: any) => e.id === ent.id), elj);

    // 2. restricted persona 403
    const rh = { cookie: `atelier_persona=${restrictedId}`, "content-type": "application/json" };
    const r403 = await fetch(`${base}/roster/people/${empId}/payroll`, { method: "PATCH", headers: rh, body: JSON.stringify({ baseCompensation: 1 }) });
    check("restricted persona payroll PATCH 403", r403.status === 403, r403.status);
    const r403b = await fetch(`${base}/roster/legal-entities`, { headers: rh });
    check("restricted persona entities 403", r403b.status === 403, r403b.status);

    // 3. general PATCH rejects payroll fields
    const gen = await fetch(`${base}/roster/people/${empId}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ legalEntityId: ent.id }) });
    const genj = await gen.json();
    check("general PATCH locks legalEntityId", gen.status === 422 && genj.error === "field-locked", genj);

    // 4. payroll PATCH happy path
    const p1 = await fetch(`${base}/roster/people/${empId}/payroll`, {
      method: "PATCH", headers: hdrs,
      body: JSON.stringify({ legalEntityId: ent.id, baseCompensation: 240000, baseCurrency: "aed", basicWageMonthly: 12000, housingAllowanceMonthly: 4000, schemeRegisteredOn: "2025-02-01" }),
    });
    const p1j = await p1.json();
    check("payroll PATCH 200", p1.status === 200, p1j);
    check("wire echoes payroll fields", p1j.person?.legalEntityId === ent.id && p1j.person?.baseCompensation === 240000 && p1j.person?.baseCurrency === "AED" && p1j.person?.basicWageMonthly === 12000 && p1j.person?.housingAllowanceMonthly === 4000 && p1j.person?.schemeRegisteredOn === "2025-02-01", p1j.person);
    check("employingEntity mirror synced", p1j.person?.employingEntity === (ent.shortName || ent.legalNameEn), p1j.person?.employingEntity);
    const auds = await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, empId), eq(atelierAuditEvents.action, "roster.person.updated")));
    check("audit row with payroll changes", auds.length === 1 && (auds[0].payload as any)?.change === "payroll" && (auds[0].payload as any)?.changes?.length >= 5, auds.map(a => a.payload));

    // 5. idempotent no-op
    const p2 = await fetch(`${base}/roster/people/${empId}/payroll`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ baseCompensation: 240000 }) });
    const p2j = await p2.json();
    check("no-op returns changes []", p2.status === 200 && Array.isArray(p2j.changes) && p2j.changes.length === 0, p2j.changes);

    // 6. bad entity
    const p3 = await fetch(`${base}/roster/people/${empId}/payroll`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ legalEntityId: "lent_nope" }) });
    check("unknown entity 422", p3.status === 422 && (await p3.json()).error === "legal-entity-not-found");

    // 7. contractor rejected
    const p4 = await fetch(`${base}/roster/people/${ctId}/payroll`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ baseCompensation: 1000 }) });
    check("contractor 422 employee-only", p4.status === 422 && (await p4.json()).error === "employee-only");

    // 8. payroll run for the entity computes with ZERO validation errors
    // (relies on the data pass having filled every other active employee).
    const run = await fetch(`${base}/finance/payroll/runs`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: ent.id, periodLabel: "2026-07" }) });
    const runj = await run.json();
    const verrs = (runj.run?.validationErrors ?? []) as any[];
    check("payroll run 201 zero validation errors", run.status === 201 && verrs.length === 0, verrs);
    check("probe employee has a payroll line", (runj.lines ?? []).some((l: any) => l.employeeId === empId), (runj.lines ?? []).map((l: any) => l.employeeId));
    if (runj.run?.id) {
      await fetch(`${base}/finance/payroll/runs/${runj.run.id}`, { headers: hdrs }); // shape sanity only
      const { atelierPayrollRuns, atelierPayrollLines } = await import("@workspace/db");
      await db.delete(atelierPayrollLines).where(eq(atelierPayrollLines.runId, runj.run.id));
      await db.delete(atelierPayrollRuns).where(eq(atelierPayrollRuns.id, runj.run.id));
    }
  } finally {
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, "%__t660%"));
    await db.delete(atelierEmployees).where(like(atelierEmployees.id, "%__t660%"));
    await db.delete(atelierContractors).where(like(atelierContractors.id, "%__t660%"));
    await db.delete(atelierUsers).where(like(atelierUsers.id, "%__t660%"));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
