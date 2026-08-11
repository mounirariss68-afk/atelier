/**
 * Task #967 — Non-Equity Partner Agreement chat flow probe.
 *
 * Deterministic (no LLM; DocuSeal stubbed with a local HTTP server):
 * drives the capability handlers directly against the templatized v3
 * template docx (scripts/assets/…) and pins:
 *
 *   contract_prepare (roster auto-add):
 *     1. unknown counterparty on a non-equity template → email
 *        clarification (counterparty_not_on_roster), NOT a dead-end.
 *     2. with newPersonEmail → preview discloses the rosterCreate.
 *     3. confirm → contractor row (notes = "Non-Equity Partner",
 *        structured-name person row, no login) + drafted contract
 *        with the reference number allocated and navigateTo set.
 *     4. re-running with the same email reuses the roster row
 *        (duplicate guard) instead of creating a second person.
 *
 *   contract_attach_final_and_send:
 *     5. attachment ownership + docx-mime guards.
 *     6. preview → confirm records the final_docx version, flips the
 *        status, and dispatches DocuSeal (stub) → out_for_signature.
 *
 * Run: pnpm --filter @workspace/api-server test:nep-flow
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DOCUSEAL_API_KEY = "test-docuseal-key";

import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DOCX = path.resolve(
  HERE,
  "../../scripts/assets/non-equity-partner-agreement-template-v3.docx",
);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, JSON.stringify(detail ?? "", null, 1)?.slice(0, 2000));
  }
}

/** Minimal DocuSeal stub — templates/pdf + submissions is all sendContract needs. */
function stubServer(): http.Server {
  let nextTemplate = 100;
  let nextSubmission = 500;
  let nextSubmitter = 900;
  return http.createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-auth-token"] !== "test-docuseal-key") return send(401, { error: "bad token" });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = req.url ?? "";
      const body = raw ? JSON.parse(raw) : undefined;
      if (req.method === "POST" && url === "/templates/pdf") return send(200, { id: nextTemplate++ });
      if (req.method === "POST" && url === "/submissions") {
        const sid = nextSubmission++;
        return send(
          200,
          (body.submitters as Array<{ name: string; email: string }>).map((s, i) => ({
            id: nextSubmitter++,
            submission_id: sid,
            name: s.name,
            email: s.email,
            status: i === 0 ? "sent" : "pending",
            slug: `slug_${sid}_${i}`,
          })),
        );
      }
      return send(404, { error: `unhandled ${req.method} ${url}` });
    });
  });
}

async function main() {
  const server = stubServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.DOCUSEAL_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Keep signer-invite emails offline too — the stub 404s unknown routes, so
  // the invite records as undelivered instead of hitting live Resend.
  process.env.RESEND_API_BASE_URL = process.env.DOCUSEAL_BASE_URL;

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierContractors,
    atelierPersons,
    atelierCliAttachments,
    atelierContractTemplates,
    atelierContractTemplateVersions,
    atelierContractRecords,
    atelierContractDocuments,
    atelierSignatureRequests,
    atelierSignatureSigners,
    atelierDocuments,
    atelierDocumentVersions,
    atelierAuditEvents,
  } = D as any;
  const { and, eq, inArray, like } = await import("drizzle-orm");
  const { storeContractBytes, DOCX_MIME } = await import("../../src/lib/atelier-contracts.js");
  const { storeAttachmentBytes } = await import("../../src/lib/atelier-cli/attachments/storage.js");
  await import("../../src/lib/atelier-cli/contract-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
  const { NEP_FIELD_SCHEMA } = await import("../../scripts/nep-template-schema.js");

  const prepare = findByToolName("contract_prepare");
  const attachSend = findByToolName("contract_attach_final_and_send");
  if (!prepare || !attachSend) throw new Error("capabilities not registered");

  const runTag = `probe967_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const otherId = `u_${runTag}_other`;
  const tplId = `ctpl_${runTag}`;
  const verId = `ctv_${runTag}`;
  const partnerName = `Xerxes Novprobe${Date.now().toString(36)}`;
  const partnerEmail = `${runTag}_nep@example.test`;
  const persona = { id: fpId, name: "NEP Probe Partner", role: "founding_partner", orgId: "aico" };
  const ctx = { persona } as any;
  const createdContractIds: string[] = [];
  const attachmentIds: string[] = [];
  const sentRequestIds: string[] = [];

  try {
    for (const [id, nm] of [
      [fpId, persona.name],
      [otherId, "Other Uploader"],
    ] as const) {
      await db.insert(atelierUsers).values({
        id,
        orgId: "aico",
        name: nm,
        initials: "NP",
        email: `${id}@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      } as any);
    }

    // The REAL templatized v3 docx + the REAL reviewed schema.
    const bytes = readFileSync(TEMPLATE_DOCX);
    const { blobRef, sha256 } = await storeContractBytes(bytes);
    await db.insert(atelierContractTemplates).values({
      id: tplId,
      orgId: "aico",
      name: `NEP Probe Agreement ${runTag}`,
      contractType: "non_equity_partner_employment",
      status: "active",
      currentVersionId: verId,
      createdBy: fpId,
      createdByLabel: persona.name,
    } as any);
    await db.insert(atelierContractTemplateVersions).values({
      id: verId,
      orgId: "aico",
      templateId: tplId,
      versionNumber: 1,
      fileName: "nep-template-v3.docx",
      sizeBytes: bytes.length,
      sha256,
      blobRef,
      fieldSchema: NEP_FIELD_SCHEMA,
      fieldStatus: "reviewed",
      createdBy: fpId,
    } as any);

    const values = {
      partner_passport_id: "P1234567",
      partner_address: "Villa 9, Palm Jumeirah, Dubai",
      sector_focus: "the Healthcare sector across the GCC",
      charge_out_rate: "USD 2,500",
      firm_signatory_name_title: "Mounir — CEO and Co-founder",
    };

    // ---- 1. unknown person, no email → clarification, not dead-end ----
    const ask: any = await prepare.run(
      { template: tplId, counterparty: partnerName, values, effectiveDate: "2026-09-01" },
      ctx,
    );
    check(
      "1. unknown NEP counterparty asks for email",
      ask?.ok === false &&
        ask?.errorCode === "counterparty_not_on_roster" &&
        ask?.clarification?.field === "newPersonEmail" &&
        ask?.clarification?.partial?.template === tplId,
      ask,
    );

    // ---- 2. with email → preview discloses roster create ----
    const preview: any = await prepare.run(
      { ...(ask?.clarification?.partial ?? {}), newPersonEmail: partnerEmail },
      ctx,
    );
    check(
      "2. preview discloses rosterCreate",
      preview?.ok === true &&
        preview?.confirmation?.diff?.rosterCreate?.email === partnerEmail &&
        preview?.confirmation?.diff?.rosterCreate?.roleLabel === "Non-Equity Partner" &&
        preview?.confirmation?.pending?.input?.counterparty === partnerName,
      preview,
    );

    // ---- 3. confirm → contractor row + drafted contract ----
    const commit: any = await prepare.run(preview.confirmation.pending.input, ctx);
    check(
      "3a. commit ok with navigateTo",
      commit?.ok === true && commit?.data?.navigateTo?.path === `/contracts/${commit?.data?.id}`,
      commit,
    );
    if (commit?.data?.id) createdContractIds.push(commit.data.id);
    const ctrRows = await db
      .select()
      .from(atelierContractors)
      .where(eq(atelierContractors.email, partnerEmail));
    check(
      "3b. contractor row created (Non-Equity Partner, no login)",
      ctrRows.length === 1 && ctrRows[0].notes === "Non-Equity Partner" && ctrRows[0].personId,
      ctrRows,
    );
    check(
      "3c. contract counterparty is the new roster person",
      commit?.data?.contract?.counterparty === partnerName &&
        commit?.data?.contract?.counterpartyKind === "person" &&
        commit?.data?.contract?.status === "draft",
      commit?.data?.contract,
    );

    // ---- 4. duplicate email reuses the roster row ----
    const again: any = await prepare.run(
      {
        template: tplId,
        counterparty: `${partnerName} Junior`,
        newPersonEmail: partnerEmail,
        values,
        effectiveDate: "2026-09-01",
      },
      ctx,
    );
    const ctrAfter = await db
      .select()
      .from(atelierContractors)
      .where(eq(atelierContractors.email, partnerEmail));
    check(
      "4. same email reuses roster row (no rosterCreate, still 1 contractor)",
      again?.ok === true && !again?.confirmation?.diff?.rosterCreate && ctrAfter.length === 1,
      { again: again?.confirmation?.diff, count: ctrAfter.length },
    );

    // ---- 5. attach-and-send guards ----
    const contractId = createdContractIds[0];
    const finalBytes = readFileSync(TEMPLATE_DOCX); // any docx works as a "revision"
    const storedA = await storeAttachmentBytes(finalBytes);
    const attId = `att_${runTag}_ok`;
    attachmentIds.push(attId);
    await db.insert(atelierCliAttachments).values({
      id: attId,
      orgId: "aico",
      userId: fpId,
      fileName: "Agreed revision — NEP.docx",
      mime: DOCX_MIME,
      sizeBytes: finalBytes.length,
      sha256: storedA.sha256 ?? "x",
      encryptedRef: storedA.encryptedRef,
      status: "extracted",
    } as any);
    const attOtherId = `att_${runTag}_other`;
    attachmentIds.push(attOtherId);
    await db.insert(atelierCliAttachments).values({
      id: attOtherId,
      orgId: "aico",
      userId: otherId,
      fileName: "someone-elses.docx",
      mime: DOCX_MIME,
      sizeBytes: finalBytes.length,
      sha256: "y",
      encryptedRef: storedA.encryptedRef,
      status: "extracted",
    } as any);
    const attPdfId = `att_${runTag}_pdf`;
    attachmentIds.push(attPdfId);
    await db.insert(atelierCliAttachments).values({
      id: attPdfId,
      orgId: "aico",
      userId: fpId,
      fileName: "not-a-docx.pdf",
      mime: "application/pdf",
      sizeBytes: 10,
      sha256: "z",
      encryptedRef: storedA.encryptedRef,
      status: "extracted",
    } as any);
    const signers = [{ name: partnerName, email: partnerEmail }];

    const notYours: any = await attachSend.run(
      { contract: contractId, attachmentId: attOtherId, signers },
      ctx,
    );
    check("5a. foreign attachment rejected", notYours?.ok === false && notYours?.errorCode === "attachment_not_yours", notYours);
    const notDocx: any = await attachSend.run(
      { contract: contractId, attachmentId: attPdfId, signers },
      ctx,
    );
    check("5b. non-docx rejected", notDocx?.ok === false && notDocx?.errorCode === "not_a_docx", notDocx);

    // ---- 6. preview → confirm records final + dispatches DocuSeal ----
    const sPreview: any = await attachSend.run(
      { contract: contractId, attachmentId: attId, signers },
      ctx,
    );
    check(
      "6a. attach-and-send preview",
      sPreview?.ok === true &&
        sPreview?.confirmation?.pending?.input?.contract === contractId &&
        /FINAL version/.test(sPreview?.confirmation?.summary ?? ""),
      sPreview,
    );
    const sCommit: any = await attachSend.run(sPreview.confirmation.pending.input, ctx);
    check(
      "6b. commit sends for signature",
      sCommit?.ok === true &&
        sCommit?.data?.contract?.status === "out_for_signature" &&
        !!sCommit?.data?.signatureRequestId &&
        sCommit?.data?.navigateTo?.path === `/contracts/${contractId}`,
      sCommit,
    );
    if (sCommit?.data?.signatureRequestId) sentRequestIds.push(sCommit.data.signatureRequestId);
    const docs = await db
      .select()
      .from(atelierContractDocuments)
      .where(eq(atelierContractDocuments.contractId, contractId));
    check(
      "6c. final_docx version recorded",
      docs.some((d: any) => d.kind === "final_docx" && d.fileName === "Agreed revision — NEP.docx"),
      docs.map((d: any) => ({ kind: d.kind, fileName: d.fileName })),
    );
  } finally {
    try {
      // signature request + signers + library doc for the sent contract
      if (sentRequestIds.length > 0) {
        await db.delete(atelierSignatureSigners).where(inArray(atelierSignatureSigners.requestId, sentRequestIds));
        await db.delete(atelierSignatureRequests).where(inArray(atelierSignatureRequests.id, sentRequestIds));
      }
      if (createdContractIds.length > 0) {
        await db.delete(atelierContractDocuments).where(inArray(atelierContractDocuments.contractId, createdContractIds));
        await db.delete(atelierContractRecords).where(inArray(atelierContractRecords.id, createdContractIds));
      }
      const libDocs = await db
        .select({ id: atelierDocuments.id })
        .from(atelierDocuments)
        .where(like(atelierDocuments.notes, `%${createdContractIds[0] ?? "none"}%`));
      if (libDocs.length > 0) {
        const ids = libDocs.map((d: any) => d.id);
        await db.delete(atelierDocumentVersions).where(inArray(atelierDocumentVersions.documentId, ids));
        await db.delete(atelierDocuments).where(inArray(atelierDocuments.id, ids));
      }
      if (attachmentIds.length > 0) {
        await db.delete(atelierCliAttachments).where(inArray(atelierCliAttachments.id, attachmentIds));
      }
      const ctr = await db
        .select({ id: atelierContractors.id, personId: atelierContractors.personId })
        .from(atelierContractors)
        .where(eq(atelierContractors.email, partnerEmail));
      if (ctr.length > 0) {
        await db.delete(atelierContractors).where(inArray(atelierContractors.id, ctr.map((c: any) => c.id)));
        const pids = ctr.map((c: any) => c.personId).filter(Boolean);
        if (pids.length > 0) await db.delete(atelierPersons).where(inArray(atelierPersons.id, pids));
      }
      await db.delete(atelierContractTemplateVersions).where(eq(atelierContractTemplateVersions.id, verId));
      await db.delete(atelierContractTemplates).where(eq(atelierContractTemplates.id, tplId));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `u_${runTag}%`));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, otherId]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
