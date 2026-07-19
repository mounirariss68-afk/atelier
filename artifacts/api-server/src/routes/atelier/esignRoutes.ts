/**
 * Task #62 — E-signing routes (DocuSeal-backed).
 *
 *   GET    /esign/requests            — list (leadership-gated)
 *   POST   /esign/requests            — send a library PDF for signature
 *   GET    /esign/requests/:id        — detail incl. signers
 *   POST   /esign/requests/:id/void   — cancel a pending request
 *   POST   /esign/requests/:id/remind — re-send email to pending signers
 *   POST   /esign/requests/:id/sync   — manual reconcile against DocuSeal
 *   POST   /esign/sync                — reconcile all open requests
 *
 * Access model: partner-tier leadership only (founding_partner |
 * partner), per task spec. Account-linked requests additionally respect
 * account visibility on read via canSeeAccount, though leadership sees
 * every account anyway — the check is defense-in-depth for future role
 * widening.
 *
 * All DocuSeal failures surface as 502 with the upstream message — no
 * silent fallbacks.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierSignatureRequests,
  atelierSignatureSigners,
} from "@workspace/db";
import { canApproveAsPartner } from "./personaRoles";
import { canSeeAccount } from "./accountRoutes";
import { accessibleEngagementIds } from "./engagementRoutes";
import { loadDocBytes } from "../../lib/atelier-documents.js";
import { atelierDocuments, atelierDocumentVersions, atelierOpportunities } from "@workspace/db";
import {
  sendSignatureRequest,
  syncSignatureRequest,
  syncAllOpenRequests,
  voidSignatureRequest,
  remindSignatureRequest,
  PageCountUnknownError,
  type SigRequestRow,
  type SigSignerRow,
} from "../../lib/atelier-esign.js";
import {
  DocusealError,
  docusealConfigured,
  getSubmission,
  submitterEmbedSrc,
} from "../../lib/docuseal.js";

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

/** Partner-tier gate for every e-sign surface. */
function ensureEsignRole(me: Me, res: Response): boolean {
  if (canApproveAsPartner(me.role)) return true;
  res.status(403).json({
    error: "esign-role",
    message: "Only partners and founding partners may manage signature requests.",
  });
  return false;
}

function handleUpstreamError(res: Response, err: unknown): void {
  if (err instanceof DocusealError) {
    res.status(502).json({ error: "docuseal-error", message: err.message });
    return;
  }
  throw err;
}

function signerShape(s: SigSignerRow) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    signingOrder: s.signingOrder,
    status: s.status,
    openedAt: s.openedAt,
    completedAt: s.completedAt,
    declinedAt: s.declinedAt,
  };
}

function requestShape(r: SigRequestRow, signers?: SigSignerRow[]) {
  return {
    id: r.id,
    title: r.title,
    message: r.message,
    status: r.status,
    documentId: r.documentId,
    documentVersionId: r.documentVersionId,
    accountId: r.accountId,
    opportunityId: r.opportunityId,
    contactId: r.contactId,
    personId: r.personId,
    signedDocumentId: r.signedDocumentId,
    expiresAt: r.expiresAt,
    createdBy: r.createdBy,
    createdByLabel: r.createdByLabel,
    lastSyncError: r.lastSyncError,
    lastRemindedAt: r.lastRemindedAt,
    lastSyncedAt: r.lastSyncedAt,
    voidedAt: r.voidedAt,
    completedAt: r.completedAt,
    declinedAt: r.declinedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(signers ? { signers: signers.map(signerShape) } : {}),
  };
}

async function loadRequestSigners(requestIds: string[]): Promise<Map<string, SigSignerRow[]>> {
  if (requestIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(atelierSignatureSigners)
    .where(inArray(atelierSignatureSigners.requestId, requestIds));
  const map = new Map<string, SigSignerRow[]>();
  for (const row of rows) {
    map.set(row.requestId, [...(map.get(row.requestId) ?? []), row]);
  }
  for (const list of map.values()) list.sort((a, b) => a.signingOrder - b.signingOrder);
  return map;
}

const router: IRouter = Router();

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.get("/esign/requests", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;

  const conds = [eq(atelierSignatureRequests.orgId, me.orgId)];
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status) conds.push(eq(atelierSignatureRequests.status, status));
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
  if (accountId) conds.push(eq(atelierSignatureRequests.accountId, accountId));
  const opportunityId =
    typeof req.query.opportunityId === "string" ? req.query.opportunityId : null;
  if (opportunityId) conds.push(eq(atelierSignatureRequests.opportunityId, opportunityId));

  const rowsAll = await db
    .select()
    .from(atelierSignatureRequests)
    .where(and(...conds))
    .orderBy(desc(atelierSignatureRequests.createdAt));

  // Account visibility (defense-in-depth; leadership sees all accounts).
  const access = await accessibleEngagementIds(me);
  const rows: SigRequestRow[] = [];
  for (const r of rowsAll) {
    if (r.accountId && !(await canSeeAccount(access, me, r.accountId))) continue;
    rows.push(r);
  }

  const signerMap = await loadRequestSigners(rows.map((r) => r.id));
  res.json({
    configured: docusealConfigured(),
    requests: rows.map((r) => requestShape(r, signerMap.get(r.id) ?? [])),
  });
});

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(2000).optional(),
  documentId: z.string().min(1),
  signers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(254),
      }),
    )
    .min(1)
    .max(10),
  accountId: z.string().optional(),
  opportunityId: z.string().optional(),
  contactId: z.string().optional(),
  personId: z.string().optional(),
  /** Days until the request lapses (DocuSeal expire_at + local lapse). */
  expiresInDays: z.number().int().min(1).max(365).optional(),
  /**
   * Sender-chosen signature boxes, one per signer IN SIGNING ORDER.
   * Normalized page-fraction coordinates (top-left origin), 1-based
   * page. Omit to use the default layout on the last page.
   */
  placements: z
    .array(
      z.object({
        page: z.number().int().min(1).max(2000),
        x: z.number().min(0).max(0.98),
        y: z.number().min(0).max(0.98),
        w: z.number().min(0.02).max(1),
        h: z.number().min(0.01).max(0.5),
      }),
    )
    .min(1)
    .max(10)
    .optional(),
  /**
   * Optional extra date/initials boxes, each tied to one signer by
   * 0-based `signerIndex`. Same coordinate space as `placements`.
   */
  extraFields: z
    .array(
      z.object({
        signerIndex: z.number().int().min(0).max(9),
        type: z.enum(["date", "initials"]),
        page: z.number().int().min(1).max(2000),
        x: z.number().min(0).max(0.98),
        y: z.number().min(0).max(0.98),
        w: z.number().min(0.02).max(1),
        h: z.number().min(0.01).max(0.5),
      }),
    )
    .max(40)
    .optional(),
  /**
   * Page count as seen by the sender's PDF preview (pdf.js). Used to
   * clamp placement pages when the server cannot parse the PDF itself.
   */
  pageCount: z.number().int().min(1).max(2000).optional(),
});

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.post("/esign/requests", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;

  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  // Duplicate signer emails break DocuSeal submitter matching.
  const emails = body.signers.map((s) => s.email.toLowerCase());
  if (new Set(emails).size !== emails.length) {
    res.status(400).json({ error: "duplicate-signer-email" });
    return;
  }

  // Custom placements must cover every signer exactly once, in order.
  if (body.placements && body.placements.length !== body.signers.length) {
    res.status(400).json({
      error: "placement-count-mismatch",
      message: `Provide one signature placement per signer (${body.signers.length}), got ${body.placements.length}.`,
    });
    return;
  }
  // Boxes must fit on the page.
  if (body.placements?.some((p) => p.x + p.w > 1.0001 || p.y + p.h > 1.0001)) {
    res.status(400).json({
      error: "placement-out-of-bounds",
      message: "Signature boxes must fit within the page.",
    });
    return;
  }
  // Extra fields must reference an existing signer and fit on the page.
  if (body.extraFields?.some((f) => f.signerIndex >= body.signers.length)) {
    res.status(400).json({
      error: "extrafield-signer-mismatch",
      message: `Extra fields must reference a signer index below ${body.signers.length}.`,
    });
    return;
  }
  if (body.extraFields?.some((f) => f.x + f.w > 1.0001 || f.y + f.h > 1.0001)) {
    res.status(400).json({
      error: "extrafield-out-of-bounds",
      message: "Date and initials boxes must fit within the page.",
    });
    return;
  }

  const [doc] = await db
    .select()
    .from(atelierDocuments)
    .where(
      and(
        eq(atelierDocuments.id, body.documentId),
        eq(atelierDocuments.orgId, me.orgId),
        eq(atelierDocuments.status, "active"),
      ),
    );
  if (!doc || !doc.currentVersionId) {
    res.status(404).json({ error: "document-not-found" });
    return;
  }
  const [version] = await db
    .select()
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.id, doc.currentVersionId));
  if (!version) {
    res.status(404).json({ error: "document-version-not-found" });
    return;
  }
  if (version.mime !== "application/pdf") {
    res.status(400).json({
      error: "document-not-pdf",
      message: "Only PDF documents can be sent for signature.",
    });
    return;
  }
  const bytes = await loadDocBytes(version.blobRef);
  if (!bytes) {
    res.status(500).json({ error: "document-bytes-missing" });
    return;
  }

  // When the request is sent from a deal, verify the opportunity exists in
  // this org and default the account link from the deal itself.
  let oppAccountId: string | null = null;
  if (body.opportunityId) {
    const [opp] = await db
      .select({ id: atelierOpportunities.id, accountId: atelierOpportunities.accountId })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.id, body.opportunityId),
          eq(atelierOpportunities.orgId, me.orgId),
        ),
      );
    if (!opp) {
      res.status(404).json({ error: "opportunity-not-found" });
      return;
    }
    oppAccountId = opp.accountId;
  }

  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  try {
    const out = await sendSignatureRequest({
      orgId: me.orgId,
      actor: { id: me.id, name: me.name },
      title: body.title,
      message: body.message ?? null,
      documentId: doc.id,
      documentVersionId: version.id,
      fileName: version.fileName,
      pdfBytes: bytes,
      signers: body.signers,
      // When a deal is linked, the account link always follows the deal —
      // a mismatched body.accountId must not tie the request to another
      // account than the opportunity's.
      accountId: oppAccountId ?? body.accountId ?? doc.accountId ?? null,
      opportunityId: body.opportunityId ?? null,
      contactId: body.contactId ?? null,
      personId: body.personId ?? null,
      expiresAt,
      placements: body.placements ?? null,
      extraFields: body.extraFields ?? null,
      clientPageCount: body.pageCount ?? null,
    });
    res.status(201).json({ request: requestShape(out.request, out.signers) });
  } catch (err) {
    if (err instanceof PageCountUnknownError) {
      res.status(400).json({ error: "page-count-unknown", message: err.message });
      return;
    }
    handleUpstreamError(res, err);
  }
});

async function loadOwnRequest(
  req: Request,
  res: Response,
  me: Me,
): Promise<SigRequestRow | null> {
  const [row] = await db
    .select()
    .from(atelierSignatureRequests)
    .where(
      and(
        eq(atelierSignatureRequests.id, String(req.params.id ?? "")),
        eq(atelierSignatureRequests.orgId, me.orgId),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "signature-request-not-found" });
    return null;
  }
  return row;
}

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.get("/esign/requests/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;
  const row = await loadOwnRequest(req, res, me);
  if (!row) return;
  const signerMap = await loadRequestSigners([row.id]);
  res.json({ request: requestShape(row, signerMap.get(row.id) ?? []) });
});

// Task #300 — embedded signing link for the CALLER's own pending signer
// on an open request (the "Sign & send" in-app partner signature). The
// link is fetched live from DocuSeal (authoritative — slugs are never
// persisted locally), matched to the caller by signer email. Explicit
// errors for every unavailable state; nothing is mutated here.
// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.get("/esign/requests/:id/signing-link", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;
  const row = await loadOwnRequest(req, res, me);
  if (!row) return;
  if (row.status !== "sent" && row.status !== "partially_signed") {
    res.status(409).json({
      error: "request-not-open",
      message: `This signature request is ${row.status} — there is nothing left to sign.`,
    });
    return;
  }
  const signerMap = await loadRequestSigners([row.id]);
  const signers = signerMap.get(row.id) ?? [];
  const myEmail = (me.email ?? "").trim().toLowerCase();
  const mine = signers.find((s) => s.email.trim().toLowerCase() === myEmail);
  if (!mine) {
    res.status(409).json({
      error: "no-matching-signer",
      message: "You are not a signer on this request — it was sent to other recipients.",
    });
    return;
  }
  if (mine.status === "completed" || mine.status === "declined") {
    res.status(409).json({
      error: "already-signed",
      message: `You have already ${mine.status === "completed" ? "signed" : "declined"} this document.`,
    });
    return;
  }
  if (!row.docusealSubmissionId) {
    res.status(409).json({
      error: "no-submission",
      message: "This request has no DocuSeal submission attached.",
    });
    return;
  }
  try {
    const submission = await getSubmission(Number(row.docusealSubmissionId));
    const submitter = submission.submitters.find(
      (s) =>
        (mine.docusealSubmitterId && String(s.id) === mine.docusealSubmitterId) ||
        s.email.trim().toLowerCase() === myEmail,
    );
    if (!submitter) {
      res.status(502).json({
        error: "submitter-not-found",
        message: "DocuSeal no longer lists you as a signer on this submission.",
      });
      return;
    }
    if (submitter.status === "completed" || submitter.status === "declined") {
      res.status(409).json({
        error: "already-signed",
        message: "DocuSeal reports your signature step is already finished.",
      });
      return;
    }
    const url = submitterEmbedSrc(submitter);
    if (!url) {
      res.status(502).json({
        error: "signing-link-unavailable",
        message:
          "DocuSeal did not return an embedded signing link for your signer. Use the signature email instead.",
      });
      return;
    }
    res.json({
      url,
      signerId: mine.id,
      signerStatus: submitter.status,
      signingOrder: mine.signingOrder,
      requestId: row.id,
    });
  } catch (err) {
    handleUpstreamError(res, err);
  }
});

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.post("/esign/requests/:id/void", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;
  const row = await loadOwnRequest(req, res, me);
  if (!row) return;
  if (row.status === "voided") {
    res.json({ request: requestShape(row) });
    return;
  }
  if (row.status !== "sent" && row.status !== "partially_signed") {
    res.status(409).json({ error: "not-voidable", status: row.status });
    return;
  }
  try {
    const updated = await voidSignatureRequest({ row, actor: { id: me.id, name: me.name } });
    res.json({ request: requestShape(updated) });
  } catch (err) {
    handleUpstreamError(res, err);
  }
});

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.post("/esign/requests/:id/remind", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;
  const row = await loadOwnRequest(req, res, me);
  if (!row) return;
  if (row.status !== "sent" && row.status !== "partially_signed") {
    res.status(409).json({ error: "not-remindable", status: row.status });
    return;
  }
  try {
    const out = await remindSignatureRequest({ row, actor: { id: me.id, name: me.name } });
    res.json({ reminded: out.reminded });
  } catch (err) {
    handleUpstreamError(res, err);
  }
});

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.post("/esign/requests/:id/sync", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;
  const row = await loadOwnRequest(req, res, me);
  if (!row) return;
  try {
    const out = await syncSignatureRequest(row.id);
    const signerMap = await loadRequestSigners([row.id]);
    res.json({
      request: requestShape(out.request, signerMap.get(row.id) ?? []),
      changed: out.changed,
    });
  } catch (err) {
    handleUpstreamError(res, err);
  }
});

// @cli-skip: e-sign surfaces are UI-driven (Task #62)
router.post("/esign/sync", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureEsignRole(me, res)) return;
  const out = await syncAllOpenRequests();
  res.json(out);
});

export default router;
