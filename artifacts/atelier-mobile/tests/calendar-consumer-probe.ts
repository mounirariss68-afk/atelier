/**
 * Guard the mobile Meetings contract: corrected shared calendar fields must be
 * rendered directly, without a mobile-only title or schedule reconstruction.
 */
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/(tabs)/meetings.tsx", import.meta.url), "utf8");
let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

check(
  "mobile renders the shared meeting subject",
  /\{m\.subject\s*\|\|\s*t\("mtg\.noSubject"\)\}/.test(source),
);
check(
  "mobile renders the shared meeting start time",
  /fmtDay\(m\.start,\s*t\)/.test(source) && /fmtTime\(m\.start\)/.test(source),
);
check(
  "mobile does not reconstruct recurring subjects",
  !/seriesMasterId|iCalUId/.test(source),
);

if (failures > 0) process.exit(1);
console.log("✓ mobile calendar consumer checks passed");