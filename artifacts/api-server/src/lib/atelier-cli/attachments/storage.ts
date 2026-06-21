/**
 * Task #575 — CLI attachment blob storage (durable, object-storage backed).
 *
 * Uploaded bytes never live inside DB rows. They land in Replit App
 * Storage (GCS) under the private object dir, and the attachment row
 * carries `enc:cli:<key>` as the opaque pointer. The `enc:` prefix is
 * an application-layer indicator (mirrors `enc:wallet:` from
 * walletRoutes — there is no live KMS in this build).
 *
 * Every consumer goes through the three accessors below, so the
 * physical store is a single-file concern. These used to be a
 * per-process in-memory Map (demo-grade — bytes vanished on restart and
 * never survived horizontal scale); they are now backed by durable
 * object storage and are async.
 */

import { createHash, randomBytes } from "node:crypto";
import { objectStorageClient } from "../../objectStorage.js";

export const CLI_ENC_PREFIX = "enc:cli:";

/** Sub-prefix (within the private object dir) for CLI attachment blobs. */
const BLOB_SUBDIR = "atelier-cli-attachments";

interface BucketTarget {
  bucketName: string;
  /** Prefix WITHOUT the trailing blob key, no leading/trailing slash issues. */
  basePrefix: string;
}

/**
 * Resolve the bucket + base prefix from `PRIVATE_OBJECT_DIR`, which has
 * the shape `/<bucket>/<dir...>`. Fails loudly when object storage is
 * not provisioned — silent fallback to memory is exactly the demo-grade
 * behaviour this task removes.
 */
function resolveTarget(): BucketTarget {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for CLI " +
        "attachments. Provision App Storage before ingesting documents.",
    );
  }
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    // Bucket only, no sub-dir.
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

export async function storeAttachmentBytes(buf: Buffer): Promise<{
  encryptedRef: string;
  sha256: string;
  sizeBytes: number;
}> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${sha256.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buf, { resumable: false, contentType: "application/octet-stream" });
  return {
    encryptedRef: `${CLI_ENC_PREFIX}${key}`,
    sha256,
    sizeBytes: buf.byteLength,
  };
}

export async function loadAttachmentBytes(encryptedRef: string): Promise<Buffer | null> {
  if (!encryptedRef.startsWith(CLI_ENC_PREFIX)) return null;
  const key = encryptedRef.slice(CLI_ENC_PREFIX.length);
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

export async function dropAttachmentBytes(encryptedRef: string): Promise<void> {
  if (!encryptedRef.startsWith(CLI_ENC_PREFIX)) return;
  const key = encryptedRef.slice(CLI_ENC_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .delete({ ignoreNotFound: true });
}

/**
 * Test/maintenance helper — no-op for durable storage. Object storage is
 * naturally isolated by unique keys, so suites no longer need to clear a
 * shared in-memory map. Kept for call-site compatibility.
 */
export function __resetAttachmentStorage(): void {
  /* no-op: durable storage needs no per-suite reset */
}
