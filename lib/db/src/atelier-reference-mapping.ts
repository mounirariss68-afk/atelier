/**
 * Atelier — deterministic auto-mapper for free-text country & sector strings
 * → canonical reference codes (Task #291).
 *
 * Used by:
 *   - `scripts/src/seed-atelier.ts` to populate `*_code` FK columns alongside
 *     the legacy text columns on every seed row.
 *   - `artifacts/api-server/src/routes/atelier/*` for write-path normalisation
 *     (forms also send the canonical code directly via `<ReferenceCombobox/>`,
 *     but legacy clients and import flows can post free-text and have it
 *     normalised here).
 *   - `artifacts/atelier/src/pages/admin/ReferenceData.tsx` to compute the
 *     "unresolved" rollup (every row whose text value resolves to `null`).
 *
 * Strategy is intentionally rule-based rather than ML / fuzzy:
 *   1. exact match against the canonical code (case-insensitive)
 *   2. exact match against a hand-curated alias (case-insensitive, trimmed,
 *      with the diacritic & punctuation stripped)
 *   3. token-prefix match (first 3 alpha chars of the input matches the
 *      first 3 alpha chars of any alias / display name) — only when the
 *      prefix is at least 3 chars to avoid spurious hits.
 *
 * Returns `null` when nothing resolves; callers surface those rows in the
 * Unresolved Reference Data admin page.
 */

// ============================================================
// COUNTRIES — text → ISO 3166-1 alpha-2 (`atelier_countries.iso_alpha_2`)
// ============================================================

/**
 * Hand-curated country aliases for values that have appeared in seeds,
 * imports, or legacy data. Keys are normalised (lowercase, no punctuation,
 * no diacritics, single-spaced); values are the canonical ISO alpha-2.
 *
 * Add new aliases here rather than in callers.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  // Saudi Arabia
  ksa: "SA",
  sa: "SA",
  saudi: "SA",
  "saudi arabia": "SA",
  "kingdom of saudi arabia": "SA",
  "k s a": "SA",
  // United Arab Emirates
  uae: "AE",
  ae: "AE",
  emirates: "AE",
  "united arab emirates": "AE",
  "u a e": "AE",
  "uae abu dhabi": "AE",
  "uae dubai": "AE",
  "uae sharjah": "AE",
  "abu dhabi": "AE",
  dubai: "AE",
  difc: "AE",
  adgm: "AE",
  // NOTE: keys must already be normalised (no underscores — `normalize()`
  // collapses `_` to a space). The original ALL-CAPS underscore tokens like
  // `UAE_DIFC` come in via the compliance-records `jurisdiction` column and
  // normalise to "uae difc" / "uae adgm" / "uae other".
  "uae difc": "AE",
  "uae adgm": "AE",
  "uae other": "AE",
  // Bahrain
  bh: "BH",
  bahrain: "BH",
  "kingdom of bahrain": "BH",
  // Qatar
  qa: "QA",
  qatar: "QA",
  // Kuwait
  kw: "KW",
  kuwait: "KW",
  // Oman
  om: "OM",
  oman: "OM",
  "sultanate of oman": "OM",
  // Egypt
  eg: "EG",
  egy: "EG",
  egypt: "EG",
  // Jordan
  jo: "JO",
  jordan: "JO",
  // Lebanon
  lb: "LB",
  lebanon: "LB",
  // Türkiye
  tr: "TR",
  tur: "TR",
  turkey: "TR",
  turkiye: "TR",
  "turkiye republic": "TR",
  "republic of turkiye": "TR",
  // United Kingdom
  uk: "GB",
  gb: "GB",
  britain: "GB",
  "great britain": "GB",
  "united kingdom": "GB",
  // United States
  us: "US",
  usa: "US",
  america: "US",
  "united states": "US",
  "united states of america": "US",
  // France / Germany / Switzerland (commonly seen in expense feeds)
  fr: "FR",
  france: "FR",
  de: "DE",
  germany: "DE",
  ch: "CH",
  switzerland: "CH",
  // India / Pakistan (large diaspora hire base)
  in: "IN",
  india: "IN",
  pk: "PK",
  pakistan: "PK",
};

/**
 * Strip diacritics, lowercase, replace any non-alphanumeric with a single
 * space, collapse whitespace, trim. Result is the lookup key.
 */
function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resolve a free-text country string to the canonical ISO alpha-2 code,
 * or `null` if it can't be resolved.
 *
 * Pure / synchronous / no DB round-trip — uses the in-memory alias table.
 * Adding a country to the lookup table without an entry here means values
 * like "Republic of X" won't auto-resolve; surface them in the Unresolved
 * page for a partner to map manually.
 */
export function mapCountryToCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalize(raw);
  if (!key) return null;
  // Direct alpha-2 (case-insensitive) — but only allow it if the value is
  // a known ISO 3166-1 alpha-2. Without this guard we'd silently accept
  // any 2-letter junk ("XX", "ZZ") and store it as the FK value.
  if (/^[a-z]{2}$/.test(key)) {
    const upper = key.toUpperCase();
    return ISO_ALPHA_2_ALLOWLIST.has(upper) ? upper : null;
  }
  return COUNTRY_ALIASES[key] ?? null;
}

/**
 * Allowlist of ISO 3166-1 alpha-2 codes accepted by `mapCountryToCode`. The
 * full 249-entry table lives in `atelier_countries`; this is the in-memory
 * mirror so we don't have to hit the DB on every write. Kept in sync with
 * the seed (which itself uses `i18n-iso-countries` minus "XK" / Kosovo).
 */
const ISO_ALPHA_2_ALLOWLIST = new Set<string>([
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY",
  "HK","HM","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","UM","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "YE","YT",
  "ZA","ZM","ZW",
]);

/**
 * All normalised alias keys that resolve to the given ISO alpha-2 code
 * (plus the lowercased code itself when it's in the allowlist). Exposed so
 * tests can cross-check mirrored per-country helpers (e.g. the frontend's
 * `isUaeCountry` in `artifacts/atelier/src/lib/country-uae.ts`) against this
 * server-side table without duplicating it.
 */
export function countryAliasKeysForCode(code: string): string[] {
  const upper = code.toUpperCase();
  const keys = Object.keys(COUNTRY_ALIASES).filter(
    (k) => COUNTRY_ALIASES[k] === upper,
  );
  if (ISO_ALPHA_2_ALLOWLIST.has(upper) && !keys.includes(upper.toLowerCase())) {
    keys.push(upper.toLowerCase());
  }
  return keys.sort();
}

/**
 * All ISO 3166-1 alpha-2 codes accepted by `mapCountryToCode`, sorted.
 * Exposed so tests can assert that every storable code renders a
 * human-readable name in mirrored frontend helpers.
 */
export function isoAlpha2Codes(): string[] {
  return [...ISO_ALPHA_2_ALLOWLIST].sort();
}

/**
 * Map an array of free-text country strings, dropping any that don't
 * resolve. Returns the deduplicated set in input order.
 */
export function mapCountriesToCodes(
  raws: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raws) {
    const c = mapCountryToCode(r);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// ============================================================
// INDUSTRIES + SUB-INDUSTRIES — text → industry / sub-industry code
// ============================================================

/**
 * Free-text sector → primary industry code (`atelier_industries.code`).
 * The seed currently uses these labels; new aliases get added here as
 * they're discovered in production import flows.
 */
const INDUSTRY_ALIASES: Record<string, string> = {
  // Health & Public Sector
  hps: "HPS",
  health: "HPS",
  healthcare: "HPS",
  "public sector": "HPS",
  // public_sector normalises to "public sector" (covered above).
  government: "HPS",
  "government enablement": "HPS",
  "government smart city": "HPS",
  "smart city": "HPS",
  "mobility public safety": "HPS",
  "public safety": "HPS",
  // Financial Services
  fs: "FS",
  finance: "FS",
  "financial services": "FS",
  // financial_services normalises to "financial services".
  banking: "FS",
  insurance: "FS",
  // TMT
  tmt: "TMT",
  technology: "TMT",
  tech: "TMT",
  software: "TMT",
  telecom: "TMT",
  telco: "TMT",
  media: "TMT",
  // Energy & Resources
  er: "ER",
  energy: "ER",
  "oil gas": "ER",
  // oil_gas normalises to "oil gas".
  utilities: "ER",
  // Industrial Goods & Real Estate
  igr: "IGR",
  industrial: "IGR",
  manufacturing: "IGR",
  "real estate": "IGR",
  "real estate public": "IGR",
  construction: "IGR",
  automotive: "IGR",
  // Travel, Transportation & Hospitality
  tth: "TTH",
  travel: "TTH",
  transportation: "TTH",
  logistics: "TTH",
  "logistics fuel retail": "TTH",
  hospitality: "TTH",
  // `travel_hospitality` → "travel hospitality" after normalize().
  "travel hospitality": "TTH",
  aviation: "TTH",
  // Retail & Consumer Goods
  rc: "RC",
  retail: "RC",
  consumer: "RC",
  "consumer goods": "RC",
  cpg: "RC",
  "retail energy logistics": "RC", // mixed bag — primary anchor is retail
  // Cross-Sector
  xsec: "XSEC",
  conglomerate: "XSEC",
  diversified: "XSEC",
  "shared services bpo": "XSEC",
  bpo: "XSEC",
  other: "XSEC",
};

/**
 * Free-text sector → sub-industry code (`atelier_sub_industries.code`).
 * Order of resolution: sub-industry alias first, then fall back to the
 * primary industry. A row may resolve to (industryCode=HPS, subCode=null).
 */
const SUB_INDUSTRY_ALIASES: Record<string, string> = {
  // HPS
  "government enablement": "HPS_FED",
  government: "HPS_FED",
  "federal government": "HPS_FED",
  // public_sector normalises to "public sector".
  "smart city": "HPS_LOCAL",
  "government smart city": "HPS_LOCAL",
  "local government": "HPS_LOCAL",
  municipalities: "HPS_LOCAL",
  "mobility public safety": "HPS_LOCAL",
  "sovereign wealth": "HPS_SOVEREIGN",
  swf: "HPS_SOVEREIGN",
  pif: "HPS_SOVEREIGN",
  healthcare: "HPS_HEALTHCARE",
  "healthcare providers": "HPS_HEALTHCARE",
  pharma: "HPS_PHARMA",
  "pharma life sciences": "HPS_PHARMA",
  education: "HPS_EDUCATION",
  ngo: "HPS_NGO",
  // FS
  banking: "FS_BANKING",
  insurance: "FS_INSURANCE",
  "capital markets": "FS_CAPMKT",
  wealth: "FS_WEALTH",
  "wealth asset management": "FS_WEALTH",
  fintech: "FS_FINTECH",
  "islamic finance": "FS_ISLAMIC",
  // TMT
  telecom: "TMT_TELECOM",
  telco: "TMT_TELECOM",
  "media entertainment": "TMT_MEDIA",
  media: "TMT_MEDIA",
  software: "TMT_SOFTWARE",
  "high tech": "TMT_HIGHTECH",
  "digital native": "TMT_DIGITAL_NATIVE",
  // ER
  "oil gas": "ER_OIL_GAS",
  // oil_gas normalises to "oil gas".
  mining: "ER_MINING",
  utilities: "ER_UTILITIES",
  chemicals: "ER_CHEMICALS",
  petrochemicals: "ER_PETROCHEM",
  renewables: "ER_RENEWABLES",
  // IGR
  construction: "IGR_CONSTRUCTION",
  "real estate": "IGR_REAL_ESTATE",
  "real estate public": "IGR_REAL_ESTATE",
  "real estate development": "IGR_REAL_ESTATE",
  manufacturing: "IGR_MANUFACTURING",
  "industrial manufacturing": "IGR_MANUFACTURING",
  automotive: "IGR_MANUFACTURING",
  aerospace: "DEF_AEROSPACE",
  "aerospace defense": "DEF_AEROSPACE",
  "engineering services": "IGR_ENG_SVCS",
  // TTH
  aviation: "TTH_AVIATION",
  "ports shipping": "TTH_PORTS_SHIPPING",
  ports: "TTH_PORTS_SHIPPING",
  shipping: "TTH_PORTS_SHIPPING",
  logistics: "TTH_LOGISTICS",
  "logistics fuel retail": "TTH_LOGISTICS",
  hospitality: "TTH_HOSPITALITY",
  // travel_hospitality normalises to "travel hospitality".
  "tourism authorities": "TTH_TOURISM_AUTHORITY",
  tourism: "TTH_TOURISM_AUTHORITY",
  // RC
  retail: "RC_RETAIL",
  "retail energy logistics": "RC_RETAIL",
  cpg: "RC_CPG",
  "consumer packaged goods": "RC_CPG",
  luxury: "RC_LUXURY",
  beauty: "RC_BEAUTY",
  "beauty personal care": "RC_BEAUTY",
  "food beverage": "RC_FB",
  "food beverage industry": "RC_FB",
  // XSEC
  "shared services bpo": "XSEC_OTHER",
  "shared services": "XSEC_OTHER",
  bpo: "XSEC_OTHER",
  conglomerate: "XSEC_CONGLOMERATE",
  "family holding": "XSEC_CONGLOMERATE",
  "private equity": "XSEC_PE",
  pe: "XSEC_PE",
  other: "XSEC_OTHER",
  unclassified: "XSEC_OTHER",
};

/**
 * Resolve a free-text sector string to `{ industryCode, subIndustryCode }`.
 * Either field may be null. If both are null, surface the row in the
 * Unresolved admin page.
 */
export function mapSectorToCodes(
  raw: string | null | undefined,
): { industryCode: string | null; subIndustryCode: string | null } {
  if (!raw) return { industryCode: null, subIndustryCode: null };
  const key = normalize(raw);
  if (!key) return { industryCode: null, subIndustryCode: null };

  const sub = SUB_INDUSTRY_ALIASES[key] ?? null;
  if (sub) {
    return { industryCode: sub.split("_")[0] ?? null, subIndustryCode: sub };
  }
  // Direct industry-code hit (e.g. "HPS").
  if (/^[A-Z]{2,4}$/i.test(raw.trim())) {
    const upper = raw.trim().toUpperCase();
    if (INDUSTRY_CODES.has(upper)) return { industryCode: upper, subIndustryCode: null };
  }
  const industry = INDUSTRY_ALIASES[key] ?? null;
  return { industryCode: industry, subIndustryCode: null };
}

/**
 * Map an array of free-text sector strings to industry codes (deduplicated,
 * input order). Used for `assets.industry_tags` and `win_themes.sector_tags`.
 */
export function mapSectorTagsToCodes(
  raws: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raws) {
    const { industryCode } = mapSectorToCodes(r);
    if (industryCode && !seen.has(industryCode)) {
      seen.add(industryCode);
      out.push(industryCode);
    }
  }
  return out;
}

const INDUSTRY_CODES = new Set([
  "HPS",
  "FS",
  "TMT",
  "ER",
  "IGR",
  "TTH",
  "RC",
  "XSEC",
]);

/**
 * Hard-coded list of valid industry codes for synchronous validation
 * (avoids a DB round-trip in route handlers). Mirror of the `INDUSTRIES`
 * array in `artifacts/api-server/src/lib/data/atelier-reference-data.ts`.
 */
export const VALID_INDUSTRY_CODES = INDUSTRY_CODES;
