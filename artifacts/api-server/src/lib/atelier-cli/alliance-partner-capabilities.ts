/**
 * Task #526 — Alliance Partner chat capabilities.
 *
 * 1. `alliance_partner_add` — the "add alliance partner <company>" flow:
 *    fuzzy dedupe against the partner registry AND the targets pipeline,
 *    candidate/agreed clarification when the stage wasn't stated, a
 *    two-phase confirm card, then create + fire-and-forget launch of the
 *    Alliance Cartographer (which auto-chains the Alliance Executive
 *    Mapper). The firm creation COMMITS even if the agent launch fails —
 *    the evaluation is advisory and can be re-run from the firm page.
 * 2. `alliance_partner_evaluation` — read-only framework evaluation
 *    summary: verdict + weighted total, archetype, DD overall, risk
 *    count, phasing and the pending-proposal count awaiting review.
 *
 * Role gating mirrors the Partners lens REST boundary: reads for
 * `canAccessPartnersLens` roles, the write for `canEditPartnersLens`
 * roles. Self-only chat roles never see these (SELF_ONLY_CHAT_ROLES
 * clamps their surface to me.* in the catalog gate).
 */

import { and, eq, ilike, isNull } from "drizzle-orm";
import {
  db,
  atelierPartnerFirms,
  atelierPartnerTargets,
  atelierAuditEvents,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import {
  ALLIANCE_ARCHETYPES,
  type AllianceArchetype,
} from "../atelier-agents/alliance-cartographer.js";
import { runAllianceCartographerAndQueue } from "../atelier-agents/alliance-mapper-chain.js";
import {
  refreshPartnerFirmRag,
  searchPartnerCapabilities,
} from "./partner-capability-rag.js";

// Task #871 — two-dimensional stage model.
const PARTNERSHIP_STAGES = ["consideration", "exploration", "agreed"] as const;
const AGREEMENT_STAGES = ["preparing", "negotiating", "reviewing", "signing", "signed"] as const;
type PartnershipStage = (typeof PARTNERSHIP_STAGES)[number];
type AgreementStage = (typeof AGREEMENT_STAGES)[number];

/** Accepts current stages plus the legacy "candidate" alias. */
function parsePartnershipStage(v: unknown): PartnershipStage | null {
  if (v === "candidate") return "consideration";
  return PARTNERSHIP_STAGES.includes(v as PartnershipStage) ? (v as PartnershipStage) : null;
}
function parseAgreementStage(v: unknown): AgreementStage | null {
  return AGREEMENT_STAGES.includes(v as AgreementStage) ? (v as AgreementStage) : null;
}

const rid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Name normalizer for fuzzy dedupe: lowercase, strip legal suffixes + punctuation. */
export function normalizePartnerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,()'"’&/\\-]+/g, " ")
    .replace(
      /\b(inc|llc|ltd|limited|gmbh|sa|s\.?a\.?s|plc|corp|corporation|co|company|group|holding|holdings|as|a\.?s|ag|bv|nv|fz|fzco|fz-llc|dmcc|teknoloji|bilisim|bilişim|yazilim|yazılım|danismanlik|danışmanlık|anonim|sirketi|şirketi|ticaret)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

async function auditEvent(
  orgId: string,
  userId: string,
  entityId: string,
  action: string,
  payload: unknown,
  summary: string,
): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: rid("ae"),
      orgId,
      actorType: "human",
      actorId: userId,
      actorLabel: userId,
      entityType: "partner_firm",
      entityId,
      action,
      payloadSummary: summary,
      payload: payload as Record<string, unknown>,
    });
  } catch (e) {
    console.warn("[alliance_partner_add] audit insert failed:", (e as Error).message);
  }
}

type FirmDupe = { id: string; name: string; status: string; partnershipStage: string };
type TargetDupe = { id: string; name: string; status: string };

async function findDupes(
  orgId: string,
  rawName: string,
): Promise<{ firms: FirmDupe[]; targets: TargetDupe[] }> {
  const norm = normalizePartnerName(rawName);
  const probe = norm.length > 0 ? norm.split(" ")[0] : rawName.toLowerCase();
  const firmRows = await db
    .select({
      id: atelierPartnerFirms.id,
      name: atelierPartnerFirms.name,
      status: atelierPartnerFirms.status,
      partnershipStage: atelierPartnerFirms.partnershipStage,
    })
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.orgId, orgId),
        isNull(atelierPartnerFirms.deletedAt),
        ilike(atelierPartnerFirms.name, `%${probe}%`),
      ),
    )
    .limit(10);
  const targetRows = await db
    .select({
      id: atelierPartnerTargets.id,
      name: atelierPartnerTargets.name,
      status: atelierPartnerTargets.status,
      promotedFirmId: atelierPartnerTargets.promotedFirmId,
    })
    .from(atelierPartnerTargets)
    .where(
      and(
        eq(atelierPartnerTargets.orgId, orgId),
        isNull(atelierPartnerTargets.deletedAt),
        ilike(atelierPartnerTargets.name, `%${probe}%`),
      ),
    )
    .limit(10);
  // Keep only rows whose normalized names actually collide (the ilike
  // probe on the first token is deliberately wide; tighten here).
  const firms = firmRows.filter(
    (f) =>
      normalizePartnerName(f.name) === norm ||
      normalizePartnerName(f.name).includes(norm) ||
      norm.includes(normalizePartnerName(f.name)),
  );
  const targets = targetRows
    .filter((t) => !t.promotedFirmId)
    .filter(
      (t) =>
        normalizePartnerName(t.name) === norm ||
        normalizePartnerName(t.name).includes(norm) ||
        norm.includes(normalizePartnerName(t.name)),
    )
    .map(({ id, name, status }) => ({ id, name, status }));
  return { firms, targets };
}

// ---------------------------------------------------------------------
// alliance_partner_add (write)
// ---------------------------------------------------------------------

defineCapability({
  id: "alliance.partner_add",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "alliance_partner_add",
  description:
    "Add an alliance partner to the registry (the 'add alliance partner <company>' flow). " +
    "Dedupes against existing partner firms AND pipeline targets, asks whether the firm is a " +
    "candidate (under evaluation) or agreed (signed) partner, shows a confirm card, then " +
    "creates the firm and launches the Alliance Cartographer framework evaluation " +
    "(the Alliance Executive Mapper auto-chains). Prefer this over partner_firm_create " +
    "whenever the user says 'alliance partner' or wants the framework evaluation.",
  slashAliases: { en: ["/alliance-partner-add"] },
  representativePrompts: {
    en: [
      "Add alliance partner Thoughtworks.",
      "Register Argano as a candidate alliance partner and evaluate them.",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      confirm: { type: "boolean", description: "Set true to commit." },
      summary: { type: "string", description: "Optional human description." },
      name: { type: "string", minLength: 2, description: "Company name." },
      partnershipStage: {
        type: "string",
        enum: [...PARTNERSHIP_STAGES],
        description:
          "consideration = being considered; exploration = partnership in discussion; " +
          "agreed = partnership agreed (agreement paperwork tracked separately). Ask the user if not stated.",
      },
      agreementStage: {
        type: "string",
        enum: [...AGREEMENT_STAGES],
        description:
          "Only when partnershipStage is agreed: where the agreement itself stands " +
          "(preparing → negotiating → reviewing → signing → signed). Defaults to preparing.",
      },
      country: { type: "string" },
      archetypeHint: {
        type: "string",
        enum: [...ALLIANCE_ARCHETYPES],
        description: "Optional framework archetype hint if the user stated one.",
      },
      contactName: { type: "string" },
      contactEmail: { type: "string" },
      notes: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  requiredRoles: ["founding_partner", "partner", "senior_manager", "finance"],
  async run(input, ctx) {
    const rawName = String(input.name ?? "").trim();
    if (rawName.length < 2) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "Partner name is required." };
    }

    // 1. Dedupe — existing registry firm or pipeline target wins.
    const { firms, targets } = await findDupes(ctx.persona.orgId, rawName);
    if (firms.length > 0) {
      const f = firms[0];
      return {
        ok: true,
        data: {
          alreadyExists: true,
          kind: "partner_firm",
          id: f.id,
          name: f.name,
          partnershipStage: f.partnershipStage,
          status: f.status,
          note: `"${f.name}" is already in the partner registry (${f.partnershipStage}). No new firm was created — you can re-run the Alliance Cartographer from its Evaluation section.`,
          navigateTo: { path: "/partners/identify", when: "on_commit" },
        },
      };
    }
    if (targets.length > 0 && input.confirm !== true) {
      const t = targets[0];
      return {
        ok: false,
        errorCode: "needs_confirm",
        errorMessage:
          `"${t.name}" already exists in the partner TARGETS pipeline (status: ${t.status}). ` +
          `Creating a registry firm anyway will not remove the target. Re-run with confirm:true to proceed.`,
        confirmation: {
          summary: `"${t.name}" is already a pipeline target — create "${rawName}" in the registry anyway?`,
          diff: { create: { name: rawName, partnershipStage: input.partnershipStage ?? null } },
          pending: { tool: "alliance_partner_add", input: { ...input, confirm: true } },
        },
      };
    }

    // 2. Partnership-stage clarification (multi-field protocol; the
    //    answer merges back at TOP-LEVEL args, not nested).
    const stage = parsePartnershipStage(input.partnershipStage);
    if (!stage) {
      return {
        ok: true,
        data: { clarificationPending: true },
        clarification: {
          field: "partnershipStage",
          tool: "alliance_partner_add",
          question:
            `Where does the ${rawName} partnership stand — consideration, exploration (in discussion), or agreed?`,
          partial: { ...input },
          suggestions: [
            { id: "consideration", label: "Consideration — being considered" },
            { id: "exploration", label: "Exploration — partnership in discussion" },
            { id: "agreed", label: "Agreed — partnership agreed" },
          ],
          fields: [
            {
              field: "partnershipStage",
              label: "Partnership stage",
              hint: "consideration, exploration or agreed",
            },
          ],
        },
      };
    }
    // Agreed firms always carry an agreement stage (default: preparing).
    const agreementStage: AgreementStage | null =
      stage === "agreed" ? (parseAgreementStage(input.agreementStage) ?? "preparing") : null;

    // 3. Confirm card.
    if (input.confirm !== true) {
      return {
        ok: false,
        errorCode: "needs_confirm",
        errorMessage: "alliance_partner_add requires confirm:true.",
        confirmation: {
          summary:
            `Add "${rawName}" as a ${stage}${agreementStage ? ` (${agreementStage})` : ""} alliance partner ` +
            `and launch the framework evaluation (Alliance Cartographer → Executive Mapper)?`,
          diff: {
            create: {
              name: rawName,
              partnershipStage: stage,
              agreementStage,
              country: input.country ?? null,
              archetype: input.archetypeHint ?? null,
              contactName: input.contactName ?? null,
              contactEmail: input.contactEmail ?? null,
            },
          },
          pending: { tool: "alliance_partner_add", input: { ...input, confirm: true } },
        },
      };
    }

    // 4. Create the firm. The agent launch below is advisory — the write
    //    commits regardless (Pursuit-Scout-style degradation).
    const id = rid("pf");
    const archetype =
      typeof input.archetypeHint === "string" &&
      ALLIANCE_ARCHETYPES.includes(input.archetypeHint as AllianceArchetype)
        ? (input.archetypeHint as AllianceArchetype)
        : null;
    const contacts =
      typeof input.contactName === "string" && input.contactName.trim().length > 0
        ? [
            {
              id: rid("pfc"),
              name: input.contactName.trim(),
              role: null,
              email:
                typeof input.contactEmail === "string" && input.contactEmail.includes("@")
                  ? input.contactEmail.trim()
                  : null,
            },
          ]
        : [];
    await db.insert(atelierPartnerFirms).values({
      id,
      orgId: ctx.persona.orgId,
      name: rawName,
      country: typeof input.country === "string" ? input.country : null,
      partnershipStage: stage,
      agreementStage,
      archetype,
      contacts,
      contactName: typeof input.contactName === "string" ? input.contactName : null,
      contactEmail: typeof input.contactEmail === "string" ? input.contactEmail : null,
      notes: typeof input.notes === "string" ? input.notes : null,
      status: "active",
      createdByUserId: ctx.persona.id,
    });
    await auditEvent(
      ctx.persona.orgId,
      ctx.persona.id,
      id,
      "create",
      { ...input, source: "chat" },
      `partner_firm.create (chat): ${rawName} as ${stage}`,
    );
    // Task #871 — mirror the new firm into the entity-embedding index so
    // Riser can resolve it on the next turn (fire-and-forget).
    void refreshPartnerFirmRag(id);

    // 5. Launch the Alliance Cartographer fire-and-forget (auto-chains the
    //    Executive Mapper). A launch failure NEVER rolls back the firm —
    //    the evaluation can be re-run from the firm's Evaluation section.
    let agentStatus: "launched" | "launch_failed" = "launched";
    let agentError: string | null = null;
    try {
      void runAllianceCartographerAndQueue(id, ctx.persona.id, { chainMapper: true }).catch(
        (e: unknown) => {
          console.warn(
            `[alliance_partner_add] Alliance Cartographer run failed for "${rawName}" (${id}); firm creation stands:`,
            e instanceof Error ? e.message : String(e),
          );
        },
      );
      await auditEvent(
        ctx.persona.orgId,
        ctx.persona.id,
        id,
        "partner_firm.agentRun.start",
        { agentId: "alliance_cartographer", source: "chat" },
        `Alliance Cartographer launched from chat for "${rawName}".`,
      );
    } catch (e) {
      agentStatus = "launch_failed";
      agentError = e instanceof Error ? e.message : String(e);
      console.warn(
        `[alliance_partner_add] Alliance Cartographer launch failed for "${rawName}"; firm creation stands:`,
        agentError,
      );
    }

    return {
      ok: true,
      data: {
        id,
        kind: "partner_firm",
        name: rawName,
        partnershipStage: stage,
        agreementStage,
        archetype,
        agent: {
          id: "ag_alliance_cartographer",
          name: "Alliance Cartographer",
          status: agentStatus,
          error: agentError,
          note:
            agentStatus === "launched"
              ? "Framework evaluation running in the background — results land as pending proposals on the firm's Evaluation section (the Executive Mapper auto-chains)."
              : "The firm was created, but the evaluation could not be launched — re-run it from the firm's Evaluation section.",
        },
        navigateTo: { path: "/partners/identify", when: "on_commit" },
      },
    };
  },
});

// ---------------------------------------------------------------------
// alliance_partner_evaluation (read)
// ---------------------------------------------------------------------

defineCapability({
  id: "alliance.partner_evaluation",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "alliance_partner_evaluation",
  description:
    "Read a partner firm's Alliance Partner Evaluation Framework summary: fit verdict + " +
    "weighted total + watch-outs, archetype, partnership stage, due-diligence overall, risk " +
    "count, phasing, and how many AI proposals are pending review.",
  slashAliases: { en: ["/alliance-evaluation"] },
  representativePrompts: {
    en: ["What's the evaluation verdict for Thoughtworks?", "Show BGTS's alliance fit scorecard."],
  },
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 2, description: "Partner firm name (fuzzy) or id." },
    },
    required: ["name"],
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  requiredRoles: [
    "founding_partner",
    "partner",
    "senior_manager",
    "consultant",
    "finance",
    "hr",
    "compliance_officer",
  ],
  async run(input, ctx) {
    const raw = String(input.name ?? "").trim();
    if (raw.length < 2) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "Partner name is required." };
    }
    const byId = await db
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, raw),
          eq(atelierPartnerFirms.orgId, ctx.persona.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      )
      .limit(1);
    let firm = byId[0] ?? null;
    if (!firm) {
      const { firms } = await findDupes(ctx.persona.orgId, raw);
      if (firms.length === 0) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `No partner firm matching "${raw}" in the registry.`,
        };
      }
      if (firms.length > 1) {
        return {
          ok: false,
          errorCode: "ambiguous",
          errorMessage: `Multiple partner firms match "${raw}".`,
          disambiguation: {
            kind: "partner_firm",
            options: firms.slice(0, 5).map((f) => ({ id: f.id, label: f.name })),
          },
        };
      }
      const [full] = await db
        .select()
        .from(atelierPartnerFirms)
        .where(eq(atelierPartnerFirms.id, firms[0].id))
        .limit(1);
      firm = full ?? null;
    }
    if (!firm) {
      return { ok: false, errorCode: "not_found", errorMessage: `Partner firm not found.` };
    }
    const scorecard = firm.fitScorecard;
    const dd = firm.dueDiligence;
    const pending = (firm.pendingUpdates ?? []).filter((p) => p.status === "pending");
    return {
      ok: true,
      data: {
        id: firm.id,
        name: firm.name,
        partnershipStage: firm.partnershipStage,
        agreementStage: firm.agreementStage ?? null,
        archetype: firm.archetype,
        tier: firm.tier,
        status: firm.status,
        fit: scorecard
          ? {
              verdict: scorecard.verdict,
              weightedTotal: scorecard.weightedTotal,
              watchouts: scorecard.watchouts,
              scoredAt: scorecard.scoredAt,
              dimensions: scorecard.dimensions.map((d) => ({
                id: d.id,
                label: d.label,
                score: d.score,
                weight: d.weight,
                evidence: d.evidence,
              })),
            }
          : null,
        dueDiligence: dd
          ? {
              overall: dd.overall,
              gates: dd.gates.map((g) => ({ id: g.id, label: g.label, status: g.status })),
            }
          : null,
        riskCount: (firm.riskRegister ?? []).length,
        phasing: firm.phasing,
        pendingProposalCount: pending.length,
        pendingProposalFields: [...new Set(pending.map((p) => p.field))],
        pageHref: "/partners/qualify",
      },
    };
  },
});

// ---------------------------------------------------------------------
// alliance_partner_capabilities (read) — Task #871
// ---------------------------------------------------------------------

defineCapability({
  id: "alliance.partner_capabilities",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "alliance_partner_capabilities",
  description:
    "Answer questions about alliance partner capabilities from the approved, researched " +
    "capability profiles (org-scoped RAG with source-URL citations). Ask 'what can partner X do' " +
    "with a name, or 'which partner can do Y' with just a query — returns matched capability " +
    "chunks with the source URLs to cite. Ground every claim in the returned chunks/profile.",
  slashAliases: { en: ["/partner-capabilities"] },
  representativePrompts: {
    en: [
      "What are Thoughtworks' capabilities as a partner?",
      "Which alliance partner can build voice AI for call centers?",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 2,
        description: "The capability question (e.g. 'marketing mix modelling').",
      },
      name: {
        type: "string",
        description: "Optional partner firm name to scope the answer to one firm.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  requiredRoles: [
    "founding_partner",
    "partner",
    "senior_manager",
    "consultant",
    "finance",
    "hr",
    "compliance_officer",
  ],
  async run(input, ctx) {
    const query = String(input.query ?? "").trim();
    if (query.length < 2) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "A capability question is required." };
    }
    const rawName = typeof input.name === "string" ? input.name.trim() : "";

    // Optional firm scoping — resolve the name against the org registry.
    let firm: typeof atelierPartnerFirms.$inferSelect | null = null;
    if (rawName.length >= 2) {
      const [byId] = await db
        .select()
        .from(atelierPartnerFirms)
        .where(
          and(
            eq(atelierPartnerFirms.id, rawName),
            eq(atelierPartnerFirms.orgId, ctx.persona.orgId),
            isNull(atelierPartnerFirms.deletedAt),
          ),
        )
        .limit(1);
      firm = byId ?? null;
      if (!firm) {
        const { firms } = await findDupes(ctx.persona.orgId, rawName);
        if (firms.length === 0) {
          return {
            ok: false,
            errorCode: "not_found",
            errorMessage: `No partner firm matching "${rawName}" in the registry.`,
          };
        }
        if (firms.length > 1) {
          return {
            ok: false,
            errorCode: "ambiguous",
            errorMessage: `Multiple partner firms match "${rawName}".`,
            disambiguation: {
              kind: "partner_firm",
              options: firms.slice(0, 5).map((f) => ({ id: f.id, label: f.name })),
            },
          };
        }
        const [full] = await db
          .select()
          .from(atelierPartnerFirms)
          .where(eq(atelierPartnerFirms.id, firms[0].id))
          .limit(1);
        firm = full ?? null;
      }
    }

    const hits = await searchPartnerCapabilities(ctx.persona.orgId, query, {
      firmId: firm?.id,
      limit: firm ? 8 : 6,
    });
    const profile = firm?.capabilityProfile ?? null;
    if (!profile && hits.length === 0) {
      return {
        ok: true,
        data: {
          matches: [],
          note: firm
            ? `"${firm.name}" has no approved capability profile yet — run (or approve) the Alliance Cartographer evaluation on its firm page to research one.`
            : "No approved partner capability profiles matched. Profiles land after the Alliance Cartographer research is approved on each firm's Evaluation section.",
          pageHref: "/partners/identify",
        },
      };
    }
    return {
      ok: true,
      data: {
        query,
        firm: firm
          ? {
              id: firm.id,
              name: firm.name,
              partnershipStage: firm.partnershipStage,
              agreementStage: firm.agreementStage ?? null,
              speciality: firm.speciality ?? null,
              capabilitySummary: profile?.summary ?? null,
              domains: (profile?.domains ?? []).map((d) => ({
                label: d.label,
                description: d.description,
                evidence: d.evidence,
                sourceUrls: d.sourceUrls ?? [],
              })),
              researchedAt: profile?.researchedAt ?? null,
            }
          : null,
        matches: hits.map((h) => ({
          firmId: h.firmId,
          firmName: h.firmName,
          domain: h.domain,
          text: h.text,
          sourceUrls: h.sourceUrls,
          score: h.score,
        })),
        citationNote:
          "Cite the sourceUrls attached to each matched chunk/domain when stating a capability claim.",
        pageHref: "/partners/identify",
      },
    };
  },
});
