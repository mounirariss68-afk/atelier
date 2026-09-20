/**
 * Task #526 — Alliance Partner Evaluation Framework agents.
 *
 * Two web-search research agents over PARTNER FIRMS (not client accounts):
 *
 *  - **Alliance Cartographer** — runs the framework evaluation (archetype,
 *    Stage 1 nine-dimension fit scorecard, Stage 2 due-diligence gates,
 *    Stage 8 risk register, Stage 9 phasing). Scores come from the model;
 *    the WEIGHTS, WEIGHTED TOTAL, VERDICT and WATCHOUTS are computed here in
 *    code and can never be hallucinated.
 *  - **Alliance Executive Mapper** — people-only sweep of the 9
 *    alliance-critical roles, PDL cross-checked, deterministically guarded
 *    (see alliance-roles.ts).
 *
 * Both agents are proposals-only: every finding lands in the firm's
 * `pendingUpdates` queue for partner review — nothing is written directly to
 * the evaluation fields.
 */

import { db, atelierPartnerFirms, atelierAuditEvents } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadEffectivePrompt } from "./loader.js";
import {
  startRun,
  progressRun,
  completeRun,
  failRun,
  callResearchJson,
  materiallyEqual,
  stableStringify,
  normaliseLinkedinProfileUrl,
  guardCartographerEntityScope,
} from "./runner.js";
import { findPersonMatch, findPersonMatchLoose, dedupeSweepRoster, richerPersonName } from "./person-name.js";
import { isPdlConfigured, fetchPdlExecutivesForCompany } from "./pdl.js";
import {
  guardAllianceMapperRoles,
  classifyAllianceRole,
  type AllianceRoleId,
  type AllianceRoleCoverageEntry,
  type AllianceGuardDrop,
} from "./alliance-roles.js";

type PartnerFirmRow = typeof atelierPartnerFirms.$inferSelect;
export type PendingPartnerUpdate = PartnerFirmRow["pendingUpdates"][number];

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Framework constants — single source of truth for weights, gates, archetypes.
// ---------------------------------------------------------------------------

export const ALLIANCE_ARCHETYPES = [
  "reference_brand",
  "delivery_backbone",
  "platform_capability",
  "niche_subcontractor",
  "market_access_jv",
  "competitor_monitor",
] as const;
export type AllianceArchetype = (typeof ALLIANCE_ARCHETYPES)[number];

export const ALLIANCE_FIT_DIMENSIONS: ReadonlyArray<{
  id: string;
  label: string;
  weight: number;
}> = [
  { id: "service_alignment", label: "Service alignment", weight: 0.2 },
  { id: "industry_coverage", label: "Industry coverage", weight: 0.15 },
  { id: "delivery_economics", label: "Delivery economics", weight: 0.15 },
  { id: "references", label: "References", weight: 0.1 },
  { id: "footprint", label: "Regional footprint (additive)", weight: 0.1 },
  { id: "ai_differentiation", label: "AI differentiation", weight: 0.1 },
  { id: "relationship_fit", label: "Relationship fit", weight: 0.1 },
  { id: "portfolio_complementarity", label: "Portfolio complementarity", weight: 0.05 },
  { id: "region_relevance", label: "Region relevance", weight: 0.05 },
];

export const ALLIANCE_DD_GATES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "legal_standing", label: "Legal standing" },
  { id: "financial_viability", label: "Financial viability" },
  { id: "delivery_track_record", label: "Delivery track record" },
  { id: "security_posture", label: "Security posture" },
  { id: "ownership_transparency", label: "Ownership transparency" },
  { id: "litigation_sanctions", label: "Litigation & sanctions" },
  { id: "insurance_liability", label: "Insurance & liability" },
];

type Evidence = "evidenced" | "inferred" | "unverified";
type GateStatus = "pass" | "conditional" | "fail" | "to_verify";

const EVIDENCE_SET = new Set<Evidence>(["evidenced", "inferred", "unverified"]);
const GATE_STATUS_SET = new Set<GateStatus>(["pass", "conditional", "fail", "to_verify"]);
/** Worst-first ordering for the code-computed overall DD verdict. */
const GATE_SEVERITY: GateStatus[] = ["fail", "conditional", "to_verify", "pass"];

export function fitVerdict(weightedTotal: number): "proceed" | "limited" | "decline" {
  if (weightedTotal >= 3.5) return "proceed";
  if (weightedTotal >= 2.5) return "limited";
  return "decline";
}

/**
 * Shared framework computation — the ONLY place weighted totals, verdicts
 * and watch-outs are derived from dimension scores. Used by the Cartographer
 * output normaliser and by the manual dimension-adjust endpoint (Task #530),
 * so both stay consistent with the framework weights/thresholds.
 */
export function computeFitTotals(
  dimensions: ReadonlyArray<{ label: string; weight: number; score: number }>,
): { weightedTotal: number; verdict: "proceed" | "limited" | "decline"; watchouts: string[] } {
  const weightedTotal =
    Math.round(dimensions.reduce((s, d) => s + d.score * d.weight, 0) * 100) / 100;
  const watchouts = [...dimensions]
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .slice(0, 2)
    .map((d) => d.label);
  return { weightedTotal, verdict: fitVerdict(weightedTotal), watchouts };
}

// ---------------------------------------------------------------------------
// Alliance Cartographer
// ---------------------------------------------------------------------------

export interface AllianceCartographerOutput {
  firm: {
    canonicalName: string | null;
    website: string | null;
    country: string | null;
    countryCode: string | null;
    hqCity: string | null;
    kind: string | null;
    speciality: string | null;
    summary: string | null;
    employeeCount: number | null;
    ownership: string | null;
  };
  archetype: { id: AllianceArchetype | null; rationale: string | null; evidence: Evidence };
  recommendedTier: { tier: "strategic" | "preferred" | "transactional" | null; rationale: string | null };
  /** Code-completed: exactly one entry per framework dimension, weights attached. */
  fitScorecard: NonNullable<PartnerFirmRow["fitScorecard"]>;
  /** Code-completed: exactly one entry per DD gate, overall = worst. */
  dueDiligence: NonNullable<PartnerFirmRow["dueDiligence"]>;
  riskRegister: PartnerFirmRow["riskRegister"];
  phasing: NonNullable<PartnerFirmRow["phasing"]> | null;
  capabilities: Record<string, number>;
  /** Task #871 — narrative capability profile (summary + domain map). */
  capabilityProfile: NonNullable<PartnerFirmRow["capabilityProfile"]> | null;
  sourceSignals: Array<{
    kind: string;
    title: string;
    url: string;
    summary?: string;
    confidence: "green" | "amber" | "red";
    uncorroborated?: boolean;
  }>;
  openQuestions: string[];
}

const clampScore = (n: unknown): number =>
  Math.min(5, Math.max(1, Math.round(Number(n) || 1)));

function normaliseEvidence(v: unknown): Evidence {
  return EVIDENCE_SET.has(v as Evidence) ? (v as Evidence) : "unverified";
}

function normaliseUrls(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 6)
    : [];
}

export async function runAllianceCartographer(args: {
  firmId: string;
  firmName: string;
  firmCountry?: string | null;
  firmSpeciality?: string | null;
  firmKind?: string | null;
  contextNotes?: string | null;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: AllianceCartographerOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "alliance_cartographer",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "partner_firm",
    targetId: args.firmId,
    targetLabel: args.firmName,
    inputs: { firmName: args.firmName, firmCountry: args.firmCountry ?? null },
    actorLabel: args.actorLabel,
  });
  try {
    const system = await loadEffectivePrompt("alliance_cartographer", 1);
    await progressRun(runId, 15, "Researching the partner firm");
    const { value, costUsd, citationUrls, potentiallyStale: allianceStale } =
      await callResearchJson<Record<string, unknown>>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          firm_name: args.firmName,
          firm_country: args.firmCountry ?? null,
          firm_speciality: args.firmSpeciality ?? null,
          firm_kind: args.firmKind ?? null,
          context_notes: args.contextNotes ?? null,
        }),
        {
          progressRunId: runId,
          // Task #771 — split catch-all news query; dedicated recency pass.
          entityLabel: args.firmName,
          researchQueries: [
            `${args.firmName}${args.firmCountry ? ` (${args.firmCountry})` : ""} company profile: what they do${args.firmSpeciality ? ` (${args.firmSpeciality})` : ""}, size, ownership, headquarters, website`,
            `${args.firmName} partnerships, alliances, technology vendor certifications and notable clients`,
          ],
          recencyQueries: [
            `${args.firmName} recent news, funding rounds, expansion and leadership announcements (last 3 months)`,
          ],
        },
      );
    await progressRun(runId, 92, "Scoring the fit framework", {
      name: "alliance_cart.synth",
      durationMs: Date.now() - t0,
    });

    const raw = (value ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();

    // --- firm block ---
    const rf = (raw.firm ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max = 600): string | null =>
      typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;
    const firm: AllianceCartographerOutput["firm"] = {
      canonicalName: str(rf.canonicalName, 200),
      website: str(rf.website, 300),
      country: str(rf.country, 80),
      countryCode: str(rf.countryCode, 2)?.toUpperCase() ?? null,
      hqCity: str(rf.hqCity, 80),
      kind: str(rf.kind, 80),
      speciality: str(rf.speciality, 300),
      summary: str(rf.summary, 600),
      employeeCount:
        typeof rf.employeeCount === "number" && Number.isFinite(rf.employeeCount) && rf.employeeCount > 0
          ? Math.round(rf.employeeCount)
          : null,
      ownership: str(rf.ownership, 200),
    };

    // --- archetype ---
    const ra = (raw.archetype ?? {}) as Record<string, unknown>;
    const archetype: AllianceCartographerOutput["archetype"] = {
      id: ALLIANCE_ARCHETYPES.includes(ra.id as AllianceArchetype)
        ? (ra.id as AllianceArchetype)
        : null,
      rationale: str(ra.rationale, 300),
      evidence: normaliseEvidence(ra.evidence),
    };

    // --- recommended tier ---
    const rt = (raw.recommendedTier ?? {}) as Record<string, unknown>;
    const recommendedTier: AllianceCartographerOutput["recommendedTier"] = {
      tier:
        rt.tier === "strategic" || rt.tier === "preferred" || rt.tier === "transactional"
          ? rt.tier
          : null,
      rationale: str(rt.rationale, 200),
    };

    // --- fit scorecard: weights/total/verdict/watchouts computed HERE ---
    const rawDims = Array.isArray(raw.fitScorecard) ? (raw.fitScorecard as Array<Record<string, unknown>>) : [];
    // Task #771 — prepend staleness warning when the dossier lacked recent dates.
    const openQuestions: string[] = [
      ...(allianceStale
        ? [
            "⚠ Web research may not reflect recent events: no content dated from this or the previous calendar year was found in the retrieved sources. Verify the firm name and re-run to capture recent developments.",
          ]
        : []),
      ...(Array.isArray(raw.openQuestions)
        ? (raw.openQuestions as unknown[]).filter((q): q is string => typeof q === "string").slice(0, 20)
        : []),
    ];
    const dimensions = ALLIANCE_FIT_DIMENSIONS.map((def) => {
      const found = rawDims.find((d) => d?.id === def.id);
      if (!found) {
        openQuestions.push(
          `Fit dimension "${def.label}" was missing from the research output — defaulted to 1/unverified; re-run or score manually.`,
        );
      }
      return {
        id: def.id,
        label: def.label,
        weight: def.weight,
        score: found ? clampScore(found.score) : 1,
        evidence: found ? normaliseEvidence(found.evidence) : ("unverified" as Evidence),
        rationale: found ? str(found.rationale, 250) : "Not returned by the research sweep.",
        sourceUrls: found ? normaliseUrls(found.sourceUrls) : [],
      };
    });
    const { weightedTotal, verdict, watchouts } = computeFitTotals(dimensions);
    const fitScorecard: AllianceCartographerOutput["fitScorecard"] = {
      dimensions,
      weightedTotal,
      verdict,
      watchouts,
      scoredAt: now,
      scoredBy: "ag_alliance_cartographer",
    };

    // --- due diligence: all 7 gates, overall = worst ---
    const rawGates = Array.isArray(raw.dueDiligence) ? (raw.dueDiligence as Array<Record<string, unknown>>) : [];
    const gates = ALLIANCE_DD_GATES.map((def) => {
      const found = rawGates.find((g) => g?.id === def.id);
      const status: GateStatus =
        found && GATE_STATUS_SET.has(found.status as GateStatus)
          ? (found.status as GateStatus)
          : "to_verify";
      return {
        id: def.id,
        label: def.label,
        status,
        evidence: found ? normaliseEvidence(found.evidence) : ("unverified" as Evidence),
        notes: found ? str(found.notes, 250) : "Not covered by the research sweep.",
        sourceUrls: found ? normaliseUrls(found.sourceUrls) : [],
      };
    });
    const overall =
      GATE_SEVERITY.find((s) => gates.some((g) => g.status === s)) ?? "to_verify";
    const dueDiligence: AllianceCartographerOutput["dueDiligence"] = {
      gates,
      overall,
      assessedAt: now,
      assessedBy: "ag_alliance_cartographer",
    };

    // --- risks ---
    const riskRegister: AllianceCartographerOutput["riskRegister"] = (
      Array.isArray(raw.riskRegister) ? (raw.riskRegister as Array<Record<string, unknown>>) : []
    )
      .filter((r) => typeof r?.risk === "string" && (r.risk as string).trim().length > 0)
      .slice(0, 8)
      .map((r) => ({
        id: rid("rsk"),
        risk: (r.risk as string).trim().slice(0, 200),
        mitigation: str(r.mitigation, 200) ?? "Mitigation to be defined at review.",
        severity: r.severity === "high" || r.severity === "low" ? r.severity : "med",
        evidence: normaliseEvidence(r.evidence),
        sourceUrls: normaliseUrls(r.sourceUrls),
      }));

    // --- phasing ---
    const rp = (raw.phasing ?? {}) as Record<string, unknown>;
    const phasing: AllianceCartographerOutput["phasing"] =
      rp.phase === "verify" || rp.phase === "pilot" || rp.phase === "convert"
        ? {
            phase: rp.phase,
            milestone: str(rp.milestone, 200) ?? "Milestone to be defined at review.",
            note: str(rp.note, 200),
          }
        : null;

    // --- capabilities ---
    const capabilities: Record<string, number> = {};
    if (raw.capabilities && typeof raw.capabilities === "object" && !Array.isArray(raw.capabilities)) {
      for (const [k, v] of Object.entries(raw.capabilities as Record<string, unknown>)) {
        const key = k.trim().slice(0, 60);
        const n = Number(v);
        if (key && Number.isFinite(n)) capabilities[key] = Math.min(5, Math.max(0, Math.round(n)));
      }
    }

    // --- capability profile (Task #871) ---
    const rcp = (raw.capabilityProfile ?? {}) as Record<string, unknown>;
    const rawDomains = Array.isArray(rcp.domains)
      ? (rcp.domains as Array<Record<string, unknown>>)
      : [];
    const domains = rawDomains
      .filter((d) => typeof d?.label === "string" && (d.label as string).trim().length > 0)
      .slice(0, 10)
      .map((d, i) => ({
        id:
          typeof d.id === "string" && d.id.trim().length > 0
            ? d.id.trim().slice(0, 60)
            : `dom_${i + 1}`,
        label: (d.label as string).trim().slice(0, 60),
        description: str(d.description, 500) ?? "",
        evidence: normaliseEvidence(d.evidence),
        sourceUrls: normaliseUrls(d.sourceUrls),
      }))
      .filter((d) => d.description.length > 0);
    const capSummary = str(rcp.summary, 800);
    const capabilityProfile: AllianceCartographerOutput["capabilityProfile"] =
      capSummary || domains.length > 0
        ? {
            summary: capSummary ?? firm.summary ?? "",
            domains,
            researchedAt: now,
            researchedBy: "ag_alliance_cartographer",
          }
        : null;

    // --- source signals (+ citation backfill) ---
    const sourceSignals: AllianceCartographerOutput["sourceSignals"] = (
      Array.isArray(raw.sourceSignals) ? (raw.sourceSignals as Array<Record<string, unknown>>) : []
    )
      .filter((s) => typeof s?.url === "string" && /^https?:\/\//.test(s.url as string))
      .slice(0, 12)
      .map((s) => ({
        kind: typeof s.kind === "string" ? s.kind : "news",
        title: str(s.title, 200) ?? (s.url as string),
        url: s.url as string,
        summary: str(s.summary, 200) ?? undefined,
        confidence: s.confidence === "green" || s.confidence === "red" ? s.confidence : "amber",
      }));
    if (sourceSignals.length < 2 && citationUrls.length > 0) {
      const seen = new Set(sourceSignals.map((s) => s.url));
      for (const c of citationUrls) {
        if (seen.has(c.url)) continue;
        sourceSignals.push({
          kind: "news",
          title: c.title ?? c.url,
          url: c.url,
          confidence: "red",
          uncorroborated: true,
        });
        seen.add(c.url);
        if (sourceSignals.length >= 6) break;
      }
    }

    const output: AllianceCartographerOutput = {
      firm,
      archetype,
      recommendedTier,
      fitScorecard,
      dueDiligence,
      riskRegister,
      phasing,
      capabilities,
      capabilityProfile,
      sourceSignals,
      openQuestions,
    };

    const confidence: "green" | "amber" | "red" =
      output.fitScorecard.dimensions.every((d) => d.evidence === "unverified")
        ? "red"
        : output.sourceSignals.length >= 2
          ? "green"
          : "amber";
    await completeRun({
      runId,
      output: output as unknown,
      confidence,
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: output.sourceSignals.length,
      actorLabel: args.actorLabel,
      targetType: "partner_firm",
      targetId: args.firmId,
      targetLabel: args.firmName,
    });
    return { runId, output, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "partner_firm",
      targetId: args.firmId,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Proposal builders — everything lands in firm.pendingUpdates for review.
// ---------------------------------------------------------------------------

function partnerProposalKey(p: { field: string; toValue: unknown }): string {
  if (p.field === "contact") {
    const c = (p.toValue ?? {}) as { name?: string; role?: string | null };
    return `contact:${(c.name ?? "").toLowerCase()}:${(c.role ?? "").toLowerCase()}`;
  }
  // Strip code-stamped volatile fields (timestamps, generated risk ids) or an
  // IDENTICAL re-run produces a different key and dedupe silently fails.
  let v = p.toValue;
  if (p.field === "fitScorecard" && v && typeof v === "object") {
    v = { ...(v as Record<string, unknown>), scoredAt: "", scoredBy: "" };
  } else if (p.field === "dueDiligence" && v && typeof v === "object") {
    v = { ...(v as Record<string, unknown>), assessedAt: "", assessedBy: "" };
  } else if (p.field === "capabilityProfile" && v && typeof v === "object") {
    v = { ...(v as Record<string, unknown>), researchedAt: "", researchedBy: "" };
  } else if (p.field === "riskRegister" && Array.isArray(v)) {
    v = v.map((r) =>
      r && typeof r === "object" ? { ...(r as Record<string, unknown>), id: "" } : r,
    );
  }
  return `${p.field}:${stableStringify(v)}`;
}

export function buildAllianceCartographerProposals(args: {
  output: AllianceCartographerOutput;
  firm: PartnerFirmRow;
}): PendingPartnerUpdate[] {
  const { output, firm } = args;
  const now = new Date().toISOString();
  const blockedKeys = new Set<string>();
  for (const u of firm.pendingUpdates ?? []) {
    if (u.status === "pending" || u.status === "rejected") {
      blockedKeys.add(partnerProposalKey(u));
    }
  }
  const candidates: PendingPartnerUpdate[] = [];
  const push = (
    field: string,
    fromValue: unknown,
    toValue: unknown,
    rationale: string,
    meta?: Record<string, unknown>,
  ) => {
    if (materiallyEqual(toValue, fromValue)) return;
    const key = partnerProposalKey({ field, toValue });
    if (blockedKeys.has(key)) return;
    blockedKeys.add(key);
    candidates.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: "ag_alliance_cartographer",
      proposedAt: now,
      field,
      fromValue,
      toValue,
      rationale,
      status: "pending",
      ...(meta ? { meta } : {}),
    });
  };

  // Comparison must ignore the code-stamped timestamps or a re-run always
  // looks "different". Strip scoredAt/assessedAt for the no-op check via meta.
  const stripFitTs = (v: PartnerFirmRow["fitScorecard"]) =>
    v ? { ...v, scoredAt: "", scoredBy: "" } : v;
  const stripDdTs = (v: PartnerFirmRow["dueDiligence"]) =>
    v ? { ...v, assessedAt: "", assessedBy: "" } : v;

  if (output.archetype.id) {
    push(
      "archetype",
      firm.archetype ?? null,
      output.archetype.id,
      output.archetype.rationale ??
        "Alliance Cartographer classified the partnership archetype from public sources.",
      { evidence: output.archetype.evidence },
    );
  }
  if (output.recommendedTier.tier) {
    push(
      "tier",
      firm.tier ?? null,
      output.recommendedTier.tier,
      output.recommendedTier.rationale ?? "Alliance Cartographer recommended a partnership tier.",
    );
  }
  if (!materiallyEqual(stripFitTs(output.fitScorecard), stripFitTs(firm.fitScorecard))) {
    push(
      "fitScorecard",
      firm.fitScorecard ?? null,
      output.fitScorecard,
      `Alliance Cartographer scored the 9-dimension fit framework: ${output.fitScorecard.weightedTotal}/5 → ${output.fitScorecard.verdict}.`,
    );
  }
  if (!materiallyEqual(stripDdTs(output.dueDiligence), stripDdTs(firm.dueDiligence))) {
    push(
      "dueDiligence",
      firm.dueDiligence ?? null,
      output.dueDiligence,
      `Alliance Cartographer assessed the 7 due-diligence gates (overall: ${output.dueDiligence.overall}).`,
    );
  }
  if (output.riskRegister.length > 0) {
    push(
      "riskRegister",
      firm.riskRegister ?? [],
      output.riskRegister,
      `Alliance Cartographer identified ${output.riskRegister.length} risk(s) with mitigations.`,
    );
  }
  if (output.phasing) {
    push(
      "phasing",
      firm.phasing ?? null,
      output.phasing,
      `Alliance Cartographer recommends phase "${output.phasing.phase}" — ${output.phasing.milestone}`,
    );
  }
  // Task #871 — capability profile proposal (comparison strips the
  // code-stamped research timestamps, mirroring fit/DD).
  const stripCapTs = (v: PartnerFirmRow["capabilityProfile"]) =>
    v ? { ...v, researchedAt: "", researchedBy: "" } : v;
  if (
    output.capabilityProfile &&
    !materiallyEqual(stripCapTs(output.capabilityProfile), stripCapTs(firm.capabilityProfile))
  ) {
    push(
      "capabilityProfile",
      firm.capabilityProfile ?? null,
      output.capabilityProfile,
      `Alliance Cartographer researched the firm's capability profile (${output.capabilityProfile.domains.length} domain(s)). Approving refreshes Riser's partner-capability retrieval.`,
    );
  }
  if (Object.keys(output.capabilities).length > 0) {
    push(
      "capabilities",
      firm.capabilities ?? {},
      output.capabilities,
      "Alliance Cartographer assessed capability strengths from public evidence.",
    );
  }
  // Firmographic enrichment — only propose when the live field is empty.
  if (output.firm.speciality && !firm.speciality) {
    push("speciality", firm.speciality ?? null, output.firm.speciality, "Alliance Cartographer sourced the firm's speciality.");
  }
  if (output.firm.kind && !firm.kind) {
    push("kind", firm.kind ?? null, output.firm.kind, "Alliance Cartographer classified the firm type.");
  }
  if (output.firm.country && !firm.country) {
    push("country", firm.country ?? null, output.firm.country, "Alliance Cartographer sourced the HQ country.", {
      countryCode: output.firm.countryCode,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Alliance Executive Mapper
// ---------------------------------------------------------------------------

export interface AllianceExecutiveMapperOutput {
  decisionMakers: Array<{
    fullName: string;
    title?: string | null;
    entityName: string | null;
    entityScope: "parent_group" | "subsidiary" | "division" | "standalone" | null;
    seniority?: string | null;
    allianceRole?: AllianceRoleId | null;
    sourceUrl: string | null;
    linkedinUrl: string | null;
    confidence: "verified" | "inferred";
    reportsToName: string | null;
    rationale?: string | null;
  }>;
  sourceSignals: AllianceCartographerOutput["sourceSignals"];
  openQuestions: string[];
  allianceRoleCoverage?: AllianceRoleCoverageEntry[];
  droppedByAllianceGuard?: AllianceGuardDrop[];
}

export async function runAllianceExecutiveMapper(args: {
  firmId: string;
  firmName: string;
  firmCountry?: string | null;
  firmSpeciality?: string | null;
  knownContacts: Array<{ fullName: string; title: string | null; linkedinUrl: string | null }>;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: AllianceExecutiveMapperOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "alliance_executive_mapper",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "partner_firm",
    targetId: args.firmId,
    targetLabel: args.firmName,
    inputs: { knownContactCount: args.knownContacts.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = await loadEffectivePrompt("alliance_executive_mapper", 1);
    await progressRun(runId, 20, "Sweeping the partner-firm leadership");
    const { value, costUsd, citationUrls } =
      await callResearchJson<AllianceExecutiveMapperOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          firm_name: args.firmName,
          firm_country: args.firmCountry ?? null,
          firm_speciality: args.firmSpeciality ?? null,
          known_contacts: args.knownContacts,
        }),
        {
          progressRunId: runId,
          // Task #687 — partner-firm leadership sweep via Perplexity.
          researchQueries: [
            `${args.firmName}${args.firmCountry ? ` (${args.firmCountry})` : ""} leadership team: founder/CEO and executives — names, exact titles`,
            `${args.firmName} partnership / alliances leads and key commercial contacts (names, titles, LinkedIn)`,
          ],
        },
      );
    await progressRun(runId, 96, "Finalising the alliance roster", {
      name: "alliance_map.synth",
      durationMs: Date.now() - t0,
    });

    const normalised: AllianceExecutiveMapperOutput = {
      decisionMakers: Array.isArray(value?.decisionMakers)
        ? value.decisionMakers
            .filter((d) => typeof d?.fullName === "string" && d.fullName.trim().length > 0)
            .map((d) => ({
              fullName: d.fullName.trim(),
              title: typeof d.title === "string" ? d.title : null,
              entityName:
                typeof d.entityName === "string" && d.entityName.trim().length > 0
                  ? d.entityName.trim()
                  : null,
              entityScope:
                d.entityScope === "parent_group" ||
                d.entityScope === "subsidiary" ||
                d.entityScope === "division" ||
                d.entityScope === "standalone"
                  ? d.entityScope
                  : null,
              seniority:
                d.seniority === "board_chair" ||
                d.seniority === "board_member" ||
                d.seniority === "c_suite" ||
                d.seniority === "vp" ||
                d.seniority === "director" ||
                d.seniority === "manager" ||
                d.seniority === "ic"
                  ? d.seniority
                  : null,
              // Raw model claim only — the deterministic guard re-classifies.
              allianceRole:
                typeof d.allianceRole === "string" ? (d.allianceRole as AllianceRoleId) : null,
              sourceUrl: typeof d.sourceUrl === "string" ? d.sourceUrl : null,
              linkedinUrl: normaliseLinkedinProfileUrl(d.linkedinUrl),
              confidence: d.confidence === "verified" ? "verified" : "inferred",
              reportsToName: typeof d.reportsToName === "string" ? d.reportsToName : null,
              rationale: typeof d.rationale === "string" ? d.rationale : null,
            }))
        : [],
      sourceSignals: Array.isArray(value?.sourceSignals)
        ? value.sourceSignals.filter(
            (s) => typeof s?.url === "string" && /^https?:\/\//.test(s.url),
          )
        : [],
      openQuestions: Array.isArray(value?.openQuestions)
        ? value.openQuestions.filter((q): q is string => typeof q === "string")
        : [],
    };

    // Collapse duplicate spellings within the sweep (same as exec mapper).
    normalised.decisionMakers = dedupeSweepRoster(
      normalised.decisionMakers,
      (x) => x.fullName,
      (existing, d) => {
        existing.fullName = richerPersonName(existing.fullName, d.fullName);
        if (!existing.title && d.title) existing.title = d.title;
        if (!existing.linkedinUrl && d.linkedinUrl) existing.linkedinUrl = d.linkedinUrl;
        if (!existing.seniority && d.seniority) existing.seniority = d.seniority;
        if (!existing.sourceUrl && d.sourceUrl) existing.sourceUrl = d.sourceUrl;
        if (existing.confidence !== "verified" && d.confidence === "verified")
          existing.confidence = "verified";
      },
    );

    // PDL cross-check — same degrade-loudly contract as the exec mapper.
    if (isPdlConfigured()) {
      await progressRun(runId, 90, "Cross-checking People Data Labs records");
      try {
        const pdl = await fetchPdlExecutivesForCompany({
          name: args.firmName,
          brandName: null,
          country: args.firmCountry ?? null,
        });
        if (!pdl) {
          normalised.openQuestions.push(
            `People Data Labs has no company record matching "${args.firmName}" — provider cross-check returned nothing.`,
          );
        } else {
          let added = 0;
          for (const p of pdl.people) {
            const pdlLinkedin = normaliseLinkedinProfileUrl(p.linkedinUrl);
            const existing = findPersonMatchLoose(
              p.fullName,
              normalised.decisionMakers,
              (d) => d.fullName,
            );
            if (existing) {
              existing.fullName = richerPersonName(existing.fullName, p.fullName);
              if (!existing.linkedinUrl && pdlLinkedin) existing.linkedinUrl = pdlLinkedin;
              if (!existing.title && p.title) existing.title = p.title;
              continue;
            }
            const known = findPersonMatchLoose(p.fullName, args.knownContacts, (c) => c.fullName);
            if (known) {
              const bringsNewLinkedin = Boolean(pdlLinkedin) && !known.linkedinUrl;
              const bringsNewTitle = Boolean(p.title) && !known.title;
              if (!bringsNewLinkedin && !bringsNewTitle) continue;
            }
            // PDL people only enter when their title carries an alliance
            // function or clear seniority — the guard below enforces it.
            normalised.decisionMakers.push({
              fullName: p.fullName,
              title: p.title ?? null,
              entityName: null,
              entityScope: null,
              seniority: p.isBoard ? "board_member" : null,
              allianceRole: null,
              sourceUrl: null,
              linkedinUrl: pdlLinkedin,
              confidence: "inferred",
              reportsToName: null,
              rationale: `People Data Labs licensed record lists this person at ${pdl.company.displayName}${p.title ? ` as ${p.title}` : ""}; not found in the public web sweep.`,
            });
            added += 1;
          }
          if (added > 0) {
            normalised.sourceSignals.push({
              kind: "manual",
              title: `People Data Labs: ${added} additional ${added === 1 ? "person" : "people"} at ${pdl.company.displayName}`,
              url: "https://www.peopledatalabs.com/",
              confidence: "amber",
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[alliance-executive-mapper] PDL lookup failed:", msg);
        normalised.openQuestions.push(
          `People Data Labs cross-check failed (${msg.slice(0, 160)}) — roster reflects the public web only.`,
        );
      }
    } else {
      normalised.openQuestions.push(
        "People Data Labs cross-check skipped: PDL_API_KEY is not configured.",
      );
    }

    // Deterministic guards: subsidiary CEOs never promoted to apex, and the
    // alliance-role classifier overwrites every model claim.
    guardCartographerEntityScope(
      normalised as unknown as Parameters<typeof guardCartographerEntityScope>[0],
      args.firmName,
    );
    guardAllianceMapperRoles(normalised);

    if (normalised.sourceSignals.length < 2 && citationUrls.length > 0) {
      const seen = new Set(normalised.sourceSignals.map((s) => s.url));
      for (const c of citationUrls) {
        if (seen.has(c.url)) continue;
        normalised.sourceSignals.push({
          kind: "news",
          title: c.title ?? c.url,
          url: c.url,
          confidence: "red",
          uncorroborated: true,
        });
        seen.add(c.url);
        if (normalised.sourceSignals.length >= 6) break;
      }
    }

    await completeRun({
      runId,
      output: normalised as unknown,
      confidence: "green",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: normalised.sourceSignals.length,
      actorLabel: args.actorLabel,
      targetType: "partner_firm",
      targetId: args.firmId,
      targetLabel: args.firmName,
    });
    return { runId, output: normalised, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "partner_firm",
      targetId: args.firmId,
    });
    throw err;
  }
}

/**
 * Contact proposals from an Alliance Executive Mapper run. Same fuzzy-human
 * blocking discipline as the client-side builder: one proposal per human per
 * run, pending blocks any spelling variant, rejected blocks unless the title
 * genuinely changed, known contacts re-listed only when something is new.
 */
export function buildAllianceMapperContactProposals(args: {
  output: AllianceExecutiveMapperOutput;
  firm: PartnerFirmRow;
}): PendingPartnerUpdate[] {
  const { output, firm } = args;
  const now = new Date().toISOString();
  const priorContactProposals: Array<{
    fullName: string;
    title: string | null;
    status: "pending" | "rejected";
  }> = [];
  const blockedKeys = new Set<string>();
  for (const u of firm.pendingUpdates ?? []) {
    if (u.status !== "pending" && u.status !== "rejected") continue;
    blockedKeys.add(partnerProposalKey(u));
    if (u.field === "contact") {
      const tv = u.toValue as { name?: unknown; role?: unknown } | null;
      if (tv && typeof tv.name === "string" && tv.name.trim()) {
        priorContactProposals.push({
          fullName: tv.name,
          title: typeof tv.role === "string" ? tv.role : null,
          status: u.status,
        });
      }
    }
  }
  const normTitle = (t: string | null | undefined) =>
    (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const existingContacts = (firm.contacts ?? []).map((c) => ({
    fullName: c.name,
    title: c.role ?? null,
  }));
  const candidates: PendingPartnerUpdate[] = [];
  const proposedPeople: Array<{ fullName: string }> = [];
  for (const dm of output.decisionMakers ?? []) {
    if (!dm.fullName || !dm.fullName.trim()) continue;
    // Task #971 — same belt-and-braces matchPerson pattern as the Executive
    // Mapper builder: structural matcher first, then the HIGH-confidence
    // contact-duplicate scorer fallback for near-miss spellings.
    if (findPersonMatchLoose(dm.fullName, proposedPeople, (p) => p.fullName)) continue;
    const prior = findPersonMatchLoose(dm.fullName, priorContactProposals, (p) => p.fullName);
    if (
      prior &&
      (prior.status === "pending" || !dm.title || normTitle(dm.title) === normTitle(prior.title))
    ) {
      proposedPeople.push({ fullName: dm.fullName });
      continue;
    }
    const existing = findPersonMatchLoose(dm.fullName, existingContacts, (c) => c.fullName);
    const changesTitle = Boolean(
      existing && dm.title && dm.title.trim() !== (existing.title ?? "").trim(),
    );
    const addsAllianceRole = Boolean(
      existing && dm.allianceRole && classifyAllianceRole(existing.title) !== dm.allianceRole,
    );
    if (existing && !changesTitle && !addsAllianceRole && !dm.linkedinUrl) {
      proposedPeople.push({ fullName: dm.fullName });
      continue;
    }
    const toValue = {
      name: existing ? richerPersonName(existing.fullName, dm.fullName) : dm.fullName,
      role: dm.title ?? existing?.title ?? null,
      email: null,
      linkedinUrl: dm.linkedinUrl ?? null,
      sourceUrl: dm.sourceUrl ?? null,
      confidence: dm.confidence,
      allianceRole: dm.allianceRole ?? null,
      rationale: dm.rationale ?? null,
    };
    const key = partnerProposalKey({ field: "contact", toValue });
    if (blockedKeys.has(key)) continue;
    blockedKeys.add(key);
    const what = existing
      ? changesTitle
        ? `updated the role for existing contact ${dm.fullName}`
        : addsAllianceRole
          ? `identified existing contact ${dm.fullName} as an alliance-critical role`
          : `found the LinkedIn profile for existing contact ${dm.fullName}`
      : `discovered ${dm.fullName}${dm.title ? ` (${dm.title})` : ""}`;
    candidates.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: "ag_alliance_executive_mapper",
      proposedAt: now,
      field: "contact",
      fromValue: null,
      toValue,
      rationale: `Alliance Executive Mapper ${what}.`,
      status: "pending",
      meta: {
        allianceRole: dm.allianceRole ?? null,
        // Task #971 — the review UI must present enrichments of a known
        // contact as updates, never as new-person suggestions.
        updateKind: existing ? "enrichment" : "new_contact",
        ...(existing ? { existingContactName: existing.fullName } : {}),
      },
    });
    proposedPeople.push({ fullName: dm.fullName });
  }
  return candidates;
}

/**
 * Persist proposals onto the firm's pendingUpdates queue (re-loading the row
 * first so a concurrent approval isn't clobbered) and audit the batch.
 */
export async function queuePartnerFirmProposals(args: {
  firmId: string;
  proposals: PendingPartnerUpdate[];
  actorId: string;
  actorLabel: string;
  runId: string;
}): Promise<number> {
  if (args.proposals.length === 0) return 0;
  return await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(atelierPartnerFirms)
      .where(eq(atelierPartnerFirms.id, args.firmId))
      .for("update");
    if (!fresh || fresh.deletedAt) return 0;
    // Re-filter against the FRESH queue (a proposal may have been decided
    // between run start and now).
    const liveKeys = new Set(
      (fresh.pendingUpdates ?? [])
        .filter((u) => u.status === "pending" || u.status === "rejected")
        .map((u) => partnerProposalKey(u)),
    );
    const toAdd = args.proposals.filter((p) => !liveKeys.has(partnerProposalKey(p)));
    if (toAdd.length === 0) return 0;
    await tx
      .update(atelierPartnerFirms)
      .set({
        pendingUpdates: [...(fresh.pendingUpdates ?? []), ...toAdd],
        updatedAt: new Date(),
      })
      .where(eq(atelierPartnerFirms.id, args.firmId));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: fresh.orgId,
      entityType: "partner_firm",
      entityId: args.firmId,
      actorType: "agent",
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: "partner_firm.proposeUpdate",
      payload: { count: toAdd.length, runId: args.runId },
      payloadSummary: `${args.actorLabel} proposed ${toAdd.length} update(s) for "${fresh.name}".`,
    });
    return toAdd.length;
  });
}
