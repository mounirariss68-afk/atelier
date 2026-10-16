/**
 * Phase 0 (Oct 2026 audit) — one way to read an expense receipt whatever
 * path created the expense.
 *
 * Expenses created in the UI store `/objects/<key>` (object storage);
 * expenses created through Riser store `enc:cli:<attachmentId>` (a chat
 * attachment whose row carries the real blob pointer). Until now only the
 * parse path understood the second form, so the two receipt endpoints
 * returned 404 for every chat-submitted expense and approvers saw a broken
 * image. Both endpoints now call `serveChatReceipt` for `enc:cli:` refs.
 */
import type { Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, atelierCliAttachments } from "@workspace/db";
import { CLI_ENC_PREFIX, loadAttachmentBytes } from "./atelier-cli/attachments/storage.js";
import { sendReceiptForDisplay } from "./atelier-heic.js";

export function isChatReceiptRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith(CLI_ENC_PREFIX);
}

export function isObjectReceiptRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("/objects/");
}

/**
 * Resolve an `enc:cli:<attachmentId>` receipt to bytes + media type. Returns
 * null when the attachment row or blob is gone (e.g. purged by retention
 * before the Phase 0 exclusion landed).
 */
export async function loadChatReceipt(
  ref: string,
  orgId: string,
): Promise<{ bytes: Buffer; mime: string; fileName: string } | null> {
  const key = ref.slice(CLI_ENC_PREFIX.length);
  const [att] = await db
    .select({
      id: atelierCliAttachments.id,
      mime: atelierCliAttachments.mime,
      fileName: atelierCliAttachments.fileName,
      encryptedRef: atelierCliAttachments.encryptedRef,
    })
    .from(atelierCliAttachments)
    .where(and(eq(atelierCliAttachments.id, key), eq(atelierCliAttachments.orgId, orgId)));
  const bytes =
    (att?.encryptedRef ? await loadAttachmentBytes(att.encryptedRef) : null) ??
    (await loadAttachmentBytes(ref));
  if (!bytes) return null;
  return {
    bytes,
    mime: att?.mime ?? "application/octet-stream",
    fileName: att?.fileName ?? "receipt",
  };
}

/** Stream a chat-created receipt to the browser, HEIC converted like UI receipts. */
export async function serveChatReceipt(res: Response, ref: string, orgId: string): Promise<boolean> {
  const loaded = await loadChatReceipt(ref, orgId);
  if (!loaded) return false;
  const synthetic = new globalThis.Response(new Uint8Array(loaded.bytes), {
    status: 200,
    headers: {
      "content-type": loaded.mime,
      "content-length": String(loaded.bytes.length),
      "cache-control": "private, max-age=60",
      "content-disposition": `inline; filename="${loaded.fileName.replace(/"/g, "")}"`,
    },
  });
  await sendReceiptForDisplay(res, synthetic);
  return true;
}
