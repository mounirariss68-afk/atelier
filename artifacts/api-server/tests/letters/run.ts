/**
 * Task #845 — offline tests for the employment/salary letter stack.
 * DB-free: pure template/PDF/resolution logic only.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/letters/run.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LETTER_TYPES, LETTER_LANGUAGES } from "../../src/lib/atelier-letters/catalog.js";
import {
  buildLetterContent,
  formatLetterDate,
  type LetterContext,
} from "../../src/lib/atelier-letters/templates.js";
import { generateLetterPdf, fixRtlRuns, hasArabic } from "../../src/lib/atelier-letters/pdf.js";
import {
  resolveEmployingEntityFrom,
  resolveTotalSalary,
} from "../../src/lib/atelier-letters/service.js";
import type { SigningEntity } from "../../src/lib/atelier-contract-service.js";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const baseCtx: Omit<LetterContext, "letterType" | "language"> = {
  refNumber: "CGN-LTR-2026-TEST01",
  issueDateIso: "2026-08-09",
  employeeName: "Ayşe Öğütçü",
  gender: "female",
  jobTitle: "Senior Consultant",
  startDateIso: "2023-02-01",
  idNumber: "P1234567",
  idKind: "passport",
  nationality: "Turkish",
  entityName: "Cognirise Management Consultancies L.L.C",
  entityAddress: "Office 1204, Marina Plaza, Dubai Marina, Dubai, UAE",
  salaryMonthly: 45000,
  salaryAnnual: 540000,
  currency: "AED",
  addresseeName: null,
  addresseeInstitution: "Emirates NBD",
  purpose: "Bank loan application",
  travelStartIso: "2026-09-10",
  travelEndIso: "2026-09-20",
  destination: "Germany",
  hrEmail: "hr@cognirise.ai",
  signatoryName: "Mounir Ariss",
  signatoryTitle: "CEO and Co-founder",
};

// 1. Content matrix — 9 types × 3 languages -------------------------------
console.log("templates: full matrix");
for (const t of LETTER_TYPES) {
  for (const lang of LETTER_LANGUAGES) {
    const c = buildLetterContent({ ...baseCtx, letterType: t.id, language: lang });
    check(`${t.id}/${lang} non-empty`, !!c.title && c.paragraphs.length > 0);
    const joined = c.paragraphs.join(" ");
    if (t.salaryBearing) {
      check(
        `${t.id}/${lang} states monthly+annual totals`,
        joined.includes("45,000") || joined.includes("45.000"),
        joined.slice(0, 120),
      );
      check(`${t.id}/${lang} states annual`, joined.includes("540,000") || joined.includes("540.000"));
      check(
        `${t.id}/${lang} no salary breakdown`,
        !/basic|allowance|housing|أساسي|بدل|temel maaş/i.test(joined),
      );
    } else if (t.id === "employment_verification") {
      check(`${t.id}/${lang} no salary figure`, !joined.includes("45,000") && !joined.includes("45.000"));
    }
    check(`${t.id}/${lang} verification line has ref`, c.verificationLine.includes(baseCtx.refNumber));
    if (t.travelDates) {
      check(`${t.id}/${lang} carries travel window`, /2026/.test(joined));
    }
    if (lang === "ar") {
      check(`${t.id}/ar body is Arabic`, hasArabic(joined));
      check(`${t.id}/ar avoids parentheses`, !/[()]/.test(joined), joined.match(/[^ ]*[()][^ ]*/)?.[0]);
    }
    if (lang === "tr") {
      check(`${t.id}/tr has Turkish diacritics`, /[çğışöüÇĞİŞÖÜ]/.test(joined + c.salutation));
    }
  }
}

// 2. fixRtlRuns ------------------------------------------------------------
console.log("fixRtlRuns");
check("pure-Latin untouched", fixRtlRuns("Emirates NBD") === "Emirates NBD");
check(
  "LTR run inside Arabic reversed",
  fixRtlRuns("قدره AED 45,000 شهرياً").includes("000,54 DEA"),
);
check(
  "extended-Latin name reversed as one run",
  fixRtlRuns("بأن Ayşe Öğütçü موظفة").includes([..."Ayşe Öğütçü"].reverse().join("")),
);

// 3. Entity resolution rule --------------------------------------------------
console.log("entity resolution");
const mk = (id: string, name: string, isDefault = false): SigningEntity =>
  ({
    id,
    name,
    jurisdiction: "",
    registeredAddress: "",
    country: "",
    governingLaw: "",
    courts: "",
    isDefault,
    authorisedSignatories: [],
    signatoryName: "",
    signatoryTitle: "",
    signatoryEmail: "",
    signatureFileRef: "",
    stampFileRef: "",
  }) as SigningEntity;
const ents = [mk("e1", "Cognirise Dubai LLC", true), mk("e2", "Cognirise Turkey AS"), mk("e3", "Cognirise KSA")];
check(
  "payroll id wins",
  resolveEmployingEntityFrom(ents, { legalEntityId: "e2", employingEntity: "Cognirise Dubai LLC" }).entity!.id === "e2",
);
const nm = resolveEmployingEntityFrom(ents, { legalEntityId: null, employingEntity: "cognirise turkey as" });
check("name match", nm.entity!.id === "e2" && nm.via === "name_match");
const amb = resolveEmployingEntityFrom(ents, { legalEntityId: null, employingEntity: "Cognirise" });
check("ambiguous falls to default (never guesses)", amb.via === "default" && amb.ambiguous && amb.entity!.id === "e1");
const fb = resolveEmployingEntityFrom(ents, { legalEntityId: "missing", employingEntity: "" });
check("fallback to default", fb.via === "default" && fb.entity!.id === "e1");
check("no entities → none", resolveEmployingEntityFrom([], { legalEntityId: null, employingEntity: "" }).via === "none");

// 4. Total salary ------------------------------------------------------------
console.log("salary resolution");
const s1 = resolveTotalSalary({ baseCompensation: "540000", basicWageMonthly: null, housingAllowanceMonthly: null, baseCurrency: "AED" } as never);
check("annual→monthly /12", !!s1 && s1.monthly === 45000 && s1.annual === 540000 && s1.currency === "AED");
const s2 = resolveTotalSalary({ baseCompensation: null, basicWageMonthly: "30000", housingAllowanceMonthly: "10000", baseCurrency: "AED" } as never);
check("monthly basic+housing sum", !!s2 && s2.monthly === 40000 && s2.annual === 480000);
check("no comp → null", resolveTotalSalary({ baseCompensation: null, basicWageMonthly: null, housingAllowanceMonthly: null, baseCurrency: null } as never) === null);

// 5. PDF generation — all languages, digital + wet ---------------------------
console.log("pdf generation");
const sig = readFileSync(fileURLToPath(new URL("../../assets/atelier-templates/entity-signature-mounir.png", import.meta.url)));
const stamp = readFileSync(fileURLToPath(new URL("../../assets/atelier-templates/entity-stamp-dubai.png", import.meta.url)));
for (const lang of LETTER_LANGUAGES) {
  for (const wet of [false, true]) {
    const ctx: LetterContext = { ...baseCtx, letterType: "salary_cert_bank_loan", language: lang };
    const content = buildLetterContent(ctx);
    const pdf = await generateLetterPdf({
      content,
      language: lang,
      refNumber: baseCtx.refNumber,
      issueDateText: formatLetterDate(baseCtx.issueDateIso, lang),
      entityName: baseCtx.entityName,
      entityAddress: baseCtx.entityAddress,
      signatoryName: baseCtx.signatoryName,
      signatoryTitle: baseCtx.signatoryTitle,
      signaturePng: wet ? null : sig,
      stampPng: wet ? null : stamp,
      embedSignature: !wet,
    });
    check(`pdf ${lang} ${wet ? "wet" : "digital"} renders`, pdf.length > 5000 && pdf.subarray(0, 4).toString() === "%PDF");
    check(`pdf ${lang} ${wet ? "wet" : "digital"} single page`, pdf.toString("latin1").split("/Type /Page").length - 1 <= 2);
    if (wet) check(`pdf ${lang} wet has no embedded images beyond logo`, pdf.length < 100_000, String(pdf.length));
  }
}

// 6. JPEG assets embed too (both accepted upload formats reach doc.image) ----
{
  const jpeg = readFileSync(fileURLToPath(new URL("./fixtures/signature-sample.jpg", import.meta.url)));
  const content = buildLetterContent({ ...baseCtx, letterType: "employment_verification", language: "en" });
  const pdf = await generateLetterPdf({
    content,
    language: "en",
    refNumber: baseCtx.refNumber,
    issueDateText: formatLetterDate(baseCtx.issueDateIso, "en"),
    entityName: baseCtx.entityName,
    entityAddress: baseCtx.entityAddress,
    signatoryName: baseCtx.signatoryName,
    signatoryTitle: baseCtx.signatoryTitle,
    signaturePng: jpeg,
    stampPng: jpeg,
    embedSignature: true,
  });
  check("pdf embeds JPEG assets", pdf.length > 5000 && pdf.subarray(0, 4).toString() === "%PDF");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll letter tests passed");
