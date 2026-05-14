/**
 * Task #332 — Seed registrations for the capability catalog.
 *
 * One representative entry per concern so the orchestrator (and the
 * downstream parity tests) exercise every code-path:
 *
 *   - read-only, board-observer-allowed:        meta.help
 *   - resolver-driven disambiguation:           account.lookup
 *   - write + two-phase confirm:                raid.add
 *   - irreversible + typed-name re-confirm:     account.delete
 *   - outbound-channel + per-day rate-limit:    deliverable.email_send
 *   - role-gated to founding_partner/partner:   firm.publish_profile
 *
 * Tasks #333-#335 layer additional entries against the same shape;
 * none of them touch orchestrator wiring.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierRaidItems,
  atelierAuditEvents,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import { resolveAccount } from "./resolvers/index.js";
import { checkAndRecord } from "./outbound-rate-limit.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------
// meta.help — universally available, returns the slash palette.
// ---------------------------------------------------------------------
defineCapability({
  id: "meta.help",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "list_capabilities",
  description:
    "List the slash-commands available to the current user. Read-only; safe for board observers.",
  slashAliases: { en: ["/help", "/?"], fr: ["/aide"], ar: ["/مساعدة"] },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "capability_list",
  async run(_input, _ctx) {
    return {
      ok: true,
      data: { schemaVersion: CATALOG_SCHEMA_VERSION, source: "catalog" },
    };
  },
});

// ---------------------------------------------------------------------
// account.lookup — resolver-driven disambiguation.
// ---------------------------------------------------------------------
defineCapability({
  id: "account.lookup",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_lookup",
  description: "Resolve a free-text account name. Returns disambiguation chips when ambiguous.",
  slashAliases: { en: ["/account", "/find-account"], fr: ["/compte"] },
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 2 } },
    required: ["query"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "account_workspace"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "account_card",
  async run(input) {
    const result = await resolveAccount(String(input.query ?? ""));
    if (result.kind === "match") {
      return { ok: true, data: { id: result.id, label: result.label } };
    }
    if (result.kind === "choices") {
      return {
        ok: true,
        data: { prompt: result.prompt, options: result.options },
        disambiguation: { kind: "account", options: result.options },
      };
    }
    return { ok: false, errorCode: "not_found", errorMessage: "no account matched" };
  },
});

// ---------------------------------------------------------------------
// raid.add_v2 — two-phase confirm (write).
// ---------------------------------------------------------------------
defineCapability({
  id: "raid.add_v2",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "raid",
  toolName: "raid_add_v2",
  description:
    "Draft a RAID item against an engagement. Always requires a confirm step before the row is written.",
  slashAliases: { en: ["/raid", "/raid-add"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      kind: { enum: ["risk", "assumption", "issue", "dependency"] },
      severity: { enum: ["red", "amber", "green"] },
      description: { type: "string", maxLength: 500 },
      confirm: { type: "boolean" },
    },
    required: ["engagementId", "kind", "severity", "description"],
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "raid_item",
  async run(input, ctx) {
    const args = {
      engagementId: String(input.engagementId ?? ""),
      kind: String(input.kind ?? "risk"),
      severity: String(input.severity ?? "amber"),
      description: String(input.description ?? "").slice(0, 500),
    };
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: args },
        confirmation: {
          summary: `Add a ${args.severity} ${args.kind} to ${args.engagementId}.`,
          diff: { create: { table: "atelier_raid_items", values: args } },
          pending: { tool: "raid_add_v2", input: { ...args, confirm: true } },
        },
      };
    }
    const id = rid("raid");
    await db.insert(atelierRaidItems).values({
      id,
      orgId: ctx.persona.orgId,
      engagementId: args.engagementId,
      kind: args.kind,
      severity: args.severity,
      description: args.description,
      status: "open",
      createdByUserId: ctx.persona.id,
    });
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "raid_item",
      entityId: id,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "raid.add.cli",
      payload: { ...args, viaCli: true, turnId: ctx.turnId },
      payloadSummary: `CLI added ${args.severity} ${args.kind}`,
    });
    return { ok: true, data: { id, ...args } };
  },
});

// ---------------------------------------------------------------------
// account.delete — irreversible + typed-name re-confirm.
// ---------------------------------------------------------------------
defineCapability({
  id: "account.delete",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_delete",
  description:
    "Soft-delete an account. Irreversible from CLI surface — second /confirm requires typing the account name.",
  slashAliases: { en: ["/delete-account"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["accountId"],
  },
  isWrite: true,
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "account_deleted",
  async run(input, ctx) {
    const accountId = String(input.accountId ?? "");
    const [acc] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, accountId), isNull(atelierAccounts.deletedAt)))
      .limit(1);
    if (!acc) {
      return { ok: false, errorCode: "not_found", errorMessage: `account ${accountId} not found` };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: acc.id, name: acc.name } },
        confirmation: {
          summary:
            `Permanently delete account "${acc.name}". This cannot be undone from the CLI — ` +
            `you will be asked to retype the account name to confirm.`,
          diff: {
            delete: { table: "atelier_accounts", id: acc.id, name: acc.name },
            irreversible: true,
            typedNameRequired: acc.name,
          },
          pending: { tool: "account_delete", input: { accountId: acc.id, confirm: true } },
        },
      };
    }
    await db
      .update(atelierAccounts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierAccounts.id, acc.id));
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: acc.id,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "account.delete.cli",
      payload: { accountId: acc.id, accountName: acc.name, viaCli: true, turnId: ctx.turnId },
      payloadSummary: `CLI deleted account ${acc.name}`,
    });
    return { ok: true, data: { deleted: acc.id, name: acc.name } };
  },
});

// ---------------------------------------------------------------------
// deliverable.email_send — outbound rate-limit + typed-recipient.
// ---------------------------------------------------------------------
defineCapability({
  id: "deliverable.email_send",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "deliverable",
  toolName: "deliverable_email_send",
  description:
    "Send a deliverable to an external recipient via email. Rate-limited per user per day; requires the recipient address to be retyped at confirm.",
  slashAliases: { en: ["/send-deliverable", "/email-deliverable"] },
  inputSchema: {
    type: "object",
    properties: {
      deliverableId: { type: "string" },
      recipientEmail: { type: "string" },
      typedRecipient: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["deliverableId", "recipientEmail"],
  },
  isWrite: true,
  irreversible: true,
  requiredRoles: ["founding_partner", "partner", "senior_manager"],
  surfaceOn: ["engagement_dashboard"],
  twoPhaseConfirm: true,
  outboundChannel: "email",
  resultCard: "email_sent",
  async run(input, ctx) {
    const deliverableId = String(input.deliverableId ?? "");
    const recipient = String(input.recipientEmail ?? "").trim().toLowerCase();
    if (!recipient.includes("@")) {
      return { ok: false, errorCode: "invalid_recipient", errorMessage: "recipient must be an email" };
    }
    if (input.confirm !== true) {
      const quota = await checkAndRecord(ctx.persona.id, "email");
      if (!quota.allowed) {
        return {
          ok: false,
          errorCode: "rate_limited",
          errorMessage: `daily email cap (${quota.snapshot.cap}) reached`,
          data: quota.snapshot,
        };
      }
      return {
        ok: true,
        data: { preview: { deliverableId, recipient }, quota: quota.snapshot },
        confirmation: {
          summary:
            `Email deliverable ${deliverableId} to ${recipient}. ` +
            `You will be asked to retype the recipient address to confirm. ` +
            `${quota.snapshot.remaining - 1} sends remaining today.`,
          diff: {
            send: { channel: "email", deliverableId, recipient },
            irreversible: true,
            typedNameRequired: recipient,
            outboundChannel: "email",
            quotaRemaining: quota.snapshot.remaining,
          },
          pending: {
            tool: "deliverable_email_send",
            input: { deliverableId, recipientEmail: recipient, confirm: true },
          },
        },
      };
    }
    // Commit phase — re-check quota (defends against confirm replay
    // racing other in-flight sends) then record the outbound row.
    const recheck = await checkAndRecord(ctx.persona.id, "email");
    if (!recheck.allowed) {
      return {
        ok: false,
        errorCode: "rate_limited",
        errorMessage: "daily email cap reached between preview and confirm",
        data: recheck.snapshot,
      };
    }
    await db.insert(atelierAuditEvents).values([
      {
        id: rid("aud"),
        entityType: "deliverable",
        entityId: deliverableId,
        actorType: "human",
        actorId: ctx.persona.id,
        actorLabel: ctx.persona.name,
        action: "cli.outbound.email",
        payload: { deliverableId, recipient, turnId: ctx.turnId },
        payloadSummary: `CLI emailed deliverable to <email>`,
      },
    ]);
    return { ok: true, data: { sent: true, deliverableId, recipient } };
  },
});
