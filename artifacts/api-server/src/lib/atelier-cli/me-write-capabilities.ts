/**
 * Task #583 — Me-lens self-service WRITE capabilities.
 *
 * Identity-locked, confirm-gated chat tools for the personal writes the
 * clamped personas (employee / contractor / partner_firm_resource) need
 * on mobile: request leave, draft an expense (optionally from a chat
 * receipt attachment), log time + submit the week, edit their own
 * profile, manage personal documents (passport / national ID / …), and
 * dismiss their own notification cards.
 *
 * Security model — every tool here goes through
 * `defineSelfWriteCapability`:
 *   - the subject is ALWAYS the authenticated session persona
 *     (`ctx.persona.id`), re-resolved via the same helper the /me/*
 *     REST routes use. Input schemas carry NO person/user selector and
 *     the run callbacks never read one (`additionalProperties: false`).
 *   - every write mirrors the corresponding /me/* REST route's
 *     validation + guards (leave balance/overlap, week draft/rejected
 *     lock, profile whitelist, document kind/mime/national-ID side
 *     rules, notification ownership-in-WHERE).
 *   - all writes are two-phase confirm (except notification dismiss —
 *     a trivially reversible UI action).
 *   - attachments referenced by id are validated as UPLOADED BY THE
 *     CALLER and org-scoped before any bytes move.
 */

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierPersons,
  atelierAccounts,
  atelierEngagements,
  atelierLeaveRequests,
  atelierExpenses,
  atelierLegalEntities,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierTimesheetSignals,
  atelierPersonDocuments,
  atelierSelfNotifications,
  atelierAuditEvents,
  atelierMsConnections,
} from "@workspace/db";
import { z } from "zod";
import {
  CATALOG_SCHEMA_VERSION,
  SELF_ONLY_CHAT_ROLES,
  defineCapability,
  findByToolName,
  type CapabilityInput,
} from "./capability-catalog.js";
import {
  splitDocQueryTerms,
  matchOwnDocuments as sharedMatchOwnDocuments,
  loadVisibleLibraryPairs,
  resolveTermsUnique,
  handoffEmailInput,
} from "./document-email-shared.js";
import { hasPersonalDocCue, hasCompanyDocCue } from "./capability-retriever.js";
import { resolveSelfSubject, type SelfSubject } from "./me-capabilities.js";
// Task #589 — chat submits must fire the same notification rows as the
// Me-lens REST submit paths so requests don't sit invisible.
import { emitSelfNotification } from "../../routes/atelier/meRoutes.js";
import { proposeExpenseAllocation } from "../atelier-entity-allocation.js";
import { loadAttachment, loadAttachmentBytes } from "./attachments/index.js";
import {
  storePersonDocBytes,
  loadPersonDocBytes,
  dropPersonDocBytes,
} from "../personDocStorage.js";
// Task #637 — email own documents via the caller's Outlook mailbox.
import {
  MsAuthError,
  MsGraphError,
  createDraftMessage,
  hasMailDraftScope,
  hasMailSendScope,
  sendMailMessage,
  type MsMailAttachment,
} from "../msGraph.js";
import {
  countWorkingDays,
  computeLeaveBalance,
} from "../../routes/atelier/meSelfServiceRoutes.js";
import {
  isoWeekOf,
  ensureWeekShell,
  recomputeWeekTotals,
  detectSuspiciousFlags,
  entryWire,
  signalWire,
  type PersonRow,
} from "../../routes/atelier/ledgerRoutes.js";
import { convertToUsd } from "../atelier-fx.js";
import {
  resolveCategoryPair,
  policyKeyFor,
} from "../atelier-expense-taxonomy.js";
import {
  lookupMerchantMemory,
  learnMerchantMapping,
} from "../atelier-expense-categorizer.js";
import { evaluateExpense } from "../atelier-expense-policy.js";
// Task #595 — every expense submit surface must notify founders.
import { notifyFoundersOfSubmittedExpense } from "../../routes/atelier/walletRoutes.js";
import { writePersonAndSync } from "../atelier-person-sync";
import type { ToolContext, ToolResult } from "./index.js";
import { resolveEmailRecipients, recipientLabel } from "./email-recipient-resolver.js";
import { rankNearestNames } from "./nearest-suggestions.js";

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO_DATE.test(s);
}

export async function selfWriteAudit(args: {
  subject: SelfSubject;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: args.subject.user.orgId,
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.subject.user.id,
    actorLabel: args.subject.user.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

/** Build the ledger PersonRow shape from the self subject's roster wire. */
function personRowOf(subject: SelfSubject): PersonRow | null {
  const p = subject.person;
  if (!p) return null;
  return {
    id: p.id,
    type: p.workerType as "employee" | "contractor",
    fullName: p.fullName,
    email: p.email,
    userId: p.workerType === "employee" ? subject.user.id : null,
  };
}

export const NO_ROSTER: ToolResult = {
  ok: false,
  errorCode: "no_roster_record",
  errorMessage:
    "Your login is not linked to an employee or contractor record yet. Ask HR to link your profile.",
};

export type SelfWriteInput = Omit<
  CapabilityInput,
  "isWrite" | "outboundChannel" | "run" | "schemaVersion"
> & {
  runSelf: (
    input: Record<string, unknown>,
    subject: SelfSubject,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};

/**
 * Identity-locked WRITE capability pattern (Task #583). Input schemas
 * carry only the write's own fields — never a person/user selector —
 * and the subject is always re-resolved from the session persona.
 */
const audit = selfWriteAudit;

export function defineSelfWriteCapability(entry: SelfWriteInput): void {
  const { runSelf, ...rest } = entry;
  defineCapability({
    ...rest,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    isWrite: true,
    outboundChannel: null,
    async run(input, ctx) {
      const subject = await resolveSelfSubject(ctx);
      if (!subject) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: "Your login could not be resolved to a user record.",
        };
      }
      return runSelf((input ?? {}) as Record<string, unknown>, subject, ctx);
    },
  });
}

// ---------------------------------------------------------------------
// me.leave_request — request leave (mirrors POST /me/leave)
// ---------------------------------------------------------------------
const LEAVE_TYPES = new Set(["annual", "sick", "unpaid", "other"]);

defineSelfWriteCapability({
  id: "me.leave_request",
  module: "roster",
  toolName: "request_leave",
  description:
    "Submit a leave request for the signed-in user only (annual, sick, unpaid, or other). Validates working days, annual balance, and overlaps exactly like the Me page.",
  slashAliases: { en: ["/request-leave"], fr: ["/demander-conge"] },
  representativePrompts: {
    en: ["Request annual leave next Monday to Wednesday", "Book 2 sick days"],
    ar: ["أريد طلب إجازة سنوية"],
    fr: ["Demander un congé annuel"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Request annual leave from 2026-08-03 to 2026-08-05"],
    ar: ["أريد طلب إجازة سنوية"],
    fr: ["Demander un congé annuel"],
  },
  inputSchema: {
    type: "object",
    properties: {
      leaveType: { type: "string", enum: ["annual", "sick", "unpaid", "other"] },
      startDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      endDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      note: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["leaveType", "startDate", "endDate"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    const leaveType = String(input.leaveType ?? "");
    if (!LEAVE_TYPES.has(leaveType)) {
      return {
        ok: false,
        errorCode: "invalid_leave_type",
        errorMessage: `Leave type must be one of: ${[...LEAVE_TYPES].join(", ")}.`,
      };
    }
    const startDate = input.startDate;
    const endDate = input.endDate;
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) {
      return {
        ok: false,
        errorCode: "invalid_date_range",
        errorMessage: "Provide a valid ISO date range (start on or before end).",
      };
    }
    const workingDays = countWorkingDays(startDate, endDate);
    if (workingDays <= 0) {
      return {
        ok: false,
        errorCode: "no_working_days",
        errorMessage: "That range contains no Mon–Fri working days.",
      };
    }
    // Balance guard for annual leave only — mirrors the REST route.
    if (leaveType === "annual") {
      const year = Number(startDate.slice(0, 4));
      const bal = await computeLeaveBalance(subject.user.orgId, person.id, year);
      if (workingDays > bal.remainingAnnual - bal.pendingAnnual) {
        return {
          ok: false,
          errorCode: "insufficient_balance",
          errorMessage: `Request of ${workingDays}d exceeds your remaining annual balance (${bal.remainingAnnual}d remaining, ${bal.pendingAnnual}d already pending).`,
        };
      }
    }
    // Overlap guard against own pending/approved requests.
    const existing = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, subject.user.orgId),
          eq(atelierLeaveRequests.personId, person.id),
          inArray(atelierLeaveRequests.status, ["pending", "approved"]),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      );
    if (existing.some((r) => r.startDate <= endDate && startDate <= r.endDate)) {
      return {
        ok: false,
        errorCode: "overlapping_request",
        errorMessage:
          "You already have a pending or approved leave request overlapping those dates.",
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { leaveType, startDate, endDate, workingDays } },
        confirmation: {
          summary: `Request ${workingDays} working day(s) of ${leaveType} leave, ${startDate} → ${endDate}?`,
          diff: {
            create: {
              table: "atelier_leave_requests",
              values: { leaveType, startDate, endDate, workingDays },
            },
          },
          pending: { tool: "request_leave", input: { ...input, confirm: true } },
        },
      };
    }
    const id = rid("leave");
    await db.insert(atelierLeaveRequests).values({
      id,
      orgId: subject.user.orgId,
      userId: subject.user.id,
      personId: person.id,
      personType: person.workerType,
      leaveType,
      startDate,
      endDate,
      workingDays,
      note: typeof input.note === "string" ? input.note.slice(0, 2000) : null,
      status: "pending",
    });
    await audit({
      subject,
      entityType: "leave_request",
      entityId: id,
      action: "leave.request",
      payload: { leaveType, startDate, endDate, workingDays, via: "chat" },
      summary: `${subject.user.name} requested ${workingDays}d ${leaveType} leave (${startDate} → ${endDate})`,
    });
    return {
      ok: true,
      data: {
        id,
        label: `${leaveType} leave ${startDate} → ${endDate}`,
        status: "pending",
        workingDays,
        href: "/me/leave",
        navigateTo: { path: "/me/leave", when: "on_commit" as const },
        note: "Your request is pending approval.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.expense_create — draft an expense (mirrors POST /me/expenses)
// ---------------------------------------------------------------------

/**
 * Task #743 — tolerant amount parsing for clarification answers. The
 * clarification resolver merges the user's raw reply into the asked
 * field, so `amount` can arrive as "120 dollars" / "45 AED" / "1,200".
 * Extracts the numeric value plus an optional 3-letter currency code.
 */
const EXPENSE_ANSWER_CURRENCIES = new Set(["USD", "AED", "SAR", "EUR", "GBP", "TRY"]);
function parseExpenseAmountAnswer(raw: unknown): {
  amount: number | null;
  currency: string | null;
} {
  if (typeof raw === "number") return { amount: raw, currency: null };
  if (typeof raw !== "string") return { amount: null, currency: null };
  const s = raw.trim().replace(/dollars?|bucks?/gi, "USD");
  if (!s) return { amount: null, currency: null };
  let currency: string | null = null;
  for (const m of s.matchAll(/\b([A-Za-z]{3})\b/g)) {
    const code = m[1]!.toUpperCase();
    if (EXPENSE_ANSWER_CURRENCIES.has(code)) {
      currency = code;
      break;
    }
  }
  const num = /-?\d+(?:[.,]\d+)?/.exec(s.replace(/,(?=\d{3}\b)/g, ""));
  if (!num) return { amount: null, currency };
  return { amount: Number(num[0].replace(",", ".")), currency };
}

defineSelfWriteCapability({
  id: "me.expense_create",
  module: "roster",
  toolName: "create_my_expense",
  description:
    "Draft a personal expense claim for the signed-in user only. Optionally attach a receipt already uploaded in this chat via its attachment id. The claim is saved as a draft; submit it from the Me page.",
  slashAliases: { en: ["/new-expense"], fr: ["/nouvelle-depense"] },
  representativePrompts: {
    en: ["Log a 45 dollar taxi expense from yesterday", "Add this receipt as an expense"],
    ar: ["سجل مصروف تاكسي"],
    fr: ["Ajouter une dépense de taxi"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Log a 45 USD taxi expense for yesterday"],
    ar: ["سجل مصروف تاكسي"],
    fr: ["Ajouter une dépense de taxi"],
  },
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "number" },
      currency: { type: "string", description: "3-letter code, default USD" },
      merchant: { type: "string" },
      expenseDate: { type: "string", description: "ISO date, default today" },
      description: { type: "string" },
      contextType: {
        type: "string",
        enum: ["bd", "internal"],
        description: "Spend context — business development (default) or internal.",
      },
      internalProjectLabel: { type: "string" },
      entityId: {
        type: "string",
        description:
          "For internal spend: legal-entity id to attribute the cost to (pre-formation entities are valid targets).",
      },
      receiptAttachmentId: {
        type: "string",
        description: "Attachment id of a receipt uploaded in this chat.",
      },
      confirm: { type: "boolean" },
    },
    required: ["amount", "merchant"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject, ctx) {
    // Task #743 — a MISSING or unparseable amount degrades to a
    // clarification (never a dead-end tool error): the resolver merges
    // the user's next reply into `amount`, which can be free text.
    const parsed = parseExpenseAmountAnswer(input.amount);
    if (parsed.amount == null) {
      const partial: Record<string, unknown> = {};
      for (const k of [
        "currency",
        "merchant",
        "expenseDate",
        "description",
        "contextType",
        "internalProjectLabel",
        "receiptAttachmentId",
      ] as const) {
        const v = input[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") partial[k] = v;
      }
      const rawTyped = typeof input.amount === "string" ? input.amount.trim() : "";
      const today = new Date().toISOString().slice(0, 10);
      return {
        ok: true,
        data: { partial },
        clarification: {
          field: "amount",
          question: rawTyped
            ? `Sorry, I couldn't read "${rawTyped}" as an amount — how much was it? (e.g. "120" or "45 AED")`
            : 'How much was this expense? (e.g. "120" or "45 AED" — the date defaults to today unless you pick one.)',
          tool: "create_my_expense",
          partial,
          fields: [
            { field: "amount", label: "Amount", hint: 'e.g. "120" or "45 AED"' },
            { field: "expenseDate", label: "Date", inputType: "date", defaultValue: today },
          ],
        },
      };
    }
    const amount = parsed.amount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return {
        ok: false,
        errorCode: "invalid_amount",
        errorMessage: "Amount must be a positive number up to 1,000,000.",
      };
    }
    const merchant = String(input.merchant ?? "").trim().slice(0, 200);
    if (!merchant) {
      return { ok: false, errorCode: "merchant_required", errorMessage: "Merchant is required." };
    }
    const dateStr = isIsoDate(input.expenseDate)
      ? input.expenseDate
      : new Date().toISOString().slice(0, 10);
    const currency = String(input.currency ?? parsed.currency ?? "USD")
      .toUpperCase()
      .slice(0, 3);
    const contextType = input.contextType === "internal" ? "internal" : "bd";
    const internalProjectLabel =
      contextType === "internal" && typeof input.internalProjectLabel === "string"
        ? input.internalProjectLabel.slice(0, 200)
        : null;
    // Task #1092 — optional internal entity attribution, same ACL as the
    // web surface: any non-archived org entity, including in_formation
    // (pre-formation cost pools).
    let entityId: string | null = null;
    if (contextType === "internal" && typeof input.entityId === "string" && input.entityId.trim()) {
      const [ent] = await db
        .select({
          id: atelierLegalEntities.id,
          status: atelierLegalEntities.status,
          formation: atelierLegalEntities.formation,
        })
        .from(atelierLegalEntities)
        .where(and(
          eq(atelierLegalEntities.id, input.entityId.trim()),
          eq(atelierLegalEntities.orgId, ctx.persona.orgId),
        ));
      if (!ent || ent.status === "archived") {
        return {
          ok: false,
          errorCode: "entity_not_found",
          errorMessage: "That legal entity was not found (or is archived).",
        };
      }
      // Same guard as the REST attribution resolver: a settled
      // pre-formation pool is closed for new costs.
      if (ent.status === "in_formation" && ent.formation?.settlement) {
        return {
          ok: false,
          errorCode: "entity_pool_settled",
          errorMessage:
            "That entity's pre-formation cost pool has already been settled — new costs can no longer be tagged to it.",
        };
      }
      entityId = ent.id;
    }

    // Receipt attachment — must belong to THIS caller (uploader) and org.
    let receiptFileRef: string | null = null;
    let receiptFileName: string | null = null;
    if (input.receiptAttachmentId) {
      const loaded = await loadAttachment(
        String(input.receiptAttachmentId),
        ctx.persona.orgId,
      );
      if (
        !loaded ||
        loaded.attachment.deletedAt ||
        loaded.attachment.userId !== ctx.persona.id
      ) {
        return {
          ok: false,
          errorCode: "receipt_not_found",
          errorMessage:
            "That receipt attachment was not found among your own uploads in this chat.",
        };
      }
      receiptFileRef = loaded.attachment.encryptedRef;
      receiptFileName = loaded.attachment.fileName;
    }

    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            merchant,
            amount,
            currency,
            expenseDate: dateStr,
            contextType,
            receipt: receiptFileName,
          },
        },
        confirmation: {
          summary: `Draft an expense: ${merchant}, ${currency} ${amount.toFixed(2)} on ${dateStr}${receiptFileName ? ` (receipt: ${receiptFileName})` : ""}?`,
          diff: {
            create: {
              table: "atelier_expenses",
              values: { merchant, amount, currency, expenseDate: dateStr, contextType },
            },
          },
          pending: { tool: "create_my_expense", input: { ...input, confirm: true } },
        },
      };
    }

    const fx = await convertToUsd(amount, currency, dateStr);
    // Org-wide merchant memory (instant, deterministic) — mirrors REST;
    // AI suggestions stay on the Me page suggest endpoint.
    const extras: Record<string, unknown> = {};
    const suggestion = await lookupMerchantMemory(merchant, subject.user.orgId);
    if (suggestion) {
      const pair = await resolveCategoryPair(
        suggestion.categoryCode,
        suggestion.subCategoryCode,
      );
      if (pair) {
        extras.categoryCode = pair.category.code;
        extras.subCategoryCode = pair.sub.code;
        extras.category = policyKeyFor(pair.sub);
        extras.categorySource = "merchant_memory";
      }
    }
    const id = rid("exp");
    await db.insert(atelierExpenses).values({
      id,
      personId: subject.user.id,
      personType: subject.user.role === "contractor" ? "contractor" : "employee",
      engagementId: null,
      expenseDate: dateStr,
      captureSource: "manual",
      merchant,
      description:
        typeof input.description === "string" ? input.description.slice(0, 2000) : null,
      ...extras,
      category: (extras.category as string | undefined) ?? "other",
      amount,
      currency,
      fxRate: fx.rate,
      fxRateDate: fx.rateDate,
      usdAmount: +fx.usdAmount.toFixed(2),
      contextType,
      accountId: null,
      internalProjectLabel,
      entityId,
      receiptFileRef,
      receiptEncryptedAtRest: !!receiptFileRef,
      summary:
        (typeof input.description === "string" && input.description) || merchant,
      status: "draft",
      policyStatus: "green",
      createdByUserId: subject.user.id,
    });
    // Task #1095 — prefill the entity allocation (fail-soft).
    await proposeExpenseAllocation(id, { allowAi: false, actorId: subject.user.id }).catch(() => null);
    await audit({
      subject,
      entityType: "expense",
      entityId: id,
      action: "expense.create",
      payload: { amount, currency, contextType, via: "chat" },
      summary: `${subject.user.name} drafted expense ${merchant} (${currency} ${amount.toFixed(2)})`,
    });
    return {
      ok: true,
      data: {
        id,
        label: `${merchant} — ${currency} ${amount.toFixed(2)}`,
        status: "draft",
        expenseDate: dateStr,
        hasReceipt: !!receiptFileRef,
        href: "/me/expenses",
        navigateTo: { path: "/me/expenses", when: "on_commit" as const },
        note: "Saved as a draft — submit it from your expenses page when ready.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// Task #787 — shared resolver: pick ONE of the caller's own draft
// expenses from an explicit id, merchant/description text (q), or
// implicitly (single draft). Never enumerates anyone else's rows — the
// pool passed in is already self-scoped.
// ---------------------------------------------------------------------
type ExpenseDraftRow = {
  id: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  currency: string;
  expenseDate: string;
  status: string;
};

function expenseOption(d: ExpenseDraftRow) {
  return {
    id: d.id,
    label: `${d.merchant ?? d.description ?? "Expense"} — ${d.currency} ${d.amount.toFixed(2)}`,
    secondary: `${d.expenseDate}${d.status === "rejected" ? " · rejected (resubmittable)" : ""}`,
  };
}

const foldExpenseText = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();

export function resolveOwnExpenseDraft<T extends ExpenseDraftRow>(
  drafts: T[],
  input: Record<string, unknown>,
):
  | { outcome: "match"; row: T }
  | { outcome: "no_drafts" }
  | { outcome: "not_found"; prompt: string; options: ReturnType<typeof expenseOption>[] }
  | { outcome: "ambiguous"; prompt: string; options: ReturnType<typeof expenseOption>[] } {
  const expenseId = typeof input.expenseId === "string" ? input.expenseId.trim() : "";
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (expenseId) {
    const row = drafts.find((d) => d.id === expenseId);
    if (row) return { outcome: "match", row };
    // Unknown id — offer the caller's own drafts (recency-ordered).
    return {
      outcome: "not_found",
      prompt:
        "I couldn't find that draft among your own expense claims — did you mean one of these?",
      options: drafts.slice(0, 6).map(expenseOption),
    };
  }
  if (drafts.length === 0) return { outcome: "no_drafts" };
  if (q) {
    const nq = foldExpenseText(q);
    const matches = drafts.filter((d) =>
      foldExpenseText(`${d.merchant ?? ""} ${d.description ?? ""}`).includes(nq),
    );
    if (matches.length === 1) return { outcome: "match", row: matches[0]! };
    if (matches.length > 1) {
      // Rank closest merchant text first; drafts are already newest-first,
      // so equal-distance candidates keep recency order (stable sort).
      const ranked = rankNearestNames(
        q,
        matches.map((d) => ({ id: d.id, label: d.merchant ?? d.description ?? d.id })),
        matches.length,
      );
      const order = new Map(ranked.map((r, idx) => [r.id, idx]));
      const sorted = [...matches].sort(
        (a, b) =>
          (order.has(a.id) ? order.get(a.id)! : Number.MAX_SAFE_INTEGER) -
          (order.has(b.id) ? order.get(b.id)! : Number.MAX_SAFE_INTEGER),
      );
      return {
        outcome: "ambiguous",
        prompt: `You have ${matches.length} drafts matching "${q}" — which one?`,
        options: sorted.slice(0, 6).map(expenseOption),
      };
    }
    // No text match — nearest-merchant candidates from the own-draft pool.
    const near = rankNearestNames(
      q,
      drafts.map((d) => ({ id: d.id, label: d.merchant ?? d.description ?? d.id })),
      6,
    );
    const nearIds = new Set(near.map((r) => r.id));
    const options = drafts.filter((d) => nearIds.has(d.id)).map(expenseOption);
    return {
      outcome: "not_found",
      prompt: `None of your drafts mention "${q}" — did you mean one of these?`,
      options,
    };
  }
  if (drafts.length === 1) return { outcome: "match", row: drafts[0]! };
  return {
    outcome: "ambiguous",
    prompt: `You have ${drafts.length} draft claims — which one should I submit?`,
    options: drafts.slice(0, 6).map(expenseOption),
  };
}

// ---------------------------------------------------------------------
// me.expense_submit — submit own draft expense for approval
// (mirrors POST /me/expenses/:id/submit — Task #595). Same gates as the
// REST route: attribution completeness for internal spend, deterministic
// policy evaluation (red block / amber rationale), merchant-memory
// learning on submit, submitter self-notification AND founder
// notifications (standing rule: every submit surface notifies founders).
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.expense_submit",
  module: "roster",
  toolName: "submit_my_expense",
  description:
    "Submit one of the signed-in user's own draft expense claims for approval. Accepts an expense id OR merchant/description text via q (\"submit my Uber expense\"); with neither, a single existing draft is submitted and several drafts come back as choices. Runs the same policy checks as the Me page: internal spend needs entity + cost center, policy RED blocks, and AMBER warnings need an override rationale.",
  slashAliases: { en: ["/submit-expense"], fr: ["/soumettre-depense"] },
  representativePrompts: {
    en: ["Submit my expense claim", "Send my taxi expense for approval"],
    ar: ["أرسل مطالبة المصروفات"],
    fr: ["Soumettre ma note de frais"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Submit my draft expense for approval"],
    ar: ["أرسل مطالبة المصروفات"],
    fr: ["Soumettre ma note de frais"],
  },
  inputSchema: {
    type: "object",
    properties: {
      expenseId: {
        type: "string",
        description:
          "Id of the caller's own draft expense (optional when they have exactly one draft).",
      },
      q: {
        type: "string",
        description:
          'Merchant or description text to pick the draft ("my Uber expense") when the id is unknown.',
      },
      overrideRationale: {
        type: "string",
        description:
          "Required only when policy raises an AMBER warning — a short business rationale for the override.",
      },
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    // Resolve the caller's OWN draft/rejected expense — never anyone else's.
    const drafts = await db
      .select()
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.personId, subject.user.id),
          inArray(atelierExpenses.status, ["draft", "rejected"]),
          isNull(atelierExpenses.deletedAt),
        ),
      )
      .orderBy(desc(atelierExpenses.createdAt));
    // Task #787 — resolve the target draft by id, by merchant/description
    // text (q), or implicitly. Ambiguity and misses come back as ranked
    // candidates / friendly copy, never raw error codes. Pool is strictly
    // the caller's own drafts, so candidates cannot leak anything.
    const resolved = resolveOwnExpenseDraft(drafts, input);
    if (resolved.outcome === "no_drafts") {
      return {
        ok: false,
        errorCode: "no_draft_expense",
        errorMessage:
          'You have no draft expense claims to submit right now. To start one, tell me the amount and merchant — e.g. "log a 45 AED taxi expense from yesterday" — then I can submit it.',
      };
    }
    if (resolved.outcome === "not_found") {
      if (resolved.options.length > 0) {
        return {
          ok: true,
          data: {
            prompt: resolved.prompt,
            options: resolved.options,
            navigateTo: null,
          },
          disambiguation: { kind: "expense", field: "expenseId", options: resolved.options },
        };
      }
      return {
        ok: false,
        errorCode: "expense_not_found",
        errorMessage:
          "I couldn't find that draft among your own expense claims — it may already be submitted. Say \"show my expenses\" to check its status.",
      };
    }
    if (resolved.outcome === "ambiguous") {
      return {
        ok: true,
        data: {
          prompt: resolved.prompt,
          options: resolved.options,
          navigateTo: null,
        },
        disambiguation: { kind: "expense", field: "expenseId", options: resolved.options },
      };
    }
    const row = resolved.row;

    // Attribution completeness — internal spend must carry entity + cost
    // center before entering the approval flow (mirrors the REST 409).
    if (row.contextType === "internal" && (!row.entityId || !row.costCenter)) {
      return {
        ok: false,
        errorCode: "attribution_incomplete",
        errorMessage:
          "Internal expenses need a legal entity and a cost center before submitting — complete them on your expenses page first.",
      };
    }

    // Deterministic policy evaluation — identical inputs to the REST route.
    const policy = await evaluateExpense({
      orgId: row.orgId,
      category: row.category,
      usdAmount: row.usdAmount,
      amount: row.amount,
      currency: row.currency,
      country: row.vatCountry ?? null,
      role: subject.user.role,
      flightClass: null,
    });
    const overrideRationale =
      typeof input.overrideRationale === "string"
        ? input.overrideRationale.slice(0, 2000)
        : null;
    if (policy.status === "red") {
      await db
        .update(atelierExpenses)
        .set({ policyStatus: "red", policyFindings: policy.findings, updatedAt: new Date() })
        .where(eq(atelierExpenses.id, row.id));
      return {
        ok: false,
        errorCode: "policy_red_block",
        errorMessage: `Policy blocks this claim: ${policy.findings
          .filter((f) => f.severity === "red")
          .map((f) => f.message)
          .join("; ")}`,
      };
    }
    if (policy.status === "amber" && !overrideRationale) {
      await db
        .update(atelierExpenses)
        .set({ policyStatus: "amber", policyFindings: policy.findings, updatedAt: new Date() })
        .where(eq(atelierExpenses.id, row.id));
      return {
        ok: false,
        errorCode: "amber_requires_rationale",
        errorMessage: `Policy AMBER warning — resubmit with an override rationale. Findings: ${policy.findings
          .map((f) => f.message)
          .join("; ")}`,
      };
    }

    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            expenseId: row.id,
            merchant: row.merchant,
            amount: row.amount,
            currency: row.currency,
            expenseDate: row.expenseDate,
            policyStatus: policy.status,
          },
        },
        confirmation: {
          summary: `Submit expense ${row.merchant ?? row.id} (${row.currency} ${row.amount.toFixed(2)}, ${row.expenseDate}) for approval?${policy.status === "amber" ? " Policy AMBER warning will be overridden with your rationale." : ""}`,
          diff: {
            update: {
              table: "atelier_expenses",
              values: { status: "submitted", policyStatus: policy.status },
            },
          },
          pending: {
            tool: "submit_my_expense",
            input: { ...input, expenseId: row.id, confirm: true },
          },
        },
      };
    }

    const [updated] = await db
      .update(atelierExpenses)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        policyStatus: policy.status,
        policyFindings: policy.findings,
        overrideRationale,
        rejectedAt: null,
        rejectedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierExpenses.id, row.id))
      .returning();
    await audit({
      subject,
      entityType: "expense",
      entityId: row.id,
      action: "expense.submit",
      payload: { policyStatus: policy.status, via: "chat", override: !!overrideRationale },
      summary: `${subject.user.name} submitted claim ${row.merchant ?? row.id} from chat`,
    });
    // A submitted category pair is a CONFIRMED choice — feed the org-wide
    // merchant memory (mirrors the REST submit).
    if (row.merchant && updated.categoryCode && updated.subCategoryCode) {
      await learnMerchantMapping({
        merchant: row.merchant,
        categoryCode: updated.categoryCode,
        subCategoryCode: updated.subCategoryCode,
        userId: subject.user.id,
        orgId: subject.user.orgId,
      });
    }
    await emitSelfNotification({
      orgId: subject.user.orgId,
      userId: subject.user.id,
      kind: "expense_submitted",
      title: `Expense claim submitted`,
      body: `${row.merchant} — ${row.currency} ${row.amount.toFixed(2)} is with the approvers.`,
      href: "/me",
    });
    // Standing rule — every submitted claim lands in both founders' queues.
    await notifyFoundersOfSubmittedExpense(updated);
    return {
      ok: true,
      data: {
        id: row.id,
        label: `${row.merchant ?? "Expense"} — ${row.currency} ${row.amount.toFixed(2)}`,
        status: "submitted",
        policyStatus: policy.status,
        href: "/me/expenses",
        navigateTo: { path: "/me/expenses", when: "on_commit" as const },
        note: "Your claim is now with the approvers.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// Task #788 — resolve an engagement/account NAME for time logging.
// Matching happens server-side (fold-based) against org-scoped live
// engagements + their account names; ambiguity comes back ranked.
// ---------------------------------------------------------------------
type EngagementCandidate = { id: string; label: string; accountName: string | null };

export async function resolveEngagementForTimeLog(
  input: Record<string, unknown>,
  orgId: string,
): Promise<
  | { outcome: "match"; engagement: EngagementCandidate | null }
  | { outcome: "not_found"; message: string }
  | {
      outcome: "ambiguous";
      prompt: string;
      options: Array<{ id: string; label: string; secondary?: string }>;
    }
> {
  const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();
  const engagementId =
    typeof input.engagementId === "string" && input.engagementId.trim() !== ""
      ? input.engagementId.trim()
      : "";
  const q = typeof input.engagement === "string" ? input.engagement.trim() : "";
  if (!engagementId && !q) return { outcome: "match", engagement: null };

  const rows = await db
    .select({
      id: atelierEngagements.id,
      name: atelierEngagements.name,
      accountName: atelierAccounts.name,
    })
    .from(atelierEngagements)
    // Join constrained to the SAME org's live accounts — a malformed
    // cross-tenant accountId must never surface a foreign account name.
    .leftJoin(
      atelierAccounts,
      and(
        eq(atelierEngagements.accountId, atelierAccounts.id),
        eq(atelierAccounts.orgId, orgId),
        isNull(atelierAccounts.deletedAt),
      ),
    )
    .where(
      and(
        eq(atelierEngagements.orgId, orgId),
        isNull(atelierEngagements.deletedAt),
        // Live = not closed; closed work must never take new billable time.
        ne(atelierEngagements.plmStage, "closed"),
      ),
    );
  const pool: EngagementCandidate[] = rows.map((r) => ({
    id: r.id,
    label: r.name,
    accountName: r.accountName ?? null,
  }));

  if (engagementId) {
    const hit = pool.find((e) => e.id === engagementId);
    if (hit) return { outcome: "match", engagement: hit };
    return {
      outcome: "not_found",
      message: `That engagement id doesn't match any live engagement. Tell me the engagement or client name instead — e.g. "log 3h on the <client> engagement".`,
    };
  }

  const nq = fold(q);
  const matches = pool.filter(
    (e) => fold(e.label).includes(nq) || (e.accountName ? fold(e.accountName).includes(nq) : false),
  );
  if (matches.length === 1) return { outcome: "match", engagement: matches[0] };

  const toOptions = (list: EngagementCandidate[]) => {
    // Rank against BOTH the engagement name and its client/account name —
    // "the Tasama work" must surface an engagement whose title never
    // mentions Tasama. Each engagement contributes one entry per name;
    // dedupe keeps the best-ranked position.
    const ranked = rankNearestNames(
      q,
      list.flatMap((e) => [
        { id: e.id, label: e.label },
        ...(e.accountName ? [{ id: e.id, label: e.accountName }] : []),
      ]),
      10,
    );
    const byId = new Map(list.map((e) => [e.id, e]));
    const seen = new Set<string>();
    const out: Array<{ id: string; label: string; secondary?: string }> = [];
    for (const r of ranked) {
      if (seen.has(r.id)) continue;
      const e = byId.get(r.id);
      if (!e) continue;
      seen.add(r.id);
      out.push({ id: e.id, label: e.label, secondary: e.accountName ?? undefined });
      if (out.length >= 5) break;
    }
    return out;
  };

  if (matches.length > 1) {
    return {
      outcome: "ambiguous",
      prompt: `Several engagements match "${q}" — which one should the time go against?`,
      options: toOptions(matches),
    };
  }
  if (pool.length > 0) {
    const options = toOptions(pool);
    if (options.length > 0) {
      return {
        outcome: "ambiguous",
        prompt: `No engagement matches "${q}" exactly — did you mean one of these?`,
        options,
      };
    }
    // Nothing even close — name what actually exists instead of a bare miss.
    const sample = pool.slice(0, 5).map((e) => e.label).join(", ");
    return {
      outcome: "not_found",
      message: `No engagement or client matches "${q}". Live engagements include: ${sample}. Use one of those names, or leave the engagement off to log internal time.`,
    };
  }
  return {
    outcome: "not_found",
    message: `No engagement matches "${q}" and there are no live engagements to pick from. Leave the engagement off to log internal time, e.g. "log 3h internal for today".`,
  };
}

// ---------------------------------------------------------------------
// me.timesheet_log — add a timesheet entry (mirrors POST week entries)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.timesheet_log",
  module: "roster",
  toolName: "log_my_time",
  description:
    "Log hours on the signed-in user's own timesheet for a given date, optionally against an engagement or client name (\"log 3h on the Tasama engagement last Tuesday\") — the server resolves the name and asks when it's ambiguous. The ISO week is derived server-side from the date; locked (submitted/approved) weeks are refused.",
  slashAliases: { en: ["/log-time"], fr: ["/saisir-temps"] },
  representativePrompts: {
    en: ["Log 6 hours for yesterday", "Add 8h internal work for Monday"],
    ar: ["سجل ٦ ساعات عمل"],
    fr: ["Saisir 6 heures hier"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Log 6 hours for 2026-07-21"],
    ar: ["سجل ٦ ساعات عمل"],
    fr: ["Saisir 6 heures hier"],
  },
  inputSchema: {
    type: "object",
    properties: {
      workDate: { type: "string", description: "ISO date YYYY-MM-DD" },
      hours: { type: "number" },
      narrative: { type: "string" },
      engagement: {
        type: "string",
        description:
          "Optional engagement or client/account name to log against (e.g. \"the Tasama engagement\"). The server resolves it; ambiguous names come back as choices.",
      },
      engagementId: { type: "string", description: "Exact engagement id, if already known." },
      confirm: { type: "boolean" },
    },
    required: ["workDate", "hours"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = personRowOf(subject);
    if (!person) return NO_ROSTER;
    const workDate = input.workDate;
    const hours = Number(input.hours);
    if (!isIsoDate(workDate) || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return {
        ok: false,
        errorCode: "invalid_body",
        errorMessage: "Provide a valid ISO date and hours between 0 and 24.",
      };
    }
    // Task #788 — engagement/account name resolution, server-side.
    const engagementResolved = await resolveEngagementForTimeLog(input, subject.user.orgId);
    if (engagementResolved.outcome === "not_found") {
      return {
        ok: false,
        errorCode: "engagement_not_found",
        errorMessage: engagementResolved.message,
      };
    }
    if (engagementResolved.outcome === "ambiguous") {
      return {
        ok: true,
        data: {
          navigateTo: null,
          prompt: engagementResolved.prompt,
        },
        disambiguation: {
          kind: "engagement",
          field: "engagementId",
          options: engagementResolved.options,
        },
      };
    }
    const engagement = engagementResolved.engagement; // null = internal time
    const { weekIso } = isoWeekOf(new Date(`${workDate}T00:00:00Z`));
    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            workDate,
            hours,
            weekIso,
            engagementId: engagement?.id ?? null,
            engagementName: engagement?.label ?? null,
          },
        },
        confirmation: {
          summary: engagement
            ? `Log ${hours}h on ${workDate} (week ${weekIso}) against ${engagement.label}?`
            : `Log ${hours}h on ${workDate} (week ${weekIso}) to your timesheet?`,
          diff: {
            create: {
              table: "atelier_timesheet_entries",
              values: {
                workDate,
                hours,
                weekIso,
                ...(engagement ? { engagementId: engagement.id } : {}),
              },
            },
          },
          pending: {
            tool: "log_my_time",
            input: {
              ...input,
              ...(engagement ? { engagementId: engagement.id, engagement: undefined } : {}),
              confirm: true,
            },
          },
        },
      };
    }
    const week = await ensureWeekShell(person, weekIso);
    if (week.status !== "draft" && week.status !== "rejected") {
      return {
        ok: false,
        errorCode: "week_locked",
        errorMessage: `Week ${weekIso} is ${week.status} and can no longer be edited.`,
      };
    }
    const id = rid("tse");
    await db.insert(atelierTimesheetEntries).values({
      id,
      weekId: week.id,
      personId: week.personId,
      personType: week.personType,
      workDate,
      engagementId: engagement?.id ?? null,
      activityCode: engagement ? "billable" : "internal",
      hours,
      billable: !!engagement,
      narrative:
        typeof input.narrative === "string" ? input.narrative.slice(0, 2000) : null,
      source: "human",
      status: "draft",
      createdByUserId: subject.user.id,
    });
    const totals = await recomputeWeekTotals(week.id);
    return {
      ok: true,
      data: {
        id,
        label: engagement
          ? `${hours}h on ${workDate} — ${engagement.label}`
          : `${hours}h on ${workDate}`,
        weekIso,
        weekTotalHours: totals?.totalHours ?? null,
        href: "/me/timesheets",
        navigateTo: { path: "/me/timesheets", when: "on_commit" as const },
        note: "Entry saved to your draft week.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// Task #802 — shared resolver: pick ONE of the caller's own DRAFT
// timesheet entries (in a draft/rejected week) from an explicit id, or
// from a description: work date + optional engagement/client name,
// activity code, and/or the hours currently on the entry ("the 3h I
// logged on Tasama yesterday"). The pool is strictly self-scoped —
// candidates can never leak anyone else's time.
// ---------------------------------------------------------------------
export type OwnTimesheetEntryRow = {
  id: string;
  workDate: string;
  hours: number;
  activityCode: string;
  narrative: string | null;
  engagementId: string | null;
  weekId: string;
  weekIso: string;
  engagementLabel: string | null;
  accountName: string | null;
};

function timesheetEntryOption(e: OwnTimesheetEntryRow) {
  return {
    id: e.id,
    label: `${e.hours}h ${e.activityCode}${e.engagementLabel ? ` — ${e.engagementLabel}` : ""}`,
    secondary: `${e.workDate}${e.accountName ? ` · ${e.accountName}` : ""}${e.narrative ? ` · ${e.narrative.slice(0, 60)}` : ""}`,
  };
}

function describeDayEntries(entries: OwnTimesheetEntryRow[]): string {
  return entries
    .slice(0, 6)
    .map((e) => `${e.hours}h ${e.activityCode}${e.engagementLabel ? ` on ${e.engagementLabel}` : ""}`)
    .join(", ");
}

export async function resolveOwnTimesheetEntry(
  input: Record<string, unknown>,
  personId: string,
  orgId: string,
): Promise<
  | { outcome: "match"; entry: OwnTimesheetEntryRow }
  | { outcome: "not_found"; message: string }
  | {
      outcome: "ambiguous";
      prompt: string;
      options: Array<{ id: string; label: string; secondary?: string }>;
    }
> {
  const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();
  const entryId = typeof input.entryId === "string" && input.entryId.trim() !== "" ? input.entryId.trim() : "";
  const workDate = typeof input.workDate === "string" ? input.workDate.trim() : "";
  const engQ = typeof input.engagement === "string" ? input.engagement.trim() : "";
  const actQ = typeof input.activity === "string" ? input.activity.trim() : "";
  const hoursWas =
    input.hoursWas !== undefined && input.hoursWas !== null && String(input.hoursWas).trim() !== ""
      ? Number(input.hoursWas)
      : null;

  if (!entryId && !isIsoDate(workDate)) {
    return {
      outcome: "not_found",
      message:
        'Tell me which day the entry is on (ISO date, e.g. "2026-08-04") — I resolve the entry from the date plus an optional engagement or activity description.',
    };
  }

  // Pool: the caller's own DRAFT entries inside draft/rejected weeks only.
  const rows = await db
    .select({
      id: atelierTimesheetEntries.id,
      workDate: atelierTimesheetEntries.workDate,
      hours: atelierTimesheetEntries.hours,
      activityCode: atelierTimesheetEntries.activityCode,
      narrative: atelierTimesheetEntries.narrative,
      engagementId: atelierTimesheetEntries.engagementId,
      weekId: atelierTimesheetEntries.weekId,
      weekIso: atelierTimesheetWeeks.weekIso,
    })
    .from(atelierTimesheetEntries)
    .innerJoin(atelierTimesheetWeeks, eq(atelierTimesheetEntries.weekId, atelierTimesheetWeeks.id))
    .where(
      and(
        eq(atelierTimesheetEntries.personId, personId),
        eq(atelierTimesheetEntries.status, "draft"),
        isNull(atelierTimesheetEntries.deletedAt),
        inArray(atelierTimesheetWeeks.status, ["draft", "rejected"]),
        ...(entryId
          ? [eq(atelierTimesheetEntries.id, entryId)]
          : [eq(atelierTimesheetEntries.workDate, workDate)]),
      ),
    );

  // Attach engagement/account labels (org-scoped join — a malformed
  // cross-tenant accountId must never surface a foreign account name).
  const engIds = [...new Set(rows.map((r) => r.engagementId).filter((x): x is string => !!x))];
  const engLabels = new Map<string, { name: string; accountName: string | null }>();
  if (engIds.length > 0) {
    const engs = await db
      .select({
        id: atelierEngagements.id,
        name: atelierEngagements.name,
        accountName: atelierAccounts.name,
      })
      .from(atelierEngagements)
      .leftJoin(
        atelierAccounts,
        and(
          eq(atelierEngagements.accountId, atelierAccounts.id),
          eq(atelierAccounts.orgId, orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      )
      .where(and(inArray(atelierEngagements.id, engIds), eq(atelierEngagements.orgId, orgId)));
    for (const e of engs) engLabels.set(e.id, { name: e.name, accountName: e.accountName ?? null });
  }
  const pool: OwnTimesheetEntryRow[] = rows.map((r) => ({
    id: r.id,
    workDate: r.workDate,
    hours: Number(r.hours),
    activityCode: r.activityCode ?? "internal",
    narrative: r.narrative ?? null,
    engagementId: r.engagementId ?? null,
    weekId: r.weekId,
    weekIso: r.weekIso,
    engagementLabel: r.engagementId ? (engLabels.get(r.engagementId)?.name ?? null) : null,
    accountName: r.engagementId ? (engLabels.get(r.engagementId)?.accountName ?? null) : null,
  }));

  if (entryId) {
    const hit = pool.find((e) => e.id === entryId);
    if (hit) return { outcome: "match", entry: hit };
    return {
      outcome: "not_found",
      message:
        "That entry isn't among your own editable (draft-week) timesheet entries — it may be submitted, approved, or someone else's. Say \"show my timesheet\" to check.",
    };
  }

  if (pool.length === 0) {
    return {
      outcome: "not_found",
      message: `You have no editable draft entries on ${workDate}. Entries in submitted or approved weeks can't be changed from chat — say "show my timesheet" to check that week's status.`,
    };
  }

  // Narrow by the optional descriptors.
  let matches = pool;
  if (engQ) {
    const nq = fold(engQ);
    matches = matches.filter(
      (e) =>
        (e.engagementLabel && fold(e.engagementLabel).includes(nq)) ||
        (e.accountName && fold(e.accountName).includes(nq)) ||
        (e.narrative && fold(e.narrative).includes(nq)),
    );
  }
  if (actQ) {
    const na = fold(actQ);
    matches = matches.filter((e) => fold(e.activityCode).includes(na));
  }
  if (hoursWas != null && Number.isFinite(hoursWas)) {
    matches = matches.filter((e) => Math.abs(e.hours - hoursWas) < 0.001);
  }

  if (matches.length === 1) return { outcome: "match", entry: matches[0]! };
  if (matches.length > 1) {
    // Rank closest to the engagement text when one was given; otherwise
    // keep the day's natural order.
    let sorted = matches;
    if (engQ) {
      const ranked = rankNearestNames(
        engQ,
        matches.map((e) => ({ id: e.id, label: e.engagementLabel ?? e.accountName ?? e.activityCode })),
        matches.length,
      );
      const order = new Map(ranked.map((r, idx) => [r.id, idx]));
      sorted = [...matches].sort(
        (a, b) =>
          (order.has(a.id) ? order.get(a.id)! : Number.MAX_SAFE_INTEGER) -
          (order.has(b.id) ? order.get(b.id)! : Number.MAX_SAFE_INTEGER),
      );
    }
    return {
      outcome: "ambiguous",
      prompt: `You have ${matches.length} entries on ${workDate} matching that — which one?`,
      options: sorted.slice(0, 6).map(timesheetEntryOption),
    };
  }
  // Zero after narrowing — friendly miss naming that day's actual entries.
  return {
    outcome: "ambiguous",
    prompt: `None of your ${workDate} entries match that description. That day has: ${describeDayEntries(pool)} — which one did you mean?`,
    options: pool.slice(0, 6).map(timesheetEntryOption),
  };
}

// ---------------------------------------------------------------------
// me.timesheet_update — fix one of the caller's own entries by
// describing it (Task #802). Mirrors PATCH entry: draft entry in a
// draft/rejected week only; week totals recomputed after the change.
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.timesheet_update",
  module: "roster",
  toolName: "update_my_time",
  description:
    "Fix one of the signed-in user's own logged time entries by describing it — a work date plus an optional engagement/client name, activity, or the hours currently on it (\"change my Tuesday hours from 4 to 6\"). The server resolves the entry; several matches come back as choices. Only draft entries in draft/rejected weeks can change.",
  slashAliases: { en: ["/fix-time"], fr: ["/corriger-temps"] },
  representativePrompts: {
    en: ["Change my Tuesday hours from 4 to 6", "Fix yesterday's Tasama entry to 5 hours"],
    ar: ["عدل ساعات يوم الثلاثاء"],
    fr: ["Corriger mes heures de mardi"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Change my 2026-08-04 hours from 4 to 6"],
    ar: ["عدل ساعات يوم الثلاثاء"],
    fr: ["Corriger mes heures de mardi"],
  },
  inputSchema: {
    type: "object",
    properties: {
      workDate: { type: "string", description: "ISO date YYYY-MM-DD of the entry to fix." },
      engagement: {
        type: "string",
        description: "Optional engagement or client name that identifies the entry.",
      },
      activity: {
        type: "string",
        description: "Optional activity descriptor (billable, internal, training, bench, leave).",
      },
      hoursWas: { type: "number", description: "Hours currently on the entry, if the user said them." },
      entryId: { type: "string", description: "Exact entry id, if already known." },
      hours: { type: "number", description: "New hours value." },
      narrative: { type: "string", description: "New narrative text." },
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = personRowOf(subject);
    if (!person) return NO_ROSTER;
    const hasHours = input.hours !== undefined && input.hours !== null;
    const hasNarrative = typeof input.narrative === "string";
    if (!hasHours && !hasNarrative) {
      return {
        ok: false,
        errorCode: "nothing_to_change",
        errorMessage: 'Tell me what to change — the new hours ("make it 6 hours") or the new note.',
      };
    }
    let hours: number | null = null;
    if (hasHours) {
      hours = Number(input.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        return {
          ok: false,
          errorCode: "invalid_hours",
          errorMessage: "New hours must be a number between 0 and 24 — nothing was changed.",
        };
      }
    }
    const resolved = await resolveOwnTimesheetEntry(input, person.id, subject.user.orgId);
    if (resolved.outcome === "not_found") {
      return { ok: false, errorCode: "entry_not_found", errorMessage: resolved.message };
    }
    if (resolved.outcome === "ambiguous") {
      return {
        ok: true,
        data: { prompt: resolved.prompt, options: resolved.options, navigateTo: null },
        disambiguation: { kind: "timesheet_entry", field: "entryId", options: resolved.options },
      };
    }
    const entry = resolved.entry;
    const label = `${entry.hours}h ${entry.activityCode}${entry.engagementLabel ? ` on ${entry.engagementLabel}` : ""} (${entry.workDate})`;
    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            entryId: entry.id,
            workDate: entry.workDate,
            currentHours: entry.hours,
            ...(hours != null ? { newHours: hours } : {}),
            ...(hasNarrative ? { newNarrative: String(input.narrative).slice(0, 200) } : {}),
          },
        },
        confirmation: {
          summary:
            hours != null
              ? `Change ${label} to ${hours}h?`
              : `Update the note on ${label}?`,
          diff: {
            update: {
              table: "atelier_timesheet_entries",
              values: {
                ...(hours != null ? { hours } : {}),
                ...(hasNarrative ? { narrative: String(input.narrative).slice(0, 2000) } : {}),
              },
            },
          },
          pending: {
            tool: "update_my_time",
            input: { ...input, entryId: entry.id, confirm: true },
          },
        },
      };
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (hours != null) patch.hours = hours;
    if (hasNarrative) patch.narrative = String(input.narrative).slice(0, 2000);
    await db
      .update(atelierTimesheetEntries)
      .set(patch)
      .where(and(eq(atelierTimesheetEntries.id, entry.id), isNull(atelierTimesheetEntries.deletedAt)));
    const totals = await recomputeWeekTotals(entry.weekId);
    await audit({
      subject,
      entityType: "timesheet_entry",
      entityId: entry.id,
      action: "timesheet.entry_update",
      payload: {
        workDate: entry.workDate,
        hoursBefore: entry.hours,
        ...(hours != null ? { hoursAfter: hours } : {}),
        via: "chat",
      },
      summary: `${subject.user.name} updated a ${entry.workDate} timesheet entry from chat`,
    });
    return {
      ok: true,
      data: {
        id: entry.id,
        label:
          hours != null
            ? `${entry.workDate}: ${entry.hours}h → ${hours}h${entry.engagementLabel ? ` — ${entry.engagementLabel}` : ""}`
            : `${entry.workDate}: note updated${entry.engagementLabel ? ` — ${entry.engagementLabel}` : ""}`,
        weekIso: entry.weekIso,
        weekTotalHours: totals?.totalHours ?? null,
        weekBillableHours: totals?.billableHours ?? null,
        href: "/me/timesheets",
        navigateTo: { path: "/me/timesheets", when: "on_commit" as const },
        note: "Week totals were recalculated.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.timesheet_remove — remove one of the caller's own entries by
// describing it (Task #802). Destructive → two-phase confirm; mirrors
// DELETE entry (soft delete + week totals recompute).
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.timesheet_remove",
  module: "roster",
  toolName: "remove_my_time",
  description:
    "Remove one of the signed-in user's own logged time entries by describing it — a work date plus an optional engagement/client name, activity, or the hours on it (\"remove the 3h I logged on Tasama yesterday\"). The server resolves the entry; several matches come back as choices. Only draft entries in draft/rejected weeks can be removed.",
  slashAliases: { en: ["/remove-time"], fr: ["/supprimer-temps"] },
  representativePrompts: {
    en: ["Remove the 3h I logged on Tasama yesterday", "Delete my Monday internal entry"],
    ar: ["احذف ساعات يوم الاثنين"],
    fr: ["Supprimer mes heures de lundi"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Remove the 3 hours I logged yesterday"],
    ar: ["احذف ساعات يوم الاثنين"],
    fr: ["Supprimer mes heures de lundi"],
  },
  inputSchema: {
    type: "object",
    properties: {
      workDate: { type: "string", description: "ISO date YYYY-MM-DD of the entry to remove." },
      engagement: {
        type: "string",
        description: "Optional engagement or client name that identifies the entry.",
      },
      activity: {
        type: "string",
        description: "Optional activity descriptor (billable, internal, training, bench, leave).",
      },
      hoursWas: { type: "number", description: "Hours on the entry, if the user said them." },
      entryId: { type: "string", description: "Exact entry id, if already known." },
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = personRowOf(subject);
    if (!person) return NO_ROSTER;
    const resolved = await resolveOwnTimesheetEntry(input, person.id, subject.user.orgId);
    if (resolved.outcome === "not_found") {
      return { ok: false, errorCode: "entry_not_found", errorMessage: resolved.message };
    }
    if (resolved.outcome === "ambiguous") {
      return {
        ok: true,
        data: { prompt: resolved.prompt, options: resolved.options, navigateTo: null },
        disambiguation: { kind: "timesheet_entry", field: "entryId", options: resolved.options },
      };
    }
    const entry = resolved.entry;
    const label = `${entry.hours}h ${entry.activityCode}${entry.engagementLabel ? ` on ${entry.engagementLabel}` : ""} (${entry.workDate})`;
    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            entryId: entry.id,
            workDate: entry.workDate,
            hours: entry.hours,
            activityCode: entry.activityCode,
            engagementName: entry.engagementLabel,
          },
        },
        confirmation: {
          summary: `Remove ${label} from your timesheet? Week totals will be recalculated.`,
          diff: {
            delete: {
              table: "atelier_timesheet_entries",
              values: { id: entry.id, workDate: entry.workDate, hours: entry.hours },
            },
            impact: `Week ${entry.weekIso} loses ${entry.hours}h.`,
          },
          pending: {
            tool: "remove_my_time",
            input: { ...input, entryId: entry.id, confirm: true },
          },
        },
      };
    }
    await db
      .update(atelierTimesheetEntries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(atelierTimesheetEntries.id, entry.id), isNull(atelierTimesheetEntries.deletedAt)));
    const totals = await recomputeWeekTotals(entry.weekId);
    await audit({
      subject,
      entityType: "timesheet_entry",
      entityId: entry.id,
      action: "timesheet.entry_remove",
      payload: {
        workDate: entry.workDate,
        hours: entry.hours,
        activityCode: entry.activityCode,
        engagementId: entry.engagementId,
        via: "chat",
      },
      summary: `${subject.user.name} removed a ${entry.workDate} timesheet entry from chat`,
    });
    return {
      ok: true,
      data: {
        id: entry.id,
        label: `Removed ${label}`,
        weekIso: entry.weekIso,
        weekTotalHours: totals?.totalHours ?? null,
        weekBillableHours: totals?.billableHours ?? null,
        href: "/me/timesheets",
        navigateTo: { path: "/me/timesheets", when: "on_commit" as const },
        note: "Week totals were recalculated.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.timesheet_submit — submit the week (mirrors POST week submit)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.timesheet_submit",
  module: "roster",
  toolName: "submit_my_timesheet",
  description:
    "Submit the signed-in user's own timesheet week for approval (current week by default, or a specific ISO week like 2026-W30). Suspicious patterns must be acknowledged before submission goes through.",
  slashAliases: { en: ["/submit-timesheet"], fr: ["/soumettre-feuille"] },
  representativePrompts: {
    en: ["Submit my timesheet", "Submit last week's timesheet"],
    ar: ["أرسل جدول ساعاتي"],
    fr: ["Soumettre ma feuille de temps"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Submit my timesheet for this week"],
    ar: ["أرسل جدول ساعاتي"],
    fr: ["Soumettre ma feuille de temps"],
  },
  inputSchema: {
    type: "object",
    properties: {
      weekIso: { type: "string", description: "ISO week like 2026-W30 (default: current week)" },
      acknowledgeFlags: { type: "boolean" },
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = personRowOf(subject);
    if (!person) return NO_ROSTER;
    const weekIso =
      typeof input.weekIso === "string" && /^\d{4}-W\d{2}$/.test(input.weekIso)
        ? input.weekIso
        : isoWeekOf(new Date()).weekIso;
    const [week] = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.personId, person.id),
          eq(atelierTimesheetWeeks.weekIso, weekIso),
          isNull(atelierTimesheetWeeks.deletedAt),
        ),
      );
    if (!week) {
      return {
        ok: false,
        errorCode: "week_not_found",
        errorMessage: `No timesheet week ${weekIso} exists yet — log some time first.`,
      };
    }
    if (week.status !== "draft" && week.status !== "rejected") {
      return {
        ok: false,
        errorCode: "week_locked",
        errorMessage: `Week ${weekIso} is already ${week.status}.`,
      };
    }
    const entries = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.weekId, week.id),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      );
    if (entries.length === 0) {
      return {
        ok: false,
        errorCode: "empty_week",
        errorMessage: `Week ${weekIso} has no entries to submit.`,
      };
    }
    const signals = await db
      .select()
      .from(atelierTimesheetSignals)
      .where(eq(atelierTimesheetSignals.weekId, week.id));
    const flags = detectSuspiciousFlags(entries.map(entryWire), signals.map(signalWire));

    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { weekIso, totalHours: week.totalHours, flags } },
        confirmation: {
          summary: `Submit week ${weekIso} (${week.totalHours}h) for approval?`,
          diff: {
            update: {
              table: "atelier_timesheet_weeks",
              values: { status: "submitted" },
            },
          },
          pending: { tool: "submit_my_timesheet", input: { ...input, confirm: true } },
        },
      };
    }
    // Suspicious-pattern gate — mirrors the REST 409: a second explicit
    // acknowledgement is required before a flagged week goes through.
    if (flags.length && input.acknowledgeFlags !== true) {
      await db
        .update(atelierTimesheetWeeks)
        .set({ suspiciousFlags: flags, updatedAt: new Date() })
        .where(eq(atelierTimesheetWeeks.id, week.id));
      return {
        ok: true,
        data: { preview: { weekIso, flags } },
        confirmation: {
          summary: `Week ${weekIso} has flagged patterns: ${flags.join("; ")}. Acknowledge and submit anyway?`,
          diff: {
            update: {
              table: "atelier_timesheet_weeks",
              values: { status: "submitted", acknowledgedFlags: flags },
            },
          },
          pending: {
            tool: "submit_my_timesheet",
            input: { ...input, confirm: true, acknowledgeFlags: true },
          },
        },
      };
    }
    await db
      .update(atelierTimesheetEntries)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(atelierTimesheetEntries.weekId, week.id));
    await db
      .update(atelierTimesheetWeeks)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        submittedByUserId: subject.user.id,
        suspiciousFlags: flags,
        rejectionReason: null,
        rejectedAt: null,
        rejectedByUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierTimesheetWeeks.id, week.id));
    await audit({
      subject,
      entityType: "timesheet_week",
      entityId: week.id,
      action: "ledger.submit",
      payload: { flags, acknowledged: flags.length > 0, via: "chat" },
      summary: `${subject.user.name} submitted week ${weekIso}${flags.length ? ` (acknowledged ${flags.length} flag(s))` : ""}`,
    });
    // Task #589 — mirror the Me-lens REST submit's self-notification so the
    // submitter's home shows the week is with the approvers.
    await emitSelfNotification({
      orgId: subject.user.orgId,
      userId: subject.user.id,
      kind: "timesheet_submitted",
      title: `Timesheet ${weekIso} submitted`,
      body: "Your week is now with the approvers.",
      href: "/me",
    });
    return {
      ok: true,
      data: {
        id: week.id,
        label: `Week ${weekIso} submitted`,
        totalHours: week.totalHours,
        flags,
        href: "/me/timesheets",
        navigateTo: { path: "/me/timesheets", when: "on_commit" as const },
        note: "Your week is now awaiting approval.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.profile_update — self-edit whitelist (mirrors PATCH /me/profile)
// ---------------------------------------------------------------------
const ProfilePatch = z
  .object({
    preferredName: z.string().max(200).nullable().optional(),
    personalEmail: z.string().max(320).nullable().optional(),
    cellPhones: z
      .array(
        z.object({
          country: z.string().min(1).max(60),
          number: z.string().min(3).max(40),
        }),
      )
      .max(3)
      .optional(),
    homeAddress: z.string().max(1000).nullable().optional(),
    officeAddress: z.string().max(1000).nullable().optional(),
    bio: z.string().max(4000).nullable().optional(),
    nationality: z.string().max(2).nullable().optional(),
    gender: z.enum(["female", "male", "unspecified"]).optional(),
  })
  .strict();

defineSelfWriteCapability({
  id: "me.profile_update",
  module: "roster",
  toolName: "update_my_profile",
  description:
    "Update the signed-in user's own personal profile fields only: preferred name (employees), personal email, cell phones, home/office address, bio, nationality, gender. Job title, pay, and HR fields cannot be changed here.",
  slashAliases: { en: ["/update-profile"], fr: ["/modifier-profil"] },
  representativePrompts: {
    en: ["Update my phone number", "Change my personal email"],
    ar: ["حدث رقم هاتفي"],
    fr: ["Mettre à jour mon téléphone"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Change my personal email to x@y.com"],
    ar: ["حدث رقم هاتفي"],
    fr: ["Mettre à jour mon téléphone"],
  },
  inputSchema: {
    type: "object",
    properties: {
      preferredName: { type: ["string", "null"] },
      personalEmail: { type: ["string", "null"] },
      cellPhones: {
        type: "array",
        items: {
          type: "object",
          properties: {
            country: { type: "string" },
            number: { type: "string" },
          },
          required: ["country", "number"],
          additionalProperties: false,
        },
      },
      homeAddress: { type: ["string", "null"] },
      officeAddress: { type: ["string", "null"] },
      bio: { type: ["string", "null"] },
      nationality: { type: ["string", "null"] },
      gender: { type: "string", enum: ["female", "male", "unspecified"] },
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    const { confirm, ...rawPatch } = input;
    const parsed = ProfilePatch.safeParse(rawPatch);
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: "invalid_body",
        errorMessage: `Invalid profile fields: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}.`,
      };
    }
    const patch = parsed.data;
    // Load the raw roster row so no-op detection matches REST behaviour.
    const table = person.workerType === "employee" ? atelierEmployees : null;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    const rowWire = person as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (person.workerType === "contractor" && k === "preferredName") continue;
      if (v === undefined) continue;
      if (JSON.stringify(rowWire[k] ?? null) === JSON.stringify(v ?? null)) continue;
      changes[k] = { from: rowWire[k] ?? null, to: v ?? null };
      upd[k] = v;
    }
    if (Object.keys(changes).length === 0) {
      return {
        ok: true,
        data: {
          label: "Profile",
          note: "Nothing to change — those values are already set.",
          navigateTo: null,
        },
      };
    }
    if (confirm !== true) {
      return {
        ok: true,
        data: { preview: { changes } },
        confirmation: {
          summary: `Update your profile (${Object.keys(changes).join(", ")})?`,
          diff: { update: { table: "roster_person", values: changes } },
          pending: { tool: "update_my_profile", input: { ...input, confirm: true } },
        },
      };
    }
    if (table) {
      await db.update(atelierEmployees).set(upd).where(eq(atelierEmployees.id, person.id));
    } else {
      const { atelierContractors } = await import("@workspace/db");
      await db
        .update(atelierContractors)
        .set(upd)
        .where(eq(atelierContractors.id, person.id));
    }
    // Mirror a preferredName self-edit onto the linked person record
    // (employees only) — same rule as the REST route.
    if ("preferredName" in changes && person.workerType === "employee") {
      const [emp] = await db
        .select()
        .from(atelierEmployees)
        .where(eq(atelierEmployees.id, person.id));
      const personId = emp?.personId ?? null;
      if (personId) {
        const [p] = await db
          .select()
          .from(atelierPersons)
          .where(
            and(
              eq(atelierPersons.id, personId),
              eq(atelierPersons.orgId, subject.user.orgId),
            ),
          )
          .limit(1);
        if (p) {
          await writePersonAndSync(db, {
            orgId: subject.user.orgId,
            personId,
            structured: {
              honorific: p.honorific,
              firstName: p.firstName,
              middleName: p.middleName,
              lastName: p.lastName,
              preferredName: (patch.preferredName ?? null) as string | null,
            },
          });
        }
      }
    }
    await audit({
      subject,
      entityType: person.workerType,
      entityId: person.id,
      action: "person.profile.self_updated",
      payload: { changes, via: "chat" },
      summary: `${subject.user.name} updated their own profile (${Object.keys(changes).join(", ")})`,
    });
    return {
      ok: true,
      data: {
        id: person.id,
        label: "Profile updated",
        updatedFields: Object.keys(changes),
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// Personal documents — list / save-from-attachment / delete
// ---------------------------------------------------------------------
const SELF_DOC_KINDS = new Set([
  "passport",
  "national_id",
  "residency",
  "visa",
  "dependent_doc",
  "other",
]);
const DOC_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function chatDocWire(d: typeof atelierPersonDocuments.$inferSelect) {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    docNumber: d.docNumber ?? null,
    issuingCountry: d.issuingCountry ?? null,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString().slice(0, 10) : null,
    fileName: d.fileName ?? null,
    sides:
      d.kind === "national_id"
        ? d.backFileRef
          ? "front_back"
          : d.fileRef || d.fileUrl
            ? d.mime === "application/pdf"
              ? "combined"
              : "front_only"
            : "none"
        : null,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

// me.documents — read-only list (identity-locked, no input needed)
defineCapability({
  id: "me.documents",
  module: "roster",
  toolName: "my_documents",
  description:
    "List the signed-in user's own personal documents (passport, national ID, residency, visa, etc.) with expiry dates. Always self-scoped; file bytes never appear in chat.",
  slashAliases: { en: ["/my-documents"], fr: ["/mes-documents"] },
  representativePrompts: {
    en: ["Show my documents", "When does my passport expire?"],
    ar: ["اعرض مستنداتي"],
    fr: ["Affiche mes documents"],
  },
  surfaceOn: ["home", "global"],
  // Task #679 — this is a LIST; entity_card rendered a broken single-item
  // card on both clients. ranked_list expects items[] with a label each.
  resultCard: "ranked_list",
  examplePhrases: {
    en: ["Show my documents"],
    ar: ["اعرض مستنداتي"],
    fr: ["Affiche mes documents"],
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
    const person = subject.person;
    if (!person) return NO_ROSTER;
    const docs = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.personType, person.workerType),
          eq(atelierPersonDocuments.personId, person.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPersonDocuments.uploadedAt));
    return {
      ok: true,
      data: {
        items: docs
          .filter((d) => d.kind !== "profile_photo" && d.kind !== "biography")
          .map((d) => ({
            ...chatDocWire(d),
            // ranked_list items render their `label`; personal documents
            // live under the Me → Profile tab (there is no /me/documents
            // page — the old href 404-bounced to the overview).
            label: d.title,
            href: "/me/profile",
          })),
        href: "/me/profile",
      },
    };
  },
});

/** Load a chat attachment strictly as "the caller's own upload". */
async function loadOwnAttachmentBytes(
  attachmentId: string,
  ctx: ToolContext,
): Promise<
  | { ok: true; fileName: string; mime: string; buf: Buffer }
  | { ok: false; error: ToolResult }
> {
  const loaded = await loadAttachment(attachmentId, ctx.persona.orgId);
  if (!loaded || loaded.attachment.deletedAt || loaded.attachment.userId !== ctx.persona.id) {
    return {
      ok: false,
      error: {
        ok: false,
        errorCode: "attachment_not_found",
        errorMessage: `Attachment ${attachmentId} was not found among your own uploads in this chat.`,
      },
    };
  }
  if (!DOC_MIMES.has(loaded.attachment.mime)) {
    return {
      ok: false,
      error: {
        ok: false,
        errorCode: "unsupported_file_type",
        errorMessage: `Personal documents accept PDF, JPEG, PNG, or WebP — ${loaded.attachment.fileName} is ${loaded.attachment.mime}.`,
      },
    };
  }
  const buf = await loadAttachmentBytes(loaded.attachment.encryptedRef);
  if (!buf) {
    return {
      ok: false,
      error: {
        ok: false,
        errorCode: "attachment_bytes_missing",
        errorMessage: `The file bytes for ${loaded.attachment.fileName} are no longer available. Re-upload the file and try again.`,
      },
    };
  }
  return {
    ok: true,
    fileName: loaded.attachment.fileName,
    mime: loaded.attachment.mime,
    buf,
  };
}

/**
 * Task #844 — best-effort date/number auto-detect for chat document saves,
 * mirroring the Me-tab upload route. Never blocks the save: any failure or
 * empty result means "store exactly what the user typed". The shared helper's
 * <4KB byte guard keeps offline stub probes (garbage bytes) from ever making
 * a live model call.
 */
async function detectDocDatesBestEffort(
  orgId: string,
  buf: Buffer,
  mime: string,
  hint: { kind: string; title: string },
): Promise<import("../atelier-doc-dates.js").DocDateExtraction | null> {
  try {
    const { extractDocumentDates } = await import("../atelier-doc-dates.js");
    return await extractDocumentDates(orgId, buf, mime, hint);
  } catch (err) {
    console.warn(
      "[atelier-cli] person-doc date auto-detect failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

defineSelfWriteCapability({
  id: "me.document_save",
  module: "roster",
  toolName: "save_my_document",
  description:
    "Save a file uploaded in this chat as a NEW personal document for the signed-in user (passport, national ID, residency, visa, other). National ID cards need both sides: pass a front and a back attachment, or a single combined PDF. Check my_documents FIRST — if the document already exists (e.g. a front-only national ID), use attach_my_document_file to add the missing side or replace the scan instead of creating a duplicate.",
  slashAliases: { en: ["/save-document"], fr: ["/enregistrer-document"] },
  representativePrompts: {
    en: ["Save this as my passport", "File this ID card — front and back attached"],
    ar: ["احفظ هذا كجواز سفري"],
    fr: ["Enregistrer ceci comme mon passeport"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Save this attachment as my passport"],
    ar: ["احفظ هذا كجواز سفري"],
    fr: ["Enregistrer ceci comme mon passeport"],
  },
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string", description: "Front (or combined PDF) attachment id" },
      backAttachmentId: {
        type: "string",
        description: "Back-side attachment id — national_id only",
      },
      kind: {
        type: "string",
        enum: ["passport", "national_id", "residency", "visa", "dependent_doc", "other"],
      },
      title: { type: "string" },
      docNumber: { type: "string" },
      issuedAt: { type: "string", description: "ISO date" },
      issuingCountry: { type: "string" },
      expiresAt: { type: "string", description: "ISO date" },
      notes: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentId", "kind", "title"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject, ctx) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    const kind = String(input.kind ?? "");
    if (!SELF_DOC_KINDS.has(kind)) {
      return {
        ok: false,
        errorCode: "invalid_kind",
        errorMessage: `Document kind must be one of: ${[...SELF_DOC_KINDS].join(", ")}.`,
      };
    }
    const title = String(input.title ?? "").trim();
    if (!title || title.length > 200) {
      return { ok: false, errorCode: "invalid_title", errorMessage: "Provide a title up to 200 characters." };
    }
    for (const f of ["issuedAt", "expiresAt"] as const) {
      if (input[f] !== undefined && !isIsoDate(input[f])) {
        return {
          ok: false,
          errorCode: `invalid_${f}`,
          errorMessage: `${f} must be an ISO date (YYYY-MM-DD).`,
        };
      }
    }
    const backId = input.backAttachmentId ? String(input.backAttachmentId) : null;
    if (backId && kind !== "national_id") {
      return {
        ok: false,
        errorCode: "back_side_not_allowed",
        errorMessage: "Only national ID cards take a back-side scan.",
      };
    }
    const front = await loadOwnAttachmentBytes(String(input.attachmentId ?? ""), ctx);
    if (!front.ok) return front.error;
    // National ID side rule — two labeled scans or one combined PDF.
    if (kind === "national_id" && !backId && front.mime !== "application/pdf") {
      return {
        ok: false,
        errorCode: "back_side_required",
        errorMessage:
          "National ID cards need both sides: upload the back too and pass it as the back attachment, or provide a single combined PDF. If one side is already saved as an existing document, attach the new side to that document instead of creating a new one.",
      };
    }
    let back: { fileName: string; mime: string; buf: Buffer } | null = null;
    if (backId) {
      const b = await loadOwnAttachmentBytes(backId, ctx);
      if (!b.ok) return b.error;
      back = b;
    }
    // Task #844 — auto-detect expiry/issue date/document number from the
    // scan when the user didn't provide them (same helper as the Me-tab
    // upload route). Fill blank fields only; never overwrite typed values.
    let detected: import("../atelier-doc-dates.js").DocDateExtraction | null = null;
    const wantsDetection =
      !isIsoDate(input.expiresAt) || !isIsoDate(input.issuedAt) || !input.docNumber;
    if (wantsDetection) {
      detected = await detectDocDatesBestEffort(
        ctx.persona.orgId,
        front.buf,
        front.mime,
        { kind, title },
      );
    }
    const effExpiresAt = isIsoDate(input.expiresAt)
      ? (input.expiresAt as string)
      : (detected?.expiresAt ?? null);
    const effIssuedAt = isIsoDate(input.issuedAt)
      ? (input.issuedAt as string)
      : (detected?.issuedAt ?? null);
    const effDocNumber = input.docNumber
      ? String(input.docNumber).slice(0, 100)
      : (detected?.docNumber ?? null);
    const detectedExpiry = !isIsoDate(input.expiresAt) && !!detected?.expiresAt;
    if (input.confirm !== true) {
      // Carry the detected values in the pending input so the commit turn
      // stores exactly what the confirmation card showed (no re-detection).
      const pendingInput: Record<string, unknown> = { ...input, confirm: true };
      if (effExpiresAt) pendingInput.expiresAt = effExpiresAt;
      if (effIssuedAt) pendingInput.issuedAt = effIssuedAt;
      if (effDocNumber) pendingInput.docNumber = effDocNumber;
      return {
        ok: true,
        data: {
          preview: {
            kind,
            title,
            fileName: front.fileName,
            backFileName: back?.fileName ?? null,
            expiresAt: effExpiresAt,
            detectedExpiry,
            sides:
              kind === "national_id"
                ? back
                  ? "front_back"
                  : "combined"
                : null,
          },
        },
        confirmation: {
          summary: `Save ${front.fileName}${back ? ` + ${back.fileName}` : ""} as your ${kind} document "${title}"?${
            detectedExpiry
              ? ` I read an expiry date of ${effExpiresAt} from the scan — tell me if that's wrong.`
              : ""
          }`,
          diff: {
            create: {
              table: "atelier_person_documents",
              values: {
                kind,
                title,
                fileName: front.fileName,
                ...(effExpiresAt ? { expiresAt: effExpiresAt } : {}),
              },
            },
          },
          pending: { tool: "save_my_document", input: pendingInput },
        },
      };
    }
    const storedFront = await storePersonDocBytes(front.buf, front.mime);
    let backFileRef: string | null = null;
    let backFileName: string | null = null;
    let backMime: string | null = null;
    let backSizeBytes: number | null = null;
    if (back) {
      const storedBack = await storePersonDocBytes(back.buf, back.mime);
      backFileRef = storedBack.fileRef;
      backFileName = back.fileName;
      backMime = back.mime;
      backSizeBytes = storedBack.sizeBytes;
    }
    const id = rid("pdoc");
    const [doc] = await db
      .insert(atelierPersonDocuments)
      .values({
        id,
        orgId: subject.user.orgId,
        personType: person.workerType,
        personId: person.id,
        kind,
        title,
        docNumber: effDocNumber,
        issuedAt: effIssuedAt,
        issuingCountry: input.issuingCountry
          ? String(input.issuingCountry).slice(0, 100)
          : null,
        expiresAt: effExpiresAt ? new Date(`${effExpiresAt}T00:00:00Z`) : null,
        fileRef: storedFront.fileRef,
        fileName: front.fileName,
        mime: front.mime,
        sizeBytes: storedFront.sizeBytes,
        backFileRef,
        backFileName,
        backMime,
        backSizeBytes,
        notes: input.notes ? String(input.notes).slice(0, 2000) : null,
        uploadedByUserId: subject.user.id,
        createdByUserId: subject.user.id,
      })
      .returning();
    await audit({
      subject,
      entityType: "person_document",
      entityId: id,
      action: "person_document.self_uploaded",
      payload: {
        kind,
        title,
        hasBackFile: !!backFileRef,
        autoDetectedExpiry: detectedExpiry,
        via: "chat",
      },
      summary: `${subject.user.name} added their own ${kind} document "${title}"`,
    });
    return {
      ok: true,
      data: {
        ...chatDocWire(doc),
        detectedExpiry,
        label: detectedExpiry && effExpiresAt ? `${title} — expiry ${effExpiresAt} read from the scan` : title,
        // Task #785 — personal documents live under Me → Profile; the old
        // /me/documents path 404-bounced on web and mobile.
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.document_file_attach — Task #792: attach/replace a scan on an
// EXISTING personal document (mirrors POST /me/documents/:id/file).
// This is the ONLY mobile path for adding the back of a national ID
// when the front is already on file — the mobile Personal Documents
// section is view/download only.
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.document_file_attach",
  module: "roster",
  toolName: "attach_my_document_file",
  description:
    "Attach or replace the scan on one of the signed-in user's EXISTING personal documents (from the my_documents list) using a file uploaded in this chat. Use side=back to add the back of a national ID whose front is already saved (back side is national_id only); use side=front (default) to replace/renew the main scan of any document. Never create a new document with this — use save_my_document for that.",
  slashAliases: { en: ["/attach-document-file"], fr: ["/joindre-fichier-document"] },
  representativePrompts: {
    en: [
      "Here's the back of my Emirates ID — add it to my saved ID",
      "Replace my passport scan with this new one",
    ],
    ar: ["أضف الوجه الخلفي لبطاقة الهوية"],
    fr: ["Ajouter le verso de ma carte d'identité"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Attach this as the back of my national ID"],
    ar: ["أضف الوجه الخلفي لبطاقة الهوية"],
    fr: ["Ajouter le verso de ma carte d'identité"],
  },
  inputSchema: {
    type: "object",
    properties: {
      documentId: {
        type: "string",
        description: "Existing document id from the my_documents list",
      },
      attachmentId: {
        type: "string",
        description: "Attachment id of the file uploaded in this chat",
      },
      side: {
        type: "string",
        enum: ["front", "back"],
        description: "Which side to attach — back is national_id only. Default front.",
      },
      // Internal (Task #844): auto-detected fields carried from the
      // confirmation preview into the confirmed commit. Never set these
      // yourself — they are filled by the server from the scan.
      detectedExpiresAt: { type: "string", description: "Internal — do not set" },
      detectedIssuedAt: { type: "string", description: "Internal — do not set" },
      detectedDocNumber: { type: "string", description: "Internal — do not set" },
      confirm: { type: "boolean" },
    },
    required: ["documentId", "attachmentId"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject, ctx) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    const side = input.side === "back" ? "back" : "front";
    const [doc] = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.id, String(input.documentId ?? "")),
          eq(atelierPersonDocuments.personType, person.workerType),
          eq(atelierPersonDocuments.personId, person.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      );
    if (!doc || doc.kind === "profile_photo" || doc.kind === "biography") {
      // Friendly miss — offer the caller's own documents as candidates
      // (self-scoped, nothing to leak) instead of a dead-end code.
      const own = await db
        .select({
          id: atelierPersonDocuments.id,
          title: atelierPersonDocuments.title,
          kind: atelierPersonDocuments.kind,
        })
        .from(atelierPersonDocuments)
        .where(
          and(
            eq(atelierPersonDocuments.personType, person.workerType),
            eq(atelierPersonDocuments.personId, person.id),
            isNull(atelierPersonDocuments.deletedAt),
          ),
        )
        .orderBy(desc(atelierPersonDocuments.uploadedAt));
      const options = own
        .filter((d) => d.kind !== "profile_photo" && d.kind !== "biography")
        .slice(0, 6)
        .map((d) => ({ id: d.id, label: d.title, secondary: d.kind }));
      if (options.length > 0) {
        return {
          ok: true,
          data: {
            prompt:
              "I couldn't find that document on your record — which one should this file go on?",
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "document", field: "documentId", options },
        };
      }
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          "You don't have any personal documents saved yet, so there is nothing to attach this file to. Save it as a new document instead (for a national ID, both sides or one combined PDF are needed).",
      };
    }
    // Mirror the REST route's side rule — back is national_id only.
    if (side === "back" && doc.kind !== "national_id") {
      return {
        ok: false,
        errorCode: "back_side_not_allowed",
        errorMessage: `Only national ID cards take a back-side scan — "${doc.title}" is a ${doc.kind} document. To replace its main scan, attach it as the front side instead.`,
      };
    }
    const file = await loadOwnAttachmentBytes(String(input.attachmentId ?? ""), ctx);
    if (!file.ok) return file.error;
    const replacing = side === "back" ? !!doc.backFileRef : !!(doc.fileRef || doc.fileUrl);
    // Task #844 — when the document has no expiry/issue date/number on file,
    // try to read them off the newly attached scan BEFORE asking to confirm,
    // so the confirmation card shows the detected expiry and the user can
    // correct it (best-effort, fill blank fields only — a replace never
    // overwrites values already stored). The confirmed replay carries the
    // reviewed values via the internal detected* input fields instead of
    // re-running detection.
    const detFromInput =
      isIsoDate(input.detectedExpiresAt) ||
      isIsoDate(input.detectedIssuedAt) ||
      typeof input.detectedDocNumber === "string";
    let attachDetected: import("../atelier-doc-dates.js").DocDateExtraction | null = null;
    if (detFromInput) {
      attachDetected = {
        expiresAt: isIsoDate(input.detectedExpiresAt) ? (input.detectedExpiresAt as string) : null,
        issuedAt: isIsoDate(input.detectedIssuedAt) ? (input.detectedIssuedAt as string) : null,
        docNumber:
          typeof input.detectedDocNumber === "string" && input.detectedDocNumber.trim()
            ? String(input.detectedDocNumber).trim().slice(0, 100)
            : null,
      };
    } else if (!doc.expiresAt || !doc.issuedAt || !doc.docNumber) {
      attachDetected = await detectDocDatesBestEffort(file.buf, file.mime, {
        kind: doc.kind,
        title: doc.title,
      });
    }
    const detectedExpiry = !doc.expiresAt && !!attachDetected?.expiresAt;
    const detectFill = {
      ...(detectedExpiry
        ? { expiresAt: new Date(`${attachDetected!.expiresAt}T00:00:00Z`) }
        : {}),
      ...(!doc.issuedAt && attachDetected?.issuedAt
        ? { issuedAt: attachDetected.issuedAt }
        : {}),
      ...(!doc.docNumber && attachDetected?.docNumber
        ? { docNumber: attachDetected.docNumber }
        : {}),
    };
    if (input.confirm !== true) {
      const pendingInput: Record<string, unknown> = { ...input, side, confirm: true };
      if (detectedExpiry) pendingInput.detectedExpiresAt = attachDetected!.expiresAt;
      if (!doc.issuedAt && attachDetected?.issuedAt)
        pendingInput.detectedIssuedAt = attachDetected.issuedAt;
      if (!doc.docNumber && attachDetected?.docNumber)
        pendingInput.detectedDocNumber = attachDetected.docNumber;
      return {
        ok: true,
        data: {
          preview: {
            ...chatDocWire(doc),
            newFileName: file.fileName,
            side,
            replacing,
            detectedExpiry,
            ...(detectedExpiry ? { expiresAt: attachDetected!.expiresAt } : {}),
          },
        },
        confirmation: {
          summary: `${
            side === "back"
              ? `${replacing ? "Replace" : "Attach"} ${file.fileName} as the BACK side of your ${doc.kind} document "${doc.title}"?`
              : replacing
                ? `Replace the scan on your ${doc.kind} document "${doc.title}" with ${file.fileName}?`
                : `Attach ${file.fileName} to your ${doc.kind} document "${doc.title}"?`
          }${
            detectedExpiry
              ? ` I read an expiry date of ${attachDetected!.expiresAt} from the scan — tell me if that's wrong.`
              : ""
          }`,
          diff: {
            update: {
              table: "atelier_person_documents",
              id: doc.id,
              values: {
                ...(side === "back"
                  ? { backFileName: file.fileName }
                  : { fileName: file.fileName }),
                ...(detectedExpiry ? { expiresAt: attachDetected!.expiresAt } : {}),
              },
            },
          },
          pending: { tool: "attach_my_document_file", input: pendingInput },
        },
      };
    }
    const stored = await storePersonDocBytes(file.buf, file.mime);
    const oldRef = side === "back" ? doc.backFileRef : doc.fileRef;
    const upd =
      side === "back"
        ? {
            backFileRef: stored.fileRef,
            backFileName: file.fileName,
            backMime: file.mime,
            backSizeBytes: stored.sizeBytes,
          }
        : {
            fileRef: stored.fileRef,
            fileName: file.fileName,
            mime: file.mime,
            sizeBytes: stored.sizeBytes,
          };
    const [updated] = await db
      .update(atelierPersonDocuments)
      .set({
        ...upd,
        ...detectFill,
        uploadedAt: new Date(),
        uploadedByUserId: subject.user.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierPersonDocuments.id, doc.id))
      .returning();
    // Drop the superseded object AFTER the row points at the new one
    // (same ordering as the REST route).
    if (oldRef && oldRef.startsWith("persondoc:")) {
      await dropPersonDocBytes(oldRef).catch((err) =>
        console.error(
          "[atelier-cli] person-doc old scan cleanup failed",
          oldRef,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
    await audit({
      subject,
      entityType: "person_document",
      entityId: doc.id,
      action: "person_document.self_scan_replaced",
      payload: {
        kind: doc.kind,
        title: doc.title,
        replaced: !!oldRef,
        side,
        autoDetectedExpiry: detectedExpiry,
        via: "chat",
      },
      summary: `${subject.user.name} ${replacing ? "replaced" : "attached"} the ${side} scan on their ${doc.kind} document "${doc.title}"`,
    });
    return {
      ok: true,
      data: {
        ...chatDocWire(updated),
        detectedExpiry,
        label: `${
          side === "back"
            ? `Back side added to "${doc.title}"`
            : `Scan updated on "${doc.title}"`
        }${
          detectedExpiry
            ? ` — expiry ${attachDetected!.expiresAt} read from the scan, correct it if that's wrong`
            : ""
        }`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

defineSelfWriteCapability({
  id: "me.document_delete",
  module: "roster",
  toolName: "delete_my_document",
  description:
    "Remove one of the signed-in user's own personal documents by id (from the my_documents list). Self-scoped — only documents on your own record can be removed.",
  slashAliases: { en: ["/delete-document"], fr: ["/supprimer-document"] },
  representativePrompts: {
    en: ["Delete my old visa document"],
    ar: ["احذف مستند التأشيرة القديم"],
    fr: ["Supprimer mon ancien visa"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Delete my expired visa document"],
    ar: ["احذف مستند التأشيرة القديم"],
    fr: ["Supprimer mon ancien visa"],
  },
  inputSchema: {
    type: "object",
    properties: {
      documentId: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["documentId"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    const [doc] = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.id, String(input.documentId ?? "")),
          eq(atelierPersonDocuments.personType, person.workerType),
          eq(atelierPersonDocuments.personId, person.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      );
    if (!doc || doc.kind === "profile_photo" || doc.kind === "biography") {
      // Task #785 — friendly miss: offer the caller's own documents as
      // candidates (self-scoped, so there is nothing to leak) instead of
      // a terse dead-end code.
      const own = await db
        .select({
          id: atelierPersonDocuments.id,
          title: atelierPersonDocuments.title,
          kind: atelierPersonDocuments.kind,
        })
        .from(atelierPersonDocuments)
        .where(
          and(
            eq(atelierPersonDocuments.personType, person.workerType),
            eq(atelierPersonDocuments.personId, person.id),
            isNull(atelierPersonDocuments.deletedAt),
          ),
        )
        .orderBy(desc(atelierPersonDocuments.uploadedAt));
      const options = own
        .filter((d) => d.kind !== "profile_photo" && d.kind !== "biography")
        .slice(0, 6)
        .map((d) => ({ id: d.id, label: d.title, secondary: d.kind }));
      if (options.length > 0) {
        return {
          ok: true,
          data: {
            prompt:
              "I couldn't find that document on your record — did you mean one of these?",
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "document", field: "documentId", options },
        };
      }
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          "I couldn't find that document on your record — you don't have any personal documents saved yet. You can add one from Me → Profile or by attaching it here.",
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: chatDocWire(doc) },
        confirmation: {
          summary: `Remove your ${doc.kind} document "${doc.title}"?`,
          diff: {
            delete: { table: "atelier_person_documents", id: doc.id, label: doc.title },
          },
          pending: { tool: "delete_my_document", input: { ...input, confirm: true } },
        },
      };
    }
    await db
      .update(atelierPersonDocuments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierPersonDocuments.id, doc.id));
    await audit({
      subject,
      entityType: "person_document",
      entityId: doc.id,
      action: "person_document.self_deleted",
      payload: { kind: doc.kind, title: doc.title, via: "chat" },
      summary: `${subject.user.name} removed their ${doc.kind} document "${doc.title}"`,
    });
    return {
      ok: true,
      data: {
        id: doc.id,
        label: `Removed "${doc.title}"`,
        // Task #785 — real self-documents location (see my_documents).
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.notification_dismiss — mirrors the /me notification dismiss route.
// Trivially reversible UI action → no two-phase confirm; ownership is
// enforced in the WHERE clause so a foreign id 404s without leaking.
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.notification_dismiss",
  module: "roster",
  toolName: "dismiss_my_notification",
  description:
    "Dismiss one of the signed-in user's own notification cards by id (from the my_notifications list).",
  slashAliases: { en: ["/dismiss"], fr: ["/ignorer"] },
  representativePrompts: {
    en: ["Dismiss that notification"],
    ar: ["تجاهل هذا الإشعار"],
    fr: ["Ignorer cette notification"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Dismiss my first notification"],
    ar: ["تجاهل هذا الإشعار"],
    fr: ["Ignorer cette notification"],
  },
  inputSchema: {
    type: "object",
    properties: { notificationId: { type: "string" } },
    required: ["notificationId"],
    additionalProperties: false,
  },
  twoPhaseConfirm: false,
  irreversible: false,
  async runSelf(input, subject) {
    const updated = await db
      .update(atelierSelfNotifications)
      .set({ status: "dismissed" })
      .where(
        and(
          eq(atelierSelfNotifications.id, String(input.notificationId ?? "")),
          eq(atelierSelfNotifications.orgId, subject.user.orgId),
          eq(atelierSelfNotifications.userId, subject.user.id),
        ),
      )
      .returning({ id: atelierSelfNotifications.id });
    if (!updated.length) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "That notification was not found on your home.",
      };
    }
    return {
      ok: true,
      data: {
        id: updated[0].id,
        label: "Notification dismissed",
        href: "/me",
        navigateTo: null,
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.document_email — Task #637: email the caller's OWN personal
// documents through THEIR Outlook mailbox (Microsoft Graph, delegated).
// Default mode creates a DRAFT with the files attached and returns the
// Outlook webLink for review; mode "send" sends directly and is treated
// as an irreversible outbound action (typed-name confirm).
// Self-scope only: documents are resolved strictly against the caller's
// own roster record; attachments over ~3 MB are refused honestly (no
// upload-session chunking here).
// ---------------------------------------------------------------------
const MAIL_ATTACH_MAX_BYTES = 3 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PersonDocRow = typeof atelierPersonDocuments.$inferSelect;

/**
 * Fuzzy-match one query term against the caller's documents by kind,
 * title, or file name. Moved to document-email-shared for Task #846
 * (both document-email tools use it); re-exported here so existing
 * probe imports keep working.
 */
export const matchOwnDocuments = sharedMatchOwnDocuments;

function docOptionWire(d: PersonDocRow) {
  return {
    id: d.id,
    label: d.title || d.kind,
    secondary: [d.kind, d.fileName].filter(Boolean).join(" — "),
  };
}

defineCapability({
  id: "me.document_email",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "email_my_documents",
  description:
    "Email one or more of the signed-in user's OWN personal documents (passport, national ID, residency, visa…) through their connected Outlook mailbox. Default creates an Outlook DRAFT with the files attached for review; mode 'send' sends immediately. Self-scoped — never another person's documents. Pass documentIds from my_documents, or a query like 'passport'.",
  slashAliases: { en: ["/email-document"], fr: ["/envoyer-document"] },
  representativePrompts: {
    en: [
      "Email my passport to jane@example.com",
      "Send my national ID and visa to hr@client.com",
    ],
    ar: ["أرسل جواز سفري بالبريد الإلكتروني"],
    fr: ["Envoyer mon passeport par e-mail"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Email my passport to jane@example.com"],
    ar: ["أرسل جواز سفري بالبريد الإلكتروني"],
    fr: ["Envoyer mon passeport par e-mail"],
  },
  inputSchema: {
    type: "object",
    properties: {
      documentIds: {
        type: "array",
        items: { type: "string" },
        description: "Exact document ids from my_documents (preferred)",
      },
      query: {
        type: "string",
        description:
          "Free-text document match ('passport', 'national id and visa') when ids are unknown",
      },
      to: {
        type: "array",
        items: { type: "string" },
        description:
          "Recipients — email addresses OR people names ('Gokhan', 'Jane Smith'). Names are looked up in the org roster and CRM contacts automatically; never ask the user for an email address when they gave a name.",
      },
      mode: {
        type: "string",
        enum: ["draft", "send"],
        description: "draft (default) creates an Outlook draft for review; send emails immediately",
      },
      subject: { type: "string" },
      message: { type: "string", description: "Plain-text email body" },
      confirm: { type: "boolean" },
    },
    required: ["to"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: "email",
  async run(input, ctx) {
    const subject = await resolveSelfSubject(ctx);
    if (!subject) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "Your login could not be resolved to a user record.",
      };
    }
    const person = subject.person;
    if (!person) return NO_ROSTER;

    // ---- recipients --------------------------------------------------
    // Accepts raw emails AND people names ("Gokhan"): names are resolved
    // against the org roster + CRM contacts; one match proceeds to the
    // confirm card (showing "Name <email>"), multiple matches return a
    // pick-one disambiguation card. Never asks free-text for an email.
    const rawTo = Array.isArray(input.to) ? input.to : [];
    const toEntries = [...new Set(rawTo.map((r) => String(r).trim()).filter(Boolean))];
    if (toEntries.length === 0 || toEntries.length > 10) {
      return {
        ok: false,
        errorCode: "invalid_recipients",
        errorMessage: "Provide between 1 and 10 recipients (email addresses or people names).",
      };
    }
    const resolution = await resolveEmailRecipients(toEntries, ctx.persona);
    if (resolution.kind === "result") return resolution.result as ToolResult;
    const resolved = resolution.recipients;
    const recipients = resolved.map((r) => r.email);
    const recipientLabels = resolved.map(recipientLabel);
    if (recipients.length === 0) {
      return {
        ok: false,
        errorCode: "invalid_recipients",
        errorMessage:
          "I couldn't turn those recipients into email addresses — give me a person's name from the roster or CRM, or a full email address.",
      };
    }
    const mode = input.mode === "send" ? "send" : input.mode === "draft" || input.mode === undefined ? "draft" : null;
    if (!mode) {
      return { ok: false, errorCode: "invalid_mode", errorMessage: "mode must be 'draft' or 'send'." };
    }

    // ---- resolve the caller's OWN documents --------------------------
    const ownDocs = (
      await db
        .select()
        .from(atelierPersonDocuments)
        .where(
          and(
            eq(atelierPersonDocuments.personType, person.workerType),
            eq(atelierPersonDocuments.personId, person.id),
            isNull(atelierPersonDocuments.deletedAt),
          ),
        )
        .orderBy(desc(atelierPersonDocuments.uploadedAt))
    ).filter((d) => d.kind !== "profile_photo" && d.kind !== "biography");

    let selected: PersonDocRow[] = [];
    const ids = Array.isArray(input.documentIds)
      ? [...new Set(input.documentIds.map((v) => String(v)).filter(Boolean))]
      : [];
    // Task #846 — cross-domain handoff to the COMPANY document flow.
    // Self-only chat roles (employee/contractor) NEVER gain library
    // access through this path; everyone else's library visibility is
    // still ACL-filtered by canSeeDocument inside the shared loader
    // and re-checked by the company tool itself.
    const selfOnly = SELF_ONLY_CHAT_ROLES.has(ctx.persona.role);
    const tryLibraryHandoff = async (terms: string[]): Promise<ToolResult | null> => {
      if (selfOnly) return null;
      const lib = await loadVisibleLibraryPairs(ctx);
      if (!lib || lib.length === 0) return null;
      const { matchLibraryDocuments } = await import("./document-email-shared.js");
      const res = resolveTermsUnique(terms, (t) => matchLibraryDocuments(lib, t), (p) => p.doc.id);
      if (res.kind === "all") {
        const entry = findByToolName("email_company_documents");
        if (!entry) return null;
        const r = (await entry.run(
          handoffEmailInput(input as Record<string, unknown>, res.hits.map((p) => p.doc.id)),
          ctx,
        )) as ToolResult;
        if (r && r.ok && (r as { confirmation?: { summary?: string } }).confirmation) {
          const conf = (r as { confirmation: { summary?: string } }).confirmation;
          conf.summary = `These matched COMPANY documents in the Document Library, not your personal documents. ${conf.summary ?? ""}`.trim();
        }
        return r;
      }
      if (res.kind === "ambiguous") {
        const options = res.matches.slice(0, 6).map(({ doc, version }) => ({
          id: doc.id,
          label: doc.title,
          secondary: [doc.docKind, version?.fileName, "company document"].filter(Boolean).join(" — "),
        }));
        return {
          ok: true,
          data: {
            prompt: `"${res.term}" matched several COMPANY documents in the Document Library (not your personal documents) — which one should I email? Re-run email_company_documents with the exact documentIds.`,
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "document", options },
        };
      }
      return null;
    };

    if (ids.length > 0) {
      const byId = new Map(ownDocs.map((d) => [d.id, d]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        // Task #846 — the ids may be LIBRARY doc ids (picked off a
        // cross-domain options card). If ALL of them are visible
        // library docs, hand off to the company flow.
        if (!selfOnly) {
          const lib = await loadVisibleLibraryPairs(ctx);
          const libIds = new Set((lib ?? []).map((p) => p.doc.id));
          if (ids.every((id) => libIds.has(id))) {
            const entry = findByToolName("email_company_documents");
            if (entry) {
              return (await entry.run(
                handoffEmailInput(input as Record<string, unknown>, ids),
                ctx,
              )) as ToolResult;
            }
          }
        }
        return {
          ok: false,
          errorCode: "doc_not_found",
          errorMessage: `Document ${missing[0]} was not found on your record. Use my_documents to list yours.`,
        };
      }
      selected = ids.map((id) => byId.get(id)!);
    } else {
      const query = String(input.query ?? "").trim();
      if (!query) {
        return {
          ok: false,
          errorCode: "doc_not_found",
          errorMessage:
            ownDocs.length === 0
              ? "You have no personal documents on file yet — add them under Me → Documents first."
              : `Which document should I email? You have: ${ownDocs.map((d) => `"${d.title}" (${d.kind})`).join(", ")}.`,
        };
      }
      // Multi-doc queries: split on "and", "+", "," (shared with the
      // company tool — Task #846).
      const terms = splitDocQueryTerms(query);
      // Deterministic ownership cue: "our/company/the library" (without
      // a personal cue) means the caller almost certainly wants a
      // COMPANY document — probe the library first (never for
      // self-only roles).
      if (hasCompanyDocCue(query) && !hasPersonalDocCue(query)) {
        const handoff = await tryLibraryHandoff(terms);
        if (handoff) return handoff;
      }
      const seen = new Set<string>();
      for (const term of terms) {
        const matches = matchOwnDocuments(ownDocs, term);
        if (matches.length === 0) {
          // Task #846 — before dead-ending, probe the Document Library
          // (ACL-filtered; self-only roles skip this entirely).
          const handoff = await tryLibraryHandoff(terms);
          if (handoff) return handoff;
          const ownList =
            ownDocs.length === 0
              ? "You have no personal documents on file yet — add them under Me → Documents first."
              : `You have: ${ownDocs.map((d) => `"${d.title}" (${d.kind})`).join(", ")}.`;
          return {
            ok: false,
            errorCode: "doc_not_found",
            errorMessage: selfOnly
              ? ownDocs.length === 0
                ? ownList
                : `No document of yours matches "${term}". ${ownList}`
              : `No document matching "${term}" was found — I checked both your personal documents and the company Document Library. ${ownList}`,
          };
        }
        if (matches.length > 1) {
          return {
            ok: true,
            data: {
              prompt: `You have ${matches.length} documents matching "${term}" — which one should I email? Re-run with the exact documentIds.`,
              options: matches.map(docOptionWire),
              // Not a commit — nothing was emailed; explicit null keeps the
              // Task #511 navigateTo contract satisfied.
              navigateTo: null,
            },
          };
        }
        if (!seen.has(matches[0].id)) {
          seen.add(matches[0].id);
          selected.push(matches[0]);
        }
      }
    }
    if (selected.length === 0) {
      return { ok: false, errorCode: "doc_not_found", errorMessage: "No documents selected." };
    }

    // ---- file availability + size guard (~3 MB per attachment) -------
    for (const d of selected) {
      if (!d.fileRef) {
        return {
          ok: false,
          errorCode: "file_missing",
          errorMessage: `"${d.title}" has no stored file that can be attached.`,
        };
      }
      const tooBig = [
        { label: d.fileName ?? d.title, size: d.sizeBytes ?? 0 },
        ...(d.backFileRef ? [{ label: d.backFileName ?? `${d.title} (back)`, size: d.backSizeBytes ?? 0 }] : []),
      ].find((f) => f.size > MAIL_ATTACH_MAX_BYTES);
      if (tooBig) {
        return {
          ok: false,
          errorCode: "attachment_too_large",
          errorMessage: `"${tooBig.label}" is ${(tooBig.size / (1024 * 1024)).toFixed(1)} MB — email attachments from chat are limited to 3 MB per file. Attach it manually from Outlook instead.`,
        };
      }
    }

    // ---- Microsoft connection must exist BEFORE the confirm card -----
    const [conn] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, subject.user.id))
      .limit(1);
    if (!conn) {
      return {
        ok: false,
        errorCode: "ms_not_connected",
        errorMessage:
          "Your Microsoft 365 account isn't connected, so I can't use your Outlook mailbox. Connect it from Me → Settings → Microsoft 365, then try again.",
      };
    }

    const docSummary = selected
      .map((d) => `"${d.title}"${d.kind === "national_id" && d.backFileRef ? " (front + back)" : ""}`)
      .join(", ");
    const sideNote = selected.some(
      (d) => d.kind === "national_id" && !d.backFileRef && d.mime !== "application/pdf",
    )
      ? " Note: your national ID has no back-side scan on file — only the front will be attached."
      : "";

    // ---- two-phase confirm -------------------------------------------
    if (input.confirm !== true) {
      const diff: Record<string, unknown> =
        mode === "send"
          ? {
              send: { channel: "email", recipients, documents: selected.map((d) => d.title) },
              irreversible: true,
              typedNameRequired: recipients.join(", "),
              outboundChannel: "email",
            }
          : {
              create: {
                target: "outlook_draft",
                recipients,
                documents: selected.map((d) => d.title),
              },
            };
      return {
        ok: true,
        data: {
          preview: {
            mode,
            recipients,
            recipientLabels,
            documents: selected.map(chatDocWire),
          },
        },
        confirmation: {
          summary:
            mode === "send"
              ? `Send ${docSummary} to ${recipientLabels.join(", ")} from your Outlook mailbox now?${sideNote}`
              : `Create an Outlook draft to ${recipientLabels.join(", ")} with ${docSummary} attached, for you to review and send?${sideNote}`,
          diff,
          pending: {
            tool: "email_my_documents",
            input: {
              documentIds: selected.map((d) => d.id),
              to: recipients,
              mode,
              ...(input.subject !== undefined ? { subject: String(input.subject) } : {}),
              ...(input.message !== undefined ? { message: String(input.message) } : {}),
              confirm: true,
            },
          },
        },
      };
    }

    // ---- commit: token + scope, load bytes, call Graph ----------------
    const RECONNECT: ToolResult = {
      ok: false,
      errorCode: "ms_reconnect_required",
      errorMessage:
        "Your Microsoft 365 connection doesn't have email permission yet (it predates this feature). Disconnect and reconnect Microsoft 365 from Me → Settings, then try again.",
    };
    let accessToken: string;
    let scopes: string[];
    try {
      const { freshAccessToken } = await import("../msScheduling.js");
      const fresh = await freshAccessToken(conn);
      accessToken = fresh.accessToken;
      scopes = fresh.scopes;
    } catch (err) {
      if (err instanceof MsAuthError || err instanceof MsGraphError) return RECONNECT;
      throw err;
    }
    if (mode === "send" ? !hasMailSendScope(scopes) : !hasMailDraftScope(scopes)) {
      return RECONNECT;
    }

    const attachments: MsMailAttachment[] = [];
    for (const d of selected) {
      const front = await loadPersonDocBytes(d.fileRef!);
      if (!front) {
        return {
          ok: false,
          errorCode: "file_missing",
          errorMessage: `The stored file for "${d.title}" could not be loaded.`,
        };
      }
      if (front.byteLength > MAIL_ATTACH_MAX_BYTES) {
        return {
          ok: false,
          errorCode: "attachment_too_large",
          errorMessage: `"${d.fileName ?? d.title}" exceeds the 3 MB attachment limit.`,
        };
      }
      attachments.push({
        name: d.fileName || `${d.title}.pdf`,
        contentType: d.mime || "application/octet-stream",
        contentBytes: front,
      });
      if (d.backFileRef) {
        const back = await loadPersonDocBytes(d.backFileRef);
        if (!back) {
          return {
            ok: false,
            errorCode: "file_missing",
            errorMessage: `The back-side file for "${d.title}" could not be loaded.`,
          };
        }
        if (back.byteLength > MAIL_ATTACH_MAX_BYTES) {
          return {
            ok: false,
            errorCode: "attachment_too_large",
            errorMessage: `"${d.backFileName ?? `${d.title} (back)`}" exceeds the 3 MB attachment limit.`,
          };
        }
        attachments.push({
          name: d.backFileName || `${d.title} (back)`,
          contentType: d.backMime || "application/octet-stream",
          contentBytes: back,
        });
      }
    }

    const mailSubject =
      typeof input.subject === "string" && input.subject.trim()
        ? input.subject.trim().slice(0, 200)
        : `Documents from ${subject.user.name}`;
    const bodyText =
      typeof input.message === "string" && input.message.trim()
        ? input.message.trim().slice(0, 5000)
        : `Please find attached: ${selected.map((d) => d.title).join(", ")}.\n\nSent from Atelier on behalf of ${subject.user.name}.`;
    const toWire = recipients.map((email) => ({ email }));

    try {
      if (mode === "send") {
        await sendMailMessage(accessToken, {
          subject: mailSubject,
          bodyText,
          to: toWire,
          attachments,
        });
      } else {
        const draft = await createDraftMessage(accessToken, {
          subject: mailSubject,
          bodyText,
          to: toWire,
          attachments,
        });
        await audit({
          subject,
          entityType: "person_document",
          entityId: selected[0].id,
          action: "person_document.self_emailed",
          payload: {
            mode,
            documentIds: selected.map((d) => d.id),
            recipients,
            draftId: draft.id,
            via: "chat",
          },
          summary: `${subject.user.name} drafted an Outlook email with their ${selected.map((d) => d.kind).join(", ")} document(s) attached`,
        });
        return {
          ok: true,
          data: {
            mode: "draft",
            label: "Outlook draft created — review and send it from Outlook",
            documents: selected.map((d) => d.title).join(", "),
            recipients: recipients.join(", "),
            outlookDraftLink: draft.webLink ?? null,
            // Task #785 — fallback lands on a real page (/me/profile).
            href: draft.webLink ?? "/me/profile",
            navigateTo: null,
          },
        };
      }
    } catch (err) {
      if (err instanceof MsGraphError) {
        if (err.status === 401 || err.status === 403) return RECONNECT;
        if (err.status === 413) {
          return {
            ok: false,
            errorCode: "attachment_too_large",
            errorMessage: "Outlook rejected the message because the attachments are too large.",
          };
        }
        return {
          ok: false,
          errorCode: "ms_graph_error",
          errorMessage: `Outlook returned an error (${err.status}) — the ${mode === "send" ? "email was not sent" : "draft was not created"}. Try again shortly.`,
        };
      }
      if (err instanceof MsAuthError) return RECONNECT;
      throw err;
    }

    await audit({
      subject,
      entityType: "person_document",
      entityId: selected[0].id,
      action: "person_document.self_emailed",
      payload: {
        mode,
        documentIds: selected.map((d) => d.id),
        recipients,
        via: "chat",
      },
      summary: `${subject.user.name} emailed their ${selected.map((d) => d.kind).join(", ")} document(s) from their Outlook mailbox`,
    });
    return {
      ok: true,
      data: {
        mode: "sent",
        label: `Email sent to ${recipients.join(", ")}`,
        documents: selected.map((d) => d.title).join(", "),
        recipients: recipients.join(", "),
        navigateTo: null,
      },
    };
  },
});
