/**
 * Task #404 — read-only chat capabilities for people, contacts,
 * meetings, documents, opportunity/engagement detail, and self-scoped
 * expenses.
 *
 * Every entry:
 *   - is `isWrite: false` and reuses the SAME ACL helpers as the REST
 *     routes it mirrors (roster scope predicate, canSeeAccount,
 *     engagement ACL, canSeeDocument),
 *   - refuses explicitly (errorCode "forbidden") instead of silently
 *     returning empty when the persona is outside the perimeter,
 *   - hard-excludes sensitive HR / compensation / bank fields from the
 *     person projections regardless of the caller's role — those
 *     surfaces stay UI-only,
 *   - delivers contact info in the structured result-card payload
 *     (`data`), which is not free-text-redacted like chat prose.
 */

import { and, eq, isNull, ilike, or, desc, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierContacts,
  atelierOpportunities,
  atelierEngagements,
  atelierMeetings,
  atelierDocuments,
  atelierDocumentVersions,
  atelierExpenses,
  atelierRaidItems,
  atelierBriefs,
  atelierRosterReportsTo,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import { resolveAccount, resolveEngagement } from "./resolvers/index.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";
import { canSeeDocument } from "../../routes/atelier/documentRoutes.js";
import {
  resolveRosterScope,
  listPersons,
  getPerson,
  toBusinessWire,
  sanitizeForViewer,
  canViewPersonViaRosterScope,
  type PersonWire,
} from "../../routes/atelier/rosterRoutes.js";
import { isRestrictedPersona } from "../../routes/atelier/personaRoles.js";
import { resolveSalesStage } from "../atelier-agents/pipeline.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function denyForbidden(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

function notFound(what: string): ToolResult {
  return { ok: false, errorCode: "not_found", errorMessage: `${what} not found` };
}

type MeRow = typeof atelierUsers.$inferSelect;

/** Load the full atelier_users row for the calling persona (the roster
 *  scope helpers need email + role, not just the persona shape). */
async function loadMe(ctx: ToolContext): Promise<MeRow | null> {
  const [me] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.id, ctx.persona.id),
        eq(atelierUsers.orgId, ctx.persona.orgId),
      ),
    )
    .limit(1);
  return me ?? null;
}

async function engAclFor(persona: CliPersona) {
  return accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);
}

/**
 * Task #404 — HARD projection for chat surfaces. Regardless of the
 * caller's role (even founding_partner), the chat tools never emit
 * compensation, bank, HR-note, or demographic fields. Those stay on
 * the gated REST/UI surfaces only. Business contact info IS included
 * (that's the point of the directory).
 */
export function toChatPersonCard(p: PersonWire) {
  return {
    id: p.id,
    workerType: p.workerType,
    fullName: p.fullName,
    preferredName: p.preferredName ?? null,
    title: p.title ?? null,
    role: p.role ?? null,
    seniority: p.seniority ?? null,
    email: p.email ?? null,
    cellPhones: p.cellPhones ?? [],
    officeAddress: p.officeAddress ?? null,
    homeOffice: p.homeOffice ?? null,
    country: p.country ?? null,
    status: p.status,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
    employmentType: p.employmentType ?? null,
    partnerFirmName: p.partnerFirmName ?? null,
    vendorEntity: p.vendorEntity ?? null,
    avatarUrl: p.avatarUrl ?? null,
    href: `/people/${p.id}`,
  };
}

/** Fields that must NEVER appear in a chat person payload. Exported for
 *  the deterministic exclusion test. */
export const CHAT_PERSON_FORBIDDEN_FIELDS = [
  "iban",
  "swift",
  "baseCompensation",
  "dayRateAmount",
  "dayRateCurrency",
  "dayRateInternalCost",
  "costToCognirisePerDay",
  "notes",
  "gender",
  "nationality",
  "payrollCountry",
  "noticePeriodDays",
  "partnerEconomicsId",
  "employeeIdExternal",
] as const;

/** Resolve an account reference (id or free text) with the shared
 *  resolver; emits disambiguation/not_found ToolResults. */
async function resolveAccountRef(
  input: Record<string, unknown>,
  persona: CliPersona,
): Promise<{ id: string; label: string } | ToolResult> {
  const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
  if (accountId) {
    const [row] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, accountId),
          eq(atelierAccounts.orgId, persona.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return notFound("account");
    return { id: row.id, label: row.name };
  }
  const q = typeof input.accountName === "string" ? input.accountName.trim() : "";
  if (!q) {
    return {
      ok: false,
      errorCode: "invalid_input",
      errorMessage: "Provide accountId or accountName.",
    };
  }
  const r = await resolveAccount(q, persona);
  if (r.kind === "match") return { id: r.id, label: r.label };
  if (r.kind === "choices") {
    return {
      ok: true,
      data: { prompt: r.prompt, options: r.options },
      disambiguation: { kind: "account", options: r.options },
    };
  }
  return { ok: false, errorCode: "not_found", errorMessage: `no account matched "${q}"` };
}

function isToolResult(v: unknown): v is ToolResult {
  return typeof v === "object" && v !== null && "ok" in (v as Record<string, unknown>);
}

// ---------------------------------------------------------------------
// roster.list — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "roster.list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "roster_list",
  description:
    "List the firm's internal people directory (employees, contractors, partner-firm resources), scoped to what the caller may see. Returns name, title, worker type, email, and country per person.",
  slashAliases: { en: ["/roster", "/people", "/directory"], fr: ["/effectif"] },
  inputSchema: {
    type: "object",
    properties: {
      workerType: {
        type: "string",
        description: "Optional filter: employee | contractor | partner_firm_resource | all (default all).",
      },
      status: { type: "string", description: "Optional status filter (e.g. active)." },
      q: { type: "string", description: "Optional free-text filter on name / email / title." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["roster", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show me the staff roster", "List all employees", "Who works at the firm?"],
    ar: ["اعرض قائمة الموظفين"],
    fr: ["Affiche la liste du personnel"],
  },
  async run(input, ctx) {
    if (isRestrictedPersona(ctx.persona.role)) {
      return denyForbidden(
        "The staff directory is not available to your role. You can ask about your own profile instead.",
      );
    }
    const me = await loadMe(ctx);
    if (!me) return denyForbidden("No active persona.");
    const scope = await resolveRosterScope(me);
    const wt = String(input.workerType ?? "all");
    const list = await listPersons({
      workerType: (["employee", "contractor", "partner_firm_resource"].includes(wt)
        ? wt
        : "all") as Parameters<typeof listPersons>[0]["workerType"],
      q: typeof input.q === "string" ? input.q : undefined,
      status: typeof input.status === "string" ? input.status : undefined,
      includeComp: false,
    });
    let visible: PersonWire[];
    if (scope.kind === "full") {
      visible = list.map((p) => sanitizeForViewer(p, me));
    } else {
      visible = list
        .filter(
          (p) =>
            scope.personIds.has(p.id) ||
            (scope.selfPersonId !== null && scope.selfPersonId === p.id),
        )
        .map(toBusinessWire);
    }
    return {
      ok: true,
      data: {
        items: visible.map((p) => {
          const card = toChatPersonCard(p);
          return { ...card, label: p.fullName };
        }),
        total: visible.length,
        scoped: scope.kind !== "full",
      },
    };
  },
});

// ---------------------------------------------------------------------
// roster.person_detail — contact_card
// ---------------------------------------------------------------------
defineCapability({
  id: "roster.person_detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "person_detail",
  description:
    "Show one internal person's business profile: name, title, work email, mobile numbers, office, status, start date, manager and direct reports. Never returns compensation, bank, or HR data. Accepts a roster person id or a name.",
  slashAliases: { en: ["/person", "/who-is"], fr: ["/personne"] },
  inputSchema: {
    type: "object",
    properties: {
      personId: { type: "string", description: "Roster person id (employee/contractor/partner resource)." },
      name: { type: "string", description: "Person name to look up when the id is unknown." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["roster", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "contact_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What is Sara's mobile number?", "Show me Karim's profile", "Who is our head of design?"],
    ar: ["ما هو رقم جوال سارة؟"],
    fr: ["Quel est le numéro de Sara ?"],
  },
  async run(input, ctx) {
    const me = await loadMe(ctx);
    if (!me) return denyForbidden("No active persona.");
    let personId = typeof input.personId === "string" ? input.personId.trim() : "";
    if (!personId) {
      const q = typeof input.name === "string" ? input.name.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide personId or name." };
      }
      const matches = (
        await listPersons({ workerType: "all", q, includeComp: false })
      ).filter((p) => p.status !== "inactive");
      if (matches.length === 0) return notFound("person");
      if (matches.length > 1) {
        const options = matches.slice(0, 5).map((p) => ({
          id: p.id,
          label: p.fullName,
          secondary: p.title ?? p.workerType,
        }));
        return {
          ok: true,
          data: { prompt: `Which person did you mean by "${q}"?`, options },
          disambiguation: { kind: "contact", options },
        };
      }
      personId = matches[0]!.id;
    }
    const allowed = await canViewPersonViaRosterScope(me, personId);
    if (!allowed) {
      return denyForbidden(
        "You may only view your own profile and people in your reports tree.",
      );
    }
    const person = await getPerson(personId, false);
    if (!person) return notFound("person");
    // Manager + direct reports (business-only labels).
    const edges = await db
      .select({
        personId: atelierRosterReportsTo.personId,
        managerPersonId: atelierRosterReportsTo.managerPersonId,
      })
      .from(atelierRosterReportsTo)
      .where(eq(atelierRosterReportsTo.orgId, me.orgId));
    const managerIds = edges.filter((e) => e.personId === personId).map((e) => e.managerPersonId);
    const reportIds = edges.filter((e) => e.managerPersonId === personId).map((e) => e.personId);
    const nameOf = async (ids: string[]) => {
      const out: Array<{ id: string; fullName: string; title: string | null }> = [];
      for (const id of ids.slice(0, 15)) {
        const p = await getPerson(id, false);
        if (p) out.push({ id: p.id, fullName: p.fullName, title: p.title ?? null });
      }
      return out;
    };
    return {
      ok: true,
      data: {
        person: toChatPersonCard(person),
        managers: await nameOf(managerIds),
        directReports: await nameOf(reportIds),
        directReportCount: reportIds.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// roster.person_reports — entity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "roster.person_reports",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "person_reports",
  description:
    "Show who a person reports to and who reports to them (org-chart edges). Business names and titles only.",
  slashAliases: { en: ["/reports-to", "/org-chart"] },
  inputSchema: {
    type: "object",
    properties: {
      personId: { type: "string" },
      name: { type: "string", description: "Person name when the id is unknown." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["roster", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Who does Karim report to?", "Who reports to Sara?"],
    ar: ["لمن يرفع كريم تقاريره؟"],
    fr: ["À qui Karim rend-il compte ?"],
  },
  async run(input, ctx) {
    if (isRestrictedPersona(ctx.persona.role)) {
      return denyForbidden("Org-chart lookups are not available to your role.");
    }
    const me = await loadMe(ctx);
    if (!me) return denyForbidden("No active persona.");
    let personId = typeof input.personId === "string" ? input.personId.trim() : "";
    if (!personId) {
      const q = typeof input.name === "string" ? input.name.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide personId or name." };
      }
      const matches = await listPersons({ workerType: "all", q, includeComp: false });
      if (matches.length === 0) return notFound("person");
      if (matches.length > 1) {
        const options = matches.slice(0, 5).map((p) => ({
          id: p.id,
          label: p.fullName,
          secondary: p.title ?? p.workerType,
        }));
        return {
          ok: true,
          data: { prompt: `Which person did you mean by "${q}"?`, options },
          disambiguation: { kind: "contact", options },
        };
      }
      personId = matches[0]!.id;
    }
    const allowed = await canViewPersonViaRosterScope(me, personId);
    if (!allowed) {
      return denyForbidden("You may only view your own profile and people in your reports tree.");
    }
    const person = await getPerson(personId, false);
    if (!person) return notFound("person");
    const edges = await db
      .select({
        personId: atelierRosterReportsTo.personId,
        managerPersonId: atelierRosterReportsTo.managerPersonId,
      })
      .from(atelierRosterReportsTo)
      .where(eq(atelierRosterReportsTo.orgId, me.orgId));
    const managerIds = edges.filter((e) => e.personId === personId).map((e) => e.managerPersonId);
    const reportIds = edges.filter((e) => e.managerPersonId === personId).map((e) => e.personId);
    const resolveNames = async (ids: string[]) => {
      const out: Array<{ id: string; fullName: string; title: string | null }> = [];
      for (const id of ids.slice(0, 25)) {
        const p = await getPerson(id, false);
        if (p) out.push({ id: p.id, fullName: p.fullName, title: p.title ?? null });
      }
      return out;
    };
    return {
      ok: true,
      data: {
        person: { id: person.id, fullName: person.fullName, title: person.title ?? null },
        managers: await resolveNames(managerIds),
        directReports: await resolveNames(reportIds),
      },
    };
  },
});

// ---------------------------------------------------------------------
// contact.list_for_account — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "contact.list_for_account",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_list",
  description:
    "List the client-side contacts (stakeholders) on an account: name, title, email, phone, disposition, influence. Accepts an account id or name.",
  slashAliases: { en: ["/contacts"], fr: ["/contacts"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountName: { type: "string" },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["account_workspace", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Who are our contacts at DEWA?", "List stakeholders on the NEOM account"],
    ar: ["من هم جهات الاتصال لدينا في ديوا؟"],
    fr: ["Qui sont nos contacts chez DEWA ?"],
  },
  async run(input, ctx) {
    const acc = await resolveAccountRef(input, ctx.persona);
    if (isToolResult(acc)) return acc;
    const me = { id: ctx.persona.id, role: ctx.persona.role };
    const access = await engAclFor(ctx.persona);
    const ok = await canSeeAccount(access, me, acc.id);
    if (!ok) return denyForbidden(`You don't have access to the account "${acc.label}".`);
    const rows = await db
      .select({
        id: atelierContacts.id,
        fullName: atelierContacts.fullName,
        title: atelierContacts.title,
        seniority: atelierContacts.seniority,
        email: atelierContacts.email,
        phone: atelierContacts.phone,
        disposition: atelierContacts.disposition,
        influenceScore: atelierContacts.influenceScore,
        relationshipStrength: atelierContacts.relationshipStrength,
      })
      .from(atelierContacts)
      .where(
        and(
          eq(atelierContacts.orgId, ctx.persona.orgId),
          eq(atelierContacts.accountId, acc.id),
          isNull(atelierContacts.deletedAt),
        ),
      );
    rows.sort((a, b) => (b.influenceScore ?? 0) - (a.influenceScore ?? 0));
    return {
      ok: true,
      data: {
        account: { id: acc.id, name: acc.label },
        items: rows.map((c) => ({
          id: c.id,
          label: c.fullName,
          title: c.title ?? null,
          seniority: c.seniority ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          disposition: c.disposition,
          influenceScore: c.influenceScore,
          relationshipStrength: c.relationshipStrength,
          href: `/accounts/${acc.id}?tab=contacts`,
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// contact.detail — contact_card
// ---------------------------------------------------------------------
defineCapability({
  id: "contact.detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "contact_detail",
  description:
    "Show one client contact's card: title, seniority, email, phone, LinkedIn, disposition, influence, relationship strength, last touch. Accepts a contact id or a name (optionally scoped to an account).",
  slashAliases: { en: ["/contact"], fr: ["/contact"] },
  inputSchema: {
    type: "object",
    properties: {
      contactId: { type: "string" },
      name: { type: "string" },
      accountName: { type: "string", description: "Optional account to narrow a name search." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["account_workspace", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "contact_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["What's the email for Ahmed at DEWA?", "Show me the contact card for Fatima"],
    ar: ["ما هو البريد الإلكتروني لأحمد في ديوا؟"],
    fr: ["Quel est l'email d'Ahmed chez DEWA ?"],
  },
  async run(input, ctx) {
    let contactId = typeof input.contactId === "string" ? input.contactId.trim() : "";
    if (!contactId) {
      const q = typeof input.name === "string" ? input.name.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide contactId or name." };
      }
      let accountId: string | undefined;
      if (typeof input.accountName === "string" && input.accountName.trim()) {
        const acc = await resolveAccountRef({ accountName: input.accountName }, ctx.persona);
        if (isToolResult(acc)) return acc;
        accountId = acc.id;
      }
      const where = and(
        or(ilike(atelierContacts.fullName, `%${q}%`), ilike(atelierContacts.email, `%${q}%`)),
        eq(atelierContacts.orgId, ctx.persona.orgId),
        isNull(atelierContacts.deletedAt),
        accountId ? eq(atelierContacts.accountId, accountId) : undefined,
      );
      const rows = await db
        .select({ id: atelierContacts.id, fullName: atelierContacts.fullName, title: atelierContacts.title })
        .from(atelierContacts)
        .where(where)
        .limit(6);
      if (rows.length === 0) return notFound("contact");
      if (rows.length > 1) {
        const options = rows.slice(0, 5).map((r) => ({
          id: r.id,
          label: r.fullName,
          secondary: r.title ?? undefined,
        }));
        return {
          ok: true,
          data: { prompt: `Which contact did you mean by "${q}"?`, options },
          disambiguation: { kind: "contact", options },
        };
      }
      contactId = rows[0]!.id;
    }
    const [c] = await db
      .select()
      .from(atelierContacts)
      .where(
        and(
          eq(atelierContacts.id, contactId),
          eq(atelierContacts.orgId, ctx.persona.orgId),
          isNull(atelierContacts.deletedAt),
        ),
      )
      .limit(1);
    if (!c) return notFound("contact");
    const me = { id: ctx.persona.id, role: ctx.persona.role };
    const access = await engAclFor(ctx.persona);
    const ok = await canSeeAccount(access, me, c.accountId);
    if (!ok) return denyForbidden("You don't have access to this contact's account.");
    const [acc] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, c.accountId))
      .limit(1);
    return {
      ok: true,
      data: {
        contact: {
          id: c.id,
          fullName: c.fullName,
          title: c.title ?? null,
          seniority: c.seniority ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          linkedinUrl: c.linkedinUrl ?? null,
          buyerPersona: c.buyerPersona ?? null,
          disposition: c.disposition,
          influenceScore: c.influenceScore,
          relationshipStrength: c.relationshipStrength,
          lastContactAt: c.lastContactAt ?? null,
          nextTouchAt: c.nextTouchAt ?? null,
          timeInRole: c.timeInRole ?? null,
        },
        account: acc ? { id: acc.id, name: acc.name } : null,
        href: `/accounts/${c.accountId}?tab=contacts`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// meeting helpers
// ---------------------------------------------------------------------

interface MeetingParent {
  kind: "opportunity" | "engagement";
  id: string;
  name: string;
  accountId: string | null;
}

/** Resolve the live parent of a meeting; null when the parent is
 *  deleted (orphan meetings never surface — Task #404 mirrors the
 *  live-parent filter used by REST meeting reads). */
async function liveMeetingParent(
  parentType: string,
  parentId: string,
  orgId: string,
): Promise<MeetingParent | null> {
  if (parentType === "engagement") {
    const [eng] = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name, accountId: atelierEngagements.accountId })
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.id, parentId),
          eq(atelierEngagements.orgId, orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      )
      .limit(1);
    return eng ? { kind: "engagement", id: eng.id, name: eng.name, accountId: eng.accountId } : null;
  }
  const [opp] = await db
    .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, accountId: atelierOpportunities.accountId })
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.id, parentId),
        eq(atelierOpportunities.orgId, orgId),
        isNull(atelierOpportunities.deletedAt),
      ),
    )
    .limit(1);
  return opp ? { kind: "opportunity", id: opp.id, name: opp.name, accountId: opp.accountId } : null;
}

/** Same ACL a REST meeting read enforces: engagement grant for
 *  engagement-parented meetings, account visibility for opp-parented. */
async function canSeeMeetingParent(
  persona: CliPersona,
  parent: MeetingParent,
): Promise<boolean> {
  const access = await engAclFor(persona);
  if (parent.kind === "engagement") {
    if (access.all === true || access.ids.has(parent.id)) return true;
    return parent.accountId
      ? canSeeAccount(access, { id: persona.id }, parent.accountId)
      : false;
  }
  return parent.accountId
    ? canSeeAccount(access, { id: persona.id }, parent.accountId)
    : false;
}

// ---------------------------------------------------------------------
// meeting.list — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "meeting.list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "meeting_list",
  description:
    "List recorded meetings the caller may see, optionally filtered to an account or engagement. Returns title, date, kind, and parent per meeting.",
  slashAliases: { en: ["/meetings"], fr: ["/reunions"] },
  inputSchema: {
    type: "object",
    properties: {
      accountName: { type: "string" },
      engagementName: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "account_workspace", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show recent meetings", "List meetings on the DEWA account"],
    ar: ["اعرض الاجتماعات الأخيرة"],
    fr: ["Affiche les réunions récentes"],
  },
  async run(input, ctx) {
    const limit = Math.max(1, Math.min(50, Number(input.limit ?? 15)));
    let engagementFilter: string | null = null;
    let accountFilter: string | null = null;
    if (typeof input.engagementName === "string" && input.engagementName.trim()) {
      const r = await resolveEngagement(input.engagementName.trim(), ctx.persona);
      if (r.kind === "choices") {
        return {
          ok: true,
          data: { prompt: r.prompt, options: r.options },
          disambiguation: { kind: "engagement", options: r.options },
        };
      }
      if (r.kind === "none") return notFound("engagement");
      engagementFilter = r.id;
    } else if (typeof input.accountName === "string" && input.accountName.trim()) {
      const acc = await resolveAccountRef({ accountName: input.accountName }, ctx.persona);
      if (isToolResult(acc)) return acc;
      const me = { id: ctx.persona.id, role: ctx.persona.role };
      const access = await engAclFor(ctx.persona);
      const ok = await canSeeAccount(access, me, acc.id);
      if (!ok) return denyForbidden(`You don't have access to the account "${acc.label}".`);
      accountFilter = acc.id;
    }
    const rows = await db
      .select()
      .from(atelierMeetings)
      .where(
        and(
          eq(atelierMeetings.orgId, ctx.persona.orgId),
          isNull(atelierMeetings.deletedAt),
        ),
      )
      .orderBy(desc(atelierMeetings.date))
      .limit(200);
    const items: Array<Record<string, unknown>> = [];
    for (const m of rows) {
      if (items.length >= limit) break;
      const parent = await liveMeetingParent(m.parentType, m.parentId, ctx.persona.orgId);
      if (!parent) continue;
      if (engagementFilter && !(parent.kind === "engagement" && parent.id === engagementFilter)) continue;
      if (accountFilter && parent.accountId !== accountFilter) continue;
      if (!(await canSeeMeetingParent(ctx.persona, parent))) continue;
      items.push({
        id: m.id,
        label: m.title,
        date: m.date,
        kind: m.kind,
        status: m.status,
        parentType: parent.kind,
        parentName: parent.name,
        href: parent.kind === "engagement" ? `/engagements/${parent.id}` : `/opportunities/${parent.id}`,
      });
    }
    return { ok: true, data: { items, total: items.length } };
  },
});

// ---------------------------------------------------------------------
// meeting.detail — meeting_card
// ---------------------------------------------------------------------
defineCapability({
  id: "meeting.detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "meeting_detail",
  description:
    "Show one meeting's card: title, date, attendees, summary, decisions, and action items. Requires access to the meeting's parent opportunity or engagement.",
  slashAliases: { en: ["/meeting"] },
  inputSchema: {
    type: "object",
    properties: {
      meetingId: { type: "string" },
      title: { type: "string", description: "Meeting title to look up when the id is unknown." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "account_workspace", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "meeting_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Show the kickoff meeting summary", "What were the action items from the steering meeting?"],
    ar: ["اعرض ملخص اجتماع الانطلاق"],
    fr: ["Montre le résumé de la réunion de lancement"],
  },
  async run(input, ctx) {
    let meetingId = typeof input.meetingId === "string" ? input.meetingId.trim() : "";
    if (!meetingId) {
      const q = typeof input.title === "string" ? input.title.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide meetingId or title." };
      }
      const rows = await db
        .select({ id: atelierMeetings.id, title: atelierMeetings.title, date: atelierMeetings.date })
        .from(atelierMeetings)
        .where(
          and(
            eq(atelierMeetings.orgId, ctx.persona.orgId),
            isNull(atelierMeetings.deletedAt),
            ilike(atelierMeetings.title, `%${q}%`),
          ),
        )
        .orderBy(desc(atelierMeetings.date))
        .limit(6);
      if (rows.length === 0) return notFound("meeting");
      if (rows.length > 1) {
        const options = rows.slice(0, 5).map((r) => ({ id: r.id, label: r.title, secondary: r.date }));
        return {
          ok: true,
          data: { prompt: `Which meeting did you mean by "${q}"?`, options },
          disambiguation: { kind: "meeting", options },
        };
      }
      meetingId = rows[0]!.id;
    }
    const [m] = await db
      .select()
      .from(atelierMeetings)
      .where(
        and(
          eq(atelierMeetings.id, meetingId),
          eq(atelierMeetings.orgId, ctx.persona.orgId),
          isNull(atelierMeetings.deletedAt),
        ),
      )
      .limit(1);
    if (!m) return notFound("meeting");
    const parent = await liveMeetingParent(m.parentType, m.parentId, ctx.persona.orgId);
    if (!parent) return notFound("meeting");
    if (!(await canSeeMeetingParent(ctx.persona, parent))) {
      return denyForbidden("You don't have access to this meeting's parent.");
    }
    return {
      ok: true,
      data: {
        meeting: {
          id: m.id,
          title: m.title,
          date: m.date,
          kind: m.kind,
          status: m.status,
          attendees: m.attendees ?? [],
          summary: m.summary ?? null,
          decisions: m.decisions ?? [],
          actionItems: m.actionItems ?? [],
        },
        parent: { kind: parent.kind, id: parent.id, name: parent.name },
        href: parent.kind === "engagement" ? `/engagements/${parent.id}` : `/opportunities/${parent.id}`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// document.list — ranked_list (metadata only; never content)
// ---------------------------------------------------------------------
defineCapability({
  id: "document.list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "document_list",
  description:
    "List or search documents in the library by title, category (proposal|deliverable|contract|template|other), account or engagement. Returns metadata only (title, category, version, file name) — never document content.",
  slashAliases: { en: ["/documents", "/docs"], fr: ["/documents"] },
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Free-text match on title / notes / file name." },
      category: { type: "string" },
      accountName: { type: "string" },
      engagementName: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "account_workspace", "engagement_dashboard", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Find the DEWA proposal document", "List contract documents", "Search documents for NEOM"],
    ar: ["ابحث عن مستند عرض ديوا"],
    fr: ["Trouve le document de proposition DEWA"],
  },
  async run(input, ctx) {
    const limit = Math.max(1, Math.min(50, Number(input.limit ?? 15)));
    let accountFilter: string | null = null;
    let engagementFilter: string | null = null;
    if (typeof input.engagementName === "string" && input.engagementName.trim()) {
      const r = await resolveEngagement(input.engagementName.trim(), ctx.persona);
      if (r.kind === "choices") {
        return {
          ok: true,
          data: { prompt: r.prompt, options: r.options },
          disambiguation: { kind: "engagement", options: r.options },
        };
      }
      if (r.kind === "none") return notFound("engagement");
      engagementFilter = r.id;
    }
    if (typeof input.accountName === "string" && input.accountName.trim()) {
      const acc = await resolveAccountRef({ accountName: input.accountName }, ctx.persona);
      if (isToolResult(acc)) return acc;
      accountFilter = acc.id;
    }
    const conds = [
      eq(atelierDocuments.orgId, ctx.persona.orgId),
      eq(atelierDocuments.status, "active"),
      isNull(atelierDocuments.deletedAt),
    ];
    if (accountFilter) conds.push(eq(atelierDocuments.accountId, accountFilter));
    if (engagementFilter) conds.push(eq(atelierDocuments.engagementId, engagementFilter));
    if (typeof input.category === "string" && input.category.trim()) {
      conds.push(eq(atelierDocuments.category, input.category.trim().toLowerCase()));
    }
    const q = typeof input.q === "string" ? input.q.trim() : "";
    const docs = await db
      .select()
      .from(atelierDocuments)
      .where(and(...conds))
      .orderBy(desc(atelierDocuments.updatedAt))
      .limit(200);
    const me = await loadMe(ctx);
    if (!me) return denyForbidden("No active persona.");
    const access = await engAclFor(ctx.persona);
    const qLower = q.toLowerCase();
    const items: Array<Record<string, unknown>> = [];
    for (const doc of docs) {
      if (items.length >= limit) break;
      let currentVersion: typeof atelierDocumentVersions.$inferSelect | null = null;
      if (doc.currentVersionId) {
        const [v] = await db
          .select()
          .from(atelierDocumentVersions)
          .where(eq(atelierDocumentVersions.id, doc.currentVersionId))
          .limit(1);
        currentVersion = v ?? null;
      }
      if (qLower) {
        const hay = `${doc.title} ${doc.notes ?? ""} ${currentVersion?.fileName ?? ""}`.toLowerCase();
        if (!hay.includes(qLower)) continue;
      }
      if (!(await canSeeDocument(me, access, doc))) continue;
      items.push({
        id: doc.id,
        label: doc.title,
        category: doc.category,
        docKind: doc.docKind ?? null,
        accountId: doc.accountId ?? null,
        engagementId: doc.engagementId ?? null,
        versionNumber: currentVersion?.versionNumber ?? null,
        fileName: currentVersion?.fileName ?? null,
        updatedAt: doc.updatedAt,
        href: `/documents`,
      });
    }
    return { ok: true, data: { items, total: items.length } };
  },
});

// ---------------------------------------------------------------------
// opportunity.detail — opportunity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "opportunity.detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_detail",
  description:
    "Show one opportunity's card: stage, deal size, probability, days in stage, next milestone, account, and the latest scout brief status. Accepts an opportunity id or name.",
  slashAliases: { en: ["/opp", "/opportunity"], fr: ["/opportunite"] },
  inputSchema: {
    type: "object",
    properties: {
      opportunityId: { type: "string" },
      name: { type: "string" },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["opportunity_workspace", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "opportunity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show me the DEWA digital opportunity", "What stage is the NEOM deal in?"],
    ar: ["اعرض فرصة ديوا الرقمية"],
    fr: ["Montre l'opportunité DEWA"],
  },
  async run(input, ctx) {
    let oppId = typeof input.opportunityId === "string" ? input.opportunityId.trim() : "";
    if (!oppId) {
      const q = typeof input.name === "string" ? input.name.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide opportunityId or name." };
      }
      const rows = await db
        .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, salesStage: atelierOpportunities.salesStage })
        .from(atelierOpportunities)
        .where(
          and(
            eq(atelierOpportunities.orgId, ctx.persona.orgId),
            isNull(atelierOpportunities.deletedAt),
            ilike(atelierOpportunities.name, `%${q}%`),
          ),
        )
        .limit(6);
      if (rows.length === 0) return notFound("opportunity");
      if (rows.length > 1) {
        const options = rows.slice(0, 5).map((r) => ({
          id: r.id,
          label: r.name,
          secondary: `stage: ${r.salesStage}`,
        }));
        return {
          ok: true,
          data: { prompt: `Which opportunity did you mean by "${q}"?`, options },
          disambiguation: { kind: "opportunity", options },
        };
      }
      oppId = rows[0]!.id;
    }
    const [opp] = await db
      .select()
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.id, oppId),
          eq(atelierOpportunities.orgId, ctx.persona.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      )
      .limit(1);
    if (!opp) return notFound("opportunity");
    const me = { id: ctx.persona.id, role: ctx.persona.role };
    const access = await engAclFor(ctx.persona);
    const ok = await canSeeAccount(access, me, opp.accountId);
    if (!ok) return denyForbidden("You don't have access to this opportunity's account.");
    const [acc] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, opp.accountId))
      .limit(1);
    const [brief] = await db
      .select({ id: atelierBriefs.id, status: atelierBriefs.status, confidence: atelierBriefs.confidence, updatedAt: atelierBriefs.updatedAt })
      .from(atelierBriefs)
      .where(and(eq(atelierBriefs.opportunityId, opp.id), isNull(atelierBriefs.deletedAt)))
      .orderBy(desc(atelierBriefs.updatedAt))
      .limit(1);
    return {
      ok: true,
      data: {
        opportunity: {
          id: opp.id,
          name: opp.name,
          stage: resolveSalesStage(opp.salesStage),
          dealSizeUsd: opp.dealSizeHypothesis,
          probabilityPct: opp.probabilityPct,
          weightedValueUsd: (opp.dealSizeHypothesis * opp.probabilityPct) / 100,
          daysInStage: opp.daysInStage,
          nextMilestone: opp.nextMilestone ?? null,
        },
        account: acc ? { id: acc.id, name: acc.name } : null,
        scoutBrief: brief
          ? { id: brief.id, status: brief.status, confidence: brief.confidence ?? null, updatedAt: brief.updatedAt }
          : null,
        href: `/opportunities/${opp.id}`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// engagement.detail — entity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "engagement.detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "engagement_detail",
  description:
    "Show one engagement's card: stage, RAID status, start / planned end, deliverables due this week, open RAID count, and account. Accepts an engagement id or name.",
  slashAliases: { en: ["/engagement", "/eng"], fr: ["/mission"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      name: { type: "string" },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show the DEWA engagement status", "How is the NEOM project going?"],
    ar: ["اعرض حالة ارتباط ديوا"],
    fr: ["Montre le statut de la mission DEWA"],
  },
  async run(input, ctx) {
    let engId = typeof input.engagementId === "string" ? input.engagementId.trim() : "";
    if (!engId) {
      const q = typeof input.name === "string" ? input.name.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide engagementId or name." };
      }
      const r = await resolveEngagement(q, ctx.persona);
      if (r.kind === "choices") {
        return {
          ok: true,
          data: { prompt: r.prompt, options: r.options },
          disambiguation: { kind: "engagement", options: r.options },
        };
      }
      if (r.kind === "none") return notFound("engagement");
      engId = r.id;
    }
    const access = await engAclFor(ctx.persona);
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.id, engId),
          eq(atelierEngagements.orgId, ctx.persona.orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      )
      .limit(1);
    if (!eng) return notFound("engagement");
    if (!(access.all === true || access.ids.has(eng.id))) {
      return denyForbidden("You don't have access to this engagement.");
    }
    const [acc] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, eng.accountId))
      .limit(1);
    const raid = await db
      .select({ id: atelierRaidItems.id, severity: atelierRaidItems.severity })
      .from(atelierRaidItems)
      .where(
        and(
          eq(atelierRaidItems.engagementId, eng.id),
          eq(atelierRaidItems.status, "open"),
          isNull(atelierRaidItems.deletedAt),
        ),
      );
    return {
      ok: true,
      data: {
        engagement: {
          id: eng.id,
          name: eng.name,
          plmStage: eng.plmStage,
          raidStatus: eng.raidStatus,
          startDate: eng.startDate,
          plannedEndDate: eng.plannedEndDate,
          deliverablesDueThisWeek: eng.deliverablesDueThisWeek,
          workstreams: (eng.workstreams ?? []).map((w) => ({ name: w.name, status: w.status })),
        },
        openRaid: {
          total: raid.length,
          red: raid.filter((r) => r.severity === "red").length,
          amber: raid.filter((r) => r.severity === "amber").length,
        },
        account: acc ? { id: acc.id, name: acc.name } : null,
        href: `/engagements/${eng.id}`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// expense.list_mine — ranked_list (strictly self-scoped)
// ---------------------------------------------------------------------
defineCapability({
  id: "expense.list_mine",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "expense_list",
  description:
    "List the caller's OWN expenses (self-scoped), optionally filtered by month (YYYY-MM), status, or category. Returns date, merchant, category, USD amount, and status per expense.",
  slashAliases: { en: ["/my-expenses", "/expenses"], fr: ["/mes-depenses"] },
  inputSchema: {
    type: "object",
    properties: {
      month: { type: "string", description: "YYYY-MM filter on expense date." },
      status: { type: "string", description: "draft | submitted | approved | rejected | reimbursed" },
      category: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my expenses this month", "List my submitted expenses"],
    ar: ["اعرض مصاريفي لهذا الشهر"],
    fr: ["Affiche mes dépenses du mois"],
  },
  async run(input, ctx) {
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 25)));
    // Strictly self-scoped — expenses key on the calling user's id.
    const rows = await db
      .select()
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.orgId, ctx.persona.orgId),
          eq(atelierExpenses.personId, ctx.persona.id),
        ),
      )
      .orderBy(desc(atelierExpenses.expenseDate))
      .limit(500);
    const month = typeof input.month === "string" ? input.month.trim() : "";
    const status = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
    const category = typeof input.category === "string" ? input.category.trim().toLowerCase() : "";
    const filtered = rows.filter((e) => {
      if (month && !e.expenseDate.startsWith(month)) return false;
      if (status && e.status !== status) return false;
      if (category && e.category.toLowerCase() !== category) return false;
      return true;
    });
    const items = filtered.slice(0, limit).map((e) => ({
      id: e.id,
      label: e.merchant ?? e.description ?? e.category,
      date: e.expenseDate,
      category: e.category,
      amount: e.amount,
      currency: e.currency,
      usdAmount: e.usdAmount,
      status: e.status,
      policyStatus: e.policyStatus,
      href: `/wallet`,
    }));
    const totalUsd = filtered.reduce((acc, e) => acc + (e.usdAmount ?? 0), 0);
    return {
      ok: true,
      data: { items, total: filtered.length, totalUsd },
    };
  },
});
