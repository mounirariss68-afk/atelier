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

import { and, eq, isNull, ilike, or, desc, inArray, sql } from "drizzle-orm";
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
  atelierAccountTeamMembers,
  atelierEngagementAccess,
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
  resolveLinkedUserId,
  type PersonWire,
} from "../../routes/atelier/rosterRoutes.js";
import { isRestrictedPersona } from "../../routes/atelier/personaRoles.js";
import { resolveSalesStage } from "../atelier-agents/pipeline.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

/** Task #538 — contact name search also matches the linked structured
 *  person record's preferred/display name. */
function contactPersonNameMatch(pat: string) {
  return sql`EXISTS (SELECT 1 FROM atelier_persons p WHERE p.id = ${atelierContacts.personId} AND (p.preferred_name ILIKE ${pat} OR p.display_name ILIKE ${pat}))`;
}

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

/**
 * Task #443 — SCOPED person-by-name matcher. `listPersons` itself is not
 * viewer-scoped, so any tool that surfaces name-match candidates (even
 * just in a disambiguation prompt) MUST filter through the caller's
 * roster scope first, or it leaks names/titles of people outside the
 * caller's perimeter. Returns only active people the caller may see.
 */
async function scopedPersonMatches(me: MeRow, q: string): Promise<PersonWire[]> {
  const scope = await resolveRosterScope(me);
  const matches = (
    await listPersons({ workerType: "all", q, includeComp: false })
  ).filter((p) => p.status !== "inactive");
  if (scope.kind === "full") return matches;
  return matches.filter(
    (p) =>
      scope.personIds.has(p.id) ||
      (scope.selfPersonId !== null && scope.selfPersonId === p.id),
  );
}

/**
 * Task #469 — cross-domain person fallback (CRM miss → internal roster).
 * When a *contact* lookup finds nobody in the client-contact table, the
 * person may be internal (e.g. "phone of Mounir" — a founder). Search
 * the caller-SCOPED internal directory before declaring the person
 * nonexistent. Returns null when the roster has no visible match either
 * (so the caller can emit its own not_found).
 */
async function internalPersonFallback(
  ctx: ToolContext,
  q: string,
): Promise<ToolResult | null> {
  const me = await loadMe(ctx);
  if (!me) return null;
  const matches = await scopedPersonMatches(me, q);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const options = matches.slice(0, 5).map((p) => ({
      id: p.id,
      label: p.fullName,
      secondary: p.title ?? p.workerType,
    }));
    return {
      ok: true,
      data: {
        prompt: `"${q}" matched people in the internal directory. Which did you mean?`,
        options,
      },
      disambiguation: { kind: "person", options },
    };
  }
  const p = matches[0]!;
  if (!(await canViewPersonViaRosterScope(me, p.id))) return null;
  return {
    ok: true,
    data: {
      person: toChatPersonCard(p),
      source: "internal_directory",
      note: `${p.fullName} is in the firm's internal directory (${p.workerType.replace(/_/g, " ")}), not a client contact.`,
    },
  };
}

/**
 * Task #469 — cross-domain person fallback (roster miss → CRM contacts).
 * When a *person* lookup finds nobody internal, the name may be a client
 * contact. Only contacts on accounts the caller can see are considered,
 * so restricted personas cannot discover out-of-scope people.
 */
async function crmContactFallback(
  ctx: ToolContext,
  q: string,
): Promise<ToolResult | null> {
  const rows = await db
    .select({
      id: atelierContacts.id,
      fullName: atelierContacts.fullName,
      title: atelierContacts.title,
      email: atelierContacts.email,
      phone: atelierContacts.phone,
      accountId: atelierContacts.accountId,
    })
    .from(atelierContacts)
    .where(
      and(
        or(
          ilike(atelierContacts.fullName, `%${q}%`),
          ilike(atelierContacts.email, `%${q}%`),
          contactPersonNameMatch(`%${q}%`),
        ),
        eq(atelierContacts.orgId, ctx.persona.orgId),
        isNull(atelierContacts.deletedAt),
      ),
    )
    // Fetch a wider candidate set BEFORE the ACL filter so a restricted
    // caller whose visible match sorts late isn't false-negatived.
    .limit(25);
  if (rows.length === 0) return null;
  const me = { id: ctx.persona.id, role: ctx.persona.role };
  const access = await engAclFor(ctx.persona);
  const flags = await Promise.all(rows.map((r) => canSeeAccount(access, me, r.accountId)));
  const visible = rows.filter((_, i) => flags[i]).slice(0, 6);
  if (visible.length === 0) return null;
  if (visible.length > 1) {
    const options = visible.slice(0, 5).map((r) => ({
      id: r.id,
      label: r.fullName,
      secondary: r.title ?? undefined,
    }));
    return {
      ok: true,
      data: {
        prompt: `"${q}" matched client contacts. Which did you mean?`,
        options,
      },
      disambiguation: { kind: "contact", options },
    };
  }
  const r = visible[0]!;
  const [acc] = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, r.accountId))
    .limit(1);
  return {
    ok: true,
    data: {
      contact: {
        id: r.id,
        fullName: r.fullName,
        title: r.title ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
      },
      account: acc ? { id: acc.id, name: acc.name } : null,
      source: "client_contacts",
      note: `${r.fullName} is a client contact${acc ? ` at ${acc.name}` : ""}, not an internal employee.`,
      href: `/accounts/${r.accountId}?tab=contacts`,
    },
  };
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
        // Task #469 — internal scope flag replaced by a human-readable
        // note (emitted only when limited) so clients never render a
        // bare "SCOPED false" metadata row.
        ...(scope.kind !== "full"
          ? { scopedNote: "Limited to people within your visibility scope." }
          : {}),
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
      // Task #469 — SCOPED matching (no name leaks in disambiguation)
      // plus cross-domain fallback into CRM contacts on a roster miss.
      const matches = await scopedPersonMatches(me, q);
      if (matches.length === 0) {
        const fb = await crmContactFallback(ctx, q);
        if (fb) return fb;
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `No internal person or client contact named "${q}" was found.`,
        };
      }
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
        or(
          ilike(atelierContacts.fullName, `%${q}%`),
          ilike(atelierContacts.email, `%${q}%`),
          contactPersonNameMatch(`%${q}%`),
        ),
        eq(atelierContacts.orgId, ctx.persona.orgId),
        isNull(atelierContacts.deletedAt),
        accountId ? eq(atelierContacts.accountId, accountId) : undefined,
      );
      const rows = await db
        .select({ id: atelierContacts.id, fullName: atelierContacts.fullName, title: atelierContacts.title })
        .from(atelierContacts)
        .where(where)
        .limit(6);
      if (rows.length === 0) {
        // Task #469 — the person may be internal, not a client contact.
        const fb = await internalPersonFallback(ctx, q);
        if (fb) return fb;
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `No client contact or internal person named "${q}" was found.`,
        };
      }
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
    if (!c) {
      // Task #469 — the id may be a roster person id (e.g. the model
      // re-called contact_detail with an id from an internal-directory
      // disambiguation). Try the roster before failing.
      const meRow = await loadMe(ctx);
      if (meRow && (await canViewPersonViaRosterScope(meRow, contactId))) {
        const p = await getPerson(contactId, false);
        if (p) {
          return {
            ok: true,
            data: { person: toChatPersonCard(p), source: "internal_directory" },
          };
        }
      }
      return notFound("contact");
    }
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

/** Task #553 — internal-meeting visibility: creator, attendee, or
 *  founding partner. Standalone meetings have no CRM parent to gate on. */
export function canSeeInternalMeeting(
  persona: { id: string; role: string },
  m: {
    createdByUserId: string | null;
    internalAttendees: Array<{ userId: string }> | null;
  },
): boolean {
  if (persona.role === "founding_partner") return true;
  if (m.createdByUserId === persona.id) return true;
  return (m.internalAttendees ?? []).some((a) => a.userId === persona.id);
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
      // Task #553 — standalone internal meetings: no CRM parent; visible
      // to creator / attendee / founding partner; excluded from account
      // or engagement-filtered listings.
      if (m.parentType === "internal") {
        if (engagementFilter || accountFilter) continue;
        if (!canSeeInternalMeeting(ctx.persona, m)) continue;
        items.push({
          id: m.id,
          label: m.title,
          date: m.date,
          kind: m.kind,
          status: m.status,
          parentType: "internal",
          parentName: "Internal",
          href: `/me?tab=calendar`,
        });
        continue;
      }
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
    // Task #553 — internal meetings: creator / attendee / FP visibility.
    if (m.parentType === "internal") {
      if (!canSeeInternalMeeting(ctx.persona, m)) {
        return denyForbidden("You don't have access to this internal meeting.");
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
            attendees: (m.internalAttendees ?? []).map((a) => a.name),
            startAt: m.startAt?.toISOString() ?? null,
            endAt: m.endAt?.toISOString() ?? null,
            locationType: m.locationType ?? null,
            joinUrl: m.joinUrl ?? null,
            summary: m.summary ?? null,
            decisions: m.decisions ?? [],
            actionItems: m.actionItems ?? [],
          },
          parent: { kind: "internal", id: "internal", name: "Internal" },
          href: "/me?tab=calendar",
        },
      };
    }
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

// ---------------------------------------------------------------------
// account.who_works — entity_card (Task #426 — composed cross-entity read)
//
// Answers compound "who works on account X and what's happening there?"
// questions in ONE tool call: staffed team (partner owner + account team
// + engagement-staffed people), open opportunities, active engagements,
// and recent meetings. Strictly read-only; reuses the SAME ACLs the
// individual reads enforce (canSeeAccount gate for the whole card,
// meeting-parent ACL per meeting row). Team members come from
// atelier_users, which carries no compensation/HR fields, so the
// projection is name/title/role-on-account only.
// ---------------------------------------------------------------------
defineCapability({
  id: "account.who_works",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_team_and_pipeline",
  description:
    "One-shot compound answer for an account: who works on it (partner owner, account team roles, people staffed on its engagements), its open opportunities with stages, active engagements, and the most recent meetings. Use for questions that combine team + pipeline + activity on one account.",
  slashAliases: { en: ["/who-works", "/account-team"], fr: ["/equipe-compte"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountName: { type: "string", description: "Account name to resolve when the id is unknown." },
      meetingLimit: { type: "integer", minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["account_workspace", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: [
      "Who works on the Aldrees account and what's the open pipeline there?",
      "Who from our team is staffed on DEWA?",
      "Show me the team, deals and recent meetings for NEOM",
    ],
    ar: ["من يعمل على حساب الدريس وما هي الفرص المفتوحة؟"],
    fr: ["Qui travaille sur le compte Aldrees et quel est le pipeline ouvert ?"],
  },
  async run(input, ctx) {
    const acc = await resolveAccountRef(input, ctx.persona);
    if (isToolResult(acc)) return acc;
    const me = { id: ctx.persona.id, role: ctx.persona.role };
    const access = await engAclFor(ctx.persona);
    if (!(await canSeeAccount(access, me, acc.id))) {
      return denyForbidden(`You don't have access to the account "${acc.label}".`);
    }
    const [accountRow] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, acc.id),
          eq(atelierAccounts.orgId, ctx.persona.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!accountRow) return notFound("account");

    // ---- engagements on the account (drives both the engagement block
    //      and the engagement-staffing part of the team) ----
    const engs = await db
      .select({
        id: atelierEngagements.id,
        name: atelierEngagements.name,
        plmStage: atelierEngagements.plmStage,
      })
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.accountId, acc.id),
          eq(atelierEngagements.orgId, ctx.persona.orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      );
    const activeEngs = engs.filter((e) => e.plmStage !== "closed");
    const engById = new Map(engs.map((e) => [e.id, e]));

    // ---- team: account-level roles + engagement staffing grants ----
    const [teamRows, grants] = await Promise.all([
      db
        .select({
          userId: atelierAccountTeamMembers.userId,
          roleOnAccount: atelierAccountTeamMembers.roleOnAccount,
        })
        .from(atelierAccountTeamMembers)
        .where(
          and(
            eq(atelierAccountTeamMembers.accountId, acc.id),
            isNull(atelierAccountTeamMembers.deletedAt),
          ),
        ),
      activeEngs.length
        ? db
            .select({
              userId: atelierEngagementAccess.userId,
              engagementId: atelierEngagementAccess.engagementId,
              roleOnEngagement: atelierEngagementAccess.roleOnEngagement,
            })
            .from(atelierEngagementAccess)
            .where(
              and(
                inArray(
                  atelierEngagementAccess.engagementId,
                  activeEngs.map((e) => e.id),
                ),
                eq(atelierEngagementAccess.status, "active"),
                isNull(atelierEngagementAccess.deletedAt),
              ),
            )
        : Promise.resolve([] as Array<{ userId: string; engagementId: string; roleOnEngagement: string }>),
    ]);

    // Aggregate per person: account-level role(s) + engagement staffings.
    const byUser = new Map<
      string,
      { accountRoles: Set<string>; staffedOn: Array<{ engagementId: string; engagementName: string; role: string }> }
    >();
    const ensure = (userId: string) => {
      let entry = byUser.get(userId);
      if (!entry) {
        entry = { accountRoles: new Set(), staffedOn: [] };
        byUser.set(userId, entry);
      }
      return entry;
    };
    if (accountRow.partnerOwnerId) ensure(accountRow.partnerOwnerId).accountRoles.add("partner_owner");
    for (const t of teamRows) ensure(t.userId).accountRoles.add(t.roleOnAccount);
    for (const g of grants) {
      const eng = engById.get(g.engagementId);
      if (!eng) continue;
      ensure(g.userId).staffedOn.push({
        engagementId: g.engagementId,
        engagementName: eng.name,
        role: g.roleOnEngagement,
      });
    }
    const userIds = Array.from(byUser.keys());
    const users = userIds.length
      ? await db
          .select({
            id: atelierUsers.id,
            name: atelierUsers.name,
            title: atelierUsers.title,
            roleLabel: atelierUsers.roleLabel,
          })
          .from(atelierUsers)
          .where(
            and(
              inArray(atelierUsers.id, userIds),
              eq(atelierUsers.orgId, ctx.persona.orgId),
              isNull(atelierUsers.deletedAt),
            ),
          )
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    // Only surface live users; roles sorted so partner_owner leads.
    const ROLE_ORDER = ["partner_owner", "account_manager", "delivery_lead", "partner", "contributor"];
    const team = userIds
      .filter((id) => userById.has(id))
      .map((id) => {
        const u = userById.get(id)!;
        const agg = byUser.get(id)!;
        const roleRank = (r: string) => {
          const i = ROLE_ORDER.indexOf(r);
          return i === -1 ? 99 : i;
        };
        const accountRoles = Array.from(agg.accountRoles).sort(
          (a, b) => roleRank(a) - roleRank(b),
        );
        return {
          id: u.id,
          name: u.name,
          title: u.title,
          roleLabel: u.roleLabel,
          accountRoles,
          staffedOn: agg.staffedOn,
        };
      })
      .sort((a, b) => {
        const ra = a.accountRoles.length ? ROLE_ORDER.indexOf(a.accountRoles[0]!) : 99;
        const rb = b.accountRoles.length ? ROLE_ORDER.indexOf(b.accountRoles[0]!) : 99;
        return (ra === -1 ? 98 : ra) - (rb === -1 ? 98 : rb) || a.name.localeCompare(b.name);
      });

    // ---- open opportunities (same terminal-stage filter as the dossier) ----
    const TERMINAL = new Set(["contract", "lost", "no_decision", "withdrawn"]);
    const opps = await db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        salesStage: atelierOpportunities.salesStage,
        daysInStage: atelierOpportunities.daysInStage,
        nextMilestone: atelierOpportunities.nextMilestone,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.accountId, acc.id),
          eq(atelierOpportunities.orgId, ctx.persona.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      );
    const openOpps = opps
      .filter((o) => !TERMINAL.has(resolveSalesStage(o.salesStage)))
      .map((o) => ({
        id: o.id,
        name: o.name,
        stage: resolveSalesStage(o.salesStage),
        daysInStage: o.daysInStage,
        nextMilestone: o.nextMilestone ?? null,
        href: `/opportunities/${o.id}`,
      }));

    // ---- recent meetings (same live-parent + parent-ACL filter as
    //      meeting.list, scoped to this account) ----
    const meetingLimit = Math.max(1, Math.min(20, Number(input.meetingLimit ?? 5)));
    const meetingRows = await db
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
    const recentMeetings: Array<Record<string, unknown>> = [];
    for (const m of meetingRows) {
      if (recentMeetings.length >= meetingLimit) break;
      const parent = await liveMeetingParent(m.parentType, m.parentId, ctx.persona.orgId);
      if (!parent || parent.accountId !== acc.id) continue;
      if (!(await canSeeMeetingParent(ctx.persona, parent))) continue;
      recentMeetings.push({
        id: m.id,
        title: m.title,
        date: m.date,
        kind: m.kind,
        parentType: parent.kind,
        parentName: parent.name,
        href: parent.kind === "engagement" ? `/engagements/${parent.id}` : `/opportunities/${parent.id}`,
      });
    }

    return {
      ok: true,
      data: {
        account: {
          id: accountRow.id,
          name: accountRow.name,
          country: accountRow.country,
          sector: accountRow.sector,
          href: `/accounts/${accountRow.id}`,
        },
        team,
        teamCount: team.length,
        openOpportunities: openOpps,
        openOpportunityCount: openOpps.length,
        activeEngagements: activeEngs.map((e) => ({
          id: e.id,
          name: e.name,
          plmStage: e.plmStage,
          href: `/engagements/${e.id}`,
        })),
        activeEngagementCount: activeEngs.length,
        recentMeetings,
      },
    };
  },
});

// ---------------------------------------------------------------------
// person.workload — entity_card (Task #443 — composed person-centric read)
//
// The inverse of account.who_works: "what is Sarah working on right
// now?" in ONE tool call. Resolves a roster person (same roster scope
// predicate as person_detail — callers only see people in their
// perimeter), maps them to their atelier_users login (the row that
// account teams / engagement staffing / opportunity ownership key on),
// then returns:
//   - accounts where they hold an account-team role or are partner owner,
//   - active engagement staffings with role + allocation %,
//   - open opportunities they own (partner owner) or lead.
// Account/engagement rows the CALLER may not see are filtered out via
// the same canSeeAccount / engagement ACL used by the single-entity
// reads, and a hidden count is reported so the answer is honest.
// No compensation / HR / bank fields ever appear (business projection).
// ---------------------------------------------------------------------
defineCapability({
  id: "person.workload",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "person_workload",
  description:
    "One-shot compound answer for a person: which accounts they're on the team for (with role), which active engagements they're staffed on (role + allocation %), and which open opportunities they own or lead. Use for questions like 'what is X working on?' or 'what is X staffed on across accounts and deals?'. Accepts a roster person id or a name. Never returns compensation or HR data.",
  slashAliases: { en: ["/workload", "/working-on"], fr: ["/charge"] },
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
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: [
      "What is Sarah working on right now?",
      "Which accounts and deals is Karim staffed on?",
      "Show me everything on Gökhan's plate",
    ],
    ar: ["على ماذا تعمل سارة الآن؟"],
    fr: ["Sur quoi travaille Sarah en ce moment ?"],
  },
  async run(input, ctx) {
    if (isRestrictedPersona(ctx.persona.role)) {
      return denyForbidden(
        "Workload lookups are not available to your role. You can ask about your own profile instead.",
      );
    }
    const me = await loadMe(ctx);
    if (!me) return denyForbidden("No active persona.");

    // ---- resolve the person (same pattern + roster scope as person_detail) ----
    let personId = typeof input.personId === "string" ? input.personId.trim() : "";
    if (!personId) {
      const q = typeof input.name === "string" ? input.name.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide personId or name." };
      }
      // Roster-scoped match: never surface out-of-perimeter people, even
      // as disambiguation options.
      const matches = await scopedPersonMatches(me, q);
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
    const personCard = {
      id: person.id,
      fullName: person.fullName,
      title: person.title ?? null,
      workerType: person.workerType,
      status: person.status,
      href: `/people/${person.id}`,
    };

    // ---- map the roster person to their atelier_users login row ----
    const linkedUserId = await resolveLinkedUserId(person);
    if (!linkedUserId) {
      return {
        ok: true,
        data: {
          person: personCard,
          linkedUser: false,
          note: "This person has no linked login, so no account-team, staffing, or opportunity records exist for them.",
          accountRoles: [],
          engagementStaffings: [],
          openOpportunities: [],
          hiddenAccountCount: 0,
        },
      };
    }

    // Caller's own account/engagement visibility (same ACL as single reads).
    const callerMe = { id: ctx.persona.id, role: ctx.persona.role };
    const access = await engAclFor(ctx.persona);
    const seenAccountCache = new Map<string, boolean>();
    const callerCanSee = async (accountId: string) => {
      const hit = seenAccountCache.get(accountId);
      if (hit !== undefined) return hit;
      const ok = await canSeeAccount(access, callerMe, accountId);
      seenAccountCache.set(accountId, ok);
      return ok;
    };
    // Unique accounts (not rows) the caller may not see.
    const hiddenAccountIds = new Set<string>();

    // ---- account-team roles + partner-owned accounts ----
    const [teamRows, ownedAccounts] = await Promise.all([
      db
        .select({
          accountId: atelierAccountTeamMembers.accountId,
          roleOnAccount: atelierAccountTeamMembers.roleOnAccount,
        })
        .from(atelierAccountTeamMembers)
        .where(
          and(
            eq(atelierAccountTeamMembers.userId, linkedUserId),
            eq(atelierAccountTeamMembers.orgId, ctx.persona.orgId),
            isNull(atelierAccountTeamMembers.deletedAt),
          ),
        ),
      db
        .select({ id: atelierAccounts.id })
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.partnerOwnerId, linkedUserId),
            eq(atelierAccounts.orgId, ctx.persona.orgId),
            isNull(atelierAccounts.deletedAt),
          ),
        ),
    ]);
    const rolesByAccount = new Map<string, Set<string>>();
    const addRole = (accountId: string, role: string) => {
      let set = rolesByAccount.get(accountId);
      if (!set) {
        set = new Set();
        rolesByAccount.set(accountId, set);
      }
      set.add(role);
    };
    for (const a of ownedAccounts) addRole(a.id, "partner_owner");
    for (const t of teamRows) addRole(t.accountId, t.roleOnAccount);

    // ---- active engagement staffings (role + allocation) ----
    const grants = await db
      .select({
        engagementId: atelierEngagementAccess.engagementId,
        roleOnEngagement: atelierEngagementAccess.roleOnEngagement,
        allocationPct: atelierEngagementAccess.allocationPct,
      })
      .from(atelierEngagementAccess)
      .where(
        and(
          eq(atelierEngagementAccess.userId, linkedUserId),
          eq(atelierEngagementAccess.status, "active"),
          isNull(atelierEngagementAccess.deletedAt),
        ),
      );
    const grantEngIds = grants.map((g) => g.engagementId);
    const engRows = grantEngIds.length
      ? await db
          .select({
            id: atelierEngagements.id,
            name: atelierEngagements.name,
            plmStage: atelierEngagements.plmStage,
            accountId: atelierEngagements.accountId,
          })
          .from(atelierEngagements)
          .where(
            and(
              inArray(atelierEngagements.id, grantEngIds),
              eq(atelierEngagements.orgId, ctx.persona.orgId),
              isNull(atelierEngagements.deletedAt),
            ),
          )
      : [];
    const engById = new Map(engRows.map((e) => [e.id, e]));

    // ---- open opportunities owned/led by the person ----
    const oppRows = await db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        salesStage: atelierOpportunities.salesStage,
        accountId: atelierOpportunities.accountId,
        partnerOwnerId: atelierOpportunities.partnerOwnerId,
        engagementLeadId: atelierOpportunities.engagementLeadId,
        nextMilestone: atelierOpportunities.nextMilestone,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.orgId, ctx.persona.orgId),
          isNull(atelierOpportunities.deletedAt),
          or(
            eq(atelierOpportunities.partnerOwnerId, linkedUserId),
            eq(atelierOpportunities.engagementLeadId, linkedUserId),
          ),
        ),
      );
    const TERMINAL = new Set(["contract", "lost", "no_decision", "withdrawn"]);
    const openOppRows = oppRows.filter(
      (o) => !TERMINAL.has(resolveSalesStage(o.salesStage)),
    );

    // ---- account names for everything we might surface ----
    const accountIds = new Set<string>([
      ...rolesByAccount.keys(),
      ...engRows.map((e) => e.accountId),
      ...openOppRows.map((o) => o.accountId),
    ]);
    const accountRows = accountIds.size
      ? await db
          .select({ id: atelierAccounts.id, name: atelierAccounts.name })
          .from(atelierAccounts)
          .where(
            and(
              inArray(atelierAccounts.id, Array.from(accountIds)),
              eq(atelierAccounts.orgId, ctx.persona.orgId),
              isNull(atelierAccounts.deletedAt),
            ),
          )
      : [];
    const accountNameById = new Map(accountRows.map((a) => [a.id, a.name]));

    // ---- caller-visibility filter (same ACL as the single-entity reads) ----
    const accountRolesOut: Array<{
      accountId: string;
      accountName: string;
      roles: string[];
      href: string;
    }> = [];
    for (const [accountId, roles] of rolesByAccount) {
      if (!accountNameById.has(accountId)) continue;
      if (!(await callerCanSee(accountId))) {
        hiddenAccountIds.add(accountId);
        continue;
      }
      accountRolesOut.push({
        accountId,
        accountName: accountNameById.get(accountId)!,
        roles: Array.from(roles).sort(),
        href: `/accounts/${accountId}`,
      });
    }
    accountRolesOut.sort((a, b) => a.accountName.localeCompare(b.accountName));

    const staffingsOut: Array<Record<string, unknown>> = [];
    for (const g of grants) {
      const eng = engById.get(g.engagementId);
      if (!eng || eng.plmStage === "closed") continue;
      const engVisible =
        access.all || access.ids.has(eng.id) || (await callerCanSee(eng.accountId));
      if (!engVisible) {
        hiddenAccountIds.add(eng.accountId);
        continue;
      }
      staffingsOut.push({
        engagementId: eng.id,
        engagementName: eng.name,
        plmStage: eng.plmStage,
        role: g.roleOnEngagement,
        allocationPct: g.allocationPct,
        accountId: eng.accountId,
        accountName: accountNameById.get(eng.accountId) ?? null,
        href: `/engagements/${eng.id}`,
      });
    }

    const oppsOut: Array<Record<string, unknown>> = [];
    for (const o of openOppRows) {
      if (!(await callerCanSee(o.accountId))) {
        hiddenAccountIds.add(o.accountId);
        continue;
      }
      oppsOut.push({
        id: o.id,
        name: o.name,
        stage: resolveSalesStage(o.salesStage),
        relationship:
          o.partnerOwnerId === linkedUserId ? "owner" : "engagement_lead",
        nextMilestone: o.nextMilestone ?? null,
        accountId: o.accountId,
        accountName: accountNameById.get(o.accountId) ?? null,
        href: `/opportunities/${o.id}`,
      });
    }

    // Capacity signal (Task #450): totalAllocationPct is the sum of the
    // person's active staffing allocations the CALLER can see; over 100%
    // means overallocated, under 100% means spare capacity. Note: if some
    // staffings were hidden by the caller's ACL, the visible total may
    // understate real load — surface that via hiddenAccountCount.
    const totalAllocationPct = staffingsOut.reduce(
      (acc, s) => acc + (typeof s.allocationPct === "number" ? s.allocationPct : 0),
      0,
    );
    const capacityStatus =
      totalAllocationPct > 100
        ? "overallocated"
        : totalAllocationPct === 100
          ? "fully_allocated"
          : "available";

    return {
      ok: true,
      data: {
        person: personCard,
        linkedUser: true,
        accountRoles: accountRolesOut,
        accountRoleCount: accountRolesOut.length,
        engagementStaffings: staffingsOut,
        engagementStaffingCount: staffingsOut.length,
        openOpportunities: oppsOut,
        openOpportunityCount: oppsOut.length,
        hiddenAccountCount: hiddenAccountIds.size,
        totalAllocationPct,
        capacityStatus,
        availablePct: Math.max(0, 100 - totalAllocationPct),
      },
    };
  },
});
