/**
 * Auto-detect key dates on personal ID documents (passport / visa /
 * national ID / residency) at upload time, so people don't have to type
 * the expiry themselves.
 *
 * Best-effort by design: callers treat a null result (or a throw) as
 * "nothing detected" and store the document exactly as before. Images go
 * through Claude vision; PDFs go through unpdf text extraction + a text
 * prompt. Tiny payloads (<4 KB) are skipped so offline probe tests with
 * garbage bytes never trigger a live model call.
 */

import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";
import { getPrivacyAuthorizedAnthropic } from "./assistant/provider-runtime.js";

export interface DocDateExtraction {
  expiresAt: string | null;
  issuedAt: string | null;
  docNumber: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VISION_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIN_BYTES = 4096;

const SYSTEM = `You extract structured fields from identity/travel documents (passports, visas, national ID cards, residency permits). Reply with ONLY a single JSON object (no prose, no code fences) with these fields:
- "expiresAt": the document's expiry / valid-until date as YYYY-MM-DD, or null if not visible. For visas this is the "valid until" / "expiry" date, NOT the entry or issue date. Convert any printed format (DD/MM/YYYY, Hijri-adjacent Gregorian pairs, month names) to the Gregorian YYYY-MM-DD form.
- "issuedAt": the issue date as YYYY-MM-DD, or null.
- "docNumber": the document/visa/permit number as printed, or null.
If the image is not an identity document or the fields are unreadable, return nulls. Never guess a date that is not printed.`;

function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!ISO_DATE.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Sanity window — ID documents live roughly within ±40 years of today.
  const year = d.getUTCFullYear();
  const now = new Date().getUTCFullYear();
  if (year < now - 40 || year > now + 40) return null;
  return t;
}

function parseModelJson(text: string): DocDateExtraction {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("doc-dates-non-json");
  const raw = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  return {
    expiresAt: cleanDate(raw.expiresAt),
    issuedAt: cleanDate(raw.issuedAt),
    docNumber:
      typeof raw.docNumber === "string" && raw.docNumber.trim()
        ? raw.docNumber.trim().slice(0, 100)
        : null,
  };
}

async function askModel(
  orgId: string,
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            source: { type: "base64"; media_type: string; data: string };
          }
      >,
): Promise<DocDateExtraction> {
  const { anthropic } = await getPrivacyAuthorizedAnthropic({
    dataClasses: ["restricted"],
    orgId,
    capabilityId: "documents.date_extraction",
    model: "claude-haiku-4-5",
  });
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 25000),
  );
  try {
    const resp = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: content as never,
          },
        ],
      },
      { signal: ac.signal },
    );
    const block = resp.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    return parseModelJson(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns detected fields or null when nothing could be extracted.
 * Never intended to block an upload — callers wrap in try/catch anyway.
 */
export async function extractDocumentDates(
  orgId: string,
  bytes: Buffer,
  mime: string,
  hint: { kind: string; title: string },
): Promise<DocDateExtraction | null> {
  if (bytes.byteLength < MIN_BYTES) return null;
  const hintText = `Document kind: ${hint.kind}. User-entered title: "${hint.title}". Extract the fields.`;
  if (VISION_MIMES.has(mime)) {
    return askModel(orgId, [
      {
        type: "image",
        source: { type: "base64", media_type: mime, data: bytes.toString("base64") },
      },
      { type: "text", text: hintText },
    ]);
  }
  if (mime === "application/pdf") {
    const proxy = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await unpdfExtractText(proxy, { mergePages: true });
    const t = (text ?? "").trim();
    if (!t) return null; // scanned/image-only PDF — no text layer to read
    return askModel(orgId, `${hintText}\n\nDocument text:\n\n${t.slice(0, 15000)}`);
  }
  return null;
}
