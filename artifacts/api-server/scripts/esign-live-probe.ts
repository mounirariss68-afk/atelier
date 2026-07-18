/**
 * Task #110 — Live DocuSeal end-to-end probe (temporary).
 *
 * Exercises the REAL DocuSeal API with the production code paths:
 *   1. Upload a small PDF into the Document Library (createDocument).
 *   2. sendSignatureRequest → live template + submission (email sent).
 *   3. Complete the submitter via the DocuSeal API (stand-in for the
 *      human clicking the email link).
 *   4. syncSignatureRequest → expect completed + signed PDF (+ audit
 *      trail when exposed) archived into the Document Library as
 *      category "contract".
 *   5. Clean up every row + blob + DocuSeal template it created.
 */
import { eq, inArray, like } from "drizzle-orm";
import {
  db,
  atelierSignatureRequests,
  atelierSignatureSigners,
  atelierDocuments,
  atelierAuditEvents,
} from "@workspace/db";
import { createDocument, purgeDocument } from "../src/lib/atelier-documents.js";
import {
  sendSignatureRequest,
  syncSignatureRequest,
} from "../src/lib/atelier-esign.js";
import { docusealBaseUrl, docusealConfigured } from "../src/lib/docuseal.js";

const ACTOR = { id: "p_mounir_ariss", name: "Mounir Ariss" };
const ORG = "aico";
const TAG = "__esignprobe110";
const SIGNER_EMAIL = "cognirise.esign.probe@example.com";

function minimalPdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

async function docusealApi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${docusealBaseUrl()}${path}`, {
    method,
    headers: {
      "X-Auth-Token": process.env.DOCUSEAL_API_KEY!.trim(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  if (!docusealConfigured()) throw new Error("DOCUSEAL_API_KEY not set");
  console.log(`[probe] DocuSeal base: ${docusealBaseUrl()}`);

  const createdDocIds: string[] = [];
  let requestId: string | null = null;
  let templateId: string | null = null;

  try {
    // 1. Library PDF
    const pdf = minimalPdf(`Cognirise live e-sign probe ${TAG}`);
    const up = await createDocument({
      orgId: ORG,
      uploader: ACTOR,
      title: `Live e-sign probe agreement ${TAG}`,
      category: "contract",
      accountId: null,
      engagementId: null,
      notes: "Temporary Task #110 live-verification document.",
      fileName: `esign_probe_${TAG}.pdf`,
      mime: "application/pdf",
      bytes: pdf,
    });
    if (!up.ok) throw new Error(`upload failed: ${up.reason}`);
    createdDocIds.push(up.document.id);
    console.log(`[probe] uploaded library doc ${up.document.id} (rag: ${JSON.stringify(up.rag)})`);

    // 2. Live send
    const sent = await sendSignatureRequest({
      orgId: ORG,
      actor: ACTOR,
      title: `Live e-sign probe ${TAG}`,
      message: "Automated live verification of the e-sign pipeline. Safe to ignore.",
      documentId: up.document.id,
      documentVersionId: up.version.id,
      fileName: `esign_probe_${TAG}.pdf`,
      pdfBytes: pdf,
      signers: [{ name: "Probe Signer", email: SIGNER_EMAIL }],
    });
    requestId = sent.request.id;
    templateId = sent.request.docusealTemplateId;
    console.log(
      `[probe] sent: request=${sent.request.id} status=${sent.request.status} ` +
        `submission=${sent.request.docusealSubmissionId} template=${templateId} ` +
        `submitter=${sent.signers[0]?.docusealSubmitterId}`,
    );
    if (sent.request.status !== "sent") throw new Error("expected status 'sent'");
    if (!sent.signers[0]?.docusealSubmitterId) throw new Error("no submitter id recorded");

    // 3. Interim sync (still open)
    const mid = await syncSignatureRequest(requestId);
    console.log(`[probe] interim sync: status=${mid.request.status} changed=${mid.changed}`);

    // 4. Complete the submitter via DocuSeal API (simulates the signer)
    await docusealApi("PUT", `/submitters/${sent.signers[0].docusealSubmitterId}`, {
      completed: true,
    });
    console.log("[probe] submitter marked completed via DocuSeal API");

    // 5. Final sync → completed + archive
    let final = await syncSignatureRequest(requestId);
    for (let i = 0; i < 5 && final.request.status !== "completed"; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      final = await syncSignatureRequest(requestId);
    }
    console.log(
      `[probe] final sync: status=${final.request.status} signedDoc=${final.request.signedDocumentId} lastSyncError=${final.request.lastSyncError}`,
    );
    if (final.request.status !== "completed") throw new Error("request did not complete");
    if (!final.request.signedDocumentId) throw new Error("signed PDF was not archived");

    // 6. Verify archived library docs
    const archived = await db
      .select()
      .from(atelierDocuments)
      .where(like(atelierDocuments.title, `%${TAG}%`));
    for (const d of archived) {
      console.log(`[probe] library doc: ${d.id} "${d.title}" category=${d.category} status=${d.status}`);
      if (!createdDocIds.includes(d.id)) createdDocIds.push(d.id);
    }
    const signedDoc = archived.find((d) => d.id === final.request.signedDocumentId);
    if (!signedDoc || signedDoc.category !== "contract") {
      throw new Error("signed doc missing or not category=contract");
    }

    // 7. Signer + audit checks
    const signers = await db
      .select()
      .from(atelierSignatureSigners)
      .where(eq(atelierSignatureSigners.requestId, requestId));
    console.log(`[probe] signer status=${signers[0]?.status} completedAt=${signers[0]?.completedAt}`);
    const audits = await db
      .select({ action: atelierAuditEvents.action, summary: atelierAuditEvents.payloadSummary })
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, requestId));
    for (const a of audits) console.log(`[probe] audit: ${a.action} — ${a.summary}`);

    console.log("[probe] ✅ LIVE E2E PASSED");
  } finally {
    // Cleanup — local rows + blobs
    try {
      if (requestId) {
        await db.delete(atelierSignatureSigners).where(eq(atelierSignatureSigners.requestId, requestId));
        await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, requestId));
        await db.delete(atelierSignatureRequests).where(eq(atelierSignatureRequests.id, requestId));
      }
      for (const id of createdDocIds) {
        await purgeDocument({ orgId: ORG, documentId: id, actor: ACTOR, silent: true }).catch(
          async (e: unknown) => {
            console.error(`[probe] purge failed for ${id}: ${e}`);
          },
        );
      }
      // audit rows for purged docs
      const leftover = await db
        .select({ id: atelierDocuments.id })
        .from(atelierDocuments)
        .where(like(atelierDocuments.title, `%${TAG}%`));
      const live = await db
        .select({ id: atelierDocuments.id, status: atelierDocuments.status })
        .from(atelierDocuments)
        .where(inArray(atelierDocuments.id, leftover.length ? leftover.map((d) => d.id) : ["__none"]));
      const notDeleted = live.filter((d) => d.status !== "deleted");
      if (notDeleted.length) console.error(`[probe] LEFTOVER live docs: ${notDeleted.map((d) => d.id)}`);
      // DocuSeal side: archive the template (submission is completed; archive too)
      if (templateId) {
        await docusealApi("DELETE", `/templates/${templateId}`).catch?.(() => {});
        console.log(`[probe] archived DocuSeal template ${templateId}`);
      }
    } catch (err) {
      console.error(`[probe] cleanup error: ${err}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[probe] FAILED: ${err instanceof Error ? err.stack : err}`);
    process.exit(1);
  },
);
