/**
 * Task #159 — contract lifecycle end-to-end probe.
 *
 * Pins the whole server-side chain, fully deterministic (no live LLM,
 * no live DocuSeal, real LibreOffice docx→PDF):
 *
 *   1. Template upload (.docx multipart) → stub-Anthropic field
 *      detection → fieldStatus "detected".
 *   2. Field review (PUT fields) → "reviewed", template auto-activates.
 *   3. Contract create for a roster person → CRM auto-fill
 *      (counterparty_name), generated draft .docx on the chain.
 *   4. Regenerate with edited values → new draft version.
 *   5. Final Word upload → docx→PDF (LibreOffice) → final + final_pdf
 *      docs, status "final_uploaded".
 *   6. Send for signature → stub DocuSeal → "out_for_signature".
 *   7. Manual e-sign sync (stub reports completed) → contract "signed",
 *      signed PDF copied onto the chain; terminal status never regresses.
 *   8. RBAC: employee persona cannot manage templates or contracts but
 *      CAN read their own contract.
 *
 * Stubs are installed via env BEFORE the app import (established
 * pattern: brief-envelope-contract-probe / esign-account-link-probe).
 *
 * Run: pnpm --filter @workspace/api-server test:contracts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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

const DETECTED_FIELDS = {
  fields: [
    {
      key: "counterparty_name",
      label: "Counterparty name",
      placeholder: "[COUNTERPARTY_NAME]",
      dataType: "text",
      autoFill: "counterparty_name",
      required: true,
    },
    {
      key: "effective_date",
      label: "Effective date",
      placeholder: "[EFFECTIVE_DATE]",
      dataType: "date",
      autoFill: "effective_date",
      required: true,
    },
    {
      key: "fee",
      label: "Fee",
      placeholder: "[FEE_AMOUNT]",
      dataType: "money",
      autoFill: "none",
      required: false,
    },
  ],
  warnings: ["probe warning"],
};

async function main() {
  // ---- stub Anthropic BEFORE app import ----
  const anthropicStub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe159",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify(DETECTED_FIELDS) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  anthropicStub.listen(0);
  await new Promise<void>((r) => anthropicStub.once("listening", () => r()));
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropicStub.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe159-stub-key";

  // ---- stub DocuSeal BEFORE app import ----
  const SIGNED_PDF = Buffer.from("%PDF-1.4 probe159 signed pdf\n%%EOF");
  let submissionCompleted = false;
  const docusealStub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/templates/pdf") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: 7159 }));
        return;
      }
      if (req.method === "POST" && url === "/submissions") {
        const body = JSON.parse(raw || "{}");
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            (body?.submitters ?? []).map((s: any, i: number) => ({
              id: 9200 + i,
              submission_id: 5599,
              name: s.name,
              email: s.email,
              status: "sent",
            })),
          ),
        );
        return;
      }
      if (req.method === "GET" && url === "/submissions/5599") {
        res.setHeader("content-type", "application/json");
        const base = `http://127.0.0.1:${(docusealStub.address() as AddressInfo).port}`;
        res.end(
          JSON.stringify(
            submissionCompleted
              ? {
                  id: 5599,
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  submitters: [
                    {
                      id: 9200,
                      status: "completed",
                      email: "p159_signer@example.test",
                      completed_at: new Date().toISOString(),
                    },
                  ],
                  documents: [{ name: "signed", url: `${base}/signed.pdf` }],
                }
              : { id: 5599, status: "pending", submitters: [] },
          ),
        );
        return;
      }
      if (req.method === "GET" && url === "/signed.pdf") {
        res.setHeader("content-type", "application/pdf");
        res.end(SIGNED_PDF);
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `unexpected-docuseal-call ${req.method} ${url}` }));
    });
  });
  docusealStub.listen(0);
  await new Promise<void>((r) => docusealStub.once("listening", () => r()));
  process.env.DOCUSEAL_BASE_URL = `http://127.0.0.1:${(docusealStub.address() as AddressInfo).port}`;
  process.env.DOCUSEAL_API_KEY = "probe159-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractTemplates,
    atelierContractTemplateVersions,
    atelierContractRecords,
    atelierContractDocuments,
    atelierSignatureRequests,
    atelierSignatureSigners,
    atelierDocuments,
  } = D as any;
  const { eq, inArray, like } = await import("drizzle-orm");
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe159_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const empUserId = `u_${runTag}_emp`;
  const empId = `emp_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown, who: string = fpId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        cookie: `atelier_persona=${who}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  const upload = async (path: string, fields: Record<string, string>, file: { name: string; bytes: Buffer; mime: string }, who: string = fpId) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name);
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${who}` },
      body: fd,
    });
    const body: any = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  async function makeDocx(lines: string[]): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          children: lines.map(
            (t) => new Paragraph({ children: [new TextRun(t)] }),
          ),
        },
      ],
    });
    return Buffer.from(await Packer.toBuffer(doc));
  }

  let templateId: string | null = null;
  let contractId: string | null = null;
  let sigRequestId: string | null = null;

  try {
    // ---- personas ----
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Probe159 Partner",
      initials: "PP",
      email: `${runTag}_fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierUsers).values({
      id: empUserId,
      orgId: "aico",
      name: "Probe159 Employee",
      initials: "PE",
      email: `${runTag}_emp@example.test`,
      role: "employee",
      roleLabel: "Employee",
      title: "Consultant",
    } as any);
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      userId: empUserId,
      fullName: "Nadia Probe",
      email: `${runTag}_nadia@example.test`,
      role: "consultant",
      roleTitle: "Consultant",
    } as any);

    // ---- 1. template upload + LLM detection (stubbed) ----
    const tplDocx = await makeDocx([
      "INDIVIDUAL NON-DISCLOSURE AGREEMENT",
      "This NDA is entered into by [COUNTERPARTY_NAME] effective [EFFECTIVE_DATE].",
      "The engagement fee is [FEE_AMOUNT].",
    ]);
    const tplUp = await upload(
      "/contract-templates",
      { name: `Probe NDA ${runTag}`, contractType: "individual_nda" },
      { name: "nda.docx", bytes: tplDocx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    );
    check("template upload -> 201", tplUp.status === 201, tplUp);
    templateId = tplUp.body?.template?.id ?? null;
    const tplV = tplUp.body?.template?.currentVersion;
    check("fields detected from stub LLM", tplV?.fieldStatus === "detected" && tplV?.fieldSchema?.length === 3, tplV);
    check("template starts draft", tplUp.body?.template?.status === "draft", tplUp.body?.template?.status);
    if (!templateId) throw new Error("no template id — aborting");

    // employee cannot upload templates
    const tplForbidden = await upload(
      "/contract-templates",
      { name: "nope", contractType: "other" },
      { name: "x.docx", bytes: tplDocx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      empUserId,
    );
    check("employee template upload -> 403", tplForbidden.status === 403, tplForbidden);

    // contract create before review -> rejected (template not usable)
    const early = await api("POST", "/contracts", {
      templateId,
      counterparty: { kind: "person", id: empId },
      values: {},
    });
    check("create before field review rejected", early.status >= 400, early);

    // ---- 2. review fields -> reviewed + auto-activate ----
    const review = await api("PUT", `/contract-templates/${templateId}/fields`, {
      fields: DETECTED_FIELDS.fields.map((f) => ({ ...f, note: undefined })),
    });
    check("field review -> 200", review.status === 200, review);
    check("fieldStatus reviewed", review.body?.template?.currentVersion?.fieldStatus === "reviewed", review.body);
    check("template auto-activated", review.body?.template?.status === "active", review.body?.template?.status);

    // ---- 3. create contract for roster person (auto-fill) ----
    const created = await api("POST", "/contracts", {
      templateId,
      counterparty: { kind: "person", id: empId },
      values: { fee: "AED 25,000" },
      effectiveDate: "2026-07-18",
    });
    check("contract create -> 201", created.status === 201, created);
    contractId = created.body?.contract?.id ?? null;
    const c0 = created.body?.contract;
    check("status draft", c0?.status === "draft", c0?.status);
    check("counterparty label = person name", c0?.counterpartyLabel === "Nadia Probe", c0);
    check(
      "auto-fill counterparty_name from CRM",
      c0?.fieldValues?.counterparty_name === "Nadia Probe",
      c0?.fieldValues,
    );
    check("effective_date auto-filled", String(c0?.fieldValues?.effective_date ?? "").includes("2026"), c0?.fieldValues);
    const draftDocs = (c0?.documents ?? []).filter((d: any) => d.kind === "generated_draft");
    check("draft .docx generated on chain", draftDocs.length === 1, c0?.documents);
    if (!contractId) throw new Error("no contract id — aborting");

    // draft docx actually contains the filled value
    const dl = await fetch(`${BASE}/contracts/${contractId}/documents/${draftDocs[0].id}/download`, {
      headers: { cookie: `atelier_persona=${fpId}` },
    });
    check("draft download -> 200 docx", dl.status === 200, dl.status);
    const draftBytes = Buffer.from(await dl.arrayBuffer());
    const { extractDocxText } = await import("../../src/lib/atelier-contracts.js");
    const draftText = await extractDocxText(draftBytes);
    check("draft text has filled name (no placeholder left)", draftText.includes("Nadia Probe") && !draftText.includes("[COUNTERPARTY_NAME]"), draftText.slice(0, 200));
    check("draft text has fee value", draftText.includes("AED 25,000"), draftText.slice(0, 200));

    // ---- 4. regenerate with edited values ----
    const regen = await api("POST", `/contracts/${contractId}/regenerate`, {
      values: { fee: "AED 30,000" },
    });
    check("regenerate -> 201", regen.status === 201, regen);
    check("regenerated values merged", regen.body?.contract?.fieldValues?.fee === "AED 30,000", regen.body?.contract?.fieldValues);
    const afterRegen = await api("GET", `/contracts/${contractId}`);
    const regenDrafts = (afterRegen.body?.contract?.documents ?? []).filter(
      (d: any) => d.kind === "generated_draft",
    );
    check("regenerate adds a new draft version", regenDrafts.length === 2, afterRegen.body?.contract?.documents);

    // ---- 5. final Word upload -> LibreOffice PDF ----
    const finalDocx = await makeDocx([
      "INDIVIDUAL NON-DISCLOSURE AGREEMENT (FINAL)",
      "This NDA is entered into by Nadia Probe effective 18 July 2026.",
    ]);
    const fin = await upload(
      `/contracts/${contractId}/final`,
      {},
      { name: "nda-final.docx", bytes: finalDocx, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    );
    check("final upload -> 200/201", fin.status === 200 || fin.status === 201, fin);
    const cf = fin.body?.contract;
    check("status final_uploaded", cf?.status === "final_uploaded", cf?.status);
    const finDocs = (cf?.documents ?? []).filter((d: any) => d.kind === "final_docx");
    check("final_docx on chain", finDocs.length === 1, cf?.documents);

    // ---- 6. send for signature (LibreOffice PDF + stub DocuSeal) ----
    const sent = await api("POST", `/contracts/${contractId}/send-for-signature`, {
      signers: [{ name: "Nadia Probe", email: "p159_signer@example.test" }],
    });
    check("send-for-signature -> 200/201", sent.status === 200 || sent.status === 201, sent);
    check("status out_for_signature", sent.body?.contract?.status === "out_for_signature", sent.body?.contract?.status);
    sigRequestId = sent.body?.contract?.signatureRequestId ?? null;
    check("signatureRequestId linked", !!sigRequestId, sent.body?.contract);

    const afterSend = await api("GET", `/contracts/${contractId}`);
    const pdfDocs = (afterSend.body?.contract?.documents ?? []).filter(
      (d: any) => d.kind === "converted_pdf",
    );
    check("converted_pdf generated at send", pdfDocs.length === 1 && pdfDocs[0].mime === "application/pdf", afterSend.body?.contract?.documents);
    const pdfDl = await fetch(`${BASE}/contracts/${contractId}/documents/${pdfDocs[0].id}/download`, {
      headers: { cookie: `atelier_persona=${fpId}` },
    });
    const pdfBytes = Buffer.from(await pdfDl.arrayBuffer());
    check("downloaded PDF magic bytes", pdfBytes.subarray(0, 4).toString() === "%PDF", pdfBytes.subarray(0, 8).toString());

    // manual status edits to signature-driven statuses are rejected
    const manualSigned = await api("PATCH", `/contracts/${contractId}`, { status: "signed" });
    check("manual 'signed' rejected -> 409", manualSigned.status === 409, manualSigned);

    // ---- 7. e-sign sync completes -> contract signed ----
    submissionCompleted = true;
    const sync = await api("POST", `/esign/requests/${sigRequestId}/sync`);
    check("esign sync -> 200", sync.status === 200, sync);
    const after = await api("GET", `/contracts/${contractId}`);
    check("contract signed after sync", after.body?.contract?.status === "signed", after.body?.contract?.status);
    const signedDocs = (after.body?.contract?.documents ?? []).filter((d: any) => d.kind === "signed_pdf");
    check("signed PDF copied onto chain", signedDocs.length === 1, after.body?.contract?.documents);
    check("signed library doc linked", !!after.body?.contract?.signedLibraryDocumentId, after.body?.contract);

    // terminal status never regresses
    const regress = await api("PATCH", `/contracts/${contractId}`, { status: "voided" });
    check("terminal status never regresses -> 409", regress.status === 409, regress);
    const regen2 = await api("POST", `/contracts/${contractId}/regenerate`, { values: {} });
    check("regenerate after signed rejected", regen2.status >= 400, regen2);

    // ---- 8. RBAC: employee sees OWN contract via Me lens, cannot manage ----
    // Employee personas are hard-gated to /me/* (Task #50 self-scope).
    const gated = await api("GET", `/contracts/${contractId}`, undefined, empUserId);
    check("employee /contracts/:id gated -> 403", gated.status === 403, gated);
    const mine = await api("GET", "/me/contracts", undefined, empUserId);
    check(
      "employee /me/contracts lists own contract",
      mine.status === 200 && (mine.body?.contracts ?? []).some((c: any) => c.id === contractId),
      mine,
    );
    // Task #161 — employee opens own contract detail + downloads signed PDF
    // via the self-scope /me/contracts/* routes.
    const mineDetail = await api("GET", `/me/contracts/${contractId}`, undefined, empUserId);
    check("employee /me/contracts/:id -> 200", mineDetail.status === 200, mineDetail);
    const mineDocs = mineDetail.body?.contract?.documents ?? [];
    const mineSigned = mineDocs.find((d: any) => d.kind === "signed_pdf");
    check("me detail includes documents chain + signed_pdf", !!mineSigned, mineDocs);
    if (mineSigned) {
      const mineDl = await fetch(
        `${BASE}/me/contracts/${contractId}/documents/${mineSigned.id}/download`,
        { headers: { cookie: `atelier_persona=${empUserId}` } },
      );
      const mineBytes = Buffer.from(await mineDl.arrayBuffer());
      check(
        "employee downloads own signed PDF via /me route",
        mineDl.status === 200 && mineBytes.subarray(0, 4).toString() === "%PDF",
        { status: mineDl.status, head: mineBytes.subarray(0, 8).toString() },
      );
    }
    // Not the caller's contract (fp has no roster row linked) -> 403.
    const notMine = await api("GET", `/me/contracts/${contractId}`, undefined, fpId);
    check("/me/contracts/:id on someone else's contract -> 403", notMine.status === 403, notMine);
    const notMineDl = await api(
      "GET",
      `/me/contracts/${contractId}/documents/${mineSigned?.id ?? "doc_x"}/download`,
      undefined,
      fpId,
    );
    check("/me download on someone else's contract -> 403", notMineDl.status === 403, notMineDl);
    // Unknown contract id -> 404.
    const mineMissing = await api("GET", "/me/contracts/ctr_does_not_exist", undefined, empUserId);
    check("/me/contracts/:id unknown -> 404", mineMissing.status === 404, mineMissing);

    const empPatch = await api("PATCH", `/contracts/${contractId}`, { notes: "hax" }, empUserId);
    check("employee cannot patch contract -> 403", empPatch.status === 403, empPatch);
    const empCreate = await api(
      "POST",
      "/contracts",
      { templateId, counterparty: { kind: "person", id: empId }, values: {} },
      empUserId,
    );
    check("employee cannot create contract -> 403", empCreate.status === 403, empCreate);
  } finally {
    // ---- cleanup (tracked ids + tag sweep) ----
    try {
      if (contractId) {
        await db.delete(atelierContractDocuments).where(eq(atelierContractDocuments.contractId, contractId));
        await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, contractId));
      }
      if (sigRequestId) {
        await db.delete(atelierSignatureSigners).where(eq(atelierSignatureSigners.requestId, sigRequestId));
        await db.delete(atelierSignatureRequests).where(eq(atelierSignatureRequests.id, sigRequestId));
      }
      if (templateId) {
        await db.delete(atelierContractTemplateVersions).where(eq(atelierContractTemplateVersions.templateId, templateId));
        await db.delete(atelierContractTemplates).where(eq(atelierContractTemplates.id, templateId));
      }
      await db.delete(atelierDocuments).where(like(atelierDocuments.title, `%${runTag}%`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, empUserId]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    anthropicStub.close();
    docusealStub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
