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
 *  10. Task #1316 CogniDocs stub probe: blurry/partial/unreadable receipts
 *      map ×10k amounts + job confidence onto the legacy extraction shape,
 *      never gain invented details, and a failed job throws typed
 *  12. Task #652 arithmetic cross-check of parsed amounts (still runs on
 *      the structured CogniDocs fields at every call site)
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
  const { RECEIPT_PARSE_MEDIA, sanitizeReceiptDetails, formatReceiptDetails, composeEnrichedSummary } = await import(
    "../../src/lib/atelier-receipt-parse.js"
  );
  for (const m of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]) {
    check(`media allows ${m}`, RECEIPT_PARSE_MEDIA.has(m));
  }
  check("media rejects octet-stream", !RECEIPT_PARSE_MEDIA.has("application/octet-stream"));
  check("media rejects svg", !RECEIPT_PARSE_MEDIA.has("image/svg+xml"));
  // Task #1316 — GIF was dropped with the in-house vision extractor
  // (CogniDocs accepts PDF/PNG/JPEG/WEBP only; HEIC converts to JPEG).
  check("media rejects gif (dropped with CogniDocs switch)", !RECEIPT_PARSE_MEDIA.has("image/gif"));

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

  // 10. Task #1316 — CogniDocs-backed receipt parsing (offline stub). One
  // shared parse path for photos AND PDFs: structured fields come back from
  // the company's own document reader, amounts are integers ×10,000, the
  // job confidence (0–100) maps onto the green/amber/red band, and a
  // document with no invoice payload is `unreadable` — never a guessed
  // expense. Enrichment `details` no longer exist at parse time, so the
  // "never invent details" contract holds by construction; the sanitize +
  // compose helpers still guard any legacy stored payloads.
  const { startCognidocsStub, defaultInvoicePayload } = await import(
    "../helpers/cognidocs-stub.js"
  );
  const cd = await startCognidocsStub();
  const { parseReceiptDocViaCognidocs } = await import(
    "../../src/lib/cognidocs/receipt.js"
  );
  const { CognidocsError } = await import("../../src/lib/cognidocs/client.js");
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  try {
    // (a) Blurry taxi receipt: sparse fields + low job confidence → red band,
    // ×10k amounts converted exactly, category key mapped to the legacy hint.
    cd.state.confidence = 30;
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Careem",
      invoiceRef: null,
      issueDate: null,
      currency: "AED",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 485_000,
      categoryKey: "taxi_rideshare",
    });
    const blurry = await parseReceiptDocViaCognidocs(tinyPng, "image/jpeg", "careem.jpg");
    check(
      "blurry: ×10k fields mapped",
      blurry.merchant === "Careem" && blurry.total === 48.5 && blurry.currency === "AED",
      JSON.stringify({ merchant: blurry.merchant, total: blurry.total }),
    );
    check("blurry: low job confidence → red band", blurry.confidence === "red", blurry.confidence);
    check("blurry: category hint mapped", blurry.category === "taxi", blurry.category);
    check("blurry: no invented details", blurry.details === undefined);
    const blurryDetails = sanitizeReceiptDetails(blurry.details);
    const blurryBase = "Taxi ride, amount partially readable.";
    check(
      "blurry: summary unchanged",
      composeEnrichedSummary(blurryBase, blurryDetails) === blurryBase,
    );
    check(
      "blurry: rawText synthesized deterministically from fields",
      (blurry.rawText ?? "").includes("vendor: Careem") &&
        (blurry.rawText ?? "").includes("total: AED 48.50"),
      blurry.rawText,
    );

    // (b) Partial hotel receipt photo: mid confidence → amber; the SAME call
    // path handles images (no separate vision extractor anymore) and the
    // submitted mime type reaches the parser untouched.
    cd.state.confidence = 65;
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Hilton",
      invoiceRef: null,
      issueDate: null,
      currency: "SAR",
      subtotalAmount10k: null,
      taxAmount10k: null,
      totalAmount10k: 9_000_000,
      categoryKey: "hotel_accommodation",
    });
    const partial = await parseReceiptDocViaCognidocs(tinyPng, "image/png", "hilton.png");
    check(
      "partial: mid confidence → amber, total mapped",
      partial.confidence === "amber" && partial.total === 900 && partial.category === "hotel",
      JSON.stringify({ c: partial.confidence, t: partial.total, cat: partial.category }),
    );
    check("partial: no invented details", sanitizeReceiptDetails(partial.details) === undefined);
    const partialBase = "Hotel stay, receipt partially torn.";
    check(
      "partial: summary unchanged",
      composeEnrichedSummary(partialBase, sanitizeReceiptDetails(partial.details)) === partialBase,
    );
    check(
      "partial: photo mime submitted as-is (one path for photos and PDFs)",
      cd.state.lastSubmit?.mimeType === "image/png" &&
        cd.state.lastSubmit?.declaredType === "auto",
      JSON.stringify({ mime: cd.state.lastSubmit?.mimeType, dt: cd.state.lastSubmit?.declaredType }),
    );

    // (c) Unreadable scrap: parse completes but yields no invoice payload →
    // unreadable, never a guessed expense.
    cd.state.invoice = null;
    const scrap = await parseReceiptDocViaCognidocs(tinyPng, "image/jpeg");
    check("scrap: unreadable flagged", scrap.unreadable === true);
    check(
      "scrap: no details, summary unchanged",
      sanitizeReceiptDetails(scrap.details) === undefined &&
        composeEnrichedSummary("Unreadable receipt.", sanitizeReceiptDetails(scrap.details)) ===
          "Unreadable receipt.",
    );

    // (d) A FAILED parse job throws the typed error (fail-loud) — callers
    // map it to a 422/503, never a silent fallback.
    cd.state.failNext = "corrupt file";
    let parseErr: unknown = null;
    try {
      await parseReceiptDocViaCognidocs(tinyPng, "image/png");
    } catch (e) {
      parseErr = e;
    }
    check(
      "failed job throws typed CognidocsError(parse-failed)",
      parseErr instanceof CognidocsError && parseErr.code === "parse-failed",
      String(parseErr),
    );

    // 12. Task #652 — arithmetic cross-check of extracted amounts. The
    // validator survives the CogniDocs switch: subtotal/tax/total come from
    // independently parsed printed fields, so the subtotal+tax=total check
    // stays meaningful.
    const { validateReceiptAmounts, amountInText } = await import(
      "../../src/lib/atelier-receipt-parse.js"
    );

    // (a) Call-site composition: internally inconsistent parsed amounts
    // (the historic Airbnb glyph misread: 4657.72/485.79 vs subtotal 571.93)
    // must NEVER survive with green confidence. The synthesized rawText
    // prints the same wrong numbers, so the correction is blocked as
    // contradicted → downgraded to needs-review, amounts untouched.
    cd.state.confidence = 95;
    cd.state.invoice = defaultInvoicePayload({
      vendorName: "Airbnb",
      invoiceRef: null,
      currency: "AED",
      subtotalAmount10k: 5_719_300,
      taxAmount10k: 4_857_900,
      totalAmount10k: 46_577_200,
      categoryKey: "hotel_accommodation",
    });
    const airbnb = validateReceiptAmounts(
      await parseReceiptDocViaCognidocs(tinyPng, "image/jpeg"),
    );
    check(
      "airbnb: inconsistent amounts downgraded, never green",
      airbnb.confidence === "amber" && airbnb.amountValidation?.status === "downgraded",
      JSON.stringify(airbnb.amountValidation),
    );
    check("airbnb: total not silently rewritten", airbnb.total === 4657.72, String(airbnb.total));

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
  } finally {
    await cd.close();
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
