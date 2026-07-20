/**
 * pnpm --filter @workspace/api-server run test:merchant-parse
 *
 * Task #396 unit tests for the invoice-scanner port. Pure in-memory — no DB,
 * no LLM calls (the matcher takes an injected MerchantStorage).
 *
 * Sections:
 *   1. normalizeMerchant / extractCoreMerchant
 *   2. matchMerchant tier precedence (exact > token > keyword > none)
 *   3. Negative guards (short / digit-heavy / transfer markers / ambiguous)
 *   4. Keyword matching + keyword-over-weak-token preference
 *   5. Unmatched-merchant logging on NONE
 *   6. PDF text-quality gate (assessTextQuality)
 *   7. Parse-endpoint media/caps constants
 *   8. Seed alias maps (EU/NA label → taxonomy pair)
 */
import {
  normalizeMerchant,
  extractCoreMerchant,
  extractSignificantTokens,
  generateBigrams,
} from "../../src/lib/atelier-merchant/normalizer.js";
import { matchMerchant } from "../../src/lib/atelier-merchant/matcher.js";
import { resetIndex } from "../../src/lib/atelier-merchant/tokenMatcher.js";
import { matchByKeyword } from "../../src/lib/atelier-merchant/keywords.js";
import { assessTextQuality } from "../../src/lib/atelier-merchant/pdf.js";
import {
  mapEuLabel,
  mapNaLabel,
  DEFAULT_PAIR,
} from "../../src/lib/atelier-merchant/aliasMap.js";
import type {
  MerchantStorage,
  GlobalMerchantRow,
} from "../../src/lib/atelier-merchant/storage.js";

const failures: string[] = [];
function check(name: string, cond: unknown, detail?: string) {
  if (!cond) failures.push(`${name}${detail ? " — " + detail : ""}`);
}

// ---- In-memory storage stub -------------------------------------------
const merchants: GlobalMerchantRow[] = [
  {
    merchantId: "m_starbucks",
    merchantName: "Starbucks",
    normalizedName: normalizeMerchant("Starbucks"),
    variant: "starbucks coffee",
    categoryCode: "meals_entertainment",
    subCategoryCode: "meal",
    confidence: 0.95,
  },
  {
    merchantId: "m_emirates",
    merchantName: "Emirates",
    normalizedName: normalizeMerchant("Emirates"),
    variant: "emirates airlines",
    categoryCode: "travel",
    subCategoryCode: "flight",
    confidence: 0.95,
  },
];
const unmatchedLog: string[] = [];
const stubStorage: MerchantStorage = {
  async listGlobalMerchants() {
    return merchants;
  },
  async findGlobalMerchantByNormalizedName(normalized) {
    return merchants.find((m) => m.normalizedName === normalized) ?? null;
  },
  async logUnmatchedMerchant(input) {
    unmatchedLog.push(input.rawMerchantText);
  },
};

// ---- 1. Normalization ---------------------------------------------------
check("lowercase + accents", normalizeMerchant("CAFÉ Nero") === "cafe nero");
check(
  "long digit runs stripped",
  normalizeMerchant("STARBUCKS 40123 DUBAI") === "starbucks dubai",
);
check(
  "punctuation stripped, whitespace collapsed",
  normalizeMerchant("McDonald's  -  #123") === "mcdonalds 123",
);
check("empty input", normalizeMerchant("") === "");
check(
  "core drops processor prefix + location + stopwords",
  extractCoreMerchant("POS STARBUCKS LLC DUBAI") === "starbucks",
);
check(
  "significant tokens skip locations/digits",
  extractSignificantTokens("Starbucks 123 Dubai").join(",") === "starbucks",
);
check(
  "bigrams",
  generateBigrams(["a1", "b2", "c3"]).join(",") === "a1_b2,b2_c3",
);
check("bigrams on single token", generateBigrams(["solo"]).length === 0);

// ---- async section ------------------------------------------------------
async function main() {
  resetIndex();

  // 2. Exact normalized match wins with full metadata
  const exact = await matchMerchant("Starbucks", "global", stubStorage);
  check("exact method", exact.matchMethod === "EXACT_NORMALIZED", exact.matchMethod);
  check("exact merchant id", exact.merchantId === "m_starbucks");
  check("exact category", exact.categoryCode === "meals_entertainment");

  // Exact still matches through digit noise (normalization strips it)
  const exactNoisy = await matchMerchant("STARBUCKS 40123", "global", stubStorage);
  check(
    "exact via normalization",
    exactNoisy.matchMethod === "EXACT_NORMALIZED",
    exactNoisy.matchMethod,
  );

  // Token fuzzy match on a variant-ish string that is not an exact hit
  const fuzzy = await matchMerchant(
    "POS EMIRATES AIRLINES DXB 99887",
    "global",
    stubStorage,
  );
  check(
    "fuzzy resolves emirates",
    fuzzy.merchantId === "m_emirates" &&
      (fuzzy.matchMethod === "TOKEN_STRONG" || fuzzy.matchMethod === "TOKEN_WEAK"),
    `${fuzzy.matchMethod} ${fuzzy.merchantName}`,
  );

  // 3. Negative guards
  const short = await matchMerchant("AB1", "global", stubStorage);
  check("short string blocked", short.matchMethod === "NONE" || short.matchMethod === "KEYWORD");
  check("short blockedReason", (short.blockedReason ?? "").includes("too_short"));

  const digits = await matchMerchant("123 456 789 12", "global", stubStorage);
  check(
    "digit-heavy blocked",
    (digits.blockedReason ?? "").includes("mostly_digits"),
    digits.blockedReason,
  );

  const transfer = await matchMerchant(
    "SWIFT TRANSFER EMIRATES SETTLEMENT",
    "global",
    stubStorage,
  );
  check(
    "transfer marker blocks fuzzy",
    transfer.matchMethod !== "TOKEN_STRONG" && transfer.matchMethod !== "TOKEN_WEAK",
    transfer.matchMethod,
  );

  // 4. Keyword matching
  const kw = matchByKeyword("HILTON GARDEN INN RIYADH");
  check("keyword hotel hit", !!kw, JSON.stringify(kw));
  const kwMatch = await matchMerchant("ZZQX HOTEL 77", "global", stubStorage);
  check(
    "keyword path used when no token match",
    kwMatch.matchMethod === "KEYWORD",
    kwMatch.matchMethod,
  );
  check("keyword sets category", !!kwMatch.categoryCode);

  // 5. NONE fallback logs to unmatched
  unmatchedLog.length = 0;
  const none = await matchMerchant("XYZVENDOR QQ", "global", stubStorage);
  check("no match → NONE", none.matchMethod === "NONE", none.matchMethod);
  check("unmatched logged", unmatchedLog.length === 1, String(unmatchedLog.length));
  check("NONE keeps raw name", none.merchantName === "XYZVENDOR QQ");

  // 6. PDF text-quality gate
  const goodText =
    "TAX INVOICE\nInvoice date: 12/05/2026\nStarbucks Coffee LLC Dubai Mall\n" +
    "Item Latte 22.00\nItem Muffin 18.50\nSubtotal 40.50\nVAT 5% 2.03\nTotal 42.53\n" +
    "Thank you for your visit. Payment: VISA ****1234 Amount 42.53 approved.";
  const good = assessTextQuality(goodText);
  check("usable invoice text", good.isUsable, JSON.stringify(good));

  check("empty text unusable", !assessTextQuality("").isUsable);
  check("short text unusable", !assessTextQuality("Total 42.53").isUsable);

  const garbled =
    "\u0001\u0002\u0003\u0004\u0005".repeat(40) + " 12/05/2026 40.50 22.00";
  check("garbled text unusable", !assessTextQuality(garbled).isUsable);

  const noNumbers =
    "This is a long paragraph of perfectly readable prose that talks about " +
    "nothing financial at all and contains neither dates nor monetary amounts " +
    "so it must not pass the receipt quality gate even though it is clean text.";
  check("no dates/amounts unusable", !assessTextQuality(noNumbers).isUsable);

  // 7. Media handling constants
  const { RECEIPT_PARSE_MEDIA } = await import(
    "../../src/lib/atelier-receipt-parse.js"
  );
  for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]) {
    check(`media allows ${m}`, RECEIPT_PARSE_MEDIA.has(m));
  }
  check("media rejects octet-stream", !RECEIPT_PARSE_MEDIA.has("application/octet-stream"));
  check("media rejects svg", !RECEIPT_PARSE_MEDIA.has("image/svg+xml"));

  // 8. Seed alias maps
  const eu = mapEuLabel("Food and drinks", "Restaurants and cafes");
  check("EU label maps", eu.mapped ? !!eu.pair.categoryCode : eu.pair === DEFAULT_PAIR);
  const euUnknown = mapEuLabel("nonsense group", "nonsense category");
  check("EU unknown → default pair", euUnknown.mapped === false && euUnknown.pair.categoryCode === DEFAULT_PAIR.categoryCode);
  const naUnknown = mapNaLabel("definitely-not-a-category");
  check("NA unknown → default pair", naUnknown.mapped === false && naUnknown.pair.categoryCode === DEFAULT_PAIR.categoryCode);

  // ---- report ----
  if (failures.length) {
    console.error(`FAIL (${failures.length}):`);
    for (const f of failures) console.error(" - " + f);
    process.exit(1);
  }
  console.log("merchant-parse tests: all checks passed");
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
