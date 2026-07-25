/**
 * Task #655 — pure statutory formula tests (no DB, no network).
 * Run: pnpm --filter api-server test:payroll-statutory
 */
import {
  resolveRules,
  computeEosbEntitlement,
  computeEosbSettlement,
  computeContributions,
  eosbApplies,
  filingInstancesFor,
} from "../../src/lib/atelier-payroll/statutoryRules";

let failures = 0;
let passed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}
function near(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps;
}

const today = "2026-07-24";

// ── AE gratuity ─────────────────────────────────────────────
{
  const ae = resolveRules("AE", today)!;
  check("AE rules resolve", !!ae && !!ae.eosb);
  // 7 years at AED 10k basic: 5y×21d + 2y×30d = 165 days × (10000/30) = 55,000
  const e = computeEosbEntitlement({ rules: ae.eosb!, serviceYears: 7, monthlyBasic: 10_000, monthlyGross: 15_000 });
  check("AE 7y @10k basic crosses 5y band → 55,000", near(e.cappedEntitlement, 55_000), e);
  check("AE uses basic wage (not gross)", near(e.wageMonthly, 10_000), e);
  // 30 years: 5×21 + 25×30 = 855d → 285,000, capped at 24 months = 240,000
  const cap = computeEosbEntitlement({ rules: ae.eosb!, serviceYears: 30, monthlyBasic: 10_000, monthlyGross: 10_000 });
  check("AE 30y capped at 24 months' wage (240,000)", near(cap.cappedEntitlement, 240_000) && cap.capApplied != null, cap);
  // Under 1 year → settlement pays nothing
  const s0 = computeEosbSettlement({ rules: ae.eosb!, serviceYears: 0.5, monthlyBasic: 10_000, monthlyGross: 10_000, reason: "termination" });
  check("AE <1y service → zero settlement", s0.finalAmount === 0 && s0.adjustmentFactor === 0, s0);
  // Resignation does NOT forfeit in AE
  const sr = computeEosbSettlement({ rules: ae.eosb!, serviceYears: 7, monthlyBasic: 10_000, monthlyGross: 10_000, reason: "resignation" });
  check("AE resignation pays full (55,000)", near(sr.finalAmount, 55_000) && sr.adjustmentFactor === 1, sr);
  // EOSB applies to expats only — GCC nationals route to pension instead
  check("AE national excluded from EOSB", eosbApplies(ae, "AE") === false);
  check("AE GCC national (SA) excluded from EOSB", eosbApplies(ae, "SA") === false);
  check("AE expat accrues EOSB", eosbApplies(ae, "IN") === true);
}

// ── SA EOSB + resignation scaling ───────────────────────────
{
  const sa = resolveRules("SA", today)!;
  // 10y at SAR 12k gross: 5×15 + 5×30 = 225d × 400 = 90,000
  const e = computeEosbEntitlement({ rules: sa.eosb!, serviceYears: 10, monthlyBasic: 8_000, monthlyGross: 12_000 });
  check("SA 10y @12k gross → 90,000", near(e.cappedEntitlement, 90_000), e);
  check("SA uses gross wage", near(e.wageMonthly, 12_000), e);
  // Resignation scaling (Art. 85)
  const r1 = computeEosbSettlement({ rules: sa.eosb!, serviceYears: 1.5, monthlyBasic: 8_000, monthlyGross: 12_000, reason: "resignation" });
  check("SA resignation <2y → nothing", r1.finalAmount === 0, r1);
  const r4 = computeEosbSettlement({ rules: sa.eosb!, serviceYears: 4, monthlyBasic: 8_000, monthlyGross: 12_000, reason: "resignation" });
  // 4×15 = 60d × 400 = 24,000 × 1/3 = 8,000
  check("SA resignation 4y → one third (8,000)", near(r4.finalAmount, 8_000), r4);
  const r7 = computeEosbSettlement({ rules: sa.eosb!, serviceYears: 7, monthlyBasic: 8_000, monthlyGross: 12_000, reason: "resignation" });
  // (5×15 + 2×30) = 135d × 400 = 54,000 × 2/3 = 36,000
  check("SA resignation 7y → two thirds (36,000)", near(r7.finalAmount, 36_000), r7);
  const r12 = computeEosbSettlement({ rules: sa.eosb!, serviceYears: 12, monthlyBasic: 8_000, monthlyGross: 12_000, reason: "resignation" });
  check("SA resignation ≥10y → full", r12.adjustmentFactor === 1, r12);
  const t4 = computeEosbSettlement({ rules: sa.eosb!, serviceYears: 4, monthlyBasic: 8_000, monthlyGross: 12_000, reason: "termination" });
  check("SA termination 4y → full (24,000)", near(t4.finalAmount, 24_000), t4);
  check("SA nationals also accrue EOSB", eosbApplies(sa, "SA") === true);
}

// ── QA gratuity ─────────────────────────────────────────────
{
  const qa = resolveRules("QA", today)!;
  // 5y at QAR 9k basic: 5×21 = 105d × 300 = 31,500
  const e = computeEosbEntitlement({ rules: qa.eosb!, serviceYears: 5, monthlyBasic: 9_000, monthlyGross: 14_000 });
  check("QA 5y @9k basic → 31,500", near(e.cappedEntitlement, 31_500), e);
  check("QA national excluded (GRSIA instead)", eosbApplies(qa, "QA") === false);
  check("QA GCC national (KW) excluded (GRSIA instead)", eosbApplies(qa, "KW") === false);
  check("QA expat accrues", eosbApplies(qa, "PH") === true);
}

// ── TR kıdem: forfeiture + per-year ceiling ─────────────────
{
  const tr = resolveRules("TR", today)!; // 2026 rules: kıdem ceiling 64,948.77
  // 3y at TRY 80k gross: 30d/yr = 80,000/yr > ceiling 64,948.77 → 3 × 64,948.77
  const e = computeEosbEntitlement({ rules: tr.eosb!, serviceYears: 3, monthlyBasic: 70_000, monthlyGross: 80_000 });
  check("TR per-year ceiling applied (194,846.31)", near(e.cappedEntitlement, 3 * 64_948.77) && e.capApplied != null, e);
  // Below ceiling: 3y at 30k gross → 90,000, no cap
  const low = computeEosbEntitlement({ rules: tr.eosb!, serviceYears: 3, monthlyBasic: 25_000, monthlyGross: 30_000 });
  check("TR below ceiling uncapped (90,000)", near(low.cappedEntitlement, 90_000) && low.capApplied == null, low);
  // Ceiling override (semi-annual update knob)
  const ov = computeEosbEntitlement({ rules: tr.eosb!, serviceYears: 2, monthlyBasic: 50_000, monthlyGross: 60_000, capPerYearOverride: 50_000 });
  check("TR ceiling override honoured (100,000)", near(ov.cappedEntitlement, 100_000), ov);
  // Resignation forfeits kıdem entirely
  const res = computeEosbSettlement({ rules: tr.eosb!, serviceYears: 3, monthlyBasic: 70_000, monthlyGross: 80_000, reason: "resignation" });
  check("TR resignation forfeits (0)", res.finalAmount === 0 && res.adjustmentFactor === 0, res);
  const term = computeEosbSettlement({ rules: tr.eosb!, serviceYears: 3, monthlyBasic: 70_000, monthlyGross: 80_000, reason: "termination" });
  check("TR termination pays capped amount", near(term.finalAmount, 3 * 64_948.77), term);
  const retire = computeEosbSettlement({ rules: tr.eosb!, serviceYears: 3, monthlyBasic: 25_000, monthlyGross: 30_000, reason: "retirement" });
  check("TR retirement pays (90,000)", near(retire.finalAmount, 90_000), retire);
  // Kıdem ceiling version history: H1-2025 → H2-2025 → H1-2026
  const tr25a = resolveRules("TR", "2025-06-30")!;
  const e25a = computeEosbEntitlement({ rules: tr25a.eosb!, serviceYears: 3, monthlyBasic: 70_000, monthlyGross: 80_000 });
  check("TR H1-2025 kıdem ceiling 46,655.43", near(e25a.cappedEntitlement, 3 * 46_655.43), e25a);
  const tr25b = resolveRules("TR", "2025-12-31")!;
  const e25b = computeEosbEntitlement({ rules: tr25b.eosb!, serviceYears: 3, monthlyBasic: 70_000, monthlyGross: 80_000 });
  check("TR H2-2025 kıdem ceiling 53,919.68", near(e25b.cappedEntitlement, 3 * 53_919.68), e25b);
}

// ── Contributions: AE GPSSA old/new law + ILOE ──────────────
{
  const ae = resolveRules("AE", today)!;
  // UAE national, pre-2023 registrant, gross 60k → capped at 50k: 12.5% / 5%
  const old = computeContributions({ rules: ae, nationality: "AE", schemeRegisteredOn: "2020-05-01", monthlyBasic: 40_000, monthlyGross: 60_000, housingAllowanceMonthly: 0 });
  const gpssaOld = old.find((c) => c.schemeKey === "gpssa_pre2023");
  check("AE pre-2023 GPSSA: employer 6,250 on 50k cap", !!gpssaOld && near(gpssaOld.employerAmount, 6_250) && near(gpssaOld.employeeAmount, 2_500), old);
  check("AE pre-2023 registrant NOT in new-law scheme", !old.some((c) => c.schemeKey === "gpssa_2023"));
  // New-law registrant (2024): 15% / 11% on 70k ceiling
  const nw = computeContributions({ rules: ae, nationality: "AE", schemeRegisteredOn: "2024-03-01", monthlyBasic: 40_000, monthlyGross: 60_000, housingAllowanceMonthly: 0 });
  const gpssaNew = nw.find((c) => c.schemeKey === "gpssa_2023");
  check("AE new-law GPSSA: 9,000 / 6,600 on 60k", !!gpssaNew && near(gpssaNew.employerAmount, 9_000) && near(gpssaNew.employeeAmount, 6_600), nw);
  // Expat: only ILOE flat AED 5 employee
  const expat = computeContributions({ rules: ae, nationality: "IN", schemeRegisteredOn: "2024-03-01", monthlyBasic: 10_000, monthlyGross: 15_000, housingAllowanceMonthly: 0 });
  check("AE expat: ILOE only (AED 5 employee)", expat.length === 1 && expat[0].schemeKey === "iloe" && near(expat[0].employeeAmount, 5) && expat[0].employerAmount === 0, expat);
  // GCC national (non-AE) in the UAE: GPSSA applies, not gratuity
  const gcc = computeContributions({ rules: ae, nationality: "SA", schemeRegisteredOn: "2024-03-01", monthlyBasic: 40_000, monthlyGross: 60_000, housingAllowanceMonthly: 0 });
  check("AE GCC national gets GPSSA pension", gcc.some((c) => c.schemeKey === "gpssa_2023"), gcc);
  // Opt-out override removes a scheme
  const opted = computeContributions({ rules: ae, nationality: "IN", schemeRegisteredOn: "2024-03-01", monthlyBasic: 10_000, monthlyGross: 15_000, housingAllowanceMonthly: 0, overrides: { optOut: ["iloe"] } });
  check("AE optOut override removes ILOE", opted.length === 0, opted);
}

// ── Contributions: QA GRSIA nationality matrix ──────────────
{
  const qa = resolveRules("QA", today)!;
  const args = { schemeRegisteredOn: "2023-01-01", monthlyBasic: 20_000, monthlyGross: 30_000, housingAllowanceMonthly: 5_000 };
  const qat = computeContributions({ rules: qa, nationality: "QA", ...args });
  check("QA national gets GRSIA (14% / 7%)", qat.some((c) => c.schemeKey === "grsia" && c.employerPct === 14 && c.employeePct === 7), qat);
  const gcc = computeContributions({ rules: qa, nationality: "BH", ...args });
  check("QA GCC national gets GRSIA", gcc.some((c) => c.schemeKey === "grsia"), gcc);
  const exp = computeContributions({ rules: qa, nationality: "PH", ...args });
  check("QA expat: no GRSIA", !exp.some((c) => c.schemeKey === "grsia"), exp);
}

// ── Contributions: SA GOSI version step-ups ─────────────────
{
  // New-law registrant rate steps: 9.75 → 10.25 (Jul 2025) → 10.75 (Jul 2026)
  const args = { nationality: "SA", schemeRegisteredOn: "2025-01-15", monthlyBasic: 10_000, monthlyGross: 14_000, housingAllowanceMonthly: 2_000 };
  const base = 12_000; // basic + housing
  const r2025a = computeContributions({ rules: resolveRules("SA", "2025-06-30")!, ...args });
  const r2025b = computeContributions({ rules: resolveRules("SA", "2025-07-31")!, ...args });
  const r2026 = computeContributions({ rules: resolveRules("SA", "2026-07-24")!, ...args });
  const pct = (rows: typeof r2025a) => rows.find((c) => c.schemeKey === "gosi_saudi_new")?.employerPct;
  check("GOSI new-law 9.75% before Jul 2025", pct(r2025a) === 9.75, r2025a);
  check("GOSI new-law 10.25% from Jul 2025", pct(r2025b) === 10.25, r2025b);
  check("GOSI new-law 10.75% from Jul 2026", pct(r2026) === 10.75, r2026);
  const gosi26 = r2026.find((c) => c.schemeKey === "gosi_saudi_new")!;
  check("GOSI base = basic+housing (12,000)", near(gosi26.base, base) && near(gosi26.employerAmount, base * 0.1075), gosi26);
  // Pre-2024 registrant stays on 9.75 in 2026
  const pre = computeContributions({ rules: resolveRules("SA", "2026-07-24")!, ...args, schemeRegisteredOn: "2022-01-01" });
  check("GOSI pre-2024 registrant stays 9.75%", pre.find((c) => c.schemeKey === "gosi_saudi_pre2024")?.employerPct === 9.75, pre);
  // Hazards applies to expats too
  const hazOnly = computeContributions({ rules: resolveRules("SA", "2026-07-24")!, ...args, nationality: "EG" });
  check("SA expat: hazards 2% only", hazOnly.length === 1 && hazOnly[0].schemeKey === "gosi_hazards" && near(hazOnly[0].employerAmount, base * 0.02), hazOnly);
}

// ── Contributions: TR SGK ceiling version step-up ───────────
{
  const args = { nationality: "TR", schemeRegisteredOn: "2024-01-01", monthlyBasic: 300_000, monthlyGross: 350_000, housingAllowanceMonthly: 0 };
  const sgk25 = computeContributions({ rules: resolveRules("TR", "2025-06-30")!, ...args }).find((c) => c.schemeKey === "sgk")!;
  const sgk26 = computeContributions({ rules: resolveRules("TR", "2026-06-30")!, ...args }).find((c) => c.schemeKey === "sgk")!;
  check("TR SGK 2025 ceiling 195,041.25", near(sgk25.base, 195_041.25) && near(sgk25.employerAmount, 195_041.25 * 0.2275), sgk25);
  check("TR SGK 2026 ceiling 297,270 (9 × 33,030)", near(sgk26.base, 297_270), sgk26);
  check("TR SGK employee 15% under ceiling", near(sgk26.employeeAmount, 297_270 * 0.15), sgk26);
  // Hazard-class employer override knob
  const oz = computeContributions({ rules: resolveRules("TR", "2026-06-30")!, ...args, overrides: { employerPctOverride: { sgk: 24.25 } } }).find((c) => c.schemeKey === "sgk")!;
  check("TR employer % override (hazard class)", oz.employerPct === 24.25 && near(oz.employerAmount, 297_270 * 0.2425), oz);
}

// ── Filing materialization: determinism + due dates ─────────
{
  const a = filingInstancesFor({ entityId: "ent_x1", country: "AE", fromPeriod: "2026-07", periods: 2 });
  const b = filingInstancesFor({ entityId: "ent_x1", country: "AE", fromPeriod: "2026-07", periods: 2 });
  check("AE filings deterministic (same keys)", JSON.stringify(a.map((f) => f.sourceKey)) === JSON.stringify(b.map((f) => f.sourceKey)), a.map((f) => f.sourceKey));
  const wps = a.find((f) => f.obligationKey === "wps_mohre" && f.wagePeriod === "2026-07")!;
  check("sourceKey shape stat_<entity>_<key>_<period>", wps.sourceKey === "stat_ent_x1_wps_mohre_2026-07", wps);
  check("AE WPS due 15th of following month", wps.dueOn === "2026-08-15", wps);
  // December wraps to January of next year
  const dec = filingInstancesFor({ entityId: "e2", country: "TR", fromPeriod: "2026-12", periods: 1 });
  const muh = dec.find((f) => f.obligationKey === "muhsgk")!;
  check("TR Dec filing due Jan 26 next year", muh.dueOn === "2027-01-26", muh);
  // Unknown country → no filings
  check("Unknown country yields no filings", filingInstancesFor({ entityId: "e3", country: "GB", fromPeriod: "2026-07", periods: 3 }).length === 0);
  check("resolveRules unknown country → null", resolveRules("GB", today) === null);
}

console.log(`\npayroll-statutory: ${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
