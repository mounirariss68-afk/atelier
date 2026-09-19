/**
 * Atelier v3 — Roster lifecycle routes (Task #255).
 *
 * Owns:
 *   - /roster/invitations              (create / list / resend / revoke / accept)
 *   - /roster/onboarding               (list active sequences + step state machine)
 *   - /roster/offboarding              (list / advance / finalize → audit pack PDF)
 *   - /roster/compliance               (registrations + expiration roll-up)
 *   - /roster/people/:id/conflicts     (POST = declare; PATCH = clear/escalate)
 *   - /roster/access/conflict-override (Partner override of the Access Sentinel
 *                                       conflict gate; logs both block + override)
 *   - /roster/steward/run              (manual trigger for the Roster Steward
 *                                       daily expiration scan)
 *
 * Three agent identities (audit only — no Claude call needed for these):
 *   - ag_onboarding_concierge   produces + advances onboarding sequences
 *   - ag_offboarding_sentinel   produces + advances offboarding sequences
 *   - ag_roster_steward         emits Pane A items for compliance expirations
 *
 * Compliance PII redaction — visa/Iqama numbers are NEVER persisted raw. The
 * route accepts a raw `referenceNumber`, derives the last-four + a redacted
 * mask, persists those, and discards the rest. The agent input builders
 * receive metadata only.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lte, gte, ne, or, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirmResources,
  atelierAccounts,
  atelierEngagements,
  atelierEngagementAccess,
  atelierAuditEvents,
  atelierAgentRuns,
  atelierConflictDisclosures,
  atelierInvitations,
  atelierOnboardings,
  atelierOnboardingSteps,
  atelierOffboardings,
  atelierOffboardingSteps,
  atelierComplianceRecords,
  atelierPartnerFirmDocuments,
  atelierPaneAItems,
  atelierStudioCandidates,
  atelierStudioOffers,
  atelierAuthCredentials,
  atelierAuthSessions,
  atelierLoginActivationTokens,
  atelierPersonDocuments,
  atelierDependents,
  atelierEmergencyContacts,
  atelierPersons,
  atelierRosterReportsTo,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierLeaveRequests,
  atelierExpenses,
  atelierContractRecords,
  atelierCompChanges,
  atelierPayrollLines,
  atelierEosbSettlements,
  atelierSalaryAdvances,
  atelierLegalEntities,
} from "@workspace/db";
import { runAccessSentinel } from "./rosterRoutes.js";
import { canViewSensitivePeopleData } from "./personaRoles.js";
import { assertAuditAction } from "./auditContract.js";
import { hashPassword } from "../../lib/auth/passwords.js";
// Task #538 — invitation acceptance materialises a structured person
// record; the draft fullName is parsed via the shared name parser.
import { writePersonAndSync, writePersonFromFullName } from "../../lib/atelier-person-sync.js";
import {
  resolveStructuredNameInput,
  composeFullName,
  PersonNameValidationError,
  type StructuredName,
} from "../../lib/atelier-person-model.js";
import { sendJoinerWelcomeEmail, sendPartnerRegistrationEmail } from "../../lib/atelier-welcome-email.js";
import { emitSelfNotification } from "./meRoutes.js";
import {
  ensureProvisioningRow,
  launchProvisioning,
  defaultProfileForWorkerType,
} from "../../lib/atelier-ms-provisioning.js";
import {
  employingEntityName,
  findActiveEmployingEntity,
  matchLegacyEmployingEntity,
} from "../../lib/atelier-employing-entity.js";

const router: IRouter = Router();

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

type WorkerType = "employee" | "contractor" | "partner_firm_resource";

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

// Task #292 — 9-persona model. Roster lifecycle splits former Operations
// into Finance (payroll/GOSI/WPS) and HR (people-ops). For backwards
// compatibility this module treats both as the "ops" tier. Per-engagement
// leads (formerly engagement_lead) are now senior_manager.
function isPartner(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "founding_partner";
}
function isPartnerOrOps(me: typeof atelierUsers.$inferSelect): boolean {
  return (
    me.role === "founding_partner" ||
    me.role === "partner" ||
    me.role === "finance" ||
    me.role === "hr"
  );
}
function canManageLifecycle(me: typeof atelierUsers.$inferSelect): boolean {
  return isPartnerOrOps(me) || me.role === "senior_manager";
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect | { id: string; name: string; role: string };
  actorIsAgent?: boolean;
  agentId?: string;
  action: string;
  payload?: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: args.actorIsAgent ? "agent" : "human",
    actorId: args.actorIsAgent ? args.agentId ?? "ag_unknown" : args.actor.id,
    actorLabel: args.actorIsAgent ? "Atelier Agent" : args.actor.name,
    action: args.action,
    payload: args.payload ?? {},
    payloadSummary: args.summary,
  });
}

// Resolve a person id across the three roster tables.
async function findPerson(
  id: string,
  orgId?: string,
): Promise<{ id: string; workerType: WorkerType; fullName: string; email: string | null; personId: string | null } | null> {
  const [emp] = await db
    .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName, email: atelierEmployees.email, personId: atelierEmployees.personId })
    .from(atelierEmployees)
   .where(and(eq(atelierEmployees.id, id), ...(orgId ? [eq(atelierEmployees.orgId, orgId)] : []), isNull(atelierEmployees.deletedAt)));
  if (emp) return { ...emp, workerType: "employee" };
  const [ct] = await db
    .select({ id: atelierContractors.id, fullName: atelierContractors.fullName, email: atelierContractors.email, personId: atelierContractors.personId })
    .from(atelierContractors)
   .where(and(eq(atelierContractors.id, id), ...(orgId ? [eq(atelierContractors.orgId, orgId)] : []), isNull(atelierContractors.deletedAt)));
  if (ct) return { ...ct, workerType: "contractor" };
  const [pr] = await db
    .select({ id: atelierPartnerFirmResources.id, fullName: atelierPartnerFirmResources.fullName, email: atelierPartnerFirmResources.email, personId: atelierPartnerFirmResources.personId })
    .from(atelierPartnerFirmResources)
    .where(
      and(
        eq(atelierPartnerFirmResources.id, id),
        ...(orgId ? [eq(atelierPartnerFirmResources.orgId, orgId)] : []),
        isNull(atelierPartnerFirmResources.deletedAt),
      ),
    );
  if (pr) return { ...pr, workerType: "partner_firm_resource" };
  return null;
}

/**
 * Resolve the linked atelier_users.id for a roster person, mirroring
 * `resolveLinkedUserId` in rosterRoutes.ts (Access Sentinel). Employees are
 * linked canonically via atelier_employees.user_id; contractors and
 * partner-firm resources fall back to email lookup against atelier_users.
 *
 * Critical for offboarding: engagement_access grants are keyed by user_id,
 * so any check that reads them MUST resolve through this same path —
 * otherwise an employee with a null/changed email would falsely report
 * "no pending grants" and let finalize sign off without revocation.
 */
async function resolveLinkedUserIdForPerson(
  person: { id: string; workerType: WorkerType; email: string | null },
  source: Pick<typeof db, "select"> = db,
  orgId?: string,
): Promise<string | null> {
  if (person.workerType === "employee") {
    const [emp] = await source
      .select({ userId: atelierEmployees.userId })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, person.id), ...(orgId ? [eq(atelierEmployees.orgId, orgId)] : [])));
    if (!emp?.userId) return null;
    const [user] = await source.select({ id: atelierUsers.id }).from(atelierUsers)
      .where(and(eq(atelierUsers.id, emp.userId), ...(orgId ? [eq(atelierUsers.orgId, orgId)] : [])));
    return user?.id ?? null;
  }
  if (!person.email) return null;
  const [u] = await source
    .select({ id: atelierUsers.id })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.email, person.email), ...(orgId ? [eq(atelierUsers.orgId, orgId)] : [])));
  return u?.id ?? null;
}

const PROTECTED_DEMO_USER_ID = "p_demo_reviewer";
const PROTECTED_DEMO_EMAIL = "demo@cognirise.ai";

type RemovalDependency = { key: string; label: string; count: number };

/**
 * Removal is intentionally conservative. A row with anything beyond its
 * creation/audit scaffolding is archived instead of destroyed. This helper
 * is also used by the UI's preflight endpoint, so the decision shown to HR is
 * the same decision enforced by DELETE.
 */
async function removalDependencies(
  person: { id: string; workerType: WorkerType; email: string | null; personId: string | null },
  orgId: string,
  source: Pick<typeof db, "select"> = db,
): Promise<RemovalDependency[]> {
  const typed = person.workerType;
  const checks: Array<Promise<RemovalDependency>> = [];
  const linkedUserId = await resolveLinkedUserIdForPerson(person, source, orgId);
  const add = (
    key: string,
    label: string,
    query: Promise<Array<unknown>>,
  ) => checks.push(query.then((rows) => ({ key, label, count: rows.length })));
  add(
    "reports",
    "reporting-line assignments",
    source.select({ id: atelierRosterReportsTo.id }).from(atelierRosterReportsTo).where(
      or(eq(atelierRosterReportsTo.personId, person.id), eq(atelierRosterReportsTo.managerPersonId, person.id)),
    ),
  );
  add(
    "documents",
    "personal or identity documents",
    source.select({ id: atelierPersonDocuments.id }).from(atelierPersonDocuments).where(
      and(eq(atelierPersonDocuments.orgId, orgId), eq(atelierPersonDocuments.personId, person.id)),
    ),
  );
  add(
    "conflicts",
    "conflict disclosures",
    source.select({ id: atelierConflictDisclosures.id }).from(atelierConflictDisclosures).where(
      and(eq(atelierConflictDisclosures.orgId, orgId), eq(atelierConflictDisclosures.personId, person.id)),
    ),
  );
  add(
    "onboarding",
    "onboarding history",
    source.select({ id: atelierOnboardings.id }).from(atelierOnboardings).where(
      and(eq(atelierOnboardings.orgId, orgId), eq(atelierOnboardings.personId, person.id)),
    ),
  );
  add(
    "offboarding",
    "offboarding history",
    source.select({ id: atelierOffboardings.id }).from(atelierOffboardings).where(
      and(eq(atelierOffboardings.orgId, orgId), eq(atelierOffboardings.personId, person.id)),
    ),
  );
  add(
    "dependents",
    "dependents",
    source.select({ id: atelierDependents.id }).from(atelierDependents).where(
      and(eq(atelierDependents.orgId, orgId), eq(atelierDependents.personId, person.id)),
    ),
  );
  add(
    "emergency_contacts",
    "emergency contacts",
    source.select({ id: atelierEmergencyContacts.id }).from(atelierEmergencyContacts).where(
      and(eq(atelierEmergencyContacts.orgId, orgId), eq(atelierEmergencyContacts.personId, person.id)),
    ),
  );
  add(
    "timesheets",
    "timesheets",
    source.select({ id: atelierTimesheetWeeks.id }).from(atelierTimesheetWeeks).where(
      and(eq(atelierTimesheetWeeks.orgId, orgId), eq(atelierTimesheetWeeks.personId, person.id)),
    ),
  );
  add(
    "timesheet_entries",
    "timesheet entries",
    source.select({ id: atelierTimesheetEntries.id }).from(atelierTimesheetEntries).where(
      and(eq(atelierTimesheetEntries.orgId, orgId), eq(atelierTimesheetEntries.personId, person.id)),
    ),
  );
  add(
    "leave",
    "leave requests",
    source.select({ id: atelierLeaveRequests.id }).from(atelierLeaveRequests).where(
      and(eq(atelierLeaveRequests.orgId, orgId), eq(atelierLeaveRequests.personId, person.id)),
    ),
  );
  add(
    "expenses",
    "expense claims",
    source.select({ id: atelierExpenses.id }).from(atelierExpenses).where(
      and(
        eq(atelierExpenses.orgId, orgId),
        linkedUserId
          ? or(eq(atelierExpenses.personId, person.id), eq(atelierExpenses.personId, linkedUserId))
          : eq(atelierExpenses.personId, person.id),
      ),
    ),
  );
  add(
    "contracts",
    "contract records",
    source.select({ id: atelierContractRecords.id }).from(atelierContractRecords).where(
      and(eq(atelierContractRecords.orgId, orgId), eq(atelierContractRecords.personId, person.id)),
    ),
  );
  if (typed === "employee") {
    add(
      "compensation",
      "compensation history",
      source.select({ id: atelierCompChanges.id }).from(atelierCompChanges).where(
        and(eq(atelierCompChanges.orgId, orgId), eq(atelierCompChanges.employeeId, person.id)),
      ),
    );
    add(
      "payroll",
      "payroll lines",
      source.select({ id: atelierPayrollLines.id }).from(atelierPayrollLines).where(
        and(eq(atelierPayrollLines.orgId, orgId), eq(atelierPayrollLines.employeeId, person.id)),
      ),
    );
    add(
      "eosb",
      "end-of-service settlement",
      source.select({ id: atelierEosbSettlements.id }).from(atelierEosbSettlements).where(
        and(eq(atelierEosbSettlements.orgId, orgId), eq(atelierEosbSettlements.employeeId, person.id)),
      ),
    );
    add(
      "salary_advances",
      "salary advances",
      source.select({ id: atelierSalaryAdvances.id }).from(atelierSalaryAdvances).where(
        and(eq(atelierSalaryAdvances.orgId, orgId), eq(atelierSalaryAdvances.employeeId, person.id)),
      ),
    );
  }
  if (linkedUserId) {
    add(
      "engagements",
      "engagement access",
      source.select({ id: atelierEngagementAccess.id }).from(atelierEngagementAccess).where(
      eq(atelierEngagementAccess.userId, linkedUserId),
      ),
    );
  }
  // Audit rows are history, but the single creation row is expected. Any
  // second audit event means the record has meaningful history.
  add(
    "audit",
    "audit history",
    source.select({ id: atelierAuditEvents.id }).from(atelierAuditEvents).where(
      and(
        eq(atelierAuditEvents.entityId, person.id),
        sql`${atelierAuditEvents.action} <> 'roster.person.created'`,
      ),
    ),
  );
  return (await Promise.all(checks)).filter((d) => d.count > 0);
}

function isProtectedDemo(person: { email: string | null; id: string; personId: string | null }): boolean {
  return (
    person.id === "emp_demo_reviewer" ||
    person.personId === PROTECTED_DEMO_USER_ID ||
    (person.email ?? "").toLowerCase() === PROTECTED_DEMO_EMAIL
  );
}

function rejectUnsupportedRemovalType(
  person: { workerType: WorkerType },
  res: Response,
): boolean {
  if (person.workerType === "partner_firm_resource") {
    res.status(422).json({ error: "partner-firm-resource-removal-unsupported" });
    return true;
  }
  return false;
}

// -----------------------------------------------------------------
// Step templates — per worker type sequences
// -----------------------------------------------------------------

interface StepTemplate {
  code: string;
  title: string;
  description?: string;
  ownerRole: string;
  isComplianceGate?: boolean;
  isReassignmentGate?: boolean;
  daysFromStart?: number;
}

// Task #509 — researched role-specific pre-boarding checklists per worker
// type. Every sequence ends with the "login.created" step: creating the
// portal login is the FINAL pre-boarding action (replaces the old parallel
// add-joiner form) and is executed via POST /roster/onboarding/:id/create-login.
const LOGIN_STEP_CODE = "login.created";

const ONBOARDING_TEMPLATES: Record<WorkerType, StepTemplate[]> = {
  employee: [
    { code: "contract.signed", title: "Employment contract signed", description: "Countersigned employment contract on file.", ownerRole: "partner", daysFromStart: 0, isComplianceGate: true },
    { code: "rtw.verified", title: "Right-to-work / visa verified", description: "Passport, residency/visa status and work permit checked and recorded.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "it.sso.provisioned", title: "IT account, email & SSO provisioned", description: "Corporate email, SSO identity, MFA enrolment and core tool access.", ownerRole: "hr", daysFromStart: 2 },
    { code: "payroll.bank", title: "Payroll & bank details registered", description: "Payroll enrolment (incl. GOSI/WPS where applicable) and verified bank details.", ownerRole: "hr", daysFromStart: 2, isComplianceGate: true },
    { code: "policies.acknowledged", title: "Policies acknowledged", description: "Code of conduct, confidentiality, IT security and expenses policies signed off.", ownerRole: "hr", daysFromStart: 3 },
    { code: "buddy.manager.intro", title: "Buddy & manager introductions", description: "Buddy assigned; manager intro and first-week schedule booked.", ownerRole: "senior_manager", daysFromStart: 5 },
    { code: "workspace.ready", title: "Workspace ready", description: "Equipment issued/shipped and desk or remote setup confirmed.", ownerRole: "hr", daysFromStart: 5 },
    { code: LOGIN_STEP_CODE, title: "Portal login created", description: "Create the portal login — the final pre-boarding step.", ownerRole: "hr", daysFromStart: 7 },
  ],
  contractor: [
    { code: "nda.msa.signed", title: "NDA & MSA signed", description: "Non-disclosure and master services agreements executed.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "conflict.disclosed", title: "Conflicts of interest disclosed", description: "Conflict disclosure captured and cleared.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "vendor.ap.setup", title: "Vendor & AP setup", description: "Vendor entity registered with accounts payable; payment terms agreed.", ownerRole: "hr", daysFromStart: 1 },
    { code: "sso.limited", title: "Limited SSO provisioned", description: "Scoped access to the tools required for the engagement only.", ownerRole: "hr", daysFromStart: 2 },
    { code: "invoice.cadence", title: "Invoice cadence agreed", description: "Invoicing schedule, rate and approval chain confirmed.", ownerRole: "hr", daysFromStart: 3 },
    { code: "scope.briefed", title: "Engagement scope briefed", description: "Scope of work, deliverables and ways of working walked through.", ownerRole: "senior_manager", daysFromStart: 3 },
    { code: LOGIN_STEP_CODE, title: "Portal login created", description: "Create the portal login — the final pre-boarding step.", ownerRole: "hr", daysFromStart: 4 },
  ],
  partner_firm_resource: [
    { code: "firm.agreement.verified", title: "Partner-firm agreement verified", description: "Firm MSA and NDA verified active and covering this resource.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "conflict.disclosed", title: "Resource conflicts disclosed", description: "Conflict disclosure for this resource captured and cleared.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "access.limited", title: "Limited access provisioned", description: "Guest access scoped to the assigned engagement only.", ownerRole: "hr", daysFromStart: 1 },
    { code: "engagement.briefed", title: "Engagement brief delivered", description: "Engagement context, client protocols and deliverables briefed.", ownerRole: "senior_manager", daysFromStart: 2 },
    { code: LOGIN_STEP_CODE, title: "Portal login created", description: "Create the portal login — the final pre-boarding step.", ownerRole: "hr", daysFromStart: 3 },
  ],
};

// 11-step offboarding (employees + contractors). Partner-firm resources use a
// trimmed variant (MSA-side closure handled by the firm).
const OFFBOARDING_TEMPLATES: Record<WorkerType, StepTemplate[]> = {
  employee: [
    { code: "intent.recorded", title: "Intent to leave recorded", ownerRole: "hr", daysFromStart: 0 },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "senior_manager", daysFromStart: 1, isReassignmentGate: true },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "senior_manager", daysFromStart: 3 },
    { code: "client.notify", title: "Clients notified (where appropriate)", ownerRole: "partner", daysFromStart: 4 },
    { code: "sso.revoked", title: "SSO revoked", ownerRole: "hr", daysFromStart: 7 },
    { code: "email.disabled", title: "Email disabled (forward set)", ownerRole: "hr", daysFromStart: 7 },
    { code: "slack.disabled", title: "Slack workspaces disabled", ownerRole: "hr", daysFromStart: 7 },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "hr", daysFromStart: 7 },
    { code: "ip.assignment.signed", title: "IP assignment + return-of-property signed", ownerRole: "hr", daysFromStart: 7 },
    { code: "final.payment", title: "Final payment + EOSB processed", ownerRole: "hr", daysFromStart: 14 },
    { code: "audit.pack.signed", title: "Partner-signed audit pack issued", ownerRole: "partner", daysFromStart: 14 },
  ],
  contractor: [
    { code: "intent.recorded", title: "Intent to roll off recorded", ownerRole: "hr", daysFromStart: 0 },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "senior_manager", daysFromStart: 1, isReassignmentGate: true },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "senior_manager", daysFromStart: 3 },
    { code: "client.notify", title: "Clients notified", ownerRole: "partner", daysFromStart: 4 },
    { code: "sso.revoked", title: "SSO revoked", ownerRole: "hr", daysFromStart: 5 },
    { code: "email.disabled", title: "Email disabled", ownerRole: "hr", daysFromStart: 5 },
    { code: "slack.disabled", title: "Slack disabled", ownerRole: "hr", daysFromStart: 5 },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "hr", daysFromStart: 5 },
    { code: "ip.assignment.signed", title: "IP assignment + return of property", ownerRole: "hr", daysFromStart: 5 },
    { code: "final.payment", title: "Final invoice paid", ownerRole: "hr", daysFromStart: 14 },
    { code: "audit.pack.signed", title: "Partner-signed audit pack issued", ownerRole: "partner", daysFromStart: 14 },
  ],
  partner_firm_resource: [
    { code: "intent.recorded", title: "Resource rotation recorded", ownerRole: "hr", daysFromStart: 0 },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "senior_manager", daysFromStart: 1, isReassignmentGate: true },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "senior_manager", daysFromStart: 3 },
    { code: "sso.revoked", title: "Guest SSO revoked", ownerRole: "hr", daysFromStart: 5 },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "hr", daysFromStart: 5 },
    { code: "audit.pack.signed", title: "Partner-signed audit pack issued", ownerRole: "partner", daysFromStart: 7 },
  ],
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------
// Sequence builders (Onboarding Concierge / Offboarding Sentinel)
// -----------------------------------------------------------------

async function startOnboardingSequence(args: {
  personId: string;
  workerType: WorkerType;
  invitationId?: string | null;
  targetStartDate?: string | null;
  ownerUserId: string;
}): Promise<string> {
  const id = rid("onb");
  const now = new Date();
  const start = args.targetStartDate ? new Date(args.targetStartDate) : now;
  await db.insert(atelierOnboardings).values({
    id,
    personType: args.workerType,
    personId: args.personId,
    invitationId: args.invitationId ?? null,
    startedAt: now,
    targetStartDate: args.targetStartDate ?? null,
    status: "in_flight",
    ownerUserId: args.ownerUserId,
  });
  const tpl = ONBOARDING_TEMPLATES[args.workerType];
  await db.insert(atelierOnboardingSteps).values(
    tpl.map((s, i) => ({
      id: rid("ostp"),
      onboardingId: id,
      sortKey: i,
      code: s.code,
      title: s.title,
      description: s.description ?? null,
      ownerRole: s.ownerRole,
      deadline: isoDate(new Date(start.getTime() + (s.daysFromStart ?? 0) * 86400_000)),
      status: "pending",
      isComplianceGate: !!s.isComplianceGate,
    })),
  );
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "onboarding",
    entityId: id,
    actorType: "agent",
    actorId: "ag_onboarding_concierge",
    actorLabel: "Onboarding Concierge",
    action: "onboarding.created",
    payload: { workerType: args.workerType, personId: args.personId, steps: tpl.length },
    payloadSummary: `Onboarding Concierge generated ${tpl.length}-step sequence for ${args.workerType} ${args.personId}.`,
  });
  // Emit an Onboarding Concierge agent run so the lifecycle is visible in
  // the standard agent_runs feed (Pane B), with toolCalls capturing each
  // template step and the prescribed owner. Status `complete` because the
  // sequence-generation tool call is what this run represents.
  await db.insert(atelierAgentRuns).values({
    id: rid("run"),
    agentId: "ag_onboarding_concierge",
    triggeredByUserId: args.ownerUserId,
    targetType: "onboarding",
    targetId: id,
    targetLabel: `${args.workerType} ${args.personId}`,
    inputs: { workerType: args.workerType, personId: args.personId, invitationId: args.invitationId ?? null },
    output: { onboardingId: id, stepCount: tpl.length },
    steps: tpl.map((s, i) => ({ idx: i, code: s.code, ownerRole: s.ownerRole })),
    // Prescribed Onboarding Concierge tool surface: each call is recorded as
    // an auditable intent that the runner integration layer fulfils when the
    // step's owner advances it. Stubs today; provisioning workers consume.
    toolCalls: [
      { tool: "atelier.lifecycle.generate_onboarding_sequence", args: { workerType: args.workerType }, result: { stepCount: tpl.length } },
      { tool: "email.send", args: { template: "welcome_invitation", personId: args.personId }, status: "queued" },
      { tool: "sso.provision", args: { personId: args.personId, workerType: args.workerType }, status: "queued" },
      { tool: "calendar.schedule", args: { template: "day_one_orientation", personId: args.personId }, status: "queued" },
      { tool: "file.write", args: { destination: `roster/${args.personId}/welcome_pack.pdf` }, status: "queued" },
      { tool: "knowledge.search", args: { query: `playbook ${args.workerType}` }, status: "queued" },
    ],
    confidence: "green",
    status: "complete",
    statusMessage: `${tpl.length}-step sequence generated`,
    progressPct: 100,
  });
  return id;
}

async function startOffboardingSequence(args: {
  personId: string;
  workerType: WorkerType;
  initiatedByUserId: string;
  lastWorkingDate?: string | null;
  reason?: string | null;
}): Promise<string> {
  const id = rid("off");
  const now = new Date();
  const last = args.lastWorkingDate ? new Date(args.lastWorkingDate) : now;
  await db.insert(atelierOffboardings).values({
    id,
    personType: args.workerType,
    personId: args.personId,
    initiatedByUserId: args.initiatedByUserId,
    lastWorkingDate: args.lastWorkingDate ?? null,
    status: "in_flight",
    reason: args.reason ?? null,
  });
  const tpl = OFFBOARDING_TEMPLATES[args.workerType];
  // Deadlines are a forward schedule anchored to `now` (the moment offboarding
  // was initiated). Steps with `daysFromStart` flow forward toward last
  // working date; the audit-pack-signed step (max daysFromStart) lands on
  // last working day. This matches the seed's forward calculation.
  const startMs = now.getTime();
  await db.insert(atelierOffboardingSteps).values(
    tpl.map((s, i) => ({
      id: rid("offs"),
      offboardingId: id,
      sortKey: i,
      code: s.code,
      title: s.title,
      description: s.description ?? null,
      ownerRole: s.ownerRole,
      deadline: isoDate(new Date(startMs + (s.daysFromStart ?? 0) * 86400_000)),
      status: "pending",
      isReassignmentGate: !!s.isReassignmentGate,
    })),
  );
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "offboarding",
    entityId: id,
    actorType: "agent",
    actorId: "ag_offboarding_sentinel",
    actorLabel: "Offboarding Sentinel",
    action: "offboarding.created",
    payload: { workerType: args.workerType, personId: args.personId, steps: tpl.length },
    payloadSummary: `Offboarding Sentinel generated ${tpl.length}-step sequence for ${args.workerType} ${args.personId}.`,
  });
  // Task #261 — Offboarding Sentinel Pane A producer. Surface a high-
  // priority "reassignment pending" item on the initiator's Home so the
  // gate step never sits silent. Idempotent on (offboardingId, userId).
  {
    const gateCount = tpl.filter((s) => s.isReassignmentGate).length;
    if (gateCount > 0 && args.initiatedByUserId) {
      const personLabel = args.personId;
      await db
        .insert(atelierPaneAItems)
        .values({
          id: `panea_offboarding_${id}_${args.initiatedByUserId}`,
          userId: args.initiatedByUserId,
          title: `Reassignment pending: ${personLabel}`,
          summary: `Offboarding Sentinel · ${gateCount} reassignment gate${gateCount === 1 ? "" : "s"} must clear before audit-pack sign-off.`,
          priority: "high",
          hrefKind: "atelier",
          hrefTargetId: "roster",
          dueLabel: args.lastWorkingDate ?? isoDate(now),
          sortKey: 0,
          createdByUserId: args.initiatedByUserId,
        })
        .onConflictDoNothing({ target: atelierPaneAItems.id });
    }
  }
  // Emit an Offboarding Sentinel agent run so the lifecycle is visible in
  // the standard agent_runs feed (Pane B), with toolCalls capturing the
  // reassignment-gate steps the Sentinel will enforce.
  await db.insert(atelierAgentRuns).values({
    id: rid("run"),
    agentId: "ag_offboarding_sentinel",
    triggeredByUserId: args.initiatedByUserId,
    targetType: "offboarding",
    targetId: id,
    targetLabel: `${args.workerType} ${args.personId}`,
    inputs: { workerType: args.workerType, personId: args.personId, lastWorkingDate: args.lastWorkingDate ?? null, reason: args.reason ?? null },
    output: { offboardingId: id, stepCount: tpl.length, gateSteps: tpl.filter((s) => s.isReassignmentGate).map((s) => s.code) },
    steps: tpl.map((s, i) => ({ idx: i, code: s.code, ownerRole: s.ownerRole, gate: !!s.isReassignmentGate })),
    // Prescribed Offboarding Sentinel tool surface (sso.revoke, email.disable,
    // slack.disable, salon.rename_team_member, audit.export). Recorded as
    // queued intents at sequence creation; finalize fulfils them and emits
    // the audit-pack export call.
    toolCalls: [
      { tool: "atelier.lifecycle.generate_offboarding_sequence", args: { workerType: args.workerType }, result: { stepCount: tpl.length } },
      { tool: "atelier.lifecycle.arm_reassignment_gate", args: { offboardingId: id }, result: { gates: tpl.filter((s) => s.isReassignmentGate).length } },
      { tool: "sso.revoke", args: { personId: args.personId }, status: "queued" },
      { tool: "email.disable", args: { personId: args.personId }, status: "queued" },
      { tool: "slack.disable", args: { personId: args.personId }, status: "queued" },
      { tool: "salon.rename_team_member", args: { personId: args.personId, suffix: " (former)" }, status: "queued" },
      { tool: "audit.export", args: { entityType: "offboarding", entityId: id, format: "pdf" }, status: "queued" },
    ],
    confidence: "green",
    status: "complete",
    statusMessage: `${tpl.length}-step sequence generated; ${tpl.filter((s) => s.isReassignmentGate).length} reassignment gate(s) armed`,
    progressPct: 100,
  });
  return id;
}

// -----------------------------------------------------------------
// PII redaction (compliance reference numbers)
// -----------------------------------------------------------------

function redactReference(raw: string | null | undefined): {
  redacted: string | null;
  lastFour: string | null;
} {
  if (!raw) return { redacted: null, lastFour: null };
  const trimmed = raw.replace(/\s+/g, "");
  if (trimmed.length === 0) return { redacted: null, lastFour: null };
  const last4 = trimmed.slice(-4);
  const masked = "•".repeat(Math.max(4, trimmed.length - 4)) + last4;
  return { redacted: masked, lastFour: last4 };
}

// -----------------------------------------------------------------
// /roster/invitations
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/invitations", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const rows = await db
      .select()
      .from(atelierInvitations)
      .where(
        and(
          eq(atelierInvitations.orgId, me.orgId),
          isNull(atelierInvitations.deletedAt),
        ),
      )
      .orderBy(desc(atelierInvitations.sentAt));
    const entities = await db
      .select({
        id: atelierLegalEntities.id,
        orgId: atelierLegalEntities.orgId,
        shortName: atelierLegalEntities.shortName,
        legalNameEn: atelierLegalEntities.legalNameEn,
      })
      .from(atelierLegalEntities)
      .where(eq(atelierLegalEntities.orgId, me.orgId));
    const entityNames = new Map(
      entities.map((entity) => [entity.id, employingEntityName(entity)]),
    );
    // Auto-mark expired (read-side; don't write).
    const now = Date.now();
    res.json({
      invitations: rows.map((r) => ({
        id: r.id,
        workerType: r.workerType,
        personDraft: {
          ...r.personDraft,
          employingEntityName:
            (r.personDraft.legalEntityId
              ? entityNames.get(r.personDraft.legalEntityId)
              : null) ??
            r.personDraft.employingEntity ??
            (r.personDraft.legalEntityId
              ? "Unavailable registered entity"
              : null),
          employingEntityLegacyUnmatched:
            Boolean(
              (r.personDraft.legalEntityId &&
                !entityNames.has(r.personDraft.legalEntityId)) ||
                (!r.personDraft.legalEntityId &&
                  r.personDraft.employingEntity?.trim()),
            ),
        },
        sentByUserId: r.sentByUserId,
        sentAt: r.sentAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        acceptedAt: r.acceptedAt?.toISOString() ?? null,
        acceptedPersonId: r.acceptedPersonId,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        status:
          r.status === "sent" && r.expiresAt && r.expiresAt.getTime() < now
            ? "expired"
            : r.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/invitations", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const body = req.body as {
      workerType?: WorkerType;
      fullName?: string;
      honorific?: string | null;
      firstName?: string | null;
      middleName?: string | null;
      lastName?: string | null;
      preferredName?: string | null;
      email?: string;
      role?: string | null;
      seniority?: string | null;
      title?: string | null;
      country?: string | null;
      partnerFirmId?: string | null;
      startDate?: string | null;
      legalEntityId?: string | null;
      expiresInDays?: number;
      sourceKind?: string;
      sourceId?: string;
    };
    if (
      req.body &&
      typeof req.body === "object" &&
      "employingEntity" in (req.body as Record<string, unknown>)
    ) {
      res.status(422).json({
        error: "legacy-employing-entity-not-accepted",
        message: "Choose a registered legal entity; free-text employing entities are not accepted.",
      });
      return;
    }
    const wt = body.workerType;
    if (!wt || !["employee", "contractor", "partner_firm_resource"].includes(wt)) {
      res.status(400).json({ error: "invalid-worker-type" });
      return;
    }
    // Task #538 — structured name fields win when present; a bare fullName
    // is parsed via the shared parser at accept-time. One of the two required.
    let structuredDraft: StructuredName | null = null;
    try {
      structuredDraft = resolveStructuredNameInput({
        fullName: body.fullName ?? undefined,
        honorific: body.honorific,
        firstName: body.firstName ?? undefined,
        middleName: body.middleName,
        lastName: body.lastName ?? undefined,
        preferredName: body.preferredName,
      });
    } catch (err) {
      if (err instanceof PersonNameValidationError) {
        res.status(400).json({ error: "invalid-name", message: err.message });
        return;
      }
      throw err;
    }
    const draftFullName = structuredDraft ? composeFullName(structuredDraft) : "";
    if (!structuredDraft || !draftFullName || !body.email?.trim()) {
      res.status(400).json({ error: "fullName + email required" });
      return;
    }
    // Task #509 — invitations can only be created from a hiring source:
    // a hired candidate, an accepted offer, or a contracted partner firm.
    // Free-standing invitations are no longer allowed.
    const sourceKind = body.sourceKind;
    const sourceId = (body.sourceId ?? "").trim();
    if (
      !sourceKind ||
      !["hired_candidate", "accepted_offer", "partner_firm_resource"].includes(sourceKind) ||
      !sourceId
    ) {
      res.status(400).json({
        error: "invitation-source-required",
        message:
          "Invitations must be created from a hired candidate, an accepted offer, or a contracted partner-firm resource (sourceKind + sourceId).",
      });
      return;
    }
    if (sourceKind === "hired_candidate") {
      const [cand] = await db
        .select({ id: atelierStudioCandidates.id, stage: atelierStudioCandidates.stage })
        .from(atelierStudioCandidates)
        .where(
          and(
            eq(atelierStudioCandidates.id, sourceId),
            eq(atelierStudioCandidates.orgId, me.orgId),
            isNull(atelierStudioCandidates.deletedAt),
          ),
        );
      if (!cand) {
        res.status(404).json({ error: "source-candidate-not-found" });
        return;
      }
      if (cand.stage !== "hired") {
        res.status(422).json({ error: "candidate-not-hired", stage: cand.stage });
        return;
      }
    } else if (sourceKind === "accepted_offer") {
      const [offer] = await db
        .select({ id: atelierStudioOffers.id, status: atelierStudioOffers.status })
        .from(atelierStudioOffers)
        .where(
          and(
            eq(atelierStudioOffers.id, sourceId),
            eq(atelierStudioOffers.orgId, me.orgId),
            isNull(atelierStudioOffers.deletedAt),
          ),
        );
      if (!offer) {
        res.status(404).json({ error: "source-offer-not-found" });
        return;
      }
      if (offer.status !== "accepted") {
        res.status(422).json({ error: "offer-not-accepted", status: offer.status });
        return;
      }
    } else {
      // partner_firm_resource — the source is a contracted individual on a
      // partner firm's bench, not the firm row itself. Provenance and firm
      // linkage come from the resource record.
      const [resource] = await db
        .select({
          id: atelierPartnerFirmResources.id,
          partnerFirmId: atelierPartnerFirmResources.partnerFirmId,
          status: atelierPartnerFirmResources.status,
        })
        .from(atelierPartnerFirmResources)
        .where(
          and(
            eq(atelierPartnerFirmResources.id, sourceId),
            eq(atelierPartnerFirmResources.orgId, me.orgId),
            isNull(atelierPartnerFirmResources.deletedAt),
          ),
        );
      if (!resource) {
        res.status(404).json({ error: "source-partner-firm-resource-not-found" });
        return;
      }
      if (resource.status !== "active") {
        res.status(422).json({
          error: "partner-firm-resource-not-active",
          status: resource.status,
        });
        return;
      }
      if (wt !== "partner_firm_resource") {
        res.status(422).json({ error: "partner-firm-source-requires-pfr-worker-type" });
        return;
      }
      // Firm linkage always comes from the resource record.
      body.partnerFirmId = resource.partnerFirmId;
    }
    const id = rid("inv");
    const expDays = Math.max(1, Math.min(60, body.expiresInDays ?? 14));
    const expiresAt = new Date(Date.now() + expDays * 86400_000);
    const legalEntityId = body.legalEntityId?.trim() || null;
    if (legalEntityId && wt !== "employee") {
      res.status(422).json({ error: "employee-only-employing-entity" });
      return;
    }
    if (
      legalEntityId &&
      !(await findActiveEmployingEntity(me.orgId, legalEntityId))
    ) {
      res.status(422).json({ error: "legal-entity-not-found" });
      return;
    }
    await db.insert(atelierInvitations).values({
      id,
      orgId: me.orgId,
      workerType: wt,
      personDraft: {
        fullName: draftFullName,
        honorific: structuredDraft.honorific ?? null,
        firstName: structuredDraft.firstName,
        middleName: structuredDraft.middleName ?? null,
        lastName: structuredDraft.lastName,
        preferredName: structuredDraft.preferredName ?? null,
        email: body.email.trim().toLowerCase(),
        role: body.role ?? null,
        seniority: body.seniority ?? null,
        title: body.title ?? null,
        country: body.country ?? null,
        partnerFirmId: body.partnerFirmId ?? null,
        startDate: body.startDate ?? null,
        legalEntityId,
      },
      sourceKind,
      sourceId,
      sentByUserId: me.id,
      sentAt: new Date(),
      expiresAt,
      status: "sent",
    });
    await audit({
      entityType: "invitation",
      entityId: id,
      actor: me,
      action: "invitation.sent",
      payload: { workerType: wt, email: body.email, sourceKind, sourceId },
      summary: `${me.name} invited ${draftFullName} (${wt}).`,
    });
    // Onboarding sequence is started immediately on invitation creation so the
    // pre-arrival compliance steps (background check, IT provisioning request,
    // ID-document collection) can begin in parallel with the invitee accepting.
    // The draft onboarding uses `draft:<invitation>` as the placeholder
    // personId; the accept handler swaps in the real personId once the person
    // record is materialised.
    const draftOnboardingId = await startOnboardingSequence({
      personId: `draft:${id}`,
      workerType: wt,
      invitationId: id,
      targetStartDate: body.startDate ?? null,
      ownerUserId: me.id,
    });
    res.json({ ok: true, id, expiresAt: expiresAt.toISOString(), onboardingId: draftOnboardingId });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/invitations/:id/resend", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const [inv] = await db
      .select()
      .from(atelierInvitations)
      .where(
        and(
          eq(atelierInvitations.id, req.params.id),
          eq(atelierInvitations.orgId, me.orgId),
          isNull(atelierInvitations.deletedAt),
        ),
      );
    if (!inv) {
      res.status(404).json({ error: "invitation-not-found" });
      return;
    }
    if (inv.status === "accepted" || inv.status === "revoked") {
      res.status(422).json({ error: "invitation-not-resendable", status: inv.status });
      return;
    }
    const expiresAt = new Date(Date.now() + 14 * 86400_000);
    await db
      .update(atelierInvitations)
      .set({ sentAt: new Date(), expiresAt, status: "sent", updatedAt: new Date() })
      .where(
        and(
          eq(atelierInvitations.id, inv.id),
          eq(atelierInvitations.orgId, me.orgId),
        ),
      );
    await audit({
      entityType: "invitation",
      entityId: inv.id,
      actor: me,
      action: "invitation.resent",
      summary: `${me.name} resent invitation to ${inv.personDraft.fullName}.`,
    });
    res.json({ ok: true, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/invitations/:id/revoke", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const [inv] = await db
      .select()
      .from(atelierInvitations)
      .where(
        and(
          eq(atelierInvitations.id, req.params.id),
          eq(atelierInvitations.orgId, me.orgId),
          isNull(atelierInvitations.deletedAt),
        ),
      );
    if (!inv) {
      res.status(404).json({ error: "invitation-not-found" });
      return;
    }
    if (inv.status === "accepted") {
      res.status(422).json({ error: "invitation-already-accepted" });
      return;
    }
    await db
      .update(atelierInvitations)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        revokedByUserId: me.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierInvitations.id, inv.id),
          eq(atelierInvitations.orgId, me.orgId),
        ),
      );
    await audit({
      entityType: "invitation",
      entityId: inv.id,
      actor: me,
      action: "invitation.revoked",
      summary: `${me.name} revoked invitation to ${inv.personDraft.fullName}.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Accept = materialise the person row + start onboarding sequence.
// In production this would be triggered by the invitee clicking the email
// link; here we expose it as a Partner/Ops action to drive demos forward.
// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/invitations/:id/accept", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const [inv] = await db
      .select()
      .from(atelierInvitations)
      .where(
        and(
          eq(atelierInvitations.id, req.params.id),
          eq(atelierInvitations.orgId, me.orgId),
          isNull(atelierInvitations.deletedAt),
        ),
      );
    if (!inv) {
      res.status(404).json({ error: "invitation-not-found" });
      return;
    }
    if (inv.status !== "sent") {
      res.status(422).json({ error: "invitation-not-acceptable", status: inv.status });
      return;
    }
    if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
      await db
        .update(atelierInvitations)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(atelierInvitations.id, inv.id),
            eq(atelierInvitations.orgId, me.orgId),
          ),
        );
      res.status(422).json({ error: "invitation-expired" });
      return;
    }
    const draft = inv.personDraft;
    let acceptedLegalEntityId = draft.legalEntityId ?? null;
    if (inv.workerType === "employee" && acceptedLegalEntityId) {
      if (!(await findActiveEmployingEntity(me.orgId, acceptedLegalEntityId))) {
        res.status(422).json({
          error: "legal-entity-not-found",
          message: "The invitation's employing legal entity is no longer active.",
        });
        return;
      }
    } else if (inv.workerType === "employee" && draft.employingEntity?.trim()) {
      const legacyEntities = await db
        .select({
          id: atelierLegalEntities.id,
          orgId: atelierLegalEntities.orgId,
          shortName: atelierLegalEntities.shortName,
          legalNameEn: atelierLegalEntities.legalNameEn,
        })
        .from(atelierLegalEntities)
        .where(
          and(
            eq(atelierLegalEntities.orgId, me.orgId),
            eq(atelierLegalEntities.status, "active"),
          ),
        );
      acceptedLegalEntityId =
        matchLegacyEmployingEntity(draft.employingEntity, legacyEntities)?.id ??
        null;
    }
    // Task #538 — create the person record first so the roster row links it.
    // Structured fields captured at invitation time win; older invitations
    // that only carry a fullName go through the shared parser.
    const personWrite =
      draft.firstName && draft.lastName
        ? await writePersonAndSync(db, {
            orgId: me.orgId,
            structured: {
              honorific: draft.honorific ?? null,
              firstName: draft.firstName,
              middleName: draft.middleName ?? null,
              lastName: draft.lastName,
              preferredName: draft.preferredName ?? null,
            },
            sourceKind: inv.workerType as string,
            createdByUserId: me.id,
          })
        : await writePersonFromFullName(db, {
            orgId: me.orgId,
            fullName: draft.fullName,
            sourceKind: inv.workerType as string,
            createdByUserId: me.id,
          });
    let personId: string;
    if (inv.workerType === "employee") {
      personId = `emp_${rid("x").slice(2)}`;
      await db.insert(atelierEmployees).values({
        id: personId,
        orgId: me.orgId,
        personId: personWrite.personId,
        fullName: personWrite.fullName,
        preferredName: personWrite.structured.preferredName ?? null,
        email: draft.email,
        role: draft.role ?? "consultant",
        seniority: draft.seniority ?? "consultant",
        title: draft.title ?? null,
        country: draft.country ?? null,
        startDate: draft.startDate ?? null,
        legalEntityId: acceptedLegalEntityId,
        employingEntity:
          acceptedLegalEntityId === null
            ? draft.employingEntity ?? null
            : null,
        status: "onboarding",
      });
    } else if (inv.workerType === "contractor") {
      personId = `ctr_${rid("x").slice(2)}`;
      await db.insert(atelierContractors).values({
        id: personId,
        orgId: me.orgId,
        personId: personWrite.personId,
        fullName: personWrite.fullName,
        email: draft.email,
        country: draft.country ?? null,
        startDate: draft.startDate ?? null,
        status: "onboarding",
      });
    } else {
      if (!draft.partnerFirmId) {
        res.status(400).json({ error: "partner_firm_id required on invitation" });
        return;
      }
      personId = `pfr_${rid("x").slice(2)}`;
      await db.insert(atelierPartnerFirmResources).values({
        id: personId,
        orgId: me.orgId,
        personId: personWrite.personId,
        partnerFirmId: draft.partnerFirmId,
        fullName: personWrite.fullName,
        email: draft.email,
        role: draft.role ?? null,
        seniority: draft.seniority ?? null,
        country: draft.country ?? null,
        startDate: draft.startDate ?? null,
        status: "onboarding",
      });
    }
    await db
      .update(atelierInvitations)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        acceptedPersonId: personId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierInvitations.id, inv.id),
          eq(atelierInvitations.orgId, me.orgId),
        ),
      );
    // Rebind the draft onboarding (created at invitation time with placeholder
    // personId = "draft:<inv.id>") to the real materialised person, rather
    // than spawning a duplicate sequence. This preserves any progress made
    // on pre-arrival compliance steps.
    const [draftOnb] = await db
      .select({ id: atelierOnboardings.id })
      .from(atelierOnboardings)
      .where(
        and(
          eq(atelierOnboardings.invitationId, inv.id),
          isNull(atelierOnboardings.deletedAt),
        ),
      );
    let onboardingId: string;
    if (draftOnb) {
      onboardingId = draftOnb.id;
      await db
        .update(atelierOnboardings)
        .set({ personId, updatedAt: new Date() })
        .where(eq(atelierOnboardings.id, draftOnb.id));
      await audit({
        entityType: "onboarding",
        entityId: onboardingId,
        actor: me,
        action: "onboarding.rebound",
        payload: { invitationId: inv.id, personId },
        summary: `Draft onboarding ${onboardingId} rebound from draft:${inv.id} → ${personId}.`,
      });
    } else {
      onboardingId = await startOnboardingSequence({
        personId,
        workerType: inv.workerType as WorkerType,
        invitationId: inv.id,
        targetStartDate: draft.startDate ?? null,
        ownerUserId: me.id,
      });
    }
    await audit({
      entityType: "invitation",
      entityId: inv.id,
      actor: me,
      action: "invitation.accepted",
      payload: { personId, onboardingId },
      summary: `${me.name} materialised ${draft.fullName} (${inv.workerType}); onboarding sequence ${onboardingId} now bound to person.`,
    });
    res.json({ ok: true, personId, onboardingId });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// /roster/onboarding
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/onboarding", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Per PRD §6, the onboarding pane shows in-flight sequences by default.
    // Pass ?status=all to include completed/cancelled rows.
    const includeAll = String(req.query.status ?? "in_flight") === "all";
    const onbs = await db
      .select()
      .from(atelierOnboardings)
      .where(
        includeAll
          ? isNull(atelierOnboardings.deletedAt)
          : and(
              isNull(atelierOnboardings.deletedAt),
              eq(atelierOnboardings.status, "in_flight"),
            ),
      )
      .orderBy(desc(atelierOnboardings.startedAt));
    const stepsByOnb = new Map<string, (typeof atelierOnboardingSteps.$inferSelect)[]>();
    if (onbs.length > 0) {
      const allSteps = await db
        .select()
        .from(atelierOnboardingSteps)
        .where(isNull(atelierOnboardingSteps.deletedAt));
      for (const s of allSteps) {
        const list = stepsByOnb.get(s.onboardingId) ?? [];
        list.push(s);
        stepsByOnb.set(s.onboardingId, list);
      }
    }
    const out = await Promise.all(
      onbs.map(async (o) => {
        const person = await findPerson(o.personId);
        // Task #509 — never show raw "draft:inv_…" placeholders. A draft
        // onboarding (invitation not yet accepted) resolves the invitee's
        // name from the invitation's person draft.
        let personName = person?.fullName ?? null;
        if (!personName && o.invitationId) {
          const [inv] = await db
            .select({ personDraft: atelierInvitations.personDraft })
            .from(atelierInvitations)
            .where(
              and(
                eq(atelierInvitations.id, o.invitationId),
                eq(atelierInvitations.orgId, me.orgId),
              ),
            );
          personName = inv?.personDraft?.fullName ?? null;
        }
        const steps = (stepsByOnb.get(o.id) ?? []).sort((a, b) => a.sortKey - b.sortKey);
        const done = steps.filter((s) => s.status === "done").length;
        return {
          id: o.id,
          personId: o.personId,
          personType: o.personType,
          personName: personName ?? o.personId,
          status: o.status,
          targetStartDate: o.targetStartDate,
          startedAt: o.startedAt.toISOString(),
          completedAt: o.completedAt?.toISOString() ?? null,
          blockedReason: o.blockedReason,
          progress: { done, total: steps.length },
          steps: steps.map((s) => ({
            id: s.id,
            code: s.code,
            title: s.title,
            ownerRole: s.ownerRole,
            deadline: s.deadline,
            status: s.status,
            isComplianceGate: s.isComplianceGate,
            completedAt: s.completedAt?.toISOString() ?? null,
            blockedReason: s.blockedReason,
          })),
        };
      }),
    );
    res.json({ onboardings: out });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/onboarding/:id/steps/:stepId/advance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canManageLifecycle(me)) {
      res.status(403).json({ error: "lifecycle-manage-forbidden" });
      return;
    }
    const body = req.body as { status?: string; blockedReason?: string };
    const next_status = body.status ?? "done";
    if (!["in_progress", "done", "blocked", "skipped"].includes(next_status)) {
      res.status(400).json({ error: "invalid-status" });
      return;
    }
    const [step] = await db
      .select()
      .from(atelierOnboardingSteps)
      .where(
        and(
          eq(atelierOnboardingSteps.id, req.params.stepId),
          eq(atelierOnboardingSteps.onboardingId, req.params.id),
        ),
      );
    if (!step) {
      res.status(404).json({ error: "step-not-found" });
      return;
    }
    // Task #509 — the "Portal login created" step is completed exclusively by
    // POST /roster/onboarding/:id/create-login (which actually creates the
    // login). It may still be skipped/blocked manually.
    if (step.code === LOGIN_STEP_CODE && next_status === "done") {
      res.status(422).json({
        error: "use-create-login",
        message: "Create the portal login via the Create Login action — that marks this step done.",
      });
      return;
    }
    await db
      .update(atelierOnboardingSteps)
      .set({
        status: next_status,
        completedAt: next_status === "done" ? new Date() : null,
        completedByUserId: next_status === "done" ? me.id : null,
        blockedReason: next_status === "blocked" ? (body.blockedReason ?? "blocked") : null,
        updatedAt: new Date(),
      })
      .where(eq(atelierOnboardingSteps.id, step.id));
    await audit({
      entityType: "onboarding_step",
      entityId: step.id,
      actor: me,
      action: `onboarding.step.${next_status}`,
      payload: { onboardingId: req.params.id, code: step.code },
      summary: `${me.name} marked onboarding step "${step.title}" → ${next_status}.`,
    });
    // After mutation, re-evaluate the parent sequence. The Onboarding
    // Concierge cannot complete the sequence with any compliance step
    // blocked or any non-skipped step still pending.
    const allSteps = await db
      .select()
      .from(atelierOnboardingSteps)
      .where(eq(atelierOnboardingSteps.onboardingId, req.params.id));
    const blockedCompliance = allSteps.find(
      (s) => s.isComplianceGate && s.status === "blocked",
    );
    const allFinal = allSteps.every(
      (s) => s.status === "done" || s.status === "skipped",
    );
    if (blockedCompliance) {
      await db
        .update(atelierOnboardings)
        .set({
          status: "blocked",
          blockedAt: new Date(),
          blockedReason: `compliance gate "${blockedCompliance.title}" is blocked`,
          updatedAt: new Date(),
        })
        .where(eq(atelierOnboardings.id, req.params.id));
    } else if (allFinal) {
      await db
        .update(atelierOnboardings)
        .set({
          status: "complete",
          completedAt: new Date(),
          blockedAt: null,
          blockedReason: null,
          updatedAt: new Date(),
        })
        .where(eq(atelierOnboardings.id, req.params.id));
      // Flip the person status from `onboarding` → `active`.
      const [onb] = await db
        .select()
        .from(atelierOnboardings)
        .where(eq(atelierOnboardings.id, req.params.id));
      if (onb) {
        const tbl =
          onb.personType === "employee"
            ? atelierEmployees
            : onb.personType === "contractor"
              ? atelierContractors
              : atelierPartnerFirmResources;
        await db
          .update(tbl)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(tbl.id, onb.personId));
      }
      await audit({
        entityType: "onboarding",
        entityId: req.params.id,
        actor: { id: "ag_onboarding_concierge", name: "Onboarding Concierge", role: "agent" },
        actorIsAgent: true,
        agentId: "ag_onboarding_concierge",
        action: "onboarding.completed",
        summary: `Onboarding Concierge completed sequence — person activated.`,
      });
    } else {
      // Re-open status if we previously blocked.
      await db
        .update(atelierOnboardings)
        .set({ status: "in_flight", blockedAt: null, blockedReason: null, updatedAt: new Date() })
        .where(eq(atelierOnboardings.id, req.params.id));
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Portal-login provisioning core (shared).
//
// Task #759 — extracted from the create-login route body so the quick-add
// flow can reuse the EXACT same login-creation path (credential row with
// unguessable placeholder hash + one-time activation token + welcome
// email + M365 provisioning). Logins are ONLY ever created through this
// helper; both callers keep their own ACL gates.
// -----------------------------------------------------------------

interface ProvisionLoginArgs {
  me: typeof atelierUsers.$inferSelect;
  person: {
    id: string;
    workerType: WorkerType;
    fullName: string;
    email: string | null;
    personId: string | null;
  };
  /** When provided, the login.created onboarding step is marked done and
   *  the sequence auto-completes if login was the last outstanding step. */
  onboarding: { id: string; personType: string; personId: string } | null;
  skipMsProvisioning?: boolean;
  msServiceProfile?: "employee" | "contractor" | null;
  /** Origin header of the calling request (for the activation link). */
  origin?: string | null;
  /**
   * Task #873 — when set, the login is an EXTERNAL alliance-partner
   * portal account: role becomes `alliance_partner`, the user row is
   * linked to this partner firm, no M365 provisioning, and no welcome
   * notification (partners never see the Me lens).
   */
  alliancePartnerFirmId?: string | null;
  /** Task #874 — firm display name for the partner registration email. */
  partnerFirmName?: string | null;
}

type ProvisionLoginResult =
  | { ok: false; status: number; body: Record<string, unknown> }
  | {
      ok: true;
      status: 201;
      body: {
        ok: true;
        userId: string;
        activationUrl: string;
        activationExpiresAt: string;
        welcomeEmail: unknown;
      };
    };

export async function provisionPortalLogin(args: ProvisionLoginArgs): Promise<ProvisionLoginResult> {
  const { me, person, onboarding } = args;
  const email = (person.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return { ok: false, status: 422, body: { error: "person-has-no-email" } };
  }
  // Task #873 security hardening — external alliance-partner logins must
  // NEVER reuse an existing user identity. resolveLinkedUserIdForPerson
  // matches by email without an org predicate, so reusing the row could
  // attach an activation link (and thus credentials) to an internal or
  // cross-org persona with its original privileges. Partner logins are
  // always freshly minted rows; any email collision is a hard 409.
  if (args.alliancePartnerFirmId) {
    const [collision] = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(eq(atelierUsers.email, email));
    if (collision) {
      return {
        ok: false,
        status: 409,
        body: { error: "email-taken", message: "A user already exists with that email." },
      };
    }
  }
  const existingUserId = args.alliancePartnerFirmId
    ? null
    : await resolveLinkedUserIdForPerson(person);
  if (existingUserId) {
    const [cred] = await db
      .select({ email: atelierAuthCredentials.email })
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.userId, existingUserId));
    if (cred) {
      return { ok: false, status: 409, body: { error: "login-already-exists" } };
    }
  }
  const [credByEmail] = await db
    .select({ email: atelierAuthCredentials.email })
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, email));
  if (credByEmail) {
    return {
      ok: false,
      status: 409,
      body: { error: "email-taken", message: "A login already exists for that email." },
    };
  }

  const initials =
    person.fullName
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase())
      .slice(0, 2)
      .join("") || "??";
  const isAlliancePartnerLogin = !!args.alliancePartnerFirmId;
  // Task #1297 — Non-Equity Partners are roster CONTRACTORS whose row
  // carries the "Non-Equity Partner" role label (matching the NEP contract
  // auto-add behaviour, Task #967). Their login gets the dedicated
  // `non_equity_partner` persona instead of the self-only `contractor` one.
  let isNepLogin = false;
  if (!isAlliancePartnerLogin && person.workerType === "contractor") {
    const [ct] = await db
      .select({ notes: atelierContractors.notes })
      .from(atelierContractors)
      .where(eq(atelierContractors.id, person.id));
    isNepLogin = /non[\s-]?equity\s+partner/i.test(ct?.notes ?? "");
  }
  const role = isAlliancePartnerLogin
    ? "alliance_partner"
    : person.workerType === "employee"
      ? "employee"
      : person.workerType === "contractor"
        ? isNepLogin
          ? "non_equity_partner"
          : "contractor"
        : "partner_firm_resource";
  const roleLabel = isAlliancePartnerLogin
    ? "Alliance Partner"
    : person.workerType === "employee"
      ? "Employee"
      : person.workerType === "contractor"
        ? isNepLogin
          ? "Non-Equity Partner"
          : "Contractor"
        : "Partner Firm Resource";
  // Security: no temporary password is ever generated, returned, or
  // emailed. The credential row is created with an unguessable random
  // hash (the account cannot sign in yet) and a one-time, short-TTL
  // activation token lets the joiner choose their own password.
  const activationToken = randomBytes(32).toString("hex");
  const activationTokenHash = createHash("sha256").update(activationToken).digest("hex");
  const activationExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const userId = existingUserId ?? rid("p_joiner");

  try {
  await db.transaction(async (tx) => {
    if (!existingUserId) {
      await tx.insert(atelierUsers).values({
        id: userId,
        orgId: me.orgId,
        email,
        name: person.fullName,
        // Task #538 — link the login row to the roster person record.
        personId: person.personId ?? null,
        initials,
        role,
        roleLabel,
        title: roleLabel,
        // Task #873 — link external alliance-partner logins to their firm.
        partnerFirmId: args.alliancePartnerFirmId ?? null,
      });
      if (!isAlliancePartnerLogin && person.workerType === "employee") {
        await tx
          .update(atelierEmployees)
          .set({ userId, updatedAt: new Date() })
          .where(eq(atelierEmployees.id, person.id));
      }
    }
    await tx.insert(atelierAuthCredentials).values({
      email,
      userId,
      // Placeholder hash of 48 random bytes that are immediately
      // discarded — sign-in is impossible until the activation link is
      // used to set a real password.
      passwordHash: hashPassword(randomBytes(48).toString("hex")),
      // user_managed=true: the boot seed must never overwrite this hash.
      userManaged: true,
      mustChangePassword: true,
      mustChangeReason: "joiner",
    });
    await tx.insert(atelierLoginActivationTokens).values({
      tokenHash: activationTokenHash,
      email,
      userId,
      createdByUserId: me.id,
      // Task #874 — partner logins get a registration-variant token: the
      // link opens the public partner registration page (company + bank
      // details + password) instead of the plain /activate password form.
      purpose: isAlliancePartnerLogin ? "partner_registration" : "activation",
      expiresAt: activationExpiresAt,
    });
    // Mark the login.created step done (if the sequence has one).
    if (onboarding) {
      const [loginStep] = await tx
        .select()
        .from(atelierOnboardingSteps)
        .where(
          and(
            eq(atelierOnboardingSteps.onboardingId, onboarding.id),
            eq(atelierOnboardingSteps.code, LOGIN_STEP_CODE),
          ),
        );
      if (loginStep && loginStep.status !== "done") {
        await tx
          .update(atelierOnboardingSteps)
          .set({
            status: "done",
            completedAt: new Date(),
            completedByUserId: me.id,
            blockedReason: null,
            updatedAt: new Date(),
          })
          .where(eq(atelierOnboardingSteps.id, loginStep.id));
      }
    }
    await tx.insert(atelierAuditEvents).values({
      id: `audit_${randomUUID()}`,
      entityType: onboarding ? "onboarding" : "person",
      entityId: onboarding ? onboarding.id : person.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "onboarding.login.created",
      payload: { personId: person.id, userId, email, workerType: person.workerType },
      payloadSummary: `${me.name} created the portal login for ${person.fullName} (${email}).`,
    });
    if (isAlliancePartnerLogin) return; // no Me-lens welcome for externals
    await emitSelfNotification(
      {
        orgId: me.orgId,
        userId,
        kind: "welcome",
        title: "Welcome to Cognirise",
        body: "Your workspace is ready. Start by reviewing your profile, then explore your Time and Expenses tabs.",
        href: "/me/profile",
      },
      tx,
    );
  });
  } catch (err) {
    // Task #873 — concurrent provisioning for the same email races past the
    // application-level pre-check; the atelier_auth_credentials.email
    // primary key serializes the winners and the loser's transaction rolls
    // back atomically (no orphan user row). Surface it as the same 409 the
    // pre-check would have produced, not a 500.
    const pgCode =
      (err as { code?: string })?.code ??
      ((err as { cause?: { code?: string } })?.cause?.code);
    if (pgCode === "23505") {
      return {
        ok: false,
        status: 409,
        body: { error: "email-taken", message: "A login already exists for that email." },
      };
    }
    throw err;
  }

  // Task #628 — Microsoft 365 provisioning rides on login creation but
  // never blocks it: the run fires in the background after commit, and
  // any tenant refusal lands on the ledger row + notifies founders/HR.
  // `skipMsProvisioning` is the "don't create an email address" tickbox.
  // Partner-firm resources use their own firm's tooling — no M365 account.
  if (person.workerType === "employee" || person.workerType === "contractor") {
    const skipMs = args.skipMsProvisioning === true;
    const msProfile =
      args.msServiceProfile === "employee" || args.msServiceProfile === "contractor"
        ? args.msServiceProfile
        : defaultProfileForWorkerType(person.workerType);
    try {
      await ensureProvisioningRow({
        orgId: me.orgId,
        personId: person.id,
        personType: person.workerType,
        userId,
        email,
        serviceProfile: msProfile,
      });
      if (!skipMs) {
        launchProvisioning({
          orgId: me.orgId,
          personId: person.id,
          actor: { id: me.id, name: me.name },
          serviceProfile: msProfile,
        });
      }
    } catch (err) {
      console.error("[create-login] M365 provisioning launch failed (non-fatal):", err);
    }
  }

  // If login was the last outstanding step, complete the sequence and
  // activate the person (same rule as the advance route).
  if (onboarding) {
    const allSteps = await db
      .select()
      .from(atelierOnboardingSteps)
      .where(eq(atelierOnboardingSteps.onboardingId, onboarding.id));
    const blockedCompliance = allSteps.some((s) => s.isComplianceGate && s.status === "blocked");
    const allFinal = allSteps.every((s) => s.status === "done" || s.status === "skipped");
    if (!blockedCompliance && allFinal) {
      await db
        .update(atelierOnboardings)
        .set({ status: "complete", completedAt: new Date(), blockedAt: null, blockedReason: null, updatedAt: new Date() })
        .where(eq(atelierOnboardings.id, onboarding.id));
      const tbl =
        onboarding.personType === "employee"
          ? atelierEmployees
          : onboarding.personType === "contractor"
            ? atelierContractors
            : atelierPartnerFirmResources;
      await db
        .update(tbl)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(tbl.id, onboarding.personId));
      await audit({
        entityType: "onboarding",
        entityId: onboarding.id,
        actor: { id: "ag_onboarding_concierge", name: "Onboarding Concierge", role: "agent" },
        actorIsAgent: true,
        agentId: "ag_onboarding_concierge",
        action: "onboarding.completed",
        summary: `Onboarding Concierge completed sequence — person activated.`,
      });
    }
  }

  // Welcome email — best-effort, after commit; never fails the request.
  let signInUrl: string | null = null;
  try {
    const parsedOrigin = new URL(args.origin?.trim() ?? "");
    if (parsedOrigin.protocol === "https:" || parsedOrigin.protocol === "http:") {
      signInUrl = parsedOrigin.origin;
    }
  } catch {
    // No/invalid Origin — omit the link.
  }
  // Task #874 — partner logins get a registration link (company + bank
  // details + password) instead of the plain activate link.
  const activationPath = isAlliancePartnerLogin ? "/partner-register" : "/activate";
  const activationUrl = signInUrl
    ? `${signInUrl}${activationPath}?token=${activationToken}`
    : `${activationPath}?token=${activationToken}`;
  const welcomeEmail = isAlliancePartnerLogin
    ? await sendPartnerRegistrationEmail({
        fullName: person.fullName,
        email,
        firmName: args.partnerFirmName ?? "your firm",
        registrationUrl: signInUrl ? activationUrl : null,
        validity: "72 hours",
        sender: { actor: { name: me.name, email: me.email } },
      })
    : await sendJoinerWelcomeEmail({
        fullName: person.fullName,
        email,
        activationUrl: signInUrl ? activationUrl : null,
        activationValidity: "72 hours",
        workerType: person.workerType === "employee" ? "employee" : "contractor",
        signInUrl,
        sender: { actor: { name: me.name, email: me.email } },
      });

  // The activation URL is returned once so HR can share it through a
  // secure channel when email delivery isn't configured. It is a
  // single-use, 72-hour token — never a password.
  return {
    ok: true,
    status: 201,
    body: {
      ok: true,
      userId,
      activationUrl,
      activationExpiresAt: activationExpiresAt.toISOString(),
      welcomeEmail,
    },
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/onboarding/:id/create-login", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const [onb] = await db
      .select()
      .from(atelierOnboardings)
      .where(and(eq(atelierOnboardings.id, req.params.id), isNull(atelierOnboardings.deletedAt)));
    if (!onb) {
      res.status(404).json({ error: "onboarding-not-found" });
      return;
    }
    if (onb.personId.startsWith("draft:")) {
      res.status(422).json({
        error: "invitation-not-accepted",
        message: "Mark the invitation accepted first — the login is created for the materialised person.",
      });
      return;
    }
    const person = await findPerson(onb.personId);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const rawBody = (req.body ?? {}) as {
      skipMsProvisioning?: unknown;
      msServiceProfile?: unknown;
    };
    const result = await provisionPortalLogin({
      me,
      person,
      onboarding: { id: onb.id, personType: onb.personType, personId: onb.personId },
      skipMsProvisioning: rawBody.skipMsProvisioning === true,
      msServiceProfile:
        rawBody.msServiceProfile === "employee" || rawBody.msServiceProfile === "contractor"
          ? rawBody.msServiceProfile
          : null,
      origin: req.get("origin") ?? null,
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
function exactIdentityConfirmed(body: unknown, fullName: string): boolean {
  return !!body && typeof body === "object" &&
    (body as { confirmName?: unknown }).confirmName === fullName;
}

function removalResponse(
  person: { id: string; workerType: WorkerType; fullName: string; email: string | null; personId: string | null },
  dependencies: RemovalDependency[],
) {
  return {
    person: { id: person.id, workerType: person.workerType, fullName: person.fullName },
    protected: isProtectedDemo(person),
    eligible: !isProtectedDemo(person) && dependencies.length === 0,
    dependencies,
  };
}

// @cli-skip: HR removal impact check remains route-authoritative until roster lifecycle conformance exists
router.get("/roster/people/:id/removal-check", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) return res.status(403).json({ error: "partner-or-operations-only" });
    const person = await findPerson(req.params.id, me.orgId);
    if (!person) return res.status(404).json({ error: "person-not-found" });
    if (rejectUnsupportedRemovalType(person, res)) return;
    return res.json(removalResponse(person, await removalDependencies(person, me.orgId)));
  } catch (err) { return next(err); }
});

// @cli-skip: HR person archive is an audited lifecycle workflow; assistant authority parity is unproven
router.post("/roster/people/:id/archive", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) return res.status(403).json({ error: "partner-or-operations-only" });
    const person = await findPerson(req.params.id, me.orgId);
    if (!person) return res.status(404).json({ error: "person-not-found" });
    if (rejectUnsupportedRemovalType(person, res)) return;
    if (isProtectedDemo(person)) return res.status(403).json({ error: "demo-person-protected" });
    if (!exactIdentityConfirmed(req.body, person.fullName)) {
      return res.status(400).json({ error: "identity-confirmation-required", expected: person.fullName });
    }
    const now = new Date();
    const userId = await resolveLinkedUserIdForPerson(person, db, me.orgId);
    await db.transaction(async (tx) => {
      const endDate = (req.body as { endDate?: string }).endDate ?? null;
      let affected;
      if (person.workerType === "employee") {
        affected = await tx.update(atelierEmployees).set({ status: "offboarded", employmentStatus: "terminated", endDate, updatedAt: now })
          .where(and(eq(atelierEmployees.id, person.id), eq(atelierEmployees.orgId, me.orgId)));
      } else {
        affected = await tx.update(atelierContractors).set({ status: "offboarded", endDate, updatedAt: now })
          .where(and(eq(atelierContractors.id, person.id), eq(atelierContractors.orgId, me.orgId)));
      }
      if (affected.rowCount !== 1) throw new Error("roster-row-not-affected");
      if (userId) {
        const [linkedUser] = await tx.select({ id: atelierUsers.id }).from(atelierUsers)
          .where(and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, me.orgId)));
        if (!linkedUser) throw new Error("linked-user-org-mismatch");
        await tx.update(atelierEngagementAccess).set({ status: "revoked", deletedAt: now }).where(eq(atelierEngagementAccess.userId, userId));
        await tx.update(atelierAuthCredentials).set({ disabled: true, mustChangePassword: false, updatedAt: now }).where(eq(atelierAuthCredentials.userId, userId));
        await tx.delete(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.userId, userId));
        await tx.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, userId));
      }
      assertAuditAction("roster.person.archived");
      await tx.insert(atelierAuditEvents).values({
        id: rid("aud"), orgId: me.orgId, entityType: "person", entityId: person.id,
        actorType: "human", actorId: me.id, actorLabel: me.name,
        action: "roster.person.archived",
        payload: { workerType: person.workerType, userId, reason: (req.body as { reason?: string }).reason ?? null },
        payloadSummary: `${me.name} archived ${person.fullName}; access and sessions revoked.`,
      });
    });
    return res.json({ ok: true, action: "archived", personId: person.id, accessRevoked: !!userId });
  } catch (err) { return next(err); }
});

// @cli-skip: permanent person removal is destructive HR work; assistant authority is not approved
router.delete("/roster/people/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) return res.status(403).json({ error: "partner-or-operations-only" });
    const person = await findPerson(req.params.id, me.orgId);
    if (!person) return res.status(404).json({ error: "person-not-found" });
    if (rejectUnsupportedRemovalType(person, res)) return;
    if (isProtectedDemo(person)) return res.status(403).json({ error: "demo-person-protected" });
    if (!exactIdentityConfirmed(req.body, person.fullName)) {
      return res.status(400).json({ error: "identity-confirmation-required", expected: person.fullName });
    }
    const dependencies = await removalDependencies(person, me.orgId);
    if (dependencies.length > 0) {
      return res.status(409).json({ error: "person-has-history", message: "This person must be archived/offboarded.", ...removalResponse(person, dependencies) });
    }
    const userId = await resolveLinkedUserIdForPerson(person, db, me.orgId);
    let dependenciesInsideTransaction: RemovalDependency[] = [];
    await db.transaction(async (tx) => {
      // Serialize removal attempts for this roster id, then perform the
      // eligibility read through the transaction handle. This closes the
      // preflight/delete TOCTOU window when another actor adds history.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${me.orgId}:roster:${person.id}`}))`);
      dependenciesInsideTransaction = await removalDependencies(person, me.orgId, tx);
      if (dependenciesInsideTransaction.length > 0) return;
      await tx.delete(atelierRosterReportsTo).where(or(eq(atelierRosterReportsTo.personId, person.id), eq(atelierRosterReportsTo.managerPersonId, person.id)));
      await tx.delete(atelierConflictDisclosures).where(eq(atelierConflictDisclosures.personId, person.id));
      await tx.delete(atelierPersonDocuments).where(eq(atelierPersonDocuments.personId, person.id));
      await tx.delete(atelierDependents).where(eq(atelierDependents.personId, person.id));
      await tx.delete(atelierEmergencyContacts).where(eq(atelierEmergencyContacts.personId, person.id));
      let affected;
      if (person.workerType === "employee") {
        affected = await tx.delete(atelierEmployees).where(and(eq(atelierEmployees.id, person.id), eq(atelierEmployees.orgId, me.orgId)));
      } else {
        affected = await tx.delete(atelierContractors).where(and(eq(atelierContractors.id, person.id), eq(atelierContractors.orgId, me.orgId)));
      }
      if (affected.rowCount !== 1) throw new Error("roster-row-not-affected");
      if (userId) {
        const [linkedUser] = await tx.select({ id: atelierUsers.id }).from(atelierUsers)
          .where(and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, me.orgId)));
        if (!linkedUser) throw new Error("linked-user-org-mismatch");
        await tx.delete(atelierEngagementAccess).where(eq(atelierEngagementAccess.userId, userId));
        await tx.delete(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.userId, userId));
        await tx.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, userId));
        await tx.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.userId, userId));
      }
      if (person.personId) await tx.delete(atelierPersons).where(and(eq(atelierPersons.id, person.personId), eq(atelierPersons.orgId, me.orgId)));
      assertAuditAction("roster.person.removed");
      await tx.insert(atelierAuditEvents).values({
        id: rid("aud"), orgId: me.orgId, entityType: "person", entityId: person.id,
        actorType: "human", actorId: me.id, actorLabel: me.name, action: "roster.person.removed",
        payload: { workerType: person.workerType, userId, confirmedName: person.fullName },
        payloadSummary: `${me.name} permanently removed pristine ${person.workerType} ${person.fullName}.`,
      });
    });
    if (dependenciesInsideTransaction.length > 0) {
      return res.status(409).json({
        error: "person-has-history",
        message: "History was added while this removal was being confirmed; archive/offboard instead.",
        ...removalResponse(person, dependenciesInsideTransaction),
      });
    }
    return res.json({ ok: true, action: "removed", personId: person.id, accessRevoked: !!userId });
  } catch (err) { return next(err); }
});

// /roster/people — quick add (Task #759)
//
// Streamlined direct create for people who are ALREADY hired (or
// historical joiners): one dialog, no candidate/offer/invitation
// prerequisite. The formal pipeline (candidates → offers → invitations
// → onboarding) remains untouched for formal recruits.
// -----------------------------------------------------------------

// @cli-skip: bespoke roster admin dialog; chat parity not planned
router.post("/roster/people", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Same gate as invitation creation.
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const body = req.body as {
      workerType?: string;
      fullName?: string;
      honorific?: string | null;
      firstName?: string;
      middleName?: string | null;
      lastName?: string;
      preferredName?: string | null;
      email?: string;
      role?: string | null;
      seniority?: string | null;
      title?: string | null;
      country?: string | null;
      startDate?: string | null;
      legalEntityId?: string | null;
      vendorEntity?: string | null;
      managerPersonId?: string | null;
      runOnboarding?: boolean;
      createLogin?: boolean;
      skipMsProvisioning?: boolean;
      msServiceProfile?: string | null;
    };
    if (
      req.body &&
      typeof req.body === "object" &&
      "employingEntity" in (req.body as Record<string, unknown>)
    ) {
      res.status(422).json({
        error: "legacy-employing-entity-not-accepted",
        message: "Choose a registered legal entity; free-text employing entities are not accepted.",
      });
      return;
    }
    const wt = body.workerType;
    if (wt !== "employee" && wt !== "contractor") {
      // Partner-firm resources always flow through the partner-firm
      // registry + invitation pipeline (firm linkage is mandatory there).
      res.status(400).json({ error: "invalid-worker-type", message: "Quick add supports employee or contractor." });
      return;
    }
    let structured: StructuredName | null = null;
    try {
      structured = resolveStructuredNameInput({
        fullName: body.fullName ?? undefined,
        honorific: body.honorific,
        firstName: body.firstName ?? undefined,
        middleName: body.middleName,
        lastName: body.lastName ?? undefined,
        preferredName: body.preferredName,
      });
    } catch (err) {
      if (err instanceof PersonNameValidationError) {
        res.status(400).json({ error: "invalid-name", message: err.message });
        return;
      }
      throw err;
    }
    if (!structured) {
      res.status(400).json({ error: "invalid-name", message: "name required" });
      return;
    }
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) {
      res.status(400).json({ error: "invalid-email", message: "A valid email is required." });
      return;
    }
    const startDate = (body.startDate ?? "").trim() || null;
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      res.status(400).json({ error: "invalid-start-date" });
      return;
    }
    // Duplicate guard — an existing (non-deleted) roster person with the
    // same email is almost certainly the same human.
    const [dupEmp] = await db
      .select({ id: atelierEmployees.id })
      .from(atelierEmployees)
      .where(and(sql`lower(${atelierEmployees.email}) = ${email}`, isNull(atelierEmployees.deletedAt)));
    const [dupCtr] = await db
      .select({ id: atelierContractors.id })
      .from(atelierContractors)
      .where(and(sql`lower(${atelierContractors.email}) = ${email}`, isNull(atelierContractors.deletedAt)));
    const dup = dupEmp ?? dupCtr;
    if (dup) {
      res.status(409).json({
        error: "email-already-on-roster",
        message: "A roster person with this email already exists.",
        personId: dup.id,
      });
      return;
    }
    // Optional manager — must be an existing (non-deleted) employee.
    const managerPersonId = (body.managerPersonId ?? "").trim() || null;
    if (managerPersonId) {
      if (managerPersonId === "emp_demo_reviewer") {
        res.status(400).json({ error: "protected-demo-cannot-be-manager" });
        return;
      }
      const [mgr] = await db
        .select({ id: atelierEmployees.id })
        .from(atelierEmployees)
        .where(and(eq(atelierEmployees.id, managerPersonId), isNull(atelierEmployees.deletedAt)));
      if (!mgr) {
        res.status(400).json({ error: "manager-not-found" });
        return;
      }
    }
    const runOnboarding = body.runOnboarding === true;
    const status = runOnboarding ? "onboarding" : "active";
    const legalEntityId =
      wt === "employee" ? body.legalEntityId?.trim() || null : null;
    if (
      legalEntityId &&
      !(await findActiveEmployingEntity(me.orgId, legalEntityId))
    ) {
      res.status(422).json({ error: "legal-entity-not-found" });
      return;
    }

    // Person row (structured-name SoT) + roster row.
    const personWrite = await writePersonAndSync(db, {
      orgId: me.orgId,
      structured,
      sourceKind: wt,
      createdByUserId: me.id,
    });
    let personId: string;
    if (wt === "employee") {
      personId = `emp_${rid("x").slice(2)}`;
      await db.insert(atelierEmployees).values({
        id: personId,
        orgId: me.orgId,
        personId: personWrite.personId,
        fullName: personWrite.fullName,
        preferredName: personWrite.structured.preferredName ?? null,
        email,
        role: body.role?.trim() || "consultant",
        seniority: body.seniority?.trim() || "consultant",
        title: body.title?.trim() || null,
        country: body.country?.trim() || null,
        startDate,
        legalEntityId,
        status,
      });
    } else {
      personId = `ctr_${rid("x").slice(2)}`;
      await db.insert(atelierContractors).values({
        id: personId,
        orgId: me.orgId,
        personId: personWrite.personId,
        fullName: personWrite.fullName,
        email,
        country: body.country?.trim() || null,
        vendorEntity: body.vendorEntity?.trim() || null,
        startDate,
        status,
      });
    }
    if (managerPersonId) {
      await db.insert(atelierRosterReportsTo).values({
        id: rid("rrt"),
        orgId: me.orgId,
        personId,
        managerPersonId,
        createdByUserId: me.id,
      });
      await audit({
        entityType: "person",
        entityId: personId,
        actor: me,
        action: "roster.reports_to.set",
        payload: { managerPersonId, via: "quick_add" },
        summary: `${me.name} set the manager for ${personWrite.fullName} during quick add.`,
      });
    }
    await audit({
      entityType: "person",
      entityId: personId,
      actor: me,
      action: "roster.person.created",
      payload: {
        method: "quick_add",
        workerType: wt,
        status,
        email,
        title: body.title ?? null,
        country: body.country ?? null,
        startDate,
        managerPersonId,
        runOnboarding,
        createLogin: body.createLogin === true,
      },
      summary: `${me.name} quick-added ${personWrite.fullName} (${wt}, ${status}) directly to the roster.`,
    });

    // Optional onboarding checklist (same sequence the formal flow uses).
    let onboardingId: string | null = null;
    if (runOnboarding) {
      onboardingId = await startOnboardingSequence({
        personId,
        workerType: wt,
        targetStartDate: startDate,
        ownerUserId: me.id,
      });
    }

    // Optional welcome invitation + portal login — the SAME provisioning
    // path the onboarding create-login step uses. A login failure never
    // rolls back the roster person; it's reported in the response.
    let login: Record<string, unknown> | null = null;
    if (body.createLogin === true) {
      const result = await provisionPortalLogin({
        me,
        person: {
          id: personId,
          workerType: wt,
          fullName: personWrite.fullName,
          email,
          personId: personWrite.personId,
        },
        onboarding: onboardingId
          ? { id: onboardingId, personType: wt, personId }
          : null,
        skipMsProvisioning: body.skipMsProvisioning === true,
        msServiceProfile:
          body.msServiceProfile === "employee" || body.msServiceProfile === "contractor"
            ? body.msServiceProfile
            : null,
        origin: req.get("origin") ?? null,
      });
      login = result.ok
        ? { ...result.body }
        : { ok: false, ...result.body };
    }

    res.status(201).json({
      ok: true,
      id: personId,
      personId: personWrite.personId,
      workerType: wt,
      fullName: personWrite.fullName,
      displayName: personWrite.displayName,
      status,
      onboardingId,
      login,
    });
  } catch (err) {
    next(err);
  }
});


// -----------------------------------------------------------------
// /roster/offboarding
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/offboarding", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Per PRD §6, the offboarding pane shows active sequences by default.
    // Pass ?status=all to include completed (audit-pack-signed) rows.
    const includeAll = String(req.query.status ?? "active") === "all";
    const offs = await db
      .select()
      .from(atelierOffboardings)
      .where(
        includeAll
          ? isNull(atelierOffboardings.deletedAt)
          : and(
              isNull(atelierOffboardings.deletedAt),
              ne(atelierOffboardings.status, "complete"),
            ),
      )
      .orderBy(desc(atelierOffboardings.initiatedAt));
    const stepsByOff = new Map<string, (typeof atelierOffboardingSteps.$inferSelect)[]>();
    if (offs.length > 0) {
      const all = await db
        .select()
        .from(atelierOffboardingSteps)
        .where(isNull(atelierOffboardingSteps.deletedAt));
      for (const s of all) {
        const list = stepsByOff.get(s.offboardingId) ?? [];
        list.push(s);
        stepsByOff.set(s.offboardingId, list);
      }
    }
    const out = await Promise.all(
      offs.map(async (o) => {
        const person = await findPerson(o.personId);
        const steps = (stepsByOff.get(o.id) ?? []).sort((a, b) => a.sortKey - b.sortKey);
        const done = steps.filter((s) => s.status === "done").length;
        return {
          id: o.id,
          personId: o.personId,
          personType: o.personType,
          personName: person?.fullName ?? o.personId,
          status: o.status,
          lastWorkingDate: o.lastWorkingDate,
          initiatedAt: o.initiatedAt.toISOString(),
          completedAt: o.completedAt?.toISOString() ?? null,
          blockedReason: o.blockedReason,
          auditPackUrl: o.auditPackUrl,
          auditPackSignedAt: o.auditPackSignedAt?.toISOString() ?? null,
          progress: { done, total: steps.length },
          steps: steps.map((s) => ({
            id: s.id,
            code: s.code,
            title: s.title,
            ownerRole: s.ownerRole,
            deadline: s.deadline,
            status: s.status,
            isReassignmentGate: s.isReassignmentGate,
            completedAt: s.completedAt?.toISOString() ?? null,
            blockedReason: s.blockedReason,
          })),
        };
      }),
    );
    res.json({ offboardings: out });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/offboarding", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const body = req.body as {
      personId?: string;
      lastWorkingDate?: string;
      reason?: string;
    };
    if (!body.personId) {
      res.status(400).json({ error: "personId required" });
      return;
    }
    const person = await findPerson(body.personId);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const id = await startOffboardingSequence({
      personId: person.id,
      workerType: person.workerType,
      initiatedByUserId: me.id,
      lastWorkingDate: body.lastWorkingDate ?? null,
      reason: body.reason ?? null,
    });
    await audit({
      entityType: "offboarding",
      entityId: id,
      actor: me,
      action: "offboarding.initiated",
      payload: { personId: person.id, reason: body.reason ?? null },
      summary: `${me.name} initiated offboarding of ${person.fullName}.`,
    });
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/offboarding/:id/steps/:stepId/advance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canManageLifecycle(me)) {
      res.status(403).json({ error: "lifecycle-manage-forbidden" });
      return;
    }
    const body = req.body as { status?: string; blockedReason?: string };
    const next_status = body.status ?? "done";
    if (!["in_progress", "done", "blocked", "skipped"].includes(next_status)) {
      res.status(400).json({ error: "invalid-status" });
      return;
    }
    const [step] = await db
      .select()
      .from(atelierOffboardingSteps)
      .where(
        and(
          eq(atelierOffboardingSteps.id, req.params.stepId),
          eq(atelierOffboardingSteps.offboardingId, req.params.id),
        ),
      );
    if (!step) {
      res.status(404).json({ error: "step-not-found" });
      return;
    }
    // Reassignment gate — cannot mark done unless the person has no remaining
    // active engagement_access grants (the engagement_lead must explicitly
    // revoke or reassign first).
    if (step.isReassignmentGate && next_status === "done") {
      const [off] = await db
        .select()
        .from(atelierOffboardings)
        .where(eq(atelierOffboardings.id, req.params.id));
      if (off) {
        const person = await findPerson(off.personId);
        const userId = person ? await resolveLinkedUserIdForPerson(person) : null;
        if (userId) {
          const remaining = await db
            .select({ id: atelierEngagementAccess.id })
            .from(atelierEngagementAccess)
            .where(
              and(
                eq(atelierEngagementAccess.userId, userId),
                eq(atelierEngagementAccess.status, "active"),
                isNull(atelierEngagementAccess.deletedAt),
              ),
            );
          if (remaining.length > 0) {
            res.status(422).json({
              error: "reassignments-still-pending",
              pendingGrants: remaining.length,
            });
            return;
          }
        }
      }
    }
    await db
      .update(atelierOffboardingSteps)
      .set({
        status: next_status,
        completedAt: next_status === "done" ? new Date() : null,
        completedByUserId: next_status === "done" ? me.id : null,
        blockedReason: next_status === "blocked" ? (body.blockedReason ?? "blocked") : null,
        updatedAt: new Date(),
      })
      .where(eq(atelierOffboardingSteps.id, step.id));
    await audit({
      entityType: "offboarding_step",
      entityId: step.id,
      actor: me,
      action: `offboarding.step.${next_status}`,
      payload: { offboardingId: req.params.id, code: step.code },
      summary: `${me.name} marked offboarding step "${step.title}" → ${next_status}.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/offboarding/:id/finalize", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartner(me)) {
      res.status(403).json({ error: "partner-signature-required" });
      return;
    }
    const [off] = await db
      .select()
      .from(atelierOffboardings)
      .where(and(eq(atelierOffboardings.id, req.params.id), isNull(atelierOffboardings.deletedAt)));
    if (!off) {
      res.status(404).json({ error: "offboarding-not-found" });
      return;
    }
    const steps = await db
      .select()
      .from(atelierOffboardingSteps)
      .where(eq(atelierOffboardingSteps.offboardingId, off.id));
    // The audit-pack step itself is signed BY this action, so we exclude it
    // from the "all done" check (every other step must be done|skipped).
    const blocking = steps.filter(
      (s) => s.code !== "audit.pack.signed" && s.status !== "done" && s.status !== "skipped",
    );
    if (blocking.length > 0) {
      res.status(422).json({
        error: "offboarding-incomplete",
        blockingSteps: blocking.map((s) => ({ id: s.id, title: s.title, status: s.status })),
      });
      return;
    }
    // Independent reassignment-gate enforcement at finalize time: even if
    // every step shows done/skipped, refuse to sign off while the linked
    // atelier_user still holds active engagement_access grants. This closes
    // the race where the gate step was skipped or marked done before grants
    // were actually rolled.
    {
      const personForCheck = await findPerson(off.personId);
      const userIdForCheck = personForCheck ? await resolveLinkedUserIdForPerson(personForCheck) : null;
      if (userIdForCheck) {
        {
          const activeGrants = await db
            .select({
              id: atelierEngagementAccess.id,
              engagementId: atelierEngagementAccess.engagementId,
            })
            .from(atelierEngagementAccess)
            .where(
              and(
                eq(atelierEngagementAccess.userId, userIdForCheck),
                eq(atelierEngagementAccess.status, "active"),
              ),
            );
          if (activeGrants.length > 0) {
            res.status(422).json({
              error: "reassignments-still-pending",
              activeGrants,
              hint: "Revoke or reassign all active engagement grants before signing the audit pack.",
            });
            return;
          }
        }
      }
    }
    // Sign the audit-pack step + flip the parent + flip person → former.
    const auditPackStep = steps.find((s) => s.code === "audit.pack.signed");
    if (auditPackStep) {
      await db
        .update(atelierOffboardingSteps)
        .set({
          status: "done",
          completedAt: new Date(),
          completedByUserId: me.id,
          updatedAt: new Date(),
        })
        .where(eq(atelierOffboardingSteps.id, auditPackStep.id));
    }
    const auditUrl = `/api/atelier/audit/export.pdf?entityType=offboarding&entityId=${off.id}`;
    await db
      .update(atelierOffboardings)
      .set({
        status: "complete",
        completedAt: new Date(),
        auditPackUrl: auditUrl,
        auditPackSignedByUserId: me.id,
        auditPackSignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierOffboardings.id, off.id));
    // Flip person status → former (never delete).
    const tbl =
      off.personType === "employee"
        ? atelierEmployees
        : off.personType === "contractor"
          ? atelierContractors
          : atelierPartnerFirmResources;
    await db
      .update(tbl)
      .set({ status: "former", endDate: isoDate(new Date()), updatedAt: new Date() })
      .where(eq(tbl.id, off.personId));
    // Auto-revoke any remaining grants the linked atelier_user holds, and
    // record cross-system revocation actions so a downstream provisioning
    // worker can pick them up. Each side-effect emits its own audit row so
    // the offboarding pack reflects exactly which systems were torn down.
    const person = await findPerson(off.personId);
    const linkedUserId = person ? await resolveLinkedUserIdForPerson(person) : null;
    if (person && linkedUserId) {
      {
        const revoked = await db
          .update(atelierEngagementAccess)
          .set({ status: "revoked", endDate: new Date() })
          .where(
            and(
              eq(atelierEngagementAccess.userId, linkedUserId),
              eq(atelierEngagementAccess.status, "active"),
            ),
          )
          .returning({ id: atelierEngagementAccess.id });
        await audit({
          entityType: "offboarding",
          entityId: off.id,
          actor: me,
          action: "offboarding.revoke.atelier_access",
          payload: { userId: linkedUserId, revokedGrantIds: revoked.map((r) => r.id) },
          summary: `Atelier engagement access revoked for ${person.fullName} (${revoked.length} grants).`,
        });
      }
      // Cross-system revocation hooks (Salons, agents, email/SSO). These
      // currently emit auditable intent rows that a provisioning worker
      // consumes; the integrations themselves are stubbed but the audit
      // trail captures every intended teardown for compliance review.
      for (const sys of [
        { action: "offboarding.revoke.salon_workspace", label: "Salon workspace access" },
        { action: "offboarding.revoke.agent_runners", label: "Agent runner credentials" },
        { action: "offboarding.revoke.sso_email", label: "SSO + corporate email" },
      ]) {
        await audit({
          entityType: "offboarding",
          entityId: off.id,
          actor: me,
          action: sys.action,
          payload: { email: person.email, personId: person.id },
          summary: `${sys.label} marked for revocation for ${person.fullName} (${person.email}).`,
        });
      }
    }
    // Explicit audit-pack render pipeline: emit an Offboarding Sentinel
    // agent run that records the audit.export tool invocation against the
    // already-wired auditPdfHandler. The renderer returns a Partner-signed
    // PDF when the URL is fetched; this run captures the assembly intent so
    // reviewers can trace from finalize → render call → served PDF.
    const renderRunId = rid("run");
    await db.insert(atelierAgentRuns).values({
      id: renderRunId,
      agentId: "ag_offboarding_sentinel",
      triggeredByUserId: me.id,
      targetType: "offboarding",
      targetId: off.id,
      targetLabel: `audit pack ${off.id}`,
      inputs: { offboardingId: off.id, partnerUserId: me.id },
      output: { auditPackUrl: auditUrl, format: "pdf" },
      steps: [
        { idx: 0, code: "assemble_audit_events", description: "Collect every audit row keyed to offboarding entity" },
        { idx: 1, code: "render_pdf", description: "PDFKit renderer (auditPdfHandler) with Partner signature line" },
        { idx: 2, code: "stamp_signed_url", description: "Persist auditPackUrl + auditPackSignedByUserId on offboarding row" },
      ],
      toolCalls: [
        { tool: "audit.export", args: { entityType: "offboarding", entityId: off.id, format: "pdf" }, result: { url: auditUrl } },
        { tool: "partner.sign", args: { partnerUserId: me.id }, result: { signedAt: new Date().toISOString() } },
      ],
      confidence: "green",
      status: "complete",
      statusMessage: "Audit pack rendered and Partner-signed",
      progressPct: 100,
    });
    await audit({
      entityType: "offboarding",
      entityId: off.id,
      actor: me,
      action: "offboarding.finalized",
      payload: { auditUrl, renderRunId },
      summary: `${me.name} (Partner) signed audit pack for offboarding ${off.id}; person → former.`,
    });
    res.json({ ok: true, auditPackUrl: auditUrl, renderRunId });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// /roster/compliance
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/compliance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — compliance registers hold visa/work-permit/insurance PII;
    // restricted to sensitive-people viewers (founding_partner | hr).
    if (!canViewSensitivePeopleData(me.role)) {
      res.status(403).json({ error: "sensitive-people-forbidden" });
      return;
    }
    const horizon = Number(req.query.horizonDays ?? 90);
    const horizonDate = isoDate(new Date(Date.now() + horizon * 86400_000));
    const todayStr = isoDate(new Date());
    const records = await db
      .select()
      .from(atelierComplianceRecords)
      .where(isNull(atelierComplianceRecords.deletedAt))
      .orderBy(atelierComplianceRecords.expiryDate);
    const enriched = await Promise.all(
      records.map(async (r) => {
        const person = r.personId ? await findPerson(r.personId) : null;
        let bucket: "expired" | "expiring_30" | "expiring_60" | "expiring_90" | "ok" = "ok";
        if (r.expiryDate) {
          if (r.expiryDate < todayStr) bucket = "expired";
          else {
            const days = Math.floor((new Date(r.expiryDate).getTime() - Date.now()) / 86400_000);
            if (days <= 30) bucket = "expiring_30";
            else if (days <= 60) bucket = "expiring_60";
            else if (days <= 90) bucket = "expiring_90";
          }
        }
        return {
          id: r.id,
          kind: r.kind,
          jurisdiction: r.jurisdiction,
          // Task #1171 — trust the resolved person's actual worker type
          // over the stored (possibly blank/stale) personType so partner
          // records can't leak into worker buckets or vice versa.
          personType: person?.workerType ?? r.personType,
          personId: r.personId,
          personName: person?.fullName ?? null,
          partnerFirmId: r.partnerFirmId,
          referenceNumberRedacted: r.referenceNumberRedacted,
          referenceNumberLastFour: r.referenceNumberLastFour,
          issuedDate: r.issuedDate,
          expiryDate: r.expiryDate,
          status: r.status,
          metadata: r.metadata,
          bucket,
        };
      }),
    );
    // Task #1172 — firm-document expiries surface read-time here (never
    // persisted as atelier_compliance_records rows). Only ACCEPTED,
    // non-deleted firm documents that carry an expiryDate become pseudo
    // records. They have no personId + a partnerFirmId, so isPartnerRecord
    // matches and they count into partnerBuckets.
    const bucketFor = (expiryDate: string | null): typeof enriched[number]["bucket"] => {
      if (!expiryDate) return "ok";
      if (expiryDate < todayStr) return "expired";
      const days = Math.floor((new Date(expiryDate).getTime() - Date.now()) / 86400_000);
      if (days <= 30) return "expiring_30";
      if (days <= 60) return "expiring_60";
      if (days <= 90) return "expiring_90";
      return "ok";
    };
    const firmDocs = await db
      .select()
      .from(atelierPartnerFirmDocuments)
      .where(
        and(
          eq(atelierPartnerFirmDocuments.orgId, me.orgId),
          eq(atelierPartnerFirmDocuments.reviewStatus, "accepted"),
          isNull(atelierPartnerFirmDocuments.deletedAt),
        ),
      );
    for (const d of firmDocs) {
      if (!d.expiryDate) continue;
      enriched.push({
        id: d.id,
        kind: `firm_doc:${d.kind}`,
        jurisdiction: null,
        personType: null,
        personId: null,
        personName: null,
        partnerFirmId: d.partnerFirmId,
        referenceNumberRedacted: null,
        referenceNumberLastFour: null,
        issuedDate: d.issuedDate ?? null,
        expiryDate: d.expiryDate,
        status: "active",
        metadata: { firmDocument: true, title: d.title ?? null, fileName: d.fileName } as never,
        bucket: bucketFor(d.expiryDate),
      });
    }
    // Roll-ups. Task #1171 — partner-firm records (partner_firm_resource
    // people or firm-level records tied to a partner firm) are counted in
    // their own roll-up so the worker buckets only reflect our own
    // employees/contractors and Cognirise entity-level registrations.
    const isPartnerRecord = (r: (typeof enriched)[number]) =>
      r.personType === "partner_firm_resource" || (!r.personId && !!r.partnerFirmId);
    const buckets = { expired: 0, expiring_30: 0, expiring_60: 0, expiring_90: 0, ok: 0 };
    const partnerBuckets = { expired: 0, expiring_30: 0, expiring_60: 0, expiring_90: 0, ok: 0 };
    for (const r of enriched) (isPartnerRecord(r) ? partnerBuckets : buckets)[r.bucket]++;
    const saudization = enriched
      .filter((r) => r.kind === "saudization")
      .map((r) => ({
        id: r.id,
        partnerFirmId: r.partnerFirmId,
        required: r.metadata?.saudizationQuotaRequired ?? null,
        actual: r.metadata?.saudizationQuotaActual ?? null,
        status: r.status,
      }));
    res.json({
      horizonDays: horizon,
      horizonDate,
      buckets,
      partnerBuckets,
      records: enriched,
      saudization,
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/compliance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — sensitive-people viewers only (founding_partner | hr).
    if (!canViewSensitivePeopleData(me.role)) {
      res.status(403).json({ error: "sensitive-people-forbidden" });
      return;
    }
    const body = req.body as {
      personType?: WorkerType | null;
      personId?: string | null;
      partnerFirmId?: string | null;
      kind?: string;
      jurisdiction?: string;
      referenceNumber?: string; // raw — redacted server-side, never persisted
      issuedDate?: string;
      expiryDate?: string;
      metadata?: Record<string, unknown>;
    };
    if (!body.kind) {
      res.status(400).json({ error: "kind required" });
      return;
    }
    const id = rid("cmp");
    const { redacted, lastFour } = redactReference(body.referenceNumber);
    // Task #1171 — when a person is attached, derive personType from the
    // actual roster row instead of trusting the request, so records are
    // never mislabeled across the worker/partner boundary.
    let personType = body.personType ?? null;
    if (body.personId) {
      const resolved = await findPerson(body.personId);
      if (!resolved) {
        res.status(400).json({ error: "unknown personId" });
        return;
      }
      personType = resolved.workerType;
    }
    await db.insert(atelierComplianceRecords).values({
      id,
      personType,
      personId: body.personId ?? null,
      partnerFirmId: body.partnerFirmId ?? null,
      kind: body.kind,
      jurisdiction: body.jurisdiction ?? null,
      referenceNumberRedacted: redacted,
      referenceNumberLastFour: lastFour,
      // The raw reference number is dropped server-side by redactReference()
      // and never reaches this row. The flag is the on-row contract that
      // downstream consumers (e.g. exports) check before serialising.
      encryptedAtRest: true,
      issuedDate: body.issuedDate ?? null,
      expiryDate: body.expiryDate ?? null,
      status: "active",
      metadata: (body.metadata ?? {}) as Record<string, unknown>,
      createdByUserId: me.id,
    });
    await audit({
      entityType: "compliance_record",
      entityId: id,
      actor: me,
      action: "compliance.recorded",
      payload: { kind: body.kind, jurisdiction: body.jurisdiction, lastFour },
      summary: `${me.name} recorded ${body.kind} compliance entry${lastFour ? ` (••${lastFour})` : ""}.`,
    });
    res.json({ ok: true, id, referenceNumberRedacted: redacted });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// /roster/people/:id/conflicts (mutate)
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/people/:id/conflicts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me) && me.role !== "senior_manager") { // Task #292
      res.status(403).json({ error: "partner-ops-or-lead-only" });
      return;
    }
    const person = await findPerson(req.params.id);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const body = req.body as {
      disclosureText?: string;
      declaredParty?: string;
      nature?: string;
      scopeImpact?: string;
      notes?: string;
    };
    if (!body.disclosureText?.trim() || !body.declaredParty?.trim()) {
      res.status(400).json({ error: "disclosureText + declaredParty required" });
      return;
    }
    const id = rid("conf");
    await db.insert(atelierConflictDisclosures).values({
      id,
      personType: person.workerType,
      personId: person.id,
      disclosureText: body.disclosureText.trim(),
      declaredParty: body.declaredParty.trim(),
      nature: body.nature ?? null,
      scopeImpact: body.scopeImpact ?? null,
      status: "active",
      notes: body.notes ?? null,
      createdByUserId: me.id,
    });
    await audit({
      entityType: "conflict_disclosure",
      entityId: id,
      actor: me,
      action: "conflict.declared",
      payload: { personId: person.id, declaredParty: body.declaredParty },
      summary: `${me.name} declared conflict for ${person.fullName} on ${body.declaredParty}.`,
    });
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.patch("/roster/people/:id/conflicts/:conflictId", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const body = req.body as { status?: string; notes?: string };
    if (!body.status || !["active", "cleared", "escalated"].includes(body.status)) {
      res.status(400).json({ error: "invalid-status" });
      return;
    }
    const [conf] = await db
      .select()
      .from(atelierConflictDisclosures)
      .where(
        and(
          eq(atelierConflictDisclosures.id, req.params.conflictId),
          eq(atelierConflictDisclosures.personId, req.params.id),
          isNull(atelierConflictDisclosures.deletedAt),
        ),
      );
    if (!conf) {
      res.status(404).json({ error: "conflict-not-found" });
      return;
    }
    await db
      .update(atelierConflictDisclosures)
      .set({
        status: body.status,
        notes: body.notes ?? conf.notes,
        lastReviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierConflictDisclosures.id, conf.id));
    await audit({
      entityType: "conflict_disclosure",
      entityId: conf.id,
      actor: me,
      action: `conflict.${body.status}`,
      summary: `${me.name} marked conflict ${conf.id} → ${body.status}.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Partner override of the conflict gate. Emits the override audit row,
// then re-runs the Sentinel with `skipConflictGate=true`.
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/access/conflict-override", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartner(me)) {
      res.status(403).json({ error: "partner-only" });
      return;
    }
    const body = req.body as {
      personId?: string;
      engagementId?: string;
      roleOnEngagement?: string;
      allocationPct?: number;
      scope?: string[];
      endDate?: string | null;
      rationale?: string;
    };
    if (!body.personId || !body.engagementId || !body.rationale?.trim()) {
      res.status(400).json({ error: "personId + engagementId + rationale required" });
      return;
    }
    const person = await findPerson(body.personId);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    // Build the PersonWire shape Access Sentinel expects.
    const pw = { ...person } as unknown as Parameters<typeof runAccessSentinel>[0]["targetPerson"];
    // Guarantee a paired "block → override" audit pair, even when the override
    // endpoint is called directly (no prior failed grant attempt exists). We
    // unconditionally write a synthesised block row first so reviewers always
    // see what was overridden. The synthesised flag distinguishes this from
    // the Sentinel-emitted block row (which fires on a real grant attempt).
    await audit({
      entityType: "engagement_access",
      entityId: `${body.engagementId}:${person.id}`,
      actor: me,
      action: "access.grant.blocked.conflict",
      payload: {
        engagementId: body.engagementId,
        personId: person.id,
        synthesised: true,
        reason:
          "Override endpoint invoked directly; block row synthesised to keep block→override audit pair coherent.",
      },
      summary: `Access Sentinel block synthesised for ${person.fullName} → ${body.engagementId} prior to Partner override.`,
    });
    await audit({
      entityType: "engagement_access",
      entityId: `${body.engagementId}:${person.id}`,
      actor: me,
      action: "access.grant.conflict-override",
      payload: {
        engagementId: body.engagementId,
        personId: person.id,
        rationale: body.rationale.trim(),
      },
      summary: `${me.name} (Partner) overrode conflict gate for ${person.fullName} → ${body.engagementId}: ${body.rationale.trim().slice(0, 120)}`,
    });
    const result = await runAccessSentinel({
      actor: me,
      targetPerson: pw,
      engagementId: body.engagementId,
      roleOnEngagement: body.roleOnEngagement ?? "member",
      allocationPct: body.allocationPct ?? 0,
      scope: body.scope ?? [],
      endDate: body.endDate ?? null,
      action: "grant",
      skipConflictGate: true,
    });
    if (!result.ok) {
      res.status(422).json({ error: "access-sentinel-blocked", ...result.blocked });
      return;
    }
    res.json({ ok: true, grantId: result.grantId, override: true });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// Roster Steward — daily compliance scan. Idempotent per (record, bucket)
// using a deterministic Pane A item id.
// -----------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.post("/roster/steward/run", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #221 — the steward scan reads the compliance register; gate it
    // like /roster/compliance (founding_partner | hr).
    if (!canViewSensitivePeopleData(me.role)) {
      res.status(403).json({ error: "sensitive-people-forbidden" });
      return;
    }
    const targets = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        // Task #292 — ops tier is now finance|hr; partner-tier covers both.
        or(
          eq(atelierUsers.role, "founding_partner"),
          eq(atelierUsers.role, "partner"),
          eq(atelierUsers.role, "finance"),
          eq(atelierUsers.role, "hr"),
        ),
      );
    const targetUserIds = targets.length > 0 ? targets.map((t) => t.id) : [me.id];
    const out = await runRosterSteward({ targetUserIds });
    res.json({ ...out, targets: targetUserIds });
  } catch (err) {
    next(err);
  }
});

export async function runRosterSteward(args: {
  targetUserIds: string[];
  horizonDays?: number;
}): Promise<{ scanned: number; emitted: number; runId: string }> {
  const horizon = args.horizonDays ?? 90;
  const horizonDate = isoDate(new Date(Date.now() + horizon * 86400_000));
  const todayStr = isoDate(new Date());
  const due = await db
    .select()
    .from(atelierComplianceRecords)
    .where(
      and(
        isNull(atelierComplianceRecords.deletedAt),
        lte(atelierComplianceRecords.expiryDate, horizonDate),
        gte(atelierComplianceRecords.expiryDate, isoDate(new Date(Date.now() - 365 * 86400_000))),
      ),
    );
  let emitted = 0;
  for (const r of due) {
    if (!r.expiryDate) continue;
    const days = Math.floor((new Date(r.expiryDate).getTime() - Date.now()) / 86400_000);
    let bucket: string;
    if (r.expiryDate < todayStr) bucket = "expired";
    else if (days <= 30) bucket = "30";
    else if (days <= 60) bucket = "60";
    else if (days <= 90) bucket = "90";
    else continue;
    const person = r.personId ? await findPerson(r.personId) : null;
    const title =
      bucket === "expired"
        ? `${r.kind.toUpperCase()} expired${person ? ` for ${person.fullName}` : ""}`
        : `${r.kind.toUpperCase()} expires in ${days}d${person ? ` (${person.fullName})` : ""}`;
    const summary = `Roster Steward · ${r.jurisdiction ?? "—"} · ref ${r.referenceNumberRedacted ?? "—"}${person ? "" : r.partnerFirmId ? ` · firm ${r.partnerFirmId}` : ""}.`;
    for (const uid of args.targetUserIds) {
      const itemId = `pane_steward_${r.id}_${bucket}_${uid}`;
      const inserted = await db
        .insert(atelierPaneAItems)
        .values({
          id: itemId,
          userId: uid,
          title,
          summary,
          priority: bucket === "expired" || bucket === "30" ? "high" : "medium",
          hrefKind: "atelier",
          hrefTargetId: "compliance",
          dueLabel: r.expiryDate,
          sortKey: bucket === "expired" ? 0 : bucket === "30" ? 1 : 2,
        })
        .onConflictDoNothing()
        .returning({ id: atelierPaneAItems.id });
      // Only count rows that were actually inserted; idempotent re-runs that
      // hit `onConflictDoNothing` must not inflate the emitted metric.
      if (inserted.length > 0) emitted++;
    }
  }
  const runId = rid("run");
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "agent_run",
    entityId: runId,
    actorType: "agent",
    actorId: "ag_roster_steward",
    actorLabel: "Roster Steward",
    action: "steward.scan",
    payload: { scanned: due.length, emitted, horizonDays: horizon },
    payloadSummary: `Roster Steward scanned ${due.length} compliance records, emitted ${emitted} Pane A items.`,
  });
  return { scanned: due.length, emitted, runId };
}

// silence unused imports across drizzle versions
void sql;

export default router;
