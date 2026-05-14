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
import { eq, and, desc, isNull, or, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierProcesses,
  atelierAgentDesigns,
  atelierAgents,
  atelierAgentRuns,
  atelierProposals,
  atelierDealPricings,
  atelierMarginPolicies,
  atelierProposalSections,
  atelierPrototypes,
  atelierEngagements,
  atelierEngagementAccess,
  atelierWinThemes,
  atelierAccounts,
  atelierFirmProfile,
  atelierProposalRecipients,
} from "@workspace/db";
import { renderProposalHtml, orderSectionsBySpine } from "../../lib/atelier-proposal-html.js";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  runAgentArchitect,
  runPrototypeForge,
  runProposalComposer,
  type MeetingScribeOutput,
  type CharterArchitectOutput,
} from "../../lib/atelier-agents/runner.js";
import { generateProposalDocs, ATELIER_ARTIFACT_DIR } from "../../lib/atelier-agents/proposal-docs.js";
import { classifyMarginGate, type MarginPolicy } from "../../lib/atelier-pricing.js";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
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

/**
 * Opportunity-scoped ACL: persona must share the opportunity's org and
 * be either the partner_owner, the engagement_lead, or any partner-role
 * user. Returns the row on success, otherwise responds 403/404 and null.
 */
async function ensureOppAccess(
  res: Response,
  me: typeof atelierUsers.$inferSelect,
  oppId: string,
): Promise<typeof atelierOpportunities.$inferSelect | null> {
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, oppId), isNull(atelierOpportunities.deletedAt)));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return null;
  }
  if (opp.orgId !== me.orgId) {
    res.status(403).json({ error: "cross-org-access-denied" });
    return null;
  }
  const isOwner = opp.partnerOwnerId === me.id || opp.engagementLeadId === me.id;
  const isPartner = (me.role === "partner" || me.role === "founding_partner");
  if (!isOwner && !isPartner) {
    res.status(403).json({ error: "no-opportunity-access" });
    return null;
  }
  return opp;
}

/**
 * Read-only mirror of ensureEngAccess that returns boolean and never
 * writes to the response. Used when we want to filter rather than 403
 * (e.g. when collecting the set of authorized engagements linked to an
 * opportunity for charter cross-wiring).
 */
async function canAccessEngagement(
  me: typeof atelierUsers.$inferSelect,
  engId: string,
): Promise<boolean> {
  const [eng] = await db
    .select({ id: atelierEngagements.id, orgId: atelierEngagements.orgId })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engId), isNull(atelierEngagements.deletedAt)));
  if (!eng) return false;
  if (eng.orgId !== me.orgId) return false;
  if ((me.role === "partner" || me.role === "founding_partner")) return true;
  const [grant] = await db
    .select({ userId: atelierEngagementAccess.userId })
    .from(atelierEngagementAccess)
    .where(
      and(
        eq(atelierEngagementAccess.engagementId, eng.id),
        eq(atelierEngagementAccess.userId, me.id),
        // Task #254 — Sentinel writes status='revoked' on revoke; ACL
        // must enforce status='active' so revocation actually denies reads.
        eq(atelierEngagementAccess.status, "active"),
        isNull(atelierEngagementAccess.deletedAt),
      ),
    );
  return !!grant;
}

const router: IRouter = Router();

// =============================================================
// PROCESSES + AGENT DESIGNS
// =============================================================

// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
router.post("/engagements/:engId/processes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  const body = req.body as {
    name?: string;
    source?: string;
    sourceType?: "text" | "transcript" | "bpmn" | "image";
    scopeHint?: string;
    depth?: "sketch" | "design";
  };
  const sourceType = body.sourceType ?? "text";
  if (sourceType !== "image" && (!body.source || body.source.trim().length < 10)) {
    res.status(400).json({ error: "source-too-short" });
    return;
  }
  if (sourceType === "image" && (!body.source || body.source.length < 50)) {
    res.status(400).json({ error: "image-payload-required" });
    return;
  }
  // Normalize each accepted sourceType into the canonical text the runner
  // expects. Transcripts are line-stripped of speaker tags; BPMN XML is
  // extracted into ordered task names so step extraction still works.
  // Images use a deterministic mock OCR (hash-of-bytes → pinned step labels)
  // so the demo loop is reproducible without an actual vision model.
  let normalizedSource = body.source ?? "";
  if (sourceType === "transcript") {
    normalizedSource = (body.source ?? "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[A-Za-z][\w .'-]{0,40}:\s*/, "").trim())
      .filter(Boolean)
      .join(". ");
  } else if (sourceType === "bpmn") {
    const taskNames = Array.from(
      (body.source ?? "").matchAll(/<bpmn:?(?:userTask|task|serviceTask|sendTask)[^>]*name="([^"]+)"/gi),
    ).map((m) => m[1]);
    if (taskNames.length) normalizedSource = taskNames.join(". ");
  } else if (sourceType === "image") {
    // Mock OCR: derive a stable step-count from a SHA-256 of the bytes,
    // emit pinned step labels suitable for the Process Reader sub-agent.
    const b64 = (body.source ?? "").replace(/^data:[^;]+;base64,/, "");
    const digest = createHash("sha256").update(b64).digest();
    const stepCount = 4 + (digest[0]! % 3); // 4..6 steps
    const palette = [
      "Inbound request received",
      "Owner triages and classifies",
      "Specialist enriches with system data",
      "Quote or response is drafted",
      "Approver reviews against policy",
      "Outbound reply is sent to customer",
    ];
    normalizedSource = palette.slice(0, stepCount).join(". ");
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

// @cli-skip: pending Task #340 read-parity migration
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

// Promote an approved engagement-scoped design to the Atelier registry.
// Partner-only (per requirement: "Partner-gated promote to Atelier").
// @cli-skip: pending Task #340 read-parity migration
router.post("/engagements/:engId/agent-designs/:designId/promote", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "only-partner-may-promote" });
    return;
  }
  const [design] = await db
    .select()
    .from(atelierAgentDesigns)
    .where(and(eq(atelierAgentDesigns.id, req.params.designId), eq(atelierAgentDesigns.engagementId, eng.id)));
  if (!design) { res.status(404).json({ error: "design-not-found" }); return; }
  if (design.status !== "approved") {
    res.status(409).json({ error: "design-not-approved", currentStatus: design.status });
    return;
  }
  const d = (design.design ?? {}) as {
    name?: string; purpose?: string; tools?: string[];
    guardrails?: string[]; humanCheckpoints?: string[]; riskClass?: string;
    inputs?: Array<Record<string, unknown>>;
    outputs?: Array<Record<string, unknown>>;
  };
  // Mark the engagement-bound design as promoted so the engagement
  // /agents view can clearly distinguish "engagement runtime (still
  // engagement-bound)" from "promoted to global Atelier registry".
  const agentId = `agent_${rid("eng").slice(4)}`;
  await db
    .update(atelierAgentDesigns)
    .set({
      status: "promoted",
      design: { ...(design.design as Record<string, unknown>), promotedAgentId: agentId },
      updatedAt: new Date(),
    })
    .where(eq(atelierAgentDesigns.id, design.id));
  await db.insert(atelierAgents).values({
    id: agentId,
    name: d.name ?? "Promoted Agent",
    group: "Engagement",
    stage: "Deliver",
    purpose: d.purpose ?? "Promoted from process discovery.",
    model: "claude-sonnet-4-5",
    starred: false,
    status: "mvp",
    tools: d.tools ?? [],
    guardrails: d.guardrails ?? [],
    humanCheckpoints: d.humanCheckpoints ?? [],
    inputs: (d.inputs ?? []) as never,
    outputs: (d.outputs ?? []) as never,
    runsLast30d: 0,
    createdByUserId: me.id ?? undefined,
  });
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: "agent_design.promote",
    payload: { designId: design.id, agentId },
    summary: `${me.name} promoted "${d.name ?? "design"}" into the Atelier registry`,
  });
  res.json({ agentId });
});

// Aggregated run counts grouped by agent_id, scoped to org. Used by the
// /agents tab to render usage counters next to runtime cards.
// @cli-skip: pending Task #340 read-parity migration
router.get("/agents/usage-counts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select({ agentId: atelierAgentRuns.agentId, count: sql<number>`count(*)::int` })
    .from(atelierAgentRuns)
    .where(eq(atelierAgentRuns.orgId, me.orgId))
    .groupBy(atelierAgentRuns.agentId);
  res.json(rows);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/engagements/:engId/agent-designs/:designId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  if (me.role !== "senior_manager" && me.role !== "partner" && me.role !== "founding_partner") {
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

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/prototypes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await ensureOppAccess(res, me, req.params.oppId);
  if (!opp) return;
  const rows = await db
    .select()
    .from(atelierPrototypes)
    .where(and(eq(atelierPrototypes.opportunityId, opp.id), isNull(atelierPrototypes.deletedAt)))
    .orderBy(desc(atelierPrototypes.createdAt));
  res.json(rows);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/prototype", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await ensureOppAccess(res, me, req.params.oppId);
  if (!opp) return;
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
  // Pre-pull the most-recent successful Meeting Scribe run on this
  // opportunity. If Scribe surfaced a `suggestedPrototypeBrief`, those
  // fields seed the Forge brief unless the caller passes overrides.
  // This is the cross-agent wiring required by Task #223.
  const [latestScribe] = await db
    .select({ output: atelierAgentRuns.output })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, "meeting_scribe"),
        eq(atelierAgentRuns.targetType, "opportunity"),
        eq(atelierAgentRuns.targetId, opp.id),
        eq(atelierAgentRuns.status, "success"),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  const scribeBrief = (latestScribe?.output as MeetingScribeOutput | null)
    ?.suggestedPrototypeBrief ?? null;
  const brief = {
    name: body.name ?? `Prototype — ${opp.name}`,
    audience: body.audience ?? scribeBrief?.audience ?? "Client decision-maker",
    problem: body.problem ?? scribeBrief?.problem ?? "Demonstrate agentic feasibility.",
    agenticThesis:
      body.agenticThesis ?? scribeBrief?.agenticThesis ?? "An agent assists; a human decides.",
    demos: body.demos ?? scribeBrief?.demos ?? ["Headline demo"],
    constraints: body.constraints ?? [],
    brandOverrides: body.brandOverrides ?? null,
    partnerDataApproved: body.partnerDataApproved ?? false,
    seededFrom: scribeBrief ? "meeting_scribe" : null,
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

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/proposal", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await ensureOppAccess(res, me, req.params.oppId);
  if (!opp) return;
  const [proposal] = await db
    .select()
    .from(atelierProposals)
    .where(and(eq(atelierProposals.opportunityId, opp.id), isNull(atelierProposals.deletedAt)))
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

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/proposal", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await ensureOppAccess(res, me, req.params.oppId);
  if (!opp) return;
  const body = req.body as {
    title?: string;
    sectionsRequired?: string[];
    teamProposed?: { role: string; alloc: number }[];
    pricingIntent?: { targetMarginPct: number; durationWeeks: number };
    rfpRequirements?: { id: string; requirement: string; severity: string }[];
    deadlineAt?: string;
    rfpFileName?: string;
  };
  const sectionsRequired = body.sectionsRequired ?? [
    // Task #297 — 15-section spine.
    "cover",
    "exec_summary",
    "context",
    "hypothesis",
    "approach",
    "workplan",
    "team",
    "pricing",
    "case_studies",
    "company_profile",
    "value_case",
    "terms",
    "compliance",
    "annexes",
    "appendices",
  ];
  // Pre-pull the most-recent Charter Architect run for THIS opportunity's
  // engagement(s) only — never org-wide. We:
  //   1. Resolve the engagement(s) linked to this opportunity.
  //   2. Verify the caller has access to each via ensureEngAccess (same
  //      ACL the engagement routes use; partners pass).
  //   3. Restrict the charter run lookup to runs whose targetType is
  //      "engagement" and targetId is in the authorized set.
  // This prevents cross-engagement bleed of charter/workstream data.
  const linkedEngs = await db
    .select({ id: atelierEngagements.id })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.opportunityId, opp.id), isNull(atelierEngagements.deletedAt)));
  const authorizedEngIds: string[] = [];
  for (const row of linkedEngs) {
    // ensureEngAccess writes a 403 to res on denial; we silence that here
    // by passing a stub response and only collecting positive results.
    // Partners short-circuit; non-partners need an atelierEngagementAccess row.
    const ok = await canAccessEngagement(me, row.id);
    if (ok) authorizedEngIds.push(row.id);
  }
  const [latestCharter] = authorizedEngIds.length
    ? await db
        .select({ output: atelierAgentRuns.output })
        .from(atelierAgentRuns)
        .where(
          and(
            eq(atelierAgentRuns.agentId, "charter_architect"),
            eq(atelierAgentRuns.orgId, me.orgId),
            eq(atelierAgentRuns.targetType, "engagement"),
            inArray(atelierAgentRuns.targetId, authorizedEngIds),
            eq(atelierAgentRuns.status, "success"),
          ),
        )
        .orderBy(desc(atelierAgentRuns.createdAt))
        .limit(1)
    : [];
  const proposedWorkstreams =
    (latestCharter?.output as CharterArchitectOutput | null)?.proposedWorkstreams ?? [];
  const teamFromCharter = proposedWorkstreams.length
    ? proposedWorkstreams.map((w) => ({ role: w.leadRole, alloc: 60 }))
    : null;
  // Task #241: pull top-3 firm-wide Win Themes for this opp's offering.
  // Prefer themes whose offeringTags include the opp's offeringAnchor;
  // fall back to org-wide themes (empty offeringTags).
  const themeRows = await db
    .select()
    .from(atelierWinThemes)
    .where(
      and(
        eq(atelierWinThemes.polarity, "win"),
        isNull(atelierWinThemes.deletedAt),
      ),
    );
  const offering = opp.offeringAnchor ?? "";
  const [acctRow] = await db
    .select({ sector: atelierAccounts.sector })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, opp.accountId));
  const oppSector = acctRow?.sector ?? "";
  // Score = 100 if offering tag matches, +50 if sector tag matches, +supportCount.
  // Tagless ("org-wide") themes always eligible with score 0 + supportCount.
  const ranked = themeRows
    .map((t) => {
      const offTags = (t.offeringTags as string[]) ?? [];
      const secTags = (t.sectorTags as string[]) ?? [];
      let score = t.supportCount ?? 0;
      if (offTags.length === 0 && secTags.length === 0) {
        // org-wide theme; eligible
      } else {
        const offMatch = offTags.length === 0 || (offering && offTags.includes(offering));
        const secMatch = secTags.length === 0 || (oppSector && secTags.includes(oppSector));
        if (!offMatch && !secMatch) return { t, score: -1 };
        if (offering && offTags.includes(offering)) score += 100;
        if (oppSector && secTags.includes(oppSector)) score += 50;
      }
      return { t, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ t }) => ({ tag: t.tag, name: t.name, positioningLine: t.positioningLine }));
  const { runId, output } = await runProposalComposer({
    opportunityId: opp.id,
    opportunityName: opp.name,
    sectionsRequired,
    teamProposed: body.teamProposed ?? teamFromCharter ?? [
      { role: "partner", alloc: 15 },
      { role: "lead", alloc: 80 },
      { role: "consultant", alloc: 60 },
      { role: "consultant", alloc: 80 },
    ],
    pricingIntent: body.pricingIntent ?? { targetMarginPct: 45, durationWeeks: 12 },
    rfpRequirements: body.rfpRequirements ?? [],
    triggeredByUserId: me.id,
    actorLabel: me.name,
    curatedWinThemes: ranked,
  });
  const proposalId = rid("prop");
  const [proposal] = await db
    .insert(atelierProposals)
    .values({
      id: proposalId,
      opportunityId: opp.id,
      runId,
      title: body.title ?? output.title,
      sectionsRequired,
      teamProposed: body.teamProposed ?? teamFromCharter ?? [],
      pricingIntent: {
        ...(body.pricingIntent ?? {}),
        seededFromCharter: proposedWorkstreams.length > 0,
        proposedWorkstreams,
        deadlineAt: body.deadlineAt ?? null,
        rfpFileName: body.rfpFileName ?? null,
      },
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

// PATCH content of a proposal section (lead/partner). Resets status
// to "draft" so the section must be re-approved after edit. This is
// the "Edit" half of the Approve/Edit/Reject pattern.
// @cli-skip: pending Task #340 read-parity migration
router.patch("/proposal-sections/:sectionId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "senior_manager" && me.role !== "partner" && me.role !== "founding_partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-edit" });
    return;
  }
  const body = req.body as { content?: string };
  if (typeof body.content !== "string" || body.content.trim().length < 1) {
    res.status(400).json({ error: "content-required" });
    return;
  }
  const [section] = await db
    .select()
    .from(atelierProposalSections)
    .where(eq(atelierProposalSections.id, req.params.sectionId));
  if (!section) { res.status(404).json({ error: "section-not-found" }); return; }
  const [parent] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(eq(atelierProposals.id, section.proposalId));
  if (!parent) { res.status(404).json({ error: "parent-proposal-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, parent.opportunityId))) return;
  const [updated] = await db
    .update(atelierProposalSections)
    .set({ content: body.content, status: "draft", updatedAt: new Date() })
    .where(eq(atelierProposalSections.id, req.params.sectionId))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: parent.opportunityId,
    actor: me,
    action: "proposal_section.edit",
    payload: { sectionId: updated.id, sectionKey: updated.sectionId, proposalId: updated.proposalId },
    summary: `${me.name} edited proposal section "${updated.name}" (status reset to draft)`,
  });
  res.json(updated);
});

// REJECT a proposal section (lead/partner). Sets status="rejected" and
// records the reason on the row's citations meta. The send gate already
// rejects any non-approved section, so this prevents re-approval until
// the lead edits + re-approves. Completes the Approve/Edit/Reject set.
// @cli-skip: pending Task #340 read-parity migration
router.post("/proposal-sections/:sectionId/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "senior_manager" && me.role !== "partner" && me.role !== "founding_partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-reject" });
    return;
  }
  const body = req.body as { reason?: string };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5) {
    res.status(400).json({ error: "reason-required" });
    return;
  }
  const [section] = await db
    .select()
    .from(atelierProposalSections)
    .where(eq(atelierProposalSections.id, req.params.sectionId));
  if (!section) { res.status(404).json({ error: "section-not-found" }); return; }
  const [parent] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(eq(atelierProposals.id, section.proposalId));
  if (!parent) { res.status(404).json({ error: "parent-proposal-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, parent.opportunityId))) return;
  const newCitations = [
    ...((section.citations as unknown[] | null) ?? []),
    { kind: "rejection", reason, by: me.name, at: new Date().toISOString() },
  ];
  const [updated] = await db
    .update(atelierProposalSections)
    .set({ status: "rejected", citations: newCitations as never, updatedAt: new Date() })
    .where(eq(atelierProposalSections.id, req.params.sectionId))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: parent.opportunityId,
    actor: me,
    action: "proposal_section.reject",
    payload: { sectionId: updated.id, sectionKey: updated.sectionId, reason },
    summary: `${me.name} rejected proposal section "${updated.name}": ${reason}`,
  });
  res.json(updated);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/proposal-sections/:sectionId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "senior_manager" && me.role !== "partner" && me.role !== "founding_partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-approve" });
    return;
  }
  // Resolve parent proposal first so we can ACL-check on its opportunity
  // before mutating the section row.
  const [section] = await db
    .select()
    .from(atelierProposalSections)
    .where(eq(atelierProposalSections.id, req.params.sectionId));
  if (!section) {
    res.status(404).json({ error: "section-not-found" });
    return;
  }
  const [parentProposal] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(eq(atelierProposals.id, section.proposalId));
  if (!parentProposal) {
    res.status(404).json({ error: "parent-proposal-not-found" });
    return;
  }
  if (!(await ensureOppAccess(res, me, parentProposal.opportunityId))) return;
  const [updated] = await db
    .update(atelierProposalSections)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(atelierProposalSections.id, req.params.sectionId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "section-not-found" });
    return;
  }
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
// Prototype Forge state machine: draft → lead_approved → live (partner).
// ----------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/prototypes/:prototypeId/approve-brief", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "senior_manager" && me.role !== "partner" && me.role !== "founding_partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-approve-brief" });
    return;
  }
  const [proto] = await db
    .select()
    .from(atelierPrototypes)
    .where(eq(atelierPrototypes.id, req.params.prototypeId));
  if (!proto || !proto.opportunityId) { res.status(404).json({ error: "prototype-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proto.opportunityId))) return;
  if (proto.status !== "draft") {
    res.status(409).json({ error: "brief-not-in-draft", currentStatus: proto.status });
    return;
  }
  const [updated] = await db
    .update(atelierPrototypes)
    .set({ status: "lead_approved", leadApprovedAt: new Date(), leadApprovedByUserId: me.id ?? undefined, updatedAt: new Date() })
    .where(eq(atelierPrototypes.id, req.params.prototypeId))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proto.opportunityId,
    actor: me,
    action: "prototype.lead_approve_brief",
    payload: { prototypeId: proto.id },
    summary: `${me.name} approved prototype brief "${proto.name}"`,
  });
  res.json(updated);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/prototypes/:prototypeId/approve-prompt", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "only-partner-may-approve-prompt" });
    return;
  }
  const [proto] = await db
    .select()
    .from(atelierPrototypes)
    .where(eq(atelierPrototypes.id, req.params.prototypeId));
  if (!proto || !proto.opportunityId) { res.status(404).json({ error: "prototype-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proto.opportunityId))) return;
  if (proto.status !== "lead_approved") {
    res.status(409).json({ error: "brief-not-lead-approved", currentStatus: proto.status });
    return;
  }
  const [updated] = await db
    .update(atelierPrototypes)
    .set({
      status: "live",
      partnerApprovedAt: new Date(),
      partnerApprovedByUserId: me.id ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(atelierPrototypes.id, req.params.prototypeId))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proto.opportunityId,
    actor: me,
    action: "prototype.partner_approve_prompt",
    payload: { prototypeId: proto.id },
    summary: `${me.name} approved prototype prompt "${proto.name}" for client demo`,
  });
  res.json(updated);
});

// ----------------------------------------------------------------------
// Pricing approval checkpoint — partner-only. Distinct from final send;
// records that the partner has explicitly read & accepted the pricing
// model. Persisted in proposal.pricingIntent so the send gate can
// require it independently of section approvals.
// ----------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/proposals/:proposalId/approve-pricing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "only-partner-may-approve-pricing" });
    return;
  }
  const [proposal] = await db
    .select()
    .from(atelierProposals)
    .where(eq(atelierProposals.id, req.params.proposalId));
  if (!proposal) { res.status(404).json({ error: "proposal-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  const verdict = (proposal.pricingModel as { verdict?: string } | null)?.verdict;
  if (verdict === "partner_override_required") {
    res.status(409).json({
      error: "pricing-requires-partner-override",
      hint: "Use POST /proposals/:id/override-pricing with a rationale",
    });
    return;
  }
  const newIntent = {
    ...((proposal.pricingIntent ?? {}) as Record<string, unknown>),
    pricingApprovedAt: new Date().toISOString(),
    pricingApprovedByUserId: me.id,
    pricingApprovedByName: me.name,
  };
  const [updated] = await db
    .update(atelierProposals)
    .set({ pricingIntent: newIntent, updatedAt: new Date() })
    .where(eq(atelierProposals.id, proposal.id))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proposal.opportunityId,
    actor: me,
    action: "proposal.approve_pricing",
    payload: { proposalId: proposal.id },
    summary: `${me.name} approved proposal pricing for "${proposal.title}"`,
  });
  res.json(updated);
});

// ----------------------------------------------------------------------
// Pricing OVERRIDE checkpoint — partner-only escape hatch for proposals
// whose verdict is "partner_override_required" (margin below target).
// Records rationale + approver + timestamp on pricingIntent. Send gate
// accepts either a normal pricing approval OR a recorded override.
// ----------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/proposals/:proposalId/override-pricing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "only-partner-may-override-pricing" });
    return;
  }
  const body = req.body as { rationale?: string };
  const rationale = (body.rationale ?? "").trim();
  if (rationale.length < 10) {
    res.status(400).json({ error: "rationale-too-short" });
    return;
  }
  const [proposal] = await db
    .select()
    .from(atelierProposals)
    .where(eq(atelierProposals.id, req.params.proposalId));
  if (!proposal) { res.status(404).json({ error: "proposal-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  const verdict = (proposal.pricingModel as { verdict?: string } | null)?.verdict;
  if (verdict !== "partner_override_required") {
    res.status(409).json({ error: "override-not-required-for-this-verdict" });
    return;
  }
  const newIntent = {
    ...((proposal.pricingIntent ?? {}) as Record<string, unknown>),
    pricingOverrideAt: new Date().toISOString(),
    pricingOverrideByUserId: me.id,
    pricingOverrideByName: me.name,
    pricingOverrideRationale: rationale,
  };
  const [updated] = await db
    .update(atelierProposals)
    .set({ pricingIntent: newIntent, updatedAt: new Date() })
    .where(eq(atelierProposals.id, proposal.id))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proposal.opportunityId,
    actor: me,
    action: "proposal.override_pricing",
    payload: { proposalId: proposal.id, rationale },
    summary: `${me.name} overrode pricing for "${proposal.title}": ${rationale}`,
  });
  res.json(updated);
});

// ----------------------------------------------------------------------
// PromptSheet checkpoint #1 — Section assignments confirmed (lead/partner).
// Locks the per-section ownerAgent + sectionsRequired list before send.
// ----------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/proposals/:proposalId/confirm-section-assignments", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "senior_manager" && me.role !== "partner" && me.role !== "founding_partner") {
    res.status(403).json({ error: "only-lead-or-partner-may-confirm-assignments" });
    return;
  }
  const [proposal] = await db.select().from(atelierProposals).where(eq(atelierProposals.id, req.params.proposalId));
  if (!proposal) { res.status(404).json({ error: "proposal-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  const newIntent = {
    ...((proposal.pricingIntent ?? {}) as Record<string, unknown>),
    sectionAssignmentsConfirmedAt: new Date().toISOString(),
    sectionAssignmentsConfirmedByUserId: me.id,
    sectionAssignmentsConfirmedByName: me.name,
  };
  const [updated] = await db
    .update(atelierProposals)
    .set({ pricingIntent: newIntent, updatedAt: new Date() })
    .where(eq(atelierProposals.id, proposal.id))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proposal.opportunityId,
    actor: me,
    action: "proposal.confirm_section_assignments",
    payload: { proposalId: proposal.id },
    summary: `${me.name} confirmed proposal section assignments for "${proposal.title}"`,
  });
  res.json(updated);
});

// ----------------------------------------------------------------------
// PromptSheet checkpoint #2 — Final partner read (partner only).
// Distinct from approve-pricing: this is the partner's last-mile read
// of the assembled proposal before the send.
// ----------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/proposals/:proposalId/partner-final-read", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "only-partner-may-record-final-read" });
    return;
  }
  const [proposal] = await db.select().from(atelierProposals).where(eq(atelierProposals.id, req.params.proposalId));
  if (!proposal) { res.status(404).json({ error: "proposal-not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  const newIntent = {
    ...((proposal.pricingIntent ?? {}) as Record<string, unknown>),
    partnerFinalReadAt: new Date().toISOString(),
    partnerFinalReadByUserId: me.id,
    partnerFinalReadByName: me.name,
  };
  const [updated] = await db
    .update(atelierProposals)
    .set({ pricingIntent: newIntent, updatedAt: new Date() })
    .where(eq(atelierProposals.id, proposal.id))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proposal.opportunityId,
    actor: me,
    action: "proposal.partner_final_read",
    payload: { proposalId: proposal.id },
    summary: `${me.name} recorded final partner read for "${proposal.title}"`,
  });
  res.json(updated);
});

// ----------------------------------------------------------------------
// Proposal SEND — partner-only final read gate. Enforces the workflow:
// (1) all sections approved, (2) pricing approved OR overridden,
// then assembles a deterministic DOCX/PDF artifact and flips
// proposal.status to "sent".
// ----------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/proposals/:proposalId/send", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
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
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
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
  // Send requires a recorded pricing checkpoint: either the normal
  // approval (verdicts other than override-required) or an explicit
  // partner override with rationale.
  const pricingIntent = (proposal.pricingIntent ?? {}) as {
    pricingApprovedAt?: string;
    pricingOverrideAt?: string;
  };
  const pricingApprovedAt = pricingIntent.pricingApprovedAt;
  const pricingOverrideAt = pricingIntent.pricingOverrideAt;
  const pricingVerdict = (proposal.pricingModel as { verdict?: string } | null)?.verdict;
  if (pricingVerdict === "partner_override_required" && !pricingOverrideAt) {
    res.status(409).json({
      error: "pricing-requires-partner-override",
      hint: "Use POST /proposals/:id/override-pricing with a rationale",
    });
    return;
  }
  if (pricingVerdict !== "partner_override_required" && !pricingApprovedAt) {
    res.status(409).json({ error: "pricing-not-yet-approved" });
    return;
  }
  // PromptSheet checkpoints (Task #223 spec): the lead must lock the
  // section assignments and the partner must record a final read before
  // anything ships to the client. Both are recorded on pricingIntent.
  const sheet = pricingIntent as {
    sectionAssignmentsConfirmedAt?: string;
    partnerFinalReadAt?: string;
  };
  if (!sheet.sectionAssignmentsConfirmedAt) {
    res.status(409).json({
      error: "section-assignments-not-confirmed",
      hint: "Use POST /proposals/:id/confirm-section-assignments (lead/partner)",
    });
    return;
  }
  if (!sheet.partnerFinalReadAt) {
    res.status(409).json({
      error: "partner-final-read-required",
      hint: "Use POST /proposals/:id/partner-final-read (partner only)",
    });
    return;
  }
  // Margin-lock gate (Task #240): block submit when the deal pricing is
  // AMBER without a single-Partner override, or RED without a two-Partner
  // countersign. Pricing rows are optional — if no row exists the gate is
  // a no-op so v1 proposals (which never built a deal pricing row) still ship.
  const [dealPricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, proposal.opportunityId), isNull(atelierDealPricings.deletedAt)));
  if (dealPricing) {
    // Re-classify against the *current* margin policy via the shared
    // classifyMarginGate helper so submit / override / countersign all
    // share one source of truth and cannot deadlock when targetMarginPct,
    // redThresholdPct and twoPartnerThresholdPct are independently tuned.
    const [livePolicyRow] = await db
      .select()
      .from(atelierMarginPolicies)
      .where(and(eq(atelierMarginPolicies.isDefault, true), isNull(atelierMarginPolicies.deletedAt)));
    const margin = dealPricing.computedMarginPct;
    const livePolicy: MarginPolicy = livePolicyRow ?? {
      targetMarginPct: 0.55,
      amberThresholdPct: 0.5,
      redThresholdPct: 0.45,
      twoPartnerThresholdPct: 0.45,
    };
    const gate = classifyMarginGate(margin, livePolicy);
    if (gate.partnerOverrideRequired && !dealPricing.partnerOverrideId) {
      res.status(409).json({
        error: gate.status === "red" ? "margin-lock-red" : "margin-lock-amber",
        hint: "Use POST /opportunities/:id/pricing/override (Partner) with rationale",
        marginPct: margin,
        twoPartnerRequired: gate.twoPartnerRequired,
      });
      return;
    }
    if (gate.twoPartnerRequired && !dealPricing.countersignPartnerId) {
      res.status(409).json({
        error: "margin-lock-countersign-required",
        hint: "Use POST /opportunities/:id/pricing/countersign (different Partner) with rationale",
        marginPct: margin,
        firstOverrideBy: dealPricing.partnerOverrideId,
        twoPartnerThresholdPct: livePolicy.twoPartnerThresholdPct,
      });
      return;
    }
  }
  // Render real DOCX + PDF artifacts via the proposal-docs pipeline and
  // persist their public URLs on the proposal row.
  // Task #297 — pass the org-scoped published Firm Profile so PDF/DOCX
  // exports use the *same* brand copy as the hosted HTML; otherwise
  // Company Profile in the export would silently fall back to the stub
  // and drift from what the recipient sees in Salon.
  const firmProfileForExport = await loadPublishedFirmProfile(proposal.orgId);
  const { pdfFile, docxFile } = await generateProposalDocs({
    proposalId: proposal.id,
    title: proposal.title,
    winThemes: (proposal.winThemes as string[] | null) ?? [],
    sections: sections.map((s) => ({
      sectionId: s.sectionId,
      name: s.name,
      ownerAgent: s.ownerAgent ?? "agent",
      status: s.status,
      content: s.content as string | null,
    })),
    pricingModel: proposal.pricingModel as ProposalDocsInputPricing,
    complianceMatrix: (proposal.complianceMatrix as Array<{
      rfpReqId: string; requirement: string; status: string; evidence: string;
    }> | null) ?? [],
    firmProfile: firmProfileForExport,
  });
  const pdfUrl = `/api/atelier/artifacts/${pdfFile}`;
  const docxUrl = `/api/atelier/artifacts/${docxFile}`;
  const [updated] = await db
    .update(atelierProposals)
    .set({ status: "sent", pdfUrl, docxUrl, updatedAt: new Date() })
    .where(eq(atelierProposals.id, proposal.id))
    .returning();
  await audit({
    entityType: "opportunity",
    entityId: proposal.opportunityId,
    actor: me,
    action: "proposal.send",
    payload: { proposalId: proposal.id, pdfUrl, docxUrl },
    summary: `${me.name} sent proposal "${proposal.title}" to client`,
  });
  res.json({ proposal: updated, pdfUrl, docxUrl });
});

// Static-ish file server for generated proposal artifacts. Files live in
// os.tmpdir()/atelier-artifacts and are name-prefixed with proposal-id, so
// access control falls back on the unguessable id (the same posture used
// for other generated artifacts in the workspace).
// @cli-skip: pending Task #340 read-parity migration
router.get("/artifacts/:filename", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const safe = req.params.filename.replace(/[^A-Za-z0-9._-]/g, "");
  if (!safe || safe !== req.params.filename) {
    res.status(400).json({ error: "bad-filename" });
    return;
  }
  // Resolve the file back to a proposal row using the persisted
  // pdf_url/docx_url columns, then enforce the same opportunity ACL
  // used everywhere else. Deny if the file is not registered to a
  // proposal — never serve unowned bytes.
  const expectedUrl = `/api/atelier/artifacts/${safe}`;
  const [owner] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(
      and(
        isNull(atelierProposals.deletedAt),
        or(eq(atelierProposals.pdfUrl, expectedUrl), eq(atelierProposals.docxUrl, expectedUrl)),
      ),
    );
  if (!owner) { res.status(404).json({ error: "not-found" }); return; }
  if (!(await ensureOppAccess(res, me, owner.opportunityId))) return;
  const full = join(ATELIER_ARTIFACT_DIR, safe);
  if (!existsSync(full)) { res.status(404).json({ error: "not-found" }); return; }
  const ct = safe.endsWith(".pdf") ? "application/pdf"
    : safe.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/octet-stream";
  res.setHeader("content-type", ct);
  res.setHeader("content-disposition", `inline; filename="${safe}"`);
  createReadStream(full).pipe(res);
});

type ProposalDocsInputPricing = Parameters<typeof generateProposalDocs>[0]["pricingModel"];

// ============================================================
// Task #297 — HTML preview + per-recipient watermarked share links.
// ============================================================

/**
 * Load the org-scoped published Firm Profile. Task #297 requires brand
 * copy to be canonical *per firm*; cross-tenant lookups are forbidden.
 */
async function loadPublishedFirmProfile(orgId: string): Promise<
  | typeof atelierFirmProfile.$inferSelect["payload"]
  | null
> {
  const [row] = await db
    .select({ payload: atelierFirmProfile.payload })
    .from(atelierFirmProfile)
    .where(
      and(
        eq(atelierFirmProfile.orgId, orgId),
        eq(atelierFirmProfile.status, "published"),
        isNull(atelierFirmProfile.deletedAt),
      ),
    )
    .orderBy(desc(atelierFirmProfile.publishedAt))
    .limit(1);
  return row?.payload ?? null;
}

async function buildProposalRenderInput(
  proposalId: string,
  recipient: typeof atelierProposalRecipients.$inferSelect | null = null,
) {
  const [proposal] = await db
    .select()
    .from(atelierProposals)
    .where(and(eq(atelierProposals.id, proposalId), isNull(atelierProposals.deletedAt)));
  if (!proposal) return null;
  const sections = await db
    .select()
    .from(atelierProposalSections)
    .where(and(eq(atelierProposalSections.proposalId, proposalId), isNull(atelierProposalSections.deletedAt)));
  const [pricing] = await db
    .select()
    .from(atelierDealPricings)
    .where(and(eq(atelierDealPricings.opportunityId, proposal.opportunityId), isNull(atelierDealPricings.deletedAt)))
    .orderBy(desc(atelierDealPricings.createdAt))
    .limit(1);
  const profile = await loadPublishedFirmProfile(proposal.orgId);
  const orderedSections = orderSectionsBySpine(
    sections.map((s) => ({
      sectionId: s.sectionId,
      name: s.name,
      ownerAgent: s.ownerAgent,
      status: s.status,
      content: s.content,
    })),
  );
  return {
    proposalId,
    title: proposal.title,
    winThemes: (proposal.winThemes as string[] | null) ?? [],
    sections: orderedSections,
    pricingModel: pricing
      ? {
          totalRevenueUsd: Number(pricing.computedPriceUsd ?? 0),
          totalCostUsd: Number(pricing.computedCostUsd ?? 0),
          marginPct: Number(pricing.computedMarginPct ?? 0),
          verdict: pricing.marginLockStatus ?? "n/a",
        }
      : null,
    complianceMatrix: (proposal.complianceMatrix as Array<{
      rfpReqId: string;
      requirement: string;
      status: string;
      evidence: string;
    }> | null) ?? [],
    firmProfile: profile,
    recipient: recipient
      ? {
          recipientName: recipient.recipientName,
          recipientEmail: recipient.recipientEmail,
          recipientOrg: recipient.recipientOrg,
        }
      : null,
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/proposals/:proposalId/preview-html", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [proposal] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(and(eq(atelierProposals.id, req.params.proposalId), isNull(atelierProposals.deletedAt)));
  if (!proposal) { res.status(404).json({ error: "not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  const data = await buildProposalRenderInput(req.params.proposalId, null);
  if (!data) { res.status(404).json({ error: "not-found" }); return; }
  const html = renderProposalHtml(data);
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.send(html);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/proposals/:proposalId/recipients", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [proposal] = await db
    .select({ opportunityId: atelierProposals.opportunityId, orgId: atelierProposals.orgId })
    .from(atelierProposals)
    .where(and(eq(atelierProposals.id, req.params.proposalId), isNull(atelierProposals.deletedAt)));
  if (!proposal) { res.status(404).json({ error: "not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  // Task #297 — recipient reads org-scoped to the proposal's org so a
  // mis-routed proposalId from another tenant cannot leak share links.
  const rows = await db
    .select()
    .from(atelierProposalRecipients)
    .where(and(
      eq(atelierProposalRecipients.proposalId, req.params.proposalId),
      eq(atelierProposalRecipients.orgId, proposal.orgId),
    ))
    .orderBy(desc(atelierProposalRecipients.createdAt));
  res.json({
    recipients: rows.map((r) => ({
      id: r.id,
      proposalId: r.proposalId,
      recipientName: r.recipientName,
      recipientEmail: r.recipientEmail,
      recipientOrg: r.recipientOrg,
      shareUrl: `/salon/proposal/${r.proposalId}/${r.token}`,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      openCount: r.openCount,
      lastOpenedAt: r.lastOpenedAt,
      createdAt: r.createdAt,
    })),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/proposals/:proposalId/recipients", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [proposal] = await db
    .select({ id: atelierProposals.id, opportunityId: atelierProposals.opportunityId, orgId: atelierProposals.orgId })
    .from(atelierProposals)
    .where(and(eq(atelierProposals.id, req.params.proposalId), isNull(atelierProposals.deletedAt)));
  if (!proposal) { res.status(404).json({ error: "not-found" }); return; }
  if (!(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  const body = req.body as {
    recipientName?: string;
    recipientEmail?: string;
    recipientOrg?: string;
    expiresInDays?: number;
  };
  if (!body.recipientName?.trim()) {
    res.status(400).json({ error: "recipient-name-required" });
    return;
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 86_400_000)
    : null;
  const id = rid("prc");
  // Task #297 — stamp the recipient row with the proposal's orgId so
  // tenant scoping is enforceable at the DB layer (no implicit "aico"
  // default).
  await db.insert(atelierProposalRecipients).values({
    id,
    orgId: proposal.orgId,
    proposalId: proposal.id,
    recipientName: body.recipientName.trim(),
    recipientEmail: body.recipientEmail ?? null,
    recipientOrg: body.recipientOrg ?? null,
    token,
    expiresAt,
    createdByUserId: me.id,
  });
  await audit({
    entityType: "proposal",
    entityId: proposal.id,
    actor: me,
    action: "proposal.recipient.created",
    payload: { recipientId: id, recipientName: body.recipientName.trim(), hasEmail: !!body.recipientEmail, expiresInDays: body.expiresInDays ?? null },
    summary: `Recipient share link created for ${body.recipientName.trim()}`,
  });
  res.status(201).json({
    recipient: {
      id,
      proposalId: proposal.id,
      recipientName: body.recipientName.trim(),
      recipientEmail: body.recipientEmail ?? null,
      recipientOrg: body.recipientOrg ?? null,
      shareUrl: `/salon/proposal/${proposal.id}/${token}`,
      expiresAt,
      openCount: 0,
    },
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/proposal-recipients/:recipientId/revoke", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Task #297 — revoke is org-scoped: an actor in tenant A cannot
  // revoke a share link minted by tenant B even with a guessed id.
  const [r] = await db
    .select()
    .from(atelierProposalRecipients)
    .where(and(
      eq(atelierProposalRecipients.id, req.params.recipientId),
      eq(atelierProposalRecipients.orgId, me.orgId),
    ));
  if (!r) { res.status(404).json({ error: "not-found" }); return; }
  const [proposal] = await db
    .select({ opportunityId: atelierProposals.opportunityId })
    .from(atelierProposals)
    .where(eq(atelierProposals.id, r.proposalId));
  if (!proposal || !(await ensureOppAccess(res, me, proposal.opportunityId))) return;
  await db
    .update(atelierProposalRecipients)
    .set({ revokedAt: new Date() })
    .where(eq(atelierProposalRecipients.id, r.id));
  await audit({
    entityType: "proposal",
    entityId: r.proposalId,
    actor: me,
    action: "proposal.recipient.revoked",
    payload: { recipientId: r.id, recipientName: r.recipientName },
    summary: `Revoked share link for ${r.recipientName}`,
  });
  res.json({ ok: true });
});

export { buildProposalRenderInput };
export default router;
