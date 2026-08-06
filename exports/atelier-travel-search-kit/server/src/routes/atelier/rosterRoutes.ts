/**
 * STUB — minimal extract of Atelier's roster routes.
 *
 * `travel-companion-capabilities.ts` uses three things from the real
 * ~2000-line roster module:
 *   - the `PersonWire` shape (subset of the upstream interface — only
 *     the fields the travel modules touch),
 *   - `resolveRosterScope(me)` — the org-wide visibility predicate
 *     (full view for leadership, manager-BFS "reports" scope otherwise),
 *   - `listPersons(opts)` — the roster query.
 *
 * INTEGRATION POINT: replace the two throwing functions with lookups
 * against your own people directory. The scope contract matters: the
 * companion tools filter colleagues through `resolveRosterScope` BEFORE
 * display so a restricted viewer never sees out-of-perimeter people.
 */

export type WorkerType = "employee" | "contractor" | "partner_firm_resource";

export interface PersonWire {
  id: string;
  workerType: WorkerType;
  fullName: string;
  personId?: string | null;
  honorific?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  preferredName?: string | null;
  email: string | null;
  role: string | null;
  seniority: string | null;
  title: string | null;
  country: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  gender: string;
  nationality: string | null;
  partnerFirmId?: string | null;
  partnerFirmName?: string | null;
  vendorEntity?: string | null;
  dayRateAmount?: number | null;
  dayRateCurrency?: string | null;
  iban?: string | null;
  swift?: string | null;
  noticePeriodDays?: number | null;
  payrollCountry?: string | null;
  employeeIdExternal?: string | null;
  employmentType?: string | null;
}

export type RosterScope =
  | { kind: "full" }
  | { kind: "reports"; personIds: Set<string>; selfPersonId: string | null };

export interface ListOpts {
  workerType?: WorkerType | "all";
  q?: string;
  includeComp: boolean;
}

export async function resolveRosterScope(me: {
  id: string;
  orgId: string;
  role: string;
}): Promise<RosterScope> {
  void me;
  throw new Error(
    "[travel-kit stub] resolveRosterScope is not wired — connect your own people directory here.",
  );
}

export async function listPersons(opts: ListOpts): Promise<PersonWire[]> {
  void opts;
  throw new Error(
    "[travel-kit stub] listPersons is not wired — connect your own people directory here.",
  );
}
