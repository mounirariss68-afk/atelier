/**
 * Task #554 — server-side HEIC/HEIF → JPEG conversion for receipt photos.
 *
 * iPhones save photos as HEIC by default; browsers can't render it and the
 * vision extractor doesn't accept it. All parse + preview surfaces convert
 * HEIC bytes to JPEG here so iPhone photos "just work" everywhere.
 *
 * Detection is belt-and-braces: declared media type OR ISO-BMFF magic bytes
 * (object storage sometimes reports application/octet-stream for uploads).
 */

import type { Response } from "express";
import convert from "heic-convert";

export const HEIC_MEDIA_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

// ISO-BMFF "ftyp" major brands used by HEIC/HEIF stills (AVIF uses avif/avis
// and is deliberately NOT listed — it stays unsupported).
const HEIC_FTYP_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

/** Magic-byte sniff: bytes 4-8 are "ftyp", bytes 8-12 a known HEIC brand. */
export function looksLikeHeic(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  return HEIC_FTYP_BRANDS.has(bytes.toString("ascii", 8, 12).toLowerCase().trim());
}

/** True when the declared type or the magic bytes say HEIC/HEIF. */
export function isHeicPayload(bytes: Buffer, mediaType: string): boolean {
  if (HEIC_MEDIA_TYPES.has(mediaType)) return true;
  // Fallback for generic/absent content types from object storage.
  if (mediaType === "" || mediaType === "application/octet-stream") {
    return looksLikeHeic(bytes);
  }
  return false;
}

/**
 * Decode HEIC and re-encode as JPEG. Throws on undecodable input — callers
 * surface that as a typed 422 (fail-loud), never a silent guess.
 */
export async function convertHeicToJpeg(bytes: Buffer): Promise<Buffer> {
  const out = await convert({
    buffer: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    format: "JPEG",
    quality: 0.85,
  });
  return Buffer.from(out);
}

/**
 * Stream a stored receipt to the browser, transparently converting HEIC to
 * JPEG for display (browsers can't render HEIC). On conversion failure the
 * original bytes are served as-is — the parse pipeline is the loud-failure
 * surface; a preview stream should still hand over what's stored.
 */
export async function sendReceiptForDisplay(res: Response, response: globalThis.Response): Promise<void> {
  const buf = Buffer.from(await response.arrayBuffer());
  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (isHeicPayload(buf, mediaType)) {
    try {
      const jpeg = await convertHeicToJpeg(buf);
      res.status(200);
      response.headers.forEach((v, k) => {
        const key = k.toLowerCase();
        if (key === "content-type" || key === "content-length" || key === "etag") return;
        res.setHeader(k, v);
      });
      res.setHeader("content-type", "image/jpeg");
      res.end(jpeg);
      return;
    } catch {
      // fall through — serve original bytes
    }
  }
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(buf);
}
