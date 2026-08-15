/**
 * Atelier v3 — Roster routes (Task #254).
 *
 * "The Roster" union of three worker types:
 *   - employees           (FTE)            tagged workerType=employee
 *   - contractors                          tagged workerType=contractor
 *   - partner-firm resources               tagged workerType=partner_firm_resource
 *
 * Plus the per-person 6-tab dossier (profile / engagements / skills /
 * timesheet-summary / documents / audit), the access matrix, and the
 * Access Sentinel grant/revoke choke-point.
 *
 * Compensation policy lock — comp/bank fields (iban, swift, day_rate_*,
 * notice_period_days) are stripped on the read side unless the calling
 * persona is `partner` or `operations`. The lock applies in `personToWire`
 * so list and detail endpoints share a single chokepoint.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import { and, desc, eq, isNull, or, ilike, inArray, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ensureEngAccess } from "./engagementRoutes.js";
import { foldRosterName } from "../../lib/atelier-cli/chat-normalizers.js";
import { assertAuditAction } from "./auditContract.js";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierCompChanges,
  atelierContractors,
  atelierPartnerFirms,
  atelierPartnerFirmResources,
  atelierEngagementAccess,
  atelierEngagements,
  atelierAccounts,
  atelierAuditEvents,
  atelierPersonDocuments,
  atelierConflictDisclosures,
  atelierDependents,
  atelierEmergencyContacts,
  atelierRosterReportsTo,
  atelierTitles,
  atelierPersons,
  atelierLegalEntities,
  atelierContractRecords,
  atelierContractSalaryProposals,
} from "@workspace/db";
// Task #538 — unified person model: structured names resolve through the
// shared parser/sanitizer and persist via the person-sync helper.
import {
  resolveStructuredNameInput,
  composeFullName,
  computeInitials,
  PersonNameValidationError,
  type StructuredName,
} from "../../lib/atelier-person-model.js";
import { writePersonAndSync } from "../../lib/atelier-person-sync.js";
// Task #744 — travel loyalty programs + preferences (employees only).
import {
  zTravelProfile,
  travelProfileToWire,
  redactTravelProfile,
  type TravelProfile,
} from "../../lib/atelier-travel-profile.js";
import { syncMsDisplayName } from "../../lib/atelier-ms-provisioning.js";
// Task #51 — stream self-uploaded scans from private object storage.
import {
  loadPersonDocBytes,
  PERSON_DOC_PREFIX,
} from "../../lib/personDocStorage.js";
// Task #381 — roster-scoped business-card PDF download for HR/partners.
import {
  generateBusinessCardPdf,
  cardFilenameStem,
} from "../../lib/atelier-business-card.js";
// Task #387 — one-click zip of all active employees' print-ready cards.
import JSZip from "jszip";

const router: IRouter = Router();

// -----------------------------------------------------------------
// Types + helpers
// -----------------------------------------------------------------

export type WorkerType = "employee" | "contractor" | "partner_firm_resource";

export interface PersonWire {
  id: string;
  workerType: WorkerType;
  fullName: string;
  // Task #538 — unified person model. Structured name fields for form
  // prefill; displayName is server-recomputed and is what UIs render.
  personId?: string | null;
  honorific?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email: string | null;
  role: string | null;
  seniority: string | null;
  title: string | null;
  country: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  // Task #412 — self-identified demographics for People Lens Team Composition.
  gender: string;
  nationality: string | null;
  partnerFirmId?: string | null;
  partnerFirmName?: string | null;
  vendorEntity?: string | null;
  // comp fields — only included for partner|operations personas
  dayRateAmount?: number | null;
  dayRateCurrency?: string | null;
  iban?: string | null;
  swift?: string | null;
  noticePeriodDays?: number | null;
  payrollCountry?: string | null;
  employeeIdExternal?: string | null;
  employmentType?: string | null;
  homeOffice?: string | null;
  // Task #645 — PUBLIC business-card contact fields (employees only). Safe to
  // print on a card; never gated behind the comp lock. At least one cell is
  // enforced on write.
  cellPhones?: Array<{ country: string; number: string }>;
  officeAddress?: string | null;
  // Task #199 — non-sensitive prefill fields for the full Edit Person form.
  preferredName?: string | null;
  employmentStatus?: string | null;
  employingEntity?: string | null;
  homeCountry?: string | null;
  contractType?: string | null;
  avatarUrl?: string | null;
  notes?: string | null;
  partnerEconomicsId?: string | null;
  // PRD §2.1 policy-locked fields (Partner / Operations only).
  baseCompensation?: number | null;
  dayRateInternalCost?: number | null;
  costToCognirisePerDay?: number | null;
  // Task #660 — statutory payroll fields (employees, comp-gated). Edited
  // ONLY via PATCH /roster/people/:id/payroll, never the general edit.
  baseCurrency?: string | null;
  legalEntityId?: string | null;
  basicWageMonthly?: number | null;
  housingAllowanceMonthly?: number | null;
  schemeRegisteredOn?: string | null;
  // Task #744 — travel loyalty programs + preferences (EMPLOYEES ONLY).
  // Membership numbers masked for viewers without the sensitive gate.
  travelProfile?: TravelProfile | null;
}

// Task #292 — Compensation visibility now spans leadership + finance + HR.
import {
  canViewCompensation,
  canViewPersonnelContract,
  canViewSensitivePeopleData,
  canEditPeople,
  isHr,
  isPartner,
  isFinance,
  isFoundingPartner,
} from "./personaRoles.js";
import { withRls } from "./rls.js";

function canSeeComp(role: string | undefined | null): boolean {
  return canViewCompensation(role);
}

// -----------------------------------------------------------------
// Task #221 — roster visibility scoping.
//
// Full-roster viewers: founding_partner | hr | finance (comp per the comp
// gate, personal data per the sensitive gate). Everyone else is scoped to
// the people who report to them (transitive reports_to tree, org-scoped,
// cycle-safe, multi-manager aware) and sees ONLY business fields. A
// non-manager gets an empty roster.
// -----------------------------------------------------------------

function hasFullRosterView(role: string | undefined | null): boolean {
  return isFoundingPartner(role) || isHr(role) || isFinance(role);
}

export type RosterScope =
  | { kind: "full" }
  | { kind: "reports"; personIds: Set<string>; selfPersonId: string | null };

/** Resolve the viewer's own roster person id (employee link via userId,
 *  falling back to an org-scoped work-email match). */
async function resolveViewerPersonId(
  me: typeof atelierUsers.$inferSelect,
): Promise<string | null> {
  const byUser = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.userId, me.id),
        eq(atelierEmployees.orgId, me.orgId),
        isNull(atelierEmployees.deletedAt),
      ),
    )
    .limit(1);
  if (byUser[0]) return byUser[0].id;
  if (!me.email) return null;
  const byEmail = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.email, me.email),
        eq(atelierEmployees.orgId, me.orgId),
        isNull(atelierEmployees.deletedAt),
      ),
    )
    .limit(1);
  return byEmail[0]?.id ?? null;
}

/** Transitive reports (BFS over ALL reports_to edges — a person may have
 *  multiple managers and the graph carries no uniqueness constraint, so we
 *  walk every edge with a visited-set to stay cycle-safe). Org-scoped. */
export async function getManagedPersonIds(
  orgId: string,
  managerPersonId: string,
): Promise<Set<string>> {
  const edges = await db
    .select({
      personId: atelierRosterReportsTo.personId,
      managerPersonId: atelierRosterReportsTo.managerPersonId,
    })
    .from(atelierRosterReportsTo)
    .where(eq(atelierRosterReportsTo.orgId, orgId));
  const byManager = new Map<string, string[]>();
  for (const e of edges) {
    const arr = byManager.get(e.managerPersonId) ?? [];
    arr.push(e.personId);
    byManager.set(e.managerPersonId, arr);
  }
  const out = new Set<string>();
  const queue = [managerPersonId];
  const visited = new Set<string>([managerPersonId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of byManager.get(cur) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

export async function resolveRosterScope(
  me: typeof atelierUsers.$inferSelect,
): Promise<RosterScope> {
  if (hasFullRosterView(me.role)) return { kind: "full" };
  const selfPersonId = await resolveViewerPersonId(me);
  const personIds = selfPersonId
    ? await getManagedPersonIds(me.orgId, selfPersonId)
    : new Set<string>();
  return { kind: "reports", personIds, selfPersonId };
}

/** Business-only projection for manager-scoped viewers: work identity,
 *  role/title/seniority, work contact, office, dates, status. NO comp,
 *  NO personal data, NO HR notes, NO demographics. */
export function toBusinessWire(p: PersonWire): PersonWire {
  return {
    id: p.id,
    workerType: p.workerType,
    fullName: p.fullName,
    // Task #538 — structured name is business identity, safe for scoped viewers.
    personId: p.personId ?? null,
    honorific: p.honorific ?? null,
    firstName: p.firstName ?? null,
    middleName: p.middleName ?? null,
    lastName: p.lastName ?? null,
    displayName: p.displayName ?? null,
    email: p.email,
    role: p.role,
    seniority: p.seniority,
    title: p.title,
    country: p.country,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    gender: "unspecified",
    nationality: null,
    partnerFirmId: p.partnerFirmId ?? null,
    partnerFirmName: p.partnerFirmName ?? null,
    vendorEntity: p.vendorEntity ?? null,
    employmentType: p.employmentType ?? null,
    homeOffice: p.homeOffice ?? null,
    cellPhones: p.cellPhones ?? [],
    officeAddress: p.officeAddress ?? null,
    preferredName: p.preferredName ?? null,
    employmentStatus: p.employmentStatus ?? null,
    employingEntity: p.employingEntity ?? null,
    homeCountry: p.homeCountry ?? null,
    contractType: p.contractType ?? null,
    avatarUrl: p.avatarUrl ?? null,
    notes: null,
  };
}

/** Strip sensitive-people fields (HR notes + self-identified demographics)
 *  for full-roster viewers who are not on the sensitive allow-list
 *  (i.e. finance). */
export function sanitizeForViewer(
  p: PersonWire,
  me: typeof atelierUsers.$inferSelect,
): PersonWire {
  if (canViewSensitivePeopleData(me.role)) return p;
  return {
    ...p,
    notes: null,
    gender: "unspecified",
    nationality: null,
    // Task #744 — loyalty membership numbers are personal data; mask them
    // for viewers without the sensitive-people gate.
    travelProfile: p.travelProfile ? redactTravelProfile(p.travelProfile) : p.travelProfile,
  };
}

/**
 * Shared per-person access resolver for the dossier sub-routes. Emits the
 * 404/403 itself and returns null when the caller may not view the person.
 * Managers get business-only wires for people in their reports tree (plus
 * themselves); full viewers get comp per the comp gate + sensitive strip.
 */
async function ensureRosterViewAccess(
  me: typeof atelierUsers.$inferSelect,
  personId: string,
  res: Response,
): Promise<PersonWire | null> {
  const scope = await resolveRosterScope(me);
  const person = await getPerson(
    personId,
    scope.kind === "full" && canSeeComp(me.role),
  );
  if (!person) {
    res.status(404).json({ error: "person-not-found" });
    return null;
  }
  if (scope.kind === "full") return sanitizeForViewer(person, me);
  if (
    scope.personIds.has(person.id) ||
    (scope.selfPersonId !== null && scope.selfPersonId === person.id)
  ) {
    return toBusinessWire(person);
  }
  res.status(403).json({ error: "roster-scope-forbidden" });
  return null;
}

/**
 * Shared boolean predicate for OTHER route modules that expose per-person
 * business data (skills, timesheet summaries, …). Mirrors the roster scope
 * model exactly: full viewers (founding_partner/hr/finance) see everyone;
 * everyone else sees only themselves + their transitive reports tree.
 */
export async function canViewPersonViaRosterScope(
  me: typeof atelierUsers.$inferSelect,
  personId: string,
): Promise<boolean> {
  const scope = await resolveRosterScope(me);
  if (scope.kind === "full") return true;
  return (
    scope.personIds.has(personId) ||
    (scope.selfPersonId !== null && scope.selfPersonId === personId)
  );
}

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// -----------------------------------------------------------------
// Persons accessor (the union)
// -----------------------------------------------------------------

export interface ListOpts {
  // Task #1171 — "internal" = employees + contractors only, excluding
  // partner-firm resources. The web People directory uses it so partner
  // contacts stop appearing mixed into the worker roster; default stays
  // "all" so search/pickers/chat keep finding partner-firm people.
  workerType?: WorkerType | "all" | "internal";
  q?: string;
  status?: string;
  // Task #412 — cohort filters surfaced from the People Lens Composition
  // dashboard's deep-links and directory chip strip. All optional and
  // case-insensitive where it makes sense.
  nationality?: string;          // ISO-3166 alpha-2
  gender?: string;               // female | male | unspecified
  country?: string;              // current location ISO alpha-2
  seniority?: string;            // exact match against `seniority`
  includeComp: boolean;
}

export async function listPersons(opts: ListOpts): Promise<PersonWire[]> {
  const wt = opts.workerType ?? "all";
  // Accent/diacritic-insensitive matching so "gokhan" finds "Gökhan
  // Güney" (Turkish dotless-ı handled too). Shared folding helper —
  // the same one the chat email-recipient resolver uses.
  const q = foldRosterName(opts.q?.trim() ?? "");
  const matches = (s: string | null | undefined) =>
    !q || foldRosterName(s ?? "").includes(q);
  const nationality = opts.nationality?.trim().toUpperCase();
  const gender = opts.gender?.trim().toLowerCase();
  const country = opts.country?.trim().toUpperCase();
  const seniority = opts.seniority?.trim().toLowerCase();

  /** Shared cohort post-filter applied after the workerType-specific
   *  free-text/status checks. Centralised so behaviour is identical for
   *  employees / contractors / partner-firm resources. */
  const matchesCohort = (
    r: { nationality?: string | null; gender?: string | null; countryCode?: string | null; country?: string | null; seniority?: string | null },
  ): boolean => {
    if (nationality && (r.nationality ?? "").toUpperCase() !== nationality) return false;
    if (gender && (r.gender ?? "unspecified").toLowerCase() !== gender) return false;
    if (country) {
      const c = (r.countryCode ?? r.country ?? "").toUpperCase();
      if (c !== country) return false;
    }
    if (seniority && (r.seniority ?? "").toLowerCase() !== seniority) return false;
    return true;
  };

  const out: PersonWire[] = [];

  // Task #538 — name search also matches structured person fields
  // (preferred name / display name), so "find Mo" hits Mohammed whose
  // preferred name is Mo. Loaded once; roster tables are small.
  const personNames = new Map<string, { preferredName: string | null; displayName: string }>();
  if (q) {
    const prs = await db
      .select({
        id: atelierPersons.id,
        preferredName: atelierPersons.preferredName,
        displayName: atelierPersons.displayName,
      })
      .from(atelierPersons);
    for (const p of prs) personNames.set(p.id, { preferredName: p.preferredName, displayName: p.displayName });
  }
  const matchesPerson = (personId: string | null): boolean => {
    if (!q || !personId) return false;
    const p = personNames.get(personId);
    if (!p) return false;
    return matches(p.preferredName) || matches(p.displayName);
  };

  if (wt === "all" || wt === "internal" || wt === "employee") {
    const rows = await db
      .select()
      .from(atelierEmployees)
      .where(isNull(atelierEmployees.deletedAt));
    for (const r of rows) {
      if (
        !matches(r.fullName) &&
        !matches(r.preferredName) &&
        !matchesPerson(r.personId) &&
        !matches(r.email) &&
        !matches(r.title) &&
        !matches(r.role)
      )
        continue;
      if (opts.status && r.status !== opts.status) continue;
      if (!matchesCohort(r)) continue;
      out.push(employeeToWire(r, opts.includeComp));
    }
  }

  if (wt === "all" || wt === "internal" || wt === "contractor") {
    const rows = await db
      .select()
      .from(atelierContractors)
      .where(isNull(atelierContractors.deletedAt));
    for (const r of rows) {
      if (
        !matches(r.fullName) &&
        !matchesPerson(r.personId) &&
        !matches(r.email) &&
        !matches(r.vendorEntity)
      )
        continue;
      if (opts.status && r.status !== opts.status) continue;
      // Contractors don't carry a `seniority` column, so a seniority filter
      // implicitly excludes them — desirable behaviour for cohort views.
      if (!matchesCohort({ ...r, seniority: null })) continue;
      out.push(contractorToWire(r, opts.includeComp));
    }
  }

  if (wt === "all" || wt === "partner_firm_resource") {
    const rows = await db
      .select({
        r: atelierPartnerFirmResources,
        firmName: atelierPartnerFirms.name,
      })
      .from(atelierPartnerFirmResources)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirmResources.partnerFirmId, atelierPartnerFirms.id),
      )
      .where(isNull(atelierPartnerFirmResources.deletedAt));
    for (const { r, firmName } of rows) {
      if (
        !matches(r.fullName) &&
        !matchesPerson(r.personId) &&
        !matches(r.email) &&
        !matches(r.role) &&
        !matches(firmName ?? "")
      )
        continue;
      if (opts.status && r.status !== opts.status) continue;
      if (!matchesCohort(r)) continue;
      out.push(partnerResourceToWire(r, firmName, opts.includeComp));
    }
  }

  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  await attachStructuredNames(out);
  return out;
}

/**
 * Task #538 — batch-attach structured name fields from atelier_persons
 * onto roster wires (form prefill + display). Wires without a personId
 * are left untouched.
 */
async function attachStructuredNames(wires: PersonWire[]): Promise<void> {
  const ids = [...new Set(wires.map((w) => w.personId).filter((v): v is string => !!v))];
  if (ids.length === 0) return;
  const rows = await db.select().from(atelierPersons).where(inArray(atelierPersons.id, ids));
  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const w of wires) {
    const p = w.personId ? byId.get(w.personId) : undefined;
    if (!p) continue;
    w.honorific = p.honorific ?? null;
    w.firstName = p.firstName;
    w.middleName = p.middleName ?? null;
    w.lastName = p.lastName;
    w.displayName = p.displayName;
    if (w.preferredName === undefined || w.preferredName === null) {
      w.preferredName = p.preferredName ?? null;
    }
  }
}

function employeeToWire(
  r: typeof atelierEmployees.$inferSelect,
  includeComp: boolean,
): PersonWire {
  const base: PersonWire = {
    id: r.id,
    workerType: "employee",
    fullName: r.fullName,
    personId: r.personId ?? null,
    email: r.email,
    role: r.role,
    seniority: r.seniority,
    title: r.title,
    country: r.country,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    employmentType: r.employmentType,
    homeOffice: r.homeOffice,
    // Task #199 — prefill fields for the full Edit Person form.
    preferredName: r.preferredName ?? null,
    employmentStatus: r.employmentStatus ?? null,
    employingEntity: r.employingEntity ?? null,
    // Task #1095 — home country (ISO-2) for entity-allocation travel rules.
    homeCountry: r.homeCountry ?? null,
    // Task #645 — public contact fields for the business-card vCard QR.
    cellPhones: r.cellPhones ?? [],
    officeAddress: r.officeAddress ?? null,
    avatarUrl: r.avatarUrl,
    notes: r.notes,
    gender: r.gender ?? "unspecified",
    nationality: r.nationality ?? null,
    // Task #744 — travel loyalty + preferences (employees only; membership
    // numbers are masked downstream by sanitizeForViewer).
    travelProfile: travelProfileToWire(r.travelProfile),
  };
  if (includeComp) {
    base.iban = r.iban;
    base.swift = r.swift;
    base.noticePeriodDays = r.noticePeriodDays;
    base.payrollCountry = r.payrollCountry;
    base.employeeIdExternal = r.employeeIdExternal;
    base.partnerEconomicsId = r.partnerEconomicsId;
    // PRD §2.1 policy-locked field — Partner / Operations only.
    base.baseCompensation = r.baseCompensation ?? null;
    // Task #660 — statutory payroll fields (comp-gated prefill for the
    // payroll edit surface).
    base.baseCurrency = r.baseCurrency ?? null;
    base.legalEntityId = r.legalEntityId ?? null;
    base.basicWageMonthly = r.basicWageMonthly ?? null;
    base.housingAllowanceMonthly = r.housingAllowanceMonthly ?? null;
    base.schemeRegisteredOn = r.schemeRegisteredOn ?? null;
  }
  return base;
}

function contractorToWire(
  r: typeof atelierContractors.$inferSelect,
  includeComp: boolean,
): PersonWire {
  const base: PersonWire = {
    id: r.id,
    workerType: "contractor",
    fullName: r.fullName,
    personId: r.personId ?? null,
    email: r.email,
    role: null,
    seniority: null,
    title: null,
    country: r.country,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    vendorEntity: r.vendorEntity,
    // Task #199 — prefill field for the full Edit Person form.
    contractType: r.contractType ?? null,
    notes: r.notes,
    gender: r.gender ?? "unspecified",
    nationality: r.nationality ?? null,
  };
  if (includeComp) {
    base.dayRateAmount = r.dayRateAmount;
    base.dayRateCurrency = r.dayRateCurrency;
    // PRD §2.1 policy-locked field — Partner / Operations only.
    base.dayRateInternalCost = r.dayRateInternalCost ?? null;
  }
  return base;
}

function partnerResourceToWire(
  r: typeof atelierPartnerFirmResources.$inferSelect,
  firmName: string | null,
  includeComp: boolean,
): PersonWire {
  const base: PersonWire = {
    id: r.id,
    workerType: "partner_firm_resource",
    fullName: r.fullName,
    personId: r.personId ?? null,
    email: r.email,
    role: r.role,
    seniority: r.seniority,
    title: r.role,
    country: r.country,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    partnerFirmId: r.partnerFirmId,
    partnerFirmName: firmName,
    notes: r.notes,
    gender: r.gender ?? "unspecified",
    nationality: r.nationality ?? null,
  };
  if (includeComp) {
    base.dayRateAmount = r.dayRateAmount;
    base.dayRateCurrency = r.dayRateCurrency;
    // PRD §2.1 policy-locked field — Partner / Operations only.
    base.costToCognirisePerDay = r.costToCognirisePerDay ?? null;
  }
  return base;
}

export async function getPerson(
  id: string,
  includeComp: boolean,
): Promise<PersonWire | null> {
  const wire = await getPersonRaw(id, includeComp);
  if (wire) await attachStructuredNames([wire]);
  return wire;
}

async function getPersonRaw(
  id: string,
  includeComp: boolean,
): Promise<PersonWire | null> {
  // Try each table by id.
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, id), isNull(atelierEmployees.deletedAt)));
  if (emp) return employeeToWire(emp, includeComp);

  const [ct] = await db
    .select()
    .from(atelierContractors)
    .where(
      and(eq(atelierContractors.id, id), isNull(atelierContractors.deletedAt)),
    );
  if (ct) return contractorToWire(ct, includeComp);

  const [pr] = await db
    .select({
      r: atelierPartnerFirmResources,
      firmName: atelierPartnerFirms.name,
    })
    .from(atelierPartnerFirmResources)
    .leftJoin(
      atelierPartnerFirms,
      eq(atelierPartnerFirmResources.partnerFirmId, atelierPartnerFirms.id),
    )
    .where(
      and(
        eq(atelierPartnerFirmResources.id, id),
        isNull(atelierPartnerFirmResources.deletedAt),
      ),
    );
  if (pr) return partnerResourceToWire(pr.r, pr.firmName, includeComp);

  return null;
}

/**
 * Resolve the v1/v2 atelier_users.id that a person row corresponds to,
 * if any. Used when looking up engagement_access (which keys on user_id).
 *
 * For employees: directly via employees.user_id.
 * For contractors / partner-firm resources: looked up by lower-cased email
 * against atelier_users.email (the v3 access grants for non-employee
 * personas write to atelier_users with role='contractor'|'partner_firm_resource').
 */
export async function resolveLinkedUserId(
  person: PersonWire,
): Promise<string | null> {
  if (person.workerType === "employee") {
    const [emp] = await db
      .select({ userId: atelierEmployees.userId })
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, person.id));
    return emp?.userId ?? null;
  }
  if (!person.email) return null;
  const [u] = await db
    .select({ id: atelierUsers.id })
    .from(atelierUsers)
    .where(eq(atelierUsers.email, person.email));
  return u?.id ?? null;
}

// -----------------------------------------------------------------
// Access Sentinel (Task #254 §6) — grant/revoke chokepoint.
// -----------------------------------------------------------------

const FORBIDDEN_SCOPE_FOR_NONEMPLOYEE = new Set([
  "can_view_pricing",
  "can_view_margin",
  "can_view_partner_economics",
  "can_view_compensation",
  "can_export_audit_pdf",
]);

interface SentinelInput {
  actor: typeof atelierUsers.$inferSelect;
  targetPerson: PersonWire;
  engagementId: string;
  roleOnEngagement: string; // lead | member | reviewer | partner_resource | contractor
  allocationPct: number;
  scope: string[];
  endDate?: string | null;
  action: "grant" | "revoke";
  // Task #255 — Partner override path sets this to bypass the conflict gate.
  // Override always emits an audit row in the calling route.
  skipConflictGate?: boolean;
}

interface SentinelResult {
  ok: boolean;
  blocked?: {
    reason: string;
    offendingScope?: string[];
    conflictIds?: string[];
    accountId?: string;
    accountName?: string;
  };
  grantId?: string;
}

async function runAccessSentinel(input: SentinelInput): Promise<SentinelResult> {
  // Task #292 — Policy 1: only partner-tier (founding_partner|partner),
  // senior_manager (replaces engagement_lead), or finance/hr (split from
  // operations) may write grants.
  const r = input.actor.role;
  const writerOk =
    r === "founding_partner" ||
    r === "partner" ||
    r === "senior_manager" ||
    r === "finance" ||
    r === "hr";
  if (!writerOk) {
    return {
      ok: false,
      blocked: { reason: "actor-not-authorized-to-grant-access" },
    };
  }

  // Policy 2 — non-employee personas cannot hold pricing/margin scope.
  if (
    input.targetPerson.workerType !== "employee" &&
    input.action === "grant"
  ) {
    const offending = input.scope.filter((s) =>
      FORBIDDEN_SCOPE_FOR_NONEMPLOYEE.has(s),
    );
    if (offending.length > 0) {
      assertAuditAction("access.grant.blocked");
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "engagement_access",
        entityId: `${input.engagementId}:${input.targetPerson.id}`,
        actorType: "agent",
        actorId: "ag_access_sentinel",
        actorLabel: "Access Sentinel",
        action: "access.grant.blocked",
        payload: {
          engagementId: input.engagementId,
          targetPersonId: input.targetPerson.id,
          workerType: input.targetPerson.workerType,
          offendingScope: offending,
          actor: input.actor.id,
        },
        payloadSummary: `Access Sentinel blocked grant of ${offending.join(",")} to ${input.targetPerson.workerType} ${input.targetPerson.fullName}`,
      });
      return {
        ok: false,
        blocked: {
          reason: "non-employee-cannot-hold-pricing-scope",
          offendingScope: offending,
        },
      };
    }
  }

  // Policy 3 — engagement must exist + not be soft-deleted.
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, input.engagementId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (!eng) {
    return { ok: false, blocked: { reason: "engagement-not-found" } };
  }

  // Policy 4 — auto-deny grants to closed engagements (Sentinel proposes
  // revocation on close; manual grants are blocked).
  if (eng.plmStage === "closed" && input.action === "grant") {
    return {
      ok: false,
      blocked: { reason: "engagement-closed-grants-frozen" },
    };
  }

  // Policy 5 (Task #255) — Conflict-of-Interest gate. If the target person
  // has an active conflict whose declared_party matches the engagement's
  // account, block. Partner override path is the explicit
  // POST /roster/access/conflict-override endpoint, which writes the
  // override row AND retries the grant. We always emit a `block` audit
  // event here so the trail shows the original guardrail fired.
  if (input.action === "grant" && !input.skipConflictGate) {
    const [acct] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, eng.accountId));
    if (acct) {
      const activeConflicts = await db
        .select()
        .from(atelierConflictDisclosures)
        .where(
          and(
            eq(atelierConflictDisclosures.personType, input.targetPerson.workerType),
            eq(atelierConflictDisclosures.personId, input.targetPerson.id),
            eq(atelierConflictDisclosures.status, "active"),
            isNull(atelierConflictDisclosures.deletedAt),
          ),
        );
      const matched = activeConflicts.filter((c) => {
        const dp = (c.declaredParty ?? "").toLowerCase();
        if (!dp) return false;
        return (
          dp === acct.id.toLowerCase() ||
          dp === acct.name.toLowerCase() ||
          dp.includes(acct.name.toLowerCase()) ||
          acct.name.toLowerCase().includes(dp)
        );
      });
      if (matched.length > 0) {
        assertAuditAction("access.grant.blocked.conflict");
        await db.insert(atelierAuditEvents).values({
          id: rid("aud"),
          entityType: "engagement_access",
          entityId: `${input.engagementId}:${input.targetPerson.id}`,
          actorType: "agent",
          actorId: "ag_access_sentinel",
          actorLabel: "Access Sentinel",
          action: "access.grant.blocked.conflict",
          payload: {
            engagementId: input.engagementId,
            targetPersonId: input.targetPerson.id,
            accountId: acct.id,
            conflictIds: matched.map((m) => m.id),
            actor: input.actor.id,
          },
          payloadSummary: `Access Sentinel blocked grant of ${input.targetPerson.fullName} → ${eng.name}: active conflict on ${acct.name}.`,
        });
        return {
          ok: false,
          blocked: {
            reason: "conflict-of-interest-active",
            conflictIds: matched.map((m) => m.id),
            accountId: acct.id,
            accountName: acct.name,
          },
        };
      }
    }
  }

  // Resolve target → atelier_users.id (engagement_access keys on user_id).
  const userId = await resolveLinkedUserId(input.targetPerson);
  if (!userId) {
    return {
      ok: false,
      blocked: {
        reason:
          "target-person-has-no-portal-login-account (provision atelier_users row first)",
      },
    };
  }

  if (input.action === "revoke") {
    await db
      .update(atelierEngagementAccess)
      .set({ status: "revoked", endDate: new Date() })
      .where(
        and(
          eq(atelierEngagementAccess.engagementId, input.engagementId),
          eq(atelierEngagementAccess.userId, userId),
        ),
      );
    assertAuditAction("access.revoke");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "engagement_access",
      entityId: `${input.engagementId}:${userId}`,
      actorType: "agent",
      actorId: "ag_access_sentinel",
      actorLabel: "Access Sentinel",
      action: "access.revoke",
      payload: { engagementId: input.engagementId, userId, by: input.actor.id },
      payloadSummary: `Access Sentinel revoked ${input.targetPerson.fullName} from engagement ${eng.name}`,
    });
    return { ok: true };
  }

  // Grant or upsert.
  const existing = await db
    .select()
    .from(atelierEngagementAccess)
    .where(
      and(
        eq(atelierEngagementAccess.engagementId, input.engagementId),
        eq(atelierEngagementAccess.userId, userId),
      ),
    );

  if (existing.length > 0) {
    await db
      .update(atelierEngagementAccess)
      .set({
        roleOnEngagement: input.roleOnEngagement,
        allocationPct: Math.max(0, Math.min(100, input.allocationPct | 0)),
        scope: input.scope,
        status: "active",
        grantedByUserId: input.actor.id,
        grantedAt: new Date(),
        endDate: input.endDate ? new Date(input.endDate) : null,
        deletedAt: null,
      })
      .where(eq(atelierEngagementAccess.id, existing[0]!.id));
  } else {
    await db.insert(atelierEngagementAccess).values({
      id: rid("acc"),
      engagementId: input.engagementId,
      userId,
      roleOnEngagement: input.roleOnEngagement,
      allocationPct: Math.max(0, Math.min(100, input.allocationPct | 0)),
      scope: input.scope,
      status: "active",
      grantedByUserId: input.actor.id,
      grantedAt: new Date(),
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
  }

  assertAuditAction("access.grant");
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "engagement_access",
    entityId: `${input.engagementId}:${userId}`,
    actorType: "agent",
    actorId: "ag_access_sentinel",
    actorLabel: "Access Sentinel",
    action: "access.grant",
    payload: {
      engagementId: input.engagementId,
      userId,
      role: input.roleOnEngagement,
      scope: input.scope,
      by: input.actor.id,
    },
    payloadSummary: `Access Sentinel granted ${input.targetPerson.fullName} → ${eng.name} (${input.roleOnEngagement}, ${input.allocationPct}%)`,
  });

  return { ok: true, grantId: existing[0]?.id };
}

// Exported so engagement-close handlers can call directly later.
export { runAccessSentinel };

// -----------------------------------------------------------------
// Routes
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const wt = req.query.workerType as WorkerType | "all" | "internal" | undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    // Task #412 — cohort query params from the People Lens Composition
    // dashboard's deep-links and the directory's chip strip.
    const str = (k: string): string | undefined =>
      typeof req.query[k] === "string" ? (req.query[k] as string) : undefined;
    // Task #221 — roster visibility scoping (see helpers above).
    const scope = await resolveRosterScope(me);
    const sensitiveViewer = canViewSensitivePeopleData(me.role);
    const list = await listPersons({
      workerType: wt,
      q,
      status,
      // Demographic cohort filters are sensitive-people surfaces.
      nationality: sensitiveViewer ? str("nationality") : undefined,
      gender: sensitiveViewer ? str("gender") : undefined,
      country: str("country"),
      seniority: str("seniority"),
      includeComp: scope.kind === "full" && canSeeComp(me.role),
    });
    if (scope.kind === "reports") {
      const people = list
        .filter((p) => scope.personIds.has(p.id))
        .map(toBusinessWire);
      res.json({ people, viewerCanSeeComp: false, viewerScope: "reports" });
      return;
    }
    res.json({
      people: list.map((p) => sanitizeForViewer(p, me)),
      viewerCanSeeComp: canSeeComp(me.role),
      viewerScope: "full",
    });
  } catch (err) {
    next(err);
  }
});

// Task #412 — HR-only demographics edit. Gender + nationality are the
// two columns added to the roster tables in this task; the dashboard
// surfaces coverage % so HR can chase data quality from one place.
// Wire-format: { gender?: "female"|"male"|"unspecified",
//                nationality?: string|null  // ISO-3166 alpha-2 or null }
const ALLOWED_GENDERS = new Set(["female", "male", "unspecified"]);
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.patch("/roster/people/:id/demographics", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — people edits are founding_partner | hr only.
    if (!canEditPeople(me.role)) {
      res.status(403).json({ error: "demographics-edit-restricted" });
      return;
    }
    const person = await getPerson(req.params.id, true);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const body = req.body as { gender?: string; nationality?: string | null };
    const update: { gender?: string; nationality?: string | null } = {};
    if (typeof body.gender === "string") {
      if (!ALLOWED_GENDERS.has(body.gender)) {
        res.status(422).json({ error: "invalid-gender" });
        return;
      }
      update.gender = body.gender;
    }
    if (body.nationality === null || typeof body.nationality === "string") {
      const n = body.nationality;
      if (typeof n === "string" && n !== "" && !/^[A-Za-z]{2}$/.test(n)) {
        res.status(422).json({ error: "invalid-nationality-iso2" });
        return;
      }
      update.nationality = n ? n.toUpperCase() : null;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "no-updatable-fields" });
      return;
    }
    if (person.workerType === "employee") {
      await db.update(atelierEmployees).set(update).where(eq(atelierEmployees.id, person.id));
    } else if (person.workerType === "contractor") {
      await db.update(atelierContractors).set(update).where(eq(atelierContractors.id, person.id));
    } else {
      await db.update(atelierPartnerFirmResources).set(update).where(eq(atelierPartnerFirmResources.id, person.id));
    }
    assertAuditAction("roster.person.updated");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "person",
      entityId: person.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name ?? me.id,
      action: "roster.person.updated",
      payload: { workerType: person.workerType, change: "demographics", ...update },
      payloadSummary: `${me.name ?? me.id} updated demographics for ${person.fullName}`,
    });
    const updated = await getPerson(person.id, canSeeComp(me.role));
    res.json({ person: updated });
  } catch (err) {
    next(err);
  }
});

// Task #189 — founding_partner / HR edit of an employee's job title. Titles
// are HR-controlled (deliberately excluded from /me/profile), so this is the
// only write surface. Keeps atelier_employees.title and the linked
// atelier_users.title in sync and writes an audit event with from/to values.
// Employees only: contractors have no title column and partner-firm resources
// surface their firm role instead.
const MAX_TITLE_LEN = 120;
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.patch("/roster/people/:id/title", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isHr(me.role) && !isFoundingPartner(me.role)) {
      res.status(403).json({ error: "title-edit-restricted" });
      return;
    }
    const person = await getPerson(req.params.id, true);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    if (person.workerType !== "employee") {
      res.status(422).json({ error: "title-edit-employees-only" });
      return;
    }
    const body = req.body as { title?: unknown };
    if (typeof body.title !== "string" || !body.title.trim()) {
      res.status(422).json({ error: "title-required" });
      return;
    }
    const title = body.title.trim();
    if (title.length > MAX_TITLE_LEN) {
      res.status(422).json({ error: "title-too-long", max: MAX_TITLE_LEN });
      return;
    }
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, person.id))
      .limit(1);
    if (!emp) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const fromTitle = emp.title ?? null;
    if (fromTitle === title) {
      res.json({ person: await getPerson(person.id, canSeeComp(me.role)) });
      return;
    }
    await db
      .update(atelierEmployees)
      .set({ title, updatedAt: new Date() })
      .where(eq(atelierEmployees.id, emp.id));
    // Keep the linked login (atelier_users.title) in sync. Prefer the userId
    // FK; fall back to an org-scoped email match for pre-link hires.
    let syncedUserId: string | null = null;
    if (emp.userId) {
      const upd = await db
        .update(atelierUsers)
        .set({ title, updatedAt: new Date() })
        .where(
          and(eq(atelierUsers.id, emp.userId), eq(atelierUsers.orgId, emp.orgId)),
        )
        .returning({ id: atelierUsers.id });
      syncedUserId = upd[0]?.id ?? null;
    } else if (emp.email) {
      const upd = await db
        .update(atelierUsers)
        .set({ title, updatedAt: new Date() })
        .where(
          and(
            eq(atelierUsers.email, emp.email),
            eq(atelierUsers.orgId, emp.orgId),
            isNull(atelierUsers.deletedAt),
          ),
        )
        .returning({ id: atelierUsers.id });
      syncedUserId = upd[0]?.id ?? null;
    }
    assertAuditAction("roster.person.updated");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "person",
      entityId: emp.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name ?? me.id,
      action: "roster.person.updated",
      payload: {
        workerType: "employee",
        change: "title",
        from: fromTitle,
        to: title,
        syncedUserId,
      },
      payloadSummary: `${me.name ?? me.id} changed ${emp.fullName}'s title from "${fromTitle ?? "—"}" to "${title}"`,
    });
    const updated = await getPerson(emp.id, canSeeComp(me.role));
    res.json({ person: updated });
  } catch (err) {
    next(err);
  }
});

// Task #645 — HR / Partner edit of an employee's PUBLIC business-card contact
// fields (cell phones + office address) that feed the offline vCard QR code.
// Wire-format: { cellPhones: Array<{country,number}>, officeAddress?: string|null }.
// At least one cell with a non-empty number is mandatory; up to 3 are allowed,
// each labelled by the country the line belongs to. Employees only.
const MAX_CELLS = 3;
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.patch("/roster/people/:id/contact", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — people edits are founding_partner | hr only.
    if (!canEditPeople(me.role)) {
      res.status(403).json({ error: "contact-edit-restricted" });
      return;
    }
    const person = await getPerson(req.params.id, true);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    if (person.workerType !== "employee") {
      res.status(422).json({ error: "contact-card-employees-only" });
      return;
    }
    const body = req.body as {
      cellPhones?: unknown;
      officeAddress?: unknown;
    };
    if (!Array.isArray(body.cellPhones)) {
      res.status(400).json({ error: "cellPhones-required" });
      return;
    }
    const cleaned: Array<{ country: string; number: string }> = [];
    for (const entry of body.cellPhones) {
      if (!entry || typeof entry !== "object") continue;
      const country = String((entry as { country?: unknown }).country ?? "").trim();
      const number = String((entry as { number?: unknown }).number ?? "").trim();
      if (!number && !country) continue; // drop fully-blank rows
      // Each cell must carry a number AND the country it belongs to — the
      // country label is what the vCard surfaces (TEL;TYPE=cell + X-ABLabel).
      if (!number) {
        res.status(422).json({ error: "cell-number-required" });
        return;
      }
      if (!country) {
        res.status(422).json({ error: "cell-country-required" });
        return;
      }
      cleaned.push({ country, number });
    }
    if (cleaned.length === 0) {
      res.status(422).json({ error: "at-least-one-cell-required" });
      return;
    }
    if (cleaned.length > MAX_CELLS) {
      res.status(422).json({ error: "too-many-cells", max: MAX_CELLS });
      return;
    }
    // Office address is a required part of the business card (feeds the vCard ADR).
    if (typeof body.officeAddress !== "string" || !body.officeAddress.trim()) {
      res.status(422).json({ error: "office-address-required" });
      return;
    }
    const update: {
      cellPhones: Array<{ country: string; number: string }>;
      officeAddress: string;
    } = { cellPhones: cleaned, officeAddress: body.officeAddress.trim() };
    const officeAddress = update.officeAddress;
    await db
      .update(atelierEmployees)
      .set(update)
      .where(eq(atelierEmployees.id, person.id));
    assertAuditAction("roster.person.updated");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "person",
      entityId: person.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name,
      action: "roster.person.updated",
      payload: {
        workerType: person.workerType,
        change: "contact",
        cellCount: cleaned.length,
        officeAddressSet: officeAddress != null && officeAddress !== "",
      },
      payloadSummary: `${me.name} updated business-card contact for ${person.fullName}`,
    });
    const updated = await getPerson(person.id, canSeeComp(me.role));
    res.json({ person: updated });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Task #199 — Full "Edit person" PATCH. One org-scoped endpoint accepting a
// whitelisted set of editable fields per worker type, gated to hr / partner /
// founding_partner (title stays hr / founding_partner-only, mirroring the
// dedicated /title route). Sensitive comp/bank/lifecycle fields are rejected
// explicitly, every accepted change is audited field-by-field.
// -----------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const zIsoDate = z
  .string()
  .regex(ISO_DATE, "expected YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
  .nullable();
const zGender = z.enum(["female", "male", "unspecified"]);
const zNationality = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "ISO alpha-2")
  .transform((s) => s.toUpperCase())
  .nullable();
const zCells = z
  .array(
    z.object({
      country: z.string().trim().min(1).max(60),
      number: z.string().trim().min(3).max(40),
    }),
  )
  .max(MAX_CELLS);
const zTrimmed = (max: number) => z.string().trim().min(1).max(max);
const zNullableTrimmed = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => (s.trim() ? s.trim() : null))
    .nullable();

// Task #538 — structured name fields accepted on all worker types; the
// server recomputes the legacy fullName mirror from them.
const zStructuredNameFields = {
  honorific: zNullableTrimmed(40),
  firstName: zTrimmed(120),
  middleName: zNullableTrimmed(120),
  lastName: zTrimmed(120),
} as const;

const employeeEditSchema = z
  .object({
    fullName: zTrimmed(200),
    ...zStructuredNameFields,
    preferredName: zNullableTrimmed(120),
    email: z.string().trim().email().max(320),
    personalEmail: z.string().trim().email().max(320).nullable(),
    seniority: z.enum([
      "analyst",
      "consultant",
      "senior_consultant",
      "manager",
      "principal",
      "partner",
    ]),
    title: zTrimmed(MAX_TITLE_LEN),
    homeOffice: zNullableTrimmed(120),
    country: zNullableTrimmed(120),
    employmentType: z.enum(["FTE", "fixed_term", "intern"]),
    employmentStatus: z.enum(["active", "notice", "on_leave", "terminated"]),
    employingEntity: zNullableTrimmed(120),
    // Task #1095 — home country (ISO-2) feeding the entity-allocation
    // travel rules (home vs destination). HR/founding editable like the
    // rest of this schema.
    homeCountry: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    startDate: zIsoDate,
    endDate: zIsoDate,
    noticePeriodDays: z.number().int().min(0).max(365),
    nationality: zNationality,
    gender: zGender,
    cellPhones: zCells,
    officeAddress: zNullableTrimmed(500),
    // Task #744 — travel loyalty programs + preferences (employees only;
    // contractor/PFR schemas deliberately omit this field so writes for
    // non-employees fail with invalid-body).
    travelProfile: zTravelProfile.nullable(),
  })
  .partial()
  .strict();

const contractorEditSchema = z
  .object({
    fullName: zTrimmed(200),
    ...zStructuredNameFields,
    preferredName: zNullableTrimmed(120),
    email: z.string().trim().email().max(320),
    personalEmail: z.string().trim().email().max(320).nullable(),
    country: zNullableTrimmed(120),
    nationality: zNationality,
    gender: zGender,
    vendorEntity: zNullableTrimmed(200),
    // Task #1095 — home country (ISO-2) for entity-allocation travel rules.
    homeCountry: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    contractType: z.enum(["T&M", "fixed_fee", "retainer"]).nullable(),
    startDate: zIsoDate,
    endDate: zIsoDate,
    cellPhones: zCells,
    officeAddress: zNullableTrimmed(500),
  })
  .partial()
  .strict();

const partnerResourceEditSchema = z
  .object({
    fullName: zTrimmed(200),
    ...zStructuredNameFields,
    preferredName: zNullableTrimmed(120),
    email: z.string().trim().email().max(320).nullable(),
    role: zNullableTrimmed(120),
    seniority: zNullableTrimmed(60),
    country: zNullableTrimmed(120),
    nationality: zNationality,
    gender: zGender,
    startDate: zIsoDate,
    endDate: zIsoDate,
    partnerFirmId: zTrimmed(80),
  })
  .partial()
  .strict();

// Fields that must NEVER pass through this endpoint — pay/bank data stays on
// the finance flows, lifecycle + identity keys stay on their dedicated flows.
const SENSITIVE_EDIT_FIELDS = new Set([
  "iban",
  "swift",
  "dayRateAmount",
  "dayRateCurrency",
  "dayRateInternalCost",
  "baseCompensation",
  "baseCurrency",
  // Task #660 — payroll linkage fields live on the dedicated payroll PATCH.
  "legalEntityId",
  "basicWageMonthly",
  "housingAllowanceMonthly",
  "schemeRegisteredOn",
  // Task #1136 — WPS identifiers live on the dedicated payroll PATCH.
  "mohrePersonId",
  "bankRoutingCode",
  "payrollCountry",
  "payrollCountryCode",
  "costToCognirisePerDay",
  "partnerEconomicsId",
  "paymentTermsDays",
  "status",
  "workerType",
  "role", // employee RBAC role — access-managed; PFR free-text role IS allowed via its own schema
  "userId",
  "id",
  "orgId",
  "deletedAt",
]);

// Task #199 — id+name list of live partner firms for the Edit Person form's
// partner-firm linkage dropdown. Editor-gated like the PATCH below.
// @cli-skip: UI support read for the Edit Person form
router.get("/roster/partner-firms", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — people edits are founding_partner | hr only.
    if (!canEditPeople(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const firms = await db
      .select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
      .from(atelierPartnerFirms)
      .where(and(eq(atelierPartnerFirms.orgId, me.orgId), isNull(atelierPartnerFirms.deletedAt)));
    firms.sort((a, b) => a.name.localeCompare(b.name));
    // Contracted (active) resources ride along so pickers (e.g. invitation
    // source) can offer individual partner-firm people, not just firm rows.
    const resources = await db
      .select({
        id: atelierPartnerFirmResources.id,
        partnerFirmId: atelierPartnerFirmResources.partnerFirmId,
        fullName: atelierPartnerFirmResources.fullName,
        email: atelierPartnerFirmResources.email,
        role: atelierPartnerFirmResources.role,
        seniority: atelierPartnerFirmResources.seniority,
        country: atelierPartnerFirmResources.country,
        startDate: atelierPartnerFirmResources.startDate,
        status: atelierPartnerFirmResources.status,
        firmName: atelierPartnerFirms.name,
      })
      .from(atelierPartnerFirmResources)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirmResources.partnerFirmId, atelierPartnerFirms.id),
      )
      .where(
        and(
          eq(atelierPartnerFirmResources.orgId, me.orgId),
          eq(atelierPartnerFirmResources.status, "active"),
          isNull(atelierPartnerFirmResources.deletedAt),
        ),
      );
    resources.sort((a, b) => a.fullName.localeCompare(b.fullName));
    res.json({ firms, resources });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.patch("/roster/people/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — people edits are founding_partner | hr only.
    if (!canEditPeople(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const person = await getPerson(req.params.id, true);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const rawBody = (req.body ?? {}) as Record<string, unknown>;

    // Explicit rejection of sensitive fields — before schema parsing so the
    // caller gets a precise "locked" error rather than a generic unknown-key.
    const offendingSensitive = Object.keys(rawBody).filter((k) =>
      SENSITIVE_EDIT_FIELDS.has(k) &&
      !(person.workerType === "partner_firm_resource" && k === "role"),
    );
    if (offendingSensitive.length > 0) {
      res.status(422).json({
        error: "field-locked",
        fields: offendingSensitive,
        hint: "Pay, bank and lifecycle fields are managed by their dedicated flows.",
      });
      return;
    }

    const schema =
      person.workerType === "employee"
        ? employeeEditSchema
        : person.workerType === "contractor"
          ? contractorEditSchema
          : partnerResourceEditSchema;
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      res.status(422).json({
        error: "invalid-body",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    const patch = parsed.data as Record<string, unknown>;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no-updatable-fields" });
      return;
    }

    // Title stays hr / founding_partner-only (Task #189 rule).
    if ("title" in patch && !isHr(me.role) && !isFoundingPartner(me.role)) {
      res.status(403).json({ error: "title-edit-restricted" });
      return;
    }

    // Load the raw org-scoped row so we can diff exact from/to values.
    const table =
      person.workerType === "employee"
        ? atelierEmployees
        : person.workerType === "contractor"
          ? atelierContractors
          : atelierPartnerFirmResources;
    const [row] = await db
      .select()
      .from(table)
      .where(and(eq(table.id, person.id), eq(table.orgId, me.orgId)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const raw = row as unknown as Record<string, unknown>;

    // Task #538 — name fields flow through the person record. Pull them out
    // of the column patch, resolve the structured name (structured fields
    // win; bare fullName is parsed), and stage the legacy fullName mirror.
    const nameInput: {
      fullName?: string;
      honorific?: string | null;
      firstName?: string;
      middleName?: string | null;
      lastName?: string;
      preferredName?: string | null;
    } = {};
    for (const k of ["honorific", "firstName", "middleName", "lastName", "preferredName", "fullName"] as const) {
      if (k in patch) {
        (nameInput as Record<string, unknown>)[k] = patch[k];
        delete patch[k];
      }
    }
    const existingPerson = raw.personId
      ? (
          await db
            .select()
            .from(atelierPersons)
            .where(and(eq(atelierPersons.id, String(raw.personId)), eq(atelierPersons.orgId, me.orgId)))
            .limit(1)
        )[0] ?? null
      : null;
    let pendingStructured: StructuredName | null = null;
    if (Object.keys(nameInput).length > 0) {
      try {
        pendingStructured = resolveStructuredNameInput(nameInput, existingPerson);
      } catch (err) {
        if (err instanceof PersonNameValidationError) {
          res.status(422).json({ error: "invalid-body", issues: [{ path: "name", message: err.message }] });
          return;
        }
        throw err;
      }
      if (pendingStructured) {
        patch.fullName = composeFullName(pendingStructured);
        // preferredName is a real column on employees only; other worker
        // types keep it solely on the person record.
        if (person.workerType === "employee") {
          patch.preferredName = pendingStructured.preferredName ?? null;
        }
      }
    }
    const structuredChanged =
      pendingStructured !== null &&
      (!existingPerson ||
        existingPerson.honorific !== (pendingStructured.honorific ?? null) ||
        existingPerson.firstName !== pendingStructured.firstName ||
        existingPerson.middleName !== (pendingStructured.middleName ?? null) ||
        existingPerson.lastName !== pendingStructured.lastName ||
        existingPerson.preferredName !== (pendingStructured.preferredName ?? null));

    // Partner-firm linkage must point at a live firm in this org.
    if ("partnerFirmId" in patch) {
      const [firm] = await db
        .select({ id: atelierPartnerFirms.id })
        .from(atelierPartnerFirms)
        .where(
          and(
            eq(atelierPartnerFirms.id, String(patch.partnerFirmId)),
            eq(atelierPartnerFirms.orgId, me.orgId),
            isNull(atelierPartnerFirms.deletedAt),
          ),
        )
        .limit(1);
      if (!firm) {
        res.status(422).json({ error: "partner-firm-not-found" });
        return;
      }
    }

    // Date sanity — the RESULTING pair must be ordered.
    const nextStart =
      "startDate" in patch ? (patch.startDate as string | null) : (raw.startDate as string | null);
    const nextEnd =
      "endDate" in patch ? (patch.endDate as string | null) : (raw.endDate as string | null);
    if (nextStart && nextEnd && nextEnd < nextStart) {
      res.status(422).json({ error: "end-date-before-start-date" });
      return;
    }

    // Work-email uniqueness within the org (employees carry a unique index;
    // enforce the same courtesy check for all worker types).
    if ("email" in patch && patch.email && patch.email !== raw.email) {
      const dupes = await listPersons({ workerType: "all", includeComp: false });
      const emailLc = String(patch.email).toLowerCase();
      if (dupes.some((p) => p.id !== person.id && (p.email ?? "").toLowerCase() === emailLc)) {
        res.status(409).json({ error: "email-already-in-use" });
        return;
      }
    }

    // Diff — only persist fields whose value actually changes.
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const before = raw[k] ?? null;
      const after = v ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      update[k] = v;
      changes.push({ field: k, from: before, to: after });
    }
    // Task #538 — a structured-name change (e.g. honorific or preferred
    // name only) may leave the legacy fullName mirror untouched; surface it
    // as its own change entry so the audit trail records it.
    if (structuredChanged && !changes.some((c) => c.field === "fullName")) {
      changes.push({
        field: "name",
        from: existingPerson
          ? [existingPerson.honorific, existingPerson.firstName, existingPerson.middleName, existingPerson.lastName, existingPerson.preferredName]
          : (raw.fullName as string | null),
        to: pendingStructured
          ? [pendingStructured.honorific, pendingStructured.firstName, pendingStructured.middleName, pendingStructured.lastName, pendingStructured.preferredName ?? null]
          : null,
      });
    }
    if (changes.length === 0) {
      res.json({ person: await getPerson(person.id, canSeeComp(me.role)), changes: [] });
      return;
    }
    update.updatedAt = new Date();

    // Task #538 — persist the person record and link the row if unlinked.
    // writePersonAndSync so a person linked across domains (e.g. an
    // employee with a login row) can never drift out of step.
    if (pendingStructured && (structuredChanged || !raw.personId)) {
      const w = await writePersonAndSync(db, {
        orgId: me.orgId,
        personId: (raw.personId as string | null) ?? null,
        structured: pendingStructured,
        sourceKind:
          person.workerType === "employee"
            ? "employee"
            : person.workerType === "contractor"
              ? "contractor"
              : "partner_firm_resource",
        createdByUserId: me.id,
      });
      if (!raw.personId) update.personId = w.personId;
    }

    if (person.workerType === "employee") {
      await db
        .update(atelierEmployees)
        .set(update)
        .where(and(eq(atelierEmployees.id, person.id), eq(atelierEmployees.orgId, me.orgId)));
      // Keep the linked login row in sync for identity fields (mirrors the
      // dedicated /title route's sync behaviour).
      const emp = raw as unknown as typeof atelierEmployees.$inferSelect;
      const userSync: Record<string, unknown> = {};
      if ("title" in update) userSync.title = update.title;
      if ("fullName" in update) userSync.name = update.fullName;
      // Task #538 — keep login-row initials in step with the new name.
      if (pendingStructured && ("fullName" in update || structuredChanged)) {
        userSync.name = composeFullName(pendingStructured);
        userSync.initials = computeInitials(pendingStructured);
      }
      if (Object.keys(userSync).length > 0 && emp.userId) {
        userSync.updatedAt = new Date();
        await db
          .update(atelierUsers)
          .set(userSync)
          .where(and(eq(atelierUsers.id, emp.userId), eq(atelierUsers.orgId, emp.orgId)));
      }
    } else if (person.workerType === "contractor") {
      await db
        .update(atelierContractors)
        .set(update)
        .where(and(eq(atelierContractors.id, person.id), eq(atelierContractors.orgId, me.orgId)));
    } else {
      await db
        .update(atelierPartnerFirmResources)
        .set(update)
        .where(
          and(
            eq(atelierPartnerFirmResources.id, person.id),
            eq(atelierPartnerFirmResources.orgId, me.orgId),
          ),
        );
    }

    // Task #628 — best-effort M365 display-name sync when the person's
    // name changed and a Microsoft account is linked (fire-and-forget).
    if (
      (person.workerType === "employee" || person.workerType === "contractor") &&
      changes.some((c) =>
        ["fullName", "firstName", "lastName", "middleName", "preferredName", "honorific"].includes(c.field),
      )
    ) {
      syncMsDisplayName({ orgId: me.orgId, personIds: [person.id] });
    }

    assertAuditAction("roster.person.updated");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "person",
      entityId: person.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name ?? me.id,
      action: "roster.person.updated",
      payload: {
        workerType: person.workerType,
        change: "profile",
        changes,
      },
      payloadSummary: `${me.name ?? me.id} edited ${person.fullName}'s profile (${changes
        .map((c) => c.field)
        .join(", ")})`,
    });
    const updated = await getPerson(person.id, canSeeComp(me.role));
    res.json({ person: updated, changes });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Task #660 — payroll linkage edit surface. Statutory payroll runs
// (Task #655) refuse to post while an active employee is missing a legal
// entity link, annual base comp, base currency, start date or nationality.
// These pay fields are deliberately locked out of the general Edit Person
// PATCH; this dedicated route is their "finance flow", gated to the people
// editors (founding_partner | hr) plus finance (who run payroll).
// -----------------------------------------------------------------

function canEditPayrollFields(role: string | undefined | null): boolean {
  return canEditPeople(role) || isFinance(role);
}

// Task #660 — active legal entities for the payroll-entity picker.
// @cli-skip: UI support read for the payroll fields form
router.get("/roster/legal-entities", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canEditPayrollFields(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const rows = await db
      .select({
        id: atelierLegalEntities.id,
        legalNameEn: atelierLegalEntities.legalNameEn,
        shortName: atelierLegalEntities.shortName,
        country: atelierLegalEntities.country,
        baseCurrency: atelierLegalEntities.baseCurrency,
      })
      .from(atelierLegalEntities)
      .where(and(eq(atelierLegalEntities.orgId, me.orgId), eq(atelierLegalEntities.status, "active")));
    const entities = rows
      .map((e) => ({
        id: e.id,
        name: e.shortName || e.legalNameEn,
        legalNameEn: e.legalNameEn,
        country: e.country,
        baseCurrency: e.baseCurrency || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ entities });
  } catch (err) {
    next(err);
  }
});

const payrollEditSchema = z
  .object({
    legalEntityId: z.string().trim().min(1).max(80).nullable(),
    baseCompensation: z.number().positive().finite().nullable(),
    baseCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "ISO 4217 code")
      .transform((s) => s.toUpperCase())
      .nullable(),
    basicWageMonthly: z.number().positive().finite().nullable(),
    housingAllowanceMonthly: z.number().min(0).finite().nullable(),
    schemeRegisteredOn: zIsoDate,
    // Task #1136 — WPS identifiers (audited payroll write path; IBAN/SWIFT
    // stay exclusively on the HR-approved bank-change flow, NOT here).
    mohrePersonId: z
      .string()
      .trim()
      .regex(/^\d{14}$/, "14-digit MOHRE Person ID / labour card number")
      .nullable(),
    bankRoutingCode: z
      .string()
      .trim()
      .regex(/^\d{9}$/, "9-digit UAE agent-bank routing code")
      .nullable(),
    // Task #1135 — comp-change provenance (not employee columns).
    effectiveFrom: zIsoDate,
    reason: z.enum(["promotion", "raise", "adjustment", "correction"]),
    changeNote: z.string().trim().max(500),
  })
  .partial()
  .strict();

/**
 * Task #660/#1137 — shared audited payroll-write core.
 *
 * The single sanctioned mutation of the four comp fields (+ legal-entity
 * link). Both the payroll PATCH route and the contract-salary proposal
 * approve route go through here so the audited write semantics
 * (roster.person.updated / change:"payroll" + field-by-field changes) can
 * never drift between surfaces. `extraPayload` lets the salary-approve path
 * attach its contract/proposal provenance.
 *
 * Returns a typed result; the caller maps it to HTTP. NEVER writes when the
 * person is missing or not an employee (fail-loud 404/422).
 */
export type ApplyPayrollResult =
  | { ok: false; code: "person-not-found" | "employee-only" | "legal-entity-not-found" }
  | {
      ok: false;
      code: "no-change";
      changes: Array<{ field: string; from: unknown; to: unknown }>;
    }
  | { ok: true; changes: Array<{ field: string; from: unknown; to: unknown }> };

export async function applyPayrollUpdate(args: {
  orgId: string;
  personId: string;
  actor: { id: string; name: string | null };
  patch: Record<string, unknown>;
  extraPayload?: Record<string, unknown>;
  summaryPrefix?: string;
  /**
   * Task #1135 — comp-change provenance. When comp fields change, an
   * effective-dated history record is written alongside the audit event so
   * the payroll run can split mid-month raises and EOSB can use the wage
   * in effect. Defaults: effectiveFrom = today, reason = "adjustment".
   */
  compMeta?: { effectiveFrom?: string | null; reason?: string | null; note?: string | null };
}): Promise<ApplyPayrollResult> {
  const [row] = await db
    .select()
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, args.personId), eq(atelierEmployees.orgId, args.orgId)))
    .limit(1);
  if (!row) return { ok: false, code: "person-not-found" };
  const raw = row as unknown as Record<string, unknown>;

  let entityRow: typeof atelierLegalEntities.$inferSelect | null = null;
  if ("legalEntityId" in args.patch && args.patch.legalEntityId != null) {
    const [ent] = await db
      .select()
      .from(atelierLegalEntities)
      .where(
        and(
          eq(atelierLegalEntities.id, String(args.patch.legalEntityId)),
          eq(atelierLegalEntities.orgId, args.orgId),
          eq(atelierLegalEntities.status, "active"),
        ),
      )
      .limit(1);
    if (!ent) return { ok: false, code: "legal-entity-not-found" };
    entityRow = ent;
  }

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.patch)) {
    const before = raw[k] ?? null;
    const after = v ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    update[k] = v;
    changes.push({ field: k, from: before, to: after });
  }
  if (entityRow && "legalEntityId" in update) {
    const mirror = entityRow.shortName || entityRow.legalNameEn;
    if ((raw.employingEntity ?? null) !== mirror) {
      update.employingEntity = mirror;
      changes.push({ field: "employingEntity", from: raw.employingEntity ?? null, to: mirror });
    }
  }
  if (changes.length === 0) return { ok: false, code: "no-change", changes: [] };

  update.updatedAt = new Date();
  await db
    .update(atelierEmployees)
    .set(update)
    .where(and(eq(atelierEmployees.id, args.personId), eq(atelierEmployees.orgId, args.orgId)));

  assertAuditAction("roster.person.updated");
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "person",
    entityId: args.personId,
    actorType: "user",
    actorId: args.actor.id,
    actorLabel: args.actor.name ?? args.actor.id,
    action: "roster.person.updated",
    payload: {
      workerType: "employee",
      change: "payroll",
      changes,
      ...(args.extraPayload ?? {}),
    },
    payloadSummary: `${args.summaryPrefix ?? `${args.actor.name ?? args.actor.id} updated payroll fields for ${row.fullName}`} (${changes
      .map((c) => c.field)
      .join(", ")})`,
  });

  // Task #1135 — effective-dated comp-change history for the payroll run.
  const COMP_FIELDS = ["baseCompensation", "baseCurrency", "basicWageMonthly", "housingAllowanceMonthly"];
  if (changes.some((c) => COMP_FIELDS.includes(c.field))) {
    const [after] = await db
      .select()
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, args.personId), eq(atelierEmployees.orgId, args.orgId)))
      .limit(1);
    if (after?.baseCompensation && after.baseCurrency) {
      // First change ever → also record the PRIOR package as the baseline
      // ("initial", effective from the start date) so the run engine can
      // value pre-change days of a mid-month raise correctly.
      const [prior] = await db
        .select({ id: atelierCompChanges.id })
        .from(atelierCompChanges)
        .where(and(eq(atelierCompChanges.orgId, args.orgId), eq(atelierCompChanges.employeeId, args.personId)))
        .limit(1);
      if (!prior && typeof raw.baseCompensation === "number" && raw.baseCompensation > 0) {
        await db.insert(atelierCompChanges).values({
          id: rid("compchg"),
          orgId: args.orgId,
          employeeId: args.personId,
          effectiveFrom: (raw.startDate as string | null) ?? "1970-01-01",
          baseCompensation: raw.baseCompensation as number,
          baseCurrency: (raw.baseCurrency as string | null) ?? "USD",
          basicWageMonthly: (raw.basicWageMonthly as number | null) ?? null,
          housingAllowanceMonthly: (raw.housingAllowanceMonthly as number | null) ?? null,
          reason: "initial",
          note: "Baseline package recorded with the first comp change",
          createdByUserId: args.actor.id,
        });
      }
      await db.insert(atelierCompChanges).values({
        id: rid("compchg"),
        orgId: args.orgId,
        employeeId: args.personId,
        effectiveFrom: args.compMeta?.effectiveFrom || new Date().toISOString().slice(0, 10),
        baseCompensation: after.baseCompensation,
        baseCurrency: after.baseCurrency,
        basicWageMonthly: after.basicWageMonthly,
        housingAllowanceMonthly: after.housingAllowanceMonthly,
        reason: args.compMeta?.reason || "adjustment",
        note: args.compMeta?.note ?? null,
        createdByUserId: args.actor.id,
      });
    }
  }
  return { ok: true, changes };
}

// @cli-skip: UI-workflow write; comp data — CLI exposure needs confirm-flow capability design
router.patch("/roster/people/:id/payroll", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canEditPayrollFields(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const person = await getPerson(req.params.id, true);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    if (person.workerType !== "employee") {
      res.status(422).json({
        error: "employee-only",
        hint: "Payroll fields apply to employees; contractors are paid via day rates.",
      });
      return;
    }
    const parsed = payrollEditSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(422).json({
        error: "invalid-body",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { effectiveFrom, reason, changeNote, ...rest } = parsed.data;
    const patch = rest as Record<string, unknown>;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no-updatable-fields" });
      return;
    }

    const result = await applyPayrollUpdate({
      orgId: me.orgId,
      personId: person.id,
      actor: { id: me.id, name: me.name },
      patch,
      compMeta: { effectiveFrom: effectiveFrom ?? null, reason: reason ?? null, note: changeNote ?? null },
    });
    if (!result.ok && result.code === "person-not-found") {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    if (!result.ok && result.code === "legal-entity-not-found") {
      res.status(422).json({ error: "legal-entity-not-found" });
      return;
    }
    if (!result.ok && result.code === "no-change") {
      res.json({ person: await getPerson(person.id, canSeeComp(me.role)), changes: [] });
      return;
    }
    const updated = await getPerson(person.id, canSeeComp(me.role));
    res.json({ person: updated, changes: result.ok ? result.changes : [] });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Task #1137 — contract salary proposals (review + decide).
//
// Proposals are produced by the extractor from SIGNED employment contracts;
// they never touch payroll until an authorised reviewer approves. All
// surfaces here share the payroll-editor gate (people editors + finance).
// -----------------------------------------------------------------

/** Latest APPROVED proposal for an employee (drives the drift flag). */
export async function latestApprovedSalaryProposal(
  orgId: string,
  personId: string,
): Promise<typeof atelierContractSalaryProposals.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(atelierContractSalaryProposals)
    .where(
      and(
        eq(atelierContractSalaryProposals.orgId, orgId),
        eq(atelierContractSalaryProposals.personId, personId),
        eq(atelierContractSalaryProposals.status, "approved"),
      ),
    )
    .orderBy(desc(atelierContractSalaryProposals.decidedAt))
    .limit(1);
  return row ?? null;
}

/**
 * compDiffersFromContract — computed at read time against the latest approved
 * proposal's RESOLVED approved values (approvedValues), NOT appliedChanges.
 *
 * approvedValues records every comp field that was approved — including fields
 * that were a no-op at approval time (current payroll already matched the
 * extracted/overridden value). appliedChanges omits those, so comparing
 * against it would miss a later manual edit of a then-unchanged field. Using
 * approvedValues as the baseline makes any subsequent divergence surface as
 * drift.
 *
 * null when there is no approved proposal (or it carries no comp baseline);
 * true/false otherwise.
 */
export async function computeCompDrift(
  orgId: string,
  personId: string,
): Promise<boolean | null> {
  const proposal = await latestApprovedSalaryProposal(orgId, personId);
  if (!proposal) return null;
  const compFields = [
    "baseCompensation",
    "baseCurrency",
    "basicWageMonthly",
    "housingAllowanceMonthly",
  ] as const;
  const approved = (proposal.approvedValues ?? {}) as Record<string, unknown>;
  const baseline = compFields.filter((f) => f in approved);
  if (baseline.length === 0) return null;
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, personId), eq(atelierEmployees.orgId, orgId)))
    .limit(1);
  if (!emp) return null;
  const raw = emp as unknown as Record<string, unknown>;
  for (const f of baseline) {
    if (JSON.stringify(raw[f] ?? null) !== JSON.stringify(approved[f] ?? null)) {
      return true;
    }
  }
  return false;
}

// @cli-skip: UI-workflow read; payroll-adjacent review queue
router.get("/roster/salary-proposals", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canEditPayrollFields(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const statusFilter =
      typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.trim()
        : null;
    const where = statusFilter
      ? and(
          eq(atelierContractSalaryProposals.orgId, me.orgId),
          eq(atelierContractSalaryProposals.status, statusFilter),
        )
      : eq(atelierContractSalaryProposals.orgId, me.orgId);
    const rows = await db
      .select({
        p: atelierContractSalaryProposals,
        contractTitle: atelierContractRecords.title,
        contractType: atelierContractRecords.contractType,
      })
      .from(atelierContractSalaryProposals)
      .leftJoin(
        atelierContractRecords,
        eq(atelierContractSalaryProposals.contractId, atelierContractRecords.id),
      )
      .where(where)
      .orderBy(desc(atelierContractSalaryProposals.createdAt));

    const proposals = [];
    for (const { p, contractTitle, contractType } of rows) {
      const [emp] = await db
        .select({
          id: atelierEmployees.id,
          fullName: atelierEmployees.fullName,
          status: atelierEmployees.status,
          baseCompensation: atelierEmployees.baseCompensation,
          baseCurrency: atelierEmployees.baseCurrency,
          basicWageMonthly: atelierEmployees.basicWageMonthly,
          housingAllowanceMonthly: atelierEmployees.housingAllowanceMonthly,
        })
        .from(atelierEmployees)
        .where(and(eq(atelierEmployees.id, p.personId), eq(atelierEmployees.orgId, me.orgId)))
        .limit(1);
      proposals.push({
        id: p.id,
        contractId: p.contractId,
        contractTitle: contractTitle ?? null,
        contractType: contractType ?? null,
        personId: p.personId,
        personName: emp?.fullName ?? null,
        personStatus: emp?.status ?? null,
        status: p.status,
        source: p.source,
        extracted: p.extracted ?? null,
        snippets: p.sourceSnippets ?? null,
        error: p.error ?? null,
        current: emp
          ? {
              baseCompensation: emp.baseCompensation ?? null,
              baseCurrency: emp.baseCurrency ?? null,
              basicWageMonthly: emp.basicWageMonthly ?? null,
              housingAllowanceMonthly: emp.housingAllowanceMonthly ?? null,
            }
          : null,
        appliedChanges: p.appliedChanges ?? null,
        decidedByLabel: p.decidedByLabel ?? null,
        decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
        decisionNote: p.decisionNote ?? null,
        createdAt: p.createdAt.toISOString(),
      });
    }
    res.json({ proposals });
  } catch (err) {
    next(err);
  }
});

// Approve overrides — the four comp fields only (subset of payrollEditSchema).
const salaryApproveSchema = z
  .object({
    baseCompensation: z.number().positive().finite().nullable(),
    baseCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "ISO 4217 code")
      .transform((s) => s.toUpperCase())
      .nullable(),
    basicWageMonthly: z.number().positive().finite().nullable(),
    housingAllowanceMonthly: z.number().min(0).finite().nullable(),
    decisionNote: z.string().trim().max(2000).optional(),
  })
  .partial()
  .strict();

// @cli-skip: UI-workflow write; payroll write via proposal — CLI exposure needs confirm-flow design
router.post("/roster/salary-proposals/:id/approve", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canEditPayrollFields(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const parsed = salaryApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(422).json({
        error: "invalid-body",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { decisionNote, ...overrides } = parsed.data as Record<string, unknown> & {
      decisionNote?: string;
    };

    // Read (unclaimed) to validate the employee + build the patch. The
    // authoritative pending→approved claim happens below via a conditional
    // UPDATE, so two concurrent approvers can never both apply payroll.
    const [proposal] = await db
      .select()
      .from(atelierContractSalaryProposals)
      .where(
        and(
          eq(atelierContractSalaryProposals.id, req.params.id),
          eq(atelierContractSalaryProposals.orgId, me.orgId),
        ),
      )
      .limit(1);
    if (!proposal) {
      res.status(404).json({ error: "proposal-not-found" });
      return;
    }
    if (proposal.status !== "pending") {
      res.status(409).json({
        error: "not-pending",
        message: `Proposal is ${proposal.status}; only pending proposals can be approved.`,
      });
      return;
    }

    // Employee must still exist and be active — fail loud otherwise.
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.id, proposal.personId),
          eq(atelierEmployees.orgId, me.orgId),
          isNull(atelierEmployees.deletedAt),
        ),
      )
      .limit(1);
    if (!emp) {
      res.status(422).json({ error: "employee-gone" });
      return;
    }
    if (emp.status && emp.status !== "active") {
      res.status(422).json({
        error: "employee-inactive",
        message: `Employee is ${emp.status}; reactivate before applying contract salary.`,
      });
      return;
    }

    // Build the comp patch with PARTIAL-override semantics:
    //  - a field present in the body (incl. explicit null) is used verbatim
    //    (explicit null = deliberate clear);
    //  - a field absent from the body falls back to the extracted value ONLY
    //    when the proposal extracted a non-null value for it;
    //  - a field that is absent from BOTH the body and the extraction is
    //    NEVER written (existing payroll values are never null-cleared).
    // zod .partial() drops absent keys but keeps explicit-null keys, so
    // `f in overrides` is the precise "present in body" test.
    const extracted = (proposal.extracted ?? {}) as Record<string, unknown>;
    const compFields = [
      "baseCompensation",
      "baseCurrency",
      "basicWageMonthly",
      "housingAllowanceMonthly",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const f of compFields) {
      if (f in overrides) patch[f] = overrides[f];
      else if (extracted[f] != null) patch[f] = extracted[f];
    }
    if (Object.keys(patch).length === 0) {
      res.status(422).json({ error: "nothing-to-apply" });
      return;
    }

    // ATOMIC CLAIM: flip pending→approved conditionally FIRST. Only the
    // winner gets a row back; a concurrent approver sees 0 rows → 409. This
    // guarantees the payroll write below runs at most once per proposal.
    const now = new Date();
    const claimed = await db
      .update(atelierContractSalaryProposals)
      .set({
        status: "approved",
        decidedBy: me.id,
        decidedByLabel: me.name ?? me.id,
        decidedAt: now,
        decisionNote: decisionNote ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(atelierContractSalaryProposals.id, proposal.id),
          eq(atelierContractSalaryProposals.status, "pending"),
        ),
      )
      .returning({ id: atelierContractSalaryProposals.id });
    if (claimed.length === 0) {
      res.status(409).json({
        error: "not-pending",
        message: "Proposal was already decided by a concurrent request.",
      });
      return;
    }

    // We own the claim — apply payroll. If the employee vanished between the
    // read and here, roll the claim back to pending so it can be retried.
    const result = await applyPayrollUpdate({
      orgId: me.orgId,
      personId: proposal.personId,
      actor: { id: me.id, name: me.name },
      patch,
      extraPayload: {
        source: "contract_salary_proposal",
        contractId: proposal.contractId,
        proposalId: proposal.id,
      },
      summaryPrefix: `${me.name ?? me.id} applied contract-sourced salary for ${emp.fullName} (contract ${proposal.contractId}, proposal ${proposal.id})`,
    });
    if (!result.ok && result.code === "person-not-found") {
      await db
        .update(atelierContractSalaryProposals)
        .set({ status: "pending", decidedBy: null, decidedByLabel: null, decidedAt: null, updatedAt: new Date() })
        .where(eq(atelierContractSalaryProposals.id, proposal.id));
      res.status(422).json({ error: "employee-gone" });
      return;
    }
    if (!result.ok && result.code === "legal-entity-not-found") {
      await db
        .update(atelierContractSalaryProposals)
        .set({ status: "pending", decidedBy: null, decidedByLabel: null, decidedAt: null, updatedAt: new Date() })
        .where(eq(atelierContractSalaryProposals.id, proposal.id));
      res.status(422).json({ error: "legal-entity-not-found" });
      return;
    }
    // appliedChanges reflects EXACTLY what the payroll write persisted (the
    // fields that actually changed). approvedValues is the RESOLVED approved
    // patch — every field we approved (incl. ones that were a no-op at
    // approval time) — and is the drift baseline computeCompDrift compares
    // against, so a later manual edit of a then-unchanged field still drifts.
    const appliedChanges = result.ok
      ? result.changes
      : result.code === "no-change"
        ? result.changes
        : [];
    await db
      .update(atelierContractSalaryProposals)
      .set({ appliedChanges, approvedValues: patch, updatedAt: new Date() })
      .where(eq(atelierContractSalaryProposals.id, proposal.id));

    assertAuditAction("contract.salary.proposal_approved");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "contract_salary_proposal",
      entityId: proposal.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name ?? me.id,
      action: "contract.salary.proposal_approved",
      payload: {
        contractId: proposal.contractId,
        personId: proposal.personId,
        source: proposal.source,
        appliedChanges,
        decisionNote: decisionNote ?? null,
      },
      payloadSummary: `${me.name ?? me.id} approved contract salary proposal for ${emp.fullName}`,
    });

    res.json({
      proposal: { id: proposal.id, status: "approved", appliedChanges },
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: UI-workflow write; proposal decision
router.post("/roster/salary-proposals/:id/reject", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canEditPayrollFields(me.role)) {
      res.status(403).json({ error: "person-edit-restricted" });
      return;
    }
    const note =
      typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : null;
    const [proposal] = await db
      .select()
      .from(atelierContractSalaryProposals)
      .where(
        and(
          eq(atelierContractSalaryProposals.id, req.params.id),
          eq(atelierContractSalaryProposals.orgId, me.orgId),
        ),
      )
      .limit(1);
    if (!proposal) {
      res.status(404).json({ error: "proposal-not-found" });
      return;
    }
    if (proposal.status !== "pending") {
      res.status(409).json({
        error: "not-pending",
        message: `Proposal is ${proposal.status}; only pending proposals can be rejected.`,
      });
      return;
    }
    // ATOMIC CLAIM: conditional pending→rejected so a concurrent decision
    // (approve or reject) can't double-fire.
    const now = new Date();
    const claimed = await db
      .update(atelierContractSalaryProposals)
      .set({
        status: "rejected",
        decidedBy: me.id,
        decidedByLabel: me.name ?? me.id,
        decidedAt: now,
        decisionNote: note,
        updatedAt: now,
      })
      .where(
        and(
          eq(atelierContractSalaryProposals.id, proposal.id),
          eq(atelierContractSalaryProposals.status, "pending"),
        ),
      )
      .returning({ id: atelierContractSalaryProposals.id });
    if (claimed.length === 0) {
      res.status(409).json({
        error: "not-pending",
        message: "Proposal was already decided by a concurrent request.",
      });
      return;
    }

    assertAuditAction("contract.salary.proposal_rejected");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "contract_salary_proposal",
      entityId: proposal.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name ?? me.id,
      action: "contract.salary.proposal_rejected",
      payload: {
        contractId: proposal.contractId,
        personId: proposal.personId,
        decisionNote: note,
      },
      payloadSummary: `${me.name ?? me.id} rejected contract salary proposal ${proposal.id}`,
    });
    res.json({ proposal: { id: proposal.id, status: "rejected" } });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — manager-scoped detail: full viewers get the (sensitive-
    // stripped) dossier; managers get a business-only wire for their tree.
    const person = await ensureRosterViewAccess(me, req.params.id, res);
    if (!person) return;
    const full = hasFullRosterView(me.role);
    // Task #1137 — drift flag for the payroll editor: does current roster
    // comp differ from the latest approved contract-salary proposal's applied
    // values? null when no approved proposal / not comp-visible / not an
    // employee. Computed at read time.
    const compDiffersFromContract =
      full && canSeeComp(me.role) && person.workerType === "employee"
        ? await computeCompDrift(me.orgId, person.id)
        : null;
    res.json({
      person,
      compDiffersFromContract,
      viewerCanSeeComp: full && canSeeComp(me.role),
      // Task #221 — drives the sensitive tabs (personal / documents / HR
      // notes) in the roster UI; mirrors canViewSensitivePeopleData.
      viewerCanSeeSensitive: canViewSensitivePeopleData(me.role),
      // Task #189 — drives the title-edit affordance in the roster UI;
      // must mirror the gate on PATCH /roster/people/:id/title.
      viewerCanEditTitle: isHr(me.role) || isFoundingPartner(me.role),
      // Task #199/#221 — drives the full Edit Person affordance; must
      // mirror the gate on PATCH /roster/people/:id (founding_partner | hr).
      viewerCanEdit: canEditPeople(me.role),
      viewerScope: full ? "full" : "reports",
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/engagements", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await ensureRosterViewAccess(me, req.params.id, res);
    if (!person) return;
    const userId = await resolveLinkedUserId(person);
    if (!userId) {
      res.json({ engagements: [] });
      return;
    }
    const rows = await db
      .select({
        id: atelierEngagementAccess.id,
        engagementId: atelierEngagementAccess.engagementId,
        engagementName: atelierEngagements.name,
        accountName: atelierAccounts.name,
        plmStage: atelierEngagements.plmStage,
        roleOnEngagement: atelierEngagementAccess.roleOnEngagement,
        allocationPct: atelierEngagementAccess.allocationPct,
        scope: atelierEngagementAccess.scope,
        status: atelierEngagementAccess.status,
        grantedAt: atelierEngagementAccess.grantedAt,
        endDate: atelierEngagementAccess.endDate,
      })
      .from(atelierEngagementAccess)
      .leftJoin(
        atelierEngagements,
        eq(atelierEngagementAccess.engagementId, atelierEngagements.id),
      )
      .leftJoin(
        atelierAccounts,
        eq(atelierEngagements.accountId, atelierAccounts.id),
      )
      .where(eq(atelierEngagementAccess.userId, userId))
      .orderBy(desc(atelierEngagementAccess.grantedAt));
    res.json({
      engagements: rows.map((r) => ({
        ...r,
        grantedAt: r.grantedAt?.toISOString() ?? null,
        endDate: r.endDate?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/access", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await ensureRosterViewAccess(me, req.params.id, res);
    if (!person) return;
    const userId = await resolveLinkedUserId(person);
    if (!userId) {
      res.json({
        person: { id: person.id, fullName: person.fullName },
        grants: [],
        hint: "Person has no linked atelier_users login row.",
      });
      return;
    }
    const [linkedUser] = await db
      .select({ role: atelierUsers.role })
      .from(atelierUsers)
      .where(eq(atelierUsers.id, userId))
      .limit(1);
    const userRole = linkedUser?.role ?? null;
    // Founding partners / partners have firm-wide access by role — the
    // engagement-grant ledger is irrelevant for them, so surface an explicit
    // firm-wide marker (matching the Access matrix) instead of "no grants".
    const firmWide = userRole === "founding_partner" || userRole === "partner";
    const grants = await db
      .select({
        id: atelierEngagementAccess.id,
        engagementId: atelierEngagementAccess.engagementId,
        engagementName: atelierEngagements.name,
        roleOnEngagement: atelierEngagementAccess.roleOnEngagement,
        allocationPct: atelierEngagementAccess.allocationPct,
        scope: atelierEngagementAccess.scope,
        status: atelierEngagementAccess.status,
      })
      .from(atelierEngagementAccess)
      .leftJoin(
        atelierEngagements,
        eq(atelierEngagementAccess.engagementId, atelierEngagements.id),
      )
      .where(
        and(
          eq(atelierEngagementAccess.userId, userId),
          eq(atelierEngagementAccess.status, "active"),
          isNull(atelierEngagementAccess.deletedAt),
        ),
      );
    res.json({
      person: { id: person.id, fullName: person.fullName, workerType: person.workerType },
      role: userRole,
      firmWide,
      scopeNote:
        userRole === "senior_manager"
          ? "All accounts; assigned opportunities & engagements"
          : null,
      grants,
    });
  } catch (err) {
    next(err);
  }
});

// Task #51 — HR parity view of self-service personal data: dependents,
// emergency contacts and the self-editable contact fields. Gated
// owner-or-personnel-contract exactly like the documents surface.
// @cli-skip: HR read-parity personal-data view (Task #51)
router.get("/roster/people/:id/personal", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const ownerUserId = await resolveLinkedUserId(person);
    const isSelf = !!ownerUserId && ownerUserId === me.id;
    if (!isSelf && !canViewPersonnelContract(me.role)) {
      res.status(403).json({ error: "personnel-contract-forbidden" });
      return;
    }
    const [deps, contacts] = await Promise.all([
      db
        .select()
        .from(atelierDependents)
        .where(
          and(
            eq(atelierDependents.personType, person.workerType),
            eq(atelierDependents.personId, person.id),
            isNull(atelierDependents.deletedAt),
          ),
        )
        .orderBy(desc(atelierDependents.createdAt)),
      db
        .select()
        .from(atelierEmergencyContacts)
        .where(
          and(
            eq(atelierEmergencyContacts.personType, person.workerType),
            eq(atelierEmergencyContacts.personId, person.id),
            isNull(atelierEmergencyContacts.deletedAt),
          ),
        )
        .orderBy(desc(atelierEmergencyContacts.createdAt)),
    ]);
    // Fetch the raw row for the self-editable fields not on PersonWire.
    let raw: Record<string, unknown> = {};
    if (person.workerType === "employee") {
      const [row] = await db
        .select()
        .from(atelierEmployees)
        .where(eq(atelierEmployees.id, person.id));
      raw = (row ?? {}) as Record<string, unknown>;
    } else if (person.workerType === "contractor") {
      const [row] = await db
        .select()
        .from(atelierContractors)
        .where(eq(atelierContractors.id, person.id));
      raw = (row ?? {}) as Record<string, unknown>;
    }
    res.json({
      person: {
        id: person.id,
        fullName: person.fullName,
        workerType: person.workerType,
        personalEmail: (raw.personalEmail as string | null) ?? null,
        cellPhones: (raw.cellPhones as unknown[] | null) ?? [],
        homeAddress: (raw.homeAddress as string | null) ?? null,
        officeAddress: (raw.officeAddress as string | null) ?? null,
        bio: (raw.bio as string | null) ?? null,
        nationality: (raw.nationality as string | null) ?? null,
      },
      dependents: deps.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        relationship: d.relationship,
        dateOfBirth: d.dateOfBirth ?? null,
        nationality: d.nationality ?? null,
        notes: d.notes ?? null,
      })),
      emergencyContacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        relationship: c.relationship,
        phones: (c.phones ?? []) as string[],
        email: c.email ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/documents", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    // Task #293 — personnel-contract sensitivity. The DB view
    // `atelier_person_documents_v` masks file_url/file_ref/notes for
    // non-viewers; here we additionally hard-gate the list endpoint to
    // personnel-contract roles or the document owner themself.
    const ownerUserId = await resolveLinkedUserId(person);
    const isSelf = !!ownerUserId && ownerUserId === me.id;
    if (!isSelf && !canViewPersonnelContract(me.role)) {
      res.status(403).json({ error: "personnel-contract-forbidden" });
      return;
    }
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
    // Task #254 round-10 — return list metadata + a short-lived signed
    // download URL. Real object-storage streaming lands in #255; for now
    // we emit a tokenized URL whose contract (HMAC + expiry) is stable so
    // the frontend wiring does not change later.
    res.json({
      documents: docs.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        uploadedAt: d.uploadedAt.toISOString(),
        expiresAt: d.expiresAt?.toISOString() ?? null,
        downloadUrl: `/api/atelier/roster/people/${person.id}/documents/${d.id}/download?${signDocToken(person.id, d.id, me.id)}`,
        // Task #531 — national ID cards can carry a labeled back-side scan.
        // `sides` tells HR what is on file (combined = one PDF for both).
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
        backDownloadUrl: d.backFileRef
          ? `/api/atelier/roster/people/${person.id}/documents/${d.id}/download?${signDocToken(person.id, d.id, me.id)}&side=back`
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Signed document download — Task #254 (PRD §2.1, §6 doc surface).
// HMAC-signed, short-lived (5min), persona-bound URLs. The handler
// re-validates the token, the persona, and the doc ownership, then
// streams the file (placeholder until #255 wires real object storage).
// -----------------------------------------------------------------
const DOC_TOKEN_TTL_MS = 5 * 60 * 1000;
function docTokenSecret(): string {
  // Task #254 round-11 — fail-closed in non-development. The dev fallback
  // is gated on NODE_ENV !== "production" so a misconfigured deploy can
  // never mint forgeable HMAC tokens for sensitive HR documents.
  const fromEnv = process.env.ATELIER_DOC_TOKEN_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ATELIER_DOC_TOKEN_SECRET is required in production (>=16 chars)",
    );
  }
  return "atelier-dev-doc-secret-do-not-use-in-prod";
}
function signDocToken(personId: string, docId: string, personaId: string): string {
  const exp = Date.now() + DOC_TOKEN_TTL_MS;
  const payload = `${personId}|${docId}|${personaId}|${exp}`;
  const sig = createHmac("sha256", docTokenSecret()).update(payload).digest("hex");
  return `exp=${exp}&p=${encodeURIComponent(personaId)}&sig=${sig}`;
}
function verifyDocToken(
  personId: string,
  docId: string,
  exp: string | undefined,
  personaId: string | undefined,
  sig: string | undefined,
): boolean {
  if (!exp || !personaId || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const payload = `${personId}|${docId}|${personaId}|${expNum}`;
  const expected = createHmac("sha256", docTokenSecret()).update(payload).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/documents/:docId/download", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const exp = typeof req.query.exp === "string" ? req.query.exp : undefined;
    const personaParam = typeof req.query.p === "string" ? req.query.p : undefined;
    const sig = typeof req.query.sig === "string" ? req.query.sig : undefined;
    if (personaParam !== me.id) {
      res.status(403).json({ error: "doc-token-persona-mismatch" });
      return;
    }
    if (!verifyDocToken(req.params.id, req.params.docId, exp, personaParam, sig)) {
      res.status(403).json({ error: "doc-token-invalid-or-expired" });
      return;
    }
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    // Task #293 — gate the streamed download identically to the list view.
    const ownerUserId = await resolveLinkedUserId(person);
    const isSelf = !!ownerUserId && ownerUserId === me.id;
    if (!isSelf && !canViewPersonnelContract(me.role)) {
      res.status(403).json({ error: "personnel-contract-forbidden" });
      return;
    }
    const [doc] = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.id, req.params.docId),
          eq(atelierPersonDocuments.personId, person.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    // Task #531 — `?side=back` streams the back of a national ID card.
    const side = String(req.query.side ?? "front");
    if (side !== "front" && side !== "back") {
      res.status(400).json({ error: "invalid-side", allowed: ["front", "back"] });
      return;
    }
    assertAuditAction("document.downloaded");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "person_document",
      entityId: doc.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name,
      action: "document.downloaded",
      payload: { personId: person.id, docId: doc.id, kind: doc.kind, side },
      payloadSummary: `${me.name} downloaded ${doc.kind} document for ${person.fullName}`,
    });
    if (side === "back") {
      if (!doc.backFileRef || !doc.backFileRef.startsWith(PERSON_DOC_PREFIX)) {
        res.status(404).json({ error: "no-file" });
        return;
      }
      const bytes = await loadPersonDocBytes(doc.backFileRef);
      if (!bytes) {
        res.status(404).json({ error: "file-missing" });
        return;
      }
      res.setHeader("Content-Type", doc.backMime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        contentDispositionFilename("attachment", doc.backFileName || "document-back"),
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.send(bytes);
      return;
    }
    // Task #51 — self-uploaded scans live in private object storage under
    // a `persondoc:` fileRef; stream those bytes directly.
    if (doc.fileRef && doc.fileRef.startsWith(PERSON_DOC_PREFIX)) {
      const bytes = await loadPersonDocBytes(doc.fileRef);
      if (!bytes) {
        res.status(404).json({ error: "file-missing" });
        return;
      }
      res.setHeader("Content-Type", doc.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        contentDispositionFilename("attachment", doc.fileName || "document"),
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.send(bytes);
      return;
    }
    if (doc.fileUrl) {
      res.redirect(302, doc.fileUrl);
      return;
    }
    // Storage wiring lands in #255; until then return the metadata so the
    // contract is exercised end-to-end. Once object-storage is in place,
    // swap this for a stream / 302 to the resolved object key.
    res.json({
      ok: true,
      placeholder: true,
      doc: { id: doc.id, kind: doc.kind, title: doc.title, fileRef: doc.fileRef },
    });
  } catch (err) {
    next(err);
  }
});

// Task #381 — print-ready business-card download for OTHER people's roster
// pages (HR / partners ordering cards for the whole firm). Gated on the same
// roster visibility predicate as the dossier itself (ensureRosterViewAccess:
// full viewers see everyone, managers their reports tree + self), and audited
// exactly like the self-scope /me/business-card.pdf route. Only public,
// card-safe fields feed the generator.
// @cli-skip: roster-scope generated PDF download; no CLI shape (Task #381)
router.get("/roster/people/:id/business-card.pdf", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rawVariant = String(req.query.variant ?? "standard");
    if (rawVariant !== "standard" && rawVariant !== "print") {
      res.status(400).json({ error: "invalid-variant", allowed: ["standard", "print"] });
      return;
    }
    const variant = rawVariant;
    const person = await ensureRosterViewAccess(me, req.params.id, res);
    if (!person) return;
    const { pdf, filename } = await generateBusinessCardPdf(
      {
        fullName: person.fullName,
        title: person.workerType === "employee" ? (person.title ?? null) : null,
        email: person.email ?? null,
        cellPhones: (person.cellPhones ?? []) as Array<{ country: string; number: string }>,
        officeAddress: person.officeAddress ?? null,
      },
      variant,
    );
    assertAuditAction("document.downloaded");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: person.workerType,
      entityId: person.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name,
      action: "document.downloaded",
      payload: { personId: person.id, kind: "business_card_pdf", self: false, variant },
      payloadSummary: `${me.name} generated ${person.fullName}'s business-card PDF (${variant})`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Task #387 — one-click "download all business cards" bundle for HR /
// founding partners ordering cards for the whole firm. Full-roster viewers
// only (founding_partner | hr | finance — same predicate as the directory
// itself). Bundles PRINT-variant PDFs (bleed + crop marks, what a printer
// needs) for every ACTIVE employee who has at least one card contact field
// (email or a cell number). Skipped people (no contact fields) are listed
// in the audit payload so HR can chase missing data. Single audited event.
// @cli-skip: bulk generated-file download; no CLI shape (Task #387)
router.get("/roster/business-cards.zip", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!hasFullRosterView(me.role)) {
      res.status(403).json({ error: "full-roster-forbidden" });
      return;
    }
    const rows = await db
      .select()
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.orgId, me.orgId),
          eq(atelierEmployees.status, "active"),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    const hasCardContact = (r: typeof atelierEmployees.$inferSelect) =>
      Boolean(r.email?.trim()) ||
      (r.cellPhones ?? []).some((c) => c.number.trim());
    const included = rows
      .filter(hasCardContact)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const skipped = rows
      .filter((r) => !hasCardContact(r))
      .map((r) => ({ personId: r.id, fullName: r.fullName }));
    if (included.length === 0) {
      res.status(404).json({
        error: "no-cardable-employees",
        message:
          "No active employees have business-card contact fields on file.",
        skipped,
      });
      return;
    }
    const zip = new JSZip();
    const usedNames = new Set<string>();
    for (const r of included) {
      const { pdf, filename } = await generateBusinessCardPdf(
        {
          fullName: r.fullName,
          title: r.title ?? null,
          email: r.email ?? null,
          cellPhones: (r.cellPhones ?? []) as Array<{
            country: string;
            number: string;
          }>,
          officeAddress: r.officeAddress ?? null,
        },
        "print",
      );
      // Two "John Smith"s must not overwrite each other inside the zip.
      let entryName = filename;
      if (usedNames.has(entryName)) {
        entryName = `${cardFilenameStem(r.fullName)}_${r.id.slice(-6)}.pdf`;
      }
      usedNames.add(entryName);
      zip.file(entryName, pdf);
    }
    const zipBuf = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    assertAuditAction("document.downloaded");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "employee",
      entityId: "roster_bulk",
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name,
      action: "document.downloaded",
      payload: {
        kind: "business_card_zip",
        variant: "print",
        count: included.length,
        personIds: included.map((r) => r.id),
        skipped,
      },
      payloadSummary: `${me.name} downloaded the business-card bundle (${included.length} print PDFs${skipped.length ? `, ${skipped.length} skipped` : ""})`,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      contentDispositionFilename("attachment", `Cognirise_business_cards_${stamp}.zip`),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(zipBuf);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/audit", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — the per-person audit feed exposes HR/lifecycle activity;
    // restrict to sensitive-people viewers (founding_partner | hr).
    if (!canViewSensitivePeopleData(me.role)) {
      res.status(403).json({ error: "sensitive-people-forbidden" });
      return;
    }
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const userId = await resolveLinkedUserId(person);
    // Per-person audit feed combines:
    //   - rows where entity = the person itself (employee/contractor/partner_firm_resource)
    //   - rows where actor = the linked atelier_users row
    //   - access-grant rows whose entity_id starts with `${engId}:${userId}`
    const personEntityRows = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, person.workerType),
          eq(atelierAuditEvents.entityId, person.id),
        ),
      )
      .orderBy(desc(atelierAuditEvents.ts))
      .limit(100);

    let actorRows: typeof personEntityRows = [];
    let accessRows: typeof personEntityRows = [];
    if (userId) {
      actorRows = await db
        .select()
        .from(atelierAuditEvents)
        .where(eq(atelierAuditEvents.actorId, userId))
        .orderBy(desc(atelierAuditEvents.ts))
        .limit(100);
      accessRows = await db
        .select()
        .from(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "engagement_access"),
            ilike(atelierAuditEvents.entityId, `%:${userId}`),
          ),
        )
        .orderBy(desc(atelierAuditEvents.ts))
        .limit(100);
    }
    const merged = [...personEntityRows, ...actorRows, ...accessRows];
    const seen = new Set<string>();
    const dedup = merged.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    dedup.sort((a, b) => b.ts.getTime() - a.ts.getTime());
    res.json({
      events: dedup.slice(0, 100).map((r) => ({
        id: r.id,
        ts: r.ts.toISOString(),
        actorLabel: r.actorLabel,
        actorType: r.actorType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        payloadSummary: r.payloadSummary,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/access-matrix", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #254 round-9 — Partner|Operations align with the frontend copy
    // ("Partner / Operations only"); both have firm-wide roster scope per
    // PRD §8.1 and need the matrix view to audit grants.
    // Task #254 acceptance — Partner-only per PRD §8.1.
    if ((me.role !== "partner" && me.role !== "founding_partner")) {
      res.status(403).json({ error: "access-matrix-partner-only" });
      return;
    }
    const grants = await db
      .select({
        userId: atelierEngagementAccess.userId,
        userName: atelierUsers.name,
        userRole: atelierUsers.role,
        engagementId: atelierEngagementAccess.engagementId,
        engagementName: atelierEngagements.name,
        accountName: atelierAccounts.name,
        roleOnEngagement: atelierEngagementAccess.roleOnEngagement,
        allocationPct: atelierEngagementAccess.allocationPct,
        scope: atelierEngagementAccess.scope,
        status: atelierEngagementAccess.status,
      })
      .from(atelierEngagementAccess)
      .leftJoin(atelierUsers, eq(atelierEngagementAccess.userId, atelierUsers.id))
      .leftJoin(
        atelierEngagements,
        eq(atelierEngagementAccess.engagementId, atelierEngagements.id),
      )
      .leftJoin(
        atelierAccounts,
        eq(atelierEngagements.accountId, atelierAccounts.id),
      )
      .where(isNull(atelierEngagementAccess.deletedAt));
    res.json({ grants });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/access", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const body = req.body as {
      personId?: string;
      engagementId?: string;
      action?: "grant" | "revoke";
      roleOnEngagement?: string;
      allocationPct?: number;
      scope?: string[];
      endDate?: string | null;
    };
    if (!body.personId || !body.engagementId || !body.action) {
      res.status(400).json({ error: "missing-fields" });
      return;
    }
    const person = await getPerson(body.personId, true);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    // Task #254 round-10 — engagement-scoped authz on the grant/revoke
    // endpoint itself (closes a privilege-escalation path where a per-
    // engagement lead could mutate the access graph for engagements they
    // are not on). Partner-tier + finance/hr retain firm-wide scope.
    // Task #292 — engagement_lead persona is now senior_manager.
    if (me.role === "senior_manager") {
      const eng = await ensureEngAccess(res, me, body.engagementId);
      if (!eng) return;
    }
    const result = await runAccessSentinel({
      actor: me,
      targetPerson: person,
      engagementId: body.engagementId,
      roleOnEngagement: body.roleOnEngagement ?? "member",
      allocationPct: body.allocationPct ?? 0,
      scope: body.scope ?? [],
      endDate: body.endDate ?? null,
      action: body.action,
    });
    if (!result.ok) {
      res.status(result.blocked?.reason === "engagement-not-found" ? 404 : 422).json({
        error: "access-sentinel-blocked",
        ...result.blocked,
      });
      return;
    }
    res.json({ ok: true, grantId: result.grantId });
  } catch (err) {
    next(err);
  }
});

// Conflict disclosures (read-only for this task; full CRUD lands in #255).
// Task #293 — read through atelier_conflict_disclosures_v inside withRls so
// disclosure_text / nature / scope_impact / notes are masked at the DB
// layer for non personnel-contract viewers (HR + leadership + self).
// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/conflicts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await ensureRosterViewAccess(me, req.params.id, res);
    if (!person) return;
    const result = await withRls(req, async (tx) => {
      return tx.execute(sql`
        SELECT id, person_type, person_id, disclosure_text, disclosed_at,
               status, notes, declared_party, nature, scope_impact,
               declared_at, last_reviewed_at
          FROM atelier_conflict_disclosures_v
         WHERE person_type = ${person.workerType}
           AND person_id   = ${person.id}
           AND deleted_at IS NULL
         ORDER BY disclosed_at DESC
      `);
    });
    res.json({ conflicts: result.rows });
  } catch (err) {
    next(err);
  }
});

// =============================================================
// Task #509 — Titles definition registry.
// Maps display titles → canonical seniority values (rate-card compatible).
// Reads: any org persona (dropdowns everywhere). Writes: HR + founding
// partners only. When the table is empty the UI falls back to the legacy
// hardcoded seniority list (production policy forbids seeding).
// =============================================================

const titleBody = z.object({
  title: z.string().trim().min(1).max(200),
  seniority: z.string().trim().min(1).max(100),
  rank: z.number().int().min(0).max(1000).default(0),
  workerTypes: z
    .array(z.enum(["employee", "contractor", "partner_firm_resource"]))
    .max(3)
    .default([]),
  notes: z.string().trim().max(2000).nullish(),
});

function canManageTitles(me: { role: string }): boolean {
  return me.role === "founding_partner" || me.role === "hr";
}

// @cli-skip: reference dropdown data; UI-driven (Task #509)
router.get("/roster/titles", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    const includeDeprecated = String(req.query.status ?? "") === "all";
    const rows = await db
      .select()
      .from(atelierTitles)
      .where(
        includeDeprecated
          ? isNull(atelierTitles.deletedAt)
          : and(isNull(atelierTitles.deletedAt), eq(atelierTitles.status, "active")),
      )
      .orderBy(desc(atelierTitles.rank), atelierTitles.title);
    res.json({
      titles: rows.map((t) => ({
        id: t.id,
        title: t.title,
        seniority: t.seniority,
        rank: t.rank,
        workerTypes: t.workerTypes ?? [],
        status: t.status,
        notes: t.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; UI-driven (Task #509)
router.post("/roster/titles", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    if (!canManageTitles(me)) {
      res.status(403).json({ error: "hr-or-founding-partner-only" });
      return;
    }
    const parsed = titleBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const [dup] = await db
      .select({ id: atelierTitles.id })
      .from(atelierTitles)
      .where(
        and(
          sql`lower(${atelierTitles.title}) = ${b.title.toLowerCase()}`,
          isNull(atelierTitles.deletedAt),
        ),
      );
    if (dup) {
      res.status(409).json({ error: "duplicate-title" });
      return;
    }
    const id = rid("ttl");
    await db.insert(atelierTitles).values({
      id,
      title: b.title,
      seniority: b.seniority,
      rank: b.rank,
      workerTypes: b.workerTypes,
      notes: b.notes ?? null,
      createdByUserId: me.id,
    });
    assertAuditAction("roster.title.created");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "roster_title",
      entityId: id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "roster.title.created",
      payload: { title: b.title, seniority: b.seniority },
      payloadSummary: `${me.name} added title "${b.title}" (→ ${b.seniority}).`,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; UI-driven (Task #509)
router.patch("/roster/titles/:id", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    if (!canManageTitles(me)) {
      res.status(403).json({ error: "hr-or-founding-partner-only" });
      return;
    }
    const parsed = titleBody
      .partial()
      .extend({ status: z.enum(["active", "deprecated"]).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
      return;
    }
    const [row] = await db
      .select()
      .from(atelierTitles)
      .where(and(eq(atelierTitles.id, String(req.params.id)), isNull(atelierTitles.deletedAt)));
    if (!row) {
      res.status(404).json({ error: "title-not-found" });
      return;
    }
    const b = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.title !== undefined) patch.title = b.title;
    if (b.seniority !== undefined) patch.seniority = b.seniority;
    if (b.rank !== undefined) patch.rank = b.rank;
    if (b.workerTypes !== undefined) patch.workerTypes = b.workerTypes;
    if (b.notes !== undefined) patch.notes = b.notes ?? null;
    if (b.status !== undefined) patch.status = b.status;
    await db.update(atelierTitles).set(patch).where(eq(atelierTitles.id, row.id));
    assertAuditAction("roster.title.updated");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "roster_title",
      entityId: row.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "roster.title.updated",
      payload: { changes: b },
      payloadSummary: `${me.name} updated title "${b.title ?? row.title}".`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; UI-driven (Task #509)
router.delete("/roster/titles/:id", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    if (!canManageTitles(me)) {
      res.status(403).json({ error: "hr-or-founding-partner-only" });
      return;
    }
    const [row] = await db
      .select()
      .from(atelierTitles)
      .where(and(eq(atelierTitles.id, String(req.params.id)), isNull(atelierTitles.deletedAt)));
    if (!row) {
      res.status(404).json({ error: "title-not-found" });
      return;
    }
    await db
      .update(atelierTitles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierTitles.id, row.id));
    assertAuditAction("roster.title.deleted");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "roster_title",
      entityId: row.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "roster.title.deleted",
      payload: { title: row.title },
      payloadSummary: `${me.name} removed title "${row.title}".`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

/**
 * Cross-realm guard for non-engagement endpoints (Task #254 §6).
 *
 * Contractor + partner_firm_resource personas may only see endpoints that
 * are scoped to engagements they hold an active grant for. This helper
 * lets the main atelier router 403 them off Home, Pipeline, Forecast,
 * Atelier Assets list, and Win-Themes.
 */
export function rejectNonEmployeePersona(
  req: Request,
  res: Response,
  next: import("express").NextFunction,
): void {
  const me = req.atelierPersona;
  if (!me) {
    next();
    return;
  }
  if (me.role === "contractor" || me.role === "partner_firm_resource") {
    res.status(403).json({
      error: "non-employee-persona-not-allowed-here",
      message:
        "Contractors and partner-firm resources may only access engagement-scoped routes.",
    });
    return;
  }
  next();
}

// =============================================================
// Task #254 — Sentinel side-effect: auto-revoke non-employee grants on close.
// Exposed for both direct callers (engagement-close transition routes when
// they land in #257) and the agent runner's emitAccessSentinelEvent dispatch.
// =============================================================
export async function revokeNonEmployeeAccessOnEngagementClose(args: {
  engagementId: string;
  closedByUserId: string;
}): Promise<{ revokedCount: number; revokedUserIds: string[] }> {
  // Active grants on this engagement.
  const grants = await db
    .select({
      userId: atelierEngagementAccess.userId,
      role: atelierUsers.role,
    })
    .from(atelierEngagementAccess)
    .innerJoin(atelierUsers, eq(atelierUsers.id, atelierEngagementAccess.userId))
    .where(
      and(
        eq(atelierEngagementAccess.engagementId, args.engagementId),
        eq(atelierEngagementAccess.status, "active"),
        isNull(atelierEngagementAccess.deletedAt),
      ),
    );
  // Internal Cognirise roles keep access (PRD §8.1); everyone else is auto-revoked.
  // Task #292 — 9-persona model. partner_firm_resource and contractor are
  // intentionally excluded so the Sentinel still revokes their grants on
  // close. board_observer is read-only at the policy layer.
  const INTERNAL = new Set([
    "founding_partner",
    "partner",
    "senior_manager",
    "consultant",
    "finance",
    "hr",
  ]);
  const targets = grants.filter((g) => !INTERNAL.has(g.role));
  if (targets.length === 0) return { revokedCount: 0, revokedUserIds: [] };
  const userIds = targets.map((t) => t.userId);
  await db
    .update(atelierEngagementAccess)
    .set({ status: "revoked", endDate: new Date() })
    .where(
      and(
        eq(atelierEngagementAccess.engagementId, args.engagementId),
        inArray(atelierEngagementAccess.userId, userIds),
      ),
    );
  // One audit row per revoke for traceability in the per-person Audit feed.
  assertAuditAction("access.revoke.auto-on-close");
  await db.insert(atelierAuditEvents).values(
    userIds.map((uid) => ({
      id: rid("aud"),
      entityType: "engagement_access",
      entityId: `${args.engagementId}:${uid}`,
      actorType: "agent" as const,
      actorId: "ag_access_sentinel",
      actorLabel: "Access Sentinel",
      action: "access.revoke.auto-on-close",
      payload: {
        engagementId: args.engagementId,
        userId: uid,
        closedByUserId: args.closedByUserId,
      },
      payloadSummary: `Access Sentinel auto-revoked non-employee access on engagement close.`,
    })),
  );
  return { revokedCount: userIds.length, revokedUserIds: userIds };
}

// silence unused imports lint that may flag drizzle helpers across versions
void or;
void inArray;
void sql;
