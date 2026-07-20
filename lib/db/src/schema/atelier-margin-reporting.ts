/**
 * THE ATELIER — Margin / realization reporting suite (Task #434).
 *
 * Two tables:
 *
 *   atelier_sold_position_snapshot — an IMMUTABLE capture of the priced
 *   ("sold") position at the moment an opportunity enters `contract`.
 *   One snapshot per opportunity (unique index). Rows are written once
 *   (contract-stage hook or the explicit backfill route) and are never
 *   updated or deleted; re-captures are no-ops via onConflictDoNothing.
 *   The snapshot is the baseline every realization/leakage report
 *   compares delivered economics against.
 *
 *   atelier_overhead_allocation_config — one row per org describing how
 *   non-engagement GL overhead spend is allocated down to engagements
 *   for the net-margin view. `basis` selects the allocation driver;
 *   `glAccountCodes` optionally restricts the overhead pool to specific
 *   chart-of-accounts codes (empty = every expense-type account line
 *   without an engagement dimension).
 *
 * Conventions mirror atelier-l2c-revrec.ts: text PKs, org default
 * 'aico', COMMON timestamps.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
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

// ============================================================
// SOLD POSITION SNAPSHOT (immutable, one per opportunity)
// source: contract_stage | backfill
// ============================================================
export const atelierSoldPositionSnapshot = pgTable(
  "atelier_sold_position_snapshot",
  {
    id: text("id").primaryKey(), // sold_<oppId> (deterministic)
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    engagementId: text("engagement_id"),
    accountId: text("account_id").notNull(),
    partnerOwnerId: text("partner_owner_id"),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    source: text("source").notNull().default("contract_stage"),
    /** False when no deal pricing existed at capture — sold price falls back to dealSizeHypothesis. */
    hasPricing: boolean("has_pricing").notNull().default(true),
    pricingModel: text("pricing_model"),
    rateCardId: text("rate_card_id"),
    durationWeeks: doublePrecision("duration_weeks").notNull().default(0),
    teamMix: jsonb("team_mix")
      .$type<Array<{ seniority: string; role?: string; ftePct: number }>>()
      .notNull()
      .default([]),
    /** Planned hours derived from teamMix × durationWeeks × 40 at capture time. */
    soldHours: doublePrecision("sold_hours").notNull().default(0),
    soldPriceUsd: doublePrecision("sold_price_usd").notNull().default(0),
    soldCostUsd: doublePrecision("sold_cost_usd").notNull().default(0),
    soldMarginAmountUsd: doublePrecision("sold_margin_amount_usd").notNull().default(0),
    soldMarginPct: doublePrecision("sold_margin_pct").notNull().default(0),
    targetMarginPct: doublePrecision("target_margin_pct").notNull().default(0),
    /** Effective sold rate = soldPriceUsd / soldHours (0 when hours unknown). */
    soldEffectiveRateUsd: doublePrecision("sold_effective_rate_usd").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_soldpos_opp").on(t.orgId, t.opportunityId),
    index("idx_atelier_soldpos_account").on(t.accountId),
    index("idx_atelier_soldpos_eng").on(t.engagementId),
  ],
);

// ============================================================
// OVERHEAD ALLOCATION CONFIG (one per org)
// basis: revenue | direct_cost | hours
// ============================================================
export const atelierOverheadAllocationConfig = pgTable(
  "atelier_overhead_allocation_config",
  {
    id: text("id").primaryKey(), // ohcfg_<orgId>
    orgId: ORG("org_id"),
    basis: text("basis").notNull().default("revenue"),
    /** Restrict overhead pool to these GL account codes; empty = all expense accounts. */
    glAccountCodes: jsonb("gl_account_codes").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    updatedByUserId: text("updated_by_user_id"),
    ...COMMON,
  },
  (t) => [uniqueIndex("uq_atelier_ohcfg_org").on(t.orgId)],
);
