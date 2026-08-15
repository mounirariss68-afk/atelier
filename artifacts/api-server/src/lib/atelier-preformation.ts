/**
 * Task #1092 — pre-formation entity cost pools.
 *
 * Costs incurred for entities that don't legally exist yet (Istanbul,
 * Riyadh, ... offices) are booked in the home (Cognirise UAE) ledger,
 * quarantined in a "Pre-incorporation costs — recoverable" clearing
 * account (1500, an asset — so never UAE opex), with each journal line
 * stamped with the prospective entity's id. On incorporation (or
 * abandonment) finance settles the pool: intercompany recharge, JV
 * split, founder receivable, absorb into UAE P&L, or write off.
 */

import { and, eq } from "drizzle-orm";
import { db, atelierLegalEntities, type EntityFormation } from "@workspace/db";

// ── Clearing / settlement account codes (seeded via DEFAULT_CHART) ──
export const PREFORMATION_CLEARING_CODE = "1500"; // Pre-incorporation costs — recoverable (asset)
export const PREFORMATION_IC_RECEIVABLE_CODE = "1550"; // Intercompany receivable — pre-formation recharge
export const PREFORMATION_FOUNDER_RECEIVABLE_CODE = "1160"; // Related-party receivable — founders
export const PREFORMATION_ABSORB_CODE = "6900"; // Other operating expenses
export const PREFORMATION_WRITEOFF_CODE = "6920"; // Abandoned market-entry costs

export type OwnershipType = NonNullable<EntityFormation["ownershipType"]>;
export type SettlementTreatment = NonNullable<EntityFormation["settlement"]>["treatment"];

export const OWNERSHIP_TYPES: OwnershipType[] = [
  "cognirise_uae",
  "jv",
  "founder_partner",
  "franchise",
];

export const SETTLEMENT_TREATMENTS: SettlementTreatment[] = [
  "recharge",
  "jv_split",
  "founder_receivable",
  "absorb",
  "write_off",
];

export const OWNERSHIP_LABEL: Record<OwnershipType, string> = {
  cognirise_uae: "100% Cognirise UAE",
  jv: "Joint venture with partners",
  founder_partner: "Founder + partner owned",
  franchise: "Franchise",
};

export const TREATMENT_LABEL: Record<SettlementTreatment, string> = {
  recharge: "Intercompany recharge to the new entity",
  jv_split: "Split recharge per JV cost-sharing %",
  founder_receivable: "Related-party receivable from founders",
  absorb: "Absorb into UAE P&L",
  write_off: "Write off — abandoned market entry",
};

/** Ownership type → recommended settlement treatment on incorporation. */
export function recommendedTreatment(
  ownershipType: OwnershipType | null | undefined,
): SettlementTreatment | null {
  switch (ownershipType) {
    case "cognirise_uae": return "recharge";
    case "jv": return "jv_split";
    case "founder_partner": return "founder_receivable";
    case "franchise": return "recharge";
    default: return null;
  }
}

/**
 * The "home" entity whose ledger carries the pre-formation clearing
 * account: the single active entity, else the single active AE-country
 * entity. Null when neither rule applies (caller raises an exception —
 * the Bookkeeper never guesses).
 */
export async function resolveHomeEntityId(orgId: string): Promise<string | null> {
  const active = await db
    .select({ id: atelierLegalEntities.id, country: atelierLegalEntities.country })
    .from(atelierLegalEntities)
    .where(and(
      eq(atelierLegalEntities.orgId, orgId),
      eq(atelierLegalEntities.status, "active"),
    ));
  if (active.length === 1) return active[0].id;
  const ae = active.filter((e) => e.country?.toUpperCase() === "AE");
  return ae.length === 1 ? ae[0].id : null;
}
