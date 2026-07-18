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
// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";
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
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
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
  searchDocumentChunks,
  purgeChunkEmbeddings,
} from "../../src/lib/atelier-cli/attachments/retrieval.js";
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
Attendees: Eng. Faisal (client), Mounir (Cognirise), Lina (Cognirise)

10:05 AM - Mounir: walked through the operating model hypothesis.
10:14 AM - Faisal: Risk: legal sign-off may slip beyond July.
10:21 AM - Lina: Action: send revised RACI by Friday. Owner Mounir.
10:30 AM - Faisal: Decision: drop Wave 2 from scope.
10:42 AM - Lina: Blocker: vendor contract still pending procurement.`;

const BRAND_DECK_TEXT = `Cognirise — Brand Profile draft notes
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
To: mounir@cognirise.example, lina@cognirise.example
Subject: Workshop follow-up
Date: Wed, 14 May 2026 12:00:00 +0300

Thanks for today. Action: please send the RACI by Friday.
Risk: legal sign-off may slip.`;

async function cleanup(): Promise<void> {
  if (created.attachmentIds.size === 0) return;
  const ids = [...created.attachmentIds];
  for (const id of ids) await purgeChunkEmbeddings(id).catch(() => {});
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
  await test("storage: store + load round-trip with sha integrity", async () => {
    __resetAttachmentStorage();
    const buf = Buffer.from("hello atelier");
    const stored = await storeAttachmentBytes(buf);
    assert.ok(stored.encryptedRef.startsWith("enc:cli:"));
    assert.equal(stored.sizeBytes, buf.byteLength);
    assert.equal(stored.sha256.length, 64);
    const loaded = await loadAttachmentBytes(stored.encryptedRef);
    assert.ok(loaded);
    assert.equal(loaded!.toString("utf8"), "hello atelier");
  });

  // 2. Extractors --------------------------------------------------------
  await test("extractor: txt", async () => {
    const x = await extractAttachment({
      fileName: "notes.txt",
      mime: "text/plain",
      bytes: Buffer.from("hello"),
    });
    assert.equal(x.kind, "text");
    assert.equal(x.normalizedText, "hello");
  });

  await test("extractor: csv parses columns + sample rows", async () => {
    const x = await extractAttachment({
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

  await test("extractor: eml parses headers + body", async () => {
    const x = await extractAttachment({
      fileName: "thread.eml",
      mime: "message/rfc822",
      bytes: Buffer.from(EML_TEXT),
    });
    assert.equal(x.kind, "eml");
    assert.equal(x.emailHeaders?.from, "faisal@tasama.example");
    assert.deepEqual(x.emailHeaders?.to, [
      "mounir@cognirise.example",
      "lina@cognirise.example",
    ]);
    assert.equal(x.emailHeaders?.subject, "Workshop follow-up");
    assert.match(x.normalizedText, /RACI by Friday/);
  });

  await test("extractor: image with fixture key produces OCR text", async () => {
    const x = await extractAttachment({
      fileName: "riyadh_taxi_01.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    });
    assert.equal(x.kind, "image");
    assert.match(x.normalizedText, /merchant: Careem KSA/);
    assert.match(x.normalizedText, /currency: SAR/);
    assert.equal(x.warnings.length, 0);
  });

  await test("extractor: image without fixture surfaces a warning", async () => {
    const x = await extractAttachment({
      fileName: "mystery.png",
      mime: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    assert.equal(x.kind, "image");
    assert.ok(x.warnings.some((w) => w.startsWith("no-ocr-fixture:")));
  });

  await test("extractor: pptx best-effort yields slide-text blocks", async () => {
    // Minimal "binary" payload with a printable run that mimics slide text.
    const buf = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("\n\nSlide 1: We help GCC firms transform.\n\n"),
      Buffer.from([0x00, 0x00, 0x00]),
      Buffer.from("\n\nSlide 2: Differentiators include audit-first AI.\n\n"),
    ]);
    const x = await extractAttachment({
      fileName: "deck.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: buf,
    });
    assert.equal(x.kind, "pptx");
    assert.ok(x.slideTexts && x.slideTexts.length >= 1);
    assert.match(x.normalizedText, /GCC firms transform/);
  });

  // 3. Chunking ----------------------------------------------------------
  await test("chunking: short text → 1 chunk with stable id", async () => {
    const { chunks, digest } = await chunkDocument({
      attachmentId: "att_test_1",
      text: RFP_TEXT,
    });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkId, "att_test_1#c000");
    assert.match(digest.toc, /chunks: 1/);
    assert.ok(findChunkById(chunks, "att_test_1#c000"));
    assert.equal(findChunkById(chunks, "att_test_1#c999"), null);
  });

  await test("chunking: large text → multiple chunks with overlap + monotonic offsets", async () => {
    const big = RFP_TEXT + "\n\n" + RFP_TEXT.repeat(20);
    const { chunks } = await chunkDocument({ attachmentId: "att_test_2", text: big });
    assert.ok(chunks.length >= 2);
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i].charStart < chunks[i].charEnd);
      assert.ok(chunks[i].charStart <= chunks[i - 1].charEnd);
    }
    // Stable across re-runs.
    const again = await chunkDocument({ attachmentId: "att_test_2", text: big });
    assert.deepEqual(
      chunks.map((c) => c.chunkId),
      again.chunks.map((c) => c.chunkId),
    );
  });

  // 4. Intent detection --------------------------------------------------
  await test("intent: RFP text → rfp top intent", async () => {
    const x = await extractAttachment({
      fileName: "rfp.txt",
      mime: "text/plain",
      bytes: Buffer.from(RFP_TEXT),
    });
    assert.equal(detectIntent(x)[0].intent, "rfp");
  });
  await test("intent: transcript text → transcript top intent", async () => {
    const x = await extractAttachment({
      fileName: "tx.txt",
      mime: "text/plain",
      bytes: Buffer.from(TRANSCRIPT_TEXT),
    });
    assert.equal(detectIntent(x)[0].intent, "transcript");
  });
  await test("intent: brand notes → brand_deck top intent", async () => {
    const x = await extractAttachment({
      fileName: "brand.txt",
      mime: "text/plain",
      bytes: Buffer.from(BRAND_DECK_TEXT),
    });
    assert.equal(detectIntent(x)[0].intent, "brand_deck");
  });
  await test("intent: csv with merchant cols → spreadsheet + receipt_batch candidates", async () => {
    const x = await extractAttachment({
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

  await test("ingest: strips EXIF metadata from JPEG before storage", async () => {
    // Minimal hand-rolled JPEG with an APP1/EXIF segment containing
    // "GPS:lat=12.34" so we can grep for it before/after.
    const exifPayload = Buffer.concat([
      Buffer.from("Exif\x00\x00", "binary"),
      Buffer.from("GPS:lat=12.34;owner=alice@example.com"),
    ]);
    const segLen = exifPayload.length + 2;
    const app1 = Buffer.concat([
      Buffer.from([0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff]),
      exifPayload,
    ]);
    // Tiny but valid-enough JPEG: SOI, APP1(EXIF), SOS, scan(0x00), EOI.
    const sos = Buffer.from([
      0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x00, 0x3f, 0x00,
    ]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      app1,
      sos,
      Buffer.from([0x00, 0xff, 0xd9]),
    ]);
    assert.ok(jpeg.includes("GPS:lat=12.34"));

    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName: "vacation.jpg",
      mime: "image/jpeg",
      bytes: jpeg,
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    created.attachmentIds.add(r.attachmentId);
    // Stored bytes must no longer contain the EXIF marker.
    const loaded = await loadAttachment(r.attachmentId, me.orgId);
    assert.ok(loaded);
    const storedBytes = await loadAttachmentBytes(loaded!.attachment.encryptedRef);
    assert.ok(storedBytes);
    assert.equal(
      storedBytes!.includes("GPS:lat=12.34"),
      false,
      "EXIF GPS bytes leaked into storage",
    );
    // Audit warning must surface that we stripped metadata.
    assert.ok(
      r.warnings.some((w) => w.startsWith("metadata-stripped")),
      `expected metadata-stripped warning, got ${JSON.stringify(r.warnings)}`,
    );
  });

  // 6. Rubric ------------------------------------------------------------
  await test("rubric: weights sum to 100", () => {
    const sum = Object.values(RUBRIC_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
  });

  await test("rubric: strong RFP scores in pursue band", async () => {
    const { chunks } = await chunkDocument({ attachmentId: "att_rfp", text: RFP_TEXT });
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

  await test("rubric: deterministic across runs", async () => {
    const { chunks } = await chunkDocument({ attachmentId: "att_rfp_d", text: RFP_TEXT });
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
  // 8. Retrieval golden eval — semantic + hybrid search quality.
  //
  // Ingest a small corpus of topically-distinct documents, then assert
  // that each query retrieves the document that actually answers it as
  // the top hit. This guards the real embedding model + pgvector ANN +
  // trgm lexical fusion end-to-end: a regression in any layer (model
  // swap, dim mismatch, RRF weighting, ACL leak) drops recall@1 below
  // the bar and fails CI. Recall is measured over the golden set.
  // ---------------------------------------------------------------------
  const GOLDEN_CORPUS: Record<string, string> = {
    "pto-policy.txt":
      "Paid time off policy. Full-time employees accrue 20 vacation days per " +
      "year. Unused leave rolls over up to a maximum of 5 days. Requests must " +
      "be submitted two weeks in advance and approved by your line manager. " +
      "Sick leave is separate and does not count against the vacation balance.",
    "expense-policy.txt":
      "Travel and expense reimbursement guidelines. Submit receipts within 30 " +
      "days of travel. Meals are capped at 75 dollars per day. Economy airfare " +
      "and standard hotel rooms are reimbursable. Personal entertainment and " +
      "minibar charges are not eligible for reimbursement.",
    "security-policy.txt":
      "Information security standards. All laptops must use full-disk " +
      "encryption. Passwords require a minimum of 14 characters and multi-factor " +
      "authentication is mandatory for VPN access. Report any phishing email to " +
      "the security team immediately and never share credentials.",
  };

  const goldenIds: Record<string, string> = {};
  for (const [fileName, text] of Object.entries(GOLDEN_CORPUS)) {
    const r = await ingestAttachment({
      orgId: me.orgId,
      userId: me.id,
      userLabel: me.name,
      sessionId: null,
      turnId: null,
      fileName,
      mime: "text/plain",
      bytes: Buffer.from(text),
    });
    assert.ok(r.ok, `golden ingest failed for ${fileName}`);
    if (!r.ok) continue;
    created.attachmentIds.add(r.attachmentId);
    goldenIds[fileName] = r.attachmentId;
  }

  // query → the file that should rank #1
  const GOLDEN_QUERIES: Array<{ q: string; want: string }> = [
    { q: "how many vacation days do I get and can they roll over?", want: "pto-policy.txt" },
    { q: "what is the daily meal limit when I travel for work?", want: "expense-policy.txt" },
    { q: "do I need two-factor authentication to connect to the VPN?", want: "security-policy.txt" },
    { q: "is the hotel minibar covered when I expense a trip?", want: "expense-policy.txt" },
    { q: "what are the password length requirements?", want: "security-policy.txt" },
  ];

  await test("eval: golden retrieval recall@1 over the corpus", async () => {
    const goldenAttIds = new Set(Object.values(goldenIds));
    let hits = 0;
    for (const { q, want } of GOLDEN_QUERIES) {
      const results = await searchDocumentChunks({
        persona: { id: me.id, role: me.role, orgId: me.orgId },
        query: q,
        // narrow to the golden corpus so unrelated seed docs can't
        // displace the expected top hit — we're scoring ranking within
        // the known set, not the whole org.
        attachmentIds: [...goldenAttIds],
        limit: 5,
      });
      assert.ok(results.length > 0, `no results for query: ${q}`);
      const topFile = results[0]!.fileName;
      // every hit must carry a citation + stay inside the golden set (no ACL leak)
      for (const hit of results) {
        assert.ok(hit.citation.includes("#"), "missing citation on hit");
        assert.ok(goldenAttIds.has(hit.attachmentId), "ACL leak: hit outside golden corpus");
      }
      if (topFile === want) hits += 1;
    }
    const recall = hits / GOLDEN_QUERIES.length;
    assert.ok(
      recall >= 0.8,
      `golden recall@1 ${recall.toFixed(2)} below 0.80 (${hits}/${GOLDEN_QUERIES.length})`,
    );
  });

  await test("eval: empty query returns no results", async () => {
    const results = await searchDocumentChunks({
      persona: { id: me.id, role: me.role, orgId: me.orgId },
      query: "   ",
      limit: 5,
    });
    assert.equal(results.length, 0);
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
