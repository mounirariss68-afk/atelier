/**
 * Task #575 — Per-MIME extractors (production parsers).
 *
 * Each extractor consumes the raw attachment Buffer + filename and
 * returns a normalised `ExtractedDoc` payload (matching the
 * `atelier_extracted_documents` shape minus the chunks/digest, which
 * are computed by `chunking.ts`).
 *
 * Coverage:
 *   - TXT/MD/CSV/JSON/EML — parsed natively.
 *   - PDF  — `unpdf` (serverless pdf.js build), page text merged.
 *   - DOCX — `mammoth` raw-text extraction.
 *   - XLSX — `exceljs`, per-sheet cell text + a table summary.
 *   - PPTX — JSZip + `<a:t>` slide-text extraction.
 *   - images — deterministic OCR fixture map (OCR is out of scope).
 *
 * Office parsers fall back to a printable-byte strip only when the
 * container cannot be opened (malformed / not really a zip). When a
 * text-bearing document yields no recoverable text at all the extractor
 * flags `unreadable:no-text`; the ingest pipeline rejects on that flag
 * rather than persisting an empty blob.
 *
 * `extractAttachment` is async because the real parsers are async.
 */

import JSZip from "jszip";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";
import { RECEIPT_FIXTURES, receiptFixturesEnabled } from "../../atelier-receipt-fixtures.js";
import { parseReceiptDocViaCognidocs } from "../../cognidocs/receipt.js";
import { isHeicPayload, convertHeicToJpeg } from "../../atelier-heic.js";

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
const MAX_TEXT = 1_000_000;

/** Strip non-printable bytes and collapse whitespace runs. Used only as
 * a fallback when a real parser cannot open the container. */
function stripPrintable(buf: Buffer): string {
  const raw = buf.toString("utf8");
  const matches: string[] = raw.match(PRINTABLE) ?? [];
  return matches
    .filter((s) => s.trim().length >= 4)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_TEXT)
    .trim();
}

const UNREADABLE = "unreadable:no-text";
/** Kinds where an empty extraction is an error (vs. images, which are
 * legitimately text-free without an OCR fixture). */
const TEXT_BEARING: ReadonlySet<DocKind> = new Set(["pdf", "docx", "xlsx", "pptx", "text", "unknown"]);

/** Append the unreadable flag when a text-bearing doc has no content. */
function flagUnreadable(doc: ExtractedDoc): ExtractedDoc {
  if (!TEXT_BEARING.has(doc.kind)) return doc;
  const hasText = doc.normalizedText.trim().length > 0;
  const hasTable = !!doc.tableSummary && doc.tableSummary.rowCount > 0;
  const hasSlides = !!doc.slideTexts && doc.slideTexts.length > 0;
  if (!hasText && !hasTable && !hasSlides && !doc.warnings.includes(UNREADABLE)) {
    doc.warnings.push(UNREADABLE);
  }
  return doc;
}

/**
 * Intake-hardening guard. Returns a rejection reason when the upload
 * looks dangerous, otherwise null. Runs before extraction so we never
 * read dangerous payloads into the parser.
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

export function intakeRejection(args: { fileName: string; mime: string }): string | null {
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
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  )
    return "docx";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    lower.endsWith(".xlsx")
  )
    return "xlsx";
  if (mime === "text/csv" || lower.endsWith(".csv")) return "csv";
  if (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
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

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function extractCsv(buf: Buffer): ExtractedDoc {
  const text = buf.toString("utf8").slice(0, MAX_TEXT);
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
  const sample = lines.slice(1, 6).map((l) => {
    const cells = splitCsvLine(l);
    const row: Record<string, unknown> = {};
    for (let i = 0; i < header.length; i++) row[header[i] ?? `col_${i}`] = cells[i] ?? null;
    return row;
  });
  return {
    kind: "csv",
    normalizedText: lines.slice(0, 2000).join("\n"),
    tableSummary: { columns: header, rowCount: lines.length - 1, sample },
    slideTexts: null,
    emailHeaders: null,
    warnings: [],
  };
}

function splitCsvLine(line: string): string[] {
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

// ---------------------------------------------------------------------------
// EML
// ---------------------------------------------------------------------------

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
        // Malformed parts surface as warnings, not a hard failure.
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

export function extractEmlNestedParts(buf: Buffer): NestedEmlPart[] {
  return parseEml(buf.toString("utf8").slice(0, MAX_TEXT * 4)).parts;
}

// ---------------------------------------------------------------------------
// Images (deterministic OCR fixture map)
// ---------------------------------------------------------------------------

/** Real photos are always at least a few KB; anything smaller is a test
 * fixture or corrupt payload, so we never spend a vision call on it. */
const MIN_VISION_IMAGE_BYTES = 4096;

// Task #1316 — image types CogniDocs accepts (GIF support was dropped with
// the in-house vision extractor; HEIC converts to JPEG below).
const VISION_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

async function extractImage(fileName: string, mime: string, buf: Buffer): Promise<ExtractedDoc> {
  const stem = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const fx = receiptFixturesEnabled() ? RECEIPT_FIXTURES[stem] : undefined;
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
  // Task #598 — no fixture: run the shared receipt parser (CogniDocs since
  // Task #1316) so a real photo taken on the phone yields real
  // merchant/amount/date text. Tiny payloads (test buffers, corrupt files)
  // skip the parse call and keep the deterministic no-fixture warning.
  if (buf.byteLength >= MIN_VISION_IMAGE_BYTES) {
    try {
      let bytes = buf;
      let mediaType = mime.toLowerCase().split(";")[0].trim();
      if (isHeicPayload(bytes, mediaType)) {
        bytes = await convertHeicToJpeg(bytes);
        mediaType = "image/jpeg";
      }
      if (!VISION_MEDIA_TYPES.has(mediaType)) mediaType = "image/jpeg";
      const vx = await parseReceiptDocViaCognidocs(bytes, mediaType, fileName);
      if (vx.unreadable || !vx.merchant || typeof vx.total !== "number") {
        return {
          kind: "image",
          normalizedText:
            "[image — vision OCR could not read a receipt from this photo]",
          tableSummary: null,
          slideTexts: null,
          emailHeaders: null,
          warnings: ["receipt-unreadable", `image-bytes:${buf.byteLength}`],
        };
      }
      const lines = [
        `merchant: ${vx.merchant}`,
        `category: ${vx.category ?? "other"}`,
        `currency: ${(vx.currency ?? "USD").toUpperCase()} country: ${vx.country ?? "-"}`,
        `total: ${vx.total} tax: ${vx.tax ?? 0}`,
      ];
      if (vx.date && /^\d{4}-\d{2}-\d{2}$/.test(vx.date)) lines.push(`date: ${vx.date}`);
      lines.push(`--- raw ---`, vx.rawText ?? "");
      const warnings: string[] = [];
      if (vx.confidence && vx.confidence !== "green") {
        warnings.push(`ocr-confidence:${vx.confidence}`);
      }
      return {
        kind: "image",
        normalizedText: lines.join("\n"),
        tableSummary: null,
        slideTexts: null,
        emailHeaders: null,
        warnings,
      };
    } catch (err) {
      return {
        kind: "image",
        normalizedText: "[image — vision OCR failed for this photo]",
        tableSummary: null,
        slideTexts: null,
        emailHeaders: null,
        warnings: [
          `ocr-failed:${err instanceof Error ? err.message.slice(0, 80) : "error"}`,
          `image-bytes:${buf.byteLength}`,
        ],
      };
    }
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

// ---------------------------------------------------------------------------
// PDF / DOCX / XLSX / PPTX — real parsers
// ---------------------------------------------------------------------------

async function extractPdf(buf: Buffer): Promise<ExtractedDoc> {
  const warnings: string[] = [];
  let text = "";
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const res = await unpdfExtractText(pdf, { mergePages: true });
    text = (Array.isArray(res.text) ? res.text.join("\n\n") : res.text).trim();
  } catch (err) {
    warnings.push(`pdf-parse-failed:${err instanceof Error ? err.message.slice(0, 80) : "error"}`);
    text = stripPrintable(buf);
  }
  return flagUnreadable({
    kind: "pdf",
    normalizedText: text.slice(0, MAX_TEXT),
    tableSummary: null,
    slideTexts: null,
    emailHeaders: null,
    warnings,
  });
}

async function extractDocx(buf: Buffer): Promise<ExtractedDoc> {
  const warnings: string[] = [];
  let text = "";
  try {
    const res = await mammoth.extractRawText({ buffer: buf });
    text = (res.value ?? "").trim();
  } catch (err) {
    warnings.push(`docx-parse-failed:${err instanceof Error ? err.message.slice(0, 80) : "error"}`);
    text = stripPrintable(buf);
  }
  return flagUnreadable({
    kind: "docx",
    normalizedText: text.slice(0, MAX_TEXT),
    tableSummary: null,
    slideTexts: null,
    emailHeaders: null,
    warnings,
  });
}

async function extractXlsx(buf: Buffer): Promise<ExtractedDoc> {
  const warnings: string[] = [];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const lines: string[] = [];
    let firstTable: ExtractedDoc["tableSummary"] = null;
    wb.eachSheet((sheet) => {
      lines.push(`# Sheet: ${sheet.name}`);
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cellToText(cell.value));
        });
        rows.push(cells);
        lines.push(cells.join("\t"));
      });
      if (!firstTable && rows.length > 0) {
        const header = rows[0];
        const sample = rows.slice(1, 6).map((r) => {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < header.length; i++) obj[header[i] || `col_${i}`] = r[i] ?? null;
          return obj;
        });
        firstTable = { columns: header, rowCount: Math.max(rows.length - 1, 0), sample };
      }
    });
    const text = lines.join("\n").slice(0, MAX_TEXT).trim();
    return flagUnreadable({
      kind: "xlsx",
      normalizedText: text,
      tableSummary: firstTable,
      slideTexts: null,
      emailHeaders: null,
      warnings,
    });
  } catch (err) {
    warnings.push(`xlsx-parse-failed:${err instanceof Error ? err.message.slice(0, 80) : "error"}`);
    const text = stripPrintable(buf);
    return flagUnreadable({
      kind: "xlsx",
      normalizedText: text,
      tableSummary: null,
      slideTexts: null,
      emailHeaders: null,
      warnings,
    });
  }
}

function cellToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (typeof v.result !== "undefined") return String(v.result);
    if (v.richText && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    if (v.hyperlink) return String(v.text ?? v.hyperlink);
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

async function extractPptx(buf: Buffer): Promise<ExtractedDoc> {
  const warnings: string[] = [];
  try {
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
        const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
        return na - nb;
      });
    if (slideFiles.length === 0) throw new Error("no-slides");
    const slideTexts: Array<{ index: number; text: string }> = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async("string");
      const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
        decodeXmlEntities(m[1]),
      );
      const text = runs.join(" ").replace(/\s+/g, " ").trim();
      if (text) slideTexts.push({ index: i + 1, text: text.slice(0, 8000) });
    }
    const normalizedText = slideTexts
      .map((s) => `# Slide ${s.index}\n${s.text}`)
      .join("\n\n")
      .slice(0, MAX_TEXT);
    return flagUnreadable({
      kind: "pptx",
      normalizedText,
      tableSummary: null,
      slideTexts: slideTexts.length > 0 ? slideTexts : null,
      emailHeaders: null,
      warnings,
    });
  } catch (err) {
    // Not a valid OOXML zip (or empty) — fall back to a printable strip
    // so oddly-encoded decks still yield text instead of being dropped.
    warnings.push(`pptx-parse-fallback:${err instanceof Error ? err.message.slice(0, 60) : "error"}`);
    const text = stripPrintable(buf);
    const blocks = text
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const slideTexts = blocks.slice(0, 100).map((t, i) => ({ index: i + 1, text: t.slice(0, 8000) }));
    return flagUnreadable({
      kind: "pptx",
      normalizedText: text,
      tableSummary: null,
      slideTexts: slideTexts.length > 0 ? slideTexts : null,
      emailHeaders: null,
      warnings,
    });
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractText(buf: Buffer): ExtractedDoc {
  return flagUnreadable({
    kind: "text",
    normalizedText: buf.toString("utf8").slice(0, MAX_TEXT),
    tableSummary: null,
    slideTexts: null,
    emailHeaders: null,
    warnings: [],
  });
}

export async function extractAttachment(args: {
  fileName: string;
  mime: string;
  bytes: Buffer;
}): Promise<ExtractedDoc> {
  const kind = detectKind(args.fileName, args.mime);
  switch (kind) {
    case "csv":
      return extractCsv(args.bytes);
    case "eml":
      return extractEml(args.bytes);
    case "image":
      return extractImage(args.fileName, args.mime, args.bytes);
    case "pptx":
      return extractPptx(args.bytes);
    case "pdf":
      return extractPdf(args.bytes);
    case "docx":
      return extractDocx(args.bytes);
    case "xlsx":
      return extractXlsx(args.bytes);
    case "text":
      return extractText(args.bytes);
    default:
      return flagUnreadable({
        kind: "unknown",
        normalizedText: stripPrintable(args.bytes),
        tableSummary: null,
        slideTexts: null,
        emailHeaders: null,
        warnings: ["unknown-mime"],
      });
  }
}

export const __testing = { stripPrintable, detectKind, splitCsvLine };
