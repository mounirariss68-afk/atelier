/**
 * Task #1137 — Salary digitization from signed employment contracts.
 *
 * Extracts the four payroll comp figures (annual base compensation, base
 * currency, monthly basic wage, monthly housing allowance) plus an
 * effective date from a *signed* employment contract, producing a
 * *proposal* that is reviewed under the same audited semantics as the
 * payroll PATCH before anything touches payroll. NOTHING is ever written
 * to payroll silently.
 *
 * Two extraction paths, tried in order:
 *   1. Structured template fieldValues — deterministic parse of money-type
 *      fields whose key/label matches salary/wage/allowance/compensation
 *      heuristics. Preferred (no LLM, exact).
 *   2. Signed-document text — a single fail-loud Anthropic pass that MUST
 *      return strict JSON whose snippets appear verbatim in the document.
 *      Any hallucinated field is dropped; a non-JSON reply / no readable
 *      text / no salary found raises a typed error → proposal "failed".
 */

import {
  db,
  atelierContractDocuments,
  atelierContractTemplateVersions,
  type ContractTemplateField,
  type ContractSalaryExtracted,
  type ContractSalarySnippet,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import mammoth from "mammoth";
import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";
import { loadContractBytes, normalizeFieldSchema } from "./atelier-contracts.js";
import type { ContractRow } from "./atelier-contract-service.js";

export class ContractSalaryExtractionError extends Error {}

export interface SalaryExtractionResult {
  source: "field_values" | "llm_text";
  extracted: ContractSalaryExtracted;
  snippets: Record<string, ContractSalarySnippet>;
}

// ---------------------------------------------------------------------------
// Heuristics + deterministic number parsing
// ---------------------------------------------------------------------------

const BASE_COMP_RE =
  /\b(annual\s+(base\s+)?salary|base\s+(annual\s+)?salary|annual\s+compensation|total\s+annual|base\s+compensation|gross\s+annual|yearly\s+salary)\b/i;
const BASIC_WAGE_RE = /\b(basic\s+(monthly\s+)?wage|basic\s+salary|basic\s+pay)\b/i;
const HOUSING_RE = /\b(housing\s+allowance|accommodation\s+allowance)\b/i;
const GENERIC_SALARY_RE =
  /\b(salary|compensation|remuneration|wage|allowance)\b/i;
const MONTHLY_RE = /\b(per\s+month|monthly|\/\s*month|p\.?m\.?|month)\b/i;
const ANNUAL_RE = /\b(per\s+annum|annual|annually|yearly|\/\s*year|p\.?a\.?|year)\b/i;

const ISO3_RE = /^[A-Z]{3}$/;
/** Currency symbol / short-code → ISO-4217 mapping for label/value hints. */
const CURRENCY_HINTS: Array<{ re: RegExp; iso: string }> = [
  { re: /\bAED\b|د\.إ|dirhams?\b/i, iso: "AED" },
  { re: /\bSAR\b|riyals?\b/i, iso: "SAR" },
  { re: /\bUSD\b|\bUS\$|\$\b|dollars?\b/i, iso: "USD" },
  { re: /\bEUR\b|€|euros?\b/i, iso: "EUR" },
  { re: /\bGBP\b|£|pounds?\b/i, iso: "GBP" },
  { re: /\bQAR\b/i, iso: "QAR" },
  { re: /\bKWD\b/i, iso: "KWD" },
  { re: /\bBHD\b/i, iso: "BHD" },
  { re: /\bOMR\b/i, iso: "OMR" },
  { re: /\bINR\b|₹|rupees?\b/i, iso: "INR" },
];

/** Deterministic money parse: strip currency symbols/commas/spaces. */
export function parseMoney(raw: string): number | null {
  if (!raw) return null;
  // Keep digits + one decimal separator; drop everything else.
  const cleaned = raw
    .replace(/[^\d.,]/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Detect an ISO currency from an explicit code or a symbol/name hint. */
export function detectCurrency(...sources: string[]): string | null {
  const joined = sources.filter(Boolean).join(" ");
  // Explicit 3-letter code standing alone anywhere wins first.
  for (const h of CURRENCY_HINTS) {
    if (h.re.test(joined)) return h.iso;
  }
  const m = joined.match(/\b([A-Z]{3})\b/);
  if (m && ISO3_RE.test(m[1])) return m[1];
  return null;
}

// ---------------------------------------------------------------------------
// Path 1 — structured template fieldValues
// ---------------------------------------------------------------------------

/**
 * Deterministic extraction from the contract's structured fieldValues.
 * Returns a result only when it yields at least a base compensation
 * figure; otherwise null so the caller falls back to the LLM path.
 */
export function extractFromFieldValues(
  fields: ContractTemplateField[],
  fieldValues: Record<string, string>,
  contractText?: string,
): SalaryExtractionResult | null {
  const schema = normalizeFieldSchema(fields ?? []);
  const extracted: ContractSalaryExtracted = {};
  const snippets: Record<string, ContractSalarySnippet> = {};

  const moneyFields = schema.filter(
    (f) => f.dataType === "money" || f.dataType === "number",
  );

  const assign = (
    key: "baseCompensation" | "basicWageMonthly" | "housingAllowanceMonthly",
    field: ContractTemplateField,
    value: number,
  ) => {
    if (extracted[key] != null) return;
    extracted[key] = value;
    snippets[key] = {
      snippet: `${field.label}: ${fieldValues[field.key]}`,
      attribution: `field:${field.key}`,
    };
  };

  for (const f of moneyFields) {
    const raw = fieldValues[f.key];
    if (raw == null || raw === "") continue;
    const label = `${f.key} ${f.label}`;
    const amount = parseMoney(String(raw));
    if (amount == null) continue;

    if (HOUSING_RE.test(label)) {
      assign("housingAllowanceMonthly", f, amount);
    } else if (BASIC_WAGE_RE.test(label)) {
      assign("basicWageMonthly", f, amount);
    } else if (BASE_COMP_RE.test(label)) {
      extracted.baseCompensation = amount;
      snippets.baseCompensation = {
        snippet: `${f.label}: ${raw}`,
        attribution: `field:${f.key}`,
      };
    } else if (GENERIC_SALARY_RE.test(label)) {
      // Generic salary/compensation field — classify by monthly vs annual
      // keyword. Monthly → basic wage; annual (or default) → base comp.
      if (MONTHLY_RE.test(label) && !ANNUAL_RE.test(label)) {
        assign("basicWageMonthly", f, amount);
      } else {
        if (extracted.baseCompensation == null) {
          extracted.baseCompensation = amount;
          snippets.baseCompensation = {
            snippet: `${f.label}: ${raw}`,
            attribution: `field:${f.key}`,
          };
        }
      }
    }
  }

  // No base compensation figure → this path did not succeed.
  if (extracted.baseCompensation == null) return null;

  // Currency: from the base-comp field label/value, else any money field,
  // else the contract text.
  const currency =
    detectCurrency(
      snippets.baseCompensation?.snippet ?? "",
      ...moneyFields.map((f) => `${f.label} ${fieldValues[f.key] ?? ""}`),
      contractText ?? "",
    ) ?? null;
  if (currency) {
    extracted.baseCurrency = currency;
    snippets.baseCurrency = {
      snippet: currency,
      attribution: snippets.baseCompensation?.attribution ?? "field",
    };
  }

  // Effective date from a date field whose key/label mentions effective/start.
  const dateField = schema.find(
    (f) =>
      f.dataType === "date" &&
      /\b(effective|start|commence|joining)\b/i.test(`${f.key} ${f.label}`) &&
      fieldValues[f.key],
  );
  if (dateField) {
    const iso = normalizeIsoDate(fieldValues[dateField.key]);
    if (iso) {
      extracted.effectiveDate = iso;
      snippets.effectiveDate = {
        snippet: `${dateField.label}: ${fieldValues[dateField.key]}`,
        attribution: `field:${dateField.key}`,
      };
    }
  }

  return { source: "field_values", extracted, snippets };
}

function normalizeIsoDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m && !Number.isNaN(Date.parse(m[0]))) return m[0];
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Document text loading (signed_pdf via unpdf; final/converted docx via mammoth)
// ---------------------------------------------------------------------------

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Load readable text from the contract's document chain, preferring the
 * signed PDF, then the latest final/converted docx. Returns "" when no
 * document yields recoverable text.
 */
export async function loadSignedContractText(contractId: string): Promise<string> {
  const docs = await db
    .select()
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.contractId, contractId))
    .orderBy(desc(atelierContractDocuments.versionNumber));

  // Priority: signed_pdf → converted_pdf → final_docx → generated_draft.
  const order = ["signed_pdf", "converted_pdf", "final_docx", "generated_draft"];
  const sorted = [...docs].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );

  for (const doc of sorted) {
    const idx = order.indexOf(doc.kind);
    if (idx === -1) continue;
    const bytes = await loadContractBytes(doc.blobRef);
    if (!bytes) continue;
    try {
      let text = "";
      if (doc.mime === "application/pdf" || doc.kind.endsWith("_pdf")) {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const res = await unpdfExtractText(pdf, { mergePages: true });
        text = (Array.isArray(res.text) ? res.text.join("\n\n") : res.text).trim();
      } else if (doc.mime === DOCX_MIME || doc.kind.endsWith("_docx") || doc.kind === "generated_draft") {
        const out = await mammoth.extractRawText({ buffer: bytes });
        text = (out.value ?? "").trim();
      }
      if (text) return text;
    } catch {
      // try the next document in priority order
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Path 2 — LLM fallback over signed-document text
// ---------------------------------------------------------------------------

const SALARY_SYSTEM_PROMPT = `You extract salary/compensation figures from a signed employment contract for an HR system.
Return ONLY a single JSON object (no prose, no code fences) of this exact shape:
{
  "baseCompensation": number | null,       // ANNUAL base compensation
  "currency": "ISO-4217 code" | null,      // e.g. "AED", "USD"
  "basicWageMonthly": number | null,       // MONTHLY basic wage
  "housingAllowanceMonthly": number | null,// MONTHLY housing allowance
  "effectiveDate": "YYYY-MM-DD" | null,    // date compensation takes effect
  "snippets": {                            // verbatim quotes proving each figure
    "baseCompensation": "exact quote from the document",
    "currency": "exact quote",
    "basicWageMonthly": "exact quote",
    "housingAllowanceMonthly": "exact quote",
    "effectiveDate": "exact quote"
  }
}
Rules:
- Every non-null figure MUST have a matching snippet copied VERBATIM from the document text.
- NEVER guess or infer a value that is not stated. Use null for anything not clearly present.
- Numbers must be plain (no currency symbols/commas), positive and finite.
- If NO salary figure is present at all, return every field null with an empty "snippets" object.`;

/** Squish whitespace for verbatim-snippet matching against the doc text. */
function squish(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export async function extractFromDocumentText(
  docText: string,
  orgId: string,
): Promise<SalaryExtractionResult> {
  if (!docText || !docText.trim()) {
    throw new ContractSalaryExtractionError(
      "No readable text in the signed contract document.",
    );
  }
  const model =
    process.env.ATELIER_CONTRACT_SALARY_MODEL ?? "claude-sonnet-4-5";
  const { anthropic } = await (
    await import("./assistant/provider-runtime.js")
  ).getPrivacyAuthorizedAnthropic({
    dataClasses: ["restricted"],
    orgId,
    capabilityId: "hr.contract_salary_extraction",
    model,
  });
  const ac = new AbortController();
  const timeoutMs = Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 90000);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let resp;
  try {
    resp = await anthropic.messages
      .create(
        {
          model,
          max_tokens: 2048,
          system: SALARY_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Signed employment contract text:\n\n${docText.slice(0, 100_000)}`,
            },
          ],
        },
        { signal: ac.signal },
      )
      .finally(() => clearTimeout(timer));
  } catch (err) {
    throw new ContractSalaryExtractionError(
      `Salary extraction LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const block = resp.content[0];
  const text = block && block.type === "text" ? block.text.trim() : "";
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(stripped.indexOf("{")));
  } catch {
    throw new ContractSalaryExtractionError(
      `Salary extraction returned non-JSON output: ${stripped.slice(0, 120)}`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  const rawSnippets = (obj.snippets ?? {}) as Record<string, unknown>;
  const hay = squish(docText);

  const extracted: ContractSalaryExtracted = {};
  const snippets: Record<string, ContractSalarySnippet> = {};

  const snippetOk = (key: string): string | null => {
    const q = rawSnippets[key];
    if (typeof q !== "string" || !q.trim()) return null;
    return hay.includes(squish(q)) ? q.trim() : null;
  };

  const addNumber = (
    key: "baseCompensation" | "basicWageMonthly" | "housingAllowanceMonthly",
    allowZero = false,
  ) => {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    if (v < 0 || (!allowZero && v <= 0)) return;
    const snip = snippetOk(key);
    if (!snip) return; // fabricated / unprovable → drop
    extracted[key] = v;
    snippets[key] = { snippet: snip, attribution: "document" };
  };

  addNumber("baseCompensation");
  addNumber("basicWageMonthly");
  addNumber("housingAllowanceMonthly", true);

  // Currency
  const cur = obj.currency;
  if (typeof cur === "string" && ISO3_RE.test(cur.trim().toUpperCase())) {
    const snip = snippetOk("currency");
    if (snip) {
      extracted.baseCurrency = cur.trim().toUpperCase();
      snippets.baseCurrency = { snippet: snip, attribution: "document" };
    }
  }

  // Effective date
  const eff = obj.effectiveDate;
  if (typeof eff === "string") {
    const iso = normalizeIsoDate(eff);
    const snip = snippetOk("effectiveDate");
    if (iso && snip) {
      extracted.effectiveDate = iso;
      snippets.effectiveDate = { snippet: snip, attribution: "document" };
    }
  }

  if (
    extracted.baseCompensation == null &&
    extracted.basicWageMonthly == null &&
    extracted.housingAllowanceMonthly == null
  ) {
    throw new ContractSalaryExtractionError(
      "No salary figure found in the signed contract document.",
    );
  }

  return { source: "llm_text", extracted, snippets };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Extract salary from a signed contract: structured fieldValues first,
 * then the signed-document text (LLM). Throws
 * ContractSalaryExtractionError with a human reason when neither path
 * yields a figure — the caller records that on the proposal as "failed".
 */
export async function extractContractSalary(
  contract: Pick<ContractRow, "id" | "orgId" | "templateVersionId" | "fieldValues">,
): Promise<SalaryExtractionResult> {
  // Load the template version schema (drives field-value heuristics).
  let fields: ContractTemplateField[] = [];
  if (contract.templateVersionId) {
    const [tv] = await db
      .select()
      .from(atelierContractTemplateVersions)
      .where(eq(atelierContractTemplateVersions.id, contract.templateVersionId));
    fields = tv?.fieldSchema ?? [];
  }

  const fieldValues = (contract.fieldValues as Record<string, string>) ?? {};

  // Path 1 — structured field values (deterministic; no LLM).
  const fromFields = extractFromFieldValues(fields, fieldValues);
  if (fromFields) return fromFields;

  // Path 2 — signed-document text (fail-loud LLM).
  const docText = await loadSignedContractText(contract.id);
  return extractFromDocumentText(docText, contract.orgId);
}
