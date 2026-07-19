/**
 * Unit tests for the vCard builder (Task #233 — dial code must be part of
 * the TEL value, never the label).
 *
 * Same convention as reference-data.test.ts: standalone assertions, run via
 *
 *   pnpm tsx artifacts/atelier/src/lib/vcard.test.ts
 *
 * Throws on the first failed assertion.
 */

import { buildVCard, telValue } from "./vcard.js";

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log(`ok — ${msg}`);
}

// telValue — dial code present
eq(telValue("+971", "50 650 4416"), "+971 50 650 4416", "dial code prepended");
eq(telValue(" +971 ", " 506504416 "), "+971 506504416", "whitespace trimmed");
// number already international
eq(telValue("+971", "+971 50 650 4416"), "+971 50 650 4416", "leading + kept as-is, not doubled");
// number already contains dial-code digits without +
eq(telValue("+971", "971506504416"), "+971506504416", "dial digits present → only + added");
// leading zeros stripped before prepending
eq(telValue("+971", "0506504416"), "+971 506504416", "leading zero dropped");
// blank / name-label country
eq(telValue("", "506504416"), "506504416", "blank country → number as-is");
eq(telValue("UAE", "0506504416"), "0506504416", "name label country → number as-is");
eq(telValue("+", "506504416"), "506504416", "bare + country → number as-is");

// buildVCard — TEL lines and labels
const card = buildVCard({
  fullName: "Mounir Test",
  cellPhones: [
    { country: "+971", number: "50 650 4416" },
    { country: "UAE", number: "+971 4 123 4567" },
    { country: "", number: "12345" },
  ],
});
const lines = card.split("\r\n");
eq(lines.includes("TEL;TYPE=CELL,VOICE:+971 50 650 4416"), true, "dial-code cell → plain TEL with full intl number");
eq(lines.some((l) => l.includes("X-ABLabel:+971")), false, "dial code never emitted as label");
eq(lines.includes("item2.TEL;TYPE=CELL,VOICE:+971 4 123 4567"), true, "name-label cell keeps itemN grouping");
eq(lines.includes("item2.X-ABLabel:UAE"), true, "real country label kept");
eq(lines.includes("TEL;TYPE=CELL,VOICE:12345"), true, "blank country → number as-is");

console.log("vcard.test.ts: all assertions passed");
