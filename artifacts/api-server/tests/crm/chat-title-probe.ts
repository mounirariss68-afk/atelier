/**
 * Task #416 — auto-generated chat session titles probe.
 *
 * Drives the REAL POST /cli/turn SSE endpoint (booted in-process on an
 * isolated scratch DB) with a stub Anthropic server and pins the title
 * lifecycle:
 *
 *   1. First completed turn in a new session → the fire-and-forget
 *      Haiku title call runs and the session row gets a sanitized,
 *      length-capped title.
 *   2. A later turn in the SAME session does NOT overwrite the title
 *      (generation is skipped once title is set; the UPDATE is also
 *      guarded on `title IS NULL`).
 *   3. When the title call fails (stub returns 500), the turn itself
 *      still succeeds and the session simply stays untitled.
 *   4. GET /cli/sessions returns the title for the history lists.
 *
 * Plus pure unit checks on sanitizeSessionTitle.
 *
 * Deterministic: local stub Anthropic server (env set BEFORE app import)
 * answers the intent-router call, the orchestrator loop, and the title
 * call ("You title chat conversations…" system prompt) with canned
 * responses; a mutable `titleMode` flips the title call between ok/fail.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-title-probe.ts
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

const TAG = `probe416_${Date.now()}`;
const CANNED_TITLE_RAW = `"Log timesheet for Acme."`;
const CANNED_TITLE_CLEAN = "Log timesheet for Acme";

async function main() {
  // ---- stub Anthropic server (must exist before the app import) ----
  let titleMode: "ok" | "fail" = "ok";
  let titleCalls = 0;
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
      const send = (content: unknown[], stop: string, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          status === 200
            ? JSON.stringify({
                id: `msg_${TAG}`,
                type: "message",
                role: "assistant",
                model: parsed.model ?? "claude-haiku-4-5",
                content,
                stop_reason: stop,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 10 },
              })
            : JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }),
        );
      };

      // Title-generation call — identified by its dedicated system prompt.
      if (systemText.startsWith("You title chat conversations")) {
        titleCalls++;
        if (titleMode === "fail") {
          send([], "end_turn", 500);
          return;
        }
        send([{ type: "text", text: CANNED_TITLE_RAW }], "end_turn");
        return;
      }

      // Intent-router call → canned read intent.
      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({ verb: "read", kind: "other", entityHints: [], confidence: 0.9 }),
            },
          ],
          "end_turn",
        );
        return;
      }

      // Orchestrator loop → plain text answer, no tools. Keeps the turn
      // terminal on the first model step.
      void messages;
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
  const { sanitizeSessionTitle } = await import("../../src/lib/atelier-cli/index.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  // ---- pure sanitizer checks ----
  check(
    "sanitize: strips quotes + trailing punctuation",
    sanitizeSessionTitle(`"Log timesheet for Acme."`) === "Log timesheet for Acme",
    sanitizeSessionTitle(`"Log timesheet for Acme."`),
  );
  check(
    "sanitize: first line only",
    sanitizeSessionTitle("Update contact\nand more text") === "Update contact",
  );
  check("sanitize: empty → null", sanitizeSessionTitle("  \"\"  ") === null);
  const long = "x".repeat(120);
  check(
    "sanitize: caps length at 60",
    (sanitizeSessionTitle(long) ?? "").length === 60,
    (sanitizeSessionTitle(long) ?? "").length,
  );

  const ORG = "aico";
  const FP = `u_${TAG}_fp`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const postTurn = async (
    prompt: string,
    sessionId?: string | null,
  ): Promise<{ status: number; raw: string; sessionId: string | null; finalStatus: string | null }> => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${FP}` },
      body: JSON.stringify({ prompt, sessionId: sessionId ?? null }),
    });
    const raw = await res.text();
    let sid: string | null = null;
    let finalStatus: string | null = null;
    for (const block of raw.split(/\n\n+/)) {
      const evLine = block.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      let data: any = {};
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {}
      if (data?.sessionId) sid = data.sessionId;
      if (evLine.slice(6).trim() === "final") finalStatus = data?.status ?? null;
    }
    return { status: res.status, raw, sessionId: sid, finalStatus };
  };

  const getTitle = async (sid: string): Promise<string | null> => {
    const [row] = await db
      .select({ title: atelierCliSessions.title })
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, sid))
      .limit(1);
    return row?.title ?? null;
  };

  // Poll until the fire-and-forget title job lands (or times out).
  const waitForTitle = async (sid: string, timeoutMs = 8000): Promise<string | null> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const t = await getTitle(sid);
      if (t !== null) return t;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  };

  try {
    await db
      .insert(atelierUsers)
      .values({
        id: FP,
        orgId: ORG,
        email: `${TAG}.fp@cognirise.ai`,
        name: "Probe FP",
        initials: "PF",
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
        permissions: ["*"],
      } as any)
      .onConflictDoNothing();

    // =================================================================
    // 1. First completed turn sets a sanitized title.
    // =================================================================
    const t1 = await postTurn("Log my timesheet for Acme this week");
    check("turn 1: HTTP 200", t1.status === 200, t1.status);
    check("turn 1: got sessionId", !!t1.sessionId, t1.raw.slice(0, 300));
    const sid1 = t1.sessionId!;
    const title1 = await waitForTitle(sid1);
    check("turn 1: session titled", title1 === CANNED_TITLE_CLEAN, title1);
    check("turn 1: title call made", titleCalls >= 1, titleCalls);

    // =================================================================
    // 2. Second turn in the same session does not overwrite the title.
    // =================================================================
    const callsBefore = titleCalls;
    const t2 = await postTurn("And what about last week?", sid1);
    check("turn 2: HTTP 200", t2.status === 200, t2.status);
    // Give any (wrong) fire-and-forget a chance to run, then re-check.
    await new Promise((r) => setTimeout(r, 800));
    check("turn 2: title unchanged", (await getTitle(sid1)) === CANNED_TITLE_CLEAN);
    check("turn 2: no second title call", titleCalls === callsBefore, {
      before: callsBefore,
      after: titleCalls,
    });

    // =================================================================
    // 3. Title-generation failure never fails the turn.
    // =================================================================
    titleMode = "fail";
    const t3 = await postTurn("Show me open opportunities");
    check("turn 3 (title fails): HTTP 200", t3.status === 200, t3.status);
    check(
      "turn 3 (title fails): turn completed",
      t3.finalStatus !== null && t3.finalStatus !== "error",
      t3.finalStatus,
    );
    check("turn 3: new session", !!t3.sessionId && t3.sessionId !== sid1, t3.sessionId);
    await new Promise((r) => setTimeout(r, 1200));
    check("turn 3: session stays untitled", (await getTitle(t3.sessionId!)) === null);

    // =================================================================
    // 4. Sessions list endpoint returns the title.
    // =================================================================
    const listRes = await fetch(`${BASE}/cli/sessions`, {
      headers: { cookie: `atelier_persona=${FP}` },
    });
    const listJson: any = await listRes.json();
    const row1 = (listJson?.sessions ?? []).find((s: any) => s.id === sid1);
    check("sessions list: titled row", row1?.title === CANNED_TITLE_CLEAN, row1);
    const row3 = (listJson?.sessions ?? []).find((s: any) => s.id === t3.sessionId);
    check("sessions list: untitled row is null", row3 ? row3.title === null : false, row3);
  } finally {
    try {
      await db.delete(atelierCliTurns).where(eq(atelierCliTurns.userId, FP));
      await db.delete(atelierCliSessions).where(eq(atelierCliSessions.userId, FP));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, [FP]));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, FP));
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
