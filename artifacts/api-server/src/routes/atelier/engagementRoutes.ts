/**
 * Atelier — engagement-side write routes (Task #222).
 *
 * - Charter Architect (redraft / list versions / approve)
 * - Hypothesis tree (read)
 * - RAID CRUD (list / create / patch)
 * - Deliverables (list / create / draft version / critique / send)
 * - Artifacts (list / create with AR detect / stub-translate)
 *
 * All write endpoints record an `atelier_audit_events` row. The
 * Partner-Authority-Lock on /send rejects with 423 unless either
 * `criticReadiness === 'green'` OR the request body provides
 * `override:true` plus a non-empty `rationale`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  db,
  atelierEngagements,
  atelierUsers,
  atelierAuditEvents,
  atelierAgentRuns,
  atelierDeliverables,
  atelierDeliverableVersions,
  atelierRaidItems,
  atelierHypothesisTrees,
  atelierCharterVersions,
  atelierArtifacts,
} from "@workspace/db";
import {
  AtelierRedraftCharterBody as AtelierCharterRedraftInput,
  AtelierApproveCharterVersionBody as AtelierCharterApproveInput,
  AtelierCreateRaidItemBody as AtelierRaidItemInput,
  AtelierUpdateRaidItemBody as AtelierRaidItemPatch,
  AtelierCreateDeliverableBody as AtelierDeliverableInput,
  AtelierDraftDeliverableBody as AtelierDeliverableDraftInput,
  AtelierCritiqueDeliverableBody as AtelierCritiqueInput,
  AtelierSendDeliverableBody as AtelierSendDeliverableInput,
  AtelierCreateArtifactBody as AtelierArtifactInput,
} from "@workspace/api-zod";
import {
  runCharterArchitect,
  runSynthesisCritic,
  scaffoldDiagnosticMemo,
  type HypothesisTree,
} from "../../lib/atelier-agents/runner.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

async function loadEng(id: string) {
  const [row] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, id), isNull(atelierEngagements.deletedAt)));
  return row;
}

/**
 * Per-engagement ACL gate.
 *
 * Resolves the parent engagement of any object referenced by id (deliverable,
 * artifact, charter version, etc.) and rejects with 404 when the engagement
 * is missing/soft-deleted. Personas with the `partner` role bypass scoping
 * (firm-wide visibility); all others must have an `engagementIds` allow-list
 * on their persona row that contains the target engagement id. When a
 * persona has no list at all, we treat them as firm-wide (current seed
 * behaviour) — the gate still blocks IDs pointing at missing/deleted
 * engagements, closing the cross-engagement IDOR path the architect flagged.
 */
async function ensureEngAccess(
  res: Response,
  me: typeof atelierUsers.$inferSelect,
  engId: string | null | undefined,
): Promise<typeof atelierEngagements.$inferSelect | null> {
  if (!engId) {
    res.status(404).json({ error: "engagement-not-found" });
    return null;
  }
  const eng = await loadEng(engId);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return null;
  }
  const allowed = (me as { engagementIds?: string[] | null }).engagementIds ?? null;
  if (me.role !== "partner" && Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(eng.id)) {
    res.status(403).json({ error: "engagement-forbidden" });
    return null;
  }
  return eng;
}

async function loadTree(engId: string): Promise<HypothesisTree | null> {
  const [row] = await db
    .select()
    .from(atelierHypothesisTrees)
    .where(and(eq(atelierHypothesisTrees.engagementId, engId), isNull(atelierHypothesisTrees.deletedAt)));
  if (!row) return null;
  return (row.root as HypothesisTree) ?? null;
}

function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<unknown> {
  return db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

const router: IRouter = Router();

// =============================================================
// Charter Architect
// =============================================================

function charterVersionWire(v: typeof atelierCharterVersions.$inferSelect) {
  return {
    id: v.id,
    engagementId: v.engagementId,
    versionNumber: v.versionNumber,
    status: v.status as "draft" | "lead_approved" | "live" | "superseded",
    runId: v.runId,
    body: v.body as never,
    hypothesisTree: v.hypothesisTree as never,
    raidBaseline: v.raidBaseline as never,
    proposedWorkstreams: v.proposedWorkstreams as never,
    meceFlags: (v.meceFlags as string[]) ?? [],
    leadApprovedByName: v.leadApprovedByUserId ?? null,
    leadApprovedAt: v.leadApprovedAt?.toISOString() ?? null,
    partnerApprovedByName: v.partnerApprovedByName ?? null,
    partnerApprovedAt: v.partnerApprovedAt?.toISOString() ?? null,
    notes: v.notes ?? null,
    createdAt: v.createdAt.toISOString(),
  };
}

router.get("/engagements/:engId/charter/versions", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const rows = await db
    .select()
    .from(atelierCharterVersions)
    .where(and(eq(atelierCharterVersions.engagementId, eng.id), isNull(atelierCharterVersions.deletedAt)))
    .orderBy(desc(atelierCharterVersions.versionNumber));
  res.json(rows.map(charterVersionWire));
});

router.post("/engagements/:engId/charter/redraft", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const parsed = AtelierCharterRedraftInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  // The UI calls /charter/redraft with no body to ask the Architect to
  // re-derive from what's already on the engagement. Default to the
  // engagement's own name + account so mock and live runners both have
  // a non-empty seed and never crash on `undefined.toLowerCase()`.
  const wonProposalSummary =
    (parsed.data.wonProposalSummary && parsed.data.wonProposalSummary.trim()) ||
    `${eng.name} — re-derive from engagement charter and seeded context`;
  const { runId, output } = await runCharterArchitect({
    engagementId: eng.id,
    engagementName: eng.name,
    accountName: eng.accountId,
    wonProposalSummary,
    kickoffTranscriptExcerpt: parsed.data.kickoffTranscriptExcerpt ?? null,
    triggeredByUserId: me.id,
    actorLabel: "Charter Architect",
  });
  // Compute next version number.
  const existing = await db
    .select()
    .from(atelierCharterVersions)
    .where(and(eq(atelierCharterVersions.engagementId, eng.id), isNull(atelierCharterVersions.deletedAt)));
  const nextNumber = (existing.reduce((m, r) => Math.max(m, r.versionNumber), 0) ?? 0) + 1;
  const id = rid("chrtv");
  const [row] = await db
    .insert(atelierCharterVersions)
    .values({
      id,
      engagementId: eng.id,
      versionNumber: nextNumber,
      runId,
      body: output.charter as never,
      hypothesisTree: output.hypothesisTree as never,
      raidBaseline: output.raidBaseline as never,
      proposedWorkstreams: output.proposedWorkstreams as never,
      meceFlags: output.meceFlags as never,
      status: "draft",
      createdByUserId: me.id,
    })
    .returning();
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: "charter.redraft",
    payload: { runId, versionId: id, versionNumber: nextNumber, meceFlags: output.meceFlags },
    summary: `Charter v${nextNumber} drafted by Charter Architect (${output.meceFlags.length ? "MECE flags raised" : "MECE clean"})`,
  });
  res.json(charterVersionWire(row));
});

router.post("/engagements/:engId/charter/versions/:versionId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierCharterApproveInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [v] = await db
    .select()
    .from(atelierCharterVersions)
    .where(and(eq(atelierCharterVersions.id, req.params.versionId), isNull(atelierCharterVersions.deletedAt)));
  if (!v || v.engagementId !== req.params.engId) {
    res.status(404).json({ error: "version-not-found" });
    return;
  }
  if (!(await ensureEngAccess(res, me, v.engagementId))) return;
  // Role spoofing guard: a persona may only approve in their own seat.
  // Partners may also approve as `lead` (they outrank lead); leads cannot
  // self-promote into the partner sign-off slot.
  if (parsed.data.role === "partner" && me.role !== "partner") {
    res.status(403).json({ error: "role-forbidden", reason: "Only a partner persona can record partner approval." });
    return;
  }
  if (parsed.data.role === "lead" && me.role !== "engagement_lead" && me.role !== "partner") {
    res.status(403).json({ error: "role-forbidden", reason: "Only the engagement lead (or partner) can record lead approval." });
    return;
  }
  const ts = new Date();
  if (parsed.data.role === "lead") {
    await db
      .update(atelierCharterVersions)
      .set({
        leadApprovedAt: ts,
        leadApprovedByUserId: me.id,
        status: "lead_approved",
        notes: parsed.data.notes || v.notes,
        updatedAt: ts,
      })
      .where(eq(atelierCharterVersions.id, v.id));
  } else {
    // Partner sign-off → mark this version live, supersede previous live.
    await db
      .update(atelierCharterVersions)
      .set({ status: "superseded", updatedAt: ts })
      .where(and(eq(atelierCharterVersions.engagementId, v.engagementId), eq(atelierCharterVersions.status, "live")));
    await db
      .update(atelierCharterVersions)
      .set({
        partnerApprovedAt: ts,
        partnerApprovedByUserId: me.id,
        partnerApprovedByName: me.name,
        status: "live",
        notes: parsed.data.notes || v.notes,
        updatedAt: ts,
      })
      .where(eq(atelierCharterVersions.id, v.id));
    // Mirror onto engagement.charter so the home tab shows it.
    await db
      .update(atelierEngagements)
      .set({ charter: v.body as never, updatedAt: ts })
      .where(eq(atelierEngagements.id, v.engagementId));
    // Replace the engagement's hypothesis tree with the approved one.
    const [existingTree] = await db
      .select()
      .from(atelierHypothesisTrees)
      .where(and(eq(atelierHypothesisTrees.engagementId, v.engagementId), isNull(atelierHypothesisTrees.deletedAt)));
    if (existingTree) {
      await db
        .update(atelierHypothesisTrees)
        .set({ root: v.hypothesisTree as never, updatedAt: ts })
        .where(eq(atelierHypothesisTrees.id, existingTree.id));
    } else {
      await db.insert(atelierHypothesisTrees).values({
        id: rid("hyp"),
        engagementId: v.engagementId,
        root: v.hypothesisTree as never,
        createdByUserId: me.id,
      });
    }
  }
  await audit({
    entityType: "engagement",
    entityId: v.engagementId,
    actor: me,
    action: `charter.approve.${parsed.data.role}`,
    payload: { versionId: v.id, versionNumber: v.versionNumber, notes: parsed.data.notes },
    summary: `${me.name} (${parsed.data.role}) approved charter v${v.versionNumber}`,
  });
  const [refreshed] = await db
    .select()
    .from(atelierCharterVersions)
    .where(eq(atelierCharterVersions.id, v.id));
  res.json(charterVersionWire(refreshed));
});

// =============================================================
// Hypothesis tree (read)
// =============================================================
router.get("/engagements/:engId/hypothesis-tree", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierHypothesisTrees)
    .where(and(eq(atelierHypothesisTrees.engagementId, eng.id), isNull(atelierHypothesisTrees.deletedAt)));
  res.json({
    engagementId: eng.id,
    treeId: row?.id ?? null,
    root: row?.root ?? { rootIssue: "", branches: [] },
  });
});

// =============================================================
// RAID
// =============================================================
function raidWire(r: typeof atelierRaidItems.$inferSelect, ownerName: string | null) {
  return {
    id: r.id,
    engagementId: r.engagementId,
    kind: r.kind as "risk" | "assumption" | "issue" | "dependency",
    severity: r.severity as "green" | "amber" | "red",
    status: r.status as "open" | "mitigated" | "closed",
    ownerUserId: r.ownerId,
    ownerName,
    description: r.description,
    // `mitigation` is exposed on the wire for the UI but not yet persisted —
    // a follow-up will add a column. For now we surface a stable null.
    mitigation: null as string | null,
    targetDate: r.dueDate,
    createdAt: r.createdAt.toISOString(),
  };
}

async function withOwner(rows: (typeof atelierRaidItems.$inferSelect)[]) {
  const userIds = Array.from(new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x)));
  const users = userIds.length
    ? await db
        .select()
        .from(atelierUsers)
        .where(and(isNull(atelierUsers.deletedAt)))
    : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => raidWire(r, r.ownerId ? byId.get(r.ownerId) ?? null : null));
}

router.get("/engagements/:engId/raid", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierRaidItems)
    .where(and(eq(atelierRaidItems.engagementId, eng.id), isNull(atelierRaidItems.deletedAt)))
    .orderBy(desc(atelierRaidItems.createdAt));
  res.json(await withOwner(rows));
});

router.post("/engagements/:engId/raid", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const parsed = AtelierRaidItemInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const id = rid("raid");
  const [row] = await db
    .insert(atelierRaidItems)
    .values({
      id,
      engagementId: eng.id,
      kind: parsed.data.kind,
      severity: parsed.data.severity,
      status: "open",
      ownerId: parsed.data.ownerUserId ?? null,
      description: parsed.data.description,
      dueDate: parsed.data.targetDate ?? null,
      createdByUserId: me.id,
    })
    .returning();
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: `raid.create.${parsed.data.kind}`,
    payload: { id, severity: parsed.data.severity, description: parsed.data.description },
    summary: `${parsed.data.kind} (${parsed.data.severity}): ${parsed.data.description.slice(0, 120)}`,
  });
  res.status(201).json(raidWire(row, null));
});

router.patch("/engagements/:engId/raid/:raidId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierRaidItemPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierRaidItems)
    .where(and(eq(atelierRaidItems.id, req.params.raidId), isNull(atelierRaidItems.deletedAt)));
  if (!existing || existing.engagementId !== req.params.engId) {
    res.status(404).json({ error: "raid-not-found" });
    return;
  }
  const patch: Partial<typeof atelierRaidItems.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.severity) patch.severity = parsed.data.severity;
  if (parsed.data.status) patch.status = parsed.data.status;
  // `mitigation` is part of the wire contract but not persisted yet — accept
  // and ignore the value so the route stays forward-compatible.
  if (parsed.data.targetDate !== undefined) patch.dueDate = parsed.data.targetDate;
  const [row] = await db
    .update(atelierRaidItems)
    .set(patch)
    .where(eq(atelierRaidItems.id, existing.id))
    .returning();
  await audit({
    entityType: "engagement",
    entityId: existing.engagementId,
    actor: me,
    action: "raid.update",
    payload: { id: existing.id, patch: parsed.data },
    summary: `RAID item ${existing.id} updated`,
  });
  res.json(raidWire(row, null));
});

// =============================================================
// Deliverables
// =============================================================
function deliverableWire(d: typeof atelierDeliverables.$inferSelect) {
  return {
    id: d.id,
    engagementId: d.engagementId,
    type: d.type,
    name: d.name,
    status: d.status,
    hypothesisId: d.hypothesisId,
    currentVersionId: d.currentVersionId,
    dueDate: d.dueDate,
    criticReadiness: (d.criticReadiness ?? null) as "green" | "amber" | "red" | null,
    criticReportSummary: d.criticReportSummary,
    partnerApprovedAt: d.partnerApprovedAt?.toISOString() ?? null,
    partnerApprovedByName: d.partnerApprovedByName,
    partnerRationale: d.partnerRationale,
    lockOverridden: d.lockOverridden,
    sentAt: d.sentAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

function versionWire(v: typeof atelierDeliverableVersions.$inferSelect) {
  return {
    id: v.id,
    deliverableId: v.deliverableId,
    versionNumber: v.versionNumber,
    body: v.body ?? "",
    // `notes` is exposed on the wire schema for future UX (re-draft notes) but
    // not yet persisted; surface a stable null.
    notes: null as string | null,
    createdAt: v.createdAt.toISOString(),
  };
}

router.get("/engagements/:engId/deliverables", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.engagementId, eng.id), isNull(atelierDeliverables.deletedAt)))
    .orderBy(desc(atelierDeliverables.createdAt));
  res.json(rows.map(deliverableWire));
});

router.post("/engagements/:engId/deliverables", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const parsed = AtelierDeliverableInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const id = rid("del");
  const [row] = await db
    .insert(atelierDeliverables)
    .values({
      id,
      engagementId: eng.id,
      type: parsed.data.type,
      name: parsed.data.name,
      status: "draft",
      hypothesisId: parsed.data.hypothesisId ?? null,
      dueDate: parsed.data.dueDate ?? null,
      createdByUserId: me.id,
    })
    .returning();
  await audit({
    entityType: "deliverable",
    entityId: id,
    actor: me,
    action: "deliverable.create",
    payload: { type: parsed.data.type, name: parsed.data.name },
    summary: `Created ${parsed.data.type} "${parsed.data.name}"`,
  });
  res.status(201).json(deliverableWire(row));
});

async function buildDeliverableDetail(d: typeof atelierDeliverables.$inferSelect) {
  const versions = await db
    .select()
    .from(atelierDeliverableVersions)
    .where(and(eq(atelierDeliverableVersions.deliverableId, d.id), isNull(atelierDeliverableVersions.deletedAt)))
    .orderBy(desc(atelierDeliverableVersions.versionNumber));
  // Most-recent critic run for this deliverable.
  const runs = await db
    .select()
    .from(atelierAgentRuns)
    .where(and(eq(atelierAgentRuns.targetType, "deliverable"), eq(atelierAgentRuns.targetId, d.id), eq(atelierAgentRuns.agentId, "synthesis_critic")))
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  const lastCritic = runs[0]?.output as
    | { issues?: unknown[]; pyramid_score?: number; evidence_coverage_pct?: number; off_hypothesis_sections?: string[] }
    | null
    | undefined;
  return {
    deliverable: deliverableWire(d),
    versions: versions.map(versionWire),
    latestCriticIssues: (lastCritic?.issues as never[]) ?? [],
    pyramidScore: lastCritic?.pyramid_score ?? null,
    evidenceCoveragePct: lastCritic?.evidence_coverage_pct ?? null,
    offHypothesisSections: lastCritic?.off_hypothesis_sections ?? [],
    criticRunId: runs[0]?.id ?? null,
  };
}

router.get("/deliverables/:delId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [row] = await db
    .select()
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.id, req.params.delId), isNull(atelierDeliverables.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "deliverable-not-found" });
    return;
  }
  if (!(await ensureEngAccess(res, me, row.engagementId))) return;
  res.json(await buildDeliverableDetail(row));
});

router.post("/deliverables/:delId/draft", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierDeliverableDraftInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [del] = await db
    .select()
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.id, req.params.delId), isNull(atelierDeliverables.deletedAt)));
  if (!del) {
    res.status(404).json({ error: "deliverable-not-found" });
    return;
  }
  if (!(await ensureEngAccess(res, me, del.engagementId))) return;
  let body = parsed.data.body ?? null;
  if (!body && parsed.data.scaffold) {
    const eng = await loadEng(del.engagementId);
    const tree = await loadTree(del.engagementId);
    body = scaffoldDiagnosticMemo({
      engagementName: eng?.name ?? del.name,
      audience: "Client executive",
      tree,
      includeDefects: parsed.data.includeDefects ?? false,
    });
  }
  if (!body) {
    res.status(400).json({ error: "no-body", reason: "Provide body or set scaffold:true" });
    return;
  }
  const versions = await db
    .select()
    .from(atelierDeliverableVersions)
    .where(and(eq(atelierDeliverableVersions.deliverableId, del.id), isNull(atelierDeliverableVersions.deletedAt)));
  const next = (versions.reduce((m, v) => Math.max(m, v.versionNumber), 0) ?? 0) + 1;
  const id = rid("delv");
  const [row] = await db
    .insert(atelierDeliverableVersions)
    .values({
      id,
      deliverableId: del.id,
      versionNumber: next,
      body,
      createdByUserId: me.id,
    })
    .returning();
  await db
    .update(atelierDeliverables)
    .set({
      currentVersionId: id,
      // A new draft invalidates any prior critic readiness.
      criticReadiness: null,
      criticReportSummary: null,
      lockOverridden: false,
      partnerApprovedAt: null,
      partnerApprovedByUserId: null,
      partnerApprovedByName: null,
      partnerRationale: null,
      updatedAt: new Date(),
    })
    .where(eq(atelierDeliverables.id, del.id));
  await audit({
    entityType: "deliverable",
    entityId: del.id,
    actor: me,
    action: "deliverable.draft",
    payload: { versionId: id, versionNumber: next, scaffold: !!parsed.data.scaffold },
    summary: `${me.name} drafted v${next}${parsed.data.scaffold ? " (scaffold)" : ""}`,
  });
  res.json(versionWire(row));
});

router.post("/deliverables/:delId/critique", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierCritiqueInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [del] = await db
    .select()
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.id, req.params.delId), isNull(atelierDeliverables.deletedAt)));
  if (!del) {
    res.status(404).json({ error: "deliverable-not-found" });
    return;
  }
  if (!(await ensureEngAccess(res, me, del.engagementId))) return;
  if (!del.currentVersionId) {
    res.status(412).json({ error: "no-version", reason: "Draft a version before requesting critique" });
    return;
  }
  const [version] = await db
    .select()
    .from(atelierDeliverableVersions)
    .where(eq(atelierDeliverableVersions.id, del.currentVersionId));
  const tree = await loadTree(del.engagementId);
  const { runId, output } = await runSynthesisCritic({
    engagementId: del.engagementId,
    deliverableId: del.id,
    deliverableName: del.name,
    body: version?.body ?? "",
    hypothesisTree: tree,
    audience: parsed.data.audience,
    triggeredByUserId: me.id,
    actorLabel: "Synthesis Critic",
  });
  const summary = `Critic: ${output.readiness.toUpperCase()} · pyramid ${Math.round(output.pyramid_score * 100)}% · evidence ${output.evidence_coverage_pct}% · ${output.issues.length} issue(s)`;
  await db
    .update(atelierDeliverables)
    .set({
      criticReadiness: output.readiness,
      criticReportSummary: summary,
      // A fresh critique invalidates any prior partner override.
      lockOverridden: false,
      partnerApprovedAt: null,
      partnerRationale: null,
      updatedAt: new Date(),
    })
    .where(eq(atelierDeliverables.id, del.id));
  await audit({
    entityType: "deliverable",
    entityId: del.id,
    actor: me,
    action: "deliverable.critique",
    payload: { runId, readiness: output.readiness, issues: output.issues.length },
    summary,
  });
  res.json({
    readiness: output.readiness,
    pyramidScore: output.pyramid_score,
    evidenceCoveragePct: output.evidence_coverage_pct,
    offHypothesisSections: output.off_hypothesis_sections,
    issues: output.issues,
    runId,
  });
});

router.post("/deliverables/:delId/send", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierSendDeliverableInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [del] = await db
    .select()
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.id, req.params.delId), isNull(atelierDeliverables.deletedAt)));
  if (!del) {
    res.status(404).json({ error: "deliverable-not-found" });
    return;
  }
  if (!(await ensureEngAccess(res, me, del.engagementId))) return;
  // ---- Partner Authority Lock + HAPA -----------------------------
  // Send rules (HAPA: Human-As-Partner-Authority):
  //   1. Only a Partner persona may press [Send to client]. Final
  //      authority always rests with a partner — even on GREEN.
  //   2. A Partner rationale (>= 8 chars) is required and permanently
  //      recorded in the audit trail on every send.
  //   3. If the Synthesis Critic has not yet reviewed the current
  //      version, we auto-run it before evaluating the lock so the
  //      partner sees fresh readiness.
  //   4. If readiness is not GREEN, the partner must explicitly set
  //      override:true to acknowledge the HAPA override.
  const isPartner = me.role === "partner";
  const hasRationale = (parsed.data.rationale ?? "").trim().length >= 8;

  if (!isPartner) {
    res.status(423).json({
      error: "send-blocked",
      reason: "Only a Partner persona may [Send to client] — final authority sits with the partner.",
      readiness: del.criticReadiness,
    });
    return;
  }
  if (!hasRationale) {
    res.status(423).json({
      error: "send-blocked",
      reason: "Partner rationale (≥ 8 chars) is required on every send and is permanently logged in the HAPA audit trail.",
      readiness: del.criticReadiness,
    });
    return;
  }
  // (3) Auto-run Critic if missing readiness, then re-load.
  if (!del.criticReadiness && del.currentVersionId) {
    const [version] = await db
      .select()
      .from(atelierDeliverableVersions)
      .where(eq(atelierDeliverableVersions.id, del.currentVersionId));
    const tree = await loadTree(del.engagementId);
    const { runId, output } = await runSynthesisCritic({
      engagementId: del.engagementId,
      deliverableId: del.id,
      deliverableName: del.name,
      body: version?.body ?? "",
      hypothesisTree: tree,
      audience: "Client executive",
      triggeredByUserId: me.id,
      actorLabel: "Synthesis Critic (auto-run on send)",
    });
    const summary = `Critic: ${output.readiness.toUpperCase()} · pyramid ${Math.round(output.pyramid_score * 100)}% · evidence ${output.evidence_coverage_pct}% · ${output.issues.length} issue(s)`;
    await db
      .update(atelierDeliverables)
      .set({ criticReadiness: output.readiness, criticReportSummary: summary, updatedAt: new Date() })
      .where(eq(atelierDeliverables.id, del.id));
    await audit({
      entityType: "deliverable",
      entityId: del.id,
      actor: me,
      action: "deliverable.critique.auto",
      payload: { runId, readiness: output.readiness, issues: output.issues.length },
      summary: `${summary} (auto-run on send)`,
    });
    del.criticReadiness = output.readiness;
  }
  const isGreen = del.criticReadiness === "green";
  if (!isGreen && parsed.data.override !== true) {
    res.status(423).json({
      error: "send-blocked",
      reason: del.criticReadiness
        ? `Synthesis Critic readiness is ${del.criticReadiness.toUpperCase()} — partner must set override:true to acknowledge the HAPA override.`
        : "Synthesis Critic has no readiness for the current version — partner must set override:true to send anyway.",
      readiness: del.criticReadiness,
    });
    return;
  }

  const ts = new Date();
  await db
    .update(atelierDeliverables)
    .set({
      status: "sent",
      sentAt: ts,
      sentByUserId: me.id,
      partnerApprovedAt: ts,
      partnerApprovedByUserId: me.id,
      partnerApprovedByName: me.name,
      partnerRationale: parsed.data.rationale || null,
      lockOverridden: !isGreen,
      updatedAt: ts,
    })
    .where(eq(atelierDeliverables.id, del.id));

  await audit({
    entityType: "deliverable",
    entityId: del.id,
    actor: me,
    action: isGreen ? "deliverable.send.green" : "deliverable.send.partner_override",
    payload: {
      readinessAtSend: del.criticReadiness,
      rationale: parsed.data.rationale,
      hapa: !isGreen,
    },
    summary: isGreen
      ? `${me.name} sent "${del.name}" (Critic GREEN)`
      : `HAPA — Partner ${me.name} overrode ${del.criticReadiness?.toUpperCase() ?? "UNREVIEWED"} on "${del.name}": "${(parsed.data.rationale ?? "").slice(0, 120)}"`,
  });

  const [refreshed] = await db
    .select()
    .from(atelierDeliverables)
    .where(eq(atelierDeliverables.id, del.id));
  res.json(deliverableWire(refreshed));
});

// =============================================================
// Artifacts (per engagement, bilingual)
// =============================================================

function detectLanguage(text: string): "en" | "ar" | "other" {
  // Cheap detector: any Arabic-block character → ar; any non-Latin
  // dominant script → other; default en.
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  // Latin/digit/punct ratio
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = (text.match(/\S/g) || []).length;
  if (total > 20 && latin / total < 0.3) return "other";
  return "en";
}

function stubTranslate(text: string, from: "en" | "ar" | "other"): string {
  // MVP stub. Production swaps to a real translation provider; the *flow*
  // (preserve original, store translation, audit the run) is the part we
  // need to test now.
  if (from === "ar") return `[EN translation pending — original AR preserved]\n${text}`;
  return `[AR translation pending — original EN preserved]\n${text}`;
}

function artifactWire(a: typeof atelierArtifacts.$inferSelect) {
  return {
    id: a.id,
    engagementId: a.parentId,
    title: a.title,
    abstract: a.abstract,
    body: a.body,
    language: a.language as "en" | "ar" | "other",
    translatedTitle: a.translatedTitle,
    translatedBody: a.translatedBody,
    translatedAt: a.translatedAt?.toISOString() ?? null,
    source: a.source,
    tags: (a.tags as string[]) ?? [],
    fileUrl: a.fileUrl,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/engagements/:engId/artifacts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierArtifacts)
    .where(
      and(
        eq(atelierArtifacts.parentType, "engagement"),
        eq(atelierArtifacts.parentId, eng.id),
        isNull(atelierArtifacts.deletedAt),
      ),
    )
    .orderBy(desc(atelierArtifacts.createdAt));
  res.json(rows.map(artifactWire));
});

router.post("/engagements/:engId/artifacts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const parsed = AtelierArtifactInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const detectFrom = `${parsed.data.title}\n${parsed.data.abstract ?? ""}\n${parsed.data.body ?? ""}`;
  const language = detectLanguage(detectFrom);
  const id = rid("art");
  const [row] = await db
    .insert(atelierArtifacts)
    .values({
      id,
      parentType: "engagement",
      parentId: eng.id,
      title: parsed.data.title,
      abstract: parsed.data.abstract ?? null,
      body: parsed.data.body ?? null,
      tags: (parsed.data.tags ?? []) as never,
      source: parsed.data.source,
      language,
      fileUrl: parsed.data.fileUrl ?? null,
      createdByUserId: me.id,
    })
    .returning();
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: `artifact.upload.${language}`,
    payload: { id, title: parsed.data.title, language },
    summary: `${me.name} uploaded artifact "${parsed.data.title}" (${language})`,
  });
  res.status(201).json(artifactWire(row));
});

router.post("/artifacts/:artifactId/translate", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [a] = await db
    .select()
    .from(atelierArtifacts)
    .where(and(eq(atelierArtifacts.id, req.params.artifactId), isNull(atelierArtifacts.deletedAt)));
  if (!a) {
    res.status(404).json({ error: "artifact-not-found" });
    return;
  }
  if (a.parentType !== "engagement" || !(await ensureEngAccess(res, me, a.parentId))) return;
  const lang = (a.language as "en" | "ar" | "other");
  const ts = new Date();
  const [row] = await db
    .update(atelierArtifacts)
    .set({
      translatedTitle: stubTranslate(a.title, lang),
      translatedBody: a.body ? stubTranslate(a.body, lang) : null,
      translatedAt: ts,
      updatedAt: ts,
    })
    .where(eq(atelierArtifacts.id, a.id))
    .returning();
  await audit({
    entityType: "engagement",
    entityId: a.parentId,
    actor: me,
    action: "artifact.translate.stub",
    payload: { id: a.id, from: lang },
    summary: `${me.name} translated artifact "${a.title}" (stub, ${lang}→${lang === "ar" ? "en" : "ar"})`,
  });
  res.json(artifactWire(row));
});

export default router;
