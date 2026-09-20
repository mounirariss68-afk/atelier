import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierAuditEvents,
  atelierAdminPersonMappings,
  atelierLegalEntities,
  atelierOwnershipStructures,
  atelierOwnershipStakeholders,
  atelierOwnershipStructureLinks,
  atelierOwnershipInterests,
  atelierCommercialRights,
  atelierDistributionPolicies,
  atelierDistributionDeclarations,
  atelierDistributionSnapshots,
  atelierDistributionAllocations,
  atelierDistributionPayments,
  atelierDistributionTrueUps,
} from "@workspace/db";
import { isFoundingPartner, isPartner } from "./personaRoles";

const router = Router();
const rid = (p: string) =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
type Me = NonNullable<Request["atelierPersona"]>;
function me(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}
function finance(m: Me, res: Response): boolean {
  if (["founding_partner", "partner", "finance"].includes(m.role)) return true;
  res.status(403).json({ error: "finance-role-required" });
  return false;
}
function writer(m: Me, res: Response): boolean {
  if (isFoundingPartner(m.role) || isPartner(m.role) || m.role === "finance")
    return true;
  res.status(403).json({ error: "ownership-writer-required" });
  return false;
}
async function audit(
  m: Me,
  entityId: string,
  action: string,
  payload: unknown,
) {
  await db
    .insert(atelierAuditEvents)
    .values({
      id: rid("aud"),
      orgId: m.orgId,
      entityType: "ownership_economics",
      entityId,
      actorType: "human",
      actorId: m.id,
      actorLabel: m.name,
      action,
      payload: payload as Record<string, unknown>,
      payloadSummary: action,
    });
}
const pct = z.number().finite().min(0).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const structureBody = z.object({
  name: z.string().trim().min(1).max(200),
  structureType: z.enum(["holding", "entity", "territory", "franchise"]),
  status: z
    .enum(["planned", "incorporated", "franchise_operated", "archived"])
    .default("planned"),
  legalEntityId: z.string().nullish(),
  country: z.string().max(3).nullish(),
  jurisdiction: z.string().max(120).nullish(),
  effectiveFrom: day,
  effectiveTo: day.nullish(),
  notes: z.string().max(2000).nullish(),
});

export function activeAt(from: string, to: string | null, asOf: string) {
  return from <= asOf && (to == null || to > asOf);
}
async function ownershipView(orgId: string, asOf: string) {
  const structures = await db
    .select()
    .from(atelierOwnershipStructures)
    .where(eq(atelierOwnershipStructures.orgId, orgId));
  const structureIds = structures
    .filter(
      (s) =>
        activeAt(s.effectiveFrom, s.effectiveTo, asOf) &&
        s.approvalStatus === "approved",
    )
    .map((s) => s.id);
  const interests = (
    await db
      .select()
      .from(atelierOwnershipInterests)
      .where(eq(atelierOwnershipInterests.orgId, orgId))
  ).filter(
    (i) =>
      structureIds.includes(i.structureId) &&
      i.status === "approved" &&
      activeAt(i.effectiveFrom, i.effectiveTo, asOf),
  );
  const stakeholders = await db
    .select()
    .from(atelierOwnershipStakeholders)
    .where(eq(atelierOwnershipStakeholders.orgId, orgId));
  const stakeholderMap = new Map(stakeholders.map((s) => [s.id, s]));
  const structureMap = new Map(structures.map((s) => [s.id, s]));
  const stake = (i: (typeof interests)[number]) => {
    const h = stakeholderMap.get(i.stakeholderId);
    return {
      id: i.id,
      holderId: i.stakeholderId,
      holderName: h?.label ?? "Unresolved stakeholder",
      holderKind: h?.stakeholderType,
      entityId: i.structureId,
      entityName: structureMap.get(i.structureId)?.name ?? i.structureId,
      legalOwnershipPct: i.legalPct,
      votingControlPct: i.votingPct,
      profitParticipationPct: i.profitPct,
      shareClass: i.shareClass,
      effectiveFrom: i.effectiveFrom,
      effectiveTo: i.effectiveTo,
      status: i.status,
      sourceAgreement: i.sourceAgreementId,
      pendingTerms: i.pendingTerms ? "Terms pending" : null,
      warnings: [],
    };
  };
  const byStructure = new Map<string, typeof interests>();
  for (const i of interests)
    byStructure.set(i.structureId, [
      ...(byStructure.get(i.structureId) ?? []),
      i,
    ]);
  const links = (
    await db
      .select()
      .from(atelierOwnershipStructureLinks)
      .where(eq(atelierOwnershipStructureLinks.orgId, orgId))
  ).filter((l) => l.status === "approved" && activeAt(l.effectiveFrom, l.effectiveTo, asOf));
  const warnings: string[] = [];
  const pendingTerms: string[] = [];
  const commercialRights = (
    await db
      .select()
      .from(atelierCommercialRights)
      .where(eq(atelierCommercialRights.orgId, orgId))
  ).filter(
    (r) =>
      structureIds.includes(r.structureId) &&
      activeAt(r.effectiveFrom, r.effectiveTo, asOf),
  );
  const summaries = structures
    .filter((s) => structureIds.includes(s.id))
    .map((s) => {
      const direct = (byStructure.get(s.id) ?? []).map(stake);
      for (const i of byStructure.get(s.id) ?? [])
        if (i.pendingTerms)
          pendingTerms.push(`${s.name}: unresolved commercial terms`);
      for (const r of commercialRights.filter((right) => right.structureId === s.id))
        if (r.pendingTerms || r.status !== "approved")
          pendingTerms.push(`${s.name}: unresolved commercial terms`);
      for (const r of commercialRights.filter((right) => right.structureId === s.id))
        if (r.pendingTerms)
          pendingTerms.push(`${s.name}: unresolved commercial terms`);
      const parentLinks = links.filter((l) => l.childStructureId === s.id);
      const predecessorIds = parentLinks.map((l) => l.parentStructureId);
      return {
        id: s.id,
        name: s.name,
        shortName: s.name,
        country: s.country,
        status: s.status,
        predecessorIds,
        successorIds: links
          .filter((l) => l.parentStructureId === s.id)
          .map((l) => l.childStructureId),
        directStakes: direct,
        warnings: [],
        pendingTerms,
      };
    });
  for (const s of summaries) {
    const direct = byStructure.get(s.id) ?? [];
    for (const field of ["legalPct", "votingPct", "profitPct"] as const) {
      const total = direct.reduce((n, i) => n + i[field], 0);
      if (total > 100.0001)
        warnings.push(`${s.name}: ${field} total exceeds 100%`);
      else if (total < 99.9999)
        warnings.push(`${s.name}: ${field} total is unresolved (${total}%)`);
    }
  }
  return {
    structures,
    structureIds,
    interests,
    stakeholders,
    stakeholderMap,
    structureMap,
    byStructure,
    links,
    summaries,
    warnings,
    pendingTerms,
  };
}
function lookThrough(
  view: Awaited<ReturnType<typeof ownershipView>>,
  stakeholderId: string,
) {
  const result: Array<{
    holderId: string;
    holderName: string;
    entityId: string;
    entityName: string;
    legalOwnershipPct: number;
    votingControlPct: number;
    profitParticipationPct: number;
    path: string[];
  }> = [];
  const directByStructure = view.byStructure;
  const entityHolderByStructure = new Map(
    [...view.stakeholderMap.values()]
      .filter((s) => s.stableKey?.startsWith("structure:"))
      .map((s) => [s.stableKey!.slice("structure:".length), s.id]),
  );
  for (const structure of view.structures) {
    const holder = view.stakeholders.find(
      (s) =>
        s.stableKey === `structure:${structure.id}` ||
        s.stableKey === `structure:${structure.id.replace(/^seed1363_/, "")}`,
    );
    if (holder) entityHolderByStructure.set(structure.id, holder.id);
  }
  const emitted = new Set<string>();
  const walk = (
    structureId: string,
    factor: { legal: number; voting: number; profit: number },
    path: string[],
    seen: Set<string>,
  ) => {
    if (seen.has(structureId)) return;
    const nextSeen = new Set(seen).add(structureId);
    const structure = view.structureMap.get(structureId);
    const key = `${structureId}:${path.join(">")}`;
    if (!emitted.has(key)) {
      emitted.add(key);
      result.push({
        holderId: stakeholderId,
        holderName: view.stakeholderMap.get(stakeholderId)?.label ?? "Unresolved stakeholder",
        entityId: structureId,
        entityName: structure?.name ?? structureId,
        legalOwnershipPct: factor.legal,
        votingControlPct: factor.voting,
        profitParticipationPct: factor.profit,
        path: [...path, structureId],
      });
    }
    for (const link of view.links.filter((l) => l.parentStructureId === structureId)) {
      const holderId = entityHolderByStructure.get(structureId);
      const through = (directByStructure.get(link.childStructureId) ?? []).find(
        (i) => i.stakeholderId === holderId,
      );
      if (!through) continue;
      walk(
        link.childStructureId,
        {
          legal: (factor.legal * through.legalPct) / 100,
          voting: (factor.voting * through.votingPct) / 100,
          profit: (factor.profit * through.profitPct) / 100,
        },
        [...path, structureId],
        nextSeen,
      );
    }
  };
  for (const [sid, rows] of directByStructure) {
    const own = rows.find((i) => i.stakeholderId === stakeholderId);
    if (own) walk(sid, { legal: own.legalPct, voting: own.votingPct, profit: own.profitPct }, [], new Set());
  }
  return result;
}

async function ensureNoCycle(orgId: string, parent: string, child: string, from = "0000-01-01", to: string | null = null) {
  if (parent === child) throw new Error("ownership-cycle");
  const links = await db
    .select()
    .from(atelierOwnershipStructureLinks)
    .where(eq(atelierOwnershipStructureLinks.orgId, orgId));
  const next = new Map<string, string[]>();
  for (const l of links.filter((x) => x.status === "approved" &&
    from < (x.effectiveTo ?? "9999-12-31") &&
    (to ?? "9999-12-31") > x.effectiveFrom))
    next.set(l.parentStructureId, [
      ...(next.get(l.parentStructureId) ?? []),
      l.childStructureId,
    ]);
  const seen = new Set<string>();
  const visit = (n: string): boolean => {
    if (n === parent) return true;
    if (seen.has(n)) return false;
    seen.add(n);
    return (next.get(n) ?? []).some(visit);
  };
  if (visit(child)) throw new Error("ownership-cycle");
}
async function validateInterest(
  orgId: string,
  input: {
    structureId: string;
    stakeholderId: string;
    legalPct: number;
    votingPct: number;
    profitPct: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    pendingTerms?: boolean;
  },
) {
  const [structure] = await db
    .select({ id: atelierOwnershipStructures.id })
    .from(atelierOwnershipStructures)
    .where(
      and(
        eq(atelierOwnershipStructures.orgId, orgId),
        eq(atelierOwnershipStructures.id, input.structureId),
      ),
    );
  const [holder] = await db
    .select({ id: atelierOwnershipStakeholders.id })
    .from(atelierOwnershipStakeholders)
    .where(
      and(
        eq(atelierOwnershipStakeholders.orgId, orgId),
        eq(atelierOwnershipStakeholders.id, input.stakeholderId),
      ),
    );
  if (!structure || !holder) throw new Error("referenced-record-not-found");
  for (const n of [input.legalPct, input.votingPct, input.profitPct])
    if (n < 0 || n > 100) throw new Error("invalid-percentage");
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom)
    throw new Error("invalid-effective-dates");
  const existing = await db
    .select()
    .from(atelierOwnershipInterests)
    .where(
      and(
        eq(atelierOwnershipInterests.orgId, orgId),
        eq(atelierOwnershipInterests.structureId, input.structureId),
        eq(atelierOwnershipInterests.stakeholderId, input.stakeholderId),
      ),
    );
  if (
    existing.some(
      (x) =>
        input.effectiveFrom < (x.effectiveTo ?? "9999-12-31") &&
        (input.effectiveTo ?? "9999-12-31") > x.effectiveFrom,
    )
  )
    throw new Error("overlapping-interest-version");
  const active = await db
    .select()
    .from(atelierOwnershipInterests)
    .where(
      and(
        eq(atelierOwnershipInterests.orgId, orgId),
        eq(atelierOwnershipInterests.structureId, input.structureId),
        eq(atelierOwnershipInterests.status, "approved"),
      ),
    );
  const activeAtProposal = active.filter((x) =>
    activeAt(x.effectiveFrom, x.effectiveTo, input.effectiveFrom),
  );
  const sums = activeAtProposal.reduce(
    (a, x) => ({
      legal: a.legal + x.legalPct,
      voting: a.voting + x.votingPct,
      profit: a.profit + x.profitPct,
    }),
    { legal: 0, voting: 0, profit: 0 },
  );
  if (
    !input.pendingTerms &&
    (sums.legal + input.legalPct > 100.0001 ||
      sums.voting + input.votingPct > 100.0001 ||
      sums.profit + input.profitPct > 100.0001)
  )
    throw new Error("percentage-total-exceeded");
}

router.get("/finance/ownership/group", async (req, res) => {
  const m = me(req, res);
  if (!m || !finance(m, res)) return;
  const structures = await db
    .select()
    .from(atelierOwnershipStructures)
    .where(eq(atelierOwnershipStructures.orgId, m.orgId))
    .orderBy(desc(atelierOwnershipStructures.effectiveFrom));
  const ids = structures.map((x) => x.id);
  const [links, interests, stakeholders, rights] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(atelierOwnershipStructureLinks)
          .where(eq(atelierOwnershipStructureLinks.orgId, m.orgId))
      : [],
    ids.length
      ? db
          .select()
          .from(atelierOwnershipInterests)
          .where(
            and(
              eq(atelierOwnershipInterests.orgId, m.orgId),
              inArray(atelierOwnershipInterests.structureId, ids),
            ),
          )
      : [],
    db
      .select()
      .from(atelierOwnershipStakeholders)
      .where(eq(atelierOwnershipStakeholders.orgId, m.orgId)),
    ids.length
      ? db
          .select()
          .from(atelierCommercialRights)
          .where(
            and(
              eq(atelierCommercialRights.orgId, m.orgId),
              inArray(atelierCommercialRights.structureId, ids),
            ),
          )
      : [],
  ]);
  res.json({
    structures,
    links,
    interests,
    stakeholders,
    commercialRights: rights,
  });
});
router.get("/finance/ownership/structures", async (req, res) => {
  const m = me(req, res);
  if (!m || !finance(m, res)) return;
  res.json({
    items: await db
      .select()
      .from(atelierOwnershipStructures)
      .where(eq(atelierOwnershipStructures.orgId, m.orgId)),
  });
});
router.get(
  "/finance/ownership/structures/:id",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !finance(m, res)) return;
    const id = String(req.params.id);
    const [structure] = await db
      .select()
      .from(atelierOwnershipStructures)
      .where(
        and(
          eq(atelierOwnershipStructures.orgId, m.orgId),
          eq(atelierOwnershipStructures.id, id),
        ),
      );
    if (!structure) return res.status(404).json({ error: "not-found" });
    const interests = await db
      .select()
      .from(atelierOwnershipInterests)
      .where(
        and(
          eq(atelierOwnershipInterests.orgId, m.orgId),
          eq(atelierOwnershipInterests.structureId, id),
        ),
      );
    res.json({
      structure,
      interests,
      links: await db
        .select()
        .from(atelierOwnershipStructureLinks)
        .where(
          and(
            eq(atelierOwnershipStructureLinks.orgId, m.orgId),
            eq(atelierOwnershipStructureLinks.childStructureId, id),
          ),
        ),
    });
  },
);

router.post("/finance/ownership/structures", async (req, res): Promise<any> => {
  const m = me(req, res);
  if (!m || !writer(m, res)) return;
  const p = structureBody.safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ error: "invalid-body", issues: p.error.issues });
  const id = rid("ostr");
  const [row] = await db
    .insert(atelierOwnershipStructures)
    .values({
      id,
      orgId: m.orgId,
      ...p.data,
      status: p.data.status,
      approvalStatus: "pending",
      proposedBy: m.id,
      legalEntityId: p.data.legalEntityId ?? null,
      country: p.data.country ?? null,
      jurisdiction: p.data.jurisdiction ?? null,
      effectiveTo: p.data.effectiveTo ?? null,
      notes: p.data.notes ?? null,
    })
    .returning();
  await audit(m, id, "ownership.structure_proposed", p.data);
  res.status(201).json({ structure: row });
});
router.post("/finance/ownership/links", async (req, res): Promise<any> => {
  const m = me(req, res);
  if (!m || !writer(m, res)) return;
  const p = z
    .object({
      parentStructureId: z.string(),
      childStructureId: z.string(),
      relationship: z.string().default("owns"),
      effectiveFrom: day,
      effectiveTo: day.nullish(),
    })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid-body" });
  try {
    if (p.data.effectiveTo && p.data.effectiveTo <= p.data.effectiveFrom)
      throw new Error("invalid-effective-dates");
    const structs = await db
      .select({ id: atelierOwnershipStructures.id })
      .from(atelierOwnershipStructures)
      .where(
        and(
          eq(atelierOwnershipStructures.orgId, m.orgId),
          inArray(atelierOwnershipStructures.id, [
            p.data.parentStructureId,
            p.data.childStructureId,
          ]),
        ),
      );
    if (structs.length !== 2) throw new Error("referenced-record-not-found");
    const existingLinks = await db.select().from(atelierOwnershipStructureLinks).where(and(eq(atelierOwnershipStructureLinks.orgId, m.orgId), eq(atelierOwnershipStructureLinks.parentStructureId, p.data.parentStructureId), eq(atelierOwnershipStructureLinks.childStructureId, p.data.childStructureId), eq(atelierOwnershipStructureLinks.relationship, p.data.relationship)));
    if (existingLinks.some((x) => p.data.effectiveFrom < (x.effectiveTo ?? "9999-12-31") && (p.data.effectiveTo ?? "9999-12-31") > x.effectiveFrom)) throw new Error("overlapping-link-version");
    await ensureNoCycle(
      m.orgId,
      p.data.parentStructureId,
      p.data.childStructureId,
      p.data.effectiveFrom,
      p.data.effectiveTo ?? null,
    );
    const [row] = await db
      .insert(atelierOwnershipStructureLinks)
      .values({
        id: rid("olink"),
        orgId: m.orgId,
        ...p.data,
        effectiveTo: p.data.effectiveTo ?? null,
        status: "pending",
        proposedBy: m.id,
      })
      .returning();
    await audit(m, row.id, "ownership.link_proposed", p.data);
    res.status(201).json({ link: row });
  } catch (e) {
    res
      .status(409)
      .json({ error: e instanceof Error ? e.message : "ownership-cycle" });
  }
});

router.post("/finance/ownership/interests", async (req, res): Promise<any> => {
  const m = me(req, res);
  if (!m || !writer(m, res)) return;
  const p = z
    .object({
      structureId: z.string(),
      stakeholderId: z.string(),
      legalPct: pct,
      votingPct: pct,
      profitPct: pct,
      shareClass: z.string().nullish(),
      effectiveFrom: day,
      effectiveTo: day.nullish(),
      sourceAgreementId: z.string().nullish(),
      pendingTerms: z.boolean().default(false),
      provenance: z.record(z.unknown()).default({}),
    })
    .safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ error: "invalid-body", issues: p.error.issues });
  try {
    await validateInterest(m.orgId, p.data);
    const [row] = await db
      .insert(atelierOwnershipInterests)
      .values({
        id: rid("oint"),
        orgId: m.orgId,
        ...p.data,
        status: "pending",
        proposedBy: m.id,
        effectiveTo: p.data.effectiveTo ?? null,
        shareClass: p.data.shareClass ?? null,
        sourceAgreementId: p.data.sourceAgreementId ?? null,
      })
      .returning();
    await audit(m, row.id, "ownership.interest_proposed", p.data);
    res.status(201).json({ interest: row });
  } catch (e) {
    res
      .status(409)
      .json({ error: e instanceof Error ? e.message : "validation-failed" });
  }
});
router.post(
  "/finance/ownership/interests/:id/approve",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !writer(m, res)) return;
    const [old] = await db
      .select()
      .from(atelierOwnershipInterests)
      .where(
        and(
          eq(atelierOwnershipInterests.orgId, m.orgId),
          eq(atelierOwnershipInterests.id, String(req.params.id)),
        ),
      );
    if (!old) return res.status(404).json({ error: "not-found" });
    if (old.proposedBy === m.id)
      return res.status(409).json({ error: "maker-checker-required" });
    try {
    const [row] = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(atelierOwnershipInterests)
        .where(and(eq(atelierOwnershipInterests.orgId, m.orgId), eq(atelierOwnershipInterests.id, old.id)))
        .for("update");
      if (!locked || locked.status !== "pending") throw new Error("invalid-interest-state");
      const rows = await tx.select().from(atelierOwnershipInterests)
        .where(and(eq(atelierOwnershipInterests.orgId, m.orgId), eq(atelierOwnershipInterests.structureId, locked.structureId)))
        .for("update");
      const end = (x: typeof locked) => x.effectiveTo ?? "9999-12-31";
      for (const other of rows) {
        if (other.id !== locked.id && other.stakeholderId === locked.stakeholderId && locked.effectiveFrom < end(other) && other.effectiveFrom < end(locked))
          throw new Error("overlapping-interest-version");
      }
      const boundaries = new Set([locked.effectiveFrom, ...rows.map(x => x.effectiveFrom), ...rows.map(x => x.effectiveTo).filter((x): x is string => !!x)]);
      for (const asOf of boundaries) {
        const active = rows.filter(x => x.id === locked.id || (x.status === "approved" && activeAt(x.effectiveFrom, x.effectiveTo, asOf))).concat([locked]);
        const unique = [...new Map(active.map(x => [x.id, x])).values()];
        for (const field of ["legalPct", "votingPct", "profitPct"] as const)
          if (unique.filter(x => activeAt(x.effectiveFrom, x.effectiveTo, asOf)).reduce((n, x) => n + x[field], 0) > 100.0001)
            throw new Error("percentage-total-exceeded");
      }
      return tx.update(atelierOwnershipInterests).set({ status: "approved", approvedBy: m.id, approvedAt: new Date() }).where(eq(atelierOwnershipInterests.id, old.id)).returning();
    }).catch((e) => { throw e; });
    await audit(m, row.id, "ownership.interest_approved", {
      proposedBy: old.proposedBy,
    });
    res.json({ interest: row });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "interest-approval-failed" });
    }
  },
);

router.post(
  "/finance/ownership/commercial-rights",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !writer(m, res)) return;
    const p = z
      .object({
        structureId: z.string(),
        holderStakeholderId: z.string(),
        rightType: z.enum(["revenue_share", "royalty", "sponsor", "franchise"]),
        ratePct: pct.nullish(),
        basis: z.string().nullish(),
        currency: z.string().nullish(),
        feeAmount: z.number().finite().nullish(),
        territory: z.string().nullish(),
        agreementTerm: z.string().nullish(),
        pendingTerms: z.boolean().default(false),
        effectiveFrom: day,
        effectiveTo: day.nullish(),
        sourceAgreementId: z.string().nullish(),
        terms: z.record(z.unknown()).default({}),
      })
      .safeParse(req.body);
    if (!p.success)
      return res
        .status(400)
        .json({ error: "invalid-body", issues: p.error.issues });
    if (p.data.pendingTerms && p.data.ratePct != null)
      return res
        .status(400)
        .json({ error: "pending-terms-must-not-invent-rate" });
    if (p.data.effectiveTo && p.data.effectiveTo <= p.data.effectiveFrom)
      return res.status(400).json({ error: "invalid-effective-dates" });
    const existingRights = await db.select().from(atelierCommercialRights).where(and(eq(atelierCommercialRights.orgId, m.orgId), eq(atelierCommercialRights.structureId, p.data.structureId), eq(atelierCommercialRights.holderStakeholderId, p.data.holderStakeholderId), eq(atelierCommercialRights.rightType, p.data.rightType)));
    if (existingRights.some((r) => p.data.effectiveFrom < (r.effectiveTo ?? "9999-12-31") && (p.data.effectiveTo ?? "9999-12-31") > r.effectiveFrom))
      return res.status(409).json({ error: "overlapping-commercial-right-version" });
    if (p.data.effectiveTo && p.data.effectiveTo <= p.data.effectiveFrom)
      return res.status(400).json({ error: "invalid-effective-dates" });
    const [structure] = await db.select({ id: atelierOwnershipStructures.id }).from(atelierOwnershipStructures)
      .where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, p.data.structureId)));
    const [holder] = await db.select({ id: atelierOwnershipStakeholders.id }).from(atelierOwnershipStakeholders)
      .where(and(eq(atelierOwnershipStakeholders.orgId, m.orgId), eq(atelierOwnershipStakeholders.id, p.data.holderStakeholderId)));
    if (!structure || !holder) return res.status(409).json({ error: "referenced-record-not-found" });
    const versions = await db.select().from(atelierCommercialRights).where(and(eq(atelierCommercialRights.orgId, m.orgId), eq(atelierCommercialRights.structureId, p.data.structureId), eq(atelierCommercialRights.holderStakeholderId, p.data.holderStakeholderId)));
    if (versions.some((x) => p.data.effectiveFrom < (x.effectiveTo ?? "9999-12-31") && (p.data.effectiveTo ?? "9999-12-31") > x.effectiveFrom))
      return res.status(409).json({ error: "overlapping-commercial-right-version" });
    const [row] = await db
      .insert(atelierCommercialRights)
      .values({
        id: rid("cright"),
        orgId: m.orgId,
        ...p.data,
        effectiveTo: p.data.effectiveTo ?? null,
        ratePct: p.data.ratePct ?? null,
        basis: p.data.basis ?? null,
        currency: p.data.currency ?? null,
        feeAmount: p.data.feeAmount ?? null,
        territory: p.data.territory ?? null,
        agreementTerm: p.data.agreementTerm ?? null,
        sourceAgreementId: p.data.sourceAgreementId ?? null,
        proposedBy: m.id,
        status: "pending",
      })
      .returning();
    await audit(m, row.id, "ownership.commercial_right_proposed", p.data);
    res.status(201).json({ right: row });
  },
);

router.post(
  "/finance/distributions/payments",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !writer(m, res)) return;
    const p = z
      .object({
        allocationId: z.string(),
        amount: z.number().finite().positive(),
        paidAt: day.nullish(),
        reference: z.string().nullish(),
      })
      .safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "invalid-body" });
    const [allocation] = await db.select().from(atelierDistributionAllocations).where(and(eq(atelierDistributionAllocations.orgId, m.orgId), eq(atelierDistributionAllocations.id, p.data.allocationId)));
    if (!allocation) return res.status(404).json({ error: "allocation-not-found" });
    const [declaration] = await db.select().from(atelierDistributionDeclarations).where(and(eq(atelierDistributionDeclarations.orgId, m.orgId), eq(atelierDistributionDeclarations.id, allocation.declarationId)));
    if (!declaration || !["approved", "snapshotted"].includes(declaration.status)) return res.status(409).json({ error: "distribution-not-frozen" });
    const paid = await db.select().from(atelierDistributionPayments).where(and(eq(atelierDistributionPayments.orgId, m.orgId), eq(atelierDistributionPayments.allocationId, allocation.id)));
    const trueUpRows = await db.select().from(atelierDistributionTrueUps).where(and(eq(atelierDistributionTrueUps.orgId, m.orgId), eq(atelierDistributionTrueUps.declarationId, declaration.id), eq(atelierDistributionTrueUps.stakeholderId, allocation.stakeholderId)));
    const ceiling = allocation.amount + trueUpRows.reduce((n, x) => n + Math.max(0, x.deltaAmount), 0);
    if (paid.reduce((n, x) => n + x.amount, 0) + p.data.amount > ceiling + 0.0001) return res.status(409).json({ error: "payment-exceeds-allocation" });
    const [row] = await db
      .insert(atelierDistributionPayments)
      .values({
        id: rid("pay"),
        orgId: m.orgId,
        ...p.data,
        paidAt: p.data.paidAt ?? null,
        reference: p.data.reference ?? null,
        status: "scheduled",
      })
      .returning();
    await audit(m, row.id, "distribution.payment_recorded", p.data);
    res.status(201).json({ payment: row });
  },
);
router.post(
  "/finance/distributions/true-ups",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !writer(m, res)) return;
    const p = z
      .object({
        declarationId: z.string(),
        stakeholderId: z.string(),
        expectedAmount: z.number().finite(),
        actualAmount: z.number().finite(),
        rationale: z.string().min(1),
      })
      .safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: "invalid-body" });
    const [declaration] = await db.select().from(atelierDistributionDeclarations).where(and(eq(atelierDistributionDeclarations.orgId, m.orgId), eq(atelierDistributionDeclarations.id, p.data.declarationId)));
    if (!declaration || declaration.status !== "snapshotted") return res.status(409).json({ error: "distribution-not-frozen" });
    const frozen = await db.select().from(atelierDistributionAllocations).where(and(eq(atelierDistributionAllocations.orgId, m.orgId), eq(atelierDistributionAllocations.declarationId, declaration.id), eq(atelierDistributionAllocations.stakeholderId, p.data.stakeholderId)));
    if (!frozen.length) return res.status(409).json({ error: "stakeholder-not-in-snapshot" });
    if (Math.abs(p.data.expectedAmount - frozen[0].amount) > 0.0001) return res.status(409).json({ error: "true-up-does-not-reconcile" });
    const [row] = await db
      .insert(atelierDistributionTrueUps)
      .values({
        id: rid("tu"),
        orgId: m.orgId,
        ...p.data,
        deltaAmount: p.data.actualAmount - p.data.expectedAmount,
        createdBy: m.id,
      })
      .returning();
    await audit(m, row.id, "distribution.true_up_recorded", p.data);
    res.status(201).json({ trueUp: row });
  },
);

// Contract-first ownership reads consumed by the Finance surfaces.
router.get("/finance/ownership", async (req, res): Promise<any> => {
  const m = me(req, res);
  if (!m || !finance(m, res)) return;
  const asOf =
    typeof req.query.asOf === "string"
      ? req.query.asOf
      : new Date().toISOString().slice(0, 10);
  const view = await ownershipView(m.orgId, asOf);
  res.json({
    asOf,
    entities: view.summaries,
    warnings: view.warnings,
    pendingTerms: view.pendingTerms,
    validation: [],
  });
});
router.get(
  "/finance/ownership/entities/:id",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !finance(m, res)) return;
    const asOf =
      typeof req.query.asOf === "string"
        ? req.query.asOf
        : new Date().toISOString().slice(0, 10);
    const view = await ownershipView(m.orgId, asOf);
    const entity = view.summaries.find((s) => s.id === String(req.params.id));
    if (!entity) return res.status(404).json({ error: "not-found" });
    const rights = await db
      .select()
      .from(atelierCommercialRights)
      .where(
        and(
          eq(atelierCommercialRights.orgId, m.orgId),
          eq(atelierCommercialRights.structureId, entity.id),
        ),
      );
    const names = new Map(view.stakeholders.map((s) => [s.id, s.label]));
    res.json({
      ...entity,
      history: (
        await db
          .select()
          .from(atelierOwnershipInterests)
          .where(
            and(
              eq(atelierOwnershipInterests.orgId, m.orgId),
              eq(atelierOwnershipInterests.structureId, entity.id),
            ),
          )
      ).map((i) => ({
        ...i,
        holderName: names.get(i.stakeholderId) ?? "Unresolved stakeholder",
        legalOwnershipPct: i.legalPct,
        votingControlPct: i.votingPct,
        profitParticipationPct: i.profitPct,
        sourceAgreement: i.sourceAgreementId,
        pendingTerms: i.pendingTerms ? "Terms pending" : null,
      })),
      lookThrough: [],
      commercialRights: rights.map((r) => ({
        id: r.id,
        kind: r.rightType,
        holderName:
          names.get(r.holderStakeholderId) ?? "Unresolved stakeholder",
        ratePct: r.ratePct,
        basis: r.basis,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        status: r.status,
        pendingTerms: r.pendingTerms ? "Terms pending" : null,
        sourceAgreement: r.sourceAgreementId,
      })),
    });
  },
);
router.get(
  "/finance/ownership/people/:personId",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !finance(m, res)) return;
    const asOf =
      typeof req.query.asOf === "string"
        ? req.query.asOf
        : new Date().toISOString().slice(0, 10);
    const view = await ownershipView(m.orgId, asOf);
    const person = view.stakeholders.find(
      (s) =>
        s.personId === String(req.params.personId) ||
        s.id === String(req.params.personId),
    );
    if (!person) return res.status(404).json({ error: "not-found" });
    const directInterests = view.interests
      .filter((i) => i.stakeholderId === person.id)
      .map((i) => ({
        ...i,
        holderId: person.id,
        holderName: person.label,
        entityName: view.structureMap.get(i.structureId)?.name ?? i.structureId,
        legalOwnershipPct: i.legalPct,
        votingControlPct: i.votingPct,
        profitParticipationPct: i.profitPct,
        sourceAgreement: i.sourceAgreementId,
        pendingTerms: i.pendingTerms ? "Terms pending" : null,
      }));
    const pendingTerms = directInterests
      .filter((i) => i.pendingTerms)
      .map((i) => `${i.entityName}: commercial terms pending`);
    res.json({
      personId: person.personId ?? person.id,
      name: person.label,
      directInterests,
      lookThrough: lookThrough(view, person.id),
      warnings: [],
      pendingTerms,
    });
  },
);

// Frontend declaration draft contract: the group holding is the default
// declaration scope until entity-specific policy editing is available.
router.post("/finance/distributions", async (req, res): Promise<any> => {
  const m = me(req, res);
  if (!m || !writer(m, res)) return;
  const body = z
    .object({
      year: z.coerce.number().int().min(2000).max(2200),
      estimatedProfit: z.number().finite().min(0),
      cashReserve: z.number().finite().min(0).default(0),
      operatingCapitalReserve: z.number().finite().min(0).default(0),
      asOf: day.optional(),
      currency: z.string().default("USD"),
      structureId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "invalid-body", issues: body.error.issues });
  const [holding] = await db
    .select()
    .from(atelierOwnershipStructures)
    .where(
      and(
        eq(atelierOwnershipStructures.orgId, m.orgId),
        eq(atelierOwnershipStructures.structureType, "holding"),
      ),
    );
  if (!holding && !body.data.structureId)
    return res.status(409).json({ error: "holding-structure-required" });
  if (body.data.cashReserve + body.data.operatingCapitalReserve > body.data.estimatedProfit)
    return res.status(400).json({ error: "negative-distributable-profit" });
  const [row] = await db
    .insert(atelierDistributionDeclarations)
    .values({
      id: rid("decl"),
      orgId: m.orgId,
      structureId: body.data.structureId ?? holding!.id,
      fiscalYear: String(body.data.year),
      kind: "estimated",
      estimatedProfit: body.data.estimatedProfit,
      reserveCash: body.data.cashReserve,
      reserveOperatingCapital: body.data.operatingCapitalReserve,
      distributableProfit:
        body.data.estimatedProfit -
        body.data.cashReserve -
        body.data.operatingCapitalReserve,
      status: "draft",
      proposedBy: m.id,
    })
    .returning();
  await audit(m, row.id, "distribution.draft_created", body.data);
  res.status(201).json({ item: row });
});

router.get("/finance/distributions", async (req, res): Promise<any> => {
  const m = me(req, res);
  if (!m || !finance(m, res)) return;
  const declarations = await db
    .select()
    .from(atelierDistributionDeclarations)
    .where(eq(atelierDistributionDeclarations.orgId, m.orgId))
    .orderBy(desc(atelierDistributionDeclarations.createdAt));
  const allocations = await db
    .select()
    .from(atelierDistributionAllocations)
    .where(eq(atelierDistributionAllocations.orgId, m.orgId));
  const payments = await db
    .select()
    .from(atelierDistributionPayments)
    .where(eq(atelierDistributionPayments.orgId, m.orgId));
  const trueUps = await db
    .select()
    .from(atelierDistributionTrueUps)
    .where(eq(atelierDistributionTrueUps.orgId, m.orgId));
  const stakeholders = await db
    .select()
    .from(atelierOwnershipStakeholders)
    .where(eq(atelierOwnershipStakeholders.orgId, m.orgId));
  const names = new Map(stakeholders.map((s) => [s.id, s.label]));
  res.json({
    items: declarations.map((d) => ({
      id: d.id,
      year: Number(d.fiscalYear),
      currency: "USD",
      status: d.status,
      estimatedProfit: d.estimatedProfit,
      cashReserve: d.reserveCash,
      operatingCapitalReserve: d.reserveOperatingCapital,
      approvedDistributableProfit: d.distributableProfit,
      snapshotAt: d.approvedAt?.toISOString?.() ?? null,
      allocations: allocations
        .filter((a) => a.declarationId === d.id)
        .map((a) => ({
          id: a.id,
          personId: a.stakeholderId,
          holderName: names.get(a.stakeholderId) ?? "Unresolved stakeholder",
          percentage: a.profitPct,
          amount: a.amount,
          status: a.status,
          paidAmount: payments
            .filter((p) => p.allocationId === a.id)
            .reduce((n, p) => n + p.amount, 0),
          trueUpAmount: trueUps
            .filter(
              (t) =>
                t.stakeholderId === a.stakeholderId && t.declarationId === d.id,
            )
            .reduce((n, t) => n + t.deltaAmount, 0),
        })),
      payments: payments.filter((p) =>
        allocations.some(
          (a) => a.declarationId === d.id && a.id === p.allocationId,
        ),
      ),
      trueUps: trueUps.filter((t) => t.declarationId === d.id),
    })),
  });
});

router.post(
  "/finance/distributions/:id/:verb",
  async (req, res): Promise<any> => {
    const m = me(req, res);
    if (!m || !writer(m, res)) return;
    const verb = String(req.params.verb);
    const [d] = await db
      .select()
      .from(atelierDistributionDeclarations)
      .where(
        and(
          eq(atelierDistributionDeclarations.orgId, m.orgId),
          eq(atelierDistributionDeclarations.id, String(req.params.id)),
        ),
      );
    if (!d) return res.status(404).json({ error: "not-found" });
    if (verb === "submit") {
      if (d.status !== "draft")
        return res.status(409).json({ error: "invalid-distribution-state" });
      const [row] = await db
        .update(atelierDistributionDeclarations)
        .set({ status: "submitted" })
        .where(eq(atelierDistributionDeclarations.id, d.id))
        .returning();
      await audit(m, d.id, "distribution.submitted", {});
      return res.json({ item: row });
    }
    if (verb === "approve") {
      if (d.status !== "submitted" || d.proposedBy === m.id)
        return res
          .status(409)
          .json({
            error:
              d.proposedBy === m.id
                ? "maker-checker-required"
                : "invalid-distribution-state",
          });
      // Approval and the ownership snapshot are one atomic transition. This
      // prevents a declaration from being approved while its allocation set
      // is still mutable.
      const asOf = `${d.fiscalYear}-12-31`;
      const result = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(atelierDistributionDeclarations)
          .where(and(eq(atelierDistributionDeclarations.orgId, m.orgId), eq(atelierDistributionDeclarations.id, d.id)))
          .for("update");
        if (!locked || locked.status !== "submitted")
          throw new Error("invalid-distribution-state");
        const interests = (await tx.select().from(atelierOwnershipInterests)
          .where(and(eq(atelierOwnershipInterests.orgId, m.orgId), eq(atelierOwnershipInterests.structureId, locked.structureId), eq(atelierOwnershipInterests.status, "approved")))
          .for("update"))
          .filter((i) => activeAt(i.effectiveFrom, i.effectiveTo, asOf));
        const [snapshot] = await tx.insert(atelierDistributionSnapshots).values({ id: rid("snap"), orgId: m.orgId, declarationId: locked.id, asOf, rows: interests }).returning();
        const allocations = interests.map((i) => ({ id: rid("alloc"), orgId: m.orgId, declarationId: locked.id, stakeholderId: i.stakeholderId, profitPct: i.profitPct, amount: Number(locked.distributableProfit ?? 0) * i.profitPct / 100 }));
        if (allocations.length) await tx.insert(atelierDistributionAllocations).values(allocations);
        const [row] = await tx.update(atelierDistributionDeclarations).set({ status: "snapshotted", approvedBy: m.id, approvedAt: new Date(), interestSnapshotId: snapshot.id }).where(eq(atelierDistributionDeclarations.id, locked.id)).returning();
        return { row, snapshot, allocations };
      });
      await audit(m, d.id, "distribution.approved_and_snapshotted", { snapshotId: result.snapshot.id });
      return res.json({ item: { ...result.row, allocations: result.allocations }, snapshot: result.snapshot, allocations: result.allocations });
    }
    res.status(400).json({ error: "unknown-distribution-action" });
  },
);

router.post("/finance/ownership/structures/:id/approve", async (req, res): Promise<any> => {
  const m = me(req, res); if (!m || !writer(m, res)) return;
  const [precheck] = await db.select({ proposedBy: atelierOwnershipStructures.proposedBy }).from(atelierOwnershipStructures).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, String(req.params.id))));
  if (precheck?.proposedBy === m.id) return res.status(409).json({ error: "maker-checker-required" });
  const result = await db.transaction(async (tx) => {
    const [old] = await tx.select().from(atelierOwnershipStructures).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, String(req.params.id)))).for("update");
    if (!old) throw new Error("not-found"); if (old.proposedBy === m.id) throw new Error("maker-checker-required");
    if (old.effectiveTo && old.effectiveTo <= old.effectiveFrom) throw new Error("invalid-effective-dates");
    if (old.legalEntityId) {
      const [entity] = await tx.select({ id: atelierLegalEntities.id }).from(atelierLegalEntities).where(and(eq(atelierLegalEntities.orgId, m.orgId), eq(atelierLegalEntities.id, old.legalEntityId)));
      if (!entity) throw new Error("referenced-record-not-found");
    }
    const [row] = await tx.update(atelierOwnershipStructures).set({ approvalStatus: "approved", approvedBy: m.id, approvedAt: new Date() }).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, old.id), eq(atelierOwnershipStructures.approvalStatus, "pending"))).returning();
    if (!row) throw new Error("invalid-structure-state"); return { row, proposedBy: old.proposedBy };
  });
  if (result.row.approvalStatus !== "approved") return res.status(409).json({ error: "invalid-structure-state" });
  const row = result.row;
  await audit(m, row.id, "ownership.structure_approved", { proposedBy: result.proposedBy }); res.json({ structure: row });
});
router.post("/finance/ownership/links/:id/approve", async (req, res): Promise<any> => {
  const m = me(req, res); if (!m || !writer(m, res)) return;
  try {
    const result = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(atelierOwnershipStructureLinks).where(and(eq(atelierOwnershipStructureLinks.orgId, m.orgId), eq(atelierOwnershipStructureLinks.id, String(req.params.id)))).for("update");
      if (!old) throw new Error("not-found"); if (old.proposedBy === m.id) throw new Error("maker-checker-required");
      if (old.effectiveTo && old.effectiveTo <= old.effectiveFrom) throw new Error("invalid-effective-dates");
      const structs = await tx.select().from(atelierOwnershipStructures).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), inArray(atelierOwnershipStructures.id, [old.parentStructureId, old.childStructureId]), eq(atelierOwnershipStructures.approvalStatus, "approved")));
      if (structs.length !== 2) throw new Error("referenced-record-not-found");
      const links = await tx.select().from(atelierOwnershipStructureLinks).where(eq(atelierOwnershipStructureLinks.orgId, m.orgId)).orderBy(asc(atelierOwnershipStructureLinks.id)).for("update");
      if (links.some((x) => x.id !== old.id && x.status === "approved" && x.parentStructureId === old.parentStructureId && x.childStructureId === old.childStructureId && x.relationship === old.relationship && old.effectiveFrom < (x.effectiveTo ?? "9999-12-31") && (old.effectiveTo ?? "9999-12-31") > x.effectiveFrom)) throw new Error("overlapping-link-version");
      const next = new Map<string, string[]>(); for (const x of links.filter(x => x.status === "approved" && x.effectiveFrom < (old.effectiveTo ?? "9999-12-31") && (x.effectiveTo ?? "9999-12-31") > old.effectiveFrom)) next.set(x.parentStructureId, [...(next.get(x.parentStructureId) ?? []), x.childStructureId]); next.set(old.parentStructureId, [...(next.get(old.parentStructureId) ?? []), old.childStructureId]);
      const seen = new Set<string>(); const visit = (n: string): boolean => { if (n === old.parentStructureId) return true; if (seen.has(n)) return false; seen.add(n); return (next.get(n) ?? []).some(visit); }; if (visit(old.childStructureId)) throw new Error("ownership-cycle");
      const [row] = await tx.update(atelierOwnershipStructureLinks).set({ status: "approved", approvedBy: m.id, approvedAt: new Date() }).where(and(eq(atelierOwnershipStructureLinks.orgId, m.orgId), eq(atelierOwnershipStructureLinks.id, old.id), eq(atelierOwnershipStructureLinks.status, "pending"))).returning();
      if (!row) throw new Error("invalid-link-state"); return { row, proposedBy: old.proposedBy };
    });
    await audit(m, result.row.id, "ownership.link_approved", { proposedBy: result.proposedBy }); res.json({ link: result.row });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : "link-approval-failed" }); }
});
router.post("/finance/ownership/commercial-rights/:id/approve", async (req, res): Promise<any> => {
  const m = me(req, res); if (!m || !writer(m, res)) return;
  try {
    const result = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(atelierCommercialRights).where(and(eq(atelierCommercialRights.orgId, m.orgId), eq(atelierCommercialRights.id, String(req.params.id)))).for("update");
      if (!old) throw new Error("not-found"); if (old.proposedBy === m.id) throw new Error("maker-checker-required"); if (old.pendingTerms) throw new Error("terms-pending");
      const [structure] = await tx.select({ id: atelierOwnershipStructures.id }).from(atelierOwnershipStructures).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, old.structureId), eq(atelierOwnershipStructures.approvalStatus, "approved")));
      const [holder] = await tx.select({ id: atelierOwnershipStakeholders.id }).from(atelierOwnershipStakeholders).where(and(eq(atelierOwnershipStakeholders.orgId, m.orgId), eq(atelierOwnershipStakeholders.id, old.holderStakeholderId)));
      if (!structure || !holder) throw new Error("referenced-record-not-found");
      if (old.effectiveTo && old.effectiveTo <= old.effectiveFrom) throw new Error("invalid-effective-dates");
      const rights = await tx.select().from(atelierCommercialRights).where(and(eq(atelierCommercialRights.orgId, m.orgId), eq(atelierCommercialRights.structureId, old.structureId), eq(atelierCommercialRights.holderStakeholderId, old.holderStakeholderId), eq(atelierCommercialRights.rightType, old.rightType))).orderBy(asc(atelierCommercialRights.id)).for("update");
      if (rights.some(x => x.id !== old.id && x.status === "approved" && old.effectiveFrom < (x.effectiveTo ?? "9999-12-31") && (old.effectiveTo ?? "9999-12-31") > x.effectiveFrom)) throw new Error("overlapping-commercial-right-version");
      const [row] = await tx.update(atelierCommercialRights).set({ status: "approved", approvedBy: m.id, approvedAt: new Date() }).where(and(eq(atelierCommercialRights.orgId, m.orgId), eq(atelierCommercialRights.id, old.id), eq(atelierCommercialRights.status, "pending"))).returning();
      if (!row) throw new Error("invalid-commercial-right-state"); return { row };
    });
    await audit(m, result.row.id, "ownership.commercial_right_approved", {}); res.json({ right: result.row });
  } catch (e) { return res.status(409).json({ error: e instanceof Error ? e.message : "commercial-approval-failed" }); }
});
for (const [path, table, label] of [
  ["/finance/ownership/links", atelierOwnershipStructureLinks, "link"],
  ["/finance/ownership/commercial-rights", atelierCommercialRights, "commercial_right"],
] as const) {
  router.post(`${path}/:id/reject`, async (req, res): Promise<any> => {
    const m = me(req, res); if (!m || !writer(m, res)) return;
    let row: any;
    try {
      row = await db.transaction(async (tx) => {
        const [old] = await tx.select().from(table).where(and(eq(table.orgId, m.orgId), eq(table.id, String(req.params.id)))).for("update");
        if (!old) throw new Error("pending-record-not-found");
        if (old.proposedBy === m.id) throw new Error("maker-checker-required");
        if (old.status !== "pending") throw new Error("pending-record-not-found");
        const [updated] = await tx.update(table).set({ status: "rejected" }).where(and(eq(table.orgId, m.orgId), eq(table.id, old.id), eq(table.status, "pending"))).returning();
        if (!updated) throw new Error("pending-record-not-found");
        return updated;
      });
    } catch (e) {
      return res.status(e instanceof Error && e.message === "maker-checker-required" ? 409 : 404).json({ error: e instanceof Error ? e.message : "rejection-failed" });
    }
    await audit(m, String(req.params.id), `ownership.${label}_rejected`, {});
    res.json({ [label]: row });
  });
}
router.post("/finance/ownership/structures/:id/reject", async (req, res): Promise<any> => {
  const m = me(req, res); if (!m || !writer(m, res)) return;
  let row: any;
  try {
    row = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(atelierOwnershipStructures).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, String(req.params.id)))).for("update");
      if (!old) throw new Error("pending-record-not-found");
      if (old.proposedBy === m.id) throw new Error("maker-checker-required");
      if (old.approvalStatus !== "pending") throw new Error("invalid-structure-state");
      const [updated] = await tx.update(atelierOwnershipStructures).set({ approvalStatus: "rejected" }).where(and(eq(atelierOwnershipStructures.orgId, m.orgId), eq(atelierOwnershipStructures.id, old.id), eq(atelierOwnershipStructures.approvalStatus, "pending"))).returning();
      if (!updated) throw new Error("invalid-structure-state");
      return updated;
    });
  } catch (e) {
    return res.status(e instanceof Error && e.message === "maker-checker-required" ? 409 : 404).json({ error: e instanceof Error ? e.message : "rejection-failed" });
  }
  await audit(m, row.id, "ownership.structure_rejected", {}); res.json({ structure: row });
});
router.post("/finance/ownership/interests/:id/reject", async (req, res): Promise<any> => {
  const m = me(req, res); if (!m || !writer(m, res)) return;
  let row: any;
  try {
    row = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(atelierOwnershipInterests).where(and(eq(atelierOwnershipInterests.orgId, m.orgId), eq(atelierOwnershipInterests.id, String(req.params.id)))).for("update");
      if (!old) throw new Error("pending-record-not-found");
      if (old.proposedBy === m.id) throw new Error("maker-checker-required");
      if (old.status !== "pending") throw new Error("invalid-interest-state");
      const [updated] = await tx.update(atelierOwnershipInterests).set({ status: "rejected" }).where(and(eq(atelierOwnershipInterests.orgId, m.orgId), eq(atelierOwnershipInterests.id, old.id), eq(atelierOwnershipInterests.status, "pending"))).returning();
      if (!updated) throw new Error("invalid-interest-state");
      return updated;
    });
  } catch (e) {
    return res.status(e instanceof Error && e.message === "maker-checker-required" ? 409 : 404).json({ error: e instanceof Error ? e.message : "rejection-failed" });
  }
  await audit(m, row.id, "ownership.interest_rejected", {}); res.json({ interest: row });
});
export default router;
