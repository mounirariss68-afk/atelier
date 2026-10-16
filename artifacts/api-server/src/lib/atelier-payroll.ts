/**
 * Task #654 — Monthly payroll runs per legal entity.
 *
 * Deliberately simple, startup-appropriate mechanics: the run snapshots
 * the active roster attributed to the entity (annual baseCompensation
 * converted to USD and divided by 12), a partner approves it (posting
 * salary expense Dr 6000 / Cr 2100 via the Bookkeeper idempotency
 * pattern), and marking it paid posts the cash side (Dr 2100 / Cr 1000).
 * No WPS/GOSI, no bank files — those are explicitly out of scope.
 *
 * Employee → entity attribution uses the canonical legalEntityId. Historical
 * rows without an ID may still use the legacy label matcher until corrected.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierEmployees, atelierLegalEntities } from "@workspace/db";
import { toUsdSync } from "./atelier-fx.js";

// Phase 0 (Oct 2026 audit): one FX source (lib/atelier-fx snapshot).
function toUsd(amount: number, currency: string | null | undefined): number {
  return toUsdSync(amount, currency);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type EntityRow = typeof atelierLegalEntities.$inferSelect;
type EmployeeRow = typeof atelierEmployees.$inferSelect;

/** ID first; name fallback is restricted to historical rows with no ID. */
export function employeeMatchesEntity(emp: EmployeeRow, entity: EntityRow): boolean {
  if (emp.legalEntityId) return emp.legalEntityId === entity.id;
  const token = (emp.employingEntity ?? "").trim().toLowerCase();
  if (!token || token === "other") return false;
  const hay = [entity.jurisdiction, entity.shortName, entity.legalNameEn]
    .map((s) => (s ?? "").toLowerCase());
  return hay.some((h) => h.includes(token));
}

export interface PayrollLine {
  employeeId: string;
  name: string;
  title: string | null;
  baseCurrency: string | null;
  baseCompensationAnnual: number;
  monthlyAmountUsd: number;
}
export interface PayrollExcluded {
  employeeId: string;
  name: string;
  reason: string;
}

/**
 * Build the payroll snapshot for an entity: active employees attributed
 * to it, with monthly USD salary cost. Employees matched to the entity
 * but missing baseCompensation land in `excluded` for visibility.
 */
export async function buildPayrollLines(
  orgId: string,
  entity: EntityRow,
): Promise<{ lines: PayrollLine[]; excluded: PayrollExcluded[]; totalAmount: number }> {
  const employees = await db
    .select()
    .from(atelierEmployees)
    .where(and(
      eq(atelierEmployees.orgId, orgId),
      eq(atelierEmployees.status, "active"),
      isNull(atelierEmployees.deletedAt),
    ));
  const active = employees.filter(
    (e) => e.employmentStatus === "active" || e.employmentStatus === "notice" || e.employmentStatus === "on_leave",
  );
  const lines: PayrollLine[] = [];
  const excluded: PayrollExcluded[] = [];
  for (const e of active) {
    if (!employeeMatchesEntity(e, entity)) continue;
    if (!e.baseCompensation || e.baseCompensation <= 0) {
      excluded.push({ employeeId: e.id, name: e.fullName, reason: "no_base_compensation" });
      continue;
    }
    lines.push({
      employeeId: e.id,
      name: e.fullName,
      title: e.title ?? null,
      baseCurrency: e.baseCurrency ?? null,
      baseCompensationAnnual: e.baseCompensation,
      monthlyAmountUsd: round2(toUsd(e.baseCompensation, e.baseCurrency) / 12),
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name));
  const totalAmount = round2(lines.reduce((s, l) => s + l.monthlyAmountUsd, 0));
  return { lines, excluded, totalAmount };
}
