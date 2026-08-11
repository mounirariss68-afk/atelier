/**
 * Task #967 — templatize the Non-Equity Partner Agreement v3 docx.
 *
 * Reads the uploaded candidate-specific v3 document (Hisham Nowfel /
 * Education-sector wording) and produces the FIRM TEMPLATE copy where
 * every candidate-specific value becomes a literal `[...]` placeholder
 * that the contract fill pipeline (fillXmlPart / findMissingPlaceholders)
 * matches per paragraph. Legal wording is otherwise untouched; the
 * original upload stays in tmp/user-uploads/.
 *
 * Anchor-safety rules (see esign-anchors.ts):
 *  - "Signature" / "Authorised Signatory" / "Date" labels must remain
 *    verbatim — their regexes are full-match.
 *  - "Name & Title" labels are prefix-matched, so the signatory
 *    placeholders are APPENDED to those labels (firm column = first
 *    occurrence, partner column = second; verified in verify step).
 *
 * Run:  pnpm --filter @workspace/api-server exec tsx scripts/nep-templatize-v3.ts
 * Output: scripts/assets/non-equity-partner-agreement-template-v3.docx
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { NEP_PLACEHOLDERS } from "./nep-template-schema.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(
  HERE,
  "../../../tmp/user-uploads/Hisham_Nowfel_-_Non-Equity_Partner_Agreement_-_v3_1786460494262.docx",
);
const OUT = path.resolve(HERE, "assets/non-equity-partner-agreement-template-v3.docx");

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface Rule {
  /** Text to find in the per-paragraph <w:t> concatenation. */
  find: string;
  replace: string;
  /** Apply only to the Nth match (1-based) across the whole part. Omit = all. */
  occurrence?: number;
  /** Minimum number of applications expected (default 1). */
  expect?: number;
  applied?: number;
}

/**
 * Paragraph-aware replace, mirroring fillXmlPart: join the paragraph's
 * <w:t> texts, substitute, write the result into the first <w:t> and
 * blank the rest. Handles occurrence targeting for repeated labels.
 */
function applyRules(xml: string, rules: Rule[]): string {
  const counters = new Map<Rule, number>();
  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  return xml.replace(paraRe, (para) => {
    const tRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(para)) !== null) texts.push(xmlUnescape(m[2]));
    if (texts.length === 0) return para;
    const joined = texts.join("");
    let filled = joined;
    for (const r of rules) {
      let idx = filled.indexOf(r.find);
      while (idx !== -1) {
        const n = (counters.get(r) ?? 0) + 1;
        counters.set(r, n);
        if (r.occurrence === undefined || r.occurrence === n) {
          filled = filled.slice(0, idx) + r.replace + filled.slice(idx + r.find.length);
          r.applied = (r.applied ?? 0) + 1;
          idx = filled.indexOf(r.find, idx + r.replace.length);
        } else {
          idx = filled.indexOf(r.find, idx + r.find.length);
        }
      }
    }
    if (filled === joined) return para;
    let first = true;
    return para.replace(tRe, (_full, open: string, _inner: string, close: string) => {
      if (first) {
        first = false;
        const openPreserve = open.includes("xml:space")
          ? open
          : open.replace("<w:t", '<w:t xml:space="preserve"');
        return `${openPreserve}${xmlEscape(filled)}${close}`;
      }
      return `${open}${close}`;
    });
  });
}

async function main() {
  const bytes = readFileSync(SOURCE);
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml")!.async("string");

  const P = NEP_PLACEHOLDERS;
  const rules: Rule[] = [
    // Partner name — parties block ("Hisham Nowfel") + signature heading.
    { find: "Hisham Nowfel", replace: P.partnerName },
    { find: "HISHAM NOWFEL", replace: P.partnerName },
    // Effective date blank on the cover.
    { find: "_________________, 2026", replace: P.effectiveDate },
    // Sector focus — Background A + Schedule A.
    { find: "the Education sector across the MENA region", replace: P.sectorFocus, expect: 2 },
    // Clause 3.1 shorter variant ("... a primary focus on the Education sector;").
    { find: "the Education sector;", replace: `${P.sectorFocus};` },
    // Schedule B charge-out rate.
    { find: "USD 2,500 per day", replace: `${P.chargeOutRate} per day` },
    // Reference series on the cover confidentiality line (first occurrence
    // only — the phrase may repeat in headers/footers, untouched there).
    {
      find: "Private & Confidential",
      replace: `Private & Confidential — Ref: ${P.reference}`,
      occurrence: 1,
    },
    // Signatory printed-name placeholders appended to the (prefix-matched)
    // "Name & Title" labels: 1st = firm column, 2nd = partner column.
    { find: "Name & Title", replace: `Name & Title: ${P.firmSignatory}`, occurrence: 1 },
    { find: "Name & Title", replace: `Name & Title: ${P.partnerSignatory}`, occurrence: 2 },
  ];

  const out = applyRules(docXml, rules);
  const problems: string[] = [];
  for (const r of rules) {
    const want = r.expect ?? 1;
    if ((r.applied ?? 0) < want) {
      problems.push(`rule "${r.find}" applied ${r.applied ?? 0}x (expected >= ${want})`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Templatization incomplete:\n  ${problems.join("\n  ")}`);
  }
  zip.file("word/document.xml", out);
  mkdirSync(path.dirname(OUT), { recursive: true });
  const buf = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })) as Buffer;
  writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${buf.length} bytes)`);
  for (const r of rules) console.log(`  applied ${r.applied}x: ${r.find.slice(0, 50)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
