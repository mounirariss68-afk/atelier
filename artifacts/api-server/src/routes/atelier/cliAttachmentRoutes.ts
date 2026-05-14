/**
 * Task #334 — CLI attachment upload route.
 *
 * Endpoint:
 *   POST /api/atelier/cli/attachments
 *     multipart/form-data: file=<binary> [sessionId, turnId]
 *     → 200 { attachmentId, kind, intent, intents, digest, chunkCount }
 *     → 4xx { error: rejection_reason }
 *
 *   GET  /api/atelier/cli/attachments/:id
 *     → 200 { attachment, extracted }
 *     (extraction body for the composer to render the digest panel)
 *
 * Storage: the multer memory store keeps the file in RAM; the ingest
 * pipeline copies it into the `enc:cli:` blob store and immediately
 * runs extraction + chunking before the response returns. No async
 * job is dispatched — the composer is allowed to block on the ingest
 * because attachment uploads sit in front of the user's confirm
 * action anyway.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { atelierUsers } from "@workspace/db";
import { ingestAttachment, loadAttachment } from "../../lib/atelier-cli/attachments/index.js";

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

// Per-file 25 MB cap; up to 8 files per request; 60 MB aggregate ceiling
// per turn (counted client-side here as well so the server stays the
// authoritative limit for prompt-budget calculations downstream).
const PER_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 8;
const PER_TURN_TOTAL_BYTES = 60 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PER_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
});

const router: IRouter = Router();

/**
 * Wraps `upload.array(...)` so multer's own `LIMIT_FILE_SIZE` /
 * `LIMIT_FILE_COUNT` errors return a structured 413 JSON response
 * (rather than the default HTML error page) and the rejection still
 * surfaces in the composer's error toast. Audit-trail rejection rows
 * are emitted by `ingestAttachment` for any file that *did* reach the
 * handler; multer-level rejects are pre-handler and so are reflected
 * only in the response.
 */
function uploadWithErrorHandling(
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): void {
  upload.array("files", MAX_FILES_PER_REQUEST)(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const code = err.code;
      const status =
        code === "LIMIT_FILE_SIZE" || code === "LIMIT_FILE_COUNT" ? 413 : 400;
      res.status(status).json({
        error: code.toLowerCase().replace(/_/g, "-"),
        message: err.message,
      });
      return;
    }
    res.status(400).json({ error: "upload-error", message: String(err) });
  });
}

router.post("/cli/attachments", uploadWithErrorHandling, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Accept either `files[]` (preferred, multi) or a legacy `file` single.
  const files = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).slice();
  const single = (req as Request & { file?: Express.Multer.File }).file;
  if (single) files.push(single);
  if (files.length === 0) {
    res.status(400).json({ error: "no-file" });
    return;
  }
  const total = files.reduce((acc, f) => acc + f.size, 0);
  if (total > PER_TURN_TOTAL_BYTES) {
    res.status(413).json({
      error: "per-turn-total-cap",
      cap: PER_TURN_TOTAL_BYTES,
      total,
    });
    return;
  }
  const sessionId =
    typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
  const turnId =
    typeof req.body?.turnId === "string" ? req.body.turnId : null;

  const results = await Promise.all(
    files.map((f) =>
      ingestAttachment({
        orgId: me.orgId,
        userId: me.id,
        userLabel: me.name,
        sessionId,
        turnId,
        fileName: f.originalname || "upload",
        mime: f.mimetype || "application/octet-stream",
        bytes: f.buffer,
      }),
    ),
  );
  // Primary contract: `attachmentIds[]` (the orchestrator's
  // `runTurn({attachmentIds})` consumes this verbatim). The verbose
  // `attachments[]` array carries per-file details for the composer's
  // result chips and rejection messaging.
  res.json({
    attachmentIds: results.filter((r) => r.ok).map((r) => r.attachmentId),
    attachments: results.map((r) =>
      r.ok
        ? {
            ok: true,
            attachmentId: r.attachmentId,
            encryptedRef: r.encryptedRef,
            kind: r.kind,
            intent: r.intent,
            intents: r.intents,
            digest: r.digest,
            chunkCount: r.chunkCount,
            warnings: r.warnings,
            nestedAttachmentIds: r.nestedAttachmentIds ?? [],
          }
        : { ok: false, attachmentId: r.attachmentId, reason: r.reason },
    ),
  });
});

router.get("/cli/attachments/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const loaded = await loadAttachment(req.params.id);
  if (!loaded) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  // Org guard — uploads are visible only to the persona that ingested
  // them or to other personas in the same org.
  if (loaded.attachment.orgId !== me.orgId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({
    attachment: {
      id: loaded.attachment.id,
      fileName: loaded.attachment.fileName,
      mime: loaded.attachment.mime,
      sizeBytes: loaded.attachment.sizeBytes,
      sha256: loaded.attachment.sha256,
      status: loaded.attachment.status,
      rejectionReason: loaded.attachment.rejectionReason,
      intentHint: loaded.attachment.intentHint,
      sessionId: loaded.attachment.sessionId,
      turnId: loaded.attachment.turnId,
      createdAt: loaded.attachment.createdAt,
    },
    extracted: loaded.extracted
      ? {
          kind: loaded.extracted.kind,
          digest: loaded.extracted.digest,
          chunkCount: (loaded.extracted.chunks ?? []).length,
          tableSummary: loaded.extracted.tableSummary,
          slideTexts: loaded.extracted.slideTexts,
          emailHeaders: loaded.extracted.emailHeaders,
          warnings: loaded.extracted.warnings,
        }
      : null,
  });
});

export default router;
