/**
 * Task #1174 — Partner delivery view + shared-document space probe.
 *
 * Boots the real app in-process on an isolated scratch DB and exercises:
 *   Delivery:
 *     1. grant/revoke engagement → portal list reflects; foreign/revoked/
 *        unknown engagement detail → 404 (indistinguishable).
 *     2. Delivery snapshot contains allowlisted fields ONLY — deep-scan the
 *        JSON asserting forbidden keys (charter/valueCase/workstreams/
 *        ownerId/mitigation/criticReadiness/economics/...) are absent.
 *     3. Another firm's grant is invisible.
 *   Documents:
 *     4. Internal share → partner sees + downloads bytes; revoke → drops from
 *        list AND download 404s.
 *     5. Firm B cannot list/download firm A's doc (404 not 403).
 *     6. Partner upload lands pending_review, downloadable by uploader firm,
 *        internal review accept/reject; garbage-magic-byte upload rejected.
 *     7. Preview: delivery + documents GETs 200 + download 200, upload 403
 *        preview-read-only.
 *     8. Notification rows for engagement_shared + document_shared exist.
 *     9. Turkish/Arabic filename downloads with an RFC5987 header (no 500).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/partner-delivery-docs-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.ATELIER_PORTAL_RATE_LIMIT = process.env.ATELIER_PORTAL_RATE_LIMIT ?? "500";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// Forbidden keys that must NEVER appear anywhere in a delivery snapshot.
const FORBIDDEN_KEYS = [
  "charter",
  "workstreams",
  "valueCase",
  "economics",
  "legalEntityId",
  "partnerOwnerId",
  "engagementLeadId",
  "ownerId",
  "ownerName",
  "mitigation",
  "criticReadiness",
  "criticReportSummary",
  "partnerApprovedByUserId",
  "partnerRationale",
  "hypothesisId",
  "attendees",
  "transcriptId",
  "joinUrl",
  "webLink",
  "body",
  "blobRef",
  "sha256",
  "sourceDocumentId",
  "sourceVersionId",
  "createdByUserId",
];

/** Recursively collect every object key present in a JSON value. */
function collectKeys(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) {
    for (const x of v) collectKeys(x, out);
  } else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      out.add(k);
      collectKeys(val, out);
    }
  }
}

const PDF_BYTES = Buffer.from("%PDF-1.4 delivery-probe\n%%EOF\n");
const GARBAGE_BYTES = Buffer.from("not a pdf at all just text");

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierPartnerFirms,
    atelierAccounts,
    atelierEngagements,
    atelierDeliverables,
    atelierRaidItems,
    atelierMeetings,
    atelierPartnerNotifications,
  } = D as any;
  const { eq, and } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const docsMod = await import("../../src/lib/atelier-documents.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const ROOT = `http://127.0.0.1:${port}/api`;
  const ATELIER = `${ROOT}/atelier`;

  const tag = `probe1174_${Date.now()}`;

  const jreq = async (url: string, method: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed, rawHeaders: res.headers };
  };

  // Multipart upload matching the REAL web client contract: field "file" is
  // the binary, optional field "note". Uses native FormData/Blob so a genuine
  // multipart/form-data body (with boundary) hits the route-local multer.
  const mpupload = async (
    url: string,
    fileBytes: Buffer,
    fileName: string,
    note?: string,
    headers?: Record<string, string>,
  ) => {
    const form = new FormData();
    form.append("file", new Blob([fileBytes]), fileName);
    if (note !== undefined) form.append("note", note);
    const res = await fetch(url, { method: "POST", headers: { ...(headers ?? {}) }, body: form });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed, rawHeaders: res.headers };
  };

  const leadId = `u_${tag}_lead`;
  const firmAId = `pfrm_${tag}_a`;
  const userA1Id = `u_${tag}_a1`;
  const firmBId = `pfrm_${tag}_b`;
  const userB1Id = `u_${tag}_b1`;

  const acctId = `acct_${tag}`;
  const engId = `eng_${tag}`;
  const engOtherId = `eng_${tag}_other`;

  const cookieA1 = `atelier_persona=${userA1Id}`;
  const cookieB1 = `atelier_persona=${userB1Id}`;
  const cookieLead = `atelier_persona=${leadId}`;

  try {
    await db.insert(atelierUsers).values([
      { id: leadId, orgId: "aico", name: "P1174 Lead", initials: "LD", email: `${tag}_lead@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Partner" },
      { id: userA1Id, orgId: "aico", name: "P1174 Partner A1", initials: "A1", email: `${tag}_a1@example.test`, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmAId },
      { id: userB1Id, orgId: "aico", name: "P1174 Partner B1", initials: "B1", email: `${tag}_b1@example.test`, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmBId },
    ] as any);
    await db.insert(atelierPartnerFirms).values([
      { id: firmAId, orgId: "aico", name: `P1174 Firm A ${tag}`, partnershipStage: "agreed", agreementStage: "signed" },
      { id: firmBId, orgId: "aico", name: `P1174 Firm B ${tag}`, partnershipStage: "agreed", agreementStage: "signed" },
    ] as any);
    await db.insert(atelierAccounts).values([
      { id: acctId, orgId: "aico", name: `P1174 Acct ${tag}`, sector: "Tech", country: "AE" },
    ] as any);
    await db.insert(atelierEngagements).values([
      {
        id: engId, orgId: "aico", slug: `p1174-eng-${Date.now()}`, name: `P1174 Eng ${tag}`,
        accountId: acctId, legalEntityId: "le_secret", plmStage: "deliver", partnerOwnerId: leadId,
        engagementLeadId: leadId, startDate: "2024-01-01", plannedEndDate: "2025-12-31",
        raidStatus: "amber",
        charter: { objectives: ["SECRET-OBJ"], scope: [], outOfScope: [], successMetrics: [], governance: "SECRET", valueHypothesis: "SECRET" },
        workstreams: [{ name: "SECRET-WS", lead: "x", status: "active" }],
        valueCase: { secret: true },
      },
      {
        id: engOtherId, orgId: "aico", slug: `p1174-eng-other-${Date.now()}`, name: `P1174 Eng OTHER ${tag}`,
        accountId: acctId, plmStage: "mobilize", partnerOwnerId: leadId, engagementLeadId: leadId,
        startDate: "2024-01-01", plannedEndDate: "2025-12-31", raidStatus: "green",
      },
    ] as any);
    await db.insert(atelierDeliverables).values([
      {
        id: `dlv_${tag}`, orgId: "aico", engagementId: engId, type: "diagnostic",
        name: "Diagnostic Readout", status: "in_progress", dueDate: "2025-06-01",
        criticReadiness: "amber", criticReportSummary: "SECRET-CRITIC", partnerRationale: "SECRET",
        hypothesisId: "hyp_secret", clientVisibility: "review",
      },
    ] as any);
    await db.insert(atelierRaidItems).values([
      {
        id: `raid_${tag}_open`, orgId: "aico", engagementId: engId, kind: "risk", severity: "red",
        ownerId: "u_owner_secret", status: "open", dueDate: "2025-05-01",
        description: "Open risk visible", mitigation: "SECRET-MITIGATION",
      },
      {
        id: `raid_${tag}_closed`, orgId: "aico", engagementId: engId, kind: "issue", severity: "green",
        ownerId: "u_owner_secret", status: "closed", description: "Closed issue hidden", mitigation: "x",
      },
    ] as any);
    const todayIso = new Date().toISOString().slice(0, 10);
    const futureIso = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const pastIso = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    await db.insert(atelierMeetings).values([
      {
        id: `mtg_${tag}_future`, orgId: "aico", parentType: "engagement", parentId: engId,
        kind: "steering", title: "Upcoming Steering", date: futureIso,
        attendees: [{ name: "SECRET-ATTENDEE" }], transcriptId: "tr_secret", joinUrl: "https://secret",
      },
      {
        id: `mtg_${tag}_past`, orgId: "aico", parentType: "engagement", parentId: engId,
        kind: "workshop", title: "Past Workshop", date: pastIso, attendees: [],
      },
    ] as any);

    // ---- 1. No grant yet → empty delivery list, detail 404 --------------
    const listEmpty = await jreq(`${ATELIER}/partner-portal/delivery`, "GET", undefined, { cookie: cookieA1 });
    check("delivery list empty before grant (200)", listEmpty.status === 200 && Array.isArray(listEmpty.body?.engagements) && listEmpty.body.engagements.length === 0, listEmpty.body);
    const detailUngranted = await jreq(`${ATELIER}/partner-portal/delivery/${engId}`, "GET", undefined, { cookie: cookieA1 });
    check("ungranted engagement detail → 404", detailUngranted.status === 404, detailUngranted);
    const detailUnknown = await jreq(`${ATELIER}/partner-portal/delivery/nope_${tag}`, "GET", undefined, { cookie: cookieA1 });
    check("unknown engagement detail → 404", detailUnknown.status === 404, detailUnknown);

    // ---- grant to firm A -------------------------------------------------
    const grant = await jreq(`${ATELIER}/engagements/${engId}/partner-grants`, "POST", { partnerFirmId: firmAId }, { cookie: cookieLead });
    check("engagement grant 201", grant.status === 201 && grant.body?.ok === true, grant);
    const grantId = grant.body?.grantId as string;
    // Idempotent re-grant.
    const grant2 = await jreq(`${ATELIER}/engagements/${engId}/partner-grants`, "POST", { partnerFirmId: firmAId }, { cookie: cookieLead });
    check("engagement grant idempotent", grant2.status === 200 && grant2.body?.alreadyGranted === true, grant2);

    // Grant a DIFFERENT engagement to firm B — must be invisible to A.
    const grantB = await jreq(`${ATELIER}/engagements/${engOtherId}/partner-grants`, "POST", { partnerFirmId: firmBId }, { cookie: cookieLead });
    check("firm B other-engagement grant 201", grantB.status === 201, grantB);

    // ---- portal list reflects grant -------------------------------------
    const listA = await jreq(`${ATELIER}/partner-portal/delivery`, "GET", undefined, { cookie: cookieA1 });
    check("granted engagement visible in delivery list", listA.status === 200 && listA.body?.engagements?.some((e: any) => e.id === engId), listA.body);
    check("delivery list carries plmStage + raidStatus + sharedAt", (() => {
      const e = listA.body?.engagements?.find((x: any) => x.id === engId);
      return e && e.plmStage === "deliver" && e.raidStatus === "amber" && typeof e.sharedAt === "string";
    })(), listA.body?.engagements);
    // Firm B's other engagement is NOT visible to firm A.
    check("other firm's granted engagement invisible to firm A", !listA.body?.engagements?.some((e: any) => e.id === engOtherId), listA.body);

    // ---- 2. Delivery snapshot: allowlist deep-scan ----------------------
    const snap = await jreq(`${ATELIER}/partner-portal/delivery/${engId}`, "GET", undefined, { cookie: cookieA1 });
    check("delivery detail 200 after grant", snap.status === 200, snap.status);
    check("snapshot engagement fields present", snap.body?.engagement?.id === engId && snap.body?.engagement?.plmStage === "deliver" && snap.body?.engagement?.account?.name?.includes("Acct"), snap.body?.engagement);
    check("snapshot deliverables allowlisted", Array.isArray(snap.body?.deliverables) && snap.body.deliverables.length === 1 && snap.body.deliverables[0].name === "Diagnostic Readout" && snap.body.deliverables[0].clientVisibility === "review", snap.body?.deliverables);
    check("snapshot openItems: only OPEN raid, no mitigation/owner", Array.isArray(snap.body?.openItems) && snap.body.openItems.length === 1 && snap.body.openItems[0].description === "Open risk visible", snap.body?.openItems);
    check("snapshot upcomingMeetings: only future, title/date/kind only", Array.isArray(snap.body?.upcomingMeetings) && snap.body.upcomingMeetings.length === 1 && snap.body.upcomingMeetings[0].title === "Upcoming Steering" && Object.keys(snap.body.upcomingMeetings[0]).sort().join(",") === "date,kind,title", snap.body?.upcomingMeetings);

    const keys = new Set<string>();
    collectKeys(snap.body, keys);
    const leaked = FORBIDDEN_KEYS.filter((k) => keys.has(k));
    check("snapshot contains NO forbidden keys (deep-scan)", leaked.length === 0, { leaked });
    // Sanity: also assert no SECRET string values leaked.
    const snapStr = JSON.stringify(snap.body);
    check("snapshot leaks no SECRET-marked values", !snapStr.includes("SECRET"), snapStr.slice(0, 200));

    // ---- 3. revoke engagement grant → list drops + detail 404 -----------
    const revoke = await jreq(`${ATELIER}/engagements/${engId}/partner-grants/${grantId}/revoke`, "POST", {}, { cookie: cookieLead });
    check("engagement revoke 200", revoke.status === 200 && revoke.body?.ok === true, revoke);
    const listAfterRevoke = await jreq(`${ATELIER}/partner-portal/delivery`, "GET", undefined, { cookie: cookieA1 });
    check("revoked engagement drops from list", listAfterRevoke.status === 200 && !listAfterRevoke.body?.engagements?.some((e: any) => e.id === engId), listAfterRevoke.body);
    const detailAfterRevoke = await jreq(`${ATELIER}/partner-portal/delivery/${engId}`, "GET", undefined, { cookie: cookieA1 });
    check("revoked engagement detail → 404", detailAfterRevoke.status === 404, detailAfterRevoke);
    // Re-grant for the rest of the run (documents live under the firm regardless).
    const regrant = await jreq(`${ATELIER}/engagements/${engId}/partner-grants`, "POST", { partnerFirmId: firmAId }, { cookie: cookieLead });
    check("engagement re-grant 201 (new row after revoke)", regrant.status === 201, regrant);

    // ---- Seed a library document with real bytes (for the share flow) ---
    const created = await docsMod.createDocument({
      orgId: "aico",
      uploader: { id: leadId, name: "P1174 Lead" },
      title: "Kickoff Deck",
      category: "client_deliverable",
      engagementId: engId,
      accountId: acctId,
      fileName: "kickoff.pdf",
      mime: "application/pdf",
      bytes: PDF_BYTES,
    });
    check("library document created", (created as any).ok === true, (created as any).reason);
    const libDocId = (created as any).document.id as string;

    // ---- 4. Internal share → partner sees + downloads bytes -------------
    const share = await jreq(`${ATELIER}/partners/firms/${firmAId}/shared-documents`, "POST", { documentId: libDocId, note: "For your review" }, { cookie: cookieLead });
    check("share document 201", share.status === 201 && share.body?.ok === true, share);
    const sharedId = share.body?.document?.id as string;
    check("admin share wire hides blobRef", share.body?.document && !("blobRef" in share.body.document), share.body?.document);
    // Idempotent re-share (same doc + current version).
    const share2 = await jreq(`${ATELIER}/partners/firms/${firmAId}/shared-documents`, "POST", { documentId: libDocId }, { cookie: cookieLead });
    check("share document idempotent", share2.status === 200 && share2.body?.alreadyShared === true, share2);

    const docsA = await jreq(`${ATELIER}/partner-portal/documents`, "GET", undefined, { cookie: cookieA1 });
    check("partner sees shared document", docsA.status === 200 && docsA.body?.shared?.some((d: any) => d.id === sharedId), docsA.body);
    check("portal wire hides blobRef/sha256/source ids", (() => {
      const d = docsA.body?.shared?.find((x: any) => x.id === sharedId);
      return d && !("blobRef" in d) && !("sha256" in d) && !("sourceDocumentId" in d) && !("sourceVersionId" in d);
    })(), docsA.body?.shared);

    const dl = await fetch(`${ATELIER}/partner-portal/documents/${sharedId}/download`, { headers: { cookie: cookieA1 } });
    const dlBuf = Buffer.from(await dl.arrayBuffer());
    check("partner downloads shared bytes", dl.status === 200 && dlBuf.equals(PDF_BYTES), { status: dl.status, len: dlBuf.length });
    check("download sets nosniff header", dl.headers.get("x-content-type-options") === "nosniff", dl.headers.get("x-content-type-options"));

    // ---- 5. Firm B cannot list/download firm A's doc (404 not 403) ------
    const docsB = await jreq(`${ATELIER}/partner-portal/documents`, "GET", undefined, { cookie: cookieB1 });
    check("firm B does NOT see firm A's shared doc", docsB.status === 200 && !docsB.body?.shared?.some((d: any) => d.id === sharedId), docsB.body);
    const dlB = await jreq(`${ATELIER}/partner-portal/documents/${sharedId}/download`, "GET", undefined, { cookie: cookieB1 });
    check("firm B download of firm A doc → 404 (not 403)", dlB.status === 404, dlB.status);

    // ---- 8. Notification rows for engagement_shared + document_shared ---
    const notifs = await db
      .select()
      .from(atelierPartnerNotifications)
      .where(eq(atelierPartnerNotifications.partnerFirmId, firmAId));
    check("engagement_shared notification exists", notifs.some((n: any) => n.kind === "engagement_shared"), notifs.map((n: any) => n.kind));
    check("document_shared notification exists", notifs.some((n: any) => n.kind === "document_shared"), notifs.map((n: any) => n.kind));

    // ---- 4b. revoke share → drops from list AND download 404 ------------
    const revokeDoc = await jreq(`${ATELIER}/partners/firms/${firmAId}/shared-documents/${sharedId}/revoke`, "POST", {}, { cookie: cookieLead });
    check("revoke shared document 200", revokeDoc.status === 200 && revokeDoc.body?.ok === true, revokeDoc);
    const docsAfterRevoke = await jreq(`${ATELIER}/partner-portal/documents`, "GET", undefined, { cookie: cookieA1 });
    check("revoked doc drops from portal list", docsAfterRevoke.status === 200 && !docsAfterRevoke.body?.shared?.some((d: any) => d.id === sharedId), docsAfterRevoke.body);
    const dlRevoked = await jreq(`${ATELIER}/partner-portal/documents/${sharedId}/download`, "GET", undefined, { cookie: cookieA1 });
    check("revoked doc download → 404", dlRevoked.status === 404, dlRevoked.status);

    // ---- 6. Partner upload (REAL multipart contract) → pending_review ---
    const upload = await mpupload(`${ATELIER}/partner-portal/documents`, PDF_BYTES, "upload.pdf", "please review", { cookie: cookieA1 });
    check("partner multipart upload 201 pending_review", upload.status === 201 && upload.body?.document?.status === "pending_review" && upload.body?.document?.direction === "partner_upload", upload.body);
    check("upload fileName taken from multipart originalname", upload.body?.document?.fileName === "upload.pdf", upload.body?.document);
    const uploadId = upload.body?.document?.id as string;
    const uploadsList = await jreq(`${ATELIER}/partner-portal/documents`, "GET", undefined, { cookie: cookieA1 });
    check("partner sees own upload in list", uploadsList.body?.uploads?.some((d: any) => d.id === uploadId), uploadsList.body?.uploads);
    const dlUpload = await fetch(`${ATELIER}/partner-portal/documents/${uploadId}/download`, { headers: { cookie: cookieA1 } });
    const dlUploadBuf = Buffer.from(await dlUpload.arrayBuffer());
    check("uploader firm downloads own upload bytes", dlUpload.status === 200 && dlUploadBuf.equals(PDF_BYTES), dlUpload.status);
    // Firm B cannot see/download the upload.
    const dlUploadB = await jreq(`${ATELIER}/partner-portal/documents/${uploadId}/download`, "GET", undefined, { cookie: cookieB1 });
    check("firm B cannot download firm A upload → 404", dlUploadB.status === 404, dlUploadB.status);

    // ---- 6b. garbage magic-byte upload rejected (multipart) -------------
    const badUpload = await mpupload(`${ATELIER}/partner-portal/documents`, GARBAGE_BYTES, "bad.pdf", undefined, { cookie: cookieA1 });
    check("garbage-magic-byte multipart upload rejected", badUpload.status === 400 && badUpload.body?.error === "content-mismatch", badUpload);

    // ---- 6c. internal review accept/reject ------------------------------
    const uploadsAdmin = await jreq(`${ATELIER}/partners/firms/${firmAId}/partner-uploads`, "GET", undefined, { cookie: cookieLead });
    check("admin partner-uploads queue lists pending upload", uploadsAdmin.status === 200 && uploadsAdmin.body?.items?.some((d: any) => d.id === uploadId), uploadsAdmin.body);
    const reviewAccept = await jreq(`${ATELIER}/partners/firms/${firmAId}/partner-uploads/${uploadId}/review`, "POST", { decision: "accepted", note: "ok" }, { cookie: cookieLead });
    check("internal review accept 200", reviewAccept.status === 200 && reviewAccept.body?.ok === true, reviewAccept);
    const reviewAgain = await jreq(`${ATELIER}/partners/firms/${firmAId}/partner-uploads/${uploadId}/review`, "POST", { decision: "rejected" }, { cookie: cookieLead });
    check("second review → 409 already-decided", reviewAgain.status === 409, reviewAgain);
    // Second upload for the reject path (multipart).
    const upload2 = await mpupload(`${ATELIER}/partner-portal/documents`, PDF_BYTES, "reject.pdf", undefined, { cookie: cookieA1 });
    const upload2Id = upload2.body?.document?.id as string;
    const reviewReject = await jreq(`${ATELIER}/partners/firms/${firmAId}/partner-uploads/${upload2Id}/review`, "POST", { decision: "rejected", note: "no" }, { cookie: cookieLead });
    check("internal review reject 200", reviewReject.status === 200 && reviewReject.body?.ok === true, reviewReject);

    // ---- 7. Preview mode -------------------------------------------------
    const previewDelivery = await jreq(`${ATELIER}/partner-portal/delivery`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("preview: delivery GET 200", previewDelivery.status === 200 && previewDelivery.body?.firm?.id === firmAId, previewDelivery.status);
    const previewDocs = await jreq(`${ATELIER}/partner-portal/documents`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("preview: documents GET 200", previewDocs.status === 200, previewDocs.status);
    // Preview MAY download (share a fresh doc so an active one exists).
    const shareForPreview = await jreq(`${ATELIER}/partners/firms/${firmAId}/shared-documents`, "POST", { documentId: libDocId }, { cookie: cookieLead });
    const previewShareId = shareForPreview.body?.document?.id as string;
    const previewDl = await jreq(`${ATELIER}/partner-portal/documents/${previewShareId}/download`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("preview: download 200 (read allowed)", previewDl.status === 200, previewDl.status);
    // Preview upload is refused (refuseIfPreview runs BEFORE the multer body
    // is consumed) — a genuine multipart POST must still 403.
    const previewUpload = await mpupload(`${ATELIER}/partner-portal/documents`, PDF_BYTES, "x.pdf", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("preview: multipart upload → 403 preview-read-only (body not parsed)", previewUpload.status === 403 && previewUpload.body?.error === "preview-read-only", previewUpload);

    // ---- 9. RFC5987 header for Turkish/Arabic filename ------------------
    const intlName = "Teşekkürler_مرحبا_تقرير.pdf";
    const intlShare = await mpupload(`${ATELIER}/partner-portal/documents`, PDF_BYTES, intlName, undefined, { cookie: cookieA1 });
    check("intl-named multipart upload 201", intlShare.status === 201, intlShare.status);
    const intlId = intlShare.body?.document?.id as string;
    const intlDl = await fetch(`${ATELIER}/partner-portal/documents/${intlId}/download`, { headers: { cookie: cookieA1 } });
    const cd = intlDl.headers.get("content-disposition") ?? "";
    await intlDl.arrayBuffer();
    check("intl filename downloads (no 500) with RFC5987 header", intlDl.status === 200 && /filename\*=UTF-8''/i.test(cd), { status: intlDl.status, cd });
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll partner-delivery-docs checks passed.");
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
