/**
 * Unit tests for the shared non-UAE contract caution helpers (Task #293).
 *
 * Same standalone pattern as reference-data.test.ts (no test runner in this
 * artifact). Run via:
 *
 *   pnpm --filter @workspace/atelier run test:country-uae
 *
 * Exits non-zero on any failed assertion.
 */

import { countryDisplayName, isUaeCountry } from "./country-uae.js";

let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log("  ✓", label);
  } else {
    failed++;
    console.error("  ✗", label, detail ?? "");
  }
}

console.log("[country-uae.test] isUaeCountry — UAE values (true)");
const uaeValues = [
  "AE",
  "ae",
  "UAE",
  "uae",
  "U.A.E.",
  "United Arab Emirates",
  "united arab emirates",
  "  United Arab Emirates  ",
  "Emirates",
  "Abu Dhabi",
  "Dubai",
  "DIFC",
  "ADGM",
  "UAE — Dubai",
];
for (const v of uaeValues) {
  ok(`"${v}" → true`, isUaeCountry(v) === true);
}

console.log("[country-uae.test] isUaeCountry — non-UAE values (false)");
const nonUaeValues: (string | null | undefined)[] = [
  "GB",
  "gb",
  "Saudi Arabia",
  "SA",
  "United Kingdom",
  "United States",
  "Qatar",
  "",
  "   ",
  null,
  undefined,
];
for (const v of nonUaeValues) {
  ok(`${JSON.stringify(v)} → false`, isUaeCountry(v) === false);
}

console.log("[country-uae.test] countryDisplayName — bare ISO codes expand");
ok('"GB" → United Kingdom', countryDisplayName("GB") === "United Kingdom");
ok('"gb" → United Kingdom', countryDisplayName("gb") === "United Kingdom");
ok('"AE" → United Arab Emirates', countryDisplayName("AE") === "United Arab Emirates");
ok('"SA" → Saudi Arabia', countryDisplayName("SA") === "Saudi Arabia");
ok('" GB " trims then expands', countryDisplayName(" GB ") === "United Kingdom");
ok('unknown ISO "ZZ" → uppercased code', countryDisplayName("zz") === "ZZ");

console.log("[country-uae.test] countryDisplayName — full names pass through");
ok(
  '"United Arab Emirates" unchanged',
  countryDisplayName("United Arab Emirates") === "United Arab Emirates",
);
ok('"Saudi Arabia" unchanged', countryDisplayName("Saudi Arabia") === "Saudi Arabia");
ok('"  France  " trimmed', countryDisplayName("  France  ") === "France");
ok('"U.A.E." not treated as ISO', countryDisplayName("U.A.E.") === "U.A.E.");

if (failed > 0) {
  console.error(`\n[country-uae.test] FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("\n[country-uae.test] all assertions passed");
