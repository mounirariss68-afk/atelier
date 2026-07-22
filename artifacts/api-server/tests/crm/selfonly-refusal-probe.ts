/**
 * Task #591 — clamped (self-only) personas get helpful guidance, not
 * dead ends, when chat cannot do what they asked.
 *
 * Drives the REAL POST /cli/turn SSE endpoint (booted in-process on an
 * isolated scratch DB) with a stub Anthropic server and pins the
 * end-to-end refusal wording for employee / contractor personas asking
 * for out-of-scope actions:
 *
 *   1. Employee asks to send a contract for e-signature → the stub
 *      model reaches for an org-wide tool (`contract_send`); the
 *      self-only surface gate emits a plain-language refusal frame
 *      (never an `unknown_tool` error, never a catalog-fallthrough
 *      run) carrying the user's current page href.
 *   2. Employee asks to upload to the firm document library → the stub
 *      model ends the turn with no tools and no text; the classifier
 *      "other" fallback refusal fires, also with the page href.
 *   3. Contractor asks for an HR-admin action → the stub model calls
 *      `person_update`; same self-only refusal, contractor branch.
 *
 * Every refusal frame is asserted to be plain language: no snake_case
 * tool tokens, no registered tool names / capability ids, a pageHref
 * pointing back at the page the user was on, and a request_feature CTA.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/selfonly-refusal-probe.ts
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

const TAG = `probe591_${Date.now()}`;

// Snake_case tool-token detector (two+ segments), mirrors the scrubber's
// fallback pattern in capability-catalog.ts.
const SNAKE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/;

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

      // Session-title call — harmless canned title.
      if (systemText.startsWith("You title chat conversations")) {
        send([{ type: "text", text: "Out of scope request" }], "end_turn");
        return;
      }

      // Intent-router call → always "other" so the classifier fallback
      // path is reachable in scenario 2.
      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "other",
                kind: "unknown",
                entityHints: [],
                confidence: 0.9,
              }),
            },
          ],
          "end_turn",
        );
        return;
      }

      // Orchestrator loop — pick the scripted behaviour from the user's
      // prompt text.
      const allUserText = messages
        .map((m: any) =>
          Array.isArray(m?.content)
            ? m.content.map((c: any) => c?.text ?? "").join("\n")
            : String(m?.content ?? ""),
        )
        .join("\n");
      if (allUserText.includes("e-signature")) {
        // Scenario 1 — model reaches for an org-wide contract tool.
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_1`,
              name: "contract_send",
              input: { contractId: "c_nope" },
            },
          ],
          "tool_use",
        );
        return;
      }
      if (allUserText.includes("firm document library")) {
        // Scenario 2 — model gives up silently: no tools, no text.
        send([], "end_turn");
        return;
      }
      if (allUserText.includes("annual salary")) {
        // Scenario 3 — contractor asks for an HR-admin write.
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_3`,
              name: "person_update",
              input: { personId: "p_nope", dayRateAmount: 9999 },
            },
          ],
          "tool_use",
        );
        return;
      }
      send([{ type: "text", text: "Done." }], "end_turn");
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns, atelierAuditEvents } =
    D as any;
  const { eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const EMP = `u_${TAG}_emp`;
  const CTR = `u_${TAG}_ctr`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  type Frame = { event: string; data: any };
  const postTurn = async (
    userId: string,
    prompt: string,
    pageHref: string,
  ): Promise<{ status: number; frames: Frame[]; finalStatus: string | null }> => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${userId}` },
      body: JSON.stringify({
        prompt,
        sessionId: null,
        pageContext: { href: pageHref },
      }),
    });
    const raw = await res.text();
    const frames: Frame[] = [];
    let finalStatus: string | null = null;
    for (const block of raw.split(/\n\n+/)) {
      const evLine = block.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      let data: any = {};
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {}
      const event = evLine.slice(6).trim();
      frames.push({ event, data });
      if (event === "final") finalStatus = data?.status ?? null;
    }
    return { status: res.status, frames, finalStatus };
  };

  const assertHelpfulRefusal = (
    label: string,
    turn: { status: number; frames: Frame[]; finalStatus: string | null },
    expectedHref: string,
  ) => {
    check(`${label}: HTTP 200`, turn.status === 200, turn.status);
    const refusals = turn.frames.filter((f) => f.event === "refusal");
    check(`${label}: exactly one refusal frame`, refusals.length === 1, {
      refusals: refusals.length,
      events: turn.frames.map((f) => f.event),
    });
    const errors = turn.frames.filter((f) => f.event === "error");
    check(`${label}: no error frames (no dead end)`, errors.length === 0, errors);
    check(
      `${label}: turn not error status`,
      turn.finalStatus !== null && turn.finalStatus !== "error",
      turn.finalStatus,
    );
    const rf = refusals[0]?.data ?? {};
    const reason = String(rf.reason ?? "");
    const suggestion = String(rf.suggestion ?? "");
    check(`${label}: reason is non-empty prose`, reason.trim().length > 20, reason);
    check(
      `${label}: reason has no snake_case tool tokens`,
      !SNAKE_TOKEN.test(reason),
      reason,
    );
    check(
      `${label}: suggestion has no snake_case tool tokens`,
      !SNAKE_TOKEN.test(suggestion),
      suggestion,
    );
    for (const leaked of ["contract_send", "person_update", "unknown_tool", "not registered"]) {
      check(
        `${label}: no "${leaked}" anywhere in refusal`,
        !reason.includes(leaked) && !suggestion.includes(leaked),
        { reason, suggestion },
      );
    }
    check(
      `${label}: pageHref points back at the user's page`,
      rf.pageHref === expectedHref,
      rf.pageHref,
    );
    check(
      `${label}: request_feature CTA present`,
      rf.requestCapability?.tool === "request_feature",
      rf.requestCapability,
    );
  };

  try {
    await db
      .insert(atelierUsers)
      .values([
        {
          id: EMP,
          orgId: ORG,
          email: `${TAG}.emp@cognirise.ai`,
          name: "Probe Employee",
          initials: "PE",
          role: "employee",
          roleLabel: "Employee",
          title: "Analyst",
          permissions: [],
        },
        {
          id: CTR,
          orgId: ORG,
          email: `${TAG}.ctr@cognirise.ai`,
          name: "Probe Contractor",
          initials: "PC",
          role: "contractor",
          roleLabel: "Contractor",
          title: "Contractor",
          permissions: [],
        },
      ] as any)
      .onConflictDoNothing();

    // ================================================================
    // 1. Employee asks for e-sign → out-of-surface tool call refused.
    // ================================================================
    const t1 = await postTurn(
      EMP,
      "Please send the master services agreement for e-signature to the client",
      "/me/documents",
    );
    assertHelpfulRefusal("employee e-sign", t1, "/me/documents");

    // ================================================================
    // 2. Employee asks for firm document upload → model goes silent,
    //    classifier-"other" fallback refusal fires.
    // ================================================================
    const t2 = await postTurn(
      EMP,
      "Upload this proposal into the firm document library for everyone",
      "/me/overview",
    );
    assertHelpfulRefusal("employee firm-doc upload", t2, "/me/overview");

    // ================================================================
    // 3. Contractor asks for an HR-admin write → refused, same shape.
    // ================================================================
    const t3 = await postTurn(
      CTR,
      "Change my colleague's annual salary to 9999 please",
      "/me/pay",
    );
    assertHelpfulRefusal("contractor HR-admin", t3, "/me/pay");
  } finally {
    try {
      const ids = [EMP, CTR];
      await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.userId, ids));
      await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.userId, ids));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, ids));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, ids));
    } catch (e) {
      console.error("cleanup error", e);
    }
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => stub.close(() => r()));
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
