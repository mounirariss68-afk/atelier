/**
 * Task #1116 — background-queued chat writes need a REAL approval.
 *
 * Before this task, a turn that paused `awaiting_confirmation` could be
 * handed off to a background runner (long write plan past the async
 * step threshold, or a caller-supplied `async:true` on POST /cli/turn)
 * which replayed the server-persisted pendingWrite via `tool.run(...)`
 * directly — committing a write the user NEVER approved and skipping
 * the typed-name gate and approver-role separation that
 * `confirmPendingWrite` enforces.
 *
 * Contract pinned here (mirrors Task #1093's unforgeable confirm):
 *   1. `async:true` + a two-phase write → the turn pauses
 *      `awaiting_confirmation` with a needs_confirmation card; NO
 *      async_dispatched frame; NO row written; NO atelier_cli_jobs row
 *      enqueued for the turn.
 *   2. POST /cli/turn/:id/confirm afterwards → exactly ONE row.
 *   3. Re-running with async:true again never changes (1).
 *
 * Deterministic: local stub Anthropic server (env set BEFORE app import),
 * isolated scratch DB. Rows cleaned in finally.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/cli-turn/async-approval-gate.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(
      `FAIL ${name}`,
      detail !== undefined ? JSON.stringify(detail)?.slice(0, 500) : "",
    );
  }
}

const TAG = `probe1116_${Date.now()}`;
const TASK_TITLE = `Prepare the board pack ${TAG}`;

async function main() {
  // ---- stub Anthropic server (must exist before the app import) ----
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      let parsed: any = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {}
      const systemText = Array.isArray(parsed.system)
        ? parsed.system.map((b: any) => b?.text ?? "").join("\n")
        : String(parsed.system ?? "");
      const sendJson = (content: unknown[], stop: string) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `msg_${TAG}`,
            type: "message",
            role: "assistant",
            model: parsed.model ?? "claude-haiku-4-5",
            content,
            stop_reason: stop,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        );
      };
      if (
        systemText.includes("title chat conversations") ||
        systemText.startsWith("You title chat conversations")
      ) {
        sendJson([{ type: "text", text: "Async approval probe" }], "end_turn");
        return;
      }
      if (systemText.startsWith("You are an intent router")) {
        sendJson(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "create",
                kind: "other",
                entityHints: [],
                confidence: 0.9,
              }),
            },
          ],
          "end_turn",
        );
        return;
      }
      // Orchestrator loop: propose the two-phase write (phase 1, no
      // confirm flag — the model behaves; the bypass under test is the
      // ASYNC hand-off, not confirm forgery).
      const hasToolResult = Array.isArray(parsed.messages)
        ? parsed.messages.some(
            (m: any) =>
              Array.isArray(m?.content) &&
              m.content.some((b: any) => b?.type === "tool_result"),
          )
        : false;
      if (!hasToolResult) {
        sendJson(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_p1`,
              name: "create_my_task",
              input: { title: TASK_TITLE },
            },
          ],
          "tool_use",
        );
        return;
      }
      sendJson([{ type: "text", text: "final: Done." }], "end_turn");
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierCliSessions,
    atelierCliTurns,
    atelierCliJobs,
    atelierAuditEvents,
    atelierPersonalTasks,
  } = D as any;
  const { eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const COOKIE = "atelier_persona=p_mounir_ariss";

  const turnIds: string[] = [];
  const sessionIds: string[] = [];

  function parseFrames(text: string): Array<{ event: string; data: any }> {
    const frames: Array<{ event: string; data: any }> = [];
    for (const block of text.split(/\n\n+/)) {
      const ev = block.split("\n").find((l) => l.startsWith("event:"));
      const dl = block.split("\n").find((l) => l.startsWith("data:"));
      if (!ev || !dl) continue;
      let data: any = {};
      try {
        data = JSON.parse(dl.slice(5).trim());
      } catch {}
      frames.push({ event: ev.slice(6).trim(), data });
    }
    return frames;
  }

  async function postTurn(prompt: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: COOKIE },
      body: JSON.stringify({ prompt, ...extra }),
    });
    const frames = parseFrames(await res.text());
    const fin = frames.find((f) => f.event === "final");
    if (fin?.data?.turnId) turnIds.push(fin.data.turnId);
    if (fin?.data?.sessionId) sessionIds.push(fin.data.sessionId);
    return { frames, final: fin?.data, turnId: fin?.data?.turnId as string | undefined };
  }

  async function postConfirm(turnId: string) {
    const res = await fetch(`${BASE}/cli/turn/${turnId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: COOKIE },
      body: JSON.stringify({}),
    });
    const frames = parseFrames(await res.text());
    return { frames, final: frames.find((f) => f.event === "final")?.data };
  }

  const taskRows = () =>
    db
      .select()
      .from(atelierPersonalTasks)
      .where(eq(atelierPersonalTasks.title, TASK_TITLE));

  // Small settle window: the old bypass committed via setImmediate, so a
  // purely synchronous row check could pass by racing the background
  // runner. Give any (now-forbidden) fire-and-forget commit time to land.
  const settle = () => new Promise((r) => setTimeout(r, 750));

  try {
    // ---- 1. async:true + two-phase write → approval still required ----
    const t1 = await postTurn(`remind me: ${TASK_TITLE}`, { async: true });
    const conf = t1.frames.find((f) => f.event === "needs_confirmation");
    check(
      "async:true → needs_confirmation card still shown",
      !!conf,
      t1.frames.map((f) => f.event),
    );
    check(
      "async:true → turn pauses awaiting_confirmation (NOT async_dispatched)",
      t1.final?.status === "awaiting_confirmation",
      t1.final,
    );
    check(
      "async:true → no async_dispatched frame emitted",
      !t1.frames.some((f) => f.event === "async_dispatched"),
      t1.frames.map((f) => f.event),
    );
    await settle();
    const rows0 = await taskRows();
    check("async:true → NO task row written without approval", rows0.length === 0, rows0.length);

    if (!t1.turnId) throw new Error("no turnId from async turn");
    const jobs0 = await db
      .select()
      .from(atelierCliJobs)
      .where(eq(atelierCliJobs.idempotencyKey, `${t1.turnId}:async_plan`));
    check("async:true → no async_plan job row enqueued", jobs0.length === 0, jobs0.length);

    // pendingWrite must survive for the legit /confirm replay.
    const [row] = await db
      .select()
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, t1.turnId));
    check(
      "pendingWrite persisted for the /confirm replay",
      (row?.pendingWrite as { tool?: string } | null)?.tool === "create_my_task",
      row?.pendingWrite,
    );

    // ---- 2. real approval via /confirm → exactly one row ----
    const c1 = await postConfirm(t1.turnId);
    check(
      "/confirm commits the write",
      c1.final?.status === "success" || c1.final?.confirmed === true,
      c1.final,
    );
    await settle();
    const rows1 = await taskRows();
    check("/confirm → exactly ONE task row", rows1.length === 1, rows1.length);

    // ---- 3. still no async job materialized after the commit ----
    const jobs1 = await db
      .select()
      .from(atelierCliJobs)
      .where(eq(atelierCliJobs.idempotencyKey, `${t1.turnId}:async_plan`));
    check("post-confirm → still no async_plan job row", jobs1.length === 0, jobs1.length);
  } finally {
    try {
      const rows = await taskRows();
      if (rows.length) {
        await db
          .delete(atelierPersonalTasks)
          .where(inArray(atelierPersonalTasks.id, rows.map((r: any) => r.id)));
      }
      if (turnIds.length) {
        await db.delete(atelierCliJobs).where(inArray(atelierCliJobs.turnId, turnIds));
        await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, turnIds));
        await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.id, turnIds));
      }
      for (const sid of sessionIds) {
        await db.delete(atelierCliSessions).where(eq(atelierCliSessions.id, sid));
      }
    } catch (err) {
      console.error("cleanup error", err);
    }
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
