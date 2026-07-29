/**
 * Task #744 — employee travel loyalty & preferences probe.
 *
 * Covers:
 *   - HR PATCH /roster/people/:id with travelProfile on an EMPLOYEE → 200,
 *     field-level change entry, full membership numbers for HR (sensitive)
 *   - Same PATCH on a CONTRACTOR → 422 invalid-body (employees only)
 *   - GET /roster/people/:id as finance (full roster, NOT sensitive) →
 *     membership numbers masked; as HR → full
 *   - Self-service: employee GET/PUT /me/travel (full numbers, audited
 *     WITHOUT raw membership numbers in the payload); contractor → 403
 *   - Audit rows: roster.person.updated + person.travel.self_updated
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/roster/travel-profile-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import (rewrites DATABASE_URL
// to the isolated scratch database before @workspace/db binds).
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const PROFILE = {
  airlinePrograms: [
    { airlineIata: "ek", programName: "Emirates Skywards", membershipNumber: "EK123456789", tier: "Gold" },
    { airlineIata: "TK", programName: "Miles&Smiles", membershipNumber: "TK987654", tier: null },
  ],
  hotelPrograms: [
    { chainCode: "mc", programName: "Marriott Bonvoy", membershipNumber: "MB55501234", tier: "Titanium" },
  ],
  preferences: {
    preferredAirlines: ["EK", "Turkish Airlines"],
    preferredHotelChains: ["Marriott", "Hilton"],
    cabinClass: "business",
    seatPreference: "aisle",
    mealPreference: "vegetarian",
    departureTimeWindow: "08:00-12:00",
    arrivalTimeWindow: null,
    notes: "Avoid tight connections under 90 minutes.",
  },
};

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierContractors, atelierAuditEvents } = D;
  const { and, eq, inArray, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe744_${Date.now()}`;
  const hrId = `u_${runTag}_hr`;
  const finId = `u_${runTag}_fin`;
  const empUserId = `u_${runTag}_emp`;
  const ctrUserId = `u_${runTag}_ctr`;
  const empId = `emp_${runTag}`;
  const ctrId = `ctr_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values([
      { id: hrId, orgId: "aico", name: "P744 HR", initials: "PH", email: `${runTag}_hr@example.test`, role: "hr", roleLabel: "HR", title: "HR" },
      { id: finId, orgId: "aico", name: "P744 Fin", initials: "PF", email: `${runTag}_fin@example.test`, role: "finance", roleLabel: "Finance", title: "Finance" },
      { id: empUserId, orgId: "aico", name: "P744 Emp", initials: "PE", email: `${runTag}_emp@example.test`, role: "consultant", roleLabel: "Consultant", title: "Consultant" },
      { id: ctrUserId, orgId: "aico", name: "P744 Ctr", initials: "PC", email: `${runTag}_ctr@example.test`, role: "contractor", roleLabel: "Contractor", title: "Contractor" },
    ] as any);
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      userId: empUserId,
      fullName: "P744 Employee",
      email: `${runTag}_emp@example.test`,
      role: "consultant",
      seniority: "consultant",
    } as any);
    await db.insert(atelierContractors).values({
      id: ctrId,
      orgId: "aico",
      fullName: "P744 Contractor",
      email: `${runTag}_ctr@example.test`,
    } as any);

    // 1. HR writes an employee travel profile via the roster edit surface.
    const patch = await api(hrId, "PATCH", `/roster/people/${empId}`, { travelProfile: PROFILE });
    check("HR PATCH employee travelProfile → 200", patch.status === 200, patch);
    const tp = patch.body?.person?.travelProfile;
    check("codes normalized to upper-case (Amadeus-ready)",
      tp?.airlinePrograms?.[0]?.airlineIata === "EK" && tp?.hotelPrograms?.[0]?.chainCode === "MC", tp);
    check("change list includes travelProfile",
      Array.isArray(patch.body?.changes) && patch.body.changes.some((c: any) => c.field === "travelProfile"), patch.body?.changes);
    check("HR sees full membership number",
      tp?.airlinePrograms?.[0]?.membershipNumber === "EK123456789", tp?.airlinePrograms?.[0]);

    // 2. Non-employee rejection: contractors cannot carry travel fields.
    const ctrPatch = await api(hrId, "PATCH", `/roster/people/${ctrId}`, { travelProfile: PROFILE });
    check("PATCH contractor travelProfile → 422 invalid-body",
      ctrPatch.status === 422 && ctrPatch.body?.error === "invalid-body", ctrPatch);

    // 3. Sensitivity scoping: finance has full roster but NOT the
    //    sensitive-people gate → membership numbers masked, programs visible.
    const finGet = await api(finId, "GET", `/roster/people/${empId}`);
    const finTp = finGet.body?.person?.travelProfile;
    check("finance GET → 200 with travelProfile present", finGet.status === 200 && !!finTp, finGet.status);
    check("finance sees masked membership number",
      typeof finTp?.airlinePrograms?.[0]?.membershipNumber === "string" &&
        finTp.airlinePrograms[0].membershipNumber.includes("••••") &&
        !finTp.airlinePrograms[0].membershipNumber.includes("EK123456789"),
      finTp?.airlinePrograms?.[0]);
    check("finance still sees program name/code/tier",
      finTp?.airlinePrograms?.[0]?.programName === "Emirates Skywards" && finTp?.airlinePrograms?.[0]?.tier === "Gold", finTp);

    const hrGet = await api(hrId, "GET", `/roster/people/${empId}`);
    check("HR GET sees full membership number",
      hrGet.body?.person?.travelProfile?.airlinePrograms?.[0]?.membershipNumber === "EK123456789",
      hrGet.body?.person?.travelProfile?.airlinePrograms?.[0]);

    // 4. Roster audit row.
    const rosterAudit = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, empId), eq(atelierAuditEvents.action, "roster.person.updated")));
    check("roster.person.updated audit row written", rosterAudit.length >= 1, rosterAudit.length);

    // 5. Self-service: the employee sees + edits their own profile in full.
    const meGet = await api(empUserId, "GET", `/me/travel`);
    check("employee GET /me/travel → full numbers",
      meGet.status === 200 && meGet.body?.travelProfile?.airlinePrograms?.[0]?.membershipNumber === "EK123456789", meGet);

    const myNext = {
      ...PROFILE,
      airlinePrograms: [
        { airlineIata: "QR", programName: "Privilege Club", membershipNumber: "QR00778899", tier: "Platinum" },
      ],
    };
    const mePut = await api(empUserId, "PUT", `/me/travel`, myNext);
    check("employee PUT /me/travel → 200",
      mePut.status === 200 && mePut.body?.travelProfile?.airlinePrograms?.[0]?.airlineIata === "QR", mePut);

    const selfAudit = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, empId), eq(atelierAuditEvents.action, "person.travel.self_updated")));
    check("person.travel.self_updated audit row written", selfAudit.length === 1, selfAudit.length);
    check("self audit payload carries NO raw membership numbers",
      selfAudit.length === 1 && !JSON.stringify(selfAudit[0].payload).includes("QR00778899"), selfAudit[0]?.payload);

    // 6. Invalid shape rejected (bad IATA code).
    const badPut = await api(empUserId, "PUT", `/me/travel`, {
      airlinePrograms: [{ airlineIata: "EMIRATES", programName: "X", membershipNumber: "1" }],
    });
    check("PUT /me/travel with non-IATA code → 400", badPut.status === 400, badPut);

    // 7. Contractors are locked out of the self-service travel surface.
    const ctrGet = await api(ctrUserId, "GET", `/me/travel`);
    const ctrPut = await api(ctrUserId, "PUT", `/me/travel`, PROFILE);
    check("contractor GET /me/travel → 403",
      ctrGet.status === 403 && ctrGet.body?.error === "travel-profile-employees-only", ctrGet);
    check("contractor PUT /me/travel → 403", ctrPut.status === 403, ctrPut);
  } finally {
    // Cleanup — tracked ids + runTag sweep.
    await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [empId, ctrId]));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
    await db.delete(atelierContractors).where(eq(atelierContractors.id, ctrId));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `u_${runTag}%`));
    server.close();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("travel-profile-probe: all checks passed");
}

main().catch((err) => {
  console.error("travel-profile-probe crashed:", err);
  process.exit(1);
});
