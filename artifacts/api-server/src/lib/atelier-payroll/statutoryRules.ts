/**
 * Task #655 — Country statutory payroll rules registry (rules-as-code).
 *
 * Canonical, effective-dated statutory rules keyed by ISO-3166 alpha-2
 * country code, seeded in code for AE / SA / QA / TR. Everything here is
 * PURE (no DB, no IO) so formulas are unit-testable against hand-computed
 * examples. Entity-specific knobs (hazard class %, free-zone flags,
 * ceiling overrides) come in via the EntityStatutory override layer.
 *
 * Figures verified July 2026 (task spec); rate changes are appended as
 * new effective-dated versions — history is never edited.
 *
 * Modeled per country:
 *  - EOSB / gratuity / severance accrual bands + settlement adjustments
 *    (Saudi resignation scaling, Turkish resignation forfeiture, caps).
 *  - Social-security contribution schemes with eligibility (nationality +
 *    first-registration-date variants), wage basis, ceilings.
 *  - Recurring statutory filing obligations (WPS, GOSI/Mudad, GPSSA,
 *    GRSIA, MUHSGK) that materialize in the compliance calendar.
 */

import type { EntityStatutory } from "@workspace/db";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type WageBasis = "basic" | "basic_housing" | "gross";
export type SeparationReason =
  | "resignation"
  | "termination"
  | "end_of_contract"
  | "retirement"
  | "death"
  | "mutual";

export interface EosbBand {
  /** Service years this band covers, [fromYears, toYears). null = open. */
  fromYears: number;
  toYears: number | null;
  /** Days of wage accrued per year of service in this band. */
  daysPerYear: number;
}

export interface EosbRules {
  /** Wage used for the daily rate: "basic" (AE/QA) or "gross" (SA/TR). */
  wageBasis: "basic" | "gross";
  bands: EosbBand[];
  /** Below this service length nothing is payable on separation. */
  minServiceYears: number;
  /** Cap expressed in months of the basis wage (AE: 24). null = none. */
  capMonthsWage: number | null;
  /** TR kıdem: cap per full year of service (currency amount). */
  capPerYearAmount: number | null;
  /** SA Art. 85 — factor by total service on resignation. null = no scaling. */
  resignationScaling: Array<{ fromYears: number; toYears: number | null; factor: number }> | null;
  /** TR — ordinary resignation forfeits severance entirely. */
  resignationForfeits: boolean;
  /** Who accrues EOSB: expats only (AE/QA — nationals get pension) or all. */
  appliesTo: "expats" | "all";
  /** Days divisor for the daily wage (30 across all four countries). */
  daysBase: number;
}

export interface ContributionScheme {
  key: string;
  name: string;
  authority: string;
  /** nationals = entity-country nationals; gcc = any GCC national. */
  applies: "nationals" | "gcc_nationals" | "expats" | "all";
  base: WageBasis;
  employerPct: number;
  employeePct: number;
  /** Flat monthly amounts (e.g. UAE ILOE premium). */
  employerFixed?: number;
  employeeFixed?: number;
  /** Monthly contribution-base ceiling in entity currency. null = none. */
  ceilingMonthly: number | null;
  /** Scheme-registration-date window (old vs new law variants). */
  registeredFrom?: string; // inclusive ISO date
  registeredBefore?: string; // exclusive ISO date
  notes?: string;
}

export interface FilingObligation {
  key: string;
  name: string;
  authority: string;
  cadence: "monthly";
  /** Due day-of-month in the month FOLLOWING the wage period. */
  dueDay: number;
  description: string;
}

export interface CountryStatutoryVersion {
  /** This version applies to periods ending on/after this date. */
  effectiveFrom: string; // YYYY-MM-DD
  eosb: EosbRules | null;
  contributions: ContributionScheme[];
  filings: FilingObligation[];
}

export interface CountryStatutoryRules {
  country: string; // ISO alpha-2
  countryName: string;
  currency: string;
  versions: CountryStatutoryVersion[]; // ascending by effectiveFrom
}

const GCC = new Set(["AE", "SA", "QA", "KW", "BH", "OM"]);

// ──────────────────────────────────────────────────────────────
// Seeded registry (AE, SA, QA, TR)
// ──────────────────────────────────────────────────────────────

const AE: CountryStatutoryRules = {
  country: "AE",
  countryName: "United Arab Emirates",
  currency: "AED",
  versions: [
    {
      effectiveFrom: "2022-02-02", // Federal Decree-Law 33/2021 in force
      eosb: {
        wageBasis: "basic",
        bands: [
          { fromYears: 0, toYears: 5, daysPerYear: 21 },
          { fromYears: 5, toYears: null, daysPerYear: 30 },
        ],
        minServiceYears: 1,
        capMonthsWage: 24, // total gratuity ≤ 2 years' wage (Art. 51)
        capPerYearAmount: null,
        resignationScaling: null, // no forfeiture on resignation
        resignationForfeits: false,
        appliesTo: "expats",
        daysBase: 30,
      },
      contributions: [
        {
          key: "gpssa_pre2023",
          name: "GPSSA pension (pre-Oct-2023 joiners)",
          authority: "GPSSA",
          applies: "gcc_nationals",
          base: "gross",
          employerPct: 12.5,
          employeePct: 5,
          ceilingMonthly: 50_000,
          registeredBefore: "2023-10-01",
          notes: "Law 7/1999 rates; contribution salary capped AED 50k.",
        },
        {
          key: "gpssa_2023",
          name: "GPSSA pension (Law 57/2023 joiners)",
          authority: "GPSSA",
          applies: "gcc_nationals",
          base: "gross",
          employerPct: 15,
          employeePct: 11,
          ceilingMonthly: 70_000,
          registeredFrom: "2023-10-01",
          notes: "New-law rates for first-time registrants from Oct 2023.",
        },
        {
          key: "iloe",
          name: "ILOE unemployment insurance",
          authority: "MOHRE / ILOE",
          applies: "all",
          base: "gross",
          employerPct: 0,
          employeePct: 0,
          employeeFixed: 5, // AED/month, basic ≤ AED 16k tier (Cat A)
          ceilingMonthly: null,
          notes: "Employee-paid flat premium; AED 10/mo above AED 16k basic (override via employeePctOverride not needed — informational).",
        },
      ],
      filings: [
        { key: "wps_mohre", name: "WPS wage file", authority: "MOHRE", cadence: "monthly", dueDay: 15, description: "Submit the WPS salary information file through the bank/exchange within 15 days of the pay date." },
        { key: "gpssa_contrib", name: "GPSSA contributions", authority: "GPSSA", cadence: "monthly", dueDay: 15, description: "Pay pension contributions for national employees for the prior wage month." },
      ],
    },
  ],
};

const SA: CountryStatutoryRules = {
  country: "SA",
  countryName: "Saudi Arabia",
  currency: "SAR",
  versions: [
    {
      effectiveFrom: "2020-01-01",
      eosb: {
        wageBasis: "gross", // last wage incl. fixed allowances (Art. 84)
        bands: [
          { fromYears: 0, toYears: 5, daysPerYear: 15 }, // half month/yr
          { fromYears: 5, toYears: null, daysPerYear: 30 }, // full month/yr
        ],
        minServiceYears: 0,
        capMonthsWage: null,
        capPerYearAmount: null,
        resignationScaling: [
          { fromYears: 0, toYears: 2, factor: 0 },
          { fromYears: 2, toYears: 5, factor: 1 / 3 },
          { fromYears: 5, toYears: 10, factor: 2 / 3 },
          { fromYears: 10, toYears: null, factor: 1 },
        ],
        resignationForfeits: false,
        appliesTo: "all", // Saudi nationals also receive EOSB
        daysBase: 30,
      },
      contributions: [
        {
          key: "gosi_hazards",
          name: "GOSI occupational hazards",
          authority: "GOSI",
          applies: "all",
          base: "basic_housing",
          employerPct: 2,
          employeePct: 0,
          ceilingMonthly: 45_000,
        },
        {
          key: "gosi_saudi_pre2024",
          name: "GOSI annuities + SANED (pre-Jul-2024 registrants)",
          authority: "GOSI",
          applies: "nationals",
          base: "basic_housing",
          employerPct: 9.75, // pension 9 + SANED 0.75 (hazards separate)
          employeePct: 9.75,
          ceilingMonthly: 45_000,
          registeredBefore: "2024-07-01",
        },
        {
          key: "gosi_saudi_new",
          name: "GOSI annuities + SANED (new-law registrants)",
          authority: "GOSI",
          applies: "nationals",
          base: "basic_housing",
          employerPct: 9.75, // base year; +0.5pp/yr each July from 2025 (versioned below)
          employeePct: 9.75,
          ceilingMonthly: 45_000,
          registeredFrom: "2024-07-01",
        },
      ],
      filings: [
        { key: "gosi_monthly", name: "GOSI contributions", authority: "GOSI", cadence: "monthly", dueDay: 15, description: "Pay GOSI contributions for the prior wage month." },
        { key: "wps_mudad", name: "WPS via Mudad", authority: "MHRSD / Mudad", cadence: "monthly", dueDay: 10, description: "Upload and commit the wage protection file for the prior month." },
      ],
    },
    // New-law gradual pension increase: +0.5pp employer & employee each
    // July from 2025 for post-Jul-2024 first-time registrants.
    {
      effectiveFrom: "2025-07-01",
      eosb: null, // unchanged — inherit from prior version
      contributions: [
        {
          key: "gosi_saudi_new",
          name: "GOSI annuities + SANED (new-law registrants)",
          authority: "GOSI",
          applies: "nationals",
          base: "basic_housing",
          employerPct: 10.25,
          employeePct: 10.25,
          ceilingMonthly: 45_000,
          registeredFrom: "2024-07-01",
        },
      ],
      filings: [],
    },
    {
      effectiveFrom: "2026-07-01",
      eosb: null,
      contributions: [
        {
          key: "gosi_saudi_new",
          name: "GOSI annuities + SANED (new-law registrants)",
          authority: "GOSI",
          applies: "nationals",
          base: "basic_housing",
          employerPct: 10.75,
          employeePct: 10.75,
          ceilingMonthly: 45_000,
          registeredFrom: "2024-07-01",
        },
      ],
      filings: [],
    },
  ],
};

const QA: CountryStatutoryRules = {
  country: "QA",
  countryName: "Qatar",
  currency: "QAR",
  versions: [
    {
      effectiveFrom: "2020-01-01",
      eosb: {
        wageBasis: "basic", // last basic salary only (Art. 54)
        bands: [{ fromYears: 0, toYears: null, daysPerYear: 21 }],
        minServiceYears: 1,
        capMonthsWage: null,
        capPerYearAmount: null,
        resignationScaling: null, // same on resignation
        resignationForfeits: false,
        appliesTo: "expats", // Qatari/GCC nationals get GRSIA pension instead
        daysBase: 30,
      },
      contributions: [
        {
          key: "grsia",
          name: "GRSIA pension (Qatari/GCC nationals)",
          authority: "GRSIA",
          applies: "gcc_nationals",
          base: "basic_housing",
          employerPct: 14,
          employeePct: 7,
          ceilingMonthly: 100_000,
          notes: "Law 1/2022; housing allowance counted up to QAR 6k within base.",
        },
      ],
      filings: [
        { key: "wps_qa", name: "WPS wage file", authority: "MOL / Qatar Central Bank", cadence: "monthly", dueDay: 7, description: "Transmit salaries through the WPS within 7 days of the due date." },
        { key: "grsia_monthly", name: "GRSIA contributions", authority: "GRSIA", cadence: "monthly", dueDay: 15, description: "Pay pension contributions for Qatari employees for the prior wage month." },
      ],
    },
  ],
};

const TR: CountryStatutoryRules = {
  country: "TR",
  countryName: "Türkiye",
  currency: "TRY",
  versions: [
    {
      effectiveFrom: "2025-01-01",
      eosb: {
        wageBasis: "gross",
        bands: [{ fromYears: 0, toYears: null, daysPerYear: 30 }], // kıdem: 30 days/yr
        minServiceYears: 1,
        capMonthsWage: null,
        // Official kıdem ceiling per year of service (H1-2025 figure —
        // updated semi-annually; override per entity as it changes).
        capPerYearAmount: 46_655.43,
        resignationScaling: null,
        resignationForfeits: true, // not payable on ordinary resignation
        appliesTo: "all",
        daysBase: 30,
      },
      contributions: [
        {
          key: "sgk",
          name: "SGK social security + unemployment",
          authority: "SGK",
          applies: "all",
          base: "gross",
          // Employer: 20.75% SGK (long-term 11 + GSS 7.5 + short-term ~2.25
          // hazard-class dependent — override per entity) + 2% unemployment.
          employerPct: 22.75,
          // Employee: 14% SGK + 1% unemployment.
          employeePct: 15,
          // Ceiling = 7.5× gross minimum wage (2025: 7.5 × 26,005.50).
          ceilingMonthly: 195_041.25,
          notes: "Treasury incentive points not modeled; adjust via employerPctOverride.",
        },
      ],
      filings: [
        { key: "muhsgk", name: "MUHSGK combined declaration", authority: "GİB / SGK", cadence: "monthly", dueDay: 26, description: "File the combined withholding + SGK declaration for the prior wage month." },
        { key: "sgk_payment", name: "SGK contribution payment", authority: "SGK", cadence: "monthly", dueDay: 28, description: "Pay social-security contributions for the prior wage month." },
      ],
    },
    {
      // H2-2025 kıdem ceiling (Treasury circular of 07.07.2025).
      effectiveFrom: "2025-07-01",
      eosb: {
        wageBasis: "gross",
        bands: [{ fromYears: 0, toYears: null, daysPerYear: 30 }],
        minServiceYears: 1,
        capMonthsWage: null,
        capPerYearAmount: 53_919.68,
        resignationScaling: null,
        resignationForfeits: true,
        appliesTo: "all",
        daysBase: 30,
      },
      contributions: [],
      filings: [],
    },
    {
      // Official 2026 figures (verified Jan 2026):
      //  - kıdem ceiling H1-2026: TRY 64,948.77 (Treasury circular 06.01.2026)
      //  - SGK ceiling: 9 × 2026 gross minimum wage 33,030.00 = 297,270.00
      //    (multiplier raised from 7.5× to 9× by Law 7566, effective 2026-01-01)
      effectiveFrom: "2026-01-01",
      eosb: {
        wageBasis: "gross",
        bands: [{ fromYears: 0, toYears: null, daysPerYear: 30 }],
        minServiceYears: 1,
        capMonthsWage: null,
        capPerYearAmount: 64_948.77, // H1-2026; H2 update appended when announced
        resignationScaling: null,
        resignationForfeits: true,
        appliesTo: "all",
        daysBase: 30,
      },
      contributions: [
        {
          key: "sgk",
          name: "SGK social security + unemployment",
          authority: "SGK",
          applies: "all",
          base: "gross",
          employerPct: 22.75,
          employeePct: 15,
          ceilingMonthly: 297_270, // 9 × 33,030.00 (2026 minimum wage)
          notes: "9× minimum-wage ceiling from 2026 (Law 7566).",
        },
      ],
      filings: [],
    },
  ],
};

const REGISTRY: Record<string, CountryStatutoryRules> = { AE, SA, QA, TR };

export const STATUTORY_COUNTRIES = Object.keys(REGISTRY);

export function getCountryRules(country: string): CountryStatutoryRules | null {
  return REGISTRY[country.toUpperCase()] ?? null;
}

// ──────────────────────────────────────────────────────────────
// Effective-date resolution
// ──────────────────────────────────────────────────────────────

/** Resolve the merged rule set in force on `onDate` (YYYY-MM-DD). */
export interface ResolvedCountryRules {
  country: string;
  countryName: string;
  currency: string;
  effectiveFrom: string;
  eosb: EosbRules | null;
  contributions: ContributionScheme[];
  filings: FilingObligation[];
}

export function resolveRules(country: string, onDate: string): ResolvedCountryRules | null {
  const def = getCountryRules(country);
  if (!def) return null;
  const applicable = def.versions.filter((v) => v.effectiveFrom <= onDate);
  if (applicable.length === 0) return null;
  // Merge ascending: later versions override eosb (when non-null),
  // override contribution schemes by key, and append/override filings by key.
  let eosb: EosbRules | null = null;
  const schemes = new Map<string, ContributionScheme>();
  const filings = new Map<string, FilingObligation>();
  let effectiveFrom = applicable[0].effectiveFrom;
  for (const v of applicable) {
    effectiveFrom = v.effectiveFrom;
    if (v.eosb) eosb = v.eosb;
    for (const s of v.contributions) schemes.set(s.key, s);
    for (const f of v.filings) filings.set(f.key, f);
  }
  return {
    country: def.country,
    countryName: def.countryName,
    currency: def.currency,
    effectiveFrom,
    eosb,
    contributions: [...schemes.values()],
    filings: [...filings.values()],
  };
}

// ──────────────────────────────────────────────────────────────
// Service length
// ──────────────────────────────────────────────────────────────

export function serviceYearsBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return (end - start) / (365.25 * 86_400_000);
}

// ──────────────────────────────────────────────────────────────
// EOSB entitlement (pure formula, band-aware, pro-rata partial years)
// ──────────────────────────────────────────────────────────────

export interface EosbComputation {
  serviceYears: number;
  /** Wage the daily rate is derived from (basic or gross per rules). */
  wageMonthly: number;
  daysAccrued: number;
  grossEntitlement: number; // before caps/adjustments
  cappedEntitlement: number; // after caps, before separation adjustments
  capApplied: string | null;
}

export function computeEosbEntitlement(args: {
  rules: EosbRules;
  serviceYears: number;
  monthlyBasic: number;
  monthlyGross: number;
  /** EntityStatutory override for the TR per-year ceiling. */
  capPerYearOverride?: number | null;
}): EosbComputation {
  const { rules, serviceYears } = args;
  const wageMonthly = rules.wageBasis === "basic" ? args.monthlyBasic : args.monthlyGross;
  const daily = wageMonthly / rules.daysBase;
  let daysAccrued = 0;
  for (const b of rules.bands) {
    const upper = b.toYears ?? Infinity;
    const span = Math.max(0, Math.min(serviceYears, upper) - b.fromYears);
    daysAccrued += span * b.daysPerYear;
  }
  let gross = daysAccrued * daily;
  let capApplied: string | null = null;
  const capPerYear = args.capPerYearOverride ?? rules.capPerYearAmount;
  if (capPerYear != null) {
    // TR kıdem: each year of service pays min(30 days' gross, ceiling).
    const perYearUncapped = rules.bands[0].daysPerYear * daily;
    if (perYearUncapped > capPerYear) {
      gross = serviceYears * capPerYear;
      capApplied = `per-year ceiling ${capPerYear}`;
    }
  }
  let capped = gross;
  if (rules.capMonthsWage != null) {
    const cap = rules.capMonthsWage * wageMonthly;
    if (capped > cap) {
      capped = cap;
      capApplied = `${rules.capMonthsWage} months' wage cap`;
    }
  }
  return {
    serviceYears,
    wageMonthly,
    daysAccrued: round2(daysAccrued),
    grossEntitlement: round2(gross),
    cappedEntitlement: round2(capped),
    capApplied,
  };
}

/** Settlement: apply eligibility threshold + separation adjustments. */
export interface EosbSettlementComputation extends EosbComputation {
  reason: SeparationReason;
  adjustmentFactor: number;
  finalAmount: number;
  explanation: string;
}

export function computeEosbSettlement(args: {
  rules: EosbRules;
  serviceYears: number;
  monthlyBasic: number;
  monthlyGross: number;
  reason: SeparationReason;
  capPerYearOverride?: number | null;
}): EosbSettlementComputation {
  const base = computeEosbEntitlement(args);
  const { rules, serviceYears, reason } = args;
  let factor = 1;
  let explanation = "Full entitlement.";
  if (serviceYears < rules.minServiceYears) {
    factor = 0;
    explanation = `Service ${serviceYears.toFixed(2)}y below the ${rules.minServiceYears}y eligibility threshold.`;
  } else if (reason === "resignation" && rules.resignationForfeits) {
    factor = 0;
    explanation = "Ordinary resignation forfeits severance (kıdem) under Turkish law.";
  } else if (reason === "resignation" && rules.resignationScaling) {
    const band = rules.resignationScaling.find(
      (s) => serviceYears >= s.fromYears && (s.toYears == null || serviceYears < s.toYears),
    );
    factor = band?.factor ?? 1;
    explanation = `Resignation scaling: ${(factor * 100).toFixed(0)}% for ${serviceYears.toFixed(2)}y of service.`;
  }
  return {
    ...base,
    reason,
    adjustmentFactor: factor,
    finalAmount: round2(base.cappedEntitlement * factor),
    explanation,
  };
}

// ──────────────────────────────────────────────────────────────
// Contribution computation (eligibility routing + overrides)
// ──────────────────────────────────────────────────────────────

export interface ContributionResult {
  schemeKey: string;
  name: string;
  authority: string;
  base: number;
  employerPct: number;
  employeePct: number;
  employerAmount: number;
  employeeAmount: number;
  notes?: string | null;
}

function schemeCoversPerson(
  scheme: ContributionScheme,
  country: string,
  nationality: string | null,
  schemeRegisteredOn: string,
): boolean {
  const nat = (nationality ?? "").toUpperCase();
  if (scheme.applies === "nationals" && nat !== country) return false;
  if (scheme.applies === "gcc_nationals" && !GCC.has(nat)) return false;
  if (scheme.applies === "expats" && nat === country) return false;
  if (scheme.registeredFrom && schemeRegisteredOn < scheme.registeredFrom) return false;
  if (scheme.registeredBefore && schemeRegisteredOn >= scheme.registeredBefore) return false;
  return true;
}

export function computeContributions(args: {
  rules: ResolvedCountryRules;
  nationality: string | null;
  /** Registration date used for old/new-law routing (fallback: hire date). */
  schemeRegisteredOn: string;
  monthlyBasic: number;
  monthlyGross: number;
  housingAllowanceMonthly: number;
  overrides?: EntityStatutory | null;
}): ContributionResult[] {
  const out: ContributionResult[] = [];
  const optOut = new Set(args.overrides?.optOut ?? []);
  for (const scheme of args.rules.contributions) {
    if (optOut.has(scheme.key)) continue;
    if (!schemeCoversPerson(scheme, args.rules.country, args.nationality, args.schemeRegisteredOn)) continue;
    const rawBase =
      scheme.base === "basic"
        ? args.monthlyBasic
        : scheme.base === "basic_housing"
          ? args.monthlyBasic + args.housingAllowanceMonthly
          : args.monthlyGross;
    const ceiling = args.overrides?.ceilingOverride?.[scheme.key] ?? scheme.ceilingMonthly;
    const base = ceiling != null ? Math.min(rawBase, ceiling) : rawBase;
    const employerPct = args.overrides?.employerPctOverride?.[scheme.key] ?? scheme.employerPct;
    const employeePct = args.overrides?.employeePctOverride?.[scheme.key] ?? scheme.employeePct;
    const employerAmount = round2((base * employerPct) / 100 + (scheme.employerFixed ?? 0));
    const employeeAmount = round2((base * employeePct) / 100 + (scheme.employeeFixed ?? 0));
    if (employerAmount === 0 && employeeAmount === 0) continue;
    out.push({
      schemeKey: scheme.key,
      name: scheme.name,
      authority: scheme.authority,
      base: round2(base),
      employerPct,
      employeePct,
      employerAmount,
      employeeAmount,
      notes: scheme.notes ?? null,
    });
  }
  return out;
}

/** Does this person accrue EOSB under these rules? */
export function eosbApplies(rules: ResolvedCountryRules, nationality: string | null): boolean {
  if (!rules.eosb) return false;
  if (rules.eosb.appliesTo === "all") return true;
  const nat = (nationality ?? "").toUpperCase();
  // "expats": excluded when the person is covered by a pension scheme
  // instead — AE/QA: own nationals AND other GCC nationals (GCC unified
  // protection extension routes them to GPSSA/GRSIA, not gratuity).
  return !GCC.has(nat);
}

// ──────────────────────────────────────────────────────────────
// Filing calendar materialization (pure — caller persists)
// ──────────────────────────────────────────────────────────────

export interface FilingInstance {
  /** Deterministic idempotency key: stat_<entityId>_<obligation>_<period>. */
  sourceKey: string;
  obligationKey: string;
  kind: string;
  authority: string;
  description: string;
  /** Wage period being filed (YYYY-MM). */
  wagePeriod: string;
  dueOn: string; // YYYY-MM-DD
}

export function filingInstancesFor(args: {
  entityId: string;
  country: string;
  /** First wage period to materialize (YYYY-MM). */
  fromPeriod: string;
  /** Number of consecutive wage periods. */
  periods: number;
}): FilingInstance[] {
  const out: FilingInstance[] = [];
  let [y, m] = args.fromPeriod.split("-").map(Number);
  for (let i = 0; i < args.periods; i++) {
    const period = `${y}-${String(m).padStart(2, "0")}`;
    const rules = resolveRules(args.country, `${period}-28`);
    if (rules) {
      // Due in the month following the wage period.
      const dy = m === 12 ? y + 1 : y;
      const dm = m === 12 ? 1 : m + 1;
      for (const f of rules.filings) {
        out.push({
          sourceKey: `stat_${args.entityId}_${f.key}_${period}`,
          obligationKey: f.key,
          kind: `${f.name} — ${period}`,
          authority: f.authority,
          description: f.description,
          wagePeriod: period,
          dueOn: `${dy}-${String(dm).padStart(2, "0")}-${String(f.dueDay).padStart(2, "0")}`,
        });
      }
    }
    if (m === 12) { y++; m = 1; } else m++;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
