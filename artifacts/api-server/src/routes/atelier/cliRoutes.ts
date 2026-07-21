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
 *   PATCH /cli/sessions/:id             JSON — rename a session (Task #485).
 *
 * SSE framing follows the orchestrator's `CliFrame` shape:
 *   event: <type>
 *   data:  <json>
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, gte, isNull, lte, ne, sql } from "drizzle-orm";
import {
  db,
  atelierCliSessions,
  atelierCliTurns,
  atelierUsers,
  atelierAuditEvents,
} from "@workspace/db";
import { assertAuditAction, V3_AUDIT_ACTIONS } from "./auditContract.js";
import {
  runTurn,
  confirmPendingWrite,
  cancelPendingWrite,
  writeSseFrame,
  CliBudgetExceededError,
  CliConcurrencyError,
  sanitizeClarificationFields,
  type CliFrame,
} from "../../lib/atelier-cli/index.js";
import { stripLocalePreamble } from "../../lib/atelier-cli/locale.js";
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

/**
 * SSE comment heartbeat — keeps the Replit proxy (and any intermediary
 * load balancer) from dropping an idle connection during long agent runs.
 * A chat turn that dispatches a web-search agent (e.g. the account
 * cartographer) can go ~60–90s with no SSE frames while Anthropic performs
 * the actual search server-side; without a heartbeat the proxy closes the
 * socket ("request aborted") and the turn's result never reaches the client.
 * Mirrors the pattern in routes/chat.ts. Returns a stop function.
 */
function startHeartbeat(res: Response): () => void {
  const interval = setInterval(() => {
    try {
      res.write(": ping\n\n");
      const flush = (res as unknown as { flush?: () => void }).flush;
      if (typeof flush === "function") flush.call(res);
    } catch {
      // socket closed — the handler's finally will clear this interval.
    }
  }, 15_000);
  interval.unref?.();
  return () => clearInterval(interval);
}

const router: IRouter = Router();

// @cli-skip: pending Task #340 read-parity migration
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
    continuesTurnId?: string | null;
    clarificationValues?: Record<string, unknown> | null;
  };
  // Multi-field clarification answers — sanitize to a bounded map of
  // string → string before it reaches the orchestrator.
  let clarificationValues: Record<string, string> | null = null;
  if (
    body.clarificationValues &&
    typeof body.clarificationValues === "object" &&
    !Array.isArray(body.clarificationValues)
  ) {
    const entries = Object.entries(body.clarificationValues)
      .filter(([k, v]) => typeof k === "string" && k.length > 0 && k.length <= 200 && typeof v === "string")
      .slice(0, 40)
      .map(([k, v]) => [k, (v as string).slice(0, 2000)] as const);
    if (entries.length > 0) clarificationValues = Object.fromEntries(entries);
  }
  const promptRawWithPreamble = (body.prompt ?? "").trim();
  if (!promptRawWithPreamble) {
    res.status(400).json({ error: "prompt-required" });
    return;
  }
  if (promptRawWithPreamble.length > 4000) {
    res.status(400).json({ error: "prompt-too-long" });
    return;
  }
  // Task #484 — strip the client's locale-instruction preamble at HTTP
  // ingress, BEFORE any downstream consumer sees the prompt. Without
  // this, the preamble corrupts entity-hint extraction (returns
  // ["Respond","English",...]), the country-extraction fallback regex
  // (first-matches "in English" instead of "in UAE"), the mock router's
  // 60-char prompt slice, redactText, and the durable rolling summary.
  const promptRaw = stripLocalePreamble(promptRawWithPreamble);
  // Task #484 — guard against a prompt that was non-empty pre-strip but
  // is now empty post-strip (i.e. the client sent the locale preamble
  // alone with nothing else). Reject with the same shape as the
  // initial empty-prompt check so the client can render it identically.
  if (!promptRaw.trim()) {
    res.status(400).json({ error: "prompt-required" });
    return;
  }
  // `/new` (or explicit reset:true) starts a fresh session before the
  // turn runs. Strip the slash command from the prompt sent to the model.
  const isNewCmd = /^\/new\b/i.test(promptRaw);
  const prompt = isNewCmd ? promptRaw.replace(/^\/new\b\s*/i, "").trim() || "(new session)" : promptRaw;
  const reset = body.reset === true || isNewCmd;
  const sessionId = reset ? null : (body.sessionId ?? null);

  openSse(res);
  const stopHeartbeat = startHeartbeat(res);
  const persona = { id: me.id, name: me.name, role: me.role, orgId: me.orgId };
  const emit = (frame: CliFrame) => writeSseFrame(res, frame);

  let closed = false;
  req.on("close", () => {
    closed = true;
    stopHeartbeat();
  });

  // Task #24 — emit a progress frame immediately so the user sees
  // feedback before the (potentially queued + LLM-bound) turn starts.
  emit({ type: "progress", data: { pct: 2, message: "Working on it…" } });

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
        continuesTurnId:
          typeof body.continuesTurnId === "string" && body.continuesTurnId.length > 0
            ? body.continuesTurnId
            : null,
        clarificationValues,
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
    stopHeartbeat();
    res.end();
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/cli/turn/:id/confirm", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  openSse(res);
  const stopHeartbeat = startHeartbeat(res);
  const persona = { id: me.id, name: me.name, role: me.role, orgId: me.orgId };
  // Task #24 — client-disconnect safety: if the confirming client
  // drops (tab close, abort), the committed write must still finish;
  // we only stop WRITING frames to the dead socket, never interrupt
  // the orchestrator run itself.
  let closed = false;
  req.on("close", () => {
    closed = true;
    stopHeartbeat();
  });
  const emit = (frame: CliFrame) => (closed ? undefined : writeSseFrame(res, frame));
  // Task #24 — immediate feedback while the confirm serializes through
  // the per-user queue and commits.
  emit({ type: "progress", data: { pct: 2, message: "Confirming…" } });
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
    stopHeartbeat();
    res.end();
  }
});

// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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
 * Task #485 — rename a chat session. Scoped to the owning user + org;
 * validates the title length (1–60 chars after trimming). A manual
 * rename can never be overwritten by the auto-title job because that
 * UPDATE is guarded on `title IS NULL`. The change is audited.
 */
// @cli-skip: session housekeeping, not a capability
router.patch("/cli/sessions/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const raw = (req.body as { title?: unknown } | undefined)?.title;
  if (typeof raw !== "string") {
    res.status(400).json({ error: "title-required" });
    return;
  }
  const title = raw.trim().replace(/\s+/g, " ");
  if (title.length === 0) {
    res.status(400).json({ error: "title-empty" });
    return;
  }
  if (title.length > 60) {
    res.status(400).json({ error: "title-too-long", maxLength: 60 });
    return;
  }
  const [session] = await db
    .select({ id: atelierCliSessions.id, title: atelierCliSessions.title })
    .from(atelierCliSessions)
    .where(
      and(
        eq(atelierCliSessions.id, req.params.id),
        eq(atelierCliSessions.userId, me.id),
        eq(atelierCliSessions.orgId, me.orgId),
        isNull(atelierCliSessions.deletedAt),
      ),
    )
    .limit(1);
  if (!session) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  await db
    .update(atelierCliSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(atelierCliSessions.id, session.id));
  assertAuditAction(V3_AUDIT_ACTIONS.CLI_SESSION_RENAMED);
  await db.insert(atelierAuditEvents).values({
    id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    orgId: me.orgId,
    entityType: "cli_session",
    entityId: session.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: V3_AUDIT_ACTIONS.CLI_SESSION_RENAMED,
    payload: { from: session.title, to: title },
    payloadSummary: `Chat renamed to "${title}"`,
  });
  res.json({ ok: true, session: { id: session.id, title } });
});

/**
 * Task #490 — delete a chat session (soft-delete: sets deletedAt so the
 * list query hides it; turns are kept for audit). Scoped to the owning
 * user + org. Any turn in the session still paused awaiting_clarification
 * is cancelled so the pending-clarification rehydration lookup (which
 * deliberately ignores session deletedAt for inactivity rollover, Task
 * #184) never resurrects a question from an explicitly deleted chat.
 * Idempotent: deleting an already-deleted session returns 404 (the
 * scoping select filters on deletedAt IS NULL).
 */
// @cli-skip: session housekeeping, not a capability
router.delete("/cli/sessions/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [session] = await db
    .select({ id: atelierCliSessions.id, title: atelierCliSessions.title })
    .from(atelierCliSessions)
    .where(
      and(
        eq(atelierCliSessions.id, req.params.id),
        eq(atelierCliSessions.userId, me.id),
        eq(atelierCliSessions.orgId, me.orgId),
        isNull(atelierCliSessions.deletedAt),
      ),
    )
    .limit(1);
  if (!session) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const now = new Date();
  await db
    .update(atelierCliSessions)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(atelierCliSessions.id, session.id));
  await db
    .update(atelierCliTurns)
    .set({
      status: "cancelled",
      statusMessage: "session deleted by user",
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(atelierCliTurns.sessionId, session.id),
        eq(atelierCliTurns.status, "awaiting_clarification"),
      ),
    );
  assertAuditAction(V3_AUDIT_ACTIONS.CLI_SESSION_DELETED);
  await db.insert(atelierAuditEvents).values({
    id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    orgId: me.orgId,
    entityType: "cli_session",
    entityId: session.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: V3_AUDIT_ACTIONS.CLI_SESSION_DELETED,
    payload: { title: session.title },
    payloadSummary: `Chat deleted${session.title ? ` ("${session.title}")` : ""}`,
  });
  res.json({ ok: true, session: { id: session.id } });
});

/**
 * Task #333 — recent turns across all sessions for the persona, used
 * by the right-rail Activity tab to render per-turn `cli_turn` rows
 * with status icon and a deep-link to /cli?session=…&turn=…
 */
// @cli-skip: pending Task #340 read-parity migration
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

/**
 * Clarification durability — returns the persona's most recent turn
 * still paused `awaiting_clarification`, so the chat client can restore
 * the question card after a page reload / server restart. Task #184:
 * the question survives session inactivity rollover (including sessions
 * already soft-deleted by an older build), so the lookup no longer
 * requires the turn to be the newest overall or its session to be live.
 * Supersession rules:
 *   - Task #196: any newer turn by the same user, in ANY session,
 *     supersedes the question (the conversation moved on — abandoned
 *     questions from older sessions must never resurrect);
 *   - answering via continuation marks the source turn resolved, which
 *     also removes it here;
 *   - questions older than 7 days expire.
 */
// @cli-skip: read-only rehydration helper, not a capability
router.get("/cli/turns/pending-clarification", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // Task #197 — on-read sweep: rows the endpoint would hide anyway
  // (expired past the 7-day TTL, or superseded by any newer turn from
  // the same user) are flipped to `cancelled` so status-based queries
  // and metrics don't see an ever-growing set of "open" questions.
  // This changes stored status only for rows that could never be
  // returned here, so rehydration semantics are unchanged.
  const now = new Date();
  await db
    .update(atelierCliTurns)
    .set({
      status: "cancelled",
      statusMessage: "clarification expired (older than 7 days)",
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(atelierCliTurns.userId, me.id),
        eq(atelierCliTurns.orgId, me.orgId),
        eq(atelierCliTurns.status, "awaiting_clarification"),
        lte(atelierCliTurns.createdAt, new Date(now.getTime() - PENDING_TTL_MS)),
      ),
    );
  await db
    .update(atelierCliTurns)
    .set({
      status: "cancelled",
      statusMessage: "superseded by newer activity",
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(atelierCliTurns.userId, me.id),
        eq(atelierCliTurns.orgId, me.orgId),
        eq(atelierCliTurns.status, "awaiting_clarification"),
        sql`EXISTS (
          SELECT 1 FROM ${atelierCliTurns} AS newer
          WHERE newer.user_id = ${me.id}
            AND newer.org_id = ${me.orgId}
            AND newer.created_at >= ${atelierCliTurns.createdAt}
            AND newer.id <> ${atelierCliTurns.id}
        )`,
      ),
    );
  const [row] = await db
    .select({
      id: atelierCliTurns.id,
      sessionId: atelierCliTurns.sessionId,
      status: atelierCliTurns.status,
      prompt: atelierCliTurns.prompt,
      frames: atelierCliTurns.frames,
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
        eq(atelierCliTurns.status, "awaiting_clarification"),
        gt(atelierCliTurns.createdAt, new Date(Date.now() - PENDING_TTL_MS)),
      ),
    )
    .orderBy(desc(atelierCliTurns.createdAt))
    .limit(1);
  if (!row) {
    res.json({ pending: null });
    return;
  }
  // Task #196 — any newer turn by the same user (org-scoped, ANY session)
  // supersedes the question: once the conversation has moved on, an
  // abandoned question must never resurrect. This is the single
  // supersession mechanism — the continuation path additionally cancels
  // its own source turn, but stale siblings in older sessions are
  // handled here, so no data patch is needed for existing stuck rows.
  // Compare with >= plus an id exclusion: Postgres keeps microsecond
  // timestamps while the JS Date round-trips at millisecond precision,
  // so a strict `created_at > $roundedDown` would match the row itself.
  const [newerTurn] = await db
    .select({ id: atelierCliTurns.id })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.userId, me.id),
        eq(atelierCliTurns.orgId, me.orgId),
        gte(atelierCliTurns.createdAt, row.createdAt),
        ne(atelierCliTurns.id, row.id),
      ),
    )
    .limit(1);
  if (newerTurn) {
    res.json({ pending: null });
    return;
  }
  const frames = Array.isArray(row.frames)
    ? (row.frames as Array<{ type?: string; data?: Record<string, unknown> }>)
    : [];
  const nc = [...frames].reverse().find((f) => f?.type === "needs_clarification");
  const d = nc?.data as
    | {
        field?: string;
        question?: string;
        tool?: string;
        partial?: Record<string, unknown>;
        suggestions?: Array<{ id: string; label: string; hint?: string }>;
        fields?: Array<{ field: string; label: string; hint?: string }>;
      }
    | undefined;
  if (!d || typeof d.field !== "string" || typeof d.tool !== "string") {
    res.json({ pending: null });
    return;
  }
  res.json({
    pending: {
      turnId: row.id,
      sessionId: row.sessionId,
      prompt: row.prompt,
      createdAt: row.createdAt.toISOString(),
      clarification: {
        field: d.field,
        question: typeof d.question === "string" ? d.question : "",
        tool: d.tool,
        partial: d.partial && typeof d.partial === "object" ? d.partial : {},
        suggestions: Array.isArray(d.suggestions) ? d.suggestions : [],
        fields: sanitizeClarificationFields(d.fields) ?? [],
      },
    },
  });
});

// @cli-skip: pending Task #340 read-parity migration
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
// @cli-skip: pending Task #340 read-parity migration
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
      examplePhrases: c.examplePhrases ?? null,
      // Task #20 — opt-in chip promotion. Only capabilities that
      // deliberately set this contribute suggestion chips client-side;
      // /help still renders every capability's examplePhrases.
      promoteAsSuggestion: c.promoteAsSuggestion === true,
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
// @cli-skip: pending Task #340 read-parity migration
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
