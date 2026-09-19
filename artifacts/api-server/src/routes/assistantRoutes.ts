import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAssistantEvents,
  atelierCliTurns,
} from "@workspace/db";
import {
  AssistantRequestV1Schema,
  upcastLegacyFrame,
} from "@workspace/assistant-protocol";
import atelierCliRoutes from "./atelier/cliRoutes.js";
import { attachPersona, rejectClientRealm } from "./atelier/personaCookie.js";
import { attachRls } from "./atelier/rls.js";
import { cancelDurableAction } from "../lib/assistant/action-runtime.js";
import { confirmAndExecuteDurableAccountUpdate } from "../lib/assistant/durable-account-update-confirmation.js";

const router: IRouter = Router();
router.use(attachPersona);
router.use(rejectClientRealm);
router.use(attachRls);

function ensurePersona(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  if (!req.atelierPersona) {
    res.status(401).json({ code: "no_active_persona" });
    return null;
  }
  return req.atelierPersona;
}

function delegateToLegacy(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2], url: string): void {
  req.url = url;
  (
    atelierCliRoutes as unknown as {
      handle: (request: typeof req, response: typeof res, nextFn: typeof next) => void;
    }
  ).handle(req, res, next);
}

function durableAccountUpdateEnabled(orgId: string): boolean {
  if (process.env.RISER_DURABLE_ACCOUNT_UPDATE !== "1") return false;
  const allowlist = new Set(
    (process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowlist.has(orgId);
}

router.post("/turns", (req, res, next) => {
  const parsed = AssistantRequestV1Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_request", issues: parsed.error.issues.map((i) => i.code) });
    return;
  }
  const body = parsed.data;
  req.body = {
    sessionId: body.conversationId,
    prompt: body.prompt,
    attachmentIds: body.attachmentIds,
    pageContext: body.pageContext ?? null,
    dryRun: body.dryRun,
    cancelInflight: body.cancelInflight,
    clientTurnKey: body.clientTurnKey,
    async: body.async,
    reset: body.reset,
    continuesTurnId: body.continuesTurnId,
    clarificationValues: body.clarificationValues,
    disambigOptionId: body.disambigOptionId,
    timezone: body.timezone,
  };
  delegateToLegacy(req, res, next, "/cli/turn");
});

router.get("/conversations/:id/events", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const after = Number(req.query.after ?? -1);
  const durable = await db
    .select()
    .from(atelierAssistantEvents)
    .where(
      and(
        eq(atelierAssistantEvents.orgId, me.orgId),
        eq(atelierAssistantEvents.requesterId, me.id),
        eq(atelierAssistantEvents.conversationId, req.params.id),
        gt(atelierAssistantEvents.conversationSequence, Number.isSafeInteger(after) ? after : -1),
      ),
    )
    .orderBy(asc(atelierAssistantEvents.conversationSequence))
    .limit(1_000);
  if (durable.length > 0) {
    res.json({
      protocolVersion: 1,
      events: durable.map((event) => ({
        protocolVersion: event.protocolVersion,
        conversationId: event.conversationId,
        turnId: event.turnId,
        eventId: event.id,
        sequence: event.sequence,
        cursor: event.conversationSequence,
        occurredAt: event.occurredAt.toISOString(),
        correlationId: event.correlationId,
        type: event.type,
        data: event.data,
      })),
      source: "durable",
    });
    return;
  }
  const legacy = await db
    .select({ id: atelierCliTurns.id, frames: atelierCliTurns.frames })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.orgId, me.orgId),
        eq(atelierCliTurns.userId, me.id),
        eq(atelierCliTurns.sessionId, req.params.id),
      ),
    )
    .orderBy(asc(atelierCliTurns.createdAt))
    .limit(100);
  res.json({
    protocolVersion: 1,
    source: "legacy-upcast",
    events: legacy.flatMap((turn) =>
      turn.frames.map((frame, index) => ({
        ...upcastLegacyFrame(frame),
        conversationId: req.params.id,
        turnId: turn.id,
        sequence: index,
      })),
    ),
  });
});

router.post("/actions/:id/confirm", async (req, res, next) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [action] = await db
    .select()
    .from(atelierAssistantActions)
    .where(
      and(
        eq(atelierAssistantActions.id, req.params.id),
        eq(atelierAssistantActions.orgId, me.orgId),
        eq(atelierAssistantActions.requesterId, me.id),
      ),
    )
    .limit(1);
  if (action) {
    if (
      action.capabilityId === "coverage.account_update" &&
      durableAccountUpdateEnabled(me.orgId)
    ) {
      try {
        const outcome = await confirmAndExecuteDurableAccountUpdate({
          actionId: action.id,
          orgId: me.orgId,
          requesterId: me.id,
          persona: me,
          expectedStateVersion:
            typeof req.body?.stateVersion === "number" ? req.body.stateVersion : undefined,
          typedEvidence:
            typeof req.body?.typedEvidence === "string" ? req.body.typedEvidence : undefined,
        });
        res.json(outcome);
      } catch (error) {
        req.log?.warn?.(
          {
            actionId: action.id,
            errorClass: error instanceof Error ? error.name : "unknown",
          },
          "durable account update confirmation failed",
        );
        res.status(409).json({
          code: "action_not_confirmable",
          message: "This action could not be confirmed safely.",
        });
      }
      return;
    }
    res.status(409).json({
      code: "action_executor_not_enabled",
      message: "This durable action cannot execute until its pinned executor is enabled.",
    });
    return;
  }
  delegateToLegacy(req, res, next, `/cli/turn/${encodeURIComponent(req.params.id)}/confirm`);
});

router.post("/actions/:id/cancel", async (req, res, next) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [action] = await db
    .select({ id: atelierAssistantActions.id })
    .from(atelierAssistantActions)
    .where(
      and(
        eq(atelierAssistantActions.id, req.params.id),
        eq(atelierAssistantActions.orgId, me.orgId),
        eq(atelierAssistantActions.requesterId, me.id),
      ),
    )
    .limit(1);
  if (!action) {
    delegateToLegacy(req, res, next, `/cli/turn/${encodeURIComponent(req.params.id)}/cancel`);
    return;
  }
  try {
    res.json(await cancelDurableAction({ actionId: action.id, orgId: me.orgId, requesterId: me.id }));
  } catch (error) {
    res.status(409).json({ code: error instanceof Error ? error.message : "action_cancel_failed" });
  }
});

export default router;