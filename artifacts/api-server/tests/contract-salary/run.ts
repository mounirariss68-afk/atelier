/**
 * Task #1137 — Salary digitization probes.
 *
 * Offline, deterministic coverage of the signed-contract → salary-proposal
 * → audited payroll-apply stack. The Anthropic LLM is a local stub started
 * BEFORE the app import (env read at import time). Nothing hits the live DB
 * (scratch-db bootstrap) or a real model.
 *
 * Covers:
 *   1. fieldValues extraction (deterministic) — LLM stub NOT hit.
 *   2. LLM fallback with verbatim snippets → pending, source llm_text.
 *   3. fabricated snippet dropped (unprovable field).
 *   4. unreadable / no-salary text → failed with a reason.
 *   5. approve applies comp + audit row + proposal approved.
 *   6. reject.
 *   7. approve with overrides.
 *   8. contractor counterparty skipped (no proposal, no LLM).
 *   9. drift flag: true after roster comp later PATCHed away; null with no
 *      approved proposal.
 *  10. on-demand 202 + live-proposal 409.
 *
 * Run: NODE_ENV=test pnpm run test:contract-salary
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// The LLM stub echoes whatever JSON we queue next; it also counts hits so we
// can assert the deterministic path never calls it.
let llmHits = 0;
let nextLlmJson = "{}";

async function main() {
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      llmHits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe1137",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: nextLlmJson }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe1137-stub-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierContractRecords,
    atelierContractTemplateVersions,
    atelierContractSalaryProposals,
    atelierAuditEvents,
  } = D as any;
  const { and, eq, inArray } = await import("drizzle-orm");
  const salary = await import("../../src/lib/atelier-contract-salary.js");
  const svc = await import("../../src/lib/atelier-contract-salary-service.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now();
  const ORG = "aico";
  const FIN = `p_test_cs_fin_${STAMP}`;
  const CONS = `p_test_cs_cons_${STAMP}`;
  const EMP = `emp_cs_${STAMP}`;
  const EMP2 = `emp_cs2_${STAMP}`;
  const CTR_TV = `ctv_cs_${STAMP}`;
  const cleanupProposalIds: string[] = [];
  const cleanupContractIds: string[] = [];

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // ---------------------------------------------------------- fixtures
    for (const [id, role, name] of [
      [FIN, "finance", "CS Finance"],
      [CONS, "consultant", "CS Consultant"],
    ] as const) {
      await db
        .insert(atelierUsers)
        .values({
          id,
          orgId: ORG,
          email: `${id}@example.test`,
          name,
          initials: "CS",
          role,
          roleLabel: name,
          title: name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values([
      {
        id: EMP,
        orgId: ORG,
        fullName: "CS Employee One",
        email: `${EMP}@example.test`,
        role: "consultant",
        status: "active",
      },
      {
        id: EMP2,
        orgId: ORG,
        fullName: "CS Employee Two",
        email: `${EMP2}@example.test`,
        role: "consultant",
        status: "active",
      },
    ] as any);

    // Template version with salary-type money fields for the structured path.
    await db.insert(atelierContractTemplateVersions).values({
      id: CTR_TV,
      orgId: ORG,
      templateId: `tpl_cs_${STAMP}`,
      versionNumber: 1,
      fileName: "cs-template.docx",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      createdBy: FIN,
      blobRef: "enc:cdoc:none",
      fieldStatus: "reviewed",
      fieldSchema: [
        {
          key: "annual_base_salary",
          label: "Annual Base Salary",
          placeholder: "[SALARY]",
          dataType: "money",
          autoFill: "none",
          required: true,
          role: "standard",
        },
        {
          key: "basic_wage",
          label: "Basic Monthly Wage",
          placeholder: "[BASIC]",
          dataType: "money",
          autoFill: "none",
          required: false,
          role: "standard",
        },
        {
          key: "housing_allowance",
          label: "Housing Allowance (monthly)",
          placeholder: "[HOUSING]",
          dataType: "money",
          autoFill: "none",
          required: false,
          role: "standard",
        },
        {
          key: "effective_date",
          label: "Effective Date",
          placeholder: "[EFF]",
          dataType: "date",
          autoFill: "none",
          required: false,
          role: "standard",
        },
      ],
    } as any);

    const mkContract = (id: string, patch: Record<string, unknown>) => {
      cleanupContractIds.push(id);
      return db
        .insert(atelierContractRecords)
        .values({
          id,
          orgId: ORG,
          title: `CS contract ${id}`,
          contractType: "employment",
          templateVersionId: CTR_TV,
          counterpartyKind: "person",
          personId: EMP,
          status: "signed",
          ownerUserId: FIN,
          ...patch,
        } as any);
    };

    // ---------------------------------------- 1. fieldValues extraction
    llmHits = 0;
    const CTR1 = `ctr_cs_fv_${STAMP}`;
    await mkContract(CTR1, {
      fieldValues: {
        annual_base_salary: "AED 360,000",
        basic_wage: "20,000",
        housing_allowance: "5,000",
        effective_date: "2026-01-01",
      },
    });
    const [c1] = await db.select().from(atelierContractRecords).where(eq(atelierContractRecords.id, CTR1));
    const r1 = await salary.extractContractSalary(c1);
    check(
      "fieldValues extraction → source field_values with base comp + currency",
      r1.source === "field_values" &&
        r1.extracted.baseCompensation === 360000 &&
        r1.extracted.baseCurrency === "AED" &&
        r1.extracted.basicWageMonthly === 20000 &&
        r1.extracted.housingAllowanceMonthly === 5000 &&
        r1.extracted.effectiveDate === "2026-01-01",
      r1,
    );
    check("fieldValues path did NOT hit the LLM stub", llmHits === 0, llmHits);
    check(
      "fieldValues snippets carry field attribution",
      r1.snippets.baseCompensation?.attribution === "field:annual_base_salary",
      r1.snippets,
    );

    // ---------------------------------------- 2. LLM fallback (doc text)
    llmHits = 0;
    const docText =
      "This employment agreement sets the annual base salary at USD 240000 per annum. " +
      "The basic monthly wage is USD 12000. Effective date: 2026-03-01.";
    nextLlmJson = JSON.stringify({
      baseCompensation: 240000,
      currency: "USD",
      basicWageMonthly: 12000,
      housingAllowanceMonthly: null,
      effectiveDate: "2026-03-01",
      snippets: {
        baseCompensation: "annual base salary at USD 240000 per annum",
        currency: "USD 240000",
        basicWageMonthly: "basic monthly wage is USD 12000",
        effectiveDate: "Effective date: 2026-03-01",
      },
    });
    const r2 = await salary.extractFromDocumentText(docText);
    check(
      "LLM fallback → source llm_text with provable figures",
      r2.source === "llm_text" &&
        r2.extracted.baseCompensation === 240000 &&
        r2.extracted.baseCurrency === "USD" &&
        r2.extracted.basicWageMonthly === 12000 &&
        r2.extracted.effectiveDate === "2026-03-01",
      r2,
    );
    check("LLM fallback hit the stub exactly once", llmHits === 1, llmHits);

    // ---------------------------------------- 3. fabricated snippet dropped
    nextLlmJson = JSON.stringify({
      baseCompensation: 240000,
      currency: "USD",
      basicWageMonthly: 99999, // fabricated — snippet won't appear verbatim
      housingAllowanceMonthly: null,
      effectiveDate: null,
      snippets: {
        baseCompensation: "annual base salary at USD 240000 per annum",
        currency: "USD 240000",
        basicWageMonthly: "the basic wage is 99999 dollars a month", // not in doc
      },
    });
    const r3 = await salary.extractFromDocumentText(docText);
    check(
      "fabricated (unprovable) field dropped; provable base kept",
      r3.extracted.baseCompensation === 240000 && r3.extracted.basicWageMonthly == null,
      r3,
    );

    // ---------------------------------------- 4a. unreadable text → error
    let threwEmpty = false;
    try {
      await salary.extractFromDocumentText("");
    } catch (e) {
      threwEmpty = e instanceof salary.ContractSalaryExtractionError;
    }
    check("unreadable/empty doc → typed extraction error", threwEmpty);

    // ---------------------------------------- 4b. no-salary JSON → error
    nextLlmJson = JSON.stringify({
      baseCompensation: null,
      currency: null,
      basicWageMonthly: null,
      housingAllowanceMonthly: null,
      effectiveDate: null,
      snippets: {},
    });
    let threwNoSalary: unknown = null;
    try {
      await salary.extractFromDocumentText("A contract with no compensation clause at all.");
    } catch (e) {
      threwNoSalary = e;
    }
    check(
      "no-salary JSON → typed error with reason",
      threwNoSalary instanceof salary.ContractSalaryExtractionError &&
        /no salary/i.test((threwNoSalary as Error).message),
      threwNoSalary,
    );

    // Helper: create a pending proposal row directly for route tests.
    const mkPending = async (
      contractId: string,
      personId: string,
      extracted: Record<string, unknown>,
      source = "field_values",
    ) => {
      const id = `csp_${Math.random().toString(36).slice(2, 8)}_${STAMP}`;
      cleanupProposalIds.push(id);
      await db.insert(atelierContractSalaryProposals).values({
        id,
        orgId: ORG,
        contractId,
        personId,
        status: "pending",
        source,
        extracted,
        sourceSnippets: {},
      } as any);
      return id;
    };

    // ---------------------------------------- 5. approve applies comp
    const p5 = await mkPending(CTR1, EMP, {
      baseCompensation: 360000,
      baseCurrency: "AED",
      basicWageMonthly: 20000,
      housingAllowanceMonthly: 5000,
    });
    const consApprove = await api(CONS, "POST", `/roster/salary-proposals/${p5}/approve`, {});
    check("consultant approve → 403", consApprove.status === 403, consApprove);
    const ap5 = await api(FIN, "POST", `/roster/salary-proposals/${p5}/approve`, {});
    check("finance approve → 200 approved", ap5.status === 200 && ap5.body?.proposal?.status === "approved", ap5);
    const [emp5] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, EMP));
    check(
      "approve applied comp to the employee row",
      emp5.baseCompensation === 360000 &&
        emp5.baseCurrency === "AED" &&
        emp5.basicWageMonthly === 20000 &&
        emp5.housingAllowanceMonthly === 5000,
      emp5,
    );
    const payrollAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityType, "person"), eq(atelierAuditEvents.entityId, EMP)));
    check(
      "approve wrote roster.person.updated change:payroll audit with proposal provenance",
      payrollAudits.some(
        (a: any) =>
          a.action === "roster.person.updated" &&
          a.payload?.change === "payroll" &&
          a.payload?.proposalId === p5 &&
          a.payload?.contractId === CTR1,
      ),
      payrollAudits.map((a: any) => a.action),
    );
    const propAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityType, "contract_salary_proposal"));
    check(
      "approve wrote a proposal-entity audit row",
      propAudits.some((a: any) => a.action === "contract.salary.proposal_approved" && a.entityId === p5),
      propAudits.map((a: any) => a.action),
    );
    // re-approve a decided proposal → 409
    const reAp5 = await api(FIN, "POST", `/roster/salary-proposals/${p5}/approve`, {});
    check("re-approve decided proposal → 409", reAp5.status === 409, reAp5);

    // ---------------------------------------- 6. reject
    const p6 = await mkPending(CTR1, EMP2, { baseCompensation: 100000, baseCurrency: "USD" });
    const rj6 = await api(FIN, "POST", `/roster/salary-proposals/${p6}/reject`, { note: "wrong figure" });
    check("reject → 200 rejected", rj6.status === 200 && rj6.body?.proposal?.status === "rejected", rj6);
    const [emp6] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, EMP2));
    check("reject did NOT touch payroll", emp6.baseCompensation == null, emp6.baseCompensation);

    // ---------------------------------------- 7. approve with overrides
    const p7 = await mkPending(CTR1, EMP2, { baseCompensation: 100000, baseCurrency: "USD" });
    const ap7 = await api(FIN, "POST", `/roster/salary-proposals/${p7}/approve`, {
      baseCompensation: 150000,
      decisionNote: "negotiated up",
    });
    check("approve with override → 200", ap7.status === 200, ap7);
    const [emp7] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, EMP2));
    check(
      "override value applied (not the extracted one)",
      emp7.baseCompensation === 150000 && emp7.baseCurrency === "USD",
      emp7,
    );

    // ------------------------ 7b. partial override never null-clears -------
    // Employee starts with a housing allowance already set; the proposal
    // extracted ONLY baseCompensation. Approving must set baseCompensation
    // and leave the untouched payroll fields exactly as they were.
    const EMP_PARTIAL = `emp_cs_partial_${STAMP}`;
    await db.insert(atelierEmployees).values({
      id: EMP_PARTIAL,
      orgId: ORG,
      fullName: "CS Partial",
      email: `${EMP_PARTIAL}@example.test`,
      role: "consultant",
      status: "active",
      housingAllowanceMonthly: 7777,
      basicWageMonthly: 8888,
    } as any);
    const pPartial = await mkPending(CTR1, EMP_PARTIAL, { baseCompensation: 500000 });
    const apPartial = await api(FIN, "POST", `/roster/salary-proposals/${pPartial}/approve`, {});
    check("partial approve (only baseComp extracted) → 200", apPartial.status === 200, apPartial);
    const [empPartial] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, EMP_PARTIAL));
    check(
      "partial approve set baseComp; left housing/basic untouched (no null-clear)",
      empPartial.baseCompensation === 500000 &&
        empPartial.housingAllowanceMonthly === 7777 &&
        empPartial.basicWageMonthly === 8888,
      empPartial,
    );

    // ------------------------ 7c. concurrent approvers → one wins ----------
    const EMP_RACE = `emp_cs_race_${STAMP}`;
    await db.insert(atelierEmployees).values({
      id: EMP_RACE,
      orgId: ORG,
      fullName: "CS Race",
      email: `${EMP_RACE}@example.test`,
      role: "consultant",
      status: "active",
    } as any);
    const pRace = await mkPending(CTR1, EMP_RACE, { baseCompensation: 111000, baseCurrency: "AED" });
    const [rA, rB] = await Promise.all([
      api(FIN, "POST", `/roster/salary-proposals/${pRace}/approve`, {}),
      api(FIN, "POST", `/roster/salary-proposals/${pRace}/approve`, {}),
    ]);
    const statuses = [rA.status, rB.status].sort();
    check(
      "two concurrent approves → exactly one 200 and one 409",
      statuses[0] === 200 && statuses[1] === 409,
      statuses,
    );
    const raceAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityType, "person"), eq(atelierAuditEvents.entityId, EMP_RACE)));
    check(
      "concurrent approve wrote EXACTLY one payroll audit row",
      raceAudits.filter((a: any) => a.action === "roster.person.updated").length === 1,
      raceAudits.length,
    );

    // ---------------------------------------- 8. contractor counterparty skipped
    llmHits = 0;
    const CTOR = `ctor_cs_${STAMP}`;
    await db.insert(atelierContractors).values({
      id: CTOR,
      orgId: ORG,
      fullName: "CS Contractor",
      email: `${CTOR}@example.test`,
      status: "active",
    } as any);
    const CTR8 = `ctr_cs_ctor_${STAMP}`;
    await mkContract(CTR8, { counterpartyKind: "person", personId: CTOR });
    const [c8] = await db.select().from(atelierContractRecords).where(eq(atelierContractRecords.id, CTR8));
    await svc.triggerSalaryExtractionOnSigned(c8);
    const ctorProps = await db
      .select()
      .from(atelierContractSalaryProposals)
      .where(eq(atelierContractSalaryProposals.contractId, CTR8));
    check("contractor counterparty → no proposal row created", ctorProps.length === 0, ctorProps.length);
    check("contractor path did NOT hit the LLM", llmHits === 0, llmHits);

    // ---------------------------------------- 9. drift flag
    // null with no approved proposal (EMP2 only has rejected + approved via
    // override — actually approved, so use a fresh employee scenario): EMP has
    // an approved proposal (from step 5). Its comp still matches → false.
    // Note: /roster/people/:id needs a full-roster viewer (finance qualifies).
    const detEmp = await api(FIN, "GET", `/roster/people/${EMP}`);
    check(
      "drift flag false when roster comp matches approved proposal",
      detEmp.status === 200 && detEmp.body?.compDiffersFromContract === false,
      detEmp.body?.compDiffersFromContract,
    );
    // Now PATCH comp away → drift true.
    await api(FIN, "PATCH", `/roster/people/${EMP}/payroll`, { baseCompensation: 999999 });
    const detEmp2 = await api(FIN, "GET", `/roster/people/${EMP}`);
    check(
      "drift flag true after roster comp PATCHed away from contract",
      detEmp2.body?.compDiffersFromContract === true,
      detEmp2.body?.compDiffersFromContract,
    );
    // Fresh employee with no approved proposal → null.
    const detEmp2None = await api(FIN, "GET", `/roster/people/${EMP2}`);
    // EMP2 has an approved (override) proposal, so it should be false/true not
    // null; use a brand-new employee for the null case.
    const EMP3 = `emp_cs3_${STAMP}`;
    await db.insert(atelierEmployees).values({
      id: EMP3,
      orgId: ORG,
      fullName: "CS Employee Three",
      email: `${EMP3}@example.test`,
      role: "consultant",
      status: "active",
    } as any);
    const detEmp3 = await api(FIN, "GET", `/roster/people/${EMP3}`);
    check(
      "drift flag null with no approved proposal",
      detEmp3.status === 200 && detEmp3.body?.compDiffersFromContract === null,
      detEmp3.body?.compDiffersFromContract,
    );
    void detEmp2None;

    // -------- 9b. no-op approval baseline: drift still detects later edits ---
    // Employee ALREADY has comp matching what the proposal extracts, so the
    // approval changes nothing (appliedChanges empty). approvedValues must
    // still record the baseline so a later manual edit surfaces as drift.
    const EMP_NOOP = `emp_cs_noop_${STAMP}`;
    await db.insert(atelierEmployees).values({
      id: EMP_NOOP,
      orgId: ORG,
      fullName: "CS NoOp",
      email: `${EMP_NOOP}@example.test`,
      role: "consultant",
      status: "active",
      baseCompensation: 300000,
      baseCurrency: "AED",
    } as any);
    const pNoop = await mkPending(CTR1, EMP_NOOP, {
      baseCompensation: 300000,
      baseCurrency: "AED",
    });
    const apNoop = await api(FIN, "POST", `/roster/salary-proposals/${pNoop}/approve`, {});
    check("no-op approval (payroll already matches) → 200", apNoop.status === 200, apNoop);
    check(
      "no-op approval recorded empty appliedChanges",
      Array.isArray(apNoop.body?.proposal?.appliedChanges) &&
        apNoop.body.proposal.appliedChanges.length === 0,
      apNoop.body?.proposal?.appliedChanges,
    );
    const detNoop = await api(FIN, "GET", `/roster/people/${EMP_NOOP}`);
    check(
      "no-op approval → drift false (not null)",
      detNoop.body?.compDiffersFromContract === false,
      detNoop.body?.compDiffersFromContract,
    );
    await api(FIN, "PATCH", `/roster/people/${EMP_NOOP}/payroll`, { baseCompensation: 350000 });
    const detNoop2 = await api(FIN, "GET", `/roster/people/${EMP_NOOP}`);
    check(
      "no-op approval baseline detects a LATER manual edit → drift true",
      detNoop2.body?.compDiffersFromContract === true,
      detNoop2.body?.compDiffersFromContract,
    );

    // -------- 9c. mixed proposal: one field unchanged at approval, drifts later
    // baseComp changes at approval; baseCurrency already matches (no-op). Later
    // editing the initially-unchanged baseCurrency must surface as drift.
    const EMP_MIX = `emp_cs_mix_${STAMP}`;
    await db.insert(atelierEmployees).values({
      id: EMP_MIX,
      orgId: ORG,
      fullName: "CS Mixed",
      email: `${EMP_MIX}@example.test`,
      role: "consultant",
      status: "active",
      baseCompensation: 100000,
      baseCurrency: "USD",
    } as any);
    const pMix = await mkPending(CTR1, EMP_MIX, {
      baseCompensation: 400000, // changes
      baseCurrency: "USD", // already matches → no-op at approval
    });
    const apMix = await api(FIN, "POST", `/roster/salary-proposals/${pMix}/approve`, {});
    check("mixed approval → 200", apMix.status === 200, apMix);
    check(
      "mixed approval appliedChanges lists only the changed field (baseComp)",
      apMix.body?.proposal?.appliedChanges?.length === 1 &&
        apMix.body.proposal.appliedChanges[0].field === "baseCompensation",
      apMix.body?.proposal?.appliedChanges,
    );
    const detMix = await api(FIN, "GET", `/roster/people/${EMP_MIX}`);
    check("mixed approval → drift false immediately after", detMix.body?.compDiffersFromContract === false, detMix.body?.compDiffersFromContract);
    // Drift the field that was UNCHANGED at approval time.
    await api(FIN, "PATCH", `/roster/people/${EMP_MIX}/payroll`, { baseCurrency: "EUR" });
    const detMix2 = await api(FIN, "GET", `/roster/people/${EMP_MIX}`);
    check(
      "mixed: editing the initially-unchanged field → drift true",
      detMix2.body?.compDiffersFromContract === true,
      detMix2.body?.compDiffersFromContract,
    );

    // ---------------------------------------- 10. on-demand 202 + 409
    llmHits = 0;
    const CTR10 = `ctr_cs_ondemand_${STAMP}`;
    await mkContract(CTR10, {
      personId: EMP3,
      fieldValues: { annual_base_salary: "USD 200,000" },
    });
    const od1 = await api(FIN, "POST", `/contracts/${CTR10}/salary-extract`, {});
    check("on-demand extract → 202 with proposalId", od1.status === 202 && !!od1.body?.proposalId, od1);
    if (od1.body?.proposalId) cleanupProposalIds.push(od1.body.proposalId);
    const od2 = await api(FIN, "POST", `/contracts/${CTR10}/salary-extract`, {});
    check("second on-demand while live → 409 proposal-in-flight", od2.status === 409, od2);
    const odCons = await api(CONS, "POST", `/contracts/${CTR10}/salary-extract`, {});
    check("consultant on-demand extract → 403", odCons.status === 403, odCons);

    // Race-safe create: two PARALLEL on-demand requests on a fresh contract →
    // exactly one 202 (winner) and one 409 (lost the unique-index race), and
    // only ONE live proposal row exists.
    const EMP_ODRACE = `emp_cs_odrace_${STAMP}`;
    await db.insert(atelierEmployees).values({
      id: EMP_ODRACE,
      orgId: ORG,
      fullName: "CS OnDemand Race",
      email: `${EMP_ODRACE}@example.test`,
      role: "consultant",
      status: "active",
    } as any);
    const CTR_ODRACE = `ctr_cs_odrace_${STAMP}`;
    await mkContract(CTR_ODRACE, {
      personId: EMP_ODRACE,
      fieldValues: { annual_base_salary: "USD 123,000" },
    });
    const [orA, orB] = await Promise.all([
      api(FIN, "POST", `/contracts/${CTR_ODRACE}/salary-extract`, {}),
      api(FIN, "POST", `/contracts/${CTR_ODRACE}/salary-extract`, {}),
    ]);
    const odStatuses = [orA.status, orB.status].sort();
    check(
      "two parallel on-demand creates → one 202 one 409",
      odStatuses[0] === 202 && odStatuses[1] === 409,
      odStatuses,
    );
    const liveRows = await db
      .select()
      .from(atelierContractSalaryProposals)
      .where(
        and(
          eq(atelierContractSalaryProposals.contractId, CTR_ODRACE),
          inArray(atelierContractSalaryProposals.status, ["processing", "pending"]),
        ),
      );
    check("parallel on-demand → exactly one live proposal row", liveRows.length === 1, liveRows.length);
    // list surface
    const list = await api(FIN, "GET", `/roster/salary-proposals?status=approved`);
    check(
      "list surface returns approved proposals with current comp side-by-side",
      list.status === 200 &&
        Array.isArray(list.body?.proposals) &&
        list.body.proposals.some((p: any) => p.id === p5 && p.current != null),
      list.body?.proposals?.length,
    );
    const listCons = await api(CONS, "GET", `/roster/salary-proposals`);
    check("consultant list → 403", listCons.status === 403, listCons);
  } finally {
    try {
      await db
        .delete(atelierAuditEvents)
        .where(
          inArray(atelierAuditEvents.entityId, [
            EMP,
            EMP2,
            `emp_cs3_${STAMP}`,
            `emp_cs_partial_${STAMP}`,
            `emp_cs_race_${STAMP}`,
            `emp_cs_odrace_${STAMP}`,
            `emp_cs_noop_${STAMP}`,
            `emp_cs_mix_${STAMP}`,
            ...cleanupProposalIds,
          ]),
        );
      await db.delete(atelierContractSalaryProposals).where(eq(atelierContractSalaryProposals.orgId, ORG));
      await db.delete(atelierContractRecords).where(inArray(atelierContractRecords.id, cleanupContractIds));
      await db.delete(atelierContractTemplateVersions).where(eq(atelierContractTemplateVersions.id, CTR_TV));
      await db.delete(atelierContractors).where(eq(atelierContractors.id, `ctor_cs_${STAMP}`));
      await db
        .delete(atelierEmployees)
        .where(
          inArray(atelierEmployees.id, [
            EMP,
            EMP2,
            `emp_cs3_${STAMP}`,
            `emp_cs_partial_${STAMP}`,
            `emp_cs_race_${STAMP}`,
            `emp_cs_odrace_${STAMP}`,
            `emp_cs_noop_${STAMP}`,
            `emp_cs_mix_${STAMP}`,
          ]),
        );
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FIN, CONS]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    stub.close();
    await pool.end();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
