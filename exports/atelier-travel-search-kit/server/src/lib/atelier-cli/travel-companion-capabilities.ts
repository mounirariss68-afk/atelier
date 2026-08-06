/**
 * Task #745 — traveller lookup for the guided flight-booking flow.
 *
 * DELIBERATELY a separate module from travel-capabilities.ts: the
 * travel search/select/itinerary tools are DB-free (offline probe),
 * while this capability is DB-backed. It lists the people the caller
 * may book travel for:
 *   - roster colleagues, filtered through the SAME roster scope
 *     predicate as the REST people surfaces (resolveRosterScope) —
 *     never the unscoped listPersons output, and
 *   - the caller's OWN dependents (atelier_dependents via the caller's
 *     linked employee/contractor row) with relationship labels.
 *
 * Read-only; the user picks travellers on the rendered card and the
 * model carries the chosen names into travel_itinerary_summary.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierDependents,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";
import {
  resolveRosterScope,
  listPersons,
  type PersonWire,
} from "../../routes/atelier/rosterRoutes.js";
import type { ToolContext, ToolResult } from "./index.js";

// Same perimeter as the travel tools (travel-capabilities.ts).
const TRAVEL_ROLES: AtelierRole[] = [
  "founding_partner",
  "partner",
  "senior_manager",
  "consultant",
];

/**
 * Pure scope filter (exported for offline tests): keep only ACTIVE
 * people the caller's roster scope allows. Mirrors the scoped-matcher
 * convention in people-read-capabilities.ts — a "full" scope sees
 * everyone, otherwise only scope.personIds + self.
 */
export function scopeColleagues(
  persons: Array<Pick<PersonWire, "id" | "status">>,
  scope:
    | { kind: "full" }
    | { kind: string; personIds: Set<string>; selfPersonId: string | null },
): Array<Pick<PersonWire, "id" | "status">> {
  const active = persons.filter((p) => p.status !== "inactive");
  if (scope.kind === "full") return active;
  const s = scope as { personIds: Set<string>; selfPersonId: string | null };
  return active.filter(
    (p) =>
      s.personIds.has(p.id) ||
      (s.selfPersonId !== null && s.selfPersonId === p.id),
  );
}

type SelfPerson =
  | { workerType: "employee" | "contractor"; id: string; fullName: string }
  | null;

/** Locate the caller's own roster row (employee by userId link, else
 * contractor by email — same convention as meProfileRoutes). */
async function resolveSelfPerson(
  me: typeof atelierUsers.$inferSelect,
): Promise<SelfPerson> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, me.orgId),
        eq(atelierEmployees.userId, me.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) return { workerType: "employee", id: emp.id, fullName: emp.fullName };
  const email = me.email.trim().toLowerCase();
  const cts = await db
    .select()
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, me.orgId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  const ct = cts.find((c) => c.email.trim().toLowerCase() === email);
  if (ct) return { workerType: "contractor", id: ct.id, fullName: ct.fullName };
  return null;
}

defineCapability({
  id: "travel.companions",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "list_travel_companions",
  description:
    "Guided flight booking, multi-passenger step: list the people the user may add as travellers — colleagues within their roster visibility and their OWN family members (dependents) with relationship labels. Call when a confirmed trip plan has more than one passenger, AFTER every leg is selected and BEFORE travel_itinerary_summary. The user picks travellers on the card; when they reply with their picks, pass them (name + kind + relationship) into travel_itinerary_summary's travellers param along with the user themselves. Optional q narrows by name.",
  slashAliases: {},
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Optional name filter." },
      adults: {
        type: "integer",
        minimum: 1,
        maximum: 9,
        description: "Passenger count from the confirmed plan (for the card header).",
      },
    },
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: TRAVEL_ROLES,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "traveller_picker",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Who can I add as travellers?"],
    fr: ["Qui puis-je ajouter comme voyageurs ?"],
  },
  async run(input, ctx: ToolContext): Promise<ToolResult> {
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
    if (!me) {
      return { ok: false, errorCode: "forbidden", errorMessage: "No active persona." };
    }

    const q = String(input.q ?? "").trim();
    const adults = Math.max(1, Math.min(9, Number(input.adults ?? 2) || 2));

    // Roster colleagues — SCOPED before display (listPersons is not
    // viewer-scoped; leaking out-of-perimeter names is a regression).
    const scope = await resolveRosterScope(me);
    const all = await listPersons({
      workerType: "all",
      ...(q ? { q } : {}),
      includeComp: false,
    });
    const self = await resolveSelfPerson(me);
    const visible = scopeColleagues(all, scope) as PersonWire[];
    const colleagues = visible
      .filter((p) => !(self && p.id === self.id))
      .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""))
      .slice(0, 30)
      .map((p) => ({
        id: `colleague:${p.id}`,
        name: p.preferredName || p.fullName,
        kind: "colleague" as const,
        title: p.title ?? null,
        relationship: null as string | null,
      }));

    // Own dependents only — never anyone else's family.
    let dependents: Array<{
      id: string;
      name: string;
      kind: "dependent";
      title: string | null;
      relationship: string | null;
    }> = [];
    if (self) {
      const rows = await db
        .select()
        .from(atelierDependents)
        .where(
          and(
            eq(atelierDependents.orgId, me.orgId),
            eq(atelierDependents.personType, self.workerType),
            eq(atelierDependents.personId, self.id),
            isNull(atelierDependents.deletedAt),
          ),
        );
      const needle = q.toLowerCase();
      dependents = rows
        .filter((d) => !q || d.fullName.toLowerCase().includes(needle))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((d) => ({
          id: `dependent:${d.id}`,
          name: d.fullName,
          kind: "dependent" as const,
          title: null,
          relationship: d.relationship,
        }));
    }

    const items = [...dependents, ...colleagues];
    return {
      ok: true,
      data: {
        items,
        total: items.length,
        adults,
        requester: { name: self?.fullName ?? me.name, kind: "self" },
        note:
          `Traveller picker — the requester travels by default; ${adults - 1} more traveller${adults - 1 === 1 ? "" : "s"} to pick. ` +
          "Family members are listed with their relationship; colleagues are limited to the user's roster visibility. " +
          "When the user picks, pass the chosen travellers (plus the requester with kind self) into travel_itinerary_summary's travellers param. " +
          (items.length === 0
            ? "No pickable people found — ask the user for the travellers' names instead and pass them along honestly."
            : ""),
      },
    };
  },
});
