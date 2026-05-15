/**
 * Task #406 — Chat Orchestrator capabilities.
 *
 * Four read/write verbs that turn the existing Sonnet tool-use loop
 * into a coordinator for create | update | link | transition across
 * the seven core entities (account, opportunity, contact, engagement,
 * partner_link, deliverable, expense):
 *
 *   1. `resolve_entity`            — fuzzy-name → id (or disambiguation).
 *   2. `prefill_from_specialist`   — dispatch the right specialist agent
 *                                    (cartographer / pursuit_scout / …)
 *                                    and return its suggestion as
 *                                    advisory prefill.
 *   3. `evaluate_gate`             — pure-read wrapper around
 *                                    validateStageTransition; returns a
 *                                    structured gateReport. Loads the
 *                                    opportunity's persisted gate
 *                                    evidence (qualify5c, goNoGoDecision)
 *                                    so suspect→prospect can pass when
 *                                    those fields are already on the row.
 *   4. `propose_write`             — wraps a mutation in the standard
 *                                    two-phase confirmation envelope so
 *                                    the user clicks Commit; on commit
 *                                    returns a dispatch payload that
 *                                    points the client at the existing
 *                                    entity route. The orchestrator
 *                                    never writes directly.
 *
 * Tenant isolation: every DB query is scoped by `ctx.persona.orgId` and
 * filters `deletedAt IS NULL`. The catalog gate (`requiredRoles`) plus
 * the orchestrator's two-phase confirm flow handle role-level ACL; the
 * org + soft-delete filters here are defence in depth.
 *
 * Architectural note — these capabilities live alongside the rest of
 * the catalog and reach Claude through the same `getToolsForPersona`
 * filter. The orchestration logic is the existing `runTurn` loop +
 * the orchestrator policy appended to SYSTEM_PROMPT in `index.ts`
 * (mirrors `prompts/chat_orchestrator/v1.md`). Claude decides which of
 * these tools to call and in what order. The runner does not know
 * about "the orchestrator" as a separate object.
 */

import { and, eq, ilike, isNull, or } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierContacts,
  atelierDeliverables,
  atelierExpenses,
} from "@workspace/db";
import { defineCapability, CATALOG_SCHEMA_VERSION } from "./capability-catalog.js";
import {
  validateStageTransition,
  type StageGateInput,
} from "../atelier-agents/pipeline.js";
import type { SalesStage } from "../atelier-agents/pipeline.js";

const FUZZY_LIMIT = 5;

type ResolvableKind =
  | "account"
  | "opportunity"
  | "engagement"
  | "contact"
  | "deliverable"
  | "expense";

type WriteVerb = "create" | "update" | "link" | "transition";
type WriteKind = ResolvableKind | "partner_link";

const ROUTE_HINTS: Record<WriteKind, Partial<Record<WriteVerb, string>>> = {
  account: {
    create: "POST /atelier/accounts",
    update: "PATCH /atelier/accounts/:id",
    link: "POST /atelier/accounts/:id/links",
  },
  opportunity: {
    create: "POST /atelier/opportunities",
    update: "PATCH /atelier/opportunities/:id",
    transition: "POST /atelier/opportunities/:id/stage-transition",
  },
  contact: {
    create: "POST /atelier/contacts",
    update: "PATCH /atelier/contacts/:id",
    link: "POST /atelier/contacts/:id/links",
  },
  engagement: {
    create: "POST /atelier/engagements",
    update: "PATCH /atelier/engagements/:id",
  },
  partner_link: {
    create: "POST /atelier/partner-links",
    link: "POST /atelier/partner-links",
  },
  deliverable: {
    create: "POST /atelier/deliverables",
    update: "PATCH /atelier/deliverables/:id",
  },
  expense: {
    create: "POST /atelier/expenses",
    update: "PATCH /atelier/expenses/:id",
  },
};

// ---------------------------------------------------------------------
// 1. resolve_entity
// ---------------------------------------------------------------------

defineCapability({
  id: "orchestrator.resolve_entity",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "resolve_entity",
  description:
    "Translate a fuzzy entity reference (free-text name or partial id) into a single canonical entity. Returns either {entity} on a unique match, a disambiguation envelope on multiple matches, or a clarification on no match. Always scoped to the caller's org and excludes soft-deleted rows.",
  slashAliases: { en: ["/resolve"] },
  representativePrompts: {
    en: ["Resolve which Acme opportunity I mean.", "Find the contact named Sarah Patel."],
  },
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["account", "opportunity", "engagement", "contact", "deliverable", "expense"],
      },
      query: { type: "string", description: "Fuzzy name or id fragment." },
      scopeAccountId: { type: "string" },
      scopeEngagementId: { type: "string" },
    },
    required: ["kind", "query"],
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_resolution",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    const orgId = ctx.persona.orgId;
    const kind = String(input.kind ?? "") as ResolvableKind;
    const query = String(input.query ?? "").trim();
    const scopeAccountId = typeof input.scopeAccountId === "string" ? input.scopeAccountId : null;
    const scopeEngagementId =
      typeof input.scopeEngagementId === "string" ? input.scopeEngagementId : null;
    if (!query) {
      return {
        ok: false,
        errorCode: "missing_query",
        errorMessage: "resolve_entity requires a non-empty query string.",
      };
    }
    const like = `%${query.replace(/[%_]/g, "")}%`;

    let rows: Array<{ id: string; label: string; secondary?: string }> = [];

    if (kind === "account") {
      const r = await db
        .select({
          id: atelierAccounts.id,
          name: atelierAccounts.name,
          brandName: atelierAccounts.brandName,
          country: atelierAccounts.country,
        })
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.orgId, orgId),
            isNull(atelierAccounts.deletedAt),
            or(
              ilike(atelierAccounts.name, like),
              ilike(atelierAccounts.brandName, like),
              eq(atelierAccounts.id, query),
            ),
          ),
        )
        .limit(FUZZY_LIMIT);
      rows = r.map((a) => ({
        id: a.id,
        label: a.brandName ?? a.name,
        secondary: a.country ?? undefined,
      }));
    } else if (kind === "opportunity") {
      const conds = [
        eq(atelierOpportunities.orgId, orgId),
        isNull(atelierOpportunities.deletedAt),
        or(ilike(atelierOpportunities.name, like), eq(atelierOpportunities.id, query)),
      ];
      if (scopeAccountId) conds.push(eq(atelierOpportunities.accountId, scopeAccountId));
      const r = await db
        .select({
          id: atelierOpportunities.id,
          name: atelierOpportunities.name,
          accountId: atelierOpportunities.accountId,
          salesStage: atelierOpportunities.salesStage,
        })
        .from(atelierOpportunities)
        .where(and(...conds))
        .limit(FUZZY_LIMIT);
      rows = r.map((o) => ({
        id: o.id,
        label: o.name,
        secondary: `stage: ${o.salesStage}`,
      }));
    } else if (kind === "engagement") {
      const r = await db
        .select({
          id: atelierEngagements.id,
          name: atelierEngagements.name,
          accountId: atelierEngagements.accountId,
        })
        .from(atelierEngagements)
        .where(
          and(
            eq(atelierEngagements.orgId, orgId),
            isNull(atelierEngagements.deletedAt),
            or(ilike(atelierEngagements.name, like), eq(atelierEngagements.id, query)),
          ),
        )
        .limit(FUZZY_LIMIT);
      rows = r.map((e) => ({ id: e.id, label: e.name }));
    } else if (kind === "contact") {
      const conds = [
        eq(atelierContacts.orgId, orgId),
        isNull(atelierContacts.deletedAt),
        or(ilike(atelierContacts.fullName, like), eq(atelierContacts.id, query)),
      ];
      if (scopeAccountId) conds.push(eq(atelierContacts.accountId, scopeAccountId));
      const r = await db
        .select({
          id: atelierContacts.id,
          fullName: atelierContacts.fullName,
          title: atelierContacts.title,
          accountId: atelierContacts.accountId,
        })
        .from(atelierContacts)
        .where(and(...conds))
        .limit(FUZZY_LIMIT);
      rows = r.map((c) => ({
        id: c.id,
        label: c.fullName,
        secondary: c.title ?? undefined,
      }));
    } else if (kind === "deliverable") {
      const conds = [
        eq(atelierDeliverables.orgId, orgId),
        isNull(atelierDeliverables.deletedAt),
        or(ilike(atelierDeliverables.name, like), eq(atelierDeliverables.id, query)),
      ];
      if (scopeEngagementId)
        conds.push(eq(atelierDeliverables.engagementId, scopeEngagementId));
      const r = await db
        .select({
          id: atelierDeliverables.id,
          name: atelierDeliverables.name,
          engagementId: atelierDeliverables.engagementId,
        })
        .from(atelierDeliverables)
        .where(and(...conds))
        .limit(FUZZY_LIMIT);
      rows = r.map((d) => ({ id: d.id, label: d.name }));
    } else if (kind === "expense") {
      // Expenses don't have a name column — accept id-prefix lookup only.
      const r = await db
        .select({ id: atelierExpenses.id })
        .from(atelierExpenses)
        .where(
          and(
            eq(atelierExpenses.orgId, orgId),
            isNull(atelierExpenses.deletedAt),
            eq(atelierExpenses.id, query),
          ),
        )
        .limit(FUZZY_LIMIT);
      rows = r.map((e) => ({ id: e.id, label: e.id }));
    }

    if (rows.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `No ${kind} matched "${query}".`,
        clarification: {
          field: "query",
          tool: "resolve_entity",
          question: `I couldn't find a ${kind} matching "${query}". Try a different name or paste the id.`,
          partial: { kind, scopeAccountId, scopeEngagementId },
          suggestions: [],
        },
      };
    }

    if (rows.length === 1) {
      return {
        ok: true,
        data: {
          entity: { kind, id: rows[0].id, label: rows[0].label, secondary: rows[0].secondary },
        },
      };
    }

    return {
      ok: true,
      data: { kind, candidateCount: rows.length },
      disambiguation: {
        kind,
        options: rows.map((r) => ({ id: r.id, label: r.label, hint: r.secondary ?? "" })),
      },
    };
  },
});

// ---------------------------------------------------------------------
// 2. prefill_from_specialist
// ---------------------------------------------------------------------

defineCapability({
  id: "orchestrator.prefill_from_specialist",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "prefill_from_specialist",
  description:
    "Return advisory prefill data for an entity that is about to be created or enriched. Routes account → Account Cartographer, opportunity → Pursuit Scout, contact/engagement → stub. The result is advisory — the user always edits it on the confirm card.",
  slashAliases: { en: ["/prefill"] },
  representativePrompts: {
    en: ["Prefill an account brief for Acme.", "Suggest defaults for the new Tasama opportunity."],
  },
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["account", "opportunity", "contact", "engagement"],
      },
      input: {
        type: "object",
        additionalProperties: true,
        description: "Free-form context the specialist will use as input.",
      },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "agent_run",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input) {
    const kind = String(input.kind ?? "");
    const inp = (input.input ?? {}) as Record<string, unknown>;

    if (kind === "account") {
      // We do NOT actually fire Account Cartographer here — the
      // existing pre-create accountRoutes flow already auto-runs it
      // and persists pendingProfileUpdates. This capability returns
      // the dispatch hint + a structured prefill stub the LLM can
      // surface so the user knows what to expect.
      return {
        ok: true,
        data: {
          specialist: {
            id: "ag_account_cartographer",
            name: "Account Cartographer",
            triggeredOn: "create",
            note: "Cartographer auto-runs after the account is created and queues firmographics + signals as pendingProfileUpdates for partner review.",
          },
          prefill: {
            sector: typeof inp.sector === "string" ? inp.sector : null,
            country: typeof inp.country === "string" ? inp.country : null,
            tier: typeof inp.tier === "string" ? inp.tier : "C",
            primaryCurrency:
              typeof inp.primaryCurrency === "string" ? inp.primaryCurrency : "USD",
            primaryLanguage:
              typeof inp.primaryLanguage === "string" ? inp.primaryLanguage : "en",
          },
        },
      };
    }

    if (kind === "opportunity") {
      return {
        ok: true,
        data: {
          specialist: {
            id: "ag_pursuit_scout",
            name: "Pursuit Scout",
            triggeredOn: "create",
            note: "Pursuit Scout auto-runs after the opportunity is created and writes a 5C draft + buyer landscape to the opportunity workspace.",
          },
          prefill: {
            stage: "suspect",
            subStatus: "cold",
            probabilityPct: 5,
            accountName: typeof inp.accountName === "string" ? inp.accountName : null,
            opportunityName:
              typeof inp.opportunityName === "string" ? inp.opportunityName : null,
            contextBlurb: typeof inp.contextBlurb === "string" ? inp.contextBlurb : null,
          },
        },
      };
    }

    if (kind === "contact") {
      return {
        ok: true,
        data: {
          specialist: {
            id: "ag_contact_enricher",
            name: "Contact Enricher (stub)",
            triggeredOn: "create",
            note: "Contact enrichment is not yet implemented; surface this prefill to the user as a starting point.",
          },
          prefill: {
            name: typeof inp.name === "string" ? inp.name : null,
            email: typeof inp.email === "string" ? inp.email : null,
            title: typeof inp.title === "string" ? inp.title : null,
            accountId: typeof inp.accountId === "string" ? inp.accountId : null,
          },
        },
      };
    }

    if (kind === "engagement") {
      return {
        ok: true,
        data: {
          specialist: {
            id: "ag_engagement_planner",
            name: "Engagement Planner (stub)",
            triggeredOn: "create",
            note: "Engagement planning is not yet implemented; Charter Architect will run on first signed instrument.",
          },
          prefill: {
            name: typeof inp.name === "string" ? inp.name : null,
            accountId: typeof inp.accountId === "string" ? inp.accountId : null,
            startDate: typeof inp.startDate === "string" ? inp.startDate : null,
          },
        },
      };
    }

    return {
      ok: false,
      errorCode: "unknown_kind",
      errorMessage: `prefill_from_specialist does not support kind "${kind}".`,
    };
  },
});

// ---------------------------------------------------------------------
// 3. evaluate_gate
// ---------------------------------------------------------------------

const ALL_STAGES: SalesStage[] = [
  "suspect",
  "prospect",
  "convert",
  "runner",
  "contract",
  "lost",
  "no_decision",
  "withdrawn",
];

defineCapability({
  id: "orchestrator.evaluate_gate",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "evaluate_gate",
  description:
    "Pure-read evaluation of a sales-stage transition gate. Loads the opportunity (org-scoped, deletedAt IS NULL) along with its persisted gate evidence (qualify5c, goNoGoDecision), merges any `proposed` overrides, runs validateStageTransition, and returns a structured gateReport with rows per gate ({id, label, met, missing, reason}). NEVER mutates anything.",
  slashAliases: { en: ["/gate"] },
  representativePrompts: {
    en: [
      "Check the gate to move opp_xyz to runner.",
      "Can we transition Acme to contract?",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      toStage: { type: "string", enum: ALL_STAGES },
      proposed: {
        type: "object",
        properties: {
          decider: { type: "string" },
          verbalCommitDate: { type: "string" },
          signaturePath: { type: "string" },
          signedInstrumentFileId: { type: "string" },
          reasonCode: { type: "string" },
          subStatus: { type: "string" },
          partnerOverride: { type: "boolean" },
          qualify5c: { type: "object", additionalProperties: true },
          goNoGoDecision: { type: "object", additionalProperties: true },
          evidenceArtifactIds: { type: "array", items: { type: "string" } },
        },
        additionalProperties: true,
      },
    },
    required: ["opportunityId", "toStage"],
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "gate_report",
  irreversible: false,
  surfaceOn: ["opportunity_workspace", "global"],
  source: "cli-only",
  async run(input, ctx) {
    const orgId = ctx.persona.orgId;
    const opportunityId = String(input.opportunityId ?? "");
    const toStage = String(input.toStage ?? "") as SalesStage;
    const proposed = (input.proposed ?? {}) as Record<string, unknown>;

    if (!opportunityId || !ALL_STAGES.includes(toStage)) {
      return {
        ok: false,
        errorCode: "bad_input",
        errorMessage: "evaluate_gate requires opportunityId and a valid toStage.",
      };
    }

    // Org-scoped + soft-delete-filtered load including persisted gate
    // evidence — without this, suspect→prospect always reports "5C
    // missing" even when the opportunity row already has a complete
    // qualify_5c blob and a Go decision.
    const [opp] = await db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        salesStage: atelierOpportunities.salesStage,
        qualify5c: atelierOpportunities.qualify5c,
        goNoGoDecision: atelierOpportunities.goNoGoDecision,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.id, opportunityId),
          eq(atelierOpportunities.orgId, orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      )
      .limit(1);

    if (!opp) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `Opportunity ${opportunityId} not found in this org.`,
      };
    }

    const fromStage = opp.salesStage as SalesStage;
    const partnerOverride = proposed.partnerOverride === true;

    // Merge persisted evidence with proposed overrides — proposed wins
    // so the LLM can preview the gate result with hypothetical edits
    // before propose_write is called.
    const mergedQualify5c =
      (proposed.qualify5c as StageGateInput["qualify5c"]) ?? opp.qualify5c ?? null;
    const mergedGoNoGo =
      (proposed.goNoGoDecision as StageGateInput["goNoGoDecision"]) ??
      (opp.goNoGoDecision
        ? { decision: opp.goNoGoDecision.decision }
        : null);
    const mergedEvidenceArtifactIds = Array.isArray(proposed.evidenceArtifactIds)
      ? (proposed.evidenceArtifactIds as string[])
      : null;

    const gateInput: StageGateInput = {
      fromStage,
      toStage,
      partnerOverride,
      qualify5c: mergedQualify5c,
      goNoGoDecision: mergedGoNoGo,
      decider: typeof proposed.decider === "string" ? proposed.decider : null,
      verbalCommitDate:
        typeof proposed.verbalCommitDate === "string" ? proposed.verbalCommitDate : null,
      signaturePath:
        typeof proposed.signaturePath === "string" ? proposed.signaturePath : null,
      signedInstrumentFileId:
        typeof proposed.signedInstrumentFileId === "string"
          ? proposed.signedInstrumentFileId
          : null,
      evidenceArtifactIds: mergedEvidenceArtifactIds,
      reasonCode: typeof proposed.reasonCode === "string" ? proposed.reasonCode : null,
      subStatus: typeof proposed.subStatus === "string" ? proposed.subStatus : null,
    };

    const err = validateStageTransition(gateInput);

    // Synthesize one row per gate that applies to the move so the
    // client can render a checklist. We always include the sub-status
    // taxonomy row when a sub-status was proposed (it is enforced
    // even with partnerOverride).
    type GateRow = {
      id: string;
      label: string;
      met: boolean;
      missing?: string[];
      reason?: string;
      partnerOverridable: boolean;
    };
    const rows: GateRow[] = [];

    const isSuspectToProspect = fromStage === "suspect" && toStage === "prospect";
    const isConvertToRunner = fromStage === "convert" && toStage === "runner";
    const isRunnerToContract = fromStage === "runner" && toStage === "contract";
    const isTerminal =
      toStage === "lost" || toStage === "no_decision" || toStage === "withdrawn";

    if (isSuspectToProspect) {
      const isThisGate = err?.gate === "suspect_to_prospect_5c";
      rows.push({
        id: "suspect_to_prospect_5c",
        label: "Completed 5C qualifier with Go decision",
        met: !isThisGate,
        reason: isThisGate
          ? "5C must be filled (client, competition, capability, capacity, contract) and Go/No-go decided."
          : undefined,
        partnerOverridable: true,
      });
    }
    if (isConvertToRunner) {
      const isThisGate = err?.gate === "convert_to_runner";
      rows.push({
        id: "convert_to_runner",
        label: "Named decider + verbal-commit date + signature path",
        met: !isThisGate,
        missing: isThisGate ? err?.missing ?? [] : [],
        reason: isThisGate ? err?.reason : undefined,
        partnerOverridable: true,
      });
    }
    if (isRunnerToContract) {
      const isThisGate = err?.gate === "runner_to_contract";
      rows.push({
        id: "runner_to_contract",
        label: "Signed instrument attached as artifact",
        met: !isThisGate,
        reason: isThisGate ? err?.reason : undefined,
        partnerOverridable: true,
      });
    }
    if (isTerminal) {
      const isThisGate = err?.gate?.startsWith("terminal_") ?? false;
      rows.push({
        id: `terminal_${toStage}`,
        label: `Reason code required to enter ${toStage}`,
        met: !isThisGate,
        reason: isThisGate ? err?.reason : undefined,
        partnerOverridable: false,
      });
    }
    if (proposed.subStatus) {
      const isSubGate = err?.gate === "invalid_sub_status";
      rows.push({
        id: "sub_status_taxonomy",
        label: "Sub-status is in the published taxonomy",
        met: !isSubGate,
        reason: isSubGate ? err?.reason : undefined,
        partnerOverridable: false,
      });
    }

    const allMet = rows.every((r) => r.met);

    return {
      ok: true,
      data: {
        gateReport: {
          opportunityId: opp.id,
          opportunityName: opp.name,
          fromStage,
          toStage,
          partnerOverride,
          allMet,
          gates: rows,
          // Surface what we loaded vs. what was proposed so the LLM
          // can mention it ("using the persisted 5C plus your new
          // verbal-commit date").
          evidenceSource: {
            qualify5cFromOpportunity: !proposed.qualify5c && !!opp.qualify5c,
            goNoGoFromOpportunity: !proposed.goNoGoDecision && !!opp.goNoGoDecision,
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------------
// 4. propose_write
// ---------------------------------------------------------------------

defineCapability({
  id: "orchestrator.propose_write",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "propose_write",
  description:
    "Wrap a proposed mutation (create | update | link | transition) in the standard two-phase confirmation envelope. The user reviews the diff and clicks Commit; on commit this capability returns a dispatch payload pointing the client at the existing entity route. The orchestrator never writes directly.",
  slashAliases: { en: ["/propose"] },
  representativePrompts: {
    en: [
      "Propose moving Acme to runner with the verbal commit on file.",
      "Propose creating a new opportunity for Tasama.",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      verb: { type: "string", enum: ["create", "update", "link", "transition"] },
      kind: {
        type: "string",
        enum: [
          "account",
          "opportunity",
          "contact",
          "engagement",
          "partner_link",
          "deliverable",
          "expense",
        ],
      },
      targetId: { type: "string", description: "Existing entity id for update/link/transition." },
      payload: {
        type: "object",
        additionalProperties: true,
        description: "The fields to write. For transition: { toStage, ...gateEvidence }.",
      },
      summary: {
        type: "string",
        description: "One-line human description of the change for the confirm card.",
      },
      confirm: {
        type: "boolean",
        description: "Set true on the second-phase /confirm POST.",
      },
    },
    required: ["verb", "kind", "payload"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input) {
    const verb = String(input.verb ?? "") as WriteVerb;
    const kind = String(input.kind ?? "") as WriteKind;
    const targetId = typeof input.targetId === "string" ? input.targetId : null;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const summary =
      typeof input.summary === "string" && input.summary.trim().length > 0
        ? input.summary.trim()
        : `${verb} ${kind}${targetId ? ` ${targetId}` : ""}`;
    const route = ROUTE_HINTS[kind]?.[verb] ?? `(no route registered for ${verb} ${kind})`;

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { stage: "preview", verb, kind, targetId, payload, route },
        confirmation: {
          summary,
          diff: {
            verb,
            kind,
            targetId,
            payload,
            route,
            note: "On commit, the client posts to the route above with the payload — the orchestrator never writes directly.",
          },
          pending: {
            tool: "propose_write",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    // Commit phase — return a dispatch hint. The client picks up the
    // payload + route from the tool_result and executes the existing
    // typed mutation via the standard React Query hook (which already
    // handles auth, optimistic updates, and audit).
    return {
      ok: true,
      data: {
        stage: "dispatched",
        verb,
        kind,
        targetId,
        payload,
        route,
        note: "Client should POST/PATCH the payload to the route to apply this change via the existing entity handler.",
      },
    };
  },
});
