/**
 * Task #396 — AI merchant enrichment (ported from the kit's
 * merchantEnrichment.ts; classifies onto the Task #383 taxonomy pairs and
 * uses the workspace Anthropic integration).
 *
 * Merchants that fell through every matcher tier (atelier_unmatched_merchants)
 * are batch-classified in ONE LLM call; validated results are inserted into
 * atelier_global_merchants so the next lookup hits tier 2 without an AI call.
 */

import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  atelierGlobalMerchants,
  atelierUnmatchedMerchants,
} from "@workspace/db";
import { DEFAULT_TAXONOMY } from "../atelier-expense-taxonomy";
import { normalizeMerchant } from "./normalizer";
import { resetIndex } from "./tokenMatcher";

const MODEL = "claude-sonnet-4-5";
const SOURCE_TAG = "ai_enrichment_v1";
const CONFIDENCE = 0.75;
/** Keep the batch small enough that a single call finishes inside proxy limits. */
export const ENRICHMENT_BATCH_CAP = 20;

export interface EnrichmentResultItem {
  rawDescription: string;
  normalizedName: string;
  canonicalName: string;
  categoryCode: string;
  subCategoryCode: string;
}

function buildTaxonomyBlock(): string {
  return DEFAULT_TAXONOMY.map(
    (cat) =>
      `  ${cat.code}: [${(cat.children ?? []).map((c) => c.code).join(", ")}]`,
  ).join("\n");
}

function validPairSets(): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const cat of DEFAULT_TAXONOMY) {
    m.set(cat.code, new Set((cat.children ?? []).map((c) => c.code)));
  }
  return m;
}

/**
 * Classify up to ENRICHMENT_BATCH_CAP pending unmatched merchants and insert
 * the validated results into the global merchant table. Returns a summary.
 */
export async function runMerchantEnrichment(): Promise<{
  processed: number;
  classified: number;
  inserted: number;
  remainingPending: number;
}> {
  const pending = await db
    .select()
    .from(atelierUnmatchedMerchants)
    .where(eq(atelierUnmatchedMerchants.status, "pending"))
    .limit(ENRICHMENT_BATCH_CAP);

  if (pending.length === 0) {
    return { processed: 0, classified: 0, inserted: 0, remainingPending: 0 };
  }

  const { anthropic } = await import("@workspace/integrations-anthropic-ai");

  const merchantList = pending
    .map((m, i) => `${i + 1}. "${m.rawMerchantText}"`)
    .join("\n");

  const prompt = `You are a financial transaction categorization expert with deep knowledge of merchants worldwide. Classify each merchant/transaction description into the correct expense category.

CATEGORY TAXONOMY — categoryCode: [allowed subCategoryCodes] (you MUST use EXACTLY these codes):
${buildTaxonomyBlock()}

RULES:
- Return a JSON array with one object per merchant
- "canonicalName": the clean, human-readable merchant/business name. Keep ALL words that are part of the brand identity (e.g. "FACEBK *MCZ768VPF2" → "Facebook Ads"). Only strip location codes, card numbers, terminal IDs, and payment noise.
- "categoryCode": EXACTLY one of the top-level codes above
- "subCategoryCode": EXACTLY one of the sub-codes listed under that categoryCode
- If uncertain, use categoryCode "office_admin", subCategoryCode "general_admin"
- Merchants may be in any language (English, Arabic, Turkish, ...). Use your knowledge of local brands.

MERCHANTS TO CLASSIFY:
${merchantList}

Respond with ONLY a JSON array, no other text:
[{"index": 1, "canonicalName": "...", "categoryCode": "...", "subCategoryCode": "..."}, ...]`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("merchant enrichment: no text in AI response");
  }
  const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("merchant enrichment: no JSON array in AI response");
  }

  const parsed: Array<{
    index: number;
    canonicalName: string;
    categoryCode: string;
    subCategoryCode: string;
  }> = JSON.parse(jsonMatch[0]);

  const pairs = validPairSets();
  const seenIdx = new Set<number>();
  const results: Array<EnrichmentResultItem & { unmatchedId: string }> = [];
  for (const item of parsed) {
    if (!item.index || !item.canonicalName) continue;
    if (seenIdx.has(item.index)) continue;
    seenIdx.add(item.index);
    const row = pending[item.index - 1];
    if (!row) continue;
    let categoryCode = item.categoryCode;
    let subCategoryCode = item.subCategoryCode;
    const subs = pairs.get(categoryCode);
    if (!subs || !subs.has(subCategoryCode)) {
      categoryCode = "office_admin";
      subCategoryCode = "general_admin";
    }
    results.push({
      rawDescription: row.rawMerchantText,
      normalizedName: row.normalizedMerchantText || normalizeMerchant(row.rawMerchantText),
      canonicalName: item.canonicalName,
      categoryCode,
      subCategoryCode,
      unmatchedId: row.id,
    });
  }

  let inserted = 0;
  const enrichedIds: string[] = [];
  for (const r of results) {
    const merchantId = `AI_global_${createHash("md5").update(r.normalizedName).digest("hex").slice(0, 12)}`;
    const insertedRows = await db
      .insert(atelierGlobalMerchants)
      .values({
        id: randomUUID(),
        merchantId,
        merchantName: r.canonicalName,
        normalizedName: r.normalizedName,
        variant: null,
        categoryCode: r.categoryCode,
        subCategoryCode: r.subCategoryCode,
        region: "global",
        confidence: CONFIDENCE,
        source: SOURCE_TAG,
      })
      .onConflictDoNothing({ target: atelierGlobalMerchants.merchantId })
      .returning({ id: atelierGlobalMerchants.id });
    if (insertedRows.length > 0) inserted++;
    enrichedIds.push(r.unmatchedId);
  }

  if (enrichedIds.length > 0) {
    await db
      .update(atelierUnmatchedMerchants)
      .set({ status: "enriched" })
      .where(inArray(atelierUnmatchedMerchants.id, enrichedIds));
  }
  if (inserted > 0) resetIndex();

  const stillPending = await db
    .select({ id: atelierUnmatchedMerchants.id })
    .from(atelierUnmatchedMerchants)
    .where(eq(atelierUnmatchedMerchants.status, "pending"));

  return {
    processed: pending.length,
    classified: results.length,
    inserted,
    remainingPending: stillPending.length,
  };
}
