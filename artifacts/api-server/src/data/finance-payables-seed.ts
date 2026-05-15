/**
 * Finance Payables (P2P) — demo seed (Task #418, Wave 6).
 *
 * Seed-only data for the procure-to-pay hardening: vendor master with
 * KYC / beneficial-ownership / sanctions-screen / bank-detail change
 * controls, purchase orders + lines + GRNs, vendor invoices with the
 * 3-way match outcome, payment runs with maker-checker + dual-signatory
 * enforcement, WHT register, and subcontractor pay-when-paid links.
 *
 * The data is held in this TS module rather than Postgres because the
 * task is explicitly scoped seed-only — no real GL / e-invoicing /
 * payment-rail integration. Surfaced via
 * `/api/atelier/finance/payables/*` (see `financePayablesRoutes.ts`)
 * and consumed via the `useFinancePayables*` hooks.
 *
 * Entity / signatory IDs reference `finance-entities-seed.ts`.
 */

// ============================================================
// Vendors
// ============================================================
export type VendorCategory =
  | "professional_services"
  | "subcontractor"
  | "saas_cloud"
  | "travel_hospitality"
  | "office_facilities"
  | "marketing"
  | "other";

export type SanctionsResult = "clear" | "match_review" | "blocked";

export interface BeneficialOwner {
  id: string;
  name: string;
  pctOwnership: number;
  nationality: string;
  isPep: boolean;
}

export interface VendorBankAccount {
  id: string;
  bank: string;
  iban: string;
  swift: string;
  currency: string;
  accountHolder: string;
  primary: boolean;
  /** Pending change requests for this account (maker-checker). */
  pendingChange?: BankChangeRequest | null;
}

export interface BankChangeRequest {
  id: string;
  fieldChanged: "iban" | "swift" | "bank" | "accountHolder";
  oldValue: string;
  newValue: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  oobConfirmation: {
    method: "phone_callback" | "in_person" | "verified_email";
    contactName: string;
    contactNumber: string | null;
    confirmedAt: string | null;
    confirmedBy: string | null;
  };
  status: "pending_oob" | "pending_checker" | "approved" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
}

export interface Vendor {
  id: string;
  legalName: string;
  shortName: string;
  category: VendorCategory;
  /** Subcontractor flag triggers pay-when-paid logic at payment-run time. */
  isSubcontractor: boolean;
  jurisdiction: string;
  country: "SA" | "AE" | "GB" | "US" | "FR" | "IN" | "DE";
  registeredEntityId: string; // FK -> finance entity (legalName)
  taxIds: { vat: string | null; corporate: string | null; whtRegistered: boolean };
  /** Default WHT rate the AICo entity withholds at payment, by jurisdiction. */
  defaultWhtPct: number;
  paymentTermsDays: number;
  beneficialOwners: BeneficialOwner[];
  sanctions: {
    lastCheckedAt: string;
    result: SanctionsResult;
    list: "OFAC" | "UN" | "EU" | "UK_HMT" | "consolidated";
    notes: string | null;
  };
  bankAccounts: VendorBankAccount[];
  primaryContact: { name: string; email: string; phone: string };
  /** Pay-against AICo entity (used for invoice-side & payment-run currency). */
  payAgainstEntityIds: string[];
  status: "active" | "on_hold" | "blocked";
  onboardedAt: string;
  notes: string;
}

const VENDORS: Vendor[] = [
  {
    id: "vnd_oracle_me",
    legalName: "Oracle Systems Limited (DIFC)",
    shortName: "Oracle ME",
    category: "saas_cloud",
    isSubcontractor: false,
    jurisdiction: "DIFC, Dubai, UAE",
    country: "AE",
    registeredEntityId: "DIFC-LLC-22871",
    taxIds: { vat: "100 2287 1300 003", corporate: "CT-100228713", whtRegistered: false },
    defaultWhtPct: 0,
    paymentTermsDays: 30,
    beneficialOwners: [
      { id: "bo_orcl_1", name: "Oracle Corporation (US-listed)", pctOwnership: 100, nationality: "US", isPep: false },
    ],
    sanctions: { lastCheckedAt: "2026-04-12", result: "clear", list: "consolidated", notes: null },
    bankAccounts: [
      { id: "vba_orcl_aed", bank: "Emirates NBD", iban: "AE91 0260 0001 0228 7130 003", swift: "EBILAEAD", currency: "AED", accountHolder: "Oracle Systems Limited", primary: true, pendingChange: null },
    ],
    primaryContact: { name: "Hadi Younes", email: "h.younes@oracle.com", phone: "+971 4 390 9000" },
    payAgainstEntityIds: ["fe_aico_uae", "fe_aico_uae_branch"],
    status: "active",
    onboardedAt: "2024-02-11",
    notes: "OCI cloud + DB licences. Auto-renewing annual contract; renewal Feb 2026.",
  },
  {
    id: "vnd_pwc_me",
    legalName: "PricewaterhouseCoopers Middle East",
    shortName: "PwC ME",
    category: "professional_services",
    isSubcontractor: false,
    jurisdiction: "DIFC, Dubai, UAE",
    country: "AE",
    registeredEntityId: "DIFC-LLP-1192",
    taxIds: { vat: "100 1192 0700 003", corporate: "CT-100119207", whtRegistered: true },
    defaultWhtPct: 0,
    paymentTermsDays: 30,
    beneficialOwners: [
      { id: "bo_pwc_1", name: "PwC Global Network (partner-owned)", pctOwnership: 100, nationality: "GB", isPep: false },
    ],
    sanctions: { lastCheckedAt: "2026-03-30", result: "clear", list: "OFAC", notes: null },
    bankAccounts: [
      { id: "vba_pwc_aed", bank: "HSBC UAE", iban: "AE54 0200 0000 9911 9207 010", swift: "BBMEAEAD", currency: "AED", accountHolder: "PricewaterhouseCoopers Middle East", primary: true, pendingChange: null },
    ],
    primaryContact: { name: "Reem Al-Tamimi", email: "reem.altamimi@pwc.com", phone: "+971 4 304 3100" },
    payAgainstEntityIds: ["fe_aico_uk", "fe_aico_uae"],
    status: "active",
    onboardedAt: "2023-09-01",
    notes: "Group statutory audit. Engagement letter renewed annually.",
  },
  {
    id: "vnd_aws_inc",
    legalName: "Amazon Web Services EMEA SARL",
    shortName: "AWS EMEA",
    category: "saas_cloud",
    isSubcontractor: false,
    jurisdiction: "Luxembourg",
    country: "DE",
    registeredEntityId: "LU-B186284",
    taxIds: { vat: "LU 26888617", corporate: "LU-B186284", whtRegistered: false },
    defaultWhtPct: 0,
    paymentTermsDays: 30,
    beneficialOwners: [
      { id: "bo_aws_1", name: "Amazon.com Inc (US-listed)", pctOwnership: 100, nationality: "US", isPep: false },
    ],
    sanctions: { lastCheckedAt: "2026-05-01", result: "clear", list: "consolidated", notes: null },
    bankAccounts: [
      { id: "vba_aws_eur", bank: "JPMorgan Luxembourg", iban: "LU14 0019 4006 4475 0000", swift: "CHASLULL", currency: "EUR", accountHolder: "Amazon Web Services EMEA SARL", primary: true, pendingChange: null },
    ],
    primaryContact: { name: "AWS Billing", email: "aws-billing@amazon.com", phone: "+352 2789 0000" },
    payAgainstEntityIds: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
    status: "active",
    onboardedAt: "2023-06-01",
    notes: "Consolidated billing across all three AICo entities; per-entity tax invoices.",
  },
  {
    id: "vnd_zenith_eng",
    legalName: "Zenith Engineering Consultants Co.",
    shortName: "Zenith Eng (KSA)",
    category: "subcontractor",
    isSubcontractor: true,
    jurisdiction: "Riyadh, KSA",
    country: "SA",
    registeredEntityId: "1010-998-441",
    taxIds: { vat: "311 0998 4410 003", corporate: "TIN 0998 4410", whtRegistered: true },
    defaultWhtPct: 0.05,
    paymentTermsDays: 45,
    beneficialOwners: [
      { id: "bo_zen_1", name: "Khaled Al-Otaibi", pctOwnership: 60, nationality: "SA", isPep: false },
      { id: "bo_zen_2", name: "Bandar Al-Otaibi", pctOwnership: 40, nationality: "SA", isPep: false },
    ],
    sanctions: { lastCheckedAt: "2026-04-22", result: "clear", list: "UN", notes: null },
    bankAccounts: [
      { id: "vba_zen_sar", bank: "Al Rajhi Bank", iban: "SA88 8000 0998 4410 0030 003", swift: "RJHISARI", currency: "SAR", accountHolder: "Zenith Engineering Consultants Co.", primary: true, pendingChange: null },
    ],
    primaryContact: { name: "Khaled Al-Otaibi", email: "khaled@zenith-eng.sa", phone: "+966 11 482 0011" },
    payAgainstEntityIds: ["fe_aico_ksa", "fe_aico_jv_neom"],
    status: "active",
    onboardedAt: "2024-08-19",
    notes: "Engineering subcontractor; pay-when-paid against linked engagements.",
  },
  {
    id: "vnd_helios_design",
    legalName: "Helios Design Partners LLP",
    shortName: "Helios Design",
    category: "subcontractor",
    isSubcontractor: true,
    jurisdiction: "London, UK",
    country: "GB",
    registeredEntityId: "OC419223",
    taxIds: { vat: "GB 318 4422 17", corporate: "UTR 4192231100", whtRegistered: true },
    defaultWhtPct: 0,
    paymentTermsDays: 30,
    beneficialOwners: [
      { id: "bo_hel_1", name: "Sophie Marsden", pctOwnership: 55, nationality: "GB", isPep: false },
      { id: "bo_hel_2", name: "Daniel Wright", pctOwnership: 45, nationality: "GB", isPep: false },
    ],
    sanctions: { lastCheckedAt: "2026-04-04", result: "clear", list: "UK_HMT", notes: null },
    bankAccounts: [
      {
        id: "vba_hel_gbp",
        bank: "NatWest Business",
        iban: "GB74 NWBK 6000 1419 2231 00",
        swift: "NWBKGB2L",
        currency: "GBP",
        accountHolder: "Helios Design Partners LLP",
        primary: true,
        pendingChange: {
          id: "bcr_hel_1",
          fieldChanged: "iban",
          oldValue: "GB74 NWBK 6000 1419 2231 00",
          newValue: "GB31 BARC 2000 0014 1922 31",
          requestedBy: "Sophie Marsden (vendor)",
          requestedAt: "2026-05-08",
          reason: "Switching banking from NatWest to Barclays.",
          oobConfirmation: {
            method: "phone_callback",
            contactName: "Sophie Marsden",
            contactNumber: "+44 20 7946 0212",
            confirmedAt: "2026-05-09",
            confirmedBy: "Omar Habib",
          },
          status: "pending_checker",
          approvedBy: null,
          approvedAt: null,
          rejectedReason: null,
        },
      },
    ],
    primaryContact: { name: "Sophie Marsden", email: "sophie@helios-design.co.uk", phone: "+44 20 7946 0212" },
    payAgainstEntityIds: ["fe_aico_uk"],
    status: "active",
    onboardedAt: "2024-03-12",
    notes: "Bank-change request awaiting checker approval — IBAN switch from NatWest to Barclays.",
  },
  {
    id: "vnd_skyline_logistics",
    legalName: "Skyline Logistics FZ-LLC",
    shortName: "Skyline Log",
    category: "office_facilities",
    isSubcontractor: false,
    jurisdiction: "JAFZA, Dubai",
    country: "AE",
    registeredEntityId: "JAFZA-77441",
    taxIds: { vat: "100 7744 1900 003", corporate: null, whtRegistered: false },
    defaultWhtPct: 0,
    paymentTermsDays: 60,
    beneficialOwners: [
      { id: "bo_sky_1", name: "Tariq Hassan", pctOwnership: 100, nationality: "PK", isPep: false },
    ],
    sanctions: {
      lastCheckedAt: "2026-04-18",
      result: "match_review",
      list: "OFAC",
      notes: "Beneficial owner name matched a low-confidence OFAC alias; flagged for compliance review.",
    },
    bankAccounts: [
      { id: "vba_sky_aed", bank: "Mashreq Bank", iban: "AE45 0330 0000 7744 1900 003", swift: "BOMLAEAD", currency: "AED", accountHolder: "Skyline Logistics FZ-LLC", primary: true, pendingChange: null },
    ],
    primaryContact: { name: "Tariq Hassan", email: "tariq@skylinelogistics.ae", phone: "+971 4 881 7700" },
    payAgainstEntityIds: ["fe_aico_uae"],
    status: "on_hold",
    onboardedAt: "2025-01-22",
    notes: "On hold pending OFAC alias review (compliance owns).",
  },
  {
    id: "vnd_dataforge",
    legalName: "DataForge Analytics India Pvt Ltd",
    shortName: "DataForge IN",
    category: "subcontractor",
    isSubcontractor: true,
    jurisdiction: "Bengaluru, India",
    country: "IN",
    registeredEntityId: "U72200KA2021PTC149887",
    taxIds: { vat: "29AABCD1234E1Z5", corporate: "PAN AABCD1234E", whtRegistered: true },
    defaultWhtPct: 0.10,
    paymentTermsDays: 45,
    beneficialOwners: [
      { id: "bo_df_1", name: "Priya Raghavan", pctOwnership: 70, nationality: "IN", isPep: false },
      { id: "bo_df_2", name: "Anil Mehta", pctOwnership: 30, nationality: "IN", isPep: false },
    ],
    sanctions: { lastCheckedAt: "2026-04-29", result: "clear", list: "consolidated", notes: null },
    bankAccounts: [
      { id: "vba_df_inr", bank: "HDFC Bank", iban: "HDFC0001234567890123", swift: "HDFCINBB", currency: "INR", accountHolder: "DataForge Analytics India Pvt Ltd", primary: true, pendingChange: null },
    ],
    primaryContact: { name: "Priya Raghavan", email: "priya@dataforge.in", phone: "+91 80 4123 5500" },
    payAgainstEntityIds: ["fe_aico_uk", "fe_aico_ksa"],
    status: "active",
    onboardedAt: "2024-11-04",
    notes: "Data engineering subcontractor. India 10% WHT (services).",
  },
];

// ============================================================
// Subcontractor links (engagement + milestone)
// ============================================================
export interface SubcontractorLink {
  id: string;
  vendorId: string;
  engagementId: string;
  engagementName: string;
  milestoneId: string;
  milestoneLabel: string;
  scope: string;
  ratePerDayUsd: number;
  /** Pay-when-paid: payment held until this client AR receipt is recorded. */
  payWhenPaidArInvoiceId: string;
  arReceiptStatus: "open" | "received" | "partial";
  arReceivedAt: string | null;
}

const SUBCONTRACTOR_LINKS: SubcontractorLink[] = [
  {
    id: "scl_zen_neom_1",
    vendorId: "vnd_zenith_eng",
    engagementId: "eng_neom_grid_phase2",
    engagementName: "NEOM Grid Optimization — Phase 2",
    milestoneId: "ms_neom_grid_p2_design",
    milestoneLabel: "Detailed Design Sign-off",
    scope: "Substation civils detailed design + load-flow modelling.",
    ratePerDayUsd: 1450,
    payWhenPaidArInvoiceId: "ar_inv_neom_p2_002",
    arReceiptStatus: "open",
    arReceivedAt: null,
  },
  {
    id: "scl_zen_neom_2",
    vendorId: "vnd_zenith_eng",
    engagementId: "eng_neom_grid_phase2",
    engagementName: "NEOM Grid Optimization — Phase 2",
    milestoneId: "ms_neom_grid_p2_construct",
    milestoneLabel: "Construction Drawings Issued",
    scope: "Issued-for-construction drawings package.",
    ratePerDayUsd: 1450,
    payWhenPaidArInvoiceId: "ar_inv_neom_p2_003",
    arReceiptStatus: "open",
    arReceivedAt: null,
  },
  {
    id: "scl_helios_pif",
    vendorId: "vnd_helios_design",
    engagementId: "eng_pif_brand_refresh",
    engagementName: "PIF Portfolio Co. Brand Refresh",
    milestoneId: "ms_pif_visual_system",
    milestoneLabel: "Visual System Approved",
    scope: "Visual identity system + brand guidelines book.",
    ratePerDayUsd: 1100,
    payWhenPaidArInvoiceId: "ar_inv_pif_002",
    arReceiptStatus: "received",
    arReceivedAt: "2026-04-29",
  },
  {
    id: "scl_dataforge_aramco",
    vendorId: "vnd_dataforge",
    engagementId: "eng_aramco_predictive_maint",
    engagementName: "Aramco Predictive Maintenance Pilot",
    milestoneId: "ms_aramco_pm_modeling",
    milestoneLabel: "Model Training Complete",
    scope: "Vibration-data feature engineering + model training.",
    ratePerDayUsd: 720,
    payWhenPaidArInvoiceId: "ar_inv_aramco_pm_002",
    arReceiptStatus: "open",
    arReceivedAt: null,
  },
];

// ============================================================
// Purchase orders (header + lines + GRN linkage)
// ============================================================
export type PoStatus = "draft" | "approved" | "open" | "partially_received" | "received" | "closed" | "cancelled";

export interface PoLine {
  id: string;
  description: string;
  quantity: number;
  uom: string;
  unitPriceUsd: number;
  receivedQuantity: number;
  invoicedQuantity: number;
}

export interface GoodsReceipt {
  id: string;
  receivedAt: string;
  receivedBy: string;
  lines: Array<{ poLineId: string; quantity: number }>;
  notes: string | null;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  vendorId: string;
  buyerEntityId: string;
  currency: "USD" | "AED" | "SAR" | "GBP" | "EUR" | "INR";
  /** Aggregate line total in USD (helper for the UI). */
  totalUsd: number;
  status: PoStatus;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Optional engagement link — required for subcontractor POs. */
  engagementId: string | null;
  engagementName: string | null;
  description: string;
  lines: PoLine[];
  goodsReceipts: GoodsReceipt[];
  /** Linked vendor invoices (drives 3-way match). */
  invoiceIds: string[];
  expectedReceiptDate: string;
}

const PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: "po_001",
    number: "PO-2026-0142",
    vendorId: "vnd_oracle_me",
    buyerEntityId: "fe_aico_uae",
    currency: "USD",
    totalUsd: 84_000,
    status: "received",
    createdBy: "Omar Habib",
    createdAt: "2026-02-02",
    approvedBy: "Faisal Al-Suwaidi",
    approvedAt: "2026-02-04",
    engagementId: null,
    engagementName: null,
    description: "Oracle OCI compute + autonomous DB — annual subscription FY26.",
    lines: [
      { id: "pol_001a", description: "OCI Compute (annual)", quantity: 1, uom: "subscription", unitPriceUsd: 48_000, receivedQuantity: 1, invoicedQuantity: 1 },
      { id: "pol_001b", description: "Autonomous DB (annual)", quantity: 1, uom: "subscription", unitPriceUsd: 36_000, receivedQuantity: 1, invoicedQuantity: 1 },
    ],
    goodsReceipts: [
      { id: "grn_001", receivedAt: "2026-02-15", receivedBy: "Omar Habib", lines: [{ poLineId: "pol_001a", quantity: 1 }, { poLineId: "pol_001b", quantity: 1 }], notes: "Subscription activated." },
    ],
    invoiceIds: ["vinv_001"],
    expectedReceiptDate: "2026-02-15",
  },
  {
    id: "po_002",
    number: "PO-2026-0188",
    vendorId: "vnd_zenith_eng",
    buyerEntityId: "fe_aico_jv_neom",
    currency: "SAR",
    totalUsd: 187_500,
    status: "partially_received",
    createdBy: "Layla Al-Mutairi",
    createdAt: "2026-03-08",
    approvedBy: "Yara Nasser",
    approvedAt: "2026-03-10",
    engagementId: "eng_neom_grid_phase2",
    engagementName: "NEOM Grid Optimization — Phase 2",
    description: "Zenith — substation civils detailed design (Phase 2).",
    lines: [
      { id: "pol_002a", description: "Senior engineer days", quantity: 60, uom: "days", unitPriceUsd: 1_450, receivedQuantity: 38, invoicedQuantity: 38 },
      { id: "pol_002b", description: "CAD drafter days", quantity: 80, uom: "days", unitPriceUsd: 1_250, receivedQuantity: 50, invoicedQuantity: 50 },
    ],
    goodsReceipts: [
      { id: "grn_002a", receivedAt: "2026-04-10", receivedBy: "Layla Al-Mutairi", lines: [{ poLineId: "pol_002a", quantity: 18 }, { poLineId: "pol_002b", quantity: 24 }], notes: "Mid-month progress." },
      { id: "grn_002b", receivedAt: "2026-05-02", receivedBy: "Layla Al-Mutairi", lines: [{ poLineId: "pol_002a", quantity: 20 }, { poLineId: "pol_002b", quantity: 26 }], notes: "April delivery." },
    ],
    invoiceIds: ["vinv_002", "vinv_003"],
    expectedReceiptDate: "2026-06-30",
  },
  {
    id: "po_003",
    number: "PO-2026-0211",
    vendorId: "vnd_aws_inc",
    buyerEntityId: "fe_aico_uk",
    currency: "USD",
    totalUsd: 24_000,
    status: "open",
    createdBy: "Omar Habib",
    createdAt: "2026-04-01",
    approvedBy: "Yara Nasser",
    approvedAt: "2026-04-02",
    engagementId: null,
    engagementName: null,
    description: "AWS — committed-spend (Q2 2026).",
    lines: [
      { id: "pol_003a", description: "EC2 + S3 + RDS committed spend", quantity: 3, uom: "month", unitPriceUsd: 8_000, receivedQuantity: 2, invoicedQuantity: 2 },
    ],
    goodsReceipts: [
      { id: "grn_003a", receivedAt: "2026-04-30", receivedBy: "Omar Habib", lines: [{ poLineId: "pol_003a", quantity: 1 }], notes: "April usage accepted." },
      { id: "grn_003b", receivedAt: "2026-05-31", receivedBy: "Omar Habib", lines: [{ poLineId: "pol_003a", quantity: 1 }], notes: "May usage accepted." },
    ],
    invoiceIds: ["vinv_004", "vinv_005"],
    expectedReceiptDate: "2026-06-30",
  },
  {
    id: "po_004",
    number: "PO-2026-0233",
    vendorId: "vnd_helios_design",
    buyerEntityId: "fe_aico_uk",
    currency: "GBP",
    totalUsd: 88_000,
    status: "received",
    createdBy: "Yara Nasser",
    createdAt: "2026-03-22",
    approvedBy: "Yara Nasser",
    approvedAt: "2026-03-22",
    engagementId: "eng_pif_brand_refresh",
    engagementName: "PIF Portfolio Co. Brand Refresh",
    description: "Helios — visual system & guidelines book.",
    lines: [
      { id: "pol_004a", description: "Senior designer days", quantity: 40, uom: "days", unitPriceUsd: 1_400, receivedQuantity: 40, invoicedQuantity: 40 },
      { id: "pol_004b", description: "Brand-book production", quantity: 1, uom: "deliverable", unitPriceUsd: 32_000, receivedQuantity: 1, invoicedQuantity: 1 },
    ],
    goodsReceipts: [
      { id: "grn_004", receivedAt: "2026-04-25", receivedBy: "Yara Nasser", lines: [{ poLineId: "pol_004a", quantity: 40 }, { poLineId: "pol_004b", quantity: 1 }], notes: "Visual system signed off by client." },
    ],
    invoiceIds: ["vinv_006"],
    expectedReceiptDate: "2026-04-30",
  },
  {
    id: "po_005",
    number: "PO-2026-0249",
    vendorId: "vnd_pwc_me",
    buyerEntityId: "fe_aico_uk",
    currency: "GBP",
    totalUsd: 145_000,
    status: "approved",
    createdBy: "Omar Habib",
    createdAt: "2026-04-15",
    approvedBy: "Yara Nasser",
    approvedAt: "2026-04-18",
    engagementId: null,
    engagementName: null,
    description: "FY26 group statutory audit — engagement letter.",
    lines: [
      { id: "pol_005a", description: "Group audit fee (FY26)", quantity: 1, uom: "engagement", unitPriceUsd: 145_000, receivedQuantity: 0, invoicedQuantity: 0 },
    ],
    goodsReceipts: [],
    invoiceIds: [],
    expectedReceiptDate: "2026-09-30",
  },
  {
    id: "po_006",
    number: "PO-2026-0256",
    vendorId: "vnd_dataforge",
    buyerEntityId: "fe_aico_ksa",
    currency: "USD",
    totalUsd: 36_000,
    status: "partially_received",
    createdBy: "Layla Al-Mutairi",
    createdAt: "2026-04-20",
    approvedBy: "Layla Al-Mutairi",
    approvedAt: "2026-04-20",
    engagementId: "eng_aramco_predictive_maint",
    engagementName: "Aramco Predictive Maintenance Pilot",
    description: "DataForge — model training + feature engineering sprint.",
    lines: [
      { id: "pol_006a", description: "Data engineer days", quantity: 50, uom: "days", unitPriceUsd: 720, receivedQuantity: 32, invoicedQuantity: 32 },
    ],
    goodsReceipts: [
      { id: "grn_006a", receivedAt: "2026-05-08", receivedBy: "Layla Al-Mutairi", lines: [{ poLineId: "pol_006a", quantity: 32 }], notes: "Feature engineering accepted." },
    ],
    invoiceIds: ["vinv_007"],
    expectedReceiptDate: "2026-06-15",
  },
];

// ============================================================
// Vendor invoices (with 3-way match outcome)
// ============================================================
export type InvoiceStatus =
  | "received"
  | "matched"
  | "exception"
  | "approved_for_payment"
  | "scheduled"
  | "paid"
  | "rejected"
  | "on_hold_pwp"; // pay-when-paid hold

export type MatchOutcome = "match" | "qty_mismatch" | "price_mismatch" | "no_grn" | "no_po" | "tolerance_override";

export interface VendorInvoice {
  id: string;
  number: string;
  vendorId: string;
  buyerEntityId: string;
  poId: string | null;
  currency: string;
  amount: number;
  amountUsd: number;
  whtPct: number;
  whtAmountUsd: number;
  netPayableUsd: number;
  invoiceDate: string;
  dueDate: string;
  receivedAt: string;
  status: InvoiceStatus;
  match: {
    outcome: MatchOutcome;
    poDeltaPct: number;
    grnDeltaPct: number;
    notes: string | null;
    overrideBy: string | null;
    overrideReason: string | null;
  };
  approvalAgeDays: number;
  /** Subcontractor pay-when-paid link (if any). */
  subcontractorLinkId: string | null;
  description: string;
}

const VENDOR_INVOICES: VendorInvoice[] = [
  {
    id: "vinv_001",
    number: "ORC-2026-7741",
    vendorId: "vnd_oracle_me",
    buyerEntityId: "fe_aico_uae",
    poId: "po_001",
    currency: "USD",
    amount: 84_000,
    amountUsd: 84_000,
    whtPct: 0,
    whtAmountUsd: 0,
    netPayableUsd: 84_000,
    invoiceDate: "2026-02-16",
    dueDate: "2026-03-18",
    receivedAt: "2026-02-17",
    status: "paid",
    match: { outcome: "match", poDeltaPct: 0, grnDeltaPct: 0, notes: null, overrideBy: null, overrideReason: null },
    approvalAgeDays: 0,
    subcontractorLinkId: null,
    description: "OCI + DB annual — paid via run pr_001.",
  },
  {
    id: "vinv_002",
    number: "ZEN-2026-0411",
    vendorId: "vnd_zenith_eng",
    buyerEntityId: "fe_aico_jv_neom",
    poId: "po_002",
    currency: "SAR",
    amount: 196_650,
    amountUsd: 52_440,
    whtPct: 0.05,
    whtAmountUsd: 2_622,
    netPayableUsd: 49_818,
    invoiceDate: "2026-04-12",
    dueDate: "2026-05-27",
    receivedAt: "2026-04-12",
    status: "on_hold_pwp",
    match: { outcome: "match", poDeltaPct: 0, grnDeltaPct: 0, notes: null, overrideBy: null, overrideReason: null },
    approvalAgeDays: 33,
    subcontractorLinkId: "scl_zen_neom_1",
    description: "Substation civils — April invoice. Held: pay-when-paid (AR open).",
  },
  {
    id: "vinv_003",
    number: "ZEN-2026-0512",
    vendorId: "vnd_zenith_eng",
    buyerEntityId: "fe_aico_jv_neom",
    poId: "po_002",
    currency: "SAR",
    amount: 215_625,
    amountUsd: 57_500,
    whtPct: 0.05,
    whtAmountUsd: 2_875,
    netPayableUsd: 54_625,
    invoiceDate: "2026-05-04",
    dueDate: "2026-06-18",
    receivedAt: "2026-05-04",
    status: "matched",
    match: { outcome: "match", poDeltaPct: 0, grnDeltaPct: 0, notes: null, overrideBy: null, overrideReason: null },
    approvalAgeDays: 11,
    subcontractorLinkId: "scl_zen_neom_2",
    description: "Substation civils — May invoice; awaiting pay-when-paid release.",
  },
  {
    id: "vinv_004",
    number: "AWS-2026-04-INV",
    vendorId: "vnd_aws_inc",
    buyerEntityId: "fe_aico_uk",
    poId: "po_003",
    currency: "USD",
    amount: 8_120,
    amountUsd: 8_120,
    whtPct: 0,
    whtAmountUsd: 0,
    netPayableUsd: 8_120,
    invoiceDate: "2026-05-01",
    dueDate: "2026-05-31",
    receivedAt: "2026-05-01",
    status: "exception",
    match: {
      outcome: "price_mismatch",
      poDeltaPct: 0.015,
      grnDeltaPct: 0,
      notes: "Invoice $8,120 vs PO $8,000 (+1.5%) — within auto-tolerance ±2% but flagged for review (above $100 absolute delta).",
      overrideBy: null,
      overrideReason: null,
    },
    approvalAgeDays: 14,
    subcontractorLinkId: null,
    description: "AWS April usage — overrun on EC2 due to NEOM data-export.",
  },
  {
    id: "vinv_005",
    number: "AWS-2026-05-INV",
    vendorId: "vnd_aws_inc",
    buyerEntityId: "fe_aico_uk",
    poId: "po_003",
    currency: "USD",
    amount: 8_000,
    amountUsd: 8_000,
    whtPct: 0,
    whtAmountUsd: 0,
    netPayableUsd: 8_000,
    invoiceDate: "2026-06-01",
    dueDate: "2026-07-01",
    receivedAt: "2026-06-01",
    status: "matched",
    match: { outcome: "match", poDeltaPct: 0, grnDeltaPct: 0, notes: null, overrideBy: null, overrideReason: null },
    approvalAgeDays: 0,
    subcontractorLinkId: null,
    description: "AWS May usage — matched, scheduled for next run.",
  },
  {
    id: "vinv_006",
    number: "HEL-2026-0312",
    vendorId: "vnd_helios_design",
    buyerEntityId: "fe_aico_uk",
    poId: "po_004",
    currency: "GBP",
    amount: 70_400,
    amountUsd: 88_000,
    whtPct: 0,
    whtAmountUsd: 0,
    netPayableUsd: 88_000,
    invoiceDate: "2026-04-26",
    dueDate: "2026-05-26",
    receivedAt: "2026-04-26",
    status: "approved_for_payment",
    match: { outcome: "match", poDeltaPct: 0, grnDeltaPct: 0, notes: null, overrideBy: null, overrideReason: null },
    approvalAgeDays: 19,
    subcontractorLinkId: "scl_helios_pif",
    description: "Brand visual system — AR already received, ready to release.",
  },
  {
    id: "vinv_007",
    number: "DF-2026-0589",
    vendorId: "vnd_dataforge",
    buyerEntityId: "fe_aico_ksa",
    poId: "po_006",
    currency: "USD",
    amount: 23_040,
    amountUsd: 23_040,
    whtPct: 0.10,
    whtAmountUsd: 2_304,
    netPayableUsd: 20_736,
    invoiceDate: "2026-05-09",
    dueDate: "2026-06-23",
    receivedAt: "2026-05-09",
    status: "on_hold_pwp",
    match: { outcome: "match", poDeltaPct: 0, grnDeltaPct: 0, notes: null, overrideBy: null, overrideReason: null },
    approvalAgeDays: 6,
    subcontractorLinkId: "scl_dataforge_aramco",
    description: "Aramco PM — feature engineering. Held: pay-when-paid (AR open).",
  },
  {
    id: "vinv_008",
    number: "SKY-2026-0188",
    vendorId: "vnd_skyline_logistics",
    buyerEntityId: "fe_aico_uae",
    poId: null,
    currency: "AED",
    amount: 14_700,
    amountUsd: 4_002,
    whtPct: 0,
    whtAmountUsd: 0,
    netPayableUsd: 4_002,
    invoiceDate: "2026-05-04",
    dueDate: "2026-07-03",
    receivedAt: "2026-05-04",
    status: "exception",
    match: {
      outcome: "no_po",
      poDeltaPct: 0,
      grnDeltaPct: 0,
      notes: "Non-PO invoice — vendor on sanctions hold; cannot be approved until match-review clears.",
      overrideBy: null,
      overrideReason: null,
    },
    approvalAgeDays: 11,
    subcontractorLinkId: null,
    description: "Office logistics — vendor blocked pending sanctions review.",
  },
];

// ============================================================
// Payment runs (maker-checker + dual-signatory)
// ============================================================
export type PaymentRunStatus =
  | "draft"
  | "pending_checker"
  | "pending_signatories"
  | "approved"
  | "exported"
  | "paid"
  | "rejected";

export interface PaymentRunSignoff {
  signatoryId: string;
  signatoryName: string;
  authorityLevel: "A" | "B" | "C";
  signedAt: string | null;
}

export interface PaymentRunBatch {
  /** One batch = one (entity, currency, bank-account) tuple. */
  id: string;
  entityId: string;
  bankAccountId: string;
  currency: string;
  invoiceIds: string[];
  totalUsd: number;
  count: number;
}

export interface PaymentRun {
  id: string;
  number: string;
  scheduledFor: string;
  status: PaymentRunStatus;
  createdBy: string;
  createdAt: string;
  /** Maker-checker. */
  makerName: string;
  checkerName: string | null;
  checkedAt: string | null;
  /** Dual signatories pulled from the entity's bank-account signatory matrix. */
  requiredSignatures: PaymentRunSignoff[];
  batches: PaymentRunBatch[];
  totalUsd: number;
  invoiceCount: number;
  /** Simulated bank-file output (CSV-like body). */
  bankFile: { filename: string; format: "SEPA-XML" | "SAMA-CSV" | "ACH-NACHA" | "BACS-CSV"; lines: number; previewBytes: string } | null;
  notes: string;
}

const PAYMENT_RUNS: PaymentRun[] = [
  {
    id: "pr_001",
    number: "PR-2026-W11",
    scheduledFor: "2026-03-13",
    status: "paid",
    createdBy: "Omar Habib",
    createdAt: "2026-03-10",
    makerName: "Omar Habib",
    checkerName: "Faisal Al-Suwaidi",
    checkedAt: "2026-03-12",
    requiredSignatures: [
      { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: "2026-03-12" },
      { signatoryId: "sig_faisal_a", signatoryName: "Faisal Al-Suwaidi", authorityLevel: "A", signedAt: "2026-03-12" },
    ],
    batches: [
      { id: "prb_001a", entityId: "fe_aico_uae", bankAccountId: "ba_aico_uae_op", currency: "AED", invoiceIds: ["vinv_001"], totalUsd: 84_000, count: 1 },
    ],
    totalUsd: 84_000,
    invoiceCount: 1,
    bankFile: { filename: "PR-2026-W11_AICOUAE.xml", format: "SEPA-XML", lines: 1, previewBytes: "<Pmt><Amt Ccy=\"AED\">308,490.00</Amt><Cdtr>Oracle Systems Limited</Cdtr><...>" },
    notes: "Cleared. Oracle subscription paid before quarter end.",
  },
  {
    id: "pr_002",
    number: "PR-2026-W20",
    scheduledFor: "2026-05-15",
    status: "pending_signatories",
    createdBy: "Omar Habib",
    createdAt: "2026-05-12",
    makerName: "Omar Habib",
    checkerName: "Yara Nasser",
    checkedAt: "2026-05-13",
    requiredSignatures: [
      { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: "2026-05-13" },
      { signatoryId: "sig_omar_h", signatoryName: "Omar Habib", authorityLevel: "B", signedAt: null },
    ],
    batches: [
      { id: "prb_002a", entityId: "fe_aico_uk", bankAccountId: "ba_aico_uk_op", currency: "GBP", invoiceIds: ["vinv_006"], totalUsd: 88_000, count: 1 },
    ],
    totalUsd: 88_000,
    invoiceCount: 1,
    bankFile: null,
    notes: "Awaiting second signatory (Omar Habib, Authority B) — Helios brand-system payment.",
  },
  {
    id: "pr_003",
    number: "PR-2026-W21",
    scheduledFor: "2026-05-22",
    status: "draft",
    createdBy: "Omar Habib",
    createdAt: "2026-05-14",
    makerName: "Omar Habib",
    checkerName: null,
    checkedAt: null,
    requiredSignatures: [
      { signatoryId: "sig_yara_n", signatoryName: "Yara Nasser", authorityLevel: "A", signedAt: null },
      { signatoryId: "sig_omar_h", signatoryName: "Omar Habib", authorityLevel: "B", signedAt: null },
    ],
    batches: [
      { id: "prb_003a", entityId: "fe_aico_uk", bankAccountId: "ba_aico_uk_op", currency: "USD", invoiceIds: ["vinv_005"], totalUsd: 8_000, count: 1 },
    ],
    totalUsd: 8_000,
    invoiceCount: 1,
    bankFile: null,
    notes: "Draft batch — AWS May invoice. Pending checker.",
  },
];

// ============================================================
// WHT register (per-jurisdiction, with certificate tracking)
// ============================================================
export type WhtCertStatus = "pending" | "issued" | "sent_to_vendor" | "acknowledged";

export interface WhtCertificate {
  id: string;
  jurisdiction: "SA" | "AE" | "GB" | "IN";
  vendorId: string;
  vendorName: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentRunId: string | null;
  paidAt: string | null;
  grossUsd: number;
  whtPct: number;
  whtUsd: number;
  certificateNumber: string | null;
  status: WhtCertStatus;
  issuedAt: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  /** Aggregated for the periodic remittance summary. */
  remittancePeriod: string; // YYYY-MM
  remittanceDueAt: string;
}

const WHT_CERTIFICATES: WhtCertificate[] = [
  {
    id: "whtc_001",
    jurisdiction: "SA",
    vendorId: "vnd_zenith_eng",
    vendorName: "Zenith Engineering Consultants Co.",
    invoiceId: "vinv_002",
    invoiceNumber: "ZEN-2026-0411",
    paymentRunId: null,
    paidAt: null,
    grossUsd: 52_440,
    whtPct: 0.05,
    whtUsd: 2_622,
    certificateNumber: null,
    status: "pending",
    issuedAt: null,
    sentAt: null,
    acknowledgedAt: null,
    remittancePeriod: "2026-05",
    remittanceDueAt: "2026-06-10",
  },
  {
    id: "whtc_002",
    jurisdiction: "SA",
    vendorId: "vnd_zenith_eng",
    vendorName: "Zenith Engineering Consultants Co.",
    invoiceId: "vinv_003",
    invoiceNumber: "ZEN-2026-0512",
    paymentRunId: null,
    paidAt: null,
    grossUsd: 57_500,
    whtPct: 0.05,
    whtUsd: 2_875,
    certificateNumber: null,
    status: "pending",
    issuedAt: null,
    sentAt: null,
    acknowledgedAt: null,
    remittancePeriod: "2026-06",
    remittanceDueAt: "2026-07-10",
  },
  {
    id: "whtc_003",
    jurisdiction: "IN",
    vendorId: "vnd_dataforge",
    vendorName: "DataForge Analytics India Pvt Ltd",
    invoiceId: "vinv_007",
    invoiceNumber: "DF-2026-0589",
    paymentRunId: null,
    paidAt: null,
    grossUsd: 23_040,
    whtPct: 0.10,
    whtUsd: 2_304,
    certificateNumber: null,
    status: "pending",
    issuedAt: null,
    sentAt: null,
    acknowledgedAt: null,
    remittancePeriod: "2026-06",
    remittanceDueAt: "2026-07-07",
  },
  {
    id: "whtc_004",
    jurisdiction: "SA",
    vendorId: "vnd_zenith_eng",
    vendorName: "Zenith Engineering Consultants Co.",
    invoiceId: "vinv_zen_legacy_03",
    invoiceNumber: "ZEN-2026-0309",
    paymentRunId: "pr_legacy_w09",
    paidAt: "2026-03-04",
    grossUsd: 41_800,
    whtPct: 0.05,
    whtUsd: 2_090,
    certificateNumber: "ZATCA-WHT-2026-04188",
    status: "acknowledged",
    issuedAt: "2026-03-08",
    sentAt: "2026-03-09",
    acknowledgedAt: "2026-03-12",
    remittancePeriod: "2026-03",
    remittanceDueAt: "2026-04-10",
  },
  {
    id: "whtc_005",
    jurisdiction: "IN",
    vendorId: "vnd_dataforge",
    vendorName: "DataForge Analytics India Pvt Ltd",
    invoiceId: "vinv_df_legacy_02",
    invoiceNumber: "DF-2026-0421",
    paymentRunId: "pr_legacy_w14",
    paidAt: "2026-04-09",
    grossUsd: 18_000,
    whtPct: 0.10,
    whtUsd: 1_800,
    certificateNumber: "TDS-IN-2026-Q1-771",
    status: "sent_to_vendor",
    issuedAt: "2026-04-15",
    sentAt: "2026-04-16",
    acknowledgedAt: null,
    remittancePeriod: "2026-04",
    remittanceDueAt: "2026-05-07",
  },
];

// ============================================================
// Public accessors
// ============================================================
export function listVendors(): Vendor[] { return VENDORS; }
export function listPurchaseOrders(): PurchaseOrder[] { return PURCHASE_ORDERS; }
export function listVendorInvoices(): VendorInvoice[] { return VENDOR_INVOICES; }
export function listPaymentRuns(): PaymentRun[] { return PAYMENT_RUNS; }
export function listWhtCertificates(): WhtCertificate[] { return WHT_CERTIFICATES; }
export function listSubcontractorLinks(): SubcontractorLink[] { return SUBCONTRACTOR_LINKS; }

/** Top-N upcoming disbursements derived from approved/scheduled payment runs
 *  + any matched/approved invoices not yet on a run. Used by the Wave-1
 *  dashboard tile (FinanceHome). */
export function topExpectedDisbursements(n: number): Array<{
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amountUsd: number;
  dueDate: string;
  status: InvoiceStatus;
  paymentRunNumber: string | null;
}> {
  const runByInvoice = new Map<string, string>();
  for (const r of PAYMENT_RUNS) {
    if (r.status === "paid" || r.status === "rejected") continue;
    for (const b of r.batches) for (const id of b.invoiceIds) runByInvoice.set(id, r.number);
  }
  const vendorById = new Map(VENDORS.map((v) => [v.id, v.shortName]));
  const candidates = VENDOR_INVOICES.filter(
    (i) =>
      i.status === "matched" ||
      i.status === "approved_for_payment" ||
      i.status === "scheduled" ||
      runByInvoice.has(i.id),
  );
  return candidates
    .map((i) => ({
      invoiceId: i.id,
      invoiceNumber: i.number,
      vendorName: vendorById.get(i.vendorId) ?? i.vendorId,
      amountUsd: i.netPayableUsd,
      dueDate: i.dueDate,
      status: i.status,
      paymentRunNumber: runByInvoice.get(i.id) ?? null,
    }))
    .sort((a, b) => b.amountUsd - a.amountUsd)
    .slice(0, n);
}

/** Producer for the "stalled in approval" inbox feed — vendor invoices in
 *  approval > N days, plus PO mismatches surfaced as exceptions. */
export function stalledApprovalItems(thresholdDays: number): Array<{
  id: string;
  kind: "vendor_invoice_stalled" | "po_mismatch";
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amountUsd: number;
  ageDays: number;
  detail: string;
}> {
  const vendorById = new Map(VENDORS.map((v) => [v.id, v.shortName]));
  const out: ReturnType<typeof stalledApprovalItems> = [];
  for (const inv of VENDOR_INVOICES) {
    const stalled = inv.approvalAgeDays > thresholdDays && (inv.status === "received" || inv.status === "matched");
    if (stalled) {
      out.push({
        id: `inb_stl_${inv.id}`,
        kind: "vendor_invoice_stalled",
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        vendorName: vendorById.get(inv.vendorId) ?? inv.vendorId,
        amountUsd: inv.netPayableUsd,
        ageDays: inv.approvalAgeDays,
        detail: `${inv.status} — awaiting approval ${inv.approvalAgeDays}d`,
      });
    }
    if (inv.status === "exception") {
      out.push({
        id: `inb_mm_${inv.id}`,
        kind: "po_mismatch",
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        vendorName: vendorById.get(inv.vendorId) ?? inv.vendorId,
        amountUsd: inv.netPayableUsd,
        ageDays: inv.approvalAgeDays,
        detail: `${inv.match.outcome.replace(/_/g, " ")} — ${inv.match.notes ?? "see invoice"}`,
      });
    }
  }
  return out;
}
