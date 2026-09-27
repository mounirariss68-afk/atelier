/**
 * Vertical Riser action probe.
 *
 * Executes a receipt-to-expense action through the real CLI HTTP endpoints
 * against the synchronous scratch DB harness. A synthetic PDF is parsed by
 * the production extractor and persisted as an owned attachment/document in
 * the scratch DB. Blob storage is deliberately not touched: the CLI action
 * consumes the persisted extracted document, and this keeps the probe from
 * writing to any shared object-storage bucket.
 *
 * Run from artifacts/api-server:
 *   pnpm exec tsx ./tests/riser-eval/vertical-cli-action.ts
 */
import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { RiserEvalObservation } from "./pure-observations.js";

const TAG = `vertical_${Date.now().toString(36)}`;
const ORG = `org_${TAG}`;
const OWNER = `p_${TAG}_owner`;
const EMPLOYEE = `p_${TAG}_employee`;
const FOREIGN = `p_${TAG}_foreign`;
const MERCHANT = `Vertical Probe Falcon Cloud ${TAG}`;
const FILE_NAME = `synthetic-invoice-${TAG}.pdf`;
const TURN_KEY = `vertical-receipt-${TAG}`;

let providerFailure = false;
let providerCalls = 0;
let actionToolCalls = 0;
let employeeToolList: string[] = [];

// Stub the Anthropic Messages API before importing the app. It handles the
// CLI intent classification and CLI tool selection. The synthetic PDF has
// deterministic receipt fields, so the probe does not assume a particular
// receipt-parser tier calls a model.
const anthropicStub = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    providerCalls++;
    if (providerFailure) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "api_error", message: "probe provider unavailable" } }));
      return;
    }
    let body: any = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400).end("{}");
      return;
    }
    const systemText = Array.isArray(body.system)
      ? body.system.map((part: any) => part?.text ?? "").join("\n")
      : String(body.system ?? "");
    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const toolResultCount = messages.reduce(
      (count, message) =>
        count +
        (Array.isArray(message?.content)
          ? message.content.filter((part: any) => part?.type === "tool_result").length
          : 0),
      0,
    );
    const allUserText = messages
      .filter((message) => message?.role === "user")
      .flatMap((message) =>
        Array.isArray(message.content)
          ? message.content.map((part: any) => part?.text ?? "")
          : [String(message.content ?? "")],
      )
      .join(" ");
    const toolNames: string[] = Array.isArray(body.tools)
      ? body.tools.map((tool: any) => String(tool?.name ?? ""))
      : [];
    if (allUserText.includes("vertical-absence")) employeeToolList = toolNames;

    const send = (content: unknown[], stopReason: string) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `msg_${TAG}`,
          type: "message",
          role: "assistant",
          model: body.model ?? "claude-haiku-4-5",
          content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 20 },
        }),
      );
    };

    if (/You are an intent router for a CRM\/PSA chat orchestrator/.test(systemText)) {
      send(
        [{ type: "text", text: JSON.stringify({ verb: "create", kind: "expense", entityHints: [], confidence: 0.99 }) }],
        "end_turn",
      );
      return;
    }
    if (allUserText.includes("vertical-absence")) {
      send(
        [{
          type: "text",
          text: toolNames.includes("ingest_receipts_to_expenses")
            ? "This role has an expense-staging capability."
            : "I cannot stage this expense: the available capabilities for this role do not include receipt-to-expense writes.",
        }],
        "end_turn",
      );
      return;
    }
    if (toolResultCount > 0) {
      const toolResults = messages.flatMap((message) =>
        Array.isArray(message?.content)
          ? message.content.filter((part: any) => part?.type === "tool_result")
          : [],
      );
      const successfulPreview = toolResults.some((result) => {
        if (result.is_error === true) return false;
        const content = Array.isArray(result.content)
          ? result.content.map((part: any) => part?.text ?? "").join("\n")
          : String(result.content ?? "");
        try {
          const parsed = JSON.parse(content);
          return parsed?.ok === true && parsed?.confirmation != null;
        } catch {
          return false;
        }
      });
      send(
        [{
          type: "text",
          text: successfulPreview
            ? "I prepared a receipt expense preview. It is not saved; confirm the pending action to create the draft."
            : "The tool did not return a successful preview, so I cannot say the expense was staged.",
        }],
        "end_turn",
      );
      return;
    }
    if (
      allUserText.includes("vertical-action") &&
      toolNames.includes("ingest_receipts_to_expenses")
    ) {
      actionToolCalls++;
      send(
        [{
          type: "tool_use",
          id: `tu_${TAG}_receipt`,
          name: "ingest_receipts_to_expenses",
          input: { attachmentIds: [attachmentId] },
        }],
        "tool_use",
      );
      return;
    }
    send([{ type: "text", text: "I cannot perform an action that is not available in this turn." }], "end_turn");
  });
});

await new Promise<void>((resolve) => anthropicStub.listen(0, "127.0.0.1", resolve));
const stubPort = (anthropicStub.address() as AddressInfo).port;
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;
process.env.ATELIER_AGENT_TIMEOUT_MS = "15000";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= `${TAG}-session-secret-32-bytes`;
process.env.ATELIER_CLI_RESOLVER_LLM = "off";

const D = await import("@workspace/db");
const {
  db,
  pool,
  atelierUsers,
  atelierCliAttachments,
  atelierExtractedDocuments,
  atelierCliSessions,
  atelierCliTurns,
  atelierCliJobs,
  atelierExpenses,
  atelierAuditEvents,
} = D as any;
const { and, eq, inArray } = await import("drizzle-orm");
const { extractAttachment } = await import("../../src/lib/atelier-cli/attachments/extractors.js");
const { chunkDocument } = await import("../../src/lib/atelier-cli/attachments/chunking.js");
await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
await import("../../src/lib/atelier-cli/attachment-capabilities.js");
const app = (await import("../../src/app.js")).default;

const personaRows = [
  {
    id: OWNER,
    orgId: ORG,
    email: `${OWNER}@test.invalid`,
    name: "Vertical Probe Partner",
    initials: "VP",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: ["*"],
  },
  {
    id: EMPLOYEE,
    orgId: ORG,
    email: `${EMPLOYEE}@test.invalid`,
    name: "Vertical Probe Employee",
    initials: "VE",
    role: "employee",
    roleLabel: "Employee",
    title: "Analyst",
    permissions: [],
  },
  {
    id: FOREIGN,
    orgId: `foreign_${TAG}`,
    email: `${FOREIGN}@test.invalid`,
    name: "Foreign Probe Partner",
    initials: "FP",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: ["*"],
  },
];

interface Frame {
  event: string;
  data: Record<string, any>;
}

function parseSse(raw: string): Frame[] {
  const frames: Frame[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) continue;
    let data: Record<string, any> = {};
    try {
      data = JSON.parse(dataLine.slice("data:".length).trim());
    } catch {}
    frames.push({ event: eventLine.slice("event:".length).trim(), data });
  }
  return frames;
}

const attachmentId = `att_${TAG}`;
const sessionIds = new Set<string>();
const turnIds = new Set<string>();
const expenseIds = new Set<string>();
let temporaryReportPath: string | null = null;
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

async function postTurn(args: {
  who: string;
  prompt: string;
  attachmentIds?: string[];
  clientTurnKey?: string;
  sessionId?: string;
}): Promise<{ status: number; frames: Frame[] }> {
  const response = await fetch(`${BASE}/cli/turn`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `atelier_persona=${args.who}`,
    },
    body: JSON.stringify({
      prompt: args.prompt,
      attachmentIds: args.attachmentIds,
      clientTurnKey: args.clientTurnKey,
      sessionId: args.sessionId,
    }),
  });
  const frames = parseSse(await response.text());
  for (const frame of frames) {
    if (typeof frame.data?.turnId === "string") turnIds.add(frame.data.turnId);
    if (typeof frame.data?.sessionId === "string" && frame.data.sessionId.length > 0) {
      sessionIds.add(frame.data.sessionId);
    }
  }
  return { status: response.status, frames };
}

async function postConfirm(
  turnId: string,
  who: string,
): Promise<{ status: number; frames: Frame[] }> {
  const response = await fetch(`${BASE}/cli/turn/${turnId}/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `atelier_persona=${who}`,
    },
    body: "{}",
  });
  return { status: response.status, frames: parseSse(await response.text()) };
}

function finalFrame(frames: Frame[]): Frame {
  const found = frames.find((frame) => frame.event === "final");
  assert.ok(found, `expected final frame, got ${frames.map((frame) => frame.event).join(",")}`);
  return found;
}

async function makeSyntheticPdf(): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  [
    `${MERCHANT} FZ-LLC`,
    "TAX INVOICE Invoice-VERTICAL-0001",
    `merchant: ${MERCHANT}`,
    "total: 1234.5",
    "currency: AED",
    "category: software",
    "tax: 58.79",
    "country: UAE",
    "date: 2026-07-02",
    "Invoice date: 02/07/2026    Due date: 16/07/2026",
    "Bill to: Cognirise Consulting DMCC, Dubai, UAE",
    "Description: annual software subscription",
    "Subtotal: 1,175.71",
    "VAT 5%: 58.79",
    "Total due: 1,234.50 AED",
    "Amount paid: 1,234.50 AED by card",
  ].forEach((line) => doc.fontSize(12).text(line));
  doc.end();
  return done;
}

try {
  await db.insert(atelierUsers).values(personaRows as any);

  // Parse actual generated PDF bytes with the same extractor as uploads.
  // Persist the attachment/document rows directly in the scratch DB so this
  // executable probe never uses shared or production object storage.
  const pdf = await makeSyntheticPdf();
  assert.ok(pdf.subarray(0, 5).toString("ascii").startsWith("%PDF-"), "fixture is a real PDF");
  const extracted = await extractAttachment({
    fileName: FILE_NAME,
    mime: "application/pdf",
    bytes: pdf,
  });
  assert.equal(extracted.kind, "pdf");
  assert.match(extracted.normalizedText, /Total due: 1,234\.50 AED/);
  const { chunks, digest } = await chunkDocument({
    attachmentId,
    text: extracted.normalizedText,
  });
  await db.insert(atelierCliAttachments).values({
    id: attachmentId,
    orgId: ORG,
    userId: OWNER,
    fileName: FILE_NAME,
    mime: "application/pdf",
    sizeBytes: pdf.byteLength,
    sha256: `synthetic-${TAG}`,
    encryptedRef: `enc:cli:${TAG}-scratch-only-no-blob`,
    status: "extracted",
    intentHint: "receipt",
  });
  await db.insert(atelierExtractedDocuments).values({
    id: `xdoc_${TAG}`,
    orgId: ORG,
    attachmentId,
    kind: extracted.kind,
    normalizedText: extracted.normalizedText,
    tableSummary: extracted.tableSummary,
    slideTexts: extracted.slideTexts,
    emailHeaders: extracted.emailHeaders,
    chunks,
    digest,
    warnings: extracted.warnings,
  });

  const draft = await postTurn({
    who: OWNER,
    prompt: `vertical-action: stage the attached synthetic invoice as a draft expense`,
    attachmentIds: [attachmentId],
    clientTurnKey: TURN_KEY,
  });
  assert.equal(draft.status, 200);
  const draftFinal = finalFrame(draft.frames);
  const turnId = String(draftFinal.data.turnId);
  turnIds.add(turnId);
  const sessionId = String(draftFinal.data.sessionId);
  if (sessionId && sessionId !== "undefined") sessionIds.add(sessionId);
  assert.equal(draftFinal.data.status, "awaiting_confirmation");
  assert.ok(draft.frames.some((frame) => frame.event === "needs_confirmation"));
  assert.ok(actionToolCalls >= 1, "stub model selected receipt staging capability");
  const previewText = draft.frames
    .map((frame) => String(frame.data?.text ?? frame.data?.summary ?? ""))
    .join("\n");
  assert.match(previewText, /Stage 1 draft expense.*unless you name the entity now/i);
  assert.doesNotMatch(previewText, /was staged|has been saved|expense was created/i);

  const [pendingTurn] = await db
    .select()
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.id, turnId))
    .limit(1);
  assert.ok(pendingTurn);
  assert.equal(pendingTurn.status, "awaiting_confirmation");
  assert.equal((pendingTurn.pendingWrite as any)?.tool, "ingest_receipts_to_expenses");

  // Unowned confirmation and forged IDs are rejected and cannot commit.
  const foreignAttempt = await postConfirm(turnId, FOREIGN);
  assert.equal(foreignAttempt.status, 200);
  assert.equal(finalFrame(foreignAttempt.frames).data.status, "error");
  assert.ok(foreignAttempt.frames.some((frame) => frame.event === "error"));
  const forgedAttempt = await postConfirm(`turn_forged_${TAG}`, OWNER);
  assert.equal(forgedAttempt.status, 200);
  assert.equal(finalFrame(forgedAttempt.frames).data.status, "error");

  // The owning persona confirms twice concurrently. The FIFO confirm path
  // must serialize the write and make the later request replay the result.
  const concurrent = await Promise.all([
    postConfirm(turnId, OWNER),
    postConfirm(turnId, OWNER),
  ]);
  assert.ok(concurrent.every((result) => result.status === 200));
  assert.ok(concurrent.every((result) => finalFrame(result.frames).data.status === "success"));
  const expenseRows = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, OWNER)));
  assert.equal(expenseRows.length, 1, "concurrent confirms persisted exactly one expense");
  assert.equal(expenseRows.length, 1, "exactly one source-of-truth expense was persisted");
  const createdExpense = expenseRows[0];
  assert.ok(createdExpense.merchant.startsWith(MERCHANT), "expense merchant comes from the parsed PDF");
  expenseIds.add(createdExpense.id);
  assert.equal(Number(createdExpense.amount), 1234.5);
  assert.equal(createdExpense.currency, "AED");
  assert.equal(createdExpense.receiptFileRef, `enc:cli:${attachmentId}`);

  const replayConfirm = await postConfirm(turnId, OWNER);
  assert.equal(finalFrame(replayConfirm.frames).data.replay, true);
  const replayTurn = await postTurn({
    who: OWNER,
    prompt: "vertical-action: stage the attached synthetic invoice as a draft expense",
    attachmentIds: [attachmentId],
    clientTurnKey: TURN_KEY,
    sessionId,
  });
  assert.equal(finalFrame(replayTurn.frames).data.status, "success");
  assert.equal(finalFrame(replayTurn.frames).data.turnId, turnId);

  const [savedDocument] = await db
    .select()
    .from(atelierExtractedDocuments)
    .where(eq(atelierExtractedDocuments.attachmentId, attachmentId));
  assert.ok(savedDocument, "source PDF extraction document is persisted");
  assert.match(savedDocument.normalizedText, /Total due: 1,234\.50 AED/);
  const turnAudit = await db
    .select()
    .from(atelierAuditEvents)
    .where(and(eq(atelierAuditEvents.entityId, turnId), eq(atelierAuditEvents.action, "cli.turn")));
  assert.equal(turnAudit.length, 1, "one source turn audit event");
  const confirmedAudit = await db
    .select()
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityId, turnId),
        eq(atelierAuditEvents.action, "cli.turn.confirmed"),
      ),
    );
  assert.ok(confirmedAudit.length >= 1, "confirm audit event persisted");
  const expenseAudit = await db
    .select()
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityId, createdExpense.id),
        eq(atelierAuditEvents.action, "expense.create"),
      ),
    );
  assert.equal(expenseAudit.length, 1, "one audit entry links the source receipt turn to expense");
  assert.equal((expenseAudit[0]!.payload as any)?.turnId, turnId, "expense audit references the source turn");
  const [savedTurn] = await db
    .select()
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.id, turnId));
  assert.equal(savedTurn.status, "success");
  assert.ok(Array.isArray(savedTurn.frames) && savedTurn.frames.some((frame: any) => frame.type === "final"));

  // The employee surface must not advertise this partner-only write. The
  // stub model responds honestly based on the actual tool list supplied.
  const beforeEmployee = providerCalls;
  const absence = await postTurn({
    who: EMPLOYEE,
    prompt: "vertical-absence: please stage the attached receipt as my expense",
    attachmentIds: [attachmentId],
  });
  assert.equal(absence.status, 200);
  assert.ok(providerCalls > beforeEmployee, "employee request reached stub model");
  assert.equal(employeeToolList.includes("ingest_receipts_to_expenses"), false);
  assert.ok(
    absence.frames.some(
      (frame) =>
        typeof frame.data?.text === "string" &&
        /cannot stage this expense.*capabilities.*do not include/i.test(frame.data.text),
    ),
    "model response acknowledges capability absence",
  );
  assert.equal(
    (await db
      .select()
      .from(atelierExpenses)
      .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, EMPLOYEE)))).length,
    0,
  );
  const foreignExpenseRows = await db
    .select()
    .from(atelierExpenses)
    .where(eq(atelierExpenses.orgId, `foreign_${TAG}`));
  assert.equal(foreignExpenseRows.length, 0, "foreign persona created no expense");

  // A cancelled confirmation is stale: it cannot be revived by /confirm.
  const staleDraft = await postTurn({
    who: OWNER,
    prompt: `vertical-action: stage the attached synthetic invoice as a draft expense`,
    attachmentIds: [attachmentId],
  });
  const staleTurnId = String(finalFrame(staleDraft.frames).data.turnId);
  turnIds.add(staleTurnId);
  const cancelResponse = await fetch(`${BASE}/cli/turn/${staleTurnId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `atelier_persona=${OWNER}` },
    body: "{}",
  });
  assert.equal(cancelResponse.status, 200);
  const staleConfirm = await postConfirm(staleTurnId, OWNER);
  assert.equal(finalFrame(staleConfirm.frames).data.status, "error");
  assert.equal(
    (await db
      .select()
      .from(atelierExpenses)
      .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, OWNER)))).length,
    1,
    "stale confirmation created no second expense",
  );

  // Provider failure is isolated to a separate turn and cannot accidentally
  // be mistaken for a committed action.
  providerFailure = true;
  const callsBeforeFailure = providerCalls;
  const failed = await postTurn({
    who: OWNER,
    prompt: `vertical-provider-failure-${TAG}: please stage a receipt`,
    attachmentIds: [attachmentId],
  });
  providerFailure = false;
  assert.ok(providerCalls > callsBeforeFailure, "failure path reached the stub provider");
  assert.ok(
    failed.frames.some((frame) => frame.event === "error") ||
      failed.frames.some((frame) => frame.event === "final" && frame.data.status === "error"),
    "provider failure is surfaced as an error frame/status",
  );
  assert.equal(
    (await db
      .select()
      .from(atelierExpenses)
      .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, OWNER)))).length,
    1,
    "provider failure made no additional expense record",
  );

  const verticalReportPath = process.env.RISER_EVAL_VERTICAL_REPORT;
  if (verticalReportPath) {
    const observations: RiserEvalObservation[] = [
      {
        id: "vertical.cli.confirmed-source-truth-replay",
        metric: "exactly_once_concurrent_replay",
        capabilityId: "wallet.ingest_receipts",
        severity: "one",
        passed: true,
        expected: {
          turnStatus: "success",
          expenseCount: 1,
          amount: 1234.5,
          currency: "AED",
          confirmReplay: true,
          turnIdStable: true,
        },
        actual: {
          turnStatus: savedTurn.status,
          expenseCount: expenseRows.length,
          amount: Number(createdExpense.amount),
          currency: createdExpense.currency,
          confirmReplay: finalFrame(replayConfirm.frames).data.replay === true,
          turnIdStable: finalFrame(replayTurn.frames).data.turnId === turnId,
          sourceDocumentPresent: Boolean(savedDocument),
          sourceTurnAuditCount: turnAudit.length,
          confirmedAuditCount: confirmedAudit.length,
          expenseAuditCount: expenseAudit.length,
        },
      },
      {
        id: "vertical.cli.acl-denial",
        metric: "policy_tenant_isolation",
        capabilityId: "wallet.ingest_receipts",
        severity: "one",
        passed: true,
        expected: { foreignConfirmStatus: "error", noForeignExpense: true },
        actual: {
          foreignConfirmStatus: finalFrame(foreignAttempt.frames).data.status,
          foreignConfirmError: foreignAttempt.frames.some((frame) => frame.event === "error"),
          foreignExpenseCount: foreignExpenseRows.length,
        },
      },
      {
        id: "vertical.cli.forged-stale-denial",
        metric: "forged_unconfirmed_commits",
        capabilityId: "wallet.ingest_receipts",
        severity: "one",
        passed: true,
        expected: { forgedStatus: "error", staleStatus: "error", ownerExpenseCount: 1 },
        actual: {
          forgedStatus: finalFrame(forgedAttempt.frames).data.status,
          staleStatus: finalFrame(staleConfirm.frames).data.status,
          ownerExpenseCount: (await db
            .select()
            .from(atelierExpenses)
            .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, OWNER)))).length,
        },
      },
      {
        id: "vertical.cli.role-capability-absence-honesty",
        metric: "unsupported_abstention",
        capabilityId: "wallet.ingest_receipts",
        severity: "one",
        passed: true,
        expected: { capabilityAdvertised: false, expenseCount: 0, honestAbstention: true },
        actual: {
          capabilityAdvertised: employeeToolList.includes("ingest_receipts_to_expenses"),
          expenseCount: (await db
            .select()
            .from(atelierExpenses)
            .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, EMPLOYEE)))).length,
          response: absence.frames
            .map((frame) => frame.data?.text ?? "")
            .filter((text) => typeof text === "string")
            .join(" "),
        },
      },
      {
        id: "vertical.cli.provider-failure-no-write",
        metric: "provider_unrelated_capability",
        capabilityId: "wallet.ingest_receipts",
        severity: "one",
        passed: true,
        expected: { errorSurfaced: true, ownerExpenseCount: 1 },
        actual: {
          errorSurfaced: failed.frames.some((frame) => frame.event === "error") ||
            failed.frames.some((frame) => frame.event === "final" && frame.data.status === "error"),
          ownerExpenseCount: (await db
            .select()
            .from(atelierExpenses)
            .where(and(eq(atelierExpenses.orgId, ORG), eq(atelierExpenses.personId, OWNER)))).length,
          providerRequests: providerCalls - callsBeforeFailure,
        },
      },
    ];
    const reportPath = resolve(verticalReportPath);
    mkdirSync(dirname(reportPath), { recursive: true });
    temporaryReportPath = `${reportPath}.${process.pid}.tmp`;
    writeFileSync(temporaryReportPath, `${JSON.stringify(observations, null, 2)}\n`);
    renameSync(temporaryReportPath, reportPath);
    temporaryReportPath = null;
  }

  console.log(
    "vertical CLI action probe passed: PDF extraction, expense preview/confirm, source-of-truth audit and replay",
  );
} finally {
  providerFailure = false;
  try {
    if (expenseIds.size > 0) {
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [...expenseIds]));
      await db.delete(atelierExpenses).where(inArray(atelierExpenses.id, [...expenseIds]));
    }
    if (turnIds.size > 0) {
      await db.delete(atelierCliJobs).where(inArray(atelierCliJobs.turnId, [...turnIds]));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [...turnIds]));
      await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.id, [...turnIds]));
    }
    if (sessionIds.size > 0) {
      await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.id, [...sessionIds]));
    }
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, attachmentId));
    await db.delete(atelierExtractedDocuments).where(eq(atelierExtractedDocuments.attachmentId, attachmentId));
    await db.delete(atelierCliAttachments).where(eq(atelierCliAttachments.id, attachmentId));
    await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, [OWNER, EMPLOYEE, FOREIGN]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [OWNER, EMPLOYEE, FOREIGN]));
  } finally {
    if (temporaryReportPath) rmSync(temporaryReportPath, { force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => anthropicStub.close(() => resolve()));
    await pool.end();
  }
}