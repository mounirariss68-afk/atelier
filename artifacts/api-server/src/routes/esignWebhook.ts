/**
 * Task #62 — Public DocuSeal webhook endpoint.
 *
 * Mounted BEFORE the global auth gate (DocuSeal cannot present a
 * session cookie). Two layers keep this safe:
 *
 *   1. Optional shared secret: when DOCUSEAL_WEBHOOK_SECRET is set,
 *      the webhook must carry it in the `X-Docuseal-Secret` header
 *      (configure the same header on the DocuSeal webhook settings
 *      page). Mismatches are rejected with 401.
 *   2. Zero trust in the payload: the body is ONLY used to find which
 *      submission to reconcile. All state comes from an authenticated
 *      re-fetch of the submission from the DocuSeal API — a spoofed
 *      webhook can at worst trigger a no-op sync.
 *
 * Always answers 200 for events about unknown submissions so DocuSeal
 * doesn't retry forever on requests created outside Atelier.
 */

import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import {
  findRequestBySubmissionId,
  syncSignatureRequest,
} from "../lib/atelier-esign.js";

const router: IRouter = Router();

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull a submission id out of the various DocuSeal event payload shapes. */
function extractSubmissionId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  // form.* events carry submission_id on the submitter; submission.*
  // events carry the submission itself (id).
  const sid = d.submission_id ?? d.id;
  if (typeof sid === "number" || typeof sid === "string") return String(sid);
  return null;
}

router.post("/docuseal", async (req, res) => {
  const expected = process.env.DOCUSEAL_WEBHOOK_SECRET?.trim();
  if (expected) {
    const provided = req.get("x-docuseal-secret") ?? undefined;
    if (!secretMatches(provided, expected)) {
      res.status(401).json({ error: "invalid-webhook-secret" });
      return;
    }
  }

  const submissionId = extractSubmissionId(req.body);
  if (!submissionId) {
    res.status(400).json({ error: "missing-submission-id" });
    return;
  }

  const request = await findRequestBySubmissionId(submissionId);
  if (!request) {
    // Not ours (or already purged) — acknowledge so DocuSeal stops retrying.
    res.json({ ok: true, matched: false });
    return;
  }

  try {
    const out = await syncSignatureRequest(request.id);
    res.json({ ok: true, matched: true, status: out.request.status, changed: out.changed });
  } catch (err) {
    // Sync failure is recorded on the row (last_sync_error). Return 500 so
    // DocuSeal retries later — the polling loop is the second safety net.
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 300) : "sync-failed",
    });
  }
});

export default router;
