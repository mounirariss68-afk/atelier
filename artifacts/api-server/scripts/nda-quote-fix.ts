/**
 * Task #330 one-off — fix the "NDA — Contractors, Employees & Interns"
 * template (ctpl_mrs8gqdq_xh9klm):
 *   1. Patch the stored docx blob: remove the stray outer straight quotes
 *      around the Receiving Party summary line.
 *   2. Mark the reference_number field role "reference" in the stored
 *      field schema.
 *   3. Regenerate the draft ctr_mrsdu29l_28xr7i so the corrected line and
 *      a real reference number appear (audited, values carried over).
 */
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { db, atelierContractTemplateVersions, atelierContractRecords } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  loadContractBytes,
  storeContractBytes,
  extractDocxText,
  fillXmlPart,
  fillDocxTemplate,
  findMissingPlaceholders,
  addContractDocument,
  auditContractEntity,
  normalizeFieldSchema,
  DOCX_MIME,
} from "../src/lib/atelier-contracts.js";
import {
  allocateReferenceSeries,
  formatReferenceValue,
} from "../src/lib/atelier-contract-service.js";

const VERSION_ID = "ctv_mrs8gqdq_32vt4s";
const TEMPLATE_ID = "ctpl_mrs8gqdq_xh9klm";
const CONTRACT_ID = "ctr_mrsdu29l_28xr7i";
const BAD_LINE =
  '"[Full Legal Name] — [Passport / Emirates ID No.] — [Address] ("the Receiving Party")"';
const GOOD_LINE =
  '[Full Legal Name] — [Passport / Emirates ID No.] — [Address] ("the Receiving Party")';
const ACTOR = { id: "system", label: "System (Task #330 fix)" };

const [version] = await db
  .select()
  .from(atelierContractTemplateVersions)
  .where(eq(atelierContractTemplateVersions.id, VERSION_ID));
if (!version) throw new Error("version not found");

// --- 1. patch the blob ---
const bytes = await loadContractBytes(version.blobRef);
if (!bytes) throw new Error("template blob missing");
const textBefore = await extractDocxText(bytes);
if (!textBefore.includes(BAD_LINE)) {
  console.log("Blob already clean — skipping docx patch.");
} else {
  const zip = await JSZip.loadAsync(bytes);
  const partNames = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(n),
  );
  let patched = 0;
  for (const name of partNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const { xml: nextXml, replaced } = fillXmlPart(xml, [
      { placeholder: BAD_LINE, value: GOOD_LINE },
    ]);
    if (replaced.size > 0) {
      zip.file(name, nextXml);
      patched++;
    }
  }
  if (patched === 0) throw new Error("stray-quote line not found in any XML part");
  const fixed = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })) as Buffer;
  // verify: text fixed + every placeholder still substitutable
  const textAfter = await extractDocxText(fixed);
  if (textAfter.includes(BAD_LINE)) throw new Error("bad line still present after patch");
  if (!textAfter.includes(GOOD_LINE)) throw new Error("corrected line missing after patch");
  const missing = await findMissingPlaceholders(
    fixed,
    version.fieldSchema.map((f) => f.placeholder),
  );
  if (missing.length > 0) throw new Error(`placeholders lost by patch: ${missing.join(", ")}`);
  const { blobRef, sha256 } = await storeContractBytes(fixed);
  await db
    .update(atelierContractTemplateVersions)
    .set({ blobRef, sha256, sizeBytes: fixed.length })
    .where(eq(atelierContractTemplateVersions.id, VERSION_ID));
  console.log(`Patched docx blob: ${version.blobRef} -> ${blobRef}`);
}

// --- 2. stamp role "reference" on reference_number ---
const [v2] = await db
  .select()
  .from(atelierContractTemplateVersions)
  .where(eq(atelierContractTemplateVersions.id, VERSION_ID));
const schema = v2.fieldSchema.map((f) =>
  f.key === "reference_number" ? { ...f, role: "reference" as const } : f,
);
const normalized = normalizeFieldSchema(schema);
const refField = normalized.find((f) => f.key === "reference_number");
if (refField?.role !== "reference") throw new Error("reference_number role not set");
await db
  .update(atelierContractTemplateVersions)
  .set({ fieldSchema: normalized })
  .where(eq(atelierContractTemplateVersions.id, VERSION_ID));
await auditContractEntity({
  entityType: "atelier_contract_template",
  entityId: TEMPLATE_ID,
  actorType: "system",
  actorId: ACTOR.id,
  actorLabel: ACTOR.label,
  action: "template.fix",
  payload: {
    versionId: VERSION_ID,
    changes: [
      "Removed stray outer quotes from the Receiving Party summary line in the stored docx.",
      "Classified reference_number as role 'reference' so a number is auto-assigned at prepare time.",
    ],
  },
  summary:
    "Fixed NDA template: stray quotes removed from Receiving Party line; reference number field now auto-assigned.",
});
console.log("Field schema updated: reference_number role=reference");

// --- 3. regenerate the affected draft ---
const [contract] = await db
  .select()
  .from(atelierContractRecords)
  .where(eq(atelierContractRecords.id, CONTRACT_ID));
if (!contract) throw new Error("contract not found");
if (!["draft", "out_for_review"].includes(contract.status)) {
  throw new Error(`contract not editable (status ${contract.status})`);
}
const values: Record<string, string> = { ...(contract.fieldValues ?? {}) };
for (const f of normalized.filter((x) => x.role === "reference")) {
  const cur = values[f.key];
  if (cur == null || cur === "" || cur === f.placeholder) {
    const year = new Date().getFullYear();
    const series = await allocateReferenceSeries({
      orgId: contract.orgId,
      templateId: TEMPLATE_ID,
      year,
    });
    values[f.key] = formatReferenceValue(f.placeholder, year, series);
    console.log(`Assigned reference: ${f.key} = ${values[f.key]}`);
  }
}
const [v3] = await db
  .select()
  .from(atelierContractTemplateVersions)
  .where(eq(atelierContractTemplateVersions.id, VERSION_ID));
const templateBytes = await loadContractBytes(v3.blobRef);
if (!templateBytes) throw new Error("patched template blob missing");
const draft = await fillDocxTemplate({ templateBytes, fields: v3.fieldSchema, values });
const draftText = await extractDocxText(draft);
if (/"Nazgul Nejmi — /.test(draftText)) throw new Error("draft still shows stray opening quote");
if (draftText.includes("[CGNR-NDA-U-")) throw new Error("draft still shows raw reference placeholder");
if (!draftText.includes(values.reference_number)) throw new Error("reference number missing in draft");
const sha = createHash("sha256").update(draft).digest("hex").slice(0, 12);
const doc = await addContractDocument({
  contractId: contract.id,
  kind: "generated_draft",
  fileName: `${contract.title.replace(/[^\w.\- ]+/g, "_")}.docx`,
  mime: DOCX_MIME,
  bytes: draft,
  actor: ACTOR,
});
await db
  .update(atelierContractRecords)
  .set({ fieldValues: values, currentDocumentId: doc.id, updatedAt: new Date() })
  .where(eq(atelierContractRecords.id, contract.id));
await auditContractEntity({
  entityType: "atelier_contract_record",
  entityId: contract.id,
  actorType: "system",
  actorId: ACTOR.id,
  actorLabel: ACTOR.label,
  action: "contract.regenerate",
  payload: {
    reason: "Task #330 — corrected Receiving Party line and assigned reference number",
    values: { reference_number: values.reference_number },
  },
  summary: `Regenerated draft for contract "${contract.title}" with corrected text and reference ${values.reference_number}`,
});
console.log(`Regenerated draft doc ${doc.id} (sha ${sha}); reference ${values.reference_number}`);
process.exit(0);
