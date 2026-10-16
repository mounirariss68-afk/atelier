/**
 * Task #405 — Me-lens self-service read capabilities.
 *
 * Identity-locked chat tools for the personal questions people ask on
 * mobile: "how much leave do I have left?", "show my payslips", "show
 * my contract", "what are my goals?", "what training can I take?",
 * "any notifications?", "show my profile".
 *
 * Security model — every tool here goes through `defineSelfCapability`:
 *   - the input schema is EMPTY (`additionalProperties: false`) so the
 *     model cannot pass a person/user argument at all;
 *   - the run callback never reads `input` — the subject is ALWAYS the
 *     authenticated session persona (`ctx.persona.id` = atelier user id),
 *     re-resolved to its own roster row via the same `resolveSelfPerson`
 *     helper the `/me/*` REST routes use;
 *   - a prompt-injected "for user X" therefore cannot widen scope: there
 *     is no input surface to carry it, and the queries key on the
 *     caller's own row only.
 *
 * Contractor variants mirror the REST ACLs: reviews/goals answer with a
 * friendly `applicable: false` payload (not an error dump); learning is
 * audience-filtered; pay shows the day-rate remittance shape. hrNotes
 * and raw IBANs never appear in any output shape (reviews wire below
 * whitelists fields; bank details are omitted entirely).
 *
 * Documents/payslips: cards LINK to the existing ACL'd download routes
 * (`/api/atelier/me/pay/documents/:id/download`) — bytes never ride in
 * a tool result.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { listMyUnreadNotifications } from "../atelier-my-notifications.js";
import {
  isoWeekOf,
  isValidIsoDateStrict,
  isValidIsoMonth,
  isValidIsoWeek,
} from "../../routes/atelier/ledgerRoutes.js";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierLeaveRequests,
  atelierPayDocuments,
  atelierContractRecords,
  atelierSelfNotifications,
  atelierPerformanceReviews,
  atelierPerformanceGoals,
  atelierTrainingMaterials,
  atelierTrainingCompletions,
  atelierExpenses,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  type CapabilityInput,
} from "./capability-catalog.js";
import { resolveSelfPerson, type SelfPersonWire } from "../../routes/atelier/meRoutes.js";
import { computeLeaveBalance } from "../../routes/atelier/meSelfServiceRoutes.js";
import type { ToolContext, ToolResult } from "./index.js";

type UserRow = typeof atelierUsers.$inferSelect;

export interface SelfSubject {
  user: UserRow;
  person: SelfPersonWire | null;
}

/**
 * Locked empty input schema — the model has no way to name a subject.
 * Any stray properties a jailbroken turn tries to pass fail Anthropic's
 * schema validation (`additionalProperties: false`) and are ignored by
 * the run callbacks regardless (they never read `input`).
 */
const SELF_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/**
 * Resolve the authenticated caller to their user row + own roster
 * record. `ctx.persona.id` is the atelier_users id hydrated from the
 * session cookie by cliRoutes — never model-supplied.
 */
export async function resolveSelfSubject(ctx: ToolContext): Promise<SelfSubject | null> {
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(eq(atelierUsers.id, ctx.persona.id), eq(atelierUsers.orgId, ctx.persona.orgId)),
    );
  if (!user) return null;
  const person = await resolveSelfPerson(user);
  return { user, person };
}

type SelfCapabilityInput = Omit<
  CapabilityInput,
  | "inputSchema"
  | "isWrite"
  | "twoPhaseConfirm"
  | "outboundChannel"
  | "irreversible"
  | "run"
  | "schemaVersion"
> & {
  runSelf: (
    subject: SelfSubject,
    ctx: ToolContext,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  /**
   * Task #788 — optional SELECTOR-FREE filter properties (periods,
   * status filters…). These must never allow naming a subject; the
   * subject stays the session identity. `additionalProperties: false`
   * is preserved.
   */
  filterSchema?: Record<string, unknown>;
};

/**
 * Identity-locked capability pattern (Task #405). Every self-service
 * read is registered through this helper so it is impossible to add
 * one that accepts a person-selection input by accident.
 */
function defineSelfCapability(entry: SelfCapabilityInput): void {
  const { runSelf, filterSchema, ...rest } = entry;
  defineCapability({
    ...rest,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    inputSchema: filterSchema
      ? { type: "object", properties: filterSchema, additionalProperties: false }
      : SELF_INPUT_SCHEMA,
    isWrite: false,
    twoPhaseConfirm: false,
    outboundChannel: null,
    irreversible: false,
    async run(input, ctx) {
      // The subject is ALWAYS the session identity; `input` carries only
      // declared selector-free filters (empty schema otherwise).
      const subject = await resolveSelfSubject(ctx);
      if (!subject) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: "Your login could not be resolved to a user record.",
        };
      }
      return runSelf(subject, ctx, (input ?? {}) as Record<string, unknown>);
    },
  });
}

function isContractorCaller(subject: SelfSubject): boolean {
  return (
    subject.user.role === "contractor" || subject.person?.workerType === "contractor"
  );
}

// ---------------------------------------------------------------------
// me.profile — entity_card
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.profile",
  module: "roster",
  toolName: "my_profile",
  description:
    "The caller's own profile: name, role, title, worker type, start date, office, and contact basics. Always answers for the signed-in user only.",
  slashAliases: { en: ["/my-profile", "/whoami"], fr: ["/mon-profil"] },
  representativePrompts: {
    en: ["Show my profile", "What's on my profile?"],
    ar: ["اعرض ملفي الشخصي"],
    fr: ["Affiche mon profil"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my profile"],
    ar: ["اعرض ملفي الشخصي"],
    fr: ["Affiche mon profil"],
  },
  async runSelf({ user, person }) {
    return {
      ok: true,
      data: {
        id: user.id,
        label: person?.fullName ?? user.name,
        name: user.name,
        email: user.email,
        role: user.role,
        workerType: person?.workerType ?? null,
        title: person?.title ?? null,
        startDate: person?.startDate ?? null,
        employmentType: person?.employmentType ?? null,
        homeOffice: person?.homeOffice ?? null,
        country: person?.country ?? null,
        status: person?.status ?? null,
        preferredName: person?.preferredName ?? null,
        href: "/me/profile",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.leave — entity_card (balance + recent requests)
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.leave",
  module: "roster",
  toolName: "my_leave",
  description:
    "The caller's own leave: remaining annual and sick balance for the current year plus their recent leave requests with statuses. Always self-scoped.",
  slashAliases: { en: ["/my-leave", "/leave"], fr: ["/mes-conges"] },
  representativePrompts: {
    en: ["How much leave do I have left?", "Show my leave requests"],
    ar: ["كم يوم إجازة تبقى لي؟"],
    fr: ["Combien de congés me reste-t-il ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["How much leave do I have left?"],
    ar: ["كم يوم إجازة تبقى لي؟"],
    fr: ["Combien de congés me reste-t-il ?"],
  },
  async runSelf({ user, person }) {
    if (!person) {
      return {
        ok: true,
        data: {
          id: null,
          label: "Leave",
          note: "Your login is not linked to an employee or contractor record, so there is no leave ledger to show.",
        },
      };
    }
    const year = new Date().getUTCFullYear();
    const [balance, requests] = await Promise.all([
      computeLeaveBalance(user.orgId, person.id, year),
      db
        .select()
        .from(atelierLeaveRequests)
        .where(
          and(
            eq(atelierLeaveRequests.orgId, user.orgId),
            eq(atelierLeaveRequests.personId, person.id),
            isNull(atelierLeaveRequests.deletedAt),
          ),
        )
        .orderBy(desc(atelierLeaveRequests.createdAt))
        .limit(20),
    ]);
    // Oct 2026 audit — when no entitlement is configured for the person or
    // their employment type, computeLeaveBalance falls back to firm defaults
    // and the card stated "22 days remaining" as fact. Surface the basis so
    // the model says "no entitlement configured" instead.
    const entitlementNote = balance.entitlementConfigured
      ? null
      : `No leave entitlement is configured for ${year} (neither for this person nor their employment type). The annual (${balance.annualDays}) and sick (${balance.sickDays}) day figures are firm defaults, not the person's entitlement; used and pending days are real. HR can set the entitlement under Roster → Leave.`;
    return {
      ok: true,
      data: {
        id: person.id,
        label: `Leave · ${year}`,
        balance: {
          ...balance,
          basis: balance.entitlementConfigured ? "configured entitlement" : "firm default (entitlement not configured)",
        },
        ...(entitlementNote ? { note: entitlementNote, entitlementConfigured: false } : { entitlementConfigured: true }),
        requests: requests.map((r) => ({
          id: r.id,
          leaveType: r.leaveType,
          startDate: r.startDate,
          endDate: r.endDate,
          workingDays: r.workingDays,
          status: r.status,
          decisionReason: r.decisionReason ?? null,
        })),
        href: "/me/time",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.pay_documents — ranked_list (links only; bytes stay behind ACL)
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.pay_documents",
  module: "roster",
  toolName: "my_pay_documents",
  description:
    "The caller's own published pay documents (payslips for employees, remittance advices for contractors) plus a compensation summary. Links to the secure download — file bytes never appear in chat.",
  slashAliases: { en: ["/my-payslips", "/my-pay"], fr: ["/mes-bulletins"] },
  representativePrompts: {
    en: ["Show my payslips", "Show my pay documents"],
    ar: ["اعرض قسائم راتبي"],
    fr: ["Affiche mes bulletins de paie"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my payslips"],
    ar: ["اعرض قسائم راتبي"],
    fr: ["Affiche mes bulletins de paie"],
  },
  async runSelf({ user, person }) {
    if (!person) {
      return { ok: true, data: { items: [], total: 0, note: "No roster record linked to your login." } };
    }
    const docs = await db
      .select()
      .from(atelierPayDocuments)
      .where(
        and(
          eq(atelierPayDocuments.orgId, user.orgId),
          eq(atelierPayDocuments.personType, person.workerType),
          eq(atelierPayDocuments.personId, person.id),
          eq(atelierPayDocuments.published, true),
          isNull(atelierPayDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPayDocuments.createdAt))
      .limit(50);
    return {
      ok: true,
      data: {
        workerType: person.workerType,
        items: docs.map((d) => ({
          id: d.id,
          label: d.title,
          category: d.category,
          periodDate: d.periodDate ?? null,
          fileName: d.fileName,
          publishedAt: d.publishedAt?.toISOString() ?? null,
          href: `/api/atelier/me/pay/documents/${d.id}/download`,
        })),
        total: docs.length,
        payPageHref: "/me/pay",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.contracts — ranked_list (self-scope contract path)
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.contracts",
  module: "roster",
  toolName: "my_contracts",
  description:
    "The caller's own employment/engagement contracts (linked to their roster record): title, type, status, effective and expiry dates. Always self-scoped.",
  slashAliases: { en: ["/my-contract", "/my-contracts"], fr: ["/mon-contrat"] },
  representativePrompts: {
    en: ["Show my contract", "What's the status of my contract?"],
    ar: ["اعرض عقدي"],
    fr: ["Affiche mon contrat"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my contract"],
    ar: ["اعرض عقدي"],
    fr: ["Affiche mon contrat"],
  },
  async runSelf({ user }) {
    // Mirrors GET /me/contracts exactly: contracts link to the caller's
    // own EMPLOYEE roster rows (userId link). Contractors' agreements
    // are held by the contracting entity, not surfaced here.
    const emps = await db
      .select({ id: atelierEmployees.id })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, user.orgId), eq(atelierEmployees.userId, user.id)));
    const ids = emps.map((e) => e.id);
    if (ids.length === 0) {
      return {
        ok: true,
        data: {
          items: [],
          total: 0,
          note: "No contracts are linked to your roster record.",
        },
      };
    }
    const rows = await db
      .select()
      .from(atelierContractRecords)
      .where(
        and(
          eq(atelierContractRecords.orgId, user.orgId),
          inArray(atelierContractRecords.personId, ids),
        ),
      )
      .orderBy(desc(atelierContractRecords.createdAt))
      .limit(20);
    return {
      ok: true,
      data: {
        items: rows.map((c) => ({
          id: c.id,
          label: c.title,
          contractType: c.contractType,
          status: c.status,
          effectiveDate: c.effectiveDate ? c.effectiveDate.toISOString().slice(0, 10) : null,
          expiryDate: c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : null,
          signingEntityLabel: c.signingEntityLabel ?? null,
          href: `/me/contracts/${c.id}`,
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.reviews — ranked_list (released only; hrNotes never in shape)
// ---------------------------------------------------------------------
const CONTRACTOR_PERFORMANCE_NOTE =
  "Performance reviews and goals are an employee-only section, so they don't apply to contractor accounts.";

defineSelfCapability({
  id: "me.reviews",
  module: "roster",
  toolName: "my_reviews",
  description:
    "The caller's own RELEASED performance reviews (cycle, ratings, strengths, growth areas, manager summary). Employee-only: contractors get a clear not-applicable answer.",
  slashAliases: { en: ["/my-reviews", "/my-review"], fr: ["/mes-evaluations"] },
  representativePrompts: {
    en: ["Show my last review", "Show my performance reviews"],
    ar: ["اعرض تقييمي الأخير"],
    fr: ["Affiche ma dernière évaluation"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my last review"],
    ar: ["اعرض تقييمي الأخير"],
    fr: ["Affiche ma dernière évaluation"],
  },
  async runSelf(subject) {
    if (isContractorCaller(subject)) {
      return {
        ok: true,
        data: { applicable: false, items: [], total: 0, note: CONTRACTOR_PERFORMANCE_NOTE },
      };
    }
    const employeeId = subject.person?.workerType === "employee" ? subject.person.id : null;
    if (!employeeId) return { ok: true, data: { applicable: true, items: [], total: 0 } };
    const rows = await db
      .select()
      .from(atelierPerformanceReviews)
      .where(
        and(
          eq(atelierPerformanceReviews.orgId, subject.user.orgId),
          eq(atelierPerformanceReviews.employeeId, employeeId),
          eq(atelierPerformanceReviews.status, "released"),
          isNull(atelierPerformanceReviews.deletedAt),
        ),
      )
      .orderBy(desc(atelierPerformanceReviews.createdAt))
      .limit(20);
    return {
      ok: true,
      data: {
        applicable: true,
        // Whitelisted wire shape — hrNotes NEVER leaves the org side.
        items: rows.map((r) => ({
          id: r.id,
          label: `Review · ${r.cycle}`,
          cycle: r.cycle,
          reviewedOn: r.reviewedOn,
          selfRating: r.selfRating,
          managerRating: r.managerRating,
          strengths: r.strengths,
          growthAreas: r.growthAreas,
          managerSummary: r.managerSummary,
          releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
          href: "/me/performance",
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.goals — ranked_list
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.goals",
  module: "roster",
  toolName: "my_goals",
  description:
    "The caller's own performance goals for the current cycles: title, weight, and on-track/at-risk/complete status. Employee-only: contractors get a clear not-applicable answer.",
  slashAliases: { en: ["/my-goals", "/goals"], fr: ["/mes-objectifs"] },
  representativePrompts: {
    en: ["What are my goals this quarter?", "Show my goals"],
    ar: ["ما هي أهدافي لهذا الربع؟"],
    fr: ["Quels sont mes objectifs ce trimestre ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What are my goals this quarter?"],
    ar: ["ما هي أهدافي لهذا الربع؟"],
    fr: ["Quels sont mes objectifs ce trimestre ?"],
  },
  async runSelf(subject) {
    if (isContractorCaller(subject)) {
      return {
        ok: true,
        data: { applicable: false, items: [], total: 0, note: CONTRACTOR_PERFORMANCE_NOTE },
      };
    }
    const employeeId = subject.person?.workerType === "employee" ? subject.person.id : null;
    if (!employeeId) return { ok: true, data: { applicable: true, items: [], total: 0 } };
    const rows = await db
      .select()
      .from(atelierPerformanceGoals)
      .where(
        and(
          eq(atelierPerformanceGoals.orgId, subject.user.orgId),
          eq(atelierPerformanceGoals.employeeId, employeeId),
          isNull(atelierPerformanceGoals.deletedAt),
        ),
      )
      .orderBy(desc(atelierPerformanceGoals.createdAt))
      .limit(30);
    return {
      ok: true,
      data: {
        applicable: true,
        items: rows.map((g) => ({
          id: g.id,
          label: g.title,
          cycle: g.cycle,
          description: g.description,
          weightPct: g.weightPct,
          status: g.status,
          href: "/me/performance",
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.learning — ranked_list (audience-filtered; contractors get theirs)
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.learning",
  module: "roster",
  toolName: "my_learning",
  description:
    "Training materials available to the caller (audience-filtered for employees vs contractors) with completion status. Always self-scoped.",
  slashAliases: { en: ["/my-learning", "/training"], fr: ["/mes-formations"] },
  representativePrompts: {
    en: ["What training is available to me?", "Show my learning list"],
    ar: ["ما التدريبات المتاحة لي؟"],
    fr: ["Quelles formations me sont proposées ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What training is available to me?"],
    ar: ["ما التدريبات المتاحة لي؟"],
    fr: ["Quelles formations me sont proposées ?"],
  },
  async runSelf(subject) {
    // Same audience rule as GET /me/learning: contractors see
    // all+contractors, everyone else sees all+employees.
    const audience = isContractorCaller(subject)
      ? ["all", "contractors"]
      : ["all", "employees"];
    const rows = await db
      .select()
      .from(atelierTrainingMaterials)
      .where(
        and(
          eq(atelierTrainingMaterials.orgId, subject.user.orgId),
          inArray(atelierTrainingMaterials.audience, audience),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      )
      .orderBy(desc(atelierTrainingMaterials.createdAt))
      .limit(50);
    const done = rows.length
      ? await db
          .select()
          .from(atelierTrainingCompletions)
          .where(
            and(
              eq(atelierTrainingCompletions.orgId, subject.user.orgId),
              eq(atelierTrainingCompletions.userId, subject.user.id),
              inArray(
                atelierTrainingCompletions.materialId,
                rows.map((r) => r.id),
              ),
            ),
          )
      : [];
    const doneSet = new Set(done.map((d) => d.materialId));
    return {
      ok: true,
      data: {
        items: rows.map((m) => ({
          id: m.id,
          label: m.title,
          topic: m.topic,
          kind: m.kind,
          audience: m.audience,
          completed: doneSet.has(m.id),
          href: "/me/learning",
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.expenses — ranked_list (Task #421)
//
// Keying quirk (see /me/expenses REST route): atelier_expenses.personId
// stores the SUBMITTER'S USER ID (atelier_users.id), NOT the roster
// person id. So this tool keys on subject.user.id and works even when
// no roster row is linked.
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.expenses",
  module: "roster",
  toolName: "my_expenses",
  description:
    "The caller's own expense claims: merchant, amount, status (draft/submitted/approved/rejected/reimbursed), policy check result, rejection reason, and reimbursement date. Always self-scoped to the signed-in user.",
  slashAliases: { en: ["/my-expenses", "/expenses"], fr: ["/mes-frais"] },
  representativePrompts: {
    en: ["Where's my expense claim?", "Show my expenses", "Has my expense been reimbursed?"],
    ar: ["أين مطالبة المصاريف الخاصة بي؟"],
    fr: ["Où en est ma note de frais ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Where's my expense claim?"],
    ar: ["أين مطالبة المصاريف الخاصة بي؟"],
    fr: ["Où en est ma note de frais ?"],
  },
  async runSelf({ user }) {
    // Expense personId IS the user id — mirror GET /me/expenses exactly.
    const rows = await db
      .select()
      .from(atelierExpenses)
      .where(and(eq(atelierExpenses.personId, user.id), isNull(atelierExpenses.deletedAt)))
      .orderBy(desc(atelierExpenses.createdAt))
      .limit(50);
    return {
      ok: true,
      data: {
        items: rows.map((e) => ({
          id: e.id,
          label: `${e.merchant ?? "Expense"} · ${e.currency} ${e.amount}`,
          expenseDate: e.expenseDate,
          merchant: e.merchant,
          description: e.description,
          category: e.category,
          amount: e.amount,
          currency: e.currency,
          usdAmount: e.usdAmount,
          status: e.status,
          policyStatus: e.policyStatus,
          policyFindings: (e.policyFindings ?? []).map((f) => ({
            severity: f.severity,
            message: f.message,
          })),
          submittedAt: e.submittedAt?.toISOString() ?? null,
          approvedAt: e.approvedAt?.toISOString() ?? null,
          rejectedAt: e.rejectedAt?.toISOString() ?? null,
          rejectedReason: e.rejectedReason,
          reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
          hasReceipt: !!e.receiptFileRef,
          href: "/me/expenses",
        })),
        total: rows.length,
        href: "/me/expenses",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.timesheets — ranked_list (Task #421)
//
// Keying quirk: timesheet weeks key on the ROSTER person id (employee/
// contractor row), resolved via resolveSelfPerson — never ctx.persona.id
// directly (that's the atelier_users id; the legacy timesheet.current
// bug did exactly that and matched nothing).
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.timesheets",
  module: "roster",
  toolName: "my_timesheets",
  description:
    "The caller's own timesheet weeks (current + past): week, status, total and billable hours, rejection reason if any. Optionally filtered to a period — pass date (any YYYY-MM-DD inside the week you want, the server derives the ISO week), month (YYYY-MM), or weekIso (YYYY-Www). Answers 'what did I book last week?' and 'show my hours for March'. Always self-scoped.",
  filterSchema: {
    date: {
      type: "string",
      description: "Any ISO date (YYYY-MM-DD) inside the week to show — the server derives the ISO week.",
    },
    month: { type: "string", description: "Calendar month filter, YYYY-MM." },
    weekIso: { type: "string", description: "Exact ISO week, e.g. 2026-W12." },
  },
  slashAliases: { en: ["/my-timesheets", "/my-timesheet"], fr: ["/mes-feuilles-de-temps"] },
  representativePrompts: {
    en: ["What did I book last week?", "Show my recent timesheets", "What's the status of my timesheet?"],
    ar: ["ماذا سجلت الأسبوع الماضي؟"],
    fr: ["Qu'ai-je saisi la semaine dernière ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What did I book last week?"],
    ar: ["ماذا سجلت الأسبوع الماضي؟"],
    fr: ["Qu'ai-je saisi la semaine dernière ?"],
  },
  async runSelf({ person }, _ctx, input) {
    if (!person) {
      return {
        ok: true,
        data: {
          items: [],
          total: 0,
          note: "Your login is not linked to an employee or contractor record, so there are no timesheets to show.",
        },
      };
    }
    // Task #788 — server-side period resolution. The model passes a raw
    // date / month / weekIso; ISO-week math happens HERE, never in the
    // model.
    const dateRaw = typeof input.date === "string" ? input.date.trim() : "";
    const monthRaw = typeof input.month === "string" ? input.month.trim() : "";
    const weekIsoRaw = typeof input.weekIso === "string" ? input.weekIso.trim().toUpperCase() : "";
    let wantWeekIso: string | null = null;
    if (weekIsoRaw) {
      if (!isValidIsoWeek(weekIsoRaw)) {
        return {
          ok: false,
          errorCode: "invalid_body",
          errorMessage: `weekIso must be a real ISO week like 2026-W12 (got "${weekIsoRaw}"). You can also pass any date inside the week instead.`,
        };
      }
      wantWeekIso = weekIsoRaw;
    } else if (dateRaw) {
      if (!isValidIsoDateStrict(dateRaw)) {
        return {
          ok: false,
          errorCode: "invalid_body",
          errorMessage: `date must be a real calendar date (YYYY-MM-DD); got "${dateRaw}".`,
        };
      }
      wantWeekIso = isoWeekOf(new Date(`${dateRaw}T00:00:00Z`)).weekIso;
    }
    if (monthRaw && !isValidIsoMonth(monthRaw)) {
      return {
        ok: false,
        errorCode: "invalid_body",
        errorMessage: `month must be a real month like 2026-03 (YYYY-MM); got "${monthRaw}".`,
      };
    }

    const allRows = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.personId, person.id),
          isNull(atelierTimesheetWeeks.deletedAt),
        ),
      )
      .orderBy(desc(atelierTimesheetWeeks.weekIso));
    let rows = allRows;
    let periodLabel: string | null = null;
    if (wantWeekIso) {
      rows = allRows.filter((w) => w.weekIso === wantWeekIso);
      periodLabel = `week ${wantWeekIso}`;
    } else if (monthRaw) {
      // A week belongs to the month if any of its 7 days fall inside it.
      rows = allRows.filter((w) => {
        const start = new Date(`${w.weekStartDate}T00:00:00Z`);
        for (let i = 0; i < 7; i++) {
          const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 7);
          if (d === monthRaw) return true;
        }
        return false;
      });
      periodLabel = monthRaw;
    } else {
      rows = allRows.slice(0, 12);
    }

    if (periodLabel && rows.length === 0) {
      const nearest = allRows.slice(0, 5).map((w) => w.weekIso);
      return {
        ok: true,
        data: {
          items: [],
          total: 0,
          href: "/me/time",
          note:
            allRows.length === 0
              ? `You have no timesheet weeks yet for ${periodLabel} or any other period. Say "log 6 hours for today" to start one.`
              : `No hours were logged for ${periodLabel}. Your most recent timesheet weeks are: ${nearest.join(", ")} — ask for one of those, or a different month.`,
        },
      };
    }

    // For a specific week, include the day-level entries so "what did I
    // book that week?" is answerable without another tool call.
    let weekEntries: Array<Record<string, unknown>> | undefined;
    if (wantWeekIso && rows.length === 1) {
      const entryRows = await db
        .select()
        .from(atelierTimesheetEntries)
        .where(
          and(
            eq(atelierTimesheetEntries.weekId, rows[0].id),
            isNull(atelierTimesheetEntries.deletedAt),
          ),
        );
      weekEntries = entryRows
        .sort((a, b) => a.workDate.localeCompare(b.workDate))
        .map((e) => ({
          id: e.id,
          workDate: e.workDate,
          hours: e.hours,
          activityCode: e.activityCode,
          engagementId: e.engagementId ?? null,
          billable: e.billable,
          narrative: e.narrative ?? null,
        }));
    }

    return {
      ok: true,
      data: {
        ...(periodLabel ? { period: periodLabel } : {}),
        ...(weekEntries ? { entries: weekEntries } : {}),
        items: rows.map((w) => ({
          id: w.id,
          label: `Timesheet · ${w.weekIso}`,
          weekIso: w.weekIso,
          weekStartDate: w.weekStartDate,
          status: w.status,
          totalHours: w.totalHours,
          billableHours: w.billableHours,
          rejectionReason: w.rejectionReason ?? null,
          submittedAt: w.submittedAt?.toISOString() ?? null,
          flags: w.suspiciousFlags ?? [],
          href: "/me/time",
        })),
        total: rows.length,
        href: "/me/time",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.notifications — ranked_list (unread cards)
// ---------------------------------------------------------------------
defineSelfCapability({
  id: "me.notifications",
  module: "roster",
  toolName: "my_notifications",
  description:
    "The caller's own unread notification cards (approvals landed, timesheet due, expense decisions). Always self-scoped to the signed-in user.",
  slashAliases: { en: ["/my-notifications", "/notifications"], fr: ["/mes-notifications"] },
  representativePrompts: {
    en: ["Any notifications for me?", "What needs my attention?"],
    ar: ["هل لدي إشعارات؟"],
    fr: ["Ai-je des notifications ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Any notifications for me?"],
    ar: ["هل لدي إشعارات؟"],
    fr: ["Ai-je des notifications ?"],
  },
  async runSelf({ user }) {
    // Phase 0 — same merged reader as GET /me/notifications.
    const rows = await listMyUnreadNotifications({ orgId: user.orgId, userId: user.id, limit: 50 });
    return {
      ok: true,
      data: {
        items: rows.map((n) => ({
          id: n.id,
          label: n.title,
          kind: n.kind,
          body: n.body,
          source: n.source,
          createdAt: n.createdAt.toISOString(),
          href: n.href ?? "/me",
        })),
        total: rows.length,
      },
    };
  },
});
