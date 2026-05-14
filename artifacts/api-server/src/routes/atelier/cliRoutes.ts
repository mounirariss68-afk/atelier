/**
 * Task #331 — Atelier CLI HTTP routes (SSE).
 *
 * Endpoints (all under `/api/atelier`):
 *
 *   POST  /cli/turn                     SSE — runs one turn end-to-end.
 *                                       Body: { sessionId?, prompt,
 *                                               attachmentIds?, pageContext?,
 *                                               dryRun?, intent?,
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
import {
  capabilitiesForPersona,
  CATALOG_SCHEMA_VERSION,
} from "../../lib/atelier-cli/capability-catalog.js";

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
    prompt?: string;
    attachmentIds?: string[];
    pageContext?: Record<string, unknown> | null;
    dryRun?: boolean;
    cancelInflight?: boolean;
    intent?: string | null;
    clientTurnKey?: string | null;
    async?: boolean;
    reset?: boolean;
  };
  const promptRaw = (body.prompt ?? "").trim();
  if (!promptRaw) {
    res.status(400).json({ error: "prompt-required" });
    return;
  }
  if (promptRaw.length > 4000) {
    res.status(400).json({ error: "prompt-too-long" });
    return;
  }
  // `/new` (or explicit reset:true) starts a fresh session before the
  // turn runs. Strip the slash command from the prompt sent to the model.
  const isNewCmd = /^\/new\b/i.test(promptRaw);
  const prompt = isNewCmd ? promptRaw.replace(/^\/new\b\s*/i, "").trim() || "(new session)" : promptRaw;
  const reset = body.reset === true || isNewCmd;
  const sessionId = reset ? null : (body.sessionId ?? null);

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
        sessionId,
        prompt,
        attachmentIds: body.attachmentIds ?? [],
        pageContext: body.pageContext ?? null,
        dryRun: body.dryRun === true,
        cancelInflight: body.cancelInflight === true,
        intent: body.intent ?? null,
        clientTurnKey: body.clientTurnKey ?? null,
        async: body.async === true,
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
  // Task #332 — irreversible ops require the client to retype the
  // entity name; we forward it to the orchestrator which checks it
  // against the saved pendingWrite hint before the run callback fires.
  const body = (req.body ?? {}) as { typedName?: string };
  // Confirm performs the actual write — it must serialize through the
  // same per-user FIFO queue runTurn uses so a confirm never races
  // another in-flight write for the same user.
  try {
    await runTurn(
      {
        sessionId: null,
        prompt: "(confirm)",
        confirmTurnId: req.params.id,
        typedName: typeof body.typedName === "string" ? body.typedName : undefined,
      },
      { persona, emit },
    );
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
      spentCentsToday: s.spentCentsToday,
    })),
  });
});

/**
 * Task #333 — recent turns across all sessions for the persona, used
 * by the right-rail Activity tab to render per-turn `cli_turn` rows
 * with status icon and a deep-link to /cli?session=…&turn=…
 */
router.get("/cli/turns/recent", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 10)));
  const rows = await db
    .select({
      id: atelierCliTurns.id,
      sessionId: atelierCliTurns.sessionId,
      status: atelierCliTurns.status,
      prompt: atelierCliTurns.prompt,
      createdAt: atelierCliTurns.createdAt,
    })
    .from(atelierCliTurns)
    .innerJoin(
      atelierCliSessions,
      eq(atelierCliTurns.sessionId, atelierCliSessions.id),
    )
    .where(
      and(
        eq(atelierCliSessions.userId, me.id),
        eq(atelierCliSessions.orgId, me.orgId),
        isNull(atelierCliSessions.deletedAt),
      ),
    )
    .orderBy(desc(atelierCliTurns.createdAt))
    .limit(limit);
  res.json({
    turns: rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      status: r.status,
      prompt: r.prompt,
      createdAt: r.createdAt.toISOString(),
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
      spentCentsToday: session.spentCentsToday,
      turnCount: session.turnCount,
    },
    turns: turns.map((t) => ({
      id: t.id,
      status: t.status,
      prompt: t.prompt,
      intent: t.intent,
      frames: t.frames,
      pendingWrite: t.pendingWrite,
      planJson: t.planJson,
      attachmentRefs: t.attachmentRefs,
      pageContext: t.pageContext,
      dryRun: t.dryRun,
      costCents: t.costCents,
      latencyMs: t.latencyMs,
      stepResults: t.stepResults,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

/**
 * Task #333 — list role-filtered capabilities for the slash-command
 * palette + /help drawer. The orchestrator already filters by role at
 * tool-binding time; this endpoint mirrors that filter so the client
 * never offers a slash that the server would reject.
 */
router.get("/cli/capabilities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Match CliPersona shape exactly (lib/atelier-cli/index.ts:89) — no
  // `locale` field, so no `as never` cast required.
  const caps = capabilitiesForPersona({
    id: me.id,
    name: me.name,
    role: me.role,
    orgId: me.orgId,
  });
  res.json({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    capabilities: caps.map((c) => ({
      id: c.id,
      module: c.module,
      toolName: c.toolName,
      description: c.description,
      slashAliases: c.slashAliases,
      isWrite: c.isWrite,
      irreversible: c.irreversible,
      surfaceOn: c.surfaceOn,
      twoPhaseConfirm: c.twoPhaseConfirm,
      outboundChannel: c.outboundChannel,
      resultCard: c.resultCard,
      inputSchema: c.inputSchema,
      // Optional examples — Task #332 catalog may add per-locale
      // example phrasings later; surface the field as forward-safe so
      // the client /help drawer can render them when present.
      examplePhrases:
        (c as { examplePhrases?: { en?: string[]; ar?: string[]; fr?: string[] } | null })
          .examplePhrases ?? null,
    })),
  });
});

/**
 * Task #342 — best-effort sink for `cli.opened` discoverability events.
 *
 * The client emits these via sendBeacon when each launcher (header
 * "Ask Atelier" button, ⌘K shortcut, Home input, Home chip, floating
 * bubble, slash command, deep link, empty-state chip, first-run
 * tooltip) opens the CLI. Body shape:
 *
 *   { event: "cli.opened", source: <CliOpenedSource>,
 *     surface?: string, prompt?: string|null, ts: number }
 *
 * We log and 204 — no DB writes, no validation beyond shape. A future
 * pass can fan this out to the analytics warehouse without changing
 * the client contract.
 */
router.post("/cli/events", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const body = (req.body ?? {}) as {
    event?: string;
    source?: string;
    surface?: string | null;
    prompt?: string | null;
    ts?: number;
  };
  if (body.event !== "cli.opened" || typeof body.source !== "string") {
    res.status(204).end();
    return;
  }
  // Console-only sink for now; intentionally avoids logging the prompt
  // body to keep PII out of server logs.
  // eslint-disable-next-line no-console
  console.info("[atelier-cli] cli.opened", {
    userId: me.id,
    role: me.role,
    source: body.source,
    surface: body.surface ?? null,
    hasPrompt: typeof body.prompt === "string" && body.prompt.length > 0,
    ts: body.ts ?? Date.now(),
  });
  res.status(204).end();
});

export default router;
