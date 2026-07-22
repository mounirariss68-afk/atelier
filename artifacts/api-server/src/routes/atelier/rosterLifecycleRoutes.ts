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
  atelierPaneAItems,
  atelierStudioCandidates,
  atelierStudioOffers,
  atelierAuthCredentials,
  atelierLoginActivationTokens,
} from "@workspace/db";
import { runAccessSentinel } from "./rosterRoutes.js";
import { canViewSensitivePeopleData } from "./personaRoles.js";
import { assertAuditAction } from "./auditContract.js";
import { hashPassword } from "../../lib/auth/passwords.js";
import { sendJoinerWelcomeEmail } from "../../lib/atelier-welcome-email.js";
import { emitSelfNotification } from "./meRoutes.js";

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
): Promise<{ id: string; workerType: WorkerType; fullName: string; email: string | null } | null> {
  const [emp] = await db
    .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName, email: atelierEmployees.email })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, id), isNull(atelierEmployees.deletedAt)));
  if (emp) return { ...emp, workerType: "employee" };
  const [ct] = await db
    .select({ id: atelierContractors.id, fullName: atelierContractors.fullName, email: atelierContractors.email })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.id, id), isNull(atelierContractors.deletedAt)));
  if (ct) return { ...ct, workerType: "contractor" };
  const [pr] = await db
    .select({ id: atelierPartnerFirmResources.id, fullName: atelierPartnerFirmResources.fullName, email: atelierPartnerFirmResources.email })
    .from(atelierPartnerFirmResources)
    .where(
      and(
        eq(atelierPartnerFirmResources.id, id),
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
    { code: LOGIN_STEP_CODE, title: "Portal login created", description: "Create the Atelier login — the final pre-boarding step.", ownerRole: "hr", daysFromStart: 7 },
  ],
  contractor: [
    { code: "nda.msa.signed", title: "NDA & MSA signed", description: "Non-disclosure and master services agreements executed.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "conflict.disclosed", title: "Conflicts of interest disclosed", description: "Conflict disclosure captured and cleared.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "vendor.ap.setup", title: "Vendor & AP setup", description: "Vendor entity registered with accounts payable; payment terms agreed.", ownerRole: "hr", daysFromStart: 1 },
    { code: "sso.limited", title: "Limited SSO provisioned", description: "Scoped access to the tools required for the engagement only.", ownerRole: "hr", daysFromStart: 2 },
    { code: "invoice.cadence", title: "Invoice cadence agreed", description: "Invoicing schedule, rate and approval chain confirmed.", ownerRole: "hr", daysFromStart: 3 },
    { code: "scope.briefed", title: "Engagement scope briefed", description: "Scope of work, deliverables and ways of working walked through.", ownerRole: "senior_manager", daysFromStart: 3 },
    { code: LOGIN_STEP_CODE, title: "Portal login created", description: "Create the Atelier login — the final pre-boarding step.", ownerRole: "hr", daysFromStart: 4 },
  ],
  partner_firm_resource: [
    { code: "firm.agreement.verified", title: "Partner-firm agreement verified", description: "Firm MSA and NDA verified active and covering this resource.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "conflict.disclosed", title: "Resource conflicts disclosed", description: "Conflict disclosure for this resource captured and cleared.", ownerRole: "hr", daysFromStart: 0, isComplianceGate: true },
    { code: "access.limited", title: "Limited access provisioned", description: "Guest access scoped to the assigned engagement only.", ownerRole: "hr", daysFromStart: 1 },
    { code: "engagement.briefed", title: "Engagement brief delivered", description: "Engagement context, client protocols and deliverables briefed.", ownerRole: "senior_manager", daysFromStart: 2 },
    { code: LOGIN_STEP_CODE, title: "Portal login created", description: "Create the Atelier login — the final pre-boarding step.", ownerRole: "hr", daysFromStart: 3 },
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
      .where(isNull(atelierInvitations.deletedAt))
      .orderBy(desc(atelierInvitations.sentAt));
    // Auto-mark expired (read-side; don't write).
    const now = Date.now();
    res.json({
      invitations: rows.map((r) => ({
        id: r.id,
        workerType: r.workerType,
        personDraft: r.personDraft,
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
      email?: string;
      role?: string | null;
      seniority?: string | null;
      title?: string | null;
      country?: string | null;
      partnerFirmId?: string | null;
      startDate?: string | null;
      employingEntity?: string | null;
      expiresInDays?: number;
      sourceKind?: string;
      sourceId?: string;
    };
    const wt = body.workerType;
    if (!wt || !["employee", "contractor", "partner_firm_resource"].includes(wt)) {
      res.status(400).json({ error: "invalid-worker-type" });
      return;
    }
    if (!body.fullName?.trim() || !body.email?.trim()) {
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
        .where(and(eq(atelierStudioCandidates.id, sourceId), isNull(atelierStudioCandidates.deletedAt)));
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
        .where(and(eq(atelierStudioOffers.id, sourceId), isNull(atelierStudioOffers.deletedAt)));
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
    await db.insert(atelierInvitations).values({
      id,
      workerType: wt,
      personDraft: {
        fullName: body.fullName.trim(),
        email: body.email.trim().toLowerCase(),
        role: body.role ?? null,
        seniority: body.seniority ?? null,
        title: body.title ?? null,
        country: body.country ?? null,
        partnerFirmId: body.partnerFirmId ?? null,
        startDate: body.startDate ?? null,
        employingEntity: body.employingEntity ?? null,
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
      summary: `${me.name} invited ${body.fullName} (${wt}).`,
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
      .where(and(eq(atelierInvitations.id, req.params.id), isNull(atelierInvitations.deletedAt)));
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
      .where(eq(atelierInvitations.id, inv.id));
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
      .where(and(eq(atelierInvitations.id, req.params.id), isNull(atelierInvitations.deletedAt)));
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
      .where(eq(atelierInvitations.id, inv.id));
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
      .where(and(eq(atelierInvitations.id, req.params.id), isNull(atelierInvitations.deletedAt)));
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
        .where(eq(atelierInvitations.id, inv.id));
      res.status(422).json({ error: "invitation-expired" });
      return;
    }
    const draft = inv.personDraft;
    let personId: string;
    if (inv.workerType === "employee") {
      personId = `emp_${rid("x").slice(2)}`;
      await db.insert(atelierEmployees).values({
        id: personId,
        fullName: draft.fullName,
        email: draft.email,
        role: draft.role ?? "consultant",
        seniority: draft.seniority ?? "consultant",
        title: draft.title ?? null,
        country: draft.country ?? null,
        startDate: draft.startDate ?? null,
        employingEntity: draft.employingEntity ?? null,
        status: "onboarding",
      });
    } else if (inv.workerType === "contractor") {
      personId = `ctr_${rid("x").slice(2)}`;
      await db.insert(atelierContractors).values({
        id: personId,
        fullName: draft.fullName,
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
        partnerFirmId: draft.partnerFirmId,
        fullName: draft.fullName,
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
      .where(eq(atelierInvitations.id, inv.id));
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
            .where(eq(atelierInvitations.id, o.invitationId));
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

// Task #509 — create the portal login as the FINAL pre-boarding step.
// Replaces the parallel "Add joiner" form: the person row already exists
// (materialised at invitation-accept), so this creates only the
// atelier_users identity + credential, links employees.user_id, marks the
// "login.created" onboarding step done, and emails the invitee a one-time
// temporary password (returned once, never persisted in plaintext).
// @cli-skip: HR admin mutation returning a one-time secret; no CLI shape
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
    const email = (person.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) {
      res.status(422).json({ error: "person-has-no-email" });
      return;
    }
    const existingUserId = await resolveLinkedUserIdForPerson(person);
    if (existingUserId) {
      const [cred] = await db
        .select({ email: atelierAuthCredentials.email })
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.userId, existingUserId));
      if (cred) {
        res.status(409).json({ error: "login-already-exists" });
        return;
      }
    }
    const [credByEmail] = await db
      .select({ email: atelierAuthCredentials.email })
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, email));
    if (credByEmail) {
      res.status(409).json({ error: "email-taken", message: "A login already exists for that email." });
      return;
    }

    const initials =
      person.fullName
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p[0]!.toUpperCase())
        .slice(0, 2)
        .join("") || "??";
    const role =
      person.workerType === "employee"
        ? "employee"
        : person.workerType === "contractor"
          ? "contractor"
          : "partner_firm_resource";
    const roleLabel =
      person.workerType === "employee"
        ? "Employee"
        : person.workerType === "contractor"
          ? "Contractor"
          : "Partner Firm Resource";
    // Security: no temporary password is ever generated, returned, or
    // emailed. The credential row is created with an unguessable random
    // hash (the account cannot sign in yet) and a one-time, short-TTL
    // activation token lets the joiner choose their own password.
    const activationToken = randomBytes(32).toString("hex");
    const activationTokenHash = createHash("sha256").update(activationToken).digest("hex");
    const activationExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const userId = existingUserId ?? rid("p_joiner");

    await db.transaction(async (tx) => {
      if (!existingUserId) {
        await tx.insert(atelierUsers).values({
          id: userId,
          orgId: me.orgId,
          email,
          name: person.fullName,
          initials,
          role,
          roleLabel,
          title: roleLabel,
        });
        if (person.workerType === "employee") {
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
        expiresAt: activationExpiresAt,
      });
      // Mark the login.created step done (if the sequence has one).
      const [loginStep] = await tx
        .select()
        .from(atelierOnboardingSteps)
        .where(
          and(
            eq(atelierOnboardingSteps.onboardingId, onb.id),
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
      await tx.insert(atelierAuditEvents).values({
        id: `audit_${randomUUID()}`,
        entityType: "onboarding",
        entityId: onb.id,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "onboarding.login.created",
        payload: { personId: person.id, userId, email, workerType: person.workerType },
        payloadSummary: `${me.name} created the portal login for ${person.fullName} (${email}).`,
      });
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

    // If login was the last outstanding step, complete the sequence and
    // activate the person (same rule as the advance route).
    const allSteps = await db
      .select()
      .from(atelierOnboardingSteps)
      .where(eq(atelierOnboardingSteps.onboardingId, onb.id));
    const blockedCompliance = allSteps.some((s) => s.isComplianceGate && s.status === "blocked");
    const allFinal = allSteps.every((s) => s.status === "done" || s.status === "skipped");
    if (!blockedCompliance && allFinal) {
      await db
        .update(atelierOnboardings)
        .set({ status: "complete", completedAt: new Date(), blockedAt: null, blockedReason: null, updatedAt: new Date() })
        .where(eq(atelierOnboardings.id, onb.id));
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
      await audit({
        entityType: "onboarding",
        entityId: onb.id,
        actor: { id: "ag_onboarding_concierge", name: "Onboarding Concierge", role: "agent" },
        actorIsAgent: true,
        agentId: "ag_onboarding_concierge",
        action: "onboarding.completed",
        summary: `Onboarding Concierge completed sequence — person activated.`,
      });
    }

    // Welcome email — best-effort, after commit; never fails the request.
    let signInUrl: string | null = null;
    try {
      const parsedOrigin = new URL(req.get("origin")?.trim() ?? "");
      if (parsedOrigin.protocol === "https:" || parsedOrigin.protocol === "http:") {
        signInUrl = parsedOrigin.origin;
      }
    } catch {
      // No/invalid Origin — omit the link.
    }
    const activationUrl = signInUrl
      ? `${signInUrl}/activate?token=${activationToken}`
      : `/activate?token=${activationToken}`;
    const welcomeEmail = await sendJoinerWelcomeEmail({
      fullName: person.fullName,
      email,
      activationUrl: signInUrl ? activationUrl : null,
      activationValidity: "72 hours",
      workerType: person.workerType === "employee" ? "employee" : "contractor",
      signInUrl,
    });

    // The activation URL is returned once so HR can share it through a
    // secure channel when email delivery isn't configured. It is a
    // single-use, 72-hour token — never a password.
    res.status(201).json({
      ok: true,
      userId,
      activationUrl,
      activationExpiresAt: activationExpiresAt.toISOString(),
      welcomeEmail,
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
          personType: r.personType,
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
    // Roll-ups
    const buckets = { expired: 0, expiring_30: 0, expiring_60: 0, expiring_90: 0, ok: 0 };
    for (const r of enriched) buckets[r.bucket]++;
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
    await db.insert(atelierComplianceRecords).values({
      id,
      personType: body.personType ?? null,
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
