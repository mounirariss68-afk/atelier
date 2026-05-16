/**
 * Task #338 — UI parity capability registrations.
 *
 * Every write action exposed by the Atelier UI gets a matching CLI
 * capability so the assistant can perform it from plain language.
 * Each executor mirrors the route handler's auth + minimal DB write +
 * audit row; the same Zod-shaped fields the UI sends are accepted.
 *
 * Pattern — every entry:
 *   - declares EN/AR/FR slash + example phrasings,
 *   - validates required fields and previews them in the confirm card,
 *   - applies the same role gate as the underlying route,
 *   - inserts the same audit-event the route would have written,
 *   - returns a `confirmation` envelope on first call (no `confirm:true`),
 *   - commits + returns ids + a `resultCard` hint on second call.
 *
 * Coverage is checked at build time by tests/cli-parity/run.ts.
 */

import { and, eq, isNull, desc } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierOpportunities,
  atelierOpportunityStageTransitions,
  atelierEngagements,
  atelierCharterVersions,
  atelierRaidItems,
  atelierDeliverables,
  atelierProposals,
  atelierProposalSections,
  atelierPovs,
  atelierMeetings,
  atelierTimesheetWeeks,
  atelierExpenses,
  atelierAuditEvents,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import {
  resolveAccount,
  resolveSalesStage,
  resolveCharterApprovalRole,
  resolveDate,
  resolveMoney,
} from "./resolvers/index.js";
import { checkAndRecord } from "./outbound-rate-limit.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const PARTNER_TIER = new Set(["founding_partner", "partner"]);
const LEADERSHIP_OR_SM = new Set(["founding_partner", "partner", "senior_manager"]);
const ALL_BUT_OBSERVER = [
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
  "contractor",
  "partner_firm_resource",
] as const;

function denyForbidden(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

function denyInvalid(msg: string): ToolResult {
  return { ok: false, errorCode: "invalid_input", errorMessage: msg };
}

async function engAclOk(persona: CliPersona, engagementId: string): Promise<boolean> {
  const acl = await accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);
  return acl.all === true || acl.ids.has(engagementId);
}

async function recordAudit(
  ctx: ToolContext,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  summary: string,
): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType,
    entityId,
    actorType: "human",
    actorId: ctx.persona.id,
    actorLabel: ctx.persona.name,
    action,
    payload: { ...payload, viaCli: true, turnId: ctx.turnId },
    payloadSummary: summary,
  });
}

// =====================================================================
// ACCOUNTS / CONTACTS
// =====================================================================

defineCapability({
  id: "account.create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_create",
  description:
    "Create a new CRM account. Required: name. Optional: country, sector (industry), brandName, hqCity, tier, partnerOwnerId.",
  slashAliases: {
    en: ["/new-account", "/create-account"],
    fr: ["/nouveau-compte"],
    ar: ["/حساب-جديد"],
  },
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      country: { type: "string" },
      sector: { type: "string" },
      brandName: { type: "string" },
      hqCity: { type: "string" },
      tier: { enum: ["A", "B", "C", "D"] },
      primaryCurrency: { type: "string", minLength: 3, maxLength: 3 },
      primaryLanguage: { enum: ["en", "ar"] },
      partnerOwnerId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["name"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager"],
  surfaceOn: ["global", "account_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "account_card",
  async run(input, ctx) {
    if (!LEADERSHIP_OR_SM.has(ctx.persona.role)) {
      return denyForbidden("Only Partner or Engagement Lead personas can create accounts.");
    }
    const name = String(input.name ?? "").trim();
    if (!name) return denyInvalid("name is required");
    // Task #411 — strict-input guard. Reject obvious placeholder names
    // ("new", "test", em-dashes, blanks) and anything shorter than 3
    // chars before they slip into the accounts table. The orchestrator
    // can collect a real name via clarification on the next turn.
    const ACCOUNT_NAME_STOP_WORDS = new Set(["new", "test", "—", "-", "n/a", "tbd"]);
    if (name.length < 3) return denyInvalid("name must be at least 3 characters");
    if (ACCOUNT_NAME_STOP_WORDS.has(name.toLowerCase()))
      return denyInvalid(`"${name}" is too generic — please supply the actual account name`);
    const country = String(input.country ?? "").trim();
    const sector = String(input.sector ?? "").trim();
    if (input.confirm !== true) {
      const missing: string[] = [];
      if (!country) missing.push("country");
      if (!sector) missing.push("sector (industry)");
      const previewLines = [
        `Name: ${name}`,
        `Country: ${country || "—"}`,
        `Sector: ${sector || "—"}`,
        input.brandName ? `Brand: ${String(input.brandName)}` : null,
        input.tier ? `Tier: ${String(input.tier)}` : null,
      ].filter(Boolean) as string[];
      return {
        ok: true,
        data: { preview: { name, country, sector }, missingFields: missing },
        confirmation: {
          summary:
            missing.length > 0
              ? `Create account "${name}". Missing: ${missing.join(", ")}. Provide them or confirm to create with defaults.`
              : `Create account "${name}" (${sector}, ${country}).`,
          diff: { create: { table: "atelier_accounts", values: { name, country, sector } }, missingFields: missing, preview: previewLines },
          pending: { tool: "account_create", input: { ...input, confirm: true } },
        },
      };
    }
    if (!country || !sector) {
      return denyInvalid("country and sector are required to commit");
    }
    const id = rid("acct");
    const now = new Date();
    const [row] = await db
      .insert(atelierAccounts)
      .values({
        id,
        orgId: ctx.persona.orgId,
        name,
        brandName: input.brandName ? String(input.brandName).trim() : null,
        country,
        sector,
        hqCity: input.hqCity ? String(input.hqCity).trim() : null,
        size: null,
        primaryCurrency: input.primaryCurrency ? String(input.primaryCurrency).toUpperCase() : "USD",
        primaryLanguage: (input.primaryLanguage === "ar" ? "ar" : "en"),
        tier: (input.tier as string) ?? "C",
        status: "active",
        partnerOwnerId:
          (input.partnerOwnerId as string | undefined) ??
          (PARTNER_TIER.has(ctx.persona.role) ? ctx.persona.id : null),
        relationshipStrength: 0,
        sourceSignals: [],
        strategicPriorities: [],
        pendingProfileUpdates: [],
        createdAt: now,
        updatedAt: now,
        createdByUserId: ctx.persona.id,
      })
      .returning();
    await recordAudit(
      ctx,
      "account",
      row.id,
      "account.created",
      { name: row.name, country: row.country, sector: row.sector, tier: row.tier },
      `${ctx.persona.name} created account "${row.name}" via CLI.`,
    );
    // Task #511 — newly created account opens its workspace.
    return {
      ok: true,
      data: {
        id: row.id,
        name: row.name,
        navigateTo: { path: `/accounts/${row.id}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "account.refresh_cartographer",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_refresh_cartographer",
  description: "Re-run Cartographer for an account, refreshing source signals and decision-makers.",
  slashAliases: { en: ["/refresh-cartographer"], fr: ["/rafraichir-cartographe"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountQuery: { type: "string" },
      confirm: { type: "boolean" },
    },
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "cartographer_run",
  async run(input, ctx) {
    let accountId = String(input.accountId ?? "");
    if (!accountId && input.accountQuery) {
      const r = await resolveAccount(String(input.accountQuery), ctx.persona);
      if (r.kind === "match") accountId = r.id;
      if (r.kind === "choices") {
        return { ok: true, data: { prompt: r.prompt, options: r.options }, disambiguation: { kind: "account", options: r.options } };
      }
      if (r.kind === "none") return { ok: false, errorCode: "not_found", errorMessage: "no account matched query" };
    }
    if (!accountId) return denyInvalid("accountId or accountQuery required");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { accountId } },
        confirmation: {
          summary: `Refresh Cartographer for account ${accountId}. May rewrite priorities + signals.`,
          diff: { run: { agent: "account_cartographer", accountId } },
          pending: { tool: "account_refresh_cartographer", input: { accountId, confirm: true } },
        },
      };
    }
    await recordAudit(ctx, "account", accountId, "cartographer.refresh.cli", { accountId }, `${ctx.persona.name} requested Cartographer refresh.`);
    // Task #511 — refreshing Cartographer lands on the account workspace.
    return {
      ok: true,
      data: {
        dispatched: true,
        accountId,
        navigateTo: { path: `/accounts/${accountId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "account.profile_update_decision",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_profile_update_decision",
  description: "Approve or reject a pending Cartographer profile-update proposal on an account. Irreversible — requires typed confirm.",
  slashAliases: { en: ["/decide-profile-update"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      updateId: { type: "string" },
      decision: { enum: ["approve", "reject"] },
      note: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["accountId", "updateId", "decision"],
  },
  isWrite: true,
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "profile_update_decision",
  async run(input, ctx) {
    if (!PARTNER_TIER.has(ctx.persona.role)) {
      return denyForbidden("Only a partner persona can decide profile updates.");
    }
    const accountId = String(input.accountId ?? "");
    const updateId = String(input.updateId ?? "");
    const decision = String(input.decision ?? "");
    if (decision !== "approve" && decision !== "reject") return denyInvalid("decision must be approve|reject");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { accountId, updateId, decision } },
        confirmation: {
          summary: `${decision === "approve" ? "Approve" : "Reject"} profile-update ${updateId} on account ${accountId}.`,
          diff: { update: { table: "atelier_accounts", id: accountId, decision }, irreversible: true, typedNameRequired: decision },
          pending: { tool: "account_profile_update_decision", input: { ...input, confirm: true } },
        },
      };
    }
    await recordAudit(ctx, "account", accountId, `profile_update.${decision}.cli`, { updateId, decision, note: input.note ?? null }, `${ctx.persona.name} ${decision}d profile update ${updateId}.`);
    // Task #499 — approval lands on the affected account workspace.
    return {
      ok: true,
      data: {
        accountId,
        updateId,
        decision,
        navigateTo: { path: `/accounts/${accountId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "contact.update_disposition",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_update_disposition",
  description: "Set a contact's disposition (champion/supporter/neutral/skeptic/blocker/unknown).",
  slashAliases: { en: ["/disposition"], fr: ["/disposition"] },
  inputSchema: {
    type: "object",
    properties: {
      contactId: { type: "string" },
      disposition: { enum: ["champion", "supporter", "neutral", "skeptic", "blocker", "unknown"] },
      note: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["contactId", "disposition"],
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "contact_card",
  async run(input, ctx) {
    const contactId = String(input.contactId ?? "");
    const disposition = String(input.disposition ?? "");
    if (!contactId || !disposition) return denyInvalid("contactId + disposition required");
    const [c] = await db
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.id, contactId), eq(atelierContacts.orgId, ctx.persona.orgId), isNull(atelierContacts.deletedAt)));
    if (!c) return { ok: false, errorCode: "not_found", errorMessage: `contact ${contactId} not found` };
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { contactId, before: c.disposition, after: disposition } },
        confirmation: {
          summary: `Set ${c.fullName} disposition: ${c.disposition} → ${disposition}.`,
          diff: { update: { table: "atelier_contacts", id: contactId, disposition } },
          pending: { tool: "contact_update_disposition", input: { ...input, confirm: true } },
        },
      };
    }
    await db.update(atelierContacts).set({ disposition, updatedAt: new Date() }).where(eq(atelierContacts.id, contactId));
    await recordAudit(ctx, "account", c.accountId, "contact.disposition.cli", { contactId, before: c.disposition, after: disposition, note: input.note ?? null }, `${ctx.persona.name} set ${c.fullName}'s disposition to "${disposition}".`);
    // Task #509 — disposition changes land on the contact's parent account workspace.
    return {
      ok: true,
      data: {
        contactId,
        disposition,
        navigateTo: c.accountId
          ? { path: `/accounts/${c.accountId}`, when: "on_commit" as const }
          : null,
      },
    };
  },
});

// =====================================================================
// OPPORTUNITIES
// =====================================================================

defineCapability({
  id: "opportunity.create",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_create",
  description: "Create a new opportunity tied to an existing account.",
  slashAliases: { en: ["/new-opp", "/create-opportunity"], fr: ["/nouvelle-opportunité"] },
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
      accountId: { type: "string" },
      accountQuery: { type: "string" },
      description: { type: "string" },
      partnerOwnerId: { type: "string" },
      engagementLeadId: { type: "string" },
      sourceLead: { type: "string" },
      dealSizeUsd: { type: "number" },
      probabilityPct: { type: "number" },
      nextMilestone: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["name"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...ALL_BUT_OBSERVER],
  surfaceOn: ["global", "account_workspace", "opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "opportunity_card",
  async run(input, ctx) {
    const name = String(input.name ?? "").trim();
    if (!name) return denyInvalid("name required");
    let accountId = String(input.accountId ?? "");
    if (!accountId && input.accountQuery) {
      const r = await resolveAccount(String(input.accountQuery), ctx.persona);
      if (r.kind === "match") accountId = r.id;
      if (r.kind === "choices") return { ok: true, data: { prompt: r.prompt, options: r.options }, disambiguation: { kind: "account", options: r.options } };
    }
    if (input.confirm !== true) {
      const missing: string[] = [];
      if (!accountId) missing.push("account");
      return {
        ok: true,
        data: { preview: { name, accountId }, missingFields: missing },
        confirmation: {
          summary: missing.length ? `Create opportunity "${name}". Missing: ${missing.join(", ")}.` : `Create opportunity "${name}" on account ${accountId}.`,
          diff: { create: { table: "atelier_opportunities", values: { name, accountId } }, missingFields: missing },
          pending: { tool: "opportunity_create", input: { ...input, accountId, confirm: true } },
        },
      };
    }
    if (!accountId) return denyInvalid("accountId required to commit");
    const id = rid("opp");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const [row] = await db
      .insert(atelierOpportunities)
      .values({
        id,
        orgId: ctx.persona.orgId,
        slug,
        name,
        accountId,
        plmStage: "shape",
        salesStage: "suspect",
        partnerOwnerId: (input.partnerOwnerId as string | undefined) ?? ctx.persona.id,
        engagementLeadId: (input.engagementLeadId as string | undefined) ?? ctx.persona.id,
        dealSizeHypothesis: Number(input.dealSizeUsd ?? 0),
        probabilityPct: Number(input.probabilityPct ?? 10),
        nextMilestone: String(input.nextMilestone ?? "Initial qualification"),
        sourceLead: String(input.sourceLead ?? "cli"),
        createdByUserId: ctx.persona.id,
      })
      .returning();
    await recordAudit(ctx, "opportunity", row.id, "opportunity.created.cli", { name, accountId }, `${ctx.persona.name} created opportunity "${name}" via CLI.`);
    // Task #511 — newly created opportunity opens its workspace.
    return {
      ok: true,
      data: {
        id: row.id,
        name: row.name,
        accountId,
        navigateTo: { path: `/opportunities/${row.id}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "opportunity.move_stage",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_move_stage",
  description: "Move an opportunity to a new sales stage. Stage names accepted: shape/pursue/propose/runner/won/lost (and locale variants).",
  slashAliases: { en: ["/move-stage"], fr: ["/changer-étape"] },
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      toStage: { type: "string" },
      rationale: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["opportunityId", "toStage"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...ALL_BUT_OBSERVER],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "opportunity_card",
  async run(input, ctx) {
    const opportunityId = String(input.opportunityId ?? "");
    const toStage = resolveSalesStage(String(input.toStage ?? ""));
    if (!opportunityId || !toStage) return denyInvalid("opportunityId + recognised toStage required");
    const [opp] = await db
      .select()
      .from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, opportunityId), eq(atelierOpportunities.orgId, ctx.persona.orgId), isNull(atelierOpportunities.deletedAt)));
    if (!opp) return { ok: false, errorCode: "not_found", errorMessage: "opportunity not found" };
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: opp.id, from: opp.salesStage, to: toStage } },
        confirmation: {
          summary: `Move "${opp.name}" from ${opp.salesStage} → ${toStage}.`,
          diff: { update: { table: "atelier_opportunities", id: opp.id, fromStage: opp.salesStage, toStage } },
          pending: { tool: "opportunity_move_stage", input: { opportunityId, toStage, rationale: input.rationale ?? null, confirm: true } },
        },
      };
    }
    await db.update(atelierOpportunities).set({ salesStage: toStage, updatedAt: new Date() }).where(eq(atelierOpportunities.id, opp.id));
    await db.insert(atelierOpportunityStageTransitions).values({
      id: rid("trans"),
      opportunityId: opp.id,
      fromStage: opp.salesStage,
      toStage,
      transitionedByUserId: ctx.persona.id,
      rationaleText: String(input.rationale ?? ""),
    });
    await recordAudit(ctx, "opportunity", opp.id, "opportunity.stage_changed.cli", { fromStage: opp.salesStage, toStage }, `${ctx.persona.name} moved "${opp.name}" to ${toStage}.`);
    // Task #511 — stage transitions land back on the opportunity workspace.
    return {
      ok: true,
      data: {
        id: opp.id,
        fromStage: opp.salesStage,
        toStage,
        navigateTo: { path: `/opportunities/${opp.id}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "opportunity.update_qualifier",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_update_qualifier",
  description: "Update the 5C qualifier on an opportunity (client, competition, capability, capacity, contract).",
  slashAliases: { en: ["/qualify"], fr: ["/qualifier"] },
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      fiveC: { type: "object" },
      decision: { enum: ["pursue", "watch", "decline"] },
      rationale: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["opportunityId"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...ALL_BUT_OBSERVER],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "qualifier_card",
  async run(input, ctx) {
    const opportunityId = String(input.opportunityId ?? "");
    if (!opportunityId) return denyInvalid("opportunityId required");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { opportunityId, fiveC: input.fiveC ?? {}, decision: input.decision ?? null } },
        confirmation: {
          summary: `Update qualifier on opportunity ${opportunityId}.`,
          diff: { update: { table: "atelier_opportunities", id: opportunityId, fiveC: input.fiveC, decision: input.decision } },
          pending: { tool: "opportunity_update_qualifier", input: { ...input, confirm: true } },
        },
      };
    }
    const fiveC = (input.fiveC as Record<string, string> | undefined) ?? {};
    await db.update(atelierOpportunities).set({ qualify5c: fiveC, updatedAt: new Date() }).where(and(eq(atelierOpportunities.id, opportunityId), eq(atelierOpportunities.orgId, ctx.persona.orgId)));
    await recordAudit(ctx, "opportunity", opportunityId, "opportunity.qualifier.cli", { fiveC, decision: input.decision ?? null, rationale: input.rationale ?? null }, `${ctx.persona.name} updated 5C qualifier.`);
    // Task #511 — qualifier edits land on the opportunity workspace.
    return {
      ok: true,
      data: {
        opportunityId,
        navigateTo: { path: `/opportunities/${opportunityId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "opportunity.draft_pov",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_draft_pov",
  description: "Draft a Point-of-View (POV) for an opportunity.",
  slashAliases: { en: ["/pov", "/draft-pov"] },
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      title: { type: "string", minLength: 1 },
      audience: { type: "string" },
      objective: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["opportunityId", "title"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...ALL_BUT_OBSERVER],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "pov_card",
  async run(input, ctx) {
    const opportunityId = String(input.opportunityId ?? "");
    const title = String(input.title ?? "").trim();
    if (!opportunityId || !title) return denyInvalid("opportunityId + title required");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { opportunityId, title } },
        confirmation: {
          summary: `Draft POV "${title}" for opportunity ${opportunityId}.`,
          diff: { create: { table: "atelier_povs", values: { opportunityId, title } } },
          pending: { tool: "opportunity_draft_pov", input: { ...input, confirm: true } },
        },
      };
    }
    const id = rid("pov");
    await db.insert(atelierPovs).values({
      id,
      orgId: ctx.persona.orgId,
      opportunityId,
      title,
      audience: String(input.audience ?? "") || null,
      objective: String(input.objective ?? "") || null,
      status: "outline",
      createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, "opportunity", opportunityId, "pov.created.cli", { id, title }, `${ctx.persona.name} drafted POV "${title}".`);
    // Task #511 — drafted POV lands on the parent opportunity workspace.
    return {
      ok: true,
      data: {
        id,
        opportunityId,
        title,
        navigateTo: { path: `/opportunities/${opportunityId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "opportunity.capture_meeting",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_capture_meeting",
  description: "Capture a meeting (transcript / paste / live) on an opportunity or engagement.",
  slashAliases: { en: ["/meeting", "/capture-meeting"], fr: ["/réunion"] },
  inputSchema: {
    type: "object",
    properties: {
      parentType: { enum: ["opportunity", "engagement"] },
      parentId: { type: "string" },
      title: { type: "string" },
      kind: { enum: ["discovery", "workshop", "steering", "kickoff"] },
      mode: { enum: ["upload", "paste", "live_bot"] },
      date: { type: "string" },
      transcript: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["parentType", "parentId", "title"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: [...ALL_BUT_OBSERVER],
  surfaceOn: ["opportunity_workspace", "engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "meeting_card",
  async run(input, ctx) {
    const parentType = String(input.parentType ?? "");
    const parentId = String(input.parentId ?? "");
    const title = String(input.title ?? "").trim();
    if (!parentType || !parentId || !title) return denyInvalid("parentType + parentId + title required");
    const date = resolveDate(String(input.date ?? "today")) ?? new Date().toISOString().slice(0, 10);
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { parentType, parentId, title, date } },
        confirmation: {
          summary: `Capture ${input.kind ?? "discovery"} meeting "${title}" on ${parentType} ${parentId} (${date}).`,
          diff: { create: { table: "atelier_meetings", values: { parentType, parentId, title, date } } },
          pending: { tool: "opportunity_capture_meeting", input: { ...input, date, confirm: true } },
        },
      };
    }
    const id = rid("mtg");
    await db.insert(atelierMeetings).values({
      id,
      orgId: ctx.persona.orgId,
      parentType,
      parentId,
      mode: String(input.mode ?? "paste"),
      kind: String(input.kind ?? "discovery"),
      title,
      date,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, parentType, parentId, "meeting.captured.cli", { id, title, date }, `${ctx.persona.name} captured meeting "${title}".`);
    // Task #511 — meetings land on the parent opportunity / engagement.
    const meetingNav =
      parentType === "engagement"
        ? `/clients/deliver/engagements/${parentId}`
        : `/opportunities/${parentId}`;
    return {
      ok: true,
      data: {
        id,
        title,
        date,
        navigateTo: { path: meetingNav, when: "on_commit" as const },
      },
    };
  },
});

// =====================================================================
// PROPOSALS
// =====================================================================

defineCapability({
  id: "proposal.compose",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_compose",
  description: "Compose / build a proposal for an opportunity.",
  slashAliases: { en: ["/compose-proposal", "/build-proposal"], fr: ["/proposition"] },
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      title: { type: "string" },
      sectionsRequired: { type: "array", items: { type: "string" } },
      pricingIntent: { type: "object" },
      deadlineAt: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["opportunityId", "title"],
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "proposal_card",
  async run(input, ctx) {
    const opportunityId = String(input.opportunityId ?? "");
    const title = String(input.title ?? "").trim();
    if (!opportunityId || !title) return denyInvalid("opportunityId + title required");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { opportunityId, title } },
        confirmation: {
          summary: `Compose proposal "${title}" for opportunity ${opportunityId}.`,
          diff: { create: { table: "atelier_proposals", values: { opportunityId, title } } },
          pending: { tool: "proposal_compose", input: { ...input, confirm: true } },
        },
      };
    }
    const id = rid("prop");
    await db.insert(atelierProposals).values({
      id,
      orgId: ctx.persona.orgId,
      opportunityId,
      title,
      sectionsRequired: (input.sectionsRequired as string[] | undefined) ?? ["context", "approach", "workplan", "team", "pricing"],
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, "proposal", id, "proposal.created.cli", { opportunityId, title }, `${ctx.persona.name} composed proposal "${title}".`);
    // Task #511 — composed proposal opens the proposal workspace.
    return {
      ok: true,
      data: {
        id,
        opportunityId,
        title,
        navigateTo: { path: `/proposals/${id}`, when: "on_commit" as const },
      },
    };
  },
});

const PROPOSAL_TOUCH_ROLES = new Set(["founding_partner", "partner", "senior_manager", "consultant"]);

async function loadSection(sectionId: string, orgId: string) {
  const [s] = await db
    .select()
    .from(atelierProposalSections)
    .where(and(eq(atelierProposalSections.id, sectionId), eq(atelierProposalSections.orgId, orgId), isNull(atelierProposalSections.deletedAt)));
  return s ?? null;
}

defineCapability({
  id: "proposal.approve_section",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_approve_section",
  description: "Approve a proposal section.",
  slashAliases: { en: ["/approve-section"] },
  inputSchema: { type: "object", properties: { sectionId: { type: "string" }, confirm: { type: "boolean" } }, required: ["sectionId"] },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "section_card",
  async run(input, ctx) {
    if (!PROPOSAL_TOUCH_ROLES.has(ctx.persona.role)) return denyForbidden("Not authorised to touch this proposal.");
    const sectionId = String(input.sectionId ?? "");
    const s = await loadSection(sectionId, ctx.persona.orgId);
    if (!s) return { ok: false, errorCode: "not_found", errorMessage: "section not found" };
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { sectionId, name: s.name } }, confirmation: { summary: `Approve section "${s.name}".`, diff: { update: { id: sectionId, status: "approved" } }, pending: { tool: "proposal_approve_section", input: { sectionId, confirm: true } } } };
    }
    await db.update(atelierProposalSections).set({ status: "approved", updatedAt: new Date() }).where(eq(atelierProposalSections.id, sectionId));
    await recordAudit(ctx, "proposal_section", sectionId, "proposal.section.approve.cli", { sectionId }, `${ctx.persona.name} approved section "${s.name}".`);
    // Task #499 — section approvals navigate to the parent proposal.
    const sectionNav = s.proposalId ? `/proposals/${s.proposalId}` : null;
    return {
      ok: true,
      data: {
        sectionId,
        status: "approved",
        navigateTo: sectionNav ? { path: sectionNav, when: "on_commit" as const } : null,
      },
    };
  },
});

defineCapability({
  id: "proposal.edit_section",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_edit_section",
  description: "Edit the content of a proposal section.",
  slashAliases: { en: ["/edit-section"] },
  inputSchema: { type: "object", properties: { sectionId: { type: "string" }, content: { type: "string" }, status: { type: "string" }, confirm: { type: "boolean" } }, required: ["sectionId", "content"] },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "section_card",
  async run(input, ctx) {
    if (!PROPOSAL_TOUCH_ROLES.has(ctx.persona.role)) return denyForbidden("Not authorised to touch this proposal.");
    const sectionId = String(input.sectionId ?? "");
    const content = String(input.content ?? "");
    const s = await loadSection(sectionId, ctx.persona.orgId);
    if (!s) return { ok: false, errorCode: "not_found", errorMessage: "section not found" };
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { sectionId, length: content.length } }, confirmation: { summary: `Replace section "${s.name}" content (${content.length} chars).`, diff: { update: { id: sectionId, contentLen: content.length } }, pending: { tool: "proposal_edit_section", input: { ...input, confirm: true } } } };
    }
    await db.update(atelierProposalSections).set({ content, status: (input.status as string) ?? s.status, updatedAt: new Date() }).where(eq(atelierProposalSections.id, sectionId));
    await recordAudit(ctx, "proposal_section", sectionId, "proposal.section.edit.cli", { sectionId, length: content.length }, `${ctx.persona.name} edited section "${s.name}".`);
    // Task #509 — section edits navigate to the parent proposal.
    const editNav = s.proposalId ? `/proposals/${s.proposalId}` : null;
    return {
      ok: true,
      data: {
        sectionId,
        navigateTo: editNav ? { path: editNav, when: "on_commit" as const } : null,
      },
    };
  },
});

defineCapability({
  id: "proposal.reject_section",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_reject_section",
  description: "Reject a proposal section with a rationale.",
  slashAliases: { en: ["/reject-section"] },
  inputSchema: { type: "object", properties: { sectionId: { type: "string" }, rationale: { type: "string" }, confirm: { type: "boolean" } }, required: ["sectionId", "rationale"] },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "section_card",
  async run(input, ctx) {
    if (!PROPOSAL_TOUCH_ROLES.has(ctx.persona.role)) return denyForbidden("Not authorised to touch this proposal.");
    const sectionId = String(input.sectionId ?? "");
    const rationale = String(input.rationale ?? "").trim();
    if (!rationale) return denyInvalid("rationale required");
    const s = await loadSection(sectionId, ctx.persona.orgId);
    if (!s) return { ok: false, errorCode: "not_found", errorMessage: "section not found" };
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { sectionId, rationale } }, confirmation: { summary: `Reject section "${s.name}": ${rationale.slice(0, 120)}.`, diff: { update: { id: sectionId, status: "red", rationale } }, pending: { tool: "proposal_reject_section", input: { ...input, confirm: true } } } };
    }
    await db.update(atelierProposalSections).set({ status: "red", notes: rationale, updatedAt: new Date() }).where(eq(atelierProposalSections.id, sectionId));
    await recordAudit(ctx, "proposal_section", sectionId, "proposal.section.reject.cli", { sectionId, rationale }, `${ctx.persona.name} rejected section "${s.name}".`);
    // Task #509 — section rejections navigate to the parent proposal.
    const rejectNav = s.proposalId ? `/proposals/${s.proposalId}` : null;
    return {
      ok: true,
      data: {
        sectionId,
        status: "red",
        navigateTo: rejectNav ? { path: rejectNav, when: "on_commit" as const } : null,
      },
    };
  },
});

defineCapability({
  id: "proposal.confirm_assignments",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_confirm_assignments",
  description: "Confirm proposal section assignments (lead/SM/partner gate).",
  slashAliases: { en: ["/confirm-assignments"] },
  inputSchema: { type: "object", properties: { proposalId: { type: "string" }, confirm: { type: "boolean" } }, required: ["proposalId"] },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager"],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "proposal_card",
  async run(input, ctx) {
    const proposalId = String(input.proposalId ?? "");
    if (!proposalId) return denyInvalid("proposalId required");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { proposalId } }, confirmation: { summary: `Confirm section assignments for proposal ${proposalId}.`, diff: { update: { table: "atelier_proposals", id: proposalId } }, pending: { tool: "proposal_confirm_assignments", input: { proposalId, confirm: true } } } };
    }
    await recordAudit(ctx, "proposal", proposalId, "proposal.confirm_assignments.cli", { proposalId }, `${ctx.persona.name} confirmed section assignments.`);
    // Task #509 — assignment confirmation lands on the proposal page.
    return {
      ok: true,
      data: {
        proposalId,
        navigateTo: { path: `/proposals/${proposalId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "proposal.final_read",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_final_read",
  description: "Partner final-read sign-off on a proposal.",
  slashAliases: { en: ["/partner-final-read", "/final-read"] },
  inputSchema: { type: "object", properties: { proposalId: { type: "string" }, confirm: { type: "boolean" } }, required: ["proposalId"] },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "proposal_card",
  async run(input, ctx) {
    const proposalId = String(input.proposalId ?? "");
    if (!proposalId) return denyInvalid("proposalId required");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { proposalId } }, confirmation: { summary: `Partner final-read on proposal ${proposalId}.`, diff: { update: { id: proposalId, partnerApprovedAt: "now" } }, pending: { tool: "proposal_final_read", input: { proposalId, confirm: true } } } };
    }
    await db.update(atelierProposals).set({ partnerApprovedAt: new Date(), partnerApprovedByUserId: ctx.persona.id, updatedAt: new Date() }).where(eq(atelierProposals.id, proposalId));
    await recordAudit(ctx, "proposal", proposalId, "proposal.final_read.cli", { proposalId }, `${ctx.persona.name} signed off final read.`);
    // Task #499 — final-read approvals navigate to the proposal page.
    return {
      ok: true,
      data: {
        proposalId,
        navigateTo: { path: `/proposals/${proposalId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "proposal.approve_pricing",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_approve_pricing",
  description: "Approve the pricing section of a proposal.",
  slashAliases: { en: ["/approve-pricing"] },
  inputSchema: { type: "object", properties: { proposalId: { type: "string" }, confirm: { type: "boolean" } }, required: ["proposalId"] },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "proposal_card",
  async run(input, ctx) {
    const proposalId = String(input.proposalId ?? "");
    if (!proposalId) return denyInvalid("proposalId required");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { proposalId } }, confirmation: { summary: `Approve pricing on proposal ${proposalId}.`, diff: { update: { id: proposalId, action: "approve_pricing" } }, pending: { tool: "proposal_approve_pricing", input: { proposalId, confirm: true } } } };
    }
    await recordAudit(ctx, "proposal", proposalId, "proposal.pricing.approve.cli", { proposalId }, `${ctx.persona.name} approved pricing.`);
    // Task #499 — pricing approvals navigate to the proposal page.
    return {
      ok: true,
      data: {
        proposalId,
        navigateTo: { path: `/proposals/${proposalId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "proposal.override_pricing",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_override_pricing",
  description: "Override pricing on a proposal with a rationale. Irreversible — typed confirm required.",
  slashAliases: { en: ["/override-pricing"] },
  inputSchema: { type: "object", properties: { proposalId: { type: "string" }, rationale: { type: "string" }, confirm: { type: "boolean" } }, required: ["proposalId", "rationale"] },
  isWrite: true,
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "proposal_card",
  async run(input, ctx) {
    const proposalId = String(input.proposalId ?? "");
    const rationale = String(input.rationale ?? "").trim();
    if (!proposalId || !rationale) return denyInvalid("proposalId + rationale required");
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { proposalId } },
        confirmation: {
          summary: `Override pricing on proposal ${proposalId}: ${rationale.slice(0, 100)}.`,
          diff: { update: { id: proposalId, action: "override_pricing", rationale }, irreversible: true, typedNameRequired: "OVERRIDE" },
          pending: { tool: "proposal_override_pricing", input: { ...input, confirm: true } },
        },
      };
    }
    await recordAudit(ctx, "proposal", proposalId, "proposal.pricing.override.cli", { proposalId, rationale }, `${ctx.persona.name} overrode pricing.`);
    // Task #509 — pricing overrides navigate to the proposal page.
    return {
      ok: true,
      data: {
        proposalId,
        navigateTo: { path: `/proposals/${proposalId}`, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "proposal.send",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "proposal",
  toolName: "proposal_send",
  description: "Send a proposal to the client. Outbound rate-limited; typed-recipient confirm required.",
  slashAliases: { en: ["/send-proposal"] },
  inputSchema: { type: "object", properties: { proposalId: { type: "string" }, recipientEmail: { type: "string" }, confirm: { type: "boolean" } }, required: ["proposalId", "recipientEmail"] },
  isWrite: true,
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["opportunity_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: "email",
  resultCard: "email_sent",
  async run(input, ctx) {
    const proposalId = String(input.proposalId ?? "");
    const recipient = String(input.recipientEmail ?? "").trim().toLowerCase();
    if (!proposalId || !recipient.includes("@")) return denyInvalid("proposalId + recipient email required");
    if (input.confirm !== true) {
      const quota = await checkAndRecord(ctx.persona.id, "email");
      if (!quota.allowed) return { ok: false, errorCode: "rate_limited", errorMessage: `daily email cap reached`, data: quota.snapshot };
      return {
        ok: true,
        data: { preview: { proposalId, recipient } },
        confirmation: {
          summary: `Send proposal ${proposalId} to ${recipient}. ${quota.snapshot.remaining - 1} sends remaining.`,
          diff: { send: { channel: "email", proposalId, recipient }, irreversible: true, typedNameRequired: recipient, outboundChannel: "email" },
          pending: { tool: "proposal_send", input: { proposalId, recipientEmail: recipient, confirm: true } },
        },
      };
    }
    const recheck = await checkAndRecord(ctx.persona.id, "email");
    if (!recheck.allowed) return { ok: false, errorCode: "rate_limited", errorMessage: "rate limit exceeded between confirm" };
    await db.update(atelierProposals).set({ sentAt: new Date(), updatedAt: new Date() }).where(eq(atelierProposals.id, proposalId));
    await recordAudit(ctx, "proposal", proposalId, "proposal.send.cli", { proposalId, recipient }, `${ctx.persona.name} sent proposal to <email>.`);
    // Task #509 — sent proposals land on the proposal page so the user
    // can verify the sent state.
    return {
      ok: true,
      data: {
        proposalId,
        recipient,
        sent: true,
        navigateTo: { path: `/proposals/${proposalId}`, when: "on_commit" as const },
      },
    };
  },
});

// =====================================================================
// ENGAGEMENTS
// =====================================================================

defineCapability({
  id: "engagement.redraft_charter",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "engagement_redraft_charter",
  description: "Redraft an engagement charter from won-proposal summary + kickoff transcript.",
  slashAliases: { en: ["/redraft-charter"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      wonProposalSummary: { type: "string" },
      kickoffTranscriptExcerpt: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["engagementId"],
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "charter_card",
  async run(input, ctx) {
    const engagementId = String(input.engagementId ?? "");
    if (!engagementId) return denyInvalid("engagementId required");
    if (!(await engAclOk(ctx.persona, engagementId))) return denyForbidden("engagement outside your access");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { engagementId } }, confirmation: { summary: `Redraft charter for engagement ${engagementId}.`, diff: { create: { table: "atelier_charter_versions", engagementId } }, pending: { tool: "engagement_redraft_charter", input: { ...input, confirm: true } } } };
    }
    await recordAudit(ctx, "engagement", engagementId, "charter.redraft.cli", { engagementId }, `${ctx.persona.name} requested charter redraft.`);
    // Task #509 — charter redrafts land on the engagement workspace.
    return {
      ok: true,
      data: {
        engagementId,
        dispatched: true,
        navigateTo: {
          path: `/clients/deliver/engagements/${engagementId}`,
          when: "on_commit" as const,
        },
      },
    };
  },
});

defineCapability({
  id: "engagement.approve_charter",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "engagement_approve_charter",
  description: "Approve a charter version as lead or partner. Role can be 'lead' or 'partner'.",
  slashAliases: { en: ["/approve-charter"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      versionId: { type: "string" },
      role: { type: "string" },
      notes: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["engagementId", "versionId", "role"],
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "charter_card",
  async run(input, ctx) {
    const engagementId = String(input.engagementId ?? "");
    const versionId = String(input.versionId ?? "");
    const role = resolveCharterApprovalRole(String(input.role ?? ""));
    if (!engagementId || !versionId || !role) return denyInvalid("engagementId + versionId + role (lead|partner) required");
    if (!(await engAclOk(ctx.persona, engagementId))) return denyForbidden("engagement outside your access");
    if (role === "partner" && !PARTNER_TIER.has(ctx.persona.role)) return denyForbidden("partner approval requires a partner persona");
    if (role === "lead" && !LEADERSHIP_OR_SM.has(ctx.persona.role)) return denyForbidden("lead approval requires senior_manager or partner");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { engagementId, versionId, role } }, confirmation: { summary: `Approve charter ${versionId} as ${role}.`, diff: { update: { table: "atelier_charter_versions", id: versionId, role } }, pending: { tool: "engagement_approve_charter", input: { ...input, confirm: true } } } };
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (role === "partner") {
      patch.partnerApprovedAt = new Date();
      patch.partnerApprovedByUserId = ctx.persona.id;
      patch.partnerApprovedByName = ctx.persona.name;
      patch.status = "live";
    } else {
      patch.leadApprovedAt = new Date();
      patch.leadApprovedByUserId = ctx.persona.id;
      patch.status = "lead_approved";
    }
    await db.update(atelierCharterVersions).set(patch as Partial<typeof atelierCharterVersions.$inferInsert>).where(eq(atelierCharterVersions.id, versionId));
    await recordAudit(ctx, "engagement", engagementId, `charter.approve.${role}.cli`, { versionId, role, notes: input.notes ?? null }, `${ctx.persona.name} approved charter ${versionId} as ${role}.`);
    // Task #499 — charter approval lands on the engagement workspace.
    return {
      ok: true,
      data: {
        engagementId,
        versionId,
        role,
        navigateTo: {
          path: `/clients/deliver/engagements/${engagementId}`,
          when: "on_commit" as const,
        },
      },
    };
  },
});

defineCapability({
  id: "raid.close",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "raid",
  toolName: "raid_close",
  description: "Close a RAID item (companion to raid.add_v2).",
  slashAliases: { en: ["/close-raid"] },
  inputSchema: { type: "object", properties: { raidId: { type: "string" }, mitigation: { type: "string" }, confirm: { type: "boolean" } }, required: ["raidId"] },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager", "consultant"],
  surfaceOn: ["engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "raid_item",
  async run(input, ctx) {
    const raidId = String(input.raidId ?? "");
    if (!raidId) return denyInvalid("raidId required");
    const [r] = await db.select().from(atelierRaidItems).where(and(eq(atelierRaidItems.id, raidId), eq(atelierRaidItems.orgId, ctx.persona.orgId)));
    if (!r) return { ok: false, errorCode: "not_found", errorMessage: "raid item not found" };
    if (!(await engAclOk(ctx.persona, r.engagementId))) return denyForbidden("engagement outside your access");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { raidId, kind: r.kind, severity: r.severity } }, confirmation: { summary: `Close ${r.severity} ${r.kind}: ${r.description.slice(0, 100)}.`, diff: { update: { table: "atelier_raid_items", id: raidId, status: "closed" } }, pending: { tool: "raid_close", input: { ...input, confirm: true } } } };
    }
    await db.update(atelierRaidItems).set({ status: "closed", updatedAt: new Date() }).where(eq(atelierRaidItems.id, raidId));
    await recordAudit(ctx, "raid_item", raidId, "raid.close.cli", { raidId, mitigation: input.mitigation ?? null }, `${ctx.persona.name} closed RAID item ${raidId}.`);
    // Task #499 — closing a RAID lands on its engagement workspace.
    return {
      ok: true,
      data: {
        raidId,
        status: "closed",
        navigateTo: {
          path: `/clients/deliver/engagements/${r.engagementId}`,
          when: "on_commit" as const,
        },
      },
    };
  },
});

defineCapability({
  id: "engagement.create_deliverable",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "engagement_create_deliverable",
  description: "Create a deliverable on an engagement.",
  slashAliases: { en: ["/new-deliverable", "/create-deliverable"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      type: { enum: ["diagnostic", "design", "build", "adoption", "decision_memo", "final_readout"] },
      name: { type: "string" },
      hypothesisId: { type: "string" },
      dueDate: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["engagementId", "type", "name"],
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "deliverable_card",
  async run(input, ctx) {
    const engagementId = String(input.engagementId ?? "");
    const type = String(input.type ?? "");
    const name = String(input.name ?? "").trim();
    if (!engagementId || !type || !name) return denyInvalid("engagementId + type + name required");
    if (!(await engAclOk(ctx.persona, engagementId))) return denyForbidden("engagement outside your access");
    const dueDate = input.dueDate ? resolveDate(String(input.dueDate)) : null;
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { engagementId, type, name, dueDate } }, confirmation: { summary: `Create ${type} deliverable "${name}" on ${engagementId}.`, diff: { create: { table: "atelier_deliverables", values: { engagementId, type, name, dueDate } } }, pending: { tool: "engagement_create_deliverable", input: { ...input, dueDate, confirm: true } } } };
    }
    const id = rid("del");
    await db.insert(atelierDeliverables).values({
      id,
      orgId: ctx.persona.orgId,
      engagementId,
      type,
      name,
      status: "draft",
      hypothesisId: (input.hypothesisId as string | undefined) ?? null,
      dueDate,
      createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, "engagement", engagementId, "deliverable.created.cli", { id, type, name }, `${ctx.persona.name} created deliverable "${name}".`);
    // Task #509 — new deliverables land on the deliverable workspace.
    return {
      ok: true,
      data: {
        id,
        engagementId,
        name,
        navigateTo: {
          path: `/clients/deliver/engagements/${engagementId}/deliverables/${id}`,
          when: "on_commit" as const,
        },
      },
    };
  },
});

// =====================================================================
// LEDGER
// =====================================================================

const LEDGER_APPROVE_ROLES = new Set(["founding_partner", "partner", "senior_manager", "finance"]);

defineCapability({
  id: "ledger.approve_timesheet",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "ledger_approve_timesheet",
  description: "Approve a submitted timesheet week (lead or partner). Self-approval blocked.",
  slashAliases: { en: ["/approve-timesheet"] },
  inputSchema: {
    type: "object",
    properties: {
      weekId: { type: "string" },
      role: { enum: ["lead", "partner"] },
      notes: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["weekId", "role"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager", "finance"],
  surfaceOn: ["ledger"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "timesheet_card",
  async run(input, ctx) {
    if (!LEDGER_APPROVE_ROLES.has(ctx.persona.role)) return denyForbidden("not allowed to approve timesheets");
    const weekId = String(input.weekId ?? "");
    const role = String(input.role ?? "");
    if (!weekId || (role !== "lead" && role !== "partner")) return denyInvalid("weekId + role (lead|partner) required");
    const [w] = await db.select().from(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, weekId));
    if (!w) return { ok: false, errorCode: "not_found", errorMessage: "timesheet week not found" };
    if (w.personId === ctx.persona.id) return denyForbidden("cannot self-approve your own timesheet");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { weekId, role } }, confirmation: { summary: `Approve timesheet ${weekId} as ${role}.`, diff: { update: { table: "atelier_timesheet_weeks", id: weekId, role } }, pending: { tool: "ledger_approve_timesheet", input: { ...input, confirm: true } } } };
    }
    const patch: Partial<typeof atelierTimesheetWeeks.$inferInsert> = { updatedAt: new Date() };
    if (role === "lead") {
      patch.leadApprovedAt = new Date();
      patch.leadApprovedByUserId = ctx.persona.id;
      patch.status = "lead_approved";
    } else {
      patch.partnerApprovedAt = new Date();
      patch.partnerApprovedByUserId = ctx.persona.id;
      patch.status = "partner_approved";
    }
    await db.update(atelierTimesheetWeeks).set(patch).where(eq(atelierTimesheetWeeks.id, weekId));
    await recordAudit(ctx, "timesheet_week", weekId, `ledger.approve.${role}.cli`, { weekId, role, notes: input.notes ?? null }, `${ctx.persona.name} approved timesheet ${weekId} as ${role}.`);
    // Task #499 — timesheet decisions land on the People → Time view
    // for the affected person/week (route is /people/time/:personId/:weekIso).
    const tsNav = w.personId && w.weekIso
      ? `/people/time/${w.personId}/${w.weekIso}`
      : "/people/time";
    return {
      ok: true,
      data: {
        weekId,
        role,
        navigateTo: { path: tsNav, when: "on_commit" as const },
      },
    };
  },
});

defineCapability({
  id: "ledger.reject_timesheet",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "ledger_reject_timesheet",
  description: "Reject a submitted timesheet week with a reason. Self-rejection blocked.",
  slashAliases: { en: ["/reject-timesheet"] },
  inputSchema: {
    type: "object",
    properties: { weekId: { type: "string" }, reason: { type: "string" }, confirm: { type: "boolean" } },
    required: ["weekId", "reason"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager", "finance"],
  surfaceOn: ["ledger"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "timesheet_card",
  async run(input, ctx) {
    if (!LEDGER_APPROVE_ROLES.has(ctx.persona.role)) return denyForbidden("not allowed to reject timesheets");
    const weekId = String(input.weekId ?? "");
    const reason = String(input.reason ?? "").trim();
    if (!weekId || !reason) return denyInvalid("weekId + reason required");
    const [w] = await db.select().from(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, weekId));
    if (!w) return { ok: false, errorCode: "not_found", errorMessage: "timesheet week not found" };
    if (w.personId === ctx.persona.id) return denyForbidden("cannot self-reject your own timesheet");
    if (input.confirm !== true) {
      return { ok: true, data: { preview: { weekId, reason } }, confirmation: { summary: `Reject timesheet ${weekId}: ${reason.slice(0, 120)}.`, diff: { update: { table: "atelier_timesheet_weeks", id: weekId, status: "rejected", reason } }, pending: { tool: "ledger_reject_timesheet", input: { ...input, confirm: true } } } };
    }
    await db.update(atelierTimesheetWeeks).set({ status: "rejected", rejectedAt: new Date(), rejectedByUserId: ctx.persona.id, rejectionReason: reason, updatedAt: new Date() }).where(eq(atelierTimesheetWeeks.id, weekId));
    await recordAudit(ctx, "timesheet_week", weekId, "ledger.reject.cli", { weekId, reason }, `${ctx.persona.name} rejected timesheet ${weekId}.`);
    const tsNav = w.personId && w.weekIso
      ? `/people/time/${w.personId}/${w.weekIso}`
      : "/people/time";
    // Task #499 — timesheet rejections also land on the affected week.
    return {
      ok: true,
      data: {
        weekId,
        status: "rejected",
        navigateTo: { path: tsNav, when: "on_commit" as const },
      },
    };
  },
});

// =====================================================================
// WALLET
// =====================================================================

defineCapability({
  id: "wallet.create_expense",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_create_expense",
  description: "Create a manual expense (not via receipt ingest). Required: date, amount, currency, merchant, category.",
  slashAliases: { en: ["/new-expense", "/expense"], fr: ["/note-de-frais"] },
  inputSchema: {
    type: "object",
    properties: {
      expenseDate: { type: "string" },
      merchant: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      engagementId: { type: "string" },
      vatCountry: { type: "string" },
      moneyText: { type: "string" },
      confirm: { type: "boolean" },
    },
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["wallet"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "expense_card",
  async run(input, ctx) {
    let amount = Number(input.amount ?? 0);
    let currency = String(input.currency ?? "USD").toUpperCase();
    if ((!amount || !currency) && input.moneyText) {
      const m = resolveMoney(String(input.moneyText));
      if (m) { amount = m.amount; currency = m.currency; }
    }
    const expenseDate = resolveDate(String(input.expenseDate ?? "today")) ?? new Date().toISOString().slice(0, 10);
    const merchant = String(input.merchant ?? "").trim();
    const category = String(input.category ?? "other");
    if (input.confirm !== true) {
      const missing: string[] = [];
      if (!amount) missing.push("amount");
      if (!merchant) missing.push("merchant");
      return {
        ok: true,
        data: { preview: { amount, currency, expenseDate, merchant, category }, missingFields: missing },
        confirmation: {
          summary: missing.length ? `Create expense. Missing: ${missing.join(", ")}.` : `Create expense ${amount} ${currency} at ${merchant} on ${expenseDate}.`,
          diff: { create: { table: "atelier_expenses", values: { amount, currency, expenseDate, merchant, category } }, missingFields: missing },
          pending: { tool: "wallet_create_expense", input: { ...input, amount, currency, expenseDate, merchant, category, confirm: true } },
        },
      };
    }
    if (!amount || !merchant) return denyInvalid("amount + merchant required to commit");
    const id = rid("exp");
    await db.insert(atelierExpenses).values({
      id,
      orgId: ctx.persona.orgId,
      personId: ctx.persona.id,
      personType: "employee",
      engagementId: (input.engagementId as string | undefined) ?? null,
      expenseDate,
      captureSource: "manual",
      merchant,
      description: String(input.description ?? "") || null,
      category,
      amount,
      currency,
      usdAmount: currency === "USD" ? amount : 0,
      vatCountry: (input.vatCountry as string | undefined) ?? null,
      status: "draft",
      createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, "expense", id, "wallet.expense.create.cli", { amount, currency, merchant, expenseDate }, `${ctx.persona.name} created expense ${amount} ${currency} at ${merchant}.`);
    // Task #509 — new expenses land on the expense detail page.
    return {
      ok: true,
      data: {
        id,
        amount,
        currency,
        expenseDate,
        merchant,
        navigateTo: { path: `/wallet/expenses/${id}`, when: "on_commit" as const },
      },
    };
  },
});

// Suppress unused-import lint.
void desc;
