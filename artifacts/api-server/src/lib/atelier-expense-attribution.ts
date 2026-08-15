/**
 * Task #383 — shared attribution + funding-source validation for expense
 * write surfaces (Me lens + wallet). Validates the new two-axis category
 * pair, BD industry, internal entity/cost-center, and funding source, and
 * returns a normalized patch fragment. Writes the 4xx itself and returns
 * null on failure (same convention as resolveContext).
 */

import type { Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierBankAccount,
  atelierLegalEntities,
} from "@workspace/db";
import {
  COST_CENTERS,
  FUNDING_SOURCES,
  policyKeyFor,
  resolveCategoryPair,
} from "./atelier-expense-taxonomy";

export interface ExpenseExtrasInput {
  categoryCode?: unknown;
  subCategoryCode?: unknown;
  categorySource?: unknown;
  bdIndustry?: unknown;
  entityId?: unknown;
  costCenter?: unknown;
  fundingSource?: unknown;
  fundingBankAccountId?: unknown;
  timesheetWeekId?: unknown;
}

export interface ExpenseExtrasPatch {
  categoryCode?: string;
  subCategoryCode?: string;
  categorySource?: string;
  /** Flat policy key derived from the sub-category — keeps the policy engine working. */
  category?: string;
  bdIndustry?: string | null;
  entityId?: string | null;
  costCenter?: string | null;
  fundingSource?: string;
  fundingBankAccountId?: string | null;
  timesheetWeekId?: string | null;
}

const CATEGORY_SOURCES = new Set(["merchant_memory", "ai", "manual"]);

/**
 * Validate the taxonomy/attribution/funding fields of an expense body.
 * Only fields PRESENT in the body are validated and returned (patch
 * semantics). `context` carries the resolved context so cross-field rules
 * (internal ⇒ entity+cost center; bd/account ⇒ industry default) can run.
 */
export async function resolveExpenseExtras(
  res: Response,
  orgId: string,
  b: ExpenseExtrasInput,
  context: { contextType: string; accountId: string | null },
): Promise<ExpenseExtrasPatch | null> {
  const patch: ExpenseExtrasPatch = {};

  // ── Two-axis category pair (both or neither) ──
  const hasCat = b.categoryCode !== undefined || b.subCategoryCode !== undefined;
  if (hasCat) {
    const categoryCode = String(b.categoryCode ?? "");
    const subCategoryCode = String(b.subCategoryCode ?? "");
    const pair = categoryCode && subCategoryCode
      ? await resolveCategoryPair(categoryCode, subCategoryCode)
      : null;
    if (!pair) {
      res.status(400).json({
        error: "invalid-category-pair",
        message: "categoryCode + subCategoryCode must be a valid parent/child pair from the taxonomy.",
      });
      return null;
    }
    patch.categoryCode = pair.category.code;
    patch.subCategoryCode = pair.sub.code;
    patch.category = policyKeyFor(pair.sub); // flat policy key stays authoritative
    const source = typeof b.categorySource === "string" && CATEGORY_SOURCES.has(b.categorySource)
      ? b.categorySource
      : "manual";
    patch.categorySource = source;
  }

  // ── Attribution ──
  if (context.contextType === "bd" || context.contextType === "account") {
    if (b.bdIndustry !== undefined) {
      patch.bdIndustry = b.bdIndustry ? String(b.bdIndustry).slice(0, 120) : null;
    } else if (context.accountId) {
      // Default from the account's firmographics (overridable).
      const [acc] = await db
        .select({ industryCode: atelierAccounts.industryCode })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.id, context.accountId), eq(atelierAccounts.orgId, orgId)));
      if (acc?.industryCode) patch.bdIndustry = acc.industryCode;
    }
    // BD/account spend is never internal-attributed.
    patch.entityId = null;
    patch.costCenter = null;
  }
  if (context.contextType === "internal") {
    if (b.entityId !== undefined) {
      const entityId = String(b.entityId ?? "");
      if (entityId) {
        const [ent] = await db
          .select({
            id: atelierLegalEntities.id,
            status: atelierLegalEntities.status,
            formation: atelierLegalEntities.formation,
          })
          .from(atelierLegalEntities)
          .where(
            and(
              eq(atelierLegalEntities.id, entityId),
              eq(atelierLegalEntities.orgId, orgId),
            ),
          );
        if (!ent) {
          res.status(400).json({ error: "entity-not-found" });
          return null;
        }
        // Task #1092 — archived entities are no longer valid targets;
        // in_formation entities ARE (pre-formation cost pools).
        if (ent.status === "archived") {
          res.status(400).json({ error: "entity-archived" });
          return null;
        }
        // A settled pre-formation pool is closed for new costs — its
        // settlement journal has already cleared the clearing account.
        if (ent.status === "in_formation" && ent.formation?.settlement) {
          res.status(400).json({ error: "entity-pool-settled" });
          return null;
        }
        patch.entityId = entityId;
      } else {
        patch.entityId = null;
      }
    }
    if (b.costCenter !== undefined) {
      const cc = String(b.costCenter ?? "");
      if (cc && !(COST_CENTERS as readonly string[]).includes(cc)) {
        res.status(400).json({ error: "invalid-cost-center", allowed: COST_CENTERS });
        return null;
      }
      patch.costCenter = cc || null;
    }
    patch.bdIndustry = null;
  }

  // ── Funding source ──
  if (b.fundingSource !== undefined) {
    const fs = String(b.fundingSource ?? "");
    if (!(FUNDING_SOURCES as readonly string[]).includes(fs)) {
      res.status(400).json({ error: "invalid-funding-source", allowed: FUNDING_SOURCES });
      return null;
    }
    patch.fundingSource = fs;
    if (fs === "company_account") {
      const bankId = String(b.fundingBankAccountId ?? "");
      if (!bankId) {
        res.status(400).json({
          error: "bank-account-required",
          message: "company_account funding requires fundingBankAccountId (a registered bank account).",
        });
        return null;
      }
      const [acct] = await db
        .select({ id: atelierBankAccount.id, isActive: atelierBankAccount.isActive })
        .from(atelierBankAccount)
        .where(
          and(
            eq(atelierBankAccount.id, bankId),
            eq(atelierBankAccount.orgId, orgId),
            isNull(atelierBankAccount.deletedAt),
          ),
        );
      if (!acct || !acct.isActive) {
        res.status(400).json({ error: "bank-account-not-found" });
        return null;
      }
      patch.fundingBankAccountId = bankId;
    } else {
      patch.fundingBankAccountId = null;
    }
  } else if (b.fundingBankAccountId !== undefined) {
    res.status(400).json({
      error: "funding-source-required",
      message: "fundingBankAccountId only applies with fundingSource=company_account.",
    });
    return null;
  }

  // ── Timesheet week link (optional; validated loosely — existence checked at approve) ──
  if (b.timesheetWeekId !== undefined) {
    patch.timesheetWeekId = b.timesheetWeekId ? String(b.timesheetWeekId).slice(0, 80) : null;
  }

  return patch;
}
