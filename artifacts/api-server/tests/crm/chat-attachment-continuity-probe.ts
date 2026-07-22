/**
 * Task #590 — attachment continuity across a plain-text clarification.
 *
 * Mobile flow under test: the user attaches a bare photo (no OCR
 * fixture → ambiguous receipt/ID tie), the model asks "receipt or an
 * identity document?" in PLAIN TEXT (turn ends "complete"), and the
 * user's answer arrives as a NEW turn with no attachmentIds. Before
 * Task #590 the answer turn had no way to reference the upload — the
 * model could not call save_my_document / ingest_receipts_to_expenses
 * with a valid id.
 *
 * The fix is a server-side "[earlier attachments]" history primer in
 * runTurn(): when a turn arrives without attachments, recent turns of
 * the same session (30-min window, own uploads only) are re-surfaced
 * as hint-only id+filename lines.
 *
 * This probe boots the real app in-process on a scratch DB with a stub
 * Anthropic server (env set BEFORE app import) and pins:
 *   1. Upload via POST /cli/attachments (multipart, like the mobile
 *      composer) → attachmentId; bare image is ambiguous (no fixture).
 *   2. Turn 1 (with attachmentIds) → model answers with a plain-text
 *      clarifying question; turn completes with no tool call.
 *   3. Turn 2 "It's my passport" (NO attachmentIds) → the stub asserts
 *      the request history contains the "[earlier attachments]" primer
 *      naming the uploaded id, extracts the id FROM the primer, and
 *      calls save_my_document with it → needs_confirmation frame.
 *   4. Confirm endpoint → person_documents row lands; GET /me/documents
 *      lists it (the Me → Documents surface the mobile app renders).
 *   5. Receipt variant in a fresh session: answer turn "it's a receipt"
 *      → primer again; ingest_receipts_to_expenses draft+confirm →
 *      draft expense row for the caller.
 *   6. Cross-user safety: the primer never lists another user's
 *      attachment ids (scoped to the persona's own uploads).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-attachment-continuity-probe.ts
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

const TAG = `probe590_${Date.now()}`;
const CLARIFY_TEXT = "Is this a receipt or an identity document?";

// Captured by the stub for assertions.
const stubState = {
  primerSeenOnPassportTurn: false,
  primerIdOnPassportTurn: null as string | null,
  primerSeenOnReceiptTurn: false,
  primerIdOnReceiptTurn: null as string | null,
  primerLinesOnPassportTurn: [] as string[],
};

function flattenMessages(messages: any[]): string {
  return messages
    .map((m) =>
      Array.isArray(m?.content)
        ? m.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join("\n")
        : String(m?.content ?? ""),
    )
    .join("\n");
}

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
            usage: { input_tokens: 25, output_tokens: 25 },
          }),
        );
      };

      // Intent router → canned write intent.
      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "write",
                kind: "expense",
                entityHints: [],
                confidence: 0.9,
              }),
            },
          ],
          "end_turn",
        );
        return;
      }
      // Session auto-title sidecar.
      if (systemText.includes("title chat conversations")) {
        send([{ type: "text", text: "Attachment continuity probe" }], "end_turn");
        return;
      }

      const hasToolResult = messages.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((b: any) => b?.type === "tool_result"),
      );
      if (hasToolResult) {
        send([{ type: "text", text: "Done." }], "end_turn");
        return;
      }

      const lastUser = [...messages].reverse().find((m) => m?.role === "user");
      const promptText = Array.isArray(lastUser?.content)
        ? lastUser.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join(" ")
        : String(lastUser?.content ?? "");
      const allText = flattenMessages(messages);

      // Turn 1 — attachment block present, ambiguous → plain-text question.
      if (allText.includes("<attachment") && /just uploaded a photo/i.test(promptText)) {
        send([{ type: "text", text: CLARIFY_TEXT }], "end_turn");
        return;
      }

      // Answer turns — extract the id from the primer the server injected.
      const primerBlock = messages
        .map((m) =>
          Array.isArray(m?.content)
            ? m.content.map((b: any) => b?.text ?? "").join("\n")
            : String(m?.content ?? ""),
        )
        .find((t) => t.includes("[earlier attachments]"));
      const primerId = primerBlock
        ? (primerBlock.match(/attachment id ([A-Za-z0-9_-]+)/)?.[1] ?? null)
        : null;

      if (/passport/i.test(promptText)) {
        stubState.primerSeenOnPassportTurn = Boolean(primerBlock);
        stubState.primerIdOnPassportTurn = primerId;
        stubState.primerLinesOnPassportTurn = primerBlock
          ? primerBlock.split("\n").filter((l: string) => l.startsWith("- "))
          : [];
        if (!primerId) {
          send([{ type: "text", text: "I can't find the attachment." }], "end_turn");
          return;
        }
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_doc`,
              name: "save_my_document",
              input: { attachmentId: primerId, kind: "passport", title: "My Passport" },
            },
          ],
          "tool_use",
        );
        return;
      }
      if (/receipt/i.test(promptText)) {
        stubState.primerSeenOnReceiptTurn = Boolean(primerBlock);
        stubState.primerIdOnReceiptTurn = primerId;
        if (!primerId) {
          send([{ type: "text", text: "I can't find the attachment." }], "end_turn");
          return;
        }
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_rcpt`,
              name: "ingest_receipts_to_expenses",
              input: { attachmentIds: [primerId] },
            },
          ],
          "tool_use",
        );
        return;
      }
      send([{ type: "text", text: "OK." }], "end_turn");
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
    atelierUsers,
    atelierEmployees,
    atelierPersonDocuments,
    atelierExpenses,
    atelierCliSessions,
    atelierCliTurns,
    atelierCliAttachments,
    atelierExtractedDocuments,
    atelierAuditEvents,
  } = D as any;
  const { eq, inArray, and, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const FP = `u_${TAG}_fp`;
  const OTHER = `u_${TAG}_other`;
  const EMP = `emp_${TAG}_fp`;

  await db.insert(atelierUsers).values([
    {
      id: FP,
      orgId: ORG,
      email: `${TAG}_fp@cognirise.example`,
      name: `Probe FP ${TAG}`,
      initials: "PF",
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    },
    {
      id: OTHER,
      orgId: ORG,
      email: `${TAG}_other@cognirise.example`,
      name: `Probe Other ${TAG}`,
      initials: "PO",
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    },
  ]);
  await db.insert(atelierEmployees).values({
    id: EMP,
    orgId: ORG,
    userId: FP,
    fullName: `Probe FP ${TAG}`,
    email: `${TAG}_fp@cognirise.example`,
    role: "consultant",
    title: "Consultant",
    status: "active",
  });

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  interface Frame {
    event: string;
    data: any;
  }
  const parseSse = (raw: string): Frame[] => {
    const frames: Frame[] = [];
    for (const block of raw.split(/\n\n+/)) {
      const evLine = block.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      let data: any = {};
      try {
        data = JSON.parse(dataLine.slice("data:".length).trim());
      } catch {}
      frames.push({ event: evLine.slice("event:".length).trim(), data });
    }
    return frames;
  };
  const postTurn = async (
    who: string,
    bodyObj: Record<string, unknown>,
  ): Promise<{ status: number; raw: string; frames: Frame[] }> => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: JSON.stringify(bodyObj),
    });
    const raw = await res.text();
    return { status: res.status, raw, frames: parseSse(raw) };
  };
  const confirmTurn = async (who: string, turnId: string) => {
    const res = await fetch(`${BASE}/cli/turn/${turnId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: JSON.stringify({}),
    });
    const raw = await res.text();
    return { status: res.status, raw, frames: parseSse(raw) };
  };
  const upload = async (who: string, fileName: string, sessionId?: string) => {
    const fd = new FormData();
    fd.append(
      "files",
      new Blob([Buffer.from(`fake-image-bytes-${TAG}-${fileName}`)], { type: "image/jpeg" }),
      fileName,
    );
    if (sessionId) fd.append("sessionId", sessionId);
    const res = await fetch(`${BASE}/cli/attachments`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${who}` },
      body: fd,
    });
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  const cleanupIds = { sessions: new Set<string>(), attachments: new Set<string>() };

  try {
    // ---------- Scenario A: passport ----------
    const upA = await upload(FP, `${TAG}_scan_a.jpg`);
    check("A: upload returns attachmentId", upA.status === 200 && upA.json.attachmentIds?.length === 1, upA);
    const attA: string = upA.json.attachmentIds[0];
    cleanupIds.attachments.add(attA);

    const t1 = await postTurn(FP, {
      prompt: "I just uploaded a photo, please handle it",
      attachmentIds: [attA],
    });
    const t1Final = t1.frames.find((f) => f.event === "final");
    const t1Session = String(t1Final?.data?.sessionId ?? t1.frames.find((f) => f.data?.sessionId)?.data?.sessionId ?? "");
    if (t1Session) cleanupIds.sessions.add(t1Session);
    const t1Text = t1.raw;
    check("A: turn1 completes with plain-text clarify question", t1.status === 200 && t1Text.includes("receipt or an identity document"), t1.raw.slice(0, 800));
    check("A: turn1 resolved a session id", t1Session.length > 0, t1.raw.slice(0, 400));

    const t2 = await postTurn(FP, { prompt: "It's my passport — save it to my documents", sessionId: t1Session });
    check("A: primer present on answer turn", stubState.primerSeenOnPassportTurn, stubState);
    check("A: primer carries the uploaded attachment id", stubState.primerIdOnPassportTurn === attA, stubState);
    const conf = t2.frames.find((f) => f.event === "needs_confirmation");
    check("A: save_my_document → needs_confirmation", Boolean(conf), t2.raw.slice(0, 1200));
    const t2TurnId = String(
      conf?.data?.turnId ?? t2.frames.find((f) => f.data?.turnId)?.data?.turnId ?? "",
    );
    check("A: confirmation frame has turnId", t2TurnId.length > 0, conf?.data);

    const c2 = await confirmTurn(FP, t2TurnId);
    const c2Final = c2.frames.find((f) => f.event === "final");
    check("A: confirm commits (final frame, no error)", c2.status === 200 && Boolean(c2Final), c2.raw.slice(0, 1200));

    const docs = await db
      .select()
      .from(atelierPersonDocuments)
      .where(and(eq(atelierPersonDocuments.personId, EMP), eq(atelierPersonDocuments.kind, "passport")));
    check("A: person_documents passport row landed", docs.length === 1, docs);

    const meDocs = await fetch(`${BASE}/me/documents`, {
      headers: { cookie: `atelier_persona=${FP}` },
    });
    const meDocsJson: any = await meDocs.json().catch(() => ({}));
    const listed = (meDocsJson.documents ?? []).some(
      (d: any) => d.kind === "passport" && String(d.title ?? "").includes("My Passport"),
    );
    check("A: GET /me/documents lists the passport", meDocs.status === 200 && listed, meDocsJson);

    // ---------- Scenario B: receipt (fresh session) ----------
    const upB = await upload(FP, `${TAG}_scan_b.jpg`);
    const attB: string = upB.json.attachmentIds?.[0];
    check("B: upload ok", upB.status === 200 && Boolean(attB), upB);
    cleanupIds.attachments.add(attB);

    // Cross-user noise: another user's upload in parallel must NOT leak
    // into FP's primer.
    const upX = await upload(OTHER, `${TAG}_scan_x.jpg`);
    const attX: string = upX.json.attachmentIds?.[0];
    if (attX) cleanupIds.attachments.add(attX);

    const b1 = await postTurn(FP, {
      prompt: "I just uploaded a photo, please handle it",
      attachmentIds: [attB],
    });
    const b1Session = String(
      b1.frames.find((f) => f.data?.sessionId)?.data?.sessionId ?? "",
    );
    if (b1Session) cleanupIds.sessions.add(b1Session);
    check("B: turn1 clarify question", b1.raw.includes("receipt or an identity document"), b1.raw.slice(0, 600));
    check("B: fresh session for scenario B", b1Session.length > 0 && b1Session !== t1Session, { b1Session, t1Session });

    const b2 = await postTurn(FP, { prompt: "it's a receipt — log it to my wallet", sessionId: b1Session });
    check("B: primer present on receipt answer turn", stubState.primerSeenOnReceiptTurn, stubState);
    check("B: primer id is scenario-B attachment", stubState.primerIdOnReceiptTurn === attB, stubState);
    const bConf = b2.frames.find((f) => f.event === "needs_confirmation");
    check("B: ingest_receipts → needs_confirmation", Boolean(bConf), b2.raw.slice(0, 1200));
    const b2TurnId = String(
      bConf?.data?.turnId ?? b2.frames.find((f) => f.data?.turnId)?.data?.turnId ?? "",
    );
    const cB = await confirmTurn(FP, b2TurnId);
    check("B: confirm commits", cB.status === 200 && cB.frames.some((f) => f.event === "final"), cB.raw.slice(0, 1200));

    const exps = await db
      .select()
      .from(atelierExpenses)
      .where(eq(atelierExpenses.personId, FP));
    check("B: draft expense row landed for caller", exps.length >= 1, exps.map((e: any) => ({ id: e.id, status: e.status, merchant: e.merchant })));

    // Cross-user safety: primer lines never mention OTHER's attachment.
    const leaked =
      stubState.primerLinesOnPassportTurn.some((l) => attX && l.includes(attX)) ||
      (stubState.primerIdOnReceiptTurn === attX);
    check("X: primer never lists another user's attachment", !leaked, { attX, stubState });
  } finally {
    // ---------- cleanup (tag sweep per crm-harness memory) ----------
    try {
      const sess = [...cleanupIds.sessions];
      if (sess.length) {
        await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.sessionId, sess));
        await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.id, sess));
      }
      const atts = [...cleanupIds.attachments];
      if (atts.length) {
        await db
          .delete(atelierExtractedDocuments)
          .where(inArray(atelierExtractedDocuments.attachmentId, atts));
        await db.delete(atelierCliAttachments).where(inArray(atelierCliAttachments.id, atts));
      }
      await db.delete(atelierPersonDocuments).where(eq(atelierPersonDocuments.personId, EMP));
      await db.delete(atelierExpenses).where(inArray(atelierExpenses.personId, [FP, OTHER]));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, [FP, OTHER]));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP, OTHER]));
      // Tag sweep for anything hook-created.
      await db.delete(atelierCliAttachments).where(like(atelierCliAttachments.fileName, `${TAG}%`));
    } catch (err) {
      console.error("cleanup error", err);
    }
    server.close();
    stub.close();
    await pool?.end?.().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(1);
});
