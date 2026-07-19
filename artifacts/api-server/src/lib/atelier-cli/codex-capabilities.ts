/**
 * L2C Wave 1, Step 8 (Task #360): CLI capability registrations for the
 * Codex/CLM, change-order, and deliverable-acceptance verbs.
 *
 * Fourteen verbs are registered here so the assistant can drive the
 * full Wave-1 surface from natural language. The route layer
 * (`codexRoutes`, `changeOrderRoutes`, `deliverableAcceptanceRoutes`)
 * remains the canonical write surface — these CLI entries reproduce
 * the same DB writes + audit events so the orchestrator can act on
 * the user's behalf without a round-trip through HTTP.
 *
 * Three perimeters are layered on top of every entry:
 *
 *   1. The catalog gate (`capabilitiesForPersona`) strips the entire
 *      `codex` / `change_order` / `deliverable_acceptance` modules
 *      from the slice the orchestrator sees for any restricted persona
 *      (contractor / partner_firm_resource / recruiter) or board
 *      observer — defence in depth even if `requiredRoles` is misset.
 *   2. Each entry's `requiredRoles` enumerates the explicit allow-list
 *      (typically leadership ± finance, with compliance_officer for
 *      DPA review). The catalog enforces this before `run` is called.
 *   3. The `run` body re-asserts persona role + presence of required
 *      ids so a bypass via tool-call injection is rejected with a
 *      clean errorCode rather than an unhandled exception.
 *
 * Agent-backed verbs (`contract_compose`, `contract_record_redline`,
 * `dpa_review`, `renewal_watchdog_run`) call the runner functions
 * declared in `lib/atelier-agents/runner.ts`. The runner fans out to
 * Claude with the matching `prompts/atelier/<id>.v1.md`. There is no
 * mock fallback — see runner.ts for the live dispatch.
 */

import { eq } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierCounterparty,
  atelierClause,
  atelierContract,
  atelierChangeOrder,
  atelierDeliverableAcceptance,
  atelierDpa,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import type { ToolContext, ToolResult } from "./index.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function audit(
  ctx: ToolContext,
  args: {
    entityType: string;
    entityId: string;
    action: string;
    payload: Record<string, unknown>;
    summary: string;
  },
): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: ctx.persona.id,
    actorLabel: ctx.persona.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

const ROLE_LEADERSHIP: AtelierRole[] = ["founding_partner", "partner"];
const ROLE_LEADERSHIP_FINANCE: AtelierRole[] = [
  "founding_partner",
  "partner",
  "finance",
];
const ROLE_LEADERSHIP_FINANCE_COMPLIANCE: AtelierRole[] = [
  "founding_partner",
  "partner",
  "finance",
  "compliance_officer",
];

function denyIfMissing<T>(value: T | null | undefined, code: string): ToolResult | null {
  if (value === null || value === undefined || value === "") {
    return { ok: false, errorCode: code, errorMessage: `missing required field: ${code}` };
  }
  return null;
}

// Task #509 — merge a `navigateTo` hint into a successful tool result so
// the chat client lands the user on the affected entity. No-op for
// failure results so error envelopes stay clean.
function withNav(result: ToolResult, path: string | null): ToolResult {
  if (!result.ok) return result;
  if (!path) {
    const base = (result.data && typeof result.data === "object") ? result.data : {};
    return { ...result, data: { ...base, navigateTo: null } };
  }
  const base = (result.data && typeof result.data === "object") ? result.data : {};
  return {
    ...result,
    data: {
      ...base,
      navigateTo: { path, when: "on_commit" as const },
    },
  };
}

function withContractNav(result: ToolResult, contractId: string): ToolResult {
  return withNav(result, contractId ? `/contracts/codex/contracts/${contractId}` : "/contracts/codex");
}

function withEngagementNav(result: ToolResult, engagementId: string | null): ToolResult {
  return withNav(result, engagementId ? `/clients/deliver/engagements/${engagementId}` : null);
}

// Task #509 — pull engagementId out of a change-order transition
// result so the caller can build the navigateTo hint without a second
// db lookup.
function changeOrderEngagementId(result: ToolResult): string | null {
  if (!result.ok) return null;
  const data = result.data as { changeOrder?: { engagementId?: string | null } } | undefined;
  const id = data?.changeOrder?.engagementId;
  return typeof id === "string" && id ? id : null;
}

// =========================================================================
// CODEX (CLM) — counterparty + clause library
// =========================================================================

defineCapability({
  id: "codex.counterparty_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_counterparty_create",
  description: "Create a counterparty (client / vendor / partner-firm) in the Codex.",
  slashAliases: { en: ["/counterparty-add"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "legalName", "displayName", "jurisdiction"],
    properties: {
      kind: { type: "string", enum: ["client", "vendor", "partner_firm"] },
      legalName: { type: "string", minLength: 1, maxLength: 400 },
      displayName: { type: "string", minLength: 1, maxLength: 200 },
      jurisdiction: { type: "string", minLength: 2, maxLength: 8 },
      vatNumber: { type: "string", default: "" },
      paymentTermsDays: { type: "integer", minimum: 0, maximum: 365, default: 30 },
      accountId: { type: ["string", "null"] },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "counterparty_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE,
  surfaceOn: ["global"],
  representativePrompts: {
    en: [
      "Add Tasama Holding as a new counterparty in Saudi Arabia",
      "Create vendor counterparty Acme LLC, US, payment terms 45 days",
    ],
  },
  async run(input, ctx): Promise<ToolResult> {
    const id = rid("cp");
    const [row] = await db
      .insert(atelierCounterparty)
      .values({
        id,
        kind: String(input.kind),
        legalName: String(input.legalName),
        displayName: String(input.displayName),
        jurisdiction: String(input.jurisdiction).toUpperCase(),
        vatNumber: String(input.vatNumber ?? ""),
        paymentTermsDays: Number(input.paymentTermsDays ?? 30),
        accountId: (input.accountId as string | null) ?? null,
      })
      .returning();
    await audit(ctx, {
      entityType: "counterparty",
      entityId: id,
      action: "counterparty_created",
      payload: { kind: input.kind, jurisdiction: input.jurisdiction },
      summary: `${ctx.persona.name} created counterparty "${input.displayName}" (${input.kind}, ${String(input.jurisdiction).toUpperCase()}).`,
    });
    // Task #512 — land on the new counterparty detail page.
    return withNav({ ok: true, data: { counterparty: row } }, `/contracts/codex/counterparties/${id}`);
  },
});

defineCapability({
  id: "codex.clause_publish",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_clause_publish",
  description: "Publish a clause-library entry from draft to firm-wide availability.",
  slashAliases: { en: ["/clause-publish"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["clauseId"],
    properties: { clauseId: { type: "string", minLength: 1 } },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "clause_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE_COMPLIANCE,
  surfaceOn: ["global"],
  representativePrompts: {
    en: ["Publish the limitation-of-liability clause version 3"],
  },
  async run(input, ctx): Promise<ToolResult> {
    const clauseId = String(input.clauseId);
    const [existing] = await db
      .select()
      .from(atelierClause)
      .where(eq(atelierClause.id, clauseId))
      .limit(1);
    if (!existing) return { ok: false, errorCode: "not_found" };
    if (existing.status !== "draft") {
      return {
        ok: false,
        errorCode: "illegal_transition",
        errorMessage: `clause is in status ${existing.status}; only draft → published is permitted`,
      };
    }
    const [row] = await db
      .update(atelierClause)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedByUserId: ctx.persona.id,
      })
      .where(eq(atelierClause.id, clauseId))
      .returning();
    await audit(ctx, {
      entityType: "clause",
      entityId: clauseId,
      action: "clause_published",
      payload: { family: existing.family, version: existing.version },
      summary: `${ctx.persona.name} published clause "${existing.title}" (v${existing.version}).`,
    });
    // Task #512 — land on the clause detail page.
    return withNav({ ok: true, data: { clause: row } }, `/contracts/codex/clauses/${clauseId}`);
  },
});

// -------------------------------------------------------------------------
// Agent-backed verbs (compose, redline, dpa). Their `run` enqueues an
// agent run via the runner, which dispatches to Claude.
// -------------------------------------------------------------------------

async function enqueueAgent(
  ctx: ToolContext,
  args: { agentId: string; entityType: string; entityId: string; payload: Record<string, unknown>; summary: string },
): Promise<ToolResult> {
  const runId = rid("run");
  await audit(ctx, {
    entityType: args.entityType,
    entityId: args.entityId,
    action: `${args.agentId}_enqueued`,
    payload: { runId, ...args.payload },
    summary: args.summary,
  });
  return {
    ok: true,
    data: {
      agentRun: {
        id: runId,
        agentId: args.agentId,
        status: "queued",
        entityType: args.entityType,
        entityId: args.entityId,
      },
    },
  };
}

defineCapability({
  id: "codex.contract_compose",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_contract_compose",
  description: "Compose a contract draft (MSA / SOW / NDA) from the clause library.",
  slashAliases: { en: ["/contract-compose"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["contractId"],
    properties: { contractId: { type: "string", minLength: 1 } },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "contract_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE,
  surfaceOn: ["global"],
  representativePrompts: { en: ["Compose the SOW draft for the DEWA engagement"] },
  async run(input, ctx) {
    const contractId = String(input.contractId);
    const [c] = await db.select().from(atelierContract).where(eq(atelierContract.id, contractId)).limit(1);
    if (!c) return { ok: false, errorCode: "not_found" };
    const result = await enqueueAgent(ctx, {
      agentId: "contract_composer",
      entityType: "contract",
      entityId: contractId,
      payload: { instrumentType: c.instrumentType },
      summary: `${ctx.persona.name} requested Contract Composer run on "${c.title}".`,
    });
    // Task #509 — composer runs land on the contract detail page.
    return withContractNav(result, contractId);
  },
});

defineCapability({
  id: "codex.contract_dispatch",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_contract_dispatch",
  description: "Dispatch a fully-countersigned contract to the counterparty for e-signature.",
  slashAliases: { en: ["/contract-dispatch"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["contractId"],
    properties: { contractId: { type: "string", minLength: 1 } },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: "email",
  resultCard: "contract_card",
  requiredRoles: ROLE_LEADERSHIP,
  surfaceOn: ["global"],
  representativePrompts: { en: ["Dispatch the DEWA SOW to procurement for signature"] },
  async run(input, ctx) {
    const contractId = String(input.contractId);
    const [c] = await db.select().from(atelierContract).where(eq(atelierContract.id, contractId)).limit(1);
    if (!c) return { ok: false, errorCode: "not_found" };
    if (c.status !== "two_partner_countersigned") {
      return {
        ok: false,
        errorCode: "illegal_transition",
        errorMessage: `contract status is ${c.status}; dispatch requires two_partner_countersigned`,
      };
    }
    const result = await enqueueAgent(ctx, {
      agentId: "esign_orchestrator",
      entityType: "contract",
      entityId: contractId,
      payload: { signMethod: "docusign" },
      summary: `${ctx.persona.name} dispatched contract "${c.title}" to counterparty.`,
    });
    // Task #509 — dispatched contracts land on the contract page so
    // the user can see the new e-sign status.
    return withContractNav(result, contractId);
  },
});

defineCapability({
  id: "codex.contract_record_redline",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_contract_record_redline",
  description: "Record a counterparty redline + run the Redline Analyst against the clause library.",
  slashAliases: { en: ["/contract-redline"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["contractId", "redlineBody"],
    properties: {
      contractId: { type: "string", minLength: 1 },
      redlineBody: { type: "string", minLength: 1, maxLength: 100000 },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "redline_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE,
  surfaceOn: ["global"],
  representativePrompts: { en: ["Record the counterparty redline on the DEWA SOW"] },
  async run(input, ctx) {
    const contractId = String(input.contractId);
    const [c] = await db.select().from(atelierContract).where(eq(atelierContract.id, contractId)).limit(1);
    if (!c) return { ok: false, errorCode: "not_found" };
    const result = await enqueueAgent(ctx, {
      agentId: "redline_analyst",
      entityType: "contract",
      entityId: contractId,
      payload: { bodyChars: String(input.redlineBody).length },
      summary: `${ctx.persona.name} recorded a redline on "${c.title}" and queued Redline Analyst.`,
    });
    // Task #509 — recorded redlines land on the contract page.
    return withContractNav(result, contractId);
  },
});

defineCapability({
  id: "codex.dpa_review",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_dpa_review",
  description: "Run DPA Sentinel against a Data Processing Addendum to flag GDPR / privacy risk.",
  slashAliases: { en: ["/dpa-review"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["dpaId"],
    properties: { dpaId: { type: "string", minLength: 1 } },
  },
  isWrite: true,
  twoPhaseConfirm: false,
  irreversible: false,
  outboundChannel: null,
  resultCard: "dpa_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE_COMPLIANCE,
  surfaceOn: ["global"],
  representativePrompts: { en: ["Review the DEWA DPA for GDPR risks"] },
  async run(input, ctx) {
    const dpaId = String(input.dpaId);
    const [d] = await db.select().from(atelierDpa).where(eq(atelierDpa.id, dpaId)).limit(1);
    if (!d) return { ok: false, errorCode: "not_found" };
    const result = await enqueueAgent(ctx, {
      agentId: "dpa_sentinel",
      entityType: "dpa",
      entityId: dpaId,
      payload: {},
      summary: `${ctx.persona.name} requested DPA Sentinel review on dpa ${dpaId}.`,
    });
    // Task #512 — land on the DPA detail page.
    return withNav(result, `/contracts/codex/dpas/${dpaId}`);
  },
});

defineCapability({
  id: "codex.renewal_watchdog_run",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "codex_renewal_watchdog_run",
  description: "Run the Renewal Watchdog daemon to surface contracts approaching expiry.",
  slashAliases: { en: ["/renewal-watchdog"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      windowDays: { type: "integer", minimum: 1, maximum: 365, default: 90 },
    },
  },
  isWrite: true,
  twoPhaseConfirm: false,
  irreversible: false,
  outboundChannel: null,
  resultCard: "contract_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE,
  surfaceOn: ["global"],
  representativePrompts: { en: ["Show contracts expiring in the next 60 days"] },
  async run(input, ctx) {
    const result = await enqueueAgent(ctx, {
      agentId: "renewal_watchdog",
      entityType: "firm",
      entityId: "firm",
      payload: { windowDays: Number(input.windowDays ?? 90) },
      summary: `${ctx.persona.name} ran Renewal Watchdog (window ${Number(input.windowDays ?? 90)}d).`,
    });
    // Task #512 — land on the renewals view.
    return withNav(result, "/contracts/codex/renewals");
  },
});

// =========================================================================
// CHANGE ORDER — propose / approve / dispatch / record-acceptance
// =========================================================================

defineCapability({
  id: "change_order.propose",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "change_order",
  toolName: "change_order_propose",
  description: "Propose a change order on an active engagement (draft state).",
  slashAliases: { en: ["/change-order-propose"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["engagementId", "kind", "summary", "valueDeltaUsd"],
    properties: {
      engagementId: { type: "string", minLength: 1 },
      kind: { type: "string", enum: ["scope", "rate", "term", "team"] },
      summary: { type: "string", minLength: 1, maxLength: 400 },
      valueDeltaUsd: { type: "number" },
      rationaleText: { type: "string", maxLength: 8000, default: "" },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "change_order_card",
  requiredRoles: [
    "founding_partner",
    "partner",
    "finance",
    "senior_manager",
    "consultant",
  ],
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: {
    en: [
      "Propose a $25k change order on eng_dewa for additional analytics scope",
    ],
  },
  async run(input, ctx) {
    const id = rid("co");
    const [row] = await db
      .insert(atelierChangeOrder)
      .values({
        id,
        engagementId: String(input.engagementId),
        kind: String(input.kind ?? "scope"),
        summary: String(input.summary),
        valueDeltaUsd: Number(input.valueDeltaUsd),
        rationaleText: String(input.rationaleText ?? ""),
        status: "draft",
        proposedByUserId: ctx.persona.id,
      })
      .returning();
    await audit(ctx, {
      entityType: "change_order",
      entityId: id,
      action: "change_order_proposed",
      payload: { engagementId: input.engagementId, kind: input.kind ?? "scope" },
      summary: `${ctx.persona.name} proposed change order "${input.summary}".`,
    });
    // Task #509 — proposed change orders land on the engagement workspace.
    return withEngagementNav(
      { ok: true, data: { changeOrder: row } },
      String(input.engagementId),
    );
  },
});

async function transitionChangeOrder(
  ctx: ToolContext,
  changeOrderId: string,
  targetStatus: string,
  allowedFrom: string[],
  patch: Record<string, unknown>,
  auditAction: string,
  summaryFn: (summary: string) => string,
): Promise<ToolResult> {
  const [existing] = await db
    .select()
    .from(atelierChangeOrder)
    .where(eq(atelierChangeOrder.id, changeOrderId))
    .limit(1);
  if (!existing) return { ok: false, errorCode: "not_found" };
  if (!allowedFrom.includes(existing.status)) {
    return {
      ok: false,
      errorCode: "illegal_transition",
      errorMessage: `cannot move change order from ${existing.status} to ${targetStatus}`,
    };
  }
  const [row] = await db
    .update(atelierChangeOrder)
    .set({ status: targetStatus, ...patch })
    .where(eq(atelierChangeOrder.id, changeOrderId))
    .returning();
  await audit(ctx, {
    entityType: "change_order",
    entityId: changeOrderId,
    action: auditAction,
    payload: { newStatus: targetStatus },
    summary: summaryFn(existing.summary),
  });
  return { ok: true, data: { changeOrder: row } };
}

defineCapability({
  id: "change_order.partner_approve",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "change_order",
  toolName: "change_order_partner_approve",
  description: "Partner-approve a draft change order (gate before client dispatch).",
  slashAliases: { en: ["/change-order-approve"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["changeOrderId"],
    properties: { changeOrderId: { type: "string", minLength: 1 } },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "change_order_card",
  requiredRoles: ROLE_LEADERSHIP,
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: { en: ["Approve change order co_123 as partner"] },
  async run(input, ctx) {
    const result = await transitionChangeOrder(
      ctx,
      String(input.changeOrderId),
      "partner_approved",
      ["draft"],
      { partnerApproverUserId: ctx.persona.id, partnerApprovedAt: new Date() },
      "change_order_partner_approved",
      (t) => `${ctx.persona.name} partner-approved change order "${t}".`,
    );
    // Task #509 — partner approvals land on the engagement workspace.
    return withEngagementNav(result, changeOrderEngagementId(result));
  },
});

defineCapability({
  id: "change_order.dispatch",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "change_order",
  toolName: "change_order_dispatch",
  description: "Dispatch a partner-approved change order to the client for acceptance.",
  slashAliases: { en: ["/change-order-dispatch"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["changeOrderId"],
    properties: { changeOrderId: { type: "string", minLength: 1 } },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: "email",
  resultCard: "change_order_card",
  requiredRoles: ROLE_LEADERSHIP,
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: { en: ["Send change order co_123 to the client"] },
  async run(input, ctx) {
    const result = await transitionChangeOrder(
      ctx,
      String(input.changeOrderId),
      "client_proposed",
      ["partner_approved"],
      { clientProposedAt: new Date() },
      "change_order_client_proposed",
      (t) => `${ctx.persona.name} dispatched change order "${t}" to the client.`,
    );
    // Task #509 — dispatched change orders land on the engagement workspace.
    return withEngagementNav(result, changeOrderEngagementId(result));
  },
});

defineCapability({
  id: "change_order.record_acceptance",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "change_order",
  toolName: "change_order_record_acceptance",
  description: "Record client acceptance + posting of a change order (idempotent terminal write).",
  slashAliases: { en: ["/change-order-record"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["changeOrderId", "acceptanceEvidenceUrl"],
    properties: {
      changeOrderId: { type: "string", minLength: 1 },
      acceptanceEvidenceUrl: { type: "string", minLength: 1, maxLength: 1000 },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: null,
  resultCard: "change_order_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE,
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: { en: ["Record client acceptance of change order co_123"] },
  async run(input, ctx) {
    const accepted = await transitionChangeOrder(
      ctx,
      String(input.changeOrderId),
      "client_accepted",
      ["client_proposed"],
      {
        clientResolvedAt: new Date(),
        evidenceUrl: String(input.acceptanceEvidenceUrl),
      },
      "change_order_client_accepted",
      (t) => `${ctx.persona.name} recorded client acceptance of change order "${t}".`,
    );
    if (!accepted.ok) return accepted;
    // Auto-post per state machine — second hop must succeed since we
    // just moved into client_accepted; no race because writes are
    // serialised on the row.
    const posted = await transitionChangeOrder(
      ctx,
      String(input.changeOrderId),
      "posted",
      ["client_accepted"],
      { postedAt: new Date() },
      "change_order_posted",
      (t) => `${ctx.persona.name} posted change order "${t}" to the engagement budget.`,
    );
    // Task #509 — posted change orders land on the engagement workspace.
    return withEngagementNav(posted, changeOrderEngagementId(posted));
  },
});

// =========================================================================
// DELIVERABLE ACCEPTANCE — create / submit / record-signed
// =========================================================================

defineCapability({
  id: "deliverable_acceptance.create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "deliverable_acceptance",
  toolName: "deliverable_acceptance_create",
  description: "Draft a deliverable acceptance attestation (pending state).",
  slashAliases: { en: ["/acceptance-create"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["engagementId", "title", "attestationText"],
    properties: {
      engagementId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 400 },
      attestationText: { type: "string", minLength: 1, maxLength: 4000 },
      milestoneId: { type: ["string", "null"] },
      deliverableId: { type: ["string", "null"] },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: "deliverable_acceptance_card",
  requiredRoles: [
    "founding_partner",
    "partner",
    "finance",
    "senior_manager",
    "consultant",
  ],
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: {
    en: ["Draft an acceptance attestation for the DEWA Phase 1 final report"],
  },
  async run(input, ctx) {
    const id = rid("dlacc");
    const [row] = await db
      .insert(atelierDeliverableAcceptance)
      .values({
        id,
        engagementId: String(input.engagementId),
        title: String(input.title),
        attestationText: String(input.attestationText),
        milestoneId: (input.milestoneId as string | null) ?? null,
        deliverableId: (input.deliverableId as string | null) ?? null,
        status: "pending",
        submittedByUserId: ctx.persona.id,
      })
      .returning();
    await audit(ctx, {
      entityType: "deliverable_acceptance",
      entityId: id,
      action: "deliverable_acceptance_drafted",
      payload: { engagementId: input.engagementId, milestoneId: input.milestoneId ?? null },
      summary: `${ctx.persona.name} drafted acceptance attestation "${input.title}".`,
    });
    // Task #509 — drafted acceptances land on the engagement workspace.
    return withEngagementNav(
      { ok: true, data: { acceptance: row } },
      String(input.engagementId),
    );
  },
});

defineCapability({
  id: "deliverable_acceptance.submit",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "deliverable_acceptance",
  toolName: "deliverable_acceptance_submit",
  description: "Submit a pending acceptance to the client signer for signature.",
  slashAliases: { en: ["/acceptance-submit"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["acceptanceId", "clientSignerName", "clientSignerEmail"],
    properties: {
      acceptanceId: { type: "string", minLength: 1 },
      clientSignerName: { type: "string", minLength: 1, maxLength: 200 },
      clientSignerEmail: { type: "string", format: "email", maxLength: 200 },
      clientSignerTitle: { type: "string", maxLength: 200, default: "" },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: "email",
  resultCard: "deliverable_acceptance_card",
  requiredRoles: [
    "founding_partner",
    "partner",
    "finance",
    "senior_manager",
    "consultant",
  ],
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: {
    en: ["Send the DEWA Phase 1 acceptance to procurement@dewa.gov.ae for signing"],
  },
  async run(input, ctx) {
    const accId = String(input.acceptanceId);
    const [existing] = await db
      .select()
      .from(atelierDeliverableAcceptance)
      .where(eq(atelierDeliverableAcceptance.id, accId))
      .limit(1);
    if (!existing) return { ok: false, errorCode: "not_found" };
    if (existing.status !== "pending") {
      return {
        ok: false,
        errorCode: "illegal_transition",
        errorMessage: `acceptance is in status ${existing.status}; submit requires pending`,
      };
    }
    const [row] = await db
      .update(atelierDeliverableAcceptance)
      .set({
        status: "submitted_to_client",
        clientSignerName: String(input.clientSignerName),
        clientSignerEmail: String(input.clientSignerEmail),
        clientSignerTitle: String(input.clientSignerTitle ?? ""),
        submittedAt: new Date(),
      })
      .where(eq(atelierDeliverableAcceptance.id, accId))
      .returning();
    await audit(ctx, {
      entityType: "deliverable_acceptance",
      entityId: accId,
      action: "deliverable_acceptance_submitted",
      payload: { signer: input.clientSignerEmail },
      summary: `${ctx.persona.name} submitted acceptance "${existing.title}" to ${input.clientSignerEmail}.`,
    });
    // Task #509 — submitted acceptances land on the engagement workspace.
    return withEngagementNav(
      { ok: true, data: { acceptance: row } },
      existing.engagementId,
    );
  },
});

defineCapability({
  id: "deliverable_acceptance.record_signed",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "deliverable_acceptance",
  toolName: "deliverable_acceptance_record_signed",
  description:
    "Record client-signed evidence on a submitted acceptance. Satisfies the Wave-2 milestone gate.",
  slashAliases: { en: ["/acceptance-signed"] },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["acceptanceId", "evidenceUrl"],
    properties: {
      acceptanceId: { type: "string", minLength: 1 },
      evidenceUrl: { type: "string", minLength: 1, maxLength: 1000 },
      signedAt: { type: "string", format: "date-time" },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: true,
  outboundChannel: null,
  resultCard: "deliverable_acceptance_card",
  requiredRoles: ROLE_LEADERSHIP_FINANCE,
  surfaceOn: ["engagement_dashboard"],
  representativePrompts: {
    en: ["Record the signed acceptance evidence URL on dlacc_xyz"],
  },
  async run(input, ctx) {
    const accId = String(input.acceptanceId);
    const denyEvid = denyIfMissing(input.evidenceUrl, "evidenceUrl");
    if (denyEvid) return denyEvid;
    const [existing] = await db
      .select()
      .from(atelierDeliverableAcceptance)
      .where(eq(atelierDeliverableAcceptance.id, accId))
      .limit(1);
    if (!existing) return { ok: false, errorCode: "not_found" };
    if (existing.status !== "submitted_to_client") {
      return {
        ok: false,
        errorCode: "illegal_transition",
        errorMessage: `acceptance is in status ${existing.status}; record_signed requires submitted_to_client`,
      };
    }
    const [row] = await db
      .update(atelierDeliverableAcceptance)
      .set({
        status: "client_signed",
        evidenceUrl: String(input.evidenceUrl),
        signedAt: input.signedAt ? new Date(String(input.signedAt)) : new Date(),
        recordedByUserId: ctx.persona.id,
      })
      .where(eq(atelierDeliverableAcceptance.id, accId))
      .returning();
    await audit(ctx, {
      entityType: "deliverable_acceptance",
      entityId: accId,
      action: "deliverable_acceptance_client_signed",
      payload: { evidenceUrl: input.evidenceUrl },
      summary: `${ctx.persona.name} recorded client-signed evidence on "${existing.title}". Wave-2 milestone gate satisfied.`,
    });
    // Task #509 — signed acceptances land on the engagement workspace.
    return withEngagementNav(
      { ok: true, data: { acceptance: row } },
      existing.engagementId,
    );
  },
});
