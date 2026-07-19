/**
 * Task #219 — display-only phone formatting for every read-only phone
 * rendering in the app. Frontend copy of `formatCardPhone` in
 * `artifacts/api-server/src/lib/atelier-business-card.ts` — keep the two
 * in sync so the on-screen numbers match the printed business-card PDF.
 *
 * Never throws, never returns empty for non-empty input: unparseable
 * numbers fall back to their raw stored text. Inputs/stored values are
 * untouched — this is for display only.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface PhoneCell {
  country: string;
  number: string;
}

/** Country-label → ISO-3166 alpha-2, for cells stored with a name label
 *  instead of a dial code (mirrors the server map). */
const COUNTRY_LABEL_TO_ISO: Record<string, CountryCode> = {
  uae: "AE",
  "united arab emirates": "AE",
  ksa: "SA",
  "saudi arabia": "SA",
  qatar: "QA",
  kuwait: "KW",
  bahrain: "BH",
  oman: "OM",
  egypt: "EG",
  lebanon: "LB",
  jordan: "JO",
  turkey: "TR",
  "türkiye": "TR",
  uk: "GB",
  "united kingdom": "GB",
  france: "FR",
  germany: "DE",
  india: "IN",
  pakistan: "PK",
  usa: "US",
  "united states": "US",
};

/** Dial code → friendly country label, for cells stored with a dial code
 *  ("+971") in the country field. Mirrors the countries covered above. */
const DIAL_CODE_TO_LABEL: Record<string, string> = {
  "+971": "UAE",
  "+966": "KSA",
  "+974": "Qatar",
  "+965": "Kuwait",
  "+973": "Bahrain",
  "+968": "Oman",
  "+20": "Egypt",
  "+961": "Lebanon",
  "+962": "Jordan",
  "+90": "Türkiye",
  "+44": "UK",
  "+33": "France",
  "+49": "Germany",
  "+91": "India",
  "+92": "Pakistan",
  "+1": "USA",
};

/**
 * Display-friendly label for a stored cell `country` field. Returns a
 * country name when the field holds a known dial code, the field as-is
 * when it already holds a name label, and null when it's empty or an
 * unrecognised dial code (caller should omit the label entirely).
 */
export function phoneCountryLabel(country: string): string | null {
  const trimmed = country.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const normalized = trimmed.replace(/[\s()-]/g, "");
    return DIAL_CODE_TO_LABEL[normalized] ?? null;
  }
  return trimmed;
}

/**
 * Format one stored cell for display. Cells are stored as
 * `{ country, number }` where `country` is usually a dial code ("+971")
 * and `number` the local part ("506504416"), but tolerate full E.164
 * numbers and country-name labels. Falls back to a raw international
 * join when the number can't be parsed.
 */
export function formatPhoneCell(cell: PhoneCell): string {
  const rawNumber = cell.number.trim();
  const rawCountry = cell.country.trim();
  if (!rawNumber) return "";

  const candidates: Array<{ text: string; iso?: CountryCode }> = [];
  if (rawNumber.startsWith("+")) {
    candidates.push({ text: rawNumber });
  }
  if (rawCountry.startsWith("+")) {
    candidates.push({ text: `${rawCountry}${rawNumber.replace(/^0+/, "")}` });
  }
  const iso = COUNTRY_LABEL_TO_ISO[rawCountry.toLowerCase()];
  if (iso) {
    candidates.push({ text: rawNumber, iso });
  }
  candidates.push({ text: rawNumber });

  for (const c of candidates) {
    const parsed = parsePhoneNumberFromString(c.text, c.iso);
    if (parsed && parsed.isPossible()) return parsed.formatInternational();
  }
  // Unparseable: fall back to a readable international-style join.
  if (rawCountry.startsWith("+") && !rawNumber.startsWith("+")) {
    return `${rawCountry} ${rawNumber}`;
  }
  return rawNumber;
}

/**
 * Format a free-text phone string (CRM contact phones, emergency-contact
 * numbers). Returns the raw text unchanged when it can't be parsed.
 */
export function formatPhoneDisplay(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return formatPhoneCell({ country: "", number: trimmed });
}
