/**
 * Task #335 — Atelier CLI help / admin / feedback / recording / digest.
 *
 * Endpoints (all under `/api/atelier`):
 *
 *   GET   /cli/help                          grouped catalog + example phrases.
 *   GET   /cli/help/suggestions?surface=…    3-5 page-aware suggestion chips.
 *   POST  /cli/turns/:id/feedback            persist 👍/👎 + optional category.
 *   GET   /cli/turns/:id/recording           founding-partner replay payload.
 *   GET   /cli/admin/turns                   observability — list+filter.
 *   GET   /cli/admin/metrics                 aggregate cost/latency/feedback.
 *   GET   /cli/admin/digest/weekly           7-day digest payload (rendered
 *                                             by a future mailer; safe to
 *                                             call ad-hoc).
 *
 * Admin endpoints require `founding_partner` role; feedback is open to
 * the persona that owns the turn. The recording endpoint additionally
 * requires `ATELIER_CLI_RECORDING_ENABLED=1` in the environment to
 * avoid leaking model-traffic in normal deployments.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, sql, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierCliTurns,
  atelierCliSessions,
  atelierAuditEvents,
} from "@workspace/db";
import {
  helpForPersona,
  suggestionsForSurface,
} from "../../lib/atelier-cli/help.js";
import {
  capabilitiesForPersona,
  CATALOG_SCHEMA_VERSION,
  type SurfaceContext,
} from "../../lib/atelier-cli/capability-catalog.js";
import { V3_AUDIT_ACTIONS } from "./auditContract.js";

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

function ensureFoundingPartner(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (me.role !== "founding_partner") {
    res.status(403).json({ error: "founding-partner-only" });
    return null;
  }
  return me;
}

const VALID_SURFACES: ReadonlySet<SurfaceContext> = new Set([
  "engagement_dashboard",
  "account_workspace",
  "opportunity_workspace",
  "wallet",
  "ledger",
  "roster",
  "global",
]);

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const router: IRouter = Router();

// ---------------------------------------------------------------------
// GET /cli/help — grouped catalog with example phrases.
// ---------------------------------------------------------------------
router.get("/cli/help", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const payload = helpForPersona({
    id: me.id,
    name: me.name,
    role: me.role,
    orgId: me.orgId,
  });
  res.json(payload);
});

// ---------------------------------------------------------------------
// GET /cli/help/suggestions?surface=… — 3-5 chips for the composer.
// ---------------------------------------------------------------------
router.get("/cli/help/suggestions", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const surfaceRaw = String(req.query.surface ?? "global") as SurfaceContext;
  const surface = VALID_SURFACES.has(surfaceRaw) ? surfaceRaw : "global";
  const limit = Math.min(8, Math.max(1, Number(req.query.limit ?? 5)));
  const suggestions = suggestionsForSurface(
    { id: me.id, name: me.name, role: me.role, orgId: me.orgId },
    surface,
    limit,
  );
  res.json({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    surface,
    suggestions,
  });
});

// ---------------------------------------------------------------------
// POST /cli/turns/:id/feedback — persist 👍/👎.
// ---------------------------------------------------------------------
router.post("/cli/turns/:id/feedback", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const body = (req.body ?? {}) as {
    thumb?: "up" | "down";
    category?: string;
    freeText?: string;
  };
  if (body.thumb !== "up" && body.thumb !== "down") {
    res.status(400).json({ error: "thumb-required" });
    return;
  }
  // Owner check — a persona can only rate turns from their own org +
  // their own user_id (no cross-user rating, even within the same org).
  const [turn] = await db
    .select({
      id: atelierCliTurns.id,
      userId: atelierCliTurns.userId,
      orgId: atelierCliTurns.orgId,
    })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.id, req.params.id),
        eq(atelierCliTurns.orgId, me.orgId),
      ),
    );
  if (!turn) {
    res.status(404).json({ error: "turn-not-found" });
    return;
  }
  if (turn.userId !== me.id) {
    res.status(403).json({ error: "not-your-turn" });
    return;
  }
  const ALLOWED_CATEGORIES = new Set([
    "intent_mis",
    "wrong_record",
    "missing_field",
    "unsafe_write",
    "hallucinated_id",
    "other",
  ]);
  const category =
    typeof body.category === "string" && ALLOWED_CATEGORIES.has(body.category)
      ? body.category
      : undefined;
  const freeText =
    typeof body.freeText === "string" ? body.freeText.slice(0, 1000) : undefined;
  const recordedAt = new Date().toISOString();
  await db
    .update(atelierCliTurns)
    .set({
      feedback: { thumb: body.thumb, category, freeText, recordedAt },
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.id, turn.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "cli_turn",
    entityId: turn.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: V3_AUDIT_ACTIONS.CLI_FEEDBACK,
    payload: { thumb: body.thumb, category, hasFreeText: Boolean(freeText), recordedAt },
    payloadSummary: `CLI feedback: ${body.thumb}${category ? ` (${category})` : ""}`,
  });
  res.json({ ok: true, turnId: turn.id, feedback: { thumb: body.thumb, category, freeText, recordedAt } });
});

// ---------------------------------------------------------------------
// GET /cli/turns/:id/recording — founding-partner replay payload.
// ---------------------------------------------------------------------
router.get("/cli/turns/:id/recording", async (req, res) => {
  const me = ensureFoundingPartner(req, res);
  if (!me) return;
  if (process.env.ATELIER_CLI_RECORDING_ENABLED !== "1") {
    res.status(403).json({ error: "recording-disabled" });
    return;
  }
  const [turn] = await db
    .select()
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.id, req.params.id),
        eq(atelierCliTurns.orgId, me.orgId),
      ),
    );
  if (!turn) {
    res.status(404).json({ error: "turn-not-found" });
    return;
  }
  // We don't persist the raw Anthropic body (system prompt + tools +
  // messages) yet — call out the gap explicitly so consumers don't
  // assume forensic fidelity. What we DO have is the persisted SSE
  // frames + tool_calls + plan_json + step_results, which are enough
  // to replay the deterministic-mock model path end-to-end.
  res.json({
    turnId: turn.id,
    sessionId: turn.sessionId,
    note:
      "Live model body capture not yet wired; this payload is the deterministic-replayable trace.",
    prompt: turn.prompt,
    intent: turn.intent,
    pageContext: turn.pageContext,
    attachmentRefs: turn.attachmentRefs,
    status: turn.status,
    frames: turn.frames,
    toolCalls: turn.toolCalls,
    planJson: turn.planJson,
    stepResults: turn.stepResults,
    recordingTrace: turn.recordingTrace ?? null,
    cost: {
      cents: turn.costCents,
      tokensIn: turn.tokensIn,
      tokensOut: turn.tokensOut,
      latencyMs: turn.latencyMs,
      model: turn.model,
    },
  });
});

// ---------------------------------------------------------------------
// GET /cli/admin/turns — observability listing.
// ---------------------------------------------------------------------
router.get("/cli/admin/turns", async (req, res) => {
  const me = ensureFoundingPartner(req, res);
  if (!me) return;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const sinceParam = req.query.since;
  const filters = [eq(atelierCliTurns.orgId, me.orgId)];
  if (typeof sinceParam === "string") {
    const since = new Date(sinceParam);
    if (!Number.isNaN(since.getTime())) {
      filters.push(gte(atelierCliTurns.createdAt, since));
    }
  }
  if (typeof req.query.userId === "string") {
    filters.push(eq(atelierCliTurns.userId, req.query.userId));
  }
  if (typeof req.query.status === "string") {
    filters.push(eq(atelierCliTurns.status, req.query.status));
  }
  if (typeof req.query.until === "string") {
    const until = new Date(req.query.until);
    if (!Number.isNaN(until.getTime())) {
      filters.push(sql`${atelierCliTurns.createdAt} <= ${until.toISOString()}`);
    }
  }
  if (typeof req.query.module === "string" && req.query.module.length > 0) {
    const modTools = capabilitiesForPersona({
      id: me.id,
      name: me.name,
      role: me.role,
      orgId: me.orgId,
    })
      .filter((c) => c.module === req.query.module)
      .map((c) => c.toolName);
    if (modTools.length === 0) {
      res.json({ turns: [] });
      return;
    }
    const orParts = modTools.map(
      (t) => sql`${atelierCliTurns.toolCalls} @> ${JSON.stringify([{ tool: t }])}::jsonb`,
    );
    filters.push(sql`(${sql.join(orParts, sql` OR `)})`);
  }
  const rows = await db
    .select({
      id: atelierCliTurns.id,
      sessionId: atelierCliTurns.sessionId,
      userId: atelierCliTurns.userId,
      status: atelierCliTurns.status,
      prompt: atelierCliTurns.prompt,
      intent: atelierCliTurns.intent,
      costCents: atelierCliTurns.costCents,
      latencyMs: atelierCliTurns.latencyMs,
      tokensIn: atelierCliTurns.tokensIn,
      tokensOut: atelierCliTurns.tokensOut,
      model: atelierCliTurns.model,
      feedback: atelierCliTurns.feedback,
      createdAt: atelierCliTurns.createdAt,
    })
    .from(atelierCliTurns)
    .where(and(...filters))
    .orderBy(desc(atelierCliTurns.createdAt))
    .limit(limit);
  res.json({
    turns: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------
// GET /cli/admin/metrics — aggregates + percentiles + behavioral rates.
//
// Filters: ?days=7  ?module=raid  ?since=ISO  ?until=ISO
// ---------------------------------------------------------------------
router.get("/cli/admin/metrics", async (req, res) => {
  const me = ensureFoundingPartner(req, res);
  if (!me) return;
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7)));
  const since =
    typeof req.query.since === "string" && !Number.isNaN(new Date(req.query.since).getTime())
      ? new Date(req.query.since)
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filters = [
    eq(atelierCliTurns.orgId, me.orgId),
    gte(atelierCliTurns.createdAt, since),
  ];
  if (typeof req.query.until === "string") {
    const until = new Date(req.query.until);
    if (!Number.isNaN(until.getTime())) {
      filters.push(sql`${atelierCliTurns.createdAt} <= ${until.toISOString()}`);
    }
  }
  const moduleFilter =
    typeof req.query.module === "string" && req.query.module.length > 0
      ? req.query.module
      : null;
  // Module filter is jsonb-side: a tool_call's tool name maps to a
  // capability whose `module` we want. We can't join against an
  // in-memory catalog from SQL, so we materialise the matching tool
  // names + apply a `tool_calls @> ...` predicate.
  if (moduleFilter) {
    const me2 = { id: me.id, name: me.name, role: me.role, orgId: me.orgId };
    const modTools = capabilitiesForPersona(me2)
      .filter((c) => c.module === moduleFilter)
      .map((c) => c.toolName);
    if (modTools.length === 0) {
      res.json({ rangeDays: days, since: since.toISOString(), module: moduleFilter, empty: true });
      return;
    }
    const orParts = modTools.map(
      (t) => sql`${atelierCliTurns.toolCalls} @> ${JSON.stringify([{ tool: t }])}::jsonb`,
    );
    filters.push(sql`(${sql.join(orParts, sql` OR `)})`);
  }

  const [agg] = await db
    .select({
      turnCount: sql<number>`count(*)::int`,
      totalCostCents: sql<number>`coalesce(sum(${atelierCliTurns.costCents}), 0)::int`,
      avgLatencyMs: sql<number>`coalesce(avg(${atelierCliTurns.latencyMs}), 0)::int`,
      // Postgres percentile_cont returns numeric; cast for JSON safety.
      p50LatencyMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${atelierCliTurns.latencyMs}), 0)::int`,
      p95LatencyMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${atelierCliTurns.latencyMs}), 0)::int`,
      p50CostCents: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${atelierCliTurns.costCents}), 0)::int`,
      p95CostCents: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${atelierCliTurns.costCents}), 0)::int`,
      totalTokensIn: sql<number>`coalesce(sum(${atelierCliTurns.tokensIn}), 0)::bigint`,
      totalTokensOut: sql<number>`coalesce(sum(${atelierCliTurns.tokensOut}), 0)::bigint`,
      thumbsUp: sql<number>`count(*) filter (where ${atelierCliTurns.feedback}->>'thumb' = 'up')::int`,
      thumbsDown: sql<number>`count(*) filter (where ${atelierCliTurns.feedback}->>'thumb' = 'down')::int`,
      errorCount: sql<number>`count(*) filter (where ${atelierCliTurns.status} = 'error')::int`,
      partialCount: sql<number>`count(*) filter (where ${atelierCliTurns.status} = 'partial')::int`,
      successCount: sql<number>`count(*) filter (where ${atelierCliTurns.status} = 'success')::int`,
      readOnlyNoOpCount: sql<number>`count(*) filter (where ${atelierCliTurns.status} = 'read_only_no_op')::int`,
      asyncDispatchedCount: sql<number>`count(*) filter (where ${atelierCliTurns.status} = 'async_dispatched')::int`,
      // Behavioral rates — confirmation = had pending_write resolved;
      // disambiguation = a needs_disambiguation frame appeared.
      confirmationCount: sql<number>`count(*) filter (where ${atelierCliTurns.frames}::text like '%"needs_confirmation"%')::int`,
      disambiguationCount: sql<number>`count(*) filter (where ${atelierCliTurns.frames}::text like '%"needs_disambiguation"%')::int`,
    })
    .from(atelierCliTurns)
    .where(and(...filters));

  // Undo rate from the audit log — every cli.undo writes one row.
  const [undoAgg] = await db
    .select({
      undoCount: sql<number>`count(*)::int`,
    })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.action, V3_AUDIT_ACTIONS.CLI_UNDO),
        gte(atelierAuditEvents.createdAt, since),
      ),
    );

  const turnCount = agg?.turnCount ?? 0;
  const safeRate = (n: number) => (turnCount > 0 ? Math.round((n / turnCount) * 1000) / 1000 : 0);
  res.json({
    rangeDays: days,
    since: since.toISOString(),
    module: moduleFilter,
    ...agg,
    totalTokensIn: Number(agg?.totalTokensIn ?? 0),
    totalTokensOut: Number(agg?.totalTokensOut ?? 0),
    rates: {
      success: safeRate(agg?.successCount ?? 0),
      error: safeRate(agg?.errorCount ?? 0),
      partial: safeRate(agg?.partialCount ?? 0),
      readOnlyNoOp: safeRate(agg?.readOnlyNoOpCount ?? 0),
      confirmation: safeRate(agg?.confirmationCount ?? 0),
      disambiguation: safeRate(agg?.disambiguationCount ?? 0),
      thumbsUp: safeRate(agg?.thumbsUp ?? 0),
      thumbsDown: safeRate(agg?.thumbsDown ?? 0),
      undo: safeRate(undoAgg?.undoCount ?? 0),
    },
    undoCount: undoAgg?.undoCount ?? 0,
  });
});

// ---------------------------------------------------------------------
// GET /cli/admin/digest/weekly — 7-day rollup ready for a mailer.
// ---------------------------------------------------------------------
router.get("/cli/admin/digest/weekly", async (req, res) => {
  const me = ensureFoundingPartner(req, res);
  if (!me) return;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // Top users by turn count.
  const topUsers = await db
    .select({
      userId: atelierCliTurns.userId,
      turnCount: sql<number>`count(*)::int`,
      totalCostCents: sql<number>`coalesce(sum(${atelierCliTurns.costCents}), 0)::int`,
    })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.orgId, me.orgId),
        gte(atelierCliTurns.createdAt, since),
      ),
    )
    .groupBy(atelierCliTurns.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  // Most-used tools (one row per tool_call entry — flattened in JS).
  const turnsForTools = await db
    .select({ toolCalls: atelierCliTurns.toolCalls })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.orgId, me.orgId),
        gte(atelierCliTurns.createdAt, since),
      ),
    );
  const toolCounts = new Map<string, number>();
  for (const t of turnsForTools) {
    const calls = (t.toolCalls as Array<{ tool: string }> | null) ?? [];
    for (const c of calls) {
      toolCounts.set(c.tool, (toolCounts.get(c.tool) ?? 0) + 1);
    }
  }
  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }));
  // Headline metrics (re-uses the shape of /admin/metrics).
  const [agg] = await db
    .select({
      turnCount: sql<number>`count(*)::int`,
      totalCostCents: sql<number>`coalesce(sum(${atelierCliTurns.costCents}), 0)::int`,
      thumbsUp: sql<number>`count(*) filter (where ${atelierCliTurns.feedback}->>'thumb' = 'up')::int`,
      thumbsDown: sql<number>`count(*) filter (where ${atelierCliTurns.feedback}->>'thumb' = 'down')::int`,
      errorCount: sql<number>`count(*) filter (where ${atelierCliTurns.status} = 'error')::int`,
    })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.orgId, me.orgId),
        gte(atelierCliTurns.createdAt, since),
      ),
    );
  res.json({
    weekOf: since.toISOString().slice(0, 10),
    headline: agg ?? {
      turnCount: 0,
      totalCostCents: 0,
      thumbsUp: 0,
      thumbsDown: 0,
      errorCount: 0,
    },
    topUsers,
    topTools,
    catalog: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      capabilityCount: capabilitiesForPersona({
        id: me.id,
        name: me.name,
        role: me.role,
        orgId: me.orgId,
      }).length,
    },
  });
});

export default router;
