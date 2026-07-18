/**
 * Task #159 — chat capability probe for contract_prepare.
 *
 * Deterministic (no LLM, no HTTP): drives the capability handler
 * directly and pins the two rerun paths the chat protocol uses:
 *
 *   1. preview → confirm: the confirmation `pending.input` carries the
 *      resolved counterparty as an ID (+ kind) — the rerun must
 *      resolve that ID directly (person, contact, and account).
 *   2. clarification → rerun: `partial` also carries IDs; answering the
 *      missing-value question and re-running with the partial must
 *      commit successfully.
 *
 * Regression pinned: resolveCounterpartyByName previously only did a
 * name search, so ID-carrying reruns failed with counterparty_not_found
 * for person counterparties.
 *
 * Run: pnpm --filter @workspace/api-server test:contract-capabilities
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
    atelierContacts,
    atelierAccounts,
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

  const prepare = findByToolName("contract_prepare");
  if (!prepare) throw new Error("contract_prepare capability not registered");

  const runTag = `probe159cap_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const empId = `emp_${runTag}`;
  const contactId = `ct_${runTag}`;
  const accountId = `acc_${runTag}`;
  const tplId = `ctpl_${runTag}`;
  const verId = `ctv_${runTag}`;
  const persona = { id: fpId, name: "Cap Probe Partner", role: "founding_partner", orgId: "aico" };
  const ctx = { persona } as any;
  const createdContractIds: string[] = [];

  const run = async (input: Record<string, unknown>) => prepare.run(input, ctx);

  try {
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: persona.name,
      initials: "CP",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      fullName: "Zorina Capprobe",
      email: `${runTag}_z@example.test`,
      role: "consultant",
      roleTitle: "Consultant",
    } as any);
    await db.insert(atelierAccounts).values({
      id: accountId,
      orgId: "aico",
      name: `Capprobe Holdings ${runTag}`,
      country: "AE",
      sector: "Technology",
    } as any);
    await db.insert(atelierContacts).values({
      id: contactId,
      orgId: "aico",
      accountId,
      fullName: "Quintus Capprobe",
      email: `${runTag}_q@example.test`,
    } as any);

    // Active reviewed template with a real .docx blob.
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("NDA for [COUNTERPARTY_NAME].")] }),
            new Paragraph({ children: [new TextRun("Fee: [FEE_AMOUNT].")] }),
          ],
        },
      ],
    });
    const bytes = Buffer.from(await Packer.toBuffer(doc));
    const { blobRef, sha256 } = await storeContractBytes(bytes);
    const fieldSchema = [
      {
        key: "counterparty_name",
        label: "Counterparty name",
        placeholder: "[COUNTERPARTY_NAME]",
        dataType: "text",
        autoFill: "counterparty_name",
        required: true,
      },
      {
        key: "fee",
        label: "Fee",
        placeholder: "[FEE_AMOUNT]",
        dataType: "money",
        autoFill: "none",
        required: true,
      },
    ];
    await db.insert(atelierContractTemplates).values({
      id: tplId,
      orgId: "aico",
      name: `Capprobe NDA ${runTag}`,
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
      fileName: "capprobe.docx",
      sizeBytes: bytes.length,
      sha256,
      blobRef,
      fieldSchema,
      fieldStatus: "reviewed",
      createdBy: fpId,
    } as any);

    // ---- 1. preview → confirm (person counterparty, ID rerun) ----
    const preview: any = await run({
      template: "Capprobe NDA",
      counterparty: "Zorina Capprobe",
      values: { fee: "AED 9,000" },
    });
    check("preview ok", preview?.ok === true && preview?.data?.stage === "preview", preview);
    const pending = preview?.confirmation?.pending;
    check("pending.input carries counterparty ID", pending?.input?.counterparty === empId, pending);
    const commit: any = await run(pending.input);
    check("confirm rerun commits (person by ID)", commit?.ok === true && !!commit?.data?.id, commit);
    if (commit?.data?.id) createdContractIds.push(commit.data.id);
    check(
      "committed counterparty is the person",
      commit?.data?.contract?.counterparty === "Zorina Capprobe",
      commit?.data?.contract,
    );

    // ---- 2. clarification → rerun (partial carries IDs) ----
    const clarify: any = await run({
      template: tplId,
      counterparty: "Quintus Capprobe",
      counterpartyKind: "contact",
    });
    check(
      "missing value triggers clarification",
      clarify?.ok === false &&
        clarify?.errorCode === "missing_required_fields" &&
        clarify?.clarification?.partial?.counterparty === contactId,
      clarify,
    );
    const partial = clarify?.clarification?.partial ?? {};
    const answered: any = await run({
      ...partial,
      values: { ...(partial.values ?? {}), fee: "AED 5,500" },
      confirm: true,
    });
    check("clarification rerun commits (contact by ID)", answered?.ok === true && !!answered?.data?.id, answered);
    if (answered?.data?.id) createdContractIds.push(answered.data.id);

    // ---- 3. account counterparty by explicit ID ----
    const accCommit: any = await run({
      template: tplId,
      counterparty: accountId,
      counterpartyKind: "account",
      values: { fee: "AED 1" },
      confirm: true,
    });
    check("account resolved directly by ID", accCommit?.ok === true, accCommit);
    if (accCommit?.data?.id) createdContractIds.push(accCommit.data.id);

    // ---- 4. unknown name still fails loudly ----
    const nf: any = await run({ template: tplId, counterparty: "Nobody Nowhere Xyz" });
    check("unknown counterparty -> counterparty_not_found", nf?.ok === false && nf?.errorCode === "counterparty_not_found", nf);
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
      await db.delete(atelierContacts).where(eq(atelierContacts.id, contactId));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, accountId));
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
