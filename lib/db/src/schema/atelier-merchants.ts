/**
 * Task #396 — Global merchant database + unmatched-merchant log
 * (ported from the invoice-scanner kit; per-user mapping table dropped —
 * Task #383's org-wide atelier_merchant_category_map is tier 1 instead).
 *
 * atelier_global_merchants is REFERENCE data (seeded from the kit CSVs,
 * grown over time by AI enrichment) — explicitly allowed despite the
 * no-demo-seeding policy. Category columns hold the Task #383 taxonomy
 * pair (categoryCode/subCategoryCode); the original CSV labels are kept
 * in rawCategoryGroup/rawCategory/subcategoryLabel for audit.
 */

import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const atelierGlobalMerchants = pgTable(
  "atelier_global_merchants",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(), // stable seed/enrichment id e.g. EU_tesco_uk, NA_GLB00001, AI_global_<hash>
    merchantName: text("merchant_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    /** Semicolon-separated raw transaction-text variants. */
    variant: text("variant"),
    // Task #383 taxonomy pair (validated against atelier_expense_categories at seed/enrich time)
    categoryCode: text("category_code").notNull(),
    subCategoryCode: text("sub_category_code").notNull(),
    // Original source labels, for audit / re-mapping
    rawCategoryGroup: text("raw_category_group"),
    rawCategory: text("raw_category"),
    subcategoryLabel: text("subcategory_label"),
    region: text("region").default("global"),
    confidence: doublePrecision("confidence").notNull().default(1.0),
    source: text("source"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_globmerch_mid").on(t.merchantId),
    index("idx_atelier_globmerch_norm").on(t.normalizedName),
  ],
);

/** Merchants that fell through every matcher tier — AI enrichment queue. */
export const atelierUnmatchedMerchants = pgTable(
  "atelier_unmatched_merchants",
  {
    id: text("id").primaryKey(),
    rawMerchantText: text("raw_merchant_text").notNull(),
    normalizedMerchantText: text("normalized_merchant_text").notNull(),
    region: text("region"),
    count: integer("count").notNull().default(1),
    // pending | enriched | dismissed
    status: text("status").notNull().default("pending"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_unmatched_raw").on(t.rawMerchantText),
    index("idx_atelier_unmatched_status").on(t.status),
  ],
);
