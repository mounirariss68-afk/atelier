/**
 * Task #645 — chat output-contract probe (narration vs cards/errors).
 *
 * Drives the REAL POST /cli/turn SSE endpoint (booted in-process on an
 * isolated scratch DB) with a stub Anthropic server and pins the
 * deterministic server backstops:
 *
 *   1. Pre-tool narration ("I'll do X…") is HELD until the tool outcome
 *      is known; when the step ends in an error (unknown tool), the
 *      optimistic prose is dropped — no narration frame contradicting
 *      the error is streamed.
 *   2. When the tool succeeds, the held narration IS streamed (exactly
 *      once) and exactly one tool_result frame is emitted per tool step.
 *   3. Leaked "final:" / "answer:" markers are still scrubbed.
 *
 * Deterministic: local stub Anthropic server (env set BEFORE app import)
 * scripts the orchestrator steps; no live model. Rows cleaned in finally.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-output-contract-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe645_${Date.now()}`;
const PRE_TOOL_TEXT = "I'll pull up your open RAID items now.";
const FAIL_PRE_TOOL_TEXT = "I'll update that record for you right away.";
const CLOSING_TEXT = "final: You have no open RAID items.";

type Scenario = "ok_read" | "bad_tool";
let scenario: Scenario = "ok_read";

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
      const messages: any[] = Array.isArray(parsed.messages) ? parsed.messages : [];
      const send = (content: unknown[], stop: string) => {
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

      if (systemText.startsWith("You title chat conversations")) {
        send([{ type: "text", text: "Output contract probe" }], "end_turn");
        return;
      }
      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "read",
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

      // Orchestrator loop.
      const sawToolResult = messages.some(
        (m: any) =>
          m?.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c?.type === "tool_result"),
      );
      if (scenario === "bad_tool") {
        // Optimistic pre-tool prose + a tool that is not registered →
        // the orchestrator errors the turn; the prose must be dropped.
        send(
          [
            { type: "text", text: FAIL_PRE_TOOL_TEXT },
            {
              type: "tool_use",
              id: `tu_${TAG}_bad`,
              name: "definitely_not_a_real_tool",
              input: {},
            },
          ],
          "tool_use",
        );
        return;
      }
      if (!sawToolResult) {
        send(
          [
            { type: "text", text: PRE_TOOL_TEXT },
            {
              type: "tool_use",
              id: `tu_${TAG}_ok`,
              name: "list_my_open_raid_items",
              input: {},
            },
          ],
          "tool_use",
        );
        return;
      }
      send([{ type: "text", text: CLOSING_TEXT }], "end_turn");
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
    // ---- Scenario 1: successful read ----
    scenario = "ok_read";
    const okFrames = await runTurn(`show my open raid items ${TAG}`);
    const narrations = okFrames.filter((f) => f.event === "narration");
    const toolResults = okFrames.filter((f) => f.event === "tool_result");
    check(
      "ok read: held pre-tool narration streamed exactly once after success",
      narrations.filter((n) => String(n.data?.text ?? "") === PRE_TOOL_TEXT).length === 1,
      narrations.map((n) => n.data?.text),
    );
    check(
      "ok read: exactly one tool_result frame for the single tool step",
      toolResults.length === 1,
      toolResults.length,
    );
    check(
      "ok read: closing narration present with 'final:' marker scrubbed",
      narrations.some(
        (n) =>
          String(n.data?.text ?? "").includes("no open RAID items") &&
          !/^\s*final\s*:/i.test(String(n.data?.text ?? "")),
      ),
      narrations.map((n) => n.data?.text),
    );

    // ---- Scenario 2: failing tool step drops optimistic prose ----
    scenario = "bad_tool";
    const badFrames = await runTurn(`update that record ${TAG}`);
    const badNarrations = badFrames.filter((f) => f.event === "narration");
    check(
      "failed step: optimistic pre-tool narration is suppressed",
      !badNarrations.some((n) => String(n.data?.text ?? "") === FAIL_PRE_TOOL_TEXT),
      badNarrations.map((n) => n.data?.text),
    );
    check(
      "failed step: error frame surfaced",
      badFrames.some((f) => f.event === "error"),
      badFrames.map((f) => f.event),
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
