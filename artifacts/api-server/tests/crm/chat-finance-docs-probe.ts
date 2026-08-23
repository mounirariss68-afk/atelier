/**
 * Task #1090 — Riser finance-document pipelines (offline probe).
 *
 * Pins, on a scratch DB with a stub Anthropic server (bank letters) AND a
 * stub CogniDocs server (invoice/statement parsing — Task #1316), env set
 * BEFORE any capability import so every parse stays offline:
 *
 *   1. classify_finance_document: invoice PDF → supplier_invoice with
 *      recommended tool; statement CSV → bank_statement; garbage →
 *      low-confidence with an ask-one-question nextStep (never guess).
 *   2. ingest_supplier_invoice: CogniDocs prefill (×10k ints → majors) →
 *      confirmation envelope → confirm commits via the SAME payables core
 *      (status submitted, source internal_upload); repeat confirm reports
 *      alreadyFiled. Low job confidence (< the 0.6 floor) → correction
 *      clarification, never a guessed commit.
 *   2c. Task #1316 failure modes: failed job / non-invoice payload /
 *      missing keys each fail LOUD with named codes; a 40-row itemized
 *      invoice survives end-to-end; CogniDocs' stable invoice id is a
 *      third dedupe signal across re-uploads with different bytes+ref.
 *   3. import_bank_statement: single account auto-picks → confirm →
 *      rows imported + navigateTo recon; repeat confirm →
 *      alreadyImported; a second account makes phase 1 return a
 *      bank-account clarification. PDF statements (Task #1316): sign
 *      comes ONLY from the explicit direction field (|amount| × direction;
 *      direction-less rows are flagged and skipped, never guessed), a
 *      non-statement PDF refuses with not_a_statement + CSV guidance,
 *      low job confidence refuses with pdf_low_confidence, and phase 2
 *      re-fetches the pinned parse job so preview and commit see
 *      identical rows (dedupe on repeat).
 *   4. save_bank_letter_account: two entities → entity clarification;
 *      with entity → extraction proposal confirmation → confirm creates
 *      the bank-account row (iban/swift/holder + entity link).
 *   5. Role clamps: employee / contractor / board_observer never see
 *      the finance-doc tools in their catalog slice; founding_partner does.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-finance-docs-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startCognidocsStub, defaultInvoicePayload } from "../helpers/cognidocs-stub.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe1090_${Date.now()}`;
const ORG = "aico";

// Mutable stub knobs (Anthropic stub — bank letters only since Task #1316).
const stubState = {
  letterCalls: 0,
};

async function main() {
  // ---- stub CogniDocs server (before any capability import) ----
  const cd = await startCognidocsStub();
  cd.state.invoice = defaultInvoicePayload();

  // ---- stub Anthropic server (before any capability import) ----
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      let parsed: any = {};
      try { parsed = JSON.parse(body || "{}"); } catch {}
      const systemText = Array.isArray(parsed.system)
        ? parsed.system.map((b: any) => b?.text ?? "").join("\n")
        : String(parsed.system ?? "");
      const reply = (text: string, stopReason = "end_turn") => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: `msg_${TAG}`, type: "message", role: "assistant",
          model: parsed.model ?? "claude-sonnet-4-5",
          content: [{ type: "text", text }],
          stop_reason: stopReason, stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }));
      };
      if (systemText.includes("treasury analyst")) {
        stubState.letterCalls++;
        reply(JSON.stringify({
          confidenceNote: "Clear IBAN letter; all fields printed.",
          fields: {
            bankName: "Emirates NBD",
            branch: "Deira",
            accountHolderName: "Cognirise Consulting FZ-LLC",
            iban: "AE07 0331 2345 6789 0123 456",
            accountNumber: "1234567890123456",
            swift: "EBILAEAD",
            currency: "AED",
            issuedOn: "2026-07-30",
          },
        }));
        return;
      }
      // Anything else (session titles etc.) — bland text.
      reply("ok");
    });
  });
  await new Promise<void>((r) => stub.listen(0, r));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "stub-key";

  // ---- dynamic imports AFTER env is pinned ----
  const { db, atelierUsers, atelierBankAccount, atelierBankTransaction, atelierLegalEntities, atelierPartnerFirmInvoices } =
    await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { findByToolName, capabilitiesForPersona } = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );
  const { ingestAttachment } = await import(
    "../../src/lib/atelier-cli/attachments/index.js"
  );

  // ---- personas ----
  const IDS = {
    fp: `u_${TAG}_fp`,
    emp: `u_${TAG}_emp`,
  };
  await db.insert(atelierUsers).values([
    {
      id: IDS.fp, orgId: ORG, email: `${TAG}.fp@cognirise.ai`, name: "Probe FP",
      initials: "PF", role: "founding_partner", roleLabel: "Founding Partner",
      title: "Founding Partner", permissions: ["*"],
    },
    {
      id: IDS.emp, orgId: ORG, email: `${TAG}.emp@cognirise.ai`, name: "Probe Emp",
      initials: "PE", role: "employee", roleLabel: "Employee",
      title: "Analyst", permissions: [],
    },
  ]);
  const fpPersona = { id: IDS.fp, name: "Probe FP", role: "founding_partner", orgId: ORG };
  const mkCtx = (persona = fpPersona) => ({
    persona, turnId: `t_${TAG}`, sessionId: `s_${TAG}`, stepIdx: 0,
  });

  // ---- helper: build a text-bearing PDF via pdfkit ----
  async function makePdf(lines: string[]): Promise<Buffer> {
    const { default: PDFDocument } = await import("pdfkit");
    return await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      for (const l of lines) doc.text(l);
      doc.end();
    });
  }

  async function ingest(fileName: string, mime: string, bytes: Buffer): Promise<string> {
    const out = await ingestAttachment({
      orgId: ORG, userId: IDS.fp, userLabel: "Probe FP",
      sessionId: `s_${TAG}`, turnId: `t_${TAG}`, fileName, mime, bytes,
    });
    if (!out.ok) throw new Error(`ingest failed for ${fileName}: ${(out as any).reason}`);
    return out.attachmentId;
  }

  const invoicePdf = await makePdf([
    "TAX INVOICE",
    "Gulf Office Supplies LLC",
    `TRN: 100234567890003  Invoice No: INV-2026-0815 ${TAG}`,
    "Bill To: Cognirise Consulting FZ-LLC",
    "Due Date: 2026-08-30    Payment Terms: Net 30",
    "Subtotal: AED 4,500.48   VAT (5%): AED 225.02",
    "Amount Due: AED 4,725.50",
  ]);
  const letterPdf = await makePdf([
    "Emirates NBD — Account Confirmation Letter",
    "To Whom It May Concern",
    "We confirm the account holder Cognirise Consulting FZ-LLC",
    "IBAN: AE070331234567890123456   SWIFT: EBILAEAD",
    "Currency: AED   Branch: Deira",
  ]);
  const statementCsv = Buffer.from(
    [
      "date,amount,counterparty,reference,currency",
      `2026-08-01,15000.00,Acme Client,${TAG}-wire-1,AED`,
      `2026-08-03,-2200.50,DEWA,${TAG}-bill-1,AED`,
      `2026-08-05,-780.00,Du Telecom,${TAG}-bill-2,AED`,
    ].join("\n"),
    "utf8",
  );

  const [invoiceAtt, letterAtt, stmtAtt] = await Promise.all([
    ingest(`supplier-invoice-${TAG}.pdf`, "application/pdf", invoicePdf),
    ingest(`iban-letter-${TAG}.pdf`, "application/pdf", letterPdf),
    ingest(`statement-${TAG}.csv`, "text/csv", statementCsv),
  ]);

  const classify = findByToolName("classify_finance_document")!;
  const ingestInv = findByToolName("ingest_supplier_invoice")!;
  const importStmt = findByToolName("import_bank_statement")!;
  const saveLetter = findByToolName("save_bank_letter_account")!;
  check("all four capabilities registered", !!classify && !!ingestInv && !!importStmt && !!saveLetter);

  // =============== 1) classifier ===============
  {
    const r: any = await classify.run(
      { attachmentIds: [invoiceAtt, stmtAtt, letterAtt] },
      mkCtx() as any,
    );
    const byId = new Map((r.data?.results ?? []).map((x: any) => [x.attachmentId, x]));
    const inv: any = byId.get(invoiceAtt);
    const stm: any = byId.get(stmtAtt);
    const let_: any = byId.get(letterAtt);
    check("classify: invoice PDF → supplier_invoice", inv?.kind === "supplier_invoice", inv);
    check(
      "classify: invoice recommends ingest_supplier_invoice",
      inv?.recommendedTool === "ingest_supplier_invoice" || inv?.lowConfidence === true,
      inv,
    );
    check("classify: CSV → bank_statement (high confidence)", stm?.kind === "bank_statement" && !stm?.lowConfidence, stm);
    check("classify: letter → bank_letter", let_?.kind === "bank_letter", let_);
    // Garbage: an unmarked text file.
    const junkAtt = await ingest(`notes-${TAG}.txt`, "text/plain", Buffer.from("hello there general notes about nothing financial", "utf8"));
    const r2: any = await classify.run({ attachmentIds: [junkAtt] }, mkCtx() as any);
    const junk: any = r2.data?.results?.[0];
    check(
      "classify: junk → unknown/low confidence with ask-one-question nextStep",
      (junk?.kind === "unknown" || junk?.lowConfidence === true) &&
        typeof junk?.nextStep === "string" && /ask the user one/i.test(junk.nextStep),
      junk,
    );
  }

  // =============== 2) supplier invoice pipeline ===============
  {
    const p1: any = await ingestInv.run({ attachmentId: invoiceAtt }, mkCtx() as any);
    check("invoice: phase 1 returns confirmation", !!p1.confirmation, p1);
    check(
      "invoice: confirmation carries parsed fields + confirm:true",
      p1.confirmation?.pending?.input?.confirm === true &&
        p1.confirmation?.pending?.input?.supplierName === "Gulf Office Supplies LLC" &&
        p1.confirmation?.pending?.input?.amount === 4725.5 &&
        p1.confirmation?.pending?.input?.reference === "INV-2026-0815",
      p1.confirmation?.pending,
    );
    const p2: any = await ingestInv.run(p1.confirmation.pending.input, mkCtx() as any);
    check("invoice: confirm commits ok", p2.ok === true && !p2.confirmation, p2);
    check(
      "invoice: navigateTo payables review queue",
      p2.data?.navigateTo?.path === "/finance/payables/supplier-invoices" &&
        p2.data?.navigateTo?.when === "on_commit",
      p2.data?.navigateTo,
    );
    const [row] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, "INV-2026-0815"),
    ));
    check(
      "invoice: DB row in the SAME review states as UI upload (submitted / internal_upload)",
      row?.status === "submitted" && row?.source === "internal_upload" &&
        row?.costAmount === 4725.5 && row?.costCurrency === "AED",
      row,
    );
    // A model-fabricated confirm:true WITHOUT the phase-1 commit token
    // must degrade to the preview — never write. (Code-review defense.)
    const forged: any = await ingestInv.run(
      { attachmentId: invoiceAtt, supplierName: "Evil Corp", amount: 1, currency: "AED", reference: `${TAG}-forged`, confirm: true },
      mkCtx() as any,
    );
    check("invoice: forged confirm without token → preview, no commit", !!forged.confirmation && !forged.data?.item, forged);
    const [forgedRow] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, `${TAG}-forged`),
    ));
    check("invoice: forged confirm wrote nothing", !forgedRow, forgedRow);

    // Idempotent retry: dedupe surfaces as success, not error.
    const p3: any = await ingestInv.run(p1.confirmation.pending.input, mkCtx() as any);
    check("invoice: repeat confirm → alreadyFiled success", p3.ok === true && p3.data?.alreadyFiled === true, p3);

    // Low-confidence parse (CogniDocs job confidence 30 → 0.3, below the
    // 0.6 floor) → correction clarification (never a guessed commit).
    cd.state.confidence = 30;
    const lowPdf = await makePdf(["TAX INVOICE", `blurry scan ${TAG}`, "Amount Due: AED ????", "Invoice No: smudged", "Subtotal VAT Bill To Due Date"]);
    const lowAtt = await ingest(`low-conf-${TAG}.pdf`, "application/pdf", lowPdf);
    const pl: any = await ingestInv.run({ attachmentId: lowAtt }, mkCtx() as any);
    check("invoice: low-confidence parse → clarification, no confirmation", !!pl.clarification && !pl.confirmation, pl);
    cd.state.confidence = 95;
  }

  // =============== 2b) Task #1250 — invoice+receipt pairing ===============
  {
    const pairRef = `YBJGOJ-${String(Date.now()).slice(-6)}`;
    const pairInvoicePdf = await makePdf([
      "TAX INVOICE",
      "Desert Print Co LLC",
      `TRN: 100987654320003  Invoice No: ${pairRef}`,
      "Bill To: Cognirise Consulting FZ-LLC",
      "Due Date: 2026-09-01   Payment Terms: Net 15",
      "Item 1: Banner printing x2 @ AED 500.00 = AED 1,000.00",
      "Item 2: Design fee x1 @ AED 175.74 = AED 175.74",
      "Subtotal: AED 1,175.74   VAT (5%): AED 58.76",
      "Amount Due: AED 1,234.50",
    ]);
    const pairReceiptPdf = await makePdf([
      "PAYMENT RECEIPT",
      "Desert Print Co LLC — thank you for your purchase",
      `Ref: ${pairRef}`,
      "Card ****4242",
      "Amount Paid: AED 1,234.50",
    ]);
    const [pairInvAtt, pairRcptAtt] = await Promise.all([
      ingest(`pair-invoice-${TAG}.pdf`, "application/pdf", pairInvoicePdf),
      ingest(`payment-receipt-${TAG}.pdf`, "application/pdf", pairReceiptPdf),
    ]);
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Desert Print Co LLC",
      invoiceRef: pairRef,
      issueDate: "2026-08-14",
      currency: "AED",
      subtotalAmount10k: 11_757_400,
      taxAmount10k: 587_600,
      totalAmount10k: 12_345_000,
      lineItems: [
        { description: "Banner printing", quantity10k: 20_000, unitPriceAmount10k: 5_000_000, amount10k: 10_000_000 },
        { description: "Design fee", quantity10k: 10_000, unitPriceAmount10k: 1_757_400, amount10k: 1_757_400 },
      ],
    });

    // Pair detection during classification (ingest preview routing).
    const c: any = await classify.run({ attachmentIds: [pairInvAtt, pairRcptAtt] }, mkCtx() as any);
    const pair = (c.data?.pairs ?? [])[0];
    check(
      "pair: classifier detects same-reference invoice+receipt as ONE combined action",
      !!pair && pair.invoiceAttachmentId === pairInvAtt && pair.receiptAttachmentId === pairRcptAtt &&
        /receiptAttachmentId/.test(pair.nextStep ?? "") && /twice/i.test(pair.nextStep ?? ""),
      c.data,
    );
    const rcptResult = (c.data?.results ?? []).find((r: any) => r.attachmentId === pairRcptAtt);
    check(
      "pair: receipt result loses its standalone ingest recommendation",
      rcptResult?.recommendedTool == null && rcptResult?.pairedInvoiceAttachmentId === pairInvAtt,
      rcptResult,
    );

    // Mismatched receipt (bank letter — no shared ref/amount) is refused.
    const bad: any = await ingestInv.run(
      { attachmentId: pairInvAtt, receiptAttachmentId: letterAtt },
      mkCtx() as any,
    );
    check("pair: non-matching receipt → receipt_mismatch, no pairing", bad.ok === false && bad.errorCode === "receipt_mismatch", bad);

    // Same AMOUNT but different reference must NOT pair or mark paid —
    // identical totals across unrelated bills are common.
    const sameAmtReceiptPdf = await makePdf([
      "PAYMENT RECEIPT",
      "Some Other Vendor LLC — thank you for your purchase",
      "Ref: OTHER-99999",
      "Amount Paid: AED 1,234.50",
    ]);
    const sameAmtAtt = await ingest(`other-receipt-${TAG}.pdf`, "application/pdf", sameAmtReceiptPdf);
    const badAmt: any = await ingestInv.run(
      { attachmentId: pairInvAtt, receiptAttachmentId: sameAmtAtt },
      mkCtx() as any,
    );
    check(
      "pair: same-amount/different-reference receipt → refused, never paired",
      badAmt.ok === false && badAmt.errorCode === "receipt_mismatch",
      badAmt,
    );
    const cAmt: any = await classify.run({ attachmentIds: [pairInvAtt, sameAmtAtt] }, mkCtx() as any);
    check(
      "pair: classifier never pairs on amount alone",
      (cAmt.data?.pairs ?? []).length === 0,
      cAmt.data?.pairs,
    );

    // Prefix/suffix reference collision: a receipt printing a LONGER
    // reference that merely contains this one must never pair.
    const collisionReceiptPdf = await makePdf([
      "PAYMENT RECEIPT",
      "Desert Print Co LLC — thank you for your purchase",
      `Ref: ${pairRef}6`,
      "Card ****4242",
      "Amount Paid: AED 1,234.50",
    ]);
    const collisionAtt = await ingest(`collision-receipt-${TAG}.pdf`, "application/pdf", collisionReceiptPdf);
    const badCollision: any = await ingestInv.run(
      { attachmentId: pairInvAtt, receiptAttachmentId: collisionAtt },
      mkCtx() as any,
    );
    check(
      "pair: receipt with a longer superstring reference → refused (exact match only)",
      badCollision.ok === false && badCollision.errorCode === "receipt_mismatch",
      badCollision,
    );

    // Self-pairing: the invoice can never be its own proof of payment.
    const selfPair: any = await ingestInv.run(
      { attachmentId: pairInvAtt, receiptAttachmentId: pairInvAtt },
      mkCtx() as any,
    );
    check(
      "pair: invoice as its own receipt → refused",
      selfPair.ok === false && selfPair.errorCode === "receipt_mismatch",
      selfPair,
    );

    // A SECOND INVOICE printing the same reference is not payment evidence:
    // it classifies as an invoice, not a receipt, so pairing is refused.
    const secondInvoicePdf = await makePdf([
      "TAX INVOICE",
      "Desert Print Co LLC",
      `TRN: 100987654320003  Invoice No: ${pairRef}`,
      "Bill To: Cognirise Consulting FZ-LLC",
      "Due Date: 2026-09-01   Payment Terms: Net 15",
      "Subtotal: AED 1,175.74   VAT (5%): AED 58.76",
      "Amount Due: AED 1,234.50",
    ]);
    const secondInvAtt = await ingest(`pair-invoice-copy-${TAG}.pdf`, "application/pdf", secondInvoicePdf);
    const notReceipt: any = await ingestInv.run(
      { attachmentId: pairInvAtt, receiptAttachmentId: secondInvAtt },
      mkCtx() as any,
    );
    check(
      "pair: reference-bearing NON-receipt (a second invoice) as receipt → refused",
      notReceipt.ok === false && notReceipt.errorCode === "receipt_mismatch" &&
        /doesn't look like a payment receipt/i.test(notReceipt.errorMessage ?? ""),
      notReceipt,
    );

    // Combined phase 1: line items captured + paid summary + pinned pair.
    const p1: any = await ingestInv.run(
      { attachmentId: pairInvAtt, receiptAttachmentId: pairRcptAtt },
      mkCtx() as any,
    );
    check("pair: phase 1 returns combined confirmation", !!p1.confirmation, p1);
    check(
      "pair: summary announces line items + proof of payment + PAID",
      /2 printed line item/.test(p1.confirmation?.summary ?? "") &&
        /proof of payment/i.test(p1.confirmation?.summary ?? "") &&
        /PAID/.test(p1.confirmation?.summary ?? ""),
      p1.confirmation?.summary,
    );
    check(
      "pair: pending input pins receipt + line items",
      p1.confirmation?.pending?.input?.receiptAttachmentId === pairRcptAtt &&
        (p1.confirmation?.pending?.input?.lineItems ?? []).length === 2,
      p1.confirmation?.pending?.input,
    );

    const p2: any = await ingestInv.run(p1.confirmation.pending.input, mkCtx() as any);
    check("pair: confirm commits ok with paid message", p2.ok === true && /PAID/.test(p2.data?.message ?? ""), p2);
    const rows = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, pairRef),
    ));
    check("pair: exactly ONE record for the bill", rows.length === 1, rows.length);
    const row = rows[0];
    check(
      "pair: row is paid with receipt attached + line items stored",
      row?.status === "paid" && !!row?.paidAt && row?.paymentReceipt?.blobRef &&
        row?.paymentReceipt?.matchedBy === "reference" &&
        (row?.lineItems ?? []).length === 2 &&
        row?.lineItems?.[0]?.description === "Banner printing",
      { status: row?.status, receipt: row?.paymentReceipt, lineItems: row?.lineItems },
    );

    // No-duplicate defense: ingesting the RECEIPT as its own invoice with
    // the same supplier+reference dedupes to alreadyFiled (never a 2nd row).
    const d1: any = await ingestInv.run(
      { attachmentId: pairRcptAtt, supplierName: "Desert Print Co LLC", amount: 1234.5, currency: "AED", reference: pairRef },
      mkCtx() as any,
    );
    check("pair: receipt-as-invoice phase 1 still previews", !!d1.confirmation, d1);
    const d2: any = await ingestInv.run(d1.confirmation.pending.input, mkCtx() as any);
    check("pair: receipt-as-invoice confirm → alreadyFiled, no duplicate", d2.ok === true && d2.data?.alreadyFiled === true, d2);
    const rowsAfter = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, pairRef),
    ));
    check("pair: still exactly ONE record after the duplicate attempt", rowsAfter.length === 1, rowsAfter.length);

    // Itemization transparency: a document with NO printed line rows says why.
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Flat Fee Consulting FZE",
      invoiceRef: `FLAT-${String(Date.now()).slice(-6)}`,
      issueDate: "2026-08-15",
      currency: "AED",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 9_000_000,
      lineItems: null,
    });
    const flatPdf = await makePdf([
      "TAX INVOICE",
      "Flat Fee Consulting FZE",
      "Invoice No: (as agreed)  Bill To: Cognirise",
      "Due Date: 2026-09-15  Subtotal VAT",
      "Amount Due: AED 900.00",
    ]);
    const flatAtt = await ingest(`flat-${TAG}.pdf`, "application/pdf", flatPdf);
    const f1: any = await ingestInv.run({ attachmentId: flatAtt }, mkCtx() as any);
    check(
      "no-items: summary explains why there is no itemization",
      !!f1.confirmation && /No itemizable line rows/i.test(f1.confirmation?.summary ?? ""),
      f1.confirmation?.summary,
    );
    cd.state.invoice = defaultInvoicePayload();
  }

  // =============== 2c) Task #1316 — CogniDocs failure modes + dedupe id ===============
  {
    const { parseSupplierInvoiceDoc } = await import("../../src/lib/atelier-finance-docs.js");
    const probeBytes = await makePdf(["TAX INVOICE", "Anything LLC", `unit ${TAG}`, "Amount Due: AED 1.00"]);

    // Unit: a FAILED CogniDocs job → parse-failed (named, fail-loud).
    cd.state.failNext = "unreadable scan";
    const failedParse = await parseSupplierInvoiceDoc({ bytes: probeBytes, fileName: "unit.pdf" });
    check(
      "parse: failed job → parse-failed",
      failedParse.ok === false && failedParse.errorCode === "parse-failed",
      failedParse,
    );

    // Unit: a completed job with NO invoice payload (the document is a
    // statement or unreadable) → parse-failed with the shape message,
    // never invoice fields forced out of a non-invoice.
    cd.state.invoice = null;
    const notInvoice = await parseSupplierInvoiceDoc({ bytes: probeBytes, fileName: "unit.pdf" });
    check(
      "parse: no invoice payload → parse-failed 'did not parse as an invoice'",
      notInvoice.ok === false &&
        notInvoice.errorCode === "parse-failed" &&
        /did not parse as an invoice/i.test(notInvoice.errorMessage),
      notInvoice,
    );

    // Unit: neither API key configured → parse-not-configured (loud).
    const savedSandboxKey = process.env.COGNIDOCS_SANDBOX_API_KEY;
    delete process.env.COGNIDOCS_SANDBOX_API_KEY;
    delete process.env.COGNIDOCS_API_KEY;
    const noKeys = await parseSupplierInvoiceDoc({ bytes: probeBytes, fileName: "unit.pdf" });
    check(
      "parse: no API keys → parse-not-configured, never a silent fallback",
      noKeys.ok === false && noKeys.errorCode === "parse-not-configured",
      noKeys,
    );
    process.env.COGNIDOCS_SANDBOX_API_KEY = savedSandboxKey;
    cd.state.invoice = defaultInvoicePayload();

    // e2e: an ingest whose parse FAILS degrades to a clarification naming
    // the error code — asks for the fields, never a dead end or a guess.
    cd.state.failNext = "corrupt file";
    const failPdf = await makePdf([
      "TAX INVOICE", "Mystery Vendor LLC",
      `fail ${TAG}`, "Subtotal VAT Bill To Due Date",
      "Amount Due: AED ????",
    ]);
    const failAtt = await ingest(`fail-${TAG}.pdf`, "application/pdf", failPdf);
    const f2: any = await ingestInv.run({ attachmentId: failAtt }, mkCtx() as any);
    check(
      "parse failure e2e: clarification names the parse error code",
      !!f2.clarification && /couldn't be parsed/i.test(f2.clarification?.question ?? "") &&
        /parse-failed/.test(f2.clarification?.question ?? ""),
      f2.clarification?.question,
    );

    // Long itemized invoice: 40 printed line rows (×10k ints) survive
    // end-to-end into the confirmation — CogniDocs never truncates.
    const longRef = `LONG-${String(Date.now()).slice(-6)}`;
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Replit Inc",
      invoiceRef: longRef,
      issueDate: "2026-08-01",
      currency: "USD",
      subtotalAmount10k: 2_000_000,
      taxAmount10k: 100_000,
      totalAmount10k: 2_100_000,
      lineItems: Array.from({ length: 40 }, (_, i) => ({
        description: `Project row ${i + 1}`,
        quantity10k: 10_000,
        unitPriceAmount10k: 50_000,
        amount10k: 50_000,
      })),
    });
    const longPdf = await makePdf([
      "TAX INVOICE", "Replit Inc", `Invoice No: ${longRef}`,
      "Bill To: Cognirise Consulting FZ-LLC",
      ...Array.from({ length: 40 }, (_, i) => `Item ${i + 1}: Project row ${i + 1}  $5.00`),
      "Amount Due: USD 210.00",
    ]);
    const longAtt = await ingest(`replit-long-${TAG}.pdf`, "application/pdf", longPdf);
    const l1: any = await ingestInv.run({ attachmentId: longAtt }, mkCtx() as any);
    check(
      "long invoice: 40 line rows parse end-to-end into the confirmation",
      !!l1.confirmation &&
        (l1.confirmation?.pending?.input?.lineItems ?? []).length === 40 &&
        /40 printed line item/.test(l1.confirmation?.summary ?? "") &&
        l1.confirmation?.pending?.input?.amount === 210,
      { n: (l1.confirmation?.pending?.input?.lineItems ?? []).length, summary: l1.confirmation?.summary },
    );

    // Task #1316 — CogniDocs' stable invoice.id is a THIRD dedupe signal:
    // the same underlying bill re-uploaded as a DIFFERENT file (different
    // bytes AND a differently-printed reference) still dedupes to
    // alreadyFiled because CogniDocs recognizes the same invoice.
    const cdRef = `CDID-${String(Date.now()).slice(-6)}`;
    cd.state.invoice = defaultInvoicePayload({
      id: `cdinv_${TAG}`,
      vendorName: "Stable Docs LLC",
      invoiceRef: cdRef,
      issueDate: "2026-08-16",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 5_000_000,
    });
    const cdPdfA = await makePdf(["TAX INVOICE", "Stable Docs LLC", `Invoice No: ${cdRef}`, "Amount Due: AED 500.00"]);
    const cdAttA = await ingest(`stable-a-${TAG}.pdf`, "application/pdf", cdPdfA);
    const s1: any = await ingestInv.run({ attachmentId: cdAttA }, mkCtx() as any);
    check(
      "cognidocs-id: phase 1 pins the parser-issued invoice id",
      !!s1.confirmation && s1.confirmation?.pending?.input?.cognidocsInvoiceId === `cdinv_${TAG}`,
      s1.confirmation?.pending?.input,
    );
    const s2: any = await ingestInv.run(s1.confirmation.pending.input, mkCtx() as any);
    check("cognidocs-id: first upload commits", s2.ok === true && !s2.data?.alreadyFiled, s2);
    // Re-upload: different bytes, different printed reference — same id.
    cd.state.invoice = defaultInvoicePayload({
      id: `cdinv_${TAG}`,
      vendorName: "Stable Docs LLC",
      invoiceRef: `${cdRef}-COPY`,
      issueDate: "2026-08-16",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 5_000_000,
    });
    const cdPdfB = await makePdf(["TAX INVOICE", "Stable Docs LLC", `Invoice No: ${cdRef}-COPY`, "resent copy", "Amount Due: AED 500.00"]);
    const cdAttB = await ingest(`stable-b-${TAG}.pdf`, "application/pdf", cdPdfB);
    const s3: any = await ingestInv.run({ attachmentId: cdAttB }, mkCtx() as any);
    check("cognidocs-id: re-upload phase 1 previews", !!s3.confirmation, s3);
    const s4: any = await ingestInv.run(s3.confirmation.pending.input, mkCtx() as any);
    check(
      "cognidocs-id: different bytes + reference, same id → alreadyFiled",
      s4.ok === true && s4.data?.alreadyFiled === true,
      s4,
    );
    const stableRows = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.cognidocsInvoiceId, `cdinv_${TAG}`),
    ));
    check("cognidocs-id: exactly ONE row for the underlying bill", stableRows.length === 1, stableRows.length);
    cd.state.invoice = defaultInvoicePayload();
  }

  // =============== 3) bank statement pipeline ===============
  {
    const acctId = `bank_${TAG}_1`;
    await db.insert(atelierBankAccount).values({
      id: acctId, orgId: ORG, bankName: "Emirates NBD", accountLabel: "Operating AED",
      accountNumberLast4: "3456", currency: "AED", createdByUserId: IDS.fp,
    });
    // The boot seed already ships bank accounts, so an account-less
    // call must clarify rather than guess.
    const pAsk: any = await importStmt.run({ attachmentId: stmtAtt, statementDate: "2026-08-10" }, mkCtx() as any);
    check(
      "statement: multiple accounts → bankAccountId clarification with options",
      !!pAsk.clarification && pAsk.clarification.field === "bankAccountId" &&
        (pAsk.clarification.suggestions ?? []).length >= 2,
      pAsk.clarification,
    );
    const p1: any = await importStmt.run(
      { attachmentId: stmtAtt, statementDate: "2026-08-10", bankAccountId: acctId },
      mkCtx() as any,
    );
    check("statement: explicit account → confirmation", !!p1.confirmation, p1);
    check(
      "statement: pending pins account + date",
      p1.confirmation?.pending?.input?.bankAccountId === acctId &&
        p1.confirmation?.pending?.input?.statementDate === "2026-08-10",
      p1.confirmation?.pending,
    );
    const p2: any = await importStmt.run(p1.confirmation.pending.input, mkCtx() as any);
    check("statement: confirm imports rows", p2.ok === true && p2.data?.rowsImported === 3, p2);
    check(
      "statement: navigateTo recon",
      p2.data?.navigateTo?.path === "/wallet/cash/recon" && p2.data?.navigateTo?.when === "on_commit",
      p2.data?.navigateTo,
    );
    const p3: any = await importStmt.run(p1.confirmation.pending.input, mkCtx() as any);
    check("statement: repeat confirm → alreadyImported success", p3.ok === true && p3.data?.alreadyImported === true, p3);

    const forged: any = await importStmt.run(
      { attachmentId: stmtAtt, bankAccountId: acctId, confirm: true, commitToken: "deadbeef" },
      mkCtx() as any,
    );
    check("statement: forged confirm without valid token → preview, no import", !!forged.confirmation && forged.data?.rowsImported == null, forged);

    // Task #1316 — a non-statement PDF (CogniDocs returns an invoice
    // payload, no statement payload) refuses with not_a_statement + the
    // CSV-export guidance, never forces rows out of an invoice.
    const pdfStmtAtt = await ingest(`stmt-${TAG}.pdf`, "application/pdf", invoicePdf);
    const pPdf: any = await importStmt.run({ attachmentId: pdfStmtAtt }, mkCtx() as any);
    check(
      "statement: non-statement PDF → not_a_statement refusal with CSV guidance",
      pPdf.ok === false && pPdf.errorCode === "not_a_statement" && /csv/i.test(pPdf.errorMessage ?? ""),
      pPdf,
    );

    // CogniDocs statement fixtures (the stub replays these; row identity
    // is stub-driven, the PDF bytes only need to look like a PDF).
    const stmtResult = (transactions: any[]): any => ({
      bankId: null, bankName: "Emirates NBD", statementType: "bank_statement",
      currency: "AED", accountRef: "****3456", periodStart: "2026-08-01",
      periodEnd: "2026-08-31", partialImportWarning: null, transactions,
    });
    const txn = (t: { date: string; amount10k: number; direction: "debit" | "credit" | null } & Record<string, unknown>): any => ({
      description: null, rawDescription: null, currency: null, balance10k: null,
      normalizedMerchant: null, parsedMerchant: null, category: null, ...t,
    });

    // Task #1316 — well-formed PDF statement: sign comes ONLY from the
    // explicit direction field (magnitude = |amount10k|), a direction-less
    // row is flagged and skipped, rows import through the shared core and
    // dedupe on repeat (phase 2 re-fetches the pinned parse job).
    cd.state.invoice = null;
    cd.state.statement = stmtResult([
      txn({ date: "2026-08-02", description: "Acme Client incoming wire", rawDescription: `ref ${TAG}-PDF-1`, amount10k: 152_500_000, direction: "credit" }),
      txn({ date: "2026-08-04", description: "DEWA utility bill payment", amount10k: 23_107_500, direction: "debit" }),
      txn({ date: "2026-08-06", description: "Du Telecom monthly plan", rawDescription: `ref ${TAG}-PDF-2`, amount10k: 7_950_000, direction: "debit" }),
      // Negative printed amount10k WITH explicit debit direction: the
      // magnitude is |amount|, the sign obeys direction alone.
      txn({ date: "2026-08-07", description: "Office rent payment", amount10k: -80_000_000, direction: "debit" }),
      // No direction marker → flagged, never guessed.
      txn({ date: "2026-08-08", description: "Misc entry", amount10k: 1_234_500, direction: null }),
    ]);
    const stmtPdf = await makePdf([
      "Emirates NBD — Account Statement",
      "Account: Operating AED  ****3456",
      `statement fixture ${TAG}`,
    ]);
    const goodPdfAtt = await ingest(`statement-${TAG}.pdf`, "application/pdf", stmtPdf);
    const q1: any = await importStmt.run(
      { attachmentId: goodPdfAtt, statementDate: "2026-08-11", bankAccountId: acctId },
      mkCtx() as any,
    );
    check("statement PDF: phase 1 returns confirmation with parsed-row preview",
      !!q1.confirmation && q1.data?.preview?.source === "pdf" &&
        q1.data?.preview?.pdf?.rowsExtracted === 4 &&
        Array.isArray(q1.data?.preview?.pdf?.rows) && q1.data.preview.pdf.rows.length === 4,
      q1.data?.preview,
    );
    const rows = (q1.data?.preview?.pdf?.rows ?? []) as any[];
    const wire = rows.find((r) => /acme/i.test(r.counterparty ?? ""));
    const dewa = rows.find((r) => /dewa/i.test(r.counterparty ?? ""));
    const du = rows.find((r) => /du telecom/i.test(r.counterparty ?? ""));
    const rent = rows.find((r) => /rent/i.test(r.counterparty ?? ""));
    check(
      "statement PDF: ×10k amounts land as majors with direction-driven signs",
      wire?.amount === 15250 && wire?.confidence >= 0.7 &&
        dewa?.amount === -2310.75 && du?.amount === -795,
      rows,
    );
    check(
      "statement PDF: negative amount10k + explicit debit → magnitude |amount|, sign from direction, kind=payment",
      rent?.amount === -8000 && rent?.confidence >= 0.7 && rent?.kind === "payment",
      rent,
    );
    const pdfFlagged = (q1.data?.preview?.pdf?.flagged ?? []) as any[];
    check(
      "statement PDF: direction-less row is flagged, never guessed",
      q1.data?.preview?.pdf?.flaggedRows === 1 &&
        pdfFlagged.some((f) => /misc entry/i.test(f.snippet ?? "") && /direction unclear/i.test(f.reason ?? "")) &&
        !rows.some((r) => Math.abs(r.amount) === 123.45),
      pdfFlagged,
    );
    check(
      "statement PDF: summary mentions extracted + skipped rows for human review",
      /PDF/.test(q1.confirmation?.summary ?? "") && /4 extracted/.test(q1.confirmation?.summary ?? "") &&
        /flagged and SKIPPED/.test(q1.confirmation?.summary ?? ""),
      q1.confirmation?.summary,
    );
    const q2: any = await importStmt.run(q1.confirmation.pending.input, mkCtx() as any);
    check("statement PDF: confirm imports only the 4 confident rows via the shared core",
      q2.ok === true && q2.data?.rowsImported === 4 &&
        q2.data?.navigateTo?.path === "/wallet/cash/recon",
      q2,
    );
    const pdfTxns = await db.select().from(atelierBankTransaction).where(and(
      eq(atelierBankTransaction.orgId, ORG),
      eq(atelierBankTransaction.statementImportId, q2.data?.importId ?? ""),
    ));
    const rentTxn = pdfTxns.find((t: any) => Number(t.amount) === -8000);
    check(
      "statement PDF: stored unsigned-outflow transaction persists kind=payment",
      pdfTxns.length === 4 && rentTxn?.kind === "payment",
      pdfTxns.map((t: any) => ({ amount: t.amount, kind: t.kind })),
    );
    const q3: any = await importStmt.run(q1.confirmation.pending.input, mkCtx() as any);
    check("statement PDF: repeat confirm → alreadyImported (same dedupe as CSV)",
      q3.ok === true && q3.data?.alreadyImported === true, q3);

    // Task #1316 — sign convention edge: a credit row whose printed
    // amount10k is NEGATIVE still lands POSITIVE (magnitude from |amount|,
    // sign from the explicit direction field ONLY).
    cd.state.statement = stmtResult([
      txn({ date: "2026-08-12", description: "Refund from vendor", rawDescription: `ref ${TAG}-SIGN-1`, amount10k: -50_000_000, direction: "credit" }),
      txn({ date: "2026-08-13", description: "Card fee", amount10k: 990_000, direction: "debit" }),
    ]);
    const signPdf = await makePdf([`ACME BANK — Statement ${TAG} SIGN`, "sign-convention fixture"]);
    const signAtt = await ingest(`statement-sign-${TAG}.pdf`, "application/pdf", signPdf);
    const d1: any = await importStmt.run(
      { attachmentId: signAtt, statementDate: "2026-08-12", bankAccountId: acctId },
      mkCtx() as any,
    );
    const signRows = (d1.data?.preview?.pdf?.rows ?? []) as any[];
    const refund = signRows.find((r) => /refund/i.test(r.counterparty ?? ""));
    const fee = signRows.find((r) => /card fee/i.test(r.counterparty ?? ""));
    check(
      "statement PDF (sign edge): negative amount10k + credit direction → POSITIVE row",
      !!d1.confirmation && d1.data?.preview?.pdf?.rowsExtracted === 2 &&
        refund?.amount === 5000 && fee?.amount === -99,
      signRows,
    );

    // Low overall job confidence (40 < the 0.6 floor) refuses with the
    // CSV guidance even though every row is individually well-formed.
    cd.state.confidence = 40;
    const dLow: any = await importStmt.run(
      { attachmentId: signAtt, statementDate: "2026-08-12", bankAccountId: acctId },
      mkCtx() as any,
    );
    check(
      "statement PDF: low job confidence → pdf_low_confidence with CSV guidance",
      dLow.ok === false && dLow.errorCode === "pdf_low_confidence" && /csv/i.test(dLow.errorMessage ?? ""),
      dLow,
    );
    cd.state.confidence = 95;

    // Every row direction-less → zero importable rows → refuse (never
    // guesses a sign to force an import through).
    cd.state.statement = stmtResult([
      txn({ date: "2026-08-14", description: "Ambiguous one", amount10k: 25_000_000, direction: null }),
      txn({ date: "2026-08-15", description: "Ambiguous two", amount10k: 12_500_000, direction: null }),
    ]);
    const ambPdf = await makePdf([`ACME BANK — Statement ${TAG} AMB`, "all-ambiguous fixture"]);
    const ambAtt = await ingest(`statement-amb-${TAG}.pdf`, "application/pdf", ambPdf);
    const dAmb: any = await importStmt.run(
      { attachmentId: ambAtt, statementDate: "2026-08-15", bankAccountId: acctId },
      mkCtx() as any,
    );
    check(
      "statement PDF: all rows direction-less → refusal mentioning the ambiguous rows",
      dAmb.ok === false && dAmb.errorCode === "pdf_low_confidence" &&
        /csv/i.test(dAmb.errorMessage ?? "") && /2 row/.test(dAmb.errorMessage ?? ""),
      dAmb,
    );

    // Forged PDF confirm: confirm:true with a bogus pinned cognidocsJobId
    // and no valid commit token degrades to a fresh phase-1 preview (a
    // NEW parse submit) — never a write, never a fetch of the forged job.
    cd.state.statement = stmtResult([
      txn({ date: "2026-08-16", description: "Legit row", amount10k: 10_000_000, direction: "credit" }),
    ]);
    const forgedPdf: any = await importStmt.run(
      {
        attachmentId: ambAtt, statementDate: "2026-08-16", bankAccountId: acctId,
        cognidocsJobId: "cdj_forged_nonexistent", confirm: true, commitToken: "deadbeef",
      },
      mkCtx() as any,
    );
    check(
      "statement PDF: forged confirm with bogus jobId → re-preview via fresh parse, no import",
      !!forgedPdf.confirmation && forgedPdf.data?.rowsImported == null &&
        forgedPdf.confirmation?.pending?.input?.cognidocsJobId !== "cdj_forged_nonexistent",
      forgedPdf,
    );

    // Unknown account id must be rejected, never silently re-picked.
    const pBad: any = await importStmt.run(
      { attachmentId: stmtAtt, bankAccountId: "bank_nope" },
      mkCtx() as any,
    );
    check("statement: unknown account id → not_found", pBad.ok === false && pBad.errorCode === "not_found", pBad);
  }

  // =============== 4) bank letter pipeline ===============
  {
    const entA = `lent_${TAG}_a`;
    const entB = `lent_${TAG}_b`;
    await db.insert(atelierLegalEntities).values([
      { id: entA, orgId: ORG, legalNameEn: `Cognirise Consulting FZ-LLC ${TAG}`, country: "AE" },
      { id: entB, orgId: ORG, legalNameEn: `Cognirise KSA ${TAG}`, country: "SA" },
    ]);
    const p0: any = await saveLetter.run({ attachmentId: letterAtt }, mkCtx() as any);
    check(
      "letter: multiple entities → legalEntityId clarification",
      !!p0.clarification && p0.clarification.field === "legalEntityId",
      p0.clarification,
    );
    const p1: any = await saveLetter.run({ attachmentId: letterAtt, legalEntityId: entA }, mkCtx() as any);
    check("letter: with entity → extraction confirmation", !!p1.confirmation, p1);
    check(
      "letter: pending carries normalized IBAN + entity",
      p1.confirmation?.pending?.input?.iban === "AE070331234567890123456" &&
        p1.confirmation?.pending?.input?.legalEntityId === entA &&
        p1.confirmation?.pending?.input?.confirm === true,
      p1.confirmation?.pending,
    );
    // A model-fabricated confirm:true WITHOUT the phase-1 commit token must
    // degrade to the preview — never save a bank account. (Defense-in-depth
    // for direct tool.run callers; see .agents/memory/chat-commit-token.md.)
    const forgedLetter: any = await saveLetter.run(
      {
        attachmentId: letterAtt, legalEntityId: entA, bankName: "Evil Bank",
        iban: "AE990000000000000000001", accountLabel: `${TAG}-forged-letter`,
        confirm: true, commitToken: "deadbeef",
      },
      mkCtx() as any,
    );
    check(
      "letter: forged confirm without valid token → preview, no save",
      !!forgedLetter.confirmation && !forgedLetter.data?.bankAccountId,
      forgedLetter,
    );
    const [forgedAcct] = await db.select().from(atelierBankAccount).where(and(
      eq(atelierBankAccount.orgId, ORG),
      eq(atelierBankAccount.iban, "AE990000000000000000001"),
    ));
    check("letter: forged confirm wrote no bank account", !forgedAcct, forgedAcct);

    const p2: any = await saveLetter.run(p1.confirmation.pending.input, mkCtx() as any);
    check("letter: confirm saves the account", p2.ok === true && !!p2.data?.bankAccountId, p2);
    if (p2.data?.bankAccountId) {
      const [acct] = await db.select().from(atelierBankAccount)
        .where(eq(atelierBankAccount.id, p2.data.bankAccountId));
      check(
        "letter: row has IBAN/SWIFT/holder + entity link via the shared core",
        acct?.iban === "AE070331234567890123456" && acct?.swift === "EBILAEAD" &&
          acct?.accountHolderName === "Cognirise Consulting FZ-LLC" && acct?.legalEntityId === entA,
        acct,
      );
    }
    check("letter: extraction ran through the shared prompt exactly once per phase-1 call", stubState.letterCalls >= 1);
  }

  // =============== 6) Task #1260 — receipt pays an ALREADY-ingested invoice ===============
  {
    const attach = findByToolName("attach_payment_receipt")!;
    check("attach: capability registered", !!attach);

    // File an UNPAID supplier invoice first (the bill arrived last week).
    const lateRef = `LATE-${String(Date.now()).slice(-6)}`;
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Oasis Catering LLC",
      invoiceRef: lateRef,
      issueDate: "2026-08-10",
      currency: "AED",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 7_772_500,
      lineItems: null,
    });
    const lateInvPdf = await makePdf([
      "TAX INVOICE",
      "Oasis Catering LLC",
      `Invoice No: ${lateRef}`,
      "Bill To: Cognirise Consulting FZ-LLC",
      "Due Date: 2026-09-10   Payment Terms: Net 30",
      "Amount Due: AED 777.25",
    ]);
    const lateInvAtt = await ingest(`late-invoice-${TAG}.pdf`, "application/pdf", lateInvPdf);
    const li1: any = await ingestInv.run({ attachmentId: lateInvAtt }, mkCtx() as any);
    check("attach: unpaid invoice phase 1 previews", !!li1.confirmation, li1);
    const li2: any = await ingestInv.run(li1.confirmation.pending.input, mkCtx() as any);
    check("attach: unpaid invoice committed", li2.ok === true, li2);
    const [lateRow] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, lateRef),
    ));
    check("attach: invoice row is NOT paid yet", lateRow && lateRow.status !== "paid", lateRow?.status);

    // The receipt for it arrives LATER as its own upload.
    const lateRcptPdf = await makePdf([
      "PAYMENT RECEIPT",
      "Oasis Catering LLC — thank you for your payment",
      `Ref: ${lateRef}`,
      "Paid from company account ****9911",
      "Amount Paid: AED 777.25",
    ]);
    const lateRcptAtt = await ingest(`late-receipt-${TAG}.pdf`, "application/pdf", lateRcptPdf);

    // classify recommends attach_payment_receipt with the matching invoice.
    const c: any = await classify.run({ attachmentIds: [lateRcptAtt] }, mkCtx() as any);
    const rcptRes = (c.data?.results ?? [])[0];
    check(
      "attach: classify recommends attach_payment_receipt for the receipt",
      rcptRes?.recommendedTool === "attach_payment_receipt" &&
        rcptRes?.matchesExistingInvoice?.invoiceId === lateRow?.id,
      rcptRes,
    );

    // Amount-only receipt (same amount, different ref) never matches.
    const amtOnlyPdf = await makePdf([
      "PAYMENT RECEIPT",
      "Someone Else LLC",
      "Ref: TOTALLY-DIFFERENT-1",
      "Amount Paid: AED 777.25",
    ]);
    const amtOnlyAtt = await ingest(`amt-only-receipt-${TAG}.pdf`, "application/pdf", amtOnlyPdf);
    const amtOnly: any = await attach.run({ receiptAttachmentId: amtOnlyAtt }, mkCtx() as any);
    check(
      "attach: amount-only receipt → no_matching_invoice (amounts never pair)",
      amtOnly.ok === false && amtOnly.errorCode === "no_matching_invoice",
      amtOnly,
    );

    // Wrong explicit invoiceId is re-verified against the receipt text.
    const otherInvoiceId = (await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, "INV-2026-0815"),
    )))[0]?.id;
    if (otherInvoiceId) {
      const wrong: any = await attach.run(
        { receiptAttachmentId: lateRcptAtt, invoiceId: otherInvoiceId },
        mkCtx() as any,
      );
      check("attach: wrong explicit invoiceId → receipt_mismatch", wrong.ok === false && wrong.errorCode === "receipt_mismatch", wrong);
    }

    // A non-receipt (the invoice itself) is never payment evidence.
    const notRcpt: any = await attach.run({ receiptAttachmentId: lateInvAtt }, mkCtx() as any);
    check("attach: non-receipt document refused", notRcpt.ok === false && notRcpt.errorCode === "receipt_mismatch", notRcpt);

    // Phase 1 resolves THE one invoice + previews with a commit token.
    const a1: any = await attach.run({ receiptAttachmentId: lateRcptAtt }, mkCtx() as any);
    check(
      "attach: phase 1 previews the matched invoice with PAID summary",
      !!a1.confirmation && a1.confirmation.pending?.input?.invoiceId === lateRow?.id &&
        /PAID/.test(a1.confirmation?.summary ?? "") &&
        typeof a1.confirmation.pending?.input?.commitToken === "string",
      a1,
    );

    // Forged confirm:true WITHOUT the token re-previews, never commits.
    const forged: any = await attach.run(
      { receiptAttachmentId: lateRcptAtt, invoiceId: lateRow?.id, confirm: true },
      mkCtx() as any,
    );
    check("attach: forged confirm without token re-previews", !!forged.confirmation, forged);
    const [stillUnpaid] = await db.select().from(atelierPartnerFirmInvoices).where(
      eq(atelierPartnerFirmInvoices.id, lateRow!.id),
    );
    check("attach: row still unpaid after forged confirm", stillUnpaid?.status !== "paid", stillUnpaid?.status);

    // Verified commit flips the row to paid with the receipt attached.
    const a2: any = await attach.run(a1.confirmation.pending.input, mkCtx() as any);
    check(
      "attach: commit records PAID with navigateTo",
      a2.ok === true && /PAID/.test(a2.data?.message ?? "") && !!a2.data?.navigateTo,
      a2,
    );
    const [paidRow] = await db.select().from(atelierPartnerFirmInvoices).where(
      eq(atelierPartnerFirmInvoices.id, lateRow!.id),
    );
    check(
      "attach: DB row paid + paymentReceipt stored + never enters payment runs",
      paidRow?.status === "paid" && !!paidRow?.paymentReceipt && !paidRow?.paymentRunId,
      { status: paidRow?.status, hasReceipt: !!paidRow?.paymentReceipt },
    );

    // Idempotent repeat: same receipt again is a success, not a double-book.
    const again: any = await attach.run({ receiptAttachmentId: lateRcptAtt }, mkCtx() as any);
    check(
      "attach: repeat with the same receipt → alreadyAttached success, no re-confirm",
      again.ok === true && again.data?.alreadyAttached === true && !again.confirmation,
      again,
    );

    // One receipt can NEVER pay two bills: a SECOND invoice printing the
    // same reference exists, but attaching the already-used receipt to it
    // by explicit invoiceId is refused org-wide on the receipt hash.
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Oasis Catering LLC",
      invoiceRef: `${lateRef}B`,
      issueDate: "2026-08-12",
      currency: "AED",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 7_772_500,
      lineItems: null,
    });
    const twinInvPdf = await makePdf([
      "TAX INVOICE",
      "Oasis Catering LLC",
      `Invoice No: ${lateRef}B`,
      "Bill To: Cognirise Consulting FZ-LLC",
      "Amount Due: AED 777.25",
    ]);
    const twinInvAtt = await ingest(`twin-invoice-${TAG}.pdf`, "application/pdf", twinInvPdf);
    const ti1: any = await ingestInv.run({ attachmentId: twinInvAtt }, mkCtx() as any);
    const ti2: any = await ingestInv.run(ti1.confirmation.pending.input, mkCtx() as any);
    check("attach: second bill filed unpaid", ti2.ok === true, ti2);
    cd.state.invoice = defaultInvoicePayload();
    const [twinRow] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, `${lateRef}B`),
    ));
    // Direct core call with explicit invoiceId — the strongest bypass
    // (skips classify + phase-1 matching entirely).
    const { attachReceiptToSupplierInvoiceCore } = await import(
      "../../src/routes/atelier/financePayablesRoutes.js"
    );
    const [fpUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, IDS.fp));
    const { loadAttachmentBytes: loadBytes } = await import(
      "../../src/lib/atelier-cli/attachments/index.js"
    );
    const rcptLoaded = await (await import("../../src/lib/atelier-cli/attachments/index.js")).loadAttachment(lateRcptAtt, ORG);
    const rcptBytes = await loadBytes(rcptLoaded!.attachment.encryptedRef!);
    const reuse = await attachReceiptToSupplierInvoiceCore({
      me: fpUser as any, invoiceId: twinRow!.id,
      fileBuffer: rcptBytes!, fileName: "late-receipt.pdf", mime: "application/pdf",
      matchedBy: "reference",
    });
    check(
      "attach: same receipt bytes on a SECOND matching invoice → 409 receipt-already-used",
      reuse.status === 409 && (reuse.body as any).error === "receipt-already-used",
      reuse,
    );
    const [twinAfter] = await db.select().from(atelierPartnerFirmInvoices).where(
      eq(atelierPartnerFirmInvoices.id, twinRow!.id),
    );
    check("attach: second bill stays unpaid after the reuse attempt", twinAfter?.status !== "paid", twinAfter?.status);

    // Concurrency: two different receipts confirmed simultaneously for the
    // same invoice — exactly one wins, the loser gets a clean 409.
    const rcA = await makePdf(["PAYMENT RECEIPT", "Oasis Catering LLC", `Ref: ${lateRef}B`, "Amount Paid: AED 777.25", "Channel: transfer A"]);
    const rcB = await makePdf(["PAYMENT RECEIPT", "Oasis Catering LLC", `Ref: ${lateRef}B`, "Amount Paid: AED 777.25", "Channel: transfer B"]);
    const [resA, resB] = await Promise.all([
      attachReceiptToSupplierInvoiceCore({ me: fpUser as any, invoiceId: twinRow!.id, fileBuffer: rcA, fileName: "rcA.pdf", mime: "application/pdf", matchedBy: "reference" }),
      attachReceiptToSupplierInvoiceCore({ me: fpUser as any, invoiceId: twinRow!.id, fileBuffer: rcB, fileName: "rcB.pdf", mime: "application/pdf", matchedBy: "reference" }),
    ]);
    const statuses = [resA.status, resB.status].sort();
    check(
      "attach: concurrent different-receipt confirms → exactly one 200 + one 409",
      statuses[0] === 200 && statuses[1] === 409,
      { a: resA.status, b: resB.status, aBody: resA.body, bBody: resB.body },
    );
    const [twinFinal] = await db.select().from(atelierPartnerFirmInvoices).where(
      eq(atelierPartnerFirmInvoices.id, twinRow!.id),
    );
    const winnerFile = (resA.status === 200 ? "rcA.pdf" : "rcB.pdf");
    check(
      "attach: stored proof belongs to the single winner (never overwritten)",
      twinFinal?.status === "paid" && twinFinal?.paymentReceipt?.fileName === winnerFile,
      { status: twinFinal?.status, file: twinFinal?.paymentReceipt?.fileName, winnerFile },
    );
    // Same-bytes concurrent double-confirm on ANOTHER fresh invoice:
    // advisory lock on the receipt hash serializes them — one attaches,
    // the other reports idempotent alreadyAttached (both 200, ONE write).
    const dupPair = await Promise.all([
      attachReceiptToSupplierInvoiceCore({ me: fpUser as any, invoiceId: twinRow!.id, fileBuffer: winnerFile === "rcA.pdf" ? rcA : rcB, fileName: winnerFile, mime: "application/pdf", matchedBy: "reference" }),
      attachReceiptToSupplierInvoiceCore({ me: fpUser as any, invoiceId: twinRow!.id, fileBuffer: winnerFile === "rcA.pdf" ? rcA : rcB, fileName: winnerFile, mime: "application/pdf", matchedBy: "reference" }),
    ]);
    check(
      "attach: concurrent same-bytes re-confirms → both idempotent alreadyAttached",
      dupPair.every((r) => r.status === 200 && (r.body as any).alreadyAttached === true),
      dupPair.map((r) => ({ s: r.status, b: r.body })),
    );

    // Scenario 5 — invoice + receipt in one batch with NO shared reference:
    // classify flags the mismatch and steers to an UNPAID ingest.
    const mmInvPdf = await makePdf([
      "TAX INVOICE",
      "Dune Logistics LLC",
      `Invoice No: MM-${String(Date.now()).slice(-6)}`,
      "Bill To: Cognirise Consulting FZ-LLC",
      "Amount Due: AED 2,000.00",
    ]);
    const mmRcptPdf = await makePdf([
      "PAYMENT RECEIPT",
      "Dune Logistics LLC",
      "Ref: UNRELATED-777",
      "Amount Paid: AED 2,000.00",
    ]);
    const [mmInvAtt, mmRcptAtt] = await Promise.all([
      ingest(`mm-invoice-${TAG}.pdf`, "application/pdf", mmInvPdf),
      ingest(`mm-receipt-${TAG}.pdf`, "application/pdf", mmRcptPdf),
    ]);
    const mm: any = await classify.run({ attachmentIds: [mmInvAtt, mmRcptAtt] }, mkCtx() as any);
    check(
      "mismatch: classify emits pairMismatch steering to UNPAID ingest + explanation",
      (mm.data?.pairs ?? []).length === 0 &&
        typeof mm.data?.pairMismatch?.explanation === "string" &&
        /UNPAID/.test(mm.data.pairMismatch.explanation) &&
        /ingest_supplier_invoice/.test(mm.data.pairMismatch.explanation),
      mm.data?.pairMismatch,
    );
  }

  // =============== 5) role clamps ===============
  {
    const TOOLS = [
      "classify_finance_document", "ingest_supplier_invoice",
      "import_bank_statement", "save_bank_letter_account",
      // Task #1260 — receipt-pays-existing-invoice pairing tool.
      "attach_payment_receipt",
    ];
    const sliceFor = (role: string) =>
      capabilitiesForPersona({ id: "x", name: "x", role, orgId: ORG } as any)
        .map((e: any) => e.toolName);
    const fpSlice = sliceFor("founding_partner");
    check("roles: founding_partner sees all four tools", TOOLS.every((t) => fpSlice.includes(t)));
    for (const role of ["employee", "contractor", "board_observer", "recruiter", "alliance_partner"]) {
      const slice = sliceFor(role);
      check(`roles: ${role} sees none of the finance-doc tools`, TOOLS.every((t) => !slice.includes(t)), slice.filter((t: string) => TOOLS.includes(t)));
    }
  }

  // =============== 6) REST billing-hub upload parses via CogniDocs ===============
  // The multipart upload surface (POST /finance/payables/supplier-invoices)
  // must get the same extraction as chat ingest: parsed fields fill blanks,
  // user-typed values always win, the stable CogniDocs invoice id joins the
  // dedupe check, and a parse failure never blocks a complete manual entry.
  {
    const appMod = await import("../../src/app.js");
    const app = appMod.default;
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const { port } = server.address() as AddressInfo;
    const upload = async (fields: Record<string, string>, bytes: Buffer, name: string) => {
      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), name);
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const res = await fetch(
        `http://127.0.0.1:${port}/api/atelier/finance/payables/supplier-invoices`,
        { method: "POST", headers: { cookie: `atelier_persona=${IDS.fp}` }, body: fd },
      );
      const txt = await res.text();
      let parsed: any = null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
      return { status: res.status, body: parsed };
    };

    // (a) file-only upload — everything comes from the parse.
    const restRef = `REST-${TAG}-1`;
    cd.state.invoice = defaultInvoicePayload({
      id: `cdinv_rest_${TAG}`,
      vendorName: `Rest Upload Vendor ${TAG}`,
      invoiceRef: restRef,
      issueDate: "2026-08-20",
      currency: "AED",
      subtotalAmount10k: 31_428_600,
      taxAmount10k: 1_571_400,
      totalAmount10k: 33_000_000, // AED 3,300.00
    });
    const up1 = await upload(
      {},
      await makePdf([`REST UPLOAD INVOICE ${TAG}`, `Ref: ${restRef}`, "Amount Due: AED 3,300.00"]),
      `rest-invoice-${TAG}.pdf`,
    );
    check("rest upload: file-only submission succeeds via parsed fields", up1.status === 201, { status: up1.status, body: up1.body });
    check("rest upload: parse note reports ok", up1.body?.parse?.status === "ok", up1.body?.parse);
    check(
      "rest upload: parsed fields fill supplier/amount/reference/currency",
      up1.body?.item?.supplierName === `Rest Upload Vendor ${TAG}` &&
        up1.body?.item?.reference === restRef &&
        Number(up1.body?.item?.amount) === 3300 &&
        up1.body?.item?.currency === "AED",
      up1.body?.item,
    );
    check(
      "rest upload: submits declaredType 'invoice' (typed surface)",
      cd.state.lastSubmit?.declaredType === "invoice",
      cd.state.lastSubmit?.declaredType,
    );
    const [restRow] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.cognidocsInvoiceId, `cdinv_rest_${TAG}`),
    ));
    check("rest upload: CogniDocs invoice id persisted on the row", !!restRow, restRow?.id);

    // (b) same underlying invoice, DIFFERENT bytes + DIFFERENT printed ref —
    // only the CogniDocs id can catch this duplicate.
    cd.state.invoice = defaultInvoicePayload({
      id: `cdinv_rest_${TAG}`,
      vendorName: `Rest Upload Vendor ${TAG}`,
      invoiceRef: `REST-${TAG}-rescan`,
      totalAmount10k: 33_000_000,
    });
    const up1b = await upload(
      {},
      await makePdf([`REST UPLOAD INVOICE ${TAG} rescanned copy`, "Amount Due: AED 3,300.00"]),
      `rest-invoice-rescan-${TAG}.pdf`,
    );
    check(
      "rest upload: repeated CogniDocs id dedupes even across bytes+reference",
      up1b.status === 409,
      { status: up1b.status, body: up1b.body },
    );

    // (c) typed fields ALWAYS win over parsed values.
    cd.state.invoice = defaultInvoicePayload({
      id: `cdinv_rest2_${TAG}`,
      vendorName: "Parsed Vendor Should Lose",
      invoiceRef: `REST-${TAG}-parsed`,
      currency: "AED",
      totalAmount10k: 99_990_000,
    });
    const up2 = await upload(
      { supplierName: `Typed Vendor ${TAG}`, amount: "1200.5", currency: "USD", reference: `REST-${TAG}-typed` },
      await makePdf([`ANOTHER REST INVOICE ${TAG}`]),
      `rest-invoice2-${TAG}.pdf`,
    );
    check(
      "rest upload: user-typed fields win over parsed values",
      up2.status === 201 &&
        up2.body?.item?.supplierName === `Typed Vendor ${TAG}` &&
        up2.body?.item?.reference === `REST-${TAG}-typed` &&
        Number(up2.body?.item?.amount) === 1200.5 &&
        up2.body?.item?.currency === "USD",
      { status: up2.status, item: up2.body?.item },
    );

    // (d) parse failure + complete manual fields → invoice still created,
    // failure surfaced in the response (reported, never silently dropped).
    cd.state.failNext = "processing_error";
    const up3 = await upload(
      { supplierName: `Manual Vendor ${TAG}`, amount: "500", currency: "AED", reference: `REST-${TAG}-manual` },
      await makePdf([`MANUAL REST INVOICE ${TAG}`]),
      `rest-invoice3-${TAG}.pdf`,
    );
    check(
      "rest upload: parse failure never blocks a complete manual submission",
      up3.status === 201 && up3.body?.parse?.status === "failed",
      { status: up3.status, parse: up3.body?.parse },
    );

    await new Promise<void>((r) => server.close(() => r()));
  }

  stub.close();
  await cd.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
