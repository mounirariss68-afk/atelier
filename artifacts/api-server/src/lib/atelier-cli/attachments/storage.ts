/**
 * Task #334 — CLI attachment blob storage.
 *
 * The CLI never holds raw bytes inside its DB rows. Uploads land in
 * an opaque blob store and the row carries `enc:cli:<key>` as the
 * pointer (mirrors `enc:wallet:` from walletRoutes — no live KMS in
 * this build, the prefix is an application-layer indicator).
 *
 * Implementation: per-process in-memory map. The CLI orchestrator and
 * the extractor pipeline both run inside the api-server, so a memory
 * store is sufficient for this task. Switching to a real bucket later
 * is a one-file change because every consumer goes through the
 * `loadAttachmentBytes` accessor.
 */

import { createHash, randomBytes } from "node:crypto";

const BLOBS = new Map<string, Buffer>();

export const CLI_ENC_PREFIX = "enc:cli:";

export function storeAttachmentBytes(buf: Buffer): {
  encryptedRef: string;
  sha256: string;
  sizeBytes: number;
} {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${sha256.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  BLOBS.set(key, buf);
  return {
    encryptedRef: `${CLI_ENC_PREFIX}${key}`,
    sha256,
    sizeBytes: buf.byteLength,
  };
}

export function loadAttachmentBytes(encryptedRef: string): Buffer | null {
  if (!encryptedRef.startsWith(CLI_ENC_PREFIX)) return null;
  const key = encryptedRef.slice(CLI_ENC_PREFIX.length);
  return BLOBS.get(key) ?? null;
}

export function dropAttachmentBytes(encryptedRef: string): void {
  if (!encryptedRef.startsWith(CLI_ENC_PREFIX)) return;
  BLOBS.delete(encryptedRef.slice(CLI_ENC_PREFIX.length));
}

/** Test-only — clears the in-memory store so suites stay isolated. */
export function __resetAttachmentStorage(): void {
  BLOBS.clear();
}
