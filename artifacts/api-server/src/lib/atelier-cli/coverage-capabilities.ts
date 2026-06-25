/**
 * Task #411 — Coverage expansion: 15 new write entities for chat.
 *
 * Each entry below is a thin self-contained write capability that the
 * propose_write dispatcher can call in-process when a chat turn
 * commits one of these entity creates / updates. They sit alongside
 * the heavier compose-style tools (proposal_compose, contract_compose,
 * etc.) so chat can perform a typed lightweight write without invoking
 * the full agent run.
 *
 * Pattern: every wrapper accepts `{ confirm: true, ... }`, performs
 * one INSERT or UPDATE against the typed Drizzle schema, writes one
 * audit row, and returns the new / updated row plus its id. RLS is
 * enforced upstream by the request middleware (atelier-rls.sql) so
 * the wrappers do not re-check tenancy beyond `orgId` filtering on
 * updates.
 *
 * The wrappers intentionally do NOT replicate the rich validation
 * already on the typed routes — the orchestrator's `evaluate_gate`
 * call covers stage transitions, and these are the simple fields
 * chat is expected to set ad-hoc. Routes remain the canonical writer
 * for the heavy business logic.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { computeNrrDeltaPct } from "../atelier-math.js";
import {
  db,
  atelierAuditEvents,
  atelierMeetings,
  atelierRaidItems,
  atelierProposals,
  atelierPovs,
  atelierBriefs,
  atelierWinLossDebriefs,
  atelierWinThemes,
  atelierAgentDesigns,
  atelierRateCards,
  atelierPartnerFirms,
  atelierTimesheetEntries,
  atelierInvoice,
  atelierRenewal,
  atelierChangeOrder,
  atelierContract,
  atelierAccounts,
  atelierContacts,
  atelierContactRelationships,
  atelierOpportunities,
  atelierDeliverables,
  atelierExpenses,
  atelierEngagements,
  atelierEngagementAccess,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { mirrorEntityEmbedding } from "./entity-resolver.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function audit(
  orgId: string,
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  payload: unknown,
): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: rid("ae"),
      orgId,
      actorType: "human",
      actorId: userId,
      actorLabel: userId,
      entityType,
      entityId,
      action,
      payloadSummary: `${entityType}.${action}`,
      payload: payload as Record<string, unknown>,
    });
  } catch {
    // Audit must never break the write itself.
  }
}

/**
 * Account-visibility guard for chat capabilities (Task #555).
 *
 * Mirrors the REST `canSeeAccount` + `accessibleEngagementIds` logic
 * (accountRoutes.ts / engagementRoutes.ts) so that contact mutation via
 * chat is scoped to the same boundary the REST PATCH/DELETE routes enforce.
 * Without this, a restricted persona (e.g. partner_firm_resource) could
 * edit or remove decision-makers on accounts outside their engagement
 * scope, since the capability handlers otherwise filter only on org +
 * soft-delete.
 *
 * Visibility rule (same as REST):
 *   - partner / founding_partner → firm-wide (all accounts)
 *   - otherwise → an active, non-revoked engagement grant on any engagement
 *     spawned from the account, OR being the account's partner_owner.
 */
async function personaCanSeeAccount(
  persona: { id: string; role?: string },
  accountId: string,
): Promise<boolean> {
  if (persona.role === "partner" || persona.role === "founding_partner") {
    return true;
  }
  const grants = await db
    .select({ engagementId: atelierEngagementAccess.engagementId })
    .from(atelierEngagementAccess)
    .where(
      and(
        eq(atelierEngagementAccess.userId, persona.id),
        eq(atelierEngagementAccess.status, "active"),
        isNull(atelierEngagementAccess.deletedAt),
      ),
    );
  const grantedIds = new Set(grants.map((g) => g.engagementId));
  const engs = await db
    .select({ id: atelierEngagements.id })
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, accountId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (engs.some((e) => grantedIds.has(e.id))) return true;
  const [a] = await db
    .select({ partnerOwnerId: atelierAccounts.partnerOwnerId })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, accountId));
  return a?.partnerOwnerId === persona.id;
}

const COMMON_INPUT_PROPS = {
  confirm: { type: "boolean", description: "Set true to commit." },
  summary: { type: "string", description: "Optional human description." },
};

// ---------------------------------------------------------------------
// 1. meeting (advisory wrapper — heavier capture flow lives in opportunity_capture_meeting)
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.meeting_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "meeting_create",
  description:
    "Create a meeting record on an opportunity or engagement. Lightweight chat wrapper — for transcript ingestion + decisions/action-items extraction use opportunity_capture_meeting.",
  slashAliases: { en: ["/meeting-add"] },
  representativePrompts: { en: ["Log a discovery call with Acme on Tuesday."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      parentType: { type: "string", enum: ["opportunity", "engagement"] },
      parentId: { type: "string", minLength: 4 },
      title: { type: "string", minLength: 3 },
      date: { type: "string", description: "ISO-8601 date." },
      kind: { type: "string", enum: ["discovery", "workshop", "steering", "kickoff"] },
      attendees: { type: "array", items: { type: "string" } },
    },
    required: ["parentType", "parentId", "title", "date"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "meeting_create requires confirm:true." };
    }
    // Task #653 — dedup. A meeting with the same parent, title, and date is the
    // same meeting; return the existing row rather than inserting a duplicate
    // (calendar syncs and re-runs otherwise fan out into noise).
    const dedupTitle = String(input.title).trim();
    const dedupDate = String(input.date).trim();
    const [dupe] = await db
      .select({ id: atelierMeetings.id })
      .from(atelierMeetings)
      .where(
        and(
          eq(atelierMeetings.orgId, ctx.persona.orgId),
          eq(atelierMeetings.parentType, String(input.parentType)),
          eq(atelierMeetings.parentId, String(input.parentId)),
          eq(atelierMeetings.title, dedupTitle),
          eq(atelierMeetings.date, dedupDate),
        ),
      )
      .limit(1);
    if (dupe) {
      return { ok: true, data: { id: dupe.id, kind: "meeting", deduped: true, navigateTo: null } };
    }
    const id = rid("mtg");
    await db.insert(atelierMeetings).values({
      id,
      orgId: ctx.persona.orgId,
      parentType: String(input.parentType),
      parentId: String(input.parentId),
      kind: String(input.kind ?? "discovery"),
      title: String(input.title),
      date: String(input.date),
      attendees: Array.isArray(input.attendees) ? (input.attendees as string[]) : [],
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "meeting", id, "create", input);
    return { ok: true, data: { id, kind: "meeting", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 2. raid_item — quick-add (heavier raid_add_v2 also exists)
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.raid_add",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "raid",
  toolName: "raid_add",
  description:
    "Quick-add a RAID item (Risk / Assumption / Issue / Dependency) on an engagement. For richer two-phase flow with severity prompting, use raid_add_v2.",
  slashAliases: { en: ["/raid"] },
  representativePrompts: { en: ["Add a risk on eng_xyz: vendor SLA may slip."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      engagementId: { type: "string", minLength: 4 },
      kind: { type: "string", enum: ["risk", "assumption", "issue", "dependency"] },
      description: { type: "string", minLength: 3 },
      severity: { type: "string", enum: ["green", "amber", "red"] },
      mitigation: { type: "string" },
      ownerId: { type: "string" },
      dueDate: { type: "string" },
    },
    required: ["engagementId", "kind", "description"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "raid_add requires confirm:true." };
    }
    const id = rid("raid");
    await db.insert(atelierRaidItems).values({
      id,
      orgId: ctx.persona.orgId,
      engagementId: String(input.engagementId),
      kind: String(input.kind),
      description: String(input.description),
      severity: String(input.severity ?? "amber"),
      mitigation: input.mitigation ? String(input.mitigation) : null,
      ownerId: input.ownerId ? String(input.ownerId) : null,
      dueDate: input.dueDate ? String(input.dueDate) : null,
      status: "open",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "raid_item", id, "create", input);
    return {
      ok: true,
      data: {
        id,
        kind: "raid_item",
        // Task #549 — surface the persisted mitigation so the chat
        // result card matches what the REST Workplan UI shows.
        mitigation: input.mitigation ? String(input.mitigation) : null,
        navigateTo: null,
      },
    };
  },
});

// ---------------------------------------------------------------------
// 3. timesheet_entry
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.timesheet_entry_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "timesheet_entry_create",
  description: "Create a draft timesheet entry for a user/day. Submit + approve flows remain on the typed routes.",
  slashAliases: { en: ["/log-time"] },
  representativePrompts: { en: ["Log 4 hours yesterday on eng_alpha — interview prep."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      weekId: { type: "string", minLength: 3 },
      personId: { type: "string", minLength: 3 },
      personType: { type: "string", enum: ["user", "contractor", "partner_resource"] },
      workDate: { type: "string", description: "ISO date" },
      engagementId: { type: "string" },
      activityCode: { type: "string" },
      hours: { type: "number", minimum: 0, maximum: 24 },
      narrative: { type: "string" },
    },
    required: ["weekId", "personId", "personType", "workDate", "hours"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "timesheet_entry_create requires confirm:true." };
    }
    const id = rid("tse");
    await db.insert(atelierTimesheetEntries).values({
      id,
      orgId: ctx.persona.orgId,
      weekId: String(input.weekId),
      personId: String(input.personId),
      personType: String(input.personType),
      workDate: String(input.workDate),
      engagementId: input.engagementId ? String(input.engagementId) : null,
      activityCode: input.activityCode ? String(input.activityCode) : null,
      hours: Number(input.hours),
      narrative: input.narrative ? String(input.narrative) : null,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "timesheet_entry", id, "create", input);
    return { ok: true, data: { id, kind: "timesheet_entry", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.timesheet_entry_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "timesheet_entry_update",
  description: "Update narrative or hours on a draft timesheet entry.",
  slashAliases: { en: ["/log-time-edit"] },
  representativePrompts: { en: ["Change my Tuesday hours from 4 to 6."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      hours: { type: "number" },
      narrative: { type: "string" },
      activityCode: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "timesheet_entry_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierTimesheetEntries.$inferInsert> = { updatedAt: new Date() };
    if (input.hours !== undefined) patch.hours = Number(input.hours);
    if (input.narrative !== undefined) patch.narrative = String(input.narrative);
    if (input.activityCode !== undefined) patch.activityCode = String(input.activityCode);
    await db
      .update(atelierTimesheetEntries)
      .set(patch)
      .where(and(eq(atelierTimesheetEntries.id, id), eq(atelierTimesheetEntries.orgId, ctx.persona.orgId), isNull(atelierTimesheetEntries.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "timesheet_entry", id, "update", input);
    return { ok: true, data: { id, kind: "timesheet_entry", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 4. invoice (lightweight — full compose lives on the routes)
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.invoice_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "invoice_create",
  description: "Create a draft invoice header. Lines + totals come from the typed invoice route.",
  slashAliases: { en: ["/invoice-add"] },
  representativePrompts: { en: ["Open a draft invoice for eng_alpha in EUR."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      jurisdiction: { type: "string", minLength: 2 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      engagementId: { type: "string" },
      accountId: { type: "string" },
      notes: { type: "string" },
      dueDate: { type: "string" },
    },
    required: ["jurisdiction", "currency"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "invoice_create requires confirm:true." };
    }
    const id = rid("inv");
    await db.insert(atelierInvoice).values({
      id,
      orgId: ctx.persona.orgId,
      jurisdiction: String(input.jurisdiction),
      currency: String(input.currency),
      engagementId: input.engagementId ? String(input.engagementId) : null,
      accountId: input.accountId ? String(input.accountId) : null,
      notes: input.notes ? String(input.notes) : null,
      dueDate: input.dueDate ? String(input.dueDate) : null,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "invoice", id, "create", input);
    return { ok: true, data: { id, kind: "invoice", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 5. rate_card
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.rate_card_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "pricing",
  toolName: "rate_card_create",
  description: "Create a new rate card header. Use the pricing route to add rows.",
  slashAliases: { en: ["/rate-card-add"] },
  representativePrompts: { en: ["Create a 2026 KSA+UAE rate card in USD."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      name: { type: "string", minLength: 3 },
      geography: { type: "string", minLength: 2 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      effectiveFrom: { type: "string" },
      effectiveTo: { type: "string" },
      notes: { type: "string" },
    },
    required: ["name", "geography", "currency"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "rate_card_create requires confirm:true." };
    }
    const id = rid("rc");
    await db.insert(atelierRateCards).values({
      id,
      orgId: ctx.persona.orgId,
      name: String(input.name),
      geography: String(input.geography),
      currency: String(input.currency),
      effectiveFrom: input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date(),
      effectiveTo: input.effectiveTo ? new Date(String(input.effectiveTo)) : null,
      notes: input.notes ? String(input.notes) : null,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "rate_card", id, "create", input);
    return { ok: true, data: { id, kind: "rate_card", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.rate_card_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "pricing",
  toolName: "rate_card_update",
  description: "Update a rate card header (name, status, notes, effective window).",
  slashAliases: { en: ["/rate-card-edit"] },
  representativePrompts: { en: ["Archive the 2024 rate card."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      name: { type: "string" },
      status: { type: "string", enum: ["draft", "active", "archived"] },
      notes: { type: "string" },
      effectiveTo: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "rate_card_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierRateCards.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = String(input.name);
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.notes !== undefined) patch.notes = String(input.notes);
    if (input.effectiveTo !== undefined) patch.effectiveTo = new Date(String(input.effectiveTo));
    await db
      .update(atelierRateCards)
      .set(patch)
      .where(and(eq(atelierRateCards.id, id), eq(atelierRateCards.orgId, ctx.persona.orgId), isNull(atelierRateCards.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "rate_card", id, "update", input);
    return { ok: true, data: { id, kind: "rate_card", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 6. partner_firm
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.partner_firm_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "partner_firm_create",
  description: "Register a new partner firm.",
  slashAliases: { en: ["/partner-firm-add"] },
  representativePrompts: { en: ["Add Beacon Advisory as a partner firm in UAE."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      name: { type: "string", minLength: 3 },
      country: { type: "string" },
      hqCountry: { type: "string" },
      contactName: { type: "string" },
      contactEmail: { type: "string" },
      defaultBillingCurrency: { type: "string" },
      defaultPaymentTermsDays: { type: "number" },
      notes: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "partner_firm_create requires confirm:true." };
    }
    const id = rid("pf");
    await db.insert(atelierPartnerFirms).values({
      id,
      orgId: ctx.persona.orgId,
      name: String(input.name),
      country: input.country ? String(input.country) : null,
      hqCountry: input.hqCountry ? String(input.hqCountry) : null,
      contactName: input.contactName ? String(input.contactName) : null,
      contactEmail: input.contactEmail ? String(input.contactEmail) : null,
      defaultBillingCurrency: input.defaultBillingCurrency ? String(input.defaultBillingCurrency) : null,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays !== undefined ? Number(input.defaultPaymentTermsDays) : null,
      notes: input.notes ? String(input.notes) : null,
      status: "active",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "partner_firm", id, "create", input);
    return { ok: true, data: { id, kind: "partner_firm", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.partner_firm_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "partner_firm_update",
  description: "Update a partner firm record.",
  slashAliases: { en: ["/partner-firm-edit"] },
  representativePrompts: { en: ["Mark Beacon Advisory as paused."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      status: { type: "string", enum: ["active", "paused", "terminated"] },
      contactEmail: { type: "string" },
      defaultBillingCurrency: { type: "string" },
      defaultPaymentTermsDays: { type: "number" },
      notes: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "partner_firm_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierPartnerFirms.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.contactEmail !== undefined) patch.contactEmail = String(input.contactEmail);
    if (input.defaultBillingCurrency !== undefined) patch.defaultBillingCurrency = String(input.defaultBillingCurrency);
    if (input.defaultPaymentTermsDays !== undefined) patch.defaultPaymentTermsDays = Number(input.defaultPaymentTermsDays);
    if (input.notes !== undefined) patch.notes = String(input.notes);
    await db
      .update(atelierPartnerFirms)
      .set(patch)
      .where(and(eq(atelierPartnerFirms.id, id), eq(atelierPartnerFirms.orgId, ctx.persona.orgId), isNull(atelierPartnerFirms.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "partner_firm", id, "update", input);
    return { ok: true, data: { id, kind: "partner_firm", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 7. win_theme
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.win_theme_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "win_loss",
  toolName: "win_theme_create",
  description: "Create a win (or loss) theme for the win-loss library.",
  slashAliases: { en: ["/win-theme-add"] },
  representativePrompts: { en: ["Add a win theme: 'agentic-native' wedge."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      name: { type: "string", minLength: 3 },
      description: { type: "string", minLength: 3 },
      tag: { type: "string", minLength: 3 },
      polarity: { type: "string", enum: ["win", "loss"] },
      positioningLine: { type: "string" },
    },
    required: ["name", "description", "tag"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "win_theme_create requires confirm:true." };
    }
    const id = rid("wt");
    await db.insert(atelierWinThemes).values({
      id,
      orgId: ctx.persona.orgId,
      name: String(input.name),
      description: String(input.description),
      tag: String(input.tag),
      polarity: String(input.polarity ?? "win"),
      positioningLine: input.positioningLine ? String(input.positioningLine) : null,
      status: "active",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "win_theme", id, "create", input);
    return { ok: true, data: { id, kind: "win_theme", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 8. win_loss_debrief
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.win_loss_debrief_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "win_loss",
  toolName: "win_loss_debrief_create",
  description: "Open a win/loss debrief on an opportunity.",
  slashAliases: { en: ["/debrief-open"] },
  representativePrompts: { en: ["Open a loss debrief on opp_xyz."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      opportunityId: { type: "string", minLength: 4 },
      outcome: {
        type: "string",
        enum: ["signed", "lost_no_decision", "lost_to_competitor", "withdrawn"],
      },
      sellerNotes: { type: "string" },
    },
    required: ["opportunityId", "outcome"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "win_loss_debrief_create requires confirm:true." };
    }
    const id = rid("wld");
    await db.insert(atelierWinLossDebriefs).values({
      id,
      orgId: ctx.persona.orgId,
      opportunityId: String(input.opportunityId),
      outcome: String(input.outcome),
      sellerNotes: input.sellerNotes ? String(input.sellerNotes) : null,
      status: "pending",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "win_loss_debrief", id, "create", input);
    return { ok: true, data: { id, kind: "win_loss_debrief", navigateTo: null } };
  },
});

// Task #411 round-3 — typed update wrappers for the four entities the
// reviewer flagged as previewing-but-failing-on-commit. Each is a
// minimal partial-patch wrapper that scopes by id+orgId, never
// duplicates rows, and stamps an audit event.

defineCapability({
  id: "coverage.proposal_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_update",
  description: "Patch a proposal draft (title, status, deadline, win themes).",
  slashAliases: { en: ["/proposal-edit"] },
  representativePrompts: { en: ["Update the Acme proposal status to in_review."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      title: { type: "string" },
      status: { type: "string" },
      deadline: { type: "string" },
      winThemes: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "proposal_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierProposals.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = String(input.title);
    if (input.status !== undefined) patch.status = String(input.status);
    if (input.deadline !== undefined) patch.deadline = new Date(String(input.deadline));
    if (Array.isArray(input.winThemes)) patch.winThemes = input.winThemes.map(String);
    await db
      .update(atelierProposals)
      .set(patch)
      .where(and(eq(atelierProposals.id, id), eq(atelierProposals.orgId, ctx.persona.orgId), isNull(atelierProposals.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "proposal", id, "update", input);
    return { ok: true, data: { id, kind: "proposal", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.pov_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "pov_update",
  description: "Patch a PoV draft (title, audience, objective, status).",
  slashAliases: { en: ["/pov-edit"] },
  representativePrompts: { en: ["Update the Tasama PoV objective."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      title: { type: "string" },
      audience: { type: "string" },
      objective: { type: "string" },
      status: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "pov_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierPovs.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = String(input.title);
    if (input.audience !== undefined) patch.audience = String(input.audience);
    if (input.objective !== undefined) patch.objective = String(input.objective);
    if (input.status !== undefined) patch.status = String(input.status);
    await db
      .update(atelierPovs)
      .set(patch)
      .where(and(eq(atelierPovs.id, id), eq(atelierPovs.orgId, ctx.persona.orgId), isNull(atelierPovs.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "pov", id, "update", input);
    return { ok: true, data: { id, kind: "pov", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.contract_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_update",
  description: "Patch a contract draft (title, status, term dates, payment terms, PO).",
  slashAliases: { en: ["/contract-edit"] },
  representativePrompts: { en: ["Update the Acme MSA payment terms to net 45."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      title: { type: "string" },
      status: { type: "string" },
      termStart: { type: "string" },
      termEnd: { type: "string" },
      paymentTermsDays: { type: "number" },
      poNumber: { type: "string" },
      governingLaw: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "contract_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierContract.$inferInsert> = {};
    if (input.title !== undefined) patch.title = String(input.title);
    if (input.status !== undefined) patch.status = String(input.status);
    if (input.termStart !== undefined) patch.termStart = String(input.termStart);
    if (input.termEnd !== undefined) patch.termEnd = String(input.termEnd);
    if (input.paymentTermsDays !== undefined) patch.paymentTermsDays = Number(input.paymentTermsDays);
    if (input.poNumber !== undefined) patch.poNumber = String(input.poNumber);
    if (input.governingLaw !== undefined) patch.governingLaw = String(input.governingLaw);
    await db
      .update(atelierContract)
      .set(patch)
      .where(and(eq(atelierContract.id, id), eq(atelierContract.orgId, ctx.persona.orgId), isNull(atelierContract.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "contract", id, "update", input);
    return { ok: true, data: { id, kind: "contract", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.win_loss_debrief_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "win_loss",
  toolName: "win_loss_debrief_update",
  description: "Patch a win/loss debrief (status, seller notes, hidden competitor).",
  slashAliases: { en: ["/debrief-edit"] },
  representativePrompts: { en: ["Mark the Acme debrief as buyer_done."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 3 },
      status: { type: "string" },
      sellerNotes: { type: "string" },
      hiddenCompetitor: { type: "string" },
      whatWeWouldDoDifferently: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "win_loss_debrief_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierWinLossDebriefs.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status);
    if (input.sellerNotes !== undefined) patch.sellerNotes = String(input.sellerNotes);
    if (input.hiddenCompetitor !== undefined) patch.hiddenCompetitor = String(input.hiddenCompetitor);
    if (input.whatWeWouldDoDifferently !== undefined) {
      patch.whatWeWouldDoDifferently = String(input.whatWeWouldDoDifferently);
    }
    await db
      .update(atelierWinLossDebriefs)
      .set(patch)
      .where(and(eq(atelierWinLossDebriefs.id, id), eq(atelierWinLossDebriefs.orgId, ctx.persona.orgId), isNull(atelierWinLossDebriefs.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "win_loss_debrief", id, "update", input);
    return { ok: true, data: { id, kind: "win_loss_debrief", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 9. brief
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.brief_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "brief_create",
  description: "Create a draft executive brief on an opportunity.",
  slashAliases: { en: ["/brief-add"] },
  representativePrompts: { en: ["Start an executive brief on opp_acme."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      opportunityId: { type: "string", minLength: 4 },
      openQuestions: { type: "array", items: { type: "string" } },
      confidence: { type: "string" },
    },
    required: ["opportunityId"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "brief_create requires confirm:true." };
    }
    const id = rid("brf");
    await db.insert(atelierBriefs).values({
      id,
      orgId: ctx.persona.orgId,
      opportunityId: String(input.opportunityId),
      openQuestions: Array.isArray(input.openQuestions) ? (input.openQuestions as string[]) : [],
      confidence: input.confidence ? String(input.confidence) : null,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "brief", id, "create", input);
    return { ok: true, data: { id, kind: "brief", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 10. agent_design
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.agent_design_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "agent",
  toolName: "agent_design_create",
  description: "Register a new agent design draft on an engagement.",
  slashAliases: { en: ["/agent-design-add"] },
  representativePrompts: { en: ["Draft a new agent design for eng_alpha."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      engagementId: { type: "string", minLength: 4 },
      processStepId: { type: "string" },
      design: { type: "object", additionalProperties: true },
    },
    required: ["engagementId"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "agent_design_create requires confirm:true." };
    }
    const id = rid("agd");
    await db.insert(atelierAgentDesigns).values({
      id,
      orgId: ctx.persona.orgId,
      engagementId: String(input.engagementId),
      processStepId: input.processStepId ? String(input.processStepId) : null,
      design: (input.design ?? {}) as Record<string, unknown>,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "agent_design", id, "create", input);
    return { ok: true, data: { id, kind: "agent_design", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 11. renewal (lightweight create — heavier watchdog flow elsewhere)
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.renewal_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "cash",
  toolName: "renewal_create",
  description: "Open a renewal record on an account / engagement.",
  slashAliases: { en: ["/renewal-open"] },
  representativePrompts: { en: ["Open a renewal for acct_xyz, due Q3."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      accountId: { type: "string", minLength: 3 },
      engagementId: { type: "string" },
      contractId: { type: "string" },
      renewalDueAt: { type: "string" },
      currentArrUsd: { type: "number" },
      proposedArrUsd: { type: "number" },
      riskTier: { type: "string", enum: ["green", "amber", "red"] },
      rationaleText: { type: "string" },
    },
    required: ["accountId"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "renewal_create requires confirm:true." };
    }
    const id = rid("rnw");
    const cur = input.currentArrUsd !== undefined ? Number(input.currentArrUsd) : 0;
    const proposed = input.proposedArrUsd !== undefined ? Number(input.proposedArrUsd) : cur;
    await db.insert(atelierRenewal).values({
      id,
      orgId: ctx.persona.orgId,
      accountId: String(input.accountId),
      engagementId: input.engagementId ? String(input.engagementId) : null,
      contractId: input.contractId ? String(input.contractId) : null,
      renewalDueAt: input.renewalDueAt ? String(input.renewalDueAt) : null,
      currentArrUsd: cur,
      proposedArrUsd: proposed,
      nrrDeltaPct: computeNrrDeltaPct(cur, proposed),
      riskTier: input.riskTier ? String(input.riskTier) : "green",
      rationaleText: input.rationaleText ? String(input.rationaleText) : null,
      status: "open",
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "renewal", id, "create", input);
    void mirrorEntityEmbedding(ctx.persona.orgId, "renewal", id, `renewal ${input.accountId}`);
    return { ok: true, data: { id, kind: "renewal", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// 12-17. Typed update wrappers — Task #411 reviewer fix.
// Required so the propose_write dispatcher can route `update` verbs to
// real UPDATE statements rather than re-running `*_create` (which would
// duplicate rows). Each wrapper applies an id-scoped partial patch and
// emits one audit row.
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.invoice_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "invoice_update",
  description: "Update a draft invoice header (status, notes, due date).",
  slashAliases: { en: ["/invoice-update"] },
  representativePrompts: { en: ["Mark invoice inv_xyz as sent."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      status: { type: "string" },
      notes: { type: "string" },
      dueDate: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "invoice_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierInvoice.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.notes !== undefined) patch.notes = String(input.notes);
    if (input.dueDate !== undefined) patch.dueDate = String(input.dueDate);
    await db.update(atelierInvoice).set(patch)
      .where(and(eq(atelierInvoice.id, id), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "invoice", id, "update", input);
    return { ok: true, data: { id, kind: "invoice", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.renewal_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "cash",
  toolName: "renewal_update",
  description: "Update an open renewal (status, risk tier, ARR estimate, rationale).",
  slashAliases: { en: ["/renewal-update"] },
  representativePrompts: { en: ["Move renewal rnw_xyz to amber risk."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      status: { type: "string" },
      riskTier: { type: "string", enum: ["green", "amber", "red"] },
      proposedArrUsd: { type: "number" },
      rationaleText: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "renewal_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierRenewal.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.riskTier !== undefined) patch.riskTier = String(input.riskTier) as typeof patch.riskTier;
    if (input.rationaleText !== undefined) patch.rationaleText = String(input.rationaleText);
    if (input.proposedArrUsd !== undefined) {
      const proposed = Number(input.proposedArrUsd);
      patch.proposedArrUsd = proposed;
      // Recompute NRR delta against the persisted current ARR baseline so
      // the figure stays canonical regardless of edit surface.
      const [existing] = await db
        .select({ currentArrUsd: atelierRenewal.currentArrUsd })
        .from(atelierRenewal)
        .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, ctx.persona.orgId), isNull(atelierRenewal.deletedAt)));
      if (existing) patch.nrrDeltaPct = computeNrrDeltaPct(existing.currentArrUsd, proposed);
    }
    await db.update(atelierRenewal).set(patch)
      .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, ctx.persona.orgId), isNull(atelierRenewal.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "renewal", id, "update", input);
    return { ok: true, data: { id, kind: "renewal", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.change_order_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "change_order",
  toolName: "change_order_update",
  description: "Update a draft change order (status, summary, rationale, value delta).",
  slashAliases: { en: ["/co-update"] },
  representativePrompts: { en: ["Mark CO co_xyz as posted."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      status: { type: "string" },
      summary: { type: "string" },
      rationaleText: { type: "string" },
      valueDeltaUsd: { type: "number" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "change_order_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierChangeOrder.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status);
    if (input.summary !== undefined) patch.summary = String(input.summary);
    if (input.rationaleText !== undefined) patch.rationaleText = String(input.rationaleText);
    if (input.valueDeltaUsd !== undefined) patch.valueDeltaUsd = Number(input.valueDeltaUsd);
    await db.update(atelierChangeOrder).set(patch)
      .where(and(eq(atelierChangeOrder.id, id), eq(atelierChangeOrder.orgId, ctx.persona.orgId), isNull(atelierChangeOrder.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "change_order", id, "update", input);
    return { ok: true, data: { id, kind: "change_order", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.win_theme_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "win_loss",
  toolName: "win_theme_update",
  description: "Update a win theme's positioning line, status, or description.",
  slashAliases: { en: ["/win-theme-update"] },
  representativePrompts: { en: ["Retire win theme wt_xyz."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      status: { type: "string" },
      description: { type: "string" },
      positioningLine: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "win_theme_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierWinThemes.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.description !== undefined) patch.description = String(input.description);
    if (input.positioningLine !== undefined) patch.positioningLine = String(input.positioningLine);
    await db.update(atelierWinThemes).set(patch)
      .where(and(eq(atelierWinThemes.id, id), eq(atelierWinThemes.orgId, ctx.persona.orgId), isNull(atelierWinThemes.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "win_theme", id, "update", input);
    return { ok: true, data: { id, kind: "win_theme", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.brief_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "brief_update",
  description: "Update an executive brief draft (status, open questions, confidence).",
  slashAliases: { en: ["/brief-update"] },
  representativePrompts: { en: ["Mark brief brf_xyz as ready."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      status: { type: "string" },
      confidence: { type: "string" },
      openQuestions: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "brief_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierBriefs.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.confidence !== undefined) patch.confidence = String(input.confidence);
    if (Array.isArray(input.openQuestions)) patch.openQuestions = input.openQuestions as string[];
    await db.update(atelierBriefs).set(patch)
      .where(and(eq(atelierBriefs.id, id), eq(atelierBriefs.orgId, ctx.persona.orgId), isNull(atelierBriefs.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "brief", id, "update", input);
    return { ok: true, data: { id, kind: "brief", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.agent_design_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "agent",
  toolName: "agent_design_update",
  description: "Update an agent design draft (status, design payload, process step).",
  slashAliases: { en: ["/agent-design-update"] },
  representativePrompts: { en: ["Promote agent design agd_xyz to active."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      status: { type: "string" },
      processStepId: { type: "string" },
      design: { type: "object", additionalProperties: true },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "agent_design_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierAgentDesigns.$inferInsert> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = String(input.status) as typeof patch.status;
    if (input.processStepId !== undefined) patch.processStepId = String(input.processStepId);
    if (input.design !== undefined) patch.design = input.design as Record<string, unknown>;
    await db.update(atelierAgentDesigns).set(patch)
      .where(and(eq(atelierAgentDesigns.id, id), eq(atelierAgentDesigns.orgId, ctx.persona.orgId), isNull(atelierAgentDesigns.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "agent_design", id, "update", input);
    return { ok: true, data: { id, kind: "agent_design", navigateTo: null } };
  },
});

// ---------------------------------------------------------------------
// Round-7 — minimal wrappers to close dispatcher coverage gaps for
// the most common (kind, verb) combos still missing from chat-write.
// Each one mirrors the invoice_update pattern: confirm-gated, audited,
// patches a small whitelist of editable columns. Heavier lifecycle
// transitions still live in their dedicated specialists (e.g.
// pipeline_update_stage, deliverable_send_to_client) — these wrappers
// cover only field edits chat users routinely request.
// ---------------------------------------------------------------------

defineCapability({
  id: "coverage.account_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_update",
  description: "Update lightweight fields on an account (name/status/notes). Stage transitions live elsewhere.",
  slashAliases: { en: ["/account-update"] },
  representativePrompts: { en: ["Mark Acme as dormant."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      name: { type: "string" },
      status: { type: "string", enum: ["active", "dormant", "archived"] },
      notes: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "account_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierAccounts.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = String(input.name);
    if (input.status !== undefined) patch.status = String(input.status);
    if (input.notes !== undefined) patch.notes = String(input.notes);
    await db.update(atelierAccounts).set(patch)
      .where(and(eq(atelierAccounts.id, id), eq(atelierAccounts.orgId, ctx.persona.orgId), isNull(atelierAccounts.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "account", id, "update", input);
    return { ok: true, data: { id, kind: "account", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.contact_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_create",
  description: "Create a contact under an account.",
  slashAliases: { en: ["/contact-add"] },
  representativePrompts: { en: ["Add Jane Doe as VP of Engineering at Acme."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      accountId: { type: "string", minLength: 4 },
      fullName: { type: "string", minLength: 2 },
      title: { type: "string" },
      seniority: { type: "string", enum: ["c_suite", "vp", "director", "manager", "ic"] },
      email: { type: "string" },
      phone: { type: "string" },
      linkedinUrl: { type: "string" },
      buyerPersona: { type: "string" },
      influenceScore: { type: "number", minimum: 1, maximum: 5 },
      disposition: { type: "string", enum: ["champion", "supporter", "neutral", "skeptic", "blocker", "unknown"] },
      notes: { type: "string" },
    },
    required: ["accountId", "fullName"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "contact_create requires confirm:true." };
    }
    const id = rid("ct");
    await db.insert(atelierContacts).values({
      id,
      orgId: ctx.persona.orgId,
      accountId: String(input.accountId),
      fullName: String(input.fullName),
      title: input.title ? String(input.title) : null,
      seniority: input.seniority ? String(input.seniority) : null,
      email: input.email ? String(input.email) : null,
      phone: input.phone ? String(input.phone) : null,
      linkedinUrl: input.linkedinUrl ? String(input.linkedinUrl) : null,
      buyerPersona: input.buyerPersona ? String(input.buyerPersona) : null,
      influenceScore: input.influenceScore !== undefined ? Number(input.influenceScore) : 3,
      disposition: input.disposition ? String(input.disposition) : "unknown",
      notes: input.notes ? String(input.notes) : null,
      confidence: "verified",
      contactOwnerId: ctx.persona.id,
      createdByUserId: ctx.persona.id,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "contact", id, "create", input);
    try { await mirrorEntityEmbedding(ctx.persona.orgId, "contact", id, String(input.fullName)); } catch {}
    return { ok: true, data: { id, kind: "contact", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.contact_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_update",
  description: "Update a contact's profile fields (name, title, seniority, email, phone, LinkedIn, buyer persona, influence, disposition, notes).",
  slashAliases: { en: ["/contact-update"] },
  representativePrompts: { en: ["Update Jane Doe's title to SVP and bump her influence to 5."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      fullName: { type: "string", minLength: 2 },
      title: { type: "string" },
      seniority: { type: "string", enum: ["c_suite", "vp", "director", "manager", "ic"] },
      email: { type: "string" },
      phone: { type: "string" },
      linkedinUrl: { type: "string" },
      buyerPersona: { type: "string" },
      influenceScore: { type: "number", minimum: 1, maximum: 5 },
      disposition: { type: "string", enum: ["champion", "supporter", "neutral", "skeptic", "blocker", "unknown"] },
      notes: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "contact_update requires confirm:true." };
    }
    const id = String(input.id);
    const [existing] = await db
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, ctx.persona.orgId), isNull(atelierContacts.deletedAt)));
    if (!existing) {
      return { ok: false, errorCode: "not_found", errorMessage: `contact ${id} not found` };
    }
    // Task #555 — account-visibility guard. Mirrors the REST PATCH route's
    // canSeeAccount check so a restricted persona cannot edit a contact on
    // an account outside their engagement/account scope via chat.
    if (!(await personaCanSeeAccount(ctx.persona, existing.accountId))) {
      return { ok: false, errorCode: "forbidden", errorMessage: `not authorized to edit contact ${id}` };
    }
    const patch: Partial<typeof atelierContacts.$inferInsert> = { updatedAt: new Date() };
    if (input.fullName !== undefined) patch.fullName = String(input.fullName);
    if (input.title !== undefined) patch.title = input.title ? String(input.title) : null;
    if (input.seniority !== undefined) patch.seniority = input.seniority ? String(input.seniority) : null;
    if (input.email !== undefined) patch.email = input.email ? String(input.email) : null;
    if (input.phone !== undefined) patch.phone = input.phone ? String(input.phone) : null;
    if (input.linkedinUrl !== undefined) patch.linkedinUrl = input.linkedinUrl ? String(input.linkedinUrl) : null;
    if (input.buyerPersona !== undefined) patch.buyerPersona = input.buyerPersona ? String(input.buyerPersona) : null;
    if (input.influenceScore !== undefined) patch.influenceScore = Number(input.influenceScore);
    if (input.disposition !== undefined) patch.disposition = String(input.disposition);
    if (input.notes !== undefined) patch.notes = input.notes ? String(input.notes) : null;
    await db
      .update(atelierContacts)
      .set(patch)
      .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, ctx.persona.orgId), isNull(atelierContacts.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "contact", id, "update", input);
    return { ok: true, data: { id, kind: "contact", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.contact_delete",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_delete",
  description: "Remove (soft-delete) a contact from an account.",
  slashAliases: { en: ["/contact-remove", "/contact-delete"] },
  representativePrompts: { en: ["Remove Jane Doe from the Acme account."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: true,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "contact_delete requires confirm:true." };
    }
    const id = String(input.id);
    const [existing] = await db
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, ctx.persona.orgId), isNull(atelierContacts.deletedAt)));
    if (!existing) {
      return { ok: false, errorCode: "not_found", errorMessage: `contact ${id} not found` };
    }
    // Task #555 — account-visibility guard. Mirrors the REST DELETE route's
    // canSeeAccount check so a restricted persona cannot remove a contact on
    // an account outside their engagement/account scope via chat.
    if (!(await personaCanSeeAccount(ctx.persona, existing.accountId))) {
      return { ok: false, errorCode: "forbidden", errorMessage: `not authorized to remove contact ${id}` };
    }
    await db
      .update(atelierContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, ctx.persona.orgId)));
    await audit(ctx.persona.orgId, ctx.persona.id, "contact", id, "delete", { id });
    return { ok: true, data: { id, kind: "contact", navigateTo: null } };
  },
});

// Task #567 — relationship edge create/delete via chat. Mirrors the REST
// /accounts/:id/contact-relationships routes (same canSeeAccount guard,
// reporting-cycle guard, and audit trail).
defineCapability({
  id: "coverage.contact_relationship_create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_relationship_create",
  description:
    "Create a relationship edge between two contacts on the same account (reports_to, partners_with, or blocks).",
  slashAliases: { en: ["/relationship-add", "/org-link"] },
  representativePrompts: { en: ["Make Jane report to the CIO on the Acme org chart."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      fromContactId: { type: "string", minLength: 4 },
      toContactId: { type: "string", minLength: 4 },
      type: { type: "string", enum: ["reports_to", "partners_with", "blocks"] },
      notes: { type: "string" },
    },
    required: ["fromContactId", "toContactId", "type"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "contact_relationship_create requires confirm:true." };
    }
    const fromContactId = String(input.fromContactId);
    const toContactId = String(input.toContactId);
    const type = String(input.type);
    if (fromContactId === toContactId) {
      return { ok: false, errorCode: "invalid", errorMessage: "a contact cannot relate to itself" };
    }
    const endpoints = await db
      .select()
      .from(atelierContacts)
      .where(
        and(
          eq(atelierContacts.orgId, ctx.persona.orgId),
          inArray(atelierContacts.id, [fromContactId, toContactId]),
          isNull(atelierContacts.deletedAt),
        ),
      );
    if (endpoints.length !== 2) {
      return { ok: false, errorCode: "not_found", errorMessage: "both contacts must exist on the account" };
    }
    const accountId = endpoints[0].accountId;
    if (endpoints[0].accountId !== endpoints[1].accountId) {
      return { ok: false, errorCode: "invalid", errorMessage: "contacts must belong to the same account" };
    }
    if (!(await personaCanSeeAccount(ctx.persona, accountId))) {
      return { ok: false, errorCode: "forbidden", errorMessage: `not authorized to edit account ${accountId}` };
    }
    // Reporting-cycle guard for reports_to edges.
    if (type === "reports_to") {
      const edges = await db
        .select()
        .from(atelierContactRelationships)
        .where(
          and(
            eq(atelierContactRelationships.accountId, accountId),
            eq(atelierContactRelationships.type, "reports_to"),
            isNull(atelierContactRelationships.deletedAt),
          ),
        );
      // A contact may have multiple live reports_to edges, so traverse EVERY
      // reachable manager from toContact — not just the first edge found.
      const managersOf = new Map<string, string[]>();
      for (const e of edges) {
        const list = managersOf.get(e.fromContactId);
        if (list) list.push(e.toContactId);
        else managersOf.set(e.fromContactId, [e.toContactId]);
      }
      const seen = new Set<string>();
      const stack: string[] = [toContactId];
      while (stack.length) {
        const cursor = stack.pop()!;
        if (cursor === fromContactId) {
          return { ok: false, errorCode: "invalid", errorMessage: "that link would create a reporting cycle" };
        }
        if (seen.has(cursor)) continue;
        seen.add(cursor);
        const next = managersOf.get(cursor);
        if (next) stack.push(...next);
      }
    }
    // Dedupe identical live edge.
    const [existing] = await db
      .select()
      .from(atelierContactRelationships)
      .where(
        and(
          eq(atelierContactRelationships.accountId, accountId),
          eq(atelierContactRelationships.fromContactId, fromContactId),
          eq(atelierContactRelationships.toContactId, toContactId),
          eq(atelierContactRelationships.type, type),
          isNull(atelierContactRelationships.deletedAt),
        ),
      );
    if (existing) {
      return { ok: true, data: { id: existing.id, kind: "contact_relationship", navigateTo: null } };
    }
    const id = rid("rel");
    await db.insert(atelierContactRelationships).values({
      id,
      orgId: ctx.persona.orgId,
      accountId,
      fromContactId,
      toContactId,
      type,
      notes: input.notes ? String(input.notes) : null,
    });
    await audit(ctx.persona.orgId, ctx.persona.id, "contact", id, "relationship.create", { fromContactId, toContactId, type });
    return { ok: true, data: { id, kind: "contact_relationship", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.contact_relationship_delete",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_relationship_delete",
  description: "Remove (soft-delete) a relationship edge between two contacts.",
  slashAliases: { en: ["/relationship-remove", "/org-unlink"] },
  representativePrompts: { en: ["Remove the reporting line between Jane and the CIO."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: true,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "contact_relationship_delete requires confirm:true." };
    }
    const id = String(input.id);
    const [rel] = await db
      .select()
      .from(atelierContactRelationships)
      .where(
        and(
          eq(atelierContactRelationships.id, id),
          eq(atelierContactRelationships.orgId, ctx.persona.orgId),
          isNull(atelierContactRelationships.deletedAt),
        ),
      );
    if (!rel) {
      return { ok: false, errorCode: "not_found", errorMessage: `relationship ${id} not found` };
    }
    if (!(await personaCanSeeAccount(ctx.persona, rel.accountId))) {
      return { ok: false, errorCode: "forbidden", errorMessage: `not authorized to edit account ${rel.accountId}` };
    }
    await db
      .update(atelierContactRelationships)
      .set({ deletedAt: new Date() })
      .where(eq(atelierContactRelationships.id, id));
    await audit(ctx.persona.orgId, ctx.persona.id, "contact", id, "relationship.delete", { id });
    return { ok: true, data: { id, kind: "contact_relationship", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.opportunity_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "pipeline",
  toolName: "opportunity_update",
  description: "Update opportunity light fields (name/dealSize/probability). Sales-stage transitions still go through pipeline_update_stage.",
  slashAliases: { en: ["/opp-update"] },
  representativePrompts: { en: ["Bump the Acme deal to $250k."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      name: { type: "string" },
      dealSizeHypothesis: { type: "number" },
      probabilityPct: { type: "number" },
      buyerPersona: { type: "string" },
      offeringAnchor: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "opportunity_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierOpportunities.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = String(input.name);
    // Task #651 — validate numeric fields rather than persisting garbage.
    if (input.dealSizeHypothesis !== undefined) {
      const deal = Number(input.dealSizeHypothesis);
      if (!Number.isFinite(deal) || deal < 0) {
        return { ok: false, errorCode: "invalid", errorMessage: "dealSize must be a number ≥ 0." };
      }
      patch.dealSizeHypothesis = Math.round(deal);
    }
    if (input.probabilityPct !== undefined) {
      const prob = Number(input.probabilityPct);
      if (!Number.isFinite(prob) || prob < 0 || prob > 100) {
        return { ok: false, errorCode: "invalid", errorMessage: "probability must be between 0 and 100." };
      }
      patch.probabilityPct = Math.round(prob);
    }
    if (input.buyerPersona !== undefined) patch.buyerPersona = String(input.buyerPersona);
    if (input.offeringAnchor !== undefined) patch.offeringAnchor = String(input.offeringAnchor);
    await db.update(atelierOpportunities).set(patch)
      .where(and(eq(atelierOpportunities.id, id), eq(atelierOpportunities.orgId, ctx.persona.orgId), isNull(atelierOpportunities.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "opportunity", id, "update", input);
    return { ok: true, data: { id, kind: "opportunity", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.deliverable_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "deliverable_update",
  description: "Update deliverable light fields (name/status/dueDate). Send-to-client transitions go through deliverable_send_to_client.",
  slashAliases: { en: ["/deliverable-update"] },
  representativePrompts: { en: ["Push the Acme readout due date to Friday."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      name: { type: "string" },
      status: { type: "string" },
      dueDate: { type: "string", description: "YYYY-MM-DD" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "deliverable_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierDeliverables.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = String(input.name);
    if (input.status !== undefined) patch.status = String(input.status);
    if (input.dueDate !== undefined) patch.dueDate = String(input.dueDate);
    await db.update(atelierDeliverables).set(patch)
      .where(and(eq(atelierDeliverables.id, id), eq(atelierDeliverables.orgId, ctx.persona.orgId), isNull(atelierDeliverables.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "deliverable", id, "update", input);
    return { ok: true, data: { id, kind: "deliverable", navigateTo: null } };
  },
});

defineCapability({
  id: "coverage.expense_update",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "finance",
  toolName: "expense_update",
  description: "Update lightweight fields on an expense (merchant/description/category/amount). Submit/approve transitions stay in their workflows.",
  slashAliases: { en: ["/expense-update"] },
  representativePrompts: { en: ["Recategorize the Riyadh dinner as client_meals."] },
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_INPUT_PROPS,
      id: { type: "string", minLength: 4 },
      merchant: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      amount: { type: "number" },
      clientBillable: { type: "boolean" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  irreversible: false,
  surfaceOn: ["global"],
  source: "cli-only",
  async run(input, ctx) {
    if (input.confirm !== true) {
      return { ok: false, errorCode: "needs_confirm", errorMessage: "expense_update requires confirm:true." };
    }
    const id = String(input.id);
    const patch: Partial<typeof atelierExpenses.$inferInsert> = { updatedAt: new Date() };
    if (input.merchant !== undefined) patch.merchant = String(input.merchant);
    if (input.description !== undefined) patch.description = String(input.description);
    if (input.category !== undefined) patch.category = String(input.category);
    if (input.amount !== undefined) patch.amount = Number(input.amount);
    if (input.clientBillable !== undefined) patch.clientBillable = Boolean(input.clientBillable);
    await db.update(atelierExpenses).set(patch)
      .where(and(eq(atelierExpenses.id, id), eq(atelierExpenses.orgId, ctx.persona.orgId), isNull(atelierExpenses.deletedAt)));
    await audit(ctx.persona.orgId, ctx.persona.id, "expense", id, "update", input);
    return { ok: true, data: { id, kind: "expense", navigateTo: null } };
  },
});
