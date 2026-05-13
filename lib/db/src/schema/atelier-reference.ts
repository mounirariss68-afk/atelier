import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/**
 * THE ATELIER — Reference data lookups (Task #290 / Patch: Reference Data).
 *
 * Canonical lookup tables for countries (ISO 3166-1 alpha-2), industries
 * (8 primary AICo taxonomy), and sub-industries (43 entries).
 *
 * Design notes:
 * - Text PKs use the canonical ISO/AICo code so cross-table references stay
 *   readable (matches the pattern used elsewhere in atelier.ts).
 * - These are intentionally **firm-wide / global** lookups: there is exactly
 *   one row per code, seeded under `org_id='aico'` to satisfy the existing
 *   org-isolation RLS policy. Per-org overrides are out of scope; future
 *   multi-tenancy would introduce per-org override tables rather than fork
 *   the canonical list.
 * - Entries are never deleted — they are `deprecated` so legacy FK rows
 *   keep resolving (see patch §0.4).
 * - Task #291 will add FK columns alongside existing text columns; this
 *   task only stands up the lookups themselves.
 */

const ORG = (name: string) => text(name).notNull().default("aico");

// ============================================================
// COUNTRIES — ISO 3166-1 alpha-2, 249 entries
// ============================================================
export const atelierCountries = pgTable(
  "atelier_countries",
  {
    isoAlpha2: text("iso_alpha_2").primaryKey(),
    orgId: ORG("org_id"),
    isoAlpha3: text("iso_alpha_3").notNull(),
    isoNumeric: text("iso_numeric").notNull(),
    displayNameEn: text("display_name_en").notNull(),
    displayNameAr: text("display_name_ar"),
    displayNameTr: text("display_name_tr"),
    aliases: jsonb("aliases").notNull().$type<string[]>().default([]),
    region: text("region").notNull(), // 'MENA' | 'Africa' | 'Asia' | 'Europe' | 'Americas' | 'Oceania' | 'Antarctica'
    subRegion: text("sub_region"),
    flagEmoji: text("flag_emoji"),
    primaryCurrency: text("primary_currency"),
    primaryLanguage: text("primary_language"),
    dialCode: text("dial_code"),
    vatDefaultPct: integer("vat_default_pct"),
    isGcc: boolean("is_gcc").notNull().default(false),
    isAicoTargetMarket: boolean("is_aico_target_market").notNull().default(false),
    status: text("status").notNull().default("active"), // 'active' | 'deprecated'
    displayOrderOverride: integer("display_order_override"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [
    index("idx_atelier_countries_org").on(t.orgId),
    index("idx_atelier_countries_region").on(t.region),
    index("idx_atelier_countries_status").on(t.status),
  ],
);

// ============================================================
// INDUSTRIES — 8 primary AICo taxonomy
// ============================================================
export const atelierIndustries = pgTable(
  "atelier_industries",
  {
    code: text("code").primaryKey(),
    orgId: ORG("org_id"),
    displayNameEn: text("display_name_en").notNull(),
    displayNameAr: text("display_name_ar"),
    shortDescription: text("short_description"),
    displayOrder: integer("display_order").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [
    index("idx_atelier_industries_org").on(t.orgId),
    index("idx_atelier_industries_status").on(t.status),
  ],
);

// ============================================================
// SUB-INDUSTRIES — 43 entries across 8 primaries
// ============================================================
export const atelierSubIndustries = pgTable(
  "atelier_sub_industries",
  {
    code: text("code").primaryKey(),
    orgId: ORG("org_id"),
    industryCode: text("industry_code").notNull(),
    displayNameEn: text("display_name_en").notNull(),
    displayNameAr: text("display_name_ar"),
    shortDescription: text("short_description"),
    displayOrder: integer("display_order").notNull(),
    status: text("status").notNull().default("active"),
    defaultOfferingAnchor: text("default_offering_anchor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [
    index("idx_atelier_sub_industries_org").on(t.orgId),
    index("idx_atelier_sub_industries_industry").on(t.industryCode),
    index("idx_atelier_sub_industries_status").on(t.status),
  ],
);
