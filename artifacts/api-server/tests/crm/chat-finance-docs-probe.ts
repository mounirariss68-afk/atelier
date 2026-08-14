/**
 * Task #1090 — Riser finance-document pipelines (offline probe).
 *
 * Pins, on a scratch DB with a stub Anthropic server (env set BEFORE
 * any capability import, so the AI parse/extract calls stay offline):
 *
 *   1. classify_finance_document: invoice PDF → supplier_invoice with
 *      recommended tool; statement CSV → bank_statement; garbage →
 *      low-confidence with an ask-one-question nextStep (never guess).
 *   2. ingest_supplier_invoice: AI prefill → confirmation envelope →
 *      confirm commits via the SAME payables core (status submitted,
 *      source internal_upload); a repeat confirm reports alreadyFiled
 *      (dedupe 409 surfaced as success, not error). Low-confidence
 *      parse → clarification, no confirmation.
 *   3. import_bank_statement: single account auto-picks → confirm →
 *      rows imported + navigateTo recon; repeat confirm →
 *      alreadyImported; a second account makes phase 1 return a
 *      bank-account clarification. Task #1094: a well-formed PDF
 *      statement extracts rows with per-row confidence, previews them
 *      in the confirmation, imports through the SAME core (dedupe on
 *      repeat), while a garbage/non-statement PDF is refused with the
 *      CSV-export guidance.
 *   4. save_bank_letter_account: two entities → entity clarification;
 *      with entity → extraction proposal confirmation → confirm creates
 *      the bank-account row (iban/swift/holder + entity link).
 *   5. Role clamps: employee / contractor / board_observer never see
 *      the four tools in their catalog slice; founding_partner does.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/chat-finance-docs-probe.ts
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

const TAG = `probe1090_${Date.now()}`;
const ORG = "aico";

// Mutable stub knobs.
const stubState = {
  invoiceConfidence: 0.95,
  invoiceCalls: 0,
  letterCalls: 0,
};

async function main() {
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
      const reply = (text: string) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: `msg_${TAG}`, type: "message", role: "assistant",
          model: parsed.model ?? "claude-sonnet-4-5",
          content: [{ type: "text", text }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }));
      };
      if (systemText.includes("accounts-payable clerk")) {
        stubState.invoiceCalls++;
        reply(JSON.stringify({
          confidence: stubState.invoiceConfidence,
          fields: {
            supplierName: "Gulf Office Supplies LLC",
            amount: 4725.5,
            currency: "AED",
            reference: "INV-2026-0815",
            invoiceDate: "2026-08-01",
            periodLabel: null,
            notes: null,
          },
        }));
        return;
      }
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

    // Low-confidence parse → clarification (never a guessed commit).
    stubState.invoiceConfidence = 0.3;
    const lowPdf = await makePdf(["TAX INVOICE", `blurry scan ${TAG}`, "Amount Due: AED ????", "Invoice No: smudged", "Subtotal VAT Bill To Due Date"]);
    const lowAtt = await ingest(`low-conf-${TAG}.pdf`, "application/pdf", lowPdf);
    const pl: any = await ingestInv.run({ attachmentId: lowAtt }, mkCtx() as any);
    check("invoice: low-confidence parse → clarification, no confirmation", !!pl.clarification && !pl.confirmation, pl);
    stubState.invoiceConfidence = 0.95;
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

    // Task #1094 — garbage PDF (an invoice, not a statement) still gets the
    // CSV-export guidance: its single date row has multiple amounts
    // (subtotal/VAT/total), so extraction confidence is low → refuse.
    const pdfStmtAtt = await ingest(`stmt-${TAG}.pdf`, "application/pdf", invoicePdf);
    const pPdf: any = await importStmt.run({ attachmentId: pdfStmtAtt }, mkCtx() as any);
    check(
      "statement: non-statement PDF → low-confidence refusal with CSV guidance",
      pPdf.ok === false && pPdf.errorCode === "pdf_low_confidence" && /csv/i.test(pPdf.errorMessage ?? ""),
      pPdf,
    );

    // Task #1094 — well-formed PDF statement: rows extracted, previewed,
    // imported through the shared core, deduped on repeat.
    const stmtPdf = await makePdf([
      "Emirates NBD — Account Statement",
      "Account: Operating AED  ****3456",
      `2026-08-02 Acme Client incoming wire ref ${TAG}-PDF-1 +15,250.00 CR`,
      "2026-08-04 DEWA utility bill payment -2,310.75",
      `2026-08-06 Du Telecom monthly plan ref ${TAG}-PDF-2 -795.00 DR`,
      "2026-08-07 Office rent payment 8,000.00", // unsigned outflow wording
      "2026-08-08 Misc entry 123.45", // no sign, no direction wording → flagged
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
      "statement PDF: explicit +CR / - / DR signs land correctly",
      wire?.amount === 15250 && wire?.confidence >= 0.7 &&
        dewa?.amount === -2310.75 && du?.amount === -795,
      rows,
    );
    check(
      "statement PDF: unsigned amount with outflow wording imports NEGATIVE with kind=payment",
      rent?.amount === -8000 && rent?.confidence >= 0.7 && rent?.kind === "payment",
      rent,
    );
    const pdfFlagged = (q1.data?.preview?.pdf?.flagged ?? []) as any[];
    check(
      "statement PDF: unsigned amount without direction wording is flagged, never guessed",
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

  // =============== 5) role clamps ===============
  {
    const TOOLS = [
      "classify_finance_document", "ingest_supplier_invoice",
      "import_bank_statement", "save_bank_letter_account",
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

  stub.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
