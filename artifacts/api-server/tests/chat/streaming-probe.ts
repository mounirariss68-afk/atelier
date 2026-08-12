/**
 * Task #1000 — live text streaming probe (text_delta frames).
 *
 * Drives the REAL POST /cli/turn SSE endpoint (booted in-process on an
 * isolated scratch DB) against a stub Anthropic server that speaks the
 * STREAMING protocol (stream:true → SSE chunks), with
 * ATELIER_CLI_STREAM_TEXT=on, and pins the streaming contracts:
 *
 *   1. A long final answer streams incrementally: multiple text_delta
 *      frames arrive BEFORE the final narration frame, and folding all
 *      frames through the shared @workspace/chat-core reducer yields
 *      text identical to the final narration (no duplication, exactly
 *      one narration trace entry, not marked streaming).
 *   2. Pre-tool prose that partially streamed is RETRACTED the moment
 *      the tool_use block starts; when that tool then fails, the
 *      reduced turn contains none of the optimistic prose (narration
 *      contract preserved under streaming).
 *   3. Deltas are presentation-only: the persisted turn row contains
 *      NO text_delta frames, and reducing the persisted frames (what
 *      refresh/replay sees) produces the same text as the live stream.
 *
 * Deterministic: local stub Anthropic server (env set BEFORE app import).
 * Rows cleaned in finally.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/chat/streaming-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.ATELIER_CLI_STREAM_TEXT = "on";

import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  applyFrame,
} from "../../../../lib/chat-core/src/reducer.js";
import type { ChatFrame, ChatTurnCore } from "../../../../lib/chat-core/src/types.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 500) : "");
  }
}

const TAG = `probe1000_${Date.now()}`;
// Long enough to clear the 120-char stream hold-back in both scenarios.
const FINAL_ANSWER =
  "final: Here is the summary you asked for. The pipeline currently holds twelve open opportunities across four accounts, " +
  "with the largest concentration in the exploratory stage. Nothing is blocked on your side today, and the next review " +
  "checkpoint lands at the end of this week.";
const FINAL_ANSWER_CLEAN = FINAL_ANSWER.replace(/^final:\s*/i, "");
const PRE_TOOL_PROSE =
  "I'll update that record for you right away — first I am going to pull the existing entry, apply the change you described, " +
  "and then confirm everything saved correctly so you have a full audit trail of the update.";

type Scenario = "long_answer" | "leaky_pre_tool";
let scenario: Scenario = "long_answer";

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
      // Streaming reply: SSE chunks the SDK's stream:true parser expects.
      const sendStream = (
        text: string,
        tool: { id: string; name: string; input: Record<string, unknown> } | null,
        stop: string,
      ) => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const ev = (type: string, data: Record<string, unknown>) =>
          res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", {
          message: {
            id: `msg_${TAG}`,
            type: "message",
            role: "assistant",
            model: parsed.model ?? "claude-haiku-4-5",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        });
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        for (let i = 0; i < text.length; i += 13) {
          ev("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: text.slice(i, i + 13) },
          });
        }
        ev("content_block_stop", { index: 0 });
        if (tool) {
          ev("content_block_start", {
            index: 1,
            content_block: { type: "tool_use", id: tool.id, name: tool.name, input: {} },
          });
          ev("content_block_delta", {
            index: 1,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) },
          });
          ev("content_block_stop", { index: 1 });
        }
        ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 25 } });
        ev("message_stop", {});
        res.end();
      };

      if (systemText.includes("title chat conversations") || systemText.startsWith("You title chat conversations")) {
        sendJson([{ type: "text", text: "Streaming probe" }], "end_turn");
        return;
      }
      if (systemText.startsWith("You are an intent router")) {
        sendJson(
          [{ type: "text", text: JSON.stringify({ verb: "read", kind: "other", entityHints: [], confidence: 0.9 }) }],
          "end_turn",
        );
        return;
      }

      // Orchestrator loop (stream:true expected with ATELIER_CLI_STREAM_TEXT=on).
      const streaming = parsed.stream === true;
      if (scenario === "leaky_pre_tool") {
        const tool = { id: `tu_${TAG}_bad`, name: "definitely_not_a_real_tool", input: {} };
        if (streaming) sendStream(PRE_TOOL_PROSE, tool, "tool_use");
        else sendJson([{ type: "text", text: PRE_TOOL_PROSE }, { type: "tool_use", ...tool }], "tool_use");
        return;
      }
      if (streaming) sendStream(FINAL_ANSWER, null, "end_turn");
      else sendJson([{ type: "text", text: FINAL_ANSWER }], "end_turn");
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;

  const D = await import("@workspace/db");
  const { db, pool, atelierCliSessions, atelierCliTurns, atelierAuditEvents } = D as any;
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

  const freshTurn = (): ChatTurnCore => ({ status: "streaming", text: "", trace: [], toolResults: [] });
  const reduce = (frames: Array<{ event: string; data: any }>): ChatTurnCore =>
    frames.reduce(
      (t, f) => applyFrame(t, { type: f.event, data: f.data, receivedAt: 1 } as unknown as ChatFrame),
      freshTurn(),
    );

  async function runTurn(prompt: string): Promise<Array<{ event: string; data: any }>> {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: COOKIE },
      body: JSON.stringify({ prompt }),
    });
    const text = await res.text();
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
    const fin = frames.find((f) => f.event === "final");
    if (fin?.data?.turnId) turnIds.push(fin.data.turnId);
    if (fin?.data?.sessionId) sessionIds.push(fin.data.sessionId);
    return frames;
  }

  try {
    // ---- Scenario 1: long final answer streams incrementally ----
    scenario = "long_answer";
    const okFrames = await runTurn(`summarize my pipeline ${TAG}`);
    const deltas = okFrames.filter((f) => f.event === "text_delta");
    const narrIdx = okFrames.findIndex((f) => f.event === "narration");
    const firstDeltaIdx = okFrames.findIndex((f) => f.event === "text_delta");
    check("long answer: multiple text_delta frames streamed", deltas.length >= 2, deltas.length);
    check(
      "long answer: deltas arrive before the final narration frame",
      firstDeltaIdx >= 0 && narrIdx > firstDeltaIdx,
      { firstDeltaIdx, narrIdx },
    );
    const narrText = String(okFrames[narrIdx]?.data?.text ?? "");
    check(
      "long answer: 'final:' marker scrubbed from streamed + final text",
      !/final\s*:/i.test(narrText) && !deltas.some((d) => /final\s*:/i.test(String(d.data?.text ?? ""))),
      narrText.slice(0, 60),
    );
    const reduced = reduce(okFrames);
    check(
      "long answer: reduced turn text equals the final narration exactly (no dup)",
      reduced.text === narrText && narrText === FINAL_ANSWER_CLEAN,
      { reduced: reduced.text.slice(0, 80), narr: narrText.slice(0, 80) },
    );
    const narrEntries = reduced.trace.filter((e: any) => e.kind === "narration");
    check(
      "long answer: exactly one narration trace entry, not left streaming",
      narrEntries.length === 1 && !(narrEntries[0] as any).streaming,
      narrEntries,
    );

    // ---- Scenario 2: pre-tool prose retracted; tool failure leaks nothing ----
    scenario = "leaky_pre_tool";
    const badFrames = await runTurn(`update that record ${TAG}`);
    const badDeltas = badFrames.filter((f) => f.event === "text_delta");
    check(
      "pre-tool: prose streamed tentatively then RETRACTED (empty replace frame)",
      badDeltas.length >= 2 &&
        badDeltas.some((d) => d.data?.replace === true && String(d.data?.text ?? "") === ""),
      badDeltas.map((d) => ({ r: d.data?.replace, n: String(d.data?.text ?? "").length })),
    );
    const badReduced = reduce(badFrames);
    check(
      "pre-tool failure: no optimistic prose in reduced turn text or trace",
      !badReduced.text.includes("update that record for you") &&
        !badReduced.trace.some((e: any) => String(e.text ?? "").includes("audit trail of the update")),
      badReduced.text.slice(0, 120),
    );
    check(
      "pre-tool failure: error frame surfaced, no narration frame",
      badFrames.some((f) => f.event === "error") && !badFrames.some((f) => f.event === "narration"),
      badFrames.map((f) => f.event),
    );

    // ---- Scenario 3: persistence/replay parity ----
    const okTurnId = turnIds[0];
    const [row] = await db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, okTurnId));
    const persisted: Array<{ type: string; data: any }> = Array.isArray(row?.frames) ? row.frames : [];
    check(
      "replay: NO text_delta frames persisted on the turn row",
      persisted.length > 0 && !persisted.some((f) => f.type === "text_delta"),
      persisted.map((f) => f.type),
    );
    const replayReduced = persisted.reduce(
      (t, f) => applyFrame(t, { type: f.type, data: f.data, receivedAt: 1 } as unknown as ChatFrame),
      freshTurn(),
    );
    check(
      "replay: reducing persisted frames yields the same text as the live stream",
      replayReduced.text === reduced.text,
      { replay: replayReduced.text.slice(0, 80), live: reduced.text.slice(0, 80) },
    );
  } finally {
    try {
      if (turnIds.length) {
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
