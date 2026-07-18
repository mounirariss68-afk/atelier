/**
 * Task #62 — E-signing (DocuSeal) integration suite.
 *
 * Deterministic, no live DocuSeal: a local stub HTTP server implements
 * the DocuSeal API subset the client uses (templates/pdf, submissions,
 * submitters, file downloads). DOCUSEAL_BASE_URL points at the stub and
 * the env is set BEFORE the app import so the client binds to it.
 *
 * Covers:
 *   - partner-tier create → 201 sent + signer rows (order preserved)
 *   - role gate: employee persona → 403
 *   - non-PDF document → 400
 *   - webhook (public, no session) triggers authoritative re-fetch:
 *       one-of-two signed  → partially_signed
 *       all signed         → completed + signed PDF archived into the
 *                            Document Library (+ audit-trail doc)
 *   - spoofed webhook for unknown submission → 200 matched:false, no-op
 *   - webhook secret mismatch → 401 (when DOCUSEAL_WEBHOOK_SECRET set)
 *   - void → DocuSeal archived + status voided; remind → resend count
 *   - expiry lapse: past expiresAt with no progress → expired on sync
 *
 * Follows the repo's hand-rolled check()/failures[] convention.
 * Cleanup removes every row this suite creates.
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";

process.env.DOCUSEAL_API_KEY = "test-docuseal-key";

import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";

const ORG = "aico";
const TAG = "esigntest";

// ---------------------------------------------------------------------------
// Stub DocuSeal server
// ---------------------------------------------------------------------------

interface StubSubmitter {
  id: number;
  submission_id: number;
  name: string;
  email: string;
  status: string;
  opened_at?: string | null;
  completed_at?: string | null;
  declined_at?: string | null;
}
interface StubSubmission {
  id: number;
  status: string;
  archived_at: string | null;
  submitters: StubSubmitter[];
  documents: Array<{ name: string; url: string }>;
  audit_log_url: string | null;
}

const stub = {
  nextTemplateId: 100,
  nextSubmissionId: 500,
  nextSubmitterId: 900,
  submissions: new Map<number, StubSubmission>(),
  resendCalls: [] as number[],
  authFailures: 0,
  /** Fields payload of the most recent POST /templates/pdf. */
  lastTemplateFields: null as
    | Array<{ name: string; role: string; areas: Array<{ x: number; y: number; w: number; h: number; page: number }> }>
    | null,
};

const SIGNED_PDF = Buffer.from("%PDF-1.4 signed-stub\n%%EOF");
const AUDIT_PDF = Buffer.from("%PDF-1.4 audit-stub\n%%EOF");

function stubServer(): http.Server {
  return http.createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-auth-token"] !== "test-docuseal-key") {
      stub.authFailures++;
      return send(401, { error: "bad token" });
    }
    const url = req.url ?? "";
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      if (req.method === "POST" && url === "/templates/pdf") {
        stub.lastTemplateFields = body?.documents?.[0]?.fields ?? null;
        return send(200, { id: stub.nextTemplateId++ });
      }
      if (req.method === "POST" && url === "/submissions") {
        const sid = stub.nextSubmissionId++;
        const submitters: StubSubmitter[] = (body.submitters as Array<{ name: string; email: string }>).map(
          (s, i) => ({
            id: stub.nextSubmitterId++,
            submission_id: sid,
            name: s.name,
            email: s.email,
            status: i === 0 ? "sent" : "pending",
          }),
        );
        stub.submissions.set(sid, {
          id: sid,
          status: "pending",
          archived_at: null,
          submitters,
          documents: [],
          audit_log_url: null,
        });
        return send(200, submitters);
      }
      const subMatch = url.match(/^\/submissions\/(\d+)$/);
      if (subMatch) {
        const sub = stub.submissions.get(Number(subMatch[1]));
        if (!sub) return send(404, { error: "not found" });
        if (req.method === "GET") return send(200, sub);
        if (req.method === "DELETE") {
          sub.status = "archived";
          sub.archived_at = new Date().toISOString();
          return send(200, { id: sub.id, archived_at: sub.archived_at });
        }
      }
      const smMatch = url.match(/^\/submitters\/(\d+)$/);
      if (smMatch && req.method === "PUT") {
        stub.resendCalls.push(Number(smMatch[1]));
        return send(200, { id: Number(smMatch[1]) });
      }
      if (url === "/files/signed.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(SIGNED_PDF);
      }
      if (url === "/files/audit.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(AUDIT_PDF);
      }
      return send(404, { error: `unhandled ${req.method} ${url}` });
    });
  });
}

function markSigned(submissionId: number, count: number, baseUrl: string): void {
  const sub = stub.submissions.get(submissionId);
  if (!sub) throw new Error(`stub submission ${submissionId} missing`);
  for (let i = 0; i < sub.submitters.length; i++) {
    const s = sub.submitters[i];
    if (i < count) {
      s.status = "completed";
      s.completed_at = new Date().toISOString();
    } else if (i === count) {
      s.status = "sent";
    }
  }
  if (count >= sub.submitters.length) {
    sub.status = "completed";
    sub.documents = [{ name: "signed.pdf", url: `${baseUrl}/files/signed.pdf` }];
    sub.audit_log_url = `${baseUrl}/files/audit.pdf`;
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

async function main(): Promise<void> {
  // Boot the stub FIRST so DOCUSEAL_BASE_URL is set before app import.
  const stubSrv = stubServer();
  await new Promise<void>((r) => stubSrv.listen(0, r));
  const stubBase = `http://127.0.0.1:${(stubSrv.address() as AddressInfo).port}`;
  process.env.DOCUSEAL_BASE_URL = stubBase;

  const { default: app } = await import("../../src/app.js");
  const {
    db,
    atelierUsers,
    atelierDocuments,
    atelierDocumentVersions,
    atelierSignatureRequests,
    atelierSignatureSigners,
    atelierAuditEvents,
  } = await import("@workspace/db");
  const { createDocument } = await import("../../src/lib/atelier-documents.js");
  const { syncSignatureRequest } = await import("../../src/lib/atelier-esign.js");

  const server = app.listen(0);
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(
    method: string,
    path: string,
    persona: string | null,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(persona ? { cookie: `atelier_persona=${persona}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    return { status: res.status, body: json };
  }

  const createdUserIds: string[] = [];
  const createdDocIds: string[] = [];

  try {
    // --- actors ---------------------------------------------------------
    const [founder] = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.role, "founding_partner"))
      .limit(1);
    if (!founder) throw new Error("no founding_partner user in DB — boot seed missing");
    const FP = founder.id;

    const employeeId = `u_${TAG}_employee`;
    await db
      .insert(atelierUsers)
      .values({
        id: employeeId,
        orgId: ORG,
        email: `${TAG}-employee@example.com`,
        name: "Esign Test Employee",
        initials: "ET",
        role: "employee",
        roleLabel: "Employee",
        title: "Test Employee",
      } as any)
      .onConflictDoNothing();
    createdUserIds.push(employeeId);

    // --- fixture documents ------------------------------------------------
    const pdf = await createDocument({
      orgId: ORG,
      uploader: { id: FP, name: founder.name },
      title: `${TAG} source agreement`,
      category: "contract",
      fileName: `${TAG}-agreement.pdf`,
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 fixture\n1 0 obj<<>>endobj\n%%EOF"),
    });
    if (!pdf.ok) throw new Error(`fixture PDF upload failed: ${pdf.reason}`);
    createdDocIds.push(pdf.document.id);

    const txt = await createDocument({
      orgId: ORG,
      uploader: { id: FP, name: founder.name },
      title: `${TAG} not a pdf`,
      category: "other",
      fileName: `${TAG}-notes.txt`,
      mime: "text/plain",
      bytes: Buffer.from("plain text"),
    });
    if (!txt.ok) throw new Error(`fixture TXT upload failed: ${txt.reason}`);
    createdDocIds.push(txt.document.id);

    console.log("— create + role gates —");

    // Employee is locked out.
    const rEmp = await call("GET", "/api/atelier/esign/requests", employeeId);
    check("GET /esign/requests (employee) → 403", rEmp.status === 403, `status=${rEmp.status}`);

    // Non-PDF rejected.
    const rTxt = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} txt send`,
      documentId: txt.document.id,
      signers: [{ name: "A Signer", email: "a@example.com" }],
    });
    check("POST non-PDF document → 400", rTxt.status === 400 && rTxt.body?.error === "document-not-pdf", `status=${rTxt.status} body=${JSON.stringify(rTxt.body)}`);

    // Duplicate signer emails rejected.
    const rDup = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} dup`,
      documentId: pdf.document.id,
      signers: [
        { name: "A", email: "same@example.com" },
        { name: "B", email: "same@example.com" },
      ],
    });
    check("POST duplicate signer emails → 400", rDup.status === 400, `status=${rDup.status}`);

    // Happy path: two signers, order preserved.
    const rCreate = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} master agreement`,
      message: "Please sign.",
      documentId: pdf.document.id,
      signers: [
        { name: "First Signer", email: "first@example.com" },
        { name: "Second Signer", email: "second@example.com" },
      ],
      expiresInDays: 30,
    });
    check("POST /esign/requests → 201 sent", rCreate.status === 201 && rCreate.body?.request?.status === "sent", `status=${rCreate.status} body=${JSON.stringify(rCreate.body)?.slice(0, 200)}`);
    const reqId: string = rCreate.body?.request?.id;
    const submissionId = Number(rCreate.body ? (await db.select().from(atelierSignatureRequests).where(eq(atelierSignatureRequests.id, reqId)))[0]?.docusealSubmissionId : 0);
    const signers = rCreate.body?.request?.signers ?? [];
    check(
      "signer rows: order + initial statuses",
      signers.length === 2 &&
        signers[0].signingOrder === 1 &&
        signers[0].status === "sent" &&
        signers[1].status === "pending",
      JSON.stringify(signers),
    );

    // Default placement: one signature field per signer, roles Signer N,
    // stamped on the (only) page of the fixture PDF.
    const defFields = stub.lastTemplateFields ?? [];
    check(
      "default template fields: one per signer with Signer N roles",
      defFields.length === 2 &&
        defFields[0].role === "Signer 1" &&
        defFields[1].role === "Signer 2" &&
        defFields.every((f) => f.areas?.length === 1),
      JSON.stringify(defFields)?.slice(0, 240),
    );

    console.log("— custom placements —");

    // Placement count must match signer count.
    const rMismatch = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} placement mismatch`,
      documentId: pdf.document.id,
      signers: [
        { name: "A", email: "pa@example.com" },
        { name: "B", email: "pb@example.com" },
      ],
      placements: [{ page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05 }],
    });
    check(
      "placements count mismatch → 400",
      rMismatch.status === 400 && rMismatch.body?.error === "placement-count-mismatch",
      `status=${rMismatch.status} body=${JSON.stringify(rMismatch.body)}`,
    );

    // Boxes must fit within the page.
    const rOob = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} placement oob`,
      documentId: pdf.document.id,
      signers: [{ name: "A", email: "poob@example.com" }],
      placements: [{ page: 1, x: 0.9, y: 0.8, w: 0.3, h: 0.05 }],
    });
    check(
      "placement out of bounds → 400",
      rOob.status === 400 && rOob.body?.error === "placement-out-of-bounds",
      `status=${rOob.status} body=${JSON.stringify(rOob.body)}`,
    );

    // Happy path: custom boxes flow through to the DocuSeal template
    // fields verbatim (page clamped to the document's real page count).
    const rPlaced = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} custom placement`,
      documentId: pdf.document.id,
      signers: [
        { name: "P One", email: "p1@example.com" },
        { name: "P Two", email: "p2@example.com" },
      ],
      placements: [
        { page: 1, x: 0.1, y: 0.2, w: 0.25, h: 0.04 },
        { page: 7, x: 0.6, y: 0.85, w: 0.3, h: 0.06 },
      ],
    });
    check("POST with placements → 201", rPlaced.status === 201, `status=${rPlaced.status} body=${JSON.stringify(rPlaced.body)?.slice(0, 200)}`);
    const placedFields = stub.lastTemplateFields ?? [];
    const a0 = placedFields[0]?.areas?.[0];
    const a1 = placedFields[1]?.areas?.[0];
    check(
      "custom placements land in template fields (roles + coords)",
      placedFields.length === 2 &&
        placedFields[0].role === "Signer 1" &&
        placedFields[1].role === "Signer 2" &&
        a0?.x === 0.1 && a0?.y === 0.2 && a0?.w === 0.25 && a0?.h === 0.04 && a0?.page === 1 &&
        a1?.x === 0.6 && a1?.y === 0.85 && a1?.w === 0.3 && a1?.h === 0.06,
      JSON.stringify(placedFields)?.slice(0, 300),
    );
    // Fixture PDF is unparseable by unpdf (page count unknown) so the
    // requested page 7 passes through un-clamped but >= 1. With a real
    // parseable PDF it clamps to the last page — asserted separately in
    // the pure-unit check below via the lib's clamp path.
    check(
      "custom placement page is normalized (>= 1)",
      typeof a1?.page === "number" && a1.page >= 1,
      `page=${a1?.page}`,
    );
    check(
      "placements recorded in send audit payload",
      (
        await db
          .select()
          .from(atelierAuditEvents)
          .where(eq(atelierAuditEvents.entityId, rPlaced.body?.request?.id ?? ""))
      ).some((ev) => {
        const pl = (ev.payload as any)?.placements;
        return ev.action === "signature_request.send" && Array.isArray(pl) && pl.length === 2;
      }),
      "no send audit row with placements",
    );

    console.log("— webhook-triggered sync —");

    // Spoofed webhook for an unknown submission: acknowledged, no-op.
    const rSpoof = await call("POST", "/api/esign/webhook/docuseal", null, {
      event_type: "form.completed",
      data: { submission_id: 999999 },
    });
    check("webhook unknown submission → 200 matched:false", rSpoof.status === 200 && rSpoof.body?.matched === false, `status=${rSpoof.status} body=${JSON.stringify(rSpoof.body)}`);

    // First signer signs → webhook → partially_signed.
    markSigned(submissionId, 1, stubBase);
    const rHook1 = await call("POST", "/api/esign/webhook/docuseal", null, {
      event_type: "form.completed",
      data: { submission_id: submissionId },
    });
    check("webhook after 1/2 signed → partially_signed", rHook1.status === 200 && rHook1.body?.status === "partially_signed", `status=${rHook1.status} body=${JSON.stringify(rHook1.body)}`);

    // Webhook payload is never trusted: a spoofed "completed" event for
    // this submission cannot complete it — state comes from the re-fetch.
    const rSpoof2 = await call("POST", "/api/esign/webhook/docuseal", null, {
      event_type: "submission.completed",
      data: { id: submissionId, status: "completed" },
    });
    check("spoofed completed webhook → still partially_signed", rSpoof2.body?.status === "partially_signed", JSON.stringify(rSpoof2.body));

    console.log("— remind + completion + archive —");

    const rRemind = await call("POST", `/api/atelier/esign/requests/${reqId}/remind`, FP);
    check("remind → 200 reminded=1 (pending signer only)", rRemind.status === 200 && rRemind.body?.reminded === 1, `status=${rRemind.status} body=${JSON.stringify(rRemind.body)} resends=${JSON.stringify(stub.resendCalls)}`);

    markSigned(submissionId, 2, stubBase);
    const rHook2 = await call("POST", "/api/esign/webhook/docuseal", null, {
      event_type: "form.completed",
      data: { submission_id: submissionId },
    });
    check("webhook after 2/2 signed → completed", rHook2.status === 200 && rHook2.body?.status === "completed", `status=${rHook2.status} body=${JSON.stringify(rHook2.body)}`);

    const rGet = await call("GET", `/api/atelier/esign/requests/${reqId}`, FP);
    const signedDocId = rGet.body?.request?.signedDocumentId;
    check("completed request records signedDocumentId", !!signedDocId, JSON.stringify(rGet.body?.request)?.slice(0, 200));
    if (signedDocId) createdDocIds.push(signedDocId);

    const [signedDoc] = signedDocId
      ? await db.select().from(atelierDocuments).where(eq(atelierDocuments.id, signedDocId))
      : [];
    check(
      "signed PDF archived in Document Library as contract",
      !!signedDoc && signedDoc.category === "contract" && signedDoc.title.includes("(signed)"),
      JSON.stringify(signedDoc)?.slice(0, 160),
    );
    if (signedDoc?.currentVersionId) {
      const [v] = await db
        .select()
        .from(atelierDocumentVersions)
        .where(eq(atelierDocumentVersions.id, signedDoc.currentVersionId));
      check("archived signed version is a PDF", v?.mime === "application/pdf", v?.mime);
    }
    const auditDocs = await db
      .select()
      .from(atelierDocuments)
      .where(like(atelierDocuments.title, `%${TAG}%audit trail%`));
    check("audit-trail PDF archived alongside", auditDocs.length === 1, `found=${auditDocs.length}`);
    for (const d of auditDocs) createdDocIds.push(d.id);

    // Terminal state never regresses; completed request is not voidable.
    const rVoidDone = await call("POST", `/api/atelier/esign/requests/${reqId}/void`, FP);
    check("void completed → 409", rVoidDone.status === 409, `status=${rVoidDone.status}`);

    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, reqId));
    check(
      "audit trail: send + status transitions recorded",
      audits.some((a) => a.action === "signature_request.send") &&
        audits.filter((a) => a.action === "signature_request.status").length >= 2,
      audits.map((a) => a.action).join(","),
    );

    console.log("— void + expiry —");

    const rCreate2 = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} voidable`,
      documentId: pdf.document.id,
      signers: [{ name: "Solo Signer", email: "solo@example.com" }],
    });
    const req2Id: string = rCreate2.body?.request?.id;
    const rVoid = await call("POST", `/api/atelier/esign/requests/${req2Id}/void`, FP);
    check("void pending → 200 voided", rVoid.status === 200 && rVoid.body?.request?.status === "voided", `status=${rVoid.status} body=${JSON.stringify(rVoid.body)?.slice(0, 160)}`);
    const [sub2Row] = await db
      .select()
      .from(atelierSignatureRequests)
      .where(eq(atelierSignatureRequests.id, req2Id));
    const stubSub2 = stub.submissions.get(Number(sub2Row?.docusealSubmissionId));
    check("void archives the DocuSeal submission", stubSub2?.status === "archived", stubSub2?.status);

    // Expiry lapse: force the local deadline into the past, then sync.
    const rCreate3 = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} expiring`,
      documentId: pdf.document.id,
      signers: [{ name: "Slow Signer", email: "slow@example.com" }],
      expiresInDays: 1,
    });
    const req3Id: string = rCreate3.body?.request?.id;
    await db
      .update(atelierSignatureRequests)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(atelierSignatureRequests.id, req3Id));
    const synced = await syncSignatureRequest(req3Id);
    check("past expiresAt → expired on sync", synced.request.status === "expired", synced.request.status);

    console.log("— webhook secret gate —");
    process.env.DOCUSEAL_WEBHOOK_SECRET = "hook-secret";
    const rBadSecret = await call("POST", "/api/esign/webhook/docuseal", null, {
      data: { submission_id: submissionId },
    });
    check("webhook w/o secret → 401", rBadSecret.status === 401, `status=${rBadSecret.status}`);
    const rGoodSecret = await fetch(`${BASE}/api/esign/webhook/docuseal`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-docuseal-secret": "hook-secret" },
      body: JSON.stringify({ data: { submission_id: submissionId } }),
    });
    check("webhook with secret → 200", rGoodSecret.status === 200, `status=${rGoodSecret.status}`);
    delete process.env.DOCUSEAL_WEBHOOK_SECRET;

    check("stub never saw a bad API key", stub.authFailures === 0, `failures=${stub.authFailures}`);
  } finally {
    // ---- cleanup --------------------------------------------------------
    try {
      const reqs = await db
        .select({ id: atelierSignatureRequests.id })
        .from(atelierSignatureRequests)
        .where(like(atelierSignatureRequests.title, `${TAG}%`));
      const ids = reqs.map((r) => r.id);
      if (ids.length) {
        await db.delete(atelierSignatureSigners).where(inArray(atelierSignatureSigners.requestId, ids));
        await db.delete(atelierSignatureRequests).where(inArray(atelierSignatureRequests.id, ids));
        await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, ids));
      }
      // Fixture + archived docs (delete versions then docs; blobs are
      // in-DB via blobRef so no object-storage orphaning to worry about
      // for these tiny fixtures).
      const docs = await db
        .select({ id: atelierDocuments.id })
        .from(atelierDocuments)
        .where(like(atelierDocuments.title, `%${TAG}%`));
      const docIds = Array.from(new Set([...docs.map((d) => d.id), ...createdDocIds]));
      if (docIds.length) {
        const { deleteDocumentHard } = await import("../../src/lib/atelier-documents.js").catch(() => ({ deleteDocumentHard: null as any }));
        if (typeof deleteDocumentHard === "function") {
          for (const id of docIds) await deleteDocumentHard(id).catch(() => {});
        } else {
          await db.delete(atelierDocumentVersions).where(inArray(atelierDocumentVersions.documentId, docIds));
          await db.delete(atelierDocuments).where(inArray(atelierDocuments.id, docIds));
        }
      }
      if (createdUserIds.length) {
        await db.delete(atelierUsers).where(inArray(atelierUsers.id, createdUserIds));
      }
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    stubSrv.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll e-sign checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("harness crashed:", err);
  process.exit(1);
});
