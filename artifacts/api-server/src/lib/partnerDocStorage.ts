/**
 * Task #1172 — Partner-firm document blob storage (private object storage).
 *
 * Trade licenses / certificates / insurance / VAT-TRN / signatory IDs
 * uploaded during partner registration or via the partner portal live in
 * Replit App Storage (GCS) under the private object dir, sub-prefix
 * `atelier-partner-docs`. The DB row (atelier_partner_firm_documents)
 * carries `partnerdoc:<key>` in `file_ref` as the opaque pointer. Bytes are
 * ONLY ever streamed through authenticated routes that enforce own-firm /
 * internal-reviewer access — no public URLs are ever minted.
 *
 * Cloned from personDocStorage.ts: fail-loud when PRIVATE_OBJECT_DIR is
 * unset, no silent memory fallback.
 */

import { createHash, randomBytes } from "node:crypto";
import { objectStorageClient } from "./objectStorage.js";

export const PARTNER_DOC_PREFIX = "partnerdoc:";

const BLOB_SUBDIR = "atelier-partner-docs";

/**
 * Decode a client base64 string, rejecting canonically-invalid input.
 *
 * Buffer.from(..., "base64") is lenient (silently drops junk), so we
 * re-encode and compare lengths (ignoring padding/whitespace) to ensure the
 * payload actually round-trips — catching truncated or corrupt uploads.
 * Returns null when the input is not valid canonical base64.
 */
export function decodeBase64Strict(input: string): Buffer | null {
  const compact = input.replace(/\s+/g, "");
  if (compact.length === 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  const buf = Buffer.from(compact, "base64");
  if (buf.byteLength === 0) return null;
  // Re-encode without padding on both sides for a length-agnostic compare.
  const reencoded = buf.toString("base64").replace(/=+$/, "");
  if (reencoded !== compact.replace(/=+$/, "")) return null;
  return buf;
}

/**
 * Verify the decoded bytes actually match the declared MIME's magic bytes.
 * Clients cannot be trusted to label uploads honestly, so we sniff the
 * leading signature and require it to agree with the allowlisted mime.
 *   - application/pdf → "%PDF-"
 *   - image/png       → 0x89 50 4E 47 0D 0A 1A 0A
 *   - image/jpeg      → 0xFF 0xD8 0xFF
 */
export function magicBytesMatchMime(buf: Buffer, mime: string): boolean {
  switch (mime) {
    case "application/pdf":
      return (
        buf.length >= 5 &&
        buf[0] === 0x25 &&
        buf[1] === 0x50 &&
        buf[2] === 0x44 &&
        buf[3] === 0x46 &&
        buf[4] === 0x2d
      );
    case "image/png":
      return (
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    case "image/jpeg":
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    default:
      return false;
  }
}

function resolveTarget(): { bucketName: string; basePrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for partner " +
        "documents. Provision App Storage before uploading files.",
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

function objectNameForKey(key: string): { bucketName: string; objectName: string } {
  const { bucketName, basePrefix } = resolveTarget();
  return { bucketName, objectName: `${basePrefix}/${key}` };
}

export async function storePartnerDocBytes(
  buf: Buffer,
  contentType: string,
): Promise<{ fileRef: string; sha256: string; sizeBytes: number }> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${sha256.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buf, { resumable: false, contentType: contentType || "application/octet-stream" });
  return { fileRef: `${PARTNER_DOC_PREFIX}${key}`, sha256, sizeBytes: buf.byteLength };
}

export async function loadPartnerDocBytes(fileRef: string): Promise<Buffer | null> {
  if (!fileRef.startsWith(PARTNER_DOC_PREFIX)) return null;
  const key = fileRef.slice(PARTNER_DOC_PREFIX.length);
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

export async function dropPartnerDocBytes(fileRef: string): Promise<void> {
  if (!fileRef.startsWith(PARTNER_DOC_PREFIX)) return;
  const key = fileRef.slice(PARTNER_DOC_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .delete({ ignoreNotFound: true });
}
