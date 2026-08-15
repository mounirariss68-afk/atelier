/**
 * Task #1174 — Shared-document blob storage for the partner delivery portal.
 *
 * Files shared with a partner firm (internal → firm SNAPSHOTS of library
 * documents) and files a partner uploads for internal review live in Replit
 * App Storage (GCS) under the private object dir, sub-prefix
 * `atelier-partner-shared`. Bytes are ALWAYS keyed under a FIRM-SCOPED path
 * prefix (`partner-shared/<firmId>/<sha-prefix>-<rand>`), and any dedupe is
 * per-firm only — NEVER org-global. Org-global dedupe would leak an existence
 * side-channel (firm B could probe whether firm A holds identical bytes).
 *
 * The DB row (atelier_partner_shared_documents) carries `pshared:<key>` in
 * `blob_ref` as the opaque pointer, where `<key>` is the firm-scoped relative
 * path. Bytes are ONLY ever streamed through authenticated routes that enforce
 * own-firm / internal-reviewer access — no public URLs are ever minted.
 *
 * Cloned from partnerDocStorage.ts: fail-loud when PRIVATE_OBJECT_DIR is
 * unset, no silent memory fallback.
 */

import { randomBytes } from "node:crypto";
import { objectStorageClient } from "./objectStorage.js";

export const PARTNER_SHARED_PREFIX = "pshared:";

const BLOB_SUBDIR = "atelier-partner-shared";

function resolveTarget(): { bucketName: string; basePrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for partner " +
        "shared documents. Provision App Storage before sharing files.",
    );
  }
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return { bucketName: trimmed, basePrefix: BLOB_SUBDIR };
  }
  const bucketName = trimmed.slice(0, slash);
  const dirPrefix = trimmed.slice(slash + 1).replace(/\/+$/, "");
  return { bucketName, basePrefix: `${dirPrefix}/${BLOB_SUBDIR}` };
}

/** The relative key `<firmId>/<sha-prefix>-<rand>` maps to an object name. */
function objectNameForKey(key: string): { bucketName: string; objectName: string } {
  const { bucketName, basePrefix } = resolveTarget();
  return { bucketName, objectName: `${basePrefix}/${key}` };
}

/** Sanitize a firm id for use as a path segment (defensive; ids are opaque). */
function firmSegment(partnerFirmId: string): string {
  const s = partnerFirmId.replace(/[^A-Za-z0-9_.-]/g, "_");
  return s || "unknown-firm";
}

/**
 * Store bytes under a FIRM-SCOPED key. `sha256` is the caller-computed digest
 * (used only for the key prefix + the stored row's sha column — never for
 * cross-firm dedupe).
 */
export async function storeSharedDocBytes(args: {
  partnerFirmId: string;
  buf: Buffer;
  sha256: string;
  contentType: string;
}): Promise<{ blobRef: string; sizeBytes: number }> {
  const key = `${firmSegment(args.partnerFirmId)}/${args.sha256.slice(0, 16)}-${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(args.buf, {
      resumable: false,
      contentType: args.contentType || "application/octet-stream",
    });
  return { blobRef: `${PARTNER_SHARED_PREFIX}${key}`, sizeBytes: args.buf.byteLength };
}

export async function loadSharedDocBytes(blobRef: string): Promise<Buffer | null> {
  if (!blobRef.startsWith(PARTNER_SHARED_PREFIX)) return null;
  const key = blobRef.slice(PARTNER_SHARED_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  try {
    const [contents] = await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .download();
    return contents;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return null;
    throw err;
  }
}

export async function dropSharedDocBytes(blobRef: string): Promise<void> {
  if (!blobRef.startsWith(PARTNER_SHARED_PREFIX)) return;
  const key = blobRef.slice(PARTNER_SHARED_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .delete({ ignoreNotFound: true });
}
