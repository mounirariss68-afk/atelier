/**
 * Atelier — pricing routes (Task #240).
 *
 * - GET/POST /atelier/rate-cards
 * - GET/PATCH /atelier/rate-cards/:id
 * - POST /atelier/rate-cards/:id/rows
 * - GET/POST /atelier/margin-policy
 * - GET/PUT /atelier/opportunities/:id/pricing
 * - POST /atelier/opportunities/:id/pricing/strategist
 * - POST /atelier/opportunities/:id/pricing/override
 * - POST /atelier/opportunities/:id/pricing/countersign
 *
 * The math lives in `lib/atelier-pricing.ts` and is fully deterministic
 * (PRD §2.4 guardrail: "no LLM math for the final figure").
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierAuditEvents,
  atelierRateCards,
  atelierRateCardRows,
  atelierMarginPolicies,
  atelierDealPricings,
  atelierPaneAItems,
  atelierEngagements,
  atelierBillingRule,
} from "@workspace/db";
import {
  computePricing,
  classifyMarginGate,
  type MarginPolicy,
  type RateCardRowLite,
  type TeamMixEntry,
} from "../../lib/atelier-pricing.js";
import {
  simulateStructure,
  simulateAllStructures,
  normalizeStructureKind,
  normalizeCostLines,
  buildBillingHandoff,
  PRICING_STRUCTURE_KINDS,
  type CostLine,
  type PricingStructureKind,
  type StructureParams,
  type StructureSimulation,
} from "../../lib/atelier-pricing-structures.js";
import { PRICING_TREND_GUIDANCE } from "../../lib/atelier-pricing-trends.js";
import { runPricingStrategist, runPricingAnalyst, runPricingResearcher } from "../../lib/atelier-agents/runner.js";
import { atelierAgentRuns } from "@workspace/db";
import { canViewEngagementCosting } from "./personaRoles.js";
import { withRls } from "./rls.js";
import { sql as dsql } from "drizzle-orm";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function requirePartner(me: typeof atelierUsers.$inferSelect, res: Response): boolean {
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return false;
  }
  return true;
}

async function loadDefaultPolicy(): Promise<MarginPolicy & { id: string }> {
  const [row] = await db
    .select()
    .from(atelierMarginPolicies)
    .where(and(isNull(atelierMarginPolicies.deletedAt), eq(atelierMarginPolicies.isDefault, true)))
    .limit(1);
  if (row) {
    return {
      id: row.id,
      targetMarginPct: row.targetMarginPct,
      amberThresholdPct: row.amberThresholdPct,
      redThresholdPct: row.redThresholdPct,
      twoPartnerThresholdPct: row.twoPartnerThresholdPct,
    };
  }
  // Lazy-seed a sensible default so first-boot tenants are never crippled.
  const id = rid("mpol");
  await db.insert(atelierMarginPolicies).values({
    id,
    name: "default",
    targetMarginPct: 0.55,
    amberThresholdPct: 0.50,
    redThresholdPct: 0.45,
    twoPartnerThresholdPct: 0.45,
    isDefault: true,
  });
  return {
    id,
    targetMarginPct: 0.55,
    amberThresholdPct: 0.50,
    redThresholdPct: 0.45,
    twoPartnerThresholdPct: 0.45,
  };
}

async function loadRateCardRows(rateCardId: string): Promise<RateCardRowLite[]> {
  const rows = await db
    .select()
    .from(atelierRateCardRows)
    .where(and(eq(atelierRateCardRows.rateCardId, rateCardId), isNull(atelierRateCardRows.deletedAt)));
  return rows.map((r) => ({
    seniority: r.seniority,
    dayRateInternalCost: r.dayRateInternalCost,
    dayRateClientPrice: r.dayRateClientPrice,
    overheadPct: r.overheadPct,
  }));
}

async function defaultRateCardId(): Promise<string | null> {
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(isNull(atelierRateCards.deletedAt), eq(atelierRateCards.status, "active")))
    .orderBy(desc(atelierRateCards.createdAt))
    .limit(1);
  return card?.id ?? null;
}

const router: IRouter = Router();

// =============================================================
// Rate cards
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/rate-cards", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const cards = await db
    .select()
    .from(atelierRateCards)
    .where(isNull(atelierRateCards.deletedAt))
    .orderBy(desc(atelierRateCards.createdAt));
  res.json(
    cards.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      geography: c.geography,
      currency: c.currency,
      effectiveFrom: c.effectiveFrom.toISOString(),
      effectiveTo: c.effectiveTo?.toISOString() ?? null,
      sourceUrl: c.sourceUrl,
      notes: c.notes,
      createdAt: c.createdAt.toISOString(),
    })),
  );
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/rate-cards", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const { name, geography, currency, status, notes, sourceUrl } = req.body ?? {};
  if (!name || !geography || !currency) {
    res.status(400).json({ error: "missing-fields" });
    return;
  }
  const id = rid("rc");
  const [card] = await db
    .insert(atelierRateCards)
    .values({
      id,
      name,
      geography,
      currency,
      status: status ?? "active",
      notes: notes ?? null,
      sourceUrl: sourceUrl ?? null,
      createdByUserId: me.id,
    })
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "rate_card",
    entityId: card.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "rate_card.create",
    payload: { name },
    payloadSummary: `${me.name} created rate card "${name}"`,
  });
  res.status(201).json(card);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/rate-cards/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(eq(atelierRateCards.id, req.params.id), isNull(atelierRateCards.deletedAt)));
  if (!card) {
    res.status(404).json({ error: "rate-card-not-found" });
    return;
  }
  // Task #293 — read through atelier_rate_card_rows_v inside withRls so
  // day_rate_internal_cost is masked at the DB layer (source of truth).
  // The JS canViewCompensation check below is retained as defense-in-depth.
  const rowsRes = await withRls(req, async (tx) => {
    return tx.execute<{
      id: string;
      role: string;
      seniority: string;
      day_rate_internal_cost: number | null;
      day_rate_client_price: number;
      overhead_pct: number;
      currency: string;
    }>(dsql`SELECT id, role, seniority, day_rate_internal_cost,
                   day_rate_client_price, overhead_pct, currency
              FROM atelier_rate_card_rows_v
             WHERE rate_card_id = ${card.id}
               AND deleted_at IS NULL`);
  });
  const rows = rowsRes.rows;
  const showCost = canViewEngagementCosting(me.role);
  res.json({
    id: card.id,
    name: card.name,
    status: card.status,
    geography: card.geography,
    currency: card.currency,
    effectiveFrom: card.effectiveFrom.toISOString(),
    effectiveTo: card.effectiveTo?.toISOString() ?? null,
    sourceUrl: card.sourceUrl,
    notes: card.notes,
    rows: rows.map((r) => ({
      id: r.id,
      role: r.role,
      seniority: r.seniority,
      dayRateInternalCost: showCost ? r.day_rate_internal_cost : null,
      dayRateClientPrice: r.day_rate_client_price,
      overheadPct: r.overhead_pct,
      currency: r.currency,
    })),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.patch("/rate-cards/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "status", "geography", "currency", "notes", "sourceUrl"] as const) {
    if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  }
  patch.updatedAt = new Date();
  const [updated] = await db
    .update(atelierRateCards)
    .set(patch)
    .where(eq(atelierRateCards.id, req.params.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "rate-card-not-found" });
    return;
  }
  res.json(updated);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/rate-cards/:id/rows", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const { role, seniority, dayRateInternalCost, dayRateClientPrice, overheadPct, currency } = req.body ?? {};
  if (!role || !seniority || typeof dayRateInternalCost !== "number" || typeof dayRateClientPrice !== "number") {
    res.status(400).json({ error: "missing-fields" });
    return;
  }
  const id = rid("rcr");
  const [row] = await db
    .insert(atelierRateCardRows)
    .values({
      id,
      rateCardId: req.params.id,
      role,
      seniority,
      dayRateInternalCost,
      dayRateClientPrice,
      overheadPct: typeof overheadPct === "number" ? overheadPct : 0.25,
      currency: currency ?? "USD",
      createdByUserId: me.id,
    })
    .returning();
  res.status(201).json(row);
});

// =============================================================
// Margin policy
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/margin-policy", async (_req, res) => {
  const policy = await loadDefaultPolicy();
  res.json(policy);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/margin-policy", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const policy = await loadDefaultPolicy();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "targetMarginPct",
    "amberThresholdPct",
    "redThresholdPct",
    "twoPartnerThresholdPct",
  ] as const) {
    if (typeof req.body?.[k] === "number") patch[k] = req.body[k];
  }
  await db.update(atelierMarginPolicies).set(patch).where(eq(atelierMarginPolicies.id, policy.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "margin_policy",
    entityId: policy.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "margin_policy.update",
    payload: patch,
    payloadSummary: `${me.name} updated firm margin policy`,
  });
  const fresh = await loadDefaultPolicy();
  res.json(fresh);
});

// =============================================================
// Deal pricing
// =============================================================
async function loadOrInitDealPricing(
  oppId: string,
  policy: MarginPolicy,
): Promise<typeof atelierDealPricings.$inferSelect | null> {
  const [existing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, oppId), isNull(atelierDealPricings.deletedAt)));
  if (existing) return existing;
  const cardId = await defaultRateCardId();
  if (!cardId) return null;
  const id = rid("dp");
  const [created] = await db
    .insert(atelierDealPricings)
    .values({
      id,
      opportunityId: oppId,
      rateCardId: cardId,
      pricingModel: "time_and_materials",
      durationWeeks: 8,
      teamMix: [],
      targetMarginPct: policy.targetMarginPct,
    })
    .returning();
  return created;
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/pricing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const policy = await loadDefaultPolicy();
  const pricing = await loadOrInitDealPricing(req.params.oppId, policy);
  if (!pricing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  // Task #293 — re-read computed_cost_usd / computed_margin_pct through
  // the masked view so the DB is the source of truth (the row above came
  // from the base table for write-side semantics; we replace the
  // sensitive fields with their masked counterparts here).
  const masked = await withRls(req, async (tx) => {
    return tx.execute<{
      computed_cost_usd: number | null;
      computed_margin_pct: number | null;
    }>(dsql`SELECT computed_cost_usd, computed_margin_pct
              FROM atelier_deal_pricings_v
             WHERE id = ${pricing.id}`);
  });
  const m = masked.rows[0] ?? { computed_cost_usd: null, computed_margin_pct: null };
  const safePricing = {
    ...pricing,
    computedCostUsd: m.computed_cost_usd,
    computedMarginPct: m.computed_margin_pct,
  } as Record<string, unknown>;
  // Task #435 — the structure simulation snapshot and analyst output carry
  // cost/margin figures; mask them for non-costing viewers alongside the
  // view-masked columns above.
  if (!canViewEngagementCosting(me.role)) {
    safePricing.riskAdjustedMarginPct = null;
    safePricing.structureSim = null;
    safePricing.pricingAnalystOutput = null;
  }
  const rows = await loadRateCardRows(pricing.rateCardId);
  // Cost-bearing rate card rows are also re-masked (loadRateCardRows
  // hits the base table for compute purposes; never serve raw cost to
  // non-comp viewers).
  if (!canViewEngagementCosting(me.role)) {
    for (const r of rows as Array<{ dayRateInternalCost: number | null }>) {
      r.dayRateInternalCost = null;
    }
  }
  res.json({ pricing: safePricing, policy, rateCardRows: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.put("/opportunities/:oppId/pricing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Governance: only Partners may persist economic terms (teamMix /
  // durationWeeks / pricingModel / rateCardId). Non-Partner roles can
  // still drive the read-only `whatif` endpoint to model scenarios.
  if (!requirePartner(me, res)) return;
  const policy = await loadDefaultPolicy();
  const existing = await loadOrInitDealPricing(req.params.oppId, policy);
  if (!existing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const teamMix: TeamMixEntry[] = Array.isArray(req.body?.teamMix) ? req.body.teamMix : (existing.teamMix as TeamMixEntry[]);
  const durationWeeks: number = typeof req.body?.durationWeeks === "number" ? req.body.durationWeeks : existing.durationWeeks;
  const pricingModel: string = typeof req.body?.pricingModel === "string" ? req.body.pricingModel : existing.pricingModel;
  const rateCardId: string = typeof req.body?.rateCardId === "string" ? req.body.rateCardId : existing.rateCardId;
  const structureParams: StructureParams | null =
    req.body?.structureParams && typeof req.body.structureParams === "object"
      ? (req.body.structureParams as StructureParams)
      : ((existing.structureParams as StructureParams | null) ?? null);
  // Task #663 — typed non-labor cost lines. Normalized defensively; absorbed
  // lines fold into cost/margin, pass-through lines ride cash/invoice only.
  const costLines: CostLine[] = normalizeCostLines(
    Array.isArray(req.body?.costLines) ? req.body.costLines : (existing.costLines ?? []),
  );
  const rateCardRows = await loadRateCardRows(rateCardId);
  const compute = computePricing({ teamMix, durationWeeks, rateCardRows, policy });

  // Task #435 — structure simulation for the chosen pricing model. The
  // margin lock gates on the risk-adjusted margin (probability-weighted
  // across best/expected/worst bands + outcome-success probability), so
  // fee-at-risk structures cannot pass on their best case.
  const structureKind = normalizeStructureKind(pricingModel);
  const sim = simulateStructure({
    kind: structureKind,
    params: structureParams,
    teamMix,
    durationWeeks,
    rateCardRows,
    policy,
    costLines,
  });
  // Headline computed figures include absorbed non-labor cost (Task #663);
  // pass-through stays out of margin. With no cost lines this is identical
  // to the legacy labor-only compute.
  const absorbedNonLabor = sim.costStack.absorbedNonLaborUsd;
  const computedCostUsd = Math.round((compute.computedCostUsd + absorbedNonLabor) * 100) / 100;
  const computedMarginPct =
    compute.computedPriceUsd > 0
      ? Math.round(((compute.computedPriceUsd - computedCostUsd) / compute.computedPriceUsd) * 10000) / 10000
      : 0;

  // Governance: if any economic input changed, invalidate prior
  // single-Partner override + two-Partner countersign so a stale approval
  // can never carry over to materially different commercial terms.
  const economicInputChanged =
    JSON.stringify(existing.teamMix ?? []) !== JSON.stringify(teamMix) ||
    existing.durationWeeks !== durationWeeks ||
    existing.pricingModel !== pricingModel ||
    existing.rateCardId !== rateCardId ||
    JSON.stringify(existing.structureParams ?? null) !== JSON.stringify(structureParams ?? null) ||
    JSON.stringify(normalizeCostLines(existing.costLines ?? [])) !== JSON.stringify(costLines);
  const hadPriorApproval = !!existing.partnerOverrideId || !!existing.countersignPartnerId;

  const updateSet: Record<string, unknown> = {
    teamMix,
    durationWeeks,
    pricingModel,
    rateCardId,
    computedCostUsd,
    computedPriceUsd: compute.computedPriceUsd,
    computedMarginPct,
    costLines: costLines as unknown as Array<Record<string, unknown>>,
    // Margin lock gates on the risk-adjusted margin from the structure
    // simulation — not the raw expected-case margin — so fee-at-risk
    // structures cannot pass on optimistic assumptions.
    marginLockStatus: sim.marginLockStatus,
    targetMarginPct: policy.targetMarginPct,
    structureParams: structureParams ?? null,
    structureSim: sim as unknown as Record<string, unknown>,
    riskAdjustedMarginPct: sim.riskAdjustedMarginPct,
    updatedAt: new Date(),
  };
  if (economicInputChanged && hadPriorApproval) {
    updateSet.partnerOverrideId = null;
    updateSet.partnerOverrideAt = null;
    updateSet.partnerOverrideRationale = null;
    updateSet.countersignPartnerId = null;
    updateSet.countersignAt = null;
    updateSet.countersignRationale = null;
  }
  const [updated] = await db
    .update(atelierDealPricings)
    .set(updateSet)
    .where(eq(atelierDealPricings.id, existing.id))
    .returning();
  if (economicInputChanged && hadPriorApproval) {
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "opportunity",
      entityId: req.params.oppId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "pricing.approval_invalidated",
      payload: {
        priorOverrideId: existing.partnerOverrideId,
        priorCountersignId: existing.countersignPartnerId,
        reason: "economic-input-changed",
      },
      payloadSummary: `${me.name} edited deal pricing — prior override/countersign cleared (terms changed).`,
    });
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "pricing.update",
    payload: {
      teamMix,
      durationWeeks,
      pricingModel,
      computedMarginPct: compute.computedMarginPct,
      riskAdjustedMarginPct: sim.riskAdjustedMarginPct,
      structureKind,
      marginLockStatus: sim.marginLockStatus,
    },
    payloadSummary: `${me.name} updated pricing — risk-adjusted margin ${(sim.riskAdjustedMarginPct * 100).toFixed(1)}% (${sim.marginLockStatus})`,
  });
  res.json({ pricing: updated, policy, rateCardRows, breakdown: compute.perRoleBreakdown, structureSim: sim });
});

// What-if: pure compute, no persistence.
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/whatif", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const policy = await loadDefaultPolicy();
  const existing = await loadOrInitDealPricing(req.params.oppId, policy);
  if (!existing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const teamMix: TeamMixEntry[] = Array.isArray(req.body?.teamMix) ? req.body.teamMix : (existing.teamMix as TeamMixEntry[]);
  const durationWeeks: number = typeof req.body?.durationWeeks === "number" ? req.body.durationWeeks : existing.durationWeeks;
  const rateCardId: string = typeof req.body?.rateCardId === "string" ? req.body.rateCardId : existing.rateCardId;
  const rateCardRows = await loadRateCardRows(rateCardId);
  const compute = computePricing({ teamMix, durationWeeks, rateCardRows, policy });
  res.json({ ...compute, policy });
});

// =============================================================
// Structure simulation (Task #435) — pure compute, no persistence.
// Body: { teamMix?, durationWeeks?, rateCardId?,
//         structures?: [{ kind, params? }] }   (omitted = all structures)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/simulate", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const policy = await loadDefaultPolicy();
  const existing = await loadOrInitDealPricing(req.params.oppId, policy);
  if (!existing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const teamMix: TeamMixEntry[] = Array.isArray(req.body?.teamMix) ? req.body.teamMix : (existing.teamMix as TeamMixEntry[]);
  const durationWeeks: number = typeof req.body?.durationWeeks === "number" ? req.body.durationWeeks : existing.durationWeeks;
  const rateCardId: string = typeof req.body?.rateCardId === "string" ? req.body.rateCardId : existing.rateCardId;
  const costLines: CostLine[] = normalizeCostLines(
    Array.isArray(req.body?.costLines) ? req.body.costLines : (existing.costLines ?? []),
  );
  const rateCardRows = await loadRateCardRows(rateCardId);

  let simulations: StructureSimulation[];
  const requested = Array.isArray(req.body?.structures) ? req.body.structures : null;
  if (requested && requested.length > 0) {
    const bad = requested.find(
      (s: { kind?: string }) => !s || typeof s.kind !== "string" || !(PRICING_STRUCTURE_KINDS as string[]).includes(normalizeStructureKind(s.kind)),
    );
    if (bad) {
      res.status(400).json({ error: "invalid-structure-kind", kinds: PRICING_STRUCTURE_KINDS });
      return;
    }
    simulations = requested.map((s: { kind: string; params?: StructureParams }) =>
      simulateStructure({
        kind: normalizeStructureKind(s.kind),
        params: s.params ?? null,
        teamMix,
        durationWeeks,
        rateCardRows,
        policy,
        costLines,
      }),
    );
  } else {
    simulations = simulateAllStructures({ teamMix, durationWeeks, rateCardRows, policy, costLines });
  }
  // Cost/margin figures are partner/finance-facing; mask for non-costing
  // viewers (same rule as the deal-pricing view masking).
  if (!canViewEngagementCosting(me.role)) {
    simulations = simulations.map((s) => ({
      ...s,
      scenarios: {
        best: { ...s.scenarios.best, costUsd: 0, marginPct: 0 },
        expected: { ...s.scenarios.expected, costUsd: 0, marginPct: 0 },
        worst: { ...s.scenarios.worst, costUsd: 0, marginPct: 0 },
      },
      riskAdjustedMarginPct: 0,
      // Task #663 — the cost stack is cost data; zero it out too.
      costStack: {
        laborCostUsd: 0,
        absorbedNonLaborUsd: 0,
        passThroughUsd: 0,
        totalAbsorbedCostUsd: 0,
        lines: [],
      },
    }));
  }
  res.json({ simulations, policy, structureKinds: PRICING_STRUCTURE_KINDS });
});

// =============================================================
// Rate-card versioning (Task #435) — clone card + rows as a new
// effective-dated version; prior version closes at the new effectiveFrom.
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/rate-cards/:id/new-version", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(eq(atelierRateCards.id, req.params.id), isNull(atelierRateCards.deletedAt)));
  if (!card) {
    res.status(404).json({ error: "rate-card-not-found" });
    return;
  }
  const effectiveFromRaw = typeof req.body?.effectiveFrom === "string" ? req.body.effectiveFrom : null;
  const effectiveFrom = effectiveFromRaw ? new Date(effectiveFromRaw) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) {
    res.status(400).json({ error: "invalid-effective-from" });
    return;
  }
  if (effectiveFrom.getTime() <= card.effectiveFrom.getTime()) {
    res.status(409).json({ error: "effective-from-not-after-current", hint: "New version must start after the current version's effectiveFrom." });
    return;
  }
  const newId = rid("rc");
  const [newCard] = await db
    .insert(atelierRateCards)
    .values({
      id: newId,
      name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : card.name,
      status: "active",
      geography: card.geography,
      currency: card.currency,
      effectiveFrom,
      effectiveTo: null,
      version: card.version + 1,
      supersedesId: card.id,
      sourceUrl: card.sourceUrl,
      notes: typeof req.body?.notes === "string" ? req.body.notes : card.notes,
      createdByUserId: me.id,
    })
    .returning();
  // Clone rows, applying an optional uniform uplift to client price.
  const upliftPct = typeof req.body?.upliftPct === "number" ? req.body.upliftPct : 0;
  const rows = await db
    .select()
    .from(atelierRateCardRows)
    .where(and(eq(atelierRateCardRows.rateCardId, card.id), isNull(atelierRateCardRows.deletedAt)));
  for (const r of rows) {
    await db.insert(atelierRateCardRows).values({
      id: rid("rcr"),
      rateCardId: newId,
      role: r.role,
      seniority: r.seniority,
      dayRateInternalCost: r.dayRateInternalCost,
      dayRateClientPrice: Math.round(r.dayRateClientPrice * (1 + upliftPct) * 100) / 100,
      overheadPct: r.overheadPct,
      currency: r.currency,
      createdByUserId: me.id,
    });
  }
  // Close the prior version at the moment the new one takes effect.
  await db
    .update(atelierRateCards)
    .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
    .where(eq(atelierRateCards.id, card.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "rate_card",
    entityId: newId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "rate_card.new_version",
    payload: { supersedesId: card.id, version: card.version + 1, upliftPct, effectiveFrom: effectiveFrom.toISOString() },
    payloadSummary: `${me.name} published rate card "${card.name}" v${card.version + 1} (effective ${effectiveFrom.toISOString().slice(0, 10)})`,
  });
  res.status(201).json({ card: newCard, rowsCloned: rows.length, supersedes: card.id });
});

// =============================================================
// Trend guidance (Task #435) — curated editorial content, no live feeds.
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/pricing/trends", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const structure = typeof req.query.structure === "string" ? req.query.structure : null;
  const items = structure
    ? PRICING_TREND_GUIDANCE.filter((t) => t.structure === structure || t.structure === "general")
    : PRICING_TREND_GUIDANCE;
  res.json({ items });
});

// =============================================================
// Pricing Analyst agent (Task #435) — full structure comparison +
// LLM recommendation. Deterministic math server-side; narrative only
// from the model.
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/analyst", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, req.params.oppId), isNull(atelierOpportunities.deletedAt)));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const policy = await loadDefaultPolicy();
  const existing = await loadOrInitDealPricing(opp.id, policy);
  if (!existing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const rateCardRows = await loadRateCardRows(existing.rateCardId);
  try {
    const result = await runPricingAnalyst({
      opportunity: opp,
      pricing: existing,
      policy,
      rateCardRows,
      actorId: me.id,
      actorLabel: me.name,
      structures: Array.isArray(req.body?.structures) ? req.body.structures : undefined,
      paramsByKind:
        req.body?.paramsByKind && typeof req.body.paramsByKind === "object"
          ? req.body.paramsByKind
          : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "analyst-failed" });
  }
});

// =============================================================
// Billing handoff (Task #435) — push the chosen structure to the
// billing engine as an atelier_billing_rule on the linked engagement.
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/handoff-billing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const [pricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, req.params.oppId), isNull(atelierDealPricings.deletedAt)));
  if (!pricing) {
    res.status(404).json({ error: "pricing-not-found" });
    return;
  }
  // Margin governance carries into billing: below-target structures need
  // their override (and countersign where applicable) before handoff.
  const gate = classifyMarginGate(
    pricing.riskAdjustedMarginPct ?? pricing.computedMarginPct,
    await loadDefaultPolicy(),
  );
  if (gate.partnerOverrideRequired && !pricing.partnerOverrideId) {
    res.status(409).json({ error: "override-required-before-handoff" });
    return;
  }
  if (gate.twoPartnerRequired && !pricing.countersignPartnerId) {
    res.status(409).json({ error: "countersign-required-before-handoff" });
    return;
  }
  const engagementId = typeof req.body?.engagementId === "string" ? req.body.engagementId : null;
  const engWhere = engagementId
    ? and(eq(atelierEngagements.id, engagementId), eq(atelierEngagements.orgId, me.orgId))
    : and(eq(atelierEngagements.opportunityId, req.params.oppId), eq(atelierEngagements.orgId, me.orgId));
  const [eng] = await db.select().from(atelierEngagements).where(engWhere).limit(1);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found", hint: "Billing rules live on the engagement — create/convert it first or pass engagementId." });
    return;
  }
  const kind = normalizeStructureKind(pricing.pricingModel);
  // Rebuild the simulation from persisted terms (or reuse snapshot).
  const policy = await loadDefaultPolicy();
  const rateCardRows = await loadRateCardRows(pricing.rateCardId);
  const sim = simulateStructure({
    kind,
    params: (pricing.structureParams as StructureParams | null) ?? null,
    teamMix: pricing.teamMix as TeamMixEntry[],
    durationWeeks: pricing.durationWeeks,
    rateCardRows,
    policy,
    costLines: normalizeCostLines(pricing.costLines ?? []),
  });
  const startDate = typeof req.body?.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.startDate)
    ? req.body.startDate
    : eng.startDate;
  const plan = buildBillingHandoff({ kind, sim, startDate });
  const ruleId = rid("brule");
  const [rule] = await db
    .insert(atelierBillingRule)
    .values({
      id: ruleId,
      engagementId: eng.id,
      accountId: eng.accountId,
      ruleType: plan.ruleType,
      currency: "USD",
      paymentTermsDays: sim.assumptions.paymentTermsDays,
      config: plan.config,
      notes: `${plan.notes} (handoff from opportunity ${req.params.oppId}, structure: ${sim.label})`,
      createdByUserId: me.id,
    })
    .returning();
  await db
    .update(atelierDealPricings)
    .set({ billingRuleId: ruleId, billingHandoffAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierDealPricings.id, pricing.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "pricing.billing_handoff",
    payload: { ruleId, engagementId: eng.id, ruleType: plan.ruleType, structureKind: kind },
    payloadSummary: `${me.name} handed off ${sim.label} pricing to billing rule ${ruleId} on ${eng.name}`,
  });
  res.status(201).json({ rule, plan, sim });
});

// =============================================================
// Pricing Researcher (Task #663) — async web-search market research.
// Review-only: output lands as a suggestion snapshot on the pricing row
// (pricingResearcherOutput) and is NEVER auto-applied to economic terms.
// Launch returns 202 immediately (proxy times out held requests); the
// client polls the status route. In-memory launch map bridges the gap
// before the durable agent_run row exists.
// =============================================================
type ResearcherLaunchState = {
  status: "running" | "succeeded" | "failed";
  error: string | null;
  runId: string | null;
  startedAt: number;
};
const researcherLaunches = new Map<string, ResearcherLaunchState>();

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/researcher", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const oppId = req.params.oppId;
  const inFlight = researcherLaunches.get(oppId);
  if (inFlight?.status === "running") {
    res.status(202).json({ status: "running", runId: inFlight.runId });
    return;
  }
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, oppId), isNull(atelierOpportunities.deletedAt)));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const policy = await loadDefaultPolicy();
  const existing = await loadOrInitDealPricing(opp.id, policy);
  if (!existing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const focus = typeof req.body?.focus === "string" && req.body.focus.trim() ? req.body.focus.trim().slice(0, 500) : undefined;
  const launch: ResearcherLaunchState = { status: "running", error: null, runId: null, startedAt: Date.now() };
  researcherLaunches.set(oppId, launch);
  void (async () => {
    try {
      const result = await runPricingResearcher({
        opportunity: opp,
        pricing: existing,
        policy,
        actorId: me.id,
        actorLabel: me.name,
        focus,
      });
      launch.status = "succeeded";
      launch.runId = result.runId;
    } catch (err) {
      launch.status = "failed";
      launch.error = err instanceof Error ? err.message : "researcher-failed";
    }
  })();
  res.status(202).json({ status: "running" });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/pricing/researcher", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const oppId = req.params.oppId;
  const [pricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, oppId), isNull(atelierDealPricings.deletedAt)));
  const launch = researcherLaunches.get(oppId);
  if (launch?.status === "running") {
    // Surface the live phase from the run row when it exists already.
    const [row] = await db
      .select({ statusMessage: atelierAgentRuns.statusMessage, progressPct: atelierAgentRuns.progressPct })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, "ag_pricing_researcher"),
          eq(atelierAgentRuns.targetType, "opportunity"),
          eq(atelierAgentRuns.targetId, oppId),
        ),
      )
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(1);
    res.json({
      status: "running",
      phase: row?.statusMessage ?? "Starting research…",
      progressPct: row?.progressPct ?? 0,
      output: null,
    });
    return;
  }
  if (launch?.status === "failed") {
    res.json({ status: "failed", phase: launch.error, progressPct: null, output: null });
    return;
  }
  if (pricing?.pricingResearcherOutput) {
    res.json({
      status: "succeeded",
      phase: null,
      progressPct: 100,
      runId: pricing.pricingResearcherRunId,
      output: pricing.pricingResearcherOutput,
    });
    return;
  }
  res.json({ status: null, phase: null, progressPct: null, output: null });
});

// Strategist — accepts the canonical agent input contract:
//   { opportunity_id?, primary_intent?, target_margin_pct?, alternative_lenses? }
// (opportunity_id from path takes precedence; the body fields are forwarded
// to the runner as hints alongside persisted pricing.) Output is returned
// in BOTH the implementation shape (`primary`, `talkingPoints`) and the
// spec-canonical aliases (`primary_pricing`, `talking_points_for_partner`)
// so existing UI keeps working while spec-conformant integrations can read
// the snake_case fields directly.
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/strategist", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, req.params.oppId), isNull(atelierOpportunities.deletedAt)));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  let policy = await loadDefaultPolicy();
  if (typeof req.body?.target_margin_pct === "number") {
    policy = { ...policy, targetMarginPct: req.body.target_margin_pct };
  }
  const existing = await loadOrInitDealPricing(opp.id, policy);
  if (!existing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const rateCardRows = await loadRateCardRows(existing.rateCardId);
  try {
    const result = await runPricingStrategist({
      opportunity: opp,
      pricing: existing,
      policy,
      rateCardRows,
      actorId: me.id,
      actorLabel: me.name,
      primaryIntent: typeof req.body?.primary_intent === "string" ? req.body.primary_intent : undefined,
      alternativeLenses: Array.isArray(req.body?.alternative_lenses) ? req.body.alternative_lenses : undefined,
    });
    // Dual-shape output: implementation camelCase + spec snake_case aliases.
    res.json({
      ...result,
      primary_pricing: result.primary,
      talking_points_for_partner: result.talkingPoints,
      margin_lock_chip: result.marginLockChip,
      partner_override_required: result.partnerOverrideRequired,
      two_partner_required: result.twoPartnerRequired,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "strategist-failed" });
  }
});

// Single-Partner override
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/override", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const rationale: string = String(req.body?.rationale ?? "").trim();
  if (!rationale) {
    res.status(400).json({ error: "rationale-required" });
    return;
  }
  const [pricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, req.params.oppId), isNull(atelierDealPricings.deletedAt)));
  if (!pricing) {
    res.status(404).json({ error: "pricing-not-found" });
    return;
  }
  // Re-classify against the *current* policy so a tightened/loosened
  // policy is honoured immediately. Override is required when the live
  // gate flags partnerOverrideRequired, regardless of the snapshot.
  const livePolicyForOverride = await loadDefaultPolicy();
  const liveGateForOverride = classifyMarginGate(pricing.computedMarginPct, livePolicyForOverride);
  if (!liveGateForOverride.partnerOverrideRequired) {
    res.status(409).json({ error: "no-override-needed" });
    return;
  }
  const [updated] = await db
    .update(atelierDealPricings)
    .set({
      partnerOverrideId: me.id,
      partnerOverrideAt: new Date(),
      partnerOverrideRationale: rationale,
      updatedAt: new Date(),
    })
    .where(eq(atelierDealPricings.id, pricing.id))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "pricing.override",
    payload: { rationale, marginLockStatus: pricing.marginLockStatus, marginPct: pricing.computedMarginPct },
    payloadSummary: `${me.name} overrode ${pricing.marginLockStatus.toUpperCase()} margin (${(pricing.computedMarginPct * 100).toFixed(1)}%) — "${rationale.slice(0, 80)}"`,
  });
  // If the live two-Partner threshold demands a second partner, queue Pane A.
  if (liveGateForOverride.twoPartnerRequired) {
    const otherPartners = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.role, "partner"));
    for (const p of otherPartners) {
      if (p.id === me.id) continue;
      await db.insert(atelierPaneAItems).values({
        id: rid("pa"),
        userId: p.id,
        title: `Countersign required: ${req.params.oppId}`,
        summary: `${me.name} overrode RED margin (${(pricing.computedMarginPct * 100).toFixed(1)}%). Second-Partner countersign required to send.`,
        priority: "high",
        hrefKind: "opportunity",
        hrefTargetId: req.params.oppId,
        dueLabel: "Now",
      });
    }
  }
  res.json(updated);
});

// Second-Partner countersign
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/pricing/countersign", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const rationale: string = String(req.body?.rationale ?? "").trim();
  if (!rationale) {
    res.status(400).json({ error: "rationale-required" });
    return;
  }
  const [pricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, req.params.oppId), isNull(atelierDealPricings.deletedAt)));
  if (!pricing) {
    res.status(404).json({ error: "pricing-not-found" });
    return;
  }
  if (!pricing.partnerOverrideId) {
    res.status(409).json({ error: "no-prior-override" });
    return;
  }
  if (pricing.partnerOverrideId === me.id) {
    res.status(409).json({ error: "countersign-must-be-different-partner" });
    return;
  }
  // Honour the configurable two-Partner threshold (PRD §2.4) — refuse a
  // countersign on a margin that doesn't actually require one. Uses the
  // shared classifyMarginGate helper so submit / override / countersign
  // can never deadlock under non-default policy settings.
  const policyForCountersign = await loadDefaultPolicy();
  const gateForCountersign = classifyMarginGate(pricing.computedMarginPct, policyForCountersign);
  if (!gateForCountersign.twoPartnerRequired) {
    res.status(409).json({
      error: "countersign-not-required",
      hint: `Margin ${(pricing.computedMarginPct * 100).toFixed(1)}% is at or above two-Partner threshold (${(policyForCountersign.twoPartnerThresholdPct * 100).toFixed(0)}%).`,
    });
    return;
  }
  const [updated] = await db
    .update(atelierDealPricings)
    .set({
      countersignPartnerId: me.id,
      countersignAt: new Date(),
      countersignRationale: rationale,
      updatedAt: new Date(),
    })
    .where(eq(atelierDealPricings.id, pricing.id))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "pricing.countersign",
    payload: { rationale, firstPartnerId: pricing.partnerOverrideId },
    payloadSummary: `${me.name} countersigned ${pricing.marginLockStatus.toUpperCase()} margin override on ${req.params.oppId}`,
  });
  res.json(updated);
});

// Delete a single rate-card row (Partner-only, soft delete via real DELETE
// since the table has no deletedAt — rows are inexpensive to recreate).
// @cli-skip: pending Task #340 read-parity migration
router.delete("/rate-cards/:id/rows/:rowId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const [row] = await db
    .select()
    .from(atelierRateCardRows)
    .where(and(eq(atelierRateCardRows.id, req.params.rowId), eq(atelierRateCardRows.rateCardId, req.params.id)));
  if (!row) {
    res.status(404).json({ error: "row-not-found" });
    return;
  }
  await db
    .update(atelierRateCardRows)
    .set({ deletedAt: new Date() })
    .where(eq(atelierRateCardRows.id, row.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "rate_card",
    entityId: req.params.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "rate_card.row_delete",
    payload: { rowId: row.id, seniority: row.seniority },
    payloadSummary: `${me.name} removed ${row.seniority} (${row.role}) from rate card ${req.params.id}`,
  });
  res.status(204).end();
});

// Archive (soft-delete) a rate card. Partner-only. Refuses if the card is
// referenced by a non-deleted dealPricing row.
// @cli-skip: pending Task #340 read-parity migration
router.delete("/rate-cards/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!requirePartner(me, res)) return;
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(eq(atelierRateCards.id, req.params.id), isNull(atelierRateCards.deletedAt)));
  if (!card) {
    res.status(404).json({ error: "card-not-found" });
    return;
  }
  const inUse = await db
    .select({ id: atelierDealPricings.id })
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.rateCardId, card.id), isNull(atelierDealPricings.deletedAt)))
    .limit(1);
  if (inUse.length > 0) {
    res.status(409).json({ error: "rate-card-in-use", hint: "Archive after migrating active deal pricings." });
    return;
  }
  await db
    .update(atelierRateCards)
    .set({ status: "archived", deletedAt: new Date() })
    .where(eq(atelierRateCards.id, card.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "rate_card",
    entityId: card.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "rate_card.archive",
    payload: { name: card.name },
    payloadSummary: `${me.name} archived rate card ${card.name}`,
  });
  res.status(204).end();
});

export default router;
