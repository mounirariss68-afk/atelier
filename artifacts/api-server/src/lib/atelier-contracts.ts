/**
 * Task #159 — Contract lifecycle core.
 *
 * Word (.docx) contract templates with LLM-detected fill-in fields,
 * draft generation (placeholder substitution that preserves the
 * document's formatting), external redlining, final upload, server-side
 * docx → PDF conversion (LibreOffice headless) and DocuSeal signing via
 * the existing e-sign flow.
 *
 * Blobs (`enc:cdoc:<key>`) live in private object storage; metadata in
 * Postgres. All failures are loud — no silent fallbacks.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, lt, notInArray } from "drizzle-orm";
import JSZip from "jszip";
import mammoth from "mammoth";
import {
  db,
  atelierAuditEvents,
  atelierContractDocuments,
  atelierContractRecords,
  type ContractTemplateField,
} from "@workspace/db";
import { objectStorageClient } from "./objectStorage.js";

const execFileAsync = promisify(execFile);

export const CONTRACT_ENC_PREFIX = "enc:cdoc:";
const BLOB_SUBDIR = "atelier-contracts";

export const CONTRACT_MAX_BYTES = 25 * 1024 * 1024;

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const CONTRACT_TYPES = [
  "individual_nda",
  "mutual_nda",
  "partnership_mou",
  "partnership_agreement",
  "non_equity_partner_employment",
  "employment",
  "contractor_agreement",
  "other",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** Lifecycle statuses. Terminal statuses never regress. */
export const CONTRACT_STATUSES = [
  "draft",
  "out_for_review",
  "final_uploaded",
  "out_for_signature",
  "signed",
  "declined",
  "voided",
  "expired",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const TERMINAL_CONTRACT_STATUSES: ReadonlySet<string> = new Set([
  "signed",
  "declined",
  "voided",
  "expired",
]);

/** Legal forward transitions (besides terminal entries via e-sign sync). */
const FORWARD: Record<string, string[]> = {
  draft: ["out_for_review", "final_uploaded", "voided"],
  out_for_review: ["final_uploaded", "draft", "voided"],
  final_uploaded: ["out_for_signature", "out_for_review", "voided"],
  out_for_signature: ["signed", "declined", "voided", "expired"],
};

export function canTransition(from: string, to: string): boolean {
  if (TERMINAL_CONTRACT_STATUSES.has(from)) return false;
  return (FORWARD[from] ?? []).includes(to);
}

export function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Blob storage
// ---------------------------------------------------------------------------

function resolveTarget(): { bucketName: string; basePrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for contract documents.",
    );
  }
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucketName: trimmed, basePrefix: BLOB_SUBDIR };
  return {
    bucketName: trimmed.slice(0, slash),
    basePrefix: `${trimmed.slice(slash + 1).replace(/\/+$/, "")}/${BLOB_SUBDIR}`,
  };
}

function objectNameForKey(key: string): { bucketName: string; objectName: string } {
  const { bucketName, basePrefix } = resolveTarget();
  return { bucketName, objectName: `${basePrefix}/${key}` };
}

export async function storeContractBytes(
  buf: Buffer,
): Promise<{ blobRef: string; sha256: string }> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${sha256.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buf, { resumable: false, contentType: "application/octet-stream" });
  return { blobRef: `${CONTRACT_ENC_PREFIX}${key}`, sha256 };
}

export async function loadContractBytes(blobRef: string): Promise<Buffer | null> {
  if (!blobRef.startsWith(CONTRACT_ENC_PREFIX)) return null;
  const key = blobRef.slice(CONTRACT_ENC_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  try {
    const [contents] = await objectStorageClient.bucket(bucketName).file(objectName).download();
    return contents;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function auditContractEntity(args: {
  entityType: "atelier_contract_template" | "atelier_contract_record";
  entityId: string;
  actorType?: "human" | "system" | "agent";
  actorId: string;
  actorLabel: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: args.actorType ?? "human",
    actorId: args.actorId,
    actorLabel: args.actorLabel,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ---------------------------------------------------------------------------
// Expiry sweep (Task #160)
// ---------------------------------------------------------------------------

/**
 * Statuses the expiry sweep must never touch. `expired` is terminal and
 * never regresses; `declined`/`voided` contracts never lapse into
 * "expired" — they already ended for another reason. A `signed`
 * contract, although terminal for manual edits, DOES lapse to expired
 * when its expiry date passes: that is the whole point of tracking
 * expiryDate, and it is a one-way move into another terminal status.
 */
const EXPIRY_SWEEP_EXCLUDED = ["declined", "voided", "expired"];

/**
 * Flip contracts whose expiryDate has passed to `expired`. Runs lazily
 * on contract read surfaces so lists/details never show a stale status.
 * Deliberately bypasses `canTransition` (which blocks all edits out of
 * terminal statuses) — this is the single sanctioned signed→expired
 * path, driven by the clock, not by a user.
 */
export async function sweepExpiredContracts(orgId: string): Promise<number> {
  const now = new Date();
  const updated = await db
    .update(atelierContractRecords)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(atelierContractRecords.orgId, orgId),
        lt(atelierContractRecords.expiryDate, now),
        notInArray(atelierContractRecords.status, EXPIRY_SWEEP_EXCLUDED),
      ),
    )
    .returning({
      id: atelierContractRecords.id,
      title: atelierContractRecords.title,
      status: atelierContractRecords.status,
      expiryDate: atelierContractRecords.expiryDate,
    });
  for (const row of updated) {
    await auditContractEntity({
      entityType: "atelier_contract_record",
      entityId: row.id,
      actorType: "system",
      actorId: "system",
      actorLabel: "System",
      action: "contract.expired",
      payload: { expiryDate: row.expiryDate?.toISOString?.() ?? row.expiryDate },
      summary: `Contract "${row.title}" automatically marked expired (expiry date passed).`,
    });
  }
  return updated.length;
}

// ---------------------------------------------------------------------------
// Template text extraction + LLM field detection
// ---------------------------------------------------------------------------

export function looksLikeDocx(buf: Buffer): boolean {
  // ZIP local-file-header magic. All .docx files are ZIP archives.
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

export async function extractDocxText(buf: Buffer): Promise<string> {
  const out = await mammoth.extractRawText({ buffer: buf });
  return out.value ?? "";
}

export class ContractFieldDetectionError extends Error {}

const DETECT_SYSTEM_PROMPT = `You analyse Word contract templates for a consulting firm's CRM.
Given the full text of a contract template, identify every fill-in spot — placeholders, blanks, bracketed markers, underscores, or obviously-variable values (counterparty name/address, dates, fees, term lengths) that must be filled in before the contract is sent to a counterparty.

Return ONLY a JSON object of this exact shape:
{
  "fields": [
    {
      "key": "snake_case_stable_key",
      "label": "Human label",
      "placeholder": "EXACT literal text from the document to replace",
      "dataType": "text" | "date" | "money" | "number",
      "autoFill": "counterparty_name" | "counterparty_address" | "counterparty_email" | "counterparty_country" | "firm_name" | "firm_address" | "firm_governing_law" | "firm_jurisdiction" | "effective_date" | "expiry_date" | "fee" | "term" | "none",
      "required": true | false,
      "note": "optional detection note",
      "options": ["optional — exact option list when the document says choose/select/circle one of a fixed set"],
      "role": "standard" | "second_party" | "reference",
      "defaultHint": "today"
    }
  ],
  "warnings": ["optional strings describing ambiguities"]
}

Rules:
- "placeholder" MUST be copied verbatim from the document text (it is used for literal substitution). Never invent or normalise it.
- Each placeholder must be unique enough to find in the document; include surrounding brackets/underscores in the placeholder itself.
- Do not include boilerplate that never changes.
- Use autoFill "none" when no CRM field maps cleanly.
- "options": include ONLY when the document explicitly restricts the value to a fixed list (e.g. "Relationship Type: Client / Supplier / Partner", "choose one of ..."). Copy the option texts exactly. Omit otherwise.
- "role":
  - "second_party" for the counterparty's/receiving party's SIGNATURE-BLOCK fields (their signature date, "Signed by ... Date: ____" on their side). These are completed when the counterparty signs, never when the contract is prepared.
  - "reference" for auto-generated document reference numbers — a code containing a 4-digit year plus a running series number, either literal (e.g. "AGR-2026-003", "Ref No: NDA-2025-014") or token-style (e.g. "[CGNR-NDA-U-[YEAR]-[###]]", "REF-[YYYY]-[NNN]"). The CRM assigns the next number automatically.
  - "standard" (or omit) for everything else, INCLUDING the firm's own signature-block fields.
- "defaultHint": "today" for the FIRM-side signature date (the date our own signatory signs) — it defaults to today. Omit otherwise.`;

export interface DetectedFields {
  fields: ContractTemplateField[];
  warnings: string[];
}

/**
 * LLM field detection. Uses the shared Anthropic integration (stubable
 * via ANTHROPIC_BASE_URL in tests). Throws loudly on non-JSON output.
 */
export async function detectTemplateFields(templateText: string): Promise<DetectedFields> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const ac = new AbortController();
  const timeoutMs = Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 90000);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const resp = await anthropic.messages
    .create(
      {
        model: process.env.ATELIER_CONTRACT_DETECT_MODEL ?? "claude-sonnet-4-5",
        max_tokens: 8192,
        system: `${DETECT_SYSTEM_PROMPT}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
        messages: [
          {
            role: "user",
            content: `Contract template text:\n\n${templateText.slice(0, 100_000)}`,
          },
        ],
      },
      { signal: ac.signal },
    )
    .finally(() => clearTimeout(timer));
  const block = resp.content[0];
  const text = block && block.type === "text" ? block.text.trim() : "";
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(stripped.indexOf("{")));
  } catch {
    throw new ContractFieldDetectionError(
      `Field detection returned non-JSON output: ${stripped.slice(0, 120)}`,
    );
  }
  const obj = parsed as { fields?: unknown; warnings?: unknown };
  if (!Array.isArray(obj.fields)) {
    throw new ContractFieldDetectionError("Field detection output missing `fields` array.");
  }
  const fields: ContractTemplateField[] = [];
  const seenKeys = new Set<string>();
  for (const raw of obj.fields as Array<Record<string, unknown>>) {
    const key = String(raw.key ?? "").trim();
    const placeholder = String(raw.placeholder ?? "");
    if (!key || !placeholder) continue;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    fields.push({
      key,
      label: String(raw.label ?? key),
      placeholder,
      dataType: ["text", "date", "money", "number"].includes(String(raw.dataType))
        ? String(raw.dataType)
        : "text",
      autoFill: String(raw.autoFill ?? "none"),
      required: raw.required !== false,
      ...(raw.note ? { note: String(raw.note) } : {}),
      ...(Array.isArray(raw.options) && raw.options.length > 0
        ? {
            options: (raw.options as unknown[])
              .map((o) => String(o).trim())
              .filter(Boolean)
              .slice(0, 20),
          }
        : {}),
      ...(["standard", "second_party", "reference"].includes(String(raw.role))
        ? { role: String(raw.role) as ContractTemplateField["role"] }
        : {}),
      ...(String(raw.defaultHint) === "today" ? { defaultHint: "today" as const } : {}),
    });
  }
  const warnings = Array.isArray(obj.warnings) ? obj.warnings.map(String) : [];
  return { fields: normalizeFieldSchema(fields), warnings };
}

// ---------------------------------------------------------------------------
// Task #291 — field-role normalization (backfill for pre-#291 schemas)
// ---------------------------------------------------------------------------

/** Reference-number shape: something ending in a 4-digit year + 3-digit series. */
const REFERENCE_PLACEHOLDER_RE = /(19|20)\d{2}[-_/.]\d{3}(?!\d)/;
/**
 * Token-style reference markers: a bracketed year token ([YEAR]/[YYYY])
 * combined with a bracketed series token ([###]/[NNN]/[No.]) in the same
 * placeholder, e.g. "[CGNR-NDA-U-[YEAR]-[###]]". Deliberately requires
 * BOTH tokens so ordinary date fields ("[YYYY]") are never misclassified.
 */
const REFERENCE_YEAR_TOKEN_RE = /\[(?:YEAR|YYYY)\]/i;
const REFERENCE_SERIES_TOKEN_RE = /\[(?:#+|N{2,}|No\.?)\]/i;
export function isTokenStyleReferencePlaceholder(placeholder: string): boolean {
  return REFERENCE_YEAR_TOKEN_RE.test(placeholder) && REFERENCE_SERIES_TOKEN_RE.test(placeholder);
}
const REFERENCE_TEXT_RE = /\b(ref(erence)?\s*(no|number|#)?|document\s+number)\b/i;
const SIGN_RE = /\bsign(ature|ed|s|ing)?\b|\bdate\s+signed\b/i;
const SECOND_PARTY_RE =
  /\b(counterpart(y|ies)|second\s+part(y|ies)|party\s*b|other\s+part(y|ies)|receiving\s+part(y|ies)|client|recipient|employee|contractor|consultant|partner\s+firm)\b/i;
const FIRM_SIDE_RE = /\b(firm|company|cognirise|first\s+part(y|ies)|party\s*a|our)\b/i;

/**
 * Derive Task #291 metadata (role, defaultHint) for a field that predates
 * it. Deterministic and conservative: only clearly-recognisable reference
 * numbers and counterparty signature-date fields are reclassified; every
 * other field stays "standard" and keeps rendering as before.
 */
export function classifyFieldRole(
  f: ContractTemplateField,
): Pick<ContractTemplateField, "role" | "defaultHint"> {
  const text = `${f.key} ${f.label}`;
  if (
    REFERENCE_PLACEHOLDER_RE.test(f.placeholder) ||
    (REFERENCE_TEXT_RE.test(text) && REFERENCE_PLACEHOLDER_RE.test(text)) ||
    // Token-style placeholders ("[CGNR-NDA-U-[YEAR]-[###]]") carry no
    // literal year+series, so additionally require reference-like
    // key/label text to stay conservative.
    (REFERENCE_TEXT_RE.test(text) && isTokenStyleReferencePlaceholder(f.placeholder))
  ) {
    return { role: "reference" };
  }
  if (SIGN_RE.test(text) && SECOND_PARTY_RE.test(text) && !FIRM_SIDE_RE.test(text)) {
    return { role: "second_party" };
  }
  if (f.dataType === "date" && SIGN_RE.test(text)) {
    // Firm-side (or unspecified) signature date — default to today.
    return { role: "standard", defaultHint: "today" };
  }
  return { role: "standard" };
}

/**
 * Fill in role/defaultHint on schemas that lack them (old reviewed
 * templates from before Task #291). Explicit metadata always wins.
 */
export function normalizeFieldSchema(fields: ContractTemplateField[]): ContractTemplateField[] {
  return fields.map((f) => {
    if (f.role) return f;
    const derived = classifyFieldRole(f);
    return {
      ...f,
      role: derived.role,
      ...(f.defaultHint || !derived.defaultHint ? {} : { defaultHint: derived.defaultHint }),
    };
  });
}

/**
 * Verify each detected placeholder actually occurs in the document text.
 * Returns warnings for those that do not (partner fixes them on review).
 */
export function verifyPlaceholders(
  fields: ContractTemplateField[],
  templateText: string,
): string[] {
  const warnings: string[] = [];
  const squish = (s: string) => s.replace(/\s+/g, " ");
  const hay = squish(templateText);
  for (const f of fields) {
    if (!hay.includes(squish(f.placeholder))) {
      warnings.push(
        `Placeholder for "${f.label}" (${f.key}) was not found verbatim in the document: ${f.placeholder.slice(0, 80)}`,
      );
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Docx fill (formatting-preserving placeholder substitution)
// ---------------------------------------------------------------------------

const XML_PARTS = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Replace placeholders inside one WordprocessingML part. Word often
 * splits literal text across multiple runs, so a naive string replace
 * misses placeholders. Strategy: per paragraph, concatenate the text of
 * its <w:t> nodes; when a placeholder appears in the concatenation,
 * write the fully-substituted paragraph text into the FIRST <w:t> and
 * blank the rest. Paragraph- and first-run formatting are preserved
 * (acceptable: placeholders live in uniform-format sentences).
 */
export function fillXmlPart(
  xml: string,
  replacements: Array<{ placeholder: string; value: string }>,
): { xml: string; replaced: Set<string> } {
  const replaced = new Set<string>();
  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  const out = xml.replace(paraRe, (para) => {
    const tRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(para)) !== null) texts.push(xmlUnescape(m[2]));
    if (texts.length === 0) return para;
    const joined = texts.join("");
    let filled = joined;
    for (const r of replacements) {
      if (filled.includes(r.placeholder)) {
        filled = filled.split(r.placeholder).join(r.value);
        replaced.add(r.placeholder);
      }
    }
    if (filled === joined) return para;
    let first = true;
    return para.replace(tRe, (_full, open: string, _inner: string, close: string) => {
      if (first) {
        first = false;
        const openPreserve = open.includes("xml:space")
          ? open
          : open.replace("<w:t", '<w:t xml:space="preserve"');
        return `${openPreserve}${xmlEscape(filled)}${close}`;
      }
      return `${open}${close}`;
    });
  });
  return { xml: out, replaced };
}

/**
 * Check which placeholders would NOT be found by fillDocxTemplate.
 * Mirrors fillXmlPart's matching exactly (per-paragraph <w:t> join over
 * the same XML parts), so a placeholder that passes here is guaranteed
 * to substitute at generation time. Used at field-review time to block
 * activation of a template whose placeholders no longer match the doc.
 */
export async function findMissingPlaceholders(
  templateBytes: Buffer,
  placeholders: string[],
): Promise<string[]> {
  if (placeholders.length === 0) return [];
  const zip = await JSZip.loadAsync(templateBytes);
  const remaining = new Set(placeholders);
  const partNames = Object.keys(zip.files).filter(
    (n) => XML_PARTS.includes(n) || /^word\/(header|footer)\d*\.xml$/.test(n),
  );
  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  for (const name of partNames) {
    if (remaining.size === 0) break;
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    let pm: RegExpExecArray | null;
    while (remaining.size > 0 && (pm = paraRe.exec(xml)) !== null) {
      const para = pm[0];
      const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      const texts: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = tRe.exec(para)) !== null) texts.push(xmlUnescape(m[1]));
      if (texts.length === 0) continue;
      const joined = texts.join("");
      for (const p of Array.from(remaining)) {
        if (joined.includes(p)) remaining.delete(p);
      }
    }
    paraRe.lastIndex = 0;
  }
  return placeholders.filter((p) => remaining.has(p));
}

export class ContractFillError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
  ) {
    super(message);
  }
}

/**
 * Fill a template's placeholders with values. Throws ContractFillError
 * listing any REQUIRED placeholder that was never found in the document
 * — the draft would otherwise silently ship with blanks.
 */
export async function fillDocxTemplate(args: {
  templateBytes: Buffer;
  fields: ContractTemplateField[];
  values: Record<string, string>;
}): Promise<Buffer> {
  const zip = await JSZip.loadAsync(args.templateBytes);
  const replacements = args.fields
    .filter((f) => args.values[f.key] != null && args.values[f.key] !== "")
    .map((f) => ({ key: f.key, placeholder: f.placeholder, value: args.values[f.key] }));
  const replacedAll = new Set<string>();
  const partNames = Object.keys(zip.files).filter(
    (n) => XML_PARTS.includes(n) || /^word\/(header|footer)\d*\.xml$/.test(n),
  );
  for (const name of partNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const { xml: nextXml, replaced } = fillXmlPart(
      xml,
      replacements.map((r) => ({ placeholder: r.placeholder, value: r.value })),
    );
    if (replaced.size > 0) zip.file(name, nextXml);
    for (const p of replaced) replacedAll.add(p);
  }
  const missing = args.fields
    .filter((f) => f.required && args.values[f.key] != null && args.values[f.key] !== "")
    .filter((f) => !replacedAll.has(f.placeholder))
    .map((f) => f.key);
  if (missing.length > 0) {
    throw new ContractFillError(
      `Could not locate placeholder(s) in the template document for: ${missing.join(", ")}. Review the template's detected fields.`,
      missing,
    );
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// docx → PDF conversion (LibreOffice headless)
// ---------------------------------------------------------------------------

export class PdfConversionError extends Error {}

export async function convertDocxToPdf(docxBytes: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "ctr-pdf-"));
  try {
    const src = path.join(dir, "contract.docx");
    await writeFile(src, docxBytes);
    try {
      await execFileAsync(
        "soffice",
        [
          "--headless",
          "--norestore",
          `-env:UserInstallation=file://${dir}/lo-profile`,
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          src,
        ],
        { timeout: 120_000 },
      );
    } catch (err) {
      throw new PdfConversionError(
        `LibreOffice PDF conversion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const pdfPath = path.join(dir, "contract.pdf");
    try {
      const pdf = await readFile(pdfPath);
      if (pdf.length === 0) throw new Error("empty output");
      return pdf;
    } catch {
      throw new PdfConversionError("LibreOffice produced no PDF output.");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// E-sign → contract record sync (Task #159 §hook)
// ---------------------------------------------------------------------------

/**
 * Flip the linked contract record when its signature request reaches a
 * terminal state. Called from the e-sign sync path (webhook-triggered
 * re-fetch + polling). Terminal contract statuses never regress; the
 * mapping is completed→signed, declined→declined, voided→voided,
 * expired→expired. On completion the signed PDF is copied onto the
 * contract's own document chain and the Document Library pointer stored.
 */
/**
 * Task #306 — pull the counterparty's typed answers (printed name,
 * title, date signed, …) out of the DocuSeal submitters' submitted
 * values and map them back onto the contract's second-party template
 * fields.
 *
 * The DocuSeal boxes were named `${label} ${signerNumber}` (with an
 * optional `.n` de-dupe suffix) by the send path, where label is the
 * field's display label (falling back to its key) — so matching strips
 * the trailing numbering and compares against the label, case-
 * insensitively. Date boxes are always named "Date signed N"; the
 * counterparty's date is taken from the submitter who supplied a
 * matching text value (or the sole submitter when there is only one).
 */
export function extractSecondPartyValues(
  fields: ContractTemplateField[],
  submitters: Array<{ values?: Array<{ field: string; value: unknown }> }>,
): Record<string, string> {
  const spFields = normalizeFieldSchema(fields).filter((f) => f.role === "second_party");
  if (spFields.length === 0) return {};
  const spText = spFields.filter((f) => f.dataType !== "date");
  const spDate = spFields.filter((f) => f.dataType === "date");

  const baseName = (name: string) => name.replace(/\s+\d+(\.\d+)?$/, "").trim().toLowerCase();
  const asString = (v: unknown): string =>
    typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

  const out: Record<string, string> = {};
  let counterpartyDate: string | null = null;
  let soleSubmitterDate: string | null = null;

  for (const sub of submitters) {
    let matchedText = false;
    let dateValue: string | null = null;
    for (const v of sub.values ?? []) {
      const base = baseName(v.field);
      const value = asString(v.value);
      if (value === "") continue;
      if (base === "date signed") {
        dateValue = value;
        continue;
      }
      const field = spText.find(
        (f) => (f.label || f.key).trim().toLowerCase() === base,
      );
      if (field) {
        out[field.key] = value;
        matchedText = true;
      }
    }
    if (matchedText && dateValue) counterpartyDate = dateValue;
    if (submitters.length === 1 && dateValue) soleSubmitterDate = dateValue;
  }

  const date = counterpartyDate ?? soleSubmitterDate;
  if (date) for (const f of spDate) out[f.key] = date;
  return out;
}

/**
 * Task #310 — repair path for the one-shot completed→signed merge.
 *
 * The counterparty's typed answers are normally merged into fieldValues
 * exactly once, on the completed→signed transition inside
 * syncContractFromSignatureRequest. If that single pass failed after the
 * signature request flipped (or DocuSeal briefly omitted submitter
 * values), the answers would be lost forever because terminal statuses
 * never regress and the sync never re-runs the merge.
 *
 * This backfill re-fetches the authoritative DocuSeal submission for a
 * signed contract whose second-party fields are still empty and merges
 * the values in — WITHOUT touching status. It is idempotent (a contract
 * with all second-party values already present is a no-op) and safe to
 * call on every contract-detail open: fetch errors are swallowed so a
 * DocuSeal outage can never break the detail view; the next open simply
 * retries.
 *
 * Returns the updated fieldValues when a merge happened, else null.
 */
export async function backfillSecondPartyValues(contract: {
  id: string;
  status: string;
  title: string;
  templateVersionId: string | null;
  signatureRequestId: string | null;
  fieldValues: Record<string, string> | null;
}): Promise<Record<string, string> | null> {
  if (contract.status !== "signed") return null;
  if (!contract.signatureRequestId || !contract.templateVersionId) return null;
  const { atelierContractTemplateVersions, atelierSignatureRequests } = await import(
    "@workspace/db"
  );
  const [tv] = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.id, contract.templateVersionId));
  if (!tv) return null;
  const spFields = normalizeFieldSchema(tv.fieldSchema ?? []).filter(
    (f) => f.role === "second_party",
  );
  if (spFields.length === 0) return null;
  const existing = contract.fieldValues ?? {};
  const missing = spFields.some((f) => !(existing[f.key] ?? "").trim());
  if (!missing) return null;

  const [sigReq] = await db
    .select()
    .from(atelierSignatureRequests)
    .where(eq(atelierSignatureRequests.id, contract.signatureRequestId));
  if (!sigReq?.docusealSubmissionId) return null;

  let submitters: Array<{ values?: Array<{ field: string; value: unknown }> }>;
  try {
    const { getSubmission } = await import("./docuseal.js");
    const submission = await getSubmission(Number(sigReq.docusealSubmissionId));
    submitters = (submission?.submitters ?? []) as typeof submitters;
  } catch (err) {
    // Never let a DocuSeal hiccup break the contract detail view — the
    // next open retries the backfill.
    console.warn(
      `[contracts] second-party backfill fetch failed for ${contract.id}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  const extracted = extractSecondPartyValues(tv.fieldSchema ?? [], submitters);
  const changed = Object.fromEntries(
    Object.entries(extracted).filter(([k, v]) => (existing[k] ?? "").trim() !== v),
  );
  if (Object.keys(changed).length === 0) return null;

  const mergedValues = { ...existing, ...changed };
  await db
    .update(atelierContractRecords)
    .set({ fieldValues: mergedValues, updatedAt: new Date() })
    .where(eq(atelierContractRecords.id, contract.id));
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contract.id,
    actorType: "system",
    actorId: "esign-sync",
    actorLabel: "DocuSeal sync",
    action: "contract.second_party_values",
    payload: {
      signatureRequestId: contract.signatureRequestId,
      values: changed,
      backfill: true,
    },
    summary: `Backfilled ${Object.keys(changed).length} second-party value(s) from signing on "${contract.title}"`,
  });
  return mergedValues;
}

export async function syncContractFromSignatureRequest(
  request: {
    id: string;
    status: string;
    signedDocumentId: string | null;
  },
  /**
   * Task #306 — the authoritative DocuSeal submission (when the caller
   * has it). On completion the submitters' typed values are merged into
   * the contract's fieldValues so they are searchable + visible in the
   * contract detail view.
   */
  submission?: {
    submitters?: Array<{ values?: Array<{ field: string; value: unknown }> }>;
  } | null,
): Promise<void> {
  const STATUS_MAP: Record<string, ContractStatus> = {
    completed: "signed",
    declined: "declined",
    voided: "voided",
    expired: "expired",
  };
  const next = STATUS_MAP[request.status];
  if (!next) return;
  const { atelierContractRecords, atelierDocumentVersions, atelierDocuments } = await import(
    "@workspace/db"
  );
  const [record] = await db
    .select()
    .from(atelierContractRecords)
    .where(eq(atelierContractRecords.signatureRequestId, request.id));
  if (!record) return;
  if (TERMINAL_CONTRACT_STATUSES.has(record.status)) return;

  let signedDocId: string | null = record.currentDocumentId;
  if (next === "signed" && request.signedDocumentId) {
    // Copy the archived signed PDF bytes onto the contract's own chain.
    const { loadDocBytes } = await import("./atelier-documents.js");
    const [libDoc] = await db
      .select()
      .from(atelierDocuments)
      .where(eq(atelierDocuments.id, request.signedDocumentId));
    if (libDoc?.currentVersionId) {
      const [ver] = await db
        .select()
        .from(atelierDocumentVersions)
        .where(eq(atelierDocumentVersions.id, libDoc.currentVersionId));
      const bytes = ver ? await loadDocBytes(ver.blobRef) : null;
      if (bytes) {
        const doc = await addContractDocument({
          contractId: record.id,
          kind: "signed_pdf",
          fileName: ver!.fileName,
          mime: "application/pdf",
          bytes,
          actor: { id: "esign-sync", label: "DocuSeal sync" },
        });
        signedDocId = doc.id;
      }
    }
  }
  // Task #306 — on completion, write the counterparty's typed answers
  // (second-party fields) back into the contract's fieldValues.
  let mergedValues: Record<string, string> | null = null;
  if (next === "signed" && submission?.submitters?.length && record.templateVersionId) {
    const { atelierContractTemplateVersions } = await import("@workspace/db");
    const [tv] = await db
      .select()
      .from(atelierContractTemplateVersions)
      .where(eq(atelierContractTemplateVersions.id, record.templateVersionId));
    if (tv) {
      const extracted = extractSecondPartyValues(tv.fieldSchema ?? [], submission.submitters);
      if (Object.keys(extracted).length > 0) {
        mergedValues = { ...((record.fieldValues as Record<string, string>) ?? {}), ...extracted };
      }
    }
  }
  await db
    .update(atelierContractRecords)
    .set({
      status: next,
      ...(next === "signed"
        ? {
            signedLibraryDocumentId: request.signedDocumentId,
            currentDocumentId: signedDocId,
          }
        : {}),
      ...(mergedValues ? { fieldValues: mergedValues } : {}),
      updatedAt: new Date(),
    })
    .where(eq(atelierContractRecords.id, record.id));
  if (mergedValues) {
    const previous = (record.fieldValues as Record<string, string>) ?? {};
    const changed = Object.fromEntries(
      Object.entries(mergedValues).filter(([k, v]) => previous[k] !== v),
    );
    await auditContractEntity({
      entityType: "atelier_contract_record",
      entityId: record.id,
      actorType: "system",
      actorId: "esign-sync",
      actorLabel: "DocuSeal sync",
      action: "contract.second_party_values",
      payload: {
        signatureRequestId: request.id,
        values: changed,
      },
      summary: `Recorded ${Object.keys(changed).length} second-party value(s) from signing on "${record.title}"`,
    });
  }
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: record.id,
    actorType: "system",
    actorId: "esign-sync",
    actorLabel: "DocuSeal sync",
    action: "contract.status",
    payload: {
      from: record.status,
      to: next,
      signatureRequestId: request.id,
      signedLibraryDocumentId: request.signedDocumentId ?? null,
    },
    summary: `Contract "${record.title}" moved ${record.status} → ${next} via signature flow`,
  });
}

// ---------------------------------------------------------------------------
// Document version chain
// ---------------------------------------------------------------------------

export type ContractDocKind =
  | "generated_draft"
  | "final_docx"
  | "converted_pdf"
  | "signed_pdf";

export async function addContractDocument(args: {
  contractId: string;
  kind: ContractDocKind;
  fileName: string;
  mime: string;
  bytes: Buffer;
  actor: { id: string; label: string };
}): Promise<typeof atelierContractDocuments.$inferSelect> {
  const { blobRef, sha256 } = await storeContractBytes(args.bytes);
  const existing = await db
    .select({ v: atelierContractDocuments.versionNumber })
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.contractId, args.contractId));
  const nextVersion = existing.reduce((mx, r) => Math.max(mx, r.v), 0) + 1;
  const [row] = await db
    .insert(atelierContractDocuments)
    .values({
      id: rid("cdoc"),
      contractId: args.contractId,
      versionNumber: nextVersion,
      kind: args.kind,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: args.bytes.length,
      sha256,
      blobRef,
      createdBy: args.actor.id,
      createdByLabel: args.actor.label,
    })
    .returning();
  return row;
}
