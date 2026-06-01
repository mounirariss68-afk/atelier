/**
 * pnpm --filter @workspace/maven-ai run test:assets
 *
 * Brand-refresh survival check for the assessment report PDF logo.
 *
 * The assessment PDF (AssessmentPDF.tsx) embeds the navy Cognirise wordmark
 * from `cognirise-logo-light.png`. In the browser it is fetched from the served
 * URL `/images/cognirise-logo-light.png`; when rendered server-side (Node) it is
 * read from `public/images/cognirise-logo-light.png`. Both ends depend on that
 * single asset. If it is renamed or removed the PDF still renders — just without
 * branding. These assertions fail loudly instead:
 *
 *   1. The asset served at `/images/cognirise-logo-light.png` exists in
 *      public/ and is a non-trivial PNG.
 *   2. AssessmentPDF.tsx still references that exact served path, so the
 *      runtime URL and the asset can't drift apart silently.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVED_PATH = "images/cognirise-logo-light.png";

// ---- 1. The served public asset exists + is a real PNG ---------------
const assetUrl = new URL(`../../public/${SERVED_PATH}`, import.meta.url);
let logo: Buffer;
try {
  logo = readFileSync(fileURLToPath(assetUrl));
} catch {
  assert.fail(
    `assessment logo asset missing — nothing is served at /${SERVED_PATH} (expected public/${SERVED_PATH}).`,
  );
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert.ok(
  logo.subarray(0, 8).equals(PNG_MAGIC),
  `served logo /${SERVED_PATH} is not a valid PNG (bad magic bytes).`,
);
assert.ok(
  logo.length > 1024,
  `served logo /${SERVED_PATH} is suspiciously small (${logo.length} bytes) — likely a broken/placeholder asset.`,
);

// ---- 2. The PDF component still points at the served path ------------
const pdfSrc = readFileSync(
  fileURLToPath(new URL("../../src/components/assessment/AssessmentPDF.tsx", import.meta.url)),
  "utf8",
);
assert.ok(
  pdfSrc.includes(SERVED_PATH),
  `AssessmentPDF.tsx no longer references ${SERVED_PATH} — the PDF logo path and the served asset have drifted apart.`,
);

console.log(
  `ok — /${SERVED_PATH} resolves (${(logo.length / 1024).toFixed(0)}kb PNG) and AssessmentPDF.tsx references it.`,
);
