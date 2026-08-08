/**
 * Task #795 — chat-parity WRITE capabilities for the remaining /me
 * self-service actions: leave cancel, expense edit/delete, dependents,
 * emergency contacts, travel profile, learning complete, timesheet
 * entry delete.
 *
 * Same security model as me-write-capabilities.ts: every tool goes
 * through `defineSelfWriteCapability`, so the subject is ALWAYS the
 * authenticated session persona, input schemas carry NO person/user
 * selector, every write mirrors the /me/* REST route's validation +
 * guards, and all writes are two-phase confirm. The route ↔ capability
 * mapping is pinned in me-chat-parity.ts and enforced by the route
 * lint.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierLeaveRequests,
  atelierExpenses,
  atelierEmployees,
  atelierContractors,
  atelierDependents,
  atelierEmergencyContacts,
  atelierTrainingMaterials,
  atelierTrainingCompletions,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierPersonDocuments,
} from "@workspace/db";
import {
  defineSelfWriteCapability,
  selfWriteAudit as audit,
  NO_ROSTER,
} from "./me-write-capabilities.js";
import type { SelfSubject } from "./me-capabilities.js";
import type { ToolResult } from "./index.js";
import { convertToUsd } from "../atelier-fx.js";
import { clearLeaveOoo } from "../atelierLeaveOoo.js";
import { recomputeWeekTotals } from "../../routes/atelier/ledgerRoutes.js";
import {
  zTravelProfile,
  travelProfileToWire,
  CABIN_CLASSES,
  SEAT_PREFERENCES,
  type TravelProfile,
} from "../atelier-travel-profile.js";

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO_DATE.test(s);
}

function str(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

// ---------------------------------------------------------------------
// me.leave_cancel — cancel/revoke an own leave request
// (mirrors POST /me/leave/:id/cancel)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.leave_cancel",
  module: "roster",
  toolName: "cancel_my_leave",
  description:
    "Cancel one of the signed-in user's own leave requests (pending requests are cancelled; approved leave is revoked and any Outlook out-of-office is cleared). Pass leaveId from my_leave, or startDate to pick by date.",
  slashAliases: { en: ["/cancel-leave"], fr: ["/annuler-conge"] },
  representativePrompts: {
    en: ["Cancel my leave request", "Cancel my leave starting next Monday"],
    ar: ["ألغِ طلب إجازتي"],
    fr: ["Annuler ma demande de congé"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Cancel my leave request for 2026-09-01"],
    ar: ["ألغِ طلب إجازتي"],
    fr: ["Annuler ma demande de congé"],
  },
  inputSchema: {
    type: "object",
    properties: {
      leaveId: { type: "string", description: "Id of the leave request (from my_leave)." },
      startDate: { type: "string", description: "ISO start date to pick the request by date." },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const rows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, subject.user.orgId),
          eq(atelierLeaveRequests.userId, subject.user.id),
          inArray(atelierLeaveRequests.status, ["pending", "approved"]),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierLeaveRequests.startDate));
    let candidates = rows;
    if (typeof input.leaveId === "string" && input.leaveId.trim()) {
      candidates = rows.filter((r) => r.id === input.leaveId);
    } else if (isIsoDate(input.startDate)) {
      candidates = rows.filter((r) => r.startDate === input.startDate);
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          rows.length === 0
            ? "You have no pending or approved leave requests to cancel."
            : "I couldn't match that to one of your pending or approved leave requests.",
      };
    }
    if (candidates.length > 1) {
      const options = candidates.map((r) => ({
        id: r.id,
        label: `${r.leaveType} leave ${r.startDate} → ${r.endDate}`,
        secondary: `${r.status} · ${r.workingDays} working day(s)`,
      }));
      return {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: { kind: "leave_request", field: "leaveId", options },
      };
    }
    const row = candidates[0];
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: row.id, status: row.status, startDate: row.startDate, endDate: row.endDate } },
        confirmation: {
          summary:
            row.status === "approved"
              ? `Revoke your APPROVED ${row.leaveType} leave ${row.startDate} → ${row.endDate}? Any Outlook out-of-office will be cleared.`
              : `Cancel your pending ${row.leaveType} leave request ${row.startDate} → ${row.endDate}?`,
          diff: {
            update: {
              table: "atelier_leave_requests",
              id: row.id,
              changes: { status: { from: row.status, to: "cancelled" } },
            },
          },
          pending: { tool: "cancel_my_leave", input: { leaveId: row.id, confirm: true } },
        },
      };
    }
    const wasApproved = row.status === "approved";
    await db
      .update(atelierLeaveRequests)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierLeaveRequests.id, row.id));
    await audit({
      subject,
      entityType: "leave_request",
      entityId: row.id,
      action: wasApproved ? "leave.revoke" : "leave.cancel",
      payload: { previousStatus: row.status, via: "chat" },
      summary: `${subject.user.name} ${wasApproved ? "revoked approved" : "cancelled"} leave ${row.startDate} → ${row.endDate}`,
    });
    // Mirror the REST route — approved leave clears its Outlook OOF.
    if (wasApproved) setImmediate(() => void clearLeaveOoo(row.id, "revoke"));
    return {
      ok: true,
      data: {
        id: row.id,
        label: `${wasApproved ? "Revoked" : "Cancelled"} ${row.leaveType} leave ${row.startDate} → ${row.endDate}`,
        status: "cancelled",
        href: "/me/leave",
        navigateTo: { path: "/me/leave", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// Expense edit + delete — shared own-draft resolver
// (mirrors PATCH/DELETE /me/expenses/:id — draft/rejected only)
// ---------------------------------------------------------------------
type ExpenseRow = typeof atelierExpenses.$inferSelect;

async function resolveOwnEditableExpense(
  subject: SelfSubject,
  input: Record<string, unknown>,
  toolName: string,
): Promise<{ row: ExpenseRow } | { result: ToolResult }> {
  const rows = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.orgId, subject.user.orgId),
        eq(atelierExpenses.personId, subject.user.id),
        inArray(atelierExpenses.status, ["draft", "rejected"]),
        isNull(atelierExpenses.deletedAt),
      ),
    )
    .orderBy(desc(atelierExpenses.createdAt));
  let candidates = rows;
  if (typeof input.expenseId === "string" && input.expenseId.trim()) {
    candidates = rows.filter((r) => r.id === input.expenseId);
  } else if (typeof input.matchMerchant === "string" && input.matchMerchant.trim()) {
    const q = input.matchMerchant.trim().toLowerCase();
    candidates = rows.filter((r) => (r.merchant ?? "").toLowerCase().includes(q));
  }
  if (candidates.length === 0) {
    return {
      result: {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          rows.length === 0
            ? "You have no draft or rejected expense claims — submitted expenses can no longer be changed from chat."
            : "I couldn't match that to one of your draft or rejected expense claims.",
      },
    };
  }
  if (candidates.length > 1) {
    const options = candidates.slice(0, 8).map((r) => ({
      id: r.id,
      label: `${r.merchant ?? "Expense"} — ${r.amount} ${r.currency}`,
      secondary: `${r.expenseDate} · ${r.status}`,
    }));
    return {
      result: {
        ok: true,
        data: { options, navigateTo: null },
        // `field` rides along for clients that merge the pick back into
        // the pending input (same shape the other me.* writes emit).
        disambiguation: { kind: "expense", field: "expenseId", options } as ToolResult["disambiguation"],
      },
    };
  }
  return { row: candidates[0] };
}

defineSelfWriteCapability({
  id: "me.expense_update",
  module: "roster",
  toolName: "update_my_expense",
  description:
    "Edit one of the signed-in user's own DRAFT (or rejected) expense claims: amount, currency, merchant, date, or description. Submitted claims cannot be edited. Pass expenseId from my_expenses, or matchMerchant to pick by merchant name.",
  slashAliases: { en: ["/edit-expense"], fr: ["/modifier-depense"] },
  representativePrompts: {
    en: ["Change that taxi expense to 60 dollars", "Fix the date on my hotel expense"],
    ar: ["عدّل مصروف التاكسي"],
    fr: ["Modifier ma dépense de taxi"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Change my taxi expense amount to 60 USD"],
    ar: ["عدّل مصروف التاكسي"],
    fr: ["Modifier ma dépense de taxi"],
  },
  inputSchema: {
    type: "object",
    properties: {
      expenseId: { type: "string" },
      matchMerchant: { type: "string", description: "Merchant name to find the claim by." },
      amount: { type: "number" },
      currency: { type: "string", description: "3-letter code" },
      merchant: { type: "string", description: "New merchant name" },
      expenseDate: { type: "string", description: "New ISO date" },
      description: { type: "string", description: "New description (empty string clears it)" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const resolved = await resolveOwnEditableExpense(subject, input, "update_my_expense");
    if ("result" in resolved) {
      // Keep the pending edit fields on the disambiguation reprompt.
      return resolved.result;
    }
    const row = resolved.row;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.merchant !== undefined) {
      const merchant = str(input.merchant, 200);
      if (!merchant)
        return { ok: false, errorCode: "merchant_required", errorMessage: "Merchant cannot be empty." };
      if (merchant !== row.merchant) {
        patch.merchant = merchant;
        changes.merchant = { from: row.merchant, to: merchant };
      }
    }
    if (input.description !== undefined) {
      const d = String(input.description).slice(0, 2000);
      const desc = d.trim() ? d : null;
      if (desc !== (row.description ?? null)) {
        patch.description = desc;
        changes.description = { from: row.description ?? null, to: desc };
      }
    }
    if (input.expenseDate !== undefined) {
      if (!isIsoDate(input.expenseDate))
        return { ok: false, errorCode: "invalid_date", errorMessage: "Provide the date as YYYY-MM-DD." };
      if (input.expenseDate !== row.expenseDate) {
        patch.expenseDate = input.expenseDate;
        changes.expenseDate = { from: row.expenseDate, to: input.expenseDate };
      }
    }
    // Amount/currency/date changes recompute FX pinned to the expense
    // date — exact mirror of the REST PATCH (Task #757 parity).
    if (input.amount !== undefined || input.currency !== undefined || patch.expenseDate !== undefined) {
      const amount = input.amount !== undefined ? Number(input.amount) : row.amount;
      const currency =
        input.currency !== undefined ? String(input.currency).toUpperCase().slice(0, 3) : row.currency;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
        return {
          ok: false,
          errorCode: "invalid_amount",
          errorMessage: "Amount must be a positive number up to 1,000,000.",
        };
      }
      if (amount !== row.amount) changes.amount = { from: row.amount, to: amount };
      if (currency !== row.currency) changes.currency = { from: row.currency, to: currency };
      const dateStr = (patch.expenseDate as string | undefined) ?? row.expenseDate;
      const fx = await convertToUsd(amount, currency, dateStr);
      patch.amount = amount;
      patch.currency = currency;
      patch.fxRate = fx.rate;
      patch.fxRateDate = fx.rateDate;
      patch.usdAmount = +fx.usdAmount.toFixed(2);
    }
    if (Object.keys(changes).length === 0) {
      return {
        ok: false,
        errorCode: "nothing_to_change",
        errorMessage:
          "Nothing to change — tell me the new amount, currency, merchant, date, or description.",
      };
    }
    // Task #757 — display summary follows manual edits only when no
    // auditor-composed summary exists.
    if (!row.auditorRunId && (input.description !== undefined || input.merchant !== undefined)) {
      const desc =
        patch.description !== undefined ? (patch.description as string | null) : row.description;
      const merch = (patch.merchant as string | undefined) ?? row.merchant;
      patch.summary = (desc && desc.trim()) || merch || row.summary;
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: row.id, changes } },
        confirmation: {
          summary: `Update your ${row.merchant ?? "expense"} claim (${Object.keys(changes).join(", ")})?`,
          diff: { update: { table: "atelier_expenses", id: row.id, changes } },
          pending: {
            tool: "update_my_expense",
            input: { ...input, expenseId: row.id, confirm: true },
          },
        },
      };
    }
    const [updated] = await db
      .update(atelierExpenses)
      .set(patch)
      .where(eq(atelierExpenses.id, row.id))
      .returning();
    await audit({
      subject,
      entityType: "expense",
      entityId: row.id,
      action: "expense.self_updated",
      payload: { changes, via: "chat" },
      summary: `${subject.user.name} edited expense ${updated.merchant ?? row.id} (${Object.keys(changes).join(", ")})`,
    });
    return {
      ok: true,
      data: {
        id: row.id,
        label: `Updated ${updated.merchant ?? "expense"} — ${updated.amount} ${updated.currency}`,
        status: updated.status,
        href: "/me/expenses",
        navigateTo: { path: "/me/expenses", when: "on_commit" as const },
      },
    };
  },
});

defineSelfWriteCapability({
  id: "me.expense_delete",
  module: "roster",
  toolName: "delete_my_expense",
  description:
    "Delete one of the signed-in user's own DRAFT (or rejected) expense claims. Submitted claims cannot be deleted. Pass expenseId from my_expenses, or matchMerchant to pick by merchant name.",
  slashAliases: { en: ["/delete-expense"], fr: ["/supprimer-depense"] },
  representativePrompts: {
    en: ["Delete that draft taxi expense", "Remove my duplicate hotel claim"],
    ar: ["احذف مصروف التاكسي"],
    fr: ["Supprimer ma dépense de taxi"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Delete my draft taxi expense"],
    ar: ["احذف مصروف التاكسي"],
    fr: ["Supprimer ma dépense de taxi"],
  },
  inputSchema: {
    type: "object",
    properties: {
      expenseId: { type: "string" },
      matchMerchant: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const resolved = await resolveOwnEditableExpense(subject, input, "delete_my_expense");
    if ("result" in resolved) return resolved.result;
    const row = resolved.row;
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: row.id, merchant: row.merchant, amount: row.amount, currency: row.currency } },
        confirmation: {
          summary: `Delete your ${row.status} expense claim ${row.merchant ?? row.id} — ${row.amount} ${row.currency} (${row.expenseDate})?`,
          diff: {
            delete: {
              table: "atelier_expenses",
              id: row.id,
              label: `${row.merchant ?? "Expense"} ${row.amount} ${row.currency}`,
            },
          },
          pending: { tool: "delete_my_expense", input: { expenseId: row.id, confirm: true } },
        },
      };
    }
    await db
      .update(atelierExpenses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierExpenses.id, row.id));
    await audit({
      subject,
      entityType: "expense",
      entityId: row.id,
      action: "expense.self_deleted",
      payload: { merchant: row.merchant, amount: row.amount, currency: row.currency, via: "chat" },
      summary: `${subject.user.name} deleted draft expense ${row.merchant ?? row.id}`,
    });
    return {
      ok: true,
      data: {
        id: row.id,
        label: `Deleted ${row.merchant ?? "expense"} — ${row.amount} ${row.currency}`,
        href: "/me/expenses",
        navigateTo: { path: "/me/expenses", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// Dependents — save (create/edit) + remove
// (mirrors POST/PATCH/DELETE /me/dependents)
// ---------------------------------------------------------------------
const RELATIONSHIPS = new Set(["spouse", "child", "parent", "other"]);

async function ownDependents(subject: SelfSubject) {
  const p = subject.person!;
  return db
    .select()
    .from(atelierDependents)
    .where(
      and(
        eq(atelierDependents.personType, p.workerType),
        eq(atelierDependents.personId, p.id),
        isNull(atelierDependents.deletedAt),
      ),
    )
    .orderBy(desc(atelierDependents.createdAt));
}

defineSelfWriteCapability({
  id: "me.dependent_save",
  module: "roster",
  toolName: "save_my_dependent",
  description:
    "Add or update a dependent (spouse, child, parent, other) on the signed-in user's own record. Pass dependentId to edit an existing one; otherwise a new dependent is created (fullName + relationship required).",
  slashAliases: { en: ["/add-dependent"], fr: ["/ajouter-dependant"] },
  representativePrompts: {
    en: ["Add my daughter Maya as a dependent", "Update my spouse's nationality"],
    ar: ["أضف ابنتي كمُعالة"],
    fr: ["Ajouter ma fille comme personne à charge"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Add my daughter Maya (born 2019-04-02) as a dependent"],
    ar: ["أضف ابنتي كمُعالة"],
    fr: ["Ajouter ma fille comme personne à charge"],
  },
  inputSchema: {
    type: "object",
    properties: {
      dependentId: { type: "string", description: "Existing dependent id (to edit)." },
      fullName: { type: "string" },
      relationship: { type: "string", enum: ["spouse", "child", "parent", "other"] },
      dateOfBirth: { type: "string", description: "ISO date YYYY-MM-DD" },
      nationality: { type: "string", description: "2-letter country code" },
      notes: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    if (!subject.person) return NO_ROSTER;
    const existing = await ownDependents(subject);
    let target: (typeof existing)[number] | null = null;
    if (typeof input.dependentId === "string" && input.dependentId.trim()) {
      target = existing.find((d) => d.id === input.dependentId) ?? null;
      if (!target) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: "That dependent was not found on your record.",
        };
      }
    }
    if (input.dateOfBirth !== undefined && input.dateOfBirth !== null && !isIsoDate(input.dateOfBirth)) {
      return { ok: false, errorCode: "invalid_date", errorMessage: "Date of birth must be YYYY-MM-DD." };
    }
    if (input.nationality !== undefined && str(input.nationality, 10).length > 2) {
      return {
        ok: false,
        errorCode: "invalid_nationality",
        errorMessage: "Nationality must be a 2-letter country code (e.g. AE, MA).",
      };
    }
    const fullName = input.fullName !== undefined ? str(input.fullName, 200) : undefined;
    const relationship =
      input.relationship !== undefined ? String(input.relationship).toLowerCase() : undefined;
    if (relationship !== undefined && !RELATIONSHIPS.has(relationship)) {
      return {
        ok: false,
        errorCode: "invalid_relationship",
        errorMessage: "Relationship must be spouse, child, parent, or other.",
      };
    }
    if (!target) {
      // CREATE — require the same mandatory fields as the REST route.
      if (!fullName || !relationship) {
        return {
          ok: false,
          errorCode: "missing_fields",
          errorMessage: "To add a dependent I need their full name and relationship (spouse/child/parent/other).",
        };
      }
      // Duplicate-name guard: editing an existing same-named dependent is
      // almost always what's wanted — surface it instead of duplicating.
      const dupe = existing.find(
        (d) => d.fullName.trim().toLowerCase() === fullName.trim().toLowerCase(),
      );
      if (dupe && input.confirm !== true) {
        target = dupe;
      }
    }
    const values = {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(relationship !== undefined ? { relationship } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: (input.dateOfBirth as string | null) ?? null } : {}),
      ...(input.nationality !== undefined ? { nationality: input.nationality ? String(input.nationality).toUpperCase() : null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ? String(input.notes).slice(0, 2000) : null } : {}),
    };
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { mode: target ? "update" : "create", values } },
        confirmation: {
          summary: target
            ? `Update dependent ${target.fullName} (${Object.keys(values).join(", ")})?`
            : `Add ${fullName} (${relationship}) as your dependent?`,
          diff: target
            ? { update: { table: "atelier_dependents", id: target.id, changes: values } }
            : { create: { table: "atelier_dependents", values } },
          pending: {
            tool: "save_my_dependent",
            input: { ...input, ...(target ? { dependentId: target.id } : {}), confirm: true },
          },
        },
      };
    }
    if (target) {
      if (Object.keys(values).length === 0) {
        return { ok: false, errorCode: "nothing_to_change", errorMessage: "Nothing to change on that dependent." };
      }
      const [row] = await db
        .update(atelierDependents)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(atelierDependents.id, target.id))
        .returning();
      await audit({
        subject,
        entityType: "dependent",
        entityId: target.id,
        action: "person.dependent.updated",
        payload: { fields: Object.keys(values), via: "chat" },
        summary: `${subject.user.name} updated dependent ${row.fullName}`,
      });
      return {
        ok: true,
        data: {
          id: row.id,
          label: `Updated dependent ${row.fullName}`,
          href: "/me/profile",
          navigateTo: { path: "/me/profile", when: "on_commit" as const },
        },
      };
    }
    const id = rid("dep");
    const [row] = await db
      .insert(atelierDependents)
      .values({
        id,
        orgId: subject.user.orgId,
        personType: subject.person.workerType,
        personId: subject.person.id,
        fullName: fullName!,
        relationship: relationship!,
        dateOfBirth: (values as { dateOfBirth?: string | null }).dateOfBirth ?? null,
        nationality: (values as { nationality?: string | null }).nationality ?? null,
        notes: (values as { notes?: string | null }).notes ?? null,
        createdByUserId: subject.user.id,
      })
      .returning();
    await audit({
      subject,
      entityType: "dependent",
      entityId: id,
      action: "person.dependent.created",
      payload: { fullName, relationship, via: "chat" },
      summary: `${subject.user.name} added dependent ${fullName}`,
    });
    return {
      ok: true,
      data: {
        id: row.id,
        label: `Added dependent ${row.fullName} (${row.relationship})`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

defineSelfWriteCapability({
  id: "me.dependent_delete",
  module: "roster",
  toolName: "remove_my_dependent",
  description:
    "Remove a dependent from the signed-in user's own record (their document scans are removed too). Pass dependentId, or fullName to match by name.",
  slashAliases: { en: ["/remove-dependent"], fr: ["/retirer-dependant"] },
  representativePrompts: {
    en: ["Remove my dependent Maya"],
    ar: ["احذف المُعالة"],
    fr: ["Retirer une personne à charge"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Remove Maya from my dependents"],
    ar: ["احذف المُعالة"],
    fr: ["Retirer une personne à charge"],
  },
  inputSchema: {
    type: "object",
    properties: {
      dependentId: { type: "string" },
      fullName: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    if (!subject.person) return NO_ROSTER;
    const existing = await ownDependents(subject);
    let candidates = existing;
    if (typeof input.dependentId === "string" && input.dependentId.trim()) {
      candidates = existing.filter((d) => d.id === input.dependentId);
    } else if (typeof input.fullName === "string" && input.fullName.trim()) {
      const q = input.fullName.trim().toLowerCase();
      candidates = existing.filter((d) => d.fullName.toLowerCase().includes(q));
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          existing.length === 0
            ? "You have no dependents on your record."
            : "I couldn't match that to one of your dependents.",
      };
    }
    if (candidates.length > 1) {
      const options = candidates.map((d) => ({
        id: d.id,
        label: d.fullName,
        secondary: d.relationship,
      }));
      return {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: { kind: "dependent", field: "dependentId", options },
      };
    }
    const dep = candidates[0];
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: dep.id, fullName: dep.fullName, relationship: dep.relationship } },
        confirmation: {
          summary: `Remove dependent ${dep.fullName} (${dep.relationship})? Their document scans will be removed too.`,
          diff: { delete: { table: "atelier_dependents", id: dep.id, label: dep.fullName } },
          pending: { tool: "remove_my_dependent", input: { dependentId: dep.id, confirm: true } },
        },
      };
    }
    const now = new Date();
    await db
      .update(atelierDependents)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(atelierDependents.id, dep.id));
    // Cascade — mirror the REST route: soft-delete the dependent's docs.
    await db
      .update(atelierPersonDocuments)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(eq(atelierPersonDocuments.dependentId, dep.id), isNull(atelierPersonDocuments.deletedAt)),
      );
    await audit({
      subject,
      entityType: "dependent",
      entityId: dep.id,
      action: "person.dependent.deleted",
      payload: { fullName: dep.fullName, via: "chat" },
      summary: `${subject.user.name} removed dependent ${dep.fullName}`,
    });
    return {
      ok: true,
      data: {
        id: dep.id,
        label: `Removed dependent ${dep.fullName}`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// Emergency contacts — save (create/edit) + remove
// (mirrors POST/PATCH/DELETE /me/emergency-contacts)
// ---------------------------------------------------------------------
async function ownEmergencyContacts(subject: SelfSubject) {
  const p = subject.person!;
  return db
    .select()
    .from(atelierEmergencyContacts)
    .where(
      and(
        eq(atelierEmergencyContacts.personType, p.workerType),
        eq(atelierEmergencyContacts.personId, p.id),
        isNull(atelierEmergencyContacts.deletedAt),
      ),
    )
    .orderBy(desc(atelierEmergencyContacts.createdAt));
}

defineSelfWriteCapability({
  id: "me.emergency_contact_save",
  module: "roster",
  toolName: "save_my_emergency_contact",
  description:
    "Add or update an emergency contact on the signed-in user's own record. Pass contactId to edit; otherwise a new contact is created (name, relationship, and at least one phone required).",
  slashAliases: { en: ["/emergency-contact"], fr: ["/contact-urgence"] },
  representativePrompts: {
    en: ["Add my brother Omar as emergency contact, phone +971501234567", "Update my emergency contact's phone"],
    ar: ["أضف جهة اتصال للطوارئ"],
    fr: ["Ajouter un contact d'urgence"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Add Omar (+971501234567, brother) as my emergency contact"],
    ar: ["أضف جهة اتصال للطوارئ"],
    fr: ["Ajouter un contact d'urgence"],
  },
  inputSchema: {
    type: "object",
    properties: {
      contactId: { type: "string", description: "Existing contact id (to edit)." },
      name: { type: "string" },
      relationship: { type: "string" },
      phones: { type: "array", items: { type: "string" }, description: "1-3 phone numbers" },
      contactEmail: { type: "string", description: "Contact's email address." },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    if (!subject.person) return NO_ROSTER;
    const existing = await ownEmergencyContacts(subject);
    let target: (typeof existing)[number] | null = null;
    if (typeof input.contactId === "string" && input.contactId.trim()) {
      target = existing.find((c) => c.id === input.contactId) ?? null;
      if (!target) {
        return { ok: false, errorCode: "not_found", errorMessage: "That emergency contact was not found on your record." };
      }
    }
    const name = input.name !== undefined ? str(input.name, 200) : undefined;
    const relationship = input.relationship !== undefined ? str(input.relationship, 100) : undefined;
    let phones: string[] | undefined;
    if (input.phones !== undefined) {
      if (!Array.isArray(input.phones)) {
        return { ok: false, errorCode: "invalid_phones", errorMessage: "Phones must be a list of numbers." };
      }
      phones = input.phones.map((p) => str(p, 40)).filter((p) => p.length >= 3);
      if (phones.length < 1 || phones.length > 3) {
        return { ok: false, errorCode: "invalid_phones", errorMessage: "Provide 1-3 valid phone numbers." };
      }
    }
    const email =
      input.contactEmail !== undefined
        ? (input.contactEmail ? str(input.contactEmail, 320) : null)
        : undefined;
    if (!target) {
      // Same-named contact → edit rather than duplicate.
      if (name) {
        target = existing.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
      }
    }
    if (!target && (!name || !relationship || !phones)) {
      return {
        ok: false,
        errorCode: "missing_fields",
        errorMessage:
          "To add an emergency contact I need their name, relationship, and at least one phone number.",
      };
    }
    const values = {
      ...(name !== undefined ? { name } : {}),
      ...(relationship !== undefined ? { relationship } : {}),
      ...(phones !== undefined ? { phones } : {}),
      ...(email !== undefined ? { email } : {}),
    };
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { mode: target ? "update" : "create", values } },
        confirmation: {
          summary: target
            ? `Update emergency contact ${target.name} (${Object.keys(values).join(", ")})?`
            : `Add ${name} (${relationship}) as your emergency contact?`,
          diff: target
            ? { update: { table: "atelier_emergency_contacts", id: target.id, changes: values } }
            : { create: { table: "atelier_emergency_contacts", values } },
          pending: {
            tool: "save_my_emergency_contact",
            input: { ...input, ...(target ? { contactId: target.id } : {}), confirm: true },
          },
        },
      };
    }
    if (target) {
      if (Object.keys(values).length === 0) {
        return { ok: false, errorCode: "nothing_to_change", errorMessage: "Nothing to change on that contact." };
      }
      const [row] = await db
        .update(atelierEmergencyContacts)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(atelierEmergencyContacts.id, target.id))
        .returning();
      await audit({
        subject,
        entityType: "emergency_contact",
        entityId: target.id,
        action: "person.emergency_contact.updated",
        payload: { fields: Object.keys(values), via: "chat" },
        summary: `${subject.user.name} updated emergency contact ${row.name}`,
      });
      return {
        ok: true,
        data: {
          id: row.id,
          label: `Updated emergency contact ${row.name}`,
          href: "/me/profile",
          navigateTo: { path: "/me/profile", when: "on_commit" as const },
        },
      };
    }
    const id = rid("ec");
    const [row] = await db
      .insert(atelierEmergencyContacts)
      .values({
        id,
        orgId: subject.user.orgId,
        personType: subject.person.workerType,
        personId: subject.person.id,
        name: name!,
        relationship: relationship!,
        phones: phones!,
        email: email ?? null,
        createdByUserId: subject.user.id,
      })
      .returning();
    await audit({
      subject,
      entityType: "emergency_contact",
      entityId: id,
      action: "person.emergency_contact.created",
      payload: { name, relationship, via: "chat" },
      summary: `${subject.user.name} added emergency contact ${name}`,
    });
    return {
      ok: true,
      data: {
        id: row.id,
        label: `Added emergency contact ${row.name} (${row.relationship})`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

defineSelfWriteCapability({
  id: "me.emergency_contact_delete",
  module: "roster",
  toolName: "remove_my_emergency_contact",
  description:
    "Remove an emergency contact from the signed-in user's own record. Pass contactId, or name to match.",
  slashAliases: { en: ["/remove-emergency-contact"], fr: ["/retirer-contact-urgence"] },
  representativePrompts: {
    en: ["Remove Omar from my emergency contacts"],
    ar: ["احذف جهة اتصال الطوارئ"],
    fr: ["Retirer un contact d'urgence"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Remove Omar from my emergency contacts"],
    ar: ["احذف جهة اتصال الطوارئ"],
    fr: ["Retirer un contact d'urgence"],
  },
  inputSchema: {
    type: "object",
    properties: {
      contactId: { type: "string" },
      name: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    if (!subject.person) return NO_ROSTER;
    const existing = await ownEmergencyContacts(subject);
    let candidates = existing;
    if (typeof input.contactId === "string" && input.contactId.trim()) {
      candidates = existing.filter((c) => c.id === input.contactId);
    } else if (typeof input.name === "string" && input.name.trim()) {
      const q = input.name.trim().toLowerCase();
      candidates = existing.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          existing.length === 0
            ? "You have no emergency contacts on your record."
            : "I couldn't match that to one of your emergency contacts.",
      };
    }
    if (candidates.length > 1) {
      const options = candidates.map((c) => ({ id: c.id, label: c.name, secondary: c.relationship }));
      return {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: { kind: "emergency_contact", field: "contactId", options },
      };
    }
    const ec = candidates[0];
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: ec.id, name: ec.name } },
        confirmation: {
          summary: `Remove emergency contact ${ec.name} (${ec.relationship})?`,
          diff: { delete: { table: "atelier_emergency_contacts", id: ec.id, label: ec.name } },
          pending: { tool: "remove_my_emergency_contact", input: { contactId: ec.id, confirm: true } },
        },
      };
    }
    await db
      .update(atelierEmergencyContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierEmergencyContacts.id, ec.id));
    await audit({
      subject,
      entityType: "emergency_contact",
      entityId: ec.id,
      action: "person.emergency_contact.deleted",
      payload: { name: ec.name, via: "chat" },
      summary: `${subject.user.name} removed emergency contact ${ec.name}`,
    });
    return {
      ok: true,
      data: {
        id: ec.id,
        label: `Removed emergency contact ${ec.name}`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.travel_profile_save — merge-update the caller's travel preferences
// and loyalty programs (mirrors PUT /me/travel; EMPLOYEES ONLY).
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.travel_profile_save",
  module: "roster",
  toolName: "save_my_travel_profile",
  description:
    "Save the signed-in user's travel preferences (cabin class, seat, meal, time windows, preferred airlines/hotel chains, notes) and add airline/hotel loyalty programs. Employees only. Fields you don't pass are kept as-is (merge, not replace).",
  slashAliases: { en: ["/travel-preferences"], fr: ["/preferences-voyage"] },
  representativePrompts: {
    en: ["Set my seat preference to aisle", "Add my Emirates Skywards number"],
    ar: ["احفظ تفضيلات سفري"],
    fr: ["Enregistrer mes préférences de voyage"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Set my cabin class to business and seat to aisle"],
    ar: ["احفظ تفضيلات سفري"],
    fr: ["Enregistrer mes préférences de voyage"],
  },
  inputSchema: {
    type: "object",
    properties: {
      cabinClass: { type: "string", enum: [...CABIN_CLASSES] },
      seatPreference: { type: "string", enum: [...SEAT_PREFERENCES] },
      mealPreference: { type: "string" },
      departureTimeWindow: { type: "string" },
      arrivalTimeWindow: { type: "string" },
      notes: { type: "string" },
      preferredAirlines: { type: "array", items: { type: "string" } },
      preferredHotelChains: { type: "array", items: { type: "string" } },
      airlineProgram: {
        type: "object",
        description: "Add/replace one airline loyalty program (matched by airline code).",
        properties: {
          airlineIata: { type: "string", description: "2-letter IATA code, e.g. EK" },
          programName: { type: "string" },
          membershipNumber: { type: "string" },
          tier: { type: "string" },
        },
        required: ["airlineIata", "programName", "membershipNumber"],
        additionalProperties: false,
      },
      hotelProgram: {
        type: "object",
        description: "Add/replace one hotel loyalty program (matched by chain code).",
        properties: {
          chainCode: { type: "string", description: "2-3 letter chain code, e.g. MC" },
          programName: { type: "string" },
          membershipNumber: { type: "string" },
          tier: { type: "string" },
        },
        required: ["chainCode", "programName", "membershipNumber"],
        additionalProperties: false,
      },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    if (person.workerType !== "employee") {
      return {
        ok: false,
        errorCode: "employees_only",
        errorMessage:
          "Travel profiles are an employee feature — contractor records don't carry one.",
      };
    }
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, person.id), isNull(atelierEmployees.deletedAt)));
    if (!emp) return NO_ROSTER;
    const before: TravelProfile =
      travelProfileToWire(emp.travelProfile) ??
      zTravelProfile.parse({ airlinePrograms: [], hotelPrograms: [], preferences: {} });
    // Merge preferences.
    const prefs = { ...before.preferences };
    const changed: string[] = [];
    const prefFields = [
      "cabinClass",
      "seatPreference",
      "mealPreference",
      "departureTimeWindow",
      "arrivalTimeWindow",
      "notes",
      "preferredAirlines",
      "preferredHotelChains",
    ] as const;
    for (const f of prefFields) {
      if (input[f] === undefined) continue;
      (prefs as Record<string, unknown>)[f] = input[f];
      changed.push(f);
    }
    const airlinePrograms = [...before.airlinePrograms];
    if (input.airlineProgram && typeof input.airlineProgram === "object") {
      const p = input.airlineProgram as Record<string, unknown>;
      const code = str(p.airlineIata, 2).toUpperCase();
      const idx = airlinePrograms.findIndex((a) => a.airlineIata === code);
      const entry = {
        airlineIata: code,
        programName: str(p.programName, 120),
        membershipNumber: str(p.membershipNumber, 60),
        tier: p.tier ? str(p.tier, 60) : null,
      };
      if (idx >= 0) airlinePrograms[idx] = entry;
      else airlinePrograms.push(entry);
      changed.push("airlinePrograms");
    }
    const hotelPrograms = [...before.hotelPrograms];
    if (input.hotelProgram && typeof input.hotelProgram === "object") {
      const p = input.hotelProgram as Record<string, unknown>;
      const code = str(p.chainCode, 3).toUpperCase();
      const idx = hotelPrograms.findIndex((h) => h.chainCode === code);
      const entry = {
        chainCode: code,
        programName: str(p.programName, 120),
        membershipNumber: str(p.membershipNumber, 60),
        tier: p.tier ? str(p.tier, 60) : null,
      };
      if (idx >= 0) hotelPrograms[idx] = entry;
      else hotelPrograms.push(entry);
      changed.push("hotelPrograms");
    }
    if (changed.length === 0) {
      return {
        ok: false,
        errorCode: "nothing_to_change",
        errorMessage:
          "Nothing to save — tell me a preference (cabin, seat, meal, time windows, airlines, hotels) or a loyalty program to add.",
      };
    }
    const parsed = zTravelProfile.safeParse({ airlinePrograms, hotelPrograms, preferences: prefs });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        errorCode: "invalid_travel_profile",
        errorMessage: `That didn't validate: ${first?.path.join(".")} — ${first?.message}.`,
      };
    }
    const after = parsed.data;
    if (input.confirm !== true) {
      // Never echo full membership numbers into the confirm frame.
      const summaryBits = changed
        .filter((c, i) => changed.indexOf(c) === i)
        .join(", ");
      return {
        ok: true,
        data: { preview: { changed: summaryBits } },
        confirmation: {
          summary: `Save your travel profile (${summaryBits})?`,
          diff: {
            update: {
              table: "atelier_employees",
              id: person.id,
              changes: { travelProfile: { from: "(current)", to: `updated: ${summaryBits}` } },
            },
          },
          pending: { tool: "save_my_travel_profile", input: { ...input, confirm: true } },
        },
      };
    }
    await db
      .update(atelierEmployees)
      .set({ travelProfile: after, updatedAt: new Date() })
      .where(eq(atelierEmployees.id, person.id));
    // Audit like the REST route — section-level deltas, never raw numbers.
    const sections: string[] = [];
    if (JSON.stringify(before.airlinePrograms) !== JSON.stringify(after.airlinePrograms))
      sections.push("airlinePrograms");
    if (JSON.stringify(before.hotelPrograms) !== JSON.stringify(after.hotelPrograms))
      sections.push("hotelPrograms");
    if (JSON.stringify(before.preferences) !== JSON.stringify(after.preferences))
      sections.push("preferences");
    await audit({
      subject,
      entityType: "employee",
      entityId: person.id,
      action: "person.travel.self_updated",
      payload: {
        sections,
        airlineProgramCount: after.airlinePrograms.length,
        hotelProgramCount: after.hotelPrograms.length,
        via: "chat",
      },
      summary: `${subject.user.name} updated their travel loyalty & preferences (${sections.join(", ") || "no-op"})`,
    });
    return {
      ok: true,
      data: {
        id: person.id,
        label: `Travel profile saved (${sections.join(", ") || "no changes"})`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.learning_complete — mark an own learning item complete
// (mirrors POST /me/learning/:id/complete; audience-scoped, idempotent)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.learning_complete",
  module: "roster",
  toolName: "complete_my_learning",
  description:
    "Mark one of the signed-in user's learning/training items as complete. Pass materialId from my_learning, or title to match by name. Idempotent — re-marking a completed item is a no-op.",
  slashAliases: { en: ["/complete-training"], fr: ["/terminer-formation"] },
  representativePrompts: {
    en: ["Mark the security training as done", "I finished the onboarding course"],
    ar: ["حددت التدريب كمكتمل"],
    fr: ["Marquer la formation comme terminée"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Mark the security awareness training complete"],
    ar: ["حددت التدريب كمكتمل"],
    fr: ["Marquer la formation comme terminée"],
  },
  inputSchema: {
    type: "object",
    properties: {
      materialId: { type: "string" },
      title: { type: "string", description: "Title (or part of it) to match the item by." },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    // Audience scoping mirrors GET /me/learning: contractor logins (or
    // contractor roster records) see all+contractors, employees all+employees.
    const workerType =
      subject.user.role === "contractor" || subject.person?.workerType === "contractor"
        ? "contractor"
        : "employee";
    const audienceValues = workerType === "contractor" ? ["all", "contractors"] : ["all", "employees"];
    const rows = await db
      .select()
      .from(atelierTrainingMaterials)
      .where(
        and(
          eq(atelierTrainingMaterials.orgId, subject.user.orgId),
          inArray(atelierTrainingMaterials.audience, audienceValues),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      )
      .orderBy(desc(atelierTrainingMaterials.createdAt));
    let candidates = rows;
    if (typeof input.materialId === "string" && input.materialId.trim()) {
      candidates = rows.filter((m) => m.id === input.materialId);
    } else if (typeof input.title === "string" && input.title.trim()) {
      const q = input.title.trim().toLowerCase();
      candidates = rows.filter((m) => m.title.toLowerCase().includes(q));
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          rows.length === 0
            ? "There are no learning items assigned to you right now."
            : "I couldn't match that to one of your learning items.",
      };
    }
    if (candidates.length > 1) {
      const options = candidates.slice(0, 8).map((m) => ({
        id: m.id,
        label: m.title,
        secondary: m.topic ?? m.kind,
      }));
      return {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: { kind: "learning_material", field: "materialId", options },
      };
    }
    const m = candidates[0];
    const [already] = await db
      .select()
      .from(atelierTrainingCompletions)
      .where(
        and(
          eq(atelierTrainingCompletions.materialId, m.id),
          eq(atelierTrainingCompletions.userId, subject.user.id),
        ),
      );
    if (already) {
      return {
        ok: true,
        data: {
          id: m.id,
          label: `"${m.title}" was already marked complete`,
          href: "/me/learning",
          navigateTo: null,
        },
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: m.id, title: m.title } },
        confirmation: {
          summary: `Mark "${m.title}" as completed?`,
          diff: {
            create: {
              table: "atelier_training_completions",
              values: { materialId: m.id, title: m.title },
            },
          },
          pending: { tool: "complete_my_learning", input: { materialId: m.id, confirm: true } },
        },
      };
    }
    // Idempotent — unique (materialId, userId) index makes re-marks no-ops.
    await db
      .insert(atelierTrainingCompletions)
      .values({ id: rid("traindone"), orgId: subject.user.orgId, materialId: m.id, userId: subject.user.id })
      .onConflictDoNothing();
    return {
      ok: true,
      data: {
        id: m.id,
        label: `Marked "${m.title}" complete`,
        href: "/me/learning",
        navigateTo: { path: "/me/learning", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.timesheet_entry_delete — delete an own timesheet entry
// (mirrors DELETE /me/timesheets/entries/:entryId; week must be
// draft/rejected)
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.timesheet_entry_delete",
  module: "roster",
  toolName: "delete_my_time_entry",
  description:
    "Delete one of the signed-in user's own timesheet entries (only while its week is still draft or rejected). Pass entryId from my_timesheet, or workDate (ISO) to pick by day.",
  slashAliases: { en: ["/delete-time-entry"], fr: ["/supprimer-saisie-temps"] },
  representativePrompts: {
    en: ["Delete the 3h entry I logged on Tuesday", "Remove yesterday's time entry"],
    ar: ["احذف تسجيل الوقت"],
    fr: ["Supprimer ma saisie de temps"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Delete my time entry for 2026-08-04"],
    ar: ["احذف تسجيل الوقت"],
    fr: ["Supprimer ma saisie de temps"],
  },
  inputSchema: {
    type: "object",
    properties: {
      entryId: { type: "string" },
      workDate: { type: "string", description: "ISO date the entry was logged on." },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    const person = subject.person;
    if (!person) return NO_ROSTER;
    // Own entries only — person-scoped exactly like the REST route.
    const entryRows = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.personId, person.id),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      )
      .orderBy(desc(atelierTimesheetEntries.workDate));
    let candidates = entryRows;
    if (typeof input.entryId === "string" && input.entryId.trim()) {
      candidates = entryRows.filter((e) => e.id === input.entryId);
    } else if (isIsoDate(input.workDate)) {
      candidates = entryRows.filter((e) => e.workDate === input.workDate);
    } else {
      return {
        ok: false,
        errorCode: "missing_selector",
        errorMessage: "Tell me which entry to delete — by date (YYYY-MM-DD) or entry id.",
      };
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "I couldn't find that timesheet entry on your record.",
      };
    }
    if (candidates.length > 1) {
      const options = candidates.slice(0, 8).map((e) => ({
        id: e.id,
        label: `${e.workDate} — ${e.hours}h ${e.activityCode ?? ""}`.trim(),
        secondary: e.narrative ?? e.status,
      }));
      return {
        ok: true,
        data: { options, navigateTo: null },
        disambiguation: { kind: "timesheet_entry", field: "entryId", options },
      };
    }
    const entry = candidates[0];
    const [week] = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(eq(atelierTimesheetWeeks.id, entry.weekId));
    if (!week || (week.status !== "draft" && week.status !== "rejected")) {
      return {
        ok: false,
        errorCode: "week_locked",
        errorMessage: `That week is ${week?.status ?? "missing"} — entries can only be deleted while the week is draft or rejected.`,
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { id: entry.id, workDate: entry.workDate, hours: entry.hours } },
        confirmation: {
          summary: `Delete your ${entry.hours}h entry on ${entry.workDate}?`,
          diff: {
            delete: {
              table: "atelier_timesheet_entries",
              id: entry.id,
              label: `${entry.workDate} ${entry.hours}h`,
            },
          },
          pending: { tool: "delete_my_time_entry", input: { entryId: entry.id, confirm: true } },
        },
      };
    }
    await db
      .update(atelierTimesheetEntries)
      .set({ deletedAt: new Date() })
      .where(eq(atelierTimesheetEntries.id, entry.id));
    await recomputeWeekTotals(week.id);
    await audit({
      subject,
      entityType: "timesheet_entry",
      entityId: entry.id,
      action: "ledger.entry.self_deleted",
      payload: { workDate: entry.workDate, hours: entry.hours, via: "chat" },
      summary: `${subject.user.name} deleted a ${entry.hours}h timesheet entry on ${entry.workDate}`,
    });
    return {
      ok: true,
      data: {
        id: entry.id,
        label: `Deleted ${entry.hours}h entry on ${entry.workDate}`,
        href: "/me/timesheets",
        navigateTo: { path: "/me/timesheets", when: "on_commit" as const },
      },
    };
  },
});
