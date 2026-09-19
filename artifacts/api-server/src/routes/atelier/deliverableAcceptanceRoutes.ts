/**
 * Atelier — L2C Wave 1, Step 7: Deliverable Acceptance workflow routes.
 * (Task #360 in `.local/tasks/l2c-wave-1-codex-clm.md`.)
 *
 * State machine (server-enforced):
 *
 *   pending ──submit──▶ submitted_to_client
 *           └─withdraw──▶ withdrawn
 *
 *   submitted_to_client ──record_signed──▶ client_signed   (terminal)
 *                       ├──record_rejected──▶ client_rejected (terminal)
 *                       └──withdraw──▶ withdrawn             (terminal)
 *
 * Wave-2 hinge: a milestone cannot transition to client_accepted
 * unless at least one row exists here with status='client_signed'
 * bound via milestone_id. The atelier_milestone_acceptance_v view
 * is the SQL surface Wave 2 will read — see migration 0032.
 *
 * Persona gates:
 *   - create / submit:        any non-restricted, non-board-observer
 *   - record signed/rejected: isLeadership || isFinance
 *   - withdraw:               original submitter || isLeadership
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierDeliverableAcceptance,
  atelierAuditEvents,
  atelierEngagements,
  atelierPaneAItems,
  atelierNotifications,
} from "@workspace/db";
import { withRls } from "./rls";
import { autoDraftOnClientSign } from "./engagementFinancialsRoutes";
import {
  isLeadership,
  isFinance,
  isRestrictedPersona,
  isBoardObserver,
} from "./personaRoles";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response) {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function canRead(role: string | null | undefined): boolean {
  return !!role && !isRestrictedPersona(role) && !isBoardObserver(role);
}

type AccRow = typeof atelierDeliverableAcceptance.$inferSelect;

// ---------------------------------------------------------------
// LIST + GET
// ---------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/deliverable-acceptances", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "deliv-acceptance-read-denied" });
    return;
  }
  const engagementId = req.query.engagementId
    ? String(req.query.engagementId)
    : null;
  const milestoneId = req.query.milestoneId
    ? String(req.query.milestoneId)
    : null;
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await withRls(req, async (tx) => {
    const conds = [isNull(atelierDeliverableAcceptance.deletedAt)];
    if (engagementId)
      conds.push(eq(atelierDeliverableAcceptance.engagementId, engagementId));
    if (milestoneId)
      conds.push(eq(atelierDeliverableAcceptance.milestoneId, milestoneId));
    if (status) conds.push(eq(atelierDeliverableAcceptance.status, status));
    return tx
      .select()
      .from(atelierDeliverableAcceptance)
      .where(and(...conds))
      .orderBy(desc(atelierDeliverableAcceptance.createdAt))
      .limit(200);
  });
  res.json({ acceptances: rows });
});

// @cli-skip: deliverable-acceptance detail is a client-signature workflow view; assistant read parity is unproven
router.get(
  "/deliverable-acceptances/:id",
  async (req: Request, res: Response) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) {
      res.status(403).json({ error: "deliv-acceptance-read-denied" });
      return;
    }
    const row = await withRls(req, async (tx) => {
      const out = await tx
        .select()
        .from(atelierDeliverableAcceptance)
        .where(
          and(
            eq(atelierDeliverableAcceptance.id, String(req.params.id)),
            isNull(atelierDeliverableAcceptance.deletedAt),
          ),
        )
        .limit(1);
      return out[0] ?? null;
    });
    if (!row) {
      res.status(404).json({ error: "deliv-acceptance-not-found" });
      return;
    }
    res.json({ acceptance: row });
  },
);

// ---------------------------------------------------------------
// CREATE — initial `pending` row
// ---------------------------------------------------------------

const CreateBody = z.object({
  engagementId: z.string().min(1),
  deliverableId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  title: z.string().min(1).max(400),
  attestationText: z.string().min(1).max(4000),
});

// @cli-skip: acceptance creation is an external-signature workflow; assistant side-effect parity is unproven
router.post(
  "/deliverable-acceptances",
  async (req: Request, res: Response) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) {
      res.status(403).json({ error: "deliv-acceptance-write-denied" });
      return;
    }
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const id = rid("dlacc");
    const row = await withRls(req, async (tx) => {
      const [inserted] = await tx
        .insert(atelierDeliverableAcceptance)
        .values({
          id,
          engagementId: parsed.data.engagementId,
          deliverableId: parsed.data.deliverableId ?? null,
          milestoneId: parsed.data.milestoneId ?? null,
          title: parsed.data.title,
          attestationText: parsed.data.attestationText,
          status: "pending",
          submittedByUserId: me.id,
        })
        .returning();
      return inserted;
    });
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "deliverable_acceptance",
      entityId: id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "deliverable_acceptance_drafted",
      payload: {
        engagementId: parsed.data.engagementId,
        milestoneId: parsed.data.milestoneId ?? null,
      },
      payloadSummary: `${me.name} drafted a deliverable-acceptance attestation: "${parsed.data.title}".`,
    });
    res.status(201).json({ acceptance: row });
  },
);

// ---------------------------------------------------------------
// State machine
// ---------------------------------------------------------------

const ALLOWED: Record<string, string[]> = {
  pending: ["submitted_to_client", "withdrawn"],
  submitted_to_client: ["client_signed", "client_rejected", "withdrawn"],
};

async function transitionAcceptance(
  req: Request,
  res: Response,
  args: {
    id: string;
    target: string;
    requireRole:
      | "any_writer"
      | "leadership_or_finance"
      | "owner_or_leadership";
    extraPatch?: Partial<typeof atelierDeliverableAcceptance.$inferInsert>;
    auditAction: string;
    auditSummary: (row: AccRow) => string;
  },
) {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "deliv-acceptance-write-denied" });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierDeliverableAcceptance)
      .where(
        and(
          eq(atelierDeliverableAcceptance.id, String(args.id)),
          isNull(atelierDeliverableAcceptance.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return { error: "not-found" as const };
    let allowed = false;
    switch (args.requireRole) {
      case "any_writer":
        allowed = canRead(me.role);
        break;
      case "leadership_or_finance":
        allowed = isLeadership(me.role) || isFinance(me.role);
        break;
      case "owner_or_leadership":
        allowed =
          isLeadership(me.role) || existing.submittedByUserId === me.id;
        break;
    }
    if (!allowed) return { error: "role-denied" as const };
    const allowedTargets = ALLOWED[existing.status] ?? [];
    if (!allowedTargets.includes(args.target)) {
      return {
        error: "illegal-transition" as const,
        from: existing.status,
        to: args.target,
      };
    }
    const [updated] = await tx
      .update(atelierDeliverableAcceptance)
      .set({ status: args.target, ...(args.extraPatch ?? {}) })
      .where(eq(atelierDeliverableAcceptance.id, String(args.id)))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "deliv-acceptance-not-found" });
      return;
    }
    if (result.error === "role-denied") {
      res
        .status(403)
        .json({ error: "deliv-acceptance-role-denied", target: args.target });
      return;
    }
    res.status(409).json({
      error: "deliv-acceptance-illegal-transition",
      from: result.from,
      to: result.to,
    });
    return;
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "deliverable_acceptance",
    entityId: args.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: args.auditAction,
    payload: { newStatus: args.target },
    payloadSummary: args.auditSummary(result.row),
  });
  res.json({ acceptance: result.row });
}

// ---------------------------------------------------------------
// Transitions — explicit endpoints
// ---------------------------------------------------------------

const SubmitBody = z.object({
  clientSignerName: z.string().min(1).max(200),
  clientSignerEmail: z.string().email().max(200),
  clientSignerTitle: z.string().max(200).default(""),
});

// @cli-skip: acceptance submission sends external workflow state; assistant side-effect parity is unproven
router.post(
  "/deliverable-acceptances/:id/submit",
  async (req: Request, res: Response) => {
    const parsed = SubmitBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    await transitionAcceptance(req, res, {
      id: String(req.params.id),
      target: "submitted_to_client",
      requireRole: "any_writer",
      extraPatch: {
        clientSignerName: parsed.data.clientSignerName,
        clientSignerEmail: parsed.data.clientSignerEmail,
        clientSignerTitle: parsed.data.clientSignerTitle,
        submittedAt: new Date(),
      },
      auditAction: "deliverable_acceptance_submitted",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} submitted acceptance "${r.title}" to ${parsed.data.clientSignerEmail}.`,
    });
  },
);

const RecordSignedBody = z.object({
  evidenceUrl: z.string().min(1).max(1000),
  signedAt: z.string().datetime().optional(),
});

// @cli-skip: signed-status recording is an external workflow transition; assistant parity is unproven
router.post(
  "/deliverable-acceptances/:id/record-signed",
  async (req: Request, res: Response) => {
    const parsed = RecordSignedBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    await transitionAcceptance(req, res, {
      id: String(req.params.id),
      target: "client_signed",
      requireRole: "leadership_or_finance",
      extraPatch: {
        signedAt: parsed.data.signedAt
          ? new Date(parsed.data.signedAt)
          : new Date(),
        evidenceUrl: parsed.data.evidenceUrl,
        recordedByUserId: req.atelierPersona?.id ?? null,
      },
      auditAction: "deliverable_acceptance_client_signed",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} recorded client-signed evidence for acceptance "${r.title}". Wave-2 milestone gate now satisfied.`,
    });
    // Task #442 — Billing Steward hook. On a *successful* client-sign
    // transition, drop a Pane-A item + notification on the engagement
    // lead so they know a bill can be drafted. The actual draft
    // happens when the lead runs the steward from the Financials tab.
    //
    // Safety:
    //   - Skip if the transition itself failed (res.statusCode != 200).
    //   - Read acceptance + engagement under withRls so the hook can
    //     never act on cross-tenant rows.
    //   - Org-scope all writes to me.orgId.
    if (res.statusCode === 200 && req.atelierPersona) {
      const me = req.atelierPersona;
      try {
        const id = String(req.params.id);
        const acc = await withRls(req, async (tx) => {
          const rows = await tx
            .select()
            .from(atelierDeliverableAcceptance)
            .where(eq(atelierDeliverableAcceptance.id, id))
            .limit(1);
          return rows[0] ?? null;
        });
        if (acc && acc.status === "client_signed") {
          const eng = await withRls(req, async (tx) => {
            const rows = await tx
              .select()
              .from(atelierEngagements)
              .where(eq(atelierEngagements.id, acc.engagementId))
              .limit(1);
            return rows[0] ?? null;
          });
          // Belt-and-braces: the engagement org must match the caller
          // org. RLS already enforces it, but an explicit check
          // documents the invariant for future maintainers.
          if (eng && eng.orgId === me.orgId) {
            // Task #442 — auto-draft a bill (gated by billing model
            // inside the helper). On t&m engagements this no-ops and
            // we still surface a Pane-A item so the lead can run the
            // Composer manually.
            const drafted = await autoDraftOnClientSign({
              actor: { id: me.id, orgId: me.orgId, name: me.name, role: me.role },
              acceptanceId: acc.id,
            });
            const titleSuffix =
              drafted.length > 0
                ? "bill auto-drafted, awaiting Lead approval"
                : "ready to bill";
            const summary =
              drafted.length > 0
                ? `Client signed — Billing Steward drafted a $${drafted[0].total.toLocaleString()} bill awaiting your approval in Financials.`
                : `Client signed — Financials tab will run the Composer for T&M lines.`;
            await db
              .insert(atelierPaneAItems)
              .values({
                id: `panea_steward_ready_${acc.id}`,
                userId: eng.engagementLeadId,
                title: `Billing Steward · "${acc.title}" ${titleSuffix}`,
                summary,
                priority: "medium",
                hrefKind: "engagement_economics",
                hrefTargetId: eng.id,
                dueLabel: "Today",
                sortKey: 65,
              })
              .onConflictDoNothing({ target: atelierPaneAItems.id });
            await db
              .insert(atelierNotifications)
              .values({
                id: `notif_steward_${acc.id}`,
                userId: eng.engagementLeadId,
                kind:
                  drafted.length > 0
                    ? "bill_lead_approval_required"
                    : "billing_steward_ready",
                payload: { engagementId: eng.id, acceptanceId: acc.id, drafted },
                subject:
                  drafted.length > 0
                    ? `Bill awaiting your approval · ${eng.name}`
                    : `Bill ready to draft · ${eng.name}`,
                body: summary,
                refType: "engagement",
                refId: eng.id,
                status: "queued",
              })
              .onConflictDoNothing({ target: atelierNotifications.id });
          }
        }
      } catch {
        // Steward hook is non-blocking; failures must not break sign-off.
      }
    }
  },
);

const RejectBody = z.object({
  reason: z.string().min(1).max(2000),
});

// @cli-skip: rejected-status recording is an external workflow transition; assistant parity is unproven
router.post(
  "/deliverable-acceptances/:id/record-rejected",
  async (req: Request, res: Response) => {
    const parsed = RejectBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    await transitionAcceptance(req, res, {
      id: String(req.params.id),
      target: "client_rejected",
      requireRole: "leadership_or_finance",
      extraPatch: {
        rejectionReason: parsed.data.reason,
        recordedByUserId: req.atelierPersona?.id ?? null,
      },
      auditAction: "deliverable_acceptance_client_rejected",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} recorded client rejection for acceptance "${r.title}".`,
    });
  },
);

// @cli-skip: acceptance withdrawal is an audited external workflow transition; assistant parity is unproven
router.post(
  "/deliverable-acceptances/:id/withdraw",
  async (req: Request, res: Response) => {
    await transitionAcceptance(req, res, {
      id: String(req.params.id),
      target: "withdrawn",
      requireRole: "owner_or_leadership",
      auditAction: "deliverable_acceptance_withdrawn",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} withdrew acceptance "${r.title}".`,
    });
  },
);

export default router;
