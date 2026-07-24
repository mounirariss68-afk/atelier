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
 *   9. Task #500 enrichment sanitize + description composition
 *  10. Task #506 stub-Anthropic probe: blurry/partial receipt texts must
 *      never gain invented details (details absent, summary unchanged)
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  const { RECEIPT_PARSE_MEDIA, sanitizeReceiptDetails, formatReceiptDetails, composeEnrichedSummary } = await import(
    "../../src/lib/atelier-receipt-parse.js"
  );
  for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "application/pdf"]) {
    check(`media allows ${m}`, RECEIPT_PARSE_MEDIA.has(m));
  }
  check("media rejects octet-stream", !RECEIPT_PARSE_MEDIA.has("application/octet-stream"));
  check("media rejects svg", !RECEIPT_PARSE_MEDIA.has("image/svg+xml"));

  // 7b. Task #554 — HEIC detection + conversion
  {
    const { looksLikeHeic, isHeicPayload, convertHeicToJpeg } = await import("../../src/lib/atelier-heic.js");
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
    const heicBytes = readFileSync(path.join(fixtureDir, "fixtures/receipt.heic"));

    check("heic magic bytes detected", looksLikeHeic(heicBytes));
    check("heic payload via declared type", isHeicPayload(Buffer.from("x".repeat(16)), "image/heic"));
    check("heic payload via magic under octet-stream", isHeicPayload(heicBytes, "application/octet-stream"));
    check("jpeg bytes not heic", !looksLikeHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])));
    check("declared jpeg never treated as heic", !isHeicPayload(heicBytes, "image/jpeg"));
    check("avif brand not heic", !looksLikeHeic(Buffer.from("\0\0\0\x1cftypavif\0\0\0\0", "latin1")));
    check("short buffer not heic", !looksLikeHeic(Buffer.from("ftyp")));

    const jpeg = await convertHeicToJpeg(heicBytes);
    check("heic converts to jpeg magic", jpeg.length > 100 && jpeg[0] === 0xff && jpeg[1] === 0xd8);

    // Garbage with a valid HEIC header must fail loudly, not silently pass.
    const garbage = Buffer.concat([heicBytes.subarray(0, 24), Buffer.from("garbage".repeat(20))]);
    let garbageThrew = false;
    try {
      await convertHeicToJpeg(garbage);
    } catch {
      garbageThrew = true;
    }
    check("garbage heic fails cleanly", garbageThrew);
  }

  // 8. Seed alias maps
  const eu = mapEuLabel("Food and drinks", "Restaurants and cafes");
  check("EU label maps", eu.mapped ? !!eu.pair.categoryCode : eu.pair === DEFAULT_PAIR);
  const euUnknown = mapEuLabel("nonsense group", "nonsense category");
  check("EU unknown → default pair", euUnknown.mapped === false && euUnknown.pair.categoryCode === DEFAULT_PAIR.categoryCode);
  const naUnknown = mapNaLabel("definitely-not-a-category");
  check("NA unknown → default pair", naUnknown.mapped === false && naUnknown.pair.categoryCode === DEFAULT_PAIR.categoryCode);

  // 9. Task #500 — enrichment sanitize + description composition
  check("sanitize null → undefined", sanitizeReceiptDetails(null) === undefined);
  check("sanitize junk → undefined", sanitizeReceiptDetails({ bogus: 1, trip: "x" }) === undefined);
  check(
    "sanitize empty sub-objects → undefined",
    sanitizeReceiptDetails({ trip: {}, flight: { route: "  " }, covers: -2 }) === undefined,
  );
  const trip = sanitizeReceiptDetails({
    trip: { pickup: " DIFC ", dropoff: "Dubai Mall", datetime: "2026-07-20 18:45" },
  });
  check("trip sanitized", trip?.trip?.pickup === "DIFC" && trip?.trip?.dropoff === "Dubai Mall");
  check(
    "trip formatted",
    formatReceiptDetails(trip) === "Trip: DIFC → Dubai Mall, 2026-07-20 18:45",
    formatReceiptDetails(trip),
  );
  const flight = sanitizeReceiptDetails({
    flight: { route: "IST → DXB", airline: "Turkish Airlines", travelClass: "Business", passenger: "G. Aydin", reference: "TK123ABC" },
  });
  check(
    "flight formatted",
    formatReceiptDetails(flight) ===
      "Flight: IST → DXB, Turkish Airlines, Business, G. Aydin, ref TK123ABC",
    formatReceiptDetails(flight),
  );
  const stay = sanitizeReceiptDetails({
    stay: { checkIn: "2026-07-01", checkOut: "2026-07-04", nights: 3, city: "Riyadh" },
  });
  check(
    "stay formatted",
    formatReceiptDetails(stay) === "Stay: 2026-07-01 – 2026-07-04, 3 nights, Riyadh",
    formatReceiptDetails(stay),
  );
  check("stay rejects bad dates", sanitizeReceiptDetails({ stay: { checkIn: "1 July" } }) === undefined);
  const covers = sanitizeReceiptDetails({ covers: 4 });
  check("covers formatted", formatReceiptDetails(covers) === "4 covers");
  const rental = sanitizeReceiptDetails({
    rental: { period: "2026-07-01 to 2026-07-04", pickupLocation: "DXB Airport", returnLocation: "DXB Airport", vehicleClass: "Compact SUV" },
  });
  check(
    "rental same-location collapses",
    formatReceiptDetails(rental) === "Rental: 2026-07-01 to 2026-07-04, DXB Airport, Compact SUV",
    formatReceiptDetails(rental),
  );
  const sub = sanitizeReceiptDetails({
    billingPeriod: { service: "Figma Professional", start: "2026-07-01", end: "2026-07-31" },
  });
  check(
    "subscription formatted",
    formatReceiptDetails(sub) === "Subscription: Figma Professional, 2026-07-01 – 2026-07-31",
    formatReceiptDetails(sub),
  );
  check(
    "compose appends detail",
    composeEnrichedSummary("Meal, within policy.", covers) === "Meal, within policy. — 4 covers",
  );
  check(
    "compose degrades to base when no detail",
    composeEnrichedSummary("Meal, within policy.", undefined) === "Meal, within policy.",
  );
  check("compose empty base → detail only", composeEnrichedSummary("", covers) === "4 covers");
  check("compose both empty", composeEnrichedSummary(null, undefined) === "");

  // 10. Task #506 — stub-Anthropic probe: blurry/partial receipt texts must
  // never end up with invented enrichment details. The stub serves the canned
  // extraction the prompt demands for low-quality input (no `details` key, or
  // a malformed hallucinated one that sanitizeReceiptDetails must drop), and
  // we assert the final proposal-side values: details === undefined and the
  // composed summary is byte-identical to the base summary.
  const { extractReceiptFromText } = await import(
    "../../src/lib/atelier-receipt-parse.js"
  );

  const cannedQueue: Array<Record<string, unknown>> = [];
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const canned = cannedQueue.shift() ?? { unreadable: true };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(canned) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const stubPort = (stub.address() as AddressInfo).port;
  // The anthropic client reads env at (lazy) import time inside
  // extractReceiptFromText — set it before the first call.
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "stub-key";

  try {
    // (a) Blurry taxi receipt: model follows the prompt and omits `details`.
    cannedQueue.push({
      merchant: "Careem",
      total: 48.5,
      currency: "AED",
      category: "taxi",
      rawText: "C▌reem ... 48.5▌ AED [rest illegible]",
      confidence: "red",
    });
    const blurry = await extractReceiptFromText("C▌reem 48.5▌ [smudged]");
    check("blurry: model omits details", blurry.details === undefined);
    const blurryDetails = sanitizeReceiptDetails(blurry.details);
    check("blurry: sanitized details stay absent", blurryDetails === undefined);
    const blurryBase = "Taxi ride, amount partially readable.";
    check(
      "blurry: summary unchanged",
      composeEnrichedSummary(blurryBase, blurryDetails) === blurryBase,
    );

    // (b) Partial hotel receipt: model hallucinates a malformed details
    // object (non-ISO dates, blank city, zero nights) — sanitizer drops it all.
    cannedQueue.push({
      merchant: "Hilton",
      total: 900,
      currency: "SAR",
      category: "hotel",
      rawText: "HILTON ... TOTAL 900 [torn edge]",
      confidence: "amber",
      details: {
        stay: { checkIn: "early July", checkOut: "sometime", nights: 0, city: "  " },
        trip: "n/a",
        covers: -1,
        madeUpKey: { foo: "bar" },
      },
    });
    const partial = await extractReceiptFromText("HILTON TOTAL 900 [torn]");
    const partialDetails = sanitizeReceiptDetails(partial.details);
    check(
      "partial: hallucinated malformed details dropped",
      partialDetails === undefined,
      JSON.stringify(partialDetails),
    );
    const partialBase = "Hotel stay, receipt partially torn.";
    check(
      "partial: summary unchanged",
      composeEnrichedSummary(partialBase, partialDetails) === partialBase,
    );

    // (c) Unreadable scrap: model flags unreadable, no details anywhere.
    cannedQueue.push({ unreadable: true, confidence: "red", rawText: "" });
    const scrap = await extractReceiptFromText("▌▌▌▌");
    check("scrap: unreadable flagged", scrap.unreadable === true);
    check(
      "scrap: no details, summary unchanged",
      sanitizeReceiptDetails(scrap.details) === undefined &&
        composeEnrichedSummary("Unreadable receipt.", sanitizeReceiptDetails(scrap.details)) ===
          "Unreadable receipt.",
    );

    // Guardrail in the prompt itself: the no-fabrication instruction must
    // stay in the extraction guidance that both vision & text paths share.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../src/lib/atelier-receipt-parse.ts", import.meta.url),
        "utf8",
      ),
    );
    check(
      "prompt keeps no-fabrication rule",
      src.includes("NEVER infer, guess, or fabricate") &&
        src.includes('Omit "details" entirely'),
    );

    // 11. Task #510 — same stub probe, but through the VISION (photo) path:
    // extractReceiptWithVision must also refuse invented details. We feed a
    // tiny 1x1 PNG buffer; the stub serves canned extractions with omitted or
    // hallucinated-malformed details, and we assert the proposal-side values
    // mirror section 10: details === undefined, summary byte-identical.
    const { extractReceiptWithVision } = await import(
      "../../src/lib/atelier-receipt-parse.js"
    );
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    // (a) Blurry photo: model follows the prompt and omits `details`.
    cannedQueue.push({
      merchant: "Careem",
      total: 48.5,
      currency: "AED",
      category: "taxi",
      rawText: "C▌reem ... 48.5▌ AED [photo blurry]",
      confidence: "red",
    });
    const visBlurry = await extractReceiptWithVision(tinyPng, "image/png");
    check("vision blurry: model omits details", visBlurry.details === undefined);
    const visBlurryDetails = sanitizeReceiptDetails(visBlurry.details);
    check("vision blurry: sanitized details stay absent", visBlurryDetails === undefined);
    const visBlurryBase = "Taxi ride, photo blurry.";
    check(
      "vision blurry: summary unchanged",
      composeEnrichedSummary(visBlurryBase, visBlurryDetails) === visBlurryBase,
    );

    // (b) Photo of a torn hotel receipt: model hallucinates a malformed
    // details object — sanitizer must drop every part of it.
    cannedQueue.push({
      merchant: "Hilton",
      total: 900,
      currency: "SAR",
      category: "hotel",
      rawText: "HILTON ... TOTAL 900 [photo cut off]",
      confidence: "amber",
      details: {
        stay: { checkIn: "early July", checkOut: "sometime", nights: 0, city: "  " },
        flight: { route: "", airline: 42 },
        covers: -3,
        inventedKey: { foo: "bar" },
      },
    });
    const visPartial = await extractReceiptWithVision(tinyPng, "image/png");
    const visPartialDetails = sanitizeReceiptDetails(visPartial.details);
    check(
      "vision partial: hallucinated malformed details dropped",
      visPartialDetails === undefined,
      JSON.stringify(visPartialDetails),
    );
    const visPartialBase = "Hotel stay, photo partially cut off.";
    check(
      "vision partial: summary unchanged",
      composeEnrichedSummary(visPartialBase, visPartialDetails) === visPartialBase,
    );

    // (c) Unreadable photo: model flags unreadable, no details anywhere.
    cannedQueue.push({ unreadable: true, confidence: "red", rawText: "" });
    const visScrap = await extractReceiptWithVision(tinyPng, "image/png");
    check("vision scrap: unreadable flagged", visScrap.unreadable === true);
    check(
      "vision scrap: no details, summary unchanged",
      sanitizeReceiptDetails(visScrap.details) === undefined &&
        composeEnrichedSummary("Unreadable receipt photo.", sanitizeReceiptDetails(visScrap.details)) ===
          "Unreadable receipt photo.",
    );
    // 12. Task #652 — currency-glyph amount misreads. A real Airbnb receipt
    // (total د.إ657.72, tax د.إ85.79) was extracted as 4657.72/485.79 with
    // green confidence — the dirham glyph read as a leading "4". The shared
    // pipeline must arithmetically cross-check and self-correct (or downgrade)
    // before any consumer trusts the numbers.
    const { validateReceiptAmounts, amountInText } = await import(
      "../../src/lib/atelier-receipt-parse.js"
    );

    // (a) End-to-end through the stubbed extractor: misread total+tax, but
    // subtotal read correctly → unambiguous stray-leading-digit fix.
    cannedQueue.push({
      merchant: "Airbnb",
      total: 4657.72,
      tax: 485.79,
      subtotal: 571.93,
      currency: "AED",
      country: "UAE",
      category: "hotel",
      rawText:
        "Airbnb receipt\n2 nights\nSubtotal د.إ571.93\nVAT د.إ85.79\nTotal (AED) د.إ657.72\nVISA ···· 4722 د.إ657.72",
      confidence: "green",
    });
    const airbnb = await extractReceiptFromText("Airbnb Total د.إ657.72 ...");
    check("airbnb: total corrected", airbnb.total === 657.72, String(airbnb.total));
    check("airbnb: tax corrected", airbnb.tax === 85.79, String(airbnb.tax));
    check(
      "airbnb: validation stamped corrected",
      airbnb.amountValidation?.status === "corrected",
      JSON.stringify(airbnb.amountValidation),
    );

    // (b) Correct values pass through untouched (green stays green).
    const good = validateReceiptAmounts({
      total: 657.72,
      tax: 85.79,
      subtotal: 571.93,
      confidence: "green",
      rawText: "Subtotal 571.93 VAT 85.79 Total 657.72",
    });
    check("good: total unchanged", good.total === 657.72);
    check("good: confidence stays green", good.confidence === "green");
    check("good: status ok", good.amountValidation?.status === "ok");

    // (c) Inconsistent but ambiguous → downgrade, never invent a number.
    const ambiguous = validateReceiptAmounts({
      total: 900,
      tax: 50,
      subtotal: 700,
      confidence: "green",
      rawText: "irrelevant",
    });
    check("ambiguous: total NOT rewritten", ambiguous.total === 900, String(ambiguous.total));
    check(
      "ambiguous: downgraded to amber",
      ambiguous.confidence === "amber" && ambiguous.amountValidation?.status === "downgraded",
      JSON.stringify(ambiguous.amountValidation),
    );

    // (d) rawText contradicting a would-be fix blocks the correction.
    const contradicted = validateReceiptAmounts({
      total: 4657.72,
      tax: 85.79,
      subtotal: 571.93,
      confidence: "green",
      rawText: "Grand total 4,657.72", // original verifiably printed, fix absent
    });
    check(
      "contradicted: downgrade instead of correct",
      contradicted.total === 4657.72 && contradicted.amountValidation?.status === "downgraded",
      JSON.stringify(contradicted.amountValidation),
    );

    // (e) Repeated printed totals that all agree force the fix even without
    // a subtotal.
    const mentionsFix = validateReceiptAmounts({
      total: 4657.72,
      tax: 0,
      totalMentions: [657.72, 657.72],
      confidence: "green",
      rawText: "Total 657.72 ... Charged 657.72",
    });
    check(
      "mentions: total corrected",
      mentionsFix.total === 657.72 && mentionsFix.amountValidation?.status === "corrected",
      JSON.stringify(mentionsFix.amountValidation),
    );

    // (f) No subtotal, no repeated total, no tax — must NOT false-positive.
    const noSignals = validateReceiptAmounts({
      total: 48.5,
      tax: 0,
      confidence: "green",
      rawText: "Careem trip 48.50 AED",
    });
    check("no-signals: untouched", noSignals.total === 48.5 && noSignals.confidence === "green");
    const noTax = validateReceiptAmounts({
      total: 30,
      tax: 0,
      subtotal: 30,
      confidence: "green",
      rawText: "OpenAI $30.00",
    });
    check("no-tax subtotal==total: ok", noTax.amountValidation?.status === "ok" && noTax.confidence === "green");

    // (g) rawText-only weak signal: total absent but stripped variant printed
    // → downgrade (never rewrite on this evidence alone).
    const weak = validateReceiptAmounts({
      total: 4657.72,
      tax: 0,
      confidence: "green",
      rawText: "Total (AED) 657.72",
    });
    check(
      "weak rawText signal: downgraded, not rewritten",
      weak.total === 4657.72 && weak.confidence === "amber" && weak.amountValidation?.status === "downgraded",
      JSON.stringify(weak.amountValidation),
    );

    // (h) amountInText boundary awareness: 657.72 inside 4,657.72 must not match.
    check("amountInText: substring guarded", amountInText("Total 4,657.72", 657.72) === false);
    check("amountInText: comma form found", amountInText("Total 4,657.72", 4657.72) === true);
    check("amountInText: plain found", amountInText("Total 657.72", 657.72) === true);

    // (i) Prompt guardrails present in the shared guidance.
    check(
      "prompt keeps currency-glyph rules",
      src.includes("Currency symbols and marks are NEVER digits") &&
        src.includes("د.إ657.72") &&
        src.includes("card-number fragments"),
    );
  } finally {
    stub.close();
  }

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
