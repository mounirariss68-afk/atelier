/**
 * Task #1249 — chat must not misquote its own document-classification
 * results. A real conversation once narrated a receipt as "low
 * confidence (42%)" while the classify_finance_document result right
 * below said lowConfidence:false.
 *
 * Drives the REAL POST /cli/turn SSE endpoint (in-process, scratch DB)
 * with a stub Anthropic server that deliberately emits bogus
 * low-confidence closing prose after a CONFIDENT classification, and
 * pins:
 *
 *   1. The tool_result frame reports lowConfidence:false for the
 *      receipt (deterministic classifier, no model involved).
 *   2. The model receives a "[classification grounding]" text block
 *      alongside the tool_result spelling out lowConfidence=FALSE.
 *   3. The bogus "low confidence (42%)" / "what kind of document"
 *      closing prose is deterministically scrubbed — no streamed
 *      narration frame contradicts the classifier's verdict.
 *   4. Honest closing prose (no confidence claims) passes through
 *      untouched, so the scrub is targeted, not a blanket mute.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/classify-narration-probe.ts
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

const TAG = `probe1249_${Date.now()}`;
const ORG = "aico";

const BOGUS_CLOSING =
  "This receipt has low confidence (42%), so I'm not sure what kind of document this is. Could you tell me what kind of document this is? I've noted the upload.";
const HONEST_CLOSING = "That's a receipt from Gulf Cafe — ready to file as an expense.";

type Scenario = "bogus" | "honest";
let scenario: Scenario = "bogus";
let attachmentId = "";
// Captured from the stub: the text blocks accompanying the tool_result
// the orchestrator sends back to the model.
let groundingSeen: string[] = [];

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
        send([{ type: "text", text: "Classify narration probe" }], "end_turn");
        return;
      }
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

      // Orchestrator loop.
      const toolResultMsg = messages.find(
        (m: any) =>
          m?.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c?.type === "tool_result"),
      );
      if (!toolResultMsg) {
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_${scenario}`,
              name: "classify_finance_document",
              input: { attachmentIds: [attachmentId] },
            },
          ],
          "tool_use",
        );
        return;
      }
      // Record the grounding text blocks sent alongside the tool_result.
      for (const c of toolResultMsg.content) {
        if (c?.type === "text" && typeof c.text === "string") groundingSeen.push(c.text);
      }
      send(
        [{ type: "text", text: scenario === "bogus" ? BOGUS_CLOSING : HONEST_CLOSING }],
        "end_turn",
      );
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
  const { ingestAttachment } = await import("../../src/lib/atelier-cli/attachments/index.js");

  // ---- seed a receipt PDF the deterministic classifier is CONFIDENT about ----
  const { default: PDFDocument } = await import("pdfkit");
  const receiptPdf: Buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.text("Gulf Cafe LLC");
    doc.text(`RECEIPT ${TAG}`);
    doc.text("Card **** 4242");
    doc.text("Total: AED 45.00");
    doc.text("Thank you for your purchase");
    doc.end();
  });
  const ing = await ingestAttachment({
    orgId: ORG,
    userId: "p_mounir_ariss",
    userLabel: "Mounir Ariss",
    sessionId: `s_${TAG}`,
    turnId: `t_${TAG}`,
    fileName: `lunch-receipt-${TAG}.pdf`,
    mime: "application/pdf",
    bytes: receiptPdf,
  });
  if (!ing.ok) throw new Error(`attachment ingest failed: ${(ing as any).reason}`);
  attachmentId = ing.attachmentId;

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
      body: JSON.stringify({ prompt, attachmentIds: [attachmentId] }),
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
    // ---- Scenario 1: confident classification + bogus low-confidence prose ----
    scenario = "bogus";
    groundingSeen = [];
    const frames = await runTurn(`what kind of document is this? ${TAG}`);
    const toolResults = frames.filter((f) => f.event === "tool_result");
    const classifyResult = toolResults.find((f) => f.data?.tool === "classify_finance_document");
    const resultRow = classifyResult?.data?.data?.results?.[0];
    check(
      "classifier reports the receipt confidently (lowConfidence:false)",
      resultRow?.kind === "receipt" && resultRow?.lowConfidence === false,
      resultRow,
    );
    const grounding = groundingSeen.find((t) => t.includes("[classification grounding]"));
    check(
      "model received the structured grounding note with lowConfidence=FALSE",
      !!grounding && grounding.includes("lowConfidence=FALSE"),
      groundingSeen,
    );
    const narrations = frames
      .filter((f) => f.event === "narration")
      .map((n) => String(n.data?.text ?? ""));
    check(
      "no streamed narration claims low confidence or a fake percentage",
      narrations.every(
        (t) => !/low[\s-]confidence/i.test(t) && !/42\s*%/.test(t) && !/what kind of document/i.test(t),
      ),
      narrations,
    );
    check(
      "the honest tail of the bogus prose survives the scrub",
      narrations.some((t) => t.includes("I've noted the upload")),
      narrations,
    );
    check(
      "no clarification question frame for a confident classification",
      !frames.some((f) => f.event === "needs_clarification"),
      frames.map((f) => f.event),
    );

    // ---- Scenario 2: honest closing prose passes through untouched ----
    scenario = "honest";
    groundingSeen = [];
    const frames2 = await runTurn(`classify this document again ${TAG}`);
    const narrations2 = frames2
      .filter((f) => f.event === "narration")
      .map((n) => String(n.data?.text ?? ""));
    check(
      "honest closing prose is not muted by the scrub",
      narrations2.some((t) => t.includes("ready to file as an expense")),
      narrations2,
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
