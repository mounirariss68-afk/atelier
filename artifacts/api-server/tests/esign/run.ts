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
  /** Task #310 — typed answers (text/date boxes) the submitter filled. */
  values?: Array<{ field: string; value: unknown }>;
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
    | Array<{ name: string; type?: string; role: string; areas: Array<{ x: number; y: number; w: number; h: number; page: number }> }>
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

/** Task #310 — attach typed answers to a stub submitter (by index). */
function setSubmitterValues(
  submissionId: number,
  submitterIndex: number,
  values: Array<{ field: string; value: unknown }>,
): void {
  const sub = stub.submissions.get(submissionId);
  if (!sub) throw new Error(`stub submission ${submissionId} missing`);
  sub.submitters[submitterIndex].values = values;
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

    // Fixture PDF is unparseable by unpdf, so with no client pageCount the
    // server has no way to verify a page-7 placement → clear 400 instead of
    // passing an out-of-range page through to DocuSeal.
    const rNoCount = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} unknown page count`,
      documentId: pdf.document.id,
      signers: [
        { name: "P One", email: "pn1@example.com" },
        { name: "P Two", email: "pn2@example.com" },
      ],
      placements: [
        { page: 1, x: 0.1, y: 0.2, w: 0.25, h: 0.04 },
        { page: 7, x: 0.6, y: 0.85, w: 0.3, h: 0.06 },
      ],
    });
    check(
      "unparseable PDF + page>1 placement, no pageCount → 400 page-count-unknown",
      rNoCount.status === 400 && rNoCount.body?.error === "page-count-unknown",
      `status=${rNoCount.status} body=${JSON.stringify(rNoCount.body)}`,
    );

    // Page-1-only placements are always safe even when the count is unknown.
    const rPage1 = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} page-1 placement`,
      documentId: pdf.document.id,
      signers: [{ name: "P Solo", email: "psolo@example.com" }],
      placements: [{ page: 1, x: 0.1, y: 0.2, w: 0.25, h: 0.04 }],
    });
    check(
      "unparseable PDF + page-1 placement (no pageCount) → 201",
      rPage1.status === 201,
      `status=${rPage1.status} body=${JSON.stringify(rPage1.body)?.slice(0, 200)}`,
    );

    // Happy path: custom boxes flow through to the DocuSeal template
    // fields verbatim; the client-reported pageCount (pdf.js) is the clamp
    // bound because the fixture is unparseable server-side.
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
      pageCount: 3,
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
    // The fixture is unparseable by unpdf, so the client-sent pageCount (3)
    // is the clamp bound: requested page 7 lands on the last real page.
    check(
      "custom placement page clamped to client pageCount (7 → 3)",
      a1?.page === 3,
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

    console.log("— extra date/initials fields —");

    // Extra field referencing a missing signer index is rejected.
    const rXfBadIdx = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} xf bad index`,
      documentId: pdf.document.id,
      signers: [{ name: "A", email: "xa@example.com" }],
      extraFields: [{ signerIndex: 1, type: "date", page: 1, x: 0.1, y: 0.9, w: 0.18, h: 0.035 }],
    });
    check(
      "extra field with unknown signer index → 400",
      rXfBadIdx.status === 400 && rXfBadIdx.body?.error === "extrafield-signer-mismatch",
      `status=${rXfBadIdx.status} body=${JSON.stringify(rXfBadIdx.body)}`,
    );

    // Extra field boxes must fit on the page.
    const rXfOob = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} xf oob`,
      documentId: pdf.document.id,
      signers: [{ name: "A", email: "xoob@example.com" }],
      extraFields: [{ signerIndex: 0, type: "initials", page: 1, x: 0.95, y: 0.9, w: 0.1, h: 0.035 }],
    });
    check(
      "extra field out of bounds → 400",
      rXfOob.status === 400 && rXfOob.body?.error === "extrafield-out-of-bounds",
      `status=${rXfOob.status} body=${JSON.stringify(rXfOob.body)}`,
    );

    // Happy path: date + initials boxes pass through to the template with
    // the right roles/types, alongside the per-signer signature fields.
    const rXf = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} xf happy`,
      documentId: pdf.document.id,
      signers: [
        { name: "X One", email: "x1@example.com" },
        { name: "X Two", email: "x2@example.com" },
      ],
      extraFields: [
        { signerIndex: 0, type: "date", page: 1, x: 0.1, y: 0.9, w: 0.18, h: 0.035 },
        { signerIndex: 1, type: "initials", page: 1, x: 0.85, y: 0.9, w: 0.08, h: 0.035 },
        { signerIndex: 1, type: "initials", page: 1, x: 0.85, y: 0.5, w: 0.08, h: 0.035 },
      ],
    });
    check("POST with extraFields → 201", rXf.status === 201, `status=${rXf.status} body=${JSON.stringify(rXf.body)?.slice(0, 200)}`);
    const xfFields = stub.lastTemplateFields ?? [];
    const sigFields = xfFields.filter((f) => f.type === "signature");
    const dateFields = xfFields.filter((f) => f.type === "date");
    const initFields = xfFields.filter((f) => f.type === "initials");
    check(
      "template fields: 2 signatures + 1 date + 2 initials with correct roles",
      xfFields.length === 5 &&
        sigFields.length === 2 &&
        dateFields.length === 1 &&
        dateFields[0].role === "Signer 1" &&
        initFields.length === 2 &&
        initFields.every((f) => f.role === "Signer 2"),
      JSON.stringify(xfFields.map((f) => ({ n: f.name, t: f.type, r: f.role })))?.slice(0, 300),
    );
    check(
      "extra field names are unique",
      new Set(xfFields.map((f) => f.name)).size === xfFields.length,
      xfFields.map((f) => f.name).join(","),
    );
    const dArea = dateFields[0]?.areas?.[0];
    check(
      "date box coords pass through verbatim",
      dArea?.x === 0.1 && dArea?.y === 0.9 && dArea?.w === 0.18 && dArea?.h === 0.035 && dArea?.page === 1,
      JSON.stringify(dArea),
    );
    check(
      "extraFields recorded in send audit payload",
      (
        await db
          .select()
          .from(atelierAuditEvents)
          .where(eq(atelierAuditEvents.entityId, rXf.body?.request?.id ?? ""))
      ).some((ev) => {
        const xf = (ev.payload as any)?.extraFields;
        return ev.action === "signature_request.send" && Array.isArray(xf) && xf.length === 3;
      }),
      "no send audit row with extraFields",
    );

    // Baseline flow unchanged: a plain request (no extraFields) still
    // produces exactly one signature field per signer.
    const rPlain = await call("POST", "/api/atelier/esign/requests", FP, {
      title: `${TAG} xf baseline`,
      documentId: pdf.document.id,
      signers: [{ name: "Plain", email: "plain@example.com" }],
    });
    const plainFields = stub.lastTemplateFields ?? [];
    check(
      "no extraFields → single signature field per signer (unchanged)",
      rPlain.status === 201 && plainFields.length === 1 && plainFields[0].type === "signature",
      JSON.stringify(plainFields)?.slice(0, 160),
    );

    // Task #298 — labelled TEXT boxes (the counterparty's own fill-in
    // fields, e.g. printed name/title) pass through with type "text",
    // the given label as the field name, and the right signer role.
    // Exercised via the lib (the contract send path builds these).
    const { sendSignatureRequest } = await import("../../src/lib/atelier-esign.js");
    const txtOut = await sendSignatureRequest({
      orgId: ORG,
      actor: { id: FP, name: founder.name },
      title: `${TAG} counterparty text fields`,
      documentId: pdf.document.id,
      documentVersionId: pdf.version.id,
      fileName: `${TAG}-agreement.pdf`,
      pdfBytes: Buffer.from("%PDF-1.4 fixture\n1 0 obj<<>>endobj\n%%EOF"),
      signers: [
        { name: "Client CP", email: "cp@example.com" },
        { name: "Firm Partner", email: "fp@example.com" },
      ],
      clientPageCount: 1,
      extraFields: [
        { signerIndex: 0, type: "date", page: 9999, x: 0.08, y: 0.72, w: 0.18, h: 0.03 },
        { signerIndex: 0, type: "text", label: "Name (print)", page: 9999, x: 0.08, y: 0.75, w: 0.32, h: 0.03 },
        { signerIndex: 0, type: "text", label: "Title", page: 9999, x: 0.08, y: 0.79, w: 0.32, h: 0.03 },
      ],
    });
    const txtFields = stub.lastTemplateFields ?? [];
    const textBoxes = txtFields.filter((f) => f.type === "text");
    check(
      "text extraFields → typed text boxes with labels on the counterparty role",
      txtFields.length === 5 &&
        textBoxes.length === 2 &&
        textBoxes.every((f) => f.role === "Signer 1") &&
        textBoxes.some((f) => f.name === "Name (print) 1") &&
        textBoxes.some((f) => f.name === "Title 1"),
      JSON.stringify(txtFields.map((f) => ({ n: f.name, t: f.type, r: f.role })))?.slice(0, 300),
    );
    check(
      "text/date extraField pages clamped to the last page (9999 → 1)",
      txtFields
        .filter((f) => f.type === "text" || f.type === "date")
        .every((f) => f.areas?.[0]?.page === 1),
      JSON.stringify(txtFields.map((f) => f.areas?.[0]?.page)),
    );
    // Track for cleanup alongside the route-created requests.
    check("lib send with text fields → sent request row", txtOut.request?.status === "sent", JSON.stringify(txtOut.request)?.slice(0, 160));

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

    console.log("— contract second-party values (Task #306/#310) —");

    // Fixture: a template version with second-party fields and a contract
    // record linked to a fresh signature request. Rows inserted directly
    // (template upload needs LLM detection; irrelevant to this path).
    const {
      atelierContractTemplates,
      atelierContractTemplateVersions,
      atelierContractRecords,
    } = await import("@workspace/db");
    const tplId = `ctpl_${TAG}_1`;
    const tvId = `ctv_${TAG}_1`;
    const ctrId = `ctr_${TAG}_1`;
    const spSchema = [
      { key: "counterparty_printed_name", label: "Name (print)", placeholder: "[NAME]", dataType: "text", role: "second_party" },
      { key: "counterparty_title", label: "Title", placeholder: "[TITLE]", dataType: "text", role: "second_party" },
      { key: "date_signed", label: "Date signed", placeholder: "[DATE]", dataType: "date", role: "second_party" },
      { key: "firm_name", label: "Firm name", placeholder: "[FIRM]", dataType: "text", role: "first_party" },
    ];
    await db.insert(atelierContractTemplates).values({
      id: tplId, orgId: ORG, name: `${TAG} tpl`, contractType: "individual_nda",
      status: "active", currentVersionId: tvId, createdBy: FP,
    } as any);
    await db.insert(atelierContractTemplateVersions).values({
      id: tvId, orgId: ORG, templateId: tplId, versionNumber: 1,
      fileName: `${TAG}.docx`, sizeBytes: 10, sha256: "0".repeat(64),
      blobRef: "enc:cdoc:test", fieldSchema: spSchema as any,
      fieldStatus: "reviewed", createdBy: FP,
    } as any);

    const ctrSend = await sendSignatureRequest({
      orgId: ORG,
      actor: { id: FP, name: founder.name },
      title: `${TAG} contract signing`,
      documentId: pdf.document.id,
      documentVersionId: pdf.version.id,
      fileName: `${TAG}-agreement.pdf`,
      pdfBytes: Buffer.from("%PDF-1.4 fixture\n1 0 obj<<>>endobj\n%%EOF"),
      signers: [
        { name: "Counter Party", email: "counter@example.com" },
        { name: "Firm Signer", email: "firm@example.com" },
      ],
      clientPageCount: 1,
    });
    const ctrReqId = ctrSend.request.id;
    const ctrSubId = Number(ctrSend.request.docusealSubmissionId);
    await db.insert(atelierContractRecords).values({
      id: ctrId, orgId: ORG, title: `${TAG} NDA`, contractType: "individual_nda",
      templateId: tplId, templateVersionId: tvId,
      counterpartyKind: "contact", counterpartyLabel: "Counter Party",
      status: "out_for_signature", fieldValues: { firm_name: "Cognirise" },
      ownerUserId: FP, ownerLabel: founder.name, signatureRequestId: ctrReqId,
    } as any);

    // Counterparty types their answers, everyone signs, sync runs.
    setSubmitterValues(ctrSubId, 0, [
      { field: "Name (print) 1", value: "Jane Roe" },
      { field: "Title 1", value: "Director" },
      { field: "Date signed 1", value: "2026-07-19" },
    ]);
    markSigned(ctrSubId, 2, stubBase);
    await syncSignatureRequest(ctrReqId);

    const [ctrAfter] = await db
      .select()
      .from(atelierContractRecords)
      .where(eq(atelierContractRecords.id, ctrId));
    check("contract flips to signed on sync", ctrAfter?.status === "signed", ctrAfter?.status);
    const fvAfter = (ctrAfter?.fieldValues ?? {}) as Record<string, string>;
    check(
      "counterparty typed answers merged into fieldValues",
      fvAfter.counterparty_printed_name === "Jane Roe" &&
        fvAfter.counterparty_title === "Director" &&
        fvAfter.date_signed === "2026-07-19" &&
        fvAfter.firm_name === "Cognirise",
      JSON.stringify(fvAfter),
    );
    const ctrAudits1 = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, ctrId));
    check(
      "contract.second_party_values audit event recorded",
      ctrAudits1.some((a) => a.action === "contract.second_party_values"),
      ctrAudits1.map((a) => a.action).join(","),
    );
    if (ctrAfter?.signedLibraryDocumentId) createdDocIds.push(ctrAfter.signedLibraryDocumentId);

    console.log("— second-party backfill on detail open (Task #310) —");

    // Simulate the lost-merge failure mode: signed contract, values gone.
    await db
      .update(atelierContractRecords)
      .set({ fieldValues: { firm_name: "Cognirise" } })
      .where(eq(atelierContractRecords.id, ctrId));

    const rDetail = await call("GET", `/api/atelier/contracts/${ctrId}`, FP);
    const fvRepaired = rDetail.body?.contract?.fieldValues ?? {};
    check(
      "detail open repairs missing second-party values",
      rDetail.status === 200 &&
        fvRepaired.counterparty_printed_name === "Jane Roe" &&
        fvRepaired.counterparty_title === "Director" &&
        fvRepaired.date_signed === "2026-07-19",
      `status=${rDetail.status} fv=${JSON.stringify(fvRepaired)}`,
    );
    check(
      "backfill does not regress status",
      rDetail.body?.contract?.status === "signed",
      rDetail.body?.contract?.status,
    );
    const [ctrRepaired] = await db
      .select()
      .from(atelierContractRecords)
      .where(eq(atelierContractRecords.id, ctrId));
    check(
      "repaired values persisted to the DB",
      ((ctrRepaired?.fieldValues ?? {}) as Record<string, string>).counterparty_printed_name === "Jane Roe",
      JSON.stringify(ctrRepaired?.fieldValues),
    );
    const ctrAudits2 = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, ctrId));
    check(
      "backfill audited with backfill:true",
      ctrAudits2.some(
        (a) => a.action === "contract.second_party_values" && (a.payload as any)?.backfill === true,
      ),
      ctrAudits2.map((a) => `${a.action}${(a.payload as any)?.backfill ? "(bf)" : ""}`).join(","),
    );

    // Idempotent: a second open with values present writes nothing new.
    const beforeCount = ctrAudits2.filter((a) => a.action === "contract.second_party_values").length;
    const rDetail2 = await call("GET", `/api/atelier/contracts/${ctrId}`, FP);
    const ctrAudits3 = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, ctrId));
    check(
      "backfill is idempotent (no new audit on repeat open)",
      rDetail2.status === 200 &&
        ctrAudits3.filter((a) => a.action === "contract.second_party_values").length === beforeCount,
      `before=${beforeCount} after=${ctrAudits3.filter((a) => a.action === "contract.second_party_values").length}`,
    );

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
      // Task #310 contract fixtures.
      const {
        atelierContractTemplates: ctpl,
        atelierContractTemplateVersions: ctv,
        atelierContractRecords: ctr,
        atelierContractDocuments: cdoc,
      } = await import("@workspace/db");
      await db.delete(cdoc).where(like(cdoc.contractId, `ctr_${TAG}%`));
      await db.delete(ctr).where(like(ctr.id, `ctr_${TAG}%`));
      await db.delete(ctv).where(like(ctv.id, `ctv_${TAG}%`));
      await db.delete(ctpl).where(like(ctpl.id, `ctpl_${TAG}%`));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `ctr_${TAG}%`));

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
