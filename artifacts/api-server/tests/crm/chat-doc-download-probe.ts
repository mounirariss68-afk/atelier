/**
 * Task #599 — a document saved from chat must be openable from the
 * mobile Me → Documents tab.
 *
 * The chat flow (save_my_document) already lands the person_documents
 * row and the list entry (pinned by chat-attachment-continuity-probe).
 * This probe covers the RENDER/DOWNLOAD path the mobile app uses when
 * the user taps the entry:
 *
 *   me.tsx openDocument() → GET ${API_BASE}/api/atelier/me/documents/:id/download
 *   (getAtelierDownloadMyDocumentUrl, `?side=back` appended manually)
 *
 * Scenarios pinned against the real app on a scratch DB with a stub
 * Anthropic server:
 *   A. Passport JPG uploaded in chat → save_my_document → confirm.
 *      - /me/documents wire carries every field me.tsx consumes to
 *        render + gate the tap (hasFile, fileName, mime, title, kind,
 *        hasBackFile, daysToExpiry).
 *      - Download route streams the SAME bytes back with the image
 *        mime + attachment disposition (what expo FileSystem saves).
 *      - ?side=back → 404 (no back on a passport).
 *      - ACL: another user 404s, unauthenticated 401s.
 *   B. National ID as a single combined PDF → save_my_document →
 *      confirm. Wire shows sides="combined"; download streams a real
 *      %PDF- payload with application/pdf mime; ?side=back → 404.
 *   C. Drift pin: the generated mobile client helper
 *      (getAtelierDownloadMyDocumentUrl) still points at the exact
 *      route this probe exercised.
 *
 * Run: pnpm --filter @workspace/api-server test:chat-doc-download
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe599_${Date.now()}`;

async function makeTextPdf(text: string): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(14).text(text);
    doc.end();
  });
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

      if (systemText.startsWith("You are an intent router")) {
        send(
          [
            {
              type: "text",
              text: JSON.stringify({
                verb: "write",
                kind: "document",
                entityHints: [],
                confidence: 0.9,
              }),
            },
          ],
          "end_turn",
        );
        return;
      }
      if (systemText.includes("title chat conversations")) {
        send([{ type: "text", text: "Doc download probe" }], "end_turn");
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

      const allText = messages
        .map((m) =>
          Array.isArray(m?.content)
            ? m.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join("\n")
            : String(m?.content ?? ""),
        )
        .join("\n");
      // The turn carried attachmentIds → the server wraps them as
      // "(opaque attachment ref <id>)" blocks. Take the LAST ref so
      // scenario B does not re-use scenario A's attachment.
      const refs = [...allText.matchAll(/opaque attachment ref ([A-Za-z0-9_-]+)/g)].map(
        (m) => m[1],
      );
      const attachmentId = refs.length ? refs[refs.length - 1] : null;
      const lastUser = [...messages].reverse().find((m) => m?.role === "user");
      const promptText = Array.isArray(lastUser?.content)
        ? lastUser.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join(" ")
        : String(lastUser?.content ?? "");

      if (attachmentId && /passport/i.test(allText)) {
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_pp`,
              name: "save_my_document",
              input: { attachmentId, kind: "passport", title: `Chat Passport ${TAG}` },
            },
          ],
          "tool_use",
        );
        return;
      }
      if (attachmentId && /national/i.test(allText)) {
        send(
          [
            {
              type: "tool_use",
              id: `tu_${TAG}_nid`,
              name: "save_my_document",
              input: {
                attachmentId,
                kind: "national_id",
                title: `Chat National ID ${TAG}`,
              },
            },
          ],
          "tool_use",
        );
        return;
      }
      send([{ type: "text", text: `OK (${promptText.slice(0, 40)})` }], "end_turn");
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
    atelierCliSessions,
    atelierCliTurns,
    atelierCliAttachments,
    atelierExtractedDocuments,
    atelierAuditEvents,
  } = D as any;
  const { eq, inArray, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const FP = `u_${TAG}_fp`;
  const OTHER = `u_${TAG}_other`;
  const EMP = `emp_${TAG}_fp`;
  const EMP2 = `emp_${TAG}_other`;

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
  await db.insert(atelierEmployees).values([
    {
      id: EMP,
      orgId: ORG,
      userId: FP,
      fullName: `Probe FP ${TAG}`,
      email: `${TAG}_fp@cognirise.example`,
      role: "consultant",
      title: "Consultant",
      status: "active",
    },
    {
      id: EMP2,
      orgId: ORG,
      userId: OTHER,
      fullName: `Probe Other ${TAG}`,
      email: `${TAG}_other@cognirise.example`,
      role: "consultant",
      title: "Consultant",
      status: "active",
    },
  ]);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const HOST = `http://127.0.0.1:${port}`;
  const BASE = `${HOST}/api/atelier`;

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
  const postTurn = async (who: string, bodyObj: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: JSON.stringify(bodyObj),
    });
    const raw = await res.text();
    return { status: res.status, raw, frames: parseSse(raw) };
  };
  const confirmTurn = async (who: string, turnId: string, typedName?: string) => {
    const res = await fetch(`${BASE}/cli/turn/${turnId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: JSON.stringify(typedName ? { typedName } : {}),
    });
    const raw = await res.text();
    return { status: res.status, raw, frames: parseSse(raw) };
  };
  const upload = async (who: string, fileName: string, bytes: Buffer, mime: string) => {
    const fd = new FormData();
    fd.append("files", new Blob([bytes], { type: mime }), fileName);
    const res = await fetch(`${BASE}/cli/attachments`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${who}` },
      body: fd,
    });
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  /** Save-from-chat helper: turn (needs_confirmation) → confirm → final. */
  const saveViaChat = async (prompt: string, attachmentId: string) => {
    const t = await postTurn(FP, { prompt, attachmentIds: [attachmentId] });
    const sessionId = String(t.frames.find((f) => f.data?.sessionId)?.data?.sessionId ?? "");
    const conf = t.frames.find((f) => f.event === "needs_confirmation");
    const turnId = String(
      conf?.data?.turnId ?? t.frames.find((f) => f.data?.turnId)?.data?.turnId ?? "",
    );
    // Attachment-derived writes require the typed-name confirm (Task
    // #332) — the mobile confirm card surfaces typedNameExpected and
    // the user retypes it. Mirror that contract here.
    const typedName = String(
      conf?.data?.diff?.typedNameRequired ?? conf?.data?.typedNameExpected ?? "",
    );
    let confirmed: { status: number; raw: string; frames: Frame[] } | null = null;
    if (conf && turnId) confirmed = await confirmTurn(FP, turnId, typedName || undefined);
    return { turn: t, sessionId, conf, turnId, confirmed };
  };
  // Exactly the URL the mobile openDocument() builds:
  //   `${API_BASE}${getAtelierDownloadMyDocumentUrl(doc.id)}` (+ ?side=back)
  const mobileDownloadUrl = (docId: string, side?: "back") =>
    `${HOST}/api/atelier/me/documents/${docId}/download${side === "back" ? "?side=back" : ""}`;
  const download = async (who: string | null, docId: string, side?: "back") => {
    const res = await fetch(mobileDownloadUrl(docId, side), {
      headers: who ? { cookie: `atelier_persona=${who}` } : {},
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      buf,
      mime: res.headers.get("content-type") ?? "",
      disposition: res.headers.get("content-disposition") ?? "",
    };
  };

  const cleanup = { sessions: new Set<string>(), attachments: new Set<string>() };

  try {
    // ---------------- Scenario A: passport JPG ----------------
    const jpgBytes = Buffer.from(`fake-jpeg-passport-bytes-${TAG}-`.repeat(20));
    const upA = await upload(FP, `${TAG}_passport.jpg`, jpgBytes, "image/jpeg");
    check("A: chat upload accepted", upA.status === 200 && upA.json.attachmentIds?.length === 1, upA);
    const attA: string = upA.json.attachmentIds?.[0];
    if (attA) cleanup.attachments.add(attA);

    const A = await saveViaChat("Please save this scan as my passport", attA);
    if (A.sessionId) cleanup.sessions.add(A.sessionId);
    check("A: save_my_document asked for confirmation", Boolean(A.conf), A.turn.raw.slice(0, 1200));
    check(
      "A: confirm committed (final frame)",
      A.confirmed?.status === 200 && A.confirmed.frames.some((f) => f.event === "final"),
      A.confirmed?.raw.slice(0, 1200),
    );

    if (process.env.PROBE_DEBUG) {
      console.log("DEBUG confirm raw:", A.confirmed?.raw?.slice(0, 2000));
      const allDocs = await db.select().from(atelierPersonDocuments);
      console.log(
        "DEBUG person_documents:",
        allDocs.map((d: any) => ({ id: d.id, personType: d.personType, personId: d.personId, kind: d.kind, title: d.title })),
      );
    }
    const listRes = await fetch(`${BASE}/me/documents`, {
      headers: { cookie: `atelier_persona=${FP}` },
    });
    const listJson: any = await listRes.json().catch(() => ({}));
    const passportDoc = (listJson.documents ?? []).find(
      (d: any) => d.kind === "passport" && String(d.title ?? "").includes(TAG),
    );
    check("A: /me/documents lists the chat-saved passport", listRes.status === 200 && Boolean(passportDoc), listJson);

    // Fields me.tsx consumes to render the card and gate the tap.
    check(
      "A: wire has the render/tap fields the mobile Me tab needs",
      passportDoc &&
        passportDoc.hasFile === true &&
        typeof passportDoc.id === "string" &&
        typeof passportDoc.title === "string" &&
        passportDoc.mime === "image/jpeg" &&
        typeof passportDoc.fileName === "string" &&
        passportDoc.hasBackFile === false &&
        "daysToExpiry" in passportDoc,
      passportDoc,
    );

    const dlA = await download(FP, passportDoc?.id ?? "missing");
    check("A: download route streams 200", dlA.status === 200, dlA);
    check("A: image mime preserved", dlA.mime.startsWith("image/jpeg"), dlA.mime);
    check(
      "A: attachment disposition set (mobile share/save path)",
      dlA.disposition.includes("attachment"),
      dlA.disposition,
    );
    check(
      "A: downloaded bytes are the uploaded scan",
      dlA.buf.length > 0 &&
        dlA.buf.length === (passportDoc?.sizeBytes ?? -1) &&
        dlA.buf.toString("latin1").includes(TAG),
      { len: dlA.buf.length, sizeBytes: passportDoc?.sizeBytes },
    );

    const dlABack = await download(FP, passportDoc?.id ?? "missing", "back");
    check("A: ?side=back 404s on a passport", dlABack.status === 404, dlABack.status);

    const dlOther = await download(OTHER, passportDoc?.id ?? "missing");
    check("A: another user's download 404s (self-scope ACL)", dlOther.status === 404, dlOther.status);
    const dlAnon = await download(null, passportDoc?.id ?? "missing");
    check("A: unauthenticated download 401s", dlAnon.status === 401, dlAnon.status);

    // ---------------- Scenario B: national ID, combined PDF ----------------
    const pdfBytes = await makeTextPdf(
      `NATIONAL IDENTITY CARD ${TAG}\nFront and back combined in one document.\nNumber 784-${TAG}`,
    );
    check("B: probe built a real PDF", pdfBytes.subarray(0, 5).toString("latin1") === "%PDF-", pdfBytes.subarray(0, 8));
    const upB = await upload(FP, `${TAG}_national_id.pdf`, pdfBytes, "application/pdf");
    check("B: PDF upload accepted (not rejected as unreadable)", upB.status === 200 && upB.json.attachmentIds?.length === 1, upB);
    const attB: string = upB.json.attachmentIds?.[0];
    if (attB) cleanup.attachments.add(attB);

    const B = await saveViaChat("Save this combined PDF as my national id card", attB);
    if (B.sessionId) cleanup.sessions.add(B.sessionId);
    check("B: save_my_document asked for confirmation", Boolean(B.conf), B.turn.raw.slice(0, 1200));
    check(
      "B: confirm committed (final frame)",
      B.confirmed?.status === 200 && B.confirmed.frames.some((f) => f.event === "final"),
      B.confirmed?.raw.slice(0, 1200),
    );

    const listRes2 = await fetch(`${BASE}/me/documents`, {
      headers: { cookie: `atelier_persona=${FP}` },
    });
    const listJson2: any = await listRes2.json().catch(() => ({}));
    const nidDoc = (listJson2.documents ?? []).find(
      (d: any) => d.kind === "national_id" && String(d.title ?? "").includes(TAG),
    );
    check("B: /me/documents lists the national ID", Boolean(nidDoc), listJson2);
    check(
      "B: combined-PDF wire shape (sides=combined, no back file)",
      nidDoc &&
        nidDoc.sides === "combined" &&
        nidDoc.hasFile === true &&
        nidDoc.hasBackFile === false &&
        nidDoc.mime === "application/pdf",
      nidDoc,
    );

    const dlB = await download(FP, nidDoc?.id ?? "missing");
    check("B: download streams 200 with pdf mime", dlB.status === 200 && dlB.mime.startsWith("application/pdf"), {
      status: dlB.status,
      mime: dlB.mime,
    });
    check(
      "B: payload is a real PDF with the uploaded content",
      dlB.buf.subarray(0, 5).toString("latin1") === "%PDF-" && dlB.buf.length === (nidDoc?.sizeBytes ?? -1),
      { head: dlB.buf.subarray(0, 8).toString("latin1"), len: dlB.buf.length, sizeBytes: nidDoc?.sizeBytes },
    );
    const dlBBack = await download(FP, nidDoc?.id ?? "missing", "back");
    check("B: ?side=back 404s on a combined PDF", dlBBack.status === 404, dlBBack.status);

    // ---------------- Scenario C: mobile client helper drift pin ----------------
    const generated = readFileSync(
      fileURLToPath(
        new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url),
      ),
      "utf8",
    );
    check(
      "C: getAtelierDownloadMyDocumentUrl still targets the exercised route",
      generated.includes("getAtelierDownloadMyDocumentUrl") &&
        generated.includes("/api/atelier/me/documents/${id}/download"),
      "helper or route template missing from generated client",
    );
  } finally {
    try {
      const sess = [...cleanup.sessions];
      if (sess.length) {
        await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.sessionId, sess));
        await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.id, sess));
      }
      const atts = [...cleanup.attachments];
      if (atts.length) {
        await db
          .delete(atelierExtractedDocuments)
          .where(inArray(atelierExtractedDocuments.attachmentId, atts));
        await db.delete(atelierCliAttachments).where(inArray(atelierCliAttachments.id, atts));
      }
      await db
        .delete(atelierPersonDocuments)
        .where(inArray(atelierPersonDocuments.personId, [EMP, EMP2]));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, [FP, OTHER]));
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [EMP, EMP2]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP, OTHER]));
      // Tag sweep for anything hook-created (crm-harness memory).
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
