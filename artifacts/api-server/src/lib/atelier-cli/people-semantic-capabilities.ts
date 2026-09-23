/**
 * Task #1413 — source-backed internal people relationships.
 *
 * This adapter deliberately narrows the existing roster union to employees
 * and contractors. CRM contacts and partner-firm resources are different
 * identities and are never returned by this capability.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  atelierEmployees,
  atelierContractors,
  atelierRosterReportsTo,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import {
  loadMe,
} from "./people-read-capabilities.js";
import {
  listPersons,
  resolveRosterScope,
  toBusinessWire,
  type PersonWire,
} from "../../routes/atelier/rosterRoutes.js";
import { foldRosterName } from "./chat-normalizers.js";
import type { ToolResult } from "./index.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";

const LIMIT = 8;
const SCAN_LIMIT = 64;
const REQUIRED_ROLES: AtelierRole[] = [
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
];
const DENIED_ROLES = new Set([
  "board_observer",
  "employee",
  "contractor",
  "non_equity_partner",
  "partner_firm_resource",
]);
const TERMINAL_STATUSES = new Set([
  "inactive",
  "archived",
  "offboarded",
  "terminated",
  "deactivated",
  "disabled",
  "deleted",
]);

function current(p: PersonWire): boolean {
  return !TERMINAL_STATUSES.has((p.status ?? "").trim().toLowerCase());
}

function visible(scope: Awaited<ReturnType<typeof resolveRosterScope>>, id: string): boolean {
  return scope.kind === "full" ||
    scope.personIds.has(id) ||
    (scope.selfPersonId !== null && scope.selfPersonId === id);
}

/** The semantic contract is intentionally smaller than PersonWire. */
function businessWorker(p: PersonWire): Record<string, unknown> {
  const business = toBusinessWire(p);
  return {
    id: business.id,
    personId: business.personId ?? null,
    workerType: business.workerType,
    fullName: business.fullName,
    displayName: business.displayName ?? null,
    preferredName: business.preferredName ?? null,
    firstName: business.firstName ?? null,
    middleName: business.middleName ?? null,
    lastName: business.lastName ?? null,
    email: business.email ?? null,
    role: business.role ?? null,
    seniority: business.seniority ?? null,
    title: business.title ?? null,
    country: business.country ?? null,
    status: business.status,
    startDate: business.startDate ?? null,
    endDate: business.endDate ?? null,
    employmentType: business.employmentType ?? null,
    source: {
      kind: business.workerType === "employee" ? "atelier_employees" : "atelier_contractors",
      rowId: business.id,
      personId: business.personId ?? null,
    },
  };
}

function nameMatches(p: PersonWire, needle: string): boolean {
  if (!needle) return true;
  const names = [
    p.fullName,
    p.preferredName,
    p.displayName,
    p.firstName,
    p.middleName,
    p.lastName,
  ];
  if (names.some((name) => foldRosterName(name ?? "").includes(needle))) return true;
  const words = needle.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((word) =>
    names.some((name) => foldRosterName(name ?? "").includes(word)));
}

function invalid(message: string): ToolResult {
  return { ok: false, errorCode: "invalid_input", errorMessage: message };
}

function forbidden(): ToolResult {
  return {
    ok: false,
    errorCode: "forbidden",
    errorMessage: "Internal people relationships are not available to this role.",
  };
}

defineCapability({
  id: "roster.people_relationships",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "people_relationships",
  description:
    "Resolve current employees and contractors, and their visible reporting relationships, without conflating CRM contacts or partner-firm resources.",
  slashAliases: { en: ["/people-relationships", "/reporting-line"] },
  representativePrompts: {
    en: ["Who reports to this person?", "Find the employee or contractor named Sara."],
  },
  inputSchema: {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["worker", "reporting_line"] },
      id: { type: "string" },
      query: { type: "string" },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: REQUIRED_ROLES,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  surfaceOn: ["roster", "global"],
  async run(input, ctx): Promise<ToolResult> {
    if (DENIED_ROLES.has(ctx.persona.role)) return forbidden();
    const kind = typeof input.kind === "string" ? input.kind.trim() : "";
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (kind !== "worker" && kind !== "reporting_line") {
      return invalid("kind must be worker or reporting_line.");
    }
    if (!id && !query) return invalid("Provide a canonical worker id or query.");
    if (id && query) return invalid("Provide either id or query, not both.");

    const me = await loadMe(ctx);
    if (!me) return { ok: false, errorCode: "not_found", errorMessage: "Active persona not found." };
    const scope = await resolveRosterScope(me);

    // Fetch the authoritative internal roster without a public limit. Current
    // and scope predicates are applied before ambiguity/result caps.
    const all = await listPersons({
      orgId: me.orgId,
      workerType: "internal",
      includeComp: false,
    });
    // listPersons is the canonical roster projection but intentionally has no
    // viewer/tenant parameter. Revalidate the source org before disclosure.
    const [employeeIds, contractorIds] = await Promise.all([
      db.select({ id: atelierEmployees.id }).from(atelierEmployees).where(and(
        eq(atelierEmployees.orgId, me.orgId),
        isNull(atelierEmployees.deletedAt),
      )),
      db.select({ id: atelierContractors.id }).from(atelierContractors).where(and(
        eq(atelierContractors.orgId, me.orgId),
        isNull(atelierContractors.deletedAt),
      )),
    ]);
    const orgWorkerIds = new Set([
      ...employeeIds.map((row) => row.id),
      ...contractorIds.map((row) => row.id),
    ]);
    const workers = all.filter((p) => orgWorkerIds.has(p.id) && current(p) && visible(scope, p.id));
    let matches = id
      ? workers.filter((p) => p.id === id)
      : workers.filter((p) => nameMatches(p, foldRosterName(query)));
    matches = matches.slice(0, SCAN_LIMIT);
    if (matches.length === 0) {
      return { ok: false, errorCode: "not_found", errorMessage: "No visible current employee or contractor matched." };
    }
    if (matches.length > 1) {
      const options = matches.slice(0, LIMIT).map((p) => ({
        id: p.id,
        label: p.fullName,
        secondary: [p.workerType, p.title].filter(Boolean).join(" · "),
      }));
      return {
        ok: true,
        data: {
          shape: "people_relationships",
          prompt: "Which internal worker did you mean?",
          options,
          bounded: { limit: LIMIT, scanned: matches.length, maxHops: 1 },
        },
        disambiguation: { kind: "worker", options },
      };
    }
    const target = matches[0]!;
    if (kind === "worker") {
      return {
        ok: true,
        data: {
          shape: "people_relationships",
          kind,
          relationships: [businessWorker(target)],
          bounded: { limit: LIMIT, maxHops: 0 },
        },
      };
    }

    const edges = await db
      .select({
        id: atelierRosterReportsTo.id,
        personId: atelierRosterReportsTo.personId,
        managerPersonId: atelierRosterReportsTo.managerPersonId,
      })
      .from(atelierRosterReportsTo)
      .where(and(
        eq(atelierRosterReportsTo.orgId, me.orgId),
        or(
          eq(atelierRosterReportsTo.personId, target.id),
          eq(atelierRosterReportsTo.managerPersonId, target.id),
        ),
      ))
      .orderBy(atelierRosterReportsTo.id);
    const byId = new Map(workers.map((p) => [p.id, p]));
    const managers = new Map<string, PersonWire>();
    const reports = new Map<string, PersonWire>();
    for (const edge of edges) {
      if (edge.personId === target.id) {
        const manager = byId.get(edge.managerPersonId);
        if (manager) managers.set(manager.id, manager);
      }
      if (edge.managerPersonId === target.id) {
        const report = byId.get(edge.personId);
        if (report) reports.set(report.id, report);
      }
    }
    return {
      ok: true,
      data: {
        shape: "people_relationships",
        kind,
        worker: businessWorker(target),
        managers: [...managers.values()].slice(0, LIMIT).map(businessWorker),
        directReports: [...reports.values()].slice(0, LIMIT).map(businessWorker),
        bounded: { limit: LIMIT, maxHops: 1, cycleSafe: true, multiManager: true },
        source: "atelier_roster_reports_to",
      },
    };
  },
});