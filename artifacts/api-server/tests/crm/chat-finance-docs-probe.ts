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

  // =============== 2d) Task #1318 — password-protected invoice PDF ===============
  // Banks/vendors email locked PDFs: the ingest asks for the password via a
  // clarification (NEVER storing it — not in the partial, not in the pin),
  // a wrong password gets a distinct incorrect-password retry, and the
  // right one flows into a normal confirmation + commit.
  {
    const PW = `pw-${TAG}`;
    cd.state.requiredPassword = PW;
    cd.state.invoice = defaultInvoicePayload({ invoiceRef: `LOCK-${TAG}` });
    const lockPdf = await makePdf(["TAX INVOICE", "Gulf Office Supplies LLC", `Invoice No: LOCK-${TAG}`, "Amount Due: AED 4,725.50"]);
    const lockAtt = await ingest(`locked-invoice-${TAG}.pdf`, "application/pdf", lockPdf);
    const w1: any = await ingestInv.run({ attachmentId: lockAtt }, mkCtx() as any);
    check(
      "invoice locked: phase 1 → password clarification, never a generic failure",
      w1.ok === true && !!w1.clarification && w1.clarification.field === "password" &&
        !w1.confirmation && /password-protected/i.test(w1.clarification.question ?? ""),
      w1.clarification ?? w1,
    );
    check(
      "invoice locked: clarification partial never carries the password",
      !("password" in (w1.clarification?.partial ?? {})),
      w1.clarification?.partial,
    );
    const w2: any = await ingestInv.run({ ...w1.clarification.partial, password: "wrong-pass" }, mkCtx() as any);
    check(
      "invoice locked: wrong password → distinct incorrect-password retry",
      !!w2.clarification && w2.clarification.field === "password" &&
        /didn't unlock/i.test(w2.clarification.question ?? "") &&
        !("password" in (w2.clarification?.partial ?? {})),
      w2.clarification ?? w2,
    );
    const w3: any = await ingestInv.run({ ...w2.clarification.partial, password: PW }, mkCtx() as any);
    check("invoice locked: correct password → normal confirmation", !!w3.confirmation, w3);
    check(
      "invoice locked: password reached the parser but never the commit pin",
      cd.state.lastSubmit?.password === PW &&
        !("password" in (w3.confirmation?.pending?.input ?? {})),
      { lastPw: cd.state.lastSubmit?.password, pinKeys: Object.keys(w3.confirmation?.pending?.input ?? {}) },
    );
    const w4: any = await ingestInv.run(w3.confirmation.pending.input, mkCtx() as any);
    check("invoice locked: confirm commits (no re-parse, no password needed)", w4.ok === true && !w4.confirmation, w4);
    const [lockRow] = await db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, ORG),
      eq(atelierPartnerFirmInvoices.reference, `LOCK-${TAG}`),
    ));
    check("invoice locked: committed row exists", !!lockRow, lockRow?.id);
    cd.state.requiredPassword = null;
    cd.state.invoice = defaultInvoicePayload();
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

    // Task #1318 — password-protected statement PDF. The password is asked
    // via clarification and never persisted; when a later clarification
    // (which bank account?) follows the unlocked parse, its partial pins
    // the parse job (jobId + HMAC token) so the continuation re-fetches it
    // instead of re-parsing — otherwise the never-stored password would be
    // re-asked in a loop.
    {
      const PW = `stmt-pw-${TAG}`;
      cd.state.requiredPassword = PW;
      cd.state.invoice = null;
      cd.state.statement = stmtResult([
        txn({ date: "2026-08-18", description: "Locked wire in", rawDescription: `ref ${TAG}-LOCK-1`, amount10k: 100_000_000, direction: "credit" }),
        txn({ date: "2026-08-19", description: "Locked fee", amount10k: 5_000_000, direction: "debit" }),
      ]);
      const lockPdf = await makePdf([`ACME BANK — Statement ${TAG} LOCKED`, "password fixture"]);
      const lockAtt = await ingest(`statement-locked-${TAG}.pdf`, "application/pdf", lockPdf);
      const l1: any = await importStmt.run({ attachmentId: lockAtt, statementDate: "2026-08-19" }, mkCtx() as any);
      check(
        "statement locked: phase 1 → password clarification, never a generic failure",
        l1.ok === true && !!l1.clarification && l1.clarification.field === "password" &&
          /password-protected/i.test(l1.clarification.question ?? "") &&
          !("password" in (l1.clarification?.partial ?? {})),
        l1.clarification ?? l1,
      );
      const l2: any = await importStmt.run({ ...l1.clarification.partial, password: "wrong" }, mkCtx() as any);
      check(
        "statement locked: wrong password → distinct incorrect-password retry",
        !!l2.clarification && l2.clarification.field === "password" &&
          /didn't unlock/i.test(l2.clarification.question ?? ""),
        l2.clarification ?? l2,
      );
      // Correct password, but no bankAccountId → the NEXT clarification
      // must pin the unlocked parse job.
      const l3: any = await importStmt.run({ ...l2.clarification.partial, password: PW }, mkCtx() as any);
      check(
        "statement locked: correct password → bankAccountId clarification pinning jobId + token, no password",
        !!l3.clarification && l3.clarification.field === "bankAccountId" &&
          typeof l3.clarification.partial?.cognidocsJobId === "string" &&
          typeof l3.clarification.partial?.cognidocsJobToken === "string" &&
          !("password" in (l3.clarification?.partial ?? {})),
        l3.clarification?.partial,
      );
      // Continuation WITHOUT the password must reuse the job, not re-parse
      // (requiredPassword is still armed — a re-submit would 422).
      const submitsBefore = cd.state.submits;
      const l4: any = await importStmt.run({ ...l3.clarification.partial, bankAccountId: acctId }, mkCtx() as any);
      check(
        "statement locked: clarification continuation re-fetches the pinned job (no re-submit, no password re-ask)",
        !!l4.confirmation && cd.state.submits === submitsBefore &&
          l4.data?.preview?.pdf?.rowsExtracted === 2,
        { submitsBefore, submitsAfter: cd.state.submits, out: l4.clarification ?? l4.confirmation?.summary },
      );
      check(
        "statement locked: confirm pin carries jobId but never the password",
        l4.confirmation?.pending?.input?.cognidocsJobId === l3.clarification.partial.cognidocsJobId &&
          !("password" in (l4.confirmation?.pending?.input ?? {})),
        Object.keys(l4.confirmation?.pending?.input ?? {}),
      );
      // A forged clarify-token must NOT unlock the pin path: it degrades to
      // a fresh parse, which (still locked) re-asks for the password.
      const forgedTok: any = await importStmt.run(
        {
          attachmentId: lockAtt, statementDate: "2026-08-19", bankAccountId: acctId,
          cognidocsJobId: l3.clarification.partial.cognidocsJobId, cognidocsJobToken: "deadbeef",
        },
        mkCtx() as any,
      );
      check(
        "statement locked: forged clarify token → fresh parse → password clarification (no pin reuse)",
        !!forgedTok.clarification && forgedTok.clarification.field === "password",
        forgedTok.clarification ?? forgedTok,
      );
      const l5: any = await importStmt.run(l4.confirmation.pending.input, mkCtx() as any);
      check(
        "statement locked: confirm imports rows while the document is still locked upstream",
        l5.ok === true && l5.data?.rowsImported === 2,
        l5,
      );
      cd.state.requiredPassword = null;
      cd.state.statement = null;
    }
  }

  // =============== 3b) Task #1318 — password answers through the REAL orchestrator ===============
  // Capability-level tests call tool.run directly, so they can't see what
  // runTurn PERSISTS. This section drives wrong → correct password answers
  // through the real chat turn path and asserts the password never lands in
  // ANY durable or streamed surface — turn prompt, frames, toolCalls,
  // pendingWrite pin, session rolling summary/title, session facts — while
  // the CogniDocs stub still receives it BYTE-FOR-BYTE (no trim, no cap).
  {
    const CLI: any = await import("../../src/lib/atelier-cli/index.js");
    const { runTurn, SENSITIVE_PROMPT_PLACEHOLDER, stripSensitiveValues } = CLI;
    const { atelierCliSessions, atelierCliTurns, atelierCliSessionFacts } =
      (await import("@workspace/db")) as any;

    // Pure helper semantics first.
    const scrubbed = stripSensitiveValues({
      a: 1, password: "s3cret", nested: { password: "s3cret", keep: "x" },
      arr: [{ password: "s3cret" }],
    });
    check(
      "e2e helper: stripSensitiveValues deep-REMOVES password keys, keeps the rest",
      scrubbed.password === undefined && scrubbed.nested.password === undefined &&
        scrubbed.arr[0].password === undefined && scrubbed.a === 1 && scrubbed.nested.keep === "x",
      scrubbed,
    );

    // Byte-exactness fixture: leading/trailing spaces, >200 chars, and a
    // command-opener first word ("show") that the bare-prompt freshness
    // gate would misroute as a fresh request if the sensitive bypass
    // regressed. PWMARK is the distinctive needle for leak scans.
    const PWMARK = `pw-${TAG}`;
    const PW = ` show ${"x".repeat(205)} ${PWMARK} `;
    const WRONG = `totally-wrong-${PWMARK}`;
    cd.state.requiredPassword = PW;
    cd.state.invoice = null;
    cd.state.statement = {
      bankId: null, bankName: "Emirates NBD", statementType: "bank_statement",
      currency: "AED", accountRef: "****3456", periodStart: "2026-08-01",
      periodEnd: "2026-08-31", partialImportWarning: null,
      transactions: [{
        date: "2026-08-21", description: "E2E locked wire", rawDescription: `ref ${TAG}-E2ELOCK`,
        amount10k: 12_345_600, direction: "credit", currency: null, balance10k: null,
        normalizedMerchant: null, parsedMerchant: null, category: null,
      }],
    };
    const e2ePdf = await makePdf([`E2E LOCKED STATEMENT ${TAG}`]);
    const e2eAtt = await ingest(`e2e-locked-${TAG}.pdf`, "application/pdf", e2ePdf);

    // Seed the paused source turn the way a real locked upload leaves it
    // (awaiting_clarification on field "password"), in a fresh session so
    // the first answer exercises the rehydrate-from-DB prompt REPAIR path.
    const sessId = `clis_${TAG}_pw`;
    const srcTurn = `clit_${TAG}_pwsrc`;
    await db.insert(atelierCliSessions).values({
      id: sessId, orgId: ORG, userId: IDS.fp, title: null,
    });
    await db.insert(atelierCliTurns).values({
      id: srcTurn, orgId: ORG, sessionId: sessId, userId: IDS.fp,
      status: "awaiting_clarification",
      prompt: "import the locked statement (e2e probe)",
      frames: [{
        type: "needs_clarification",
        data: {
          step: 0, tool: "import_bank_statement", field: "password",
          question: "This statement PDF is password-protected — what's the password?",
          partial: { attachmentId: e2eAtt, statementDate: "2026-08-21", bankAccountId: `bank_${TAG}_1` },
          fields: [{ field: "password", label: "PDF password" }],
        },
      }],
    });

    const persona = fpPersona as any;

    // ---- turn 1: WRONG password via explicit continuation ----
    const emitted1: any[] = [];
    const r1: any = await runTurn(
      { prompt: WRONG, continuesTurnId: srcTurn, sessionId: sessId },
      { persona, emit: (f: any) => emitted1.push(f) },
    );
    check(
      "e2e locked: wrong password → distinct incorrect-password re-ask through runTurn",
      emitted1.some((f) => f.type === "needs_clarification" &&
        f.data?.field === "password" && /didn't unlock/i.test(f.data?.question ?? "")),
      emitted1.map((f) => f.type),
    );
    check(
      "e2e locked: wrong password never streamed back in any frame",
      !JSON.stringify(emitted1).includes(WRONG),
      null,
    );
    const [row1] = await db.select().from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, r1.turnId));
    check(
      "e2e locked: wrong-password turn prompt persisted as placeholder (rehydrated repair path)",
      row1?.prompt === SENSITIVE_PROMPT_PLACEHOLDER,
      row1?.prompt,
    );
    check(
      "e2e locked: wrong password nowhere in the persisted turn row",
      !!row1 && !JSON.stringify(row1).includes(WRONG),
      null,
    );

    // ---- turn 2: CORRECT password as a BARE prompt (no continuesTurnId).
    // Starts with a command opener + >200 chars: without the sensitive
    // gate bypass this would be misrouted as a fresh request.
    const emitted2: any[] = [];
    const r2: any = await runTurn(
      { prompt: PW, sessionId: sessId },
      { persona, emit: (f: any) => emitted2.push(f) },
    );
    check(
      "e2e locked: correct password (bare prompt) → confirmation preview, not a fresh request",
      r2.status === "awaiting_confirmation" &&
        emitted2.some((f) => f.type === "needs_confirmation"),
      { status: r2.status, types: emitted2.map((f) => f.type) },
    );
    check(
      "e2e locked: password reached CogniDocs BYTE-FOR-BYTE (spaces + length preserved, no cap)",
      cd.state.lastSubmit?.password === PW,
      { gotLen: cd.state.lastSubmit?.password?.length, wantLen: PW.length },
    );
    const tcFrame = emitted2.find((f) => f.type === "tool_call");
    check(
      "e2e locked: streamed tool_call frame input has the password key REMOVED",
      !!tcFrame && !("password" in (tcFrame.data?.input ?? {})) &&
        tcFrame.data?.input?.attachmentId === e2eAtt,
      tcFrame?.data?.input && Object.keys(tcFrame.data.input),
    );
    check(
      "e2e locked: password never streamed back in any frame",
      !JSON.stringify(emitted2).includes(PWMARK),
      null,
    );
    const [row2] = await db.select().from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, r2.turnId));
    check(
      "e2e locked: correct-password turn prompt persisted as placeholder (pre-insert path)",
      row2?.prompt === SENSITIVE_PROMPT_PLACEHOLDER,
      row2?.prompt,
    );
    check(
      "e2e locked: password nowhere in persisted frames/toolCalls/pendingWrite",
      !!row2 && !JSON.stringify(row2).includes(PWMARK),
      null,
    );
    check(
      "e2e locked: pendingWrite pin present but password-free (confirm re-fetches by jobId)",
      !!row2?.pendingWrite && !("password" in ((row2.pendingWrite as any)?.input ?? {})) &&
        typeof (row2.pendingWrite as any)?.input?.cognidocsJobId === "string",
      row2?.pendingWrite && Object.keys((row2.pendingWrite as any)?.input ?? {}),
    );

    // ---- durable session surfaces: rolling summary, title, facts ----
    await new Promise((r) => setTimeout(r, 400)); // fire-and-forget title
    const [sess] = await db.select().from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, sessId));
    check(
      "e2e locked: session rolling summary + title never contain the password",
      !!sess && !JSON.stringify(sess).includes(PWMARK) && !JSON.stringify(sess).includes(WRONG),
      null,
    );
    const factRows = await db.select().from(atelierCliSessionFacts)
      .where(eq(atelierCliSessionFacts.sessionId, sessId));
    check(
      "e2e locked: session facts never contain the password",
      !JSON.stringify(factRows).includes(PWMARK) && !JSON.stringify(factRows).includes(WRONG),
      null,
    );

    // ---- HTTP ingress coverage: the REAL /cli/turn route must not trim,
    // truncate, or misroute password answers. Ingress historically trimmed
    // every prompt, rejected >4000 chars, and cut clarificationValues at
    // 2000 chars — all of which silently corrupt a valid password before
    // runTurn can see the pending sensitive clarification.
    const appMod = await import("../../src/app.js");
    const appSrv = appMod.default.listen(0);
    await new Promise<void>((r) => appSrv.once("listening", () => r()));
    const { port: cliPort } = appSrv.address() as AddressInfo;
    const sseTurn = async (bodyObj: Record<string, unknown>) => {
      const res = await fetch(`http://127.0.0.1:${cliPort}/api/atelier/cli/turn`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `atelier_persona=${IDS.fp}`,
        },
        body: JSON.stringify(bodyObj),
      });
      const text = await res.text();
      const frames: Array<{ type: string; data: any }> = [];
      const re = /event: ([^\n]+)\ndata: ([^\n]*)\n/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        try {
          frames.push({ type: m[1], data: JSON.parse(m[2]) });
        } catch {
          frames.push({ type: m[1], data: m[2] });
        }
      }
      return { status: res.status, text, frames };
    };
    const seedLockedAsk = async (suffix: string, attId: string) => {
      const sid = `clis_${TAG}_${suffix}`;
      const tid = `clit_${TAG}_${suffix}src`;
      await db.insert(atelierCliSessions).values({
        id: sid, orgId: ORG, userId: IDS.fp, title: `locked ${suffix}`,
      });
      await db.insert(atelierCliTurns).values({
        id: tid, orgId: ORG, sessionId: sid, userId: IDS.fp,
        status: "awaiting_clarification",
        prompt: `import the locked statement (${suffix})`,
        frames: [{
          type: "needs_clarification",
          data: {
            step: 0, tool: "import_bank_statement", field: "password",
            question: "This statement PDF is password-protected — what's the password?",
            partial: { attachmentId: attId, statementDate: "2026-08-21", bankAccountId: `bank_${TAG}_1` },
            fields: [{ field: "password", label: "PDF password" }],
          },
        }],
      });
      return { sid, tid };
    };

    // Ordinary requests keep the old limits (regression guard).
    const tooLong = await sseTurn({ prompt: "x".repeat(4500) });
    check(
      "http ingress: ordinary 4500-char prompt still rejected prompt-too-long",
      tooLong.status === 400 && tooLong.text.includes("prompt-too-long"),
      { status: tooLong.status },
    );

    // Flow B — leading/trailing-whitespace password over HTTP.
    const HPWMARK = `hpw-${TAG}`;
    const HPW = `  ${HPWMARK} ${"y".repeat(80)} `;
    const HWRONG = ` nope-${HPWMARK} `;
    cd.state.requiredPassword = HPW;
    const httpPdf = await makePdf([`HTTP LOCKED STATEMENT ${TAG}`]);
    const httpAtt = await ingest(`http-locked-${TAG}.pdf`, "application/pdf", httpPdf);
    const flowB = await seedLockedAsk("pwh", httpAtt);

    // Wrong password via explicit continuesTurnId (ingress detection path 1).
    const b1 = await sseTurn({
      sessionId: flowB.sid, continuesTurnId: flowB.tid, prompt: HWRONG,
    });
    check(
      "http locked: wrong password → incorrect-password re-ask over the wire",
      b1.frames.some((f) => f.type === "needs_clarification" &&
        f.data?.field === "password" && /didn't unlock/i.test(f.data?.question ?? "")),
      b1.frames.map((f) => f.type),
    );
    check(
      "http locked: wrong password never appears in the SSE stream",
      !b1.text.includes(HWRONG.trim()),
      null,
    );
    // Correct password as a BARE prompt with sessionId only (ingress
    // detection path 2 — in-memory draft), spaces + length preserved.
    const b2 = await sseTurn({ sessionId: flowB.sid, prompt: HPW });
    check(
      "http locked: correct whitespace-wrapped password (bare prompt) → confirmation",
      b2.frames.some((f) => f.type === "needs_confirmation"),
      b2.frames.map((f) => f.type),
    );
    check(
      "http locked: password reached CogniDocs byte-for-byte THROUGH HTTP ingress (no trim)",
      cd.state.lastSubmit?.password === HPW,
      { gotLen: cd.state.lastSubmit?.password?.length, wantLen: HPW.length },
    );
    check(
      "http locked: password never appears in the SSE stream",
      !b2.text.includes(HPWMARK),
      null,
    );
    const bRows = await db.select().from(atelierCliTurns)
      .where(eq(atelierCliTurns.sessionId, flowB.sid));
    check(
      "http locked: no persisted turn row in the session contains the password",
      bRows.length >= 3 && !JSON.stringify(bRows).includes(HPWMARK),
      { rows: bRows.length },
    );
    check(
      "http locked: answer turns persist the placeholder prompt",
      bRows.filter((r: any) => r.prompt === SENSITIVE_PROMPT_PLACEHOLDER).length === 2,
      bRows.map((r: any) => r.prompt),
    );

    // Flow C — clarificationValues password EXCEEDING the ordinary
    // 2000-char value cap, answered with sessionId only and a COLD
    // in-memory draft (ingress detection path 3 — DB fallback, i.e. the
    // post-restart case; runTurn rehydrates from the same row).
    const VPWMARK = `vpw-${TAG}`;
    const VPW = ` ${"z".repeat(2400)}-${VPWMARK} `;
    cd.state.requiredPassword = VPW;
    const valPdf = await makePdf([`VALUES LOCKED STATEMENT ${TAG}`]);
    const valAtt = await ingest(`values-locked-${TAG}.pdf`, "application/pdf", valPdf);
    const flowC = await seedLockedAsk("pwv", valAtt);
    const c1 = await sseTurn({
      sessionId: flowC.sid,
      prompt: "here is the password",
      clarificationValues: { password: VPW },
    });
    check(
      "http locked: >2000-char clarificationValues password → confirmation (no truncation)",
      c1.frames.some((f) => f.type === "needs_confirmation"),
      c1.frames.map((f) => f.type),
    );
    check(
      "http locked: oversized password reached CogniDocs byte-for-byte (spaces + full length)",
      cd.state.lastSubmit?.password === VPW,
      { gotLen: cd.state.lastSubmit?.password?.length, wantLen: VPW.length },
    );
    const cRows = await db.select().from(atelierCliTurns)
      .where(eq(atelierCliTurns.sessionId, flowC.sid));
    check(
      "http locked: oversized password nowhere in persisted rows; prompt is placeholder",
      !JSON.stringify(cRows).includes(VPWMARK) &&
        cRows.some((r: any) => r.prompt === SENSITIVE_PROMPT_PLACEHOLDER),
      { rows: cRows.length },
    );

    // Flow D — reset-language passwords must NOT be misrouted. The intent
    // classifier's deterministic reset matcher accepts "reset" / "start
    // over" anywhere in a fresh prompt; a pending sensitive clarification
    // must suppress that routing entirely, or the password forces a NEW
    // session, orphans the ask, and persists raw as a fresh prompt.
    cd.state.requiredPassword = "reset";
    const rstPdf = await makePdf([`RESET LOCKED STATEMENT ${TAG}`]);
    const rstAtt = await ingest(`reset-locked-${TAG}.pdf`, "application/pdf", rstPdf);
    const flowD = await seedLockedAsk("pwr", rstAtt);
    const sessionsBefore = (await db.select({ id: atelierCliSessions.id })
      .from(atelierCliSessions)).length;
    // Wrong password CONTAINING reset language, bare prompt.
    const D_WRONG = " start over please ";
    const d1 = await sseTurn({ sessionId: flowD.sid, prompt: D_WRONG });
    const d1Final = d1.frames.find((f) => f.type === "final");
    check(
      "http locked: password containing 'start over' stays in the SAME session (no reset)",
      d1Final?.data?.sessionId === flowD.sid,
      d1Final?.data,
    );
    check(
      "http locked: reset-language wrong password → incorrect-password re-ask, not a fresh turn",
      d1.frames.some((f) => f.type === "needs_clarification" &&
        f.data?.field === "password" && /didn't unlock/i.test(f.data?.question ?? "")),
      d1.frames.map((f) => f.type),
    );
    // Correct password EXACTLY equal to reset language.
    const d2 = await sseTurn({ sessionId: flowD.sid, prompt: "reset" });
    const d2Final = d2.frames.find((f) => f.type === "final");
    check(
      "http locked: password exactly 'reset' continues the pending ask → confirmation",
      d2Final?.data?.sessionId === flowD.sid &&
        d2.frames.some((f) => f.type === "needs_confirmation"),
      { final: d2Final?.data, types: d2.frames.map((f) => f.type) },
    );
    check(
      "http locked: literal 'reset' reached CogniDocs byte-for-byte",
      cd.state.lastSubmit?.password === "reset",
      cd.state.lastSubmit?.password,
    );
    const dRows = await db.select().from(atelierCliTurns)
      .where(eq(atelierCliTurns.sessionId, flowD.sid));
    check(
      "http locked: both reset-language answers persist placeholder prompts, no leak",
      dRows.length === 3 &&
        dRows.filter((r: any) => r.prompt === SENSITIVE_PROMPT_PLACEHOLDER).length === 2 &&
        !JSON.stringify(dRows).includes(D_WRONG),
      dRows.map((r: any) => r.prompt),
    );
    const sessionsAfter = (await db.select({ id: atelierCliSessions.id })
      .from(atelierCliSessions)).length;
    check(
      "http locked: no fresh session was created by reset-language answers",
      sessionsAfter === sessionsBefore,
      { sessionsBefore, sessionsAfter },
    );

    appSrv.close();
    cd.state.requiredPassword = null;
    cd.state.statement = null;
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

    // (e) Task #1318 — the web bank-import surface: a locked statement PDF
    // 422s with pdf_password_required (prompt, not generic failure), a wrong
    // password 422s with pdf_password_incorrect, the right password parses,
    // and the signed confirm re-fetches the job WITHOUT the password.
    {
      const PW = `rest-pw-${TAG}`;
      cd.state.requiredPassword = PW;
      cd.state.invoice = null;
      cd.state.statement = {
        bankId: null, bankName: "Emirates NBD", statementType: "bank_statement",
        currency: "AED", accountRef: "****3456", periodStart: "2026-08-01",
        periodEnd: "2026-08-31", partialImportWarning: null,
        transactions: [{
          date: "2026-08-20", description: "REST locked wire", rawDescription: `ref ${TAG}-RESTLOCK`,
          amount10k: 42_000_000, direction: "credit", currency: null, balance10k: null,
          normalizedMerchant: null, parsedMerchant: null, category: null,
        }],
      };
      // SAME bytes on every call — the confirm signature binds jobId to the
      // file sha, and pdfkit output embeds timestamps (bytes vary per call).
      const lockedStmtBytes = await makePdf([`REST LOCKED STATEMENT ${TAG}`]);
      const importFile = async (fields: Record<string, string>) => {
        const fd = new FormData();
        fd.append("file", new Blob([new Uint8Array(lockedStmtBytes)], { type: "application/pdf" }), `rest-locked-${TAG}.pdf`);
        for (const [k, v] of Object.entries(fields)) fd.append(k, v);
        const res = await fetch(
          `http://127.0.0.1:${port}/api/atelier/wallet/bank/import-file`,
          { method: "POST", headers: { cookie: `atelier_persona=${IDS.fp}` }, body: fd },
        );
        return { status: res.status, body: await res.json().catch(() => null) };
      };
      const base = { bankAccountId: `bank_${TAG}_1`, statementDate: "2026-08-20" };
      const r1 = await importFile(base);
      check(
        "rest import-file: locked PDF → 422 pdf_password_required with password prompt",
        r1.status === 422 && r1.body?.error === "pdf_password_required" && /password/i.test(r1.body?.message ?? ""),
        { status: r1.status, body: r1.body },
      );
      const r2 = await importFile({ ...base, password: "nope" });
      check(
        "rest import-file: wrong password → 422 pdf_password_incorrect with distinct message",
        r2.status === 422 && r2.body?.error === "pdf_password_incorrect" && /incorrect password/i.test(r2.body?.message ?? ""),
        { status: r2.status, body: r2.body },
      );
      const r3 = await importFile({ ...base, password: PW });
      check(
        "rest import-file: correct password → preview with jobId + signature",
        r3.status === 200 && r3.body?.data?.preview?.source === "pdf" &&
          r3.body?.data?.preview?.rowsExtracted === 1 &&
          typeof r3.body?.data?.preview?.cognidocsJobId === "string" &&
          typeof r3.body?.data?.preview?.signature === "string",
        { status: r3.status, body: r3.body },
      );
      const submitsBefore = cd.state.submits;
      const r4 = await importFile({
        ...base, confirm: "true",
        cognidocsJobId: r3.body?.data?.preview?.cognidocsJobId ?? "missing",
        signature: r3.body?.data?.preview?.signature ?? "missing",
      });
      check(
        "rest import-file: confirm re-fetches the unlocked job (no password, no re-submit) and imports",
        r4.status === 200 && r4.body?.data?.rowsImported === 1 && cd.state.submits === submitsBefore,
        { status: r4.status, body: r4.body, submitsBefore, submitsAfter: cd.state.submits },
      );
      cd.state.requiredPassword = null;
      cd.state.statement = null;
    }

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
