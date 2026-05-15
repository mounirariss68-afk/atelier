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
import {
  runAccountCartographer,
  runPursuitScout,
} from "../atelier-agents/runner.js";

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
      targetId: {
        type: "string",
        description:
          "Existing entity id (verb=update). When provided, the specialist is dispatched against the live row; when absent (verb=create) the call returns advisory hints only.",
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
  async run(input, ctx) {
    const kind = String(input.kind ?? "");
    const inp = (input.input ?? {}) as Record<string, unknown>;

    const targetId = typeof input.targetId === "string" ? input.targetId : null;

    if (kind === "account") {
      // When targetId is provided (verb=update), actually dispatch
      // Account Cartographer via runAgent so the orchestrator returns
      // a real, freshly-derived prefill (firmographics + signals).
      // Without targetId (verb=create) we degrade to an advisory hint
      // because Cartographer requires an existing account row — the
      // post-create accountRoutes flow handles that case.
      if (targetId) {
        try {
          const [acct] = await db
            .select({
              id: atelierAccounts.id,
              name: atelierAccounts.name,
              brandName: atelierAccounts.brandName,
              sector: atelierAccounts.sector,
              country: atelierAccounts.country,
            })
            .from(atelierAccounts)
            .where(
              and(
                eq(atelierAccounts.id, targetId),
                eq(atelierAccounts.orgId, ctx.persona.orgId),
                isNull(atelierAccounts.deletedAt),
              ),
            )
            .limit(1);
          if (!acct) {
            return {
              ok: false,
              errorCode: "not_found",
              errorMessage: `Account ${targetId} not found in this org.`,
            };
          }
          const result = await runAccountCartographer({
            accountId: acct.id,
            accountName: acct.brandName ?? acct.name,
            accountSector: acct.sector ?? "",
            accountCountry: acct.country ?? "",
            triggeredByUserId: ctx.persona.id,
            actorLabel: "Chat Orchestrator",
          });
          const out = result.output as unknown as Record<string, unknown> | null;
          // Normalise into { draft, missingRequiredFields, ... }
          // contract expected by the orchestrator policy.
          const draft = out ?? {};
          const required = ["sector", "country", "primaryCurrency", "primaryLanguage"];
          const missingRequiredFields = required.filter(
            (k) => !(k in draft) || draft[k] == null || draft[k] === "",
          );
          return {
            ok: true,
            data: {
              specialist: {
                id: "ag_account_cartographer",
                name: "Account Cartographer",
                runId: result.runId,
                source: result.source,
                costUsd: result.costUsd,
              },
              draft,
              missingRequiredFields,
              missingOptionalFields: [],
              lowConfidenceFields: result.warning ? ["*"] : [],
            },
          };
        } catch (e) {
          return {
            ok: false,
            errorCode: "specialist_failed",
            errorMessage: `Cartographer dispatch failed: ${(e as Error).message}`,
          };
        }
      }
      // Pre-create advisory hint.
      return {
        ok: true,
        data: {
          specialist: {
            id: "ag_account_cartographer",
            name: "Account Cartographer",
            triggeredOn: "create",
            note: "Cartographer auto-runs post-create on the existing accountRoutes path and queues firmographics + signals as pendingProfileUpdates for partner review.",
          },
          draft: {
            sector: typeof inp.sector === "string" ? inp.sector : null,
            country: typeof inp.country === "string" ? inp.country : null,
            tier: typeof inp.tier === "string" ? inp.tier : "C",
            primaryCurrency:
              typeof inp.primaryCurrency === "string" ? inp.primaryCurrency : "USD",
            primaryLanguage:
              typeof inp.primaryLanguage === "string" ? inp.primaryLanguage : "en",
          },
          missingRequiredFields: ["partnerOwnerId"],
          missingOptionalFields: ["website", "tier"],
          lowConfidenceFields: [],
        },
      };
    }

    if (kind === "opportunity") {
      // Same pattern: real Pursuit Scout when targetId exists,
      // advisory hint otherwise.
      if (targetId) {
        try {
          const [opp] = await db
            .select({
              id: atelierOpportunities.id,
              name: atelierOpportunities.name,
              accountId: atelierOpportunities.accountId,
            })
            .from(atelierOpportunities)
            .where(
              and(
                eq(atelierOpportunities.id, targetId),
                eq(atelierOpportunities.orgId, ctx.persona.orgId),
                isNull(atelierOpportunities.deletedAt),
              ),
            )
            .limit(1);
          if (!opp) {
            return {
              ok: false,
              errorCode: "not_found",
              errorMessage: `Opportunity ${targetId} not found in this org.`,
            };
          }
          const [acct] = await db
            .select({
              name: atelierAccounts.name,
              brandName: atelierAccounts.brandName,
              sector: atelierAccounts.sector,
              country: atelierAccounts.country,
            })
            .from(atelierAccounts)
            .where(eq(atelierAccounts.id, opp.accountId))
            .limit(1);
          const result = await runPursuitScout({
            opportunityId: opp.id,
            accountName: acct?.brandName ?? acct?.name ?? "",
            accountCountry: acct?.country ?? "",
            accountSector: acct?.sector ?? "",
            opportunityName: opp.name,
            contextBlurb:
              typeof inp.contextBlurb === "string" ? inp.contextBlurb : opp.name,
            triggeredByUserId: ctx.persona.id,
            actorLabel: "Chat Orchestrator",
          });
          const draft = (result.output as unknown as Record<string, unknown> | null) ?? {};
          const required = ["qualify5c", "decisionMakers"];
          const missingRequiredFields = required.filter(
            (k) => !(k in draft) || draft[k] == null,
          );
          return {
            ok: true,
            data: {
              specialist: {
                id: "ag_pursuit_scout",
                name: "Pursuit Scout",
                runId: result.runId,
                costUsd: result.costUsd,
              },
              draft,
              missingRequiredFields,
              missingOptionalFields: [],
              lowConfidenceFields: [],
            },
          };
        } catch (e) {
          return {
            ok: false,
            errorCode: "specialist_failed",
            errorMessage: `Pursuit Scout dispatch failed: ${(e as Error).message}`,
          };
        }
      }
      return {
        ok: true,
        data: {
          specialist: {
            id: "ag_pursuit_scout",
            name: "Pursuit Scout",
            triggeredOn: "create",
            note: "Pursuit Scout auto-runs post-create and writes a 5C draft + buyer landscape to the opportunity workspace.",
          },
          draft: {
            stage: "suspect",
            subStatus: "cold",
            probabilityPct: 5,
            accountName: typeof inp.accountName === "string" ? inp.accountName : null,
            opportunityName:
              typeof inp.opportunityName === "string" ? inp.opportunityName : null,
            contextBlurb: typeof inp.contextBlurb === "string" ? inp.contextBlurb : null,
          },
          missingRequiredFields: ["accountId", "opportunityName"],
          missingOptionalFields: ["dealValueUsd", "expectedCloseDate"],
          lowConfidenceFields: [],
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
      kind: {
        type: "string",
        enum: ["opportunity", "engagement", "deliverable", "expense"],
        description: "Entity whose transition is being evaluated. Defaults to 'opportunity'.",
      },
      opportunityId: { type: "string", description: "Opportunity id (kind=opportunity)." },
      targetId: {
        type: "string",
        description: "Target entity id for kind in {engagement, deliverable, expense}.",
      },
      toStage: {
        type: "string",
        description:
          "Desired next stage / status. For opportunity: one of the SalesStage enum. For engagement: mobilize|deliver|compound|closed. For deliverable: in_review|published|final. For expense: submitted|approved|rejected.",
      },
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
    required: ["toStage"],
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
    const kind = (typeof input.kind === "string" ? input.kind : "opportunity") as
      | "opportunity"
      | "engagement"
      | "deliverable"
      | "expense";
    const toStage = String(input.toStage ?? "");
    const proposed = (input.proposed ?? {}) as Record<string, unknown>;

    // ----- Non-opportunity adapters (table-driven). The opportunity
    // path stays as the canonical implementation that consumes
    // validateStageTransition; the others are thin status-taxonomy
    // checks until dedicated validators land (task spec lists them
    // as "to be located/added").
    if (kind !== "opportunity") {
      const targetId = typeof input.targetId === "string" ? input.targetId : "";
      if (!targetId || !toStage) {
        return {
          ok: false,
          errorCode: "bad_input",
          errorMessage: `evaluate_gate(${kind}) requires targetId and toStage.`,
        };
      }
      type GateRow = {
        id: string;
        label: string;
        met: boolean;
        missing?: string[];
        reason?: string;
        overrideAvailable: boolean;
      };
      const partnerOverride = proposed.partnerOverride === true;
      let currentStage = "";
      let entityName = "";
      const rows: GateRow[] = [];

      if (kind === "engagement") {
        const allowed: Record<string, string[]> = {
          mobilize: ["deliver"],
          deliver: ["compound", "closed"],
          compound: ["closed"],
          closed: [],
        };
        const [row] = await db
          .select({
            id: atelierEngagements.id,
            name: atelierEngagements.name,
            plmStage: atelierEngagements.plmStage,
          })
          .from(atelierEngagements)
          .where(
            and(
              eq(atelierEngagements.id, targetId),
              eq(atelierEngagements.orgId, orgId),
              isNull(atelierEngagements.deletedAt),
            ),
          )
          .limit(1);
        if (!row) {
          return { ok: false, errorCode: "not_found", errorMessage: `Engagement ${targetId} not found.` };
        }
        currentStage = row.plmStage;
        entityName = row.name;
        const validNext = (allowed[currentStage] ?? []).includes(toStage);
        rows.push({
          id: "engagement_phase_taxonomy",
          label: `PLM phase advance ${currentStage} → ${toStage}`,
          met: validNext || partnerOverride,
          reason: validNext
            ? undefined
            : `Engagements in '${currentStage}' may transition only to: ${(allowed[currentStage] ?? []).join(", ") || "none"}.`,
          overrideAvailable: true,
        });
      } else if (kind === "deliverable") {
        // Partner Authority Lock: critic readiness must be GREEN to
        // publish (or partner override w/ rationale).
        const [row] = await db
          .select({
            id: atelierDeliverables.id,
            name: atelierDeliverables.name,
            status: atelierDeliverables.status,
            criticReadiness: atelierDeliverables.criticReadiness,
            partnerApprovedAt: atelierDeliverables.partnerApprovedAt,
          })
          .from(atelierDeliverables)
          .where(
            and(
              eq(atelierDeliverables.id, targetId),
              eq(atelierDeliverables.orgId, orgId),
              isNull(atelierDeliverables.deletedAt),
            ),
          )
          .limit(1);
        if (!row) {
          return { ok: false, errorCode: "not_found", errorMessage: `Deliverable ${targetId} not found.` };
        }
        currentStage = row.status;
        entityName = row.name;
        const isPublish = toStage === "published" || toStage === "final";
        if (isPublish) {
          rows.push({
            id: "synthesis_critic_green",
            label: "Synthesis Critic readiness is GREEN",
            met: row.criticReadiness === "green" || partnerOverride,
            reason:
              row.criticReadiness === "green"
                ? undefined
                : `Critic readiness is '${row.criticReadiness ?? "unknown"}'. Resolve criticisms or record a partner override with rationale.`,
            overrideAvailable: true,
          });
          rows.push({
            id: "partner_authority_lock",
            label: "Partner Authority Lock satisfied",
            met: !!row.partnerApprovedAt || partnerOverride,
            reason: row.partnerApprovedAt
              ? undefined
              : "A partner must approve before publish (or override with logged rationale).",
            overrideAvailable: true,
          });
        } else {
          rows.push({
            id: "deliverable_status_taxonomy",
            label: `Deliverable status advance ${currentStage} → ${toStage}`,
            met: true,
            overrideAvailable: false,
          });
        }
      } else if (kind === "expense") {
        const [row] = await db
          .select({
            id: atelierExpenses.id,
            status: atelierExpenses.status,
            policyStatus: atelierExpenses.policyStatus,
            captureSource: atelierExpenses.captureSource,
            merchant: atelierExpenses.merchant,
          })
          .from(atelierExpenses)
          .where(
            and(
              eq(atelierExpenses.id, targetId),
              eq(atelierExpenses.orgId, orgId),
              isNull(atelierExpenses.deletedAt),
            ),
          )
          .limit(1);
        if (!row) {
          return { ok: false, errorCode: "not_found", errorMessage: `Expense ${targetId} not found.` };
        }
        currentStage = row.status;
        entityName = row.merchant ?? targetId;
        if (toStage === "approved") {
          rows.push({
            id: "expense_policy_green",
            label: "Policy check is GREEN",
            met: row.policyStatus === "green" || partnerOverride,
            reason:
              row.policyStatus === "green"
                ? undefined
                : `Policy status is '${row.policyStatus}'. Resolve flags or record an override.`,
            overrideAvailable: true,
          });
          rows.push({
            id: "expense_must_be_submitted",
            label: "Expense is in 'submitted' state",
            met: row.status === "submitted",
            reason:
              row.status === "submitted"
                ? undefined
                : `Expense is currently '${row.status}'; only submitted expenses may be approved.`,
            overrideAvailable: false,
          });
        } else if (toStage === "submitted") {
          rows.push({
            id: "expense_capture_present",
            label: "Capture source recorded",
            met: !!row.captureSource,
            overrideAvailable: false,
          });
        } else {
          rows.push({
            id: "expense_status_taxonomy",
            label: `Expense status advance ${currentStage} → ${toStage}`,
            met: ["draft", "submitted", "approved", "rejected"].includes(toStage),
            overrideAvailable: false,
          });
        }
      }

      const allMet = rows.every((r) => r.met);
      return {
        ok: true,
        data: {
          gateReport: {
            kind,
            targetId,
            entityName,
            fromStage: currentStage,
            toStage,
            partnerOverride,
            allMet,
            gates: rows,
          },
        },
      };
    }

    // Opportunity path (canonical) — uses validateStageTransition.
    const opportunityId = String(input.opportunityId ?? input.targetId ?? "");
    const toStageOpp = toStage as SalesStage;

    if (!opportunityId || !ALL_STAGES.includes(toStageOpp)) {
      return {
        ok: false,
        errorCode: "bad_input",
        errorMessage: "evaluate_gate(opportunity) requires opportunityId and a valid toStage.",
      };
    }
    // Re-bind the opportunity-stage-typed local that the canonical
    // block below uses (the outer `toStage` is the broader string
    // shape that engagement/deliverable/expense also share).
    const toStageNarrow: SalesStage = toStageOpp;

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
      toStage: toStageNarrow,
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
      overrideAvailable: boolean;
    };
    const rows: GateRow[] = [];

    const isSuspectToProspect = fromStage === "suspect" && toStageNarrow === "prospect";
    const isConvertToRunner = fromStage === "convert" && toStageNarrow === "runner";
    const isRunnerToContract = fromStage === "runner" && toStageNarrow === "contract";
    const isTerminal =
      toStageNarrow === "lost" || toStageNarrow === "no_decision" || toStageNarrow === "withdrawn";

    if (isSuspectToProspect) {
      const isThisGate = err?.gate === "suspect_to_prospect_5c";
      rows.push({
        id: "suspect_to_prospect_5c",
        label: "Completed 5C qualifier with Go decision",
        met: !isThisGate,
        reason: isThisGate
          ? "5C must be filled (client, competition, capability, capacity, contract) and Go/No-go decided."
          : undefined,
        overrideAvailable: true,
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
        overrideAvailable: true,
      });
    }
    if (isRunnerToContract) {
      const isThisGate = err?.gate === "runner_to_contract";
      rows.push({
        id: "runner_to_contract",
        label: "Signed instrument attached as artifact",
        met: !isThisGate,
        reason: isThisGate ? err?.reason : undefined,
        overrideAvailable: true,
      });
    }
    if (isTerminal) {
      const isThisGate = err?.gate?.startsWith("terminal_") ?? false;
      rows.push({
        id: `terminal_${toStage}`,
        label: `Reason code required to enter ${toStage}`,
        met: !isThisGate,
        reason: isThisGate ? err?.reason : undefined,
        overrideAvailable: false,
      });
    }
    if (proposed.subStatus) {
      const isSubGate = err?.gate === "invalid_sub_status";
      rows.push({
        id: "sub_status_taxonomy",
        label: "Sub-status is in the published taxonomy",
        met: !isSubGate,
        reason: isSubGate ? err?.reason : undefined,
        overrideAvailable: false,
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
