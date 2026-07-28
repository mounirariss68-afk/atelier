/**
 * Task #706 — Travel search from chat (flights, hotels, Airbnb links).
 *
 * Three read-only capabilities backed by Duffel (one provider for both
 * flights and Stays hotel inventory):
 *
 *   - travel.search_flights — multi-segment (multi-city capable) flight
 *     search with a multi-airline price comparison. Booking is a
 *     deep-link handoff (Google Flights prefilled per offer) — no
 *     orders/payments in v1.
 *   - travel.search_stays — hotel search around a resolved place, with
 *     rates and a Google Hotels handoff link.
 *   - travel.airbnb_link — pre-filled Airbnb search deep link. Airbnb
 *     has NO public API, so live prices/availability are impossible —
 *     the card says so honestly.
 *
 * All three are deliberately DB-free (no @workspace/db import) so the
 * offline probe can exercise them against a Duffel stub without a
 * database. ACL: partner/leadership roles only (mirrors agent
 * invocation); self-only chat roles never see non-me.* tools anyway,
 * and the module gating below keeps board observers out.
 *
 * Failure policy: no DUFFEL_API_KEY → DuffelConnectionError propagates
 * as a loud "travel search is not configured" tool error. Never stub
 * data outside tests.
 */

import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";
import type { ToolResult } from "./index.js";
import {
  DuffelConnectionError,
  duffelIsTestMode,
  duffelPlaceSuggestions,
  duffelSearchFlights,
  duffelSearchStays,
  type CabinClass,
  type DuffelPlace,
  type FlightOffer,
  type FlightSlice,
} from "../atelier-agents/duffel.js";

// Mirrors AGENT_INVOCABLE_ROLES — travel planning is a delivery-side
// convenience, not a board/finance surface.
const TRAVEL_ROLES: AtelierRole[] = [
  "founding_partner",
  "partner",
  "senior_manager",
  "consultant",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidFutureDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Allow today (timezone slack of one day behind UTC).
  return d.getTime() >= Date.now() - 36 * 60 * 60 * 1000;
}

function duffelError(err: unknown): ToolResult {
  if (err instanceof DuffelConnectionError) {
    return { ok: false, errorCode: "travel_unavailable", errorMessage: err.message };
  }
  throw err;
}

/**
 * Resolve a free-text place ("Dubai", "IST", "Istanbul airport") to a
 * Duffel place. Bare 3-letter IATA codes pass through for flight
 * slices without a lookup. Returns null when nothing matched.
 */
async function resolvePlace(
  query: string,
  opts: { preferType?: "airport" | "city" } = {},
): Promise<DuffelPlace | null> {
  const suggestions = await duffelPlaceSuggestions(query);
  if (suggestions.length === 0) return null;
  if (opts.preferType) {
    const typed = suggestions.find((s) => s.type === opts.preferType && s.iataCode);
    if (typed) return typed;
  }
  return suggestions.find((s) => s.iataCode) ?? suggestions[0];
}

// ---------------------------------------------------------------------
// Task #715 — AED display conversion.
//
// The firm's display currency is AED, but Duffel prices offers in the
// account's settlement currency (often AUD/USD). The travel tools are
// deliberately DB-free (offline probe), so we do NOT use the finance FX
// table here — a static approximate rate table with honest "approx."
// labeling is used instead. Original amount + currency stay in the
// payload.
// ---------------------------------------------------------------------
const AED_PER_UNIT: Record<string, number> = {
  AED: 1,
  USD: 3.6725,
  AUD: 2.41,
  EUR: 3.98,
  GBP: 4.65,
  SAR: 0.979,
  TRY: 0.093,
  CAD: 2.68,
  CHF: 4.12,
  SGD: 2.72,
  JPY: 0.0243,
  INR: 0.0424,
};

/** Convert to AED for display. Returns null for unknown currencies —
 * callers then show the original amount honestly, never a fake rate. */
function toAed(
  amount: number,
  currency: string,
): { amount: number; approx: boolean } | null {
  const cur = (currency || "").toUpperCase();
  const rate = AED_PER_UNIT[cur];
  if (rate === undefined) return null;
  if (cur === "AED") return { amount, approx: false };
  return { amount: Math.round(amount * rate * 100) / 100, approx: true };
}

/** Display price string: AED when convertible (approx-labeled), else
 * the original currency. */
function fmtDisplayPrice(amount: number, currency: string): string {
  const aed = toAed(amount, currency);
  if (!aed) return fmtMoney(amount, currency);
  if (!aed.approx) return fmtMoney(amount, "AED");
  return `AED ${aed.amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} (≈, from ${fmtMoney(amount, currency)})`;
}

const TEST_MODE_NOTE =
  "TEST DATA: the configured Duffel key is a test-mode key, so these offers are sandbox/synthetic data (e.g. 'Duffel Airways') and NOT bookable real flights. A live Duffel key is needed for real inventory.";

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "?";
  // Duffel departing_at is local time without offset — keep as-is.
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : iso;
}

/** "5 hr 10 min" from minutes. */
function fmtDuration(mins: number | null): string | null {
  if (mins === null || mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Summarize one slice (leg) for the rich flight card. */
function summarizeLeg(slice: FlightSlice) {
  const first = slice.segments[0];
  const last = slice.segments[slice.segments.length - 1];
  const depDate = first.departingAt?.slice(0, 10) ?? null;
  const arrDate = last.arrivingAt?.slice(0, 10) ?? null;
  const arrivesNextDay =
    depDate !== null && arrDate !== null && arrDate > depDate;
  const stops = Math.max(0, slice.segments.length - 1);
  // Marketing carriers (unique, in order), plus operating carriers that
  // differ from their marketing carrier (e.g. "flydubai · Emirates").
  const carriers: string[] = [];
  for (const seg of slice.segments) {
    if (seg.carrierName && !carriers.includes(seg.carrierName))
      carriers.push(seg.carrierName);
    if (
      seg.operatingCarrierName &&
      seg.operatingCarrierName !== seg.carrierName &&
      !carriers.includes(seg.operatingCarrierName)
    )
      carriers.push(seg.operatingCarrierName);
  }
  return {
    departTime: fmtTime(first.departingAt),
    arriveTime: fmtTime(last.arrivingAt),
    departDate: depDate,
    originIata: first.originIata,
    destinationIata: last.destinationIata,
    arrivesNextDay,
    stops,
    stopsLabel: stops === 0 ? "Non-stop" : stops === 1 ? "1 stop" : `${stops} stops`,
    durationMinutes: slice.durationMinutes,
    durationLabel: fmtDuration(slice.durationMinutes),
    carriers,
    carriersLabel: carriers.join(" · ") || null,
  };
}

/** Google Flights handoff deep link for one offer's itinerary. */
function flightHandoffLink(
  offer: FlightOffer,
  slices: Array<{ origin: string; destination: string; departureDate: string }>,
): string {
  const legs = slices
    .map((s) => `${s.origin} to ${s.destination} on ${s.departureDate}`)
    .join(", ");
  const q = `Flights ${legs}${offer.airlineName ? ` with ${offer.airlineName}` : ""}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// ---------------------------------------------------------------------
// travel.search_flights — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "travel.search_flights",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_search_flights",
  description:
    "Search real flight offers for business travel: one-way, return, or multi-city (pass one segment per leg). Compares prices across airlines and returns offers with times, cabin, baggage, total price (displayed in AED), and a booking handoff link. Call IMMEDIATELY when origin, destination, and date are known — cabin class defaults to economy and passengers to 1 adult, so NEVER ask the user about cabin class or passenger count unless they raise it themselves. The only thing worth clarifying is a missing/vague exact date (YYYY-MM-DD per segment): relative dates like 'tomorrow' or 'next Tuesday' should be resolved to a concrete date yourself from today's date, not asked about. If the tool itself asks a clarifying question, answer it via the clarification flow — the original route and dates are preserved automatically.",
  slashAliases: { en: ["/flights", "/flight-search"], fr: ["/vols"] },
  inputSchema: {
    type: "object",
    properties: {
      segments: {
        type: "array",
        description:
          "One entry per flight leg, in travel order. For a return trip pass two segments (out + back).",
        items: {
          type: "object",
          properties: {
            origin: {
              type: "string",
              description: "Departure city, airport name, or IATA code (e.g. DXB).",
            },
            destination: {
              type: "string",
              description: "Arrival city, airport name, or IATA code (e.g. IST).",
            },
            date: { type: "string", description: "Departure date, YYYY-MM-DD." },
          },
          required: ["origin", "destination", "date"],
        },
        minItems: 1,
      },
      adults: { type: "integer", minimum: 1, maximum: 9 },
      cabinClass: {
        type: "string",
        enum: ["economy", "premium_economy", "business", "first"],
      },
      maxResults: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["segments"],
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: TRAVEL_ROLES,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "Find me flights Dubai to Istanbul next Tuesday, back Friday",
      "Compare business-class fares DXB to LHR on the 12th",
    ],
    ar: ["ابحث عن رحلات من دبي إلى إسطنبول"],
    fr: ["Trouve des vols Dubaï–Istanbul"],
  },
  async run(input) {
    const rawSegments = Array.isArray(input.segments)
      ? (input.segments as Array<Record<string, unknown>>)
      : [];
    if (rawSegments.length === 0) {
      return {
        ok: false,
        errorCode: "missing_segments",
        errorMessage: "At least one flight segment (origin, destination, date) is required.",
        clarification: {
          field: "segments",
          question: "Where are you flying from and to, and on what date?",
          tool: "travel_search_flights",
          partial: { ...input },
        },
      };
    }
    // Validate dates BEFORE any API call — missing/invalid dates pause
    // the turn with a clarification instead of guessing.
    const badDates = rawSegments
      .map((s, i) => ({ i, date: String(s.date ?? "").trim(), o: s }))
      .filter((x) => !isValidFutureDate(x.date));
    if (badDates.length > 0) {
      const fields = badDates.map((x) => ({
        field: `segments.${x.i}.date`,
        label: `Departure date — ${String(x.o.origin ?? "?")} → ${String(x.o.destination ?? "?")}`,
        inputType: "date" as const,
      }));
      return {
        ok: false,
        errorCode: "missing_dates",
        errorMessage: "Each segment needs a valid future departure date (YYYY-MM-DD).",
        clarification: {
          field: fields[0].field,
          question:
            fields.length > 1
              ? "I need exact departure dates for each leg."
              : `What date should the ${String(badDates[0].o.origin ?? "?")} → ${String(badDates[0].o.destination ?? "?")} flight leave?`,
          fields,
          tool: "travel_search_flights",
          partial: { ...input },
        },
      };
    }

    try {
      // Resolve each endpoint to an IATA code (bare codes pass through).
      const slices: Array<{ origin: string; destination: string; departureDate: string }> = [];
      for (let i = 0; i < rawSegments.length; i++) {
        const seg = rawSegments[i];
        const endpoints: Array<["origin" | "destination", string]> = [
          ["origin", String(seg.origin ?? "").trim()],
          ["destination", String(seg.destination ?? "").trim()],
        ];
        const resolved: Record<string, string> = {};
        for (const [role, text] of endpoints) {
          if (!text) {
            return {
              ok: false,
              errorCode: "missing_place",
              errorMessage: `Segment ${i + 1} is missing its ${role}.`,
              clarification: {
                field: `segments.${i}.${role}`,
                question: `Which city or airport is the ${role} for leg ${i + 1}?`,
                tool: "travel_search_flights",
                partial: { ...input },
              },
            };
          }
          if (/^[A-Za-z]{3}$/.test(text)) {
            resolved[role] = text.toUpperCase();
            continue;
          }
          const place = await resolvePlace(text, { preferType: "city" });
          if (!place?.iataCode) {
            return {
              ok: false,
              errorCode: "unknown_place",
              errorMessage: `Could not find an airport or city matching "${text}".`,
              clarification: {
                field: `segments.${i}.${role}`,
                question: `I couldn't find "${text}" — which airport should I use (name or IATA code)?`,
                tool: "travel_search_flights",
                partial: { ...input },
              },
            };
          }
          resolved[role] = place.iataCode;
        }
        slices.push({
          origin: resolved.origin,
          destination: resolved.destination,
          departureDate: String(seg.date).trim(),
        });
      }

      const adults = Math.max(1, Math.min(9, Number(input.adults ?? 1) || 1));
      const cabinClass = input.cabinClass
        ? (String(input.cabinClass) as CabinClass)
        : undefined;
      const maxResults = Math.max(1, Math.min(20, Number(input.maxResults ?? 10) || 10));

      const offers = await duffelSearchFlights({ slices, adults, cabinClass });
      const sorted = [...offers].sort((a, b) => a.totalAmount - b.totalAmount);

      // Multi-airline price comparison: cheapest total per airline.
      const byAirline = new Map<string, { airline: string; cheapest: FlightOffer }>();
      for (const o of sorted) {
        if (!byAirline.has(o.airlineName)) {
          byAirline.set(o.airlineName, { airline: o.airlineName, cheapest: o });
        }
      }
      const airlineComparison = [...byAirline.values()].map((x) => ({
        airline: x.airline,
        cheapestTotal: fmtDisplayPrice(x.cheapest.totalAmount, x.cheapest.currency),
        cheapestTotalAmount: x.cheapest.totalAmount,
        currency: x.cheapest.currency,
      }));

      // Trip-type qualifier ("one way" / "round trip" / "multi-city").
      const tripType =
        slices.length === 1
          ? "one way"
          : slices.length === 2 &&
              slices[1].origin === slices[0].destination &&
              slices[1].destination === slices[0].origin
            ? "round trip"
            : "multi-city";
      const testMode = duffelIsTestMode();

      const items = sorted.slice(0, maxResults).map((o) => {
        const route = o.segments
          .map(
            (s) =>
              `${s.originIata} ${fmtTime(s.departingAt)} → ${s.destinationIata} ${fmtTime(s.arrivingAt)}`,
          )
          .join(" · ");
        const legs = o.slices.map(summarizeLeg);
        const aed = toAed(o.totalAmount, o.currency);
        return {
          id: o.id,
          label: `${o.airlineName} — ${fmtDisplayPrice(o.totalAmount, o.currency)}`,
          route,
          cabin: o.cabinClass ?? cabinClass ?? "economy",
          stops: Math.max(0, o.segments.length - slices.length),
          checkedBags: o.checkedBags,
          priceAmount: o.totalAmount,
          currency: o.currency,
          priceAedAmount: aed?.amount ?? null,
          priceAedApprox: aed?.approx ?? null,
          priceDisplay: fmtDisplayPrice(o.totalAmount, o.currency),
          href: flightHandoffLink(o, slices),
          // Structured payload for the rich (Google-Flights-style) card.
          flight: {
            tripType,
            cabin: o.cabinClass ?? cabinClass ?? "economy",
            checkedBags: o.checkedBags,
            airline: o.airlineName,
            airlineIata: o.airlineIata,
            legs,
            outbound: legs[0] ?? null,
            price: {
              amount: o.totalAmount,
              currency: o.currency,
              aedAmount: aed?.amount ?? null,
              aedApprox: aed?.approx ?? null,
            },
            testMode,
          },
        };
      });

      const anyConverted = items.some((i) => i.priceAedApprox === true);
      const noteParts = [
        testMode ? TEST_MODE_NOTE : "Prices are live offers.",
        anyConverted
          ? "Prices are shown in AED using an approximate exchange rate; the original fare amount and currency are included with each offer."
          : null,
        "Links open a prefilled flight search to complete booking with the airline (in-chat ticketing is not enabled).",
      ].filter(Boolean);

      return {
        ok: true,
        data: {
          items,
          total: sorted.length,
          slices,
          tripType,
          airlineComparison,
          testMode,
          displayCurrency: "AED",
          note: noteParts.join(" "),
        },
      };
    } catch (err) {
      return duffelError(err);
    }
  },
});

// ---------------------------------------------------------------------
// travel.search_stays — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "travel.search_stays",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_search_stays",
  description:
    "Search hotels for business travel around a city, neighbourhood, or landmark: name, rating, total price for the stay (displayed in AED), cancellation info, and a booking handoff link. Call immediately when location and dates are known — guest/room counts default to 1, never ask about them. Requires exact check-in/check-out dates (YYYY-MM-DD); resolve relative dates yourself from today's date.",
  slashAliases: { en: ["/hotels", "/stays"], fr: ["/hotels"] },
  inputSchema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City, neighbourhood, or landmark (e.g. 'Taksim, Istanbul').",
      },
      checkIn: { type: "string", description: "Check-in date, YYYY-MM-DD." },
      checkOut: { type: "string", description: "Check-out date, YYYY-MM-DD." },
      adults: { type: "integer", minimum: 1, maximum: 9 },
      rooms: { type: "integer", minimum: 1, maximum: 9 },
      maxResults: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["location", "checkIn", "checkOut"],
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: TRAVEL_ROLES,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Find hotels near Taksim for those dates", "Hotels in Riyadh next Sunday to Wednesday"],
    ar: ["ابحث عن فنادق قرب تقسيم"],
    fr: ["Trouve des hôtels près de Taksim"],
  },
  async run(input) {
    const location = String(input.location ?? "").trim();
    const checkIn = String(input.checkIn ?? "").trim();
    const checkOut = String(input.checkOut ?? "").trim();
    const missing: Array<{ field: string; label: string; inputType?: "date" }> = [];
    if (!location) missing.push({ field: "location", label: "Where (city / area)" });
    if (!isValidFutureDate(checkIn))
      missing.push({ field: "checkIn", label: "Check-in date", inputType: "date" });
    if (!isValidFutureDate(checkOut) || (checkIn && checkOut && checkOut <= checkIn))
      missing.push({ field: "checkOut", label: "Check-out date", inputType: "date" });
    if (missing.length > 0) {
      return {
        ok: false,
        errorCode: "missing_stay_details",
        errorMessage: `Need: ${missing.map((m) => m.label).join(", ")}.`,
        clarification: {
          field: missing[0].field,
          question:
            missing.length > 1
              ? `I need ${missing.map((m) => `"${m.label}"`).join(" and ")} to search hotels.`
              : `What should "${missing[0].label}" be?`,
          fields: missing,
          tool: "travel_search_stays",
          partial: { ...input },
        },
      };
    }
    try {
      const place = await resolvePlace(location, { preferType: "city" });
      if (!place || place.latitude === null || place.longitude === null) {
        return {
          ok: false,
          errorCode: "unknown_place",
          errorMessage: `Could not resolve "${location}" to a searchable location.`,
          clarification: {
            field: "location",
            question: `I couldn't place "${location}" — can you give me the city (and country)?`,
            tool: "travel_search_stays",
            partial: { ...input },
          },
        };
      }
      const adults = Math.max(1, Math.min(9, Number(input.adults ?? 1) || 1));
      const rooms = Math.max(1, Math.min(9, Number(input.rooms ?? 1) || 1));
      const maxResults = Math.max(1, Math.min(20, Number(input.maxResults ?? 10) || 10));
      const stays = await duffelSearchStays({
        latitude: place.latitude,
        longitude: place.longitude,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults,
        rooms,
      });
      const priced = [...stays].sort((a, b) => {
        if (a.totalAmount === null) return 1;
        if (b.totalAmount === null) return -1;
        return a.totalAmount - b.totalAmount;
      });
      const nights = Math.max(
        1,
        Math.round(
          (new Date(`${checkOut}T00:00:00Z`).getTime() -
            new Date(`${checkIn}T00:00:00Z`).getTime()) /
            86_400_000,
        ),
      );
      const testMode = duffelIsTestMode();
      const items = priced.slice(0, maxResults).map((s) => {
        const aed =
          s.totalAmount !== null && s.currency ? toAed(s.totalAmount, s.currency) : null;
        return {
        id: s.id,
        label:
          s.totalAmount !== null && s.currency
            ? `${s.name} — ${fmtDisplayPrice(s.totalAmount, s.currency)} total`
            : s.name,
        rating: s.rating,
        reviewScore: s.reviewScore,
        address: s.address,
        priceAmount: s.totalAmount,
        currency: s.currency,
        priceAedAmount: aed?.amount ?? null,
        priceAedApprox: aed?.approx ?? null,
        nightly:
          s.totalAmount !== null && s.currency
            ? fmtDisplayPrice(s.totalAmount / nights, s.currency)
            : null,
        cancellation:
          s.freeCancellation === true
            ? "free cancellation available"
            : s.freeCancellation === false
              ? "non-refundable"
              : null,
        href: `https://www.google.com/travel/search?q=${encodeURIComponent(
          `${s.name} ${place.cityName ?? location}`,
        )}`,
        };
      });
      const anyConverted = items.some((i) => i.priceAedApprox === true);
      const noteParts = [
        testMode ? TEST_MODE_NOTE : null,
        anyConverted
          ? "Prices are shown in AED using an approximate exchange rate; original amounts and currencies are included per hotel."
          : null,
        "Links open a hotel search to complete booking (in-chat hotel booking is not enabled).",
      ].filter(Boolean);
      return {
        ok: true,
        data: {
          items,
          total: priced.length,
          location: { query: location, resolved: place.name },
          checkIn,
          checkOut,
          nights,
          testMode,
          displayCurrency: "AED",
          note: noteParts.join(" "),
        },
      };
    } catch (err) {
      return duffelError(err);
    }
  },
});

// ---------------------------------------------------------------------
// travel.airbnb_link — ranked_list (single deep-link item)
// ---------------------------------------------------------------------
defineCapability({
  id: "travel.airbnb_link",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_airbnb_link",
  description:
    "Build a pre-filled Airbnb search link (location, dates, guests). Airbnb has no public API, so live prices/availability cannot be shown — use this when the user specifically wants Airbnb.",
  slashAliases: { en: ["/airbnb"] },
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string", description: "City or area to search." },
      checkIn: { type: "string", description: "Check-in date, YYYY-MM-DD (optional)." },
      checkOut: { type: "string", description: "Check-out date, YYYY-MM-DD (optional)." },
      adults: { type: "integer", minimum: 1, maximum: 16 },
    },
    required: ["location"],
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: TRAVEL_ROLES,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Find an Airbnb in Kadıköy for those dates"],
    fr: ["Cherche un Airbnb à Kadıköy"],
  },
  async run(input) {
    const location = String(input.location ?? "").trim();
    if (!location) {
      return {
        ok: false,
        errorCode: "missing_location",
        errorMessage: "location is required.",
        clarification: {
          field: "location",
          question: "Which city or area should the Airbnb search cover?",
          tool: "travel_airbnb_link",
          partial: { ...input },
        },
      };
    }
    const params = new URLSearchParams();
    const checkIn = String(input.checkIn ?? "").trim();
    const checkOut = String(input.checkOut ?? "").trim();
    if (DATE_RE.test(checkIn)) params.set("checkin", checkIn);
    if (DATE_RE.test(checkOut)) params.set("checkout", checkOut);
    const adults = Number(input.adults ?? 0);
    if (Number.isInteger(adults) && adults > 0) params.set("adults", String(adults));
    const qs = params.toString();
    const href = `https://www.airbnb.com/s/${encodeURIComponent(location)}/homes${qs ? `?${qs}` : ""}`;
    return {
      ok: true,
      data: {
        items: [
          {
            id: "airbnb-search",
            label: `Airbnb — homes in ${location}`,
            dates: checkIn && checkOut ? `${checkIn} → ${checkOut}` : null,
            href,
          },
        ],
        total: 1,
        note:
          "Airbnb has no public API, so live prices and availability can't be shown here — the link opens a pre-filled Airbnb search.",
      },
    };
  },
});
