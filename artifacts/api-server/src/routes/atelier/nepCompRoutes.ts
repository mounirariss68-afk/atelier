/**
 * Task #1298 — Non-salaried NEP compensation routes.
 *
 * Finance/founder surfaces for effective-dated NEP comp plans, origination
 * attribution, margin-share entitlements and the conversion tracker, plus
 * the NEP's own read-only /me/nep-comp view.
 *
 * Gating:
 *  - Reads: canViewCompensation (founding_partner | hr | finance) — person-
 *    level comp visibility, consistent with the roster comp gate.
 *  - Writes: founding_partner | finance only (plan terms, attribution flags
 *    and entitlement approvals move money).
 *  - /me/nep-comp: any persona, self-scoped via the contractor email link.
 *
 * Entitlements are NEVER auto-paid: approval here only makes them eligible
 * for the maker-checker payment-run build in financePayablesRoutes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierAccounts,
  atelierEngagements,
  atelierContractors,
  atelierEmployees,
  atelierNepCompPlans,
  atelierNepEntitlements,
  atelierContractorPayments,
  atelierSelfBilledInvoices,
  atelierContractRecords,
  atelierContractDocuments,
  atelierContractorEngagementRates,
  atelierPersonRelationshipClassifications,
} from "@workspace/db";
import { canViewCompensation } from "./personaRoles.js";
import {
  computeConversionProgress,
  loadPlansForContractor,
  pickEffectivePlan,
  recomputeNepEntitlements,
  syncContractorDayRate,
  computeDueDate,
  type NepPlan,
  type NepEntitlement,
} from "../../lib/atelier-nep-comp.js";
import { loadRelationshipClassification } from "./governanceRoutes.js";

type Me = typeof atelierUsers.$inferSelect;
const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function audit(args: {
  entityType: string; entityId: string; actor: Me;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), orgId: args.actor.orgId,
    entityType: args.entityType, entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

function readGate(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  if (!canViewCompensation(me.role)) {
    res.status(403).json({ error: "comp-viewers-only", message: "NEP compensation is visible to founders, HR and Finance only." });
    return null;
  }
  return me;
}

function writeGate(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  if (me.role !== "founding_partner" && me.role !== "finance") {
    res.status(403).json({ error: "founder-finance-only", message: "Only founders and Finance can change NEP compensation." });
    return null;
  }
  return me;
}

function planWire(p: NepPlan) {
  return {
    id: p.id,
    contractorId: p.contractorId,
    userId: p.userId,
    effectiveFrom: p.effectiveFrom,
    currency: p.currency,
    dayRateAmount: p.dayRateAmount,
    marginSharePctSale: p.marginSharePctSale,
    marginSharePctOriginationOnly: p.marginSharePctOriginationOnly,
    originationWindowMonths: p.originationWindowMonths,
    conversionRevenueThresholdUsd: p.conversionRevenueThresholdUsd,
    conversionMarginThresholdPct: p.conversionMarginThresholdPct,
    postConversionSalaryAmount: p.postConversionSalaryAmount,
    postConversionSalaryCurrency: p.postConversionSalaryCurrency,
    postConversionVariableNote: p.postConversionVariableNote,
    status: p.status,
    convertedAt: p.convertedAt?.toISOString() ?? null,
    endedAt: p.endedAt?.toISOString() ?? null,
    statusNote: p.statusNote,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    governingContractId: p.governingContractId,
    governingContractVersionId: p.governingContractVersionId,
    provenanceStatus:
      p.governingContractId && p.governingContractVersionId
        ? "verified"
        : "requires_review",
  };
}

function entitlementWire(e: NepEntitlement) {
  return {
    id: e.id,
    contractorId: e.contractorId,
    planId: e.planId,
    engagementId: e.engagementId,
    engagementName: e.engagementName,
    accountId: e.accountId,
    accountName: e.accountName,
    tier: e.tier,
    tierPct: e.tierPct,
    feesInvoicedUsd: e.feesInvoicedUsd,
    feesCollectedUsd: e.feesCollectedUsd,
    directCostsUsd: e.directCostsUsd,
    ownTimeChargesUsd: e.ownTimeChargesUsd,
    projectProfitUsd: e.projectProfitUsd,
    amountUsd: e.amountUsd,
    statement: e.statement,
    fullyCollected: e.fullyCollected,
    collectedAt: e.collectedAt?.toISOString() ?? null,
    clientAcceptedAt: e.clientAcceptedAt?.toISOString() ?? null,
    dueDate: e.dueDate,
    status: e.status,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidReason: e.voidReason,
    paymentRunId: e.paymentRunId,
    paidAt: e.paidAt?.toISOString() ?? null,
    remittanceRef: e.remittanceRef,
  };
}

async function loadContractor(orgId: string, contractorId: string) {
  const [row] = await db.select().from(atelierContractors).where(and(
    eq(atelierContractors.orgId, orgId),
    eq(atelierContractors.id, contractorId),
    isNull(atelierContractors.deletedAt),
  ));
  return row ?? null;
}

/** Resolve the login user for a contractor (by e-mail, like the Me lens). */
async function resolveContractorUserId(orgId: string, email: string): Promise<string | null> {
  const rows = await db.select({ id: atelierUsers.id, email: atelierUsers.email })
    .from(atelierUsers).where(eq(atelierUsers.orgId, orgId));
  const norm = email.trim().toLowerCase();
  return rows.find((u) => (u.email ?? "").trim().toLowerCase() === norm)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function strictDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function rateWire(row: typeof atelierContractorEngagementRates.$inferSelect) {
  return {
    id: row.id,
    contractorId: row.contractorId,
    engagementId: row.engagementId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    dayRateAmount: row.dayRateAmount,
    amount: row.dayRateAmount,
    currency: row.currency,
    governingAgreementRef: row.agreementRef,
    scopeRef: row.agreementVersionRef,
    agreementRef: row.agreementRef,
    agreementVersionRef: row.agreementVersionRef,
    scope: row.scope,
    allowsNepOverride: row.allowsNepOverride,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function rateSubjects(orgId: string, contractorId: string, engagementId: string) {
  const [contractor] = await db.select({ id: atelierContractors.id })
    .from(atelierContractors).where(and(
      eq(atelierContractors.orgId, orgId), eq(atelierContractors.id, contractorId),
      isNull(atelierContractors.deletedAt),
    ));
  const [engagement] = await db.select({ id: atelierEngagements.id })
    .from(atelierEngagements).where(and(
      eq(atelierEngagements.orgId, orgId), eq(atelierEngagements.id, engagementId),
      isNull(atelierEngagements.deletedAt),
    ));
  return { contractor, engagement };
}

function rateInput(body: Record<string, unknown>) {
  const effectiveFrom = body.effectiveFrom;
  const effectiveTo = body.effectiveTo;
  const amount = body.amount ?? body.dayRateAmount;
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  const governingAgreementRef = body.governingAgreementRef ?? body.agreementRef;
  const scopeRef = body.scopeRef ?? body.agreementVersionRef;
  const scope = Array.isArray(body.scope) && body.scope.every((v) => typeof v === "string")
    ? body.scope as string[] : [];
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!strictDate(effectiveFrom) || (effectiveTo !== undefined && effectiveTo !== null && !strictDate(effectiveTo)))
    return { error: "invalid-effective-dates" as const };
  if (effectiveTo != null && (effectiveTo as string) < (effectiveFrom as string))
    return { error: "effective-to-before-from" as const };
  if (!Number.isFinite(n) || n <= 0) return { error: "amount-must-be-positive" as const };
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "invalid-currency" as const };
  if (typeof governingAgreementRef !== "string" || !governingAgreementRef.trim() ||
      typeof scopeRef !== "string" || !scopeRef.trim() || scope.length === 0)
    return { error: "governing-agreement-and-scope-provenance-required" as const };
  if (typeof body.allowsNepOverride !== "boolean")
    return { error: "allows-nep-override-explicit-required" as const };
  return {
    value: {
      effectiveFrom: effectiveFrom as string,
      effectiveTo: effectiveTo == null ? null : effectiveTo as string,
      dayRateAmount: n,
      currency,
      agreementRef: governingAgreementRef.trim(),
      agreementVersionRef: scopeRef.trim(),
      scope,
      allowsNepOverride: body.allowsNepOverride,
    },
  };
}

// @cli-skip: NEP rate registry is compensation-sensitive; assistant read parity is not approved
router.get("/finance/nep-comp/engagement-rates", async (req, res, next) => {
  try {
    const me = readGate(req, res); if (!me) return;
    const conditions = [eq(atelierContractorEngagementRates.orgId, me.orgId), isNull(atelierContractorEngagementRates.deletedAt)];
    if (typeof req.query.contractorId === "string") conditions.push(eq(atelierContractorEngagementRates.contractorId, req.query.contractorId));
    if (typeof req.query.engagementId === "string") conditions.push(eq(atelierContractorEngagementRates.engagementId, req.query.engagementId));
    const rows = await db.select().from(atelierContractorEngagementRates).where(and(...conditions)).orderBy(desc(atelierContractorEngagementRates.effectiveFrom));
    res.json({ items: rows.map(rateWire) });
  } catch (err) { next(err); }
});

// @cli-skip: NEP rate detail is compensation-sensitive; assistant read parity is not approved
router.get("/finance/nep-comp/engagement-rates/:id", async (req, res, next) => {
  try {
    const me = readGate(req, res); if (!me) return;
    const [row] = await db.select().from(atelierContractorEngagementRates).where(and(
      eq(atelierContractorEngagementRates.orgId, me.orgId),
      eq(atelierContractorEngagementRates.id, req.params.id),
      isNull(atelierContractorEngagementRates.deletedAt),
    ));
    if (!row) return void res.status(404).json({ error: "rate-term-not-found" });
    res.json({ rate: rateWire(row) });
  } catch (err) { next(err); }
});

// @cli-skip: NEP rate creation is a compensation workflow; assistant authority parity is unproven
router.post("/finance/nep-comp/engagement-rates", async (req, res, next) => {
  try {
    const me = writeGate(req, res); if (!me) return;
    const b = req.body ?? {};
    const contractorId = typeof b.contractorId === "string" ? b.contractorId : "";
    const engagementId = typeof b.engagementId === "string" ? b.engagementId : "";
    const subjects = await rateSubjects(me.orgId, contractorId, engagementId);
    if (!subjects.contractor) return void res.status(404).json({ error: "contractor-not-found" });
    if (!subjects.engagement) return void res.status(404).json({ error: "engagement-not-found" });
    const parsed = rateInput(b);
    if ("error" in parsed) return void res.status(400).json({ error: parsed.error });
    const [duplicate] = await db.select({ id: atelierContractorEngagementRates.id })
      .from(atelierContractorEngagementRates).where(and(
        eq(atelierContractorEngagementRates.orgId, me.orgId),
        eq(atelierContractorEngagementRates.contractorId, contractorId),
        eq(atelierContractorEngagementRates.engagementId, engagementId),
        eq(atelierContractorEngagementRates.effectiveFrom, parsed.value.effectiveFrom),
        isNull(atelierContractorEngagementRates.deletedAt),
      ));
    if (duplicate) return void res.status(409).json({ error: "duplicate-effective-date" });
    const id = rid("ctr_rate");
    const [row] = await db.insert(atelierContractorEngagementRates).values({
      id, orgId: me.orgId, contractorId, engagementId, ...parsed.value,
      createdByUserId: me.id, updatedByUserId: me.id,
    }).returning();
    await audit({ entityType: "contractor_engagement_rate", entityId: id, actor: me, action: "nep_comp.engagement_rate_create", payload: { contractorId, engagementId, effectiveFrom: parsed.value.effectiveFrom, allowsNepOverride: parsed.value.allowsNepOverride }, summary: `Created contractor engagement rate term effective ${parsed.value.effectiveFrom}.` });
    res.status(201).json({ ok: true, rate: rateWire(row) });
  } catch (err) { next(err); }
});

// @cli-skip: NEP rate editing is a compensation workflow; assistant authority parity is unproven
router.patch("/finance/nep-comp/engagement-rates/:id", async (req, res, next) => {
  try {
    const me = writeGate(req, res); if (!me) return;
    const [existing] = await db.select().from(atelierContractorEngagementRates).where(and(
      eq(atelierContractorEngagementRates.orgId, me.orgId), eq(atelierContractorEngagementRates.id, req.params.id),
      isNull(atelierContractorEngagementRates.deletedAt),
    ));
    if (!existing) return void res.status(404).json({ error: "rate-term-not-found" });
    const parsed = rateInput({ ...existing, ...req.body });
    if ("error" in parsed) return void res.status(400).json({ error: parsed.error });
    const [duplicate] = await db.select({ id: atelierContractorEngagementRates.id })
      .from(atelierContractorEngagementRates).where(and(
        eq(atelierContractorEngagementRates.orgId, me.orgId),
        eq(atelierContractorEngagementRates.contractorId, existing.contractorId),
        eq(atelierContractorEngagementRates.engagementId, existing.engagementId),
        eq(atelierContractorEngagementRates.effectiveFrom, parsed.value.effectiveFrom),
        isNull(atelierContractorEngagementRates.deletedAt),
      ));
    if (duplicate && duplicate.id !== existing.id) return void res.status(409).json({ error: "duplicate-effective-date" });
    const [row] = await db.update(atelierContractorEngagementRates).set({ ...parsed.value, updatedByUserId: me.id, updatedAt: new Date() })
      .where(and(eq(atelierContractorEngagementRates.id, existing.id), isNull(atelierContractorEngagementRates.deletedAt))).returning();
    await audit({ entityType: "contractor_engagement_rate", entityId: existing.id, actor: me, action: "nep_comp.engagement_rate_update", payload: { changes: req.body }, summary: "Updated contractor engagement rate term." });
    res.json({ ok: true, rate: rateWire(row) });
  } catch (err) { next(err); }
});

// @cli-skip: NEP rate deletion is a compensation workflow; assistant authority parity is unproven
router.delete("/finance/nep-comp/engagement-rates/:id", async (req, res, next) => {
  try {
    const me = writeGate(req, res); if (!me) return;
    const [row] = await db.update(atelierContractorEngagementRates).set({ deletedAt: new Date(), updatedByUserId: me.id, updatedAt: new Date() })
      .where(and(eq(atelierContractorEngagementRates.orgId, me.orgId), eq(atelierContractorEngagementRates.id, req.params.id), isNull(atelierContractorEngagementRates.deletedAt))).returning();
    if (!row) return void res.status(404).json({ error: "rate-term-not-found" });
    await audit({ entityType: "contractor_engagement_rate", entityId: row.id, actor: me, action: "nep_comp.engagement_rate_delete", payload: {}, summary: "Soft-deleted contractor engagement rate term." });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration; read-parity handled by the finance NEP-comp web surface
router.get("/finance/nep-comp/plans", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const rows = await db.select().from(atelierNepCompPlans).where(and(
      eq(atelierNepCompPlans.orgId, me.orgId),
      isNull(atelierNepCompPlans.deletedAt),
    )).orderBy(desc(atelierNepCompPlans.effectiveFrom));
    const contractorIds = [...new Set(rows.map((p) => p.contractorId))];
    const contractors = contractorIds.length
      ? await db.select({ id: atelierContractors.id, fullName: atelierContractors.fullName })
          .from(atelierContractors)
          .where(and(eq(atelierContractors.orgId, me.orgId), inArray(atelierContractors.id, contractorIds)))
      : [];
    const nameById = new Map(contractors.map((c) => [c.id, c.fullName]));
    res.json({
      items: rows.map((p) => ({ ...planWire(p), contractorName: nameById.get(p.contractorId) ?? null })),
    });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration write; UI maker flow only
router.post("/finance/nep-comp/plans", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const b = req.body ?? {};
    const contractorId = typeof b.contractorId === "string" ? b.contractorId : "";
    const contractor = contractorId ? await loadContractor(me.orgId, contractorId) : null;
    if (!contractor) { res.status(404).json({ error: "contractor-not-found" }); return; }
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const dayRateAmount = num(b.dayRateAmount);
    const marginSharePctSale = num(b.marginSharePctSale);
    const marginSharePctOriginationOnly = num(b.marginSharePctOriginationOnly);
    const originationWindowMonths = num(b.originationWindowMonths);
    const conversionRevenueThresholdUsd = num(b.conversionRevenueThresholdUsd);
    const conversionMarginThresholdPct = num(b.conversionMarginThresholdPct);
    const effectiveFrom = typeof b.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.effectiveFrom)
      ? b.effectiveFrom : null;
    const governingContractId = typeof b.governingContractId === "string" ? b.governingContractId : null;
    const governingContractVersionId = typeof b.governingContractVersionId === "string" ? b.governingContractVersionId : null;
    if (
      dayRateAmount == null || dayRateAmount < 0 ||
      marginSharePctSale == null || marginSharePctSale < 0 || marginSharePctSale > 100 ||
      marginSharePctOriginationOnly == null || marginSharePctOriginationOnly < 0 || marginSharePctOriginationOnly > 100 ||
      originationWindowMonths == null || originationWindowMonths < 0 ||
      conversionRevenueThresholdUsd == null || conversionRevenueThresholdUsd < 0 ||
      conversionMarginThresholdPct == null || conversionMarginThresholdPct < 0 || conversionMarginThresholdPct > 100 ||
       !effectiveFrom || !governingContractId || !governingContractVersionId
    ) {
      res.status(400).json({ error: "invalid-plan-terms", message: "Plan terms and signed governing contract provenance are required." });
      return;
    }
    const classification = contractor.personId ? await loadRelationshipClassification(me.orgId, contractor.personId) : null;
    if (!classification || classification.relationshipType !== "non_equity_partner") { res.status(409).json({ error: "classification-required", message: "A canonical non_equity_partner classification is required before creating NEP compensation." }); return; }
    const [contract] = await db.select().from(atelierContractRecords).where(and(eq(atelierContractRecords.orgId, me.orgId), eq(atelierContractRecords.id, governingContractId), eq(atelierContractRecords.status, "signed")));
    const [signedDocument] = await db.select({ id: atelierContractDocuments.id }).from(atelierContractDocuments).where(and(
      eq(atelierContractDocuments.orgId, me.orgId),
      eq(atelierContractDocuments.id, governingContractVersionId),
      eq(atelierContractDocuments.contractId, governingContractId),
      eq(atelierContractDocuments.kind, "signed_pdf"),
    ));
    const allowedContract = contract && signedDocument && ["non_equity_partner_employment", "contractor_agreement"].includes(contract.contractType) && contract.counterpartyKind === "person" && (contract.personId === contractor.id || contract.personId === contractor.personId) && contract.currentDocumentId === governingContractVersionId;
    if (!allowedContract) { res.status(409).json({ error: "signed-governing-contract-required", message: "The governing contract must be an org-scoped signed NEP/contractor agreement linked to this contractor or canonical person and its current signed document version." }); return; }
    const currency = typeof b.currency === "string" && b.currency ? b.currency.toUpperCase().slice(0, 3) : "USD";
    const priorPlans = await loadPlansForContractor(me.orgId, contractorId);
    if (priorPlans.some((p) => p.effectiveFrom === effectiveFrom)) {
      res.status(409).json({ error: "duplicate-effective-date", message: `A plan revision effective ${effectiveFrom} already exists.` });
      return;
    }
    const lineageStatus = priorPlans[0]?.status ?? "pre_conversion";
    if (lineageStatus === "ended") {
      res.status(409).json({ error: "plan-ended", message: "This NEP's plan lineage is ended; create requires reactivating with founders." });
      return;
    }
    const userId = await resolveContractorUserId(me.orgId, contractor.email);
    const id = rid("nepplan");
    await db.insert(atelierNepCompPlans).values({
      id,
      orgId: me.orgId,
      contractorId,
      userId,
      effectiveFrom,
      currency,
      dayRateAmount,
      marginSharePctSale,
      marginSharePctOriginationOnly,
      originationWindowMonths,
      conversionRevenueThresholdUsd,
      conversionMarginThresholdPct,
      postConversionSalaryAmount: num(b.postConversionSalaryAmount),
      postConversionSalaryCurrency: typeof b.postConversionSalaryCurrency === "string" ? b.postConversionSalaryCurrency.toUpperCase().slice(0, 3) : null,
      postConversionVariableNote: typeof b.postConversionVariableNote === "string" ? b.postConversionVariableNote.slice(0, 2000) : null,
      status: lineageStatus,
      notes: typeof b.notes === "string" ? b.notes.slice(0, 4000) : null,
      createdByUserId: me.id,
       governingContractId,
       governingContractVersionId,
    });
    // Time charges ride the existing contractor day-rate machinery: keep
    // the roster day rate in lockstep with the CURRENTLY EFFECTIVE plan
    // (audited). A future-dated revision must NOT change the operational
    // rate today — it is applied when it becomes effective (recompute and
    // subsequent plan writes re-derive via pickEffectivePlan).
    const prevRate = contractor.dayRateAmount;
    const [afterInsert] = await db.select().from(atelierNepCompPlans).where(eq(atelierNepCompPlans.id, id));
    const effectiveNow = pickEffectivePlan([...priorPlans, afterInsert], new Date().toISOString().slice(0, 10));
    const dayRateSynced = effectiveNow != null;
    if (effectiveNow) {
      await db.update(atelierContractors).set({
        dayRateAmount: effectiveNow.dayRateAmount,
        dayRateCurrency: effectiveNow.currency,
        updatedAt: new Date(),
      }).where(eq(atelierContractors.id, contractor.id));
    }
    await audit({
      entityType: "nep_comp_plan", entityId: id, actor: me,
      action: "nep_comp.plan_create",
      payload: {
        contractorId, effectiveFrom, currency, dayRateAmount,
        marginSharePctSale, marginSharePctOriginationOnly, originationWindowMonths,
        conversionRevenueThresholdUsd, conversionMarginThresholdPct,
        postConversionSalaryAmount: num(b.postConversionSalaryAmount), governingContractId, governingContractVersionId,
        previousDayRate: prevRate,
        dayRateSynced,
        syncedDayRate: effectiveNow?.dayRateAmount ?? null,
      },
      summary: `NEP comp plan ${priorPlans.length ? "revised" : "created"} for ${contractor.fullName}: ${currency} ${dayRateAmount}/day, ${marginSharePctSale}%/${marginSharePctOriginationOnly}% margin share, effective ${effectiveFrom}.`,
    });
    const [row] = await db.select().from(atelierNepCompPlans).where(eq(atelierNepCompPlans.id, id));
    res.status(201).json({ ok: true, plan: planWire(row) });
  } catch (err) { next(err); }
});

// Explicit legacy bridge: never inferred from role/name. Re-running is safe.
// @cli-skip: NEP classification migration rewrites compensation history; assistant authority is not approved
router.post("/finance/nep-comp/plans/:contractorId/classification-migration", async (req, res, next) => {
  try {
    const me = writeGate(req, res); if (!me) return;
    const contractor = await loadContractor(me.orgId, req.params.contractorId);
    if (!contractor || !contractor.personId) { res.status(404).json({ error: "contractor-person-not-found" }); return; }
    if (req.body?.relationshipType !== "non_equity_partner") { res.status(400).json({ error: "explicit-nep-classification-required" }); return; }
    const effectiveFrom = typeof req.body?.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.effectiveFrom) ? req.body.effectiveFrom : new Date().toISOString().slice(0, 10);
    const [row] = await db.insert(atelierPersonRelationshipClassifications).values({ id: rid("rel"), orgId: me.orgId, personId: contractor.personId, relationshipType: "non_equity_partner", compensationBasis: "day_rate", status: "active", effectiveFrom, source: "explicit_legacy_migration", provenanceId: req.body?.provenanceId ?? null, createdByUserId: me.id }).onConflictDoUpdate({ target: [atelierPersonRelationshipClassifications.orgId, atelierPersonRelationshipClassifications.personId, atelierPersonRelationshipClassifications.effectiveFrom], set: { relationshipType: "non_equity_partner", compensationBasis: "day_rate", status: "active", updatedAt: new Date() } }).returning();
    await audit({ entityType: "person_relationship_classification", entityId: row.id, actor: me, action: "nep_comp.classification_migration", payload: { contractorId: contractor.id, personId: contractor.personId }, summary: "Explicit legacy NEP classification migration." });
    res.json({ ok: true, classification: row, idempotent: true });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration; read-parity handled by the finance NEP-comp web surface
router.get("/finance/nep-comp/plans/:contractorId", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const contractor = await loadContractor(me.orgId, req.params.contractorId);
    if (!contractor) { res.status(404).json({ error: "contractor-not-found" }); return; }
    const plans = await loadPlansForContractor(me.orgId, contractor.id);
    if (plans.length === 0) { res.status(404).json({ error: "no-plan" }); return; }
    const today = new Date().toISOString().slice(0, 10);
    const current = pickEffectivePlan(plans, today);
    const ents = await db.select().from(atelierNepEntitlements).where(and(
      eq(atelierNepEntitlements.orgId, me.orgId),
      eq(atelierNepEntitlements.contractorId, contractor.id),
      isNull(atelierNepEntitlements.deletedAt),
    )).orderBy(desc(atelierNepEntitlements.updatedAt));
    const conversion = await computeConversionProgress({ orgId: me.orgId, contractorId: contractor.id });
    res.json({
      contractor: { id: contractor.id, fullName: contractor.fullName, email: contractor.email },
      currentPlan: current ? planWire(current) : null,
      planHistory: plans
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
        .map(planWire),
      entitlements: ents.map(entitlementWire),
      conversion,
    });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration write; conversion is a human decision recorded via UI
router.post("/finance/nep-comp/plans/:contractorId/convert", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const contractor = await loadContractor(me.orgId, req.params.contractorId);
    if (!contractor) { res.status(404).json({ error: "contractor-not-found" }); return; }
    const plans = await loadPlansForContractor(me.orgId, contractor.id);
    if (plans.length === 0) { res.status(404).json({ error: "no-plan" }); return; }
    if (plans[0].status !== "pre_conversion") {
      res.status(409).json({ error: "invalid-status", message: `Plan is already ${plans[0].status}.` });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : null;
    const now = new Date();
    await db.update(atelierNepCompPlans).set({
      status: "converted", convertedAt: now, convertedByUserId: me.id, statusNote: note, updatedAt: now,
    }).where(and(
      eq(atelierNepCompPlans.orgId, me.orgId),
      eq(atelierNepCompPlans.contractorId, contractor.id),
      isNull(atelierNepCompPlans.deletedAt),
    ));
    await audit({
      entityType: "nep_comp_plan", entityId: plans[0].id, actor: me,
      action: "nep_comp.plan_convert",
      payload: { contractorId: contractor.id, note },
      summary: `Marked ${contractor.fullName}'s NEP plan CONVERTED — pre-conversion accrual stops for new engagements; employment comp takes over via the Conversion Addendum.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration write; UI maker flow only
router.post("/finance/nep-comp/plans/:contractorId/end", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const contractor = await loadContractor(me.orgId, req.params.contractorId);
    if (!contractor) { res.status(404).json({ error: "contractor-not-found" }); return; }
    const plans = await loadPlansForContractor(me.orgId, contractor.id);
    if (plans.length === 0) { res.status(404).json({ error: "no-plan" }); return; }
    if (plans[0].status === "ended") {
      res.status(409).json({ error: "invalid-status", message: "Plan is already ended." });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : null;
    const now = new Date();
    await db.update(atelierNepCompPlans).set({
      status: "ended", endedAt: now, endedByUserId: me.id, statusNote: note, updatedAt: now,
    }).where(and(
      eq(atelierNepCompPlans.orgId, me.orgId),
      eq(atelierNepCompPlans.contractorId, contractor.id),
      isNull(atelierNepCompPlans.deletedAt),
    ));
    await audit({
      entityType: "nep_comp_plan", entityId: plans[0].id, actor: me,
      action: "nep_comp.plan_end",
      payload: { contractorId: contractor.id, note },
      summary: `Ended ${contractor.fullName}'s NEP compensation plan.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Origination & material-contribution attribution
// ---------------------------------------------------------------------------

// @cli-skip: founder-only attribution write; changes payout tiers — UI maker flow only
router.patch("/finance/nep-comp/accounts/:accountId/origination", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const [acct] = await db.select().from(atelierAccounts).where(and(
      eq(atelierAccounts.orgId, me.orgId),
      eq(atelierAccounts.id, req.params.accountId),
      isNull(atelierAccounts.deletedAt),
    ));
    if (!acct) { res.status(404).json({ error: "account-not-found" }); return; }
    const b = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    const changes: Record<string, unknown> = {};
    if ("originatedByUserId" in b) {
      const v = b.originatedByUserId;
      if (v !== null && typeof v !== "string") { res.status(400).json({ error: "invalid-originated-by" }); return; }
      if (typeof v === "string") {
        const [u] = await db.select({ id: atelierUsers.id }).from(atelierUsers)
          .where(and(eq(atelierUsers.orgId, me.orgId), eq(atelierUsers.id, v)));
        if (!u) { res.status(404).json({ error: "user-not-found" }); return; }
      }
      patch.originatedByUserId = v;
      patch.originatedAt = v ? (acct.originatedAt ?? new Date()) : null;
      changes.originatedByUserId = { from: acct.originatedByUserId, to: v };
    }
    if ("firstEngagementAt" in b) {
      const v = b.firstEngagementAt;
      if (v !== null && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
        res.status(400).json({ error: "invalid-first-engagement-date" }); return;
      }
      patch.originationFirstEngagementAt = v;
      changes.firstEngagementAt = { from: acct.originationFirstEngagementAt, to: v };
    }
    if (Object.keys(changes).length === 0) { res.status(400).json({ error: "no-changes" }); return; }
    await db.update(atelierAccounts).set(patch).where(eq(atelierAccounts.id, acct.id));
    await audit({
      entityType: "account", entityId: acct.id, actor: me,
      action: "nep_comp.origination_update",
      payload: { changes },
      summary: `Updated origination attribution on account ${acct.name}.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// @cli-skip: founder-only attribution write; changes payout tiers — UI maker flow only
router.post("/finance/nep-comp/engagements/:engagementId/material-contribution", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const [eng] = await db.select().from(atelierEngagements).where(and(
      eq(atelierEngagements.orgId, me.orgId),
      eq(atelierEngagements.id, req.params.engagementId),
      isNull(atelierEngagements.deletedAt),
    ));
    if (!eng) { res.status(404).json({ error: "engagement-not-found" }); return; }
    const v = req.body?.userId ?? null;
    if (v !== null && typeof v !== "string") { res.status(400).json({ error: "invalid-user-id" }); return; }
    if (typeof v === "string") {
      const [u] = await db.select({ id: atelierUsers.id }).from(atelierUsers)
        .where(and(eq(atelierUsers.orgId, me.orgId), eq(atelierUsers.id, v)));
      if (!u) { res.status(404).json({ error: "user-not-found" }); return; }
    }
    const now = new Date();
    await db.update(atelierEngagements).set({
      materialContributionUserId: v,
      materialContributionSetByUserId: me.id,
      materialContributionSetAt: now,
      updatedAt: now,
    }).where(eq(atelierEngagements.id, eng.id));
    await audit({
      entityType: "engagement", entityId: eng.id, actor: me,
      action: "nep_comp.material_contribution_set",
      payload: { from: eng.materialContributionUserId, to: v },
      summary: v
        ? `Flagged material contribution to the sale of ${eng.name} (moves margin share to the sale tier).`
        : `Cleared material-contribution flag on ${eng.name}.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

// @cli-skip: finance comp administration write; idempotent recompute is a UI maker action
router.post("/finance/nep-comp/recompute", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const wantId = typeof req.body?.contractorId === "string" ? req.body.contractorId : null;
    const plans = await db.select({ contractorId: atelierNepCompPlans.contractorId })
      .from(atelierNepCompPlans)
      .where(and(eq(atelierNepCompPlans.orgId, me.orgId), isNull(atelierNepCompPlans.deletedAt)));
    const contractorIds = [...new Set(plans.map((p) => p.contractorId))]
      .filter((id) => !wantId || id === wantId);
    const results = [];
    for (const contractorId of contractorIds) {
      const [contractor] = await db.select({ personId: atelierContractors.personId }).from(atelierContractors).where(and(eq(atelierContractors.orgId, me.orgId), eq(atelierContractors.id, contractorId)));
      const classification = contractor?.personId ? await loadRelationshipClassification(me.orgId, contractor.personId) : null;
      if (!classification || classification.relationshipType !== "non_equity_partner") {
        res.status(409).json({ error: "classification-required", contractorId, message: "A canonical non_equity_partner classification is required before recompute." });
        return;
      }
      results.push(await recomputeNepEntitlements({ orgId: me.orgId, contractorId }));
      // Future-dated plan revisions take over the operational day rate
      // once effective; recompute is the standing hook that applies them.
      await syncContractorDayRate(me.orgId, contractorId);
    }
    await audit({
      entityType: "nep_comp_plan", entityId: wantId ?? "all", actor: me,
      action: "nep_comp.recompute",
      payload: { results: results.map((r) => ({ contractorId: r.contractorId, created: r.created, updated: r.updated, frozen: r.frozen })) },
      summary: `Recomputed NEP margin-share entitlements (${results.reduce((s, r) => s + r.created, 0)} new, ${results.reduce((s, r) => s + r.updated, 0)} refreshed).`,
    });
    res.json({ ok: true, results });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration; read-parity handled by the finance NEP-comp web surface
router.get("/finance/nep-comp/entitlements", async (req, res, next) => {
  try {
    const me = readGate(req, res);
    if (!me) return;
    const conds = [eq(atelierNepEntitlements.orgId, me.orgId), isNull(atelierNepEntitlements.deletedAt)];
    if (typeof req.query.contractorId === "string") {
      conds.push(eq(atelierNepEntitlements.contractorId, req.query.contractorId));
    }
    if (typeof req.query.status === "string") {
      conds.push(eq(atelierNepEntitlements.status, req.query.status));
    }
    const rows = await db.select().from(atelierNepEntitlements).where(and(...conds))
      .orderBy(desc(atelierNepEntitlements.updatedAt));
    res.json({ items: rows.map(entitlementWire) });
  } catch (err) { next(err); }
});

async function loadEntitlement(me: Me, id: string) {
  const [row] = await db.select().from(atelierNepEntitlements).where(and(
    eq(atelierNepEntitlements.orgId, me.orgId),
    eq(atelierNepEntitlements.id, id),
    isNull(atelierNepEntitlements.deletedAt),
  ));
  return row ?? null;
}

// @cli-skip: founder-only acceptance record; payability gate — UI maker flow only
router.post("/finance/nep-comp/entitlements/:id/accept", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const ent = await loadEntitlement(me, req.params.id);
    if (!ent) { res.status(404).json({ error: "not-found" }); return; }
    if (ent.clientAcceptedAt) { res.status(409).json({ error: "already-accepted" }); return; }
    const now = new Date();
    const dueDate = computeDueDate(ent.fullyCollected ? ent.collectedAt : null, now);
    const status = ent.status === "accruing" && ent.fullyCollected && ent.tier !== "none" ? "payable" : ent.status;
    await db.update(atelierNepEntitlements).set({
      clientAcceptedAt: now, clientAcceptedByUserId: me.id, dueDate, status, updatedAt: now,
    }).where(eq(atelierNepEntitlements.id, ent.id));
    await audit({
      entityType: "nep_entitlement", entityId: ent.id, actor: me,
      action: "nep_comp.entitlement_accept",
      payload: { engagementId: ent.engagementId, dueDate, status },
      summary: `Recorded client acceptance for ${ent.engagementName ?? ent.engagementId}${dueDate ? `; margin share due ${dueDate}` : ""}.`,
    });
    res.json({ ok: true, dueDate, status });
  } catch (err) { next(err); }
});

// @cli-skip: finance approval write moving money; UI maker-checker flow only
router.post("/finance/nep-comp/entitlements/:id/approve", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const ent = await loadEntitlement(me, req.params.id);
    if (!ent) { res.status(404).json({ error: "not-found" }); return; }
    if (ent.status !== "payable") {
      res.status(409).json({ error: "invalid-status", message: `Only payable entitlements can be approved (status: ${ent.status}). Payable requires full fee collection AND recorded client acceptance.` });
      return;
    }
    if (ent.amountUsd <= 0) {
      res.status(409).json({ error: "nothing-payable", message: "Entitlement amount is zero — nothing to approve." });
      return;
    }
    const now = new Date();
    await db.update(atelierNepEntitlements).set({
      status: "approved", approvedByUserId: me.id, approvedAt: now, updatedAt: now,
    }).where(and(eq(atelierNepEntitlements.id, ent.id), eq(atelierNepEntitlements.status, "payable")));
    await audit({
      entityType: "nep_entitlement", entityId: ent.id, actor: me,
      action: "nep_comp.entitlement_approve",
      payload: { engagementId: ent.engagementId, amountUsd: ent.amountUsd, tier: ent.tier, dueDate: ent.dueDate },
      summary: `Approved NEP margin share $${ent.amountUsd.toFixed(2)} (${ent.tierPct}% tier) for ${ent.engagementName ?? ent.engagementId}; joins the next payment run.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// @cli-skip: finance comp administration write; UI maker flow only
router.post("/finance/nep-comp/entitlements/:id/void", async (req, res, next) => {
  try {
    const me = writeGate(req, res);
    if (!me) return;
    const ent = await loadEntitlement(me, req.params.id);
    if (!ent) { res.status(404).json({ error: "not-found" }); return; }
    if (ent.status === "paid" || ent.status === "scheduled" || ent.status === "void") {
      res.status(409).json({ error: "invalid-status", message: `Cannot void an entitlement in status ${ent.status}.` });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null;
    const now = new Date();
    await db.update(atelierNepEntitlements).set({
      status: "void", voidedByUserId: me.id, voidedAt: now, voidReason: reason, updatedAt: now,
    }).where(eq(atelierNepEntitlements.id, ent.id));
    await audit({
      entityType: "nep_entitlement", entityId: ent.id, actor: me,
      action: "nep_comp.entitlement_void",
      payload: { engagementId: ent.engagementId, reason },
      summary: `Voided NEP margin-share entitlement for ${ent.engagementName ?? ent.engagementId}.`,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Me lens — read-only self view
// ---------------------------------------------------------------------------

// @cli-skip: read-only self view; pending Task #340 read-parity migration
router.get("/me/nep-comp", async (req, res, next) => {
  try {
    const me = req.atelierPersona ?? null;
    if (!me) { res.status(401).json({ error: "no-active-persona" }); return; }
    // Self-scope: resolve MY contractor row by e-mail (employees have no NEP plan).
    const [emp] = await db.select({ id: atelierEmployees.id }).from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, me.orgId), eq(atelierEmployees.userId, me.id), isNull(atelierEmployees.deletedAt)));
    let contractor: typeof atelierContractors.$inferSelect | null = null;
    if (!emp) {
      const email = me.email.trim().toLowerCase();
      const cts = await db.select().from(atelierContractors)
        .where(and(eq(atelierContractors.orgId, me.orgId), isNull(atelierContractors.deletedAt)));
      contractor = cts.find((c) => c.email.trim().toLowerCase() === email) ?? null;
    }
    if (!contractor) { res.json({ hasPlan: false }); return; }
    const plans = await loadPlansForContractor(me.orgId, contractor.id);
    if (plans.length === 0) { res.json({ hasPlan: false }); return; }
    const today = new Date().toISOString().slice(0, 10);
    const current = pickEffectivePlan(plans, today);
    const ents = await db.select().from(atelierNepEntitlements).where(and(
      eq(atelierNepEntitlements.orgId, me.orgId),
      eq(atelierNepEntitlements.contractorId, contractor.id),
      isNull(atelierNepEntitlements.deletedAt),
    )).orderBy(desc(atelierNepEntitlements.updatedAt));
    const conversion = await computeConversionProgress({ orgId: me.orgId, contractorId: contractor.id });

    // Time charges: my contractor-payment accruals + my self-billed invoices.
    const cps = await db.select().from(atelierContractorPayments).where(and(
      eq(atelierContractorPayments.orgId, me.orgId),
      eq(atelierContractorPayments.payeeUserId, me.id),
      isNull(atelierContractorPayments.deletedAt),
    ));
    const accruedUsd = cps.filter((c) => c.status !== "rejected" && c.status !== "paid").reduce((s, c) => s + (c.usdAmount ?? 0), 0);
    const paidUsd = cps.filter((c) => c.status === "paid").reduce((s, c) => s + (c.usdAmount ?? 0), 0);
    const sbis = await db.select().from(atelierSelfBilledInvoices).where(and(
      eq(atelierSelfBilledInvoices.orgId, me.orgId),
      eq(atelierSelfBilledInvoices.supplierType, "contractor"),
      eq(atelierSelfBilledInvoices.supplierId, contractor.id),
      isNull(atelierSelfBilledInvoices.deletedAt),
    ));
    res.json({
      hasPlan: true,
      plan: current ? planWire(current) : null,
      planHistory: plans.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)).map(planWire),
      timeCharges: {
        accruedUsd: Math.round(accruedUsd * 100) / 100,
        paidUsd: Math.round(paidUsd * 100) / 100,
        invoices: sbis.map((i) => ({
          id: i.id, invoiceNumber: i.invoiceNumber, weekIso: i.weekIso,
          totalAmount: i.totalAmount, currency: i.currency, totalUsd: i.totalUsd,
          status: i.status, paidAt: i.paidAt?.toISOString() ?? null,
        })),
      },
      entitlements: ents.map(entitlementWire),
      conversion,
    });
  } catch (err) { next(err); }
});

export default router;
