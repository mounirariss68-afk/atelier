export interface ContactCardPhone {
  country: string;
  number: string;
}

export interface ContactCardInput {
  fullName: string;
  honorific?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  title?: string | null;
  org?: string | null;
  email?: string | null;
  cellPhones?: ContactCardPhone[] | null;
  officeAddress?: string | null;
}

const COUNTRY_DIAL_CODES: Record<string, string> = {
  uae: "+971",
  "united arab emirates": "+971",
  ksa: "+966",
  "saudi arabia": "+966",
  qatar: "+974",
  kuwait: "+965",
  bahrain: "+973",
  oman: "+968",
  egypt: "+20",
  lebanon: "+961",
  jordan: "+962",
  turkey: "+90",
  "türkiye": "+90",
  uk: "+44",
  "united kingdom": "+44",
  france: "+33",
  germany: "+49",
  india: "+91",
  pakistan: "+92",
  usa: "+1",
  "united states": "+1",
};

function escapeVCardText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function resolveDialCode(country: string): string | null {
  const trimmed = country.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  return COUNTRY_DIAL_CODES[trimmed.toLocaleLowerCase("en-US")] ?? null;
}

/**
 * Return an internationally dialable phone value whenever the stored country
 * is a supported label or dial code. Unknown/blank-country values are kept as
 * a trimmed fallback because inventing a calling code would corrupt the data.
 */
export function canonicalPhoneValue(country: string, number: string): string {
  const raw = number.trim();
  if (!raw) return "";

  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("00")) {
    const international = raw.slice(2).trimStart();
    return international ? `+${international}` : raw;
  }

  const dial = resolveDialCode(country);
  if (!dial) return raw;

  const dialDigits = dial.slice(1);
  const withoutTrunk = raw.replace(/^0+[\s()-]*/, "");
  const localDigits = withoutTrunk.replace(/\D/g, "");
  if (localDigits.startsWith(dialDigits)) return `+${withoutTrunk}`;
  return `${dial} ${withoutTrunk}`;
}

function structuredName(input: ContactCardInput): string {
  if (input.firstName && input.lastName) {
    return `${escapeVCardText(input.lastName)};${escapeVCardText(input.firstName)};${escapeVCardText(input.middleName ?? "")};${escapeVCardText(input.honorific ?? "")};`;
  }
  const parts = input.fullName.trim().split(/\s+/);
  if (parts.length <= 1) return `${escapeVCardText(input.fullName.trim())};;;;`;
  const family = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(" ");
  return `${escapeVCardText(family)};${escapeVCardText(given)};;;`;
}

/** Build the canonical, stable vCard payload used by every contact QR. */
export function buildContactVCard(input: ContactCardInput): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${structuredName(input)}`,
    `FN:${escapeVCardText(input.fullName)}`,
  ];
  if (input.org) lines.push(`ORG:${escapeVCardText(input.org)}`);
  lines.push("URL;TYPE=WORK:https://www.cognirise.ai");
  if (input.title) lines.push(`TITLE:${escapeVCardText(input.title)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeVCardText(input.email)}`);

  let phoneOrdinal = 0;
  for (const cell of input.cellPhones ?? []) {
    const tel = canonicalPhoneValue(cell.country, cell.number);
    if (!tel) continue;
    phoneOrdinal += 1;
    const country = cell.country.trim();
    const label = country.startsWith("+") ? "" : country;
    if (label) {
      // Numbering follows populated phone order, with no gaps from blank rows.
      const item = `item${phoneOrdinal}`;
      lines.push(`${item}.TEL;TYPE=CELL,VOICE:${escapeVCardText(tel)}`);
      lines.push(`${item}.X-ABLabel:${escapeVCardText(label)}`);
    } else {
      lines.push(`TEL;TYPE=CELL,VOICE:${escapeVCardText(tel)}`);
    }
  }

  if (input.officeAddress?.trim()) {
    const address = escapeVCardText(input.officeAddress.trim());
    lines.push(`ADR;TYPE=WORK:;;${address};;;;`);
    lines.push(`LABEL;TYPE=WORK:${address}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}