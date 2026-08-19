/**
 * Task #199 — full "Edit person" PATCH regression probe.
 *
 * Standalone (tsx ./tests/edit-person/run.ts), boots the app in-process
 * via app.listen(0); NODE_ENV=test enables the persona-cookie bypass.
 * Ephemeral p_test_* personas + roster rows, cleaned in `finally`.
 */

import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_hr_${STAMP}`;
const PARTNER_ID = `p_test_par_${STAMP}`;
const FP_ID = `p_test_fp_${STAMP}`;
const CONS_ID = `p_test_cons_${STAMP}`;
const EMP_USER_ID = `p_test_empu_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(t: string): void {
  console.log(`\n\u2500\u2500 ${t}`);
}

async function main(): Promise<void> {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierPartnerFirms,
    atelierPartnerFirmResources,
    atelierAuditEvents,
    atelierLegalEntities,
    atelierInvitations,
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

  const EMP_ROW = `emp_t199_${STAMP}`;
  const EMP2_ROW = `emp2_t199_${STAMP}`;
  const CT_ROW = `ct_t199_${STAMP}`;
  const PFR_ROW = `pfr_t199_${STAMP}`;
  const FIRM_A = `pf_t199a_${STAMP}`;
  const FIRM_B = `pf_t199b_${STAMP}`;
  const ENTITY_OLD = `lent_t199_old_${STAMP}`;
  const ENTITY_NEW = `lent_t199_new_${STAMP}`;
  const FOREIGN_INVITATION = `inv_foreign_t199_${STAMP}`;

  try {
    const personas = [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "Test HR" },
      { id: PARTNER_ID, role: "partner", roleLabel: "Partner", name: "Test Partner" },
      { id: FP_ID, role: "founding_partner", roleLabel: "Founding Partner", name: "Test FP" },
      { id: CONS_ID, role: "consultant", roleLabel: "Consultant", name: "Test Consultant" },
      { id: EMP_USER_ID, role: "employee", roleLabel: "Employee", name: "Edit Target" },
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
      userId: EMP_USER_ID,
      fullName: "Edit Target",
      email: `${EMP_USER_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
      seniority: "analyst",
      startDate: "2025-01-01",
      employingEntity: `Legacy Entity ${STAMP}`,
      iban: "AE070331234567890123456",
    });
    await db.insert(atelierEmployees).values({
      id: EMP2_ROW,
      orgId: ORG,
      fullName: "Email Holder",
      email: `taken_${STAMP}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierContractors).values({
      id: CT_ROW,
      orgId: ORG,
      fullName: "Contract Target",
      email: `ct_${STAMP}@vendor.com`,
    });
    await db.insert(atelierPartnerFirms).values([
      { id: FIRM_A, orgId: ORG, name: "Firm A" },
      { id: FIRM_B, orgId: ORG, name: "Firm B" },
    ]);
    await db.insert(atelierPartnerFirmResources).values({
      id: PFR_ROW,
      orgId: ORG,
      partnerFirmId: FIRM_A,
      fullName: "PFR Target",
      role: "Engineer",
    });
    await db.insert(atelierLegalEntities).values([
      {
        id: ENTITY_OLD,
        orgId: ORG,
        legalNameEn: `Legacy Entity ${STAMP}`,
        shortName: `Legacy ${STAMP}`,
        country: "AE",
      },
      {
        id: ENTITY_NEW,
        orgId: ORG,
        legalNameEn: `New Entity ${STAMP}`,
        shortName: `New ${STAMP}`,
        country: "AE",
      },
    ]);
    await db.insert(atelierInvitations).values({
      id: FOREIGN_INVITATION,
      orgId: `other_org_${STAMP}`,
      workerType: "employee",
      personDraft: {
        fullName: "Foreign Invitee",
        email: `foreign_${STAMP}@example.com`,
      },
      sentByUserId: FP_ID,
      status: "sent",
    });
    const { backfillEmployeeEmployingEntityIds } = await import(
      "../../src/lib/atelier-employing-entity.js"
    );
    await backfillEmployeeEmployingEntityIds();
    const [backfilled] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, EMP_ROW));
    check(
      "legacy employing-entity name backfills to registry ID",
      backfilled?.legalEntityId === ENTITY_OLD,
    );
    const invitationList = await call(
      "GET",
      "/roster/invitations",
      FP_ID,
    );
    check(
      "invitation list excludes other organisations",
      invitationList.status === 200 &&
        !(invitationList.body?.invitations ?? []).some(
          (inv: any) => inv.id === FOREIGN_INVITATION,
        ),
    );
    const foreignRevoke = await call(
      "POST",
      `/roster/invitations/${FOREIGN_INVITATION}/revoke`,
      FP_ID,
    );
    check(
      "invitation mutations cannot cross organisations",
      foreignRevoke.status === 404,
    );

    // ================================================================
    group("gating");
    // ================================================================
    const consEdit = await call("PATCH", `/roster/people/${EMP_ROW}`, CONS_ID, {
      fullName: "Nope",
    });
    check("consultant PATCH \u2192 403", consEdit.status === 403, `status=${consEdit.status}`);

    const consFirms = await call("GET", "/roster/partner-firms", CONS_ID);
    check("consultant partner-firms list \u2192 403", consFirms.status === 403);

    const hrFirms = await call("GET", "/roster/partner-firms", HR_ID);
    check(
      "hr partner-firms list \u2192 200 with both firms",
      hrFirms.status === 200 &&
        [FIRM_A, FIRM_B].every((f) => hrFirms.body?.firms?.some((x: any) => x.id === f)),
      JSON.stringify(hrFirms.body),
    );

    const partnerTitle = await call("PATCH", `/roster/people/${EMP_ROW}`, PARTNER_ID, {
      title: "Sneaky Title",
    });
    check("partner editing title \u2192 403", partnerTitle.status === 403, `status=${partnerTitle.status}`);

    const getAsHr = await call("GET", `/roster/people/${EMP_ROW}`, HR_ID);
    check(
      "GET person exposes viewerCanEdit=true for hr",
      getAsHr.status === 200 && getAsHr.body?.viewerCanEdit === true,
    );
    const getAsCons = await call("GET", `/roster/people/${EMP_ROW}`, CONS_ID);
    check(
      "consultant person detail is restricted",
      getAsCons.status === 403,
    );

    // ================================================================
    group("sensitive-field lock");
    // ================================================================
    const iban = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      iban: "AE999",
    });
    check(
      "iban \u2192 422 field-locked",
      iban.status === 422 && iban.body?.error === "field-locked" && iban.body?.fields?.includes("iban"),
      JSON.stringify(iban.body),
    );
    const rate = await call("PATCH", `/roster/people/${CT_ROW}`, FP_ID, {
      dayRateAmount: 5000,
    });
    check("dayRateAmount \u2192 422 field-locked", rate.status === 422 && rate.body?.error === "field-locked");
    const lifecycle = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      status: "offboarded",
    });
    check("status \u2192 422 field-locked", lifecycle.status === 422 && lifecycle.body?.error === "field-locked");
    const rbacRole = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      role: "founding_partner",
    });
    check("employee role \u2192 422 field-locked", rbacRole.status === 422 && rbacRole.body?.error === "field-locked");
    const unknown = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      madeUpField: 1,
    });
    check("unknown field \u2192 422 invalid-body", unknown.status === 422 && unknown.body?.error === "invalid-body");

    // ================================================================
    group("employee edit (hr)");
    // ================================================================
    const legacyEntityWrite = await call(
      "PATCH",
      `/roster/people/${EMP_ROW}`,
      HR_ID,
      { employingEntity: "DIFC" },
    );
    check(
      "free-text employing entity is rejected",
      legacyEntityWrite.status === 422 &&
        legacyEntityWrite.body?.error === "legacy-employing-entity-not-accepted",
    );
    const empEdit = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      firstName: "Edit",
      lastName: "Target Renamed",
      preferredName: "ET",
      title: "Senior Analyst",
      seniority: "consultant",
      employmentType: "fixed_term",
      employmentStatus: "notice",
      legalEntityId: ENTITY_NEW,
      homeOffice: "Dubai",
      noticePeriodDays: 60,
      country: "UAE",
      nationality: "eg",
      gender: "male",
      personalEmail: "et.personal@example.com",
      cellPhones: [{ country: "UAE", number: "+971 50 000 1111" }],
      officeAddress: "DIFC Gate, Dubai",
      endDate: "2026-12-31",
    });
    check(
      "hr full employee edit \u2192 200 with per-field changes",
      empEdit.status === 200 && Array.isArray(empEdit.body?.changes) && empEdit.body.changes.length >= 10,
      `status=${empEdit.status} ${JSON.stringify(empEdit.body?.changes ?? empEdit.body)}`,
    );
    check(
      "nationality uppercased + change entries carry from/to",
      empEdit.body?.changes?.some((c: any) => c.field === "nationality" && c.to === "EG"),
    );
    const [empRow] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, EMP_ROW));
    check(
      "employee stores registry ID and clears legacy text",
      empRow?.legalEntityId === ENTITY_NEW && empRow?.employingEntity === null,
    );
    check(
      "employee row persisted",
      empRow?.fullName === "Edit Target Renamed" &&
        empRow?.title === "Senior Analyst" &&
        empRow?.noticePeriodDays === 60 &&
        empRow?.personalEmail === "et.personal@example.com",
    );
    check("iban untouched", empRow?.iban === "AE070331234567890123456");
    const [linkedUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, EMP_USER_ID));
    check(
      "linked login row synced (name + title)",
      linkedUser?.name === "Edit Target Renamed" && linkedUser?.title === "Senior Analyst",
      JSON.stringify({ name: linkedUser?.name, title: linkedUser?.title }),
    );
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, EMP_ROW), eq(atelierAuditEvents.action, "roster.person.updated")));
    const profileAudit = audits.find((a: any) => a.payload?.change === "profile");
    check(
      "audit row with field-level changes",
      !!profileAudit && Array.isArray(profileAudit.payload?.changes) &&
        profileAudit.payload.changes.some((c: any) => c.field === "title" && c.from === "Analyst" && c.to === "Senior Analyst"),
      JSON.stringify(profileAudit?.payload ?? null),
    );

    const noop = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, { country: "UAE" });
    check("no-change edit \u2192 200 with empty changes", noop.status === 200 && noop.body?.changes?.length === 0);

    const dupEmail = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      email: `taken_${STAMP}@cognirise.ai`,
    });
    check("duplicate work email \u2192 409", dupEmail.status === 409, `status=${dupEmail.status}`);

    const badDates = await call("PATCH", `/roster/people/${EMP_ROW}`, HR_ID, {
      endDate: "2024-01-01",
    });
    check("endDate before startDate \u2192 422", badDates.status === 422, `status=${badDates.status}`);

    // ================================================================
    group("contractor edit (partner)");
    // ================================================================
    const ctEdit = await call("PATCH", `/roster/people/${CT_ROW}`, HR_ID, {
      vendorEntity: "Vendor LLC",
      contractType: "retainer",
      country: "KSA",
    });
    check(
      "partner contractor edit \u2192 200",
      ctEdit.status === 200 && ctEdit.body?.changes?.length === 3,
      `status=${ctEdit.status} ${JSON.stringify(ctEdit.body?.changes ?? ctEdit.body)}`,
    );
    const ctEmployeeField = await call("PATCH", `/roster/people/${CT_ROW}`, HR_ID, {
      employmentStatus: "active",
    });
    check("employee-only field on contractor \u2192 422", ctEmployeeField.status === 422);

    // ================================================================
    group("partner-firm resource edit (founding partner)");
    // ================================================================
    const pfrEdit = await call("PATCH", `/roster/people/${PFR_ROW}`, FP_ID, {
      role: "Lead Engineer",
      seniority: "principal",
      partnerFirmId: FIRM_B,
    });
    check(
      "PFR edit incl. free-text role + firm move \u2192 200",
      pfrEdit.status === 200 && pfrEdit.body?.changes?.some((c: any) => c.field === "partnerFirmId" && c.to === FIRM_B),
      `status=${pfrEdit.status} ${JSON.stringify(pfrEdit.body?.changes ?? pfrEdit.body)}`,
    );
    const pfrBadFirm = await call("PATCH", `/roster/people/${PFR_ROW}`, FP_ID, {
      partnerFirmId: "pf_nonexistent",
    });
    check("unknown partnerFirmId \u2192 422", pfrBadFirm.status === 422 && pfrBadFirm.body?.error === "partner-firm-not-found");
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `p_test_%${STAMP}`));
      await db.delete(atelierEmployees).where(like(atelierEmployees.id, `%_t199_${STAMP}`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP2_ROW));
      await db.delete(atelierContractors).where(eq(atelierContractors.id, CT_ROW));
      await db.delete(atelierPartnerFirmResources).where(eq(atelierPartnerFirmResources.id, PFR_ROW));
      await db.delete(atelierPartnerFirms).where(like(atelierPartnerFirms.id, `pf_t199%_${STAMP}`));
      await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.id, `lent_t199_%_${STAMP}`));
      await db.delete(atelierInvitations).where(eq(atelierInvitations.id, FOREIGN_INVITATION));
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
  console.log("\n\u2713 all edit-person checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
