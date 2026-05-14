/**
 * Task #332 — PII redactor for CLI audit + persisted-frame paths.
 *
 * The CLI ferries free-form user prompts, attachment OCR text, and
 * Claude-emitted narrations into the audit table and the persisted
 * `frames` blob on `atelier_cli_turns`. That makes those tables a
 * juicy target for accidental data leakage — emails, phone numbers,
 * and credit-card-like sequences must be redacted server-side before
 * write so a downstream audit consumer (Sentinel report, export.csv,
 * GDPR DSAR dump) cannot re-derive them.
 *
 * The redactor is intentionally conservative:
 *   - Email      → `<email>`
 *   - Phone      → `<phone>` (E.164 + locale variants)
 *   - PAN/IBAN   → `<pan>` / `<iban>`
 *   - Long digit runs (>=12) → `<digits>`
 *   - URLs that include credentials (user:pass@) → strip the userinfo
 *
 * It is *not* a full DLP — the goal is to keep accidents out of the
 * blast radius. Real Sentinel-grade redaction lives in the Sentinel
 * pipeline; the CLI just defends its own write path.
 */

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const PAN_RE = /\b(?:\d[ -]?){13,19}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const LONG_DIGIT_RE = /\b\d{12,}\b/g;
const URL_USERINFO_RE = /(https?:\/\/)([^\s/@]+:[^\s/@]+)@/g;

export interface RedactionStats {
  emails: number;
  phones: number;
  pans: number;
  ibans: number;
  digitRuns: number;
  urlCreds: number;
}

export interface RedactionResult {
  text: string;
  stats: RedactionStats;
}

export function redactText(input: string): RedactionResult {
  const stats: RedactionStats = {
    emails: 0, phones: 0, pans: 0, ibans: 0, digitRuns: 0, urlCreds: 0,
  };
  let out = input;
  out = out.replace(URL_USERINFO_RE, (_m, scheme) => {
    stats.urlCreds += 1;
    return `${scheme}<redacted>@`;
  });
  out = out.replace(IBAN_RE, () => {
    stats.ibans += 1;
    return "<iban>";
  });
  out = out.replace(EMAIL_RE, () => {
    stats.emails += 1;
    return "<email>";
  });
  out = out.replace(PAN_RE, (m) => {
    // Skip if it matched a phone-like grouping already handled below.
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13) return m;
    stats.pans += 1;
    return "<pan>";
  });
  out = out.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) return m;
    stats.phones += 1;
    return "<phone>";
  });
  out = out.replace(LONG_DIGIT_RE, () => {
    stats.digitRuns += 1;
    return "<digits>";
  });
  return { text: out, stats };
}

/**
 * Recursively redact a JSON-shaped payload. Object keys are not
 * redacted (they are schema, not data); only string values are
 * scanned. Number/boolean/null pass through untouched.
 */
export function redactJson<T>(value: T): { value: T; stats: RedactionStats } {
  const acc: RedactionStats = {
    emails: 0, phones: 0, pans: 0, ibans: 0, digitRuns: 0, urlCreds: 0,
  };
  const merge = (s: RedactionStats) => {
    acc.emails += s.emails; acc.phones += s.phones; acc.pans += s.pans;
    acc.ibans += s.ibans; acc.digitRuns += s.digitRuns; acc.urlCreds += s.urlCreds;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redactText(v);
      merge(r.stats);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(vv);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, stats: acc };
}

/** Convenience helper to test if a redaction had any effect. */
export function statsTouched(s: RedactionStats): boolean {
  return s.emails + s.phones + s.pans + s.ibans + s.digitRuns + s.urlCreds > 0;
}
