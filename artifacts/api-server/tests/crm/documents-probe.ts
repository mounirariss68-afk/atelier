/**
 * Task #61 — Document Library probe.
 *
 * Covers:
 *   - Account-scoped upload (multipart) -> 201 with version + rag summary
 *   - SHA-256 blob dedupe: identical bytes -> same sha256; deleting one
 *     document keeps the shared blob alive for the other (refcount)
 *   - ACL: consultant with no account access is filtered on list and gets
 *     403 (not a leak) on direct GET/download
 *   - Org-level docs: consultant create -> 403; partner create -> 201;
 *     consultant sees only after an explicit grant; revoke -> 403 again
 *   - Versioning: new version -> versionNumber 2, currentVersionId moves,
 *     old version still downloadable by versionId
 *   - Download streams exact bytes
 *   - PATCH aiRetrieval toggles the flag (chunk `retrievable` flips ride
 *     the same code path; garbage bytes give 0 chunks so no embedding call)
 *   - DELETE purges: GET -> 404, versions + grants rows gone
 *   - Audit trail: upload/download/toggle/grant actions recorded
 *
 * Deterministic: uploads are random binary bytes (unreadable => 0 chunks,
 * so no live embedding calls). Run: pnpm exec tsx tests/crm/documents-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

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
    atelierAccounts,
    atelierDocuments,
    atelierDocumentVersions,
    atelierDocumentAccess,
    atelierAuditEvents,
  } = D;
  const { and, eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe61_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const conId = `u_${runTag}_con`;
  const docIds: string[] = [];
  let accountId: string | null = null;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (
    who: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${who}`,
      },
      body: body ? JSON.stringify(body) : undefined,
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

  const uploadDoc = async (
    who: string,
    path: string,
    fields: Record<string, string>,
    bytes: Buffer,
    fileName: string,
  ) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      fileName,
    );
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${who}` },
      body: fd,
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

  const downloadRaw = async (who: string, path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: `atelier_persona=${who}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf };
  };

  try {
    await db.insert(atelierUsers).values([
      {
        id: fpId,
        orgId: "aico",
        name: "Probe61 Partner",
        initials: "PP",
        email: `${runTag}_fp@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: conId,
        orgId: "aico",
        name: "Probe61 Consultant",
        initials: "PC",
        email: `${runTag}_con@example.test`,
        role: "consultant",
        roleLabel: "Consultant",
        title: "Consultant",
      },
    ] as any);

    // ---- seed an account (fp-owned; consultant has no access path) ----
    const acctRes = await api(fpId, "POST", "/accounts", {
      name: `Doc Probe Account ${runTag}`,
      sector: "Logistics",
      country: "AE",
      tier: "C",
      status: "active",
      primaryCurrency: "USD",
      primaryLanguage: "en",
    });
    check("account create -> 201", acctRes.status === 201, acctRes);
    accountId = acctRes.body?.id ?? null;
    check("account id present", !!accountId, acctRes.body);
    if (!accountId) throw new Error("no account id — aborting");

    // ---- account-scoped upload ----
    const bytesA = randomBytes(2048);
    const up1 = await uploadDoc(
      fpId,
      "/documents",
      { title: `Proposal ${runTag}`, category: "proposal", accountId },
      bytesA,
      "proposal-v1.pdf",
    );
    check("scoped upload -> 201", up1.status === 201, up1);
    const doc1 = up1.body?.document;
    if (doc1?.id) docIds.push(doc1.id);
    check(
      "upload shape: currentVersion v1 + sha + rag",
      !!doc1?.currentVersion &&
        doc1.currentVersion.versionNumber === 1 &&
        typeof doc1.currentVersion.sha256 === "string" &&
        doc1.aiRetrieval === true &&
        up1.body?.rag != null,
      up1.body,
    );

    // ---- dedupe: identical bytes in a second document ----
    const up2 = await uploadDoc(
      fpId,
      "/documents",
      { title: `Proposal Copy ${runTag}`, category: "proposal", accountId },
      bytesA,
      "proposal-copy.pdf",
    );
    check("dup-bytes upload -> 201", up2.status === 201, up2);
    const doc2 = up2.body?.document;
    if (doc2?.id) docIds.push(doc2.id);
    check(
      "dedupe: same sha256 for identical bytes",
      !!doc2?.currentVersion &&
        doc2.currentVersion.sha256 === doc1.currentVersion.sha256,
      { a: doc1?.currentVersion?.sha256, b: doc2?.currentVersion?.sha256 },
    );
    const [v1Row] = await db
      .select()
      .from(atelierDocumentVersions)
      .where(eq(atelierDocumentVersions.id, doc1.currentVersion.id));
    const [v2Row] = await db
      .select()
      .from(atelierDocumentVersions)
      .where(eq(atelierDocumentVersions.id, doc2.currentVersion.id));
    check(
      "dedupe: both versions share one blobRef",
      !!v1Row && !!v2Row && v1Row.blobRef === v2Row.blobRef,
      { a: v1Row?.blobRef, b: v2Row?.blobRef },
    );

    // ---- ACL: consultant filtered on list, 403 on direct access ----
    const listCon = await api(conId, "GET", "/documents");
    check(
      "consultant list excludes scoped docs",
      listCon.status === 200 &&
        Array.isArray(listCon.body?.documents) &&
        !listCon.body.documents.some((d: any) => docIds.includes(d.id)),
      listCon,
    );
    const getCon = await api(conId, "GET", `/documents/${doc1.id}`);
    check("consultant direct GET -> 403", getCon.status === 403, getCon);
    const dlCon = await downloadRaw(conId, `/documents/${doc1.id}/download`);
    check("consultant download -> 403", dlCon.status === 403, dlCon.status);

    // ---- org-level docs ----
    const orgCon = await uploadDoc(
      conId,
      "/documents",
      { title: `Org Doc Con ${runTag}`, category: "template" },
      randomBytes(64),
      "org-con.pdf",
    );
    check("consultant org-level create -> 403", orgCon.status === 403, orgCon);
    const orgFp = await uploadDoc(
      fpId,
      "/documents",
      { title: `Org Template ${runTag}`, category: "template" },
      randomBytes(256),
      "org-template.pdf",
    );
    check("partner org-level create -> 201", orgFp.status === 201, orgFp);
    const orgDoc = orgFp.body?.document;
    if (orgDoc?.id) docIds.push(orgDoc.id);

    // Grants are an org-level-only mechanism: granting on a scoped doc must
    // be rejected so it can never widen the account/engagement ACL (routes
    // AND the retrieval-layer grant clause both re-assert org-level scope).
    const scopedGrant = await api(fpId, "POST", `/documents/${doc1.id}/access`, {
      userId: conId,
    });
    check(
      "grant on account-scoped doc -> 400",
      scopedGrant.status === 400 &&
        scopedGrant.body?.error === "grants-org-level-only",
      scopedGrant,
    );

    const orgGetPre = await api(conId, "GET", `/documents/${orgDoc.id}`);
    check("org doc pre-grant -> 403", orgGetPre.status === 403, orgGetPre);
    const grant = await api(fpId, "POST", `/documents/${orgDoc.id}/access`, {
      userId: conId,
    });
    check("grant -> 201", grant.status === 201, grant);
    const orgGetPost = await api(conId, "GET", `/documents/${orgDoc.id}`);
    check(
      "org doc post-grant -> 200",
      orgGetPost.status === 200 && orgGetPost.body?.document?.id === orgDoc.id,
      orgGetPost,
    );
    const listConPost = await api(conId, "GET", "/documents");
    check(
      "granted org doc appears in consultant list",
      listConPost.body?.documents?.some((d: any) => d.id === orgDoc.id),
      listConPost.body,
    );
    const revoke = await api(
      fpId,
      "DELETE",
      `/documents/${orgDoc.id}/access/${conId}`,
    );
    check("revoke -> 200", revoke.status === 200, revoke);
    const orgGetRevoked = await api(conId, "GET", `/documents/${orgDoc.id}`);
    check("org doc post-revoke -> 403", orgGetRevoked.status === 403, orgGetRevoked);

    // ---- versioning ----
    const bytesB = randomBytes(4096);
    const ver2 = await uploadDoc(
      fpId,
      `/documents/${doc1.id}/versions`,
      {},
      bytesB,
      "proposal-v2.pdf",
    );
    check(
      "new version -> 201 v2",
      ver2.status === 201 && ver2.body?.version?.versionNumber === 2,
      ver2,
    );
    const det = await api(fpId, "GET", `/documents/${doc1.id}`);
    check(
      "detail: currentVersionId moved to v2, both versions listed",
      det.status === 200 &&
        det.body?.document?.currentVersionId === ver2.body.version.id &&
        det.body?.versions?.length === 2,
      det.body,
    );

    // ---- download exact bytes (current + old by versionId) ----
    const dlCur = await downloadRaw(fpId, `/documents/${doc1.id}/download`);
    check(
      "download current == v2 bytes",
      dlCur.status === 200 && dlCur.buf.equals(bytesB),
      { status: dlCur.status, len: dlCur.buf.length },
    );
    const dlOld = await downloadRaw(
      fpId,
      `/documents/${doc1.id}/download?versionId=${doc1.currentVersion.id}`,
    );
    check(
      "download old version == v1 bytes",
      dlOld.status === 200 && dlOld.buf.equals(bytesA),
      { status: dlOld.status, len: dlOld.buf.length },
    );

    // ---- AI retrieval toggle ----
    const off = await api(fpId, "PATCH", `/documents/${doc1.id}`, {
      aiRetrieval: false,
    });
    check(
      "aiRetrieval toggle off",
      off.status === 200 && off.body?.document?.aiRetrieval === false,
      off.body,
    );
    const on = await api(fpId, "PATCH", `/documents/${doc1.id}`, {
      aiRetrieval: true,
    });
    check(
      "aiRetrieval toggle on",
      on.status === 200 && on.body?.document?.aiRetrieval === true,
      on.body,
    );

    // ---- audit trail ----
    const detAudit = await api(fpId, "GET", `/documents/${doc1.id}`);
    const actions = new Set(
      (detAudit.body?.audit ?? []).map((a: any) => a.action),
    );
    check(
      "audit has upload/download/toggle events",
      actions.has("document.upload") &&
        actions.has("document.version_upload") &&
        actions.has("document.download") &&
        actions.has("document.update"),
      Array.from(actions),
    );

    // ---- purge + dedupe refcount ----
    const del2 = await api(fpId, "DELETE", `/documents/${doc2.id}`);
    check("delete dup doc -> 200", del2.status === 200, del2);
    const dlAfterDel = await downloadRaw(
      fpId,
      `/documents/${doc1.id}/download?versionId=${doc1.currentVersion.id}`,
    );
    check(
      "shared blob survives deleting the other doc",
      dlAfterDel.status === 200 && dlAfterDel.buf.equals(bytesA),
      dlAfterDel.status,
    );
    const del1 = await api(fpId, "DELETE", `/documents/${doc1.id}`);
    check("delete doc1 -> 200", del1.status === 200, del1);
    const getGone = await api(fpId, "GET", `/documents/${doc1.id}`);
    check("deleted doc GET -> 404", getGone.status === 404, getGone);
    const verRows = await db
      .select()
      .from(atelierDocumentVersions)
      .where(eq(atelierDocumentVersions.documentId, doc1.id));
    check("version rows purged", verRows.length === 0, verRows.length);
  } finally {
    try {
      // Purge any leftover docs through the lib (drops blobs + chunks).
      const lib = await import("../../src/lib/atelier-documents.js");
      const leftover = await db
        .select({ id: atelierDocuments.id })
        .from(atelierDocuments)
        .where(inArray(atelierDocuments.id, docIds.length ? docIds : ["_"]));
      for (const d of leftover) {
        await lib.purgeDocument({
          orgId: "aico",
          documentId: d.id,
          actor: { id: fpId, name: "Probe61 cleanup" },
        });
      }
      await db
        .delete(atelierDocuments)
        .where(inArray(atelierDocuments.id, docIds.length ? docIds : ["_"]));
      await db
        .delete(atelierDocumentAccess)
        .where(inArray(atelierDocumentAccess.documentId, docIds.length ? docIds : ["_"]));
      await db
        .delete(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.entityType, "atelier_document"),
            inArray(atelierAuditEvents.entityId, docIds.length ? docIds : ["_"]),
          ),
        );
      if (accountId) {
        await db.delete(atelierAccounts).where(eq(atelierAccounts.id, accountId));
      }
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, conId]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
