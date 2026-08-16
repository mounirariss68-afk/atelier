/**
 * Task #1191 — Client-logo blob storage (private object storage).
 *
 * Logos uploaded by partners for client accounts live in Replit App Storage
 * (GCS) under the private object dir, sub-prefix `atelier-account-logos`.
 * The DB column `atelier_accounts.client_logo_ref` carries `accountlogo:<key>`
 * as the opaque pointer.  Bytes are ONLY ever streamed through authenticated
 * routes — no public URLs are ever minted.
 *
 * Mirrors personDocStorage.ts: fail-loud when PRIVATE_OBJECT_DIR is unset,
 * no silent memory fallback.
 */

import { createHash, randomBytes } from "node:crypto";
import { objectStorageClient } from "./objectStorage.js";

export const ACCOUNT_LOGO_PREFIX = "accountlogo:";

const BLOB_SUBDIR = "atelier-account-logos";

function resolveTarget(): { bucketName: string; basePrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for account " +
        "logos. Provision App Storage before uploading.",
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

export async function storeAccountLogoBytes(
  buf: Buffer,
  contentType: string,
): Promise<{ fileRef: string; sha256: string; sizeBytes: number }> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${sha256.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buf, { resumable: false, contentType: contentType || "image/png" });
  return { fileRef: `${ACCOUNT_LOGO_PREFIX}${key}`, sha256, sizeBytes: buf.byteLength };
}

export async function loadAccountLogoBytes(
  fileRef: string,
): Promise<{ buf: Buffer; contentType: string } | null> {
  if (!fileRef.startsWith(ACCOUNT_LOGO_PREFIX)) return null;
  const key = fileRef.slice(ACCOUNT_LOGO_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  try {
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [contents, meta] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType =
      (meta[0]?.contentType as string | undefined) ?? "image/png";
    return { buf: contents[0], contentType };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return null;
    throw err;
  }
}

export async function dropAccountLogoBytes(fileRef: string): Promise<void> {
  if (!fileRef.startsWith(ACCOUNT_LOGO_PREFIX)) return;
  const key = fileRef.slice(ACCOUNT_LOGO_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  try {
    await objectStorageClient.bucket(bucketName).file(objectName).delete();
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return; // already gone — idempotent
    throw err;
  }
}

/** Convert a stored logo ref to an inline data URI for embedding in offline
 *  HTML (e.g. the downloaded prep card). Returns null if no ref or load fails. */
export async function logoRefToDataUri(fileRef: string | null | undefined): Promise<string | null> {
  if (!fileRef) return null;
  try {
    const result = await loadAccountLogoBytes(fileRef);
    if (!result) return null;
    return `data:${result.contentType};base64,${result.buf.toString("base64")}`;
  } catch {
    return null;
  }
}
