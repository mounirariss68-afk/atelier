/**
 * Atelier — Task #223 routes:
 *   - Process discovery + Agent Architect (engagement-scoped)
 *   - Prototype Forge (opportunity- or engagement-scoped)
 *   - Proposal Composer (opportunity-scoped)
 *
 * All write endpoints record an `atelier_audit_events` row via the
 * `audit()` helper exported from `engagementRoutes.ts`. ACL is enforced
 * via `ensureEngAccess` for engagement-scoped routes; opportunities are
 * not engagement-scoped at the ACL layer in MVP, so opportunity routes
 * only require an authenticated persona.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierProcesses,
  atelierAgentDesigns,
  atelierProposals,
  atelierProposalSections,
  atelierPrototypes,
} from "@workspace/db";
import {
  runAgentArchitect,
  runPrototypeForge,
  runProposalComposer,
} from "../../lib/atelier-agents/runner.js";
import { ensureEngAccess, audit } from "./engagementRoutes.js";

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

const router: IRouter = Router();

// =============================================================
// PROCESSES + AGENT DESIGNS
// =============================================================

router.get("/engagements/:engId/processes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const rows = await db
    .select()
    .from(atelierProcesses)
    .where(and(eq(atelierProcesses.engagementId, eng.id), isNull(atelierProcesses.deletedAt)))
    .orderBy(desc(atelierProcesses.createdAt));
  res.json(rows);
});

router.post("/engagements/:engId/processes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const body = req.body as {
    name?: string;
    source?: string;
    sourceType?: "text" | "transcript" | "bpmn";
    scopeHint?: string;
    depth?: "sketch" | "design";
  };
  if (!body.source || body.source.trim().length < 10) {
    res.status(400).json({ error: "source-too-short" });
    return;
  }
  // Normalize each accepted sourceType into the canonical text the runner
  // expects. Transcripts are line-stripped of speaker tags; BPMN XML is
  // extracted into ordered task names so step extraction still works.
  let normalizedSource = body.source;
  const sourceType = body.sourceType ?? "text";
  if (sourceType === "transcript") {
    normalizedSource = body.source
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[A-Za-z][\w .'-]{0,40}:\s*/, "").trim())
      .filter(Boolean)
      .join(". ");
  } else if (sourceType === "bpmn") {
    const taskNames = Array.from(
      body.source.matchAll(/<bpmn:?(?:userTask|task|serviceTask|sendTask)[^>]*name="([^"]+)"/gi),
    ).map((m) => m[1]);
    if (taskNames.length) normalizedSource = taskNames.join(". ");
  }
  const { runId, output } = await runAgentArchitect({
    engagementId: eng.id,
    engagementName: eng.name,
    scopeHint: body.scopeHint ?? body.name ?? "Process",
    source: normalizedSource,
    depth: body.depth ?? "design",
    triggeredByUserId: me.id,
    actorLabel: me.name,
  });
  const procId = rid("proc");
  const [proc] = await db
    .insert(atelierProcesses)
    .values({
      id: procId,
      engagementId: eng.id,
      name: body.name ?? body.scopeHint ?? "Captured process",
      diagram: output.processDiagramMermaid,
      steps: output.steps,
      createdByUserId: me.id,
    })
    .returning();
  // Persist candidate agent designs.
  const designsToInsert = output.candidateAgents.map((a) => ({
    id: rid("agd"),
    engagementId: eng.id,
    processStepId: null,
    design: a as unknown as Record<string, unknown>,
    status: "draft",
    createdByUserId: me.id,
  }));
  const insertedDesigns = designsToInsert.length
    ? await db.insert(atelierAgentDesigns).values(designsToInsert).returning()
    : [];
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: "process.analyze",
    payload: { processId: proc.id, runId, designs: insertedDesigns.length },
    summary: `${me.name} analyzed process "${proc.name}" → ${insertedDesigns.length} candidate agents`,
  });
  res.status(201).json({ process: proc, designs: insertedDesigns, runId });
});

router.get("/engagements/:engId/agent-designs", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const rows = await db
    .select()
    .from(atelierAgentDesigns)
    .where(and(eq(atelierAgentDesigns.engagementId, eng.id), isNull(atelierAgentDesigns.deletedAt)))
    .orderBy(desc(atelierAgentDesigns.createdAt));
  res.json(rows);
});

router.post("/engagements/:engId/agent-designs/:designId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  if (me.role !== "engagement_lead" && me.role !== "partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-approve" });
    return;
  }
  const [updated] = await db
    .update(atelierAgentDesigns)
    .set({ status: "approved", updatedAt: new Date() })
    .where(and(eq(atelierAgentDesigns.id, req.params.designId), eq(atelierAgentDesigns.engagementId, eng.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "design-not-found" });
    return;
  }
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: "agent_design.approve",
    payload: { designId: updated.id },
    summary: `${me.name} approved candidate agent design ${updated.id}`,
  });
  res.json(updated);
});

// =============================================================
// PROTOTYPE FORGE (opportunity-scoped)
// =============================================================

router.get("/opportunities/:oppId/prototypes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierPrototypes)
    .where(and(eq(atelierPrototypes.opportunityId, req.params.oppId), isNull(atelierPrototypes.deletedAt)))
    .orderBy(desc(atelierPrototypes.createdAt));
  res.json(rows);
});

router.post("/opportunities/:oppId/prototype", async (req, res) => {
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
  const body = req.body as {
    name?: string;
    audience?: string;
    problem?: string;
    agenticThesis?: string;
    demos?: string[];
    constraints?: string[];
    brandOverrides?: { primary?: string; logo?: string } | null;
    partnerDataApproved?: boolean;
  };
  const brief = {
    name: body.name ?? `Prototype — ${opp.name}`,
    audience: body.audience ?? "Client decision-maker",
    problem: body.problem ?? "Demonstrate agentic feasibility.",
    agenticThesis: body.agenticThesis ?? "An agent assists; a human decides.",
    demos: body.demos ?? ["Headline demo"],
    constraints: body.constraints ?? [],
    brandOverrides: body.brandOverrides ?? null,
    partnerDataApproved: body.partnerDataApproved ?? false,
  };
  const { runId, output } = await runPrototypeForge({
    opportunityId: opp.id,
    engagementId: null,
    targetLabel: opp.name,
    brief,
    triggeredByUserId: me.id,
    actorLabel: me.name,
  });
  const [proto] = await db
    .insert(atelierPrototypes)
    .values({
      id: rid("proto"),
      opportunityId: opp.id,
      runId,
      name: brief.name,
      brief: brief as unknown as Record<string, unknown>,
      replitPromptMd: output.replitPromptMd,
      buildPlan: output.buildPlan,
      demoStoryboard: output.demoStoryboard,
      status: "draft",
      createdByUserId: me.id,
    })
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: opp.id,
    actor: me,
    action: "prototype.forge",
    payload: { prototypeId: proto.id, runId },
    summary: `${me.name} forged prototype "${brief.name}"`,
  });
  res.status(201).json({ prototype: proto, runId });
});

// =============================================================
// PROPOSAL COMPOSER (opportunity-scoped)
// =============================================================

router.get("/opportunities/:oppId/proposal", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [proposal] = await db
    .select()
    .from(atelierProposals)
    .where(and(eq(atelierProposals.opportunityId, req.params.oppId), isNull(atelierProposals.deletedAt)))
    .orderBy(desc(atelierProposals.createdAt));
  if (!proposal) {
    res.status(404).json({ error: "proposal-not-found" });
    return;
  }
  const sections = await db
    .select()
    .from(atelierProposalSections)
    .where(and(eq(atelierProposalSections.proposalId, proposal.id), isNull(atelierProposalSections.deletedAt)));
  res.json({ proposal, sections });
});

router.post("/opportunities/:oppId/proposal", async (req, res) => {
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
  const body = req.body as {
    sectionsRequired?: string[];
    teamProposed?: { role: string; alloc: number }[];
    pricingIntent?: { targetMarginPct: number; durationWeeks: number };
    rfpRequirements?: { id: string; requirement: string; severity: string }[];
  };
  const sectionsRequired = body.sectionsRequired ?? [
    "context",
    "approach",
    "workplan",
    "team",
    "pricing",
    "case_studies",
    "terms",
    "compliance",
  ];
  const { runId, output } = await runProposalComposer({
    opportunityId: opp.id,
    opportunityName: opp.name,
    sectionsRequired,
    teamProposed: body.teamProposed ?? [
      { role: "partner", alloc: 15 },
      { role: "lead", alloc: 80 },
      { role: "sme", alloc: 60 },
      { role: "ai_engineer", alloc: 80 },
    ],
    pricingIntent: body.pricingIntent ?? { targetMarginPct: 45, durationWeeks: 12 },
    rfpRequirements: body.rfpRequirements ?? [],
    triggeredByUserId: me.id,
    actorLabel: me.name,
  });
  const proposalId = rid("prop");
  const [proposal] = await db
    .insert(atelierProposals)
    .values({
      id: proposalId,
      opportunityId: opp.id,
      runId,
      title: output.title,
      sectionsRequired,
      teamProposed: body.teamProposed ?? [],
      pricingIntent: body.pricingIntent ?? {},
      pricingModel: output.pricingModel as unknown as Record<string, unknown>,
      winThemes: output.winThemes,
      complianceMatrix: output.complianceMatrix,
      status: "draft",
      createdByUserId: me.id,
    })
    .returning();
  const sectionRows = output.sections.map((s) => ({
    id: rid("psec"),
    proposalId: proposal.id,
    sectionId: s.id,
    name: s.name,
    ownerAgent: s.ownerAgent,
    status: s.status,
    content: s.content,
    citations: s.citations,
    createdByUserId: me.id,
  }));
  if (sectionRows.length) {
    await db.insert(atelierProposalSections).values(sectionRows);
  }
  await audit({
    entityType: "opportunity",
    entityId: opp.id,
    actor: me,
    action: "proposal.compose",
    payload: { proposalId: proposal.id, runId, sections: sectionRows.length },
    summary: `${me.name} composed proposal "${proposal.title}" (${sectionRows.length} sections)`,
  });
  res.status(201).json({ proposal, sections: sectionRows, runId });
});

router.post("/proposal-sections/:sectionId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "engagement_lead" && me.role !== "partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-approve" });
    return;
  }
  const [updated] = await db
    .update(atelierProposalSections)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(atelierProposalSections.id, req.params.sectionId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "section-not-found" });
    return;
  }
  // Audit must be filed against the opportunity (the parent business
  // entity) so it surfaces on the opportunity activity stream.
  const [parentProposal] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(eq(atelierProposals.id, updated.proposalId));
  await audit({
    entityType: "opportunity",
    entityId: parentProposal?.opportunityId ?? updated.proposalId,
    actor: me,
    action: "proposal_section.approve",
    payload: {
      sectionId: updated.id,
      sectionKey: updated.sectionId,
      proposalId: updated.proposalId,
    },
    summary: `${me.name} approved proposal section "${updated.name}"`,
  });
  res.json(updated);
});

// ----------------------------------------------------------------------
// Proposal SEND — partner-only final read gate. Enforces the workflow:
// (1) all sections approved, (2) pricing not partner_override_required,
// then assembles a deterministic DOCX/PDF placeholder artifact and flips
// proposal.status to "sent".
// ----------------------------------------------------------------------
router.post("/proposals/:proposalId/send", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "only-partner-may-send-proposal" });
    return;
  }
  const [proposal] = await db
    .select()
    .from(atelierProposals)
    .where(eq(atelierProposals.id, req.params.proposalId));
  if (!proposal) {
    res.status(404).json({ error: "proposal-not-found" });
    return;
  }
  const sections = await db
    .select()
    .from(atelierProposalSections)
    .where(eq(atelierProposalSections.proposalId, proposal.id));
  const unapproved = sections.filter((s) => s.status !== "approved");
  if (unapproved.length > 0) {
    res.status(409).json({
      error: "sections-not-approved",
      pending: unapproved.map((s) => s.sectionId),
    });
    return;
  }
  const pricingVerdict = (proposal.pricingModel as { verdict?: string } | null)?.verdict;
  if (pricingVerdict === "partner_override_required") {
    res.status(409).json({ error: "pricing-requires-partner-override" });
    return;
  }
  // Deterministic stub artifact URL — real DOCX/PDF assembly is wired
  // through the artifacts pipeline in a follow-up. Path encodes proposal
  // id so downstream artifact retrieval can locate the rendered file.
  const artifactUrl = `/api/atelier/artifacts/proposal-${proposal.id}.pdf`;
  const [updated] = await db
    .update(atelierProposals)
    .set({ status: "sent", updatedAt: new Date() })
    .where(eq(atelierProposals.id, proposal.id))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proposal.opportunityId,
    actor: me,
    action: "proposal.send",
    payload: { proposalId: proposal.id, artifactUrl },
    summary: `${me.name} sent proposal "${proposal.title}" to client`,
  });
  res.json({ proposal: updated, artifactUrl });
});

export default router;
