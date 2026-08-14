/**
 * Task #1065 — Legal-entity bank accounts + bank-letter extraction probe.
 *
 * Covers:
 *   - POST /wallet/bank/accounts with legalEntityId → 201; invalid IBAN → 400
 *   - GET /finance/entities/:id → bankAccounts listed (swift/holder included)
 *   - board_observer gets entity detail but an EMPTY bankAccounts list
 *   - PATCH /wallet/bank/accounts/:id — swift/holder/iban update + invalid
 *     IBAN 400 + deactivate via isActive:false
 *   - POST /finance/entities/:id/bank-letter-extract:
 *       stub Anthropic canned bank proposal → 200 with normalized fields
 *       consultant → 403; unreadable (binary-garbage pdf) → 422
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/entity-bank-accounts-probe.ts
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

const BANK_PROPOSAL = {
  confidenceNote: "Stubbed bank-letter extraction for probe1065",
  fields: {
    bankName: "Emirates NBD",
    branch: "Deira Main",
    accountHolderName: "Probe1065 Ventures LLC",
    iban: "ae07 0331 2345 6789 0123 456",
    accountNumber: "1015234567890",
    swift: "ebilaead",
    currency: "aed",
    issuedOn: "2026-08-01",
  },
};

const LETTER_TEXT = `EMIRATES NBD — ACCOUNT CONFIRMATION LETTER
To whom it may concern: we confirm that Probe1065 Ventures LLC maintains
account number 1015234567890 (IBAN AE07 0331 2345 6789 0123 456, SWIFT EBILAEAD)
in AED with our Deira Main branch. Issued 2026-08-01.`;

async function main() {
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe1065",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify(BANK_PROPOSAL) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe1065-stub-key";

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierLegalEntities, atelierDocuments, atelierBankAccount } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe1065_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const conId = `u_${runTag}_con`;
  const boId = `u_${runTag}_bo`;
  const finId = `u_${runTag}_fin`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  const uploadDoc = async (who: string, fields: Record<string, string>, bytes: Buffer, fileName: string, mime: string) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
    const res = await fetch(`${BASE}/documents`, { method: "POST", headers: { cookie: `atelier_persona=${who}` }, body: fd });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  const docIds: string[] = [];
  const entityIds: string[] = [];
  const bankIds: string[] = [];

  try {
    await db.insert(atelierUsers).values([
      { id: fpId, orgId: "aico", name: "P1065 Partner", initials: "PP", email: `${runTag}_fp@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: conId, orgId: "aico", name: "P1065 Consultant", initials: "PC", email: `${runTag}_con@example.test`, role: "consultant", roleLabel: "Consultant", title: "Consultant" },
      { id: boId, orgId: "aico", name: "P1065 Observer", initials: "PO", email: `${runTag}_bo@example.test`, role: "board_observer", roleLabel: "Board Observer", title: "Board Observer" },
      { id: finId, orgId: "aico", name: "P1065 Finance", initials: "PF", email: `${runTag}_fin@example.test`, role: "finance", roleLabel: "Finance", title: "Finance Lead" },
    ] as any);

    // Entity
    const created = await api(fpId, "POST", "/finance/entities", {
      legalNameEn: `Probe1065 Ventures LLC ${runTag}`,
      country: "ae",
      legalForm: "LLC",
      baseCurrency: "AED",
    });
    check("entity create 201", created.status === 201, created);
    const entityId = created.body?.entity?.id as string;
    entityIds.push(entityId);

    // --- Bank account CRUD via wallet routes ---
    const badIban = await api(fpId, "POST", "/wallet/bank/accounts", {
      bankName: "Emirates NBD", accountLabel: "Ops", accountNumberLast4: "7890",
      legalEntityId: entityId, iban: "NOT-AN-IBAN!!",
    });
    check("create with invalid IBAN → 400 invalid_iban", badIban.status === 400 && badIban.body?.error === "invalid_iban", badIban);

    const good = await api(fpId, "POST", "/wallet/bank/accounts", {
      bankName: "Emirates NBD", accountLabel: "Operating account", accountNumberLast4: "7890",
      legalEntityId: entityId, iban: "ae07 0331 2345 6789 0123 456",
      swift: "ebilaead", accountHolderName: "  Probe1065 Ventures LLC  ", currency: "AED", purpose: "operating",
    });
    check("create bank account ok", good.status === 200 && good.body?.ok === true, good);
    const bankId = good.body?.data?.id;
    if (bankId) bankIds.push(bankId);

    // Entity detail lists it (normalized IBAN/swift, trimmed holder)
    const det = await api(fpId, "GET", `/finance/entities/${entityId}`);
    const acct = (det.body?.bankAccounts ?? []).find((a: any) => a.id === bankId);
    check("entity detail lists bank account", det.status === 200 && !!acct, det.body?.bankAccounts);
    check("IBAN normalized", acct?.iban === "AE070331234567890123456", acct?.iban);
    check("SWIFT normalized", acct?.swift === "EBILAEAD", acct?.swift);
    check("holder trimmed", acct?.accountHolderName === "Probe1065 Ventures LLC", acct?.accountHolderName);

    // Board observer + consultant: detail OK but bankAccounts empty (finance
    // leadership only sees IBANs)
    const boDet = await api(boId, "GET", `/finance/entities/${entityId}`);
    check("board_observer detail 200 with empty bankAccounts", boDet.status === 200 && Array.isArray(boDet.body?.bankAccounts) && boDet.body.bankAccounts.length === 0, boDet.body?.bankAccounts);
    const conDet = await api(conId, "GET", `/finance/entities/${entityId}`);
    check("consultant detail 200 with empty bankAccounts", conDet.status === 200 && Array.isArray(conDet.body?.bankAccounts) && conDet.body.bankAccounts.length === 0, conDet.body?.bankAccounts);

    // Bogus legalEntityId on create → 404
    const bogus = await api(fpId, "POST", "/wallet/bank/accounts", {
      bankName: "X", accountLabel: "X", accountNumberLast4: "0000", legalEntityId: "lent_nope",
    });
    check("create with bogus entity → 404", bogus.status === 404 && bogus.body?.error === "entity-not-found", bogus);

    // Wallet list: consultant gets redacted rows (no IBAN/SWIFT/holder)
    const conList = await api(conId, "GET", "/wallet/bank/accounts");
    const conRow = (conList.body?.data ?? []).find((a: any) => a.id === bankId);
    check(
      "consultant wallet list redacted",
      conList.status === 200 && !!conRow && conRow.iban === null && conRow.swift === null && conRow.accountHolderName === null,
      conRow,
    );
    const fpList = await api(fpId, "GET", "/wallet/bank/accounts");
    const fpRow = (fpList.body?.data ?? []).find((a: any) => a.id === bankId);
    check("fp wallet list full", !!fpRow && fpRow.iban === "AE070331234567890123456", fpRow);

    // PATCH invalid IBAN → 400; valid update + deactivate
    const patchBad = await api(fpId, "PATCH", `/wallet/bank/accounts/${bankId}`, { iban: "??" });
    check("patch invalid IBAN → 400", patchBad.status === 400 && patchBad.body?.error === "invalid_iban", patchBad);
    const patchOk = await api(fpId, "PATCH", `/wallet/bank/accounts/${bankId}`, { swift: "EBIL AEAD", accountHolderName: "Probe1065 Ventures", isActive: false });
    check("patch ok", patchOk.status === 200, patchOk);
    const det2 = await api(fpId, "GET", `/finance/entities/${entityId}`);
    const acct2 = (det2.body?.bankAccounts ?? []).find((a: any) => a.id === bankId);
    check("patch applied (swift/holder/inactive)", acct2?.swift === "EBILAEAD" && acct2?.accountHolderName === "Probe1065 Ventures" && acct2?.isActive === false, acct2);

    // --- Bank-letter extraction ---
    const up = await uploadDoc(fpId, { title: "Bank letter — ENBD", category: "corporate_legal", entityId }, Buffer.from(LETTER_TEXT, "utf8"), "enbd-letter.txt", "text/plain");
    check("letter upload 201", up.status === 201, up);
    const letterDocId = up.body?.document?.id ?? up.body?.id;
    if (letterDocId) docIds.push(letterDocId);

    const conExtract = await api(conId, "POST", `/finance/entities/${entityId}/bank-letter-extract`, { documentId: letterDocId });
    check("consultant extract → 403", conExtract.status === 403, conExtract);

    const ext = await api(fpId, "POST", `/finance/entities/${entityId}/bank-letter-extract`, { documentId: letterDocId });
    check("extract 200", ext.status === 200, ext);
    const f = ext.body?.proposal?.fields ?? {};
    check("extract fields normalized", f.iban === "AE070331234567890123456" && f.swift === "EBILAEAD" && f.currency === "AED" && f.bankName === "Emirates NBD", f);

    // Garbage-as-pdf → 422 (unreadable or text-extraction-failed)
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x99, 0x42, 0x00, 0x13, 0x37]);
    const upBad = await uploadDoc(fpId, { title: "Bank letter — garbage", category: "corporate_legal", entityId }, garbage, "garbage.pdf", "application/pdf");
    const badDocId = upBad.body?.document?.id ?? upBad.body?.id;
    if (badDocId) docIds.push(badDocId);
    if (upBad.status === 201) {
      const extBad = await api(fpId, "POST", `/finance/entities/${entityId}/bank-letter-extract`, { documentId: badDocId });
      check("garbage pdf extract → 422", extBad.status === 422, extBad);
    } else {
      check("garbage pdf rejected at upload (acceptable)", upBad.status >= 400, upBad);
    }

    // Document linked to a DIFFERENT entity → 409
    const other = await api(fpId, "POST", "/finance/entities", {
      legalNameEn: `Probe1065 Other LLC ${runTag}`, country: "ae", legalForm: "LLC", baseCurrency: "AED",
    });
    const otherId = other.body?.entity?.id as string;
    entityIds.push(otherId);
    const mismatch = await api(fpId, "POST", `/finance/entities/${otherId}/bank-letter-extract`, { documentId: letterDocId });
    check("doc linked to other entity → 409", mismatch.status === 409 && mismatch.body?.error === "document-entity-mismatch", mismatch);

    // Finance role: full workflow (create, see, patch, extract)
    const finCreate = await api(finId, "POST", "/wallet/bank/accounts", {
      bankName: "Mashreq", accountLabel: "Payroll account", accountNumberLast4: "4321",
      legalEntityId: entityId, iban: "AE210330000010154321000", purpose: "payroll",
    });
    check("finance create bank account ok", finCreate.status === 200 && finCreate.body?.ok === true, finCreate);
    const finBankId = finCreate.body?.data?.id;
    if (finBankId) bankIds.push(finBankId);
    const finDet = await api(finId, "GET", `/finance/entities/${entityId}`);
    const finAcct = (finDet.body?.bankAccounts ?? []).find((a: any) => a.id === finBankId);
    check("finance sees full bank row on detail", !!finAcct && finAcct.iban === "AE210330000010154321000", finAcct);
    const finPatch = await api(finId, "PATCH", `/wallet/bank/accounts/${finBankId}`, { swift: "BOMLAEAD" });
    check("finance patch ok", finPatch.status === 200, finPatch);
    const finExt = await api(finId, "POST", `/finance/entities/${entityId}/bank-letter-extract`, { documentId: letterDocId });
    check("finance extract 200", finExt.status === 200, finExt);

    // Missing documentId → 400
    const noDoc = await api(fpId, "POST", `/finance/entities/${entityId}/bank-letter-extract`, {});
    check("missing documentId → 400", noDoc.status === 400, noDoc);
  } finally {
    try {
      if (bankIds.length) await db.delete(atelierBankAccount).where(inArray(atelierBankAccount.id, bankIds));
      if (docIds.length) await db.delete(atelierDocuments).where(inArray(atelierDocuments.id, docIds));
      if (entityIds.length) await db.delete(atelierLegalEntities).where(inArray(atelierLegalEntities.id, entityIds));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, conId, boId, finId]));
    } catch (err) {
      console.error("cleanup error", err);
    }
    server.close();
    stub.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(1);
});
