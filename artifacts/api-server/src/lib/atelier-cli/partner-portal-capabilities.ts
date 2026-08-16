/**
 * Task #873 — Alliance-partner portal chat capabilities.
 *
 * The ONLY chat surface an `alliance_partner` login ever sees (the
 * catalog gate in `capabilitiesForPersona` returns exactly the
 * partnerportal.* slice for that role, and every internal role is
 * denied here via `requiredRoles`). Each run() re-checks the role and
 * resolves visibility through the SAME grant helpers the
 * /partner-portal REST routes use — grant revocation or firm archive
 * drops chat visibility in the same query.
 *
 * No RAG: attachment/document retrieval is never surfaced to this role
 * (and `attachment.search_documents` carries its own role deny as
 * defence-in-depth).
 */

import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierPartnerFirms,
  atelierPartnerContractShares,
  atelierContractRecords,
  atelierPartnerFirmInvoices,
  atelierPartnerSharedDocuments,
  atelierPartnerNotifications,
} from "@workspace/db";
import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import {
  grantedOpportunitiesForPartner,
  grantedEngScopeForFirm,
  partnerOppWire,
  partnerEngagementWire,
  redactedAccountOverview,
  resolveAlliancePartnerFirm,
  submitPartnerChangeRequest,
  PARTNER_CHANGE_FIELDS,
} from "../../routes/atelier/partnerPortalRoutes.js";
import type { ToolContext, ToolResult } from "./index.js";

function deny(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

async function partnerScope(ctx: ToolContext): Promise<
  | { ok: true; scope: NonNullable<Awaited<ReturnType<typeof grantedOpportunitiesForPartner>>> }
  | { ok: false; result: ToolResult }
> {
  if (ctx.persona.role !== "alliance_partner") {
    return { ok: false, result: deny("This assistant surface is only available to alliance-partner logins.") };
  }
  const [me] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ctx.persona.id), isNull(atelierUsers.deletedAt)));
  if (!me) return { ok: false, result: deny("No active persona.") };
  const scope = await grantedOpportunitiesForPartner(me);
  if (!scope) {
    return {
      ok: false,
      result: deny("Your firm's portal access is not available right now. Please contact your Cognirise counterpart."),
    };
  }
  return { ok: true, scope };
}

/**
 * Task #1175 — resolve the caller's own live firm the SAME way the
 * /partner-portal REST routes do (role re-check + resolveAlliancePartnerFirm).
 * Firm archive or a missing link drops chat visibility identically.
 */
async function firmScope(ctx: ToolContext): Promise<
  | { ok: true; me: typeof atelierUsers.$inferSelect; firm: typeof atelierPartnerFirms.$inferSelect }
  | { ok: false; result: ToolResult }
> {
  if (ctx.persona.role !== "alliance_partner") {
    return { ok: false, result: deny("This assistant surface is only available to alliance-partner logins.") };
  }
  const [me] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ctx.persona.id), isNull(atelierUsers.deletedAt)));
  if (!me) return { ok: false, result: deny("No active persona.") };
  const firm = await resolveAlliancePartnerFirm(me);
  if (!firm) {
    return {
      ok: false,
      result: deny("Your firm's portal access is not available right now. Please contact your Cognirise counterpart."),
    };
  }
  return { ok: true, me, firm };
}

defineCapability({
  id: "partnerportal.opportunities",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "partner_portal_opportunities",
  slashAliases: { en: ["/my-opportunities"] },
  description:
    "List the opportunities assigned to the caller's partner firm (alliance-partner portal). Returns name, stage, next milestone and expected close per opportunity.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my assigned opportunities", "Which deals are we working on together?"],
  },
  async run(_input, ctx) {
    const s = await partnerScope(ctx);
    if (!s.ok) return s.result;
    const items = s.scope.opps.map(partnerOppWire);
    return {
      ok: true,
      data: {
        firm: s.scope.firm.name,
        count: items.length,
        items: items.map((o) => ({
          id: o.id,
          name: o.name,
          stage: o.salesStage,
          nextMilestone: o.nextMilestone,
          closeDate: o.closeDate,
          href: `/partner/opportunities/${o.id}`,
        })),
      },
    };
  },
});

defineCapability({
  id: "partnerportal.opportunity_detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "partner_portal_opportunity_detail",
  slashAliases: { en: ["/opportunity-status"] },
  description:
    "Detail for ONE opportunity assigned to the caller's partner firm: stage, sub-status, next milestone, expected close. Accepts the opportunity name or id.",
  requiredRoles: ["alliance_partner"],
  inputSchema: {
    type: "object",
    properties: {
      opportunity: {
        type: "string",
        description: "Opportunity name (or id) as shown in the partner portal.",
      },
    },
    required: ["opportunity"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["What's the status of the Falcon deal?"] },
  async run(input, ctx) {
    const s = await partnerScope(ctx);
    if (!s.ok) return s.result;
    const q = String(input.opportunity ?? "").trim().toLowerCase();
    if (!q) return { ok: false, errorCode: "not_found", errorMessage: "Which opportunity?" };
    const matches = s.scope.opps.filter(
      (o) => o.id === input.opportunity || o.name.toLowerCase().includes(q),
    );
    if (matches.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "No assigned opportunity matches that name.",
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        disambiguation: {
          kind: "opportunity",
          options: matches.slice(0, 5).map((o) => ({ id: o.id, label: o.name })),
        },
      };
    }
    const o = partnerOppWire(matches[0]!);
    return {
      ok: true,
      data: { ...o, href: `/partner/opportunities/${o.id}` },
    };
  },
});

defineCapability({
  id: "partnerportal.account_overview",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "partner_portal_account_overview",
  slashAliases: { en: ["/client-overview"] },
  description:
    "Redacted overview of the client account behind ONE assigned opportunity: name, sector, country, city, size. No contacts, financials or strategy are ever included.",
  requiredRoles: ["alliance_partner"],
  inputSchema: {
    type: "object",
    properties: {
      opportunity: {
        type: "string",
        description: "The assigned opportunity name (or id) whose account to summarise.",
      },
    },
    required: ["opportunity"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["Tell me about the client on the Falcon deal"] },
  async run(input, ctx) {
    const s = await partnerScope(ctx);
    if (!s.ok) return s.result;
    const q = String(input.opportunity ?? "").trim().toLowerCase();
    const matches = s.scope.opps.filter(
      (o) => o.id === input.opportunity || o.name.toLowerCase().includes(q),
    );
    if (matches.length !== 1) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          matches.length === 0
            ? "No assigned opportunity matches that name."
            : "Multiple assigned opportunities match — use the exact name.",
      };
    }
    const [account] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, matches[0]!.accountId),
          eq(atelierAccounts.orgId, ctx.persona.orgId),
        ),
      );
    if (!account) {
      return { ok: false, errorCode: "not_found", errorMessage: "Account not found." };
    }
    return { ok: true, data: redactedAccountOverview(account) };
  },
});

// =====================================================================
// Task #1175 — additional partner-portal READ tools. Every run()
// re-checks the role and resolves the firm through the SAME helpers the
// REST routes use, so grant revocation / firm archive drops chat
// visibility in the same query. METADATA ONLY — never document content.
// =====================================================================

function maskIbanChat(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const v = iban.replace(/\s+/g, "");
  if (v.length <= 4) return "\u2022\u2022\u2022\u2022";
  return `\u2022\u2022\u2022\u2022${v.slice(-4)}`;
}

defineCapability({
  id: "partnerportal.contracts",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "partner_portal_contracts",
  slashAliases: { en: ["/my-contracts"] },
  description:
    "List the contracts shared with the caller's partner firm: title, type, status, effective and expiry dates, and whether renewal is approaching. Metadata only — never document content.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["Show the contracts shared with us", "Which of our contracts expire soon?"] },
  async run(_input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const shares = await db
      .select()
      .from(atelierPartnerContractShares)
      .where(
        and(
          eq(atelierPartnerContractShares.orgId, s.me.orgId),
          eq(atelierPartnerContractShares.partnerFirmId, s.firm.id),
          isNull(atelierPartnerContractShares.revokedAt),
        ),
      )
      .orderBy(desc(atelierPartnerContractShares.createdAt));
    const contractIds = [...new Set(shares.map((sh) => sh.contractId))];
    const records = contractIds.length
      ? await db
          .select()
          .from(atelierContractRecords)
          .where(
            and(
              eq(atelierContractRecords.orgId, s.me.orgId),
              inArray(atelierContractRecords.id, contractIds),
            ),
          )
      : [];
    const recById = new Map(records.map((r) => [r.id, r]));
    const now = Date.now();
    const items = shares.flatMap((sh) => {
      const r = recById.get(sh.contractId);
      if (!r) return [];
      const expiry = r.expiryDate ? r.expiryDate.getTime() : null;
      const renewalDue = expiry != null && expiry - now <= 60 * 86400_000 && expiry >= now;
      return [
        {
          title: r.title,
          type: r.contractType,
          status: r.status,
          effectiveDate: r.effectiveDate ? r.effectiveDate.toISOString().slice(0, 10) : null,
          expiryDate: r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : null,
          renewalDue,
          sharedAt: sh.createdAt.toISOString(),
        },
      ];
    });
    return { ok: true, data: { firm: s.firm.name, count: items.length, items } };
  },
});

defineCapability({
  id: "partnerportal.invoices",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "report",
  toolName: "partner_portal_invoices",
  slashAliases: { en: ["/my-invoices"] },
  description:
    "List the caller partner firm's submitted invoices and their payment status: reference, amount, currency, status, invoice date, submitted and paid dates.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["What's the status of our invoices?", "Have we been paid yet?"] },
  async run(_input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const rows = await db
      .select()
      .from(atelierPartnerFirmInvoices)
      .where(
        and(
          eq(atelierPartnerFirmInvoices.orgId, s.me.orgId),
          eq(atelierPartnerFirmInvoices.partnerFirmId, s.firm.id),
          eq(atelierPartnerFirmInvoices.source, "partner_submitted"),
          isNull(atelierPartnerFirmInvoices.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerFirmInvoices.createdAt));
    const items = rows.map((r) => ({
      reference: r.reference,
      amount: r.costAmount,
      currency: r.costCurrency,
      status: r.status,
      invoiceDate: r.invoiceDate,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    }));
    return { ok: true, data: { firm: s.firm.name, count: items.length, items } };
  },
});

defineCapability({
  id: "partnerportal.documents",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "partner_portal_documents",
  slashAliases: { en: ["/my-documents"] },
  description:
    "List document METADATA shared with the caller's partner firm (title, file name, shared date, note) plus the firm's own uploads with their review status. Never returns document content or bytes.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["What documents have been shared with us?", "List our uploaded documents"] },
  async run(_input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const rows = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.orgId, s.me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, s.firm.id),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerSharedDocuments.createdAt));
    const shared = rows
      .filter((r) => r.direction === "shared" && r.revokedAt == null)
      .map((r) => ({
        title: r.title,
        fileName: r.fileName,
        sharedAt: r.createdAt.toISOString(),
        note: r.note ?? null,
      }));
    const uploads = rows
      .filter((r) => r.direction === "partner_upload")
      .map((r) => ({
        title: r.title,
        fileName: r.fileName,
        uploadedAt: r.createdAt.toISOString(),
        reviewStatus: r.status,
      }));
    return {
      ok: true,
      data: { firm: s.firm.name, shared, uploads },
    };
  },
});

defineCapability({
  id: "partnerportal.delivery",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "partner_portal_delivery",
  slashAliases: { en: ["/my-delivery"] },
  description:
    "List the delivery engagements granted to the caller's partner firm: name, phase, health, and dates. Only granted engagements are ever returned.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["Which engagements are we delivering on?", "Show our delivery work"] },
  async run(_input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const scope = await grantedEngScopeForFirm(s.me.orgId, s.firm);
    const items = scope.engs
      .map((e) => partnerEngagementWire(e, scope.sharedAtByEngId.get(e.id) ?? null))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: { firm: s.firm.name, count: items.length, items } };
  },
});

defineCapability({
  id: "partnerportal.notifications",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "admin",
  toolName: "partner_portal_notifications",
  slashAliases: { en: ["/my-notifications"] },
  description:
    "List the caller's recent partner-portal notifications: title, body, read status and time.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["Any new notifications?", "What have I missed?"] },
  async run(_input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const rows = await db
      .select()
      .from(atelierPartnerNotifications)
      .where(
        and(
          eq(atelierPartnerNotifications.orgId, s.me.orgId),
          eq(atelierPartnerNotifications.partnerFirmId, s.firm.id),
          isNull(atelierPartnerNotifications.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerNotifications.createdAt))
      .limit(20);
    const items = rows.map((n) => ({
      title: n.title,
      body: n.body ?? null,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }));
    return {
      ok: true,
      data: {
        count: items.length,
        unreadCount: items.filter((i) => !i.readAt).length,
        items,
      },
    };
  },
});

defineCapability({
  id: "partnerportal.firm_profile",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "partner_portal_firm_profile",
  slashAliases: { en: ["/my-firm"] },
  description:
    "Show the caller firm's company profile as Cognirise holds it: legal details, capability summary and a masked bank summary. Never returns the raw IBAN.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["What does Cognirise have on file for my firm?", "Show my company profile"] },
  async run(_input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const firm = s.firm;
    return {
      ok: true,
      data: {
        name: firm.name,
        legalName: firm.legalName ?? null,
        registrationNumber: firm.registrationNumber ?? null,
        taxId: firm.taxId ?? null,
        registeredAddress: firm.registeredAddress ?? null,
        speciality: firm.speciality ?? null,
        country: firm.country ?? null,
        capabilities: Object.keys(firm.capabilities ?? {}),
        capabilitySummary: firm.capabilityProfile?.summary ?? null,
        bank: {
          bankName: firm.bankName ?? null,
          ibanMasked: maskIbanChat(firm.bankIban),
          currency: firm.bankCurrency ?? null,
          onFile: Boolean(firm.bankIban),
        },
        href: "/partner/company",
      },
    };
  },
});

// =====================================================================
// Task #1175 — the ONE partner-portal WRITE tool. Two-phase confirm;
// commit shares the SINGLE change-request write path with the REST route
// (submitPartnerChangeRequest). Same allowlist + bank refusal.
// =====================================================================

const CHANGE_FIELD_LABELS: Record<string, string> = {
  legalName: "legal name",
  registrationNumber: "registration number",
  taxId: "tax ID",
  registeredAddress: "registered address",
  capabilityProfile: "capability summary",
  capabilities: "capabilities",
  speciality: "speciality",
  country: "country",
};

defineCapability({
  id: "partnerportal.request_change",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "firm_profile",
  toolName: "partner_portal_request_change",
  slashAliases: { en: ["/request-change"] },
  description:
    "Request a change to your firm's own company profile (legal name, registration number, tax ID, registered address, capability summary, capabilities, speciality or country). The request is reviewed by Cognirise before anything is applied. Bank details cannot be changed here.",
  requiredRoles: ["alliance_partner"],
  inputSchema: {
    type: "object",
    properties: {
      field: {
        type: "string",
        enum: [
          "legalName",
          "registrationNumber",
          "taxId",
          "registeredAddress",
          "capabilityProfile",
          "capabilities",
          "speciality",
          "country",
        ],
        description: "The profile field to change.",
      },
      newValue: {
        description:
          "The requested new value. A string for most fields; a list of short labels for `capabilities`.",
      },
      reason: { type: "string", description: "Optional rationale for the change." },
      confirm: { type: "boolean" },
    },
    required: ["field", "newValue"],
    additionalProperties: false,
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Update our registered address", "Change our firm's legal name"],
  },
  async run(input, ctx) {
    const s = await firmScope(ctx);
    if (!s.ok) return s.result;
    const field = typeof input.field === "string" ? input.field.trim() : "";
    // Partner-safe refusal for bank + out-of-scope fields (before any effect).
    const BANK = new Set(["bankName", "iban", "bankIban", "swift", "bankSwift", "currency", "bankCurrency"]);
    if (BANK.has(field)) {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage:
          "Bank details can't be changed here. Use the secure bank-change request in the Billing tab so Finance can verify and approve them.",
      };
    }
    if (!PARTNER_CHANGE_FIELDS.has(field)) {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage:
          "I can only request changes to your firm's legal name, registration number, tax ID, registered address, capability summary, capabilities, speciality or country. For contacts, use the contact suggestions form.",
      };
    }
    const label = CHANGE_FIELD_LABELS[field] ?? field;
    const reason =
      typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) || null : null;
    const toDisplay = Array.isArray(input.newValue)
      ? (input.newValue as unknown[]).filter((v) => typeof v === "string").join(", ")
      : typeof input.newValue === "string"
        ? input.newValue.trim()
        : String(input.newValue ?? "");
    const fromDisplay =
      field === "capabilities"
        ? Object.keys(s.firm.capabilities ?? {}).join(", ") || "(none)"
        : field === "capabilityProfile"
          ? s.firm.capabilityProfile?.summary ?? "(none)"
          : ((s.firm[field as keyof typeof s.firm] as string | null) ?? "(none)");

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { field, from: fromDisplay, to: toDisplay } },
        confirmation: {
          summary: `Request a change to your firm's ${label} from "${fromDisplay}" to "${toDisplay}"? Cognirise will review it before it's applied.`,
          diff: {
            update: {
              table: "atelier_partner_firms",
              values: { field, to: toDisplay },
            },
          },
          pending: {
            tool: "partner_portal_request_change",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    const outcome = await submitPartnerChangeRequest({
      orgId: s.me.orgId,
      firmId: s.firm.id,
      field,
      toValueRaw: input.newValue,
      rationale: reason,
      submittedByUserId: s.me.id,
      submittedByName: s.me.name,
    });
    if (!outcome.ok) {
      return { ok: false, errorCode: "invalid_input", errorMessage: outcome.message };
    }
    return {
      ok: true,
      data: {
        id: outcome.proposalId,
        field,
        label: `Change request: ${label}`,
        status: "pending",
        note: "Your request has been submitted for Cognirise review.",
        navigateTo: { path: "/partner/company", when: "on_commit" as const },
      },
    };
  },
});
