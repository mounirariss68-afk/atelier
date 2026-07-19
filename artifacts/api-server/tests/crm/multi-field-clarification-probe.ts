/**
 * Task #267 — multi-field clarification probe.
 *
 * Deterministic (no LLM, no HTTP). Pins:
 *   1. contract_prepare with 2+ missing required values emits
 *      clarification.fields (one entry per missing field, dotted
 *      "values.<key>" names, labels from fieldSchema, hint from note).
 *   2. mergeClarificationAnswer expands dotted paths into nested
 *      objects (and keeps non-dotted names top-level).
 *   3. All-values-at-once continuation: merging every provided field
 *      into partial and re-running commits in one round-trip.
 *   4. Partial answers: merging a subset re-runs and yields a NARROWED
 *      clarification listing only the still-missing fields.
 *   5. sanitizeClarificationFields drops malformed entries.
 *
 * Run: npx tsx tests/crm/multi-field-clarification-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
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
  } = D as any;
  const { eq, inArray } = await import("drizzle-orm");
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const { storeContractBytes } = await import("../../src/lib/atelier-contracts.js");
  await import("../../src/lib/atelier-cli/contract-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
  const { mergeClarificationAnswer, sanitizeClarificationFields } = await import(
    "../../src/lib/atelier-cli/index.js"
  );

  // ---- pure unit checks (no DB needed) ----
  const m1 = mergeClarificationAnswer({ kind: "x" }, "values.fee", "AED 5");
  check(
    "merge expands dotted path",
    (m1 as any).values?.fee === "AED 5" && !("values.fee" in m1) && m1.kind === "x",
    m1,
  );
  const m2 = mergeClarificationAnswer(
    { values: { a: "1" } },
    "values.b",
    "2",
  ) as any;
  check("merge preserves nested siblings", m2.values?.a === "1" && m2.values?.b === "2", m2);
  const m3 = mergeClarificationAnswer({}, "accountName", "Acme") as any;
  check("non-dotted stays top-level", m3.accountName === "Acme", m3);
  const s1 = sanitizeClarificationFields([
    { field: "values.fee", label: "Fee", hint: "AED" },
    { field: "" },
    { label: "no field" },
    "junk",
    { field: "values.term" },
  ]);
  check(
    "sanitize keeps valid entries, defaults label",
    s1?.length === 2 &&
      s1[0].field === "values.fee" &&
      s1[0].hint === "AED" &&
      s1[1].label === "values.term",
    s1,
  );
  check("sanitize null on garbage", sanitizeClarificationFields("nope") === null, null);

  const prepare = findByToolName("contract_prepare");
  if (!prepare) throw new Error("contract_prepare capability not registered");

  const runTag = `probe267_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const empId = `emp_${runTag}`;
  const tplId = `ctpl_${runTag}`;
  const verId = `ctv_${runTag}`;
  const persona = { id: fpId, name: "Multi Probe Partner", role: "founding_partner", orgId: "aico" };
  const ctx = { persona } as any;
  const createdContractIds: string[] = [];
  const run = async (input: Record<string, unknown>) => prepare.run(input, ctx);

  try {
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: persona.name,
      initials: "MP",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      fullName: "Yolanda Multiprobe",
      email: `${runTag}_y@example.test`,
      role: "consultant",
      roleTitle: "Consultant",
    } as any);

    // Template with THREE required non-autofill fields.
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("Fee [FEE_AMOUNT] Term [TERM_MONTHS] City [CITY_NAME]")] }),
          ],
        },
      ],
    });
    const bytes = Buffer.from(await Packer.toBuffer(doc));
    const { blobRef, sha256 } = await storeContractBytes(bytes);
    const fieldSchema = [
      { key: "fee", label: "Fee", placeholder: "[FEE_AMOUNT]", dataType: "money", autoFill: "none", required: true, note: "e.g. AED 5,000" },
      { key: "term", label: "Term (months)", placeholder: "[TERM_MONTHS]", dataType: "text", autoFill: "none", required: true },
      { key: "city", label: "City", placeholder: "[CITY_NAME]", dataType: "text", autoFill: "none", required: true },
    ];
    await db.insert(atelierContractTemplates).values({
      id: tplId,
      orgId: "aico",
      name: `Multiprobe NDA ${runTag}`,
      contractType: "individual_nda",
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
      fileName: "multiprobe.docx",
      sizeBytes: bytes.length,
      sha256,
      blobRef,
      fieldSchema,
      fieldStatus: "reviewed",
      createdBy: fpId,
    } as any);

    // ---- 1. multi-field clarification emitted ----
    const clarify: any = await run({ template: tplId, counterparty: "Yolanda Multiprobe" });
    const fields = clarify?.clarification?.fields ?? [];
    check(
      "3 missing values -> 3 fields",
      clarify?.ok === false &&
        clarify?.errorCode === "missing_required_fields" &&
        fields.length === 3,
      clarify?.clarification,
    );
    check(
      "fields carry dotted names + labels + hint",
      fields[0]?.field === "values.fee" &&
        fields[0]?.label === "Fee" &&
        fields[0]?.hint === "e.g. AED 5,000" &&
        fields[1]?.field === "values.term" &&
        fields[2]?.label === "City",
      fields,
    );
    check(
      "question mentions all labels",
      typeof clarify?.clarification?.question === "string" &&
        clarify.clarification.question.includes("Fee") &&
        clarify.clarification.question.includes("City"),
      clarify?.clarification?.question,
    );

    // ---- 2. all-values-at-once merge -> commit ----
    const partial = clarify?.clarification?.partial ?? {};
    let merged: Record<string, unknown> = { ...partial };
    for (const [k, v] of Object.entries({
      "values.fee": "AED 7,000",
      "values.term": "12",
      "values.city": "Dubai",
    })) {
      merged = mergeClarificationAnswer(merged, k, v);
    }
    const commit: any = await run({ ...merged, confirm: true });
    check("all-at-once continuation commits", commit?.ok === true && !!commit?.data?.id, commit);
    if (commit?.data?.id) createdContractIds.push(commit.data.id);

    // ---- 3. partial answer -> narrowed clarification ----
    let partialMerged: Record<string, unknown> = { ...partial };
    partialMerged = mergeClarificationAnswer(partialMerged, "values.fee", "AED 1,000");
    const narrowed: any = await run(partialMerged);
    const nFields = narrowed?.clarification?.fields ?? [];
    check(
      "partial answer -> narrowed to 2 fields",
      narrowed?.ok === false &&
        narrowed?.errorCode === "missing_required_fields" &&
        nFields.length === 2 &&
        nFields.every((f: any) => f.field !== "values.fee"),
      narrowed?.clarification,
    );
  } finally {
    try {
      if (createdContractIds.length > 0) {
        await db
          .delete(atelierContractDocuments)
          .where(inArray(atelierContractDocuments.contractId, createdContractIds));
        await db
          .delete(atelierContractRecords)
          .where(inArray(atelierContractRecords.id, createdContractIds));
      }
      await db.delete(atelierContractTemplateVersions).where(eq(atelierContractTemplateVersions.id, verId));
      await db.delete(atelierContractTemplates).where(eq(atelierContractTemplates.id, tplId));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASHED", e);
  process.exit(1);
});
