/**
 * Atelier — L2C Wave 1, Step 6: Change Order workflow routes.
 * (Task #360 in `.local/tasks/l2c-wave-1-codex-clm.md`.)
 *
 * State machine (server-enforced):
 *
 *   draft ──proposeApprove──▶ partner_approved
 *                       │
 *                       └──withdraw──▶ withdrawn
 *
 *   partner_approved ──dispatch──▶ client_proposed
 *                                       │
 *                                       ├──record_acceptance──▶ client_accepted
 *                                       ├──record_rejection──▶ client_rejected
 *                                       └──withdraw──▶ withdrawn
 *
 *   client_accepted ──post──▶ posted        (terminal — Finance only)
 *   client_rejected, withdrawn               (terminal)
 *
 * Persona gates:
 *   - propose:           any non-restricted, non-board-observer
 *   - partner-approve:   isLeadership (partner / managing_partner)
 *   - dispatch:          isLeadership
 *   - record acceptance: isLeadership || isFinance
 *   - record rejection:  isLeadership || isFinance
 *   - withdraw:          original proposer || isLeadership
 *   - post:              isFinance (terminal commit into engagement value)
 *
 * value_delta_usd is masked to null on read for non-leadership /
 * non-finance personas (mirrors atelier_contract_v masking).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierChangeOrder,
  atelierAuditEvents,
} from "@workspace/db";
import { withRls } from "./rls";
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

function canReadChangeOrder(role: string | null | undefined): boolean {
  return !!role && !isRestrictedPersona(role) && !isBoardObserver(role);
}

function canSeeValueDelta(role: string | null | undefined): boolean {
  return isLeadership(role) || isFinance(role);
}

type ChangeOrderRow = typeof atelierChangeOrder.$inferSelect;

function maskValueDelta(
  row: ChangeOrderRow,
  role: string | null | undefined,
): ChangeOrderRow & { valueDeltaUsd: number | null } {
  if (canSeeValueDelta(role)) {
    return row as ChangeOrderRow & { valueDeltaUsd: number | null };
  }
  return { ...row, valueDeltaUsd: null as unknown as number };
}

const KIND = z.enum(["scope", "rate", "term", "team"]);

// ---------------------------------------------------------------
// LIST + GET
// ---------------------------------------------------------------

router.get("/change-orders", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadChangeOrder(me.role)) {
    res.status(403).json({ error: "change-order-read-denied" });
    return;
  }
  const engagementId = req.query.engagementId
    ? String(req.query.engagementId)
    : null;
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await withRls(req, async (tx) => {
    const conds = [isNull(atelierChangeOrder.deletedAt)];
    if (engagementId)
      conds.push(eq(atelierChangeOrder.engagementId, engagementId));
    if (status) conds.push(eq(atelierChangeOrder.status, status));
    return tx
      .select()
      .from(atelierChangeOrder)
      .where(and(...conds))
      .orderBy(desc(atelierChangeOrder.createdAt))
      .limit(200);
  });
  res.json({
    changeOrders: rows.map((r) => maskValueDelta(r, me.role)),
  });
});

router.get("/change-orders/:id", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadChangeOrder(me.role)) {
    res.status(403).json({ error: "change-order-read-denied" });
    return;
  }
  const row = await withRls(req, async (tx) => {
    const out = await tx
      .select()
      .from(atelierChangeOrder)
      .where(
        and(
          eq(atelierChangeOrder.id, String(req.params.id)),
          isNull(atelierChangeOrder.deletedAt),
        ),
      )
      .limit(1);
    return out[0] ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "change-order-not-found" });
    return;
  }
  res.json({ changeOrder: maskValueDelta(row, me.role) });
});

// ---------------------------------------------------------------
// PROPOSE — create as `draft`
// ---------------------------------------------------------------

const ProposeBody = z.object({
  engagementId: z.string().min(1),
  parentContractId: z.string().nullable().optional(),
  kind: KIND,
  summary: z.string().min(1).max(400),
  rationaleText: z.string().max(4000).default(""),
  oldValueJson: z.unknown().nullable().optional(),
  newValueJson: z.unknown().nullable().optional(),
  valueDeltaUsd: z.number().default(0),
  linkedRaidId: z.string().nullable().optional(),
});

router.post("/change-orders", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadChangeOrder(me.role)) {
    res.status(403).json({ error: "change-order-write-denied" });
    return;
  }
  const parsed = ProposeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const id = rid("co");
  const row = await withRls(req, async (tx) => {
    const [inserted] = await tx
      .insert(atelierChangeOrder)
      .values({
        id,
        engagementId: parsed.data.engagementId,
        parentContractId: parsed.data.parentContractId ?? null,
        kind: parsed.data.kind,
        summary: parsed.data.summary,
        rationaleText: parsed.data.rationaleText,
        oldValueJson: (parsed.data.oldValueJson ?? null) as never,
        newValueJson: (parsed.data.newValueJson ?? null) as never,
        valueDeltaUsd: parsed.data.valueDeltaUsd,
        status: "draft",
        proposedByUserId: me.id,
        linkedRaidId: parsed.data.linkedRaidId ?? null,
      })
      .returning();
    return inserted;
  });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "change_order",
    entityId: id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "change_order_proposed",
    payload: { kind: parsed.data.kind, valueDeltaUsd: parsed.data.valueDeltaUsd },
    payloadSummary: `${me.name} proposed a ${parsed.data.kind} change order on engagement ${parsed.data.engagementId}.`,
  });
  res.status(201).json({ changeOrder: maskValueDelta(row, me.role) });
});

// ---------------------------------------------------------------
// PATCH — only allowed while still `draft`
// ---------------------------------------------------------------

const PatchBody = z.object({
  summary: z.string().min(1).max(400).optional(),
  rationaleText: z.string().max(4000).optional(),
  oldValueJson: z.unknown().nullable().optional(),
  newValueJson: z.unknown().nullable().optional(),
  valueDeltaUsd: z.number().optional(),
});

router.patch("/change-orders/:id", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadChangeOrder(me.role)) {
    res.status(403).json({ error: "change-order-write-denied" });
    return;
  }
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierChangeOrder)
      .where(
        and(
          eq(atelierChangeOrder.id, String(req.params.id)),
          isNull(atelierChangeOrder.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return { error: "not-found" as const };
    if (existing.status !== "draft") {
      return { error: "not-draft" as const, status: existing.status };
    }
    const patch: Partial<typeof atelierChangeOrder.$inferInsert> = {};
    if (parsed.data.summary !== undefined) patch.summary = parsed.data.summary;
    if (parsed.data.rationaleText !== undefined)
      patch.rationaleText = parsed.data.rationaleText;
    if (parsed.data.oldValueJson !== undefined)
      patch.oldValueJson = parsed.data.oldValueJson as never;
    if (parsed.data.newValueJson !== undefined)
      patch.newValueJson = parsed.data.newValueJson as never;
    if (parsed.data.valueDeltaUsd !== undefined)
      patch.valueDeltaUsd = parsed.data.valueDeltaUsd;
    const [updated] = await tx
      .update(atelierChangeOrder)
      .set(patch)
      .where(eq(atelierChangeOrder.id, String(req.params.id)))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "change-order-not-found" });
      return;
    }
    res.status(409).json({
      error: "change-order-not-editable",
      currentStatus: result.status,
    });
    return;
  }
  res.json({ changeOrder: maskValueDelta(result.row, me.role) });
});

// ---------------------------------------------------------------
// State machine — transition helper
// ---------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["partner_approved", "withdrawn"],
  partner_approved: ["client_proposed", "withdrawn"],
  client_proposed: [
    "client_accepted",
    "client_rejected",
    "withdrawn",
  ],
  client_accepted: ["posted"],
};

async function transitionChangeOrder(
  req: Request,
  res: Response,
  args: {
    id: string;
    target: string;
    requireRole:
      | "leadership"
      | "leadership_or_finance"
      | "finance"
      | "owner_or_leadership";
    extraPatch?: Partial<typeof atelierChangeOrder.$inferInsert>;
    auditAction: string;
    auditSummary: (row: ChangeOrderRow) => string;
  },
) {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadChangeOrder(me.role)) {
    res.status(403).json({ error: "change-order-write-denied" });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierChangeOrder)
      .where(
        and(
          eq(atelierChangeOrder.id, String(args.id)),
          isNull(atelierChangeOrder.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return { error: "not-found" as const };
    // role gate (uses the loaded row for owner check)
    let allowed = false;
    switch (args.requireRole) {
      case "leadership":
        allowed = isLeadership(me.role);
        break;
      case "leadership_or_finance":
        allowed = isLeadership(me.role) || isFinance(me.role);
        break;
      case "finance":
        allowed = isFinance(me.role);
        break;
      case "owner_or_leadership":
        allowed =
          isLeadership(me.role) || existing.proposedByUserId === me.id;
        break;
    }
    if (!allowed) return { error: "role-denied" as const };
    const allowedTargets = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowedTargets.includes(args.target)) {
      return {
        error: "illegal-transition" as const,
        from: existing.status,
        to: args.target,
      };
    }
    const [updated] = await tx
      .update(atelierChangeOrder)
      .set({ status: args.target, ...(args.extraPatch ?? {}) })
      .where(eq(atelierChangeOrder.id, String(args.id)))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "change-order-not-found" });
      return;
    }
    if (result.error === "role-denied") {
      res
        .status(403)
        .json({ error: "change-order-role-denied", target: args.target });
      return;
    }
    res.status(409).json({
      error: "change-order-illegal-transition",
      from: result.from,
      to: result.to,
    });
    return;
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "change_order",
    entityId: args.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: args.auditAction,
    payload: { newStatus: args.target },
    payloadSummary: args.auditSummary(result.row),
  });
  res.json({ changeOrder: maskValueDelta(result.row, me.role) });
}

// ---------------------------------------------------------------
// Transitions — explicit endpoints
// ---------------------------------------------------------------

router.post(
  "/change-orders/:id/partner-approve",
  async (req: Request, res: Response) => {
    await transitionChangeOrder(req, res, {
      id: String(req.params.id),
      target: "partner_approved",
      requireRole: "leadership",
      extraPatch: {
        partnerApproverUserId: req.atelierPersona?.id ?? null,
        partnerApprovedAt: new Date(),
      },
      auditAction: "change_order_partner_approved",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} partner-approved change order ${r.id}.`,
    });
  },
);

const DispatchBody = z.object({
  clientSignerName: z.string().min(1).max(200),
  clientSignerEmail: z.string().email().max(200),
});

router.post(
  "/change-orders/:id/dispatch",
  async (req: Request, res: Response) => {
    const parsed = DispatchBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    await transitionChangeOrder(req, res, {
      id: String(req.params.id),
      target: "client_proposed",
      requireRole: "leadership",
      extraPatch: {
        clientSignerName: parsed.data.clientSignerName,
        clientSignerEmail: parsed.data.clientSignerEmail,
        clientProposedAt: new Date(),
      },
      auditAction: "change_order_dispatched",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} dispatched change order ${r.id} to ${parsed.data.clientSignerEmail}.`,
    });
  },
);

const RecordAcceptanceBody = z.object({
  evidenceUrl: z.string().min(1).max(1000),
});

router.post(
  "/change-orders/:id/record-acceptance",
  async (req: Request, res: Response) => {
    const parsed = RecordAcceptanceBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    await transitionChangeOrder(req, res, {
      id: String(req.params.id),
      target: "client_accepted",
      requireRole: "leadership_or_finance",
      extraPatch: {
        clientResolvedAt: new Date(),
        evidenceUrl: parsed.data.evidenceUrl,
      },
      auditAction: "change_order_client_accepted",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} recorded client acceptance for change order ${r.id}.`,
    });
  },
);

const RecordRejectionBody = z.object({
  reason: z.string().min(1).max(2000),
});

router.post(
  "/change-orders/:id/record-rejection",
  async (req: Request, res: Response) => {
    const parsed = RecordRejectionBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    await transitionChangeOrder(req, res, {
      id: String(req.params.id),
      target: "client_rejected",
      requireRole: "leadership_or_finance",
      extraPatch: {
        clientResolvedAt: new Date(),
        rationaleText: parsed.data.reason,
      },
      auditAction: "change_order_client_rejected",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} recorded client rejection for change order ${r.id}.`,
    });
  },
);

router.post(
  "/change-orders/:id/withdraw",
  async (req: Request, res: Response) => {
    await transitionChangeOrder(req, res, {
      id: String(req.params.id),
      target: "withdrawn",
      requireRole: "owner_or_leadership",
      extraPatch: { clientResolvedAt: new Date() },
      auditAction: "change_order_withdrawn",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} withdrew change order ${r.id}.`,
    });
  },
);

router.post(
  "/change-orders/:id/post",
  async (req: Request, res: Response) => {
    await transitionChangeOrder(req, res, {
      id: String(req.params.id),
      target: "posted",
      requireRole: "finance",
      extraPatch: { postedAt: new Date() },
      auditAction: "change_order_posted",
      auditSummary: (r) =>
        `${req.atelierPersona?.name ?? "?"} posted change order ${r.id} (Finance commit).`,
    });
  },
);

export default router;
