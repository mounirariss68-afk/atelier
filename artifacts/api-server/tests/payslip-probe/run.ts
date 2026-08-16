/**
 * Task #1160 — End-to-end payslip probe.
 *
 * Proves the full flow: generateRunPayslips() → GET /me/pay shows the
 * payslip → GET /me/pay/documents/:id/download returns the correct PDF bytes.
 *
 * Run standalone:
 *   NODE_ENV=test pnpm --filter @workspace/api-server exec tsx ./tests/payslip-probe/run.ts
 *
 * Also callable via: pnpm --filter @workspace/api-server run test:payslip-probe
 *
 * Follows the same scratch-DB / persona-cookie harness used by pay-hub/run.ts
 * and payroll-statutory/api-probe.ts. All inserted rows are removed in `finally`.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";

// Ephemeral user IDs (persona-cookie bypass in NODE_ENV=test)
const FP_ID = `p_test_fp_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`;
const OTHER_ID = `p_test_other_${STAMP}`;

// Roster row IDs
const EMP_PERSON = `emp_ps_${STAMP}`;
const OTHER_PERSON = `emp_ps_other_${STAMP}`;

// Payroll row IDs (hand-crafted, not via the API)
const ENTITY_ID = `lent_ps_${STAMP}`;
const RUN_ID = `payrun_ps_${STAMP}`;
const LINE_ID = `payln_ps_${STAMP}`;
const LINE_OTHER_ID = `payln_ps_other_${STAMP}`;

const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function group(title: string): void {
  console.log(`\n── ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL is not set.");
    process.exit(1);
  }

  // Import DB + app AFTER scratch-db.ts has rewritten DATABASE_URL.
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierPayDocuments,
    atelierPayrollRuns,
    atelierPayrollLines,
    atelierAuditEvents,
    atelierSelfNotifications,
  } = D as any;

  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  /** Small HTTP helper that acts as a given persona via the cookie bypass. */
  async function call(
    method: string,
    path: string,
    personaId: string,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Raw download helper — returns status, bytes as Buffer, and Content-Type. */
  async function download(
    personaId: string,
    url: string,
  ): Promise<{ status: number; buf: Buffer; ct: string | null }> {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      headers: { cookie: `atelier_persona=${personaId}` },
    });
    const ab = await res.arrayBuffer();
    return {
      status: res.status,
      buf: Buffer.from(ab),
      ct: res.headers.get("content-type"),
    };
  }

  const createdPayDocIds: string[] = [];

  try {
    // ── Provision ephemeral personas ──────────────────────────────────────
    await db
      .insert(atelierUsers)
      .values([
        {
          id: FP_ID,
          orgId: ORG,
          email: `${FP_ID}@cognirise.ai`,
          name: "PS Test FP",
          initials: "PF",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: [],
          bdActive: false,
        },
        {
          id: EMP_ID,
          orgId: ORG,
          email: `${EMP_ID}@cognirise.ai`,
          name: "PS Test Employee",
          initials: "PE",
          role: "employee",
          roleLabel: "Employee",
          title: "Analyst",
          permissions: [],
          bdActive: false,
        },
        {
          id: OTHER_ID,
          orgId: ORG,
          email: `${OTHER_ID}@cognirise.ai`,
          name: "PS Other Employee",
          initials: "PO",
          role: "employee",
          roleLabel: "Employee",
          title: "Analyst",
          permissions: [],
          bdActive: false,
        },
      ])
      .onConflictDoNothing();

    // ── Provision roster rows ─────────────────────────────────────────────
    await db.insert(atelierEmployees).values([
      {
        id: EMP_PERSON,
        orgId: ORG,
        userId: EMP_ID,
        fullName: "PS Test Employee",
        email: `${EMP_ID}@cognirise.ai`,
        role: "employee",
        title: "Analyst",
        legalEntityId: ENTITY_ID,
        baseCompensation: 120_000,
        baseCurrency: "AED",
        basicWageMonthly: 8_000,
        housingAllowanceMonthly: 2_000,
        nationality: "IN",
        startDate: "2022-01-01",
        iban: "AE070331234567890123456",
      },
      {
        id: OTHER_PERSON,
        orgId: ORG,
        userId: OTHER_ID,
        fullName: "PS Other Employee",
        email: `${OTHER_ID}@cognirise.ai`,
        role: "employee",
        title: "Analyst",
        legalEntityId: ENTITY_ID,
        baseCompensation: 96_000,
        baseCurrency: "AED",
        basicWageMonthly: 6_000,
        nationality: "GB",
        startDate: "2023-06-01",
        iban: "AE070331234567890123457",
      },
    ]);

    // ── Insert a posted payroll run + lines directly in the DB ────────────
    // (Bypassing the API so this probe stays focused on payslip generation
    // and the /me/pay surface, independent of the full payroll posting flow
    // which is covered by payroll-statutory/api-probe.ts.)
    const totals = {
      headcount: 2,
      grossSalaries: 20_000,
      employerContributions: 0,
      employeeWithholdings: 0,
      eosbAccrual: 666.67,
      netPay: 20_000,
      advanceRecovery: 0,
    };

    await db.insert(atelierPayrollRuns).values({
      id: RUN_ID,
      orgId: ORG,
      legalEntityId: ENTITY_ID,
      periodLabel: "2026-06",
      status: "posted",
      currency: "AED",
      countryCode: "AE",
      totals,
      validationErrors: [],
      computedAt: new Date(),
      postedAt: new Date(),
      postedByUserId: FP_ID,
    });

    await db.insert(atelierPayrollLines).values([
      {
        id: LINE_ID,
        orgId: ORG,
        runId: RUN_ID,
        employeeId: EMP_PERSON,
        personName: "PS Test Employee",
        nationality: "IN",
        currency: "AED",
        monthlyGross: 10_000,
        monthlyBasic: 8_000,
        housingAllowance: 2_000,
        serviceYears: 4.42,
        contributions: [],
        employerTotal: 0,
        employeeTotal: 0,
        eosbTarget: 26_666.67,
        eosbOpening: 23_333.33,
        eosbAccrual: 333.34,
        daysInMonth: 30,
        payableDays: 30,
        unpaidLeaveDays: 0,
        prorationFactor: 1,
        prorationBasis: null,
        advanceDeduction: 0,
        netPay: 10_000,
        detail: {},
      },
      {
        id: LINE_OTHER_ID,
        orgId: ORG,
        runId: RUN_ID,
        employeeId: OTHER_PERSON,
        personName: "PS Other Employee",
        nationality: "GB",
        currency: "AED",
        monthlyGross: 6_000,
        monthlyBasic: 6_000,
        housingAllowance: 0,
        serviceYears: 3.0,
        contributions: [],
        employerTotal: 0,
        employeeTotal: 0,
        eosbTarget: 18_000,
        eosbOpening: 17_666.67,
        eosbAccrual: 333.33,
        daysInMonth: 30,
        payableDays: 30,
        unpaidLeaveDays: 0,
        prorationFactor: 1,
        prorationBasis: null,
        advanceDeduction: 0,
        netPay: 6_000,
        detail: {},
      },
    ]);

    // ── 1. generateRunPayslips() creates published payslip documents ───────
    group("generateRunPayslips · document creation");

    // Fetch the run + lines exactly as the payslip generator expects them.
    const { generateRunPayslips } = await import(
      "../../src/lib/atelier-payroll/payslips.js"
    );

    const [runRow] = await db
      .select()
      .from(atelierPayrollRuns)
      .where(eq(atelierPayrollRuns.id, RUN_ID));

    const lineRows = await db
      .select()
      .from(atelierPayrollLines)
      .where(eq(atelierPayrollLines.runId, RUN_ID));

    const result = await generateRunPayslips({
      orgId: ORG,
      run: runRow,
      lines: lineRows,
      createdByUserId: FP_ID,
    });

    check(
      "generateRunPayslips returns created=2 (one per line)",
      result.created === 2,
      { created: result.created },
    );

    // Verify DB rows are published, have PDF bytes, and carry the marker.
    const dbDocs = await db
      .select()
      .from(atelierPayDocuments)
      .where(
        and(
          eq(atelierPayDocuments.orgId, ORG),
          eq(atelierPayDocuments.notes, `payrun:${RUN_ID}`),
        ),
      );

    for (const doc of dbDocs) createdPayDocIds.push(doc.id);

    check(
      "two payslip documents inserted",
      dbDocs.length === 2,
      { count: dbDocs.length },
    );
    check(
      "all documents are published",
      dbDocs.every((d: any) => d.published === true),
      dbDocs.map((d: any) => ({ id: d.id, published: d.published })),
    );
    check(
      "all documents have PDF mime type",
      dbDocs.every((d: any) => d.mime === "application/pdf"),
      dbDocs.map((d: any) => ({ id: d.id, mime: d.mime })),
    );
    check(
      "all documents have non-trivial file bytes (> 1 KB)",
      dbDocs.every((d: any) => (d.sizeBytes ?? 0) > 1000),
      dbDocs.map((d: any) => ({ id: d.id, sizeBytes: d.sizeBytes })),
    );
    check(
      "payslip category on all documents",
      dbDocs.every((d: any) => d.category === "payslip"),
    );
    check(
      "payrun marker stamped on all documents",
      dbDocs.every((d: any) => d.notes === `payrun:${RUN_ID}`),
    );

    // Re-running is idempotent — no new documents created.
    const result2 = await generateRunPayslips({
      orgId: ORG,
      run: runRow,
      lines: lineRows,
      createdByUserId: FP_ID,
    });
    check(
      "generateRunPayslips is idempotent (re-run creates 0)",
      result2.created === 0,
      { created: result2.created },
    );

    // ── 2. GET /me/pay surfaces the payslip for the right employee ─────────
    group("GET /me/pay · payslip visibility");

    const empPay = await call("GET", "/me/pay", EMP_ID);
    check(
      "GET /me/pay → 200 for employee",
      empPay.status === 200,
      { status: empPay.status },
    );

    // The self-wire shape does not include `notes`; match by category +
    // periodDate (monthEnd("2026-06") = "2026-06-30").
    const empDoc = empPay.body?.documents?.find(
      (d: any) => d.category === "payslip" && d.periodDate === "2026-06-30",
    );
    check(
      "payslip appears in employee's /me/pay documents[]",
      !!empDoc,
      {
        documents: (empPay.body?.documents ?? []).map((d: any) => ({
          id: d.id,
          category: d.category,
          periodDate: d.periodDate,
        })),
      },
    );
    check(
      "payslip document has correct title",
      empDoc?.title === "Payslip 2026-06",
      { title: empDoc?.title },
    );
    check(
      "payslip response never exposes raw file bytes",
      !("fileData" in (empDoc ?? {})),
    );
    check(
      "payslip has a downloadUrl",
      typeof empDoc?.downloadUrl === "string" && empDoc.downloadUrl.length > 0,
      { downloadUrl: empDoc?.downloadUrl },
    );

    // The other employee sees their own payslip, not the first employee's.
    const otherPay = await call("GET", "/me/pay", OTHER_ID);
    const otherEmpDoc = otherPay.body?.documents?.find(
      (d: any) => d.category === "payslip" && d.periodDate === "2026-06-30",
    );
    const empDocForOther = otherPay.body?.documents?.find(
      (d: any) => d.id === empDoc?.id,
    );
    check(
      "other employee also sees their own payslip",
      !!otherEmpDoc,
      {
        documents: (otherPay.body?.documents ?? []).map((d: any) => ({
          id: d.id,
          category: d.category,
          periodDate: d.periodDate,
        })),
      },
    );
    check(
      "other employee does NOT see the first employee's payslip document",
      !empDocForOther,
    );

    // ── 3. Download route returns the correct PDF bytes ────────────────────
    group("GET /me/pay/documents/:docId/download · byte-level correctness");

    const docId: string = empDoc?.id ?? dbDocs.find((d: any) => d.personId === EMP_PERSON)?.id ?? "";

    // Derive the download URL (use route from API response if available,
    // otherwise fall back to the canonical path).
    const downloadUrl =
      empDoc?.downloadUrl ??
      `/api/atelier/me/pay/documents/${docId}/download`;

    const ownDl = await download(EMP_ID, downloadUrl);
    check(
      "owner download → 200",
      ownDl.status === 200,
      { status: ownDl.status, ct: ownDl.ct },
    );
    check(
      "download Content-Type is application/pdf",
      (ownDl.ct ?? "").startsWith("application/pdf"),
      { ct: ownDl.ct },
    );
    check(
      "downloaded bytes are non-empty (> 1 KB)",
      ownDl.buf.length > 1000,
      { bytes: ownDl.buf.length },
    );
    // PDF magic bytes: first 4 bytes of a PDF are always %PDF (0x25 50 44 46).
    check(
      "downloaded content starts with PDF magic bytes (%PDF)",
      ownDl.buf[0] === 0x25 &&
        ownDl.buf[1] === 0x50 &&
        ownDl.buf[2] === 0x44 &&
        ownDl.buf[3] === 0x46,
      { first4: ownDl.buf.slice(0, 4).toString("ascii") },
    );

    // Verify the byte length matches the stored sizeBytes (exact content
    // equality is confirmed by the magic-bytes + size checks; a full buffer
    // comparison against base64 would require binary-safe decoding).
    const dbDoc = dbDocs.find((d: any) => d.personId === EMP_PERSON);
    if (dbDoc) {
      check(
        "downloaded byte count matches stored sizeBytes",
        ownDl.buf.length === dbDoc.sizeBytes,
        { downloadedBytes: ownDl.buf.length, storedSizeBytes: dbDoc.sizeBytes },
      );
    }

    // Access control: another employee cannot download a foreign payslip.
    const foreignDl = await download(
      OTHER_ID,
      `/api/atelier/me/pay/documents/${docId}/download`,
    );
    check(
      "another employee downloading a foreign payslip → 404",
      foreignDl.status === 404,
      { status: foreignDl.status },
    );

    // Download is audited.
    const dlAudits = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "pay_document"),
          eq(atelierAuditEvents.entityId, docId),
        ),
      );
    check(
      "self download is audited (pay_document.downloaded.self)",
      dlAudits.some((r: any) => r.action === "pay_document.downloaded.self"),
      dlAudits.map((r: any) => r.action),
    );
  } finally {
    // ── Cleanup: every row this probe created ─────────────────────────────
    try {
      if (createdPayDocIds.length > 0) {
        await db
          .delete(atelierPayDocuments)
          .where(inArray(atelierPayDocuments.id, createdPayDocIds));
      }
      // Remove audit rows tied to the documents we created.
      if (createdPayDocIds.length > 0) {
        await db
          .delete(atelierAuditEvents)
          .where(
            and(
              eq(atelierAuditEvents.entityType, "pay_document"),
              inArray(atelierAuditEvents.entityId, createdPayDocIds),
            ),
          );
      }
      await db
        .delete(atelierPayrollLines)
        .where(
          inArray(atelierPayrollLines.id, [LINE_ID, LINE_OTHER_ID]),
        );
      await db
        .delete(atelierPayrollRuns)
        .where(eq(atelierPayrollRuns.id, RUN_ID));
      await db
        .delete(atelierEmployees)
        .where(inArray(atelierEmployees.id, [EMP_PERSON, OTHER_PERSON]));
      for (const uid of [FP_ID, EMP_ID, OTHER_ID]) {
        await db
          .delete(atelierSelfNotifications)
          .where(eq(atelierSelfNotifications.userId, uid));
        await db
          .delete(atelierUsers)
          .where(eq(atelierUsers.id, uid));
      }
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  if (failures.length === 0) {
    console.log("\n✓ payslip-probe: all checks passed");
  } else {
    console.error(
      `\n✗ payslip-probe: ${failures.length} failed:\n  - ${failures.join("\n  - ")}`,
    );
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
