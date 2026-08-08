/**
 * Task #785 — document chat dead-ends + broken documents link.
 *
 * Pins, at capability level on a scratch DB:
 *   1. document_list misses (engagement / account / legal entity) return
 *      friendly copy with a next step — never raw `not_found` codes alone.
 *   2. Free-text `q` zero-match offers nearest-title candidates (ACL-
 *      filtered before ranking) or a friendly miss; close multi-matches
 *      come back ranked, not silent recency order.
 *   3. delete_my_document miss offers the caller's OWN documents as
 *      candidates (navigateTo:null on the disambiguation), or friendly
 *      copy when the record has none.
 *   4. Save/delete success navigation lands on /me/profile (a real page)
 *      on both clients — no "/me/documents" 404 target remains in the
 *      self-document write surfaces.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/document-chat-miss-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe785_${Date.now()}`;
const ORG = "aico";

async function main() {
  const D = (await import("@workspace/db")) as any;
  const { db, pool, atelierUsers, atelierEmployees, atelierDocuments, atelierPersonDocuments } = D;
  const { eq, inArray } = await import("drizzle-orm");
  // Capability modules register on import.
  await import("../../src/lib/atelier-cli/people-read-capabilities.js");
  await import("../../src/lib/atelier-cli/me-write-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const IDS = {
    fp: `u_${TAG}_fp`,
    emp: `u_${TAG}_emp`,
    roster: `pe_${TAG}_emp`,
    doc1: `doc_${TAG}_1`,
    doc2: `doc_${TAG}_2`,
    pdoc: `pd_${TAG}_1`,
  };

  const ctxFor = (id: string, role: string) => ({
    persona: { id, orgId: ORG, role, name: `p-${role}` },
  });

  try {
    await db
      .insert(atelierUsers)
      .values([
        {
          id: IDS.fp,
          orgId: ORG,
          email: `${TAG}.fp@cognirise.ai`,
          name: "Probe FP",
          initials: "PF",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
        {
          id: IDS.emp,
          orgId: ORG,
          email: `${TAG}.emp@cognirise.ai`,
          name: "Probe Emp",
          initials: "PE",
          role: "employee",
          roleLabel: "Employee",
          title: "Analyst",
          permissions: [],
        },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierEmployees)
      .values([
        {
          id: IDS.roster,
          orgId: ORG,
          userId: IDS.emp,
          fullName: "Probe Emp",
          email: `${TAG}.emp@cognirise.ai`,
          role: "consultant",
          status: "active",
        },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierDocuments)
      .values([
        {
          id: IDS.doc1,
          orgId: ORG,
          title: `Neomprobe Digital Strategy Proposal ${TAG}`,
          category: "proposal",
          uploaderUserId: IDS.fp,
          uploaderLabel: "Probe FP",
          status: "active",
        },
        {
          id: IDS.doc2,
          orgId: ORG,
          title: `Neomprobe Delivery Plan ${TAG}`,
          category: "other",
          uploaderUserId: IDS.fp,
          uploaderLabel: "Probe FP",
          status: "active",
        },
      ] as any)
      .onConflictDoNothing();

    const docList = findByToolName("document_list");
    const delDoc = findByToolName("delete_my_document");
    check("catalog: document_list + delete_my_document registered", !!docList && !!delDoc);
    const fp = ctxFor(IDS.fp, "founding_partner");

    // 1 — relational misses are friendly, never raw codes alone
    const engMiss: any = await docList!.run({ engagementName: `Zqx Missing ${TAG}` }, fp);
    check(
      "785: engagement miss → friendly copy with a next step",
      engMiss?.ok === false && /couldn't find an engagement/i.test(engMiss?.errorMessage ?? "") &&
        /list active engagements/i.test(engMiss?.errorMessage ?? ""),
      engMiss,
    );
    const accMiss: any = await docList!.run({ accountName: `Zqx Missing ${TAG}` }, fp);
    check(
      "785: account miss → friendly copy",
      accMiss?.ok === false && /couldn't find an account/i.test(accMiss?.errorMessage ?? ""),
      accMiss,
    );
    const entMiss: any = await docList!.run({ entityName: `Zqx Missing ${TAG}` }, fp);
    check(
      "785: legal-entity miss → friendly copy",
      entMiss?.ok === false && /couldn't find a legal entity/i.test(entMiss?.errorMessage ?? "") &&
        /list the firm's legal entities/i.test(entMiss?.errorMessage ?? ""),
      entMiss,
    );

    // 2 — q zero-match offers nearest candidates; hopeless q is friendly
    const typo: any = await docList!.run({ q: `Neomprobe Digtal Strategy Proposal ${TAG}` }, fp);
    const typoOpts = typo?.data?.options ?? [];
    check(
      "785: near-typo q → nearest-title candidates include the real doc",
      typo?.ok === true &&
        Array.isArray(typoOpts) &&
        typoOpts.some((o: any) => o.id === IDS.doc1) &&
        /did you mean/i.test(String(typo?.data?.prompt ?? "")),
      JSON.stringify(typo).slice(0, 300),
    );
    // 2a — ACL: a restricted caller must never see a hidden document's
    // title as a nearest-candidate suggestion.
    const empDoc: any = await docList!.run(
      { q: `Neomprobe Digtal Strategy Proposal ${TAG}` },
      ctxFor(IDS.emp, "employee"),
    );
    const empStr = JSON.stringify(empDoc);
    check(
      "785: restricted caller gets no hidden-title suggestions",
      !(empDoc?.data?.options?.length > 0) &&
        !empStr.includes(IDS.doc1) &&
        !empStr.includes(IDS.doc2) &&
        !empStr.includes("Digital Strategy") &&
        !empStr.includes("Delivery Plan"),
      empStr.slice(0, 300),
    );

    const hopeless: any = await docList!.run({ q: "zzqqxxyy totally unrelated 9931" }, fp);
    check(
      "785: hopeless q → friendly miss, no raw code phrasing",
      hopeless?.ok === false &&
        /couldn't find any documents/i.test(hopeless?.errorMessage ?? "") &&
        /browse/i.test(hopeless?.errorMessage ?? ""),
      hopeless,
    );

    // 2b — multi-match q returns ranked candidates (closest title first)
    const multi: any = await docList!.run({ q: "Neomprobe" }, fp);
    const multiItems = (multi?.data?.items ?? []) as any[];
    check(
      "785: multi-match q → both docs returned",
      multi?.ok === true && multiItems.filter((i) => [IDS.doc1, IDS.doc2].includes(i.id)).length === 2,
      JSON.stringify(multi).slice(0, 300),
    );
    const rankedQ: any = await docList!.run({ q: `Neomprobe Delivery Plan` }, fp);
    const rankedItems = (rankedQ?.data?.items ?? []) as any[];
    check(
      "785: close-title q ranks the closest match first",
      rankedQ?.ok === true && rankedItems.length >= 1 && rankedItems[0]?.id === IDS.doc2,
      JSON.stringify(rankedQ).slice(0, 300),
    );

    // 3 — delete miss offers own docs as candidates, then friendly when none
    await db
      .insert(atelierPersonDocuments)
      .values([
        {
          id: IDS.pdoc,
          orgId: ORG,
          personType: "employee",
          personId: IDS.roster,
          kind: "id",
          title: `Old Visa ${TAG}`,
        },
      ] as any)
      .onConflictDoNothing();
    const emp = ctxFor(IDS.emp, "employee");
    const missWithDocs: any = await delDoc!.run({ documentId: "pd_bogus_785" }, emp);
    check(
      "785: delete miss → own-document candidates (navigateTo null)",
      missWithDocs?.ok === true &&
        (missWithDocs?.data?.options ?? []).some((o: any) => o.id === IDS.pdoc) &&
        missWithDocs?.data?.navigateTo === null &&
        missWithDocs?.disambiguation?.field === "documentId",
      JSON.stringify(missWithDocs).slice(0, 300),
    );

    // 4 — delete success navigates to a real page (/me/profile)
    const delOk: any = await delDoc!.run({ documentId: IDS.pdoc, confirm: true }, emp);
    check(
      "785: delete success navigates to /me/profile",
      delOk?.ok === true &&
        delOk?.data?.navigateTo?.path === "/me/profile" &&
        delOk?.data?.href === "/me/profile",
      JSON.stringify(delOk).slice(0, 300),
    );
    const missNoDocs: any = await delDoc!.run({ documentId: "pd_bogus_785" }, emp);
    check(
      "785: delete miss with empty record → friendly copy",
      missNoDocs?.ok === false &&
        /couldn't find that document/i.test(missNoDocs?.errorMessage ?? "") &&
        /don't have any personal documents/i.test(missNoDocs?.errorMessage ?? ""),
      missNoDocs,
    );

    // 5 — static pin: no self-document write surface targets /me/documents
    const src = readFileSync(
      fileURLToPath(new URL("../../src/lib/atelier-cli/me-write-capabilities.ts", import.meta.url)),
      "utf8",
    );
    check(
      "785: no '/me/documents' navigation target remains in self-doc writes",
      !src.includes('"/me/documents"'),
    );
  } finally {
    try {
      const { eq: _eq } = await import("drizzle-orm");
      await db.delete(atelierPersonDocuments).where(eq(atelierPersonDocuments.id, IDS.pdoc));
      await db.delete(atelierDocuments).where(inArray(atelierDocuments.id, [IDS.doc1, IDS.doc2]));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, IDS.roster));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [IDS.fp, IDS.emp]));
      await pool.end();
    } catch (e) {
      console.error("cleanup failed", e);
    }
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
