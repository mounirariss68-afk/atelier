/**
 * Task #383 — Automated expense categorization.
 *
 * Two-axis taxonomy: category/sub-category (nature of spend) is DATA in
 * atelier_expense_categories, not a hardcoded enum. Sub-categories carry
 * `legacyKeys` mapping the old flat 9-category list (flight/hotel/meal/
 * gift/software/taxi/mileage/per_diem/other) so the policy engine —
 * which keys on those legacy strings — keeps working: an expense's flat
 * `category` column remains the policy key, derived from the chosen
 * sub-category's first legacy key.
 *
 * Companions:
 *  - atelier_expense_gl_mappings   : per-entity GL code + VAT treatment per sub-category
 *  - atelier_merchant_category_map : org-wide merchant→category memory (learned)
 *  - atelier_bank_signatories      : per-bank-account signatory authority register
 *                                    (distinct from atelier_signing_entity_signatories,
 *                                    which is about CONTRACT signing)
 *  - atelier_engagement_expense_alerts : 80%/100% budget alert dedupe ledger
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ORG = (name: string) => text(name).notNull().default("aico");
const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

/**
 * Category tree. Top-level rows have parentCode = null; sub-categories
 * point at their parent's code. Codes are stable slugs (never renamed —
 * relabel via `label`). `legacyKeys` on sub-categories lists old flat
 * category strings that map here (used for row migration + policy-key
 * derivation). `policyKey` overrides the derived policy key when a
 * sub-category has no legacy key but should still hit a policy bucket.
 */
export const atelierExpenseCategories = pgTable(
  "atelier_expense_categories",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    code: text("code").notNull(),
    parentCode: text("parent_code"), // null = top-level category
    label: text("label").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    legacyKeys: jsonb("legacy_keys").notNull().default([]).$type<string[]>(),
    policyKey: text("policy_key"), // explicit policy-engine key override
    active: boolean("active").notNull().default(true),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_expcat_org_code").on(t.orgId, t.code),
    index("idx_atelier_expcat_parent").on(t.parentCode),
  ],
);

/**
 * Per-entity accountant mapping: sub-category → GL code + VAT treatment.
 * Maintained by finance / founding partners. One row per
 * (entity, sub-category).
 */
export const atelierExpenseGlMappings = pgTable(
  "atelier_expense_gl_mappings",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    entityId: text("entity_id").notNull(), // atelier_legal_entities.id
    subCategoryCode: text("sub_category_code").notNull(),
    glCode: text("gl_code").notNull(),
    // recoverable | non_recoverable | zero_rated | out_of_scope
    vatTreatment: text("vat_treatment").notNull().default("out_of_scope"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_glmap_entity_subcat").on(t.orgId, t.entityId, t.subCategoryCode),
    index("idx_atelier_glmap_entity").on(t.entityId),
  ],
);

/**
 * Org-wide merchant memory. merchantKey is the normalized merchant name
 * (lowercased, collapsed whitespace, punctuation stripped). Every
 * confirmed submission (including corrections) upserts here; a mapping
 * is trusted for auto-fill once confirmCount >= 2 (repeat confirmed
 * usage) and beats AI proposals.
 */
export const atelierMerchantCategoryMap = pgTable(
  "atelier_merchant_category_map",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    merchantKey: text("merchant_key").notNull(),
    merchantLabel: text("merchant_label").notNull(),
    categoryCode: text("category_code").notNull(),
    subCategoryCode: text("sub_category_code").notNull(),
    confirmCount: integer("confirm_count").notNull().default(1),
    lastConfirmedAt: timestamp("last_confirmed_at").notNull().defaultNow(),
    lastConfirmedByUserId: text("last_confirmed_by_user_id"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_merchmap_org_key").on(t.orgId, t.merchantKey),
  ],
);

/**
 * Signatory-authority register per BANK ACCOUNT (atelier_bank_account).
 * Who may operate the account, with what authority and limit. Editable
 * by founding partners only. Distinct from contract-signing signatories.
 */
export const atelierBankSignatories = pgTable(
  "atelier_bank_signatories",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    bankAccountId: text("bank_account_id").notNull(), // atelier_bank_account.id
    userId: text("user_id").notNull(), // atelier_users.id
    personName: text("person_name").notNull(), // snapshot for display/export
    authority: text("authority").notNull().default("view_only"), // sole | joint | view_only
    monetaryLimitAmount: doublePrecision("monetary_limit_amount"), // null = unlimited
    limitCurrency: text("limit_currency"),
    geography: text("geography"), // free text, e.g. "UAE", "GCC", "Global"
    effectiveFrom: text("effective_from"), // YYYY-MM-DD
    expiresOn: text("expires_on"), // YYYY-MM-DD; null = open-ended
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_banksig_account").on(t.bankAccountId),
    index("idx_atelier_banksig_user").on(t.userId),
  ],
);

/**
 * Budget-alert dedupe ledger: one row per (engagement, threshold) so the
 * 80% / 100% notifications fire exactly once per crossing. Re-arms if
 * the budget is raised (spentPctAtNotify recorded for audit).
 */
export const atelierEngagementExpenseAlerts = pgTable(
  "atelier_engagement_expense_alerts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    threshold: integer("threshold").notNull(), // 80 | 100
    budgetUsdAtNotify: doublePrecision("budget_usd_at_notify").notNull().default(0),
    spentUsdAtNotify: doublePrecision("spent_usd_at_notify").notNull().default(0),
    notifiedUserId: text("notified_user_id"),
    notifiedAt: timestamp("notified_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_engexpalert").on(t.engagementId, t.threshold),
  ],
);
