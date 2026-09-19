import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAssistantEvents,
  atelierCliTurns,
} from "@workspace/db";
import { AssistantRequestV1Schema } from "@workspace/assistant-protocol";
import atelierCliRoutes from "./atelier/cliRoutes.js";
import { attachPersona, rejectClientRealm } from "./atelier/personaCookie.js";
import { attachRls, withRls } from "./atelier/rls.js";
import { cancelDurableAction } from "../lib/assistant/action-runtime.js";
import { confirmAndExecuteDurableAccountUpdate } from "../lib/assistant/durable-account-update-confirmation.js";
import { durableAccountUpdateEnabled } from "../lib/assistant/durable-account-update-canary.js";
import { mergeAssistantReplayEvents } from "../lib/assistant/legacy-event-reader.js";
import {
  assistantProtocolMetadata,
  CANONICAL_ASSISTANT_HEADERS,
  canonicalToLegacyTurnRequest,
} from "../lib/assistant/compatibility.js";

const router: IRouter = Router();
router.use(attachPersona);
router.use(rejectClientRealm);
router.use(attachRls);

router.get("/protocol", (_req, res) => {
  res.json(assistantProtocolMetadata());
});

function negotiateCanonicalProtocol(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
): boolean {
  const offeredVersion = req.header("X-Assistant-Protocol-Version");
  const offeredMode = req.header("X-Assistant-Protocol-Mode");
  const offeredPresentations = req.header("X-Assistant-Presentation-Versions");
  const supported =
    offeredVersion === CANONICAL_ASSISTANT_HEADERS["x-assistant-protocol-version"] &&
    offeredMode === CANONICAL_ASSISTANT_HEADERS["x-assistant-protocol-mode"] &&
    offeredPresentations !== undefined &&
      offeredPresentations.split(",").map((value) => value.trim()).includes(
        CANONICAL_ASSISTANT_HEADERS["x-assistant-presentation-versions"],
      );
  if (!supported) {
    res.status(426).json({
      code: "unsupported_assistant_protocol",
      supported: assistantProtocolMetadata(),
    });
    return false;
  }
  for (const [name, value] of Object.entries(CANONICAL_ASSISTANT_HEADERS)) {
    req.headers[name] = value;
    res.setHeader(name, value);
  }
  return true;
}

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

router.post("/turns", (req, res, next) => {
  const parsed = AssistantRequestV1Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "invalid_request", issues: parsed.error.issues.map((i) => i.code) });
    return;
  }
  if (!negotiateCanonicalProtocol(req, res)) return;
  const body = parsed.data;
  req.body = canonicalToLegacyTurnRequest(body);
  delegateToLegacy(req, res, next, "/cli/turn");
});

router.get("/conversations/:id/events", async (req, res) => {
  if (!negotiateCanonicalProtocol(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const after =
    typeof req.query.after === "string" && req.query.after.length <= 500
      ? req.query.after
      : null;
  const durable = await withRls(req, (tx) => tx
    .select()
    .from(atelierAssistantEvents)
    .where(
      and(
        eq(atelierAssistantEvents.orgId, me.orgId),
        eq(atelierAssistantEvents.requesterId, me.id),
        eq(atelierAssistantEvents.conversationId, req.params.id),
      ),
    )
    .orderBy(asc(atelierAssistantEvents.occurredAt), asc(atelierAssistantEvents.id)));
  const legacy = await withRls(req, (tx) => tx
    .select({
      id: atelierCliTurns.id,
      status: atelierCliTurns.status,
      prompt: atelierCliTurns.prompt,
      frames: atelierCliTurns.frames,
      pendingWrite: atelierCliTurns.pendingWrite,
      createdAt: atelierCliTurns.createdAt,
    })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.orgId, me.orgId),
        eq(atelierCliTurns.userId, me.id),
        eq(atelierCliTurns.sessionId, req.params.id),
      ),
    )
    .orderBy(asc(atelierCliTurns.createdAt), asc(atelierCliTurns.id)));
  const events = mergeAssistantReplayEvents({
    conversationId: req.params.id,
    durable,
    legacy,
    after,
  });
  res.json({
    protocolVersion: 1,
    source: durable.length > 0 && legacy.length > 0
      ? "mixed"
      : durable.length > 0
        ? "durable"
        : "legacy-upcast",
    events,
  });
});

router.post("/actions/:id/confirm", async (req, res, next) => {
  if (!negotiateCanonicalProtocol(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const [action] = await withRls(req, (tx) => tx
    .select()
    .from(atelierAssistantActions)
    .where(
      and(
        eq(atelierAssistantActions.id, req.params.id),
        eq(atelierAssistantActions.orgId, me.orgId),
        eq(atelierAssistantActions.requesterId, me.id),
      ),
    )
    .limit(1));
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
          conversationId: action.conversationId ?? "",
          sourceTurnId: action.sourceTurnId ?? "",
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
  const [legacyTurn] = await withRls(req, (tx) => tx
    .select({ id: atelierCliTurns.id })
    .from(atelierCliTurns)
    .where(and(
      eq(atelierCliTurns.id, req.params.id),
      eq(atelierCliTurns.orgId, me.orgId),
      eq(atelierCliTurns.userId, me.id),
    ))
    .limit(1));
  if (!legacyTurn) {
    res.status(404).json({ code: "action_not_found" });
    return;
  }
  req.body = {
    ...(req.body && typeof req.body === "object" ? req.body : {}),
    typedName:
      typeof req.body?.typedEvidence === "string"
        ? req.body.typedEvidence
        : undefined,
  };
  delegateToLegacy(req, res, next, `/cli/turn/${encodeURIComponent(legacyTurn.id)}/confirm`);
});

router.post("/actions/:id/cancel", async (req, res, next) => {
  if (!negotiateCanonicalProtocol(req, res)) return;
  const me = ensurePersona(req, res);
  if (!me) return;
  const [action] = await withRls(req, (tx) => tx
    .select({ id: atelierAssistantActions.id })
    .from(atelierAssistantActions)
    .where(
      and(
        eq(atelierAssistantActions.id, req.params.id),
        eq(atelierAssistantActions.orgId, me.orgId),
        eq(atelierAssistantActions.requesterId, me.id),
      ),
    )
    .limit(1));
  if (!action) {
    const [legacyTurn] = await withRls(req, (tx) => tx
      .select({ id: atelierCliTurns.id })
      .from(atelierCliTurns)
      .where(and(
        eq(atelierCliTurns.id, req.params.id),
        eq(atelierCliTurns.orgId, me.orgId),
        eq(atelierCliTurns.userId, me.id),
      ))
      .limit(1));
    if (!legacyTurn) {
      res.status(404).json({ code: "action_not_found" });
      return;
    }
    delegateToLegacy(req, res, next, `/cli/turn/${encodeURIComponent(legacyTurn.id)}/cancel`);
    return;
  }
  try {
    res.json(await cancelDurableAction({ actionId: action.id, orgId: me.orgId, requesterId: me.id }));
  } catch (error) {
    res.status(409).json({ code: error instanceof Error ? error.message : "action_cancel_failed" });
  }
});

export default router;