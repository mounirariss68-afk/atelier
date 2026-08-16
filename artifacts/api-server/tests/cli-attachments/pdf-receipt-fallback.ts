/**
 * Task #1263 — real PDF invoices attached in chat must parse through the
 * shared receipt pipeline (not the fixture-header regex), and expenses
 * stored with `enc:cli:<attachmentId>` receipt refs must be repairable
 * via parseReceiptForExpense ("Parse receipt" button).
 *
 * Stub-Anthropic pattern: a local HTTP server answers both the
 * receipt-text extraction call and the Expense Auditor call with canned
 * JSON, so the probe is deterministic and offline.
 *
 * Run: pnpm --filter @workspace/api-server run test:pdf-receipt-fallback
 */
// DB isolation bootstrap — MUST be first import.
import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";

// ---- stub Anthropic (env BEFORE app imports) ---------------------------
const EXTRACTION = {
  merchant: "Falcon Cloud Systems",
  date: "2026-07-02",
  total: 1234.5,
  tax: 58.79,
  currency: "AED",
  country: "UAE",
  category: "software",
  rawText: "Falcon Cloud Systems Tax Invoice ... Total AED 1,234.50",
  confidence: "green",
};
const AUDITOR = {
  category: "software",
  vatTreatment: "uae_5",
  vatAmount: 58.79,
  clientBillable: false,
  markupPct: 0,
  summary: "Falcon Cloud Systems subscription invoice",
  ocrConfidence: "green",
};
let extractionCalls = 0;
let auditorCalls = 0;
// When true, every extraction call answers "unreadable" — models the
// genuinely-unparseable document regardless of which tier (text or
// vision-on-render) the pipeline escalates to in this environment.
let unreadableMode = false;
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (ch) => (body += ch));
  req.on("end", () => {
    let out: unknown;
    if (body.includes("Extract this receipt")) {
      extractionCalls++;
      out = unreadableMode ? { unreadable: true } : EXTRACTION;
    } else {
      auditorCalls++;
      out = AUDITOR;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "stub-key";
process.env.ATELIER_AGENT_TIMEOUT_MS = "15000";

// ---- app imports (after env) -------------------------------------------
const { db, atelierUsers, atelierExpenses, atelierCliAttachments, atelierExtractedDocuments } =
  await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { ingestAttachment, loadAttachment } = await import(
  "../../src/lib/atelier-cli/attachments/index.js"
);
await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
await import("../../src/lib/atelier-cli/attachment-capabilities.js");
const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
const { parseReceiptForExpense } = await import("../../src/lib/atelier-receipt-parse.js");

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// ---- fixture persona ------------------------------------------------------
const STAMP = Date.now().toString(36);
const ORG = "aico";
const UID = `p_test_pdfrcpt_${STAMP}`;
await db.insert(atelierUsers).values({
  id: UID,
  orgId: ORG,
  name: `Pdf Receipt Probe ${STAMP}`,
  initials: "PR",
  email: `pdfrcpt.${STAMP}@test.local`,
  role: "partner",
  roleLabel: "Partner",
  title: "Partner",
});
const [me] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, UID));

// ---- helper: build a text-layer PDF with pdfkit ---------------------------
async function makePdf(lines: string[]): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  for (const l of lines) doc.fontSize(12).text(l);
  doc.end();
  return done;
}

// Realistic invoice text: NO fixture-style `merchant:`/`total:` headers,
// but enough dates/amounts that the text-layer quality gate passes.
const INVOICE_LINES = [
  "Falcon Cloud Systems FZ-LLC",
  "TAX INVOICE Invoice-YBJGOJ-00079",
  "Invoice date: 02/07/2026    Due date: 16/07/2026",
  "Bill to: Cognirise Consulting DMCC, Dubai, UAE",
  "Description: Falcon Cloud annual subscription (Team plan)",
  "Subtotal: 1,175.71",
  "VAT 5%: 58.79",
  "Total due: 1,234.50 AED",
  "Amount paid: 1,234.50 on 02/07/2026 by card ending 4722",
  "Thank you for your business.",
];

const cap = findByToolName("ingest_receipts_to_expenses")!;
const ctx = { persona: { id: me.id, orgId: ORG, role: me.role, name: me.name }, turnId: `turn_${STAMP}` } as never;

// ---- 1. real PDF invoice → draft with real merchant/amount ---------------
const pdf = await makePdf(INVOICE_LINES);
const ing = await ingestAttachment({
  orgId: ORG,
  userId: me.id,
  userLabel: me.name,
  fileName: `Invoice-YBJGOJ-${STAMP}.pdf`,
  mime: "application/pdf",
  bytes: pdf,
});
check("ingest: pdf accepted", ing.ok === true, ing);
const aid = ing.attachmentId;

const preview = (await cap.run({ attachmentIds: [aid] }, ctx)) as {
  ok: boolean;
  data?: { preview?: Array<Record<string, unknown>> };
  confirmation?: { pending: { input: Record<string, unknown> } };
};
const d0 = preview.data?.preview?.[0] ?? {};
check("preview: ok", preview.ok === true, preview);
check("preview: merchant from shared parser", d0.merchant === "Falcon Cloud Systems", d0);
check("preview: amount", d0.amount === 1234.5, d0);
check("preview: currency", d0.currency === "AED", d0);
check("preview: date", d0.expenseDate === "2026-07-02", d0);
check("preview: not flagged unreadable", d0.needsReview === false, d0);
const callsAfterPreview = extractionCalls;
check("preview: shared extraction called once", callsAfterPreview === 1, extractionCalls);

// Headers were persisted → confirm pass must NOT re-call the model.
const confirm = (await cap.run(
  preview.confirmation!.pending.input,
  ctx,
)) as { ok: boolean; data?: { ids?: string[] } };
check("confirm: ok", confirm.ok === true, confirm);
check("confirm: no second extraction call", extractionCalls === callsAfterPreview, extractionCalls);
const expId = confirm.data?.ids?.[0];
check("confirm: expense created", typeof expId === "string", confirm);
const [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId!));
check("expense: merchant persisted", row?.merchant === "Falcon Cloud Systems", row?.merchant);
check("expense: amount persisted", Number(row?.amount) === 1234.5, row?.amount);
check("expense: enc:cli receipt ref", row?.receiptFileRef === `enc:cli:${aid}`, row?.receiptFileRef);

// ---- 2. Parse receipt (enc:cli ref) repairs the draft ---------------------
const reparse = await parseReceiptForExpense({ row: row!, me: me!, via: "probe" });
check("reparse: ok on enc:cli ref", reparse.ok === true, reparse);
if (reparse.ok) {
  check("reparse: merchant", reparse.expense.merchant === "Falcon Cloud Systems", reparse.expense.merchant);
  check("reparse: auditor ran", auditorCalls >= 1, auditorCalls);
}

// ---- 3. failure path degrades to manual entry -----------------------------
unreadableMode = true;
const badPdf = await makePdf([
  "GARBLE-DOC scrambled scan output 12/07/2026",
  "1,111.11 2,222.22 no coherent structure here at all",
  "GARBLE-DOC GARBLE-DOC padding padding padding padding padding",
]);
const ing2 = await ingestAttachment({
  orgId: ORG,
  userId: me.id,
  userLabel: me.name,
  fileName: `garbled-${STAMP}.pdf`,
  mime: "application/pdf",
  bytes: badPdf,
});
check("ingest: garbled pdf accepted", ing2.ok === true, ing2);
const preview2 = (await cap.run({ attachmentIds: [ing2.attachmentId] }, ctx)) as {
  ok: boolean;
  data?: { preview?: Array<Record<string, unknown>> };
};
const d1 = preview2.data?.preview?.[0] ?? {};
check("failure: draft flagged for review", d1.needsReview === true, d1);
check(
  "failure: manual-entry reason",
  String(d1.reviewReason ?? "").includes("manual entry"),
  d1.reviewReason,
);
check("failure: amount zero", d1.amount === 0, d1);

// ---- cleanup ---------------------------------------------------------------
for (const id of [aid, ing2.attachmentId]) {
  await db.delete(atelierExtractedDocuments).where(eq(atelierExtractedDocuments.attachmentId, id));
  await db.delete(atelierCliAttachments).where(eq(atelierCliAttachments.id, id));
}
if (expId) await db.delete(atelierExpenses).where(eq(atelierExpenses.id, expId));
await db.delete(atelierUsers).where(eq(atelierUsers.id, UID));
stub.close();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
