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
import { buildVCard as buildServerVCard } from "../../../api-server/src/lib/atelier-business-card.js";

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
eq(telValue("UAE", "0506504416"), "+971 506504416", "UAE label resolves calling code and trunk");
eq(telValue("Saudi Arabia", "055 123 4567"), "+966 55 123 4567", "Saudi label resolves calling code and trunk");
eq(telValue(" KSA ", " 966551234567 "), "+966551234567", "label avoids duplicate dial digits");
eq(telValue("", " 506504416 "), "506504416", "blank country fallback is trimmed");
eq(telValue("Unknown", " 0123 456 "), "0123 456", "unknown label fallback preserves number");
eq(telValue("UAE", "00971 50 650 4416"), "+971 50 650 4416", "00 international prefix normalized");
eq(telValue("+", "506504416"), "506504416", "bare + country → number as-is");

// buildVCard — TEL lines and labels
const card = buildVCard({
  fullName: "Mounir Test",
  cellPhones: [
    { country: "+971", number: "50 650 4416" },
    { country: "Saudi Arabia", number: "055 123 4567" },
    { country: "UAE", number: "+971 4 123 4567" },
    { country: "UAE", number: "  " },
    { country: "", number: "12345" },
  ],
});
const lines = card.split("\r\n");
eq(lines.includes("TEL;TYPE=CELL,VOICE:+971 50 650 4416"), true, "dial-code cell → plain TEL with full intl number");
eq(lines.some((l) => l.includes("X-ABLabel:+971")), false, "dial code never emitted as label");
eq(lines.includes("item2.TEL;TYPE=CELL,VOICE:+966 55 123 4567"), true, "Saudi local number is complete");
eq(lines.includes("item2.X-ABLabel:Saudi Arabia"), true, "Saudi label kept");
eq(lines.includes("item3.TEL;TYPE=CELL,VOICE:+971 4 123 4567"), true, "existing international number preserved");
eq(lines.includes("item3.X-ABLabel:UAE"), true, "real country label kept");
eq(lines.includes("TEL;TYPE=CELL,VOICE:12345"), true, "blank country → number as-is");
eq(lines.filter((line) => line.includes(".TEL;TYPE=CELL,VOICE:") || line.startsWith("TEL;TYPE=CELL,VOICE:")).length, 4, "every populated phone emitted in stored order");

const parityInput = {
  fullName: "Mounir Test",
  title: "Partner",
  email: "mounir@example.com",
  cellPhones: [
    { country: "UAE", number: "050 650 4416" },
    { country: "KSA", number: "055 123 4567" },
  ],
  officeAddress: "Dubai, UAE",
};
eq(
  buildVCard({ ...parityInput, org: "Cognirise" }),
  buildServerVCard(parityInput),
  "in-app and business-card payload paths are identical",
);

console.log("vcard.test.ts: all assertions passed");
