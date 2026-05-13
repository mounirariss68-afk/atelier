/**
 * Unit tests for reference-data client helpers (Task #290).
 *
 * Vitest is not currently installed in the atelier artifact (Task #290 stays
 * within scope by not introducing a test runner). These tests are written as
 * standalone assertions and are runnable via:
 *
 *   pnpm tsx artifacts/atelier/src/lib/reference-data.test.ts
 *
 * The script throws on the first failed assertion; CI can wrap it later.
 */

import {
  assertResolvableCountry,
  normalize,
  resolveCountry,
  scoreCountryMatch,
  scoreIndustryMatch,
  sortCountries,
  type CountryRow,
  type IndustryRow,
} from "./reference-data.js";

const C = (
  iso: string,
  name: string,
  region: string,
  flags: { isGcc?: boolean; isTarget?: boolean; aliases?: string[]; order?: number; status?: "active" | "deprecated"; nameAr?: string; nameTr?: string } = {},
): CountryRow => ({
  isoAlpha2: iso,
  isoAlpha3: iso + "X",
  isoNumeric: "000",
  displayNameEn: name,
  displayNameAr: flags.nameAr ?? null,
  displayNameTr: flags.nameTr ?? null,
  aliases: flags.aliases ?? [],
  region,
  isGcc: flags.isGcc ?? false,
  isAicoTargetMarket: flags.isTarget ?? false,
  status: flags.status ?? "active",
  displayOrderOverride: flags.order ?? null,
});

const COUNTRIES: CountryRow[] = [
  C("US", "United States", "Americas", { aliases: ["USA", "America"] }),
  C("SA", "Saudi Arabia", "MENA", { isGcc: true, aliases: ["KSA"], order: 1 }),
  C("AE", "United Arab Emirates", "MENA", { isGcc: true, aliases: ["UAE"], order: 2 }),
  C("TR", "Turkey", "Asia", { isTarget: true, aliases: ["Türkiye"], order: 7, nameTr: "Türkiye" }),
  C("EG", "Egypt", "MENA"),
  C("FR", "France", "Europe"),
  C("XX", "Old Country", "Europe", { status: "deprecated" }),
  C("NL", "Netherlands", "Europe", { aliases: ["Holland"] }),
];

let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log("  ✓", label);
  } else {
    failed++;
    console.error("  ✗", label, detail ?? "");
  }
}

console.log("[reference-data.test] normalize");
ok("strips diacritics", normalize("Türkiye") === "turkiye");
ok("lowercases", normalize("Saudi ARABIA") === "saudi arabia");

console.log("[reference-data.test] resolveCountry");
ok("ISO-2 match", resolveCountry("SA", COUNTRIES)?.isoAlpha2 === "SA");
ok("alias UAE → AE", resolveCountry("UAE", COUNTRIES)?.isoAlpha2 === "AE");
ok("alias ksa → SA", resolveCountry("ksa", COUNTRIES)?.isoAlpha2 === "SA");
ok("alias Holland → NL", resolveCountry("Holland", COUNTRIES)?.isoAlpha2 === "NL");
ok("EN name accent-insensitive", resolveCountry("turkiye", COUNTRIES)?.isoAlpha2 === "TR");
ok("Mars not resolvable", resolveCountry("Mars", COUNTRIES) === null);

console.log("[reference-data.test] sortCountries");
const sorted = sortCountries(COUNTRIES);
ok(
  "GCC first in display_order (SA, AE)",
  sorted[0].isoAlpha2 === "SA" && sorted[1].isoAlpha2 === "AE",
  sorted.map((s) => s.isoAlpha2),
);
ok("AICo target market (TR) third", sorted[2].isoAlpha2 === "TR");
ok("MENA non-GCC (EG) precedes Americas/Europe", sorted[3].isoAlpha2 === "EG");
ok(
  "Deprecated entries float to the bottom",
  sorted[sorted.length - 1].status === "deprecated",
  sorted.map((s) => `${s.isoAlpha2}:${s.status}`),
);

console.log("[reference-data.test] scoreCountryMatch");
ok("empty query passes", scoreCountryMatch(COUNTRIES[0], "") === 1);
ok("exact ISO match scores 1", scoreCountryMatch(COUNTRIES[1], "SA") === 1);
ok("prefix beats substring", scoreCountryMatch(COUNTRIES[1], "saud") === 0.8);
ok("alias matches", scoreCountryMatch(COUNTRIES[1], "KSA") === 1);
ok("non-match returns 0", scoreCountryMatch(COUNTRIES[1], "zzz") === 0);

console.log("[reference-data.test] scoreIndustryMatch");
const HPS: IndustryRow = {
  code: "HPS",
  displayNameEn: "Health & Public Sector",
  displayOrder: 1,
  status: "active",
  shortDescription: "Government, healthcare",
};
ok("exact code", scoreIndustryMatch(HPS, "HPS") === 1);
ok("name prefix", scoreIndustryMatch(HPS, "health") === 0.8);
ok("description substring", scoreIndustryMatch(HPS, "healthcare") > 0);

console.log("[reference-data.test] assertResolvableCountry (free-text guard)");
const okHit = assertResolvableCountry("Saudi Arabia", COUNTRIES);
ok("known active resolves", okHit.ok === true && okHit.ok && okHit.row.isoAlpha2 === "SA");
const unknownHit = assertResolvableCountry("Mars", COUNTRIES);
ok(
  "unknown rejected as 'unknown'",
  !unknownHit.ok && unknownHit.reason === "unknown",
);
const deprecated = assertResolvableCountry("Old Country", COUNTRIES);
ok(
  "deprecated rejected as 'deprecated'",
  !deprecated.ok && deprecated.reason === "deprecated",
);
const empty = assertResolvableCountry("   ", COUNTRIES);
ok("empty rejected", !empty.ok && empty.reason === "unknown");

if (failed > 0) {
  console.error(`\n[reference-data.test] FAILED ${failed} assertion(s).`);
  process.exit(1);
} else {
  console.log("\n[reference-data.test] all assertions passed.");
}
