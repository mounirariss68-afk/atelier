/**
 * Atelier v3 — Skill graph + Skill Mapper (Task #256).
 *
 * Endpoints:
 *   GET  /roster/skill-graph/skills              — list taxonomy
 *   POST /roster/skill-graph/skills              — Partner/Operations only
 *   GET  /roster/skill-graph/search?q=...        — A + B (AND) | A or B (OR) grammar
 *   GET  /roster/people/:id/skills               — per-person grouped by source
 *   POST /roster/people/:id/skills               — add/upsert (self|partner_attested|evidence_atelier|certification)
 *   POST /roster/people/:id/skills/row/:rowId/verify
 *   POST /roster/people/:id/skills/row/:rowId/dismiss
 *   POST /roster/skill-graph/run                 — Skill Mapper, proposes agent_inferred rows
 *
 * Architectural rule: partner_firm_resource workers NEVER appear in
 * `atelier_person_skills`. The route layer rejects writes targeting that
 * worker type, the listing endpoint omits them, and the Skill Mapper
 * runner refuses to propose rows for them.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { canViewPersonViaRosterScope } from "./rosterRoutes";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirmResources,
  atelierEngagements,
  atelierEngagementAccess,
  atelierAccounts,
  atelierAssets,
  atelierDeliverables,
  atelierDeliverableVersions,
  atelierAuditEvents,
  atelierSkills,
  atelierPersonSkills,
  atelierAgentRuns,
  atelierAgents,
  atelierPersonDocuments,
} from "@workspace/db";

const router: IRouter = Router();

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

type WorkerType = "employee" | "contractor" | "partner_firm_resource";
type SkillSource =
  | "self"
  | "partner_attested"
  | "evidence_atelier"
  | "certification"
  | "agent_inferred";

const HUMAN_SOURCES: ReadonlyArray<SkillSource> = [
  "self",
  "partner_attested",
  "evidence_atelier",
  "certification",
];

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// Task #292 — 9-persona model. Skill verification = lead-approver tier
// (partner-tier + senior_manager + finance). Taxonomy editing is partner-tier
// + finance (no per-engagement leads).
function canVerify(me: typeof atelierUsers.$inferSelect): boolean {
  return (
    me.role === "founding_partner" ||
    me.role === "partner" ||
    me.role === "senior_manager" ||
    me.role === "finance"
  );
}

function canEditTaxonomy(me: typeof atelierUsers.$inferSelect): boolean {
  return (
    me.role === "founding_partner" ||
    me.role === "partner" ||
    me.role === "finance"
  );
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect | null;
  actorIsAgent?: boolean;
  agentId?: string;
  action: string;
  payload?: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: args.actorIsAgent ? "agent" : "human",
    actorId: args.actorIsAgent
      ? args.agentId ?? "ag_skill_mapper"
      : args.actor?.id ?? "system",
    actorLabel: args.actorIsAgent
      ? args.agentId === "ag_skill_mapper"
        ? "Skill Mapper"
        : "Atelier Agent"
      : args.actor?.name ?? "system",
    action: args.action,
    payload: args.payload ?? {},
    payloadSummary: args.summary,
  });
}

// Resolve a person id across employees/contractors. Returns null for
// partner-firm resources (architectural exclusion) and for unknown ids.
async function findPerson(
  id: string,
): Promise<{
  id: string;
  workerType: "employee" | "contractor";
  fullName: string;
} | null> {
  const [emp] = await db
    .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, id), isNull(atelierEmployees.deletedAt)));
  if (emp) return { ...emp, workerType: "employee" };
  const [ct] = await db
    .select({ id: atelierContractors.id, fullName: atelierContractors.fullName })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.id, id), isNull(atelierContractors.deletedAt)));
  if (ct) return { ...ct, workerType: "contractor" };
  return null;
}

async function isPartnerFirmResource(id: string): Promise<boolean> {
  const [pr] = await db
    .select({ id: atelierPartnerFirmResources.id })
    .from(atelierPartnerFirmResources)
    .where(
      and(
        eq(atelierPartnerFirmResources.id, id),
        isNull(atelierPartnerFirmResources.deletedAt),
      ),
    );
  return !!pr;
}

// Resolve linked atelier_users.id for an employee (used to map signal
// authorship — atelier_assets.createdByUserId etc. point at users, not
// employees). Returns null if no link.
async function userIdForEmployee(empId: string): Promise<string | null> {
  const [r] = await db
    .select({ userId: atelierEmployees.userId })
    .from(atelierEmployees)
    .where(eq(atelierEmployees.id, empId));
  return r?.userId ?? null;
}

// -----------------------------------------------------------------
// Wire shapes
// -----------------------------------------------------------------

interface SkillWire {
  id: string;
  slug: string;
  name: string;
  kind: string;
  parentId: string | null;
  description: string | null;
}

interface PersonSkillWire {
  id: string;
  personType: string;
  personId: string;
  skill: SkillWire;
  proficiency: number;
  source: SkillSource;
  evidenceArtifactIds: string[];
  evidenceSummary: string | null;
  confidence: number | null;
  status: string;
  verifiedByUserId: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  proposedByAgentId: string | null;
  proposedAt: string | null;
  createdAt: string;
}

function skillToWire(s: typeof atelierSkills.$inferSelect): SkillWire {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    parentId: s.parentId,
    description: s.description,
  };
}

// -----------------------------------------------------------------
// Taxonomy
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/skill-graph/skills", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierSkills)
    .where(isNull(atelierSkills.deletedAt));
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  res.json({ skills: rows.map(skillToWire) });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/skill-graph/skills", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canEditTaxonomy(me)) {
    res.status(403).json({ error: "taxonomy-edits-partner-or-operations-only" });
    return;
  }
  const body = req.body as {
    slug?: string;
    name?: string;
    kind?: string;
    parentId?: string | null;
    description?: string | null;
  };
  const slug = (body.slug ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim();
  const kind = (body.kind ?? "").trim();
  // Task #412 — `soft` kind added so the Team Composition dashboard can
  // cleanly split hard skills (tech / function / tool / industry) from
  // soft skills (collaboration, leadership, communication, ownership, …).
  const validKinds = new Set(["tech", "industry", "function", "language", "tool", "soft"]);
  if (!slug || !name || !validKinds.has(kind)) {
    res.status(400).json({ error: "invalid-skill-payload" });
    return;
  }
  const id = `sk_${slug.replace(/[^a-z0-9]+/g, "_").slice(0, 60)}`;
  const [existing] = await db
    .select()
    .from(atelierSkills)
    .where(and(eq(atelierSkills.slug, slug), isNull(atelierSkills.deletedAt)));
  if (existing) {
    res.json({ skill: skillToWire(existing) });
    return;
  }
  const [inserted] = await db
    .insert(atelierSkills)
    .values({
      id,
      slug,
      name,
      kind,
      parentId: body.parentId ?? null,
      description: body.description ?? null,
      createdByUserId: me.id,
    })
    .returning();
  await audit({
    entityType: "skill",
    entityId: id,
    actor: me,
    action: "skill.create",
    payload: { slug, name, kind },
    summary: `${me.name} added skill ${name} (${kind})`,
  });
  res.json({ skill: skillToWire(inserted!) });
});

// Task #116 — bulk read of every active person-skill row so the People
// Lens Composition dashboard can chart language / hard-skill / soft-skill
// coverage across the whole roster without N per-person requests. Only
// non-sensitive fields are exposed (no evidence, no verifier identity).
// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/skill-graph/person-skills", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select({ ps: atelierPersonSkills, sk: atelierSkills })
    .from(atelierPersonSkills)
    .innerJoin(atelierSkills, eq(atelierPersonSkills.skillId, atelierSkills.id))
    .where(
      and(
        eq(atelierPersonSkills.status, "active"),
        isNull(atelierPersonSkills.deletedAt),
        isNull(atelierSkills.deletedAt),
      ),
    );
  res.json({
    personSkills: rows.map(({ ps, sk }) => ({
      personType: ps.personType,
      personId: ps.personId,
      slug: sk.slug,
      name: sk.name,
      kind: sk.kind,
      proficiency: ps.proficiency,
    })),
  });
});

// -----------------------------------------------------------------
// Per-person skills
// -----------------------------------------------------------------

async function loadPersonSkills(
  personType: "employee" | "contractor",
  personId: string,
): Promise<PersonSkillWire[]> {
  const rows = await db
    .select({
      ps: atelierPersonSkills,
      sk: atelierSkills,
    })
    .from(atelierPersonSkills)
    .innerJoin(atelierSkills, eq(atelierPersonSkills.skillId, atelierSkills.id))
    .where(
      and(
        eq(atelierPersonSkills.personType, personType),
        eq(atelierPersonSkills.personId, personId),
        isNull(atelierPersonSkills.deletedAt),
      ),
    );

  const verifierIds = Array.from(
    new Set(
      rows
        .map((r) => r.ps.verifiedByUserId)
        .filter((x): x is string => !!x),
    ),
  );
  const userMap = new Map<string, string>();
  if (verifierIds.length) {
    const uRows = await db
      .select({ id: atelierUsers.id, name: atelierUsers.name })
      .from(atelierUsers)
      .where(inArray(atelierUsers.id, verifierIds));
    uRows.forEach((u) => userMap.set(u.id, u.name));
  }

  return rows.map(({ ps, sk }) => ({
    id: ps.id,
    personType: ps.personType,
    personId: ps.personId,
    skill: skillToWire(sk),
    proficiency: ps.proficiency,
    source: ps.source as SkillSource,
    evidenceArtifactIds: (ps.evidenceArtifactIds as string[]) ?? [],
    evidenceSummary: ps.evidenceSummary,
    confidence: ps.confidence,
    status: ps.status,
    verifiedByUserId: ps.verifiedByUserId,
    verifiedByName: ps.verifiedByUserId
      ? userMap.get(ps.verifiedByUserId) ?? null
      : null,
    verifiedAt: ps.verifiedAt?.toISOString() ?? null,
    proposedByAgentId: ps.proposedByAgentId,
    proposedAt: ps.proposedAt?.toISOString() ?? null,
    createdAt: ps.createdAt.toISOString(),
  }));
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/skills", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const personId = req.params.id as string;
  if (await isPartnerFirmResource(personId)) {
    res.status(403).json({
      error: "partner-firm-resources-excluded-from-skill-graph",
      message:
        "Partner-firm resources are not part of the firm's skill graph by design.",
    });
    return;
  }
  const person = await findPerson(personId);
  if (!person) {
    res.status(404).json({ error: "person-not-found" });
    return;
  }
  // Roster-scope model: full viewers see everyone; managers only their
  // reports tree; everyone else self-only.
  if (!(await canViewPersonViaRosterScope(me, person.id))) {
    res.status(403).json({ error: "roster-scope-forbidden" });
    return;
  }
  const skills = await loadPersonSkills(person.workerType, person.id);
  res.json({
    personId: person.id,
    workerType: person.workerType,
    skills,
    viewerCanVerify: canVerify(me),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/people/:id/skills", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const personId = req.params.id as string;
  if (await isPartnerFirmResource(personId)) {
    res.status(403).json({
      error: "partner-firm-resources-excluded-from-skill-graph",
    });
    return;
  }
  const person = await findPerson(personId);
  if (!person) {
    res.status(404).json({ error: "person-not-found" });
    return;
  }

  const body = req.body as {
    skillId?: string;
    proficiency?: number;
    source?: SkillSource;
    evidenceArtifactIds?: string[];
    evidenceSummary?: string | null;
  };
  const source = body.source ?? "self";
  if (!HUMAN_SOURCES.includes(source)) {
    res.status(400).json({ error: "invalid-source-for-manual-add" });
    return;
  }
  // Authorization: self-attestation requires the persona be linked to the
  // employee. partner_attested / evidence_atelier / certification require
  // verifier role.
  if (source === "self") {
    // Provenance rule: source=self may only be written by the subject
    // user themselves. Verifier roles must use partner_attested or
    // evidence_atelier when speaking on someone else's behalf.
    // Contractors have no userId link in the schema, so they cannot
    // self-attest under the current data model — verifier roles must
    // record their skills via partner_attested or evidence_atelier.
    const linkedUserId =
      person.workerType === "employee" ? await userIdForEmployee(person.id) : null;
    if (linkedUserId !== me.id) {
      res.status(403).json({ error: "self-attestation-must-be-by-the-person" });
      return;
    }
  } else if (!canVerify(me)) {
    res.status(403).json({ error: "attestation-requires-verifier-role" });
    return;
  }

  const skillId = (body.skillId ?? "").trim();
  if (!skillId) {
    res.status(400).json({ error: "skill-id-required" });
    return;
  }
  const [skill] = await db
    .select()
    .from(atelierSkills)
    .where(and(eq(atelierSkills.id, skillId), isNull(atelierSkills.deletedAt)));
  if (!skill) {
    res.status(404).json({ error: "skill-not-found" });
    return;
  }

  const proficiency = Math.max(
    1,
    Math.min(5, Math.round(Number(body.proficiency ?? 3))),
  );

  const id = rid("psk");
  const now = new Date();
  const verified = source !== "self" || canVerify(me);
  await db
    .insert(atelierPersonSkills)
    .values({
      id,
      personType: person.workerType,
      personId: person.id,
      skillId,
      proficiency,
      source,
      evidenceArtifactIds: body.evidenceArtifactIds ?? [],
      evidenceSummary: body.evidenceSummary ?? null,
      status: "active",
      verifiedByUserId: verified && source !== "self" ? me.id : null,
      verifiedAt: verified && source !== "self" ? now : null,
      createdByUserId: me.id,
    })
    .onConflictDoUpdate({
      target: [
        atelierPersonSkills.personType,
        atelierPersonSkills.personId,
        atelierPersonSkills.skillId,
        atelierPersonSkills.source,
      ],
      set: {
        proficiency,
        evidenceArtifactIds: body.evidenceArtifactIds ?? [],
        evidenceSummary: body.evidenceSummary ?? null,
        status: "active",
        // Refresh verifier metadata on re-attestation so provenance does
        // not go stale. Self-attestations stay unverified.
        verifiedByUserId: source !== "self" ? me.id : null,
        verifiedAt: source !== "self" ? now : null,
        updatedAt: now,
      },
    });

  await audit({
    entityType: "person_skill",
    entityId: `${person.workerType}:${person.id}:${skillId}`,
    actor: me,
    action: "skill.attest",
    payload: { source, proficiency, skillId },
    summary: `${me.name} attested ${skill.name} (${source}, p${proficiency}) on ${person.fullName}`,
  });

  const skills = await loadPersonSkills(person.workerType, person.id);
  res.json({ skills });
});

// Verify / dismiss target a SPECIFIC row by id and are restricted to
// `agent_inferred` rows — verify/dismiss is the per-row review flow for
// Skill Mapper proposals. Human-asserted rows are managed via the POST
// upsert endpoint above (or eventually a soft-delete) — they cannot be
// silently flipped by a verifier.
async function setRowStatus(
  req: Request,
  res: Response,
  newStatus: "active" | "dismissed",
  action: "verify" | "dismiss",
): Promise<void> {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canVerify(me)) {
    res.status(403).json({
      error: "verifier-role-required",
      message:
        "Only Engagement Lead, Operations, or Partner may verify or dismiss inferred skill rows.",
    });
    return;
  }
  const personId = req.params.id as string;
  const rowId = req.params.rowId as string;
  const person = await findPerson(personId);
  if (!person) {
    res.status(404).json({ error: "person-not-found" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierPersonSkills)
    .where(
      and(
        eq(atelierPersonSkills.id, rowId),
        eq(atelierPersonSkills.personType, person.workerType),
        eq(atelierPersonSkills.personId, person.id),
        isNull(atelierPersonSkills.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "person-skill-row-not-found" });
    return;
  }
  if (row.source !== "agent_inferred") {
    res.status(409).json({
      error: "verify-dismiss-applies-only-to-agent-inferred",
      message:
        "Verify and dismiss are the per-row review flow for Skill Mapper proposals. Human-asserted rows must be edited through the upsert endpoint.",
    });
    return;
  }
  const now = new Date();
  await db
    .update(atelierPersonSkills)
    .set({
      status: newStatus,
      verifiedByUserId: action === "verify" ? me.id : null,
      verifiedAt: action === "verify" ? now : null,
      updatedAt: now,
    })
    .where(eq(atelierPersonSkills.id, rowId));
  await audit({
    entityType: "person_skill",
    entityId: rowId,
    actor: me,
    action: `skill.${action}`,
    payload: { rowId, skillId: row.skillId },
    summary: `${me.name} ${action === "verify" ? "verified" : "dismissed"} inferred row ${rowId} (skill ${row.skillId}) on ${person.fullName}`,
  });
  const skills = await loadPersonSkills(person.workerType, person.id);
  res.json({ skills });
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/people/:id/skills/row/:rowId/verify", (req, res) =>
  setRowStatus(req, res, "active", "verify"),
);
// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/people/:id/skills/row/:rowId/dismiss", (req, res) =>
  setRowStatus(req, res, "dismissed", "dismiss"),
);

// -----------------------------------------------------------------
// Search — A + B (AND), A or B (OR). Returns ranked people with evidence.
// -----------------------------------------------------------------

interface SearchTermMatch {
  term: string;
  matchedSkill: SkillWire;
  proficiency: number;
  source: SkillSource;
  status: string;
}

interface SearchResultWire {
  personType: "employee" | "contractor";
  personId: string;
  fullName: string;
  title: string | null;
  role: string | null;
  score: number;
  matchedTerms: SearchTermMatch[];
  unmatchedTerms: string[];
  evidence: Array<{ kind: string; id: string; label: string; href: string }>;
}

function parseQuery(q: string): { terms: string[]; mode: "AND" | "OR" } {
  const cleaned = q.trim();
  if (!cleaned) return { terms: [], mode: "AND" };
  // OR has lower precedence than AND in this small grammar; pick whichever
  // operator appears in the query. Mixed queries default to AND.
  if (/\s+or\s+/i.test(cleaned) && !/\+/.test(cleaned)) {
    return {
      terms: cleaned
        .split(/\s+or\s+/i)
        .map((t) => t.trim())
        .filter(Boolean),
      mode: "OR",
    };
  }
  return {
    terms: cleaned
      .split("+")
      .map((t) => t.trim())
      .filter(Boolean),
    mode: "AND",
  };
}

function termMatchesSkill(term: string, sk: SkillWire): boolean {
  const t = term.toLowerCase();
  return (
    sk.name.toLowerCase().includes(t) ||
    sk.slug.toLowerCase().includes(t) ||
    (sk.description ?? "").toLowerCase().includes(t)
  );
}

function rowScore(
  source: SkillSource,
  proficiency: number,
  status: string,
  verifiedAt: Date | null,
): number {
  if (status !== "active") return 0;
  // Verified human sources rank well above agent_inferred. A verified
  // agent_inferred row earns a small bump (+1) so reviewer attention has
  // observable effect on ranking, but it still sits below any human source.
  const sourceWeight: Record<SkillSource, number> = {
    certification: 5,
    partner_attested: 4,
    evidence_atelier: 3,
    self: 2,
    agent_inferred: 1,
  };
  const verifiedBump = source === "agent_inferred" && verifiedAt ? 1 : 0;
  return (sourceWeight[source] + verifiedBump) * proficiency;
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/skill-graph/search", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const q = String(req.query.q ?? "");
  const { terms, mode } = parseQuery(q);
  if (terms.length === 0) {
    res.json({ query: q, mode, results: [] });
    return;
  }

  const allSkills = await db
    .select()
    .from(atelierSkills)
    .where(isNull(atelierSkills.deletedAt));

  // For each term find matching skill ids.
  const termSkillIds = terms.map((t) => ({
    term: t,
    skillIds: allSkills.filter((s) => termMatchesSkill(t, s)).map((s) => s.id),
  }));
  const matchedSkillIds = Array.from(
    new Set(termSkillIds.flatMap((x) => x.skillIds)),
  );
  if (matchedSkillIds.length === 0) {
    res.json({ query: q, mode, results: [], note: "no-skills-match-terms" });
    return;
  }

  const psRows = await db
    .select({ ps: atelierPersonSkills, sk: atelierSkills })
    .from(atelierPersonSkills)
    .innerJoin(atelierSkills, eq(atelierPersonSkills.skillId, atelierSkills.id))
    .where(
      and(
        inArray(atelierPersonSkills.skillId, matchedSkillIds),
        eq(atelierPersonSkills.status, "active"),
        isNull(atelierPersonSkills.deletedAt),
      ),
    );

  // Group by person.
  type Bucket = {
    personType: "employee" | "contractor";
    personId: string;
    matched: Map<string, SearchTermMatch & { verifiedAt: Date | null }>;
    score: number;
    evidenceIds: Set<string>;
  };
  const byPerson = new Map<string, Bucket>();
  for (const { ps, sk } of psRows) {
    if (ps.personType !== "employee" && ps.personType !== "contractor")
      continue; // safety net; partner_firm_resource never inserted
    const key = `${ps.personType}:${ps.personId}`;
    let bucket = byPerson.get(key);
    if (!bucket) {
      bucket = {
        personType: ps.personType as "employee" | "contractor",
        personId: ps.personId,
        matched: new Map(),
        score: 0,
        evidenceIds: new Set(),
      };
      byPerson.set(key, bucket);
    }
    for (const { term, skillIds } of termSkillIds) {
      if (!skillIds.includes(ps.skillId)) continue;
      const candidate = {
        term,
        matchedSkill: skillToWire(sk),
        proficiency: ps.proficiency,
        source: ps.source as SkillSource,
        status: ps.status,
        verifiedAt: ps.verifiedAt ?? null,
      };
      const prev = bucket.matched.get(term);
      const candScore = rowScore(
        candidate.source,
        candidate.proficiency,
        candidate.status,
        candidate.verifiedAt,
      );
      const prevScore = prev
        ? rowScore(prev.source, prev.proficiency, prev.status, prev.verifiedAt)
        : -1;
      if (candScore > prevScore) bucket.matched.set(term, candidate);
    }
    for (const id of (ps.evidenceArtifactIds as string[]) ?? []) {
      bucket.evidenceIds.add(id);
    }
  }

  // Apply AND/OR filter and compute scores.
  const candidates: Array<Bucket & { unmatched: string[] }> = [];
  for (const bucket of byPerson.values()) {
    const matchedTerms = Array.from(bucket.matched.keys());
    if (mode === "AND" && matchedTerms.length < terms.length) continue;
    if (mode === "OR" && matchedTerms.length === 0) continue;
    let score = 0;
    for (const m of bucket.matched.values()) {
      score += rowScore(m.source, m.proficiency, m.status, m.verifiedAt);
    }
    bucket.score = score;
    candidates.push({
      ...bucket,
      unmatched: terms.filter((t) => !bucket.matched.has(t)),
    });
  }

  // Hydrate person + evidence labels.
  const empIds = candidates.filter((c) => c.personType === "employee").map((c) => c.personId);
  const ctIds = candidates.filter((c) => c.personType === "contractor").map((c) => c.personId);
  const empRows = empIds.length
    ? await db
        .select()
        .from(atelierEmployees)
        .where(inArray(atelierEmployees.id, empIds))
    : [];
  const ctRows = ctIds.length
    ? await db
        .select()
        .from(atelierContractors)
        .where(inArray(atelierContractors.id, ctIds))
    : [];
  const empMap = new Map(empRows.map((r) => [r.id, r]));
  const ctMap = new Map(ctRows.map((r) => [r.id, r]));

  // Resolve evidence ids → labels (assets / deliverables / engagements).
  const allEvidenceIds = Array.from(
    new Set(candidates.flatMap((c) => Array.from(c.evidenceIds))),
  );
  const evidenceLabels = new Map<
    string,
    { kind: string; id: string; label: string; href: string }
  >();
  if (allEvidenceIds.length) {
    const [aRows, dRows, eRows] = await Promise.all([
      db
        .select({ id: atelierAssets.id, title: atelierAssets.title })
        .from(atelierAssets)
        .where(inArray(atelierAssets.id, allEvidenceIds)),
      db
        .select({
          id: atelierDeliverables.id,
          name: atelierDeliverables.name,
          engagementId: atelierDeliverables.engagementId,
        })
        .from(atelierDeliverables)
        .where(inArray(atelierDeliverables.id, allEvidenceIds)),
      db
        .select({ id: atelierEngagements.id, name: atelierEngagements.name })
        .from(atelierEngagements)
        .where(inArray(atelierEngagements.id, allEvidenceIds)),
    ]);
    aRows.forEach((r) =>
      evidenceLabels.set(r.id, {
        kind: "asset",
        id: r.id,
        label: r.title,
        href: `/atelier/assets?focus=${encodeURIComponent(r.id)}`,
      }),
    );
    dRows.forEach((r) =>
      evidenceLabels.set(r.id, {
        kind: "deliverable",
        id: r.id,
        label: r.name,
        href: `/engagements/${encodeURIComponent(r.engagementId)}/deliverables/${encodeURIComponent(r.id)}`,
      }),
    );
    eRows.forEach((r) =>
      evidenceLabels.set(r.id, {
        kind: "engagement",
        id: r.id,
        label: r.name,
        href: `/engagements/${encodeURIComponent(r.id)}`,
      }),
    );
  }

  const results: SearchResultWire[] = candidates
    .map((c) => {
      const row =
        c.personType === "employee" ? empMap.get(c.personId) : ctMap.get(c.personId);
      if (!row) return null;
      return {
        personType: c.personType,
        personId: c.personId,
        fullName: row.fullName,
        title: ("title" in row ? (row.title as string | null) : null) ?? null,
        role: ("role" in row ? (row.role as string | null) : null) ?? null,
        score: c.score,
        matchedTerms: Array.from(c.matched.values()).map(
          ({ verifiedAt: _v, ...m }): SearchTermMatch => m,
        ),
        unmatchedTerms: c.unmatched,
        evidence: Array.from(c.evidenceIds)
          .map((id) => evidenceLabels.get(id))
          .filter(
            (x): x is { kind: string; id: string; label: string; href: string } =>
              !!x,
          ),
      } satisfies SearchResultWire;
    })
    .filter((r): r is SearchResultWire => !!r)
    .sort((a, b) => b.score - a.score);

  res.json({ query: q, mode, terms, results });
});

// -----------------------------------------------------------------
// Skill Mapper runner — proposes agent_inferred rows from real signals.
// Never auto-verifies. Hard exclusion of partner_firm_resource workers.
// -----------------------------------------------------------------

interface MapperProposal {
  personType: "employee" | "contractor";
  personId: string;
  skillId: string;
  proficiency: number;
  confidence: number;
  evidenceArtifactIds: string[];
  evidenceSummary: string;
}

async function runSkillMapper(
  triggeredBy: typeof atelierUsers.$inferSelect | null,
): Promise<{
  proposalsConsidered: number;
  proposalsInserted: number;
  proposalsSkipped: number;
}> {
  // Load employees with their linked user id.
  const employees = await db
    .select({
      id: atelierEmployees.id,
      userId: atelierEmployees.userId,
    })
    .from(atelierEmployees)
    .where(isNull(atelierEmployees.deletedAt));
  const userIdToEmpId = new Map<string, string>();
  for (const e of employees) {
    if (e.userId) userIdToEmpId.set(e.userId, e.id);
  }

  const skills = await db
    .select()
    .from(atelierSkills)
    .where(isNull(atelierSkills.deletedAt));
  // Existing rows so we don't re-propose what's already in (any source).
  const existingRows = await db
    .select({
      personType: atelierPersonSkills.personType,
      personId: atelierPersonSkills.personId,
      skillId: atelierPersonSkills.skillId,
      source: atelierPersonSkills.source,
      status: atelierPersonSkills.status,
    })
    .from(atelierPersonSkills)
    .where(isNull(atelierPersonSkills.deletedAt));
  const existingKey = (
    pt: string,
    pid: string,
    skid: string,
    src: string,
  ) => `${pt}|${pid}|${skid}|${src}`;
  const existing = new Set(
    existingRows.map((r) =>
      existingKey(r.personType, r.personId, r.skillId, r.source),
    ),
  );
  // Also: if the same (person, skill) already has a stronger source row
  // (anything not agent_inferred) OR a dismissed agent_inferred row, skip.
  const blockKey = (pt: string, pid: string, skid: string) =>
    `${pt}|${pid}|${skid}`;
  const blocked = new Set<string>();
  for (const r of existingRows) {
    if (r.source !== "agent_inferred") blocked.add(blockKey(r.personType, r.personId, r.skillId));
    if (r.source === "agent_inferred" && r.status === "dismissed")
      blocked.add(blockKey(r.personType, r.personId, r.skillId));
  }

  // Helper: record a candidate signal (per person, per skill) with a weight.
  type SignalKey = string; // `${pt}|${pid}|${skid}`
  const signals = new Map<
    SignalKey,
    {
      personType: "employee" | "contractor";
      personId: string;
      skillId: string;
      weight: number;
      evidenceIds: Set<string>;
      reasons: string[];
    }
  >();
  function record(
    pt: "employee" | "contractor",
    pid: string,
    skillId: string,
    weight: number,
    evidenceId: string | null,
    reason: string,
  ): void {
    const k = `${pt}|${pid}|${skillId}`;
    let s = signals.get(k);
    if (!s) {
      s = {
        personType: pt,
        personId: pid,
        skillId,
        weight: 0,
        evidenceIds: new Set(),
        reasons: [],
      };
      signals.set(k, s);
    }
    s.weight += weight;
    if (evidenceId) s.evidenceIds.add(evidenceId);
    s.reasons.push(reason);
  }

  // Match a skill against a free-text haystack.
  function skillsInText(text: string): typeof atelierSkills.$inferSelect[] {
    const lc = text.toLowerCase();
    return skills.filter(
      (s) =>
        lc.includes(s.name.toLowerCase()) || lc.includes(s.slug.replace(/_/g, " ")),
    );
  }

  // -------- Signal 1: deliverable authorship --------
  const dvRows = await db
    .select({
      versionId: atelierDeliverableVersions.id,
      deliverableId: atelierDeliverableVersions.deliverableId,
      createdByUserId: atelierDeliverableVersions.createdByUserId,
      body: atelierDeliverableVersions.body,
    })
    .from(atelierDeliverableVersions)
    .where(isNull(atelierDeliverableVersions.deletedAt));
  for (const v of dvRows) {
    if (!v.createdByUserId) continue;
    const empId = userIdToEmpId.get(v.createdByUserId);
    if (!empId) continue;
    const matched = skillsInText(v.body ?? "");
    for (const sk of matched) {
      record(
        "employee",
        empId,
        sk.id,
        2,
        v.deliverableId,
        `Authored deliverable version mentioning ${sk.name}`,
      );
    }
  }

  // -------- Signal 2: atelier asset authorship + promotion --------
  const aRows = await db
    .select()
    .from(atelierAssets)
    .where(isNull(atelierAssets.deletedAt));
  for (const a of aRows) {
    const haystack = `${a.title} ${a.abstract ?? ""} ${(a.tags as string[] | null)?.join(" ") ?? ""}`;
    const matched = skillsInText(haystack);
    if (matched.length === 0) continue;
    for (const sk of matched) {
      if (a.createdByUserId) {
        const empId = userIdToEmpId.get(a.createdByUserId);
        if (empId)
          record(
            "employee",
            empId,
            sk.id,
            3,
            a.id,
            `Created Atelier asset "${a.title}"`,
          );
      }
      if (a.promotedByUserId && a.promotedByUserId !== a.createdByUserId) {
        const empId = userIdToEmpId.get(a.promotedByUserId);
        if (empId)
          record(
            "employee",
            empId,
            sk.id,
            1,
            a.id,
            `Promoted Atelier asset "${a.title}"`,
          );
      }
    }
  }

  // -------- Signal 3: engagement leadership + participation --------
  const engRows = await db
    .select({
      id: atelierEngagements.id,
      name: atelierEngagements.name,
      accountId: atelierEngagements.accountId,
      partnerOwnerId: atelierEngagements.partnerOwnerId,
      engagementLeadId: atelierEngagements.engagementLeadId,
    })
    .from(atelierEngagements)
    .where(isNull(atelierEngagements.deletedAt));
  const accountIds = Array.from(new Set(engRows.map((e) => e.accountId)));
  const acctRows = accountIds.length
    ? await db
        .select()
        .from(atelierAccounts)
        .where(inArray(atelierAccounts.id, accountIds))
    : [];
  const acctMap = new Map(acctRows.map((a) => [a.id, a]));
  // Participation grants — anyone allocated to the engagement absorbs the
  // industry/function signal at a lower weight than the owner/lead.
  const accessRows = engRows.length
    ? await db
        .select()
        .from(atelierEngagementAccess)
        .where(
          and(
            inArray(
              atelierEngagementAccess.engagementId,
              engRows.map((e) => e.id),
            ),
            eq(atelierEngagementAccess.status, "active"),
          ),
        )
    : [];
  const accessByEng = new Map<string, typeof accessRows>();
  for (const a of accessRows) {
    const arr = accessByEng.get(a.engagementId) ?? [];
    arr.push(a);
    accessByEng.set(a.engagementId, arr);
  }
  for (const e of engRows) {
    const acct = acctMap.get(e.accountId);
    if (!acct) continue;
    const text = `${acct.sector} ${acct.country} ${acct.name}`;
    const matched = skillsInText(text).filter(
      (s) => s.kind === "industry" || s.kind === "function",
    );
    if (matched.length === 0) continue;
    // Owner/lead: weight 2.
    for (const userId of [e.partnerOwnerId, e.engagementLeadId]) {
      if (!userId) continue;
      const empId = userIdToEmpId.get(userId);
      if (!empId) continue;
      for (const sk of matched) {
        record(
          "employee",
          empId,
          sk.id,
          2,
          e.id,
          `Owned/led engagement ${e.name} (${acct.name})`,
        );
      }
    }
    // Participants on engagement_access (member/reviewer/contractor): weight 1.
    for (const grant of accessByEng.get(e.id) ?? []) {
      const empId = userIdToEmpId.get(grant.userId);
      if (!empId) continue; // Only employees here; partner-firm ids not in map.
      for (const sk of matched) {
        record(
          "employee",
          empId,
          sk.id,
          1,
          e.id,
          `Allocated ${grant.allocationPct ?? 0}% on ${e.name} as ${grant.roleOnEngagement}`,
        );
      }
    }
  }

  // -------- Signal 4: certifications uploaded as person_documents --------
  const certRows = await db
    .select()
    .from(atelierPersonDocuments)
    .where(
      and(
        eq(atelierPersonDocuments.kind, "cert"),
        isNull(atelierPersonDocuments.deletedAt),
      ),
    );
  for (const c of certRows) {
    if (c.personType !== "employee" && c.personType !== "contractor") continue;
    const matched = skillsInText(c.title);
    for (const sk of matched) {
      record(
        c.personType,
        c.personId,
        sk.id,
        3,
        c.id,
        `Certification on file: ${c.title}`,
      );
    }
  }

  // -------- Signal 5: atelier_agent_runs provenance --------
  // If a person triggered a run on a tool-bearing agent, propose tech/tool
  // skills mentioned in the agent's `tools` registry text.
  const agentRunRows = await db
    .select({
      runId: atelierAgentRuns.id,
      agentId: atelierAgentRuns.agentId,
      triggeredByUserId: atelierAgentRuns.triggeredByUserId,
    })
    .from(atelierAgentRuns)
    .where(isNull(atelierAgentRuns.deletedAt));
  const agentIds = Array.from(new Set(agentRunRows.map((r) => r.agentId)));
  const agentRows = agentIds.length
    ? await db
        .select({
          id: atelierAgents.id,
          name: atelierAgents.name,
          tools: atelierAgents.tools,
          purpose: atelierAgents.purpose,
        })
        .from(atelierAgents)
        .where(inArray(atelierAgents.id, agentIds))
    : [];
  const agentMap = new Map(agentRows.map((a) => [a.id, a]));
  for (const r of agentRunRows) {
    if (!r.triggeredByUserId) continue;
    const empId = userIdToEmpId.get(r.triggeredByUserId);
    if (!empId) continue;
    const agent = agentMap.get(r.agentId);
    if (!agent) continue;
    const haystack = `${agent.name} ${agent.purpose ?? ""} ${((agent.tools as string[] | null) ?? []).join(" ")}`;
    const matched = skillsInText(haystack).filter(
      (s) => s.kind === "tech" || s.kind === "tool",
    );
    for (const sk of matched) {
      record(
        "employee",
        empId,
        sk.id,
        1,
        r.runId,
        `Triggered ${agent.name} agent run`,
      );
    }
  }

  // Convert signals → proposals, skipping blocked / existing rows and
  // partner-firm resources (which never appear here anyway).
  const proposals: MapperProposal[] = [];
  let skipped = 0;
  for (const sig of signals.values()) {
    if (blocked.has(blockKey(sig.personType, sig.personId, sig.skillId))) {
      skipped++;
      continue;
    }
    if (
      existing.has(
        existingKey(sig.personType, sig.personId, sig.skillId, "agent_inferred"),
      )
    ) {
      skipped++;
      continue;
    }
    // Map weight → proficiency (1..4 — never 5 from inference) + confidence.
    const proficiency = Math.min(4, Math.max(2, Math.round(sig.weight / 2)));
    const confidence = Math.min(0.85, 0.4 + sig.weight * 0.07);
    proposals.push({
      personType: sig.personType,
      personId: sig.personId,
      skillId: sig.skillId,
      proficiency,
      confidence,
      evidenceArtifactIds: Array.from(sig.evidenceIds),
      evidenceSummary: sig.reasons.slice(0, 3).join(" · "),
    });
  }

  let inserted = 0;
  if (proposals.length) {
    const now = new Date();
    const rowsToInsert = proposals.map((p) => ({
      id: rid("psk"),
      personType: p.personType,
      personId: p.personId,
      skillId: p.skillId,
      proficiency: p.proficiency,
      source: "agent_inferred" as const,
      evidenceArtifactIds: p.evidenceArtifactIds,
      evidenceSummary: p.evidenceSummary,
      confidence: p.confidence,
      status: "active",
      proposedByAgentId: "ag_skill_mapper",
      proposedAt: now,
      createdByUserId: triggeredBy?.id ?? null,
    }));
    const out = await db
      .insert(atelierPersonSkills)
      .values(rowsToInsert)
      .onConflictDoNothing()
      .returning({ id: atelierPersonSkills.id });
    inserted = out.length;
  }

  await audit({
    entityType: "skill_graph",
    entityId: "global",
    actor: triggeredBy,
    actorIsAgent: true,
    agentId: "ag_skill_mapper",
    action: "skill_mapper.run",
    payload: {
      proposalsConsidered: proposals.length,
      proposalsInserted: inserted,
      proposalsSkipped: skipped,
    },
    summary: `Skill Mapper proposed ${inserted} new agent_inferred row(s); ${skipped} skipped (already known or dismissed)`,
  });

  return {
    proposalsConsidered: proposals.length,
    proposalsInserted: inserted,
    proposalsSkipped: skipped,
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/skill-graph/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canVerify(me)) {
    res.status(403).json({
      error: "skill-mapper-trigger-restricted",
      message: "Only Engagement Lead, Operations, or Partner can trigger the Skill Mapper.",
    });
    return;
  }
  const result = await runSkillMapper(me);
  res.json(result);
});

export default router;
