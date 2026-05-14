/**
 * Task #331 — Atelier CLI HTTP routes (SSE).
 *
 * Endpoints (all under `/api/atelier`):
 *
 *   POST  /cli/turn                     SSE — runs one turn end-to-end.
 *                                       Body: { sessionId?, userText, intent?,
 *                                               clientTurnKey? }
 *   POST  /cli/turn/:id/confirm         SSE — commits the awaiting_confirmation
 *                                       diff for a prior turn (two-phase write).
 *   POST  /cli/turn/:id/cancel          JSON — discards the pending write.
 *   GET   /cli/sessions                 JSON — recent sessions for the persona.
 *   GET   /cli/sessions/:id             JSON — session + last 50 turns.
 *
 * SSE framing follows the orchestrator's `CliFrame` shape:
 *   event: <type>
 *   data:  <json>
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, atelierCliSessions, atelierCliTurns, atelierUsers } from "@workspace/db";
import {
  runTurn,
  confirmPendingWrite,
  cancelPendingWrite,
  writeSseFrame,
  CliBudgetExceededError,
  CliConcurrencyError,
  type CliFrame,
} from "../../lib/atelier-cli/index.js";

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

function openSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Initial newline so the client's EventSource sees headers immediately.
  res.write("\n");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

const router: IRouter = Router();

router.post("/cli/turn", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;

  const body = req.body as {
    sessionId?: string | null;
    userText?: string;
    intent?: string | null;
    clientTurnKey?: string | null;
  };
  const userText = (body.userText ?? "").trim();
  if (!userText) {
    res.status(400).json({ error: "user-text-required" });
    return;
  }
  if (userText.length > 4000) {
    res.status(400).json({ error: "user-text-too-long" });
    return;
  }

  openSse(res);
  const persona = { id: me.id, name: me.name, role: me.role, orgId: me.orgId };
  const emit = (frame: CliFrame) => writeSseFrame(res, frame);

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  try {
    await runTurn(
      {
        sessionId: body.sessionId ?? null,
        userText,
        intent: body.intent ?? null,
        clientTurnKey: body.clientTurnKey ?? null,
      },
      { persona, emit: (f) => (closed ? undefined : emit(f)) },
    );
  } catch (err) {
    const code =
      err instanceof CliBudgetExceededError
        ? "budget_exceeded"
        : err instanceof CliConcurrencyError
          ? "concurrency"
          : "internal";
    if (!closed) {
      emit({
        type: "error",
        data: { code, message: err instanceof Error ? err.message : String(err) },
      });
    }
  } finally {
    res.end();
  }
});

router.post("/cli/turn/:id/confirm", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  openSse(res);
  const persona = { id: me.id, name: me.name, role: me.role, orgId: me.orgId };
  const emit = (frame: CliFrame) => writeSseFrame(res, frame);
  try {
    await confirmPendingWrite(req.params.id, persona, emit);
  } catch (err) {
    emit({
      type: "error",
      data: { message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    res.end();
  }
});

router.post("/cli/turn/:id/cancel", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  try {
    const persona = { id: me.id, name: me.name, role: me.role, orgId: me.orgId };
    const out = await cancelPendingWrite(req.params.id, persona);
    res.json(out);
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/cli/sessions", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierCliSessions)
    .where(
      and(
        eq(atelierCliSessions.userId, me.id),
        eq(atelierCliSessions.orgId, me.orgId),
        isNull(atelierCliSessions.deletedAt),
      ),
    )
    .orderBy(desc(atelierCliSessions.lastTurnAt))
    .limit(20);
  res.json({
    sessions: rows.map((s) => ({
      id: s.id,
      title: s.title,
      turnCount: s.turnCount,
      lastTurnAt: s.lastTurnAt?.toISOString() ?? null,
      spentUsdToday: s.spentUsdToday,
    })),
  });
});

router.get("/cli/sessions/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [session] = await db
    .select()
    .from(atelierCliSessions)
    .where(
      and(
        eq(atelierCliSessions.id, req.params.id),
        eq(atelierCliSessions.userId, me.id),
        eq(atelierCliSessions.orgId, me.orgId),
      ),
    )
    .limit(1);
  if (!session) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const turns = await db
    .select()
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.sessionId, session.id))
    .orderBy(desc(atelierCliTurns.createdAt))
    .limit(50);
  res.json({
    session: {
      id: session.id,
      title: session.title,
      rollingSummary: session.rollingSummary,
      spentUsdToday: session.spentUsdToday,
      turnCount: session.turnCount,
    },
    turns: turns.map((t) => ({
      id: t.id,
      status: t.status,
      userText: t.userText,
      intent: t.intent,
      frames: t.frames,
      pendingWrite: t.pendingWrite,
      costUsd: t.costUsd,
      durationMs: t.durationMs,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export default router;
