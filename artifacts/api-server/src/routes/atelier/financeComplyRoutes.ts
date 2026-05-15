/**
 * Atelier — Finance Comply read routes (Task #419, Wave 7).
 *
 * Demo-only seed data describing the four Comply registers that sit
 * alongside the existing tax-filings calendar (which lives on the
 * entities backbone, Task #372):
 *
 *   - Internal controls catalogue (SOX-lite — controls + cadence +
 *     last-tested + exceptions, plus a SoD matrix mapped onto the
 *     atelier role model).
 *   - Statutory filings register (per entity — annual accounts,
 *     beneficial ownership, country-by-country, MISA / DIFC / ADGM,
 *     payroll year-end).
 *   - Transfer-pricing register (one row per inter-company link,
 *     pulling the TP method already set on the entity model; master
 *     and local file slots with version history; related-party
 *     transactions schedule).
 *   - Insurance register (PI / D&O / employer's liability / cyber).
 *
 * All four feed the FinanceHome compliance-calendar tile and the
 * "Next action for you" inbox alongside the existing tax / licence
 * / close items.
 *
 * Persona gating mirrors financeEntitiesRoutes: recruiter is denied
 * (it is /studio-only firm-wide). Real document storage and
 * automated control testing are out of scope; everything here is
 * static seed.
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

/* ============================================================
   Internal controls catalogue
   ============================================================ */
export type ControlFrequency =
  | "per_transaction"
  | "daily"
  | "monthly"
  | "quarterly"
  | "annual";
export type ControlResult = "pass" | "fail" | "exception" | "not_tested";
export type ControlArea =
  | "revenue"
  | "ar"
  | "cash"
  | "ap"
  | "payroll"
  | "journals"
  | "itgc";

export interface InternalControl {
  id: string;
  title: string;
  description: string;
  area: ControlArea;
  owner: string;
  ownerRole: string;
  frequency: ControlFrequency;
  evidenceCadence: string;
  lastTestedOn: string;
  lastResult: ControlResult;
  exceptionsOpen: number;
  remediation: string | null;
  appliesToEntities: string[];
}

const CONTROLS: InternalControl[] = [
  {
    id: "ctl_rev_001",
    title: "Revenue recognition cut-off",
    description: "All revenue recognised in the period has signed deliverable acceptance and milestone evidence on file before posting.",
    area: "revenue",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "monthly",
    evidenceCadence: "Per close — sample 25 milestones / period",
    lastTestedOn: "2026-04-30",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae", "fe_aico_uae_branch"],
  },
  {
    id: "ctl_rev_002",
    title: "Two-Partner sign-off on rev-rec adjustments > $50k",
    description: "Manual rev-rec adjustments with absolute value above $50k require sign-off from two Partners (Wave-4 Two-Partner pattern).",
    area: "revenue",
    owner: "Yara Nasser",
    ownerRole: "Founding Partner",
    frequency: "per_transaction",
    evidenceCadence: "Audit-trail entry per posting",
    lastTestedOn: "2026-05-01",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
  {
    id: "ctl_ar_001",
    title: "AR aging review and write-off",
    description: "Monthly review of AR > 90d; write-offs require Group Controller sign-off and a documented collections trail.",
    area: "ar",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "monthly",
    evidenceCadence: "AR aging snapshot + write-off log",
    lastTestedOn: "2026-04-30",
    lastResult: "exception",
    exceptionsOpen: 2,
    remediation: "Two write-offs (Helios, NorthHaven) posted without collections-trail evidence — chase from Layla due 2026-05-22.",
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
  {
    id: "ctl_cash_001",
    title: "Bank reconciliation",
    description: "All operating, payroll and escrow accounts reconciled monthly; reconciling items aged > 30d are flagged and explained.",
    area: "cash",
    owner: "Layla Al-Mutairi",
    ownerRole: "KSA Managing Partner",
    frequency: "monthly",
    evidenceCadence: "Per close — reconciliation packet attached",
    lastTestedOn: "2026-04-30",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae", "fe_aico_uae_branch", "fe_aico_jv_neom"],
  },
  {
    id: "ctl_cash_002",
    title: "Dual signatories on payments > $25k",
    description: "Bank disbursements above $25k equivalent require two A-level signatories. JV escrow account requires one AICo + one NEOM signatory irrespective of value.",
    area: "cash",
    owner: "Layla Al-Mutairi",
    ownerRole: "KSA Managing Partner",
    frequency: "per_transaction",
    evidenceCadence: "Bank-portal approval log",
    lastTestedOn: "2026-05-05",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae", "fe_aico_uae_branch", "fe_aico_jv_neom"],
  },
  {
    id: "ctl_ap_001",
    title: "Vendor master changes",
    description: "Vendor master record changes (bank details especially) require segregation between requestor and approver, with email-chain evidence retained.",
    area: "ap",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "per_transaction",
    evidenceCadence: "Change log + approver email",
    lastTestedOn: "2026-04-15",
    lastResult: "exception",
    exceptionsOpen: 1,
    remediation: "One vendor (Skylight Studios) had bank details changed by the requestor — re-confirmed via call-back, control re-tested 2026-05-10.",
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
  {
    id: "ctl_ap_002",
    title: "PO / non-PO invoice three-way match",
    description: "PO invoices three-way matched (PO, GRN, invoice). Non-PO invoices require cost-centre owner + Controller approval before payment.",
    area: "ap",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "per_transaction",
    evidenceCadence: "Approval workflow in wallet",
    lastTestedOn: "2026-04-30",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae", "fe_aico_uae_branch"],
  },
  {
    id: "ctl_pay_001",
    title: "Payroll register approval",
    description: "Monthly payroll register approved by HR Lead and Controller before bank submission; gross-to-net variances > 5% explained.",
    area: "payroll",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "monthly",
    evidenceCadence: "Signed payroll register PDF",
    lastTestedOn: "2026-04-25",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
  {
    id: "ctl_je_001",
    title: "Manual journal entry approval",
    description: "Manual JEs > $10k require independent reviewer approval with rationale; recurring / accrual templates pre-approved annually.",
    area: "journals",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "per_transaction",
    evidenceCadence: "Audit-trail entry per JE",
    lastTestedOn: "2026-04-30",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae", "fe_aico_uae_branch"],
  },
  {
    id: "ctl_itgc_001",
    title: "Quarterly user-access review",
    description: "Privileged-access roles in finance systems reviewed quarterly; leavers removed within 24h; SoD conflicts surfaced from the access matrix.",
    area: "itgc",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "quarterly",
    evidenceCadence: "Access-review packet + revocation log",
    lastTestedOn: "2026-03-31",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
  {
    id: "ctl_itgc_002",
    title: "Backup restore verification",
    description: "Restore-from-backup test executed quarterly against one production system; success and RTO recorded.",
    area: "itgc",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "quarterly",
    evidenceCadence: "Restore log + screenshot",
    lastTestedOn: "2026-02-15",
    lastResult: "exception",
    exceptionsOpen: 1,
    remediation: "Q1 restore exceeded RTO target (4h actual vs 2h target). Vendor escalation in flight; re-test scheduled 2026-05-30.",
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
  {
    id: "ctl_itgc_003",
    title: "Change management — production deploys",
    description: "Production deploys to finance systems require ticket, peer review and rollback plan; emergency changes back-filled within 48h.",
    area: "itgc",
    owner: "Omar Habib",
    ownerRole: "Group Controller",
    frequency: "per_transaction",
    evidenceCadence: "Change ticket + PR link",
    lastTestedOn: "2026-04-10",
    lastResult: "pass",
    exceptionsOpen: 0,
    remediation: null,
    appliesToEntities: ["fe_aico_uk", "fe_aico_ksa", "fe_aico_uae"],
  },
];

/* ============================================================
   Segregation-of-duties matrix
   ============================================================ */
export interface SoDConflict {
  id: string;
  title: string;
  description: string;
  rolesA: string[];
  rolesB: string[];
  severity: "high" | "medium" | "low";
  currentlyViolatingPeople: { name: string; role: string }[];
  mitigation: string;
  linkedControlIds: string[];
}

const SOD_CONFLICTS: SoDConflict[] = [
  {
    id: "sod_001",
    title: "Vendor setup ↔ Payment approval",
    description: "The same person must not be able to create / amend a vendor master record and approve a payment to that vendor.",
    rolesA: ["finance"],
    rolesB: ["partner", "founding_partner"],
    severity: "high",
    currentlyViolatingPeople: [],
    mitigation: "Wallet enforces approver-not-equals-requestor; access matrix denies finance role from payment-approve permission.",
    linkedControlIds: ["ctl_ap_001", "ctl_ap_002"],
  },
  {
    id: "sod_002",
    title: "Journal entry posting ↔ Bank reconciliation",
    description: "The person posting manual journals must not be the person reconciling the bank, to prevent fraudulent entries being concealed in reconciliations.",
    rolesA: ["finance"],
    rolesB: ["partner", "founding_partner"],
    severity: "high",
    currentlyViolatingPeople: [
      { name: "Omar Habib", role: "Group Controller" },
    ],
    mitigation: "Single-controller firm — temporary mitigation via Founding Partner sample-review of all bank reconciliations until a second finance hire lands (Q3 2026).",
    linkedControlIds: ["ctl_je_001", "ctl_cash_001"],
  },
  {
    id: "sod_003",
    title: "Expense submission ↔ Expense approval",
    description: "An employee must not approve their own expense report.",
    rolesA: ["consultant", "senior_manager", "partner", "founding_partner"],
    rolesB: ["senior_manager", "partner", "founding_partner"],
    severity: "high",
    currentlyViolatingPeople: [],
    mitigation: "Wallet expense-approval workflow blocks self-approval; partner expenses route to a second partner.",
    linkedControlIds: [],
  },
  {
    id: "sod_004",
    title: "Timesheet entry ↔ Timesheet approval",
    description: "An individual must not approve their own time entries; partner time approvals route to a second partner.",
    rolesA: ["consultant", "senior_manager", "partner", "founding_partner"],
    rolesB: ["senior_manager", "partner", "founding_partner"],
    severity: "medium",
    currentlyViolatingPeople: [],
    mitigation: "Time approval workflow enforces approver-not-equals-submitter.",
    linkedControlIds: [],
  },
  {
    id: "sod_005",
    title: "User-access provisioning ↔ User-access review",
    description: "The person granting privileged access must not be the sole reviewer of access rights.",
    rolesA: ["finance"],
    rolesB: ["founding_partner"],
    severity: "medium",
    currentlyViolatingPeople: [],
    mitigation: "Quarterly access review co-signed by a Founding Partner; provisioning log compared independently.",
    linkedControlIds: ["ctl_itgc_001"],
  },
  {
    id: "sod_006",
    title: "Customer credit-note issue ↔ Cash application",
    description: "The person issuing a customer credit note must not also apply incoming cash, to prevent receipts being routed through bogus credit notes.",
    rolesA: ["finance"],
    rolesB: ["finance"],
    severity: "medium",
    currentlyViolatingPeople: [
      { name: "Omar Habib", role: "Group Controller" },
    ],
    mitigation: "Credit notes > $10k require Founding-Partner co-sign until a second finance hire lands; cash-application log Partner-reviewed monthly.",
    linkedControlIds: ["ctl_ar_001"],
  },
];

/* ============================================================
   Statutory filings register
   ============================================================ */
export type FilingStatus = "not_started" | "in_progress" | "filed" | "overdue";

export interface StatutoryFiling {
  id: string;
  entityId: string;
  kind: string;
  authority: string;
  description: string;
  dueOn: string;
  status: FilingStatus;
  owner: string;
  evidenceUrl: string | null;
  notes: string;
}

const STATUTORY_FILINGS: StatutoryFiling[] = [
  {
    id: "stat_uk_accounts_2025",
    entityId: "fe_aico_uk",
    kind: "Annual accounts (FY25)",
    authority: "Companies House",
    description: "Filed group-consolidated accounts for the year ended 31 Dec 2025 under FRS 102.",
    dueOn: "2026-09-30",
    status: "in_progress",
    owner: "Omar Habib",
    evidenceUrl: null,
    notes: "Audit fieldwork complete; sign-off pending two Wave-4 Partner approvers.",
  },
  {
    id: "stat_uk_confirmation",
    entityId: "fe_aico_uk",
    kind: "Confirmation statement",
    authority: "Companies House",
    description: "Annual CS01 confirmation statement of company details and PSCs.",
    dueOn: "2026-03-28",
    status: "filed",
    owner: "Omar Habib",
    evidenceUrl: "/comply/evidence/cs01-2026.pdf",
    notes: "Filed 2026-03-12; CH receipt on file.",
  },
  {
    id: "stat_uk_psc",
    entityId: "fe_aico_uk",
    kind: "Beneficial-ownership / PSC update",
    authority: "Companies House",
    description: "Notify PSC register of any changes to people with significant control within 14 days.",
    dueOn: "2026-12-31",
    status: "not_started",
    owner: "Omar Habib",
    evidenceUrl: null,
    notes: "No PSC changes in the period — no action needed unless cap-table moves.",
  },
  {
    id: "stat_uk_cbc",
    entityId: "fe_aico_uk",
    kind: "Country-by-country notification",
    authority: "HMRC",
    description: "CbCR notification confirming UK group reporter for the consolidated group.",
    dueOn: "2026-12-31",
    status: "not_started",
    owner: "Omar Habib",
    evidenceUrl: null,
    notes: "Group is sub-€750m so CbCR full-report not required; notification only.",
  },
  {
    id: "stat_uk_payroll_yearend",
    entityId: "fe_aico_uk",
    kind: "Payroll year-end (P60 / P11D)",
    authority: "HMRC",
    description: "Year-end payroll filings, P60 distribution to staff, P11D for benefits in kind.",
    dueOn: "2026-07-06",
    status: "in_progress",
    owner: "Layla Al-Mutairi",
    evidenceUrl: null,
    notes: "P60s issued 2026-04-12; P11D in draft.",
  },
  {
    id: "stat_ksa_misa_renewal",
    entityId: "fe_aico_ksa",
    kind: "MISA licence renewal",
    authority: "MISA",
    description: "Renewal of foreign-investor IT services licence (MISA-1010-7723).",
    dueOn: "2026-08-15",
    status: "in_progress",
    owner: "Layla Al-Mutairi",
    evidenceUrl: null,
    notes: "Application packet drafted; localisation evidence (Saudi staff %) under review.",
  },
  {
    id: "stat_ksa_zatca_return",
    entityId: "fe_aico_ksa",
    kind: "Zakat & corporate income tax return",
    authority: "ZATCA",
    description: "Annual Zakat / CIT return covering FY25.",
    dueOn: "2026-04-30",
    status: "filed",
    owner: "Layla Al-Mutairi",
    evidenceUrl: "/comply/evidence/zatca-cit-2025.pdf",
    notes: "Filed 2026-04-22; assessment notice received.",
  },
  {
    id: "stat_ksa_gosi",
    entityId: "fe_aico_ksa",
    kind: "GOSI / payroll year-end",
    authority: "GOSI",
    description: "Year-end social insurance reconciliation and statement of contributions.",
    dueOn: "2026-06-30",
    status: "in_progress",
    owner: "Layla Al-Mutairi",
    evidenceUrl: null,
    notes: "Headcount reconciliation in progress; no variance expected.",
  },
  {
    id: "stat_uae_difc_return",
    entityId: "fe_aico_uae",
    kind: "DIFC commercial return",
    authority: "DIFC Registrar",
    description: "Annual DIFC commercial return and confirmation of registered details.",
    dueOn: "2026-04-10",
    status: "filed",
    owner: "Faisal Al-Suwaidi",
    evidenceUrl: "/comply/evidence/difc-return-2026.pdf",
    notes: "Filed 2026-03-28.",
  },
  {
    id: "stat_uae_dpc",
    entityId: "fe_aico_uae",
    kind: "DIFC Data Protection annual notification",
    authority: "DIFC DPC",
    description: "Annual notified data-controller renewal and processing record update.",
    dueOn: "2027-02-01",
    status: "not_started",
    owner: "Faisal Al-Suwaidi",
    evidenceUrl: null,
    notes: "RoPA refreshed Q1 2026; renewal window opens Nov 2026.",
  },
  {
    id: "stat_uae_ct_return",
    entityId: "fe_aico_uae",
    kind: "UAE corporate-tax return (FY25)",
    authority: "FTA",
    description: "Annual UAE corporate-tax return; consolidated with ADGM branch.",
    dueOn: "2026-09-30",
    status: "in_progress",
    owner: "Faisal Al-Suwaidi",
    evidenceUrl: null,
    notes: "First full-year return under UAE CT regime; transfer-pricing local file is the gating dependency.",
  },
  {
    id: "stat_uae_adgm_return",
    entityId: "fe_aico_uae_branch",
    kind: "ADGM annual return",
    authority: "ADGM Registration Authority",
    description: "Annual ADGM return for the Abu Dhabi branch.",
    dueOn: "2026-09-01",
    status: "not_started",
    owner: "Faisal Al-Suwaidi",
    evidenceUrl: null,
    notes: "Branch licence renewal due Dec 2025 should land first; return tied to that record.",
  },
  {
    id: "stat_jv_neom_accounts",
    entityId: "fe_aico_jv_neom",
    kind: "JV first-year accounts",
    authority: "Ministry of Commerce (KSA)",
    description: "First annual accounts for the AICo × NEOM Sector Lab JV.",
    dueOn: "2026-06-30",
    status: "in_progress",
    owner: "Layla Al-Mutairi",
    evidenceUrl: null,
    notes: "Audited accounts must be filed jointly with NEOM Authority; co-sign required.",
  },
];

/* ============================================================
   Transfer-pricing register
   ============================================================ */
export interface TpFileVersion {
  version: string;
  publishedOn: string;
  author: string;
  notes: string;
}

export interface RelatedPartyTransaction {
  id: string;
  entityAId: string;
  entityBId: string;
  description: string;
  fyAmountUsdK: number;
  basis: string;
}

export interface TpRegisterRow {
  id: string;
  entityAId: string;
  entityBId: string;
  relationship: string;
  tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
  intercoServiceFeePct: number | null;
  benchmarkRange: string;
  benchmarkSource: string;
  masterFile: { current: TpFileVersion | null; history: TpFileVersion[] };
  localFile: { current: TpFileVersion | null; history: TpFileVersion[] };
  relatedPartyTransactions: RelatedPartyTransaction[];
  notes: string;
}

const TP_REGISTER: TpRegisterRow[] = [
  {
    id: "tp_uk_to_ksa",
    entityAId: "fe_aico_uk",
    entityBId: "fe_aico_ksa",
    relationship: "Parent provides group services to KSA subsidiary (HQ allocation, brand, IT, treasury).",
    tpMethod: "TNMM",
    intercoServiceFeePct: 0.07,
    benchmarkRange: "5.0% – 9.0% net cost-plus",
    benchmarkSource: "Internal benchmarking study, KPMG Q4 2024 — comparable IT services TNMM panel (n=18).",
    masterFile: {
      current: { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "Refreshed for FY25 organisational changes (NEOM JV, ADGM branch added)." },
      history: [
        { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "FY25 refresh." },
        { version: "v2024.1", publishedOn: "2025-03-15", author: "Omar Habib", notes: "Initial group master file." },
      ],
    },
    localFile: {
      current: { version: "v2025.1-KSA", publishedOn: "2026-03-31", author: "Layla Al-Mutairi", notes: "KSA local file FY25; ZATCA-format." },
      history: [
        { version: "v2025.1-KSA", publishedOn: "2026-03-31", author: "Layla Al-Mutairi", notes: "FY25 local file." },
        { version: "v2024.1-KSA", publishedOn: "2025-03-31", author: "Layla Al-Mutairi", notes: "FY24 local file." },
      ],
    },
    relatedPartyTransactions: [
      { id: "rpt_uk_ksa_svc", entityAId: "fe_aico_uk", entityBId: "fe_aico_ksa", description: "Group services fee (HQ allocation)", fyAmountUsdK: 1180, basis: "7% of KSA total cost base" },
      { id: "rpt_uk_ksa_ip", entityAId: "fe_aico_uk", entityBId: "fe_aico_ksa", description: "Trademark licence", fyAmountUsdK: 220, basis: "1.5% of KSA revenue (CUP)" },
    ],
    notes: "Primary TP relationship — auditors & ZATCA both rely on this file.",
  },
  {
    id: "tp_uk_to_uae",
    entityAId: "fe_aico_uk",
    entityBId: "fe_aico_uae",
    relationship: "Parent provides group services to UAE (DIFC) subsidiary.",
    tpMethod: "TNMM",
    intercoServiceFeePct: 0.07,
    benchmarkRange: "5.0% – 9.0% net cost-plus",
    benchmarkSource: "Internal benchmarking study, KPMG Q4 2024 — same panel as KSA.",
    masterFile: {
      current: { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "Shared with the KSA file." },
      history: [
        { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "FY25 refresh." },
      ],
    },
    localFile: {
      current: { version: "v2025.1-UAE", publishedOn: "2026-04-15", author: "Faisal Al-Suwaidi", notes: "UAE local file FY25 — first under the UAE CT regime." },
      history: [
        { version: "v2025.1-UAE", publishedOn: "2026-04-15", author: "Faisal Al-Suwaidi", notes: "FY25 local file." },
      ],
    },
    relatedPartyTransactions: [
      { id: "rpt_uk_uae_svc", entityAId: "fe_aico_uk", entityBId: "fe_aico_uae", description: "Group services fee", fyAmountUsdK: 760, basis: "7% of UAE total cost base" },
      { id: "rpt_uk_uae_ip", entityAId: "fe_aico_uk", entityBId: "fe_aico_uae", description: "Trademark licence", fyAmountUsdK: 145, basis: "1.5% of UAE revenue (CUP)" },
    ],
    notes: "Local file is the gating dependency on the UAE CT return (stat_uae_ct_return).",
  },
  {
    id: "tp_ksa_to_uae",
    entityAId: "fe_aico_ksa",
    entityBId: "fe_aico_uae",
    relationship: "KSA provides delivery sub-contracting to UAE on cross-border engagements.",
    tpMethod: "Cost+",
    intercoServiceFeePct: 0.08,
    benchmarkRange: "6.0% – 10.0% cost-plus mark-up",
    benchmarkSource: "Internal benchmarking — services sub-contractor panel (n=12), refreshed Q4 2024.",
    masterFile: {
      current: { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "Shared group master file." },
      history: [
        { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "FY25 refresh." },
      ],
    },
    localFile: {
      current: { version: "v2025.1-KSA-UAE", publishedOn: "2026-03-31", author: "Layla Al-Mutairi", notes: "Sub-contracting addendum to KSA local file." },
      history: [
        { version: "v2025.1-KSA-UAE", publishedOn: "2026-03-31", author: "Layla Al-Mutairi", notes: "FY25 addendum." },
      ],
    },
    relatedPartyTransactions: [
      { id: "rpt_ksa_uae_dlv", entityAId: "fe_aico_ksa", entityBId: "fe_aico_uae", description: "Delivery sub-contracting hours", fyAmountUsdK: 410, basis: "Cost-plus 8% on hours billed" },
    ],
    notes: "Mark-up reviewed quarterly — last review April 2026, in range.",
  },
  {
    id: "tp_uae_to_branch",
    entityAId: "fe_aico_uae",
    entityBId: "fe_aico_uae_branch",
    relationship: "DIFC entity recharges shared services to ADGM branch.",
    tpMethod: "Cost+",
    intercoServiceFeePct: 0.05,
    benchmarkRange: "3.0% – 7.0% cost-plus",
    benchmarkSource: "Branch profit attribution per OECD AOA — internal model.",
    masterFile: {
      current: { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "Group master file." },
      history: [
        { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "FY25 refresh." },
      ],
    },
    localFile: {
      current: null,
      history: [],
    },
    relatedPartyTransactions: [
      { id: "rpt_uae_branch_svc", entityAId: "fe_aico_uae", entityBId: "fe_aico_uae_branch", description: "Branch shared-services recharge", fyAmountUsdK: 95, basis: "Cost-plus 5%" },
    ],
    notes: "Branch consolidates with parent for UAE CT — local file not separately required, but branch profit attribution memo on file.",
  },
  {
    id: "tp_ksa_to_jv",
    entityAId: "fe_aico_ksa",
    entityBId: "fe_aico_jv_neom",
    relationship: "KSA supplies advisory services into the AICo × NEOM JV at a resale-price margin.",
    tpMethod: "ResalePrice",
    intercoServiceFeePct: null,
    benchmarkRange: "12.0% – 18.0% gross resale margin",
    benchmarkSource: "External advisor (PwC ME) memo, Q1 2025.",
    masterFile: {
      current: { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "Group master file." },
      history: [
        { version: "v2025.1", publishedOn: "2026-02-28", author: "Omar Habib", notes: "FY25 refresh." },
      ],
    },
    localFile: {
      current: { version: "v2025.1-JV", publishedOn: "2026-04-10", author: "Layla Al-Mutairi", notes: "JV-specific local file; co-signed with NEOM Authority." },
      history: [
        { version: "v2025.1-JV", publishedOn: "2026-04-10", author: "Layla Al-Mutairi", notes: "FY25 first local file." },
      ],
    },
    relatedPartyTransactions: [
      { id: "rpt_ksa_jv_adv", entityAId: "fe_aico_ksa", entityBId: "fe_aico_jv_neom", description: "Advisory service hours into JV", fyAmountUsdK: 320, basis: "Resale margin 15%" },
    ],
    notes: "Auto-derived from IC transaction log; co-sign by NEOM Authority recorded in JV-2025-001.",
  },
];

/* ============================================================
   Insurance register
   ============================================================ */
export type InsuranceKind =
  | "Professional Indemnity"
  | "D&O"
  | "Employer's Liability"
  | "Cyber"
  | "Office / Property";

export interface InsurancePolicy {
  id: string;
  entityId: string;
  kind: InsuranceKind;
  insurer: string;
  policyNumber: string;
  periodFrom: string;
  periodTo: string;
  coverageUsdK: number;
  premiumUsdK: number;
  excessUsdK: number;
  status: "active" | "expiring_soon" | "expired" | "renewal_in_progress";
  renewalOwner: string;
  notes: string;
}

const INSURANCE: InsurancePolicy[] = [
  {
    id: "ins_uk_pi",
    entityId: "fe_aico_uk",
    kind: "Professional Indemnity",
    insurer: "Hiscox UK",
    policyNumber: "PI-HSX-141200-25",
    periodFrom: "2025-07-01",
    periodTo: "2026-06-30",
    coverageUsdK: 5000,
    premiumUsdK: 38,
    excessUsdK: 25,
    status: "expiring_soon",
    renewalOwner: "Omar Habib",
    notes: "Renewal in flight — broker sent draft slip 2026-05-02. Coverage step-up to $7.5M under review.",
  },
  {
    id: "ins_uk_do",
    entityId: "fe_aico_uk",
    kind: "D&O",
    insurer: "Allianz UK",
    policyNumber: "DO-ALZ-141200-25",
    periodFrom: "2025-07-01",
    periodTo: "2026-06-30",
    coverageUsdK: 3000,
    premiumUsdK: 22,
    excessUsdK: 25,
    status: "expiring_soon",
    renewalOwner: "Omar Habib",
    notes: "Renews with PI — same broker.",
  },
  {
    id: "ins_uk_el",
    entityId: "fe_aico_uk",
    kind: "Employer's Liability",
    insurer: "AIG UK",
    policyNumber: "EL-AIG-141200-25",
    periodFrom: "2025-04-01",
    periodTo: "2026-03-31",
    coverageUsdK: 13000,
    premiumUsdK: 4,
    excessUsdK: 0,
    status: "renewal_in_progress",
    renewalOwner: "Omar Habib",
    notes: "Statutory £10M cover; renewed 2026-03-15 — certificate awaiting upload.",
  },
  {
    id: "ins_uk_cyber",
    entityId: "fe_aico_uk",
    kind: "Cyber",
    insurer: "Beazley",
    policyNumber: "CY-BZL-141200-25",
    periodFrom: "2025-09-01",
    periodTo: "2026-08-31",
    coverageUsdK: 2000,
    premiumUsdK: 15,
    excessUsdK: 25,
    status: "active",
    renewalOwner: "Omar Habib",
    notes: "Includes ransomware extortion sub-limit of $500k. Tied to the Guardhouse incident playbook.",
  },
  {
    id: "ins_ksa_pi",
    entityId: "fe_aico_ksa",
    kind: "Professional Indemnity",
    insurer: "Tawuniya",
    policyNumber: "PI-TWN-300884-25",
    periodFrom: "2025-08-01",
    periodTo: "2026-07-31",
    coverageUsdK: 3000,
    premiumUsdK: 28,
    excessUsdK: 15,
    status: "active",
    renewalOwner: "Layla Al-Mutairi",
    notes: "Local KSA cover supplements UK group policy for KSA-jurisdiction claims.",
  },
  {
    id: "ins_uae_pi",
    entityId: "fe_aico_uae",
    kind: "Professional Indemnity",
    insurer: "Oman Insurance / Sukoon",
    policyNumber: "PI-SKN-DIFC7741-25",
    periodFrom: "2025-04-10",
    periodTo: "2026-04-09",
    coverageUsdK: 3000,
    premiumUsdK: 24,
    excessUsdK: 15,
    status: "renewal_in_progress",
    renewalOwner: "Faisal Al-Suwaidi",
    notes: "Renewed 2026-04-05 — slip signed; certificate due 2026-05-20.",
  },
  {
    id: "ins_uae_office",
    entityId: "fe_aico_uae",
    kind: "Office / Property",
    insurer: "Emirates Insurance",
    policyNumber: "OFF-EMI-DIFC7741-25",
    periodFrom: "2025-06-01",
    periodTo: "2026-05-31",
    coverageUsdK: 500,
    premiumUsdK: 3,
    excessUsdK: 5,
    status: "expiring_soon",
    renewalOwner: "Faisal Al-Suwaidi",
    notes: "Tied to DIFC office lease.",
  },
  {
    id: "ins_jv_pi",
    entityId: "fe_aico_jv_neom",
    kind: "Professional Indemnity",
    insurer: "Tawuniya",
    policyNumber: "PI-TWN-NEOMJV-25",
    periodFrom: "2025-03-01",
    periodTo: "2026-02-28",
    coverageUsdK: 2000,
    premiumUsdK: 18,
    excessUsdK: 10,
    status: "expired",
    renewalOwner: "Layla Al-Mutairi",
    notes: "Lapsed during JV cap-table refresh — emergency placement in flight via broker; target bind 2026-05-22. JV operations on cover under group umbrella in the interim.",
  },
];

/* ============================================================
   Routes
   ============================================================ */
function gatedList(items: unknown) {
  return (req: Request, res: Response) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (denyRecruiter(me, res)) return;
    res.json({ items });
  };
}

router.get("/finance/comply/controls", gatedList(CONTROLS));
router.get("/finance/comply/sod", gatedList(SOD_CONFLICTS));
router.get("/finance/comply/statutory", gatedList(STATUTORY_FILINGS));
router.get("/finance/comply/tp", gatedList(TP_REGISTER));
router.get("/finance/comply/insurance", gatedList(INSURANCE));

export default router;
