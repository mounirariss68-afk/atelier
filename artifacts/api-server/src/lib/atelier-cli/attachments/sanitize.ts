/**
 * Task #334 — pre-storage metadata sanitization.
 *
 * Strips embedded metadata that could leak PII (EXIF GPS / camera /
 * authoring info) before the bytes ever reach `storeAttachmentBytes`.
 * Implemented as a pure-buffer rewriter so we have no dependency on a
 * native image library:
 *
 *   - JPEG: walk APPn / COM segments and drop APP0..APP15 + comments,
 *     keeping the SOI, DQT/DHT/SOFn/SOS marker chain and entropy data.
 *   - PNG : preserve IHDR/PLTE/IDAT/IEND and other critical chunks
 *     (uppercase first byte) but drop ancillary text/metadata chunks
 *     tEXt / iTXt / zTXt / tIME / eXIf.
 *   - Anything else (PDF/DOCX/PPTX/CSV/EML/TXT) is returned unchanged
 *     and a warning surfaces on the extracted-doc audit so operators
 *     can see the sanitizer ran in pass-through mode.
 *
 * Returns `{ bytes, strippedBytes, warning? }`. `strippedBytes` is the
 * count of metadata bytes removed (>0 ⇒ sanitization actually fired).
 */

export interface SanitizeResult {
  bytes: Buffer;
  strippedBytes: number;
  warning?: string;
}

const JPEG_SOI = 0xffd8;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sanitizeJpeg(buf: Buffer): SanitizeResult {
  if (buf.length < 4 || buf.readUInt16BE(0) !== JPEG_SOI) {
    return { bytes: buf, strippedBytes: 0, warning: "not-a-jpeg" };
  }
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  let stripped = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      // Stream is malformed — emit the rest verbatim and bail.
      out.push(buf.slice(i));
      break;
    }
    // Skip 0xFF padding bytes.
    let m = i + 1;
    while (m < buf.length && buf[m] === 0xff) m++;
    if (m >= buf.length) break;
    const marker = buf[m];
    const headerEnd = m + 1;
    // Stand-alone markers (no length): SOI, EOI, RSTn, TEM.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(buf.slice(i, headerEnd));
      i = headerEnd;
      if (marker === 0xd9) break; // EOI
      continue;
    }
    if (headerEnd + 2 > buf.length) {
      out.push(buf.slice(i));
      break;
    }
    const segLen = buf.readUInt16BE(headerEnd);
    const segEnd = headerEnd + segLen;
    const isAppOrCom = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (isAppOrCom) {
      // Drop the entire APPn / COM segment (header + length + payload).
      stripped += segEnd - i;
      i = segEnd;
      continue;
    }
    if (marker === 0xda) {
      // SOS — emit segment header then the entropy-coded scan that
      // follows, terminated by EOI / next non-RST marker.
      out.push(buf.slice(i, segEnd));
      let j = segEnd;
      while (j < buf.length) {
        if (buf[j] === 0xff && j + 1 < buf.length) {
          const next = buf[j + 1];
          // 0xFF00 is a stuffed byte, 0xFFD0..0xFFD7 are restart markers.
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out.push(buf.slice(segEnd, j));
      i = j;
      continue;
    }
    // Generic segment with length — keep verbatim.
    out.push(buf.slice(i, segEnd));
    i = segEnd;
  }
  return { bytes: Buffer.concat(out), strippedBytes: stripped };
}

function sanitizePng(buf: Buffer): SanitizeResult {
  if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIG)) {
    return { bytes: buf, strippedBytes: 0, warning: "not-a-png" };
  }
  const out: Buffer[] = [PNG_SIG];
  let i = 8;
  let stripped = 0;
  const dropTypes = new Set(["tEXt", "iTXt", "zTXt", "tIME", "eXIf"]);
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString("ascii");
    const chunkEnd = i + 8 + len + 4;
    if (chunkEnd > buf.length) {
      out.push(buf.slice(i));
      break;
    }
    if (dropTypes.has(type)) {
      stripped += chunkEnd - i;
      i = chunkEnd;
      continue;
    }
    out.push(buf.slice(i, chunkEnd));
    i = chunkEnd;
    if (type === "IEND") break;
  }
  return { bytes: Buffer.concat(out), strippedBytes: stripped };
}

export function sanitizeMetadata(args: {
  fileName: string;
  mime: string;
  bytes: Buffer;
}): SanitizeResult {
  const lower = args.fileName.toLowerCase();
  if (args.mime === "image/jpeg" || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return sanitizeJpeg(args.bytes);
  }
  if (args.mime === "image/png" || lower.endsWith(".png")) {
    return sanitizePng(args.bytes);
  }
  return {
    bytes: args.bytes,
    strippedBytes: 0,
    warning: `metadata-sanitize:passthrough:${args.mime}`,
  };
}
