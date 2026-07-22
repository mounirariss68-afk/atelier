/**
 * Task #514 — Live DocuSeal probe for anchored placements + sendEmail:false.
 * Self-cleaning: archives the submission and template it creates.
 *
 *   1. Take a real converted contract-template PDF (arg 1).
 *   2. extractSignatureAnchors + computeAnchoredBoxes for 2 signers.
 *   3. createTemplateFromPdf with the anchored placements/extra fields
 *      (live Cloud validates pages/coords; stub does not).
 *   4. createSubmission with sendEmail:false — assert submitters come back
 *      with slugs (signing links) and DocuSeal reports no email sent.
 *   5. Archive submission + template.
 */
import { readFileSync } from "node:fs";
import {
  createTemplateFromPdf,
  createSubmission,
  archiveSubmission,
  docusealBaseUrl,
  docusealConfigured,
  defaultSignaturePlacement,
} from "../src/lib/docuseal.js";
import { extractSignatureAnchors, computeAnchoredBoxes } from "../src/lib/esign-anchors.js";

const TAG = "__esignprobe514";

async function main() {
  if (!docusealConfigured()) throw new Error("DOCUSEAL_API_KEY missing");
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error("usage: tsx esign-anchor-live-probe.ts <pdf>");
  const pdfBytes = readFileSync(pdfPath);

  const anchors = await extractSignatureAnchors(pdfBytes);
  if (!anchors) throw new Error("no anchors found in probe PDF");
  const boxes = computeAnchoredBoxes({
    anchors,
    signerCount: 2,
    counterpartyIndex: 1,
    textFieldCount: 1,
    defaultPlacement: defaultSignaturePlacement,
  });
  console.log("anchors page", anchors.page, "columns", anchors.columns.length);
  console.log("placements", JSON.stringify(boxes.placements));
  console.log("dateBoxes", JSON.stringify(boxes.dateBoxes));
  if (boxes.unanchoredSignerIndexes.length > 0) {
    throw new Error(`unanchored signers: ${boxes.unanchoredSignerIndexes.join(",")}`);
  }

  const extraFields = boxes.dateBoxes.map((d) => ({
    signerIndex: d.signerIndex,
    kind: "date" as const,
    page: d.page,
    x: d.x,
    y: d.y,
    w: d.w,
    h: d.h,
  }));

  const tpl = await createTemplateFromPdf({
    name: `Probe ${TAG} ${Date.now()}`,
    fileName: "probe.pdf",
    pdfBytes,
    signerCount: 2,
    lastPageIndex: anchors.page - 1,
    placements: boxes.placements,
    extraFields,
  });
  console.log("template created", tpl.id);

  let submissionId: number | null = null;
  try {
    const sub = await createSubmission({
      templateId: tpl.id,
      signers: [
        { name: `Probe One ${TAG}`, email: `probe1.${TAG}@example.com` },
        { name: `Probe Two ${TAG}`, email: `probe2.${TAG}@example.com` },
      ],
      sendEmail: false,
    });
    submissionId = sub.submissionId;
    console.log("submission", sub.submissionId);
    for (const s of sub.submitters) {
      console.log("submitter", s.email, "slug:", (s as { slug?: string }).slug ?? "(none)");
    }
    const missing = sub.submitters.filter((s) => !(s as { slug?: string }).slug);
    if (sub.submitters.length !== 2) throw new Error("expected 2 submitters");
    if (missing.length > 0) {
      throw new Error(`submitters missing slug: ${missing.map((s) => s.email).join(",")}`);
    }
    console.log("OK: anchored placements accepted + slugs returned with send_email:false");
  } finally {
    if (submissionId != null) {
      await archiveSubmission(submissionId).catch((e) => console.warn("archive sub failed", e));
    }
    const res = await fetch(`${docusealBaseUrl()}/templates/${tpl.id}`, {
      method: "DELETE",
      headers: { "X-Auth-Token": process.env.DOCUSEAL_API_KEY ?? "" },
    });
    console.log("template archive status", res.status);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("PROBE FAILED:", err);
    process.exit(1);
  },
);
