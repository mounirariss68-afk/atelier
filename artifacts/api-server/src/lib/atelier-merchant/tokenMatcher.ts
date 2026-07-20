/**
 * Task #396 — token-based fuzzy merchant matcher (ported from the kit's
 * tokenMatcher.ts; category fields swapped for the Task #383 taxonomy pair).
 *
 * Builds an in-memory inverted index over global-merchant name variants and
 * scores candidates with IDF-weighted containment + Jaccard + Levenshtein +
 * bigram overlap. Call resetIndex() after bulk inserts (seed/enrichment).
 */

import type { MerchantStorage } from "./storage";
import {
  extractSignificantTokens,
  generateBigrams,
  extractCoreMerchant,
} from "./normalizer";

export interface TokenMatchResult {
  merchantId?: string;
  merchantName: string;
  categoryCode: string;
  subCategoryCode: string;
  confidence: number;
  matchMethod: "TOKEN_STRONG" | "TOKEN_WEAK";
  matchedVariant?: string;
  secondBestScore?: number;
  evidence: string[];
  alternativeCandidates: Array<{ name: string; confidence: number }>;
}

interface MerchantIndexEntry {
  merchantId: string;
  merchantName: string;
  categoryCode: string;
  subCategoryCode: string;
  confidence: number;
  variants: string[];
  tokenSets: Set<string>[];
  coreMerchants: string[];
}

let merchantIndex: Map<string, MerchantIndexEntry[]> = new Map();
let tokenDocFrequency: Map<string, number> = new Map();
let totalMerchantCount = 0;
let indexBuilt = false;
let buildPromise: Promise<void> | null = null;

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizedLevenshtein(a: string, b: string): number {
  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen > 0 ? 1 - distance / maxLen : 1;
}

function splitVariants(variantString: string | null): string[] {
  if (!variantString) return [];
  return variantString
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function addVariantToIndex(
  entry: MerchantIndexEntry,
  variant: string,
  index: Map<string, MerchantIndexEntry[]>,
): void {
  const tokens = extractSignificantTokens(variant);
  const core = extractCoreMerchant(variant);
  entry.variants.push(variant);
  entry.tokenSets.push(new Set(tokens));
  entry.coreMerchants.push(core);
  for (const token of tokens) {
    if (!index.has(token)) index.set(token, []);
    const existing = index.get(token)!;
    if (!existing.includes(entry)) existing.push(entry);
  }
}

export async function buildMerchantIndex(
  storage: MerchantStorage,
): Promise<void> {
  if (indexBuilt) return;
  if (buildPromise) return buildPromise;

  buildPromise = (async () => {
    const startTime = Date.now();
    const merchants = await storage.listGlobalMerchants();
    const merchantMap = new Map<string, MerchantIndexEntry>();
    let totalVariantsIndexed = 0;

    for (const m of merchants) {
      const key = m.merchantId || m.merchantName;
      if (!merchantMap.has(key)) {
        const entry: MerchantIndexEntry = {
          merchantId: m.merchantId,
          merchantName: m.merchantName,
          categoryCode: m.categoryCode,
          subCategoryCode: m.subCategoryCode,
          confidence: Number(m.confidence) || 0.9,
          variants: [],
          tokenSets: [],
          coreMerchants: [],
        };
        merchantMap.set(key, entry);
        addVariantToIndex(entry, m.merchantName, merchantIndex);
        totalVariantsIndexed++;
      }
      const entry = merchantMap.get(key)!;
      for (const variant of splitVariants(m.variant)) {
        if (variant !== m.merchantName && !entry.variants.includes(variant)) {
          addVariantToIndex(entry, variant, merchantIndex);
          totalVariantsIndexed++;
        }
      }
    }

    totalMerchantCount = merchantMap.size;
    tokenDocFrequency = new Map();
    for (const [, entry] of merchantMap) {
      const allTokens = new Set<string>();
      for (const tokenSet of entry.tokenSets)
        for (const t of tokenSet) allTokens.add(t);
      for (const t of allTokens) {
        tokenDocFrequency.set(t, (tokenDocFrequency.get(t) || 0) + 1);
      }
    }

    indexBuilt = true;
    console.log(
      `[TokenMatcher] Index built: ${merchantMap.size} merchants, ${totalVariantsIndexed} variants, ${tokenDocFrequency.size} tokens in ${Date.now() - startTime}ms`,
    );
  })();

  return buildPromise;
}

export async function findBestMatch(
  storage: MerchantStorage,
  rawText: string,
): Promise<TokenMatchResult | null> {
  await buildMerchantIndex(storage);

  const inputTokens = extractSignificantTokens(rawText);
  const inputCore = extractCoreMerchant(rawText);
  const inputTokenSet = new Set(inputTokens);
  if (inputTokens.length === 0) return null;

  const idf = (token: string): number => {
    const df = tokenDocFrequency.get(token) || 0;
    return Math.log((totalMerchantCount + 1) / (df + 1));
  };

  const candidates = new Set<MerchantIndexEntry>();
  for (const token of inputTokens) {
    const entries = merchantIndex.get(token);
    if (entries) for (const entry of entries) candidates.add(entry);
  }
  if (candidates.size === 0) return null;

  let bestMatch: {
    entry: MerchantIndexEntry;
    score: number;
    variantIdx: number;
    matchedTokens: string[];
  } | null = null;
  let secondBestScore = 0;
  const topCandidates: Array<{
    name: string;
    confidence: number;
    merchantId?: string;
  }> = [];

  for (const entry of candidates) {
    let entryBestScore = 0;

    for (let i = 0; i < entry.tokenSets.length; i++) {
      const variantTokens = entry.tokenSets[i];
      const variantCore = entry.coreMerchants[i];
      const inputArr = Array.from(inputTokenSet);
      const variantArr = Array.from(variantTokens);

      let intersection = 0;
      const matched: string[] = [];
      for (const t of inputArr) {
        if (variantTokens.has(t)) {
          intersection++;
          matched.push(t);
        }
      }
      if (intersection === 0) continue;

      const variantIdfTotal = variantArr.reduce((sum, t) => sum + idf(t), 0);
      const matchedIdfTotal = matched.reduce((sum, t) => sum + idf(t), 0);
      const inputIdfTotal = inputArr.reduce((sum, t) => sum + idf(t), 0);

      const containmentScore =
        variantIdfTotal > 0 ? matchedIdfTotal / variantIdfTotal : 0;

      const tokenCountDiff = Math.abs(inputArr.length - variantArr.length);
      const singleTokenPenalty =
        intersection === 1 &&
        (inputArr.length >= 2 || variantArr.length >= 2) &&
        tokenCountDiff >= 1
          ? 0.35
          : 0;

      const inputCoverage =
        inputIdfTotal > 0 ? matchedIdfTotal / inputIdfTotal : 0;
      const lowCoveragePenalty =
        inputCoverage < 0.5 && intersection <= 1 && inputArr.length >= 2
          ? 0.25
          : 0;

      const unionIdfTotal =
        inputArr
          .filter((t) => !variantTokens.has(t))
          .reduce((sum, t) => sum + idf(t), 0) + variantIdfTotal;
      const idfJaccard = unionIdfTotal > 0 ? matchedIdfTotal / unionIdfTotal : 0;

      const levenshtein = normalizedLevenshtein(inputCore, variantCore);

      const coreTokensMatch =
        variantArr.length > 0 && variantArr.every((t) => inputTokenSet.has(t));
      const coreBonus = coreTokensMatch && variantArr.length >= 2 ? 0.3 : 0;

      const inputBigrams = new Set(generateBigrams(inputTokens));
      const variantBigrams = new Set(generateBigrams(variantArr));
      const bigramSimilarity = jaccardSimilarity(inputBigrams, variantBigrams);

      const score = Math.min(
        containmentScore * 0.35 +
          idfJaccard * 0.2 +
          levenshtein * 0.25 +
          bigramSimilarity * 0.1 +
          coreBonus -
          singleTokenPenalty -
          lowCoveragePenalty,
        0.95,
      );

      if (score > entryBestScore) entryBestScore = score;

      if (!bestMatch || score > bestMatch.score) {
        if (bestMatch) secondBestScore = bestMatch.score;
        bestMatch = { entry, score, variantIdx: i, matchedTokens: matched };
      } else if (
        score > secondBestScore &&
        bestMatch &&
        entry.merchantId !== bestMatch.entry.merchantId
      ) {
        secondBestScore = score;
      }
    }

    if (entryBestScore >= 0.5) {
      topCandidates.push({
        name: entry.merchantName,
        confidence: Math.min(entryBestScore, 0.95),
        merchantId: entry.merchantId,
      });
    }
  }

  topCandidates.sort((a, b) => b.confidence - a.confidence);

  if (bestMatch && bestMatch.score >= 0.5) {
    const finalConfidence = Math.min(bestMatch.score, 0.95);
    const alternativeCandidates =
      finalConfidence < 0.85
        ? topCandidates
            .filter((c) => c.merchantId !== bestMatch!.entry.merchantId)
            .slice(0, 3)
            .map(({ name, confidence }) => ({ name, confidence }))
        : [];

    return {
      merchantId: bestMatch.entry.merchantId,
      merchantName: bestMatch.entry.merchantName,
      categoryCode: bestMatch.entry.categoryCode,
      subCategoryCode: bestMatch.entry.subCategoryCode,
      confidence: finalConfidence,
      matchMethod: bestMatch.score >= 0.8 ? "TOKEN_STRONG" : "TOKEN_WEAK",
      matchedVariant: bestMatch.entry.variants[bestMatch.variantIdx],
      secondBestScore,
      evidence: [
        `tokens_matched:[${bestMatch.matchedTokens.join(",")}]`,
        `variant:${bestMatch.entry.variants[bestMatch.variantIdx]}`,
        `score:${finalConfidence.toFixed(3)}`,
      ],
      alternativeCandidates,
    };
  }

  return null;
}

export function resetIndex(): void {
  merchantIndex = new Map();
  tokenDocFrequency = new Map();
  totalMerchantCount = 0;
  indexBuilt = false;
  buildPromise = null;
}
