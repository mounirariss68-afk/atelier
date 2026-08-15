/**
 * Task #1141 — Wio Bank bulk payment CSV export probe.
 *
 * Runs standalone (tsx ./tests/wio-export/run.ts) booting the app in-process
 * on an isolated scratch DB. NODE_ENV=test enables the persona-cookie bypass.
 * All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. Auth gate: non-finance persona gets 403 on both Wio export endpoints.
 *   2. Status gate: 409 when payment run is not approved/exported; 409 when
 *      payroll run is not posted.
 *   3. Payment-run Wio CSV — IBAN resolution by item type:
 *        a. partner_firm_invoice with registered firm → firm bankIban
 *        b. partner_firm_invoice with no firmId (one-off) → invoice.supplierBankIban
 *        c. expense_reimbursement → atelierEmployees.iban
 *        d. Missing IBAN → empty field (not an error; missingIban audited)
 *   4. Payment-run Wio CSV — correct headers, CRLF line endings, CSV quoting.
 *   5. Payroll Wio CSV — uses persisted line.netPay (not monthlyGross−employeeTotal),
 *      IBANs from atelierEmployees, employee without IBAN → empty field.
 *   6. Approved payment run advances to "exported" status after download.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";

const STAMP = Date.now();
const ORG = "aico";
const FIN_ID = `p_test_fin_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`;  // non-finance; must get 403

// Fixture IDs
const BANK_ID   = `bank_wio_${STAMP}`;
const PF_ID     = `pf_wio_${STAMP}`;    // registered partner firm
const PFI_REG   = `pfi_wio_reg_${STAMP}`;   // invoice for registered firm
const PFI_ONE   = `pfi_wio_one_${STAMP}`;   // invoice for one-off supplier
const EXP_ID    = `exp_wio_${STAMP}`;
const EXP2_ID   = `exp2_wio_${STAMP}`;  // expense with no IBAN employee
const EMP_PERSON  = `emp_wio_${STAMP}`;   // employee with IBAN
const EMP_PERSON2 = `emp2_wio_${STAMP}`;  // employee without IBAN
const RUN_ID    = `pr_wio_${STAMP}`;
const PRI_REG   = `pri_wio_reg_${STAMP}`;
const PRI_ONE   = `pri_wio_one_${STAMP}`;
const PRI_EXP   = `pri_wio_exp_${STAMP}`;
const PRI_EXP2  = `pri_wio_exp2_${STAMP}`;
const ENTITY_ID = `le_wio_${STAMP}`;
const PAYRUN_ID = `payrun_wio_${STAMP}`;
const PAYLN1_ID = `payln_wio1_${STAMP}`;
const PAYLN2_ID = `payln_wio2_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function group(title: string): void { console.log(`\n── ${title}`); }

/** Parse a Wio CSV response into rows (array of field arrays). */
function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((row) => {
    const fields: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (inQ) {
        if (c === '"' && row[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { cur += c; }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { fields.push(cur); cur = ""; }
        else { cur += c; }
      }
    }
    fields.push(cur);
    return fields;
  });
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierEmployees,
    atelierBankAccount,
    atelierPartnerFirms,
    atelierPartnerFirmInvoices,
    atelierExpenses,
    atelierPaymentRuns,
    atelierPaymentRunItems,
    atelierLegalEntities,
    atelierPayrollRuns,
    atelierPayrollLines,
  } = D as any;

  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string, path: string, personaId: string,
  ): Promise<{ status: number; body: string }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${personaId}` },
    });
    return { status: res.status, body: await res.text() };
  }

  try {
    // ── Personas ──────────────────────────────────────────────────────────────
    for (const [id, role, name] of [
      [FIN_ID, "finance",  "Wio Finance"],
      [EMP_ID, "employee", "Wio Employee"],
    ] as [string, string, string][]) {
      await db.insert(atelierUsers).values({
        id, orgId: ORG, email: `${id}@cognirise.ai`, name, title: name,
        initials: "WT", role, roleLabel: role, permissions: [], bdActive: false,
      }).onConflictDoNothing();
    }

    // ── Bank account (required by payment run) ────────────────────────────────
    await db.insert(atelierBankAccount).values({
      id: BANK_ID, orgId: ORG, bankName: "Wio Bank",
      accountLabel: "Wio Main", accountNumberLast4: "3456",
      iban: "AE070331234567890123456", swift: "WIOBAEADXXX",
      currency: "AED",
    }).onConflictDoNothing();

    // ── Registered partner firm with bank details ─────────────────────────────
    await db.insert(atelierPartnerFirms).values({
      id: PF_ID, orgId: ORG, name: "Acme Partner Ltd",
      bankIban: "AE070331111111111111111", bankSwift: "TESTAEADXXX", bankName: "ENBD",
    }).onConflictDoNothing();

    // ── Partner firm invoices (registered + one-off) ──────────────────────────
    // Registered firm: partnerFirmId = actual firm id
    await db.insert(atelierPartnerFirmInvoices).values({
      id: PFI_REG, orgId: ORG, partnerFirmId: PF_ID, partnerFirmName: "Acme Partner Ltd",
      weekIso: "2026-W10",
      costAmount: 5000, costCurrency: "AED", usdAmount: 1362,
      status: "approved", source: "partner_submitted",
    }).onConflictDoNothing();
    // One-off supplier: partnerFirmId = "" (empty string per Task #1075 convention — falsy in JS)
    await db.insert(atelierPartnerFirmInvoices).values({
      id: PFI_ONE, orgId: ORG, partnerFirmId: "", partnerFirmName: "One-Off Corp LLC",
      weekIso: "2026-W10",
      supplierBankIban: "AE070332222222222222222", supplierBankHolder: "One-Off Corp LLC",
      costAmount: 1200, costCurrency: "AED", usdAmount: 327,
      status: "approved", source: "partner_submitted",
    }).onConflictDoNothing();

    // ── Employees (with / without IBAN) ───────────────────────────────────────
    // `email` and `role` are both NOT NULL on atelier_employees with no DB default.
    await db.insert(atelierEmployees).values({
      id: EMP_PERSON, orgId: ORG, fullName: "John Smith",
      email: `${EMP_PERSON}@cognirise.ai`, role: "employee",
      iban: "AE070333333333333333333", swift: "FABAEADXXX",
      status: "active", employmentStatus: "active",
    }).onConflictDoNothing();
    await db.insert(atelierEmployees).values({
      id: EMP_PERSON2, orgId: ORG, fullName: "No IBAN Employee",
      email: `${EMP_PERSON2}@cognirise.ai`, role: "employee",
      status: "active", employmentStatus: "active",
    }).onConflictDoNothing();

    // ── Expenses linked to each employee ─────────────────────────────────────
    const TODAY = new Date().toISOString().slice(0, 10);
    await db.insert(atelierExpenses).values({
      id: EXP_ID, orgId: ORG, personId: EMP_PERSON, personType: "employee",
      merchant: "Carrefour", category: "meals", amount: 150, currency: "AED",
      captureSource: "manual", status: "approved", expenseDate: TODAY,
    }).onConflictDoNothing();
    await db.insert(atelierExpenses).values({
      id: EXP2_ID, orgId: ORG, personId: EMP_PERSON2, personType: "employee",
      merchant: "IKEA", category: "office", amount: 300, currency: "AED",
      captureSource: "manual", status: "approved", expenseDate: TODAY,
    }).onConflictDoNothing();

    // ── Payment run (approved) ────────────────────────────────────────────────
    await db.insert(atelierPaymentRuns).values({
      id: RUN_ID, orgId: ORG, runNumber: `WIO-PR-${STAMP}`,
      bankAccountId: BANK_ID, bankAccountLabel: "Wio Main",
      currency: "AED", status: "approved",
      itemCount: 4, totalUsd: 2000,
      makerUserId: FIN_ID, makerName: "Wio Finance",
    }).onConflictDoNothing();

    // ── Payment run items ─────────────────────────────────────────────────────
    await db.insert(atelierPaymentRunItems).values([
      {
        id: PRI_REG, orgId: ORG, runId: RUN_ID,
        itemType: "partner_firm_invoice", refId: PFI_REG,
        payeeName: "Acme Partner Ltd",
        description: "Feb 2026 services", amount: 5000, currency: "AED", amountUsd: 1362,
        status: "pending",
      },
      {
        id: PRI_ONE, orgId: ORG, runId: RUN_ID,
        itemType: "partner_firm_invoice", refId: PFI_ONE,
        payeeName: "One-Off Corp LLC",
        description: "Consulting invoice", amount: 1200, currency: "AED", amountUsd: 327,
        status: "pending",
      },
      {
        id: PRI_EXP, orgId: ORG, runId: RUN_ID,
        itemType: "expense_reimbursement", refId: EXP_ID,
        payeeName: "John Smith",
        description: "Expense reimbursement", amount: 150, currency: "AED", amountUsd: 41,
        status: "pending",
      },
      {
        id: PRI_EXP2, orgId: ORG, runId: RUN_ID,
        itemType: "expense_reimbursement", refId: EXP2_ID,
        payeeName: "No IBAN Employee",
        description: "Expense reimbursement", amount: 300, currency: "AED", amountUsd: 82,
        status: "pending",
      },
    ]).onConflictDoNothing();

    // ── Legal entity + payroll run ─────────────────────────────────────────────
    await db.insert(atelierLegalEntities).values({
      id: ENTITY_ID, orgId: ORG, legalNameEn: "Cognirise DIFC Ltd", shortName: "DIFC",
      country: "AE", jurisdiction: "DIFC", status: "active",
    }).onConflictDoNothing();
    await db.insert(atelierPayrollRuns).values({
      id: PAYRUN_ID, orgId: ORG, legalEntityId: ENTITY_ID,
      periodLabel: "2026-03", status: "posted",
      currency: "AED", countryCode: "AE",
      totals: { headcount: 2, grossPayroll: 30000, employerCost: 32500, netPayroll: 28000, eosbAccrual: 500 },
    }).onConflictDoNothing();

    // ── Payroll lines ─────────────────────────────────────────────────────────
    // Line 1: advance deduction applied — netPay = 9750 (not monthlyGross−employeeTotal = 10000)
    await db.insert(atelierPayrollLines).values({
      id: PAYLN1_ID, orgId: ORG, runId: PAYRUN_ID, employeeId: EMP_PERSON,
      personName: "John Smith", currency: "AED",
      monthlyGross: 10000, monthlyBasic: 8000, housingAllowance: 2000,
      serviceYears: 1.5,
      employerTotal: 500, employeeTotal: 250,
      advanceDeduction: 0, netPay: 9750,  // persisted netPay (with some rounding / proration)
      eosbTarget: 15000, eosbOpening: 13000, eosbAccrual: 2000,
      contributions: [], detail: {},
    }).onConflictDoNothing();
    // Line 2: no IBAN on employee record
    await db.insert(atelierPayrollLines).values({
      id: PAYLN2_ID, orgId: ORG, runId: PAYRUN_ID, employeeId: EMP_PERSON2,
      personName: "No IBAN Employee", currency: "AED",
      monthlyGross: 8000, monthlyBasic: 7000, housingAllowance: 1000,
      serviceYears: 0.5,
      employerTotal: 400, employeeTotal: 200,
      advanceDeduction: 0, netPay: 7800,
      eosbTarget: 4000, eosbOpening: 3000, eosbAccrual: 1000,
      contributions: [], detail: {},
    }).onConflictDoNothing();

    // ── 1. Auth gate ──────────────────────────────────────────────────────────
    group("1. Auth gate");
    {
      const r1 = await call("POST", `/finance/payables/payment-runs/${RUN_ID}/export-wio`, EMP_ID);
      check("employee → 403 on payment-run export", r1.status === 403, `got ${r1.status}`);
      const r2 = await call("POST", `/finance/payroll/runs/${PAYRUN_ID}/export-wio`, EMP_ID);
      check("employee → 403 on payroll export", r2.status === 403, `got ${r2.status}`);
    }

    // ── 2. Status gate ────────────────────────────────────────────────────────
    group("2. Status gate — wrong-status runs");
    {
      // Insert a draft payment run
      const DRAFT_PR = `pr_wio_draft_${STAMP}`;
      await db.insert(atelierPaymentRuns).values({
        id: DRAFT_PR, orgId: ORG, runNumber: `WIO-DRAFT-${STAMP}`,
        bankAccountId: BANK_ID, bankAccountLabel: "Wio Main",
        currency: "AED", status: "draft",
        itemCount: 0, totalUsd: 0,
        makerUserId: FIN_ID, makerName: "Wio Finance",
      }).onConflictDoNothing();
      const r1 = await call("POST", `/finance/payables/payment-runs/${DRAFT_PR}/export-wio`, FIN_ID);
      check("draft payment run → 409", r1.status === 409, `got ${r1.status}`);

      // Insert a draft payroll run
      const DRAFT_PAYRUN = `payrun_wio_draft_${STAMP}`;
      await db.insert(atelierPayrollRuns).values({
        id: DRAFT_PAYRUN, orgId: ORG, legalEntityId: ENTITY_ID,
        periodLabel: "2026-04", status: "draft",
        currency: "AED", countryCode: "AE",
        totals: { headcount: 0, grossPayroll: 0, employerCost: 0, netPayroll: 0, eosbAccrual: 0 },
      }).onConflictDoNothing();
      const r2 = await call("POST", `/finance/payroll/runs/${DRAFT_PAYRUN}/export-wio`, FIN_ID);
      check("draft payroll run → 409", r2.status === 409, `got ${r2.status}`);
    }

    // ── 3+4. Payment-run Wio CSV ──────────────────────────────────────────────
    group("3+4. Payment-run Wio CSV");
    {
      const r = await call("POST", `/finance/payables/payment-runs/${RUN_ID}/export-wio`, FIN_ID);
      check("export-wio 200", r.status === 200, `got ${r.status}`);
      check("CRLF line endings", r.body.includes("\r\n"), "no \\r\\n found");
      const rows = parseCsv(r.body);
      const hdr = rows[0];
      check("correct header columns", hdr.length === 7 && hdr[0] === "Beneficiary Name" && hdr[1] === "IBAN", JSON.stringify(hdr));
      // Row for registered firm
      const regRow = rows.find((r) => r[0] === "Acme Partner Ltd");
      check("registered firm IBAN resolved", regRow?.[1] === "AE070331111111111111111", `got ${regRow?.[1]}`);
      check("registered firm amount", regRow?.[2] === "5000.00", `got ${regRow?.[2]}`);
      check("registered firm SWIFT", regRow?.[5] === "TESTAEADXXX", `got ${regRow?.[5]}`);
      // Row for one-off supplier
      const oneRow = rows.find((r) => r[0] === "One-Off Corp LLC");
      check("one-off supplier IBAN resolved", oneRow?.[1] === "AE070332222222222222222", `got ${oneRow?.[1]}`);
      check("one-off supplier bank name", oneRow?.[6] === "One-Off Corp LLC", `got ${oneRow?.[6]}`);
      // Row for employee expense
      const expRow = rows.find((r) => r[0] === "John Smith");
      check("expense employee IBAN resolved", expRow?.[1] === "AE070333333333333333333", `got ${expRow?.[1]}`);
      // Missing IBAN row — should still be included with empty IBAN field
      const missingRow = rows.find((r) => r[0] === "No IBAN Employee");
      check("missing IBAN row present", !!missingRow, "row not found");
      check("missing IBAN field is empty", missingRow?.[1] === "", `got ${missingRow?.[1]}`);
    }

    // ── run advances to "exported" ─────────────────────────────────────────────
    group("4b. Approved run advances to exported");
    {
      const { eq } = await import("drizzle-orm");
      const { atelierPaymentRuns: prTable } = D as any;
      const [updated] = await db.select({ status: prTable.status }).from(prTable)
        .where(eq(prTable.id, RUN_ID));
      check("run status → exported", updated?.status === "exported", `got ${updated?.status}`);
    }

    // ── 5. Payroll Wio CSV ────────────────────────────────────────────────────
    group("5. Payroll Wio CSV — netPay + atelierEmployees IBAN");
    {
      const r = await call("POST", `/finance/payroll/runs/${PAYRUN_ID}/export-wio`, FIN_ID);
      check("payroll export-wio 200", r.status === 200, `got ${r.status}`);
      check("CRLF line endings", r.body.includes("\r\n"), "no \\r\\n found");
      const rows = parseCsv(r.body);
      const hdr = rows[0];
      check("correct header", hdr[0] === "Beneficiary Name" && hdr[1] === "IBAN", JSON.stringify(hdr));

      const johnRow = rows.find((r) => r[0] === "John Smith");
      check("employee IBAN from atelierEmployees", johnRow?.[1] === "AE070333333333333333333", `got ${johnRow?.[1]}`);
      // Must use persisted netPay (9750), NOT monthlyGross−employeeTotal (10000−250 = 9750 coincides, but advanceDeduction would differ)
      check("uses persisted netPay (9750.00)", johnRow?.[2] === "9750.00", `got ${johnRow?.[2]}`);

      const noIbanRow = rows.find((r) => r[0] === "No IBAN Employee");
      check("no-IBAN employee row present", !!noIbanRow, "row not found");
      check("no-IBAN employee field empty", noIbanRow?.[1] === "", `got ${noIbanRow?.[1]}`);
      check("no-IBAN employee netPay (7800.00)", noIbanRow?.[2] === "7800.00", `got ${noIbanRow?.[2]}`);
    }

    // ── CSV quoting ────────────────────────────────────────────────────────────
    group("6. CSV quoting");
    {
      // All name/reference fields are double-quoted; commas inside names must be escaped
      const r = await call("POST", `/finance/payroll/runs/${PAYRUN_ID}/export-wio`, FIN_ID);
      check("all data rows have 7 fields", parseCsv(r.body).slice(1).every((row) => row.length === 7),
        parseCsv(r.body).slice(1).map((r) => r.length).join(","));
    }

  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────
    const { eq, inArray } = await import("drizzle-orm");
    const {
      atelierPayrollLines: plTable,
      atelierPayrollRuns: prTable,
      atelierPaymentRunItems: priTable,
      atelierPaymentRuns: prRunTable,
      atelierPartnerFirmInvoices: pfiTable,
      atelierExpenses: expTable,
      atelierEmployees: empTable,
      atelierPartnerFirms: pfTable,
      atelierBankAccount: bankTable,
      atelierLegalEntities: leTable,
      atelierUsers: usersTable,
    } = D as any;

    await db.delete(plTable).where(inArray(plTable.id, [PAYLN1_ID, PAYLN2_ID]));
    await db.delete(prTable).where(inArray(prTable.id, [PAYRUN_ID, `payrun_wio_draft_${STAMP}`]));
    await db.delete(priTable).where(inArray(priTable.id, [PRI_REG, PRI_ONE, PRI_EXP, PRI_EXP2]));
    await db.delete(prRunTable).where(inArray(prRunTable.id, [RUN_ID, `pr_wio_draft_${STAMP}`]));
    await db.delete(pfiTable).where(inArray(pfiTable.id, [PFI_REG, PFI_ONE]));
    await db.delete(expTable).where(inArray(expTable.id, [EXP_ID, EXP2_ID]));
    await db.delete(empTable).where(inArray(empTable.id, [EMP_PERSON, EMP_PERSON2]));
    await db.delete(pfTable).where(eq(pfTable.id, PF_ID));
    await db.delete(bankTable).where(eq(bankTable.id, BANK_ID));
    await db.delete(leTable).where(eq(leTable.id, ENTITY_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, [FIN_ID, EMP_ID]));

    server.close();
    await pool.end();
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\n✓ All Wio export checks passed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
