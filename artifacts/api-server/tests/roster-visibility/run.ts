/**
 * Task #221 — Sensitive people-data lockdown probe.
 *
 * Runs standalone (tsx ./tests/roster-visibility/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass so requests act as ephemeral p_test_* personas. All rows created
 * here are removed in `finally`.
 *
 * Coverage:
 *   1. Roster list scoping: founding_partner/hr/finance see the full
 *      roster ("full" scope); a manager sees ONLY their transitive
 *      reports tree (cycle-safe BFS) as business-only wires; a regular
 *      partner / plain employee with no reports gets an empty list.
 *   2. Sensitive strip: finance (full scope) gets NO hr notes /
 *      demographics; manager wires carry no comp, notes, or demographics.
 *   3. Person detail: manager 200-business-only inside tree, 403 outside;
 *      viewer flags (viewerCanEdit / viewerCanSeeSensitive / viewerScope).
 *   4. Edit gates: PATCH person + demographics are founding_partner|hr
 *      only (partner now 403s).
 *   5. Sensitive sub-surfaces: /personal + /documents (fp|hr|self only),
 *      /audit (fp|hr only), /roster/compliance (fp|hr only).
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_rvfp_${STAMP}`;
const HR_ID = `p_test_rvhr_${STAMP}`;
const FIN_ID = `p_test_rvfin_${STAMP}`;
const PTR_ID = `p_test_rvptr_${STAMP}`;
const MGR_ID = `p_test_rvmgr_${STAMP}`;
const EMP_ID = `p_test_rvemp_${STAMP}`;
const CON_ID = `p_test_rvcon_${STAMP}`;
const MGR_PERSON = `emp_test_rvmgr_${STAMP}`;
const REPORT_PERSON = `emp_test_rvrep_${STAMP}`;
const DEEP_PERSON = `emp_test_rvdeep_${STAMP}`;
const OTHER_PERSON = `emp_test_rvother_${STAMP}`;
const EMP_PERSON = `emp_test_rvemp_${STAMP}`;

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
    atelierRosterReportsTo,
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

  const edgeIds: string[] = [];
  try {
    const personas = [
      { id: FP_ID, role: "founding_partner", roleLabel: "Founding Partner", name: "RV FP" },
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "RV HR" },
      { id: FIN_ID, role: "finance", roleLabel: "Finance", name: "RV Finance" },
      { id: PTR_ID, role: "partner", roleLabel: "Partner", name: "RV Partner" },
      { id: MGR_ID, role: "senior_manager", roleLabel: "Senior Manager", name: "RV Manager" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "RV Employee" },
      { id: CON_ID, role: "consultant", roleLabel: "Consultant", name: "RV Consultant" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "RV",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    const people = [
      { id: MGR_PERSON, userId: MGR_ID, fullName: "RV Manager", role: "senior_manager", title: "Senior Manager" },
      { id: REPORT_PERSON, userId: null, fullName: "RV Report", role: "employee", title: "Consultant" },
      { id: DEEP_PERSON, userId: null, fullName: "RV Deep Report", role: "employee", title: "Analyst" },
      { id: OTHER_PERSON, userId: null, fullName: "RV Outside Tree", role: "employee", title: "Analyst" },
      { id: EMP_PERSON, userId: EMP_ID, fullName: "RV Employee", role: "employee", title: "Analyst" },
    ];
    for (const p of people) {
      await db.insert(atelierEmployees).values({
        id: p.id,
        orgId: ORG,
        userId: p.userId,
        fullName: p.fullName,
        email: `${p.id}@cognirise.ai`,
        role: p.role,
        title: p.title,
        gender: "female",
        nationality: "FR",
        notes: `HR-sensitive note ${STAMP}`,
        baseCompensation: 123456,
        iban: "DE00TESTIBAN0000",
      });
    }
    // reports_to edges: MGR → REPORT → DEEP, plus a DEEP → MGR back-edge to
    // prove the BFS is cycle-safe.
    const edges = [
      { manager: MGR_PERSON, person: REPORT_PERSON },
      { manager: REPORT_PERSON, person: DEEP_PERSON },
      { manager: DEEP_PERSON, person: MGR_PERSON },
    ];
    for (const e of edges) {
      const id = `rrt_test_${STAMP}_${edgeIds.length}`;
      edgeIds.push(id);
      await db.insert(atelierRosterReportsTo).values({
        id,
        orgId: ORG,
        personId: e.person,
        personType: "employee",
        managerPersonId: e.manager,
        managerPersonType: "employee",
      });
    }

    // =====================================================================
    group("roster list scoping");
    // =====================================================================
    const fpList = await call("GET", "/roster/people", FP_ID);
    const fpIds = new Set((fpList.body?.people ?? []).map((p: any) => p.id));
    check(
      "founding_partner list \u2192 full scope incl. out-of-tree person",
      fpList.status === 200 && fpList.body?.viewerScope === "full" && fpIds.has(OTHER_PERSON),
      `status=${fpList.status} scope=${fpList.body?.viewerScope}`,
    );
    const fpOther = (fpList.body?.people ?? []).find((p: any) => p.id === OTHER_PERSON);
    check(
      "founding_partner sees notes + demographics",
      fpOther?.notes === `HR-sensitive note ${STAMP}` && fpOther?.gender === "female" && fpOther?.nationality === "FR",
    );

    const finList = await call("GET", "/roster/people", FIN_ID);
    const finOther = (finList.body?.people ?? []).find((p: any) => p.id === OTHER_PERSON);
    check(
      "finance list \u2192 full scope but notes/demographics stripped",
      finList.status === 200 &&
        finList.body?.viewerScope === "full" &&
        !!finOther &&
        (finOther.notes ?? null) === null &&
        finOther.gender === "unspecified" &&
        (finOther.nationality ?? null) === null,
      `notes=${finOther?.notes} gender=${finOther?.gender}`,
    );

    const ptrList = await call("GET", "/roster/people", PTR_ID);
    check(
      "partner (no roster link) \u2192 reports scope, empty list",
      ptrList.status === 200 &&
        ptrList.body?.viewerScope === "reports" &&
        (ptrList.body?.people ?? []).length === 0,
      `scope=${ptrList.body?.viewerScope} n=${(ptrList.body?.people ?? []).length}`,
    );

    // Employee personas are locked to the Me lens entirely (Task #50).
    const empList = await call("GET", "/roster/people", EMP_ID);
    check(
      "employee persona \u2192 403 employee-self-scope (Me lens lock)",
      empList.status === 403 && empList.body?.error === "employee-self-scope",
      `status=${empList.status} err=${empList.body?.error}`,
    );
    // A consultant with no reports is the true non-manager empty state.
    const conList = await call("GET", "/roster/people", CON_ID);
    check(
      "non-manager consultant \u2192 reports scope, empty list",
      conList.status === 200 &&
        conList.body?.viewerScope === "reports" &&
        (conList.body?.people ?? []).length === 0,
      `status=${conList.status} scope=${conList.body?.viewerScope} n=${(conList.body?.people ?? []).length}`,
    );

    const mgrList = await call("GET", "/roster/people", MGR_ID);
    const mgrIds = new Set((mgrList.body?.people ?? []).map((p: any) => p.id));
    check(
      "manager \u2192 transitive reports only (cycle-safe), no out-of-tree",
      mgrList.status === 200 &&
        mgrList.body?.viewerScope === "reports" &&
        mgrIds.has(REPORT_PERSON) &&
        mgrIds.has(DEEP_PERSON) &&
        !mgrIds.has(OTHER_PERSON) &&
        !mgrIds.has(EMP_PERSON),
      `ids=${[...mgrIds].join(",")}`,
    );
    const mgrRep = (mgrList.body?.people ?? []).find((p: any) => p.id === REPORT_PERSON);
    check(
      "manager wire is business-only (no comp / notes / demographics)",
      !!mgrRep &&
        mgrRep.iban === undefined &&
        mgrRep.baseCompensation === undefined &&
        mgrRep.dayRateAmount === undefined &&
        (mgrRep.notes ?? null) === null &&
        mgrRep.gender === "unspecified" &&
        (mgrRep.nationality ?? null) === null &&
        mgrRep.fullName === "RV Report",
      JSON.stringify(mgrRep ?? {}),
    );

    // =====================================================================
    group("person detail scoping + viewer flags");
    // =====================================================================
    const mgrDetail = await call("GET", `/roster/people/${REPORT_PERSON}`, MGR_ID);
    check(
      "manager detail in-tree \u2192 200 business-only, read-only flags",
      mgrDetail.status === 200 &&
        mgrDetail.body?.viewerScope === "reports" &&
        mgrDetail.body?.viewerCanEdit === false &&
        mgrDetail.body?.viewerCanSeeSensitive === false &&
        mgrDetail.body?.viewerCanSeeComp === false &&
        (mgrDetail.body?.person?.notes ?? null) === null &&
        mgrDetail.body?.person?.iban === undefined,
      `status=${mgrDetail.status}`,
    );
    const mgrSelf = await call("GET", `/roster/people/${MGR_PERSON}`, MGR_ID);
    check("manager can open own person record", mgrSelf.status === 200);
    const mgrOut = await call("GET", `/roster/people/${OTHER_PERSON}`, MGR_ID);
    check(
      "manager detail out-of-tree \u2192 403 roster-scope-forbidden",
      mgrOut.status === 403 && mgrOut.body?.error === "roster-scope-forbidden",
      `status=${mgrOut.status} err=${mgrOut.body?.error}`,
    );
    const ptrDetail = await call("GET", `/roster/people/${OTHER_PERSON}`, PTR_ID);
    check("partner detail \u2192 403 (no roster scope)", ptrDetail.status === 403);
    const finDetail = await call("GET", `/roster/people/${OTHER_PERSON}`, FIN_ID);
    check(
      "finance detail \u2192 200, comp visible, sensitive stripped, no edit",
      finDetail.status === 200 &&
        finDetail.body?.viewerCanSeeComp === true &&
        finDetail.body?.person?.iban === "DE00TESTIBAN0000" &&
        (finDetail.body?.person?.notes ?? null) === null &&
        finDetail.body?.viewerCanSeeSensitive === false &&
        finDetail.body?.viewerCanEdit === false,
      `status=${finDetail.status} iban=${finDetail.body?.person?.iban}`,
    );
    const hrDetail = await call("GET", `/roster/people/${OTHER_PERSON}`, HR_ID);
    check(
      "hr detail \u2192 sensitive + edit flags on",
      hrDetail.status === 200 &&
        hrDetail.body?.viewerCanSeeSensitive === true &&
        hrDetail.body?.viewerCanEdit === true &&
        hrDetail.body?.person?.notes === `HR-sensitive note ${STAMP}`,
    );

    // =====================================================================
    group("edit gates \u2014 founding_partner | hr only");
    // =====================================================================
    const ptrPatch = await call("PATCH", `/roster/people/${OTHER_PERSON}`, PTR_ID, { country: "FR" });
    check(
      "partner PATCH person \u2192 403 person-edit-restricted",
      ptrPatch.status === 403 && ptrPatch.body?.error === "person-edit-restricted",
      `status=${ptrPatch.status}`,
    );
    const ptrDemo = await call("PATCH", `/roster/people/${OTHER_PERSON}/demographics`, PTR_ID, { gender: "male" });
    check("partner PATCH demographics \u2192 403", ptrDemo.status === 403);
    const ptrContact = await call("PATCH", `/roster/people/${OTHER_PERSON}/contact`, PTR_ID, {
      cellPhones: [{ country: "France", number: "+33 1 23" }],
      officeAddress: "1 Rue Test",
    });
    check("partner PATCH contact \u2192 403", ptrContact.status === 403);
    const ptrFirms = await call("GET", "/roster/partner-firms", PTR_ID);
    check("partner GET partner-firms (edit support) \u2192 403", ptrFirms.status === 403);
    const hrPatch = await call("PATCH", `/roster/people/${OTHER_PERSON}`, HR_ID, { country: "France" });
    check(
      "hr PATCH person \u2192 200 with audited change",
      hrPatch.status === 200 && (hrPatch.body?.changes ?? []).some((c: any) => c.field === "country"),
      `status=${hrPatch.status}`,
    );

    // =====================================================================
    group("sensitive sub-surfaces");
    // =====================================================================
    const ptrPersonal = await call("GET", `/roster/people/${OTHER_PERSON}/personal`, PTR_ID);
    check("partner /personal \u2192 403", ptrPersonal.status === 403);
    const finPersonal = await call("GET", `/roster/people/${OTHER_PERSON}/personal`, FIN_ID);
    check("finance /personal \u2192 403", finPersonal.status === 403);
    const hrPersonal = await call("GET", `/roster/people/${OTHER_PERSON}/personal`, HR_ID);
    check("hr /personal \u2192 200", hrPersonal.status === 200);
    const finDocs = await call("GET", `/roster/people/${OTHER_PERSON}/documents`, FIN_ID);
    check("finance /documents \u2192 403", finDocs.status === 403);
    const hrDocs = await call("GET", `/roster/people/${OTHER_PERSON}/documents`, HR_ID);
    check("hr /documents \u2192 200", hrDocs.status === 200);
    const ptrAudit = await call("GET", `/roster/people/${OTHER_PERSON}/audit`, PTR_ID);
    check("partner /audit \u2192 403 sensitive-people-forbidden", ptrAudit.status === 403);
    const finAudit = await call("GET", `/roster/people/${OTHER_PERSON}/audit`, FIN_ID);
    check("finance /audit \u2192 403", finAudit.status === 403);
    const hrAudit = await call("GET", `/roster/people/${OTHER_PERSON}/audit`, HR_ID);
    check("hr /audit \u2192 200", hrAudit.status === 200);
    const mgrEng = await call("GET", `/roster/people/${REPORT_PERSON}/engagements`, MGR_ID);
    check("manager in-tree /engagements \u2192 200 (business surface)", mgrEng.status === 200);
    const mgrEngOut = await call("GET", `/roster/people/${OTHER_PERSON}/engagements`, MGR_ID);
    check("manager out-of-tree /engagements \u2192 403", mgrEngOut.status === 403);

    const ptrCompliance = await call("GET", "/roster/compliance", PTR_ID);
    check("partner /roster/compliance \u2192 403", ptrCompliance.status === 403);
    const finCompliance = await call("GET", "/roster/compliance", FIN_ID);
    check("finance /roster/compliance \u2192 403", finCompliance.status === 403);
    const hrCompliance = await call("GET", "/roster/compliance", HR_ID);
    check("hr /roster/compliance \u2192 200", hrCompliance.status === 200);

    // ---- side channels: /skills + /timesheet-summary must obey roster scope ----
    const ptrSkills = await call("GET", `/roster/people/${OTHER_PERSON}/skills`, PTR_ID);
    check("partner /skills \u2192 403 roster-scope", ptrSkills.status === 403, `status=${ptrSkills.status}`);
    const conSkills = await call("GET", `/roster/people/${OTHER_PERSON}/skills`, CON_ID);
    check("non-manager consultant /skills \u2192 403", conSkills.status === 403, `status=${conSkills.status}`);
    const mgrSkillsIn = await call("GET", `/roster/people/${REPORT_PERSON}/skills`, MGR_ID);
    check("manager in-tree /skills \u2192 200", mgrSkillsIn.status === 200, `status=${mgrSkillsIn.status}`);
    const mgrSkillsOut = await call("GET", `/roster/people/${OTHER_PERSON}/skills`, MGR_ID);
    check("manager out-of-tree /skills \u2192 403", mgrSkillsOut.status === 403, `status=${mgrSkillsOut.status}`);
    const finSkills = await call("GET", `/roster/people/${OTHER_PERSON}/skills`, FIN_ID);
    check("finance (full view) /skills \u2192 200", finSkills.status === 200, `status=${finSkills.status}`);

    const ptrTs = await call("GET", `/roster/people/${OTHER_PERSON}/timesheet-summary`, PTR_ID);
    check("partner /timesheet-summary \u2192 403 roster-scope", ptrTs.status === 403, `status=${ptrTs.status}`);
    const mgrTsIn = await call("GET", `/roster/people/${REPORT_PERSON}/timesheet-summary`, MGR_ID);
    check("manager in-tree /timesheet-summary \u2192 200", mgrTsIn.status === 200, `status=${mgrTsIn.status}`);
    const mgrTsOut = await call("GET", `/roster/people/${OTHER_PERSON}/timesheet-summary`, MGR_ID);
    check("manager out-of-tree /timesheet-summary \u2192 403", mgrTsOut.status === 403, `status=${mgrTsOut.status}`);
    const hrTs = await call("GET", `/roster/people/${OTHER_PERSON}/timesheet-summary`, HR_ID);
    check("hr /timesheet-summary \u2192 200", hrTs.status === 200, `status=${hrTs.status}`);

    // ---- audit pack (PDF handler wins the route match): self allowed via
    // person\u2192user linkage; managers may NOT pull reports' audit packs.
    const mgrSelfAudit = await call("GET", `/roster/people/${MGR_PERSON}/audit`, MGR_ID);
    check("manager self audit pack \u2192 200 (self-export)", mgrSelfAudit.status === 200, `status=${mgrSelfAudit.status}`);
    const mgrReportAudit = await call("GET", `/roster/people/${REPORT_PERSON}/audit`, MGR_ID);
    check("manager in-tree report audit pack \u2192 403", mgrReportAudit.status === 403, `status=${mgrReportAudit.status}`);
  } finally {
    // ---- cleanup (tracked ids + pattern sweep) ----
    try {
      await db.delete(atelierRosterReportsTo).where(inArray(atelierRosterReportsTo.id, edgeIds));
      await db.delete(atelierEmployees).where(
        inArray(atelierEmployees.id, [MGR_PERSON, REPORT_PERSON, DEEP_PERSON, OTHER_PERSON, EMP_PERSON]),
      );
      await db.delete(atelierUsers).where(
        inArray(atelierUsers.id, [FP_ID, HR_ID, FIN_ID, PTR_ID, MGR_ID, EMP_ID, CON_ID]),
      );
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `emp_test_rv%_${STAMP}`));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 roster-visibility probe passed"
      : `\n\u2717 ${failures.length} failure(s): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
