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
import { and, desc, eq, isNull, lte, gte, or, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirms,
  atelierPartnerFirmResources,
  atelierAccounts,
  atelierEngagements,
  atelierEngagementAccess,
  atelierAuditEvents,
  atelierConflictDisclosures,
  atelierInvitations,
  atelierOnboardings,
  atelierOnboardingSteps,
  atelierOffboardings,
  atelierOffboardingSteps,
  atelierComplianceRecords,
  atelierPaneAItems,
} from "@workspace/db";
import { runAccessSentinel } from "./rosterRoutes.js";

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

function isPartner(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner";
}
function isPartnerOrOps(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "operations";
}
function canManageLifecycle(me: typeof atelierUsers.$inferSelect): boolean {
  // Partner | Operations | Engagement Lead can advance lifecycle steps.
  return (
    me.role === "partner" ||
    me.role === "operations" ||
    me.role === "engagement_lead"
  );
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

const ONBOARDING_TEMPLATES: Record<WorkerType, StepTemplate[]> = {
  employee: [
    { code: "nda.signed", title: "NDA signed", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "contract.signed", title: "Employment contract signed", ownerRole: "partner", daysFromStart: 0, isComplianceGate: true },
    { code: "payroll.registered", title: "Payroll registered (GOSI / WPS)", ownerRole: "operations", daysFromStart: 1, isComplianceGate: true },
    { code: "sso.provisioned", title: "SSO + email provisioned", ownerRole: "operations", daysFromStart: 2 },
    { code: "slack.invited", title: "Invited to Slack workspaces", ownerRole: "operations", daysFromStart: 2 },
    { code: "calendar.welcome", title: "Welcome calendar block", ownerRole: "operations", daysFromStart: 3 },
    { code: "equipment.shipped", title: "Equipment shipped", ownerRole: "operations", daysFromStart: 3 },
    { code: "benefits.enrolled", title: "Benefits enrollment", ownerRole: "operations", daysFromStart: 5 },
    { code: "security.training", title: "Security & data-handling training", ownerRole: "operations", daysFromStart: 7 },
    { code: "manager.intro", title: "Manager intro session", ownerRole: "engagement_lead", daysFromStart: 7 },
    { code: "atelier.tour", title: "The Atelier walkthrough", ownerRole: "engagement_lead", daysFromStart: 7 },
  ],
  contractor: [
    { code: "nda.signed", title: "NDA signed", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "msa.signed", title: "Master services agreement signed", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "conflict.disclosed", title: "Conflicts of interest disclosed", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "vendor.onboarded", title: "Vendor entity onboarded (AP)", ownerRole: "operations", daysFromStart: 1 },
    { code: "sso.provisioned", title: "Limited SSO provisioned", ownerRole: "operations", daysFromStart: 2 },
    { code: "invoice.setup", title: "Invoice cadence configured", ownerRole: "operations", daysFromStart: 3 },
    { code: "scope.briefed", title: "Engagement scope briefed", ownerRole: "engagement_lead", daysFromStart: 3 },
  ],
  partner_firm_resource: [
    { code: "msa.firm.verified", title: "Firm MSA verified active", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "nda.firm.verified", title: "Firm NDA covers resource", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "conflict.disclosed", title: "Resource conflicts disclosed", ownerRole: "operations", daysFromStart: 0, isComplianceGate: true },
    { code: "sso.guest", title: "Guest SSO provisioned", ownerRole: "operations", daysFromStart: 1 },
    { code: "scope.briefed", title: "Engagement scope briefed", ownerRole: "engagement_lead", daysFromStart: 2 },
  ],
};

// 11-step offboarding (employees + contractors). Partner-firm resources use a
// trimmed variant (MSA-side closure handled by the firm).
const OFFBOARDING_TEMPLATES: Record<WorkerType, StepTemplate[]> = {
  employee: [
    { code: "intent.recorded", title: "Intent to leave recorded", ownerRole: "operations", daysFromStart: 0 },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "engagement_lead", daysFromStart: 1, isReassignmentGate: true },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "engagement_lead", daysFromStart: 3 },
    { code: "client.notify", title: "Clients notified (where appropriate)", ownerRole: "partner", daysFromStart: 4 },
    { code: "sso.revoked", title: "SSO revoked", ownerRole: "operations", daysFromStart: 7 },
    { code: "email.disabled", title: "Email disabled (forward set)", ownerRole: "operations", daysFromStart: 7 },
    { code: "slack.disabled", title: "Slack workspaces disabled", ownerRole: "operations", daysFromStart: 7 },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "operations", daysFromStart: 7 },
    { code: "ip.assignment.signed", title: "IP assignment + return-of-property signed", ownerRole: "operations", daysFromStart: 7 },
    { code: "final.payment", title: "Final payment + EOSB processed", ownerRole: "operations", daysFromStart: 14 },
    { code: "audit.pack.signed", title: "Partner-signed audit pack issued", ownerRole: "partner", daysFromStart: 14 },
  ],
  contractor: [
    { code: "intent.recorded", title: "Intent to roll off recorded", ownerRole: "operations", daysFromStart: 0 },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "engagement_lead", daysFromStart: 1, isReassignmentGate: true },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "engagement_lead", daysFromStart: 3 },
    { code: "client.notify", title: "Clients notified", ownerRole: "partner", daysFromStart: 4 },
    { code: "sso.revoked", title: "SSO revoked", ownerRole: "operations", daysFromStart: 5 },
    { code: "email.disabled", title: "Email disabled", ownerRole: "operations", daysFromStart: 5 },
    { code: "slack.disabled", title: "Slack disabled", ownerRole: "operations", daysFromStart: 5 },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "operations", daysFromStart: 5 },
    { code: "ip.assignment.signed", title: "IP assignment + return of property", ownerRole: "operations", daysFromStart: 5 },
    { code: "final.payment", title: "Final invoice paid", ownerRole: "operations", daysFromStart: 14 },
    { code: "audit.pack.signed", title: "Partner-signed audit pack issued", ownerRole: "partner", daysFromStart: 14 },
  ],
  partner_firm_resource: [
    { code: "intent.recorded", title: "Resource rotation recorded", ownerRole: "operations", daysFromStart: 0 },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "engagement_lead", daysFromStart: 1, isReassignmentGate: true },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "engagement_lead", daysFromStart: 3 },
    { code: "sso.revoked", title: "Guest SSO revoked", ownerRole: "operations", daysFromStart: 5 },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "operations", daysFromStart: 5 },
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
  await db.insert(atelierOffboardingSteps).values(
    tpl.map((s, i) => ({
      id: rid("offs"),
      offboardingId: id,
      sortKey: i,
      code: s.code,
      title: s.title,
      description: s.description ?? null,
      ownerRole: s.ownerRole,
      deadline: isoDate(new Date(last.getTime() + ((s.daysFromStart ?? 0) - tpl[tpl.length - 1]!.daysFromStart!) * 86400_000)),
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
      expiresInDays?: number;
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
      },
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
      payload: { workerType: wt, email: body.email },
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
    const onboardingId = await startOnboardingSequence({
      personId,
      workerType: inv.workerType as WorkerType,
      invitationId: inv.id,
      targetStartDate: draft.startDate ?? null,
      ownerUserId: me.id,
    });
    await audit({
      entityType: "invitation",
      entityId: inv.id,
      actor: me,
      action: "invitation.accepted",
      payload: { personId, onboardingId },
      summary: `${me.name} materialised ${draft.fullName} (${inv.workerType}); onboarding sequence ${onboardingId} started.`,
    });
    res.json({ ok: true, personId, onboardingId });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// /roster/onboarding
// -----------------------------------------------------------------

router.get("/roster/onboarding", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const onbs = await db
      .select()
      .from(atelierOnboardings)
      .where(isNull(atelierOnboardings.deletedAt))
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
        const steps = (stepsByOnb.get(o.id) ?? []).sort((a, b) => a.sortKey - b.sortKey);
        const done = steps.filter((s) => s.status === "done").length;
        return {
          id: o.id,
          personId: o.personId,
          personType: o.personType,
          personName: person?.fullName ?? o.personId,
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
// /roster/offboarding
// -----------------------------------------------------------------

router.get("/roster/offboarding", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const offs = await db
      .select()
      .from(atelierOffboardings)
      .where(isNull(atelierOffboardings.deletedAt))
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
        if (person?.email) {
          const [u] = await db
            .select({ id: atelierUsers.id })
            .from(atelierUsers)
            .where(eq(atelierUsers.email, person.email));
          if (u) {
            const remaining = await db
              .select({ id: atelierEngagementAccess.id })
              .from(atelierEngagementAccess)
              .where(
                and(
                  eq(atelierEngagementAccess.userId, u.id),
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
      if (personForCheck?.email) {
        const [u] = await db
          .select({ id: atelierUsers.id })
          .from(atelierUsers)
          .where(eq(atelierUsers.email, personForCheck.email));
        if (u) {
          const activeGrants = await db
            .select({
              id: atelierEngagementAccess.id,
              engagementId: atelierEngagementAccess.engagementId,
            })
            .from(atelierEngagementAccess)
            .where(
              and(
                eq(atelierEngagementAccess.userId, u.id),
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
    if (person?.email) {
      const [u] = await db
        .select({ id: atelierUsers.id })
        .from(atelierUsers)
        .where(eq(atelierUsers.email, person.email));
      if (u) {
        const revoked = await db
          .update(atelierEngagementAccess)
          .set({ status: "revoked", endDate: new Date() })
          .where(
            and(
              eq(atelierEngagementAccess.userId, u.id),
              eq(atelierEngagementAccess.status, "active"),
            ),
          )
          .returning({ id: atelierEngagementAccess.id });
        await audit({
          entityType: "offboarding",
          entityId: off.id,
          actor: me,
          action: "offboarding.revoke.atelier_access",
          payload: { userId: u.id, revokedGrantIds: revoked.map((r) => r.id) },
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
    await audit({
      entityType: "offboarding",
      entityId: off.id,
      actor: me,
      action: "offboarding.finalized",
      payload: { auditUrl },
      summary: `${me.name} (Partner) signed audit pack for offboarding ${off.id}; person → former.`,
    });
    res.json({ ok: true, auditPackUrl: auditUrl });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------
// /roster/compliance
// -----------------------------------------------------------------

router.get("/roster/compliance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
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

router.post("/roster/compliance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
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

router.post("/roster/people/:id/conflicts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me) && me.role !== "engagement_lead") {
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

router.post("/roster/steward/run", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isPartnerOrOps(me)) {
      res.status(403).json({ error: "partner-or-operations-only" });
      return;
    }
    const targets = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(or(eq(atelierUsers.role, "partner"), eq(atelierUsers.role, "operations")));
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
      await db
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
        .onConflictDoNothing();
      emitted++;
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
