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
} from "@workspace/db";
import {
  computePricing,
  type MarginPolicy,
  type RateCardRowLite,
  type TeamMixEntry,
} from "../../lib/atelier-pricing.js";
import { runPricingStrategist } from "../../lib/atelier-agents/runner.js";

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
  if (me.role !== "partner") {
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
router.get("/rate-cards", async (_req, res) => {
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

router.get("/rate-cards/:id", async (req, res) => {
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(eq(atelierRateCards.id, req.params.id), isNull(atelierRateCards.deletedAt)));
  if (!card) {
    res.status(404).json({ error: "rate-card-not-found" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierRateCardRows)
    .where(and(eq(atelierRateCardRows.rateCardId, card.id), isNull(atelierRateCardRows.deletedAt)));
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
      dayRateInternalCost: r.dayRateInternalCost,
      dayRateClientPrice: r.dayRateClientPrice,
      overheadPct: r.overheadPct,
      currency: r.currency,
    })),
  });
});

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
router.get("/margin-policy", async (_req, res) => {
  const policy = await loadDefaultPolicy();
  res.json(policy);
});

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

router.get("/opportunities/:oppId/pricing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const policy = await loadDefaultPolicy();
  const pricing = await loadOrInitDealPricing(req.params.oppId, policy);
  if (!pricing) {
    res.status(409).json({ error: "no-active-rate-card" });
    return;
  }
  const rows = await loadRateCardRows(pricing.rateCardId);
  res.json({ pricing, policy, rateCardRows: rows });
});

router.put("/opportunities/:oppId/pricing", async (req, res) => {
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
  const pricingModel: string = typeof req.body?.pricingModel === "string" ? req.body.pricingModel : existing.pricingModel;
  const rateCardId: string = typeof req.body?.rateCardId === "string" ? req.body.rateCardId : existing.rateCardId;
  const rateCardRows = await loadRateCardRows(rateCardId);
  const compute = computePricing({ teamMix, durationWeeks, rateCardRows, policy });
  const [updated] = await db
    .update(atelierDealPricings)
    .set({
      teamMix,
      durationWeeks,
      pricingModel,
      rateCardId,
      computedCostUsd: compute.computedCostUsd,
      computedPriceUsd: compute.computedPriceUsd,
      computedMarginPct: compute.computedMarginPct,
      marginLockStatus: compute.marginLockStatus,
      targetMarginPct: policy.targetMarginPct,
      updatedAt: new Date(),
    })
    .where(eq(atelierDealPricings.id, existing.id))
    .returning();
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
      marginLockStatus: compute.marginLockStatus,
    },
    payloadSummary: `${me.name} updated pricing — margin ${(compute.computedMarginPct * 100).toFixed(1)}% (${compute.marginLockStatus})`,
  });
  res.json({ pricing: updated, policy, rateCardRows, breakdown: compute.perRoleBreakdown });
});

// What-if: pure compute, no persistence.
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

// Strategist
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
  const policy = await loadDefaultPolicy();
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
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "strategist-failed" });
  }
});

// Single-Partner override
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
  if (pricing.marginLockStatus === "green") {
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
  // If we're in RED and the policy demands a second partner, queue Pane A.
  if (pricing.marginLockStatus === "red") {
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

export default router;
