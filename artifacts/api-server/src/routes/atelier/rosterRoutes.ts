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
import { and, desc, eq, isNull, or, ilike, inArray, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureEngAccess } from "./engagementRoutes.js";
import { assertAuditAction } from "./auditContract.js";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirms,
  atelierPartnerFirmResources,
  atelierEngagementAccess,
  atelierEngagements,
  atelierAccounts,
  atelierAuditEvents,
  atelierPersonDocuments,
  atelierConflictDisclosures,
} from "@workspace/db";

const router: IRouter = Router();

// -----------------------------------------------------------------
// Types + helpers
// -----------------------------------------------------------------

export type WorkerType = "employee" | "contractor" | "partner_firm_resource";

interface PersonWire {
  id: string;
  workerType: WorkerType;
  fullName: string;
  email: string | null;
  role: string | null;
  seniority: string | null;
  title: string | null;
  country: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
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
  avatarUrl?: string | null;
  notes?: string | null;
  partnerEconomicsId?: string | null;
  // PRD §2.1 policy-locked fields (Partner / Operations only).
  baseCompensation?: number | null;
  dayRateInternalCost?: number | null;
  costToAicoPerDay?: number | null;
}

// Task #292 — Compensation visibility now spans leadership + finance + HR.
import { canViewCompensation } from "./personaRoles.js";

function canSeeComp(role: string | undefined | null): boolean {
  return canViewCompensation(role);
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

interface ListOpts {
  workerType?: WorkerType | "all";
  q?: string;
  status?: string;
  includeComp: boolean;
}

async function listPersons(opts: ListOpts): Promise<PersonWire[]> {
  const wt = opts.workerType ?? "all";
  const q = opts.q?.trim().toLowerCase() ?? "";
  const matches = (s: string | null | undefined) =>
    !q || (s ?? "").toLowerCase().includes(q);

  const out: PersonWire[] = [];

  if (wt === "all" || wt === "employee") {
    const rows = await db
      .select()
      .from(atelierEmployees)
      .where(isNull(atelierEmployees.deletedAt));
    for (const r of rows) {
      if (
        !matches(r.fullName) &&
        !matches(r.email) &&
        !matches(r.title) &&
        !matches(r.role)
      )
        continue;
      if (opts.status && r.status !== opts.status) continue;
      out.push(employeeToWire(r, opts.includeComp));
    }
  }

  if (wt === "all" || wt === "contractor") {
    const rows = await db
      .select()
      .from(atelierContractors)
      .where(isNull(atelierContractors.deletedAt));
    for (const r of rows) {
      if (
        !matches(r.fullName) &&
        !matches(r.email) &&
        !matches(r.vendorEntity)
      )
        continue;
      if (opts.status && r.status !== opts.status) continue;
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
        !matches(r.email) &&
        !matches(r.role) &&
        !matches(firmName ?? "")
      )
        continue;
      if (opts.status && r.status !== opts.status) continue;
      out.push(partnerResourceToWire(r, firmName, opts.includeComp));
    }
  }

  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}

function employeeToWire(
  r: typeof atelierEmployees.$inferSelect,
  includeComp: boolean,
): PersonWire {
  const base: PersonWire = {
    id: r.id,
    workerType: "employee",
    fullName: r.fullName,
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
    avatarUrl: r.avatarUrl,
    notes: r.notes,
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
    email: r.email,
    role: null,
    seniority: null,
    title: null,
    country: r.country,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    vendorEntity: r.vendorEntity,
    notes: r.notes,
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
  };
  if (includeComp) {
    base.dayRateAmount = r.dayRateAmount;
    base.dayRateCurrency = r.dayRateCurrency;
    // PRD §2.1 policy-locked field — Partner / Operations only.
    base.costToAicoPerDay = r.costToAicoPerDay ?? null;
  }
  return base;
}

async function getPerson(
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
async function resolveLinkedUserId(
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

router.get("/roster/people", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const wt = req.query.workerType as WorkerType | "all" | undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    const list = await listPersons({
      workerType: wt,
      q,
      status,
      includeComp: canSeeComp(me.role),
    });
    res.json({ people: list, viewerCanSeeComp: canSeeComp(me.role) });
  } catch (err) {
    next(err);
  }
});

router.get("/roster/people/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    res.json({ person, viewerCanSeeComp: canSeeComp(me.role) });
  } catch (err) {
    next(err);
  }
});

router.get("/roster/people/:id/engagements", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
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

router.get("/roster/people/:id/access", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const userId = await resolveLinkedUserId(person);
    if (!userId) {
      res.json({
        person: { id: person.id, fullName: person.fullName },
        grants: [],
        hint: "Person has no linked atelier_users login row.",
      });
      return;
    }
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
      grants,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/roster/people/:id/documents", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
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
    assertAuditAction("document.downloaded");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "person_document",
      entityId: doc.id,
      actorType: "user",
      actorId: me.id,
      actorLabel: me.name,
      action: "document.downloaded",
      payload: { personId: person.id, docId: doc.id, kind: doc.kind },
      payloadSummary: `${me.name} downloaded ${doc.kind} document for ${person.fullName}`,
    });
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

router.get("/roster/people/:id/audit", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
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
router.get("/roster/people/:id/conflicts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await getPerson(req.params.id, canSeeComp(me.role));
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const rows = await db
      .select()
      .from(atelierConflictDisclosures)
      .where(
        and(
          eq(atelierConflictDisclosures.personType, person.workerType),
          eq(atelierConflictDisclosures.personId, person.id),
          isNull(atelierConflictDisclosures.deletedAt),
        ),
      )
      .orderBy(desc(atelierConflictDisclosures.disclosedAt));
    res.json({ conflicts: rows });
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
  // Internal AICo roles keep access (PRD §8.1); everyone else is auto-revoked.
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
