/**
 * CLI-only capabilities (no Express route counterpart).
 *
 * Most catalog entries are now derived from code via Task #339's two
 * helpers — `defineRouteCapability` colocates a capability with its
 * route, and `registerAgentCapabilities` walks the agents registry.
 * The entries in this file are the leftover slice that have no real
 * HTTP route: they expose pure CLI verbs (help/palette listing, free
 * text resolvers, soft mocks of high-blast-radius operations like
 * outbound email send + irreversible deletes) so the orchestrator can
 * exercise every code path before the read-parity task wires up the
 * real routes.
 *
 * Each entry is registered with `source: "cli-only"` so the lint and
 * coverage checks know not to expect a sibling route.
 *
 *   - read-only, board-observer-allowed:        meta.help
 *   - resolver-driven disambiguation:           account.lookup
 *   - write + two-phase confirm:                raid.add_v2
 *   - irreversible + typed-name re-confirm:     account.delete
 *   - outbound-channel + per-day rate-limit:    deliverable.email_send
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierEngagements,
  atelierRaidItems,
  atelierAuditEvents,
  atelierCliSessions,
  atelierCliTurns,
} from "@workspace/db";
import { purgeAttachmentsByScope } from "./attachments/index.js";
import {
  archiveAccount,
  restoreAccount,
  permanentlyDeleteAccount,
  loadAccountAnyState,
  accountFinancialFootprint,
} from "../atelier-account-lifecycle.js";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  getSessionDraft,
} from "./capability-catalog.js";
import { buildRecapPayload } from "./recap-relevance.js";
import { collectRecapOpenThreads } from "./index.js";
import { resolveAccount } from "./resolvers/index.js";
import { checkAndRecord } from "./outbound-rate-limit.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";

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
  // Task #342 — surface meta.help on Home so the assistant's
  // discoverability chips can advertise "what can I ask?" as a
  // catalog-driven prompt.
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "capability_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show me what I can ask Atelier", "What can Atelier do?"],
    ar: ["اعرض ما يمكنني سؤاله للأتيليه", "ما الذي يستطيع الأتيليه فعله؟"],
    fr: ["Montre-moi ce que je peux demander à l'Atelier"],
  },
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
  // Task #342 — also surfaced on Home so the discoverability chips can
  // offer "Find an account…" as a top-level prompt.
  surfaceOn: ["global", "account_workspace", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "account_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Find an account by name", "Look up an account"],
    ar: ["ابحث عن حساب بالاسم", "اعثر على حساب"],
    fr: ["Trouver un compte par nom"],
  },
  async run(input, ctx) {
    const result = await resolveAccount(String(input.query ?? ""), ctx.persona);
    if (result.kind === "match") {
      // Task #499 — single-match lookup: hint a navigation to the
      // resolved account workspace.
      return {
        ok: true,
        data: {
          id: result.id,
          label: result.label,
          navigateTo: { path: `/accounts/${result.id}`, when: "on_commit" as const },
        },
      };
    }
    if (result.kind === "choices") {
      return {
        ok: true,
        data: { prompt: result.prompt, options: result.options },
        disambiguation: { kind: "account", options: result.options },
      };
    }
    // Task #390 — point the model (and the user) at the list tool instead
    // of dead-ending.
    return {
      ok: false,
      errorCode: "not_found",
      errorMessage:
        "no account matched — use the account_list tool to browse all visible accounts/clients",
    };
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
  requiredRoles: [
    "founding_partner",
    "partner",
    "senior_manager",
    "consultant",
    
    
  ],
  surfaceOn: ["engagement_dashboard"],
  examplePhrases: {
    en: [
      "add a red risk: vendor missed milestone",
      "log an amber issue on this engagement",
      "/raid risk red — backup window slipping",
    ],
  },
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
    // Task #340 — clarification producer. If the user asked to file a
    // RAID without a description, pause the turn and ask for it; the
    // orchestrator will treat the next user message as the answer and
    // re-call this tool with the merged args.
    if (!args.description || args.description.trim().length < 3) {
      return {
        ok: true,
        data: { partial: args },
        clarification: {
          field: "description",
          question:
            "What's the description for this RAID item? A single sentence is fine.",
          tool: "raid_add_v2",
          partial: args,
        },
      };
    }
    // Task #332 — engagement ACL parity. Reuse the same accessible-id
    // helper the routes use so the CLI cannot create a RAID against an
    // engagement the persona is not actually on.
    const acl = await accessibleEngagementIds({
      id: ctx.persona.id,
      role: ctx.persona.role,
    } as Parameters<typeof accessibleEngagementIds>[0]);
    if (acl.all !== true && !acl.ids.has(args.engagementId)) {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage: `engagement ${args.engagementId} is outside your access`,
      };
    }
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
    // Task #511 — RAID drafts land on the parent engagement dashboard.
    return {
      ok: true,
      data: {
        id,
        ...args,
        navigateTo: {
          path: `/clients/deliver/engagements/${args.engagementId}`,
          when: "on_commit" as const,
        },
      },
    };
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
    "Permanently delete an account (founding partner only). Blocked when invoices or timesheets exist unless overridden. Irreversible — purges every document and the second /confirm requires typing the account name. Use /archive-account for the reversible default.",
  slashAliases: { en: ["/delete-account"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      override: { type: "boolean" },
      confirm: { type: "boolean" },
    },
    required: ["accountId"],
  },
  isWrite: true,
  irreversible: true,
  // Task #627 — true hard-delete is reserved for the founding partner.
  requiredRoles: ["founding_partner"],
  surfaceOn: ["account_workspace"],
  examplePhrases: {
    en: ["permanently delete the Acme account", "/delete-account acme"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "account_deleted",
  async run(input, ctx) {
    const accountId = String(input.accountId ?? "");
    const override = input.override === true;
    // Task #627 — true hard-delete is reserved for the founding partner. The
    // catalog already hides this capability from other roles; this in-run guard
    // makes the capability self-defending for direct/programmatic callers.
    if (ctx.persona.role !== "founding_partner") {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage:
          "Only the founding partner can permanently delete an account. Archive it instead.",
      };
    }
    // Task #332/#627 — org-scope the lookup WITHOUT filtering deletedAt so a
    // re-confirm of an already-removed target replays as a success no-op
    // ("already removed"), never a confusing not_found.
    const acc = await loadAccountAnyState(ctx.persona.orgId, accountId);
    if (!acc) {
      return { ok: false, errorCode: "not_found", errorMessage: `No account ${accountId} in your workspace.` };
    }
    if (acc.deletedAt) {
      // Idempotent: the destructive action already happened.
      return {
        ok: true,
        data: {
          deleted: acc.id,
          name: acc.name,
          alreadyRemoved: true,
          message: `Account "${acc.name}" was already removed.`,
          navigateTo: { path: "/accounts", when: "on_commit" as const },
        },
      };
    }

    // Surface the financial-records gate before asking for confirmation.
    const footprint = await accountFinancialFootprint(ctx.persona.orgId, acc.id);
    if (footprint.hasAny && !override) {
      const parts: string[] = [];
      if (footprint.invoices > 0) parts.push(`${footprint.invoices} invoice${footprint.invoices === 1 ? "" : "s"}`);
      if (footprint.timesheets > 0) parts.push(`${footprint.timesheets} timesheet entr${footprint.timesheets === 1 ? "y" : "ies"}`);
      return {
        ok: false,
        errorCode: "financial_records_exist",
        errorMessage:
          `"${acc.name}" has ${parts.join(" and ")} on its books. Permanent deletion is blocked. ` +
          `Archive it instead (/archive-account), or re-run with override:true to force the delete.`,
      };
    }

    if (input.confirm !== true) {
      const overrideNote =
        footprint.hasAny && override
          ? ` Overriding the financial-records block (${footprint.invoices} invoices, ${footprint.timesheets} timesheet entries will be orphaned).`
          : "";
      return {
        ok: true,
        data: { preview: { id: acc.id, name: acc.name } },
        confirmation: {
          summary:
            `Permanently delete account "${acc.name}" and purge all of its documents. ` +
            `This cannot be undone — you will be asked to retype the account name to confirm.` +
            overrideNote +
            ` (To keep the records and make this reversible, archive it instead.)`,
          diff: {
            delete: { table: "atelier_accounts", id: acc.id, name: acc.name },
            irreversible: true,
            typedNameRequired: acc.name,
          },
          pending: { tool: "account_delete", input: { accountId: acc.id, override, confirm: true } },
        },
      };
    }

    const result = await permanentlyDeleteAccount(
      { id: ctx.persona.id, name: ctx.persona.name, orgId: ctx.persona.orgId },
      acc.id,
      { override },
    );
    if (result.status === "blocked") {
      return {
        ok: false,
        errorCode: "financial_records_exist",
        errorMessage:
          `"${result.accountName}" has financial records (${result.financial.invoices} invoices, ` +
          `${result.financial.timesheets} timesheet entries). Re-run with override:true to force the delete.`,
      };
    }
    if (result.status === "not_found") {
      return { ok: false, errorCode: "not_found", errorMessage: `No account ${accountId} in your workspace.` };
    }
    // Task #499/#627 — after a delete the entity page no longer exists; land
    // the user on the accounts index so they see their list.
    return {
      ok: true,
      data: {
        deleted: acc.id,
        name: result.accountName,
        alreadyRemoved: result.status === "already_removed",
        navigateTo: { path: "/accounts", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// account.archive — reversible default. Cascades opps/engs, retains
// invoices + timesheets read-only, restorable via account.restore.
// ---------------------------------------------------------------------
defineCapability({
  id: "account.archive",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_archive",
  description:
    "Archive an account (reversible). Closes its open opportunities and engagements and hides it from the active roster, while keeping invoices and timesheets read-only. Restore it any time with /restore-account.",
  slashAliases: { en: ["/archive-account"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["accountId"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["account_workspace"],
  examplePhrases: {
    en: ["archive the Acme account", "/archive-account acme"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "entity_card",
  async run(input, ctx) {
    const accountId = String(input.accountId ?? "");
    if (ctx.persona.role !== "founding_partner" && ctx.persona.role !== "partner") {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage: "Only partners can archive accounts.",
      };
    }
    const acc = await loadAccountAnyState(ctx.persona.orgId, accountId);
    if (!acc || acc.deletedAt) {
      return { ok: false, errorCode: "not_found", errorMessage: `No account ${accountId} in your workspace.` };
    }
    if (acc.status === "archived") {
      return {
        ok: true,
        data: {
          archived: acc.id,
          name: acc.name,
          alreadyArchived: true,
          message: `Account "${acc.name}" is already archived.`,
          navigateTo: { path: `/accounts/${acc.id}`, when: "on_commit" as const },
        },
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: acc.id, name: acc.name } },
        confirmation: {
          summary:
            `Archive account "${acc.name}". Its open opportunities and active engagements will be closed and ` +
            `the account drops off the active roster (still viewable read-only under the Archived filter). ` +
            `Invoices and timesheets are kept. You can restore it any time.`,
          diff: {
            update: { table: "atelier_accounts", id: acc.id, name: acc.name, status: "archived" },
            reversible: true,
          },
          pending: { tool: "account_archive", input: { accountId: acc.id, confirm: true } },
        },
      };
    }
    const result = await archiveAccount(
      { id: ctx.persona.id, name: ctx.persona.name, orgId: ctx.persona.orgId },
      acc.id,
    );
    if (result.status === "not_found") {
      return { ok: false, errorCode: "not_found", errorMessage: `No account ${accountId} in your workspace.` };
    }
    return {
      ok: true,
      data: {
        archived: acc.id,
        name: result.status === "already_archived" ? result.accountName : result.accountName,
        alreadyArchived: result.status === "already_archived",
        navigateTo: { path: `/accounts/${acc.id}`, when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// account.restore — inverse of archive. Reactivates the account and its
// cascaded opportunities + engagements.
// ---------------------------------------------------------------------
defineCapability({
  id: "account.restore",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_restore",
  description:
    "Restore a previously archived account, reactivating it and reverting its cascaded opportunities and engagements to their pre-archive state.",
  slashAliases: { en: ["/restore-account"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["accountId"],
  },
  isWrite: true,
  irreversible: false,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["account_workspace"],
  examplePhrases: {
    en: ["restore the Acme account", "/restore-account acme"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "entity_card",
  async run(input, ctx) {
    const accountId = String(input.accountId ?? "");
    if (ctx.persona.role !== "founding_partner" && ctx.persona.role !== "partner") {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage: "Only partners can restore accounts.",
      };
    }
    const acc = await loadAccountAnyState(ctx.persona.orgId, accountId);
    if (!acc || acc.deletedAt) {
      return { ok: false, errorCode: "not_found", errorMessage: `No account ${accountId} in your workspace.` };
    }
    if (acc.status !== "archived") {
      return {
        ok: true,
        data: {
          restored: acc.id,
          name: acc.name,
          alreadyActive: true,
          message: `Account "${acc.name}" is not archived.`,
          navigateTo: { path: `/accounts/${acc.id}`, when: "on_commit" as const },
        },
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: acc.id, name: acc.name } },
        confirmation: {
          summary:
            `Restore account "${acc.name}". It returns to the active roster and its archived opportunities and ` +
            `engagements are reactivated to their pre-archive state.`,
          diff: {
            update: { table: "atelier_accounts", id: acc.id, name: acc.name, status: "active" },
            reversible: true,
          },
          pending: { tool: "account_restore", input: { accountId: acc.id, confirm: true } },
        },
      };
    }
    const result = await restoreAccount(
      { id: ctx.persona.id, name: ctx.persona.name, orgId: ctx.persona.orgId },
      acc.id,
    );
    if (result.status === "not_found") {
      return { ok: false, errorCode: "not_found", errorMessage: `No account ${accountId} in your workspace.` };
    }
    return {
      ok: true,
      data: {
        restored: acc.id,
        name: result.accountName,
        navigateTo: { path: `/accounts/${acc.id}`, when: "on_commit" as const },
      },
    };
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
  examplePhrases: {
    en: ["email this deck to the client", "/send-deliverable to john@acme.com"],
  },
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
    // Task #509 — outbound email is a pure side-effect; the chat has
    // no canonical destination keyed by deliverableId alone (the
    // deliverable workspace requires the parent engagementId, which we
    // don't load here). Explicitly return null so callers get a
    // consistent shape.
    return {
      ok: true,
      data: { sent: true, deliverableId, recipient, navigateTo: null },
    };
  },
});

async function fetchLiveOpenStateForPersona(persona: {
  id: string;
  orgId: string;
  role: string;
}): Promise<{ openRaids: number; activeEngagements: number }> {
  try {
    const acl = await accessibleEngagementIds({
      id: persona.id,
      role: persona.role,
    } as Parameters<typeof accessibleEngagementIds>[0]);
    const baseRaid = and(
      eq(atelierRaidItems.orgId, persona.orgId),
      eq(atelierRaidItems.status, "open"),
      isNull(atelierRaidItems.deletedAt),
    );
    const raidRows = await db
      .select({ id: atelierRaidItems.id, eng: atelierRaidItems.engagementId })
      .from(atelierRaidItems)
      .where(baseRaid);
    const openRaids =
      acl.all === true
        ? raidRows.length
        : raidRows.filter((r) => acl.ids.has(r.eng)).length;
    const activeEngagements = acl.all === true ? -1 : acl.ids.size;
    return { openRaids, activeEngagements };
  } catch {
    return { openRaids: 0, activeEngagements: 0 };
  }
}

defineCapability({
  id: "meta.recap",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "recap",
  description:
    "Recap recent activity in this CLI session. Returns the rolling summary plus the last few referenced entities. Read-only.",
  slashAliases: { en: ["/recap", "/catch-me-up"], fr: ["/résumé"], ar: ["/ملخص"] },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "recap_card",
  async run(_input, ctx) {
    const [sess] = await db
      .select()
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, ctx.sessionId))
      .limit(1);
    const draft = getSessionDraft(ctx.sessionId);
    // Task #992 — lead with the composed outcome summary (same composer
    // as the proactive "Catching you up" card, Task #978) plus open
    // threads. Raw trace lines appear ONLY as a legacy fallback when no
    // composed summary exists (rolling summary predates outcome segments).
    const recapPayload = buildRecapPayload({
      rollingSummary: sess?.rollingSummary,
      openThreads: await collectRecapOpenThreads({
        sessionId: ctx.sessionId,
        excludeTurnId: ctx.turnId,
      }),
    });
    const entities = Object.entries(draft.entities)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 6)
      .map(([k, v]) => ({ kind: k, id: v.id, label: v.label }));
    const live = await fetchLiveOpenStateForPersona(ctx.persona);
    return {
      ok: true,
      data: {
        // Task #992 — outcome-first recap. `accomplishments` mirrors the
        // proactive card's composed outcome lines; `recap` carries raw
        // trace lines ONLY when no composed summary exists.
        ...recapPayload,
        entities,
        turnCount: sess?.turnCount ?? 0,
        lastTurnAt: sess?.lastTurnAt ?? null,
        lastResultKind: draft.lastResultKind ?? null,
        lastResultRowCount: Array.isArray(draft.lastResultRows)
          ? draft.lastResultRows.length
          : 0,
        liveOpenState: {
          openRaidItems: live.openRaids,
          accessibleEngagements: live.activeEngagements,
        },
      },
    };
  },
});

defineCapability({
  id: "meta.explain_last",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "explain_last",
  description:
    "Explain or summarize the most recent CLI turn — what was decided, which tools ran, what changed. Read-only.",
  slashAliases: {
    en: ["/explain", "/why", "/summarize"],
    fr: ["/expliquer"],
    ar: ["/اشرح"],
  },
  inputSchema: {
    type: "object",
    properties: {
      mode: { enum: ["explain", "why", "summarize"], default: "explain" },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "explain_card",
  async run(input, ctx) {
    const draft = getSessionDraft(ctx.sessionId);
    const targetTurnId = draft.lastTurnId;
    if (!targetTurnId) {
      return { ok: false, errorCode: "no_prior_turn", errorMessage: "no prior turn in this session" };
    }
    const [turn] = await db
      .select()
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, targetTurnId))
      .limit(1);
    if (!turn) {
      return { ok: false, errorCode: "not_found", errorMessage: `turn ${targetTurnId} not found` };
    }
    const calls = (turn.toolCalls as Array<Record<string, unknown>>) ?? [];
    const frames = (turn.frames as Array<Record<string, unknown>>) ?? [];
    const narrationLines = frames
      .filter((f) => f.type === "narration")
      .map((f) => String(((f.data as { text?: string })?.text ?? "")));
    const mode = String(input.mode ?? "explain");
    // Task #340 — record-grounded citations: pull every audit row written
    // for this CLI turn so the explanation can be backed by real entity
    // references the UI can deep-link to.
    // Match audit rows BOTH for the cli_turn row (entityId = turn.id)
    // AND for downstream entity mutations (payload->>'turnId' = turn.id)
    // so citations include the actual records touched during this turn,
    // not just the meta `cli.turn` envelope.
    const auditRows = await db
      .select({
        id: atelierAuditEvents.id,
        entityType: atelierAuditEvents.entityType,
        entityId: atelierAuditEvents.entityId,
        action: atelierAuditEvents.action,
        payloadSummary: atelierAuditEvents.payloadSummary,
        createdAt: atelierAuditEvents.createdAt,
      })
      .from(atelierAuditEvents)
      .where(
        or(
          eq(atelierAuditEvents.entityId, turn.id),
          sql`${atelierAuditEvents.payload}->>'turnId' = ${turn.id}`,
        ),
      )
      .limit(40);
    const toolCallEntities = calls
      .map((c) => ({
        tool: String(c.tool ?? ""),
        ok: Boolean(c.ok),
        errorCode: (c.errorCode as string | null | undefined) ?? null,
        input: (c.input as Record<string, unknown> | undefined) ?? null,
      }))
      .filter((c) => c.tool.length > 0);
    const citations = [
      ...auditRows.map((r) => ({
        kind: "audit" as const,
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        summary: r.payloadSummary ?? null,
        at: r.createdAt,
      })),
      ...toolCallEntities.map((c, i) => ({
        kind: "tool_call" as const,
        id: `${turn.id}:${i}`,
        tool: c.tool,
        ok: c.ok,
        errorCode: c.errorCode,
      })),
    ];
    return {
      ok: true,
      data: {
        mode,
        turnId: turn.id,
        prompt: turn.prompt,
        status: turn.status,
        narration: narrationLines,
        toolCalls: toolCallEntities.map((c) => ({
          tool: c.tool,
          ok: c.ok,
          errorCode: c.errorCode,
        })),
        citations,
        latencyMs: turn.latencyMs ?? null,
        costCents: turn.costCents ?? null,
      },
    };
  },
});

defineCapability({
  id: "meta.refine_last",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "refine_last",
  description:
    "Refine the most recent list/result without re-running the original tool. Supports filter (substring across fields), groupBy (field name), justField (project a single field). Read-only.",
  slashAliases: { en: ["/filter", "/group", "/just", "/refine"] },
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "string", maxLength: 120 },
      groupBy: { type: "string", maxLength: 60 },
      justField: { type: "string", maxLength: 60 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "refined_list",
  async run(input, ctx) {
    const draft = getSessionDraft(ctx.sessionId);
    const filterTok = String(input.filter ?? "").trim().toLowerCase();
    const groupBy = String(input.groupBy ?? "").trim();
    const justField = String(input.justField ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(input.limit ?? 50)));
    let rerunUsed = false;
    let rows: Array<Record<string, unknown>> | null =
      Array.isArray(draft.lastResultRows) ? draft.lastResultRows : null;
    // Task #340 — re-run originating read capability with adjusted args
    // when we have it on file. This is a real refinement (fresh data,
    // server-side filtering) instead of only post-filtering cached rows.
    // Task #340 — never re-invoke meta post-processors as the "source"
    // read tool: refine_last → refine_last would recurse forever, and
    // recap/explain/undo aren't list-producing reads either. Only
    // genuine source reads belong here.
    const META_TOOLS = new Set([
      "refine_last",
      "recap",
      "explain_last",
      "undo_last",
      "request_feature",
    ]);
    if (
      draft.lastReadTool &&
      draft.lastReadArgs &&
      !META_TOOLS.has(draft.lastReadTool)
    ) {
      try {
        const { findToolByName } = await import("./index.js");
        const tool = findToolByName(draft.lastReadTool, ctx.persona);
        if (tool && !tool.isWrite) {
          const reArgs: Record<string, unknown> = { ...draft.lastReadArgs };
          if (filterTok) reArgs.q = filterTok;
          if (limit) reArgs.limit = limit;
          const fresh = await tool.run(reArgs, {
            persona: ctx.persona,
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            stepIdx: 0,
          });
          if (fresh.ok && fresh.data && typeof fresh.data === "object") {
            const fd = fresh.data as Record<string, unknown>;
            const candidate = Array.isArray(fd.items)
              ? (fd.items as Array<Record<string, unknown>>)
              : Array.isArray(fd.rows)
                ? (fd.rows as Array<Record<string, unknown>>)
                : Array.isArray(fd.results)
                  ? (fd.results as Array<Record<string, unknown>>)
                  : null;
            if (candidate) {
              rows = candidate;
              rerunUsed = true;
            }
          }
        }
      } catch {
        // fall through to in-memory refinement
      }
    }
    if (!rows || rows.length === 0) {
      return {
        ok: false,
        errorCode: "no_prior_result",
        errorMessage: "no prior list result is available to refine",
      };
    }
    let working: Array<Record<string, unknown>> = rows;
    if (filterTok) {
      working = working.filter((r) =>
        Object.values(r).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(filterTok),
        ),
      );
    }
    if (justField) {
      working = working.map((r) => ({ [justField]: r[justField] }));
    }
    let groups: Array<{ key: string; count: number; rows: Array<Record<string, unknown>> }> | undefined;
    if (groupBy) {
      const buckets = new Map<string, Array<Record<string, unknown>>>();
      for (const r of working) {
        const key = String(r[groupBy] ?? "(none)");
        const arr = buckets.get(key) ?? [];
        arr.push(r);
        buckets.set(key, arr);
      }
      groups = [...buckets.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([key, rs]) => ({ key, count: rs.length, rows: rs.slice(0, 5) }));
    }
    return {
      ok: true,
      data: {
        sourceKind: draft.lastResultKind ?? null,
        sourceTool: draft.lastReadTool ?? null,
        rerunUsed,
        total: rows.length,
        filtered: working.length,
        items: working.slice(0, limit),
        groups,
        appliedFilter: filterTok || null,
        appliedGroupBy: groupBy || null,
        appliedJustField: justField || null,
      },
    };
  },
});

defineCapability({
  id: "meta.undo_last",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "undo_last",
  description:
    "Undo the most recent CLI write in this session by performing the inverse action (e.g. cancel + soft-delete a RAID item). Mutates state.",
  slashAliases: { en: ["/undo", "/undo-last"], ar: ["/تراجع"] },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "undo_card",
  async run(_input, ctx) {
    const draft = getSessionDraft(ctx.sessionId);
    const candidateTurnId = draft.lastWriteTurnId;
    if (!candidateTurnId) {
      // Task #511 — undo has no destination; stay on the current surface.
      return {
        ok: true,
        data: {
          canUndo: false,
          reason: "no recent CLI write in this session",
          navigateTo: null,
        },
      };
    }
    const [turn] = await db
      .select()
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, candidateTurnId))
      .limit(1);
    if (!turn) {
      return {
        ok: true,
        data: { canUndo: false, reason: "prior write turn not found", navigateTo: null },
      };
    }
    const tool = String(draft.lastWriteTool ?? "");
    // Task #340 — execute true inverse for supported writes.
    if (tool === "raid_add_v2" && draft.lastWriteRaidId) {
      const raidId = draft.lastWriteRaidId;
      const [item] = await db
        .select({
          id: atelierRaidItems.id,
          status: atelierRaidItems.status,
          orgId: atelierRaidItems.orgId,
          deletedAt: atelierRaidItems.deletedAt,
        })
        .from(atelierRaidItems)
        .where(eq(atelierRaidItems.id, raidId))
        .limit(1);
      if (!item || item.deletedAt) {
        return {
          ok: true,
          data: {
            canUndo: false,
            tool,
            reason: "underlying RAID row already removed",
            raidId,
            navigateTo: null,
          },
        };
      }
      if (item.orgId !== ctx.persona.orgId) {
        return {
          ok: false,
          errorCode: "forbidden",
          errorMessage: "raid item belongs to another org",
        };
      }
      await db
        .update(atelierRaidItems)
        .set({ status: "cancelled", deletedAt: new Date() })
        .where(eq(atelierRaidItems.id, raidId));
      const auditId = rid("aud");
      await db.insert(atelierAuditEvents).values({
        id: auditId,
        entityType: "raid_item",
        entityId: raidId,
        actorType: "human",
        actorId: ctx.persona.id,
        actorLabel: ctx.persona.name,
        action: "raid.cancel.cli.undo",
        payload: { undoOfTurnId: turn.id, viaCli: true, turnId: ctx.turnId },
        payloadSummary: `CLI undo: cancelled RAID ${raidId}`,
      });
      // Prevent double-undo on the same write.
      draft.lastWriteRaidId = undefined;
      draft.lastWriteTurnId = undefined;
      draft.lastWriteTool = undefined;
      return {
        ok: true,
        data: {
          canUndo: true,
          executed: true,
          tool,
          turnId: turn.id,
          inverseAction: "raid.cancel",
          raidId,
          auditEventId: auditId,
          navigateTo: null,
        },
      };
    }
    const irreversibleHint =
      "This action does not have an inverse mapping on the CLI surface. Open the audit row to review or revert in the underlying module.";
    return {
      ok: true,
      data: {
        canUndo: false,
        tool,
        turnId: turn.id,
        prompt: turn.prompt,
        status: turn.status,
        finishedAt: turn.finishedAt,
        guidance: irreversibleHint,
        auditEntityType: "cli_turn",
        auditEntityId: turn.id,
        navigateTo: null,
      },
    };
  },
});

defineCapability({
  id: "meta.request_feature",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "request_feature",
  description:
    "Capture a user-requested capability that the CLI cannot perform today. Writes a `cli.feature_request` audit row. Use after a refusal or when the user types /request.",
  slashAliases: { en: ["/request", "/feature"], ar: ["/طلب"] },
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 3, maxLength: 1000 },
      surface: { type: "string", maxLength: 60 },
    },
    required: ["text"],
  },
  isWrite: true,
  irreversible: false,
  twoPhaseConfirm: false,
  surfaceOn: ["global"],
  outboundChannel: null,
  resultCard: "feature_request",
  async run(input, ctx) {
    const text = String(input.text ?? "").trim().slice(0, 1000);
    if (text.length < 3) {
      return {
        ok: true,
        data: { partial: { surface: input.surface ?? null } },
        clarification: {
          field: "text",
          question:
            "Briefly describe the capability you wanted. I'll log it as a feature request for the product team.",
          tool: "request_feature",
          partial: { surface: input.surface ?? null },
        },
      };
    }
    const id = rid("aud");
    await db.insert(atelierAuditEvents).values({
      id,
      entityType: "cli_session",
      entityId: ctx.sessionId,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "cli.feature_request",
      payload: {
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        text,
        surface: input.surface ?? null,
      },
      payloadSummary: `CLI feature request: ${text.slice(0, 100)}`,
    });
    // Task #511 — feature requests are pure audit writes with no destination.
    return {
      ok: true,
      data: {
        captured: true,
        auditEventId: id,
        text,
        message:
          "Thanks — I logged this as a feature request. The product team reviews these in the weekly CLI sync.",
        navigateTo: null,
      },
    };
  },
});
