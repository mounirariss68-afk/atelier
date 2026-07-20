/**
 * Task #396 — merchant text normalization (ported from the invoice-scanner
 * kit's merchantNormalizer.ts + merchantConstants.ts).
 *
 * normalizeMerchant() strips accents, long digit runs (store/terminal
 * numbers), punctuation and collapses whitespace; extractCoreMerchant()
 * additionally drops payment-processor prefixes, location suffixes and
 * corporate stopwords to isolate the brand tokens.
 */

export const PAYMENT_PREFIXES = new Set([
  "sp", "sq", "pp", "nfc", "pos", "atm", "txw", "pmt", "pymt", "pym",
  "izettle", "sumup", "zettle", "visa", "mc", "mastercard", "amex",
  "google", "apple", "samsung", "contactless", "tap", "imp", "iap",
  "mpos", "eftpos",
]);

export const LOCATION_SUFFIXES = new Set([
  "ae", "uae", "dubai", "abudhabi", "dhabi", "sharjah", "ajman", "fujairah",
  "rak", "quwain", "dxb",
  "uk", "gbr", "gb", "usa", "us", "london", "lnd", "ldn", "ny", "nyc", "la",
  "singapore", "sg", "sgp",
  "ksa", "sau", "saudi", "riyadh", "jeddah", "qatar", "qat", "doha", "bahrain", "bhr", "manama",
  "kuwait", "kwt", "oman", "omn", "muscat", "egypt", "egy", "cairo", "india", "ind", "mumbai", "delhi",
  "turkey", "tur", "istanbul", "ankara", "germany", "deu", "ger", "berlin", "france", "fra", "paris",
  "italy", "ita", "rome", "milan", "spain", "esp", "madrid", "barcelona",
  "netherlands", "nld", "amsterdam", "belgium", "bel", "brussels",
  "switzerland", "che", "zurich", "geneva", "austria", "aut", "vienna",
  "portugal", "prt", "lisbon", "ireland", "irl", "dublin",
  "scotland", "glasgow", "edinburgh", "wales", "cardiff",
  "dover", "fitzrovia", "westbourne", "oxford",
  "online", "mobile", "web", "terminal",
]);

export const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "at", "to", "for", "on", "by",
  "llc", "ltd", "inc", "co", "corp", "fzc", "fze", "fzco", "dmcc", "jlt",
  "plc", "wll", "pjsc", "psc", "est", "establishment",
  "enterprises", "services", "solutions", "holdings", "international", "intl",
  "pvt", "private", "limited", "company", "trading", "general", "group",
  "branch", "store", "shop", "outlet", "center", "centre",
]);

export function normalizeMerchant(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/[^\w\s*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCoreMerchant(text: string): string {
  if (!text) return "";
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/[#*\-_.,:;()[\]{}'"!@$%^&+=|\\/<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(" ");
  let startIdx = 0;
  while (startIdx < tokens.length && PAYMENT_PREFIXES.has(tokens[startIdx])) {
    startIdx++;
  }
  const filtered = tokens
    .slice(startIdx)
    .filter(
      (t) =>
        t.length > 1 &&
        !LOCATION_SUFFIXES.has(t) &&
        !STOPWORDS.has(t) &&
        !PAYMENT_PREFIXES.has(t),
    );
  return filtered.join(" ");
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function extractSignificantTokens(text: string): string[] {
  return tokenize(text).filter(
    (t) => !LOCATION_SUFFIXES.has(t) && !STOPWORDS.has(t) && !/^\d+$/.test(t),
  );
}

export function generateBigrams(tokens: string[]): string[] {
  if (tokens.length < 2) return [];
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}
