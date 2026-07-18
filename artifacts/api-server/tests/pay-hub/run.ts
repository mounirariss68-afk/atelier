/**
 * Task #54 — Personal pay hub regression probe.
 *
 * Runs standalone (tsx ./tests/pay-hub/run.ts) booting the app in-process
 * via app.listen(0) — the CRM harness pattern; NODE_ENV=test enables the
 * persona-cookie bypass so requests act as ephemeral p_test_* personas.
 * All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. HR upload (multipart) → 201 draft; consultant upload → 403;
 *      contractor-only/employee-only category rules → 400
 *   2. Unpublished docs invisible in /me/pay; publish → visible + Me-home
 *      notification; retract → hidden again
 *   3. Download ACL: owner OK, foreign persona 404, unpublished 404,
 *      HR admin download OK, consultant 403; downloads audited
 *   4. /me/pay bundle: employee comp+bank masked (last-4), insurance after
 *      HR upsert; contractor variant (day rate, no bank/insurance)
 *   5. Bank change lifecycle: employee submit (masked in self view),
 *      duplicate-pending 400, contractor 400, HR approve applies
 *      iban/swift to roster row + audits + notifies; reject leaves roster
 *      untouched; decided request cannot be re-decided (404)
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_hr_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`;
const EMP2_ID = `p_test_emp2_${STAMP}`;
const CT_ID = `p_test_ct_${STAMP}`;
const CONS_ID = `p_test_cons_${STAMP}`;
const EMP_PERSON = `emp_test_${STAMP}`;
const EMP2_PERSON = `emp2_test_${STAMP}`;
const CT_PERSON = `ct_test_${STAMP}`;

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
    atelierSelfNotifications,
    atelierAuditEvents,
    atelierPayDocuments,
    atelierPersonInsurance,
    atelierBankChangeRequests,
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

  async function uploadDoc(
    personaId: string,
    personId: string,
    fields: Record<string, string>,
    fileName = "doc.pdf",
    content = `pdf-bytes-${STAMP}`,
  ): Promise<{ status: number; body: any }> {
    const fd = new FormData();
    fd.set(
      "file",
      new Blob([content], { type: "application/pdf" }),
      fileName,
    );
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const res = await fetch(`${API}/roster/pay/people/${personId}/documents`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${personaId}` },
      body: fd,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function download(
    personaId: string,
    url: string,
  ): Promise<{ status: number; text: string; ct: string | null }> {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      headers: { cookie: `atelier_persona=${personaId}` },
    });
    return {
      status: res.status,
      text: await res.text(),
      ct: res.headers.get("content-type"),
    };
  }

  const payDocIds: string[] = [];

  try {
    // --- ephemeral personas + roster rows ---
    const personas = [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "Test HR" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "Pay Emp" },
      { id: EMP2_ID, role: "employee", roleLabel: "Employee", name: "Other Emp" },
      { id: CT_ID, role: "contractor", roleLabel: "Contractor", name: "Pay Contractor" },
      { id: CONS_ID, role: "consultant", roleLabel: "Consultant", name: "Test Consultant" },
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
      id: EMP_PERSON,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "Pay Emp",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
      baseCompensation: 120000,
      baseCurrency: "USD",
      iban: "AE070331234567890123456",
      swift: "OLDBICXX",
    });
    await db.insert(atelierEmployees).values({
      id: EMP2_PERSON,
      orgId: ORG,
      userId: EMP2_ID,
      fullName: "Other Emp",
      email: `${EMP2_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierContractors).values({
      id: CT_PERSON,
      orgId: ORG,
      fullName: "Pay Contractor",
      email: `${CT_ID}@cognirise.ai`,
      dayRateAmount: 900,
      dayRateCurrency: "USD",
    });

    // =====================================================================
    group("upload \u00b7 HR gate + category rules");
    // =====================================================================
    const consUp = await uploadDoc(CONS_ID, EMP_PERSON, {
      category: "payslip",
      title: "Nope",
    });
    check("consultant upload \u2192 403", consUp.status === 403, `status=${consUp.status}`);

    const empUp = await uploadDoc(HR_ID, EMP_PERSON, {
      category: "payslip",
      title: `Payslip June ${STAMP}`,
      periodDate: "2026-06",
    });
    check(
      "HR payslip upload \u2192 201 draft (unpublished)",
      empUp.status === 201 && empUp.body?.published === false && empUp.body?.category === "payslip",
      `status=${empUp.status} body=${JSON.stringify(empUp.body)?.slice(0, 200)}`,
    );
    const payslipId: string = empUp.body?.id;
    if (payslipId) payDocIds.push(payslipId);
    check(
      "upload response never contains file bytes",
      empUp.status === 201 && !("fileData" in (empUp.body ?? {})),
    );

    const badCatCt = await uploadDoc(HR_ID, CT_PERSON, {
      category: "payslip",
      title: "Nope",
    });
    check("payslip for contractor \u2192 400", badCatCt.status === 400, `status=${badCatCt.status}`);
    const badInsCt = await uploadDoc(HR_ID, CT_PERSON, {
      category: "insurance",
      title: "Nope",
    });
    check("insurance doc for contractor \u2192 400", badInsCt.status === 400, `status=${badInsCt.status}`);
    const badCatEmp = await uploadDoc(HR_ID, EMP_PERSON, {
      category: "remittance",
      title: "Nope",
    });
    check("remittance for employee \u2192 400", badCatEmp.status === 400, `status=${badCatEmp.status}`);

    const ctUp = await uploadDoc(HR_ID, CT_PERSON, {
      category: "remittance",
      title: `Remittance June ${STAMP}`,
      periodDate: "2026-06",
    });
    check("HR remittance upload for contractor \u2192 201", ctUp.status === 201, `status=${ctUp.status}`);
    const remitId: string = ctUp.body?.id;
    if (remitId) payDocIds.push(remitId);

    // =====================================================================
    group("publish lifecycle \u00b7 visibility + notification");
    // =====================================================================
    const beforePub = await call("GET", "/me/pay", EMP_ID);
    check(
      "unpublished doc invisible in /me/pay",
      beforePub.status === 200 &&
        !beforePub.body?.documents?.some((d: any) => d.id === payslipId),
      `status=${beforePub.status} docs=${beforePub.body?.documents?.length}`,
    );

    const consPub = await call("POST", `/roster/pay/documents/${payslipId}/publish`, CONS_ID, {});
    check("consultant publish \u2192 403", consPub.status === 403, `status=${consPub.status}`);

    const pub = await call("POST", `/roster/pay/documents/${payslipId}/publish`, HR_ID, {});
    check(
      "HR publish \u2192 200 published",
      pub.status === 200 && pub.body?.published === true,
      `status=${pub.status}`,
    );
    const afterPub = await call("GET", "/me/pay", EMP_ID);
    const selfDoc = afterPub.body?.documents?.find((d: any) => d.id === payslipId);
    check(
      "published doc visible to owner in /me/pay",
      afterPub.status === 200 && !!selfDoc,
      `docs=${JSON.stringify(afterPub.body?.documents)?.slice(0, 200)}`,
    );
    const notifs = await call("GET", "/me/notifications", EMP_ID);
    check(
      "publish emitted a Me-home notification (kind=pay_document, href=/me/pay)",
      notifs.status === 200 &&
        notifs.body?.some((n: any) => n.kind === "pay_document" && n.href === "/me/pay"),
      JSON.stringify(notifs.body)?.slice(0, 200),
    );
    const foreignPay = await call("GET", "/me/pay", EMP2_ID);
    check(
      "other employee never sees the doc in their /me/pay",
      foreignPay.status === 200 &&
        !foreignPay.body?.documents?.some((d: any) => d.id === payslipId),
    );

    // =====================================================================
    group("download ACL");
    // =====================================================================
    const ownDl = await download(EMP_ID, selfDoc?.downloadUrl ?? `/api/atelier/me/pay/documents/${payslipId}/download`);
    check(
      "owner download \u2192 200 with bytes",
      ownDl.status === 200 && ownDl.text.includes(`pdf-bytes-${STAMP}`),
      `status=${ownDl.status}`,
    );
    const foreignDl = await download(EMP2_ID, `/api/atelier/me/pay/documents/${payslipId}/download`);
    check("foreign owner download \u2192 404", foreignDl.status === 404, `status=${foreignDl.status}`);
    const consAdminDl = await download(CONS_ID, `/api/atelier/roster/pay/documents/${payslipId}/download`);
    check("consultant HR-download \u2192 403", consAdminDl.status === 403, `status=${consAdminDl.status}`);
    const hrDl = await download(HR_ID, `/api/atelier/roster/pay/documents/${payslipId}/download`);
    check("HR admin download \u2192 200", hrDl.status === 200 && hrDl.text.includes(`pdf-bytes-${STAMP}`), `status=${hrDl.status}`);
    const dlAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "pay_document"),
          eq(atelierAuditEvents.entityId, payslipId),
        ),
      );
    check(
      "self + HR downloads audited",
      dlAudits.some((r: any) => r.action === "pay_document.downloaded.self") &&
        dlAudits.some((r: any) => r.action === "pay_document.downloaded.hr"),
      dlAudits.map((r: any) => r.action).join(","),
    );

    // retract hides it again (owner download 404s afterwards)
    const retract = await call("POST", `/roster/pay/documents/${payslipId}/retract`, HR_ID, {});
    check("HR retract \u2192 200 unpublished", retract.status === 200 && retract.body?.published === false);
    const afterRetract = await call("GET", "/me/pay", EMP_ID);
    check(
      "retracted doc gone from /me/pay",
      !afterRetract.body?.documents?.some((d: any) => d.id === payslipId),
    );
    const retractedDl = await download(EMP_ID, `/api/atelier/me/pay/documents/${payslipId}/download`);
    check("retracted doc download \u2192 404", retractedDl.status === 404, `status=${retractedDl.status}`);
    // re-publish for later state sanity
    await call("POST", `/roster/pay/documents/${payslipId}/publish`, HR_ID, {});

    // =====================================================================
    group("/me/pay bundle \u00b7 employee vs contractor");
    // =====================================================================
    const empPay = await call("GET", "/me/pay", EMP_ID);
    check(
      "employee comp summary present",
      empPay.body?.compSummary?.baseCompensation === 120000 &&
        empPay.body?.compSummary?.baseCurrency === "USD",
      JSON.stringify(empPay.body?.compSummary),
    );
    check(
      "employee IBAN masked to last-4",
      empPay.body?.bank?.ibanMasked === "\u2022\u2022\u2022\u2022 3456" &&
        empPay.body?.bank?.canRequestChange === true,
      JSON.stringify(empPay.body?.bank),
    );

    const insUpsert = await call("PUT", `/roster/pay/people/${EMP_PERSON}/insurance`, HR_ID, {
      provider: "Cigna Test",
      policyNumber: "POL-1",
      memberNumber: "MEM-1",
      coverageSummary: "Family cover",
    });
    check("HR insurance upsert \u2192 200", insUpsert.status === 200 && insUpsert.body?.provider === "Cigna Test", `status=${insUpsert.status}`);
    const insUpsert2 = await call("PUT", `/roster/pay/people/${EMP_PERSON}/insurance`, HR_ID, {
      provider: "Cigna Test 2",
    });
    check("insurance upsert is idempotent (update, not dup)", insUpsert2.status === 200 && insUpsert2.body?.provider === "Cigna Test 2");
    const empPay2 = await call("GET", "/me/pay", EMP_ID);
    check(
      "employee sees insurance details",
      empPay2.body?.insurance?.provider === "Cigna Test 2",
      JSON.stringify(empPay2.body?.insurance),
    );
    const ctIns = await call("PUT", `/roster/pay/people/${CT_PERSON}/insurance`, HR_ID, {
      provider: "Nope",
    });
    check("insurance upsert for contractor \u2192 400", ctIns.status === 400, `status=${ctIns.status}`);

    const ctPub = await call("POST", `/roster/pay/documents/${remitId}/publish`, HR_ID, {});
    check("remittance publish \u2192 200", ctPub.status === 200);
    const ctPay = await call("GET", "/me/pay", CT_ID);
    check(
      "contractor variant: day rate, remittance doc, no bank/insurance",
      ctPay.status === 200 &&
        ctPay.body?.person?.workerType === "contractor" &&
        ctPay.body?.compSummary?.dayRateAmount === 900 &&
        ctPay.body?.bank === null &&
        ctPay.body?.insurance === null &&
        ctPay.body?.documents?.some((d: any) => d.category === "remittance"),
      JSON.stringify({ comp: ctPay.body?.compSummary, bank: ctPay.body?.bank, docs: ctPay.body?.documents?.length }),
    );

    const consMePayGate = await call("GET", `/roster/pay/people/${EMP_PERSON}/documents`, CONS_ID);
    check("consultant HR doc list \u2192 403", consMePayGate.status === 403, `status=${consMePayGate.status}`);
    const hrList = await call("GET", `/roster/pay/people/${EMP_PERSON}/documents`, HR_ID);
    check(
      "HR doc list includes drafts and published",
      hrList.status === 200 && hrList.body?.some((d: any) => d.id === payslipId),
      `status=${hrList.status}`,
    );

    // =====================================================================
    group("bank change \u00b7 lifecycle");
    // =====================================================================
    const ctBank = await call("POST", "/me/pay/bank-change-request", CT_ID, {
      newIban: "AE070331234567890129999",
    });
    check("contractor bank change \u2192 400", ctBank.status === 400, `status=${ctBank.status}`);
    const badIban = await call("POST", "/me/pay/bank-change-request", EMP_ID, {
      newIban: "no t-valid!",
    });
    check("invalid IBAN \u2192 400", badIban.status === 400, `status=${badIban.status}`);

    const bankReq = await call("POST", "/me/pay/bank-change-request", EMP_ID, {
      newIban: "AE070331234567890129999",
      newSwift: "NEWBICXX",
      reason: "Moved banks",
    });
    check(
      "employee bank change \u2192 201 pending, masked in self view",
      bankReq.status === 201 &&
        bankReq.body?.status === "pending" &&
        bankReq.body?.newIbanMasked === "\u2022\u2022\u2022\u2022 9999" &&
        !("newIban" in (bankReq.body ?? {})),
      JSON.stringify(bankReq.body),
    );
    const reqId: string = bankReq.body?.id;

    const dupReq = await call("POST", "/me/pay/bank-change-request", EMP_ID, {
      newIban: "AE070331234567890120000",
    });
    check("second pending request \u2192 400", dupReq.status === 400, `status=${dupReq.status}`);

    const consQueue = await call("GET", "/roster/pay/bank-change-requests", CONS_ID);
    check("consultant bank queue \u2192 403", consQueue.status === 403, `status=${consQueue.status}`);
    const queue = await call("GET", "/roster/pay/bank-change-requests", HR_ID);
    const qRow = queue.body?.find?.((r: any) => r.id === reqId);
    check(
      "HR queue shows FULL new IBAN + prior masked",
      queue.status === 200 &&
        qRow?.newIban === "AE070331234567890129999" &&
        qRow?.previousIbanMasked === "\u2022\u2022\u2022\u2022 3456",
      JSON.stringify(qRow),
    );

    const approve = await call("POST", `/roster/pay/bank-change-requests/${reqId}/approve`, HR_ID, {
      note: "Verified over the phone",
    });
    check("HR approve \u2192 200 approved", approve.status === 200 && approve.body?.status === "approved", `status=${approve.status}`);
    const [empRow] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, EMP_PERSON));
    check(
      "approve applied iban + swift to roster row",
      empRow?.iban === "AE070331234567890129999" && empRow?.swift === "NEWBICXX",
      JSON.stringify({ iban: empRow?.iban, swift: empRow?.swift }),
    );
    const reDecide = await call("POST", `/roster/pay/bank-change-requests/${reqId}/approve`, HR_ID, {});
    check("re-decide decided request \u2192 404", reDecide.status === 404, `status=${reDecide.status}`);
    const empNotifs2 = await call("GET", "/me/notifications", EMP_ID);
    check(
      "approval notified the requester",
      empNotifs2.body?.some((n: any) => n.kind === "bank_change" && /approved/i.test(n.title)),
    );

    // reject path leaves roster untouched
    const bankReq2 = await call("POST", "/me/pay/bank-change-request", EMP_ID, {
      newIban: "AE070331234567890124444",
    });
    const reqId2: string = bankReq2.body?.id;
    const rejectRes = await call("POST", `/roster/pay/bank-change-requests/${reqId2}/reject`, HR_ID, {
      note: "Could not verify",
    });
    check("HR reject \u2192 200 rejected", rejectRes.status === 200 && rejectRes.body?.status === "rejected");
    const [empRow2] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, EMP_PERSON));
    check(
      "reject leaves roster iban untouched",
      empRow2?.iban === "AE070331234567890129999",
      `iban=${empRow2?.iban}`,
    );
    const bankAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityType, "bank_change_request"));
    const mine = bankAudits.filter((r: any) => [reqId, reqId2].includes(r.entityId));
    check(
      "bank change requested/approved/rejected all audited",
      mine.some((r: any) => r.action === "bank_change.requested") &&
        mine.some((r: any) => r.action === "bank_change.approved") &&
        mine.some((r: any) => r.action === "bank_change.rejected"),
      mine.map((r: any) => r.action).join(","),
    );
    check(
      "audit payloads never contain the full IBAN",
      mine.every((r: any) => !JSON.stringify(r.payload ?? {}).includes("AE0703312345678901")),
    );
  } finally {
    // --- cleanup: every row this suite created ---
    try {
      if (payDocIds.length > 0) {
        await db.delete(atelierPayDocuments).where(inArray(atelierPayDocuments.id, payDocIds));
      }
      await db
        .delete(atelierBankChangeRequests)
        .where(eq(atelierBankChangeRequests.personId, EMP_PERSON));
      await db
        .delete(atelierPersonInsurance)
        .where(eq(atelierPersonInsurance.personId, EMP_PERSON));
      for (const uid of [EMP_ID, EMP2_ID, CT_ID]) {
        await db.delete(atelierSelfNotifications).where(eq(atelierSelfNotifications.userId, uid));
      }
      await db
        .delete(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "pay_document"),
            inArray(atelierAuditEvents.entityId, payDocIds.length ? payDocIds : ["none"]),
          ),
        );
      await db
        .delete(atelierAuditEvents)
        .where(eq(atelierAuditEvents.entityType, "bank_change_request"));
      await db
        .delete(atelierAuditEvents)
        .where(eq(atelierAuditEvents.entityType, "person_insurance"));
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [EMP_PERSON, EMP2_PERSON]));
      await db.delete(atelierContractors).where(eq(atelierContractors.id, CT_PERSON));
      for (const id of [HR_ID, EMP_ID, EMP2_ID, CT_ID, CONS_ID]) {
        await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
      }
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 pay-hub probe: all checks passed"
      : `\n\u2717 pay-hub probe: ${failures.length} failed:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
