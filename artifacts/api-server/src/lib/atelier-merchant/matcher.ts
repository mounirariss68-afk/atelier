/**
 * Task #396 — layered merchant matcher (ported from the kit's
 * merchantMatcher.ts, remapped onto the Task #383 taxonomy).
 *
 * Tier 1 (org merchant memory, atelier_merchant_category_map) is resolved by
 * the CALLER via lookupMerchantMemory() — it carries org scoping and trust
 * counts that don't belong in this generic layer. This module covers:
 *   2. Exact normalized match against atelier_global_merchants
 *   3. Keyword-based category inference (checked before fuzzy)
 *   4. Token-based fuzzy matching with negative guards
 *   5. Keyword fallback
 *   6. Log to atelier_unmatched_merchants for AI enrichment
 */

import type { MerchantStorage } from "./storage";
import { drizzleMerchantStorage } from "./storage";
import { normalizeMerchant } from "./normalizer";
import { findBestMatch, buildMerchantIndex } from "./tokenMatcher";
import { matchByKeyword } from "./keywords";

export interface MerchantMatchResult {
  merchantId?: string;
  merchantName: string;
  categoryCode: string | null;
  subCategoryCode: string | null;
  confidence: number;
  matchMethod:
    | "EXACT_NORMALIZED"
    | "TOKEN_STRONG"
    | "TOKEN_WEAK"
    | "KEYWORD"
    | "KEYWORD_OVER_TOKEN"
    | "NONE";
  evidence: string[];
  alternativeCandidates: Array<{ name: string; confidence: number }>;
  blockedReason?: string;
}

const TRANSFER_MARKER_PATTERN =
  /\b(EFT|SWIFT|HAVALE|HVL|FAST|VİRMAN|VIRMAN|WIRE|CHAPS|BACS|SEPA|ACH|VIREMENT|TRANSFERENCIA|TRASPASO)\b/i;

function shouldSkipFuzzyMatching(cleanedKey: string): string | null {
  if (cleanedKey.length < 4) return `too_short (${cleanedKey.length} chars)`;
  const digitCount = (cleanedKey.match(/\d/g) || []).length;
  const nonSpaceLength = cleanedKey.replace(/\s/g, "").length;
  if (nonSpaceLength > 0 && digitCount / nonSpaceLength > 0.6) {
    return `mostly_digits (${Math.round((digitCount / nonSpaceLength) * 100)}%)`;
  }
  if (TRANSFER_MARKER_PATTERN.test(cleanedKey)) return "transfer_marker";
  return null;
}

export async function matchMerchant(
  rawText: string,
  region = "global",
  storage: MerchantStorage = drizzleMerchantStorage,
): Promise<MerchantMatchResult> {
  const normalized = normalizeMerchant(rawText);

  // 2. Exact normalized match against the global merchant database
  try {
    const m = await storage.findGlobalMerchantByNormalizedName(normalized);
    if (m) {
      return {
        merchantId: m.merchantId,
        merchantName: m.merchantName,
        categoryCode: m.categoryCode,
        subCategoryCode: m.subCategoryCode,
        confidence: Number(m.confidence) || 0.95,
        matchMethod: "EXACT_NORMALIZED",
        evidence: [`exact_normalized:${normalized}`],
        alternativeCandidates: [],
      };
    }
  } catch (e) {
    console.log(`[MerchantMatcher] Exact lookup error: ${e}`);
  }

  // 3. Keyword inference (checked before fuzzy to prevent false positives)
  const keywordMatch = matchByKeyword(rawText);

  // 4. Token-based fuzzy matching with negative guards
  const guardReason = shouldSkipFuzzyMatching(normalized);
  if (guardReason) {
    console.log(
      `[MERCHANT-GUARD] Blocked fuzzy match for "${normalized}" — ${guardReason}`,
    );
    if (keywordMatch) {
      return {
        merchantName: rawText,
        categoryCode: keywordMatch.categoryCode,
        subCategoryCode: keywordMatch.subCategoryCode,
        confidence: 0.7,
        matchMethod: "KEYWORD",
        evidence: [
          `keyword:${keywordMatch.keyword}`,
          `guard_blocked:${guardReason}`,
        ],
        alternativeCandidates: [],
        blockedReason: guardReason,
      };
    }
  } else {
    try {
      const tokenMatch = await findBestMatch(storage, rawText);
      if (tokenMatch && tokenMatch.confidence >= 0.5) {
        const ambiguous =
          tokenMatch.secondBestScore !== undefined &&
          tokenMatch.confidence - tokenMatch.secondBestScore <= 0.05 &&
          tokenMatch.confidence < 0.85;
        if (ambiguous) {
          const reason = `ambiguous (${tokenMatch.confidence.toFixed(3)} vs ${tokenMatch.secondBestScore!.toFixed(3)})`;
          console.log(
            `[MERCHANT-GUARD] Blocked fuzzy match for "${normalized}" — ${reason}`,
          );
          if (keywordMatch) {
            return {
              merchantName: rawText,
              categoryCode: keywordMatch.categoryCode,
              subCategoryCode: keywordMatch.subCategoryCode,
              confidence: 0.7,
              matchMethod: "KEYWORD",
              evidence: [
                `keyword:${keywordMatch.keyword}`,
                `guard_blocked:${reason}`,
                ...tokenMatch.evidence,
              ],
              alternativeCandidates: tokenMatch.alternativeCandidates,
              blockedReason: reason,
            };
          }
        } else {
          if (keywordMatch && tokenMatch.confidence < 0.85) {
            return {
              merchantName: rawText,
              categoryCode: keywordMatch.categoryCode,
              subCategoryCode: keywordMatch.subCategoryCode,
              confidence: 0.75,
              matchMethod: "KEYWORD_OVER_TOKEN",
              evidence: [
                `keyword_preferred:${keywordMatch.keyword}`,
                `token_candidate:${tokenMatch.merchantName}(${tokenMatch.confidence.toFixed(3)})`,
                ...tokenMatch.evidence,
              ],
              alternativeCandidates: tokenMatch.alternativeCandidates,
            };
          }
          return {
            merchantId: tokenMatch.merchantId,
            merchantName: tokenMatch.merchantName,
            categoryCode: tokenMatch.categoryCode,
            subCategoryCode: tokenMatch.subCategoryCode,
            confidence: tokenMatch.confidence,
            matchMethod: tokenMatch.matchMethod,
            evidence: tokenMatch.evidence,
            alternativeCandidates: tokenMatch.alternativeCandidates,
          };
        }
      }
    } catch (e) {
      console.log(`[MerchantMatcher] Token matching error: ${e}`);
    }
  }

  // 5. Keyword fallback
  if (keywordMatch) {
    return {
      merchantName: rawText,
      categoryCode: keywordMatch.categoryCode,
      subCategoryCode: keywordMatch.subCategoryCode,
      confidence: 0.7,
      matchMethod: "KEYWORD",
      evidence: [`keyword_fallback:${keywordMatch.keyword}`],
      alternativeCandidates: [],
    };
  }

  // 6. Final fallback — log for AI enrichment
  try {
    if (normalized.length >= 2) {
      await storage.logUnmatchedMerchant({
        rawMerchantText: rawText,
        normalizedMerchantText: normalized,
        region,
      });
    }
  } catch {
    // non-critical
  }

  return {
    merchantName: rawText,
    categoryCode: null,
    subCategoryCode: null,
    confidence: 0.3,
    matchMethod: "NONE",
    evidence: [`no_match:${normalized}`],
    alternativeCandidates: [],
    blockedReason: guardReason || undefined,
  };
}

export async function warmupMerchantIndex(
  storage: MerchantStorage = drizzleMerchantStorage,
): Promise<void> {
  try {
    await buildMerchantIndex(storage);
  } catch (error) {
    console.error("[MerchantMatcher] Warmup failed:", error);
  }
}
