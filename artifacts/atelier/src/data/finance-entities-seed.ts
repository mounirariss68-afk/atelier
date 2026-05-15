/**
 * Finance Entities backbone — demo seed (Task #372).
 *
 * Demo-only data describing the legal-entity scaffold every CFO/Controller
 * surface needs: legal entities (parent/sub/branch/JV) with their
 * commercial registration, tax IDs, e-invoicing identifiers (ZATCA / FTA /
 * Peppol), trade licenses with expiry tracking, bank accounts &
 * signatories, fiscal calendar, and inter-company / TP relationships.
 *
 * The shape mirrors what a real `atelier_finance_entities` table would
 * look like; per the task the surface is seed-data only (no GL software
 * integration, no live registry feeds). Surfaced via
 * `/api/atelier/finance/entities` (see `entitiesRoutes.ts`) and consumed
 * via the `useFinanceEntities` hook in `v5-hooks.ts`.
 */

export type EntityKind = "parent" | "subsidiary" | "branch" | "jv";
export type EntityStatus = "active" | "dormant" | "winding_down";
export type LicenseStatus = "active" | "expiring_soon" | "expired" | "renewal_in_progress";

export interface EInvoicingId {
  scheme: "ZATCA" | "FTA" | "Peppol" | "HMRC_MTD";
  id: string;
  status: "live" | "sandbox" | "pending";
  enrolledAt: string;
}

export interface TradeLicense {
  id: string;
  authority: string;
  number: string;
  issuedOn: string;
  expiresOn: string;
  status: LicenseStatus;
  scope: string;
}

export interface BankAccount {
  id: string;
  bank: string;
  iban: string;
  currency: string;
  purpose: "operating" | "tax" | "payroll" | "escrow";
  signatories: string[];
  primary: boolean;
}

export interface Signatory {
  id: string;
  name: string;
  role: string;
  authorityLevel: "A" | "B" | "C";
  resolutionRef: string | null;
}

export interface FiscalCalendar {
  yearEnd: string;
  vatPeriod: "monthly" | "quarterly";
  ctPeriod: "annual";
  nextClose: string;
  nextVatFiling: string;
  nextCtFiling: string;
}

export interface InterCompanyLink {
  counterpartyId: string;
  relationship: "subsidiary" | "branch" | "shareholder" | "service_provider";
  tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
  intercoServiceFeePct: number | null;
}

export interface FinanceEntity {
  id: string;
  legalName: string;
  shortName: string;
  kind: EntityKind;
  parentId: string | null;
  status: EntityStatus;
  country: "SA" | "AE" | "GB";
  jurisdiction: string;
  baseCurrency: "SAR" | "AED" | "GBP" | "USD";
  reportingCurrency: "USD";
  incorporatedOn: string;
  commercialRegistration: { number: string; authority: string; expiresOn: string };
  taxIds: { vat: string | null; corporate: string | null; whtAgent: string | null };
  eInvoicing: EInvoicingId[];
  tradeLicenses: TradeLicense[];
  bankAccounts: BankAccount[];
  signatories: Signatory[];
  fiscal: FiscalCalendar;
  interCompany: InterCompanyLink[];
  staffCount: number;
  notes: string;
}

const ENTITIES: FinanceEntity[] = [
  {
    id: "fe_aico_uk",
    legalName: "AICo Group Holdings Ltd",
    shortName: "AICo Group (UK)",
    kind: "parent",
    parentId: null,
    status: "active",
    country: "GB",
    jurisdiction: "England & Wales",
    baseCurrency: "GBP",
    reportingCurrency: "USD",
    incorporatedOn: "2022-03-14",
    commercialRegistration: { number: "14012987", authority: "Companies House", expiresOn: "—" },
    taxIds: { vat: "GB 412 6677 09", corporate: "UTR 8826541198", whtAgent: null },
    eInvoicing: [
      { scheme: "HMRC_MTD", id: "MTD-141200", status: "live", enrolledAt: "2022-04-01" },
      { scheme: "Peppol", id: "0192:14012987", status: "live", enrolledAt: "2024-01-12" },
    ],
    tradeLicenses: [],
    bankAccounts: [
      {
        id: "ba_aico_uk_op",
        bank: "Barclays Business",
        iban: "GB29 BARC 2006 0512 3456 78",
        currency: "GBP",
        purpose: "operating",
        signatories: ["sig_yara_n", "sig_omar_h"],
        primary: true,
      },
    ],
    signatories: [
      { id: "sig_yara_n", name: "Yara Nasser", role: "Founding Partner", authorityLevel: "A", resolutionRef: "BR-2022-001" },
      { id: "sig_omar_h", name: "Omar Habib", role: "Group Controller", authorityLevel: "B", resolutionRef: "BR-2024-007" },
    ],
    fiscal: {
      yearEnd: "Dec 31",
      vatPeriod: "quarterly",
      ctPeriod: "annual",
      nextClose: "2026-06-30",
      nextVatFiling: "2026-07-31",
      nextCtFiling: "2026-09-30",
    },
    interCompany: [
      { counterpartyId: "fe_aico_ksa", relationship: "subsidiary", tpMethod: "TNMM", intercoServiceFeePct: 0.07 },
      { counterpartyId: "fe_aico_uae", relationship: "subsidiary", tpMethod: "TNMM", intercoServiceFeePct: 0.07 },
    ],
    staffCount: 12,
    notes: "Top-co. Holds the trademarks and the Group's IP. Files consolidated accounts.",
  },
  {
    id: "fe_aico_ksa",
    legalName: "AICo for Information Technology Co.",
    shortName: "AICo KSA",
    kind: "subsidiary",
    parentId: "fe_aico_uk",
    status: "active",
    country: "SA",
    jurisdiction: "Riyadh, Kingdom of Saudi Arabia",
    baseCurrency: "SAR",
    reportingCurrency: "USD",
    incorporatedOn: "2023-01-22",
    commercialRegistration: { number: "1010 884 412", authority: "Ministry of Commerce (MoC)", expiresOn: "2026-12-31" },
    taxIds: { vat: "300 8841 2000 003", corporate: "TIN 8841 2000 0003", whtAgent: "WHT-KSA-8841" },
    eInvoicing: [
      { scheme: "ZATCA", id: "ZATCA-Phase2-300884120", status: "live", enrolledAt: "2024-01-01" },
    ],
    tradeLicenses: [
      {
        id: "lic_ksa_misa",
        authority: "MISA (Investment Licence)",
        number: "MISA-1010-7723",
        issuedOn: "2023-01-15",
        expiresOn: "2026-08-15",
        status: "expiring_soon",
        scope: "Foreign-investor IT services licence",
      },
      {
        id: "lic_ksa_zakat",
        authority: "ZATCA Registration",
        number: "ZK-300884120",
        issuedOn: "2023-02-01",
        expiresOn: "2027-02-01",
        status: "active",
        scope: "VAT + Zakat & corporate income tax registration",
      },
    ],
    bankAccounts: [
      {
        id: "ba_aico_ksa_op",
        bank: "Saudi National Bank (SNB)",
        iban: "SA03 8000 0000 6080 1016 7519",
        currency: "SAR",
        purpose: "operating",
        signatories: ["sig_yara_n", "sig_layla_m"],
        primary: true,
      },
      {
        id: "ba_aico_ksa_payroll",
        bank: "Riyad Bank",
        iban: "SA44 2000 0001 2345 6789 0123",
        currency: "SAR",
        purpose: "payroll",
        signatories: ["sig_layla_m"],
        primary: false,
      },
    ],
    signatories: [
      { id: "sig_layla_m", name: "Layla Al-Mutairi", role: "KSA Managing Partner", authorityLevel: "A", resolutionRef: "BR-KSA-2024-002" },
      { id: "sig_yara_n", name: "Yara Nasser", role: "Founding Partner", authorityLevel: "A", resolutionRef: "BR-KSA-2024-002" },
    ],
    fiscal: {
      yearEnd: "Dec 31",
      vatPeriod: "monthly",
      ctPeriod: "annual",
      nextClose: "2026-05-31",
      nextVatFiling: "2026-06-28",
      nextCtFiling: "2027-04-30",
    },
    interCompany: [
      { counterpartyId: "fe_aico_uk", relationship: "shareholder", tpMethod: "TNMM", intercoServiceFeePct: null },
      { counterpartyId: "fe_aico_uae", relationship: "service_provider", tpMethod: "Cost+", intercoServiceFeePct: 0.08 },
    ],
    staffCount: 38,
    notes: "Local Saudi LLC. ZATCA Phase-2 e-invoicing live since Jan 2024. MISA licence renewal Aug 2026 — owner: Layla.",
  },
  {
    id: "fe_aico_uae",
    legalName: "AICo Consulting (DIFC) Ltd",
    shortName: "AICo UAE (DIFC)",
    kind: "subsidiary",
    parentId: "fe_aico_uk",
    status: "active",
    country: "AE",
    jurisdiction: "Dubai International Financial Centre",
    baseCurrency: "AED",
    reportingCurrency: "USD",
    incorporatedOn: "2023-04-10",
    commercialRegistration: { number: "DIFC-7741", authority: "DIFC Registrar of Companies", expiresOn: "2026-04-10" },
    taxIds: { vat: "100 4188 7300 003", corporate: "CT-100418873", whtAgent: null },
    eInvoicing: [
      { scheme: "FTA", id: "FTA-100418873", status: "live", enrolledAt: "2024-06-01" },
      { scheme: "Peppol", id: "0184:DIFC7741", status: "sandbox", enrolledAt: "2025-09-15" },
    ],
    tradeLicenses: [
      {
        id: "lic_uae_difc",
        authority: "DIFC Authority",
        number: "DIFC-LIC-7741",
        issuedOn: "2023-04-10",
        expiresOn: "2026-04-10",
        status: "renewal_in_progress",
        scope: "Professional services / management consulting",
      },
      {
        id: "lic_uae_dataprot",
        authority: "DIFC Data Protection Commissioner",
        number: "DPC-2024-1188",
        issuedOn: "2024-02-01",
        expiresOn: "2027-02-01",
        status: "active",
        scope: "Notified data controller registration",
      },
    ],
    bankAccounts: [
      {
        id: "ba_aico_uae_op",
        bank: "Emirates NBD",
        iban: "AE07 0331 2345 6789 0123 456",
        currency: "AED",
        purpose: "operating",
        signatories: ["sig_yara_n", "sig_faisal_a"],
        primary: true,
      },
      {
        id: "ba_aico_uae_usd",
        bank: "HSBC UAE",
        iban: "AE54 0200 0000 7700 4188 730",
        currency: "USD",
        purpose: "operating",
        signatories: ["sig_faisal_a"],
        primary: false,
      },
    ],
    signatories: [
      { id: "sig_faisal_a", name: "Faisal Al-Suwaidi", role: "UAE Managing Partner", authorityLevel: "A", resolutionRef: "BR-UAE-2024-001" },
      { id: "sig_yara_n", name: "Yara Nasser", role: "Founding Partner", authorityLevel: "A", resolutionRef: "BR-UAE-2024-001" },
    ],
    fiscal: {
      yearEnd: "Dec 31",
      vatPeriod: "quarterly",
      ctPeriod: "annual",
      nextClose: "2026-06-30",
      nextVatFiling: "2026-07-28",
      nextCtFiling: "2026-09-30",
    },
    interCompany: [
      { counterpartyId: "fe_aico_uk", relationship: "shareholder", tpMethod: "TNMM", intercoServiceFeePct: null },
      { counterpartyId: "fe_aico_ksa", relationship: "service_provider", tpMethod: "Cost+", intercoServiceFeePct: 0.08 },
    ],
    staffCount: 24,
    notes: "DIFC entity. CT (UAE corporate-tax) registered. FTA e-invoicing live since June 2024.",
  },
  {
    id: "fe_aico_uae_branch",
    legalName: "AICo Consulting (DIFC) — Abu Dhabi Branch",
    shortName: "AICo AUH (Branch)",
    kind: "branch",
    parentId: "fe_aico_uae",
    status: "active",
    country: "AE",
    jurisdiction: "Abu Dhabi Global Market",
    baseCurrency: "AED",
    reportingCurrency: "USD",
    incorporatedOn: "2024-09-01",
    commercialRegistration: { number: "ADGM-BR-2241", authority: "ADGM Registration Authority", expiresOn: "2026-09-01" },
    taxIds: { vat: "100 4188 7300 003", corporate: "CT-100418873", whtAgent: null },
    eInvoicing: [
      { scheme: "FTA", id: "FTA-100418873-BR", status: "live", enrolledAt: "2024-09-15" },
    ],
    tradeLicenses: [
      {
        id: "lic_uae_adgm",
        authority: "ADGM Registration Authority",
        number: "ADGM-LIC-2241",
        issuedOn: "2024-09-01",
        expiresOn: "2025-12-31",
        status: "expiring_soon",
        scope: "Branch licence — management consulting",
      },
    ],
    bankAccounts: [
      {
        id: "ba_aico_auh_op",
        bank: "First Abu Dhabi Bank (FAB)",
        iban: "AE15 0350 0000 0022 4128 871",
        currency: "AED",
        purpose: "operating",
        signatories: ["sig_faisal_a"],
        primary: true,
      },
    ],
    signatories: [
      { id: "sig_faisal_a", name: "Faisal Al-Suwaidi", role: "UAE Managing Partner", authorityLevel: "A", resolutionRef: "BR-UAE-2024-008" },
    ],
    fiscal: {
      yearEnd: "Dec 31",
      vatPeriod: "quarterly",
      ctPeriod: "annual",
      nextClose: "2026-06-30",
      nextVatFiling: "2026-07-28",
      nextCtFiling: "2026-09-30",
    },
    interCompany: [
      { counterpartyId: "fe_aico_uae", relationship: "branch", tpMethod: "Cost+", intercoServiceFeePct: 0.05 },
    ],
    staffCount: 6,
    notes: "ADGM branch of the DIFC entity. Files consolidated CT return with parent. ADGM licence renewal due Dec 2025 — owner: Faisal.",
  },
  {
    id: "fe_aico_jv_neom",
    legalName: "AICo × NEOM Sector Lab JV",
    shortName: "AICo-NEOM JV",
    kind: "jv",
    parentId: null,
    status: "active",
    country: "SA",
    jurisdiction: "Tabuk, KSA",
    baseCurrency: "SAR",
    reportingCurrency: "USD",
    incorporatedOn: "2025-02-18",
    commercialRegistration: { number: "1011 998 332", authority: "Ministry of Commerce (MoC)", expiresOn: "2027-02-17" },
    taxIds: { vat: "311 0119 9800 003", corporate: "TIN 0119 9800 0003", whtAgent: "WHT-KSA-0119" },
    eInvoicing: [
      { scheme: "ZATCA", id: "ZATCA-Phase2-311011998", status: "pending", enrolledAt: "2025-12-01" },
    ],
    tradeLicenses: [
      {
        id: "lic_ksa_neom_jv",
        authority: "NEOM Authority",
        number: "NEOM-JV-2025-0044",
        issuedOn: "2025-02-18",
        expiresOn: "2027-02-17",
        status: "active",
        scope: "Joint-venture sector-lab — AI advisory & deployment within NEOM",
      },
    ],
    bankAccounts: [
      {
        id: "ba_jv_neom_escrow",
        bank: "Saudi National Bank (SNB)",
        iban: "SA60 8000 0301 6080 1016 7519",
        currency: "SAR",
        purpose: "escrow",
        signatories: ["sig_yara_n", "sig_layla_m", "sig_neom_rep"],
        primary: true,
      },
    ],
    signatories: [
      { id: "sig_neom_rep", name: "Khalid Al-Saud", role: "NEOM Authority Rep (JV Director)", authorityLevel: "A", resolutionRef: "JV-2025-001" },
      { id: "sig_yara_n", name: "Yara Nasser", role: "AICo JV Director", authorityLevel: "A", resolutionRef: "JV-2025-001" },
      { id: "sig_layla_m", name: "Layla Al-Mutairi", role: "AICo JV Director", authorityLevel: "B", resolutionRef: "JV-2025-001" },
    ],
    fiscal: {
      yearEnd: "Dec 31",
      vatPeriod: "monthly",
      ctPeriod: "annual",
      nextClose: "2026-05-31",
      nextVatFiling: "2026-06-28",
      nextCtFiling: "2027-04-30",
    },
    interCompany: [
      { counterpartyId: "fe_aico_ksa", relationship: "shareholder", tpMethod: "ResalePrice", intercoServiceFeePct: null },
    ],
    staffCount: 9,
    notes: "50/50 JV with NEOM Authority. ZATCA Phase-2 enrolment in flight (cutover Dec 2025). All disbursements require dual sign (1 AICo + 1 NEOM).",
  },
];

export function listFinanceEntities(): FinanceEntity[] {
  return ENTITIES;
}
