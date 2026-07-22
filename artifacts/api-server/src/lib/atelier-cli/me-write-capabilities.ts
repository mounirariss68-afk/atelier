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

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierPersons,
  atelierLeaveRequests,
  atelierExpenses,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierTimesheetSignals,
  atelierPersonDocuments,
  atelierSelfNotifications,
  atelierAuditEvents,
} from "@workspace/db";
import { z } from "zod";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  type CapabilityInput,
} from "./capability-catalog.js";
import { resolveSelfSubject, type SelfSubject } from "./me-capabilities.js";
import { loadAttachment, loadAttachmentBytes } from "./attachments/index.js";
import { storePersonDocBytes } from "../personDocStorage.js";
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
import { lookupMerchantMemory } from "../atelier-expense-categorizer.js";
import { writePersonAndSync } from "../atelier-person-sync";
import type { ToolContext, ToolResult } from "./index.js";

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO_DATE.test(s);
}

async function audit(args: {
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

const NO_ROSTER: ToolResult = {
  ok: false,
  errorCode: "no_roster_record",
  errorMessage:
    "Your login is not linked to an employee or contractor record yet. Ask HR to link your profile.",
};

type SelfWriteInput = Omit<
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
function defineSelfWriteCapability(entry: SelfWriteInput): void {
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
    const amount = Number(input.amount);
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
    const currency = String(input.currency ?? "USD").toUpperCase().slice(0, 3);
    const contextType = input.contextType === "internal" ? "internal" : "bd";
    const internalProjectLabel =
      contextType === "internal" && typeof input.internalProjectLabel === "string"
        ? input.internalProjectLabel.slice(0, 200)
        : null;

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
      receiptFileRef,
      receiptEncryptedAtRest: !!receiptFileRef,
      summary:
        (typeof input.description === "string" && input.description) || merchant,
      status: "draft",
      policyStatus: "green",
      createdByUserId: subject.user.id,
    });
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
// me.timesheet_log — add a timesheet entry (mirrors POST week entries)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.timesheet_log",
  module: "roster",
  toolName: "log_my_time",
  description:
    "Log hours on the signed-in user's own timesheet for a given date. The ISO week is derived server-side from the date; locked (submitted/approved) weeks are refused.",
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
    const { weekIso } = isoWeekOf(new Date(`${workDate}T00:00:00Z`));
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { workDate, hours, weekIso } },
        confirmation: {
          summary: `Log ${hours}h on ${workDate} (week ${weekIso}) to your timesheet?`,
          diff: {
            create: {
              table: "atelier_timesheet_entries",
              values: { workDate, hours, weekIso },
            },
          },
          pending: { tool: "log_my_time", input: { ...input, confirm: true } },
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
      engagementId: null,
      activityCode: "internal",
      hours,
      billable: false,
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
        label: `${hours}h on ${workDate}`,
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
  resultCard: "entity_card",
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
          .map(chatDocWire),
        href: "/me/documents",
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

defineSelfWriteCapability({
  id: "me.document_save",
  module: "roster",
  toolName: "save_my_document",
  description:
    "Save a file uploaded in this chat as one of the signed-in user's personal documents (passport, national ID, residency, visa, other). National ID cards need both sides: pass a front and a back attachment, or a single combined PDF.",
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
          "National ID cards need both sides: upload the back too and pass it as the back attachment, or provide a single combined PDF.",
      };
    }
    let back: { fileName: string; mime: string; buf: Buffer } | null = null;
    if (backId) {
      const b = await loadOwnAttachmentBytes(backId, ctx);
      if (!b.ok) return b.error;
      back = b;
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            kind,
            title,
            fileName: front.fileName,
            backFileName: back?.fileName ?? null,
            sides:
              kind === "national_id"
                ? back
                  ? "front_back"
                  : "combined"
                : null,
          },
        },
        confirmation: {
          summary: `Save ${front.fileName}${back ? ` + ${back.fileName}` : ""} as your ${kind} document "${title}"?`,
          diff: {
            create: {
              table: "atelier_person_documents",
              values: { kind, title, fileName: front.fileName },
            },
          },
          pending: { tool: "save_my_document", input: { ...input, confirm: true } },
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
        docNumber: input.docNumber ? String(input.docNumber).slice(0, 100) : null,
        issuedAt: isIsoDate(input.issuedAt) ? input.issuedAt : null,
        issuingCountry: input.issuingCountry
          ? String(input.issuingCountry).slice(0, 100)
          : null,
        expiresAt: isIsoDate(input.expiresAt)
          ? new Date(`${input.expiresAt}T00:00:00Z`)
          : null,
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
      payload: { kind, title, hasBackFile: !!backFileRef, via: "chat" },
      summary: `${subject.user.name} added their own ${kind} document "${title}"`,
    });
    return {
      ok: true,
      data: {
        ...chatDocWire(doc),
        label: title,
        href: "/me/documents",
        navigateTo: { path: "/me/documents", when: "on_commit" as const },
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
      return {
        ok: false,
        errorCode: "doc_not_found",
        errorMessage: "That document was not found on your record.",
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
        href: "/me/documents",
        navigateTo: { path: "/me/documents", when: "on_commit" as const },
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
