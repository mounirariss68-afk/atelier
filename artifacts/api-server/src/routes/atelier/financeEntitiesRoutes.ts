/**
 * Atelier — Finance Entities backbone read routes (Task #372).
 *
 * Demo-only seed data describing the legal-entity scaffold every CFO /
 * Controller surface needs (parent / sub / branch / JV records, CR
 * numbers, tax IDs, e-invoicing IDs, trade licenses with expiry, bank
 * accounts & signatories, fiscal calendar, inter-company / TP).
 *
 * The task is explicit that no real GL software / e-invoicing /
 * payment-run integrations are in scope, so the data is held in a TS
 * module rather than Postgres. Persona gating mirrors v5Routes:
 * recruiter is denied (it is /studio-only firm-wide).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { atelierUsers } from "@workspace/db";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({
      error: "recruiter-scope",
      message: "Recruiter persona may only access /studio surfaces.",
    });
    return true;
  }
  return false;
}

interface EInvoicingId {
  scheme: "ZATCA" | "FTA" | "Peppol" | "HMRC_MTD";
  id: string;
  status: "live" | "sandbox" | "pending";
  enrolledAt: string;
}
interface TradeLicense {
  id: string;
  authority: string;
  number: string;
  issuedOn: string;
  expiresOn: string;
  status: "active" | "expiring_soon" | "expired" | "renewal_in_progress";
  scope: string;
}
interface BankAccount {
  id: string;
  bank: string;
  iban: string;
  currency: string;
  purpose: "operating" | "tax" | "payroll" | "escrow";
  signatories: string[];
  primary: boolean;
}
interface Signatory {
  id: string;
  name: string;
  role: string;
  authorityLevel: "A" | "B" | "C";
  resolutionRef: string | null;
}
interface FiscalCalendar {
  yearEnd: string;
  vatPeriod: "monthly" | "quarterly";
  ctPeriod: "annual";
  nextClose: string;
  nextVatFiling: string;
  nextCtFiling: string;
}
interface InterCompanyLink {
  counterpartyId: string;
  relationship: "subsidiary" | "branch" | "shareholder" | "service_provider";
  tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
  intercoServiceFeePct: number | null;
}
interface FinanceEntity {
  id: string;
  legalName: string;
  shortName: string;
  kind: "parent" | "subsidiary" | "branch" | "jv";
  parentId: string | null;
  status: "active" | "dormant" | "winding_down";
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

export const ENTITIES_SEED: FinanceEntity[] = [
  {
    id: "fe_aico_uk",
    legalName: "Cognirise Group Holdings Ltd",
    shortName: "Cognirise Group (UK)",
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
      { id: "ba_aico_uk_op", bank: "Barclays Business", iban: "GB29 BARC 2006 0512 3456 78", currency: "GBP", purpose: "operating", signatories: ["sig_yara_n", "sig_omar_h"], primary: true },
    ],
    signatories: [
      { id: "sig_yara_n", name: "Yara Nasser", role: "Founding Partner", authorityLevel: "A", resolutionRef: "BR-2022-001" },
      { id: "sig_omar_h", name: "Omar Habib", role: "Group Controller", authorityLevel: "B", resolutionRef: "BR-2024-007" },
    ],
    fiscal: { yearEnd: "Dec 31", vatPeriod: "quarterly", ctPeriod: "annual", nextClose: "2026-06-30", nextVatFiling: "2026-07-31", nextCtFiling: "2026-09-30" },
    interCompany: [
      { counterpartyId: "fe_aico_ksa", relationship: "subsidiary", tpMethod: "TNMM", intercoServiceFeePct: 0.07 },
      { counterpartyId: "fe_aico_uae", relationship: "subsidiary", tpMethod: "TNMM", intercoServiceFeePct: 0.07 },
    ],
    staffCount: 12,
    notes: "Top-co. Holds the trademarks and the Group's IP. Files consolidated accounts.",
  },
  {
    id: "fe_aico_ksa",
    legalName: "Cognirise for Information Technology Co.",
    shortName: "Cognirise KSA",
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
    eInvoicing: [{ scheme: "ZATCA", id: "ZATCA-Phase2-300884120", status: "live", enrolledAt: "2024-01-01" }],
    tradeLicenses: [
      { id: "lic_ksa_misa", authority: "MISA (Investment Licence)", number: "MISA-1010-7723", issuedOn: "2023-01-15", expiresOn: "2026-08-15", status: "expiring_soon", scope: "Foreign-investor IT services licence" },
      { id: "lic_ksa_zakat", authority: "ZATCA Registration", number: "ZK-300884120", issuedOn: "2023-02-01", expiresOn: "2027-02-01", status: "active", scope: "VAT + Zakat & corporate income tax registration" },
    ],
    bankAccounts: [
      { id: "ba_aico_ksa_op", bank: "Saudi National Bank (SNB)", iban: "SA03 8000 0000 6080 1016 7519", currency: "SAR", purpose: "operating", signatories: ["sig_yara_n", "sig_layla_m"], primary: true },
      { id: "ba_aico_ksa_payroll", bank: "Riyad Bank", iban: "SA44 2000 0001 2345 6789 0123", currency: "SAR", purpose: "payroll", signatories: ["sig_layla_m"], primary: false },
    ],
    signatories: [
      { id: "sig_layla_m", name: "Layla Al-Mutairi", role: "KSA Managing Partner", authorityLevel: "A", resolutionRef: "BR-KSA-2024-002" },
      { id: "sig_yara_n", name: "Yara Nasser", role: "Founding Partner", authorityLevel: "A", resolutionRef: "BR-KSA-2024-002" },
    ],
    fiscal: { yearEnd: "Dec 31", vatPeriod: "monthly", ctPeriod: "annual", nextClose: "2026-05-31", nextVatFiling: "2026-06-28", nextCtFiling: "2027-04-30" },
    interCompany: [
      { counterpartyId: "fe_aico_uk", relationship: "shareholder", tpMethod: "TNMM", intercoServiceFeePct: null },
      { counterpartyId: "fe_aico_uae", relationship: "service_provider", tpMethod: "Cost+", intercoServiceFeePct: 0.08 },
    ],
    staffCount: 38,
    notes: "Local Saudi LLC. ZATCA Phase-2 e-invoicing live since Jan 2024. MISA licence renewal Aug 2026 — owner: Layla.",
  },
  {
    id: "fe_aico_uae",
    legalName: "Cognirise Consulting (DIFC) Ltd",
    shortName: "Cognirise UAE (DIFC)",
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
      { id: "lic_uae_difc", authority: "DIFC Authority", number: "DIFC-LIC-7741", issuedOn: "2023-04-10", expiresOn: "2026-04-10", status: "renewal_in_progress", scope: "Professional services / management consulting" },
      { id: "lic_uae_dataprot", authority: "DIFC Data Protection Commissioner", number: "DPC-2024-1188", issuedOn: "2024-02-01", expiresOn: "2027-02-01", status: "active", scope: "Notified data controller registration" },
    ],
    bankAccounts: [
      { id: "ba_aico_uae_op", bank: "Emirates NBD", iban: "AE07 0331 2345 6789 0123 456", currency: "AED", purpose: "operating", signatories: ["sig_yara_n", "sig_faisal_a"], primary: true },
      { id: "ba_aico_uae_usd", bank: "HSBC UAE", iban: "AE54 0200 0000 7700 4188 730", currency: "USD", purpose: "operating", signatories: ["sig_faisal_a"], primary: false },
    ],
    signatories: [
      { id: "sig_faisal_a", name: "Faisal Al-Suwaidi", role: "UAE Managing Partner", authorityLevel: "A", resolutionRef: "BR-UAE-2024-001" },
      { id: "sig_yara_n", name: "Yara Nasser", role: "Founding Partner", authorityLevel: "A", resolutionRef: "BR-UAE-2024-001" },
    ],
    fiscal: { yearEnd: "Dec 31", vatPeriod: "quarterly", ctPeriod: "annual", nextClose: "2026-06-30", nextVatFiling: "2026-07-28", nextCtFiling: "2026-09-30" },
    interCompany: [
      { counterpartyId: "fe_aico_uk", relationship: "shareholder", tpMethod: "TNMM", intercoServiceFeePct: null },
      { counterpartyId: "fe_aico_ksa", relationship: "service_provider", tpMethod: "Cost+", intercoServiceFeePct: 0.08 },
    ],
    staffCount: 24,
    notes: "DIFC entity. CT (UAE corporate-tax) registered. FTA e-invoicing live since June 2024.",
  },
  {
    id: "fe_aico_uae_branch",
    legalName: "Cognirise Consulting (DIFC) — Abu Dhabi Branch",
    shortName: "Cognirise AUH (Branch)",
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
    eInvoicing: [{ scheme: "FTA", id: "FTA-100418873-BR", status: "live", enrolledAt: "2024-09-15" }],
    tradeLicenses: [
      { id: "lic_uae_adgm", authority: "ADGM Registration Authority", number: "ADGM-LIC-2241", issuedOn: "2024-09-01", expiresOn: "2025-12-31", status: "expiring_soon", scope: "Branch licence — management consulting" },
    ],
    bankAccounts: [
      { id: "ba_aico_auh_op", bank: "First Abu Dhabi Bank (FAB)", iban: "AE15 0350 0000 0022 4128 871", currency: "AED", purpose: "operating", signatories: ["sig_faisal_a"], primary: true },
    ],
    signatories: [
      { id: "sig_faisal_a", name: "Faisal Al-Suwaidi", role: "UAE Managing Partner", authorityLevel: "A", resolutionRef: "BR-UAE-2024-008" },
    ],
    fiscal: { yearEnd: "Dec 31", vatPeriod: "quarterly", ctPeriod: "annual", nextClose: "2026-06-30", nextVatFiling: "2026-07-28", nextCtFiling: "2026-09-30" },
    interCompany: [{ counterpartyId: "fe_aico_uae", relationship: "branch", tpMethod: "Cost+", intercoServiceFeePct: 0.05 }],
    staffCount: 6,
    notes: "ADGM branch of the DIFC entity. Files consolidated CT return with parent. ADGM licence renewal due Dec 2025 — owner: Faisal.",
  },
  {
    id: "fe_aico_jv_neom",
    legalName: "Cognirise × NEOM Sector Lab JV",
    shortName: "Cognirise-NEOM JV",
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
    eInvoicing: [{ scheme: "ZATCA", id: "ZATCA-Phase2-311011998", status: "pending", enrolledAt: "2025-12-01" }],
    tradeLicenses: [
      { id: "lic_ksa_neom_jv", authority: "NEOM Authority", number: "NEOM-JV-2025-0044", issuedOn: "2025-02-18", expiresOn: "2027-02-17", status: "active", scope: "Joint-venture sector-lab — AI advisory & deployment within NEOM" },
    ],
    bankAccounts: [
      { id: "ba_jv_neom_escrow", bank: "Saudi National Bank (SNB)", iban: "SA60 8000 0301 6080 1016 7519", currency: "SAR", purpose: "escrow", signatories: ["sig_yara_n", "sig_layla_m", "sig_neom_rep"], primary: true },
    ],
    signatories: [
      { id: "sig_neom_rep", name: "Khalid Al-Saud", role: "NEOM Authority Rep (JV Director)", authorityLevel: "A", resolutionRef: "JV-2025-001" },
      { id: "sig_yara_n", name: "Yara Nasser", role: "Cognirise JV Director", authorityLevel: "A", resolutionRef: "JV-2025-001" },
      { id: "sig_layla_m", name: "Layla Al-Mutairi", role: "Cognirise JV Director", authorityLevel: "B", resolutionRef: "JV-2025-001" },
    ],
    fiscal: { yearEnd: "Dec 31", vatPeriod: "monthly", ctPeriod: "annual", nextClose: "2026-05-31", nextVatFiling: "2026-06-28", nextCtFiling: "2027-04-30" },
    interCompany: [{ counterpartyId: "fe_aico_ksa", relationship: "shareholder", tpMethod: "ResalePrice", intercoServiceFeePct: null }],
    staffCount: 9,
    notes: "50/50 JV with NEOM Authority. ZATCA Phase-2 enrolment in flight (cutover Dec 2025). All disbursements require dual sign (1 Cognirise + 1 NEOM).",
  },
];

router.get("/finance/entities", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  res.json({ items: ENTITIES_SEED });
});

router.get("/finance/entities/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const row = ENTITIES_SEED.find((e) => e.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not-found" });
  res.json({ entity: row });
});

export default router;
