/**
 * Finance Close — period close, reconciliations, adjusting entries, and
 * two-partner sign-off (Task #416, Wave 4).
 *
 * Pure client-side seed + in-memory mutable store. The task is explicit
 * that there is no real GL connection; mutations live in module state and
 * notify React subscribers via `useSyncExternalStore`. Refreshing the
 * page resets the state to the seed (predictable for demos).
 */

export type ControlAccountKind =
  | "bank"
  | "ar"
  | "ap"
  | "ic"
  | "payroll"
  | "vat";

export type CloseTaskStatus = "pending" | "in_progress" | "done" | "na";
export type ReconStatus = "open" | "in_review" | "signed";
export type AdjustmentKind = "accrual" | "deferral" | "fx_reval";
export type AdjustmentStatus = "draft" | "posted" | "reversed";
export type ClosePeriodStatus =
  | "not_started"
  | "in_progress"
  | "in_review"
  | "signed";

export interface CloseUser {
  id: string;
  name: string;
  role: string;
  /** Partner-tier signers can sign off the period. */
  partnerTier: boolean;
}

export interface CloseTask {
  id: string;
  periodId: string;
  code: string;
  title: string;
  ownerId: string;
  dueDate: string;
  dependsOn: string[];
  status: CloseTaskStatus;
  evidenceLink: string | null;
  preparedById: string | null;
  reviewedById: string | null;
  completedOn: string | null;
}

export interface ReconcilingItem {
  id: string;
  description: string;
  amount: number;
}

export interface Reconciliation {
  id: string;
  periodId: string;
  controlAccount: ControlAccountKind;
  label: string;
  currency: string;
  ledgerBalance: number;
  sourceBalance: number;
  sourceLabel: string;
  items: ReconcilingItem[];
  preparedById: string | null;
  reviewedById: string | null;
  status: ReconStatus;
  signedOn: string | null;
}

export interface AdjustingEntry {
  id: string;
  periodId: string;
  kind: AdjustmentKind;
  narrative: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: string;
  postedById: string | null;
  reviewedById: string | null;
  status: AdjustmentStatus;
  postedOn: string | null;
}

export interface SignOff {
  id: string;
  periodId: string;
  signerId: string;
  signerName: string;
  signerRole: string;
  signedOn: string;
  comment: string;
}

export interface AuditTrailEntry {
  id: string;
  periodId: string;
  ts: string;
  actorId: string;
  actorName: string;
  type:
    | "task.complete"
    | "task.reopen"
    | "rec.review"
    | "rec.sign"
    | "adjustment.post"
    | "adjustment.reverse"
    | "period.open"
    | "period.signoff"
    | "period.lock";
  summary: string;
  before: unknown;
  after: unknown;
}

export interface ClosePeriod {
  id: string;
  entityId: string;
  periodLabel: string; // e.g. "Apr 2026"
  periodIso: string; // YYYY-MM
  targetCloseDays: number;
  openedOn: string;
  targetCloseOn: string;
  actualCloseOn: string | null;
  status: ClosePeriodStatus;
  locked: boolean;
}

interface CloseState {
  users: CloseUser[];
  periods: ClosePeriod[];
  tasks: CloseTask[];
  recs: Reconciliation[];
  adjustments: AdjustingEntry[];
  signOffs: SignOff[];
  audit: AuditTrailEntry[];
}

// ────────────────────────── Users (signers + preparers) ──────────────────────────
const USERS: CloseUser[] = [
  { id: "u_yara_n", name: "Yara Nasser", role: "Founding Partner", partnerTier: true },
  { id: "u_layla_m", name: "Layla Al-Mutairi", role: "KSA Managing Partner", partnerTier: true },
  { id: "u_faisal_a", name: "Faisal Al-Suwaidi", role: "UAE Managing Partner", partnerTier: true },
  { id: "u_omar_h", name: "Omar Habib", role: "Group Controller", partnerTier: false },
  { id: "u_nour_k", name: "Nour Kassem", role: "Senior Accountant", partnerTier: false },
  { id: "u_rami_s", name: "Rami Saadi", role: "AP Lead", partnerTier: false },
];

// ────────────────────────── Standard task library ──────────────────────────
interface TaskTemplate {
  code: string;
  title: string;
  /** Default day-offset from period close target. */
  dayOffset: number;
  ownerHint: "controller" | "senior" | "ap" | "partner";
  dependsOnCodes?: string[];
}

const STANDARD_LIBRARY: TaskTemplate[] = [
  { code: "T01", title: "Cut-off: stop sub-ledger postings", dayOffset: 1, ownerHint: "controller" },
  { code: "T02", title: "Bank statements imported & reviewed", dayOffset: 2, ownerHint: "senior" },
  { code: "T03", title: "AR sub-ledger reconciled to control account", dayOffset: 3, ownerHint: "senior", dependsOnCodes: ["T02"] },
  { code: "T04", title: "AP sub-ledger reconciled (3-way match swept)", dayOffset: 3, ownerHint: "ap", dependsOnCodes: ["T02"] },
  { code: "T05", title: "Inter-company balances matched & confirmed", dayOffset: 4, ownerHint: "controller", dependsOnCodes: ["T03", "T04"] },
  { code: "T06", title: "Payroll journal posted & reconciled", dayOffset: 4, ownerHint: "senior" },
  { code: "T07", title: "VAT control account reconciled", dayOffset: 5, ownerHint: "controller", dependsOnCodes: ["T03", "T04"] },
  { code: "T08", title: "Accruals & deferrals posted (revenue, opex)", dayOffset: 5, ownerHint: "controller", dependsOnCodes: ["T05"] },
  { code: "T09", title: "FX revaluation run on monetary balances", dayOffset: 5, ownerHint: "senior", dependsOnCodes: ["T08"] },
  { code: "T10", title: "Trial balance reviewed & flux explained", dayOffset: 6, ownerHint: "controller", dependsOnCodes: ["T08", "T09"] },
  { code: "T11", title: "Period reviewed by managing partner", dayOffset: 7, ownerHint: "partner", dependsOnCodes: ["T10"] },
  { code: "T12", title: "Two-partner sign-off & period lock", dayOffset: 7, ownerHint: "partner", dependsOnCodes: ["T11"] },
];

function ownerFor(hint: TaskTemplate["ownerHint"], entityId: string): string {
  switch (hint) {
    case "ap": return "u_rami_s";
    case "senior": return "u_nour_k";
    case "controller": return "u_omar_h";
    case "partner":
      if (entityId === "fe_aico_ksa") return "u_layla_m";
      if (entityId === "fe_aico_uae") return "u_faisal_a";
      return "u_yara_n";
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildTasks(period: ClosePeriod): CloseTask[] {
  const open = period.openedOn;
  return STANDARD_LIBRARY.map((t) => {
    const code = t.code;
    return {
      id: `${period.id}_${code}`,
      periodId: period.id,
      code,
      title: t.title,
      ownerId: ownerFor(t.ownerHint, period.entityId),
      dueDate: addDays(open, t.dayOffset),
      dependsOn: (t.dependsOnCodes ?? []).map((c) => `${period.id}_${c}`),
      status: "pending",
      evidenceLink: null,
      preparedById: null,
      reviewedById: null,
      completedOn: null,
    };
  });
}

// ────────────────────────── Seed periods ──────────────────────────
// Three entities, three different close states (per task spec).
//
//   Cognirise KSA (fe_aico_ksa): May 2026 — mid-close, several tasks open,
//     two reconciliations unsigned.
//   Cognirise Group UK (fe_aico_uk): Apr 2026 — fully closed and signed.
//   Cognirise UAE DIFC (fe_aico_uae): May 2026 — not yet started.
//
// Other entities (Abu Dhabi branch, NEOM JV) don't have an open close
// period in this seed; they'll show "no period open" on the dashboard.

const PERIODS: ClosePeriod[] = [
  {
    id: "cp_ksa_2026_05",
    entityId: "fe_aico_ksa",
    periodLabel: "May 2026",
    periodIso: "2026-05",
    targetCloseDays: 7,
    openedOn: "2026-05-31",
    targetCloseOn: "2026-06-07",
    actualCloseOn: null,
    status: "in_progress",
    locked: false,
  },
  {
    id: "cp_uk_2026_04",
    entityId: "fe_aico_uk",
    periodLabel: "Apr 2026",
    periodIso: "2026-04",
    targetCloseDays: 7,
    openedOn: "2026-04-30",
    targetCloseOn: "2026-05-07",
    actualCloseOn: "2026-05-06",
    status: "signed",
    locked: true,
  },
  {
    id: "cp_uae_2026_05",
    entityId: "fe_aico_uae",
    periodLabel: "May 2026",
    periodIso: "2026-05",
    targetCloseDays: 7,
    openedOn: "2026-05-31",
    targetCloseOn: "2026-06-07",
    actualCloseOn: null,
    status: "not_started",
    locked: false,
  },
];

function tasks(): CloseTask[] {
  const all: CloseTask[] = [];
  for (const p of PERIODS) all.push(...buildTasks(p));

  // KSA mid-close — mark T01..T06 done, T07 in_progress
  const ksaDoneCodes = new Set(["T01", "T02", "T03", "T04", "T05", "T06"]);
  for (const t of all) {
    if (t.periodId !== "cp_ksa_2026_05") continue;
    if (ksaDoneCodes.has(t.code)) {
      t.status = "done";
      t.completedOn = addDays("2026-05-31", parseInt(t.code.slice(1), 10));
      t.preparedById = t.ownerId;
      t.reviewedById = "u_omar_h";
      t.evidenceLink = `evidence://close/ksa/2026-05/${t.code.toLowerCase()}.pdf`;
    } else if (t.code === "T07") {
      t.status = "in_progress";
      t.preparedById = t.ownerId;
    }
  }

  // UK fully closed — mark all done
  for (const t of all) {
    if (t.periodId !== "cp_uk_2026_04") continue;
    t.status = "done";
    t.completedOn = addDays("2026-04-30", parseInt(t.code.slice(1), 10));
    t.preparedById = t.ownerId;
    t.reviewedById = "u_omar_h";
    t.evidenceLink = `evidence://close/uk/2026-04/${t.code.toLowerCase()}.pdf`;
  }

  // UAE not started — leave all pending
  return all;
}

function recs(): Reconciliation[] {
  return [
    // KSA — six recs; bank+AR+payroll+VAT signed, AP+IC remain in_review (the two unsigned recs blocking sign-off)
    {
      id: "rec_ksa_bank", periodId: "cp_ksa_2026_05", controlAccount: "bank",
      label: "SNB operating cash", currency: "SAR",
      ledgerBalance: 4_812_330.45, sourceBalance: 4_812_330.45, sourceLabel: "SNB statement 2026-05-31",
      items: [], preparedById: "u_nour_k", reviewedById: "u_omar_h",
      status: "signed", signedOn: "2026-06-02T10:14:00Z",
    },
    {
      id: "rec_ksa_ar", periodId: "cp_ksa_2026_05", controlAccount: "ar",
      label: "AR control vs sub-ledger", currency: "SAR",
      ledgerBalance: 2_104_220.00, sourceBalance: 2_104_220.00, sourceLabel: "AR aging 2026-05-31",
      items: [], preparedById: "u_nour_k", reviewedById: "u_omar_h",
      status: "signed", signedOn: "2026-06-03T09:02:00Z",
    },
    {
      id: "rec_ksa_ap", periodId: "cp_ksa_2026_05", controlAccount: "ap",
      label: "AP control vs vendor sub-ledger", currency: "SAR",
      ledgerBalance: 988_410.20, sourceBalance: 991_690.20, sourceLabel: "AP aging 2026-05-31",
      items: [
        { id: "ri_ap_1", description: "Vendor invoice posted twice — to be reversed", amount: -3_280.00 },
      ],
      preparedById: "u_rami_s", reviewedById: null,
      status: "in_review", signedOn: null,
    },
    {
      id: "rec_ksa_ic", periodId: "cp_ksa_2026_05", controlAccount: "ic",
      label: "IC with Cognirise UK + UAE", currency: "SAR",
      ledgerBalance: 612_500.00, sourceBalance: 605_900.00, sourceLabel: "IC matching ledger",
      items: [
        { id: "ri_ic_1", description: "FX timing diff on May IC service fee invoice", amount: 6_600.00 },
      ],
      preparedById: "u_omar_h", reviewedById: null,
      status: "in_review", signedOn: null,
    },
    {
      id: "rec_ksa_payroll", periodId: "cp_ksa_2026_05", controlAccount: "payroll",
      label: "Payroll clearing — Riyad Bank", currency: "SAR",
      ledgerBalance: 1_842_010.00, sourceBalance: 1_842_010.00, sourceLabel: "Payroll register 2026-05",
      items: [], preparedById: "u_nour_k", reviewedById: "u_omar_h",
      status: "signed", signedOn: "2026-06-03T11:20:00Z",
    },
    {
      id: "rec_ksa_vat", periodId: "cp_ksa_2026_05", controlAccount: "vat",
      label: "VAT control (output – input)", currency: "SAR",
      ledgerBalance: 318_445.50, sourceBalance: 318_445.50, sourceLabel: "ZATCA Phase-2 returns view",
      items: [], preparedById: "u_nour_k", reviewedById: "u_omar_h",
      status: "signed", signedOn: "2026-06-03T11:25:00Z",
    },

    // UK — all signed
    {
      id: "rec_uk_bank", periodId: "cp_uk_2026_04", controlAccount: "bank",
      label: "Barclays operating cash", currency: "GBP",
      ledgerBalance: 1_412_080.00, sourceBalance: 1_412_080.00, sourceLabel: "Barclays statement 2026-04-30",
      items: [], preparedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "signed", signedOn: "2026-05-04T11:00:00Z",
    },
    {
      id: "rec_uk_ar", periodId: "cp_uk_2026_04", controlAccount: "ar",
      label: "AR control vs sub-ledger", currency: "GBP",
      ledgerBalance: 246_900.00, sourceBalance: 246_900.00, sourceLabel: "AR aging 2026-04-30",
      items: [], preparedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "signed", signedOn: "2026-05-04T11:05:00Z",
    },
    {
      id: "rec_uk_ic", periodId: "cp_uk_2026_04", controlAccount: "ic",
      label: "IC with KSA + UAE subsidiaries", currency: "GBP",
      ledgerBalance: 88_400.00, sourceBalance: 88_400.00, sourceLabel: "IC matching ledger",
      items: [], preparedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "signed", signedOn: "2026-05-05T08:30:00Z",
    },
    {
      id: "rec_uk_vat", periodId: "cp_uk_2026_04", controlAccount: "vat",
      label: "HMRC VAT control", currency: "GBP",
      ledgerBalance: 41_220.00, sourceBalance: 41_220.00, sourceLabel: "HMRC MTD return view",
      items: [], preparedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "signed", signedOn: "2026-05-05T08:35:00Z",
    },
    {
      id: "rec_uk_ap", periodId: "cp_uk_2026_04", controlAccount: "ap",
      label: "AP control vs sub-ledger", currency: "GBP",
      ledgerBalance: 132_540.00, sourceBalance: 132_540.00, sourceLabel: "AP aging 2026-04-30",
      items: [], preparedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "signed", signedOn: "2026-05-05T08:40:00Z",
    },
    {
      id: "rec_uk_payroll", periodId: "cp_uk_2026_04", controlAccount: "payroll",
      label: "PAYE/NI control", currency: "GBP",
      ledgerBalance: 28_460.00, sourceBalance: 28_460.00, sourceLabel: "HMRC PAYE return 2026-04",
      items: [], preparedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "signed", signedOn: "2026-05-05T08:45:00Z",
    },
  ];
}

function adjustments(): AdjustingEntry[] {
  return [
    // KSA — two posted accruals, one FX reval draft
    {
      id: "adj_ksa_1", periodId: "cp_ksa_2026_05", kind: "accrual",
      narrative: "Accrue May utilities (Riyadh office, invoice arrives in June)",
      debitAccount: "6210 · Utilities", creditAccount: "2110 · Accrued expenses",
      amount: 18_400, currency: "SAR",
      postedById: "u_nour_k", reviewedById: "u_omar_h",
      status: "posted", postedOn: "2026-06-03T13:20:00Z",
    },
    {
      id: "adj_ksa_2", periodId: "cp_ksa_2026_05", kind: "deferral",
      narrative: "Defer 4 months of insurance prepayment (May–Aug)",
      debitAccount: "1310 · Prepayments", creditAccount: "6310 · Insurance",
      amount: 96_000, currency: "SAR",
      postedById: "u_nour_k", reviewedById: "u_omar_h",
      status: "posted", postedOn: "2026-06-03T13:24:00Z",
    },
    {
      id: "adj_ksa_3", periodId: "cp_ksa_2026_05", kind: "fx_reval",
      narrative: "FX reval on USD-denominated client receivable (Aramco SOW-12)",
      debitAccount: "1210 · AR — clients (FX)", creditAccount: "8110 · FX gain/loss",
      amount: 12_580, currency: "SAR",
      postedById: "u_nour_k", reviewedById: null,
      status: "draft", postedOn: null,
    },
    // UK — both posted and reviewed
    {
      id: "adj_uk_1", periodId: "cp_uk_2026_04", kind: "accrual",
      narrative: "Accrue Q1 board fees (paid in May)",
      debitAccount: "7110 · Board fees", creditAccount: "2110 · Accrued expenses",
      amount: 24_000, currency: "GBP",
      postedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "posted", postedOn: "2026-05-04T15:00:00Z",
    },
    {
      id: "adj_uk_2", periodId: "cp_uk_2026_04", kind: "fx_reval",
      narrative: "FX reval on SAR + AED IC balances",
      debitAccount: "8110 · FX gain/loss", creditAccount: "1410 · IC receivable",
      amount: 6_310, currency: "GBP",
      postedById: "u_omar_h", reviewedById: "u_yara_n",
      status: "posted", postedOn: "2026-05-04T15:05:00Z",
    },
  ];
}

function signOffs(): SignOff[] {
  return [
    // UK — fully signed by two distinct partners
    {
      id: "so_uk_1", periodId: "cp_uk_2026_04",
      signerId: "u_yara_n", signerName: "Yara Nasser", signerRole: "Founding Partner",
      signedOn: "2026-05-06T09:00:00Z",
      comment: "Reviewed P&L flux, IC matched, VAT return filed. Period locked.",
    },
    {
      id: "so_uk_2", periodId: "cp_uk_2026_04",
      signerId: "u_layla_m", signerName: "Layla Al-Mutairi", signerRole: "KSA Managing Partner",
      signedOn: "2026-05-06T09:05:00Z",
      comment: "Group sign-off. Trial balance ties to sub-ledgers; IC eliminated.",
    },
  ];
}

function audit(): AuditTrailEntry[] {
  const out: AuditTrailEntry[] = [];
  // KSA — completed tasks + signed recs + posted adjustments
  const ksaDoneCodes = ["T01", "T02", "T03", "T04", "T05", "T06"];
  ksaDoneCodes.forEach((code, i) => {
    out.push({
      id: `aud_ksa_t_${code}`, periodId: "cp_ksa_2026_05",
      ts: `2026-06-0${(i + 1)}T10:00:00Z`,
      actorId: "u_omar_h", actorName: "Omar Habib", type: "task.complete",
      summary: `Task ${code} marked done`, before: { status: "pending" }, after: { status: "done" },
    });
  });
  out.push({
    id: "aud_ksa_rec_bank", periodId: "cp_ksa_2026_05", ts: "2026-06-02T10:14:00Z",
    actorId: "u_omar_h", actorName: "Omar Habib", type: "rec.sign",
    summary: "Signed bank reconciliation (SNB)", before: { status: "in_review" }, after: { status: "signed" },
  });
  out.push({
    id: "aud_ksa_rec_ar", periodId: "cp_ksa_2026_05", ts: "2026-06-03T09:02:00Z",
    actorId: "u_omar_h", actorName: "Omar Habib", type: "rec.sign",
    summary: "Signed AR reconciliation", before: { status: "in_review" }, after: { status: "signed" },
  });
  out.push({
    id: "aud_ksa_adj_1", periodId: "cp_ksa_2026_05", ts: "2026-06-03T13:20:00Z",
    actorId: "u_nour_k", actorName: "Nour Kassem", type: "adjustment.post",
    summary: "Posted accrual: May utilities (SAR 18,400)", before: null, after: { status: "posted" },
  });
  out.push({
    id: "aud_ksa_adj_2", periodId: "cp_ksa_2026_05", ts: "2026-06-03T13:24:00Z",
    actorId: "u_nour_k", actorName: "Nour Kassem", type: "adjustment.post",
    summary: "Posted deferral: insurance prepayment (SAR 96,000)", before: null, after: { status: "posted" },
  });

  // UK — full close trail
  for (let i = 1; i <= 12; i++) {
    const code = `T${String(i).padStart(2, "0")}`;
    out.push({
      id: `aud_uk_t_${code}`, periodId: "cp_uk_2026_04",
      ts: `2026-05-0${Math.min(i, 6)}T11:0${i % 10}:00Z`,
      actorId: "u_omar_h", actorName: "Omar Habib", type: "task.complete",
      summary: `Task ${code} marked done`, before: { status: "pending" }, after: { status: "done" },
    });
  }
  const ukRecAudit: Array<[string, string]> = [
    ["rec_uk_bank", "2026-05-04T11:00:00Z"],
    ["rec_uk_ar", "2026-05-04T11:05:00Z"],
    ["rec_uk_ic", "2026-05-05T08:30:00Z"],
    ["rec_uk_vat", "2026-05-05T08:35:00Z"],
    ["rec_uk_ap", "2026-05-05T08:40:00Z"],
    ["rec_uk_payroll", "2026-05-05T08:45:00Z"],
  ];
  for (const [r, ts] of ukRecAudit) {
    out.push({
      id: `aud_uk_${r}`, periodId: "cp_uk_2026_04", ts,
      actorId: "u_omar_h", actorName: "Omar Habib", type: "rec.sign",
      summary: `Signed reconciliation ${r}`, before: { status: "in_review" }, after: { status: "signed" },
    });
  }
  out.push({
    id: "aud_uk_adj_1", periodId: "cp_uk_2026_04", ts: "2026-05-04T15:00:00Z",
    actorId: "u_omar_h", actorName: "Omar Habib", type: "adjustment.post",
    summary: "Posted accrual: Q1 board fees (GBP 24,000)",
    before: null, after: { status: "posted" },
  });
  out.push({
    id: "aud_uk_adj_2", periodId: "cp_uk_2026_04", ts: "2026-05-04T15:05:00Z",
    actorId: "u_omar_h", actorName: "Omar Habib", type: "adjustment.post",
    summary: "Posted FX revaluation on IC balances (GBP 6,310)",
    before: null, after: { status: "posted" },
  });
  out.push({
    id: "aud_uk_so_1", periodId: "cp_uk_2026_04", ts: "2026-05-06T09:00:00Z",
    actorId: "u_yara_n", actorName: "Yara Nasser", type: "period.signoff",
    summary: "Partner sign-off (1 of 2)", before: { status: "in_review" }, after: { status: "signed" },
  });
  out.push({
    id: "aud_uk_so_2", periodId: "cp_uk_2026_04", ts: "2026-05-06T09:05:00Z",
    actorId: "u_layla_m", actorName: "Layla Al-Mutairi", type: "period.signoff",
    summary: "Partner sign-off (2 of 2) — period locked",
    before: { status: "in_review", locked: false }, after: { status: "signed", locked: true },
  });
  out.push({
    id: "aud_uk_lock", periodId: "cp_uk_2026_04", ts: "2026-05-06T09:05:01Z",
    actorId: "system", actorName: "System", type: "period.lock",
    summary: "Period Apr 2026 locked (immutable)", before: null, after: { locked: true },
  });

  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function buildInitialState(): CloseState {
  return {
    users: USERS,
    periods: structuredClone(PERIODS),
    tasks: tasks(),
    recs: recs(),
    adjustments: adjustments(),
    signOffs: signOffs(),
    audit: audit(),
  };
}

// ────────────────────────── Mutable store ──────────────────────────
let state: CloseState = buildInitialState();
const listeners = new Set<() => void>();

// Replace the top-level state reference on every notify so that
// `useSyncExternalStore` (which compares snapshots by identity) re-renders
// subscribers reliably, even though our nested mutations already produce
// fresh arrays for the slices that changed.
function notify() {
  state = { ...state };
  for (const fn of listeners) fn();
}

export function subscribeCloseStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getCloseSnapshot(): CloseState { return state; }

function nowIso(): string { return new Date().toISOString(); }
function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function pushAudit(entry: Omit<AuditTrailEntry, "id" | "ts">) {
  state.audit = [
    ...state.audit,
    { ...entry, id: uid("aud"), ts: nowIso() },
  ];
}

function recomputePeriodStatus(periodId: string) {
  const p = state.periods.find((x) => x.id === periodId);
  if (!p) return;
  if (p.locked) return; // signed periods are immutable
  const tasksFor = state.tasks.filter((t) => t.periodId === periodId);
  const allDone = tasksFor.every((t) => t.status === "done" || t.status === "na");
  const noneDone = tasksFor.every((t) => t.status === "pending");
  const recsFor = state.recs.filter((r) => r.periodId === periodId);
  const allRecsSigned = recsFor.every((r) => r.status === "signed");
  let next: ClosePeriodStatus = "in_progress";
  if (noneDone && recsFor.every((r) => r.status === "open")) next = "not_started";
  else if (allDone && allRecsSigned) next = "in_review";
  state.periods = state.periods.map((x) => x.id === periodId ? { ...x, status: next } : x);
}

// ────────────────────────── Mutations ──────────────────────────
export function completeTask(taskId: string, actor: CloseUser) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const period = state.periods.find((p) => p.id === t.periodId);
  if (!period || period.locked) return;
  // Enforce dependencies — all dependsOn must be done.
  for (const depId of t.dependsOn) {
    const dep = state.tasks.find((x) => x.id === depId);
    if (dep && dep.status !== "done" && dep.status !== "na") return;
  }
  const before = { status: t.status };
  state.tasks = state.tasks.map((x) => x.id === taskId
    ? {
      ...x,
      status: "done",
      completedOn: nowIso().slice(0, 10),
      preparedById: x.preparedById ?? actor.id,
      reviewedById: actor.id,
      evidenceLink: x.evidenceLink ?? `evidence://close/${period.id}/${x.code.toLowerCase()}.pdf`,
    }
    : x);
  pushAudit({
    periodId: t.periodId, actorId: actor.id, actorName: actor.name,
    type: "task.complete", summary: `Task ${t.code} marked done`,
    before, after: { status: "done" },
  });
  recomputePeriodStatus(t.periodId);
  notify();
}

export function reopenTask(taskId: string, actor: CloseUser) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const period = state.periods.find((p) => p.id === t.periodId);
  if (!period || period.locked) return;
  const before = { status: t.status };
  state.tasks = state.tasks.map((x) => x.id === taskId
    ? { ...x, status: "in_progress", completedOn: null, reviewedById: null }
    : x);
  pushAudit({
    periodId: t.periodId, actorId: actor.id, actorName: actor.name,
    type: "task.reopen", summary: `Task ${t.code} reopened`, before, after: { status: "in_progress" },
  });
  recomputePeriodStatus(t.periodId);
  notify();
}

export function reviewRec(recId: string, actor: CloseUser) {
  const r = state.recs.find((x) => x.id === recId);
  if (!r) return;
  const period = state.periods.find((p) => p.id === r.periodId);
  if (!period || period.locked) return;
  if (r.status !== "open") return;
  const before = { status: r.status };
  state.recs = state.recs.map((x) => x.id === recId ? { ...x, status: "in_review", preparedById: actor.id } : x);
  pushAudit({
    periodId: r.periodId, actorId: actor.id, actorName: actor.name,
    type: "rec.review", summary: `${r.label} marked in-review`,
    before, after: { status: "in_review" },
  });
  notify();
}

export function signRec(recId: string, actor: CloseUser) {
  const r = state.recs.find((x) => x.id === recId);
  if (!r) return;
  const period = state.periods.find((p) => p.id === r.periodId);
  if (!period || period.locked) return;
  if (r.status !== "in_review") return; // must transition open → in_review → signed
  if (r.preparedById === actor.id) return; // maker ≠ checker
  const before = { status: r.status };
  state.recs = state.recs.map((x) => x.id === recId
    ? { ...x, status: "signed", reviewedById: actor.id, signedOn: nowIso() }
    : x);
  pushAudit({
    periodId: r.periodId, actorId: actor.id, actorName: actor.name,
    type: "rec.sign", summary: `Signed reconciliation ${r.label}`,
    before, after: { status: "signed" },
  });
  recomputePeriodStatus(r.periodId);
  notify();
}

export function postAdjustment(adjId: string, actor: CloseUser) {
  const a = state.adjustments.find((x) => x.id === adjId);
  if (!a) return;
  const period = state.periods.find((p) => p.id === a.periodId);
  if (!period || period.locked) return;
  if (a.status !== "draft") return;
  if (a.postedById === actor.id) return; // maker ≠ checker
  const before = { status: a.status };
  state.adjustments = state.adjustments.map((x) => x.id === adjId
    ? { ...x, status: "posted", reviewedById: actor.id, postedOn: nowIso() }
    : x);
  pushAudit({
    periodId: a.periodId, actorId: actor.id, actorName: actor.name,
    type: "adjustment.post",
    summary: `Posted ${a.kind.replace("_", " ")}: ${a.narrative} (${a.currency} ${a.amount.toLocaleString()})`,
    before, after: { status: "posted" },
  });
  notify();
}

export interface SignPeriodResult {
  ok: boolean;
  reason?: string;
}

export function signPeriod(periodId: string, actor: CloseUser, comment: string): SignPeriodResult {
  const period = state.periods.find((p) => p.id === periodId);
  if (!period) return { ok: false, reason: "period_not_found" };
  if (period.locked) return { ok: false, reason: "already_locked" };
  if (!actor.partnerTier) return { ok: false, reason: "not_partner_tier" };
  // Pre-conditions: all tasks done, all recs signed, no draft adjustments.
  const tasksFor = state.tasks.filter((t) => t.periodId === periodId);
  if (!tasksFor.every((t) => t.status === "done" || t.status === "na")) {
    return { ok: false, reason: "open_tasks" };
  }
  const recsFor = state.recs.filter((r) => r.periodId === periodId);
  if (!recsFor.every((r) => r.status === "signed")) {
    return { ok: false, reason: "open_reconciliations" };
  }
  const adjsFor = state.adjustments.filter((a) => a.periodId === periodId);
  if (adjsFor.some((a) => a.status === "draft")) {
    return { ok: false, reason: "draft_adjustments" };
  }
  const existing = state.signOffs.filter((s) => s.periodId === periodId);
  if (existing.some((s) => s.signerId === actor.id)) {
    return { ok: false, reason: "duplicate_signer" };
  }
  // Two-partner sign-off requires two DISTINCT roles, not just two distinct
  // user IDs (e.g. you cannot have two "Founding Partner" sign-offs).
  if (existing.some((s) => s.signerRole === actor.role)) {
    return { ok: false, reason: "duplicate_role" };
  }
  state.signOffs = [
    ...state.signOffs,
    {
      id: uid("so"), periodId, signerId: actor.id, signerName: actor.name,
      signerRole: actor.role, signedOn: nowIso(), comment,
    },
  ];
  pushAudit({
    periodId, actorId: actor.id, actorName: actor.name, type: "period.signoff",
    summary: `Partner sign-off (${existing.length + 1} of 2)`,
    before: { signOffs: existing.length }, after: { signOffs: existing.length + 1 },
  });
  // Two distinct partners → lock.
  if (existing.length + 1 >= 2) {
    state.periods = state.periods.map((p) => p.id === periodId
      ? { ...p, status: "signed", locked: true, actualCloseOn: nowIso().slice(0, 10) }
      : p);
    pushAudit({
      periodId, actorId: "system", actorName: "System", type: "period.lock",
      summary: `Period ${period.periodLabel} locked (immutable)`,
      before: { locked: false }, after: { locked: true },
    });
  } else {
    state.periods = state.periods.map((p) => p.id === periodId ? { ...p, status: "in_review" } : p);
  }
  notify();
  return { ok: true };
}

export function openPeriod(periodId: string, actor: CloseUser) {
  const period = state.periods.find((p) => p.id === periodId);
  if (!period) return;
  if (period.status !== "not_started") return;
  state.periods = state.periods.map((p) => p.id === periodId ? { ...p, status: "in_progress" } : p);
  pushAudit({
    periodId, actorId: actor.id, actorName: actor.name, type: "period.open",
    summary: `Period ${period.periodLabel} opened`, before: { status: "not_started" }, after: { status: "in_progress" },
  });
  notify();
}

// ────────────────────────── Aggregations ──────────────────────────
export interface CloseStatusForEntity {
  entityId: string;
  period: ClosePeriod | null;
  daysToCloseTarget: number;
  daysToCloseActual: number | null;
  checklistPct: number;
  openRecs: number;
  totalRecs: number;
  signOffsCount: number;
  signOffsRequired: number;
  status: ClosePeriodStatus | "no_period";
}

export function statusForEntity(entityId: string): CloseStatusForEntity {
  // Sort periods deterministically by ISO period (newest first) so we always
  // pick the latest unlocked period, then fall back to the latest of any.
  const periods = state.periods
    .filter((p) => p.entityId === entityId)
    .slice()
    .sort((a, b) => (a.periodIso < b.periodIso ? 1 : a.periodIso > b.periodIso ? -1 : 0));
  const open = periods.find((p) => !p.locked) ?? periods[0] ?? null;
  if (!open) {
    return {
      entityId, period: null, daysToCloseTarget: 0, daysToCloseActual: null,
      checklistPct: 0, openRecs: 0, totalRecs: 0, signOffsCount: 0, signOffsRequired: 2,
      status: "no_period",
    };
  }
  const tasksFor = state.tasks.filter((t) => t.periodId === open.id);
  const done = tasksFor.filter((t) => t.status === "done" || t.status === "na").length;
  const checklistPct = tasksFor.length === 0 ? 0 : Math.round((done / tasksFor.length) * 100);
  const recsFor = state.recs.filter((r) => r.periodId === open.id);
  const openRecs = recsFor.filter((r) => r.status !== "signed").length;
  const signOffs = state.signOffs.filter((s) => s.periodId === open.id);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysToCloseTarget = open.targetCloseDays;
  const daysToCloseActual = open.actualCloseOn
    ? Math.round((new Date(open.actualCloseOn).getTime() - new Date(open.openedOn).getTime()) / dayMs)
    : null;
  return {
    entityId, period: open,
    daysToCloseTarget, daysToCloseActual,
    checklistPct, openRecs, totalRecs: recsFor.length,
    signOffsCount: signOffs.length, signOffsRequired: 2,
    status: open.status,
  };
}

export function listAllStatuses(entityIds: string[]): CloseStatusForEntity[] {
  return entityIds.map(statusForEntity);
}

export function userById(id: string): CloseUser | undefined {
  return state.users.find((u) => u.id === id);
}

/** Test-only — reset module state to seed (used by unit tests, not UI). */
export function _resetForTests() {
  state = buildInitialState();
  notify();
}
