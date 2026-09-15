/**
 * Explicitly authorized, sequential actual NDA request.
 * Run from artifacts/api-server with --send. Reruns inspect, never resend.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, pool, atelierUsers, atelierSignatureRequests, atelierSignatureSigners } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createDocument } from "../src/lib/atelier-documents";
import { sendSignatureRequest, syncSignatureRequest } from "../src/lib/atelier-esign";
import { getSubmission } from "../src/lib/docuseal";

const title = "Cognirise / Antur — Mutual Non-Disclosure Agreement — CGNR-NDA-9-26-1";
async function report(id: string) {
  await syncSignatureRequest(id);
  const [request] = await db.select().from(atelierSignatureRequests).where(eq(atelierSignatureRequests.id,id));
  const submission = await getSubmission(Number(request.docusealSubmissionId));
  const signers = await db.select().from(atelierSignatureSigners).where(eq(atelierSignatureSigners.requestId,id));
  console.log({
    requestId:id, status:request.status, syncError:request.lastSyncError,
    signers:signers.sort((a,b)=>a.signingOrder-b.signingOrder).map(s=>({
      order:s.signingOrder,name:s.name,email:s.email,status:s.status,invite:s.inviteEmailStatus,
      providerStatus:submission.submitters?.find(p=>String(p.id)===s.docusealSubmitterId)?.status,
    })),
  });
}
async function main() {
  const [actor] = await db.select().from(atelierUsers).where(eq(atelierUsers.email,"mounir@cognirise.ai"));
  if (!actor || actor.role!=="founding_partner") throw new Error("Expected requester not found");
  const existing = await db.select().from(atelierSignatureRequests).where(and(
    eq(atelierSignatureRequests.orgId,actor.orgId),eq(atelierSignatureRequests.title,title)));
  if (existing.length) {
    for (const row of existing) await report(row.id);
    return;
  }
  if (!process.argv.includes("--send")) throw new Error("Explicit --send required");
  const pdfBytes = await readFile("../../attached_assets/Cognirise-Antur_Dual_2026-NDA_vCogniSigned_1789466544265.pdf");
  const fileName = "Cognirise-Antur-NDA-CGNR-NDA-9-26-1.pdf";
  const uploaded = await createDocument({
    orgId:actor.orgId,uploader:actor,title,category:"contract",aiRetrieval:false,
    notes:"Actual NDA signing explicitly authorized by requester. Uploaded PDF used without conversion or watermark. Gokhan signs first for Cognitive Rise; Miray Sozen second for Antur.",
    fileName,mime:"application/pdf",bytes:pdfBytes,
  });
  if (!uploaded.ok) throw new Error(`Upload failed: ${uploaded.reason}`);
  const result = await sendSignatureRequest({
    orgId:actor.orgId,actor,title,
    message:"Please review and sign the attached mutual non-disclosure agreement between Cognitive Rise Artificial Intelligence Developing Services L.L.C and Antur Turizm Anonim Şirketi. Gökhan Güney signs first for Cognitive Rise. Miray Sozen will be invited to sign for Antur after Gökhan completes signing.",
    documentId:uploaded.document.id,documentVersionId:uploaded.version.id,
    fileName,pdfBytes,
    signers:[{name:"Gökhan Güney",email:"gokhan@cognirise.ai"},{name:"Miray Sozen",email:"miray.sozen@antur.com.tr"}],
    placements:[
      {page:8,x:48/612,y:658/792,w:240/612,h:47/792},
      {page:8,x:355/612,y:658/792,w:205/612,h:47/792},
    ],
    extraFields:[
      {page:8,signerIndex:1,type:"text",label:"Full name and title",x:355/612,y:711/792,w:205/612,h:17/792},
      {page:8,signerIndex:1,type:"date",label:"Date signed",x:355/612,y:730/792,w:150/612,h:17/792},
    ],
    clientPageCount:8,
  });
  console.log({createdRequestId:result.request.id,sourceSha256:createHash("sha256").update(pdfBytes).digest("hex"),
    firstInvite:result.signers[0]?.inviteEmailStatus});
  await report(result.request.id);
}
main().then(()=>pool.end()).catch(e=>{console.error(e.message);process.exit(1)});