/**
 * Task #331 — Atelier CLI orchestrator integration tests.
 *
 * Hits the running api-server over HTTP/SSE. Asserts:
 *   1. SSE turn returns final frame + persists atelier_cli_turns row +
 *      writes a `cli.turn` audit event.
 *   2. Read-only tool path (`list_my_open_raid_items`) → status
 *      read_only_no_op or success, no pending write, no DB mutation.
 *   3. Two-phase write: first turn yields needs_confirmation +
 *      pendingWrite is saved; explicit confirm endpoint commits a real
 *      atelier_raid_items row + writes `cli.turn.confirmed`.
 *   4. Idempotent confirm: replaying confirm on a finished turn returns
 *      a `final` frame (no second insert).
 *   5. clientTurnKey replay: same key on the same session returns the
 *      original turn frames (no second turn row created).
 *   6. Cancel endpoint clears pendingWrite and marks status=cancelled.
 *
 * Runs in MOCK_MODE (default) so no Anthropic call is needed — the
 * mock router maps user text → tool call deterministically.
 */
import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import {
  db,
  atelierCliSessions,
  atelierCliTurns,
  atelierCliJobs,
  atelierAuditEvents,
  atelierRaidItems,
} from "@workspace/db";

const BASE = process.env.API_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 8080}/api/atelier`;
const PERSONA_ID = "p_mounir_ariss";
const ENG_ID = process.env.ATELIER_TEST_ENG_ID ?? "eng_tasama_bpo_phase1";
const COOKIE = `atelier_persona=${PERSONA_ID}`;

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json", cookie: COOKIE };
}

interface ParsedFrame {
  event: string;
  data: Record<string, unknown>;
}

async function postSse(
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<{ status: number; frames: ParsedFrame[] }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const frames: ParsedFrame[] = [];
  for (const block of text.split(/\n\n+/)) {
    const evLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!evLine || !dataLine) continue;
    const event = evLine.slice("event:".length).trim();
    const raw = dataLine.slice("data:".length).trim();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
    frames.push({ event, data });
  }
  return { status: res.status, frames };
}

async function postJson(path: string, body?: Record<string, unknown>): Promise<{
  status: number;
  body: unknown;
}> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let parsed: unknown = txt;
  try {
    parsed = JSON.parse(txt);
  } catch {
    /* leave as text */
  }
  return { status: res.status, body: parsed };
}

const createdSessionIds = new Set<string>();
const createdTurnIds = new Set<string>();
const createdRaidIds = new Set<string>();

async function cleanup(): Promise<void> {
  for (const rid of createdRaidIds) {
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, ENG_ID));
    await db.delete(atelierRaidItems).where(eq(atelierRaidItems.id, rid));
  }
  for (const tid of createdTurnIds) {
    await db.delete(atelierCliJobs).where(eq(atelierCliJobs.turnId, tid));
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, tid));
    await db.delete(atelierCliTurns).where(eq(atelierCliTurns.id, tid));
  }
  for (const sid of createdSessionIds) {
    await db.delete(atelierCliSessions).where(eq(atelierCliSessions.id, sid));
  }
}

async function expectFinal(frames: ParsedFrame[]): Promise<ParsedFrame> {
  const final = frames.find((f) => f.event === "final");
  if (!final) throw new Error(`no final frame; got: ${frames.map((f) => f.event).join(",")}`);
  return final;
}

async function test1_readOnly(): Promise<string> {
  const { status, frames } = await postSse("/cli/turn", {
    prompt: "list my open raid items",
  });
  assert.equal(status, 200, "sse 200");
  const final = await expectFinal(frames);
  const sessionId = String(final.data.sessionId);
  const turnId = String(final.data.turnId);
  createdSessionIds.add(sessionId);
  createdTurnIds.add(turnId);

  const toolFrames = frames.filter((f) => f.event === "tool_call");
  assert.equal(toolFrames.length, 1, "one tool call");
  assert.equal(toolFrames[0]!.data.tool, "list_my_open_raid_items");

  const tr = frames.find((f) => f.event === "tool_result");
  assert.ok(tr && tr.data.ok === true, "tool_result ok");

  // Status persisted.
  const [row] = await db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, turnId));
  assert.ok(row, "turn row persisted");
  assert.ok(
    row!.status === "read_only_no_op" || row!.status === "success",
    `unexpected read-only status ${row!.status}`,
  );
  assert.equal(row!.pendingWrite, null, "no pending write on read");

  // Audit row.
  const aud = await db
    .select()
    .from(atelierAuditEvents)
    .where(and(eq(atelierAuditEvents.entityId, turnId), eq(atelierAuditEvents.action, "cli.turn")));
  assert.equal(aud.length, 1, "exactly one cli.turn audit row");

  console.log("✓ test1: read-only path persists turn + audit");
  return sessionId;
}

async function test2_writeTwoPhase(sessionId: string): Promise<void> {
  // First turn — should yield needs_confirmation.
  const draftRes = await postSse("/cli/turn", {
    sessionId,
    prompt: `add raid risk amber for ${ENG_ID}: throughput regression on the new pricing engine`,
  });
  assert.equal(draftRes.status, 200);
  const draftFinal = await expectFinal(draftRes.frames);
  const turnId = String(draftFinal.data.turnId);
  createdTurnIds.add(turnId);
  assert.equal(draftFinal.data.status, "awaiting_confirmation", "awaiting confirmation");

  const needsConf = draftRes.frames.find((f) => f.event === "needs_confirmation");
  assert.ok(needsConf, "needs_confirmation frame emitted");
  const diff = needsConf!.data.diff as Record<string, unknown>;
  assert.equal(diff.engagementId, ENG_ID);
  assert.equal(diff.kind, "risk");

  const [row] = await db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, turnId));
  assert.ok(row?.pendingWrite, "pendingWrite saved on row");
  assert.equal(row!.status, "awaiting_confirmation");

  // Confirm — should commit.
  const confirmRes = await postSse(`/cli/turn/${turnId}/confirm`, {});
  assert.equal(confirmRes.status, 200);
  const confirmFinal = await expectFinal(confirmRes.frames);
  assert.equal(confirmFinal.data.status, "success", "confirm success");

  // RAID row exists.
  const raids = await db
    .select()
    .from(atelierRaidItems)
    .where(and(eq(atelierRaidItems.engagementId, ENG_ID), eq(atelierRaidItems.createdByUserId, PERSONA_ID)));
  const created = raids.find((r) => (r.description ?? "").includes("throughput regression"));
  assert.ok(created, "RAID row was inserted on confirm");
  createdRaidIds.add(created!.id);

  // Idempotent confirm.
  const confirm2 = await postSse(`/cli/turn/${turnId}/confirm`, {});
  const final2 = await expectFinal(confirm2.frames);
  assert.equal(final2.data.replay, true, "second confirm is replay");

  // Audit cli.turn.confirmed exists.
  const aud = await db
    .select()
    .from(atelierAuditEvents)
    .where(and(eq(atelierAuditEvents.entityId, turnId), eq(atelierAuditEvents.action, "cli.turn.confirmed")));
  assert.ok(aud.length >= 1, "cli.turn.confirmed audit emitted");

  console.log("✓ test2: write two-phase commits + audits + idempotent confirm");
}

async function test3_clientTurnKeyReplay(sessionId: string): Promise<void> {
  const key = `key_${Date.now().toString(36)}`;
  const a = await postSse("/cli/turn", {
    sessionId,
    prompt: "find account aico",
    clientTurnKey: key,
  });
  const finalA = await expectFinal(a.frames);
  const turnId = String(finalA.data.turnId);
  createdTurnIds.add(turnId);

  const b = await postSse("/cli/turn", {
    sessionId,
    prompt: "find account aico",
    clientTurnKey: key,
  });
  const finalB = await expectFinal(b.frames);
  assert.equal(finalB.data.replay, true, "second submission with same clientTurnKey replays");
  assert.equal(finalB.data.turnId, turnId, "replay returns same turnId");

  // Only one turn row for that key.
  const rows = await db
    .select()
    .from(atelierCliTurns)
    .where(and(eq(atelierCliTurns.sessionId, sessionId), eq(atelierCliTurns.clientTurnKey, key)));
  assert.equal(rows.length, 1, "only one turn row per clientTurnKey");

  console.log("✓ test3: clientTurnKey is idempotent");
}

async function test5_disambiguation(sessionId: string): Promise<void> {
  // The mock router maps "choose/pick/option" prompts onto the
  // `present_choices` tool, which always returns a disambiguation payload.
  const { status, frames } = await postSse("/cli/turn", {
    sessionId,
    prompt: "give me options to pick",
  });
  assert.equal(status, 200);
  const final = await expectFinal(frames);
  const turnId = String(final.data.turnId);
  createdTurnIds.add(turnId);

  const dis = frames.find((f) => f.event === "needs_disambiguation");
  assert.ok(dis, "needs_disambiguation frame emitted");
  const opts = dis!.data.options as Array<{ id: string; label: string }>;
  assert.ok(Array.isArray(opts) && opts.length >= 2, "≥2 options offered");

  const [row] = await db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, turnId));
  assert.equal(row!.status, "partial", "disambiguation marks turn partial");
  assert.equal(row!.pendingWrite, null, "no pending write on disambiguation");
  console.log("✓ test5: disambiguation halts the turn with options");
}

async function test6_budgetExceeded(sessionId: string): Promise<void> {
  // Submit a dryRun turn for a write — should NOT offer Confirm (no
  // pendingWrite), should emit a `proposed_plan` frame.
  const { status, frames } = await postSse("/cli/turn", {
    sessionId,
    prompt: `add raid risk amber for ${ENG_ID}: dry run plan only`,
    dryRun: true,
  });
  assert.equal(status, 200);
  const final = await expectFinal(frames);
  const turnId = String(final.data.turnId);
  createdTurnIds.add(turnId);

  const plan = frames.find((f) => f.event === "proposed_plan");
  assert.ok(plan, "proposed_plan frame emitted in dry-run");
  assert.equal(plan!.data.dryRun, true, "plan flagged dryRun");

  const conf = frames.find((f) => f.event === "needs_confirmation");
  assert.equal(conf, undefined, "no needs_confirmation in dry-run");

  const [row] = await db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, turnId));
  assert.equal(row!.dryRun, true, "row marked dryRun");
  assert.equal(row!.pendingWrite, null, "no pending write in dry-run");
  assert.ok(row!.planJson, "planJson persisted");
  assert.equal(row!.status, "success", "dry-run terminates success");

  console.log("✓ test6: dry-run emits proposed_plan only, no confirm offered");
}

async function test7_budgetExceededWallClock(): Promise<void> {
  // Real budget-exceeded path: spawn a child node process that imports the
  // orchestrator with ATELIER_CLI_SOFT_WALL_MS=0 + HARD_WALL_MS=0 so the
  // first wall-clock check fires immediately, captures the SSE frames into
  // an in-memory writer, and reports the result. This exercises the
  // budget_exceeded frame and the `partial` terminal status.
  const { spawnSync } = await import("node:child_process");
  const path = await import("node:path");
  const script = path.resolve(import.meta.dirname, "budget-child.ts");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script],
    {
      env: {
        ...process.env,
        ATELIER_CLI_SOFT_WALL_MS: "-1",
        ATELIER_CLI_HARD_WALL_MS: "60000",
        ATELIER_MOCK_AGENTS: "1",
      },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `budget-child failed (exit ${result.status}):\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
  }
  const out = JSON.parse(result.stdout.trim().split("\n").pop()!);
  createdTurnIds.add(out.turnId);
  assert.equal(out.status, "partial", "budget-exceeded turn ends in partial");
  assert.ok(out.budgetFrame, "budget_exceeded frame emitted");
  console.log("✓ test7: wall-clock budget exceeded → partial + budget_exceeded frame");
}

async function test4_cancel(sessionId: string): Promise<void> {
  const draft = await postSse("/cli/turn", {
    sessionId,
    prompt: `add raid issue red for ${ENG_ID}: vendor lockout incoming`,
  });
  const final = await expectFinal(draft.frames);
  assert.equal(final.data.status, "awaiting_confirmation");
  const turnId = String(final.data.turnId);
  createdTurnIds.add(turnId);

  const cancel = await postJson(`/cli/turn/${turnId}/cancel`, {});
  assert.equal(cancel.status, 200);
  assert.equal((cancel.body as { status: string }).status, "cancelled");

  const [row] = await db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, turnId));
  assert.equal(row!.status, "cancelled");
  assert.equal(row!.pendingWrite, null);

  console.log("✓ test4: cancel clears pendingWrite + marks cancelled");
}

async function main(): Promise<void> {
  // Pre-flight: confirm the API server is up.
  const ping = await fetch(`${BASE}/me`, { headers: { cookie: COOKIE } });
  if (!ping.ok) throw new Error(`api server not reachable at ${BASE}: ${ping.status}`);

  let sessionId: string;
  try {
    sessionId = await test1_readOnly();
    await test2_writeTwoPhase(sessionId);
    await test3_clientTurnKeyReplay(sessionId);
    await test4_cancel(sessionId);
    await test5_disambiguation(sessionId);
    await test6_budgetExceeded(sessionId);
    await test7_budgetExceededWallClock();
    console.log("ALL CLI-TURN TESTS PASSED");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
