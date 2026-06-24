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
  lines.push(`N:${structuredName(input.fullName)}`);
  lines.push(`FN:${esc(input.fullName)}`);
  if (input.org) lines.push(`ORG:${esc(input.org)}`);
  if (input.title) lines.push(`TITLE:${esc(input.title)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(input.email)}`);

  const cells = (input.cellPhones ?? []).filter((c) => c.number.trim());
  cells.forEach((c, i) => {
    const num = c.number.trim();
    const label = c.country.trim();
    if (label) {
      const item = `item${i + 1}`;
      lines.push(`${item}.TEL;TYPE=CELL,VOICE:${esc(num)}`);
      lines.push(`${item}.X-ABLabel:${esc(label)}`);
    } else {
      lines.push(`TEL;TYPE=CELL,VOICE:${esc(num)}`);
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
