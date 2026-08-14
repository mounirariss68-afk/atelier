/**
 * Task #1091 — finance autopilot settings store (blueprint D1).
 *
 * Org-scoped thresholds that drive the auto-post policy engine. READ
 * returns the blueprint defaults when no row exists (production no-seed
 * policy: no boot seed for this — boot seeds are auth-only). A row only
 * materialises after a founding_partner/partner PATCHes it.
 */
import { eq } from "drizzle-orm";
import { db, atelierFinanceAutopilotSettings } from "@workspace/db";
import {
  FINANCE_AUTOPILOT_DEFAULTS,
  type FinanceAutopilotThresholds,
} from "./atelier-finance-autopolicy.js";

export interface FinanceAutopilotSettingsView extends FinanceAutopilotThresholds {
  /** True when a founder has customised the thresholds (a row exists). */
  customised: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/** Read the org's thresholds, falling back to the blueprint defaults with
 * no seeding. Never throws for a missing row. */
export async function loadFinanceAutopilotSettings(orgId: string): Promise<FinanceAutopilotSettingsView> {
  const [row] = await db
    .select()
    .from(atelierFinanceAutopilotSettings)
    .where(eq(atelierFinanceAutopilotSettings.orgId, orgId))
    .limit(1);
  if (!row) {
    return {
      ...FINANCE_AUTOPILOT_DEFAULTS,
      customised: false,
      updatedAt: null,
      updatedByName: null,
    };
  }
  return {
    journalAutoConfidence: row.journalAutoConfidence,
    supplierInvoiceAutoMaxAed: row.supplierInvoiceAutoMaxAed,
    journalAutoMaxAed: row.journalAutoMaxAed,
    customised: true,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
  };
}

/** Bare thresholds for the policy engine (defaults when unset). */
export async function loadFinanceAutopilotThresholds(orgId: string): Promise<FinanceAutopilotThresholds> {
  const v = await loadFinanceAutopilotSettings(orgId);
  return {
    journalAutoConfidence: v.journalAutoConfidence,
    supplierInvoiceAutoMaxAed: v.supplierInvoiceAutoMaxAed,
    journalAutoMaxAed: v.journalAutoMaxAed,
  };
}
