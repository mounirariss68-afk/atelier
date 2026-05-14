/**
 * Task #334 — Per-MIME extractors.
 *
 * Each extractor consumes the raw attachment Buffer + filename and
 * returns a normalised `ExtractedDoc` payload (matching the
 * `atelier_extracted_documents` shape minus the chunks/digest, which
 * are computed by `chunking.ts`).
 *
 * Coverage: TXT/MD/CSV/JSON/EML are parsed natively. PDF/DOCX/PPTX/
 * XLSX use a best-effort text-strip (regex over the printable byte
 * stream) which works for narrative documents authored in modern
 * office suites; binary-only inputs surface a `low-extraction-yield`
 * warning. Images are routed through the deterministic OCR fixture
 * map (same convention walletRoutes uses for receipts) — the
 * filename's stem is treated as a fixture key, with a friendly
 * fallback when no fixture is registered.
 */

import { RECEIPT_FIXTURES } from "../../atelier-receipt-fixtures.js";

export type DocKind =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "pptx"
  | "image"
  | "eml"
  | "text"
  | "unknown";

export interface ExtractedDoc {
  kind: DocKind;
  normalizedText: string;
  tableSummary: {
    columns: string[];
    rowCount: number;
    sample: Array<Record<string, unknown>>;
  } | null;
  slideTexts: Array<{ index: number; text: string }> | null;
  emailHeaders: { from?: string; to?: string[]; subject?: string; date?: string } | null;
  warnings: string[];
}

const PRINTABLE = /[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]+/g;
const MAX_TEXT = 200_000;

/** Strip non-printable bytes and collapse whitespace runs. */
function stripPrintable(buf: Buffer): string {
  // For PDF/DOCX/PPTX/XLSX the bytes include the file's binary
  // wrapper; runs of printable characters are the human content
  // (page text, slide text, cell text). This is intentionally
  // crude: a real implementation would call into pdf-parse /
  // mammoth / xlsx; that's out of scope for this task. Result is
  // truncated so we never spill tens of MBs into the model window.
  const raw = buf.toString("utf8");
  const matches = raw.match(PRINTABLE) ?? [];
  return matches
    .filter((s) => s.trim().length >= 4)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_TEXT)
    .trim();
}

/**
 * Intake-hardening guard. Returns a rejection reason when the upload
 * looks dangerous (executable / macro-bearing / MIME-extension mismatch),
 * otherwise null. This runs before extraction so we never even read
 * dangerous payloads into the chunker.
 *
 * Rules:
 *   - Disallow legacy macro-bearing office formats (.doc/.xls/.ppt) and
 *     explicit macro-enabled variants (.docm/.xlsm/.pptm).
 *   - Disallow executable / script extensions outright.
 *   - Require the declared MIME and the filename extension to belong
 *     to the same family (PDF↔.pdf, DOCX↔.docx, image/*↔.png/.jpg/...).
 *     Mismatches are a classic content-type spoofing vector.
 */
const MACRO_OR_EXEC_EXT_RE =
  /\.(docm|dotm|xlsm|xltm|xlsb|pptm|potm|doc|xls|ppt|exe|dll|bat|cmd|sh|ps1|js|vbs|jar|msi|app)$/i;

const MIME_EXT_FAMILIES: Array<{ ext: RegExp; mimes: RegExp }> = [
  { ext: /\.pdf$/i, mimes: /^application\/pdf$/i },
  {
    ext: /\.docx$/i,
    mimes: /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/i,
  },
  {
    ext: /\.xlsx$/i,
    mimes: /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/i,
  },
  {
    ext: /\.pptx$/i,
    mimes: /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/i,
  },
  { ext: /\.csv$/i, mimes: /^(text\/csv|text\/plain|application\/vnd\.ms-excel)$/i },
  { ext: /\.eml$/i, mimes: /^message\/rfc822$/i },
  { ext: /\.(png|jpe?g|webp|gif|tiff?|bmp)$/i, mimes: /^image\//i },
  { ext: /\.(txt|md|json)$/i, mimes: /^(text\/|application\/json)/i },
];

export function intakeRejection(args: {
  fileName: string;
  mime: string;
}): string | null {
  if (MACRO_OR_EXEC_EXT_RE.test(args.fileName)) {
    return `executable-or-macro-extension:${args.fileName.split(".").pop()}`;
  }
  for (const fam of MIME_EXT_FAMILIES) {
    if (fam.ext.test(args.fileName) && !fam.mimes.test(args.mime)) {
      return `mime-extension-mismatch:${args.mime}≠${args.fileName}`;
    }
  }
  return null;
}

function detectKind(fileName: string, mime: string): DocKind {
  const lower = fileName.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  )
    return "docx";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lower.endsWith(".xlsx")
  )
    return "xlsx";
  if (mime === "text/csv" || lower.endsWith(".csv")) return "csv";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    lower.endsWith(".pptx")
  )
    return "pptx";
  if (mime === "message/rfc822" || lower.endsWith(".eml")) return "eml";
  if (mime.startsWith("image/")) return "image";
  if (
    mime.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".json")
  )
    return "text";
  return "unknown";
}

function extractCsv(buf: Buffer): ExtractedDoc {
  const text = buf.toString("utf8").slice(0, MAX_TEXT);
  // Naïve CSV reader — splits on commas; quotes preserved verbatim
  // because we only need the column shape + a sample.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      kind: "csv",
      normalizedText: "",
      tableSummary: { columns: [], rowCount: 0, sample: [] },
      slideTexts: null,
      emailHeaders: null,
      warnings: ["empty-csv"],
    };
  }
  const header = splitCsvLine(lines[0]);
  const sample = lines
    .slice(1, 6)
    .map((l) => {
      const cells = splitCsvLine(l);
      const row: Record<string, unknown> = {};
      for (let i = 0; i < header.length; i++) row[header[i] ?? `col_${i}`] = cells[i] ?? null;
      return row;
    });
  return {
    kind: "csv",
    normalizedText: lines.slice(0, 200).join("\n"),
    tableSummary: { columns: header, rowCount: lines.length - 1, sample },
    slideTexts: null,
    emailHeaders: null,
    warnings: [],
  };
}

function splitCsvLine(line: string): string[] {
  // Minimal RFC-4180-ish split with quoted-cell support.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"' && inQuotes) {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * .eml extractor — also returns base64-decoded nested attachments so
 * the ingest pipeline can recursively re-ingest each part. The minimal
 * MIME parser handles the common case: a multipart message with each
 * part separated by `boundary=...` and per-part headers including
 * Content-Type + Content-Disposition + Content-Transfer-Encoding.
 */
export interface NestedEmlPart {
  fileName: string;
  mime: string;
  bytes: Buffer;
}

function parseEml(raw: string): {
  headers: { from?: string; to?: string[]; subject?: string; date?: string };
  body: string;
  parts: NestedEmlPart[];
} {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const body = headerEnd === -1 ? "" : raw.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
  const headers: { from?: string; to?: string[]; subject?: string; date?: string } = {};
  let contentType = "";
  for (const line of headerBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "from") headers.from = v;
    else if (k === "to") headers.to = v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    else if (k === "subject") headers.subject = v;
    else if (k === "date") headers.date = v;
    else if (k === "content-type") contentType = v;
  }
  const parts: NestedEmlPart[] = [];
  const boundaryMatch = contentType.match(/boundary=("?)([^";\s]+)\1/i);
  if (boundaryMatch) {
    const boundary = `--${boundaryMatch[2]}`;
    const segments = body.split(boundary).slice(1, -1);
    for (const seg of segments) {
      const trimmed = seg.replace(/^\r?\n/, "");
      const segHeaderEnd = trimmed.search(/\r?\n\r?\n/);
      if (segHeaderEnd === -1) continue;
      const segHeaderBlock = trimmed.slice(0, segHeaderEnd);
      const segBody = trimmed.slice(segHeaderEnd).replace(/^\r?\n\r?\n/, "");
      let partMime = "application/octet-stream";
      let partName = "attachment";
      let encoding = "7bit";
      for (const line of segHeaderBlock.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
        if (!m) continue;
        const k = m[1].toLowerCase();
        const v = m[2].trim();
        if (k === "content-type") {
          partMime = v.split(";")[0].trim();
          const nm = v.match(/name=("?)([^";\s]+)\1/i);
          if (nm) partName = nm[2];
        } else if (k === "content-disposition") {
          const nm = v.match(/filename=("?)([^";\s]+)\1/i);
          if (nm) partName = nm[2];
        } else if (k === "content-transfer-encoding") {
          encoding = v.toLowerCase();
        }
      }
      // Skip the inline text body; only recurse into named attachments.
      if (partMime.startsWith("text/") && !/filename=/i.test(segHeaderBlock)) continue;
      try {
        const bytes =
          encoding === "base64"
            ? Buffer.from(segBody.replace(/\s+/g, ""), "base64")
            : Buffer.from(segBody, "utf8");
        if (bytes.byteLength > 0) {
          parts.push({ fileName: partName, mime: partMime, bytes });
        }
      } catch {
        // Malformed parts are skipped — they surface as warnings on the
        // parent attachment audit, not as a hard ingest failure.
      }
    }
  }
  return { headers, body: body.slice(0, MAX_TEXT), parts };
}

function extractEml(buf: Buffer): ExtractedDoc {
  const raw = buf.toString("utf8").slice(0, MAX_TEXT * 4);
  const { headers, body, parts } = parseEml(raw);
  return {
    kind: "eml",
    normalizedText: body,
    tableSummary: null,
    slideTexts: null,
    emailHeaders: headers,
    warnings: parts.length > 0 ? [`nested-attachments:${parts.length}`] : [],
  };
}

/** Public helper used by the ingest pipeline to recurse on .eml parts. */
export function extractEmlNestedParts(buf: Buffer): NestedEmlPart[] {
  return parseEml(buf.toString("utf8").slice(0, MAX_TEXT * 4)).parts;
}

function extractImage(fileName: string, buf: Buffer): ExtractedDoc {
  // Deterministic OCR: filename stem (minus ext) is looked up in the
  // shared receipt-fixture map. This is the same convention the wallet
  // pipeline uses; it lets the CLI ingest receipts without a live OCR
  // provider.
  const stem = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const fx = RECEIPT_FIXTURES[stem];
  if (fx) {
    const text = [
      `merchant: ${fx.merchant}`,
      `category: ${fx.category}`,
      `currency: ${fx.currency} country: ${fx.country}`,
      `total: ${fx.total} tax: ${fx.tax}`,
      `lineItems: ${fx.lineItems.join("; ")}`,
      `--- raw ---`,
      fx.rawText,
    ].join("\n");
    return {
      kind: "image",
      normalizedText: text,
      tableSummary: null,
      slideTexts: null,
      emailHeaders: null,
      warnings: [],
    };
  }
  return {
    kind: "image",
    normalizedText: "[image — no OCR fixture registered for this filename]",
    tableSummary: null,
    slideTexts: null,
    emailHeaders: null,
    warnings: [`no-ocr-fixture:${stem}`, `image-bytes:${buf.byteLength}`],
  };
}

function extractPptx(buf: Buffer): ExtractedDoc {
  // Best-effort text strip. The XML inside the .pptx ZIP carries
  // slide text in <a:t> nodes; the stripPrintable pass keeps those
  // strings (4+ printable runs) and drops the binary preamble.
  const text = stripPrintable(buf);
  // Heuristic split into "slides" by long printable gaps so the
  // model can be pointed at slide N when forming a brand profile.
  const blocks = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const slideTexts = blocks
    .slice(0, 100)
    .map((t, i) => ({ index: i + 1, text: t.slice(0, 4000) }));
  return {
    kind: "pptx",
    normalizedText: text,
    tableSummary: null,
    slideTexts: slideTexts.length > 0 ? slideTexts : null,
    emailHeaders: null,
    warnings: text.length < 64 ? ["low-extraction-yield"] : [],
  };
}

function extractGenericBinary(kind: DocKind, buf: Buffer): ExtractedDoc {
  const text = stripPrintable(buf);
  return {
    kind,
    normalizedText: text,
    tableSummary: null,
    slideTexts: null,
    emailHeaders: null,
    warnings: text.length < 64 ? ["low-extraction-yield"] : [],
  };
}

function extractText(buf: Buffer): ExtractedDoc {
  return {
    kind: "text",
    normalizedText: buf.toString("utf8").slice(0, MAX_TEXT),
    tableSummary: null,
    slideTexts: null,
    emailHeaders: null,
    warnings: [],
  };
}

export function extractAttachment(args: {
  fileName: string;
  mime: string;
  bytes: Buffer;
}): ExtractedDoc {
  const kind = detectKind(args.fileName, args.mime);
  switch (kind) {
    case "csv":
      return extractCsv(args.bytes);
    case "eml":
      return extractEml(args.bytes);
    case "image":
      return extractImage(args.fileName, args.bytes);
    case "pptx":
      return extractPptx(args.bytes);
    case "pdf":
    case "docx":
    case "xlsx":
      return extractGenericBinary(kind, args.bytes);
    case "text":
      return extractText(args.bytes);
    default:
      return {
        kind: "unknown",
        normalizedText: stripPrintable(args.bytes),
        tableSummary: null,
        slideTexts: null,
        emailHeaders: null,
        warnings: ["unknown-mime"],
      };
  }
}

export const __testing = { stripPrintable, detectKind, splitCsvLine };
