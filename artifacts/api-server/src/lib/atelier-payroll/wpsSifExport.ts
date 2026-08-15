/**
 * Task #1136 — WPS SIF export step (DB-facing wrapper around the pure
 * builder in wpsSif.ts).
 *
 * Responsibilities:
 *  - assemble the builder input from a payroll run (lines → employees →
 *    bank/WPS identifiers, entity → employer WPS config). Employee
 *    IBAN/SWIFT is only ever READ here — writes stay exclusively on the
 *    HR-approved bank-change flow.
 *  - preview: applicability + blocking problems + who would be excluded.
 *  - export: build the file, record the export (who/when/run/sha256) in
 *    atelier_wps_sif_exports, emit an audit event, and link the export to
 *    the WPS row in the statutory comply register so marking it filed is
 *    one step.
 *
 * Delivery to the bank is a MANUAL Wio portal upload for now; this module
 * is the seam a future Wio API integration replaces.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierEmployees,
  atelierLegalEntities,
  atelierPayrollRuns,
  atelierPayrollLines,
  atelierWpsSifExports,
  atelierFinanceComplianceEntries,
  atelierAuditEvents,
} from "@workspace/db";
import {
  buildWpsSif,
  wpsApplicability,
  type SifProblem,
  type WpsEntityConfig,
  type WpsEmployeeInput,
} from "./wpsSif.js";
import { PayrollError, ensureStatutoryFilings } from "./payrollRun.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type RunRow = typeof atelierPayrollRuns.$inferSelect;

async function loadRunContext(orgId: string, runId: string): Promise<{
  run: RunRow;
  entity: WpsEntityConfig;
  employees: WpsEmployeeInput[];
}> {
  const [run] = await db.select().from(atelierPayrollRuns).where(and(
    eq(atelierPayrollRuns.orgId, orgId),
    eq(atelierPayrollRuns.id, runId),
    isNull(atelierPayrollRuns.deletedAt),
  ));
  if (!run) throw new PayrollError(404, "payroll run not found");
  const [ent] = await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, orgId),
    eq(atelierLegalEntities.id, run.legalEntityId),
  ));
  if (!ent) throw new PayrollError(404, "legal entity for this run not found");
  const lines = await db.select().from(atelierPayrollLines).where(and(
    eq(atelierPayrollLines.orgId, orgId),
    eq(atelierPayrollLines.runId, run.id),
  ));
  const empIds = lines.map((l) => l.employeeId);
  const emps = empIds.length > 0
    ? await db.select({
        id: atelierEmployees.id,
        fullName: atelierEmployees.fullName,
        mohrePersonId: atelierEmployees.mohrePersonId,
        bankRoutingCode: atelierEmployees.bankRoutingCode,
        iban: atelierEmployees.iban,
      }).from(atelierEmployees).where(and(
        eq(atelierEmployees.orgId, orgId),
        inArray(atelierEmployees.id, empIds),
      ))
    : [];
  const byId = new Map(emps.map((e) => [e.id, e]));
  const employees: WpsEmployeeInput[] = lines.map((l) => {
    const e = byId.get(l.employeeId);
    return {
      employeeId: l.employeeId,
      name: e?.fullName ?? l.personName,
      mohrePersonId: e?.mohrePersonId ?? null,
      bankRoutingCode: e?.bankRoutingCode ?? null,
      iban: e?.iban ?? null,
      netPay: l.netPay,
      daysInMonth: l.daysInMonth,
      payableDays: l.payableDays,
      unpaidLeaveDays: l.unpaidLeaveDays,
    };
  });
  const entity: WpsEntityConfig = {
    entityId: ent.id,
    name: ent.shortName || ent.legalNameEn,
    country: ent.country,
    freeZoneRegime: ent.statutory?.freeZoneRegime ?? null,
    wps: ent.statutory?.wps ?? null,
  };
  return { run, entity, employees };
}

async function findWpsFilingRow(orgId: string, entityId: string, periodLabel: string) {
  const sourceKey = `stat_${entityId}_wps_mohre_${periodLabel}`;
  const rows = await db.select().from(atelierFinanceComplianceEntries).where(and(
    eq(atelierFinanceComplianceEntries.orgId, orgId),
    eq(atelierFinanceComplianceEntries.register, "statutory"),
    isNull(atelierFinanceComplianceEntries.deletedAt),
    sql`${atelierFinanceComplianceEntries.data} ->> 'sourceKey' = ${sourceKey}`,
  ));
  return rows[0] ?? null;
}

export interface WpsSifPreview {
  applicable: boolean;
  /** On-screen explanation when the entity is WPS-exempt. */
  exemptReason: string | null;
  /** Blocking problems (missing IBAN / MOHRE ID / routing / employer config). */
  problems: SifProblem[];
  ready: boolean;
  runStatus: string;
  recordCount: number;
  totalNetPay: number;
  /** Prior exports of this run (latest first). */
  exports: Array<typeof atelierWpsSifExports.$inferSelect>;
  /** Linked WPS filing row id in the statutory register, when materialized. */
  filingEntryId: string | null;
  gpssaNote: string;
}

export async function previewWpsSif(orgId: string, runId: string): Promise<WpsSifPreview> {
  const { run, entity, employees } = await loadRunContext(orgId, runId);
  const app = wpsApplicability(entity);
  let problems: SifProblem[] = [];
  if (app.applicable) {
    const built = buildWpsSif({ entity, periodLabel: run.periodLabel, employees, generatedAt: new Date() });
    if (!built.ok) problems = built.problems;
  }
  const exports_ = await db.select().from(atelierWpsSifExports).where(and(
    eq(atelierWpsSifExports.orgId, orgId),
    eq(atelierWpsSifExports.runId, run.id),
  )).orderBy(desc(atelierWpsSifExports.createdAt));
  const filing = app.applicable ? await findWpsFilingRow(orgId, entity.entityId, run.periodLabel) : null;
  return {
    applicable: app.applicable,
    exemptReason: app.reason,
    problems,
    ready: app.applicable && problems.length === 0 && run.status === "posted",
    runStatus: run.status,
    recordCount: employees.length,
    totalNetPay: run.totals.netPay,
    exports: exports_,
    filingEntryId: filing?.id ?? null,
    gpssaNote:
      "Emirati/GCC nationals are included in the SIF with their bank details; GPSSA pension contributions remain a separate remittance line in the filing register, never a SIF record.",
  };
}

export interface WpsSifExportResult {
  exportId: string;
  fileName: string;
  content: string;
  sha256: string;
  recordCount: number;
  totalNetPay: number;
  complianceEntryId: string | null;
}

/**
 * Generate + record a SIF export from a POSTED run. Throws PayrollError
 * (409 not posted, 422 validation with `problems`) — never writes a file
 * record unless the build fully validated.
 */
export async function exportWpsSif(args: {
  orgId: string;
  runId: string;
  actor: { id: string; name: string | null };
}): Promise<WpsSifExportResult> {
  const { run, entity, employees } = await loadRunContext(args.orgId, args.runId);
  if (run.status !== "posted") {
    throw new PayrollError(409, "WPS SIF can only be generated from a posted payroll run — post the run first.");
  }
  const app = wpsApplicability(entity);
  if (!app.applicable) {
    throw new PayrollError(422, app.reason ?? "entity is not WPS-applicable");
  }
  const built = buildWpsSif({ entity, periodLabel: run.periodLabel, employees, generatedAt: new Date() });
  if (!built.ok) {
    const err = new PayrollError(
      422,
      `SIF validation failed — ${built.problems.length} problem(s): ` +
        built.problems.map((p) => `${p.name ? `${p.name}: ` : ""}${p.message}`).join(" | "),
    );
    (err as PayrollError & { problems?: SifProblem[] }).problems = built.problems;
    throw err;
  }
  const sha256 = createHash("sha256").update(built.content, "utf8").digest("hex");
  const exportId = rid("wpssif");

  // Link to the WPS filing row in the statutory comply register. Materialize
  // the entity's statutory filings first so the link is guaranteed even for
  // API/agent callers that never visited the payroll overview; a missing row
  // afterwards is a hard failure — never export with a silent null link.
  await ensureStatutoryFilings(args.orgId, {
    id: entity.entityId,
    country: entity.country,
    shortName: entity.name,
    legalNameEn: entity.name,
  });
  const filing = await findWpsFilingRow(args.orgId, entity.entityId, run.periodLabel);
  if (!filing) {
    throw new PayrollError(500, `WPS filing row missing for ${entity.entityId} ${run.periodLabel} — statutory register materialization failed`);
  }
  {
    const data = { ...(filing.data as Record<string, unknown>) };
    data.sifExport = {
      exportId,
      fileName: built.fileName,
      sha256,
      runId: run.id,
      exportedAt: new Date().toISOString(),
      exportedBy: args.actor.name ?? args.actor.id,
    };
    await db.update(atelierFinanceComplianceEntries)
      .set({ data, updatedAt: new Date() })
      .where(eq(atelierFinanceComplianceEntries.id, filing.id));
  }

  await db.insert(atelierWpsSifExports).values({
    id: exportId,
    orgId: args.orgId,
    runId: run.id,
    legalEntityId: entity.entityId,
    periodLabel: run.periodLabel,
    fileName: built.fileName,
    sha256,
    employerUniqueId: built.employerUniqueId,
    recordCount: built.recordCount,
    totalNetPay: built.totalNetPay,
    currency: built.currency,
    complianceEntryId: filing.id,
    exportedByUserId: args.actor.id,
    createdByUserId: args.actor.id,
  });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "payroll_run",
    entityId: run.id,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name ?? args.actor.id,
    action: "payroll.wps_sif_exported",
    payload: {
      exportId,
      fileName: built.fileName,
      sha256,
      periodLabel: run.periodLabel,
      legalEntityId: entity.entityId,
      recordCount: built.recordCount,
      totalNetPay: built.totalNetPay,
      complianceEntryId: filing?.id ?? null,
    },
    payloadSummary: `WPS SIF ${built.fileName} exported for ${entity.name} ${run.periodLabel}: ${built.recordCount} record(s), AED ${built.totalNetPay} (upload manually via the Wio portal).`,
  });
  return {
    exportId,
    fileName: built.fileName,
    content: built.content,
    sha256,
    recordCount: built.recordCount,
    totalNetPay: built.totalNetPay,
    complianceEntryId: filing?.id ?? null,
  };
}
