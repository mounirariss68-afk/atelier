/**
 * Task #1135 — per-employee payslip PDFs generated into the pay hub when a
 * statutory payroll run posts. Employee-visible (published) documents:
 * gross, allowances, contributions, deductions/advances, net — with the
 * proration basis spelled out. Idempotent per (person, run): re-posting a
 * run only fills in missing documents.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierPayDocuments,
  atelierPayrollRuns,
  atelierPayrollLines,
  type PayrollContributionDetail,
} from "@workspace/db";
import {
  createBrandDoc,
  addBrandPage,
  glassSection,
  brandTable,
  writeBrandFooters,
  block,
} from "../atelier-pdf-brand.js";
import {
  emitSelfNotification,
  resolveUserIdForPerson,
} from "../../routes/atelier/meRoutes.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function money(n: number, ccy: string): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;
}
function monthEnd(periodLabel: string): string {
  const y = Number(periodLabel.slice(0, 4));
  const m = Number(periodLabel.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periodLabel}-${String(last).padStart(2, "0")}`;
}

async function renderPayslipPdf(args: {
  run: typeof atelierPayrollRuns.$inferSelect;
  line: typeof atelierPayrollLines.$inferSelect;
}): Promise<Buffer> {
  const { run, line } = args;
  const ccy = line.currency;
  const doc = createBrandDoc();
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  addBrandPage(doc);
  glassSection(doc, `Payslip — ${run.periodLabel}`, [
    block.strong(line.personName),
    block.body(`Pay period: ${run.periodLabel}`),
    block.body(`Basis: ${line.prorationBasis ?? `full month (${line.daysInMonth} days)`}`),
    block.muted(`Payable days: ${line.payableDays} of ${line.daysInMonth}${line.unpaidLeaveDays > 0 ? ` (${line.unpaidLeaveDays} unpaid leave)` : ""}`),
    block.gap(4),
  ]);

  const contribs = (line.contributions ?? []) as PayrollContributionDetail[];
  const rows: string[][] = [["Gross salary (prorated)", "Earning", money(line.monthlyGross, ccy)]];
  if (line.housingAllowance > 0) {
    rows.push(["— of which housing allowance", "", money(line.housingAllowance, ccy)]);
  }
  for (const c of contribs) {
    if (c.employeeAmount > 0) rows.push([`${c.name} (employee)`, "Deduction", `−${money(c.employeeAmount, ccy)}`]);
  }
  if (line.advanceDeduction > 0) {
    rows.push(["Salary-advance installment", "Deduction", `−${money(line.advanceDeduction, ccy)}`]);
  }
  rows.push(["Net pay", "", money(line.netPay, ccy)]);
  brandTable(doc, [
    { label: "Item", width: 250 },
    { label: "Type", width: 90 },
    { label: "Amount", width: 140, align: "right" as const },
  ], rows);

  const employerRows = contribs
    .filter((c) => c.employerAmount > 0)
    .map((c) => [c.name, money(c.employerAmount, ccy)]);
  if (line.eosbAccrual !== 0) employerRows.push(["End-of-service accrual (provision)", money(line.eosbAccrual, ccy)]);
  if (employerRows.length > 0) {
    glassSection(doc, "Employer contributions (informational)", [
      block.muted("Paid by the employer on your behalf — not deducted from your pay."),
    ]);
    brandTable(doc, [
      { label: "Scheme", width: 300 },
      { label: "Amount", width: 140, align: "right" as const },
    ], employerRows);
  }
  writeBrandFooters(doc);
  doc.end();
  return done;
}

export async function generateRunPayslips(args: {
  orgId: string;
  run: typeof atelierPayrollRuns.$inferSelect;
  lines: Array<typeof atelierPayrollLines.$inferSelect>;
  createdByUserId: string | null;
}): Promise<{ created: number }> {
  const periodDate = monthEnd(args.run.periodLabel);
  const marker = `payrun:${args.run.id}`;
  const existing = await db
    .select({ personId: atelierPayDocuments.personId })
    .from(atelierPayDocuments)
    .where(and(
      eq(atelierPayDocuments.orgId, args.orgId),
      eq(atelierPayDocuments.category, "payslip"),
      eq(atelierPayDocuments.notes, marker),
      isNull(atelierPayDocuments.deletedAt),
    ));
  const have = new Set(existing.map((r) => r.personId));
  let created = 0;
  for (const line of args.lines) {
    if (have.has(line.employeeId)) continue;
    const pdf = await renderPayslipPdf({ run: args.run, line });
    const docTitle = `Payslip ${args.run.periodLabel}`;
    await db.insert(atelierPayDocuments).values({
      id: rid("paydoc"),
      orgId: args.orgId,
      personType: "employee",
      personId: line.employeeId,
      category: "payslip",
      title: docTitle,
      periodDate,
      published: true,
      publishedAt: new Date(),
      publishedByUserId: args.createdByUserId,
      fileName: `payslip-${args.run.periodLabel}.pdf`,
      mime: "application/pdf",
      sizeBytes: pdf.length,
      fileData: pdf.toString("base64"),
      uploadedByUserId: args.createdByUserId,
      notes: marker,
      createdByUserId: args.createdByUserId,
    });
    created++;
    // Me-home card + device push for the employee (best-effort: person may
    // have no login yet, in which case resolveUserIdForPerson returns null).
    const ownerUserId = await resolveUserIdForPerson(args.orgId, line.employeeId);
    if (ownerUserId) {
      await emitSelfNotification({
        orgId: args.orgId,
        userId: ownerUserId,
        kind: "pay_document",
        title: "New payslip available",
        body: docTitle,
        href: "/me/pay",
      });
    }
  }
  return { created };
}
