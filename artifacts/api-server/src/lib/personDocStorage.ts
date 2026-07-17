/**
 * Task #51 — Person-document blob storage (private object storage).
 *
 * Scans of passports / IDs / residency documents, dependent documents and
 * profile photos live in Replit App Storage (GCS) under the private object
 * dir, sub-prefix `atelier-person-docs`. The DB row
 * (atelier_person_documents) carries `persondoc:<key>` in `file_ref` as
 * the opaque pointer. Bytes are ONLY ever streamed through authenticated
 * routes that enforce owner-or-HR access — no public URLs are ever minted.
 *
 * Mirrors the CLI attachment store (atelier-cli/attachments/storage.ts):
 * fail-loud when PRIVATE_OBJECT_DIR is unset, no silent memory fallback.
 */

import { createHash, randomBytes } from "node:crypto";
import { objectStorageClient } from "./objectStorage.js";

export const PERSON_DOC_PREFIX = "persondoc:";

const BLOB_SUBDIR = "atelier-person-docs";

function resolveTarget(): { bucketName: string; basePrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for person " +
        "documents. Provision App Storage before uploading scans.",
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

export async function storePersonDocBytes(
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
  return { fileRef: `${PERSON_DOC_PREFIX}${key}`, sha256, sizeBytes: buf.byteLength };
}

export async function loadPersonDocBytes(fileRef: string): Promise<Buffer | null> {
  if (!fileRef.startsWith(PERSON_DOC_PREFIX)) return null;
  const key = fileRef.slice(PERSON_DOC_PREFIX.length);
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

export async function dropPersonDocBytes(fileRef: string): Promise<void> {
  if (!fileRef.startsWith(PERSON_DOC_PREFIX)) return;
  const key = fileRef.slice(PERSON_DOC_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .delete({ ignoreNotFound: true });
}
