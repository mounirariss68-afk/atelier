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
  | ResolvableKind
  | "partner_link"
  // Task #567 — relationship edges between contacts (org-chart structure).
  | "contact_relationship"
  // Task #411 — 15 new chat-owned write entities.
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
  | "agent_design";

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
  raid_item: { create: "POST /atelier/raid", update: "PATCH /atelier/raid/:id" },
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
    const orgId = ctx.persona.orgId;
    const kind = String(input.kind ?? "") as ResolverKind;
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
    // Hybrid pg_trgm + pgvector resolver — single source of truth for
    // every chat-owned kind. Returns up to 5 candidates ordered by
    // score; this capability emits a disambiguation envelope when
    // there is more than one.
    const candidates = await hybridResolveEntity(kind, query, orgId, {
      accountId: scopeAccountId,
      engagementId: scopeEngagementId,
    });
    await recordRiserObservation({
      orgId,
      conversationId: ctx.sessionId,
      turnId: ctx.turnId,
      stage: "resolution",
      outcome:
        candidates.length === 0
          ? "not_found"
          : candidates.length === 1
            ? "unique"
            : "ambiguous",
      dimensions: { candidate_count: candidates.length },
    }).catch(() => null);
    if (candidates.length === 0) {
      // "contact" is really a person search — it spans client contacts,
      // HR employees, and partner-firm people. Say so, so the user
      // knows all three rosters were checked.
      const contactRosterLabel = scopeAccountId
        ? "client contacts on this account, employees, and partner-firm people"
        : "client contacts, employees, and partner-firm people";
      const kindLabel = kind === "contact" ? `person (searched ${contactRosterLabel})` : kind;
      // Task #769 — "a opportunity" / "a engagement" are wrong; use the
      // correct article and a natural plural for the question phrasing.
      const displayKind = kind === "contact" ? "person" : kind;
      const article = /^[aeiou]/i.test(displayKind) ? "an" : "a";
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `No ${kindLabel} matched "${query}".`,
        clarification: {
          field: "query",
          tool: "resolve_entity",
          question: `I couldn't find ${article} ${displayKind} matching "${query}"${kind === "contact" ? (scopeAccountId ? " in this account's client contacts, the employee roster, or partner-firm people" : " in client contacts, the employee roster, or partner-firm people") : ""}. Try a different name or paste the id.`,
          partial: { kind, scopeAccountId, scopeEngagementId },
          suggestions: [],
        },
      };
    }
    if (candidates.length === 1) {
      const c = candidates[0];
      // Task #499 — single-match resolves should land the user on the
      // entity's canonical page. Optional: null for kinds with no
      // dedicated SPA route (helper returns null in that case).
      const navPath = entityNavPath(kind, c.id);
      const navigateTo = navPath ? { path: navPath, when: "on_commit" as const } : null;
      return {
        ok: true,
        data: {
          entity: { kind, id: c.id, label: c.label, secondary: c.secondary, score: c.score, via: c.via },
          navigateTo,
        },
      };
    }
    const options = candidates.map((c) => ({
      id: c.id,
      label: c.label,
      secondary: c.secondary ?? `${c.via} ${c.score.toFixed(2)}`,
      hint: c.secondary ?? `${c.via} ${c.score.toFixed(2)}`,
    }));
    // Task #769 — natural plural for kind ("opportunities" not "opportunitys").
    const kindPlural = (k: string): string => {
      if (k === "opportunity") return "opportunities";
      if (k === "delivery") return "deliveries";
      if (k.endsWith("y")) return `${k.slice(0, -1)}ies`;
      return `${k}s`;
    };
    return {
      ok: true,
      // Task #411 — flat top-level `options` so the EntityResolution
      // renderer can pick it up directly (no nested envelope).
      data: {
        kind,
        candidateCount: candidates.length,
        options,
        prompt: `Multiple ${kindPlural(kind)} match "${query}". Pick one.`,
      },
      disambiguation: { kind, options },
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
          // Task #1193 — Background Work bell visibility during the
          // pre-run-row window. Cleared in the finally below.
          noteAgentLaunch({
            agentId: "account_cartographer",
            targetId: acct.id,
            targetLabel: acct.brandName ?? acct.name,
            userId: ctx.persona.id,
          });
          let result: Awaited<ReturnType<typeof runAccountCartographer>>;
          try {
            result = await runAccountCartographer({
              accountId: acct.id,
              accountName: acct.brandName ?? acct.name,
              accountSector: acct.sector ?? "",
              accountCountry: acct.country ?? "",
              triggeredByUserId: ctx.persona.id,
              actorLabel: "Chat Orchestrator",
            });
          } finally {
            clearAgentLaunch("account_cartographer", acct.id);
          }
          // Cartographer ran against a persisted account — chain the
          // Executive Mapper (fire-and-forget), same as account creation
          // and the manual refresh route. Research-only runs (no targetId)
          // never reach this branch, so they never trigger the Mapper.
          chainExecutiveMapperAfterCartographer(
            acct.id,
            ctx.persona.id,
            acct.brandName ?? acct.name,
          );
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
            errorMessage: `Cartographer dispatch failed: ${(e as Error).message}`,
          };
        }
      }
      // Pre-create research mode. Dispatch Account Cartographer in
      // research_only mode (no DB writes, no agent_runs row) using the
      // user-provided fragment so the confirm card is pre-populated
      // with real, web-search-grounded firmographics + signals + DMs.
      const rawName =
        typeof inp.name === "string" && inp.name.trim().length > 0
          ? inp.name.trim()
          : null;
      if (!rawName) {
        return {
          ok: false,
          errorCode: "missing_input",
          errorMessage:
            "prefill_from_specialist: input.name is required when targetId is absent (verb=create).",
        };
      }
      // Task #601 — when a prior turn paused on the branch-vs-HQ clarification,
      // the full researched draft rides back in `input.__researchedDraft`, and
      // the partner's HQ/branch answer in top-level `entityRole` (merged by the
      // clarification continuation). Reuse the cached draft so we do NOT re-run
      // the (slow, costly) Cartographer just to attach one answer.
      const cachedDraft =
        inp.__researchedDraft &&
        typeof inp.__researchedDraft === "object" &&
        !Array.isArray(inp.__researchedDraft)
          ? (inp.__researchedDraft as Record<string, unknown>)
          : null;
      const entityRoleAnswerRaw =
        typeof input.entityRole === "string"
          ? input.entityRole
          : typeof inp.entityRole === "string"
            ? inp.entityRole
            : "";
      const VALID_ENTITY_ROLES = ["hq", "subsidiary", "branch", "office"];
      const entityRoleAnswer = (() => {
        const t = entityRoleAnswerRaw.trim().toLowerCase();
        if (VALID_ENTITY_ROLES.includes(t)) return t;
        // Tolerate free-text answers ("it's the headquarters", "a local branch").
        if (/\b(hq|head ?quarter)/.test(t)) return "hq";
        if (/\bsubsidiar/.test(t)) return "subsidiary";
        if (/\bbranch\b/.test(t)) return "branch";
        if (/\boffice\b/.test(t)) return "office";
        return "";
      })();
      try {
        let draft: Record<string, unknown>;
        let costUsd = 0;
        if (cachedDraft) {
          draft = cachedDraft;
        } else {
          const result = await runAccountCartographer({
            accountId: null,
            accountName: rawName,
            accountSector: typeof inp.sector === "string" ? inp.sector : "",
            accountCountry: typeof inp.country === "string" ? inp.country : "",
            accountHqCity: typeof inp.hqCity === "string" ? inp.hqCity : null,
            triggeredByUserId: ctx.persona.id,
            actorLabel: "Chat Orchestrator (prefill)",
            mode: "research_only",
          });
          costUsd = result.costUsd;
          const out = result.output;
          const sourceSignals = (out.sourceSignals ?? []).slice(0, 6).map((s) => ({
            kind: s.kind,
            title: s.title,
            url: s.url,
            summary: s.summary,
            publishedAt: s.publishedAt,
            confidence: s.confidence ?? "amber",
          }));
          const decisionMakers = (out.decisionMakers ?? []).slice(0, 7).map((d) => ({
            fullName: d.fullName,
            title: d.title ?? null,
            seniority: d.seniority ?? null,
            buyerPersona: d.buyerPersona ?? null,
            sourceUrl: d.sourceUrl ?? null,
            confidence: d.confidence,
          }));
          draft = {
            name: out.account.canonicalName || rawName,
            // Task #601 — brand/display name defaults to the legal name when the
            // firm has no distinct brand.
            brandName:
              out.account.brandName ||
              out.account.canonicalName ||
              rawName,
            country:
              out.account.country ||
              (typeof inp.country === "string" ? inp.country : null),
            sector: out.account.sector ?? null,
            hqCity: out.account.hqCity ?? null,
            tier: out.account.tier ?? null,
            // Task #601 — firmographic enrichment carried onto the proposal card
            // and through "Review & Create".
            size: out.account.size ?? null,
            employeeCount: out.account.employeeCount ?? null,
            primaryCurrency: out.account.primaryCurrency ?? null,
            annualRevenue: out.account.annualRevenue ?? null,
            holdingStructure: out.account.holdingStructure ?? null,
            countryPresence: out.account.countryPresence ?? [],
            industryCode: out.account.industryCode ?? null,
            subIndustryCode: out.account.subIndustryCode ?? null,
            strategicPriorities: (out.account.strategicPriorities ?? [])
              .slice(0, 5)
              .map((p) => ({ text: p.text, sourceUrls: p.sourceUrls })),
            cogniriseHypothesis: out.account.cogniriseHypothesis ?? "",
            refreshedSummary: out.account.refreshedSummary ?? "",
            sourceSignals,
            decisionMakers,
            // Task #560 — full structured research brief carried onto the
            // proposal card (display-only) and persisted post-create.
            researchBrief: out.researchBrief,
          };
        }

        // Task #601 — branch-vs-HQ conversational question. When the firm has a
        // multinational footprint and the partner has not yet told us which
        // entity they're onboarding, pause and ask. The full researched draft
        // rides in `partial` so the answer turn skips the Cartographer.
        const presence = Array.isArray(draft.countryPresence)
          ? (draft.countryPresence as Array<Record<string, unknown>>)
          : [];
        const presenceCountries = presence
          .map((p) => (typeof p?.country === "string" ? p.country.trim() : ""))
          .filter((c) => c.length > 0);
        const isMultinational =
          presenceCountries.length > 1 ||
          presence.some(
            (p) =>
              typeof p?.role === "string" &&
              p.role.length > 0 &&
              p.role !== "hq",
          );
        if (isMultinational && !entityRoleAnswer) {
          const displayName =
            (typeof draft.brandName === "string" && draft.brandName) ||
            (typeof draft.name === "string" && draft.name) ||
            rawName;
          const countryList =
            presenceCountries.length > 0
              ? presenceCountries.slice(0, 6).join(", ")
              : "multiple countries";
          return {
            ok: true,
            data: { clarificationPending: true },
            clarification: {
              field: "entityRole",
              tool: "prefill_from_specialist",
              question:
                `${displayName} has a presence across multiple markets (${countryList}). ` +
                `Is the account you're creating the global headquarters, or a specific ` +
                `branch/subsidiary? This sets the entity's role on the record.`,
              partial: {
                kind: "account",
                input: { ...inp, __researchedDraft: draft },
              },
              suggestions: [
                { id: "hq", label: "Global headquarters" },
                { id: "subsidiary", label: "A subsidiary" },
                { id: "branch", label: "A branch / local office" },
              ],
            },
          };
        }
        // Stamp the resolved role (if any) onto the draft so it carries through
        // "Review & Create" into the account record.
        if (entityRoleAnswer) draft.entityRole = entityRoleAnswer;

        const required = ["sector", "country"];
        const missingRequiredFields = required.filter((k) => {
          const v = draft[k];
          return v == null || (typeof v === "string" && v.trim() === "");
        });
        // Task #560 — partnerOwnerId is NO LONGER forced onto
        // missingRequiredFields. The chat flow now ends here by emitting an
        // `account_proposal` card; the partner reviews the draft and clicks
        // "Review & Create", which opens the pre-populated CreateAccountDialog
        // (partner-owner defaulted to the acting partner) and writes the row
        // through the standard POST /accounts route. There is no in-chat
        // confirm card, so there is nothing to leave unsatisfied.
        return {
          ok: true,
          data: {
            // Drives the frontend ShapeBody renderer (overrides the
            // capability default via the per-result shape hint).
            shape: "account_proposal",
            specialist: {
              id: "ag_account_cartographer",
              name: "Account Cartographer",
              mode: "research_only",
              costUsd,
            },
            draft,
            missingRequiredFields,
            missingOptionalFields: ["website", "size"],
            lowConfidenceFields: [],
          },
        };
      } catch (e) {
        // The Cartographer prefill is ADVISORY — the partner always reviews and
        // edits the draft on the `account_proposal` card before the account is
        // actually written. A web-search/synthesis timeout (a heavy
        // conglomerate that exhausts the research budget mid-synthesis surfaces
        // as "Request was aborted") must therefore NOT block account creation.
        // Degrade gracefully: emit the same proposal card pre-filled with
        // whatever the partner already typed, flagged `degraded` so the UI and
        // the orchestrator's final message make clear auto-enrichment couldn't
        // finish and the remaining fields need manual entry on Review & Create.
        const reason = (e as Error).message;
        console.warn(
          `[prefill_from_specialist] Account Cartographer failed for "${rawName}"; degrading to manual draft: ${reason}`,
        );
        const fallbackDraft: Record<string, unknown> = {
          name: rawName,
          brandName: rawName,
          country: typeof inp.country === "string" ? inp.country : null,
          sector: typeof inp.sector === "string" ? inp.sector : null,
          hqCity: typeof inp.hqCity === "string" ? inp.hqCity : null,
          strategicPriorities: [],
          sourceSignals: [],
          decisionMakers: [],
        };
        if (entityRoleAnswer) fallbackDraft.entityRole = entityRoleAnswer;
        const required = ["sector", "country"];
        const missingRequiredFields = required.filter((k) => {
          const v = fallbackDraft[k];
          return v == null || (typeof v === "string" && v.trim() === "");
        });
        return {
          ok: true,
          data: {
            shape: "account_proposal",
            degraded: true,
            degradedReason: reason,
            specialist: {
              id: "ag_account_cartographer",
              name: "Account Cartographer",
              mode: "research_only",
              costUsd: 0,
            },
            draft: fallbackDraft,
            missingRequiredFields,
            missingOptionalFields: ["website", "size"],
            lowConfidenceFields: [],
          },
        };
      }
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
    // Role-aware override: only partner-grade personas may exercise
    // partnerOverride on a gate. Surfacing this in the gate row so
    // the LLM (and the user) doesn't see an "Override" affordance
    // they cannot actually invoke.
    const canOverride =
      ctx.persona.role === "partner" || ctx.persona.role === "founding_partner";

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
          overrideAvailable: canOverride,
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
            overrideAvailable: canOverride,
          });
          rows.push({
            id: "partner_authority_lock",
            label: "Partner Authority Lock satisfied",
            met: !!row.partnerApprovedAt || partnerOverride,
            reason: row.partnerApprovedAt
              ? undefined
              : "A partner must approve before publish (or override with logged rationale).",
            overrideAvailable: canOverride,
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
            overrideAvailable: canOverride,
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
      const blockers = rows
        .filter((r) => !r.met)
        .map((r) => r.reason || (Array.isArray(r.missing) ? r.missing.join(", ") : "") || r.label);
      const evidence = rows.map((r) => ({
        code: r.id,
        label: r.label,
        value: r.met ? "met" : (r.reason || "missing"),
      }));
      return {
        ok: true,
        data: {
          // Task #411 — flat top-level shape consumed directly by the
          // GateReport renderer (no nested wrapper).
          kind,
          targetId,
          entityName,
          fromStage: currentStage,
          toStage,
          partnerOverride,
          partnerOverrideAvailable: partnerOverride === true,
          passed: allMet,
          allMet,
          blockers,
          evidence,
          gates: rows,
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
        overrideAvailable: canOverride,
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
        overrideAvailable: canOverride,
      });
    }
    if (isRunnerToContract) {
      const isThisGate = err?.gate === "runner_to_contract";
      rows.push({
        id: "runner_to_contract",
        label: "Signed instrument attached as artifact",
        met: !isThisGate,
        reason: isThisGate ? err?.reason : undefined,
        overrideAvailable: canOverride,
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
    const blockers = rows
      .filter((r) => !r.met)
      .map((r) => r.reason || (Array.isArray(r.missing) ? r.missing.join(", ") : "") || r.label);
    const evidence = rows.map((r) => ({
      code: r.id,
      label: r.label,
      value: r.met ? "met" : (r.reason || "missing"),
    }));
    const partnerOverrideAvailable = rows.some((r) => r.overrideAvailable === true);

    // Task #499 — evaluate_gate resolves to a single opportunity; offer
    // a navigateTo hint so the chat lands on the opportunity workspace
    // while the partner reviews the gate report.
    const oppNavPath = entityNavPath("opportunity", opp.id);
    const oppNavigateTo = oppNavPath
      ? { path: oppNavPath, when: "on_commit" as const }
      : null;
    return {
      ok: true,
      data: {
        // Task #411 — flat top-level shape consumed directly by the
        // GateReport renderer (no nested wrapper).
        kind: "opportunity",
        targetId: opp.id,
        opportunityId: opp.id,
        opportunityName: opp.name,
        entityName: opp.name,
        fromStage,
        toStage,
        partnerOverride,
        partnerOverrideAvailable,
        passed: allMet,
        allMet,
        blockers,
        evidence,
        gates: rows,
        evidenceSource: {
          qualify5cFromOpportunity: !proposed.qualify5c && !!opp.qualify5c,
          goNoGoFromOpportunity: !proposed.goNoGoDecision && !!opp.goNoGoDecision,
        },
        navigateTo: oppNavigateTo,
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

    if (input.confirm !== true) {
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
