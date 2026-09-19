/** Task #1342 — relationship classifications, stable-ID mappings and gates. */
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";

const stamp = Date.now(), org = "aico";
const HR = `p_test_1342_hr_${stamp}`, VIEWER = `p_test_1342_viewer_${stamp}`;
const PEOPLE = ["opaque-a", "opaque-b", "opaque-c", "opaque-d", "opaque-e"].map((x) => `${x}_${stamp}`);
const EMPLOYEES = PEOPLE.map((x) => `emp_${x}`);
const KEYS = ["equity-key-red", "legacy-equity-42", "arbitrary-id-7", "uuid-no-name"];
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`); else { failures.push(name); console.error(`  ✗ ${name}`, detail ?? ""); }
};

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierPersons, atelierEmployees, atelierAdminPersonMappings, atelierPersonRelationshipClassifications, atelierAuditEvents } = D as any;
  const app = (await import("../../src/app.js")).default, server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo, API = `http://127.0.0.1:${port}/api/atelier`;
  async function call(method: string, path: string, persona: string, body?: unknown) {
    const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  }
  try {
    await db.insert(atelierUsers).values([
      { id: HR, orgId: org, email: `${HR}@test`, name: "HR Admin", initials: "HR", role: "hr", roleLabel: "HR", title: "HR" },
      { id: VIEWER, orgId: org, email: `${VIEWER}@test`, name: "Ordinary Viewer", initials: "OV", role: "consultant", roleLabel: "Consultant", title: "Consultant" },
    ]);
    await db.insert(atelierPersons).values(PEOPLE.map((id, i) => ({ id, orgId: org, firstName: `Arbitrary${i}`, lastName: `Record${i}`, displayName: `Unrelated display ${i}`, sourceKind: "migration" })));
    await db.insert(atelierEmployees).values(PEOPLE.map((personId, i) => ({ id: EMPLOYEES[i], orgId: org, userId: i === 0 ? VIEWER : null, personId, fullName: `Unrelated display ${i}`, email: `${EMPLOYEES[i]}@test`, role: "employee", title: "Analyst" })));

    check("ordinary viewer cannot edit classification", (await call("PATCH", `/roster/people/${PEOPLE[0]}/classification`, VIEWER, { relationshipType: "employee" })).status === 403);
    check("ordinary viewer cannot edit own classification", (await call("PATCH", `/roster/people/${EMPLOYEES[0]}/classification`, VIEWER, { relationshipType: "employee" })).status === 403);
    const types = ["employee", "contractor", "equity_partner", "non_equity_partner", "partner_firm_resource"];
    for (let i = 0; i < types.length; i++) {
      const r = await call("PATCH", `/roster/people/${PEOPLE[i]}/classification`, HR, {
        relationshipType: types[i], compensationBasis: types[i] === "equity_partner" ? "salary" : "contractor_day_rate",
        status: "active", effectiveFrom: "2026-01-01",
      });
      check(`classification ${types[i]} is accepted`, r.status === 200 && r.body?.relationship?.relationshipType === types[i]);
    }
    const rows = await db.select().from(atelierPersonRelationshipClassifications).where(eq(atelierPersonRelationshipClassifications.orgId, org));
    check("all five classifications are persisted", rows.length === 5);
    const equity = rows.find((r: any) => r.personId === PEOPLE[2]);
    check("equity is forced to profit_sharing + rules_pending", equity?.compensationBasis === "profit_sharing" && equity?.status === "rules_pending");
    check("classification edit is audited", (await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.action, "roster.relationship_classification_update"), eq(atelierAuditEvents.actorId, HR)))).length >= 5);

    for (let i = 0; i < KEYS.length; i++) {
      const r = await call("PUT", `/admin/roster/mappings/${KEYS[i]}`, HR, { personId: PEOPLE[2], metadata: { label: `Not ${i}'s name` } });
      check(`opaque equity mapping ${i + 1} uses stable ID`, r.status === 201 && r.body?.mapping?.personId === PEOPLE[2]);
      const retry = await call("PUT", `/admin/roster/mappings/${KEYS[i]}`, HR, { personId: PEOPLE[2] });
      check(`mapping ${i + 1} is idempotent`, retry.status === 200 && retry.body?.idempotent === true);
      check(`mapping ${i + 1} collision is rejected`, (await call("PUT", `/admin/roster/mappings/${KEYS[i]}`, HR, { personId: PEOPLE[3] })).status === 409);
    }
    const mapped = await call("GET", "/admin/roster/mappings", HR);
    check("four arbitrary mappings are retained", mapped.status === 200 && mapped.body.items.filter((m: any) => KEYS.includes(m.stableKey)).length === 4);

    const ordinary = await call("GET", `/roster/people/${EMPLOYEES[0]}`, VIEWER);
    const own = ordinary.body?.person;
    check("ordinary roster viewer sees relationshipType", ordinary.status === 200 && own?.relationshipType === "employee");
    check("ordinary roster viewer gets no compensation basis/status", own?.compensationBasis === undefined && own?.compensationStatus === undefined);
    const hr = await call("GET", `/roster/people/${EMPLOYEES[2]}`, HR);
    check("HR sees compensation basis/status", hr.status === 200 && hr.body?.person?.compensationBasis === "profit_sharing" && hr.body?.person?.compensationStatus === "rules_pending");
    const future = await call("PATCH", `/roster/people/${PEOPLE[0]}/classification`, HR, {
      relationshipType: "equity_partner", effectiveFrom: "2030-01-01",
    });
    check("future classification can be scheduled", future.status === 200);
    const beforeFuture = await call("GET", `/roster/people/${EMPLOYEES[0]}`, HR);
    check("future classification does not apply early", beforeFuture.body?.person?.relationshipType === "employee");
    await db.update(atelierPersonRelationshipClassifications)
      .set({ effectiveTo: "2026-01-31" })
      .where(and(
        eq(atelierPersonRelationshipClassifications.personId, PEOPLE[1]),
        eq(atelierPersonRelationshipClassifications.effectiveFrom, "2026-01-01"),
      ));
    const expired = await call("GET", `/roster/people/${EMPLOYEES[1]}`, HR);
    check("expired classification is not current", expired.body?.person?.relationshipType === undefined);
    const noPayout = await call("GET", "/finance/equity-grants", HR);
    check("no equity payout endpoint/data exists", noPayout.status === 404 || noPayout.body?.items?.every((x: any) => x.payoutEligible !== true));
  } finally {
    try {
      await db.delete(atelierPersonRelationshipClassifications).where(eq(atelierPersonRelationshipClassifications.orgId, org));
      await db.delete(atelierAdminPersonMappings).where(eq(atelierAdminPersonMappings.orgId, org));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `${HR}%`));
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, EMPLOYEES));
      await db.delete(atelierPersons).where(inArray(atelierPersons.id, PEOPLE));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [HR, VIEWER]));
    } finally { server.close(); await pool.end().catch(() => undefined); }
  }
  console.log(failures.length ? `✗ ${failures.length} failures` : "✓ governance-1342 probe passed");
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });