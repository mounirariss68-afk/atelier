import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  atelierWorkAttempts,
  atelierWorkItems,
  atelierWorkSteps,
} from "@workspace/db";
import { attachPersona, rejectClientRealm } from "./atelier/personaCookie.js";
import { attachRls } from "./atelier/rls.js";
import {
  cancelDurableWork,
  createDurableWork,
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
  try {
    const body = createWorkflowSchema.parse(req.body);
    const result = await createDurableWork({
      orgId: me.orgId,
      requesterId: me.id,
      goal: body.goal,
      policyContext: body.policyContext,
      plan: body.plan,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ code: error instanceof Error ? error.message : "invalid_workflow" });
  }
});

router.get("/:id", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const [work] = await db
    .select()
    .from(atelierWorkItems)
    .where(and(eq(atelierWorkItems.id, req.params.id), eq(atelierWorkItems.orgId, me.orgId)))
    .limit(1);
  if (!work) return void res.status(404).json({ code: "work_not_found" });
  const steps = await db.select().from(atelierWorkSteps).where(eq(atelierWorkSteps.workItemId, work.id));
  res.json({ work, steps });
});

router.get("/:id/events", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const [work] = await db
    .select({ id: atelierWorkItems.id })
    .from(atelierWorkItems)
    .where(and(eq(atelierWorkItems.id, req.params.id), eq(atelierWorkItems.orgId, me.orgId)))
    .limit(1);
  if (!work) return void res.status(404).json({ code: "work_not_found" });
  const events = await db
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
    .orderBy(asc(atelierWorkAttempts.createdAt));
  res.json({ events });
});

router.post("/:id/cancel", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) return void res.status(401).json({ code: "no_active_persona" });
  const updated = await cancelDurableWork({
    orgId: me.orgId,
    requesterId: me.id,
    workItemId: req.params.id,
  });
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
  const checkpoint = await decideWorkCheckpoint({
    orgId: me.orgId,
    requesterId: me.id,
    workItemId: req.params.id,
    checkpointId: req.params.checkpointId,
    decision,
    evidence: req.body?.evidence ?? null,
  });
  if (!checkpoint) return void res.status(404).json({ code: "checkpoint_not_found" });
  res.json(checkpoint);
});

export default router;