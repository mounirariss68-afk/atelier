/**
 * Task #706 / #715 / #716 — Travel search from chat (flights, hotels, Airbnb links).
 *
 * Three read-only capabilities backed by self-serve providers with
 * Middle East / Gulf-carrier coverage (Ignav for flights, StayingAPI
 * for hotels — Duffel lacked ME coverage and Amadeus Self-Service was
 * decommissioned 2026-07-17):
 *
 *   - travel.search_flights — multi-segment (multi-city capable) flight
 *     search with a multi-airline price comparison and rich
 *     Google-Flights-style cards (AED display prices). Booking is a
 *     deep-link handoff (Google Flights prefilled per offer) — no
 *     orders/payments in v1.
 *   - travel.search_stays — hotel search by free-text location with
 *     live cross-OTA prices and a direct listing / Google Hotels
 *     handoff link.
 *   - travel.airbnb_link — pre-filled Airbnb search deep link. Airbnb
 *     has NO public API, so live prices/availability are impossible —
 *     the card says so honestly.
 *
 * All three are deliberately DB-free (no @workspace/db import) so the
 * offline probe can exercise them against local provider stubs without
 * a database. ACL: partner/leadership roles only (mirrors agent
 * invocation); self-only chat roles never see non-me.* tools anyway,
 * and the module gating below keeps board observers out.
 *
 * Failure policy: missing IGNAV_API_KEY / STAYINGAPI_API_KEY →
 * TravelConnectionError propagates as a loud "travel search is not
 * configured" tool error (errorCode travel_unavailable). Never stub
 * data outside tests.
 */

import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";
import type { ToolResult } from "./index.js";
// Task #744 — requester travel-preference context (DB-free indirection;
// the real resolver is registered by bootstrap-capabilities).
import { resolveTravelPreferences, travelPrefsNote } from "./travel-preferences.js";
import {
  TravelConnectionError,
  ignavAirportSuggestions,
  ignavSearchFlights,
  stayingIsSandbox,
  stayingSearchHotels,
  type AirportPlace,
  type CabinClass,
  type FlightOffer,
  type FlightSlice,
} from "../atelier-agents/travel-providers.js";

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

function travelError(err: unknown): ToolResult {
  if (err instanceof TravelConnectionError) {
    return { ok: false, errorCode: "travel_unavailable", errorMessage: err.message };
  }
  throw err;
}

/**
 * Resolve a free-text place ("Dubai", "IST", "Istanbul airport") to an
 * airport. Bare 3-letter IATA codes pass through for flight slices
 * without a lookup. Returns null when nothing matched.
 */
async function resolveAirport(query: string): Promise<AirportPlace | null> {
  const r = await resolveAirportScoped(query);
  return r.kind === "none" ? null : r.kind === "match" ? r.place : r.options[0] ?? null;
}

/** Task #786 — airport resolution with honest ambiguity. */
type AirportResolution =
  | { kind: "match"; place: AirportPlace }
  | { kind: "ambiguous"; options: AirportPlace[] }
  | { kind: "none" };

const foldPlace = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim();

/**
 * Resolve a free-text place to an airport, surfacing material ambiguity
 * instead of silently taking the provider's first suggestion. A place
 * that clearly names ONE airport ("Heathrow", "Dubai") still resolves
 * in one step; a multi-airport city ("London", "Tokyo", "New York")
 * comes back `ambiguous` with the provider-ranked candidates so the
 * caller can ask which airport the user means.
 */
async function resolveAirportScoped(query: string): Promise<AirportResolution> {
  const suggestions = await ignavAirportSuggestions(query);
  if (suggestions.length === 0) return { kind: "none" };
  if (suggestions.length === 1) return { kind: "match", place: suggestions[0]! };
  const nq = foldPlace(query);
  // Exact code or exact airport-name mention → unambiguous.
  const exact = suggestions.find(
    (s) => foldPlace(s.code) === nq || foldPlace(s.name ?? "") === nq,
  );
  if (exact) return { kind: "match", place: exact };
  // Relevant = suggestions the query plausibly refers to (city match or
  // name containing the query). Provider order is its relevance ranking.
  const relevant = suggestions.filter((s) => {
    const city = foldPlace(s.city ?? "");
    const name = foldPlace(s.name ?? "");
    return (city && (city === nq || nq.includes(city) || city.includes(nq))) || name.includes(nq);
  });
  const pool = relevant.length > 0 ? relevant : suggestions;
  // Materially different = distinct airport codes.
  const seen = new Set<string>();
  const distinct = pool.filter((s) => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  });
  if (distinct.length <= 1) return { kind: "match", place: distinct[0] ?? pool[0]! };
  return { kind: "ambiguous", options: distinct.slice(0, 5) };
}

/** Option string shown on airport-clarification chips. Keep the IATA
 * code first — the resume path parses it back out of the answer. */
function airportOptionLabel(p: AirportPlace): string {
  const where = [p.city, p.country].filter(Boolean).join(", ");
  return `${p.code} — ${p.name}${where ? ` (${where})` : ""}`;
}

// ---------------------------------------------------------------------
// Task #715 — AED display conversion.
//
// The firm's display currency is AED; providers price in their own
// settlement currencies. Phase 0 (Oct 2026 audit): the private rate table
// that lived here is gone — conversion uses the single FX snapshot in
// lib/atelier-fx (daily ECB import + pegs). The snapshot is in-memory, so
// this module stays DB-free and the offline probe still runs; an unknown
// currency shows the original amount, never an invented rate.
// ---------------------------------------------------------------------
import { convertSync, FxRateMissingError } from "../atelier-fx.js";

/** Convert to AED for display. Returns null for unknown currencies —
 * callers then show the original amount honestly, never a fake rate. */
function toAed(
  amount: number,
  currency: string,
): { amount: number; approx: boolean } | null {
  const cur = (currency || "").toUpperCase();
  if (cur === "AED") return { amount, approx: false };
  try {
    return { amount: Math.round(convertSync(amount, cur, "AED") * 100) / 100, approx: true };
  } catch (err) {
    if (err instanceof FxRateMissingError) return null;
    throw err;
  }
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
  "TEST DATA: the configured StayingAPI key is a sandbox key (stay_test_ prefix), so these hotels are deterministic fixture data and NOT live inventory. Save the live StayingAPI key to get real hotels.";

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "?";
  // Provider times are local wall-clock without offset — keep as-is.
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

/**
 * Airline logo URL (public CDN keyed by IATA code). Clients render the
 * logo with a text fallback when the image 404s — no server fetch.
 */
function airlineLogoUrl(iata: string | null | undefined): string | null {
  const code = (iata ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(code)) return null;
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}

/** "EK 123" style flight-number labels for a slice's segments. */
function legFlightNumbers(slice: FlightSlice): string[] {
  const out: string[] = [];
  for (const seg of slice.segments) {
    const n = (seg.flightNumber ?? "").trim();
    if (!n) continue;
    // Provider numbers may already carry the carrier prefix ("EK123");
    // otherwise prepend the marketing carrier code.
    const label = /[A-Za-z]/.test(n)
      ? n.toUpperCase()
      : `${(seg.carrierIata ?? "").toUpperCase()}${seg.carrierIata ? " " : ""}${n}`;
    if (!out.includes(label)) out.push(label);
  }
  return out;
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
    // Task #721 — keep flight numbers + logo through to the cards.
    flightNumbers: legFlightNumbers(slice),
    flightNumbersLabel: legFlightNumbers(slice).join(" · ") || null,
    logoUrl: airlineLogoUrl(slice.segments[0]?.carrierIata),
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
// Task #745 — guided-flow leg context ("Leg 1 of 2 · DXB → RUH").
// Stateless: the model passes it through search → select so the cards
// can show sequential progress. Parsed defensively from tool input.
// ---------------------------------------------------------------------
type LegContext = { legIndex: number; legCount: number };

function parseLegContext(raw: unknown): LegContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const legIndex = Number(o.legIndex);
  const legCount = Number(o.legCount);
  if (!Number.isInteger(legIndex) || !Number.isInteger(legCount)) return null;
  if (legIndex < 1 || legCount < 1 || legIndex > legCount || legCount > 8)
    return null;
  return { legIndex, legCount };
}

function legContextLabel(
  lc: LegContext,
  origin: string,
  destination: string,
): string {
  return `Leg ${lc.legIndex} of ${lc.legCount} · ${origin} → ${destination}`;
}

const LEG_CONTEXT_SCHEMA = {
  type: "object",
  description:
    "Guided-flow progress context: which leg of the planned trip this call is for. Pass it through from travel_plan_trip's confirmed plan (legIndex is 1-based).",
  properties: {
    legIndex: { type: "integer", minimum: 1 },
    legCount: { type: "integer", minimum: 1 },
  },
  required: ["legIndex", "legCount"],
} as const;

// ---------------------------------------------------------------------
// Task #745 — travel.plan_trip: interactive planner card shown BEFORE
// the first search. DB-free. Emits a clarification whose single field
// has inputType "flight_planner" + a `planner` prefill (shared
// chat-core shape); the client renders the Return/One-way/Multi-city
// planner card and submits the confirmed plan back as JSON in
// clarificationValues.plan. On the confirmed pass the tool validates
// the plan and hands the model a sequential per-leg search script.
// ---------------------------------------------------------------------
type PlannerAirport = { text: string; iata: string | null; label: string | null };
type PlannerSegment = { origin: PlannerAirport; destination: PlannerAirport; date: string };

async function plannerAirport(textRaw: unknown): Promise<PlannerAirport> {
  const text = String(textRaw ?? "").trim();
  if (!text) return { text: "", iata: null, label: null };
  if (/^[A-Za-z]{3}$/.test(text)) {
    const code = text.toUpperCase();
    return { text: code, iata: code, label: code };
  }
  try {
    const place = await resolveAirport(text);
    if (place?.code) {
      return {
        text,
        iata: place.code,
        label: `${place.city || place.name || text} — ${place.code}`,
      };
    }
  } catch {
    // Prefill is best-effort: provider down ⇒ keep the raw text and let
    // the user fix it in the card (the search itself will fail loudly
    // later if the provider is genuinely unavailable).
  }
  return { text, iata: null, label: null };
}

defineCapability({
  id: "travel.plan_trip",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_plan_trip",
  description:
    "START HERE for any new flight request: shows the interactive trip-planner card (Return / One-way / Multi-city tabs, FROM/TO, dates, passengers, cabin) pre-filled with everything the user already said. Pass whatever the user stated — origin, destination, dates, passenger count, cabin, or explicit segments for multi-city — and leave the rest unset; the user completes and confirms the card. NEVER ask about missing details in prose first — emit this planner instead. After the user confirms, the tool returns the confirmed plan plus the exact next step: run travel_search_flights for leg 1 with the provided legContext, let the user pick a flight (travel_select_flight), then search the next leg, and finish with travel_itinerary_summary. Do NOT call this again mid-flow, and do not use it for hotel searches.",
  slashAliases: { en: ["/plan-trip"], fr: ["/planifier-vol"] },
  inputSchema: {
    type: "object",
    properties: {
      tripType: {
        type: "string",
        enum: ["return", "one_way", "multi_city"],
        description:
          "Trip type the user implied. Default: return when both outbound and return dates were given, one_way when only one date, multi_city when 3+ distinct segments.",
      },
      origin: { type: "string", description: "Departure city/airport/IATA as stated." },
      destination: { type: "string", description: "Arrival city/airport/IATA as stated." },
      departDate: { type: "string", description: "Outbound date YYYY-MM-DD when stated." },
      returnDate: { type: "string", description: "Return date YYYY-MM-DD when stated." },
      segments: {
        type: "array",
        description:
          "Multi-city only: one entry per leg in travel order (overrides origin/destination).",
        items: {
          type: "object",
          properties: {
            origin: { type: "string" },
            destination: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD, omit when unknown." },
          },
          required: ["origin", "destination"],
        },
      },
      adults: { type: "integer", minimum: 1, maximum: 9 },
      cabinClass: {
        type: "string",
        enum: ["economy", "premium_economy", "business", "first"],
      },
      plan: {
        type: "string",
        description:
          "INTERNAL — set only by the planner card via the clarification flow (JSON of the confirmed plan). Never fabricate this yourself.",
      },
    },
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: TRAVEL_ROLES,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "I need to fly to Riyadh next week",
      "Plan a trip Dubai → London → New York",
    ],
    ar: ["أريد السفر إلى الرياض الأسبوع القادم"],
    fr: ["Je dois aller à Riyad la semaine prochaine"],
  },
  async run(input) {
    // ── Confirmed pass: the planner card submitted a JSON plan. ──
    const planRaw = input.plan;
    if (typeof planRaw === "string" && planRaw.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(planRaw);
      } catch {
        return {
          ok: false,
          errorCode: "invalid_plan",
          errorMessage: "The confirmed plan was not valid JSON — re-emit the planner card by calling travel_plan_trip without the plan field.",
        };
      }
      const p = (parsed ?? {}) as Record<string, unknown>;
      const tripType = String(p.tripType ?? "");
      if (!["return", "one_way", "multi_city"].includes(tripType)) {
        return {
          ok: false,
          errorCode: "invalid_plan",
          errorMessage: "Confirmed plan is missing a valid tripType.",
        };
      }
      const rawSegs = Array.isArray(p.segments) ? p.segments : [];
      const segs: Array<{ origin: string; destination: string; date: string }> = [];
      for (let i = 0; i < rawSegs.length && i < 8; i++) {
        const s = (rawSegs[i] ?? {}) as Record<string, unknown>;
        const originObj = (s.origin ?? {}) as Record<string, unknown>;
        const destObj = (s.destination ?? {}) as Record<string, unknown>;
        const origin = String(originObj.iata ?? originObj.text ?? "").trim();
        const destination = String(destObj.iata ?? destObj.text ?? "").trim();
        const date = String(s.date ?? "").trim();
        if (!origin || !destination) {
          return {
            ok: false,
            errorCode: "invalid_plan",
            errorMessage: `Leg ${i + 1} of the confirmed plan is missing its origin or destination.`,
          };
        }
        if (!isValidFutureDate(date)) {
          return {
            ok: false,
            errorCode: "invalid_plan",
            errorMessage: `Leg ${i + 1} (${origin} → ${destination}) needs a valid future date (YYYY-MM-DD).`,
          };
        }
        segs.push({ origin: origin.toUpperCase().length === 3 ? origin.toUpperCase() : origin, destination: destination.toUpperCase().length === 3 ? destination.toUpperCase() : destination, date });
      }
      const minSegs = tripType === "return" ? 2 : 1;
      if (segs.length < minSegs) {
        return {
          ok: false,
          errorCode: "invalid_plan",
          errorMessage: `A ${tripType.replace("_", "-")} plan needs at least ${minSegs} segment${minSegs > 1 ? "s" : ""}.`,
        };
      }
      const adults = Math.max(1, Math.min(9, Number(p.adults ?? 1) || 1));
      const cabinClass = ["economy", "premium_economy", "business", "first"].includes(
        String(p.cabinClass ?? ""),
      )
        ? String(p.cabinClass)
        : "economy";
      const legCount = segs.length;
      const first = segs[0];
      const travellerStep =
        adults > 1
          ? ` Because ${adults} passengers are travelling, call list_travel_companions BEFORE travel_itinerary_summary so the user can pick the travellers, then pass the chosen travellers to travel_itinerary_summary.`
          : "";
      return {
        ok: true,
        data: {
          title: `Trip plan confirmed — ${legCount} leg${legCount > 1 ? "s" : ""}`,
          entityType: "flight_plan",
          clarificationPending: false,
          plan: { tripType, segments: segs, adults, cabinClass, legCount },
          fields: [
            { label: "Trip type", value: tripType.replace("_", " ") },
            ...segs.map((s, i) => ({
              label: `Leg ${i + 1}`,
              value: `${s.origin} → ${s.destination} on ${s.date}`,
            })),
            { label: "Passengers", value: String(adults) },
            { label: "Cabin", value: cabinClass },
          ],
          nextStep:
            `Plan confirmed. Now run travel_search_flights for leg 1 of ${legCount}: segments=[{origin:"${first.origin}", destination:"${first.destination}", date:"${first.date}"}], adults=${adults}, cabinClass=${cabinClass}, legContext={legIndex:1, legCount:${legCount}}. ` +
            `After the user picks an offer, call travel_select_flight with that offer's fields AND the same legContext, then search the next leg the same way (legIndex 2, 3, …) until every leg is selected.${travellerStep} ` +
            `Finish with travel_itinerary_summary listing every selected leg. Do NOT re-ask anything the plan already answers.`,
          note: "Plan confirmed — proceed to sequential per-leg search without asking further questions.",
        },
      };
    }

    // ── Prefill pass: build the planner card from what was stated. ──
    const explicitSegs = Array.isArray(input.segments)
      ? (input.segments as Array<Record<string, unknown>>)
      : [];
    const departDate = String(input.departDate ?? "").trim();
    const returnDate = String(input.returnDate ?? "").trim();
    let tripType = String(input.tripType ?? "").trim();
    if (!["return", "one_way", "multi_city"].includes(tripType)) {
      tripType =
        explicitSegs.length >= 3
          ? "multi_city"
          : returnDate
            ? "return"
            : "one_way";
    }

    const segments: PlannerSegment[] = [];
    if (explicitSegs.length > 0) {
      for (const s of explicitSegs.slice(0, 8)) {
        segments.push({
          origin: await plannerAirport(s.origin),
          destination: await plannerAirport(s.destination),
          date: DATE_RE.test(String(s.date ?? "").trim())
            ? String(s.date).trim()
            : "",
        });
      }
    } else {
      const origin = await plannerAirport(input.origin);
      const destination = await plannerAirport(input.destination);
      segments.push({
        origin,
        destination,
        date: DATE_RE.test(departDate) ? departDate : "",
      });
      if (tripType === "return") {
        segments.push({
          origin: destination,
          destination: origin,
          date: DATE_RE.test(returnDate) ? returnDate : "",
        });
      }
    }
    if (tripType === "return" && segments.length === 1) {
      segments.push({
        origin: segments[0].destination,
        destination: segments[0].origin,
        date: DATE_RE.test(returnDate) ? returnDate : "",
      });
    }

    const adults = Math.max(1, Math.min(9, Number(input.adults ?? 1) || 1));
    const cabinClass = ["economy", "premium_economy", "business", "first"].includes(
      String(input.cabinClass ?? ""),
    )
      ? String(input.cabinClass)
      : "economy";

    return {
      ok: false,
      errorCode: "plan_confirmation_needed",
      errorMessage:
        "Waiting for the user to review and confirm the trip planner card.",
      clarification: {
        field: "plan",
        question:
          "Here's your trip so far — adjust anything and confirm to start searching.",
        tool: "travel_plan_trip",
        partial: { ...input },
        fields: [
          {
            field: "plan",
            label: "Trip plan",
            inputType: "flight_planner",
            planner: { tripType, segments, adults, cabinClass },
          },
        ],
      },
    };
  },
});

// ---------------------------------------------------------------------
// travel.search_flights — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "travel.search_flights",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_search_flights",
  description:
    "Search real flight offers for business travel: one-way, return, or multi-city (pass one segment per leg). Compares prices across airlines and returns offers with times, cabin, total price (displayed in AED), and a booking handoff link. Call IMMEDIATELY when origin, destination, and date are known — cabin class defaults to economy and passengers to 1 adult, so NEVER ask the user about cabin class or passenger count unless they raise it themselves. The only thing worth clarifying is a missing/vague exact date (YYYY-MM-DD per segment): relative dates like 'tomorrow' or 'next Tuesday' should be resolved to a concrete date yourself from today's date, not asked about. If the tool itself asks a clarifying question, answer it via the clarification flow — the original route and dates are preserved automatically. When the user asks for a specific airline, pass the `airline` param — NEVER filter airlines only in prose (the card shows what the tool returns). When the user then picks an offer, call travel_select_flight with that offer's fields to continue the guided booking flow.",
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
      airline: {
        type: "string",
        description:
          "Optional airline filter — airline name (e.g. 'Emirates') or 2-letter IATA code (e.g. EK). Only offers on that airline are returned; ALWAYS pass this when the user asks for a specific airline instead of filtering in prose.",
      },
      maxResults: { type: "integer", minimum: 1, maximum: 20 },
      legContext: LEG_CONTEXT_SCHEMA,
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
  async run(input, ctx) {
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
    const outOfOrderIndex = rawSegments.findIndex((segment, index) => {
      if (index === 0) return false;
      const previousDate = String(rawSegments[index - 1]?.date ?? "").trim();
      const currentDate = String(segment.date ?? "").trim();
      return currentDate < previousDate;
    });
    if (outOfOrderIndex > 0) {
      return {
        ok: false,
        errorCode: "out_of_order_dates",
        errorMessage: `Departure date for leg ${outOfOrderIndex + 1} cannot be before leg ${outOfOrderIndex}.`,
        clarification: {
          field: `segments.${outOfOrderIndex}.date`,
          question: `What date should leg ${outOfOrderIndex + 1} leave? It cannot be before the previous leg.`,
          fields: [{
            field: `segments.${outOfOrderIndex}.date`,
            label: `Departure date — leg ${outOfOrderIndex + 1}`,
            inputType: "date" as const,
          }],
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
          // Task #786 — an airport-clarification answer comes back as
          // "LHR — Heathrow Airport (London, GB)"; take the code.
          const answered = /^([A-Za-z]{3}) — /.exec(text);
          if (answered) {
            resolved[role] = answered[1]!.toUpperCase();
            continue;
          }
          const res = await resolveAirportScoped(text);
          if (res.kind === "none") {
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
          if (res.kind === "ambiguous") {
            // Task #786 — "fly to London" must not silently become one
            // airport. Ranked candidates (provider relevance order).
            const options = res.options.map(airportOptionLabel);
            return {
              ok: false,
              errorCode: "ambiguous_place",
              errorMessage: `"${text}" has several airports — ask which one to use.`,
              clarification: {
                field: `segments.${i}.${role}`,
                question: `"${text}" has more than one airport — which should I use?`,
                fields: [
                  {
                    field: `segments.${i}.${role}`,
                    label: `${role === "origin" ? "Departure" : "Arrival"} airport for leg ${i + 1}`,
                    options,
                  },
                ],
                tool: "travel_search_flights",
                partial: { ...input },
              },
            };
          }
          resolved[role] = res.place.code;
        }
        slices.push({
          origin: resolved.origin,
          destination: resolved.destination,
          departureDate: String(seg.date).trim(),
        });
      }

      const adults = Math.max(1, Math.min(9, Number(input.adults ?? 1) || 1));
      // Task #744 — requester's saved preferences (advisory context; a
      // missing/failed lookup never blocks the search).
      const prefs = await resolveTravelPreferences(ctx);
      let prefCabinApplied = false;
      let cabinClass = input.cabinClass
        ? (String(input.cabinClass) as CabinClass)
        : undefined;
      if (
        !cabinClass &&
        prefs?.cabinClass &&
        ["economy", "premium_economy", "business", "first"].includes(prefs.cabinClass)
      ) {
        cabinClass = prefs.cabinClass as CabinClass;
        prefCabinApplied = true;
      }
      // Task #721 — fetch up to 20 so clients can page (10 per page).
      const maxResults = Math.max(1, Math.min(20, Number(input.maxResults ?? 20) || 20));

      const offers = await ignavSearchFlights({ slices, adults, cabinClass });

      // Task #721 — server-side airline filter: match name (substring,
      // case-insensitive) or exact 2-letter IATA code. Filtering here
      // keeps card and prose consistent (the old model-side prose
      // filter left mismatched cards).
      const airlineFilterRaw = String(input.airline ?? "").trim();
      let filtered = offers;
      let airlineFilterApplied: string | null = null;
      if (airlineFilterRaw) {
        const lower = airlineFilterRaw.toLowerCase();
        const isIata = /^[A-Za-z0-9]{2}$/.test(airlineFilterRaw);
        filtered = offers.filter((o) => {
          if (isIata && (o.airlineIata ?? "").toLowerCase() === lower) return true;
          if (o.airlineName.toLowerCase().includes(lower)) return true;
          // Multi-carrier combos: match any segment carrier too.
          return o.segments.some(
            (s) =>
              (isIata && (s.carrierIata ?? "").toLowerCase() === lower) ||
              (s.carrierName ?? "").toLowerCase().includes(lower) ||
              (s.operatingCarrierName ?? "").toLowerCase().includes(lower),
          );
        });
        airlineFilterApplied = airlineFilterRaw;
      }
      const sorted = [...filtered].sort((a, b) => a.totalAmount - b.totalAmount);

      if (airlineFilterApplied && sorted.length === 0) {
        const available = [...new Set(offers.map((o) => o.airlineName))].sort();
        return {
          ok: true,
          data: {
            items: [],
            total: 0,
            slices,
            airlineFilter: airlineFilterApplied,
            availableAirlines: available,
            note: `No offers matched airline "${airlineFilterApplied}" on this route/date. Airlines with offers: ${available.join(", ") || "none"}. Tell the user honestly and offer the alternatives.`,
          },
        };
      }

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
      // Ignav has no sandbox mode — flight fares are always live.
      const testMode = false;

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
          selfTransfer: o.selfTransfer,
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
            selfTransfer: o.selfTransfer,
            airline: o.airlineName,
            airlineIata: o.airlineIata,
            logoUrl: airlineLogoUrl(o.airlineIata),
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

      // Task #745 — guided-flow progress context on the results card.
      const legContext = parseLegContext(input.legContext);
      const legContextOut = legContext
        ? {
            ...legContext,
            label: legContextLabel(
              legContext,
              slices[0]?.origin ?? "?",
              slices[slices.length - 1]?.destination ?? "?",
            ),
          }
        : null;

      const anyConverted = items.some((i) => i.priceAedApprox === true);
      const anySelfTransfer = items.some((i) => i.selfTransfer === true);
      const noteParts = [
        "Prices are live fares.",
        anySelfTransfer
          ? "Some itineraries combine separate tickets per leg (no through-ticketing) — marked as self-transfer."
          : null,
        anyConverted
          ? "Prices are shown in AED using an approximate exchange rate; the original fare amount and currency are included with each offer."
          : null,
        "Links open a prefilled flight search to complete booking with the airline (in-chat ticketing is not enabled).",
        prefCabinApplied && cabinClass
          ? `Cabin defaulted to the traveller's saved preference (${cabinClass.replace("_", " ")}); say so and offer other cabins on request.`
          : null,
      ].filter(Boolean);
      const prefsNote = prefs ? travelPrefsNote(prefs, "flights") : null;

      return {
        ok: true,
        data: {
          items,
          total: sorted.length,
          pageSize: 10,
          slices,
          tripType,
          ...(prefsNote ? { travelerPreferences: prefsNote } : {}),
          ...(prefCabinApplied ? { cabinFromPreferences: cabinClass } : {}),
          ...(airlineFilterApplied ? { airlineFilter: airlineFilterApplied } : {}),
          ...(legContextOut ? { legContext: legContextOut } : {}),
          airlineComparison,
          testMode,
          displayCurrency: "AED",
          note: noteParts.join(" "),
        },
      };
    } catch (err) {
      return travelError(err);
    }
  },
});

// ---------------------------------------------------------------------
// Task #721 — travel.select_flight: guided-booking step after the user
// picks an offer from the results. Stateless: the model passes the
// picked offer's fields back. Handles the "want a return flight?"
// question for one-way picks (via the clarification flow) and offers
// honest fare alternatives (Ignav has NO fare-family data, so the only
// real upsell is re-searching a higher cabin).
// ---------------------------------------------------------------------
defineCapability({
  id: "travel.select_flight",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_select_flight",
  description:
    "Record the flight offer the user picked from travel_search_flights results and drive the next guided-booking step. Pass the picked offer's fields verbatim from the search results (airline, route, date, times, price, cabin, flight numbers, href). For a ONE-WAY pick the tool asks whether the user wants a return flight (and its date) — answer via the clarification flow; if they do, run travel_search_flights for the return leg next. Also surfaces honest fare options: the flight provider has no branded-fare data, so the only real alternatives are other cabin classes — offer to re-run travel_search_flights with cabinClass business/first (or economy) if the user wants different fares. Once every leg of the trip has been selected, call travel_itinerary_summary.",
  slashAliases: {},
  inputSchema: {
    type: "object",
    properties: {
      airline: { type: "string", description: "Airline name from the picked offer." },
      airlineIata: { type: "string", description: "2-letter airline IATA code, when known." },
      origin: { type: "string", description: "Leg origin IATA code." },
      destination: { type: "string", description: "Leg destination IATA code." },
      date: { type: "string", description: "Departure date YYYY-MM-DD." },
      departTime: { type: "string", description: "Departure time HH:MM (local)." },
      arriveTime: { type: "string", description: "Arrival time HH:MM (local)." },
      flightNumbers: {
        type: "array",
        items: { type: "string" },
        description: "Flight numbers for the leg (e.g. ['EK 121']).",
      },
      cabin: { type: "string", description: "Cabin class of the picked offer." },
      priceAmount: { type: "number", description: "Offer total price amount." },
      currency: { type: "string", description: "Offer price currency (e.g. USD)." },
      href: { type: "string", description: "Booking handoff link from the offer." },
      tripType: {
        type: "string",
        enum: ["one way", "round trip", "multi-city"],
        description: "Trip type of the search the offer came from.",
      },
      stops: { type: "integer", description: "Number of stops on the leg." },
      durationLabel: { type: "string", description: "e.g. '5 hr 10 min'." },
      addReturn: {
        type: "string",
        enum: ["yes", "no"],
        description:
          "One-way picks only: whether the user wants a return flight too. Leave unset to have the tool ask.",
      },
      returnDate: {
        type: "string",
        description: "Return departure date YYYY-MM-DD (when addReturn is yes).",
      },
      legContext: LEG_CONTEXT_SCHEMA,
    },
    required: ["airline", "origin", "destination", "date"],
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: TRAVEL_ROLES,
  surfaceOn: ["global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Take the 2pm Emirates one", "Book the second option"],
    fr: ["Prends le vol Emirates de 14 h"],
  },
  async run(input) {
    const airline = String(input.airline ?? "").trim();
    const origin = String(input.origin ?? "").trim().toUpperCase();
    const destination = String(input.destination ?? "").trim().toUpperCase();
    const date = String(input.date ?? "").trim();
    const missing: string[] = [];
    if (!airline) missing.push("airline");
    if (!origin) missing.push("origin");
    if (!destination) missing.push("destination");
    if (!DATE_RE.test(date)) missing.push("date");
    if (missing.length > 0) {
      return {
        ok: false,
        errorCode: "missing_selection_fields",
        errorMessage: `Pass the picked offer's fields from the search results — missing: ${missing.join(", ")}.`,
      };
    }
    const tripType = String(input.tripType ?? "").trim() || "one way";
    const cabin = String(input.cabin ?? "economy").trim() || "economy";
    const addReturn = String(input.addReturn ?? "").trim().toLowerCase();
    const returnDate = String(input.returnDate ?? "").trim();
    // Task #745 — planner-driven flows carry legContext; the planner
    // already decided the trip shape, so the "add a return?" question
    // is skipped (it only applies to ad-hoc one-way picks).
    const legContext = parseLegContext(input.legContext);

    // One-way guided step: ask about a return flight before summarizing.
    if (!legContext && tripType === "one way" && addReturn !== "yes" && addReturn !== "no") {
      return {
        ok: false,
        errorCode: "return_choice_needed",
        errorMessage: "Ask the user whether they also want a return flight.",
        clarification: {
          field: "addReturn",
          question: `Noted — ${airline} ${origin} → ${destination} on ${date}. Do you also want a return flight ${destination} → ${origin}? If yes, pick the return date.`,
          fields: [
            {
              field: "addReturn",
              label: "Add a return flight?",
              options: ["yes", "no"],
            },
            {
              field: "returnDate",
              label: `Return date (${destination} → ${origin})`,
              inputType: "date",
              hint: "Leave blank if no return flight is needed.",
            },
          ],
          tool: "travel_select_flight",
          partial: { ...input },
        },
      };
    }
    if (!legContext && tripType === "one way" && addReturn === "yes" && !isValidFutureDate(returnDate)) {
      return {
        ok: false,
        errorCode: "return_date_needed",
        errorMessage: "A valid future return date (YYYY-MM-DD) is required.",
        clarification: {
          field: "returnDate",
          question: `What date should the return flight ${destination} → ${origin} leave?`,
          fields: [
            {
              field: "returnDate",
              label: `Return date (${destination} → ${origin})`,
              inputType: "date",
            },
          ],
          tool: "travel_select_flight",
          partial: { ...input },
        },
      };
    }
    if (!legContext && tripType === "one way" && addReturn === "yes" && returnDate < date) {
      return {
        ok: false,
        errorCode: "return_before_departure",
        errorMessage: "Return date cannot be before the departure date.",
        clarification: {
          field: "returnDate",
          question: `Pick a return date on or after ${date}.`,
          fields: [{
            field: "returnDate",
            label: `Return date (${destination} → ${origin})`,
            inputType: "date",
          }],
          tool: "travel_select_flight",
          partial: { ...input },
        },
      };
    }

    const priceAmount = Number(input.priceAmount);
    const currency = String(input.currency ?? "").trim().toUpperCase();
    const hasPrice = Number.isFinite(priceAmount) && priceAmount > 0 && !!currency;
    const flightNumbers = Array.isArray(input.flightNumbers)
      ? (input.flightNumbers as unknown[]).map((n) => String(n)).filter(Boolean)
      : [];
    const airlineIata = String(input.airlineIata ?? "").trim().toUpperCase() || null;
    const cabinAlternatives = (
      ["economy", "business", "first"] as const
    ).filter((c) => c !== cabin);
    const wantsReturn = tripType === "one way" && addReturn === "yes";

    const fareOptionsNote =
      "The flight provider exposes no branded-fare (fare family) data, so fare options beyond the quoted fare cannot be shown honestly. The only real alternatives are other cabin classes — offer to re-run the search with cabinClass " +
      cabinAlternatives.join("/") +
      " if the user wants different fares.";
    // Task #745 — sequential guided flow: legContext drives the next
    // step deterministically (next leg's search, or the summary).
    const nextStep = legContext
      ? legContext.legIndex < legContext.legCount
        ? `Leg ${legContext.legIndex} of ${legContext.legCount} selected. Now run travel_search_flights for leg ${legContext.legIndex + 1} of ${legContext.legCount} from the confirmed plan, passing legContext={legIndex:${legContext.legIndex + 1}, legCount:${legContext.legCount}}.`
        : "All legs are now selected. If more than one passenger is travelling and travellers have not been chosen yet, call list_travel_companions next; otherwise call travel_itinerary_summary with every selected leg (include travellers when chosen)."
      : wantsReturn
        ? `Now run travel_search_flights for the return leg ${destination} → ${origin} on ${returnDate}${airline ? ` (offer to filter by ${airline} via the airline param, but show all airlines unless asked)` : ""}.`
        : tripType === "one way"
          ? "No return wanted — call travel_itinerary_summary with this leg to wrap up."
          : "If every leg of the trip is now selected, call travel_itinerary_summary with all selected legs; otherwise continue selecting the remaining legs.";

    return {
      ok: true,
      data: {
        title: `Selected: ${airline} ${origin} → ${destination}`,
        entityType: "flight_selection",
        fields: [
          { label: "Flight", value: `${airline}${flightNumbers.length ? ` ${flightNumbers.join(" · ")}` : ""}` },
          { label: "Route", value: `${origin} → ${destination}` },
          { label: "Date", value: date },
          ...(input.departTime || input.arriveTime
            ? [{ label: "Times", value: `${String(input.departTime ?? "?")} → ${String(input.arriveTime ?? "?")}` }]
            : []),
          { label: "Cabin", value: cabin },
          ...(hasPrice
            ? [{ label: "Price", value: fmtDisplayPrice(priceAmount, currency) }]
            : []),
        ],
        selection: {
          airline,
          airlineIata,
          logoUrl: airlineLogoUrl(airlineIata),
          flightNumbers,
          origin,
          destination,
          date,
          departTime: String(input.departTime ?? "") || null,
          arriveTime: String(input.arriveTime ?? "") || null,
          cabin,
          priceAmount: hasPrice ? priceAmount : null,
          currency: hasPrice ? currency : null,
          href: String(input.href ?? "") || null,
          tripType,
          addReturn: tripType === "one way" ? addReturn : null,
          returnDate: wantsReturn ? returnDate : null,
        },
        ...(legContext
          ? {
              legContext: {
                ...legContext,
                label: legContextLabel(legContext, origin, destination),
              },
            }
          : {}),
        fareOptions: {
          fareFamiliesAvailable: false,
          cabinAlternatives,
          note: fareOptionsNote,
        },
        nextStep,
        note: `${fareOptionsNote} ${nextStep}`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// Task #721 — travel.itinerary_summary: final recap card once every
// leg of the trip has been selected. Stateless — legs are passed in.
// ---------------------------------------------------------------------
defineCapability({
  id: "travel.itinerary_summary",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "travel_itinerary_summary",
  description:
    "Show the final itinerary summary card once the user has selected a flight for EVERY leg of their trip (after travel_select_flight). Pass one entry per selected leg in travel order with the exact fields from the selected offers. Renders each leg with airline logo, flight numbers, times, and a combined total in AED (and original currency), plus the booking handoff links.",
  slashAliases: { en: ["/itinerary"] },
  inputSchema: {
    type: "object",
    properties: {
      legs: {
        type: "array",
        minItems: 1,
        description: "One entry per selected leg, in travel order.",
        items: {
          type: "object",
          properties: {
            airline: { type: "string" },
            airlineIata: { type: "string" },
            flightNumbers: { type: "array", items: { type: "string" } },
            origin: { type: "string", description: "Origin IATA code." },
            destination: { type: "string", description: "Destination IATA code." },
            date: { type: "string", description: "YYYY-MM-DD." },
            departTime: { type: "string" },
            arriveTime: { type: "string" },
            cabin: { type: "string" },
            stops: { type: "integer" },
            durationLabel: { type: "string" },
            priceAmount: { type: "number", description: "Leg price (omit on legs covered by a combined round-trip fare — put the full fare on one leg only)." },
            currency: { type: "string" },
            href: { type: "string", description: "Booking handoff link." },
          },
          required: ["airline", "origin", "destination", "date"],
        },
      },
      adults: { type: "integer", minimum: 1, maximum: 9 },
      travellers: {
        type: "array",
        description:
          "Task #745 — travellers chosen via list_travel_companions (plus the requester). One entry per person; include relationship for dependents.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["self", "colleague", "dependent"] },
            relationship: {
              type: "string",
              description: "For dependents: spouse / child / parent / other.",
            },
          },
          required: ["name"],
        },
      },
    },
    required: ["legs"],
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
    en: ["Show me the full itinerary", "Summarize my trip"],
    fr: ["Résume mon itinéraire"],
  },
  async run(input) {
    const rawLegs = Array.isArray(input.legs)
      ? (input.legs as Array<Record<string, unknown>>)
      : [];
    if (rawLegs.length === 0) {
      return {
        ok: false,
        errorCode: "missing_legs",
        errorMessage: "Pass one entry per selected leg (airline, origin, destination, date).",
      };
    }
    type LegIn = {
      airline: string;
      airlineIata: string | null;
      flightNumbers: string[];
      origin: string;
      destination: string;
      date: string;
      departTime: string | null;
      arriveTime: string | null;
      cabin: string;
      stops: number | null;
      durationLabel: string | null;
      priceAmount: number | null;
      currency: string | null;
      href: string | null;
    };
    const legs: LegIn[] = [];
    for (let i = 0; i < rawLegs.length; i++) {
      const l = rawLegs[i];
      const airline = String(l.airline ?? "").trim();
      const origin = String(l.origin ?? "").trim().toUpperCase();
      const destination = String(l.destination ?? "").trim().toUpperCase();
      const date = String(l.date ?? "").trim();
      if (!airline || !origin || !destination || !DATE_RE.test(date)) {
        return {
          ok: false,
          errorCode: "invalid_leg",
          errorMessage: `Leg ${i + 1} is missing airline/origin/destination or a valid YYYY-MM-DD date.`,
        };
      }
      const amount = Number(l.priceAmount);
      const currency = String(l.currency ?? "").trim().toUpperCase();
      legs.push({
        airline,
        airlineIata: String(l.airlineIata ?? "").trim().toUpperCase() || null,
        flightNumbers: Array.isArray(l.flightNumbers)
          ? (l.flightNumbers as unknown[]).map((n) => String(n)).filter(Boolean)
          : [],
        origin,
        destination,
        date,
        departTime: String(l.departTime ?? "").trim() || null,
        arriveTime: String(l.arriveTime ?? "").trim() || null,
        cabin: String(l.cabin ?? "economy").trim() || "economy",
        stops: Number.isFinite(Number(l.stops)) ? Number(l.stops) : null,
        durationLabel: String(l.durationLabel ?? "").trim() || null,
        priceAmount: Number.isFinite(amount) && amount > 0 && currency ? amount : null,
        currency: Number.isFinite(amount) && amount > 0 && currency ? currency : null,
      href:
          String(l.href ?? "").trim() ||
          `https://www.google.com/travel/flights?q=${encodeURIComponent(
            `Flights ${origin} to ${destination} on ${date} with ${airline}`,
          )}`,
      });
    }

    // Totals: AED (approx) always when convertible; original-currency
    // totals per currency (never sum across currencies).
    let aedTotal = 0;
    let aedConvertible = true;
    const byCurrency = new Map<string, number>();
    let pricedLegs = 0;
    for (const leg of legs) {
      if (leg.priceAmount === null || !leg.currency) continue;
      pricedLegs++;
      byCurrency.set(leg.currency, (byCurrency.get(leg.currency) ?? 0) + leg.priceAmount);
      const aed = toAed(leg.priceAmount, leg.currency);
      if (aed) aedTotal += aed.amount;
      else aedConvertible = false;
    }
    const originalTotals = [...byCurrency.entries()].map(([cur, amt]) => fmtMoney(amt, cur));
    const totalDisplay =
      pricedLegs === 0
        ? null
        : aedConvertible
          ? `AED ${Math.round(aedTotal).toLocaleString("en-US")}${
              originalTotals.length ? ` (≈, from ${originalTotals.join(" + ")})` : ""
            }`
          : originalTotals.join(" + ");

    const adults = Math.max(1, Math.min(9, Number(input.adults ?? 1) || 1));
    // Task #745 — travellers chosen in the guided flow (self + scoped
    // colleagues + own dependents). Names pass through verbatim.
    const travellersRaw = Array.isArray(input.travellers)
      ? (input.travellers as Array<Record<string, unknown>>)
      : [];
    const travellers = travellersRaw
      .slice(0, 12)
      .map((t) => {
        const name = String(t.name ?? "").trim();
        const kind = ["self", "colleague", "dependent"].includes(String(t.kind ?? ""))
          ? String(t.kind)
          : "colleague";
        const relationship = String(t.relationship ?? "").trim() || null;
        return name ? { name, kind, relationship } : null;
      })
      .filter((t): t is { name: string; kind: string; relationship: string | null } => t !== null);
    const items = legs.map((leg, i) => {
      const aed = leg.priceAmount !== null && leg.currency ? toAed(leg.priceAmount, leg.currency) : null;
      return {
        id: `leg-${i + 1}`,
        label: `${leg.airline} — ${leg.origin} → ${leg.destination} ${leg.date}`,
        href: leg.href,
        flight: {
          tripType: null,
          cabin: leg.cabin,
          checkedBags: null,
          selfTransfer: null,
          airline: leg.airline,
          airlineIata: leg.airlineIata,
          logoUrl: airlineLogoUrl(leg.airlineIata),
          legs: [
            {
              departTime: leg.departTime ?? "?",
              arriveTime: leg.arriveTime ?? "?",
              departDate: leg.date,
              originIata: leg.origin,
              destinationIata: leg.destination,
              arrivesNextDay: false,
              stops: leg.stops ?? 0,
              stopsLabel:
                leg.stops === null
                  ? null
                  : leg.stops === 0
                    ? "Non-stop"
                    : leg.stops === 1
                      ? "1 stop"
                      : `${leg.stops} stops`,
              durationMinutes: null,
              durationLabel: leg.durationLabel,
              carriers: [leg.airline],
              carriersLabel: leg.airline,
              flightNumbers: leg.flightNumbers,
              flightNumbersLabel: leg.flightNumbers.join(" · ") || null,
              logoUrl: airlineLogoUrl(leg.airlineIata),
            },
          ],
          outbound: null, // filled by clients from legs[0]
          price:
            leg.priceAmount !== null && leg.currency
              ? {
                  amount: leg.priceAmount,
                  currency: leg.currency,
                  aedAmount: aed?.amount ?? null,
                  aedApprox: aed?.approx ?? null,
                }
              : { amount: null, currency: null, aedAmount: null, aedApprox: null },
          testMode: false,
        },
      };
    });

    return {
      ok: true,
      data: {
        items,
        total: items.length,
        itinerary: {
          legCount: legs.length,
          adults,
          totalDisplay,
          totalAedAmount: pricedLegs > 0 && aedConvertible ? Math.round(aedTotal) : null,
          originalTotals,
          travellers,
        },
        note:
          `Itinerary summary — ${legs.length} leg${legs.length > 1 ? "s" : ""}${totalDisplay ? `, total ${totalDisplay}` : ""}` +
          (travellers.length > 0
            ? `, travellers: ${travellers.map((t) => t.name).join(", ")}`
            : "") +
          ". " +
          "Prices are the selected live fares (AED totals are approximate conversions). Each leg's link opens a prefilled flight search to complete booking with the airline — in-chat ticketing is not enabled.",
      },
    };
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
    "Search hotels for business travel around a city, neighbourhood, or landmark: name, star rating, guest score, live total price for the stay (displayed in AED), and a booking handoff link. Call immediately when location and dates are known — guest/room counts default to 1, never ask about them. Requires exact check-in/check-out dates (YYYY-MM-DD); resolve relative dates yourself from today's date.",
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
  async run(input, ctx) {
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
      const adults = Math.max(1, Math.min(9, Number(input.adults ?? 1) || 1));
      const rooms = Math.max(1, Math.min(9, Number(input.rooms ?? 1) || 1));
      const maxResults = Math.max(1, Math.min(20, Number(input.maxResults ?? 10) || 10));
      // StayingAPI takes free-text locations directly — no coordinate
      // resolution step needed. Wire ctx.progress so the async 202→poll
      // cycle streams live steps into chat instead of freezing at "Thinking…".
      const stays = await stayingSearchHotels({
        location,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults,
        rooms,
        progress: ctx.progress
          ? (pct: number, msg: string) => ctx.progress!(pct, msg)
          : undefined,
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
      const testMode = stayingIsSandbox();
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
          s.nightlyAmount !== null && s.currency
            ? fmtDisplayPrice(s.nightlyAmount, s.currency)
            : s.totalAmount !== null && s.currency
              ? fmtDisplayPrice(s.totalAmount / nights, s.currency)
              : null,
        platform: s.platform,
        href:
          s.bookingUrl ??
          `https://www.google.com/travel/search?q=${encodeURIComponent(`${s.name} ${location}`)}`,
        };
      });
      const anyConverted = items.some((i) => i.priceAedApprox === true);
      const noteParts = [
        testMode ? TEST_MODE_NOTE : null,
        anyConverted
          ? "Prices are shown in AED using an approximate exchange rate; original amounts and currencies are included per hotel."
          : null,
        "Links open the hotel's listing (or a hotel search) to complete booking (in-chat hotel booking is not enabled).",
      ].filter(Boolean);
      // Task #744 — saved-preference context rides beside the results.
      const stayPrefs = await resolveTravelPreferences(ctx);
      const stayPrefsNote = stayPrefs ? travelPrefsNote(stayPrefs, "stays") : null;
      return {
        ok: true,
        data: {
          items,
          total: priced.length,
          ...(stayPrefsNote ? { travelerPreferences: stayPrefsNote } : {}),
          location: { query: location, resolved: location },
          checkIn,
          checkOut,
          nights,
          testMode,
          displayCurrency: "AED",
          note: noteParts.join(" "),
        },
      };
    } catch (err) {
      return travelError(err);
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
