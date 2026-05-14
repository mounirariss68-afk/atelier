/**
 * Task #334 — Atelier CLI attachments + qualification rubric tests.
 *
 * In-process suite (no HTTP) covering the deterministic pieces that
 * sit *behind* the orchestrator. The orchestrator end-to-end path is
 * already exercised by tests/cli-turn; here we focus on the new
 * extraction pipeline + rubric.
 *
 * Coverage:
 *   1. Storage round-trip + sha integrity
 *   2. Per-MIME extractors (txt, csv, eml, image-fixture, pptx-binary,
 *      generic-binary fallback)
 *   3. Chunking is stable + chunkIds resolve
 *   4. Intent detection routes RFP / transcript / receipt / deck / sheet
 *   5. ingestAttachment validates size + MIME and writes audit rows
 *   6. Rubric is deterministic, bands are correct, weights sum 100
 *   7. Catalog tools registered: fetch_document_chunk +
 *      qualify_opportunity_rubric + 5 ingest_* tools
 */
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  atelierCliAttachments,
  atelierExtractedDocuments,
  atelierAuditEvents,
  atelierUsers,
} from "@workspace/db";

// Side-effect imports — register the catalog entries.
import "../../src/lib/atelier-cli/capability-seed.js";
import "../../src/lib/atelier-cli/attachment-capabilities.js";

import {
  storeAttachmentBytes,
  loadAttachmentBytes,
  __resetAttachmentStorage,
} from "../../src/lib/atelier-cli/attachments/storage.js";
import { extractAttachment } from "../../src/lib/atelier-cli/attachments/extractors.js";
import { chunkDocument, findChunkById } from "../../src/lib/atelier-cli/attachments/chunking.js";
import { detectIntent } from "../../src/lib/atelier-cli/attachments/intent-detect.js";
import {
  ingestAttachment,
  loadAttachment,
  loadChunk,
} from "../../src/lib/atelier-cli/attachments/index.js";
import {
  scoreRubric,
  RUBRIC_WEIGHTS,
} from "../../src/lib/atelier-cli/qualification-rubric.js";
import { listCapabilities, findByToolName } from "../../src/lib/atelier-cli/capability-catalog.js";

const PERSONA_ID = process.env.ATELIER_TEST_PERSONA_ID ?? "p_mounir_ariss";

let pass = 0;
let fail = 0;
const created = { attachmentIds: new Set<string>() };

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
  }
}

async function loadPersona(): Promise<typeof atelierUsers.$inferSelect> {
  const [me] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PERSONA_ID));
  if (!me) throw new Error(`persona ${PERSONA_ID} not found — seed first`);
  return me;
}

const RFP_TEXT = `Tasama BPO — Request for Proposal
Submission deadline: 2026-06-30. Evaluation criteria below.

Scope of work
We require a target operating model redesign and capability build for our
shared services centre in Riyadh. Bilingual (Arabic + English) team needed.

Budget: SAR 1,800,000 not to exceed. Fixed-price preferred.
Steering committee includes the COO and CFO. Sponsor: Eng. Faisal.
Incumbent vendor: Roland Berger (re-bid). Shortlist of 3 firms expected.
Kick-off targeted for Q3 2026, 16 weeks delivery on-site in Riyadh KSA.`;

const TRANSCRIPT_TEXT = `Workshop transcript — 14 May 2026
Attendees: Eng. Faisal (client), Mounir (AICo), Lina (AICo)

10:05 AM - Mounir: walked through the operating model hypothesis.
10:14 AM - Faisal: Risk: legal sign-off may slip beyond July.
10:21 AM - Lina: Action: send revised RACI by Friday. Owner Mounir.
10:30 AM - Faisal: Decision: drop Wave 2 from scope.
10:42 AM - Lina: Blocker: vendor contract still pending procurement.`;

const BRAND_DECK_TEXT = `AICo — Brand Profile draft notes
Tagline: Ateliers, not factories.
Mission: build the consultancy of consultants for the GCC.
Voice attributes: principled, plain-spoken, bilingual.
Differentiators: deterministic agents, partner-led, audit-first.
Differentiators: priced by outcomes, not headcount.
Proof points: 24 ongoing engagements; 96% retention.`;

const CSV_TEXT = `merchant,date,amount,currency,vat,country
Careem KSA,2026-05-12,84.50,SAR,11.02,KSA
Four Seasons Riyadh,2026-05-12,2875.00,SAR,375.00,KSA
Najd Village,2026-05-13,690.00,SAR,90.00,KSA`;

const EML_TEXT = `From: faisal@tasama.example
To: mounir@aico.example, lina@aico.example
Subject: Workshop follow-up
Date: Wed, 14 May 2026 12:00:00 +0300

Thanks for today. Action: please send the RACI by Friday.
Risk: legal sign-off may slip.`;

async function cleanup(): Promise<void> {
  if (created.attachmentIds.size === 0) return;
  const ids = [...created.attachmentIds];
  await db.delete(atelierExtractedDocuments).where(inArray(atelierExtractedDocuments.attachmentId, ids));
  await db.delete(atelierCliAttachments).where(inArray(atelierCliAttachments.id, ids));
  await db
    .delete(atelierAuditEvents)
    .where(inArray(atelierAuditEvents.entityId, ids));
}

async function main(): Promise<void> {
  console.log("Task #334 — CLI attachments + rubric tests\n");
  const me = await loadPersona();

  // 1. Storage round-trip ------------------------------------------------
  await test("storage: store + load round-trip with sha integrity", () => {
    __resetAttachmentStorage();
    const buf = Buffer.from("hello atelier");
    const stored = storeAttachmentBytes(buf);
    assert.ok(stored.encryptedRef.startsWith("enc:cli:"));
    assert.equal(stored.sizeBytes, buf.byteLength);
    assert.equal(stored.sha256.length, 64);
    const loaded = loadAttachmentBytes(stored.encryptedRef);
    assert.ok(loaded);
    assert.equal(loaded!.toString("utf8"), "hello atelier");
  });

  // 2. Extractors --------------------------------------------------------
  await test("extractor: txt", () => {
    const x = extractAttachment({
      fileName: "notes.txt",
      mime: "text/plain",
      bytes: Buffer.from("hello"),
    });
    assert.equal(x.kind, "text");
    assert.equal(x.normalizedText, "hello");
  });

  await test("extractor: csv parses columns + sample rows", () => {
    const x = extractAttachment({
      fileName: "expenses.csv",
      mime: "text/csv",
      bytes: Buffer.from(CSV_TEXT),
    });
    assert.equal(x.kind, "csv");
    assert.deepEqual(x.tableSummary?.columns, [
      "merchant",
      "date",
      "amount",
      "currency",
      "vat",
      "country",
    ]);
    assert.equal(x.tableSummary?.rowCount, 3);
    assert.equal(x.tableSummary?.sample.length, 3);
    assert.equal(x.tableSummary?.sample[0].merchant, "Careem KSA");
  });

  await test("extractor: eml parses headers + body", () => {
    const x = extractAttachment({
      fileName: "thread.eml",
      mime: "message/rfc822",
      bytes: Buffer.from(EML_TEXT),
    });
    assert.equal(x.kind, "eml");
    assert.equal(x.emailHeaders?.from, "faisal@tasama.example");
    assert.deepEqual(x.emailHeaders?.to, [
      "mounir@aico.example",
      "lina@aico.example",
    ]);
    assert.equal(x.emailHeaders?.subject, "Workshop follow-up");
    assert.match(x.normalizedText, /RACI by Friday/);
  });

  await test("extractor: image with fixture key produces OCR text", () => {
    const x = extractAttachment({
      fileName: "riyadh_taxi_01.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    });
    assert.equal(x.kind, "image");
    assert.match(x.normalizedText, /merchant: Careem KSA/);
    assert.match(x.normalizedText, /currency: SAR/);
    assert.equal(x.warnings.length, 0);
  });

  await test("extractor: image without fixture surfaces a warning", () => {
    const x = extractAttachment({
      fileName: "mystery.png",
      mime: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    assert.equal(x.kind, "image");
    assert.ok(x.warnings.some((w) => w.startsWith("no-ocr-fixture:")));
  });

  await test("extractor: pptx best-effort yields slide-text blocks", () => {
    // Minimal "binary" payload with a printable run that mimics slide text.
    const buf = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("\n\nSlide 1: We help GCC firms transform.\n\n"),
      Buffer.from([0x00, 0x00, 0x00]),
      Buffer.from("\n\nSlide 2: Differentiators include audit-first AI.\n\n"),
    ]);
    const x = extractAttachment({
      fileName: "deck.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: buf,
    });
    assert.equal(x.kind, "pptx");
    assert.ok(x.slideTexts && x.slideTexts.length >= 1);
    assert.match(x.normalizedText, /GCC firms transform/);
  });

  // 3. Chunking ----------------------------------------------------------
  await test("chunking: short text → 1 chunk with stable id", () => {
    const { chunks, digest } = chunkDocument({
      attachmentId: "att_test_1",
      text: RFP_TEXT,
    });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkId, "att_test_1#c000");
    assert.match(digest.toc, /chunks: 1/);
    assert.ok(findChunkById(chunks, "att_test_1#c000"));
    assert.equal(findChunkById(chunks, "att_test_1#c999"), null);
  });

  await test("chunking: large text → multiple chunks with overlap + monotonic offsets", () => {
    const big = RFP_TEXT + "\n\n" + RFP_TEXT.repeat(20);
    const { chunks } = chunkDocument({ attachmentId: "att_test_2", text: big });
    assert.ok(chunks.length >= 2);
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i].charStart < chunks[i].charEnd);
      assert.ok(chunks[i].charStart <= chunks[i - 1].charEnd);
    }
    // Stable across re-runs.
    const again = chunkDocument({ attachmentId: "att_test_2", text: big });
    assert.deepEqual(
      chunks.map((c) => c.chunkId),
      again.chunks.map((c) => c.chunkId),
    );
  });

  // 4. Intent detection --------------------------------------------------
  await test("intent: RFP text → rfp top intent", () => {
    const x = extractAttachment({
      fileName: "rfp.txt",
      mime: "text/plain",
      bytes: Buffer.from(RFP_TEXT),
    });
    assert.equal(detectIntent(x)[0].intent, "rfp");
  });
  await test("intent: transcript text → transcript top intent", () => {
    const x = extractAttachment({
      fileName: "tx.txt",
      mime: "text/plain",
      bytes: Buffer.from(TRANSCRIPT_TEXT),
    });
    assert.equal(detectIntent(x)[0].intent, "transcript");
  });
  await test("intent: brand notes → brand_deck top intent", () => {
    const x = extractAttachment({
      fileName: "brand.txt",
      mime: "text/plain",
      bytes: Buffer.from(BRAND_DECK_TEXT),
    });
    assert.equal(detectIntent(x)[0].intent, "brand_deck");
  });
  await test("intent: csv with merchant cols → spreadsheet + receipt_batch candidates", () => {
    const x = extractAttachment({
      fileName: "exp.csv",
      mime: "text/csv",
      bytes: Buffer.from(CSV_TEXT),
    });
    const ints = detectIntent(x);
    assert.ok(ints.some((i) => i.intent === "spreadsheet"));
    assert.ok(ints.some((i) => i.intent === "receipt_batch"));
  });

  // 5. End-to-end ingest -------------------------------------------------
  await test("ingest: txt RFP → row + extracted doc + 2 audit rows", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "rfp.txt",
      mime: "text/plain",
      bytes: Buffer.from(RFP_TEXT),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    assert.equal(r.intent, "rfp");
    assert.ok(r.chunkCount >= 1);
    const loaded = await loadAttachment(r.attachmentId);
    assert.ok(loaded?.attachment);
    assert.equal(loaded!.attachment.status, "extracted");
    assert.equal(loaded!.attachment.intentHint, "rfp");
    assert.ok(loaded!.extracted);
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, r.attachmentId));
    const actions = audits.map((a) => a.action).sort();
    assert.deepEqual(actions, ["cli_attachment.extract", "cli_attachment.upload"]);
  });

  await test("ingest: rejects oversize uploads", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "big.bin",
      mime: "application/octet-stream",
      bytes: Buffer.alloc(26 * 1024 * 1024, 0),
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    assert.equal(r.reason, "over-size-cap");
    const [row] = await db
      .select()
      .from(atelierCliAttachments)
      .where(eq(atelierCliAttachments.id, r.attachmentId));
    assert.equal(row?.status, "rejected");
  });

  await test("ingest: rejects non-whitelisted MIME", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "bad.bin",
      mime: "application/x-msdownload",
      bytes: Buffer.from("MZ"),
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    assert.equal(r.reason, "mime-not-allowed");
  });

  await test("loadChunk: returns the right chunk by id", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "transcript.txt",
      mime: "text/plain",
      bytes: Buffer.from(TRANSCRIPT_TEXT),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    const firstChunkId = r.digest.chunkSummaries[0]?.chunkId;
    assert.ok(firstChunkId);
    const hit = await loadChunk({
      attachmentId: r.attachmentId,
      chunkId: firstChunkId!,
      orgId: me.orgId,
    });
    assert.ok(hit);
    assert.match(hit!.chunk.text, /Workshop transcript/);
    const miss = await loadChunk({
      attachmentId: r.attachmentId,
      chunkId: "bogus",
      orgId: me.orgId,
    });
    assert.equal(miss, null);
    // Cross-org guard: same chunkId, different org → null.
    const crossOrg = await loadChunk({
      attachmentId: r.attachmentId,
      chunkId: firstChunkId!,
      orgId: "org_other_does_not_exist",
    });
    assert.equal(crossOrg, null);
  });

  await test("ingest: identical bytes within same org dedupe to one row", async () => {
    const buf = Buffer.from(BRAND_DECK_TEXT);
    const a = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "brand.txt",
      mime: "text/plain",
      bytes: buf,
    });
    const b = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "brand-copy.txt",
      mime: "text/plain",
      bytes: buf,
    });
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    created.attachmentIds.add(a.attachmentId);
    created.attachmentIds.add(b.attachmentId);
    assert.equal(a.attachmentId, b.attachmentId, "expected dedup to reuse the first id");
  });

  await test("loadAttachment: cross-org access returns null", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "scoped.txt",
      mime: "text/plain",
      bytes: Buffer.from("scoped to my org only"),
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    const mine = await loadAttachment(r.attachmentId, me.orgId);
    assert.ok(mine);
    const other = await loadAttachment(r.attachmentId, "org_other_does_not_exist");
    assert.equal(other, null);
  });

  await test("ingest: rejects MIME-vs-extension mismatch", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "spoof.pdf",
      mime: "text/plain",
      bytes: Buffer.from("not actually a pdf"),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "mime-extension-mismatch");
      created.attachmentIds.add(r.attachmentId);
    }
  });

  await test("ingest: rejects macro / executable extensions", async () => {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "payload.docm",
      mime: "application/vnd.ms-word.document.macroEnabled.12",
      bytes: Buffer.from("PKmacro"),
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "executable-or-macro");
      created.attachmentIds.add(r.attachmentId);
    }
  });

  await test("ingest: .eml with nested base64 attachment recurses", async () => {
    const inner = "Inner attachment body — invoice line item.";
    const innerB64 = Buffer.from(inner).toString("base64");
    const eml = [
      'From: a@example.com',
      'To: b@example.com',
      'Subject: With attachment',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="bound1"',
      '',
      '--bound1',
      'Content-Type: text/plain',
      '',
      'See attached.',
      '--bound1',
      'Content-Type: text/plain; name="invoice.txt"',
      'Content-Disposition: attachment; filename="invoice.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      innerB64,
      '--bound1--',
      '',
    ].join("\r\n");
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "msg.eml",
      mime: "message/rfc822",
      bytes: Buffer.from(eml),
    });
    assert.ok(r.ok, "parent eml ingest should succeed");
    if (!r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    assert.ok(r.nestedAttachmentIds && r.nestedAttachmentIds.length === 1, "expected one nested part");
    const childId = r.nestedAttachmentIds![0];
    created.attachmentIds.add(childId);
    const child = await loadAttachment(childId, me.orgId);
    assert.ok(child, "child attachment must be queryable in same org");
    assert.match(child!.extracted!.normalizedText, /Inner attachment body/);
  });

  // 6. Rubric ------------------------------------------------------------
  await test("rubric: weights sum to 100", () => {
    const sum = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
  });

  await test("rubric: strong RFP scores in pursue band", () => {
    const { chunks } = chunkDocument({ attachmentId: "att_rfp", text: RFP_TEXT });
    const r = scoreRubric({
      attachmentIds: ["att_rfp"],
      chunks: chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })),
      offeringAnchors: ["operating model"],
      accountCountry: "KSA",
    });
    assert.equal(r.dimensions.length, 6);
    assert.ok(r.composite >= 70, `expected pursue, got ${r.composite}`);
    assert.equal(r.band, "pursue");
    // Each scored dimension cites at least one chunkId.
    // Non-inverted dimensions citing a positive score must point at chunks;
    // the inverted risk dimension defaults to 5 with no chunks when there
    // are no risk markers, so it is exempt from the citation requirement.
    for (const d of r.dimensions) {
      if (d.key === "riskInverted") continue;
      if (d.score > 0) assert.ok(d.chunkIds.length > 0, `${d.key} cited no chunks`);
    }
  });

  await test("rubric: empty text scores in decline band", () => {
    const r = scoreRubric({
      attachmentIds: ["empty"],
      chunks: [{ chunkId: "empty#c000", text: "irrelevant filler text" }],
    });
    // Risk-inverted defaults to a perfect 5 in the absence of risk
    // markers, contributing its full weight (15). Everything else is 0.
    // The score must still land safely in the decline band (<40).
    assert.equal(r.composite, RUBRIC_WEIGHTS.riskInverted);
    assert.equal(r.band, "decline");
  });

  await test("rubric: deterministic across runs", () => {
    const { chunks } = chunkDocument({ attachmentId: "att_rfp_d", text: RFP_TEXT });
    const a = scoreRubric({
      attachmentIds: ["att_rfp_d"],
      chunks: chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })),
      accountCountry: "KSA",
    });
    const b = scoreRubric({
      attachmentIds: ["att_rfp_d"],
      chunks: chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })),
      accountCountry: "KSA",
    });
    assert.equal(a.composite, b.composite);
    assert.deepEqual(
      a.dimensions.map((d) => [d.key, d.score, d.chunkIds]),
      b.dimensions.map((d) => [d.key, d.score, d.chunkIds]),
    );
  });

  // 7. Catalog registration ---------------------------------------------
  await test("catalog: new tools are registered", () => {
    const expected = [
      "fetch_document_chunk",
      "qualify_opportunity_rubric",
      "ingest_rfp_to_opportunity",
      "ingest_transcript_to_raid",
      "ingest_receipts_to_expenses",
      "ingest_deck_to_brand_profile",
      "ingest_spreadsheet_summary",
    ];
    for (const name of expected) {
      assert.ok(findByToolName(name), `missing capability: ${name}`);
    }
    const all = listCapabilities();
    assert.ok(all.length >= expected.length);
  });

  await test("catalog: fetch_document_chunk is read-only + safe for any persona", () => {
    const cap = findByToolName("fetch_document_chunk");
    assert.ok(cap);
    assert.equal(cap!.isWrite, false);
    assert.equal(cap!.irreversible, false);
    assert.equal(cap!.outboundChannel, null);
  });

  await test("catalog: ingest_rfp_to_opportunity is two-phase confirmable write", () => {
    const cap = findByToolName("ingest_rfp_to_opportunity");
    assert.ok(cap);
    assert.equal(cap!.isWrite, true);
    assert.equal(cap!.twoPhaseConfirm, true);
  });

  // ---------------------------------------------------------------------
  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("fatal:", err);
  await cleanup().catch(() => {});
  process.exit(1);
});
