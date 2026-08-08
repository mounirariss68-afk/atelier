/**
 * Task #800 — EA-assist chat capabilities (acting-for, dual attribution).
 *
 * Lets an Executive Assistant prepare items for a partner from chat
 * WITHOUT misfiled attribution. Design rules (see
 * .agents/memory/atelier-ea-delegation.md):
 *
 *   - Nothing an EA enters takes effect until the PARTNER approves it in
 *     the web review queue (Me → Delegates). Chat only creates/edits
 *     PENDING items in `atelier_ea_pending_items` — never real artifacts.
 *   - Acting-for context comes ONLY from the caller's own active
 *     delegation grants (`activeDelegationsForEa`). The partner is never
 *     a free-text person selector: `partnerName` merely filters the
 *     caller's own grants, and multiple matches disambiguate on the
 *     opaque delegationId. Scope (timesheets/expenses/meetings_tasks) is
 *     re-checked server-side per kind.
 *   - Dual attribution on every write: the shared route helpers
 *     (`submitEaPendingItem` / `updateEaPendingItem` /
 *     `resubmitEaPendingItem`) stamp the audit actorLabel
 *     "<EA> (EA) on behalf of <Partner>" and notify the partner — the
 *     REST routes and chat share one code path, so they cannot diverge.
 *   - Revoke re-checks per edit: `getEditableEaItem` re-validates the
 *     live grant + scope on every update/resubmit, so a revoked grant
 *     cuts chat off immediately too.
 *   - Payloads go through the same whitelist (`normalizeEaItemPayload`)
 *     as the REST route — no monetary/HR field can be smuggled in.
 *   - All writes are two-phase confirm; the confirm summary names both
 *     parties so the EA sees exactly whose queue the item lands in.
 *
 * Partner approve/reject deliberately STAYS in the web review queue
 * (overlap hints need the side-by-side UI); those registry entries stay
 * excluded in me-chat-parity.ts.
 */

import {
  activeDelegationsForEa,
  loadOrgUser,
  normalizeEaItemPayload,
  submitEaPendingItem,
  updateEaPendingItem,
  resubmitEaPendingItem,
  getEditableEaItem,
  KIND_SCOPE,
  ITEM_KINDS,
  type ItemKind,
  type DelegationRow,
  type PendingItemRow,
} from "../../routes/atelier/delegationRoutes.js";
import { defineSelfWriteCapability } from "./me-write-capabilities.js";
import type { SelfSubject } from "./me-capabilities.js";
import { resolveSelfSubject } from "./me-capabilities.js";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import type { ToolResult } from "./index.js";

const KIND_LABEL: Record<ItemKind, string> = {
  timesheet_entry: "timesheet entry",
  expense: "expense",
  meeting_task: "meeting/task note",
};

const NOT_AN_ASSISTANT: ToolResult = {
  ok: false,
  errorCode: "no_active_delegation",
  errorMessage:
    "You don't hold an active assistant (EA) delegation from any partner, so there is nothing you can prepare on someone else's behalf. A partner can set one up on the web portal under Me → Delegates.",
};

/**
 * Resolve which of the CALLER'S OWN active grants this action runs
 * under. Never a person lookup — only the caller's grants are searched,
 * so an EA cannot be steered toward a partner who never delegated to
 * them. Returns a ToolResult (error/disambiguation) or the resolved pair.
 */
async function resolveActingFor(
  subject: SelfSubject,
  input: Record<string, unknown>,
  kind: ItemKind,
): Promise<
  | { delegation: DelegationRow; partner: { id: string; name: string; row: NonNullable<Awaited<ReturnType<typeof loadOrgUser>>> } }
  | { result: ToolResult }
> {
  const grants = await activeDelegationsForEa(subject.user.orgId, subject.user.id);
  if (grants.length === 0) return { result: NOT_AN_ASSISTANT };
  const scope = KIND_SCOPE[kind];
  const inScope = grants.filter((g) => (g.scopes ?? []).includes(scope));
  if (inScope.length === 0) {
    return {
      result: {
        ok: false,
        errorCode: "scope_not_delegated",
        errorMessage: `None of your delegations covers ${scope.replace(/_/g, " ")} — the partner would need to add that scope under Me → Delegates.`,
      },
    };
  }
  // Load partner names for matching/labels.
  const withPartners: Array<{ delegation: DelegationRow; partner: NonNullable<Awaited<ReturnType<typeof loadOrgUser>>> }> = [];
  for (const d of inScope) {
    const partner = await loadOrgUser(subject.user.orgId, d.partnerUserId);
    if (partner) withPartners.push({ delegation: d, partner });
  }
  if (withPartners.length === 0) return { result: NOT_AN_ASSISTANT };

  let candidates = withPartners;
  if (typeof input.delegationId === "string" && input.delegationId.trim()) {
    candidates = withPartners.filter((c) => c.delegation.id === input.delegationId);
    if (candidates.length === 0) {
      return {
        result: {
          ok: false,
          errorCode: "not_found",
          errorMessage: "That delegation is not one of your active grants (it may have been revoked).",
        },
      };
    }
  } else if (typeof input.partnerName === "string" && input.partnerName.trim()) {
    const q = input.partnerName.trim().toLowerCase();
    const matched = withPartners.filter((c) => c.partner.name.toLowerCase().includes(q));
    if (matched.length === 0) {
      return {
        result: {
          ok: false,
          errorCode: "not_found",
          errorMessage: `None of the partners who delegated to you matches "${input.partnerName}". You can only prepare items for partners who granted you a delegation.`,
        },
      };
    }
    candidates = matched;
  }
  if (candidates.length > 1) {
    const options = candidates.map((c) => ({
      id: c.delegation.id,
      label: c.partner.name,
      secondary: `delegated: ${(c.delegation.scopes ?? []).join(", ").replace(/_/g, " ")}`,
    }));
    return {
      result: {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: {
          kind: "ea_delegation",
          field: "delegationId",
          options,
        } as ToolResult["disambiguation"],
      },
    };
  }
  const { delegation, partner } = candidates[0];
  return { delegation, partner: { id: partner.id, name: partner.name, row: partner } };
}

function pendingItemData(row: PendingItemRow, partnerName: string, verb: string) {
  return {
    id: row.id,
    label: `${verb} ${KIND_LABEL[row.kind as ItemKind]} for ${partnerName}'s approval`,
    status: row.status,
    partnerName,
    kind: row.kind,
    href: "/me/assist",
    navigateTo: { path: "/me/assist", when: "on_commit" as const },
  };
}

// ---------------------------------------------------------------------
// me.ea_item_submit — propose an item on behalf of a partner
// (mirrors POST /me/assist/:delegationId/items)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.ea_item_submit",
  module: "roster",
  toolName: "prepare_assist_item",
  description:
    "For Executive Assistants: prepare a timesheet entry, expense, or meeting/task note ON BEHALF OF a partner who delegated to the signed-in user. The item lands in the partner's pending review queue (nothing is applied until the partner approves) and is attributed as entered by the EA on behalf of the partner. kind is one of timesheet_entry (workDate + hours), expense (merchant + amount), or meeting_task (title). Receipts cannot be attached here — the EA can add one under Me → Assist.",
  slashAliases: { en: ["/assist"], fr: ["/assister"] },
  representativePrompts: {
    en: ["Log a taxi expense for Mounir", "Enter 3 hours for Friday on Karim's timesheet"],
    ar: ["سجّل مصروف تاكسي لمنير"],
    fr: ["Saisir une dépense de taxi pour Mounir"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Log a 45 dollar taxi expense for Mounir"],
    ar: ["سجّل مصروف تاكسي لمنير"],
    fr: ["Saisir une dépense de taxi pour Mounir"],
  },
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...ITEM_KINDS], description: "What to prepare." },
      partnerName: {
        type: "string",
        description:
          "Name of the partner to act for — matched only against partners who delegated to the caller.",
      },
      delegationId: {
        type: "string",
        description: "Delegation grant id (from a disambiguation pick).",
      },
      // timesheet_entry
      workDate: { type: "string", description: "ISO work date (timesheet_entry)." },
      hours: { type: "number", description: "Hours worked (timesheet_entry)." },
      activityCode: { type: "string" },
      narrative: { type: "string" },
      billable: { type: "boolean" },
      // expense
      merchant: { type: "string", description: "Merchant name (expense)." },
      amount: { type: "number", description: "Amount (expense)." },
      currency: { type: "string", description: "3-letter code, default USD." },
      expenseDate: { type: "string", description: "ISO date, defaults to today (expense)." },
      category: { type: "string" },
      description: { type: "string" },
      // meeting_task
      title: { type: "string", description: "Title (meeting_task)." },
      date: { type: "string", description: "ISO date (meeting_task)." },
      time: { type: "string", description: "HH:MM (meeting_task)." },
      notes: { type: "string" },
      attendees: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const kind = String(input.kind ?? "") as ItemKind;
    if (!ITEM_KINDS.includes(kind)) {
      return {
        ok: false,
        errorCode: "invalid_kind",
        errorMessage: `kind must be one of: ${ITEM_KINDS.join(", ")}.`,
      };
    }
    const acting = await resolveActingFor(subject, input, kind);
    if ("result" in acting) return acting.result;
    const normalized = normalizeEaItemPayload(kind, input);
    if ("error" in normalized) {
      return {
        ok: false,
        errorCode: normalized.error.replace(/-/g, "_"),
        errorMessage:
          kind === "timesheet_entry"
            ? "A timesheet entry needs a valid workDate (YYYY-MM-DD) and hours between 0 and 24."
            : kind === "expense"
              ? "An expense needs a merchant name and a positive amount (up to 1,000,000)."
              : "A meeting/task note needs a title.",
      };
    }
    const payload = normalized.payload;
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { kind, partnerName: acting.partner.name, payload } },
        confirmation: {
          summary: `Send this ${KIND_LABEL[kind]} to ${acting.partner.name}'s review queue? It will be recorded as entered by you (EA) on behalf of ${acting.partner.name}, and nothing is applied until ${acting.partner.name} approves it.`,
          diff: {
            create: {
              table: "atelier_ea_pending_items",
              summary: `Pending ${KIND_LABEL[kind]} for ${acting.partner.name}: ${
                kind === "expense"
                  ? `${payload.merchant} — ${payload.amount} ${payload.currency} (${payload.expenseDate})`
                  : kind === "timesheet_entry"
                    ? `${payload.hours}h on ${payload.workDate}`
                    : String(payload.title)
              }`,
            },
          },
          pending: {
            tool: "prepare_assist_item",
            input: { ...input, delegationId: acting.delegation.id, confirm: true },
          },
        },
      };
    }
    const row = await submitEaPendingItem({
      actor: subject.user,
      delegation: acting.delegation,
      partner: acting.partner.row,
      kind,
      payload,
      via: "chat",
    });
    return {
      ok: true,
      data: pendingItemData(row, acting.partner.name, "Sent"),
    };
  },
});

// ---------------------------------------------------------------------
// Shared own-item resolver for edit/resubmit (re-checks the live grant)
// ---------------------------------------------------------------------
async function resolveOwnAssistItem(
  subject: SelfSubject,
  input: Record<string, unknown>,
  wantStatuses: readonly string[],
): Promise<{ item: PendingItemRow } | { result: ToolResult }> {
  // No upfront grant check here: with an explicit itemId the per-item
  // live-grant re-check (getEditableEaItem) yields the precise refusal
  // ("that grant was revoked") instead of a generic one.
  if (typeof input.itemId === "string" && input.itemId.trim()) {
    const r = await getEditableEaItem(subject.user, input.itemId.trim());
    if ("error" in r) {
      return {
        result: {
          ok: false,
          errorCode: r.error === "not-found" ? "not_found" : r.error.replace(/-/g, "_"),
          errorMessage:
            r.error === "not-found"
              ? "That is not one of your assist items."
              : r.error === "not-editable"
                ? `That item is ${r.status} and can no longer be changed.`
                : "The delegation behind that item was revoked (or its scope removed), so it can no longer be edited.",
        },
      };
    }
    if (!wantStatuses.includes(r.item.status)) {
      return {
        result: {
          ok: false,
          errorCode: "not_editable",
          errorMessage: `That item is ${r.item.status}; expected ${wantStatuses.join(" or ")}.`,
        },
      };
    }
    return { item: r.item };
  }
  // No id — list the caller's editable items and disambiguate/pick.
  const { db, atelierEaPendingItems } = await import("@workspace/db");
  const { and, desc, eq, inArray, isNull } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(atelierEaPendingItems)
    .where(
      and(
        eq(atelierEaPendingItems.orgId, subject.user.orgId),
        eq(atelierEaPendingItems.eaUserId, subject.user.id),
        inArray(atelierEaPendingItems.status, [...wantStatuses]),
        isNull(atelierEaPendingItems.deletedAt),
      ),
    )
    .orderBy(desc(atelierEaPendingItems.createdAt))
    .limit(20);
  // Filter through the live-grant re-check so revoked items never surface.
  const editable: PendingItemRow[] = [];
  for (const r of rows) {
    const check = await getEditableEaItem(subject.user, r.id);
    if ("item" in check) editable.push(check.item);
  }
  if (editable.length === 0) {
    return {
      result: {
        ok: false,
        errorCode: "not_found",
        errorMessage: `You have no ${wantStatuses.join("/")} assist items that can be changed right now.`,
      },
    };
  }
  if (editable.length > 1) {
    const options = editable.slice(0, 8).map((r) => {
      const p = r.payload as Record<string, unknown>;
      return {
        id: r.id,
        label:
          r.kind === "expense"
            ? `${p.merchant} — ${p.amount} ${p.currency}`
            : r.kind === "timesheet_entry"
              ? `${p.hours}h on ${p.workDate}`
              : String(p.title ?? "Meeting/task"),
        secondary: `${KIND_LABEL[r.kind as ItemKind]} · ${r.status}`,
      };
    });
    return {
      result: {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: {
          kind: "ea_pending_item",
          field: "itemId",
          options,
        } as ToolResult["disambiguation"],
      },
    };
  }
  return { item: editable[0] };
}

// ---------------------------------------------------------------------
// me.ea_item_update — edit an own pending/rejected assist item
// (mirrors PATCH /me/assist/items/:id)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.ea_item_update",
  module: "roster",
  toolName: "update_assist_item",
  description:
    "For Executive Assistants: edit one of the signed-in user's own PENDING or REJECTED assist items (an item prepared on behalf of a partner that has not been approved yet). Provide the FULL corrected details for the item's kind — the payload is replaced as a whole. The live delegation is re-checked; a revoked grant blocks the edit.",
  slashAliases: { en: ["/edit-assist-item"], fr: ["/modifier-element-assistance"] },
  representativePrompts: {
    en: ["Change that taxi expense I entered for Mounir to 60 dollars"],
    ar: ["عدّل المصروف الذي أدخلته لمنير"],
    fr: ["Modifier la dépense que j'ai saisie pour Mounir"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Fix the amount on the assist expense I prepared"],
    ar: ["عدّل المصروف الذي أدخلته لمنير"],
    fr: ["Modifier la dépense que j'ai saisie pour Mounir"],
  },
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Id of the assist item (from a disambiguation pick)." },
      // timesheet_entry
      workDate: { type: "string" },
      hours: { type: "number" },
      activityCode: { type: "string" },
      narrative: { type: "string" },
      billable: { type: "boolean" },
      // expense
      merchant: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      expenseDate: { type: "string" },
      category: { type: "string" },
      description: { type: "string" },
      // meeting_task
      title: { type: "string" },
      date: { type: "string" },
      time: { type: "string" },
      notes: { type: "string" },
      attendees: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const resolved = await resolveOwnAssistItem(subject, input, ["pending", "rejected"]);
    if ("result" in resolved) return resolved.result;
    const item = resolved.item;
    const kind = item.kind as ItemKind;
    const prior = item.payload as Record<string, unknown>;
    // Whole-payload replace, defaulting unspecified fields from the prior
    // payload so "change the amount to 60" keeps the merchant/date.
    const merged: Record<string, unknown> = { ...prior };
    for (const [k, v] of Object.entries(input)) {
      if (k === "itemId" || k === "confirm" || v === undefined) continue;
      merged[k] = v;
    }
    const normalized = normalizeEaItemPayload(kind, merged);
    if ("error" in normalized) {
      return {
        ok: false,
        errorCode: normalized.error.replace(/-/g, "_"),
        errorMessage: "The corrected details are invalid for this item's kind.",
      };
    }
    const payload = normalized.payload;
    const partner = await loadOrgUser(subject.user.orgId, item.partnerUserId);
    const partnerName = partner?.name ?? "the partner";
    if (input.confirm !== true) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(payload)) {
        if (JSON.stringify(payload[k]) !== JSON.stringify(prior[k])) {
          changes[k] = { from: prior[k] ?? null, to: payload[k] };
        }
      }
      if (Object.keys(changes).length === 0) {
        return {
          ok: false,
          errorCode: "nothing_to_change",
          errorMessage: "Nothing to change — tell me the corrected details.",
        };
      }
      return {
        ok: true,
        data: { preview: { id: item.id, changes } },
        confirmation: {
          summary: `Update the ${KIND_LABEL[kind]} you prepared on behalf of ${partnerName} (${Object.keys(changes).join(", ")})? It stays in ${partnerName}'s review queue.`,
          diff: { update: { table: "atelier_ea_pending_items", id: item.id, changes } },
          pending: {
            tool: "update_assist_item",
            input: { ...input, itemId: item.id, confirm: true },
          },
        },
      };
    }
    const row = await updateEaPendingItem({
      actor: subject.user,
      item,
      payload,
      via: "chat",
    });
    return {
      ok: true,
      data: pendingItemData(row, partnerName, "Updated"),
    };
  },
});

// ---------------------------------------------------------------------
// me.ea_item_resubmit — rejected → pending
// (mirrors POST /me/assist/items/:id/resubmit)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.ea_item_resubmit",
  module: "roster",
  toolName: "resubmit_assist_item",
  description:
    "For Executive Assistants: resubmit one of the signed-in user's own REJECTED assist items back into the partner's review queue (usually after fixing it with an edit). The live delegation is re-checked.",
  slashAliases: { en: ["/resubmit-assist-item"], fr: ["/resoumettre-element-assistance"] },
  representativePrompts: {
    en: ["Resubmit the expense Mounir sent back"],
    ar: ["أعد إرسال المصروف المرفوض"],
    fr: ["Resoumettre la dépense renvoyée"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Resubmit my rejected assist expense"],
    ar: ["أعد إرسال المصروف المرفوض"],
    fr: ["Resoumettre la dépense renvoyée"],
  },
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Id of the rejected assist item." },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const resolved = await resolveOwnAssistItem(subject, input, ["rejected"]);
    if ("result" in resolved) return resolved.result;
    const item = resolved.item;
    const partner = await loadOrgUser(subject.user.orgId, item.partnerUserId);
    const partnerName = partner?.name ?? "the partner";
    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            id: item.id,
            kind: item.kind,
            rejectionReason: item.rejectionReason,
          },
        },
        confirmation: {
          summary: `Resubmit this ${KIND_LABEL[item.kind as ItemKind]} to ${partnerName}'s review queue?${item.rejectionReason ? ` It was sent back with: "${item.rejectionReason}".` : ""}`,
          diff: {
            update: {
              table: "atelier_ea_pending_items",
              id: item.id,
              changes: { status: { from: "rejected", to: "pending" } },
            },
          },
          pending: {
            tool: "resubmit_assist_item",
            input: { itemId: item.id, confirm: true },
          },
        },
      };
    }
    await resubmitEaPendingItem({ actor: subject.user, item, via: "chat" });
    return {
      ok: true,
      data: pendingItemData({ ...item, status: "pending" }, partnerName, "Resubmitted"),
    };
  },
});

// ---------------------------------------------------------------------
// me.ea_assist — read-only: my grants + my prepared items
// (mirrors GET /me/assist; identity-locked, no input)
// ---------------------------------------------------------------------
defineCapability({
  id: "me.ea_assist",
  module: "roster",
  toolName: "my_assist_items",
  description:
    "For Executive Assistants: the signed-in user's own delegation grants (which partners they can act for, and for what) and the items they have prepared on partners' behalf with statuses (pending / approved / rejected). Always self-scoped.",
  slashAliases: { en: ["/my-assist"], fr: ["/mon-assistance"] },
  representativePrompts: {
    en: ["What did I prepare for Mounir?", "Which partners can I assist?"],
    ar: ["ماذا أعددت لمنير؟"],
    fr: ["Qu'ai-je préparé pour Mounir ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Show my assist items"],
    ar: ["اعرض عناصر المساعدة الخاصة بي"],
    fr: ["Afficher mes éléments d'assistance"],
  },
  schemaVersion: CATALOG_SCHEMA_VERSION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  irreversible: false,
  async run(_input, ctx) {
    const subject = await resolveSelfSubject(ctx);
    if (!subject) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "Your login could not be resolved to a user record.",
      };
    }
    const grants = await activeDelegationsForEa(subject.user.orgId, subject.user.id);
    const { db, atelierEaPendingItems } = await import("@workspace/db");
    const { and, desc, eq, isNull } = await import("drizzle-orm");
    const items = await db
      .select()
      .from(atelierEaPendingItems)
      .where(
        and(
          eq(atelierEaPendingItems.orgId, subject.user.orgId),
          eq(atelierEaPendingItems.eaUserId, subject.user.id),
          isNull(atelierEaPendingItems.deletedAt),
        ),
      )
      .orderBy(desc(atelierEaPendingItems.createdAt))
      .limit(50);
    const nameFor = new Map<string, string>();
    for (const uid of new Set([
      ...grants.map((g) => g.partnerUserId),
      ...items.map((i) => i.partnerUserId),
    ])) {
      const u = await loadOrgUser(subject.user.orgId, uid);
      if (u) nameFor.set(uid, u.name);
    }
    return {
      ok: true,
      data: {
        id: subject.user.id,
        label: `Assist overview — ${grants.length} active delegation(s), ${items.length} item(s)`,
        delegations: grants.map((g) => ({
          id: g.id,
          partnerName: nameFor.get(g.partnerUserId) ?? g.partnerUserId,
          scopes: g.scopes,
        })),
        items: items.map((i) => {
          const p = i.payload as Record<string, unknown>;
          return {
            id: i.id,
            kind: i.kind,
            partnerName: nameFor.get(i.partnerUserId) ?? i.partnerUserId,
            status: i.status,
            rejectionReason: i.rejectionReason,
            summary:
              i.kind === "expense"
                ? `${p.merchant} — ${p.amount} ${p.currency}`
                : i.kind === "timesheet_entry"
                  ? `${p.hours}h on ${p.workDate}`
                  : String(p.title ?? ""),
          };
        }),
        href: "/me/assist",
      },
    };
  },
});
