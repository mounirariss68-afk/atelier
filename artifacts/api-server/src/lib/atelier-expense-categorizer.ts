/**
 * Task #383 — expense auto-categorization.
 *
 * Precedence on create/parse/submit:
 *   (a) org-wide merchant memory — a mapping confirmed >= MEMORY_TRUST_COUNT
 *       times (repeat confirmed usage across all users) wins outright;
 *   (b) AI proposal (Anthropic, same integration as the Expense Auditor)
 *       with a confidence grade — FAIL-LOUD: if the model call fails the
 *       caller falls back to manual, never a silent guess;
 *   (c) manual — user picks from the cascading dropdowns.
 *
 * Every confirmed submission (including corrections) feeds the memory
 * via learnMerchantMapping().
 */

import { db, atelierMerchantCategoryMap } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getPrivacyAuthorizedAnthropic } from "./assistant/provider-runtime.js";
import {
  loadTaxonomy,
  normalizeMerchantKey,
  type TaxonomyRow,
} from "./atelier-expense-taxonomy";

export const MEMORY_TRUST_COUNT = 2;

export interface CategorySuggestion {
  categoryCode: string;
  subCategoryCode: string;
  source: "merchant_memory" | "ai";
  confidence: "green" | "amber" | "red";
  rationale?: string;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** (a) merchant memory — trusted after repeat confirmed usage. */
export async function lookupMerchantMemory(
  merchant: string,
  orgId: string,
): Promise<CategorySuggestion | null> {
  const key = normalizeMerchantKey(merchant);
  if (!key) return null;
  const [row] = await db
    .select()
    .from(atelierMerchantCategoryMap)
    .where(
      and(
        eq(atelierMerchantCategoryMap.orgId, orgId),
        eq(atelierMerchantCategoryMap.merchantKey, key),
        isNull(atelierMerchantCategoryMap.deletedAt),
      ),
    );
  if (!row || row.confirmCount < MEMORY_TRUST_COUNT) return null;
  // Guard against stale mappings pointing at retired taxonomy rows.
  const tax = await loadTaxonomy();
  const ok = tax.some((r) => r.code === row.subCategoryCode && r.parentCode === row.categoryCode);
  if (!ok) return null;
  return {
    categoryCode: row.categoryCode,
    subCategoryCode: row.subCategoryCode,
    source: "merchant_memory",
    confidence: "green",
    rationale: `Merchant "${row.merchantLabel}" confirmed ${row.confirmCount}× org-wide.`,
  };
}

/**
 * (b) AI categorization. Throws on any model/parse failure — the caller
 * MUST catch and degrade to manual (fail-loud, never silent-guess).
 */
export async function aiCategorize(input: {
  merchant: string | null;
  description?: string | null;
  ocrText?: string | null;
  amount?: number | null;
  currency?: string | null;
  contextType?: string | null;
}): Promise<CategorySuggestion> {
  const tax = await loadTaxonomy();
  const tree = tax
    .filter((r) => r.parentCode === null)
    .map((cat) => {
      const subs = tax
        .filter((r) => r.parentCode === cat.code)
        .map((s) => `${s.code} (${s.label})`)
        .join(", ");
      return `- ${cat.code} (${cat.label}): ${subs}`;
    })
    .join("\n");

  const { anthropic } = await getPrivacyAuthorizedAnthropic({
    dataClasses: ["confidential"],
  });
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 30000),
  );
  try {
    const resp = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system:
          "You are an expense categorizer for a consulting firm. Given expense details and the firm's category taxonomy, reply with ONLY a single JSON object (no prose, no code fences): {\"categoryCode\": string (a top-level code), \"subCategoryCode\": string (a child code under that category), \"confidence\": \"green\"|\"amber\"|\"red\", \"rationale\": string (one short sentence)}. Use only codes from the taxonomy. green = clear match, amber = plausible, red = guessing.",
        messages: [
          {
            role: "user",
            content: `Taxonomy:\n${tree}\n\nExpense:\nmerchant: ${input.merchant ?? "unknown"}\ndescription: ${input.description ?? ""}\namount: ${input.amount ?? ""} ${input.currency ?? ""}\ncontext: ${input.contextType ?? ""}\nreceipt text: ${(input.ocrText ?? "").slice(0, 1500)}`,
          },
        ],
      },
      { signal: ac.signal },
    );
    const block = resp.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("categorizer-non-json");
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as {
      categoryCode?: string;
      subCategoryCode?: string;
      confidence?: string;
      rationale?: string;
    };
    const sub = tax.find(
      (r) => r.code === parsed.subCategoryCode && r.parentCode === parsed.categoryCode,
    );
    if (!sub) throw new Error(`categorizer-invalid-pair: ${parsed.categoryCode}/${parsed.subCategoryCode}`);
    const confidence =
      parsed.confidence === "green" || parsed.confidence === "red" ? parsed.confidence : "amber";
    return {
      categoryCode: sub.parentCode as string,
      subCategoryCode: sub.code,
      source: "ai",
      confidence,
      rationale: parsed.rationale,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the best suggestion (memory then AI). Returns null when neither
 * axis yields anything — the caller renders manual dropdowns. `aiError`
 * carries the loud failure reason when AI was attempted and failed.
 */
export async function suggestCategory(input: {
  merchant: string | null;
  description?: string | null;
  ocrText?: string | null;
  amount?: number | null;
  currency?: string | null;
  contextType?: string | null;
  allowAi?: boolean;
  orgId: string;
}): Promise<{ suggestion: CategorySuggestion | null; aiError: string | null }> {
  if (input.merchant) {
    const mem = await lookupMerchantMemory(input.merchant, input.orgId);
    if (mem) return { suggestion: mem, aiError: null };
  }
  if (input.allowAi === false) return { suggestion: null, aiError: null };
  try {
    const ai = await aiCategorize(input);
    return { suggestion: ai, aiError: null };
  } catch (err) {
    return {
      suggestion: null,
      aiError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Learn from a confirmed choice (submission or approver correction).
 * Same pair → increment confirmCount; different pair → the mapping is
 * corrected and the counter restarts at 1.
 */
export async function learnMerchantMapping(input: {
  merchant: string;
  categoryCode: string;
  subCategoryCode: string;
  userId: string | null;
  orgId: string;
}): Promise<void> {
  const key = normalizeMerchantKey(input.merchant);
  if (!key) return;
  const [existing] = await db
    .select()
    .from(atelierMerchantCategoryMap)
    .where(
      and(
        eq(atelierMerchantCategoryMap.orgId, input.orgId),
        eq(atelierMerchantCategoryMap.merchantKey, key),
        isNull(atelierMerchantCategoryMap.deletedAt),
      ),
    );
  const now = new Date();
  if (!existing) {
    await db
      .insert(atelierMerchantCategoryMap)
      .values({
        id: rid("merchmap"),
        orgId: input.orgId,
        merchantKey: key,
        merchantLabel: input.merchant.trim().slice(0, 200),
        categoryCode: input.categoryCode,
        subCategoryCode: input.subCategoryCode,
        confirmCount: 1,
        lastConfirmedAt: now,
        lastConfirmedByUserId: input.userId,
      })
      .onConflictDoNothing();
    return;
  }
  const same =
    existing.categoryCode === input.categoryCode &&
    existing.subCategoryCode === input.subCategoryCode;
  await db
    .update(atelierMerchantCategoryMap)
    .set({
      categoryCode: input.categoryCode,
      subCategoryCode: input.subCategoryCode,
      confirmCount: same ? existing.confirmCount + 1 : 1,
      lastConfirmedAt: now,
      lastConfirmedByUserId: input.userId,
      updatedAt: now,
    })
    .where(eq(atelierMerchantCategoryMap.id, existing.id));
}
