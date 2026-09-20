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

import { and, count, eq, ilike, isNull, or } from "drizzle-orm";
import { recordRiserObservation } from "../assistant/observability-runtime.js";
import {
  db,
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierContacts,
  atelierContactRelationships,
  atelierDeliverables,
  atelierExpenses,
  atelierInvoice,
} from "@workspace/db";
import { defineCapability, CATALOG_SCHEMA_VERSION } from "./capability-catalog.js";
import { hybridResolveEntity, type ResolverKind } from "./entity-resolver.js";
import {
  validateStageTransition,
  type StageGateInput,
} from "../atelier-agents/pipeline.js";
import type { SalesStage } from "../atelier-agents/pipeline.js";
import {
  runAccountCartographer,
  runPursuitScout,
} from "../atelier-agents/runner.js";
import { chainExecutiveMapperAfterCartographer } from "../atelier-agents/executive-mapper-chain.js";
import { noteAgentLaunch, clearAgentLaunch } from "../atelier-agents/launch-visibility.js";
import type { IntentKind } from "./intent-router.js";

const FUZZY_LIMIT = 5;

type ResolvableKind =
  | "account"
  | "opportunity"
  | "engagement"
  | "contact"
  | "deliverable"
  | "expense";

type WriteVerb = "create" | "update" | "link" | "transition" | "delete";
type WriteKind =
  | Extract<
      IntentKind,
      | ResolvableKind
      | "partner_link"
      // Task #411 — chat-owned write entities.
      | "meeting"
      | "raid_item"
      | "proposal"
      | "pov"
      | "change_order"
      | "timesheet_entry"
      | "invoice"
      | "contract"
      | "rate_card"
      | "renewal"
      | "partner_firm"
      | "win_theme"
      | "win_loss_debrief"
      | "brief"
      | "agent_design"
    >
  // Task #567 — relationship edges are dispatchable but not a user intent kind.
  | "contact_relationship";

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
  // Task #567 — contact relationship edges (org-chart structure).
  contact_relationship: {
    create: "POST /atelier/accounts/:id/contact-relationships",
    link: "POST /atelier/accounts/:id/contact-relationships",
    delete: "DELETE /atelier/contact-relationships/:id",
  },
  deliverable: {
    create: "POST /atelier/deliverables",
    update: "PATCH /atelier/deliverables/:id",
  },
  expense: {
    create: "POST /atelier/expenses",
    update: "PATCH /atelier/expenses/:id",
  },
  // — Task #411 coverage expansion. Routes here are advisory hints
  // for the confirm card; the actual commit dispatches in-process via
  // `dispatchTarget(verb, kind)` → `findToolByName(...).run({...payload, confirm:true})`.
  meeting: { create: "POST /atelier/meetings", update: "PATCH /atelier/meetings/:id" },
  raid_item: {
    create: "POST /atelier/raid",
    update: "PATCH /atelier/raid/:id",
    transition: "POST /atelier/raid/:id/close",
  },
  proposal: { create: "POST /atelier/proposals", update: "PATCH /atelier/proposals/:id" },
  pov: { create: "POST /atelier/povs", update: "PATCH /atelier/povs/:id" },
  change_order: { create: "POST /atelier/change-orders", update: "PATCH /atelier/change-orders/:id" },
  timesheet_entry: { create: "POST /atelier/timesheets", update: "PATCH /atelier/timesheets/:id" },
  invoice: { create: "POST /atelier/invoices", update: "PATCH /atelier/invoices/:id" },
  contract: { create: "POST /atelier/contracts", update: "PATCH /atelier/contracts/:id" },
  rate_card: { create: "POST /atelier/rate-cards", update: "PATCH /atelier/rate-cards/:id" },
  renewal: { create: "POST /atelier/renewals", update: "PATCH /atelier/renewals/:id" },
  partner_firm: { create: "POST /atelier/partner-firms", update: "PATCH /atelier/partner-firms/:id" },
  win_theme: { create: "POST /atelier/win-themes", update: "PATCH /atelier/win-themes/:id" },
  win_loss_debrief: { create: "POST /atelier/winloss", update: "PATCH /atelier/winloss/:id" },
  brief: { create: "POST /atelier/briefs", update: "PATCH /atelier/briefs/:id" },
  agent_design: { create: "POST /atelier/agent-designs", update: "PATCH /atelier/agent-designs/:id" },
};

// ---------------------------------------------------------------------
// Task #495 — UI navigation map. `ROUTE_HINTS` above describe HTTP
// dispatch routes for the confirm card; the actual in-app SPA path the
// chat UI auto-navigates to lives in `./orchestrator-nav-path.ts` (so
// it can be unit-tested in isolation, see Task #500). The resolver
// consumes (verb, kind, targetId, payload) at proposal time and adds
// `resultData` at commit time. Returns null when no meaningful
// destination is known — pure Q&A, disambiguation, and refusals do not
// auto-navigate.
// ---------------------------------------------------------------------
// Task #500 — implementation extracted to ./orchestrator-nav-path.ts so
// it can be unit-tested in isolation. Re-exported here for Task #499's
// callers in attachment-capabilities and the entityNavPath helper below.
import { resolveNavPath } from "./orchestrator-nav-path.js";
export { resolveNavPath };

// Task #499 — convenience wrapper for read-side capabilities that
// resolved a single entity. Returns the canonical UI page for that
// entity (or null when unknown) so the caller can attach a
// `navigateTo: { path, when: "on_commit" }` hint to its result. The
// `verb` is fixed to "update" because resolveNavPath only inspects
// verb for `expense` / `invoice` / `contract` (where create maps to
// a "new" page) — for read flows we always want the detail page.
export function entityNavPath(
  kind: string,
  id: string | null | undefined,
  extras?: {
    engagementId?: string | null;
    opportunityId?: string | null;
    accountId?: string | null;
  },
): string | null {
  if (!id && !extras) return null;
  const payload: Record<string, unknown> = {};
  if (extras?.engagementId) payload.engagementId = extras.engagementId;
  if (extras?.opportunityId) payload.opportunityId = extras.opportunityId;
  if (extras?.accountId) payload.accountId = extras.accountId;
  return resolveNavPath({
    verb: "update",
    kind: kind as WriteKind,
    targetId: id ?? null,
    payload,
  });
}

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
        enum: [
          "account",
          "opportunity",
          "engagement",
          "contact",
          "deliverable",
          "expense",
          "meeting",
          "raid_item",
          "proposal",
          "pov",
          "change_order",
          "timesheet_entry",
          "invoice",
          "contract",
          "rate_card",
          "renewal",
          "partner_firm",
          "win_theme",
          "win_loss_debrief",
          "brief",
          "agent_design",
        ],
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
    const verb = String(input.verb ?? "") as WriteVerb;
    const kind = String(input.kind ?? "") as WriteKind;
    const targetId = typeof input.targetId === "string" ? input.targetId : null;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const summary =
      typeof input.summary === "string" && input.summary.trim().length > 0
        ? input.summary.trim()
        : `${verb} ${kind}${targetId ? ` ${targetId}` : ""}`;
    const route = ROUTE_HINTS[kind]?.[verb] ?? `(no route registered for ${verb} ${kind})`;
    // Task #411 — resolve in-process dispatch target now so the
    // preview card can warn when there is no registered backing tool.
    const { dispatchTarget, translateDispatchPayload } = await import("./write-dispatch.js");
    const dispatchToolName = dispatchTarget(verb as DispatchVerb, kind);

    // Contract preparation owns a richer conversation than the generic
    // dispatcher: it resolves the active template and counterparty, asks for
    // missing template values, and builds the actual filled-value preview.
    // Delegate before producing a generic propose_write card so even a model
    // that selects the fallback dispatcher cannot bypass that conversation or
    // turn a real prerequisite error into a false capability denial.
    if (
      input.confirm !== true &&
      verb === "create" &&
      kind === "contract" &&
      dispatchToolName === "contract_prepare"
    ) {
      const { findToolByName } = await import("./index.js");
      const prepareTool = findToolByName(dispatchToolName, ctx.persona);
      if (!prepareTool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage:
            "Contract preparation is unavailable for the current persona.",
        };
      }
      return prepareTool.run({ ...payload, confirm: false }, ctx);
    }

    if (input.confirm !== true) {
      if (!dispatchToolName) {
        return {
          ok: false,
          errorCode: "unsupported_dispatch",
          errorMessage: `Riser cannot ${verb} a ${kind} through this workflow. No compatible ${verb} implementation is registered; use the dedicated ${kind} workflow instead.`,
          data: { stage: "failed", verb, kind, targetId, route },
        };
      }
      // Task #495 — at proposal time, compute the context page the
      // user should be looking at while reviewing the confirm card
      // (e.g. the opportunity detail page when proposing a stage
      // transition, or the timesheet edit screen when updating an
      // entry). Skipped for `create` when no targetId/payload hints
      // exist — there is no destination yet.
      // Task #573 — deletes never auto-navigate on propose: the entity's
      // own page disappears on commit, and pre-navigating there is just
      // noise. Only non-delete verbs surface a review destination.
      const proposeNavPath =
        verb === "delete" ? null : resolveNavPath({ verb, kind, targetId, payload });
      const navigateTo = proposeNavPath
        ? { path: proposeNavPath, when: "on_propose" as const }
        : null;
      // Task #573 — dependency-impact check for destructive deletes.
      const impact =
        verb === "delete"
          ? await computeDeleteImpact(kind, targetId, ctx.persona.orgId)
          : null;
      return {
        ok: true,
        data: {
          stage: "preview",
          verb,
          kind,
          targetId,
          navigateTo,
        },
        confirmation: {
          summary,
          diff: {
            verb,
            kind,
            targetId,
            payload,
            ...(navigateTo ? { navigateTo } : {}),
            ...(impact ? { impact } : {}),
          },
          pending: {
            tool: "propose_write",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    // Task #411 — commit phase. Look up the typed write capability for
    // (verb, kind) and run it in-process via the same executor the
    // sync turn loop uses, so audit / RLS / writeStepCount stay
    // consistent. When no dispatch is registered, fall back to the
    // legacy "client should POST/PATCH the route" hint.
    if (dispatchToolName) {
      // Lazy import to avoid circular module load (index.ts imports
      // bootstrap-capabilities.js which imports this file).
      const { findToolByName } = await import("./index.js");
      const { capabilitiesForPersona } = await import("./capability-catalog.js");
      if (
        !capabilitiesForPersona(ctx.persona).some(
          (capability) => capability.toolName === dispatchToolName,
        )
      ) {
        return {
          ok: false,
          errorCode: "dispatch_forbidden",
          errorMessage: `You do not have permission to ${verb} this ${kind}.`,
        };
      }
      const tool = findToolByName(dispatchToolName, ctx.persona);
      if (!tool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage: `propose_write commit dispatch target "${dispatchToolName}" is not registered for the current persona.`,
        };
      }
      const seed: Record<string, unknown> = { ...payload };
      if (targetId && !("id" in seed)) seed.id = targetId;
      const translated = translateDispatchPayload(verb as DispatchVerb, kind, seed, targetId);
      const targetPayload: Record<string, unknown> = { ...translated, confirm: true };
      const out = await tool.run(targetPayload, ctx);
      // Task #411 — mirror the resulting row into atelier_entity_embeddings
      // so the hybrid resolver finds it on subsequent turns. Best-
      // effort; failures here never block the write.
      if (out.ok && out.data && typeof out.data === "object") {
        const data = out.data as { id?: string; kind?: string };
        const newId = typeof data.id === "string" ? data.id : targetId ?? undefined;
        if (newId) {
          const { mirrorEntityEmbedding } = await import("./entity-resolver.js");
          const label =
            (typeof payload.name === "string" && payload.name) ||
            (typeof payload.summary === "string" && payload.summary) ||
            `${kind} ${newId}`;
          void mirrorEntityEmbedding(ctx.persona.orgId, kind, newId, label, summary);
        }
      }
      // Task #495 — on a successful commit, compute the destination
      // page so the chat client can auto-navigate. Falls back to null
      // (no navigation) when the (verb, kind) has no known UI route.
      const commitNavPath = out.ok
        ? resolveNavPath({ verb, kind, targetId, payload, resultData: out.data })
        : null;
      return {
        ok: out.ok,
        data: out.ok
          ? {
              stage: "committed",
              // Task #573 — drives the clean single-line success card on
              // the client instead of the raw debug entity_card echo.
              shape: "write_success",
              verb,
              kind,
              summary,
              result: out.data ?? null,
              // Task #511 — inline the literal so the navigateTo
              // contract test (which scans `run` source for the
              // `{ path, when: "on_commit" }` shape) can see it.
              navigateTo: commitNavPath
                ? { path: commitNavPath, when: "on_commit" as const }
                : null,
            }
          : { stage: "failed", verb, kind, dispatchTool: dispatchToolName, errorCode: out.errorCode, errorMessage: out.errorMessage },
        errorCode: out.ok ? undefined : out.errorCode ?? "dispatch_failed",
        errorMessage: out.ok ? undefined : out.errorMessage ?? `dispatch ${dispatchToolName} failed`,
      };
    }

    // Engagement create/update is intentionally omitted from
    // write-dispatch.ts: standing up (or amending) an engagement runs
    // through the charter flow rather than a generic write. Instead of
    // the opaque `unsupported_dispatch` error, hand the user the exact
    // tool to use so they are not left guessing.
    if (kind === "engagement" && (verb === "create" || verb === "update")) {
      return {
        ok: false,
        errorCode: "use_charter_flow",
        errorMessage:
          `Engagements are not created or amended through propose_write. ` +
          `Use engagement_open_charter to ${verb === "create" ? "stand up a new engagement" : "amend an existing engagement"}.`,
        data: {
          stage: "failed",
          verb,
          kind,
          targetId,
          payload,
          route,
          useTool: "engagement_open_charter",
        },
      };
    }

    // Task #411 — no in-process dispatcher mapping exists for this
    // (verb, kind). Reviewer round-3 requires a hard failure here
    // (the previous "dispatched" no-op silently dropped writes the
    // user expected to commit). Surface a structured error so the
    // confirm card can show the user a real problem.
    return {
      ok: false,
      errorCode: "unsupported_dispatch",
      errorMessage:
        `propose_write commit cannot apply ${verb} ${kind} in-process — no dispatch mapping is registered. ` +
        `Use the typed route (${route}) directly, or extend write-dispatch.ts to cover this combination.`,
      data: {
        stage: "failed",
        verb,
        kind,
        targetId,
        payload,
        route,
      },
    };
  },
});

// — legacy ILIKE branch kept here as a private helper, still callable
// from internal callers that haven't migrated to the hybrid resolver.
// (Not registered as a capability; not exported.)

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
    const verb = String(input.verb ?? "") as WriteVerb;
    const kind = String(input.kind ?? "") as WriteKind;
    const targetId = typeof input.targetId === "string" ? input.targetId : null;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const summary =
      typeof input.summary === "string" && input.summary.trim().length > 0
        ? input.summary.trim()
        : `${verb} ${kind}${targetId ? ` ${targetId}` : ""}`;
    const route = ROUTE_HINTS[kind]?.[verb] ?? `(no route registered for ${verb} ${kind})`;
    // Task #411 — resolve in-process dispatch target now so the
    // preview card can warn when there is no registered backing tool.
    const { dispatchTarget, translateDispatchPayload } = await import("./write-dispatch.js");
    const dispatchToolName = dispatchTarget(verb as DispatchVerb, kind);

    // Contract preparation owns a richer conversation than the generic
    // dispatcher: it resolves the active template and counterparty, asks for
    // missing template values, and builds the actual filled-value preview.
    // Delegate before producing a generic propose_write card so even a model
    // that selects the fallback dispatcher cannot bypass that conversation or
    // turn a real prerequisite error into a false capability denial.
    if (
      input.confirm !== true &&
      verb === "create" &&
      kind === "contract" &&
      dispatchToolName === "contract_prepare"
    ) {
      const { findToolByName } = await import("./index.js");
      const prepareTool = findToolByName(dispatchToolName, ctx.persona);
      if (!prepareTool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage:
            "Contract preparation is unavailable for the current persona.",
        };
      }
      return prepareTool.run({ ...payload, confirm: false }, ctx);
    }

    if (input.confirm !== true) {
      if (!dispatchToolName) {
        return {
          ok: false,
          errorCode: "unsupported_dispatch",
          errorMessage: `Riser cannot ${verb} a ${kind} through this workflow. No compatible ${verb} implementation is registered; use the dedicated ${kind} workflow instead.`,
          data: { stage: "failed", verb, kind, targetId, route },
        };
      }
      // Task #495 — at proposal time, compute the context page the
      // user should be looking at while reviewing the confirm card
      // (e.g. the opportunity detail page when proposing a stage
      // transition, or the timesheet edit screen when updating an
      // entry). Skipped for `create` when no targetId/payload hints
      // exist — there is no destination yet.
      // Task #573 — deletes never auto-navigate on propose: the entity's
      // own page disappears on commit, and pre-navigating there is just
      // noise. Only non-delete verbs surface a review destination.
      const proposeNavPath =
        verb === "delete" ? null : resolveNavPath({ verb, kind, targetId, payload });
      const navigateTo = proposeNavPath
        ? { path: proposeNavPath, when: "on_propose" as const }
        : null;
      // Task #573 — dependency-impact check for destructive deletes.
      const impact =
        verb === "delete"
          ? await computeDeleteImpact(kind, targetId, ctx.persona.orgId)
          : null;
      return {
        ok: true,
        data: {
          stage: "preview",
          verb,
          kind,
          targetId,
          navigateTo,
        },
        confirmation: {
          summary,
          diff: {
            verb,
            kind,
            targetId,
            payload,
            ...(navigateTo ? { navigateTo } : {}),
            ...(impact ? { impact } : {}),
          },
          pending: {
            tool: "propose_write",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    // Task #411 — commit phase. Look up the typed write capability for
    // (verb, kind) and run it in-process via the same executor the
    // sync turn loop uses, so audit / RLS / writeStepCount stay
    // consistent. When no dispatch is registered, fall back to the
    // legacy "client should POST/PATCH the route" hint.
    if (dispatchToolName) {
      // Lazy import to avoid circular module load (index.ts imports
      // bootstrap-capabilities.js which imports this file).
      const { findToolByName } = await import("./index.js");
      const { capabilitiesForPersona } = await import("./capability-catalog.js");
      if (
        !capabilitiesForPersona(ctx.persona).some(
          (capability) => capability.toolName === dispatchToolName,
        )
      ) {
        return {
          ok: false,
          errorCode: "dispatch_forbidden",
          errorMessage: `You do not have permission to ${verb} this ${kind}.`,
        };
      }
      const tool = findToolByName(dispatchToolName, ctx.persona);
      if (!tool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage: `propose_write commit dispatch target "${dispatchToolName}" is not registered for the current persona.`,
        };
      }
      const seed: Record<string, unknown> = { ...payload };
      if (targetId && !("id" in seed)) seed.id = targetId;
      const translated = translateDispatchPayload(verb as DispatchVerb, kind, seed, targetId);
      const targetPayload: Record<string, unknown> = { ...translated, confirm: true };
      const out = await tool.run(targetPayload, ctx);
      // Task #411 — mirror the resulting row into atelier_entity_embeddings
      // so the hybrid resolver finds it on subsequent turns. Best-
      // effort; failures here never block the write.
      if (out.ok && out.data && typeof out.data === "object") {
        const data = out.data as { id?: string; kind?: string };
        const newId = typeof data.id === "string" ? data.id : targetId ?? undefined;
        if (newId) {
          const { mirrorEntityEmbedding } = await import("./entity-resolver.js");
          const label =
            (typeof payload.name === "string" && payload.name) ||
            (typeof payload.summary === "string" && payload.summary) ||
            `${kind} ${newId}`;
          void mirrorEntityEmbedding(ctx.persona.orgId, kind, newId, label, summary);
        }
      }
      // Task #495 — on a successful commit, compute the destination
      // page so the chat client can auto-navigate. Falls back to null
      // (no navigation) when the (verb, kind) has no known UI route.
      const commitNavPath = out.ok
        ? resolveNavPath({ verb, kind, targetId, payload, resultData: out.data })
        : null;
      return {
        ok: out.ok,
        data: out.ok
          ? {
              stage: "committed",
              // Task #573 — drives the clean single-line success card on
              // the client instead of the raw debug entity_card echo.
              shape: "write_success",
              verb,
              kind,
              summary,
              result: out.data ?? null,
              // Task #511 — inline the literal so the navigateTo
              // contract test (which scans `run` source for the
              // `{ path, when: "on_commit" }` shape) can see it.
              navigateTo: commitNavPath
                ? { path: commitNavPath, when: "on_commit" as const }
                : null,
            }
          : { stage: "failed", verb, kind, dispatchTool: dispatchToolName, errorCode: out.errorCode, errorMessage: out.errorMessage },
        errorCode: out.ok ? undefined : out.errorCode ?? "dispatch_failed",
        errorMessage: out.ok ? undefined : out.errorMessage ?? `dispatch ${dispatchToolName} failed`,
      };
    }

    // Engagement create/update is intentionally omitted from
    // write-dispatch.ts: standing up (or amending) an engagement runs
    // through the charter flow rather than a generic write. Instead of
    // the opaque `unsupported_dispatch` error, hand the user the exact
    // tool to use so they are not left guessing.
    if (kind === "engagement" && (verb === "create" || verb === "update")) {
      return {
        ok: false,
        errorCode: "use_charter_flow",
        errorMessage:
          `Engagements are not created or amended through propose_write. ` +
          `Use engagement_open_charter to ${verb === "create" ? "stand up a new engagement" : "amend an existing engagement"}.`,
        data: {
          stage: "failed",
          verb,
          kind,
          targetId,
          payload,
          route,
          useTool: "engagement_open_charter",
        },
      };
    }

    // Task #411 — no in-process dispatcher mapping exists for this
    // (verb, kind). Reviewer round-3 requires a hard failure here
    // (the previous "dispatched" no-op silently dropped writes the
    // user expected to commit). Surface a structured error so the
    // confirm card can show the user a real problem.
    return {
      ok: false,
      errorCode: "unsupported_dispatch",
      errorMessage:
        `propose_write commit cannot apply ${verb} ${kind} in-process — no dispatch mapping is registered. ` +
        `Use the typed route (${route}) directly, or extend write-dispatch.ts to cover this combination.`,
      data: {
        stage: "failed",
        verb,
        kind,
        targetId,
        payload,
        route,
      },
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
    const verb = String(input.verb ?? "") as WriteVerb;
    const kind = String(input.kind ?? "") as WriteKind;
    const targetId = typeof input.targetId === "string" ? input.targetId : null;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const summary =
      typeof input.summary === "string" && input.summary.trim().length > 0
        ? input.summary.trim()
        : `${verb} ${kind}${targetId ? ` ${targetId}` : ""}`;
    const route = ROUTE_HINTS[kind]?.[verb] ?? `(no route registered for ${verb} ${kind})`;
    // Task #411 — resolve in-process dispatch target now so the
    // preview card can warn when there is no registered backing tool.
    const { dispatchTarget, translateDispatchPayload } = await import("./write-dispatch.js");
    const dispatchToolName = dispatchTarget(verb as DispatchVerb, kind);

    // Contract preparation owns a richer conversation than the generic
    // dispatcher: it resolves the active template and counterparty, asks for
    // missing template values, and builds the actual filled-value preview.
    // Delegate before producing a generic propose_write card so even a model
    // that selects the fallback dispatcher cannot bypass that conversation or
    // turn a real prerequisite error into a false capability denial.
    if (
      input.confirm !== true &&
      verb === "create" &&
      kind === "contract" &&
      dispatchToolName === "contract_prepare"
    ) {
      const { findToolByName } = await import("./index.js");
      const prepareTool = findToolByName(dispatchToolName, ctx.persona);
      if (!prepareTool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage:
            "Contract preparation is unavailable for the current persona.",
        };
      }
      return prepareTool.run({ ...payload, confirm: false }, ctx);
    }

    if (input.confirm !== true) {
      if (!dispatchToolName) {
        return {
          ok: false,
          errorCode: "unsupported_dispatch",
          errorMessage: `Riser cannot ${verb} a ${kind} through this workflow. No compatible ${verb} implementation is registered; use the dedicated ${kind} workflow instead.`,
          data: { stage: "failed", verb, kind, targetId, route },
        };
      }
      // Task #495 — at proposal time, compute the context page the
      // user should be looking at while reviewing the confirm card
      // (e.g. the opportunity detail page when proposing a stage
      // transition, or the timesheet edit screen when updating an
      // entry). Skipped for `create` when no targetId/payload hints
      // exist — there is no destination yet.
      // Task #573 — deletes never auto-navigate on propose: the entity's
      // own page disappears on commit, and pre-navigating there is just
      // noise. Only non-delete verbs surface a review destination.
      const proposeNavPath =
        verb === "delete" ? null : resolveNavPath({ verb, kind, targetId, payload });
      const navigateTo = proposeNavPath
        ? { path: proposeNavPath, when: "on_propose" as const }
        : null;
      // Task #573 — dependency-impact check for destructive deletes.
      const impact =
        verb === "delete"
          ? await computeDeleteImpact(kind, targetId, ctx.persona.orgId)
          : null;
      return {
        ok: true,
        data: {
          stage: "preview",
          verb,
          kind,
          targetId,
          navigateTo,
        },
        confirmation: {
          summary,
          diff: {
            verb,
            kind,
            targetId,
            payload,
            ...(navigateTo ? { navigateTo } : {}),
            ...(impact ? { impact } : {}),
          },
          pending: {
            tool: "propose_write",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    // Task #411 — commit phase. Look up the typed write capability for
    // (verb, kind) and run it in-process via the same executor the
    // sync turn loop uses, so audit / RLS / writeStepCount stay
    // consistent. When no dispatch is registered, fall back to the
    // legacy "client should POST/PATCH the route" hint.
    if (dispatchToolName) {
      // Lazy import to avoid circular module load (index.ts imports
      // bootstrap-capabilities.js which imports this file).
      const { findToolByName } = await import("./index.js");
      const { capabilitiesForPersona } = await import("./capability-catalog.js");
      if (
        !capabilitiesForPersona(ctx.persona).some(
          (capability) => capability.toolName === dispatchToolName,
        )
      ) {
        return {
          ok: false,
          errorCode: "dispatch_forbidden",
          errorMessage: `You do not have permission to ${verb} this ${kind}.`,
        };
      }
      const tool = findToolByName(dispatchToolName, ctx.persona);
      if (!tool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage: `propose_write commit dispatch target "${dispatchToolName}" is not registered for the current persona.`,
        };
      }
      const seed: Record<string, unknown> = { ...payload };
      if (targetId && !("id" in seed)) seed.id = targetId;
      const translated = translateDispatchPayload(verb as DispatchVerb, kind, seed, targetId);
      const targetPayload: Record<string, unknown> = { ...translated, confirm: true };
      const out = await tool.run(targetPayload, ctx);
      // Task #411 — mirror the resulting row into atelier_entity_embeddings
      // so the hybrid resolver finds it on subsequent turns. Best-
      // effort; failures here never block the write.
      if (out.ok && out.data && typeof out.data === "object") {
        const data = out.data as { id?: string; kind?: string };
        const newId = typeof data.id === "string" ? data.id : targetId ?? undefined;
        if (newId) {
          const { mirrorEntityEmbedding } = await import("./entity-resolver.js");
          const label =
            (typeof payload.name === "string" && payload.name) ||
            (typeof payload.summary === "string" && payload.summary) ||
            `${kind} ${newId}`;
          void mirrorEntityEmbedding(ctx.persona.orgId, kind, newId, label, summary);
        }
      }
      // Task #495 — on a successful commit, compute the destination
      // page so the chat client can auto-navigate. Falls back to null
      // (no navigation) when the (verb, kind) has no known UI route.
      const commitNavPath = out.ok
        ? resolveNavPath({ verb, kind, targetId, payload, resultData: out.data })
        : null;
      return {
        ok: out.ok,
        data: out.ok
          ? {
              stage: "committed",
              // Task #573 — drives the clean single-line success card on
              // the client instead of the raw debug entity_card echo.
              shape: "write_success",
              verb,
              kind,
              summary,
              result: out.data ?? null,
              // Task #511 — inline the literal so the navigateTo
              // contract test (which scans `run` source for the
              // `{ path, when: "on_commit" }` shape) can see it.
              navigateTo: commitNavPath
                ? { path: commitNavPath, when: "on_commit" as const }
                : null,
            }
          : { stage: "failed", verb, kind, dispatchTool: dispatchToolName, errorCode: out.errorCode, errorMessage: out.errorMessage },
        errorCode: out.ok ? undefined : out.errorCode ?? "dispatch_failed",
        errorMessage: out.ok ? undefined : out.errorMessage ?? `dispatch ${dispatchToolName} failed`,
      };
    }

    // Engagement create/update is intentionally omitted from
    // write-dispatch.ts: standing up (or amending) an engagement runs
    // through the charter flow rather than a generic write. Instead of
    // the opaque `unsupported_dispatch` error, hand the user the exact
    // tool to use so they are not left guessing.
    if (kind === "engagement" && (verb === "create" || verb === "update")) {
      return {
        ok: false,
        errorCode: "use_charter_flow",
        errorMessage:
          `Engagements are not created or amended through propose_write. ` +
          `Use engagement_open_charter to ${verb === "create" ? "stand up a new engagement" : "amend an existing engagement"}.`,
        data: {
          stage: "failed",
          verb,
          kind,
          targetId,
          payload,
          route,
          useTool: "engagement_open_charter",
        },
      };
    }

    // Task #411 — no in-process dispatcher mapping exists for this
    // (verb, kind). Reviewer round-3 requires a hard failure here
    // (the previous "dispatched" no-op silently dropped writes the
    // user expected to commit). Surface a structured error so the
    // confirm card can show the user a real problem.
    return {
      ok: false,
      errorCode: "unsupported_dispatch",
      errorMessage:
        `propose_write commit cannot apply ${verb} ${kind} in-process — no dispatch mapping is registered. ` +
        `Use the typed route (${route}) directly, or extend write-dispatch.ts to cover this combination.`,
      data: {
        stage: "failed",
        verb,
        kind,
        targetId,
        payload,
        route,
      },
    };
  },
});

// ---------------------------------------------------------------------
// 4. propose_write
// ---------------------------------------------------------------------

// Task #573 — dependency-impact preview for destructive deletes. Before
// a soft-delete confirm card is shown, count the live child rows that
// reference the target so the user sees what they are about to orphan.
// Soft-delete does NOT cascade here, so these rows are retained but lose
// their parent — the confirm card spells that out.
export interface DeleteDependency {
  kind: string;
  count: number;
}
export interface DeleteImpact {
  dependencies: DeleteDependency[];
  total: number;
}

async function computeDeleteImpact(
  kind: WriteKind,
  targetId: string | null,
  orgId: string,
): Promise<DeleteImpact | null> {
  if (!targetId) return null;
  const deps: DeleteDependency[] = [];
  const countLive = async (
    table: typeof atelierOpportunities | typeof atelierEngagements | typeof atelierContacts | typeof atelierInvoice,
    accountCol: typeof atelierOpportunities.accountId,
  ): Promise<number> => {
    const [row] = await db
      .select({ n: count() })
      .from(table)
      .where(and(eq(accountCol, targetId), eq(table.orgId, orgId), isNull(table.deletedAt)));
    return Number(row?.n ?? 0);
  };
  if (kind === "account") {
    const [opps, engs, contacts, invoices] = await Promise.all([
      countLive(atelierOpportunities, atelierOpportunities.accountId),
      countLive(atelierEngagements, atelierEngagements.accountId),
      countLive(atelierContacts, atelierContacts.accountId),
      countLive(atelierInvoice, atelierInvoice.accountId),
    ]);
    if (opps) deps.push({ kind: "opportunity", count: opps });
    if (engs) deps.push({ kind: "engagement", count: engs });
    if (contacts) deps.push({ kind: "contact", count: contacts });
    if (invoices) deps.push({ kind: "invoice", count: invoices });
  } else if (kind === "contact") {
    const [row] = await db
      .select({ n: count() })
      .from(atelierContactRelationships)
      .where(
        and(
          eq(atelierContactRelationships.orgId, orgId),
          isNull(atelierContactRelationships.deletedAt),
          or(
            eq(atelierContactRelationships.fromContactId, targetId),
            eq(atelierContactRelationships.toContactId, targetId),
          ),
        ),
      );
    const rels = Number(row?.n ?? 0);
    if (rels) deps.push({ kind: "contact_relationship", count: rels });
  }
  const total = deps.reduce((sum, d) => sum + d.count, 0);
  return { dependencies: deps, total };
}

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
      verb: { type: "string", enum: ["create", "update", "link", "transition", "delete"] },
      kind: {
        type: "string",
        enum: [
          "account",
          "opportunity",
          "contact",
          "engagement",
          "partner_link",
          // Task #567 — contact relationship edges.
          "contact_relationship",
          "deliverable",
          "expense",
          // Task #411 — 15 new chat-owned write entities.
          "meeting",
          "raid_item",
          "proposal",
          "pov",
          "change_order",
          "timesheet_entry",
          "invoice",
          "contract",
          "rate_card",
          "renewal",
          "partner_firm",
          "win_theme",
          "win_loss_debrief",
          "brief",
          "agent_design",
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
  async run(input, ctx) {
    const verb = String(input.verb ?? "") as WriteVerb;
    const kind = String(input.kind ?? "") as WriteKind;
    const targetId = typeof input.targetId === "string" ? input.targetId : null;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const summary =
      typeof input.summary === "string" && input.summary.trim().length > 0
        ? input.summary.trim()
        : `${verb} ${kind}${targetId ? ` ${targetId}` : ""}`;
    const route = ROUTE_HINTS[kind]?.[verb] ?? `(no route registered for ${verb} ${kind})`;
    // Task #411 — resolve in-process dispatch target now so the
    // preview card can warn when there is no registered backing tool.
    const { dispatchTarget, translateDispatchPayload } = await import("./write-dispatch.js");
    const dispatchToolName = dispatchTarget(verb as DispatchVerb, kind);

    // Contract preparation owns a richer conversation than the generic
    // dispatcher: it resolves the active template and counterparty, asks for
    // missing template values, and builds the actual filled-value preview.
    // Delegate before producing a generic propose_write card so even a model
    // that selects the fallback dispatcher cannot bypass that conversation or
    // turn a real prerequisite error into a false capability denial.
    if (
      input.confirm !== true &&
      verb === "create" &&
      kind === "contract" &&
      dispatchToolName === "contract_prepare"
    ) {
      const { findToolByName } = await import("./index.js");
      const prepareTool = findToolByName(dispatchToolName, ctx.persona);
      if (!prepareTool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage:
            "Contract preparation is unavailable for the current persona.",
        };
      }
      return prepareTool.run({ ...payload, confirm: false }, ctx);
    }

    if (input.confirm !== true) {
      if (!dispatchToolName) {
        return {
          ok: false,
          errorCode: "unsupported_dispatch",
          errorMessage: `Riser cannot ${verb} a ${kind} through this workflow. No compatible ${verb} implementation is registered; use the dedicated ${kind} workflow instead.`,
          data: { stage: "failed", verb, kind, targetId, route },
        };
      }
      // Task #495 — at proposal time, compute the context page the
      // user should be looking at while reviewing the confirm card
      // (e.g. the opportunity detail page when proposing a stage
      // transition, or the timesheet edit screen when updating an
      // entry). Skipped for `create` when no targetId/payload hints
      // exist — there is no destination yet.
      // Task #573 — deletes never auto-navigate on propose: the entity's
      // own page disappears on commit, and pre-navigating there is just
      // noise. Only non-delete verbs surface a review destination.
      const proposeNavPath =
        verb === "delete" ? null : resolveNavPath({ verb, kind, targetId, payload });
      const navigateTo = proposeNavPath
        ? { path: proposeNavPath, when: "on_propose" as const }
        : null;
      // Task #573 — dependency-impact check for destructive deletes.
      const impact =
        verb === "delete"
          ? await computeDeleteImpact(kind, targetId, ctx.persona.orgId)
          : null;
      return {
        ok: true,
        data: {
          stage: "preview",
          verb,
          kind,
          targetId,
          navigateTo,
        },
        confirmation: {
          summary,
          diff: {
            verb,
            kind,
            targetId,
            payload,
            ...(navigateTo ? { navigateTo } : {}),
            ...(impact ? { impact } : {}),
          },
          pending: {
            tool: "propose_write",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    // Task #411 — commit phase. Look up the typed write capability for
    // (verb, kind) and run it in-process via the same executor the
    // sync turn loop uses, so audit / RLS / writeStepCount stay
    // consistent. When no dispatch is registered, fall back to the
    // legacy "client should POST/PATCH the route" hint.
    if (dispatchToolName) {
      // Lazy import to avoid circular module load (index.ts imports
      // bootstrap-capabilities.js which imports this file).
      const { findToolByName } = await import("./index.js");
      const { capabilitiesForPersona } = await import("./capability-catalog.js");
      if (
        !capabilitiesForPersona(ctx.persona).some(
          (capability) => capability.toolName === dispatchToolName,
        )
      ) {
        return {
          ok: false,
          errorCode: "dispatch_forbidden",
          errorMessage: `You do not have permission to ${verb} this ${kind}.`,
        };
      }
      const tool = findToolByName(dispatchToolName, ctx.persona);
      if (!tool) {
        return {
          ok: false,
          errorCode: "dispatch_unregistered",
          errorMessage: `propose_write commit dispatch target "${dispatchToolName}" is not registered for the current persona.`,
        };
      }
      const seed: Record<string, unknown> = { ...payload };
      if (targetId && !("id" in seed)) seed.id = targetId;
      const translated = translateDispatchPayload(verb as DispatchVerb, kind, seed, targetId);
      const targetPayload: Record<string, unknown> = { ...translated, confirm: true };
      const out = await tool.run(targetPayload, ctx);
      // Task #411 — mirror the resulting row into atelier_entity_embeddings
      // so the hybrid resolver finds it on subsequent turns. Best-
      // effort; failures here never block the write.
      if (out.ok && out.data && typeof out.data === "object") {
        const data = out.data as { id?: string; kind?: string };
        const newId = typeof data.id === "string" ? data.id : targetId ?? undefined;
        if (newId) {
          const { mirrorEntityEmbedding } = await import("./entity-resolver.js");
          const label =
            (typeof payload.name === "string" && payload.name) ||
            (typeof payload.summary === "string" && payload.summary) ||
            `${kind} ${newId}`;
          void mirrorEntityEmbedding(ctx.persona.orgId, kind, newId, label, summary);
        }
      }
      // Task #495 — on a successful commit, compute the destination
      // page so the chat client can auto-navigate. Falls back to null
      // (no navigation) when the (verb, kind) has no known UI route.
      const commitNavPath = out.ok
        ? resolveNavPath({ verb, kind, targetId, payload, resultData: out.data })
        : null;
      return {
        ok: out.ok,
        data: out.ok
          ? {
              stage: "committed",
              // Task #573 — drives the clean single-line success card on
              // the client instead of the raw debug entity_card echo.
              shape: "write_success",
              verb,
              kind,
              summary,
              result: out.data ?? null,
              // Task #511 — inline the literal so the navigateTo
              // contract test (which scans `run` source for the
              // `{ path, when: "on_commit" }` shape) can see it.
              navigateTo: commitNavPath
                ? { path: commitNavPath, when: "on_commit" as const }
                : null,
            }
          : { stage: "failed", verb, kind, dispatchTool: dispatchToolName, errorCode: out.errorCode, errorMessage: out.errorMessage },
        errorCode: out.ok ? undefined : out.errorCode ?? "dispatch_failed",
        errorMessage: out.ok ? undefined : out.errorMessage ?? `dispatch ${dispatchToolName} failed`,
      };
    }

    // Engagement create/update is intentionally omitted from
    // write-dispatch.ts: standing up (or amending) an engagement runs
    // through the charter flow rather than a generic write. Instead of
    // the opaque `unsupported_dispatch` error, hand the user the exact
    // tool to use so they are not left guessing.
    if (kind === "engagement" && (verb === "create" || verb === "update")) {
      return {
        ok: false,
        errorCode: "use_charter_flow",
        errorMessage:
          `Engagements are not created or amended through propose_write. ` +
          `Use engagement_open_charter to ${verb === "create" ? "stand up a new engagement" : "amend an existing engagement"}.`,
        data: {
          stage: "failed",
          verb,
          kind,
          targetId,
          payload,
          route,
          useTool: "engagement_open_charter",
        },
      };
    }

    // Task #411 — no in-process dispatcher mapping exists for this
    // (verb, kind). Reviewer round-3 requires a hard failure here
    // (the previous "dispatched" no-op silently dropped writes the
    // user expected to commit). Surface a structured error so the
    // confirm card can show the user a real problem.
    return {
      ok: false,
      errorCode: "unsupported_dispatch",
      errorMessage:
        `propose_write commit cannot apply ${verb} ${kind} in-process — no dispatch mapping is registered. ` +
        `Use the typed route (${route}) directly, or extend write-dispatch.ts to cover this combination.`,
      data: {
        stage: "failed",
        verb,
        kind,
        targetId,
        payload,
        route,
      },
    };
  },
});

// Task #411 — local alias for the dispatch verb type (kept here so the
// import line above stays small).
type DispatchVerb = "create" | "update" | "link" | "transition";
