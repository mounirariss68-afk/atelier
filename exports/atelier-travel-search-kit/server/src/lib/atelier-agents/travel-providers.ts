/**
 * Task #716 — travel-search provider clients (flights + hotels).
 *
 * Amadeus Self-Service was decommissioned on 2026-07-17 (Enterprise
 * contract only now), and Duffel lacked Middle East coverage, so the
 * chat travel tools use two self-serve providers:
 *
 *   - Flights: Ignav (https://ignav.com) — one-way / round-trip /
 *     flexible (up to two ordered legs) fare search over Google
 *     Flights-grade inventory, incl. Gulf carriers (Emirates, Qatar
 *     Airways, Saudia, flydubai, …). Auth is a simple X-Api-Key
 *     header (IGNAV_API_KEY) — no OAuth.
 *   - Hotels: StayingAPI (https://stayingapi.com) — cross-OTA hotel
 *     search (Booking.com / Google Hotels / …) in one schema, free-text
 *     location, live prices. Bearer key (STAYINGAPI_API_KEY). Long
 *     searches may return 202 + a poll URL; the client polls to a
 *     terminal state.
 *
 * Read-only retrieval layer: booking stays a deep-link handoff — no
 * orders or payments are ever created here.
 *
 * Failure policy: missing keys or any API failure FAILS LOUDLY with a
 * typed TravelConnectionError — never silent stub data.
 *
 * Testing: ATELIER_IGNAV_BASE_URL / ATELIER_STAYING_BASE_URL point all
 * requests at local stub servers (mirroring the stub-Anthropic /
 * stub-Perplexity probe pattern); no keys required — fully offline.
 */

export class TravelConnectionError extends Error {
  constructor(detail: string) {
    super(`Travel search is unavailable: ${detail}`);
    this.name = "TravelConnectionError";
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =====================================================================
// Ignav — flights
// =====================================================================

function ignavBase(): string {
  const stub = process.env.ATELIER_IGNAV_BASE_URL;
  if (stub) return stub.replace(/\/$/, "");
  return "https://ignav.com";
}

async function ignavRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const stub = process.env.ATELIER_IGNAV_BASE_URL;
  const apiKey = process.env.IGNAV_API_KEY?.trim();
  if (!stub && !apiKey) {
    throw new TravelConnectionError(
      "flight search is not configured — set the IGNAV_API_KEY secret (free instant key from ignav.com).",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${ignavBase()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(apiKey ? { "X-Api-Key": apiKey } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TravelConnectionError(`flight search connection failed (${msg}).`);
  }
  if (!res.ok) {
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new TravelConnectionError(
      `Ignav API returned HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new TravelConnectionError("Ignav API returned a non-JSON response body");
  }
}

export interface AirportPlace {
  code: string;
  name: string;
  city: string | null;
  country: string | null;
}

/** Free-text → ranked airport suggestions (IATA codes). */
export async function ignavAirportSuggestions(query: string): Promise<AirportPlace[]> {
  const rows = await ignavRequest<Array<Record<string, unknown>>>(
    `/api/airports?q=${encodeURIComponent(query)}&limit=8`,
  );
  return (Array.isArray(rows) ? rows : [])
    .map((r): AirportPlace | null => {
      const code = str(r.code);
      if (!code) return null;
      return {
        code: code.toUpperCase(),
        name: str(r.name) ?? code,
        city: str(r.city),
        country: str(r.country),
      };
    })
    .filter((p): p is AirportPlace => p !== null);
}

export type CabinClass = "economy" | "premium_economy" | "business" | "first";

export interface FlightSegment {
  originIata: string;
  destinationIata: string;
  departingAt: string | null;
  arrivingAt: string | null;
  carrierName: string | null;
  carrierIata: string | null;
  operatingCarrierName: string | null;
  operatingCarrierIata: string | null;
  flightNumber: string | null;
}

/** One leg (bound) of an itinerary — feeds the rich flight cards. */
export interface FlightSlice {
  segments: FlightSegment[];
  durationMinutes: number | null;
}

export interface FlightOffer {
  id: string;
  totalAmount: number;
  currency: string;
  airlineName: string;
  airlineIata: string | null;
  cabinClass: string | null;
  segments: FlightSegment[];
  slices: FlightSlice[];
  /** Ignav fare responses carry no baggage allowance — always null. */
  checkedBags: number | null;
  /** True when the itinerary requires separate tickets (self-transfer). */
  selfTransfer: boolean | null;
}

type RawItinerary = Record<string, unknown>;

function parseSlice(leg: Record<string, unknown> | null | undefined): FlightSlice {
  const segs = Array.isArray(leg?.segments)
    ? (leg!.segments as Array<Record<string, unknown>>)
    : [];
  const carrier = str(leg?.carrier);
  return {
    segments: segs.map((s) => ({
      originIata: str(s.departure_airport) ?? "?",
      destinationIata: str(s.arrival_airport) ?? "?",
      departingAt: str(s.departure_time_local),
      arrivingAt: str(s.arrival_time_local),
      // Ignav names the leg-level (marketing) carrier; the marketing
      // code and operating carrier name ride on each segment.
      carrierName: carrier ?? str(s.operating_carrier_name),
      carrierIata: str(s.marketing_carrier_code),
      operatingCarrierName: str(s.operating_carrier_name),
      operatingCarrierIata: null,
      flightNumber: str(s.flight_number),
    })),
    durationMinutes: num(leg?.duration_minutes),
  };
}

function parseItinerary(raw: RawItinerary): FlightOffer | null {
  const price = (raw.price ?? {}) as Record<string, unknown>;
  const totalAmount = num(price.amount);
  const id = str(raw.ignav_id);
  if (!id || totalAmount === null) return null;
  // Legs appear as outbound/inbound (one-way / round-trip endpoints)
  // or as an ordered legs[] array (flexible search).
  const legObjs: Array<Record<string, unknown>> = [];
  if (raw.outbound) legObjs.push(raw.outbound as Record<string, unknown>);
  if (raw.inbound) legObjs.push(raw.inbound as Record<string, unknown>);
  if (Array.isArray(raw.legs)) {
    for (const l of raw.legs as Array<Record<string, unknown>>) legObjs.push(l);
  }
  const slices = legObjs.map((l) => parseSlice(l)).filter((sl) => sl.segments.length > 0);
  const segments = slices.flatMap((sl) => sl.segments);
  if (segments.length === 0) return null;
  const airlineName =
    str(legObjs[0]?.carrier) ?? segments[0].carrierName ?? segments[0].carrierIata ?? "Unknown airline";
  return {
    id,
    totalAmount,
    currency: str(price.currency) ?? "USD",
    airlineName,
    airlineIata: segments[0].carrierIata,
    cabinClass: str(raw.cabin_class),
    segments,
    slices,
    checkedBags: null,
    selfTransfer: typeof raw.requires_self_transfer === "boolean" ? raw.requires_self_transfer : null,
  };
}

function parseItineraries(json: { itineraries?: RawItinerary[] }): FlightOffer[] {
  const rows = Array.isArray(json.itineraries) ? json.itineraries : [];
  return rows.map((r) => parseItinerary(r)).filter((o): o is FlightOffer => o !== null);
}

/**
 * Multi-leg (multi-city capable) flight search. Each slice is one
 * origin→destination leg on a date. Returns parsed offers across
 * airlines, unsorted — callers own the comparison/sort.
 *
 * Endpoint mapping: 1 leg → one-way; 2 mirrored legs → round-trip;
 * 2 other legs (open-jaw/multi-city) → flexible search. Ignav caps
 * flexible search at two ordered legs, so 3+ leg trips are searched
 * per leg and combined (same-carrier combos + a cheapest mixed combo);
 * those combinations are separate tickets per leg.
 */
export async function ignavSearchFlights(args: {
  slices: Array<{ origin: string; destination: string; departureDate: string }>;
  adults: number;
  cabinClass?: CabinClass;
}): Promise<FlightOffer[]> {
  const adults = Math.max(1, args.adults);
  const common = {
    adults,
    ...(args.cabinClass ? { cabin_class: args.cabinClass } : {}),
  };
  const { slices } = args;

  if (slices.length === 1) {
    const s = slices[0];
    const json = await ignavRequest<{ itineraries?: RawItinerary[] }>("/api/fares/one-way", {
      method: "POST",
      body: { origin: s.origin, destination: s.destination, departure_date: s.departureDate, ...common },
    });
    return parseItineraries(json);
  }

  if (slices.length === 2) {
    const [out, back] = slices;
    const mirrored = out.origin === back.destination && out.destination === back.origin;
    if (mirrored) {
      const json = await ignavRequest<{ itineraries?: RawItinerary[] }>("/api/fares/round-trip", {
        method: "POST",
        body: {
          origin: out.origin,
          destination: out.destination,
          departure_date: out.departureDate,
          return_date: back.departureDate,
          ...common,
        },
      });
      return parseItineraries(json);
    }
    const json = await ignavRequest<{ itineraries?: RawItinerary[] }>("/api/fares/search", {
      method: "POST",
      body: {
        legs: slices.map((s) => ({
          origin: s.origin,
          destination: s.destination,
          departure_date: s.departureDate,
        })),
        ...common,
      },
    });
    return parseItineraries(json);
  }

  // 3+ legs: search each leg one-way and combine. Combinations are
  // honest per-leg sums (separate tickets), flagged via selfTransfer.
  const perLeg = await Promise.all(
    slices.map((s) =>
      ignavRequest<{ itineraries?: RawItinerary[] }>("/api/fares/one-way", {
        method: "POST",
        body: { origin: s.origin, destination: s.destination, departure_date: s.departureDate, ...common },
      }).then(parseItineraries),
    ),
  );
  if (perLeg.some((offers) => offers.length === 0)) return [];

  const combine = (picks: FlightOffer[], airlineName: string): FlightOffer => ({
    id: picks.map((p) => p.id).join("+"),
    totalAmount: picks.reduce((sum, p) => sum + p.totalAmount, 0),
    currency: picks[0].currency,
    airlineName,
    airlineIata: picks[0].airlineIata,
    cabinClass: picks[0].cabinClass,
    segments: picks.flatMap((p) => p.segments),
    slices: picks.flatMap((p) => p.slices),
    checkedBags: null,
    selfTransfer: true,
  });

  const offers: FlightOffer[] = [];
  // Same-carrier combos: cheapest offer per carrier on each leg, for
  // carriers present on every leg.
  const carriersEverywhere = perLeg
    .map((legOffers) => new Set(legOffers.map((o) => o.airlineName)))
    .reduce((acc, set) => new Set([...acc].filter((c) => set.has(c))));
  for (const carrier of carriersEverywhere) {
    const picks = perLeg.map(
      (legOffers) =>
        legOffers
          .filter((o) => o.airlineName === carrier)
          .sort((a, b) => a.totalAmount - b.totalAmount)[0],
    );
    offers.push(combine(picks, carrier));
  }
  // Cheapest mixed combo, when it beats (or nothing else exists).
  const cheapestPicks = perLeg.map(
    (legOffers) => [...legOffers].sort((a, b) => a.totalAmount - b.totalAmount)[0],
  );
  const mixed = combine(cheapestPicks, "Mixed airlines");
  if (!offers.some((o) => o.totalAmount <= mixed.totalAmount)) offers.push(mixed);
  return offers;
}

// =====================================================================
// StayingAPI — hotels
// =====================================================================

/**
 * True when the configured StayingAPI key is a sandbox key
 * (`stay_test_` prefix) — sandbox keys return deterministic fixture
 * data, NOT live hotel inventory. Surfaced honestly on result cards.
 */
export function stayingIsSandbox(): boolean {
  return (process.env.STAYINGAPI_API_KEY?.trim() ?? "").startsWith("stay_test_");
}

function stayingBase(): string {
  const stub = process.env.ATELIER_STAYING_BASE_URL;
  if (stub) return stub.replace(/\/$/, "");
  return "https://api.stayingapi.com/v1";
}

async function stayingRequest<T>(path: string): Promise<T> {
  const stub = process.env.ATELIER_STAYING_BASE_URL;
  const apiKey = process.env.STAYINGAPI_API_KEY?.trim();
  if (!stub && !apiKey) {
    throw new TravelConnectionError(
      "hotel search is not configured — set the STAYINGAPI_API_KEY secret (free instant key from stayingapi.com).",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${stayingBase()}${path}`, {
      headers: {
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TravelConnectionError(`hotel search connection failed (${msg}).`);
  }
  if (res.status === 202) {
    // Async job — poll to a terminal state.
    let pollPath: string | null = null;
    try {
      const body = (await res.json()) as { data?: { pollUrl?: unknown } };
      const pollUrl = str(body.data?.pollUrl);
      if (pollUrl) pollPath = pollUrl.replace(/^\/v1(?=\/)/, "");
    } catch {
      /* fall through to error below */
    }
    if (!pollPath) throw new TravelConnectionError("hotel search job had no poll URL");
    const retryAfter = num(res.headers.get("retry-after")) ?? 2;
    return pollStayingJob<T>(pollPath, retryAfter);
  }
  if (!res.ok) {
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new TravelConnectionError(
      `StayingAPI returned HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new TravelConnectionError("StayingAPI returned a non-JSON response body");
  }
}

async function pollStayingJob<T>(pollPath: string, firstWaitSec: number): Promise<T> {
  const apiKey = process.env.STAYINGAPI_API_KEY?.trim();
  let waitSec = Math.min(10, Math.max(1, firstWaitSec));
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(waitSec * 1000);
    let res: Response;
    try {
      res = await fetch(`${stayingBase()}${pollPath}`, {
        headers: {
          accept: "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TravelConnectionError(`hotel search poll failed (${msg}).`);
    }
    if (!res.ok) {
      throw new TravelConnectionError(`StayingAPI job poll returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: { status?: unknown; result?: unknown; error?: { message?: unknown } };
    };
    const status = str(json.data?.status);
    if (status === "completed") return json.data!.result as T;
    if (status === "failed") {
      throw new TravelConnectionError(
        `hotel search job failed${str(json.data?.error?.message) ? ` — ${str(json.data?.error?.message)}` : ""}`,
      );
    }
    waitSec = Math.min(10, Math.max(1, num(res.headers.get("retry-after")) ?? waitSec));
  }
  throw new TravelConnectionError("hotel search job did not complete in time");
}

export interface StayResult {
  id: string;
  name: string;
  /** Hotel star rating (0–5), when reported. */
  rating: number | null;
  /** Guest review score, when reported (see ratingScale). */
  reviewScore: number | null;
  address: string | null;
  totalAmount: number | null;
  nightlyAmount: number | null;
  currency: string | null;
  /** Direct listing URL on the source platform (Booking.com, …). */
  bookingUrl: string | null;
  platform: string | null;
}

type RawProperty = Record<string, unknown>;

function parseProperty(raw: RawProperty): StayResult | null {
  const id = str(raw.id) ?? str(raw.platformListingId);
  const name = str(raw.name);
  if (!id || !name) return null;
  const location = (raw.location ?? {}) as Record<string, unknown>;
  const address =
    str(location.address) ??
    [str(location.city), str(location.country)].filter(Boolean).join(", ") ??
    null;
  const price = (raw.price ?? null) as Record<string, unknown> | null;
  return {
    id,
    name,
    rating: num(raw.starRating),
    reviewScore: num(raw.guestRating),
    address: address || null,
    totalAmount: price ? num(price.totalPrice) : null,
    nightlyAmount: price ? num(price.nightlyPrice) : null,
    currency: price ? str(price.currency) : null,
    bookingUrl: str(raw.url) ?? (price ? str(price.url) : null),
    platform: str(raw.platform),
  };
}

/** Hotel search by free-text location with live prices for the stay. */
export async function stayingSearchHotels(args: {
  location: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  rooms?: number;
  limit?: number;
}): Promise<StayResult[]> {
  const qs = new URLSearchParams({
    location: args.location,
    checkIn: args.checkInDate,
    checkOut: args.checkOutDate,
    adults: String(Math.max(1, args.adults)),
    rooms: String(Math.max(1, args.rooms ?? 1)),
    limit: String(Math.max(1, Math.min(40, args.limit ?? 20))),
    sort: "price_asc",
  });
  const json = await stayingRequest<{ data?: RawProperty[] }>(`/search?${qs.toString()}`);
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((r) => parseProperty(r)).filter((s): s is StayResult => s !== null);
}
