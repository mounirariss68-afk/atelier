/**
 * Task #1298 — enter Hisham Nofal's signed NEP compensation plan.
 *
 * NOT demo seeding: this records a real signed agreement
 * (attached_assets/Hisham_Nofal_-_Non-Equity_Partner_Agreement_-_V2-*.docx)
 * through the same shared write path the founder/finance UI uses (roster
 * contractor row + effective-dated plan row + audit event + day-rate sync).
 *
 * Terms (Schedules B–D of the agreement):
 *   - No fixed salary pre-conversion.
 *   - Time charges: USD 2,500/day charge-out rate.
 *   - Margin share on Project Profit: 20% originated + material
 *     contribution; 10% origination-only within 24 months of the first
 *     engagement at the client.
 *   - Conversion: rolling-12m attributable revenue ≥ USD 2,000,000 AND
 *     realised delivered gross margin ≥ 40% → USD 300,000/yr salary,
 *     variable agreed at conversion.
 *
 * Run:  cd artifacts/api-server && npx tsx scripts/seed-hisham-nep-plan.ts
 * Idempotent: keyed on Hisham's e-mail + the plan effective date.
 * MUST be re-run on prod at go-live (task-agent DB data never merges).
 */
import { and, eq, isNull } from "drizzle-orm";
import { syncContractorDayRate } from "../src/lib/atelier-nep-comp.js";
import {
  db, pool,
  atelierUsers, atelierContractors, atelierNepCompPlans, atelierAuditEvents,
} from "@workspace/db";

const EMAIL = "hisham.nofal@cognirise.ai";
const FULL_NAME = "Hisham Nofal";
const EFFECTIVE_FROM = "2026-08-01"; // agreement V2 signature month
const ORG = "aico";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
  // Actor: a founding partner (the plan is founder-entered).
  const founders = await db.select().from(atelierUsers).where(and(
    eq(atelierUsers.orgId, ORG),
    eq(atelierUsers.role, "founding_partner"),
  ));
  const actor = founders[0];
  if (!actor) throw new Error("No founding_partner user found — cannot attribute the plan entry.");

  // 1. Contractor roster row (NEPs ride the contractor machinery).
  const contractors = await db.select().from(atelierContractors).where(and(
    eq(atelierContractors.orgId, ORG),
    isNull(atelierContractors.deletedAt),
  ));
  let contractor = contractors.find((c) => c.email.trim().toLowerCase() === EMAIL) ?? null;
  if (!contractor) {
    const id = rid("ct");
    await db.insert(atelierContractors).values({
      id, orgId: ORG, fullName: FULL_NAME, email: EMAIL,
      dayRateAmount: 2500, dayRateCurrency: "USD",
    });
    [contractor] = await db.select().from(atelierContractors).where(eq(atelierContractors.id, id));
    console.log(`created contractor roster row ${id} for ${FULL_NAME}`);
  } else {
    console.log(`contractor roster row exists: ${contractor.id}`);
  }

  // Login row, if Hisham already has one (NEP login is provisioned separately).
  const users = await db.select().from(atelierUsers).where(eq(atelierUsers.orgId, ORG));
  const userId = users.find((u) => (u.email ?? "").trim().toLowerCase() === EMAIL)?.id ?? null;

  // 2. Effective-dated plan (idempotent on contractor + effectiveFrom).
  const existing = await db.select().from(atelierNepCompPlans).where(and(
    eq(atelierNepCompPlans.orgId, ORG),
    eq(atelierNepCompPlans.contractorId, contractor.id),
    eq(atelierNepCompPlans.effectiveFrom, EFFECTIVE_FROM),
    isNull(atelierNepCompPlans.deletedAt),
  ));
  if (existing.length > 0) {
    console.log(`plan already present (${existing[0].id}) — nothing to do`);
    return;
  }
  const planId = rid("nepplan");
  await db.insert(atelierNepCompPlans).values({
    id: planId,
    orgId: ORG,
    contractorId: contractor.id,
    userId,
    effectiveFrom: EFFECTIVE_FROM,
    currency: "USD",
    dayRateAmount: 2500,
    marginSharePctSale: 20,
    marginSharePctOriginationOnly: 10,
    originationWindowMonths: 24,
    conversionRevenueThresholdUsd: 2_000_000,
    conversionMarginThresholdPct: 40,
    postConversionSalaryAmount: 300_000,
    postConversionSalaryCurrency: "USD",
    postConversionVariableNote: "Variable component agreed at conversion (Conversion Addendum); no equity.",
    status: "pre_conversion",
    notes: "Per signed Non-Equity Partner Agreement V2 (Schedules B–D).",
    createdByUserId: actor.id,
  });
  // Roster day rate follows the CURRENTLY effective plan only (a future
  // effectiveFrom must not change the operational rate early).
  await syncContractorDayRate(ORG, contractor.id);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), orgId: ORG,
    entityType: "nep_comp_plan", entityId: planId,
    actorType: "human", actorId: actor.id, actorLabel: actor.name,
    action: "nep_comp.plan_create",
    payload: {
      contractorId: contractor.id, effectiveFrom: EFFECTIVE_FROM, currency: "USD",
      dayRateAmount: 2500, marginSharePctSale: 20, marginSharePctOriginationOnly: 10,
      originationWindowMonths: 24, conversionRevenueThresholdUsd: 2_000_000,
      conversionMarginThresholdPct: 40, postConversionSalaryAmount: 300_000,
      source: "seed-hisham-nep-plan (signed agreement V2)",
    },
    payloadSummary: `NEP comp plan created for ${FULL_NAME}: USD 2,500/day, 20%/10% margin share, 24-month window, effective ${EFFECTIVE_FROM}.`,
  });
  console.log(`created plan ${planId} for ${FULL_NAME} (${contractor.id})`);
}

main()
  .then(async () => { await pool.end().catch(() => undefined); process.exit(0); })
  .catch(async (err) => { console.error(err); await pool.end().catch(() => undefined); process.exit(1); });
