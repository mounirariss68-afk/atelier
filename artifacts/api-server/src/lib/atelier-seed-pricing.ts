import {
  db,
  atelierRateCards,
  atelierRateCardRows,
  atelierMarginPolicies,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const DEFAULT_CARD_ID = "rc_aico_2026_ksa_uae_v1";
const DEFAULT_POLICY_ID = "mpol_aico_default_v1";

interface SeedRow {
  id: string;
  seniority: string;
  role: string;
  costPerHourUsd: number;
  billRatePerHourUsd: number;
  utilisationPct: number;
  overheadMultiplier: number;
}

const SIX_BANDS: SeedRow[] = [
  { id: "rcr_aico_partner",     seniority: "Partner",    role: "Partner",         costPerHourUsd: 250, billRatePerHourUsd: 850, utilisationPct: 0.55, overheadMultiplier: 1.35 },
  { id: "rcr_aico_principal",   seniority: "Principal",  role: "Principal",       costPerHourUsd: 200, billRatePerHourUsd: 650, utilisationPct: 0.65, overheadMultiplier: 1.35 },
  { id: "rcr_aico_manager",     seniority: "Manager",    role: "EngagementManager", costPerHourUsd: 150, billRatePerHourUsd: 475, utilisationPct: 0.75, overheadMultiplier: 1.35 },
  { id: "rcr_aico_aieng",       seniority: "AIEngineer", role: "AIEngineer",      costPerHourUsd: 120, billRatePerHourUsd: 375, utilisationPct: 0.80, overheadMultiplier: 1.35 },
  { id: "rcr_aico_designer",    seniority: "Designer",   role: "Designer",        costPerHourUsd: 95,  billRatePerHourUsd: 295, utilisationPct: 0.80, overheadMultiplier: 1.35 },
  { id: "rcr_aico_analyst",     seniority: "Analyst",    role: "Analyst",         costPerHourUsd: 70,  billRatePerHourUsd: 225, utilisationPct: 0.85, overheadMultiplier: 1.35 },
];

/**
 * Idempotent bootstrap seed for the AICo 2026 KSA + UAE v1 rate card and
 * the default margin policy. Safe to run on every cold start — every
 * insert is gated on existence so re-runs are no-ops.
 *
 * Required by Task #240: a Partner should never have to manually create
 * the baseline rate card before the Pricing module is usable.
 */
export async function ensureAtelierPricingSeed(): Promise<void> {
  try {
    const [existingCard] = await db
      .select({ id: atelierRateCards.id })
      .from(atelierRateCards)
      .where(eq(atelierRateCards.id, DEFAULT_CARD_ID));
    if (!existingCard) {
      await db.insert(atelierRateCards).values({
        id: DEFAULT_CARD_ID,
        name: "AICo 2026 KSA + UAE v1",
        status: "active",
        geography: "KSA + UAE",
        currency: "USD",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        sourceUrl: null,
      });
      logger.info({ cardId: DEFAULT_CARD_ID }, "[atelier] seeded default rate card");
    }
    for (const row of SIX_BANDS) {
      const [existingRow] = await db
        .select({ id: atelierRateCardRows.id })
        .from(atelierRateCardRows)
        .where(eq(atelierRateCardRows.id, row.id));
      if (!existingRow) {
        await db.insert(atelierRateCardRows).values({
          id: row.id,
          rateCardId: DEFAULT_CARD_ID,
          seniority: row.seniority,
          role: row.role,
          costPerHourUsd: row.costPerHourUsd,
          billRatePerHourUsd: row.billRatePerHourUsd,
          utilisationPct: row.utilisationPct,
          overheadMultiplier: row.overheadMultiplier,
        });
      }
    }
    const [existingPolicy] = await db
      .select({ id: atelierMarginPolicies.id })
      .from(atelierMarginPolicies)
      .where(eq(atelierMarginPolicies.id, DEFAULT_POLICY_ID));
    if (!existingPolicy) {
      await db.insert(atelierMarginPolicies).values({
        id: DEFAULT_POLICY_ID,
        name: "AICo default margin policy",
        targetMarginPct: 0.55,
        amberThresholdPct: 0.5,
        redThresholdPct: 0.45,
        twoPartnerThresholdPct: 0.45,
        isDefault: true,
      });
      logger.info({ policyId: DEFAULT_POLICY_ID }, "[atelier] seeded default margin policy");
    }
  } catch (err) {
    logger.warn({ err }, "[atelier] pricing seed skipped (table likely missing)");
  }
}
