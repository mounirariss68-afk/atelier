/**
 * Task #645 — Offline vCard builder for the employee business-card QR code.
 *
 * The QR encodes this vCard string DIRECTLY (no hosted page, no server round
 * trip), so a customer scanning a printed card saves the contact instantly,
 * even with no network. Only PUBLIC, card-safe fields are ever included —
 * never compensation, IBAN, or other restricted data.
 */

export interface VCardCell {
  country: string;
  number: string;
}

export interface VCardInput {
  fullName: string;
  /** Task #538 — structured name fields from the unified person record.
   *  When present they produce an exact N: value instead of the
   *  last-token guess. */
  honorific?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  title?: string | null;
  org?: string | null;
  email?: string | null;
  cellPhones?: VCardCell[];
  officeAddress?: string | null;
}

/** Escape a value for a vCard text field (RFC 6350 / 2426 rules). */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Task #233 — build the full international TEL value from a stored cell.
 * `country` usually holds the dial code (e.g. "+971"); it must become part
 * of the phone NUMBER, never the label. Handles: number already starting
 * with "+" (kept as-is), number already containing the dial-code digits
 * (not doubled), blank/name-label country (number used as-is), whitespace.
 */
export function telValue(country: string, number: string): string {
  const num = number.trim();
  const dial = country.trim();
  if (!num) return "";
  if (!dial.startsWith("+") || num.startsWith("+")) return num;
  const dialDigits = dial.replace(/\D/g, "");
  if (!dialDigits) return num;
  const local = num.replace(/^0+/, "");
  const localDigits = local.replace(/\D/g, "");
  if (localDigits.startsWith(dialDigits)) return `+${local}`;
  return `${dial} ${local}`;
}

/** Split a display name into a structured N value: Family;Given;;;. */
function structuredName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return `${esc(fullName.trim())};;;;`;
  const family = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(" ");
  return `${esc(family)};${esc(given)};;;`;
}

/**
 * Build a vCard 3.0 string. Country-labelled cells use the Apple-style
 * `itemN.` grouping so the label (e.g. "UAE") rides along with each number
 * and shows up in the saved contact on iOS/macOS; Android still imports the
 * numbers as mobile lines.
 */
export function buildVCard(input: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  // N: Family;Given;Additional;Prefix;Suffix — prefer real structured
  // fields (Task #538); fall back to the last-token guess for legacy rows.
  const n =
    input.firstName && input.lastName
      ? `${esc(input.lastName)};${esc(input.firstName)};${esc(input.middleName ?? "")};${esc(input.honorific ?? "")};`
      : structuredName(input.fullName);
  lines.push(`N:${n}`);
  lines.push(`FN:${esc(input.fullName)}`);
  if (input.org) lines.push(`ORG:${esc(input.org)}`);
  if (input.title) lines.push(`TITLE:${esc(input.title)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(input.email)}`);

  const cells = (input.cellPhones ?? []).filter((c) => c.number.trim());
  cells.forEach((c, i) => {
    const tel = telValue(c.country, c.number);
    const country = c.country.trim();
    // Only a real non-dial-code label (e.g. "UAE") rides along as an
    // Apple-style X-ABLabel; dial codes belong in the number itself.
    const label = country.startsWith("+") ? "" : country;
    if (label) {
      const item = `item${i + 1}`;
      lines.push(`${item}.TEL;TYPE=CELL,VOICE:${esc(tel)}`);
      lines.push(`${item}.X-ABLabel:${esc(label)}`);
    } else {
      lines.push(`TEL;TYPE=CELL,VOICE:${esc(tel)}`);
    }
  });

  if (input.officeAddress && input.officeAddress.trim()) {
    // Place the full address in the street component; other ADR components
    // (PO box, extended, city, region, postal, country) are left empty.
    lines.push(`ADR;TYPE=WORK:;;${esc(input.officeAddress.trim())};;;;`);
    lines.push(`LABEL;TYPE=WORK:${esc(input.officeAddress.trim())}`);
  }

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

/** Sanitise a name into a safe download filename stem. */
export function vcardFilename(fullName: string): string {
  const stem =
    fullName
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "") || "contact";
  return `${stem}.vcf`;
}
