/** Task #538 probe — invitation flow with structured names (self-cleaning). */
process.env.NODE_ENV = "test";
const STAMP = Date.now();
const EMAIL = `p538probe_${STAMP}@example.com`;
const CAND_ID = `cand_t538_${STAMP}`;

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const D: any = await import("@workspace/db");
  const { db, pool, atelierInvitations, atelierStudioCandidates, atelierEmployees, atelierPersons, atelierUsers, atelierAuthCredentials } = D;
  const { eq } = await import("drizzle-orm");
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=p_mounir_ariss`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  let invId: string | null = null;
  try {
    await db.insert(atelierStudioCandidates).values({
      id: CAND_ID, orgId: "aico", name: `Probe Q. TestFivethreeeight${STAMP}`,
      email: EMAIL, roleTitle: "Consultant", stage: "hired", activeOrPassive: "active",
    });

    // 1. create invitation with structured name
    let r = await fetch(`${base}/roster/invitations`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({
        workerType: "employee",
        honorific: "Dr.",
        firstName: "Probe",
        middleName: "Q.",
        lastName: `TestFivethreeeight${STAMP}`,
        preferredName: "Probey",
        email: EMAIL,
        role: "consultant",
        seniority: "consultant",
        sourceKind: "hired_candidate",
        sourceId: CAND_ID,
      }),
    });
    let j: any = await r.json();
    invId = j.invitation?.id ?? j.id ?? null;
    check("invitation created ok", (r.status === 200 || r.status === 201) && j.ok === true && Boolean(invId), { s: r.status, j });
    const [invRow] = await db.select().from(atelierInvitations).where(eq(atelierInvitations.id, invId));
    const draft = invRow?.personDraft;
    check("personDraft has structured fields", draft?.firstName === "Probe" && draft?.lastName === `TestFivethreeeight${STAMP}` && draft?.honorific === "Dr." && draft?.preferredName === "Probey", draft);
    check("personDraft fullName composed", typeof draft?.fullName === "string" && draft.fullName.includes("Probe") && draft.fullName.includes(`TestFivethreeeight${STAMP}`), draft?.fullName);

    // 2. missing lastName -> 400
    r = await fetch(`${base}/roster/invitations`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ workerType: "employee", firstName: "OnlyFirst", email: `x${STAMP}@example.com`, sourceKind: "hired_candidate", sourceId: CAND_ID }),
    });
    check("missing lastName rejected 400", r.status === 400, { s: r.status });

    // 3. accept invitation
    r = await fetch(`${base}/roster/invitations/${invId}/accept`, { method: "POST", headers: hdrs, body: "{}" });
    j = await r.json();
    check("accept ok", r.status === 200 || r.status === 201, { s: r.status, j });

    // 4. verify employee + person rows
    const [emp] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.email, EMAIL));
    check("employee row created", Boolean(emp));
    if (emp) {
      check("employee fullName from personWrite", emp.fullName.includes(`TestFivethreeeight${STAMP}`), emp.fullName);
      check("employee preferredName", emp.preferredName === "Probey", emp.preferredName);
      check("employee linked to person", Boolean(emp.personId), emp.personId);
      if (emp.personId) {
        const [p] = await db.select().from(atelierPersons).where(eq(atelierPersons.id, emp.personId));
        check("person structured stored", p?.firstName === "Probe" && p?.lastName === `TestFivethreeeight${STAMP}` && p?.honorific === "Dr." && p?.middleName === "Q." && p?.preferredName === "Probey", p);
        check("person displayName recomputed", typeof p?.displayName === "string" && p.displayName.includes("Probe"), p?.displayName);
      }
    }
  } finally {
    try {
      const { like } = await import("drizzle-orm");
      const [emp] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.email, EMAIL));
      if (emp) {
        if (emp.userId) {
          await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.userId, emp.userId));
          await db.delete(atelierUsers).where(eq(atelierUsers.id, emp.userId));
        }
        await db.delete(atelierEmployees).where(eq(atelierEmployees.id, emp.id));
        if (emp.personId) await db.delete(atelierPersons).where(eq(atelierPersons.id, emp.personId));
      }
      if (invId) await db.delete(atelierInvitations).where(eq(atelierInvitations.id, invId));
      await db.delete(atelierStudioCandidates).where(eq(atelierStudioCandidates.id, CAND_ID));
    } catch (e) {
      console.log("cleanup error", e);
    }
    server.close();
    await pool.end();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
