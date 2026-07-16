/**
 * The Atelier — country reference data (Task #290).
 *
 * Per-ISO metadata that augments the canonical ISO 3166-1 list pulled from
 * `i18n-iso-countries`. The seed merges this table with the EN/AR/TR
 * names from the package to produce a complete row for every active country.
 *
 * Only entries listed here get firm-specific extras (aliases, dial codes,
 * default currency, etc). Countries absent from this map are still seeded
 * (with EN/AR/TR display names from the ISO package) but with empty
 * extras — Founding Partner / HR can fill them in via the admin surface.
 */

export type RegionCode =
  | "MENA"
  | "Africa"
  | "Asia"
  | "Europe"
  | "Americas"
  | "Oceania"
  | "Antarctica";

export interface CountryExtras {
  aliases?: string[];
  region: RegionCode;
  subRegion?: string;
  flagEmoji?: string;
  primaryCurrency?: string;
  primaryLanguage?: string;
  dialCode?: string;
  vatDefaultPct?: number;
  isGcc?: boolean;
  isCogniriseTargetMarket?: boolean;
  displayOrderOverride?: number;
  displayNameTr?: string;
}

// Default region per ISO alpha-2 — exhaustive (covers all 249 entries) so
// every seeded row gets a region, even when no other extras are defined.
// Sources: UN M49 region groupings, simplified to the 7 buckets above.
export const REGION_BY_ISO: Record<string, RegionCode> = {
  // ----- Africa (54) -----
  DZ: "MENA", AO: "Africa", BJ: "Africa", BW: "Africa", BF: "Africa", BI: "Africa",
  CV: "Africa", CM: "Africa", CF: "Africa", TD: "Africa", KM: "MENA", CG: "Africa",
  CD: "Africa", DJ: "MENA", EG: "MENA", GQ: "Africa", ER: "Africa", SZ: "Africa",
  ET: "Africa", GA: "Africa", GM: "Africa", GH: "Africa", GN: "Africa", GW: "Africa",
  CI: "Africa", KE: "Africa", LS: "Africa", LR: "Africa", LY: "MENA", MG: "Africa",
  MW: "Africa", ML: "Africa", MR: "MENA", MU: "Africa", YT: "Africa", MA: "MENA",
  MZ: "Africa", NA: "Africa", NE: "Africa", NG: "Africa", RE: "Africa", RW: "Africa",
  SH: "Africa", ST: "Africa", SN: "Africa", SC: "Africa", SL: "Africa", SO: "MENA",
  ZA: "Africa", SS: "Africa", SD: "MENA", TZ: "Africa", TG: "Africa", TN: "MENA",
  UG: "Africa", EH: "MENA", ZM: "Africa", ZW: "Africa",
  // ----- Asia (50) -----
  AF: "Asia", AM: "Asia", AZ: "Asia", BH: "MENA", BD: "Asia", BT: "Asia",
  BN: "Asia", KH: "Asia", CN: "Asia", CY: "Asia", GE: "Asia", HK: "Asia",
  IN: "Asia", ID: "Asia", IR: "MENA", IQ: "MENA", IL: "MENA", JP: "Asia",
  JO: "MENA", KZ: "Asia", KW: "MENA", KG: "Asia", LA: "Asia", LB: "MENA",
  MO: "Asia", MY: "Asia", MV: "Asia", MN: "Asia", MM: "Asia", NP: "Asia",
  KP: "Asia", OM: "MENA", PK: "Asia", PS: "MENA", PH: "Asia", QA: "MENA",
  SA: "MENA", SG: "Asia", KR: "Asia", LK: "Asia", SY: "MENA", TW: "Asia",
  TJ: "Asia", TH: "Asia", TL: "Asia", TR: "Asia", TM: "Asia", AE: "MENA",
  UZ: "Asia", VN: "Asia", YE: "MENA",
  // ----- Europe (51 incl. transcontinentals counted here) -----
  AL: "Europe", AD: "Europe", AT: "Europe", BY: "Europe", BE: "Europe", BA: "Europe",
  BG: "Europe", HR: "Europe", CZ: "Europe", DK: "Europe", EE: "Europe", FO: "Europe",
  FI: "Europe", FR: "Europe", DE: "Europe", GI: "Europe", GR: "Europe", GG: "Europe",
  VA: "Europe", HU: "Europe", IS: "Europe", IE: "Europe", IM: "Europe", IT: "Europe",
  JE: "Europe", LV: "Europe", LI: "Europe", LT: "Europe", LU: "Europe",
  MT: "Europe", MD: "Europe", MC: "Europe", ME: "Europe", NL: "Europe", MK: "Europe",
  NO: "Europe", PL: "Europe", PT: "Europe", RO: "Europe", RU: "Europe", SM: "Europe",
  RS: "Europe", SK: "Europe", SI: "Europe", ES: "Europe", SJ: "Europe", SE: "Europe",
  CH: "Europe", UA: "Europe", GB: "Europe", AX: "Europe",
  // ----- Americas (57) -----
  AI: "Americas", AG: "Americas", AR: "Americas", AW: "Americas", BS: "Americas",
  BB: "Americas", BZ: "Americas", BM: "Americas", BO: "Americas", BQ: "Americas",
  BR: "Americas", VG: "Americas", CA: "Americas", KY: "Americas", CL: "Americas",
  CO: "Americas", CR: "Americas", CU: "Americas", CW: "Americas", DM: "Americas",
  DO: "Americas", EC: "Americas", SV: "Americas", FK: "Americas", GF: "Americas",
  GL: "Americas", GD: "Americas", GP: "Americas", GT: "Americas", GY: "Americas",
  HT: "Americas", HN: "Americas", JM: "Americas", MQ: "Americas", MX: "Americas",
  MS: "Americas", NI: "Americas", PA: "Americas", PY: "Americas", PE: "Americas",
  PR: "Americas", BL: "Americas", KN: "Americas", LC: "Americas", MF: "Americas",
  PM: "Americas", VC: "Americas", SX: "Americas", SR: "Americas", TT: "Americas",
  TC: "Americas", US: "Americas", UM: "Americas", UY: "Americas", VE: "Americas",
  VI: "Americas",
  // ----- Oceania (25) -----
  AS: "Oceania", AU: "Oceania", CX: "Oceania", CC: "Oceania", CK: "Oceania",
  FJ: "Oceania", PF: "Oceania", GU: "Oceania", KI: "Oceania", MH: "Oceania",
  FM: "Oceania", NR: "Oceania", NC: "Oceania", NZ: "Oceania", NU: "Oceania",
  NF: "Oceania", MP: "Oceania", PW: "Oceania", PG: "Oceania", PN: "Oceania",
  WS: "Oceania", SB: "Oceania", TK: "Oceania", TO: "Oceania", TV: "Oceania",
  VU: "Oceania", WF: "Oceania",
  // ----- Antarctica (5) -----
  AQ: "Antarctica", BV: "Antarctica", TF: "Antarctica", HM: "Antarctica", GS: "Antarctica",
  IO: "Asia", // British Indian Ocean Territory — bucket as Asia for region rollups
};

export const COUNTRY_EXTRAS: Record<string, CountryExtras> = {
  // ===== GCC (priority sort, display order 1..6) =====
  SA: {
    aliases: ["KSA", "Kingdom of Saudi Arabia", "Saudi"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇸🇦",
    primaryCurrency: "SAR",
    primaryLanguage: "ar",
    dialCode: "+966",
    vatDefaultPct: 15,
    isGcc: true,
    isCogniriseTargetMarket: true,
    displayOrderOverride: 1,
    displayNameTr: "Suudi Arabistan",
  },
  AE: {
    aliases: ["UAE", "Emirates", "U.A.E."],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇦🇪",
    primaryCurrency: "AED",
    primaryLanguage: "ar",
    dialCode: "+971",
    vatDefaultPct: 5,
    isGcc: true,
    isCogniriseTargetMarket: true,
    displayOrderOverride: 2,
    displayNameTr: "Birleşik Arap Emirlikleri",
  },
  QA: {
    aliases: ["Qatar"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇶🇦",
    primaryCurrency: "QAR",
    primaryLanguage: "ar",
    dialCode: "+974",
    vatDefaultPct: 0,
    isGcc: true,
    displayOrderOverride: 3,
    displayNameTr: "Katar",
  },
  KW: {
    aliases: ["Kuwait"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇰🇼",
    primaryCurrency: "KWD",
    primaryLanguage: "ar",
    dialCode: "+965",
    vatDefaultPct: 0,
    isGcc: true,
    displayOrderOverride: 4,
    displayNameTr: "Kuveyt",
  },
  BH: {
    aliases: ["Bahrain"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇧🇭",
    primaryCurrency: "BHD",
    primaryLanguage: "ar",
    dialCode: "+973",
    vatDefaultPct: 10,
    isGcc: true,
    displayOrderOverride: 5,
    displayNameTr: "Bahreyn",
  },
  OM: {
    aliases: ["Oman", "Sultanate of Oman"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇴🇲",
    primaryCurrency: "OMR",
    primaryLanguage: "ar",
    dialCode: "+968",
    vatDefaultPct: 5,
    isGcc: true,
    displayOrderOverride: 6,
    displayNameTr: "Umman",
  },
  // ===== Other Cognirise target markets =====
  TR: {
    aliases: ["Türkiye", "Turkey", "Republic of Türkiye"],
    region: "Asia",
    subRegion: "Western Asia",
    flagEmoji: "🇹🇷",
    primaryCurrency: "TRY",
    primaryLanguage: "tr",
    dialCode: "+90",
    vatDefaultPct: 20,
    isCogniriseTargetMarket: true,
    displayOrderOverride: 7,
    displayNameTr: "Türkiye",
  },
  // ===== GCC adjacency (MENA non-GCC) =====
  EG: {
    aliases: ["Egypt", "Arab Republic of Egypt"],
    region: "MENA",
    subRegion: "Northern Africa",
    flagEmoji: "🇪🇬",
    primaryCurrency: "EGP",
    primaryLanguage: "ar",
    dialCode: "+20",
    vatDefaultPct: 14,
    displayNameTr: "Mısır",
  },
  JO: {
    aliases: ["Jordan", "Hashemite Kingdom of Jordan"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇯🇴",
    primaryCurrency: "JOD",
    primaryLanguage: "ar",
    dialCode: "+962",
    vatDefaultPct: 16,
    displayNameTr: "Ürdün",
  },
  LB: {
    aliases: ["Lebanon"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇱🇧",
    primaryCurrency: "LBP",
    primaryLanguage: "ar",
    dialCode: "+961",
    vatDefaultPct: 11,
    displayNameTr: "Lübnan",
  },
  IQ: {
    aliases: ["Iraq"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇮🇶",
    primaryCurrency: "IQD",
    primaryLanguage: "ar",
    dialCode: "+964",
    displayNameTr: "Irak",
  },
  YE: {
    aliases: ["Yemen"],
    region: "MENA",
    subRegion: "Western Asia",
    flagEmoji: "🇾🇪",
    primaryCurrency: "YER",
    primaryLanguage: "ar",
    dialCode: "+967",
    displayNameTr: "Yemen",
  },
  // ===== Other commonly-aliased anchors =====
  GB: {
    aliases: ["UK", "United Kingdom", "Britain", "Great Britain", "England"],
    region: "Europe",
    subRegion: "Northern Europe",
    flagEmoji: "🇬🇧",
    primaryCurrency: "GBP",
    primaryLanguage: "en",
    dialCode: "+44",
    vatDefaultPct: 20,
    displayNameTr: "Birleşik Krallık",
  },
  US: {
    aliases: ["USA", "United States", "United States of America", "America"],
    region: "Americas",
    subRegion: "Northern America",
    flagEmoji: "🇺🇸",
    primaryCurrency: "USD",
    primaryLanguage: "en",
    dialCode: "+1",
    displayNameTr: "Amerika Birleşik Devletleri",
  },
  NL: {
    aliases: ["Holland", "Netherlands", "The Netherlands"],
    region: "Europe",
    subRegion: "Western Europe",
    flagEmoji: "🇳🇱",
    primaryCurrency: "EUR",
    primaryLanguage: "en",
    dialCode: "+31",
    vatDefaultPct: 21,
    displayNameTr: "Hollanda",
  },
  DE: {
    aliases: ["Germany", "Deutschland"],
    region: "Europe",
    subRegion: "Western Europe",
    flagEmoji: "🇩🇪",
    primaryCurrency: "EUR",
    primaryLanguage: "en",
    dialCode: "+49",
    vatDefaultPct: 19,
    displayNameTr: "Almanya",
  },
  FR: {
    aliases: ["France"],
    region: "Europe",
    subRegion: "Western Europe",
    flagEmoji: "🇫🇷",
    primaryCurrency: "EUR",
    primaryLanguage: "en",
    dialCode: "+33",
    vatDefaultPct: 20,
    displayNameTr: "Fransa",
  },
  SG: {
    aliases: ["Singapore"],
    region: "Asia",
    subRegion: "South-Eastern Asia",
    flagEmoji: "🇸🇬",
    primaryCurrency: "SGD",
    primaryLanguage: "en",
    dialCode: "+65",
    displayNameTr: "Singapur",
  },
  IN: {
    aliases: ["India", "Bharat"],
    region: "Asia",
    subRegion: "Southern Asia",
    flagEmoji: "🇮🇳",
    primaryCurrency: "INR",
    primaryLanguage: "en",
    dialCode: "+91",
    displayNameTr: "Hindistan",
  },
  MM: {
    aliases: ["Burma", "Myanmar"],
    region: "Asia",
    subRegion: "South-Eastern Asia",
    flagEmoji: "🇲🇲",
    primaryCurrency: "MMK",
    primaryLanguage: "en",
    dialCode: "+95",
  },
};

// ============================================================
// INDUSTRY TAXONOMY (patch §2.2 – §2.3)
// ============================================================
export const INDUSTRIES = [
  { code: "HPS", displayNameEn: "Health & Public Sector", displayNameAr: "الصحة والقطاع العام", shortDescription: "Government, sovereign, healthcare, education", displayOrder: 1 },
  { code: "FS", displayNameEn: "Financial Services", displayNameAr: "الخدمات المالية", shortDescription: "Banks, insurers, capital markets, FinTech", displayOrder: 2 },
  { code: "TMT", displayNameEn: "Technology, Media & Telecom", displayNameAr: "التكنولوجيا والإعلام والاتصالات", shortDescription: "Telcos, media, software, digital natives", displayOrder: 3 },
  { code: "ER", displayNameEn: "Energy & Resources", displayNameAr: "الطاقة والموارد", shortDescription: "Oil & gas, mining, utilities, chemicals, renewables", displayOrder: 4 },
  { code: "IGR", displayNameEn: "Industrial Goods & Real Estate", displayNameAr: "الصناعات والعقارات", shortDescription: "Construction, real estate, manufacturing", displayOrder: 5 },
  { code: "DEF", displayNameEn: "Defense", displayNameAr: "الدفاع", shortDescription: "Defense programs, aerospace & defense industry, national security", displayOrder: 6 },
  { code: "TTH", displayNameEn: "Travel, Transportation & Hospitality", displayNameAr: "السفر والنقل والضيافة", shortDescription: "Aviation, ports, logistics, hospitality", displayOrder: 7 },
  { code: "RC", displayNameEn: "Retail & Consumer Goods", displayNameAr: "البيع بالتجزئة والسلع الاستهلاكية", shortDescription: "Retail, CPG, luxury, beauty, F&B", displayOrder: 8 },
  { code: "XSEC", displayNameEn: "Cross-Sector / Diversified", displayNameAr: "متعدد القطاعات", shortDescription: "Conglomerates, PE, family holdings, NGOs, other", displayOrder: 9 },
] as const;

/**
 * Sub-industry catalogue (44 entries, Cognirise taxonomy).
 *
 * Per patch §6.1, every sub-industry must canonicalize a `defaultOfferingAnchor`
 * (the offering family the Cognirise CSP defaults to when a deal lands in this
 * sub-industry) and a `shortDescription` (one-liner used in the combobox and
 * the admin page). Anchors map to Cognirise's four practice families:
 *   • agentic_ai           — AI agents, copilots, assistive workflows
 *   • legacy_modernization — replatforming, modernization, migration
 *   • data_foundations     — data platforms, lakes, warehousing, governance
 *   • ai_product           — productized AI / model deployment
 */
export const SUB_INDUSTRIES = [
  // HPS (8)
  { code: "HPS_FED", industryCode: "HPS", displayNameEn: "Federal Government", displayOrder: 1, shortDescription: "National ministries, central agencies, federal programs", defaultOfferingAnchor: "legacy_modernization" },
  { code: "HPS_LOCAL", industryCode: "HPS", displayNameEn: "Local Government / Municipalities", displayOrder: 2, shortDescription: "Cities, emirates, smart-city authorities, public services", defaultOfferingAnchor: "agentic_ai" },
  { code: "HPS_SOVEREIGN", industryCode: "HPS", displayNameEn: "Sovereign Wealth / SWF", displayOrder: 3, shortDescription: "PIF, ADIA, Mubadala-class investors and their portfolios", defaultOfferingAnchor: "data_foundations" },
  { code: "HPS_HEALTHCARE", industryCode: "HPS", displayNameEn: "Healthcare Providers", displayOrder: 4, shortDescription: "Hospital groups, clinics, payor-providers, health authorities", defaultOfferingAnchor: "agentic_ai" },
  { code: "HPS_PHARMA", industryCode: "HPS", displayNameEn: "Pharma & Life Sciences", displayOrder: 5, shortDescription: "Pharmaceutical, biotech, medical-devices, regulators", defaultOfferingAnchor: "ai_product" },
  { code: "HPS_EDUCATION", industryCode: "HPS", displayNameEn: "Education", displayOrder: 6, shortDescription: "K-12, higher ed, ministries of education, EdTech", defaultOfferingAnchor: "agentic_ai" },
  { code: "HPS_NGO", industryCode: "HPS", displayNameEn: "NGO / Multilateral", displayOrder: 7, shortDescription: "UN agencies, foundations, development banks, NGOs", defaultOfferingAnchor: "data_foundations" },
  // FS (6)
  { code: "FS_BANKING", industryCode: "FS", displayNameEn: "Banking", displayOrder: 1, shortDescription: "Retail, commercial, corporate banking; core systems", defaultOfferingAnchor: "agentic_ai" },
  { code: "FS_INSURANCE", industryCode: "FS", displayNameEn: "Insurance", displayOrder: 2, shortDescription: "P&C, life, health, takaful; underwriting and claims", defaultOfferingAnchor: "agentic_ai" },
  { code: "FS_CAPMKT", industryCode: "FS", displayNameEn: "Capital Markets", displayOrder: 3, shortDescription: "Exchanges, brokers, custodians, market infrastructure", defaultOfferingAnchor: "data_foundations" },
  { code: "FS_WEALTH", industryCode: "FS", displayNameEn: "Wealth & Asset Management", displayOrder: 4, shortDescription: "Private banks, asset managers, family offices", defaultOfferingAnchor: "agentic_ai" },
  { code: "FS_FINTECH", industryCode: "FS", displayNameEn: "FinTech", displayOrder: 5, shortDescription: "Digital-native lenders, payments, neobanks, embedded finance", defaultOfferingAnchor: "ai_product" },
  { code: "FS_ISLAMIC", industryCode: "FS", displayNameEn: "Islamic Finance", displayOrder: 6, shortDescription: "Sharia-compliant banking, sukuk, takaful, Islamic windows", defaultOfferingAnchor: "data_foundations" },
  // TMT (5)
  { code: "TMT_TELECOM", industryCode: "TMT", displayNameEn: "Telecom", displayOrder: 1, shortDescription: "Mobile/fixed operators, towercos, ISPs, B2B carriers", defaultOfferingAnchor: "agentic_ai" },
  { code: "TMT_MEDIA", industryCode: "TMT", displayNameEn: "Media & Entertainment", displayOrder: 2, shortDescription: "Broadcast, streaming, publishing, gaming, sports", defaultOfferingAnchor: "ai_product" },
  { code: "TMT_SOFTWARE", industryCode: "TMT", displayNameEn: "Software", displayOrder: 3, shortDescription: "Enterprise/B2B SaaS vendors, ISVs, platform plays", defaultOfferingAnchor: "ai_product" },
  { code: "TMT_HIGHTECH", industryCode: "TMT", displayNameEn: "High Tech / Hardware", displayOrder: 4, shortDescription: "Semiconductors, electronics, OEMs, IoT hardware", defaultOfferingAnchor: "data_foundations" },
  { code: "TMT_DIGITAL_NATIVE", industryCode: "TMT", displayNameEn: "Digital Native", displayOrder: 5, shortDescription: "Marketplaces, ride-hailing, super-apps, internet companies", defaultOfferingAnchor: "ai_product" },
  // ER (6)
  { code: "ER_OIL_GAS", industryCode: "ER", displayNameEn: "Oil & Gas", displayOrder: 1, shortDescription: "Upstream, midstream, downstream, NOCs and IOCs", defaultOfferingAnchor: "data_foundations" },
  { code: "ER_MINING", industryCode: "ER", displayNameEn: "Mining & Metals", displayOrder: 2, shortDescription: "Extractives, processing, smelting, metals trading", defaultOfferingAnchor: "data_foundations" },
  { code: "ER_UTILITIES", industryCode: "ER", displayNameEn: "Utilities (Power & Water)", displayOrder: 3, shortDescription: "Generation, T&D, water utilities, grid operators", defaultOfferingAnchor: "legacy_modernization" },
  { code: "ER_CHEMICALS", industryCode: "ER", displayNameEn: "Chemicals", displayOrder: 4, shortDescription: "Specialty/commodity chemicals, agrochemicals", defaultOfferingAnchor: "data_foundations" },
  { code: "ER_PETROCHEM", industryCode: "ER", displayNameEn: "Petrochemicals", displayOrder: 5, shortDescription: "Refining, ethylene/PE/PP, fertilizers, derivatives", defaultOfferingAnchor: "data_foundations" },
  { code: "ER_RENEWABLES", industryCode: "ER", displayNameEn: "Renewables / Clean Energy", displayOrder: 6, shortDescription: "Solar, wind, hydrogen, energy storage, EV infra", defaultOfferingAnchor: "data_foundations" },
  // IGR (5)
  { code: "IGR_CONSTRUCTION", industryCode: "IGR", displayNameEn: "Construction & Engineering", displayOrder: 1, shortDescription: "Contractors, EPC firms, infrastructure programs", defaultOfferingAnchor: "legacy_modernization" },
  { code: "IGR_REAL_ESTATE", industryCode: "IGR", displayNameEn: "Real Estate Development", displayOrder: 2, shortDescription: "Master developers, REITs, property managers, PropTech", defaultOfferingAnchor: "agentic_ai" },
  { code: "IGR_MANUFACTURING", industryCode: "IGR", displayNameEn: "Industrial Manufacturing", displayOrder: 3, shortDescription: "Heavy/light manufacturing, factory operations, MES/SCADA", defaultOfferingAnchor: "data_foundations" },
  { code: "IGR_ENG_SVCS", industryCode: "IGR", displayNameEn: "Engineering Services", displayOrder: 4, shortDescription: "Engineering consultancies, design firms, program mgmt", defaultOfferingAnchor: "agentic_ai" },
  // DEF (3)
  { code: "DEF_GOVERNMENT", industryCode: "DEF", displayNameEn: "Defense Ministries & Agencies", displayOrder: 1, shortDescription: "Ministries of defense, armed forces back-office, simulation, training", defaultOfferingAnchor: "legacy_modernization" },
  { code: "DEF_AEROSPACE", industryCode: "DEF", displayNameEn: "Aerospace & Defense Industry", displayOrder: 2, shortDescription: "Defense OEMs, aerospace primes, MRO, defense electronics", defaultOfferingAnchor: "ai_product" },
  { code: "DEF_SECURITY", industryCode: "DEF", displayNameEn: "National Security & Cyber", displayOrder: 3, shortDescription: "Homeland security, intelligence support, cyber defense", defaultOfferingAnchor: "data_foundations" },
  // TTH (5)
  { code: "TTH_AVIATION", industryCode: "TTH", displayNameEn: "Aviation", displayOrder: 1, shortDescription: "Airlines, airports, ANSPs, ground handling", defaultOfferingAnchor: "agentic_ai" },
  { code: "TTH_PORTS_SHIPPING", industryCode: "TTH", displayNameEn: "Ports & Shipping", displayOrder: 2, shortDescription: "Container terminals, shipping lines, port operators", defaultOfferingAnchor: "data_foundations" },
  { code: "TTH_LOGISTICS", industryCode: "TTH", displayNameEn: "Logistics", displayOrder: 3, shortDescription: "3PLs, freight forwarders, last-mile, postal operators", defaultOfferingAnchor: "agentic_ai" },
  { code: "TTH_HOSPITALITY", industryCode: "TTH", displayNameEn: "Hospitality", displayOrder: 4, shortDescription: "Hotels, resorts, F&B chains, hospitality groups", defaultOfferingAnchor: "agentic_ai" },
  { code: "TTH_TOURISM_AUTHORITY", industryCode: "TTH", displayNameEn: "Tourism Authorities", displayOrder: 5, shortDescription: "Destination marketing organizations, tourism boards", defaultOfferingAnchor: "data_foundations" },
  // RC (5)
  { code: "RC_RETAIL", industryCode: "RC", displayNameEn: "Retail", displayOrder: 1, shortDescription: "Department stores, specialty retail, grocery, e-commerce", defaultOfferingAnchor: "agentic_ai" },
  { code: "RC_CPG", industryCode: "RC", displayNameEn: "Consumer Packaged Goods", displayOrder: 2, shortDescription: "Food, beverage, household, personal-care manufacturers", defaultOfferingAnchor: "data_foundations" },
  { code: "RC_LUXURY", industryCode: "RC", displayNameEn: "Luxury", displayOrder: 3, shortDescription: "Luxury fashion, watches, jewelry, leather goods", defaultOfferingAnchor: "ai_product" },
  { code: "RC_BEAUTY", industryCode: "RC", displayNameEn: "Beauty & Personal Care", displayOrder: 4, shortDescription: "Cosmetics, skincare, fragrance, personal care brands", defaultOfferingAnchor: "ai_product" },
  { code: "RC_FB", industryCode: "RC", displayNameEn: "Food & Beverage", displayOrder: 5, shortDescription: "Restaurants, QSR, beverage producers, catering", defaultOfferingAnchor: "agentic_ai" },
  // XSEC (3)
  { code: "XSEC_CONGLOMERATE", industryCode: "XSEC", displayNameEn: "Conglomerate / Family Holding", displayOrder: 1, shortDescription: "Diversified holdings, family offices, family-business groups", defaultOfferingAnchor: "data_foundations" },
  { code: "XSEC_PE", industryCode: "XSEC", displayNameEn: "Private Equity / Investment", displayOrder: 2, shortDescription: "PE/VC funds and their portfolio companies", defaultOfferingAnchor: "data_foundations" },
  { code: "XSEC_OTHER", industryCode: "XSEC", displayNameEn: "Other / Unclassified", displayOrder: 3, shortDescription: "Catch-all for clients that do not fit other taxonomies", defaultOfferingAnchor: "agentic_ai" },
] as const;
