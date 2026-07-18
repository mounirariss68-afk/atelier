/**
 * Task #51 — Me-lens self-service profile regression probe.
 *
 * Runs standalone (tsx ./tests/me-profile/run.ts) booting the app
 * in-process via app.listen(0) — the CRM harness pattern; NODE_ENV=test
 * enables the persona-cookie bypass so requests act as ephemeral
 * p_test_* personas. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. PATCH /me/profile — whitelist edits land on the employee row,
 *      contractor edits land on the contractor row, unknown/sensitive
 *      fields are rejected (400 strict), edits are audited
 *   2. Documents CRUD — metadata-only create (no file), self-scope 404
 *      for a foreign doc id, PATCH details, soft delete
 *   3. Dependents CRUD + cascade: deleting a dependent soft-deletes its
 *      linked documents; foreign ids 404
 *   4. Emergency contacts CRUD; foreign ids 404
 *   5. HR parity: GET /roster/people/:id/personal 200 for hr, 403 for
 *      consultant (non-owner, non-personnel-contract)
 *   6. Employee-persona boundary still blocks org-wide routes but allows
 *      /people-photos/*
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_hr_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`;
const EMP2_ID = `p_test_emp2_${STAMP}`;
const CT_ID = `p_test_ct_${STAMP}`;
const CONSULTANT_ID = `p_test_cons_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierPersonDocuments,
    atelierDependents,
    atelierEmergencyContacts,
    atelierAuditEvents,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const EMP_ROW = `emp_test_${STAMP}`;
  const EMP2_ROW = `emp_test2_${STAMP}`;
  const CT_ROW = `ct_test_${STAMP}`;

  try {
    // --- ephemeral personas + roster rows ---
    const personas = [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "Test HR" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "Test Employee" },
      { id: EMP2_ID, role: "employee", roleLabel: "Employee", name: "Other Employee" },
      { id: CT_ID, role: "contractor", roleLabel: "Contractor", name: "Test Contractor" },
      { id: CONSULTANT_ID, role: "consultant", roleLabel: "Consultant", name: "Test Consultant" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "TT",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values({
      id: EMP_ROW,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "Test Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierEmployees).values({
      id: EMP2_ROW,
      orgId: ORG,
      userId: EMP2_ID,
      fullName: "Other Employee",
      email: `${EMP2_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierContractors).values({
      id: CT_ROW,
      orgId: ORG,
      fullName: "Test Contractor",
      email: `${CT_ID}@cognirise.ai`,
    });

    // =====================================================================
    group("profile \u00b7 self-edit whitelist");
    // =====================================================================
    const patch = await call("PATCH", "/me/profile", EMP_ID, {
      preferredName: "Tee",
      personalEmail: "tee@example.com",
      cellPhones: [{ country: "+971", number: "50 111 2222" }],
      homeAddress: "Villa 1, Palm Jumeirah, Dubai",
      bio: "Analyst focused on ops transformation.",
    });
    check(
      "PATCH /me/profile updates own employee row",
      patch.status === 200 &&
        patch.body?.person?.personalEmail === "tee@example.com" &&
        patch.body?.person?.preferredName === "Tee" &&
        patch.body?.person?.cellPhones?.[0]?.number === "50 111 2222",
      `status=${patch.status} body=${JSON.stringify(patch.body)}`,
    );
    const [empRow] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, EMP_ROW));
    check("edit persisted to DB", empRow?.personalEmail === "tee@example.com");

    const sensitive = await call("PATCH", "/me/profile", EMP_ID, {
      baseCompensation: 999999,
    });
    check(
      "sensitive field (baseCompensation) rejected with 400",
      sensitive.status === 400,
      `status=${sensitive.status}`,
    );
    const iban = await call("PATCH", "/me/profile", EMP_ID, { iban: "AE1234" });
    check("banking field (iban) rejected with 400", iban.status === 400);

    const ctPatch = await call("PATCH", "/me/profile", CT_ID, {
      bio: "Contractor bio",
      officeAddress: "DIFC, Dubai",
    });
    check(
      "contractor PATCH /me/profile lands on contractor row",
      ctPatch.status === 200 && ctPatch.body?.person?.bio === "Contractor bio",
      `status=${ctPatch.status}`,
    );

    const [auditRow] = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.action, "person.profile.self_updated"),
          eq(atelierAuditEvents.entityId, EMP_ROW),
        ),
      );
    check("profile edit is audited", !!auditRow);

    // =====================================================================
    group("documents \u00b7 self-scope CRUD");
    // =====================================================================
    // Metadata-only create goes through JSON-less multipart normally; the
    // route accepts urlencoded/no-file too via multer. Use form-data.
    const fd = new FormData();
    fd.append("kind", "passport");
    fd.append("title", "UAE Passport");
    fd.append("docNumber", "P1234567");
    fd.append("expiresAt", "2027-03-01");
    fd.append("issuingCountry", "AE");
    const upResp = await fetch(`${API}/me/documents`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${EMP_ID}` },
      body: fd,
    });
    const upBody = await upResp.json().catch(() => null);
    const docId = upBody?.document?.id;
    check(
      "POST /me/documents creates doc with expiry surfaced",
      upResp.status === 201 && typeof upBody?.document?.daysToExpiry === "number",
      `status=${upResp.status} body=${JSON.stringify(upBody)}`,
    );

    const list = await call("GET", "/me/documents", EMP_ID);
    check(
      "GET /me/documents lists own doc",
      list.status === 200 && list.body?.documents?.some((d: any) => d.id === docId),
    );
    const otherList = await call("GET", "/me/documents", EMP2_ID);
    check(
      "other employee does NOT see the doc",
      otherList.status === 200 && !otherList.body?.documents?.some((d: any) => d.id === docId),
    );
    const foreignPatch = await call("PATCH", `/me/documents/${docId}`, EMP2_ID, {
      title: "hijack",
    });
    check("foreign doc PATCH 404s (no leak)", foreignPatch.status === 404);
    const foreignDl = await fetch(`${API}/me/documents/${docId}/download`, {
      headers: { cookie: `atelier_persona=${EMP2_ID}` },
    });
    check("foreign doc download 404s", foreignDl.status === 404);

    const docPatch = await call("PATCH", `/me/documents/${docId}`, EMP_ID, {
      docNumber: "P7654321",
    });
    check(
      "own doc PATCH updates details",
      docPatch.status === 200 && docPatch.body?.document?.docNumber === "P7654321",
    );

    // Scan replace — attach a scan to the metadata-only doc, then verify
    // self-scope on the replace route too.
    const scanFd = new FormData();
    scanFd.append(
      "file",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "scan.pdf", {
        type: "application/pdf",
      }),
    );
    const replResp = await fetch(`${API}/me/documents/${docId}/file`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${EMP_ID}` },
      body: scanFd,
    });
    const replBody = await replResp.json().catch(() => null);
    check(
      "POST /me/documents/:id/file attaches/replaces scan",
      replResp.status === 200 && replBody?.document?.hasFile === true,
      `status=${replResp.status} body=${JSON.stringify(replBody)}`,
    );
    const foreignFd = new FormData();
    foreignFd.append(
      "file",
      new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }),
    );
    const foreignRepl = await fetch(`${API}/me/documents/${docId}/file`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${EMP2_ID}` },
      body: foreignFd,
    });
    check("foreign scan replace 404s", foreignRepl.status === 404, `status=${foreignRepl.status}`);
    await foreignRepl.json().catch(() => null);
    const docDel = await call("DELETE", `/me/documents/${docId}`, EMP_ID);
    const listAfter = await call("GET", "/me/documents", EMP_ID);
    check(
      "own doc DELETE soft-deletes",
      docDel.status === 200 &&
        !listAfter.body?.documents?.some((d: any) => d.id === docId),
    );

    // =====================================================================
    group("dependents \u00b7 CRUD + doc cascade");
    // =====================================================================
    const depCreate = await call("POST", "/me/dependents", EMP_ID, {
      fullName: "Junior Test",
      relationship: "child",
      dateOfBirth: "2020-05-01",
    });
    const depId = depCreate.body?.dependent?.id;
    check("POST /me/dependents 201", depCreate.status === 201 && !!depId);

    const fd2 = new FormData();
    fd2.append("kind", "dependent_doc");
    fd2.append("title", "Junior passport");
    fd2.append("dependentId", depId);
    const depDocResp = await fetch(`${API}/me/documents`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${EMP_ID}` },
      body: fd2,
    });
    const depDocBody = await depDocResp.json().catch(() => null);
    const depDocId = depDocBody?.document?.id;
    check("dependent-linked doc created", depDocResp.status === 201 && !!depDocId);

    const foreignDep = await call("PATCH", `/me/dependents/${depId}`, EMP2_ID, {
      fullName: "Hijack",
    });
    check("foreign dependent PATCH 404s", foreignDep.status === 404);

    const depDel = await call("DELETE", `/me/dependents/${depId}`, EMP_ID);
    const docsAfterDep = await call("GET", "/me/documents", EMP_ID);
    check(
      "dependent DELETE cascades to its documents",
      depDel.status === 200 &&
        !docsAfterDep.body?.documents?.some((d: any) => d.id === depDocId),
    );

    // =====================================================================
    group("emergency contacts \u00b7 CRUD");
    // =====================================================================
    const ecCreate = await call("POST", "/me/emergency-contacts", EMP_ID, {
      name: "Pat Test",
      relationship: "spouse",
      phones: ["+971 50 999 8888"],
    });
    const ecId = ecCreate.body?.contact?.id;
    check("POST /me/emergency-contacts 201", ecCreate.status === 201 && !!ecId);
    const ecForeign = await call("DELETE", `/me/emergency-contacts/${ecId}`, EMP2_ID);
    check("foreign emergency-contact DELETE 404s", ecForeign.status === 404);
    const ecPatch = await call("PATCH", `/me/emergency-contacts/${ecId}`, EMP_ID, {
      phones: ["+971 50 000 0000"],
    });
    check(
      "own emergency-contact PATCH 200",
      ecPatch.status === 200 && ecPatch.body?.contact?.phones?.[0] === "+971 50 000 0000",
    );

    // =====================================================================
    group("HR parity \u00b7 /roster/people/:id/personal");
    // =====================================================================
    const hrView = await call("GET", `/roster/people/${EMP_ROW}/personal`, HR_ID);
    check(
      "hr sees personal view (contacts + dependents + fields)",
      hrView.status === 200 &&
        hrView.body?.person?.personalEmail === "tee@example.com" &&
        Array.isArray(hrView.body?.emergencyContacts) &&
        hrView.body.emergencyContacts.some((c: any) => c.id === ecId),
      `status=${hrView.status} body=${JSON.stringify(hrView.body)}`,
    );
    const consView = await call(
      "GET",
      `/roster/people/${EMP_ROW}/personal`,
      CONSULTANT_ID,
    );
    check("consultant (non-owner) gets 403", consView.status === 403);

    // =====================================================================
    group("boundary \u00b7 employee persona");
    // =====================================================================
    const blocked = await call("GET", "/accounts", EMP_ID);
    check("employee still blocked from org-wide routes", blocked.status === 403);
    const photo = await fetch(`${API}/people-photos/employee/${EMP_ROW}`, {
      headers: { cookie: `atelier_persona=${EMP_ID}` },
    });
    check(
      "employee may reach /people-photos/* (404 no-photo, not 403)",
      photo.status === 404,
      `status=${photo.status}`,
    );
  } finally {
    // --- cleanup (children first) ---
    try {
      await db
        .delete(atelierPersonDocuments)
        .where(like(atelierPersonDocuments.personId, `%_test_%${STAMP}%`));
      await db
        .delete(atelierPersonDocuments)
        .where(eq(atelierPersonDocuments.personId, EMP_ROW));
      await db
        .delete(atelierPersonDocuments)
        .where(eq(atelierPersonDocuments.personId, CT_ROW));
      await db.delete(atelierDependents).where(eq(atelierDependents.personId, EMP_ROW));
      await db
        .delete(atelierEmergencyContacts)
        .where(eq(atelierEmergencyContacts.personId, EMP_ROW));
      await db
        .delete(atelierAuditEvents)
        .where(like(atelierAuditEvents.actorId, `p_test_%${STAMP}`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP_ROW));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP2_ROW));
      await db.delete(atelierContractors).where(eq(atelierContractors.id, CT_ROW));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_%${STAMP}`));
    } catch (e) {
      console.error("cleanup error:", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} failure(s):\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\n\u2713 all me-profile checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
