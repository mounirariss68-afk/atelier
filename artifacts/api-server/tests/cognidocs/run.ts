/**
 * Task #1316 — CogniDocs client + converter contract probe (offline).
 *
 * Pure/offline checks (no DB, no network beyond localhost stubs):
 *   1. Key selection: dev prefers the sandbox key, falls back to the main
 *      key; production (REPLIT_DEPLOYMENT) uses ONLY the main key; neither
 *      → not-configured (loud).
 *   2. Submit guards: empty file, >20MB, unsupported media (GIF) all
 *      throw typed errors BEFORE any network call.
 *   3. HTTP error mapping: 401/403 → auth, 413 → file-too-large,
 *      pdf_password_required passthrough, 5xx → request-failed.
 *   4. Client flow against the shared stub: queued job polls to
 *      completion; failed job → parse-failed; tiny timeout → timeout;
 *      getCognidocsJob(id) replays the SAME result after state changes
 *      (the preview→confirm determinism mechanism).
 *   5. Converters: ×10,000 integer → major-unit mapping; statement sign
 *      comes ONLY from the explicit direction field (direction-less rows
 *      flagged, never guessed); confidence formula; invoice line-item cap
 *      + reconciliation warning; receipt unreadable rule.
 *
 * Run: pnpm --filter @workspace/api-server run test:cognidocs
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startCognidocsStub, defaultInvoicePayload } from "../helpers/cognidocs-stub.js";
import {
  CognidocsError,
  COGNIDOCS_MAX_FILE_BYTES,
  cognidocsConfigured,
  submitCognidocsDocument,
  parseCognidocsDocument,
  getCognidocsJob,
  waitForCognidocsJob,
} from "../../src/lib/cognidocs/client.js";
import {
  receiptExtractionFromJob,
  statementRowsFromJob,
  supplierFieldsFromJob,
} from "../../src/lib/cognidocs/convert.js";
import type { CognidocsParseJob } from "../../src/lib/cognidocs/types.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function expectError(fn: () => Promise<unknown>): Promise<CognidocsError | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof CognidocsError ? err : null;
  }
}

const PDF = Buffer.from("%PDF-1.4 probe");

function completedJob(overrides: Partial<CognidocsParseJob>): CognidocsParseJob {
  return {
    id: "cdj_local",
    status: "completed",
    declaredType: "auto",
    detectedType: null,
    confidence: 95,
    error: null,
    result: { documentType: null, parserPath: null, confidence: null, statement: null, invoice: null },
    ...overrides,
  };
}

async function main() {
  // =============== 1) key selection ===============
  {
    const saved = {
      main: process.env.COGNIDOCS_API_KEY,
      sandbox: process.env.COGNIDOCS_SANDBOX_API_KEY,
      deploy: process.env.REPLIT_DEPLOYMENT,
    };
    delete process.env.COGNIDOCS_API_KEY;
    delete process.env.COGNIDOCS_SANDBOX_API_KEY;
    delete process.env.REPLIT_DEPLOYMENT;
    check("keys: neither present → not configured", cognidocsConfigured() === false);
    const noKey = await expectError(() =>
      submitCognidocsDocument({ bytes: PDF, fileName: "x.pdf", mimeType: "application/pdf", declaredType: "auto" }),
    );
    check("keys: unconfigured submit throws not-configured", noKey?.code === "not-configured", noKey);

    process.env.COGNIDOCS_SANDBOX_API_KEY = "sb_key";
    check("keys: sandbox key alone configures dev", cognidocsConfigured() === true);
    process.env.REPLIT_DEPLOYMENT = "1";
    check(
      "keys: production ignores the sandbox key (main key required)",
      cognidocsConfigured() === false,
    );
    process.env.COGNIDOCS_API_KEY = "main_key";
    check("keys: production with main key configures", cognidocsConfigured() === true);
    delete process.env.REPLIT_DEPLOYMENT;

    process.env.COGNIDOCS_API_KEY = saved.main ?? "";
    if (!saved.main) delete process.env.COGNIDOCS_API_KEY;
    process.env.COGNIDOCS_SANDBOX_API_KEY = saved.sandbox ?? "";
    if (!saved.sandbox) delete process.env.COGNIDOCS_SANDBOX_API_KEY;
    if (saved.deploy) process.env.REPLIT_DEPLOYMENT = saved.deploy;
  }

  // Shared stub for the client-path sections (sets base URL + sandbox key).
  const cd = await startCognidocsStub();
  cd.state.invoice = defaultInvoicePayload();

  // =============== 2) submit guards (no network) ===============
  {
    const before = cd.state.submits;
    const empty = await expectError(() =>
      submitCognidocsDocument({ bytes: Buffer.alloc(0), fileName: "x.pdf", mimeType: "application/pdf", declaredType: "auto" }),
    );
    check("guards: empty file → request-failed", empty?.code === "request-failed", empty);
    const huge = await expectError(() =>
      submitCognidocsDocument({
        bytes: Buffer.alloc(COGNIDOCS_MAX_FILE_BYTES + 1),
        fileName: "big.pdf",
        mimeType: "application/pdf",
        declaredType: "auto",
      }),
    );
    check("guards: >20MB → file-too-large", huge?.code === "file-too-large", huge);
    const gif = await expectError(() =>
      submitCognidocsDocument({ bytes: PDF, fileName: "x.gif", mimeType: "image/gif", declaredType: "auto" }),
    );
    check("guards: GIF → unsupported-media-type", gif?.code === "unsupported-media-type", gif);
    check("guards: no guard reached the network", cd.state.submits === before, cd.state.submits);
  }

  // =============== 3) HTTP error mapping (dedicated status server) ===============
  {
    let respond: { status: number; body: Record<string, unknown> } = { status: 500, body: {} };
    const errSrv = createServer((_req, res) => {
      res.writeHead(respond.status, { "content-type": "application/json" });
      res.end(JSON.stringify(respond.body));
    });
    await new Promise<void>((r) => errSrv.listen(0, "127.0.0.1", r));
    const savedBase = process.env.COGNIDOCS_BASE_URL;
    process.env.COGNIDOCS_BASE_URL = `http://127.0.0.1:${(errSrv.address() as AddressInfo).port}`;

    const submit = () =>
      submitCognidocsDocument({ bytes: PDF, fileName: "x.pdf", mimeType: "application/pdf", declaredType: "auto" });
    respond = { status: 401, body: { error: "bad key" } };
    check("http: 401 → auth", (await expectError(submit))?.code === "auth");
    respond = { status: 403, body: { error: "forbidden" } };
    check("http: 403 → auth", (await expectError(submit))?.code === "auth");
    respond = { status: 413, body: { error: "too large" } };
    check("http: 413 → file-too-large", (await expectError(submit))?.code === "file-too-large");
    respond = { status: 422, body: { code: "pdf_password_required", error: "locked" } };
    const locked = await expectError(submit);
    check("http: pdf_password_required passes through", locked?.code === "pdf_password_required", locked);
    respond = { status: 500, body: { error: "boom" } };
    check("http: 5xx → request-failed", (await expectError(submit))?.code === "request-failed");

    process.env.COGNIDOCS_BASE_URL = savedBase!;
    await new Promise<void>((r) => errSrv.close(() => r()));
  }

  // =============== 4) client flow against the stub ===============
  {
    // Queued job polls to completion.
    cd.state.pendingPolls = 1;
    const before = cd.state.jobGets;
    const polled = await parseCognidocsDocument({
      bytes: PDF, fileName: "poll.pdf", mimeType: "application/pdf", declaredType: "auto",
    });
    check(
      "client: queued job polls to completed",
      polled.status === "completed" && cd.state.jobGets > before,
      { status: polled.status, gets: cd.state.jobGets - before },
    );
    check(
      "client: submit carries fileName/mime/declaredType",
      cd.state.lastSubmit?.fileName === "poll.pdf" &&
        cd.state.lastSubmit?.mimeType === "application/pdf" &&
        cd.state.lastSubmit?.declaredType === "auto",
      cd.state.lastSubmit,
    );

    // Failed job → typed parse-failed.
    cd.state.failNext = "scan unreadable";
    const failed = await expectError(() =>
      parseCognidocsDocument({ bytes: PDF, fileName: "bad.pdf", mimeType: "application/pdf", declaredType: "auto" }),
    );
    check("client: failed job → parse-failed", failed?.code === "parse-failed", failed);

    // Tiny timeout on a never-completing job → timeout error.
    cd.state.pendingPolls = 50;
    const submitted = await submitCognidocsDocument({
      bytes: PDF, fileName: "slow.pdf", mimeType: "application/pdf", declaredType: "auto",
    });
    const timedOut = await expectError(() => waitForCognidocsJob(submitted.id, { timeoutMs: 10 }));
    check("client: deadline exceeded → timeout", timedOut?.code === "timeout", timedOut);
    cd.state.pendingPolls = 0;

    // Determinism: re-fetching a jobId replays the SAME result even after
    // the stub's state changes (preview→confirm replay mechanism).
    cd.state.invoice = defaultInvoicePayload({ vendorName: "Replay Vendor LLC", totalAmount10k: 1_000_000 });
    const job = await parseCognidocsDocument({
      bytes: PDF, fileName: "replay.pdf", mimeType: "application/pdf", declaredType: "auto",
    });
    cd.state.invoice = defaultInvoicePayload({ vendorName: "Someone Else LLC", totalAmount10k: 9_990_000 });
    const refetched = await getCognidocsJob(job.id);
    check(
      "client: jobId re-fetch is deterministic despite state changes",
      refetched.result?.invoice?.vendorName === "Replay Vendor LLC" &&
        refetched.result?.invoice?.totalAmount10k === 1_000_000,
      refetched.result?.invoice,
    );
    cd.state.invoice = defaultInvoicePayload();

    // Task #1318 — password-protected documents: no password → typed
    // pdf_password_required, wrong → pdf_password_incorrect, correct →
    // normal parse with the password on the submit wire (never a job field).
    cd.state.requiredPassword = "s3cret";
    const noPw = await expectError(() =>
      parseCognidocsDocument({ bytes: PDF, fileName: "locked.pdf", mimeType: "application/pdf", declaredType: "auto" }),
    );
    check("client: locked doc without password → pdf_password_required", noPw?.code === "pdf_password_required", noPw);
    const badPw = await expectError(() =>
      parseCognidocsDocument({ bytes: PDF, fileName: "locked.pdf", mimeType: "application/pdf", declaredType: "auto", password: "nope" }),
    );
    check("client: wrong password → pdf_password_incorrect", badPw?.code === "pdf_password_incorrect", badPw);
    const unlocked = await parseCognidocsDocument({
      bytes: PDF, fileName: "locked.pdf", mimeType: "application/pdf", declaredType: "auto", password: "s3cret",
    });
    check(
      "client: correct password → completed job, password sent on the submit",
      unlocked.status === "completed" && cd.state.lastSubmit?.password === "s3cret",
      { status: unlocked.status, password: cd.state.lastSubmit?.password },
    );
    // A pinned job re-fetch never needs the password again (preview→confirm).
    cd.state.requiredPassword = "rotated-away";
    const refetchLocked = await getCognidocsJob(unlocked.id);
    check("client: unlocked job re-fetch needs no password", refetchLocked.status === "completed", refetchLocked.status);
    cd.state.requiredPassword = null;
  }

  // =============== 5) converters (pure) ===============
  {
    // Statement: sign ONLY from direction; ×10k → majors; flag rules.
    const stmtJob = completedJob({
      confidence: 80,
      result: {
        documentType: "bank_statement", parserPath: null, confidence: null, invoice: null,
        statement: {
          bankId: null, bankName: null, statementType: "bank_statement", currency: "AED",
          accountRef: null, periodStart: null, periodEnd: null, partialImportWarning: null,
          transactions: [
            { date: "2026-08-01", description: "Inflow", rawDescription: null, amount10k: 152_500_000, currency: null, direction: "credit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            // Negative printed amount + explicit credit → still POSITIVE.
            { date: "2026-08-02", description: "Refund", rawDescription: null, amount10k: -50_000_000, currency: null, direction: "credit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            { date: "2026-08-03", description: "Outflow", rawDescription: null, amount10k: 23_107_500, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            // Direction-less → flagged, never guessed.
            { date: "2026-08-04", description: "Ambiguous", rawDescription: null, amount10k: 1_234_500, currency: null, direction: null, balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            // Bad date → flagged.
            { date: "04/08/2026", description: "Bad date", rawDescription: null, amount10k: 10_000, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            // Zero amount → flagged.
            { date: "2026-08-05", description: "Zero", rawDescription: null, amount10k: 0, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            // LIVE shape (2026-08-23 smoke): ISO datetime despite the spec's
            // `format: date` — must normalize to YYYY-MM-DD, not flag.
            { date: "2026-08-06T00:00:00.000Z", description: "Datetime shape", rawDescription: null, amount10k: 10_000_000, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
          ],
        },
      },
    });
    const conv = statementRowsFromJob(stmtJob, "USD");
    check(
      "convert: statement signs obey direction only (×10k → majors)",
      conv?.rows.length === 4 &&
        conv.rows[0].amount === 15250 && conv.rows[1].amount === 5000 && conv.rows[2].amount === -2310.75,
      conv?.rows,
    );
    check(
      "convert: live ISO-datetime posting dates normalize to YYYY-MM-DD",
      conv?.rows[3]?.postedDate === "2026-08-06" && conv.rows[3].amount === -1000,
      conv?.rows[3],
    );
    check(
      "convert: date/amount/direction problems each flag with a named reason",
      conv?.flagged.length === 3 &&
        conv.flagged.some((f) => /direction unclear/.test(f.reason)) &&
        conv.flagged.some((f) => /unparseable posting date/.test(f.reason)) &&
        conv.flagged.some((f) => /missing or zero amount/.test(f.reason)),
      conv?.flagged,
    );
    check(
      "convert: confidence = jobConf × usable-row share",
      conv?.confidence === +(0.8 * (4 / 7)).toFixed(3),
      conv?.confidence,
    );
    check("convert: no statement payload → null", statementRowsFromJob(completedJob({}), "USD") === null);

    // Canonical-CSV round-trip is lossless for 3-decimal currencies
    // (KWD/BHD/OMR): sub-cent amounts must survive serialise → reparse.
    {
      const { rowsToCanonicalCsv, parseCsv } = await import("../../src/lib/bank-parsers/index.js");
      const kwdJob = completedJob({
        confidence: 95,
        result: {
          documentType: "bank_statement", parserPath: null, confidence: null, invoice: null,
          statement: {
            bankId: null, bankName: null, statementType: "bank_statement", currency: "KWD",
            accountRef: null, periodStart: null, periodEnd: null, partialImportWarning: null,
            transactions: [
              { date: "2026-08-10", description: "Kuwait supplier", rawDescription: null, amount10k: 12_345, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
              { date: "2026-08-11", description: "Kuwait client", rawDescription: null, amount10k: 987_654, currency: null, direction: "credit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            ],
          },
        },
      });
      const kwd = statementRowsFromJob(kwdJob, "KWD");
      const reparsed = parseCsv(rowsToCanonicalCsv(kwd!.rows), "KWD");
      check(
        "convert: canonical CSV round-trip keeps 3-decimal currency amounts exact",
        reparsed.errors.length === 0 &&
          reparsed.rows.length === 2 &&
          reparsed.rows[0].amount === -1.2345 &&
          reparsed.rows[1].amount === 98.7654,
        { errors: reparsed.errors, rows: reparsed.rows.map((r) => r.amount) },
      );
    }

    // Live service serializes transaction dates as full ISO 8601 timestamps
    // ("2026-08-03T00:00:00.000Z") even though the guide says YYYY-MM-DD.
    // The converter must take the LITERAL date part (no timezone-shifting
    // Date parse) and still flag genuinely unparseable tokens.
    {
      const isoJob = completedJob({
        confidence: 95,
        result: {
          documentType: "bank_statement", parserPath: null, confidence: null, invoice: null,
          statement: {
            bankId: null, bankName: null, statementType: "bank_statement", currency: "AED",
            accountRef: null, periodStart: null, periodEnd: null, partialImportWarning: null,
            transactions: [
              { date: "2026-08-03T00:00:00.000Z", description: "ISO timestamp row", rawDescription: null, amount10k: 150_000_000, currency: null, direction: "credit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
              { date: "2026-08-05", description: "Bare date row", rawDescription: null, amount10k: 22_005_000, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
              { date: "03/08/2026", description: "Garbage date row", rawDescription: null, amount10k: 10_000, currency: null, direction: "debit", balance10k: null, normalizedMerchant: null, parsedMerchant: null, category: null },
            ],
          },
        },
      });
      const iso = statementRowsFromJob(isoJob, "AED");
      check(
        "convert: ISO-timestamp posting dates accepted literally, bare dates unchanged, garbage still flagged",
        iso?.rows.length === 2 &&
          iso.rows[0].postedDate === "2026-08-03" &&
          iso.rows[0].amount === 15000 &&
          iso.rows[1].postedDate === "2026-08-05" &&
          iso.flagged.length === 1 &&
          iso.flagged[0].reason === "unparseable posting date",
        { rows: iso?.rows.map((r) => [r.postedDate, r.amount]), flagged: iso?.flagged },
      );
    }

    // Invoice: ×10k mapping, 50-item cap, reconciliation warning.
    const manyItems = Array.from({ length: 60 }, (_, i) => ({
      description: `Row ${i + 1}`, quantity10k: 10_000, unitPriceAmount10k: 25_000, amount10k: 25_000, taxAmount10k: null,
    }));
    const invJob = completedJob({
      confidence: 90,
      result: {
        documentType: "invoice", parserPath: null, confidence: null, statement: null,
        invoice: {
          id: "cdinv_1", vendorKey: null, vendorName: "Vendor LLC", invoiceRef: "INV-9",
          issueDate: "2026-08-01T00:00:00.000Z", dueDate: null, currency: "aed",
          subtotalAmount10k: 1_000_000, taxAmount10k: 50_000, totalAmount10k: 1_050_000,
          categoryKey: null, lineItems: manyItems,
          reconciliation: { lineItemSum10k: 1_500_000, matchesTotal: false, delta10k: 450_000 },
        },
      },
    });
    const sup = supplierFieldsFromJob(invJob);
    check(
      "convert: supplier fields map ×10k → majors with uppercased currency",
      sup?.fields.supplierName === "Vendor LLC" && sup.fields.amount === 105 &&
        sup.fields.currency === "AED" && sup.fields.reference === "INV-9" &&
        sup.confidence === 0.9 && sup.cognidocsInvoiceId === "cdinv_1",
      sup,
    );
    check("convert: line items capped at 50", (sup?.fields.lineItems ?? []).length === 50);
    check(
      "convert: invoice issueDate normalizes ISO datetime → date-only",
      sup?.fields.invoiceDate === "2026-08-01",
      sup?.fields.invoiceDate,
    );
    check(
      "convert: reconciliation mismatch surfaces as a notes warning",
      /line item/i.test(sup?.fields.notes ?? "") || /match/i.test(sup?.fields.notes ?? ""),
      sup?.fields.notes,
    );
    check("convert: no invoice payload → null", supplierFieldsFromJob(completedJob({})) === null);

    // Receipt: merchant+total missing → unreadable, never guessed.
    const bare = receiptExtractionFromJob(
      completedJob({
        result: {
          documentType: "receipt", parserPath: null, confidence: null, statement: null,
          invoice: {
            id: null, vendorKey: null, vendorName: null, invoiceRef: null, issueDate: null,
            dueDate: null, currency: "AED", subtotalAmount10k: null, taxAmount10k: null,
            totalAmount10k: null, categoryKey: null,
          },
        },
      }),
    );
    check("convert: receipt without merchant AND total → unreadable", bare.unreadable === true, bare);

    // Receipt date arrives as an ISO datetime from the live service —
    // extraction + rawText must both carry the normalized date-only form.
    const dated = receiptExtractionFromJob(
      completedJob({
        confidence: 90,
        result: {
          documentType: "receipt", parserPath: null, confidence: null, statement: null,
          invoice: defaultInvoicePayload({ issueDate: "2026-08-05T00:00:00.000Z" }),
        },
      }),
    );
    check(
      "convert: receipt ISO-datetime issueDate normalizes to date-only",
      dated.date === "2026-08-05" && /date: 2026-08-05(\n|$)/.test(dated.rawText ?? ""),
      { date: dated.date, rawText: dated.rawText },
    );
  }

  await cd.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
