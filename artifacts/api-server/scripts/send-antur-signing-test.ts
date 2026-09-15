import { readFile } from "node:fs/promises";
import { db, pool, atelierUsers, atelierSignatureRequests, atelierSignatureSigners } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createDocument } from "../src/lib/atelier-documents";
import { sendSignatureRequest, syncSignatureRequest } from "../src/lib/atelier-esign";

const title = "TEST — NOT FOR EXECUTION — Cognirise / Antur NDA";
async function main() {
  const [actor] = await db.select().from(atelierUsers).where(eq(atelierUsers.email, "mounir@cognirise.ai"));
  if (!actor || actor.role !== "founding_partner") throw new Error("Expected requester not found");
  const existing = await db.select().from(atelierSignatureRequests).where(and(
    eq(atelierSignatureRequests.orgId, actor.orgId), eq(atelierSignatureRequests.title, title)));
  if (existing.length) {
    console.log("Existing test request found; no new invitation created.");
    for (const request of existing) {
      await syncSignatureRequest(request.id);
      console.log({requestId: request.id, signers: await db.select({
        order: atelierSignatureSigners.signingOrder, status: atelierSignatureSigners.status,
        invite: atelierSignatureSigners.inviteEmailStatus,
      }).from(atelierSignatureSigners).where(eq(atelierSignatureSigners.requestId,request.id))});
    }
    return;
  }
  if (!process.argv.includes("--send")) throw new Error("Explicit --send required");
  const pdfBytes = await readFile("../../generated/antur-signing-test/Antur-NDA-TEST-NOT-FOR-EXECUTION.pdf");
  const fileName = "Antur-NDA-TEST-NOT-FOR-EXECUTION.pdf";
  const uploaded = await createDocument({
    orgId:actor.orgId,uploader:actor,title,category:"contract",aiRetrieval:false,
    notes:"User-authorized signing test only. Original content preserved with an additional test signature page.",
    fileName,mime:"application/pdf",bytes:pdfBytes,
  });
  if (!uploaded.ok) throw new Error(`Document upload failed: ${uploaded.reason}`);
  const result = await sendSignatureRequest({
    orgId:actor.orgId,actor,title,
    message:"TEST — NOT FOR EXECUTION. This is only an electronic-signature workflow test, not execution of the NDA. Mounir signs first under Antur on the additional test page; Gokhan signs second under Cognitive Rise after Mounir completes.",
    documentId:uploaded.document.id,documentVersionId:uploaded.version.id,fileName,pdfBytes,
    signers:[{name:"Mounir Ariss",email:"mounir@cognirise.ai"},{name:"Gökhan Güney",email:"Gokhan@cognirise.ai"}],
    placements:[{page:11,x:330/612,y:380/792,w:230/612,h:70/792},
      {page:11,x:42/612,y:380/792,w:230/612,h:70/792}],
    clientPageCount:11,
  });
  console.log({requestId:result.request.id,status:result.request.status,
    signers:result.signers.map(s=>({order:s.signingOrder,status:s.status,invite:s.inviteEmailStatus}))});
}
main().then(()=>pool.end()).catch(e=>{console.error(e.message);process.exit(1)});