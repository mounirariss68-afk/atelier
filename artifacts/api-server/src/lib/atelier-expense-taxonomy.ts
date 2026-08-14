/**
 * Task #383 — Expense taxonomy: default tree, boot installer, legacy
 * migration, and lookup helpers.
 *
 * The taxonomy lives in atelier_expense_categories (DATA, not an enum).
 * This module ships the DEFAULT tree and installs it idempotently at
 * boot (configuration, like the reference-data seed — NOT demo data).
 * Finance can extend/relabel rows later without code changes.
 *
 * Policy compatibility: the policy engine keys on the old flat category
 * strings (flight/hotel/meal/gift/software/taxi/mileage/per_diem/other).
 * Each sub-category carries `legacyKeys` (old strings that map onto it)
 * and optionally `policyKey`. An expense's flat `category` column stays
 * the policy key: resolvePolicyKey(subCode) = policyKey ?? legacyKeys[0]
 * ?? "other".
 */

import { db, atelierExpenseCategories, atelierExpenses } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface TaxonomyNode {
  code: string;
  label: string;
  legacyKeys?: string[];
  policyKey?: string;
  children?: TaxonomyNode[];
}

export const DEFAULT_TAXONOMY: TaxonomyNode[] = [
  {
    code: "travel",
    label: "Travel",
    children: [
      { code: "flights", label: "Flights", legacyKeys: ["flight"] },
      { code: "lodging", label: "Hotels & Lodging", legacyKeys: ["hotel"] },
      { code: "ground_transport", label: "Taxi & Ground Transport", legacyKeys: ["taxi"] },
      { code: "mileage", label: "Mileage", legacyKeys: ["mileage"] },
      { code: "per_diem", label: "Per Diem", legacyKeys: ["per_diem"] },
      { code: "visas_travel_docs", label: "Visas & Travel Documents" },
    ],
  },
  {
    code: "meals_entertainment",
    label: "Meals & Entertainment",
    children: [
      { code: "client_meals", label: "Client Meals", legacyKeys: ["meal"] },
      { code: "team_meals", label: "Team Meals", policyKey: "meal" },
      { code: "entertainment", label: "Entertainment" },
    ],
  },
  {
    code: "client_bd",
    label: "Client & BD",
    children: [
      { code: "client_gifts", label: "Client Gifts", legacyKeys: ["gift"] },
      { code: "proposals_bids", label: "Proposals & Bids" },
      { code: "events_sponsorships", label: "Events & Sponsorships" },
      { code: "client_workshops", label: "Client Workshops" },
    ],
  },
  {
    code: "project_delivery",
    label: "Project Delivery",
    children: [
      { code: "client_software_licenses", label: "Client Software Licenses & Seats", policyKey: "software" },
      { code: "cloud_infra_dev_test", label: "Cloud Infrastructure (Dev/Test)" },
      { code: "hardware_provisioning", label: "Hardware Provisioning" },
      { code: "subcontracted_services", label: "Subcontracted Services" },
      { code: "site_field_costs", label: "Site & Field Costs" },
      { code: "materials", label: "Materials" },
      { code: "testing_surveys", label: "Testing & Surveys" },
    ],
  },
  {
    code: "professional_services",
    label: "Professional Services",
    children: [
      { code: "legal_fees", label: "Legal" },
      { code: "accounting_audit", label: "Accounting & Audit" },
      { code: "consulting_advisory", label: "Consulting & Advisory" },
      { code: "recruitment_fees", label: "Recruitment Fees" },
    ],
  },
  {
    code: "technology",
    label: "Technology",
    children: [
      { code: "software_subscriptions", label: "Software Subscriptions", legacyKeys: ["software"] },
      { code: "it_equipment", label: "IT Equipment" },
      { code: "telecom_connectivity", label: "Telecom & Connectivity", policyKey: "telecom" },
      { code: "cloud_internal", label: "Cloud (Internal)" },
    ],
  },
  {
    code: "office_admin",
    label: "Office & Admin",
    children: [
      { code: "rent_facilities", label: "Rent & Facilities" },
      { code: "office_supplies", label: "Office Supplies" },
      { code: "utilities", label: "Utilities" },
      { code: "printing_postage", label: "Printing & Postage" },
      { code: "general_admin", label: "General / Other", legacyKeys: ["other"] },
    ],
  },
  {
    code: "people",
    label: "People",
    children: [
      { code: "training_development", label: "Training & Development" },
      { code: "certifications", label: "Certifications" },
      { code: "team_events", label: "Team Events" },
      { code: "wellbeing", label: "Wellbeing" },
    ],
  },
  {
    code: "government_compliance",
    label: "Government & Compliance",
    children: [
      { code: "license_renewals", label: "License Renewals" },
      { code: "government_fees", label: "Government Fees" },
      { code: "localization_compliance", label: "Localization & Compliance" },
      { code: "fines_penalties", label: "Fines & Penalties" },
    ],
  },
  {
    code: "financial",
    label: "Financial",
    children: [
      { code: "bank_charges", label: "Bank Charges" },
      { code: "fx_costs", label: "FX Costs" },
      { code: "insurance", label: "Insurance" },
      { code: "interest_fees", label: "Interest & Financing Fees" },
    ],
  },
];

export const COST_CENTERS = ["management", "operations", "marketing"] as const;
export const FUNDING_SOURCES = ["personal_claim", "partner_paid", "company_account"] as const;

/** Normalize a merchant name into the org-wide memory key. */
export function normalizeMerchantKey(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Install the default taxonomy (idempotent — insert missing codes only;
 * never overwrites finance edits).
 */
export async function ensureExpenseTaxonomy(): Promise<void> {
  const existing = await db
    .select({ code: atelierExpenseCategories.code })
    .from(atelierExpenseCategories);
  const have = new Set(existing.map((r) => r.code));
  let sort = 0;
  const inserts: (typeof atelierExpenseCategories.$inferInsert)[] = [];
  for (const cat of DEFAULT_TAXONOMY) {
    sort += 10;
    if (!have.has(cat.code)) {
      inserts.push({
        id: `expcat_${cat.code}`,
        code: cat.code,
        parentCode: null,
        label: cat.label,
        sortOrder: sort,
        legacyKeys: [],
      });
    }
    let childSort = 0;
    for (const sub of cat.children ?? []) {
      childSort += 10;
      if (have.has(sub.code)) continue;
      inserts.push({
        id: `expcat_${sub.code}`,
        code: sub.code,
        parentCode: cat.code,
        label: sub.label,
        sortOrder: childSort,
        legacyKeys: sub.legacyKeys ?? [],
        policyKey: sub.policyKey ?? null,
      });
    }
  }
  if (inserts.length > 0) {
    await db.insert(atelierExpenseCategories).values(inserts).onConflictDoNothing();
  }
  // Backfill: existing rows inserted before a default node gained a
  // policyKey keep NULL forever (installer is insert-only). Fill in the
  // default ONLY where the row's policyKey is still NULL — a finance
  // edit that set one is never overwritten.
  const defaultPolicyKeys = new Map<string, string>();
  for (const cat of DEFAULT_TAXONOMY) {
    for (const sub of cat.children ?? []) {
      if (sub.policyKey) defaultPolicyKeys.set(sub.code, sub.policyKey);
    }
  }
  for (const [code, policyKey] of defaultPolicyKeys) {
    await db
      .update(atelierExpenseCategories)
      .set({ policyKey })
      .where(and(eq(atelierExpenseCategories.code, code), isNull(atelierExpenseCategories.policyKey)));
  }
}

export type TaxonomyRow = typeof atelierExpenseCategories.$inferSelect;

export async function loadTaxonomy(): Promise<TaxonomyRow[]> {
  return db
    .select()
    .from(atelierExpenseCategories)
    .where(and(eq(atelierExpenseCategories.active, true), isNull(atelierExpenseCategories.deletedAt)))
    .orderBy(atelierExpenseCategories.sortOrder);
}

/**
 * Validate a (categoryCode, subCategoryCode) pair against the live tree.
 * Returns the resolved rows or null when invalid.
 */
export async function resolveCategoryPair(
  categoryCode: string,
  subCategoryCode: string,
): Promise<{ category: TaxonomyRow; sub: TaxonomyRow } | null> {
  const rows = await loadTaxonomy();
  const category = rows.find((r) => r.code === categoryCode && r.parentCode === null);
  const sub = rows.find((r) => r.code === subCategoryCode && r.parentCode === categoryCode);
  if (!category || !sub) return null;
  return { category, sub };
}

/** Flat policy-engine key for a sub-category row. */
export function policyKeyFor(sub: TaxonomyRow): string {
  return sub.policyKey ?? (Array.isArray(sub.legacyKeys) ? sub.legacyKeys[0] : undefined) ?? "other";
}

/**
 * Best-fit (category, sub) for an old flat category string. Used by row
 * migration and as a bridge for legacy inputs.
 */
export async function mapLegacyCategory(
  legacy: string,
): Promise<{ categoryCode: string; subCategoryCode: string } | null> {
  const rows = await loadTaxonomy();
  const sub = rows.find(
    (r) => r.parentCode !== null && Array.isArray(r.legacyKeys) && r.legacyKeys.includes(legacy),
  );
  if (!sub || !sub.parentCode) return null;
  return { categoryCode: sub.parentCode, subCategoryCode: sub.code };
}

/**
 * One-time-ish migration: backfill categoryCode/subCategoryCode onto
 * expense rows that predate the taxonomy (idempotent — only touches rows
 * with NULL categoryCode). Old category → best-fit sub via legacyKeys;
 * unknown strings land on office_admin/general_admin.
 */
export async function migrateLegacyExpenseRows(): Promise<number> {
  const rows = await loadTaxonomy();
  const byLegacy = new Map<string, { cat: string; sub: string }>();
  for (const r of rows) {
    if (!r.parentCode || !Array.isArray(r.legacyKeys)) continue;
    for (const k of r.legacyKeys) {
      if (!byLegacy.has(k)) byLegacy.set(k, { cat: r.parentCode, sub: r.code });
    }
  }
  const pending = await db
    .select({ id: atelierExpenses.id, category: atelierExpenses.category })
    .from(atelierExpenses)
    .where(isNull(atelierExpenses.categoryCode));
  let migrated = 0;
  for (const row of pending) {
    const hit = byLegacy.get(row.category) ?? byLegacy.get("other") ?? {
      cat: "office_admin",
      sub: "general_admin",
    };
    await db
      .update(atelierExpenses)
      .set({
        categoryCode: hit.cat,
        subCategoryCode: hit.sub,
        categorySource: sql`COALESCE(${atelierExpenses.categorySource}, 'manual')`,
      })
      .where(eq(atelierExpenses.id, row.id));
    migrated += 1;
  }
  return migrated;
}
