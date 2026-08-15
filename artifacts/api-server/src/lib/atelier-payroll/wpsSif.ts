/**
 * Task #1136 — UAE WPS SIF builder (pure, deterministic, DB-free).
 *
 * Generates a MOHRE-format Salary Information File from a payroll run's
 * lines so approved AE payroll is payable through the employer's WPS agent
 * bank (Wio). The file is a CSV with:
 *
 *   EDR — one Employee Detail Record per paid employee:
 *     EDR,<14-digit MOHRE Person ID>,<9-digit agent-bank routing code>,
 *     <IBAN>,<pay start DD/MM/YYYY>,<pay end DD/MM/YYYY>,<days paid>,
 *     <income fixed 2dp>,<income variable 2dp>,<leave days>,<employee name ≤40>
 *   SCR — one Salary Control Record (last line):
 *     SCR,<13-digit Employer Unique ID>,<employer agent-bank routing>,
 *     <file creation DD/MM/YYYY>,<file creation HHMMSS>,<salary month MMYYYY>,
 *     <EDR count>,<total salary 2dp>,AED,<reference>
 *
 * Filename convention: <EmployerUniqueID><DDMMYYYY><HHMMSS>.SIF
 *
 * Scope rules (enforced here, surfaced by the routes):
 *  - Only MOHRE-registered AE entities produce a file. DIFC/ADGM free-zone
 *    entities (per the legal-entity registry) and entities flagged
 *    `wps.applicable === false` are refused with an explanation — never a
 *    silently invalid file.
 *  - Emirati/GCC nationals are INCLUDED with their bank details like any
 *    other employee; their GPSSA pension remittance stays a separate filing
 *    line in the statutory register, never a SIF record (net pay in the run
 *    already reflects the employee withholding).
 *  - Validation BLOCKS generation when any included employee is missing
 *    IBAN, MOHRE Person ID or bank routing data — listing exactly who/what.
 *
 * Bank handoff: the generated file is uploaded manually through the Wio
 * business portal for now. This module is deliberately isolated (pure
 * input → file content) so a future Wio API integration can replace the
 * delivery step without touching the format logic.
 */

export interface WpsEntityConfig {
  entityId: string;
  name: string;
  /** ISO-3166 alpha-2. */
  country: string;
  /** From the legal-entity registry statutory jsonb. */
  freeZoneRegime: string | null;
  wps: {
    applicable?: boolean | null;
    employerUniqueId?: string | null;
    agentBankRoutingCode?: string | null;
  } | null;
}

export interface WpsApplicability {
  applicable: boolean;
  /** Human-readable explanation when NOT applicable. */
  reason: string | null;
}

/**
 * Whether this entity's payroll must go through MOHRE WPS at all.
 * Missing employer config does NOT make an entity exempt — that is a
 * blocking validation problem, reported by buildWpsSif instead.
 */
export function wpsApplicability(entity: WpsEntityConfig): WpsApplicability {
  if (entity.country !== "AE") {
    return { applicable: false, reason: `${entity.name} is not a UAE entity (${entity.country}) — MOHRE WPS does not apply.` };
  }
  const regime = (entity.freeZoneRegime ?? "").toUpperCase();
  if (/\b(DIFC|ADGM)\b/.test(regime)) {
    return {
      applicable: false,
      reason: `${entity.name} is registered in ${regime.includes("DIFC") ? "DIFC" : "ADGM"} — a WPS-exempt financial free zone (employees are paid outside MOHRE WPS; DEWS/It's-style schemes apply). No SIF file is generated for this entity.`,
    };
  }
  if (entity.wps?.applicable === false) {
    return {
      applicable: false,
      reason: `${entity.name} is flagged WPS-exempt in the legal-entity registry — no SIF file is generated. Clear the flag in the entity's statutory config if this is wrong.`,
    };
  }
  return { applicable: true, reason: null };
}

export interface WpsEmployeeInput {
  employeeId: string;
  name: string;
  mohrePersonId: string | null;
  bankRoutingCode: string | null;
  iban: string | null;
  /** Net pay after deductions/advances — the amount actually disbursed. */
  netPay: number;
  /** Calendar days in the period month. */
  daysInMonth: number;
  /** Employed days minus unpaid leave (leaver partial months < daysInMonth). */
  payableDays: number;
  unpaidLeaveDays: number;
}

export interface SifProblem {
  employeeId: string | null;
  name: string | null;
  field: string;
  message: string;
}

export interface BuildWpsSifArgs {
  entity: WpsEntityConfig;
  /** Wage period YYYY-MM. */
  periodLabel: string;
  employees: WpsEmployeeInput[];
  /** File creation timestamp — injected for determinism. */
  generatedAt: Date;
  /** Optional SCR reference (defaults to the salary month). */
  reference?: string;
}

export type BuildWpsSifResult =
  | {
      ok: true;
      fileName: string;
      content: string;
      recordCount: number;
      totalNetPay: number;
      currency: "AED";
      employerUniqueId: string;
    }
  | { ok: false; problems: SifProblem[] };

const IBAN_AE_RE = /^AE\d{21}$/;

/** ISO 13616 MOD-97 check (digits-only after AE prefix, so no letter mapping
 * beyond the country code is needed for UAE IBANs). */
function ibanMod97Ok(iban: string): boolean {
  // Move first 4 chars to the end, map letters A=10..Z=35, mod 97 must be 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const v = code >= 65 ? String(code - 55) : ch; // A-Z → 10..35
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** DD/MM/YYYY from a Date (UTC). */
function ddmmyyyy(d: Date): string {
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Uppercase-ASCII, CSV-safe employee name, truncated to 40 chars. */
export function sifName(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^\x20-\x7E]/g, " ") // non-ASCII → space
    .replace(/[,"\r\n]/g, " ") // CSV metacharacters
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return ascii.slice(0, 40).trim();
}

function amount(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Last calendar day of a YYYY-MM period. */
function lastDayOf(periodLabel: string): number {
  const [y, m] = periodLabel.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function buildWpsSif(args: BuildWpsSifArgs): BuildWpsSifResult {
  const problems: SifProblem[] = [];
  const app = wpsApplicability(args.entity);
  if (!app.applicable) {
    problems.push({ employeeId: null, name: null, field: "entity", message: app.reason ?? "entity is not WPS-applicable" });
    return { ok: false, problems };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.periodLabel)) {
    problems.push({ employeeId: null, name: null, field: "periodLabel", message: `invalid wage period "${args.periodLabel}" — YYYY-MM required` });
  }
  const employerId = (args.entity.wps?.employerUniqueId ?? "").trim();
  const employerRouting = (args.entity.wps?.agentBankRoutingCode ?? "").trim();
  if (!/^\d{13}$/.test(employerId)) {
    problems.push({
      employeeId: null, name: null, field: "employerUniqueId",
      message: `${args.entity.name} has no valid 13-digit MOHRE Employer Unique ID — set it in the entity's statutory WPS config.`,
    });
  }
  if (!/^\d{9}$/.test(employerRouting)) {
    problems.push({
      employeeId: null, name: null, field: "agentBankRoutingCode",
      message: `${args.entity.name} has no valid 9-digit agent-bank routing code (Wio) — set it in the entity's statutory WPS config.`,
    });
  }
  if (args.employees.length === 0) {
    problems.push({ employeeId: null, name: null, field: "employees", message: "the run has no payable employee lines — nothing to include in the SIF." });
  }

  for (const e of args.employees) {
    const who = { employeeId: e.employeeId, name: e.name };
    if (!e.mohrePersonId || !/^\d{14}$/.test(e.mohrePersonId.trim())) {
      problems.push({ ...who, field: "mohrePersonId", message: "missing/invalid 14-digit MOHRE Person ID (labour card) — set it via the payroll fields editor." });
    }
    if (!e.bankRoutingCode || !/^\d{9}$/.test(e.bankRoutingCode.trim())) {
      problems.push({ ...who, field: "bankRoutingCode", message: "missing/invalid 9-digit agent-bank routing code — set it via the payroll fields editor." });
    }
    const iban = (e.iban ?? "").replace(/\s+/g, "").toUpperCase();
    if (!IBAN_AE_RE.test(iban) || !ibanMod97Ok(iban)) {
      problems.push({ ...who, field: "iban", message: "missing/invalid UAE IBAN (AE + 21 digits with valid checksum) — bank details change only via the HR-approved pay-hub flow." });
    }
    if (!(e.netPay > 0)) {
      problems.push({ ...who, field: "netPay", message: `net pay is ${e.netPay} — every SIF record must disburse a positive amount.` });
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const [y, m] = args.periodLabel.split("-").map(Number);
  const periodStart = `01/${two(m)}/${y}`;
  const periodEnd = `${two(lastDayOf(args.periodLabel))}/${two(m)}/${y}`;
  const salaryMonth = `${two(m)}${y}`;
  const d = args.generatedAt;
  const fileDate = ddmmyyyy(d);
  const fileTime = `${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
  const fileName = `${employerId}${two(d.getUTCDate())}${two(d.getUTCMonth() + 1)}${d.getUTCFullYear()}${fileTime}.SIF`;

  // Deterministic record order: MOHRE Person ID ascending.
  const rows = [...args.employees].sort((a, b) => a.mohrePersonId!.localeCompare(b.mohrePersonId!));
  const lines: string[] = [];
  let total = 0;
  for (const e of rows) {
    const iban = (e.iban ?? "").replace(/\s+/g, "").toUpperCase();
    total = Math.round((total + e.netPay) * 100) / 100;
    lines.push([
      "EDR",
      e.mohrePersonId!.trim(),
      e.bankRoutingCode!.trim(),
      iban,
      periodStart,
      periodEnd,
      String(Math.round(e.payableDays)),
      amount(e.netPay), // income fixed = net disbursement
      amount(0), // income variable — none in the statutory engine
      String(Math.round(e.unpaidLeaveDays)),
      sifName(e.name),
    ].join(","));
  }
  lines.push([
    "SCR",
    employerId,
    employerRouting,
    fileDate,
    fileTime,
    salaryMonth,
    String(rows.length),
    amount(total),
    "AED",
    (args.reference ?? `PAYROLL ${args.periodLabel}`).slice(0, 30),
  ].join(","));

  return {
    ok: true,
    fileName,
    content: lines.join("\r\n") + "\r\n",
    recordCount: rows.length,
    totalNetPay: total,
    currency: "AED",
    employerUniqueId: employerId,
  };
}
