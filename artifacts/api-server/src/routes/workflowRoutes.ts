import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  atelierWorkAttempts,
  atelierWorkItems,
  atelierWorkSteps,
} from "@workspace/db";
import { attachPersona, rejectClientRealm } from "./atelier/personaCookie.js";
import { attachRls, withRls } from "./atelier/rls.js";
import {
  cancelDurableWork,
  decideWorkCheckpoint,
} from "../lib/assistant/workflow-runtime.js";
import { z } from "zod";

const router: IRouter = Router();
router.use(attachPersona);
router.use(rejectClientRealm);
router.use(attachRls);

function enabled(): boolean {
  // Fail closed until plans, grants, policy pins, and result schemas are
  // generated and authorized server-side. An environment toggle must not
  // turn a client-authored plan into executable authority.
  return false;
}

const createWorkflowSchema = z
  .object({
    goal: z.string().min(1).max(2_000),
    policyContext: z.record(z.string(), z.unknown()),
    plan: z.unknown(),
  })
  .strict();

router.post("/", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  if (!enabled()) {
    return void res.status(503).json({ code: "workflow_writes_disabled" });
  }
  createWorkflowSchema.parse(req.body);
  res.status(503).json({ code: "workflow_writes_disabled" });
});

router.get("/:id", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const [work] = await withRls(req, (tx) => tx
    .select()
    .from(atelierWorkItems)
    .where(and(
      eq(atelierWorkItems.id, req.params.id),
      eq(atelierWorkItems.orgId, me.orgId),
      eq(atelierWorkItems.requesterId, me.id),
    ))
    .limit(1));
  if (!work) return void res.status(404).json({ code: "work_not_found" });
  const steps = await withRls(req, (tx) =>
    tx.select().from(atelierWorkSteps).where(eq(atelierWorkSteps.workItemId, work.id)));
  res.json({ work, steps });
});

router.get("/:id/events", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const [work] = await withRls(req, (tx) => tx
    .select({ id: atelierWorkItems.id })
    .from(atelierWorkItems)
    .where(and(
      eq(atelierWorkItems.id, req.params.id),
      eq(atelierWorkItems.orgId, me.orgId),
      eq(atelierWorkItems.requesterId, me.id),
    ))
    .limit(1));
  if (!work) return void res.status(404).json({ code: "work_not_found" });
  const events = await withRls(req, (tx) => tx
    .select({
      id: atelierWorkAttempts.id,
      stepId: atelierWorkAttempts.stepId,
      status: atelierWorkAttempts.status,
      startedAt: atelierWorkAttempts.startedAt,
      endedAt: atelierWorkAttempts.endedAt,
      errorClass: atelierWorkAttempts.errorClass,
    })
    .from(atelierWorkAttempts)
    .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
    .where(eq(atelierWorkSteps.workItemId, work.id))
    .orderBy(asc(atelierWorkAttempts.createdAt)));
  res.json({ events });
});

router.post("/:id/cancel", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const updated = await withRls(req, (tx) => cancelDurableWork({
    orgId: me.orgId,
    requesterId: me.id,
    workItemId: req.params.id,
    transactionRunner: { transaction: async (fn) => fn(tx) },
  }));
  if (!updated) return void res.status(404).json({ code: "work_not_found" });
  res.json(updated);
});

router.post("/:id/checkpoints/:checkpointId/decide", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const decision = req.body?.decision;
  if (decision !== "approve" && decision !== "reject") {
    return void res.status(400).json({ code: "invalid_checkpoint_decision" });
  }
  const checkpoint = await withRls(req, (tx) => decideWorkCheckpoint({
    orgId: me.orgId,
    requesterId: me.id,
    workItemId: req.params.id,
    checkpointId: req.params.checkpointId,
    decision,
    evidence: req.body?.evidence ?? null,
    deciderRoles: me.role ? [me.role] : [],
    transactionRunner: { transaction: async (fn) => fn(tx) },
  }));
  if (!checkpoint) return void res.status(404).json({ code: "checkpoint_not_found" });
  res.json(checkpoint);
});

export default router;