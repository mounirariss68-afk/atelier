/**
 * Task #706 — Duffel travel-search client (flights + Stays).
 *
 * Read-only retrieval layer for the chat travel tools: multi-segment
 * flight offer search (multi-airline price comparison) and hotel
 * (Stays) search. Booking is a deep-link handoff in v1 — no orders or
 * payments are ever created here.
 *
 * Failure policy: a missing DUFFEL_API_KEY or any API failure FAILS
 * LOUDLY with a typed DuffelConnectionError — never silent stub data.
 *
 * Testing: when ATELIER_DUFFEL_BASE_URL is set (local stub server,
 * mirroring the stub-Anthropic / stub-Perplexity probe pattern) all
 * requests go to that base URL and no API key is required — fully
 * offline.
 */

export class DuffelConnectionError extends Error {
  constructor(detail: string) {
    super(`Travel search is unavailable: ${detail}`);
    this.name = "DuffelConnectionError";
  }
}

const DUFFEL_VERSION = "v2";

/**
 * Task #715 — test-mode key detection. Duffel test keys are prefixed
 * `duffel_test`; their offers are synthetic ("Duffel Airways",
 * implausible fares) and NOT bookable. Callers surface this honestly.
 */
export function duffelIsTestMode(): boolean {
  return (process.env.DUFFEL_API_KEY ?? "").trim().startsWith("duffel_test");
}

function baseUrl(): string {
  const stub = process.env.ATELIER_DUFFEL_BASE_URL;
  if (stub) return stub.replace(/\/$/, "");
  return "https://api.duffel.com";
}

async function duffelRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const stub = process.env.ATELIER_DUFFEL_BASE_URL;
  const apiKey = process.env.DUFFEL_API_KEY?.trim();
  if (!stub && !apiKey) {
    throw new DuffelConnectionError(
      "travel search is not configured — set the DUFFEL_API_KEY secret (a Duffel test-mode key works for search).",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "Duffel-Version": DUFFEL_VERSION,
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DuffelConnectionError(`connection failed (${msg}).`);
  }
  if (!res.ok) {
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new DuffelConnectionError(
      `Duffel API returned HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new DuffelConnectionError("Duffel API returned a non-JSON response body");
  }
}

// ---------------------------------------------------------------------
// Places (airport / city resolution)
// ---------------------------------------------------------------------

export interface DuffelPlace {
  id: string;
  type: string; // "airport" | "city"
  name: string;
  iataCode: string | null;
  cityName: string | null;
  countryName: string | null;
  latitude: number | null;
  longitude: number | null;
}

type RawPlace = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  iata_code?: unknown;
  city_name?: unknown;
  iata_country_code?: unknown;
  country_name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Free-text → ranked place suggestions (airports + cities). */
export async function duffelPlaceSuggestions(query: string): Promise<DuffelPlace[]> {
  const json = await duffelRequest<{ data?: RawPlace[] }>(
    `/places/suggestions?query=${encodeURIComponent(query)}`,
  );
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .map((r): DuffelPlace | null => {
      const id = str(r.id);
      if (!id) return null;
      return {
        id,
        type: str(r.type) ?? "airport",
        name: str(r.name) ?? id,
        iataCode: str(r.iata_code),
        cityName: str(r.city_name),
        countryName: str(r.country_name) ?? str(r.iata_country_code),
        latitude: num(r.latitude),
        longitude: num(r.longitude),
      };
    })
    .filter((p): p is DuffelPlace => p !== null);
}

// ---------------------------------------------------------------------
// Flights — offer request with inline offers
// ---------------------------------------------------------------------

export type CabinClass = "economy" | "premium_economy" | "business" | "first";

export interface FlightSegment {
  originIata: string;
  destinationIata: string;
  departingAt: string | null;
  arrivingAt: string | null;
  carrierName: string | null;
  carrierIata: string | null;
  /** Operating carrier when Duffel reports one distinct from marketing. */
  operatingCarrierName: string | null;
  operatingCarrierIata: string | null;
  flightNumber: string | null;
}

/** One slice (origin→destination leg, possibly multi-segment). */
export interface FlightSlice {
  segments: FlightSegment[];
  /** Total slice duration in minutes, from Duffel's ISO-8601 `duration`. */
  durationMinutes: number | null;
}

export interface FlightOffer {
  id: string;
  totalAmount: number;
  currency: string;
  airlineName: string;
  airlineIata: string | null;
  cabinClass: string | null;
  /** Flattened segments across all slices (legacy consumers). */
  segments: FlightSegment[];
  /** Per-slice structure (Task #715 rich cards). */
  slices: FlightSlice[];
  /** Checked-bag quantity included, when Duffel reports baggage. */
  checkedBags: number | null;
}

/** Parse an ISO-8601 duration ("PT5H10M") to minutes. */
function isoDurationMinutes(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
  if (!m) return null;
  const mins =
    (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
  return mins > 0 ? mins : null;
}

type RawOffer = Record<string, unknown>;

function parseOffer(raw: RawOffer): FlightOffer | null {
  const id = str(raw.id);
  const totalAmount = num(raw.total_amount);
  if (!id || totalAmount === null) return null;
  const owner = (raw.owner ?? {}) as Record<string, unknown>;
  const slices = Array.isArray(raw.slices) ? (raw.slices as Array<Record<string, unknown>>) : [];
  const segments: FlightSegment[] = [];
  const parsedSlices: FlightSlice[] = [];
  let checkedBags: number | null = null;
  let cabinClass: string | null = null;
  for (const slice of slices) {
    const segs = Array.isArray(slice.segments)
      ? (slice.segments as Array<Record<string, unknown>>)
      : [];
    const sliceSegments: FlightSegment[] = [];
    for (const seg of segs) {
      const origin = (seg.origin ?? {}) as Record<string, unknown>;
      const destination = (seg.destination ?? {}) as Record<string, unknown>;
      const carrier = (seg.marketing_carrier ?? seg.operating_carrier ?? {}) as Record<
        string,
        unknown
      >;
      const opCarrier = (seg.operating_carrier ?? {}) as Record<string, unknown>;
      const parsedSeg: FlightSegment = {
        originIata: str(origin.iata_code) ?? "?",
        destinationIata: str(destination.iata_code) ?? "?",
        departingAt: str(seg.departing_at),
        arrivingAt: str(seg.arriving_at),
        carrierName: str(carrier.name),
        carrierIata: str(carrier.iata_code),
        operatingCarrierName: str(opCarrier.name),
        operatingCarrierIata: str(opCarrier.iata_code),
        flightNumber: str(seg.marketing_carrier_flight_number),
      };
      segments.push(parsedSeg);
      sliceSegments.push(parsedSeg);
      const paxes = Array.isArray(seg.passengers)
        ? (seg.passengers as Array<Record<string, unknown>>)
        : [];
      for (const pax of paxes) {
        if (cabinClass === null) cabinClass = str(pax.cabin_class);
        const bags = Array.isArray(pax.baggages)
          ? (pax.baggages as Array<Record<string, unknown>>)
          : [];
        for (const bag of bags) {
          if (str(bag.type) === "checked") {
            checkedBags = (checkedBags ?? 0) + (num(bag.quantity) ?? 0);
          }
        }
      }
    }
    if (sliceSegments.length > 0) {
      parsedSlices.push({
        segments: sliceSegments,
        durationMinutes: isoDurationMinutes(slice.duration),
      });
    }
  }
  if (segments.length === 0) return null;
  return {
    id,
    totalAmount,
    currency: str(raw.total_currency) ?? "USD",
    airlineName: str(owner.name) ?? "Unknown airline",
    airlineIata: str(owner.iata_code),
    cabinClass,
    segments,
    slices: parsedSlices,
    checkedBags,
  };
}

/**
 * Multi-segment (multi-city capable) flight search. Each slice is one
 * origin→destination leg on a date. Returns parsed offers across
 * airlines, unsorted — callers own the comparison/sort.
 */
export async function duffelSearchFlights(args: {
  slices: Array<{ origin: string; destination: string; departureDate: string }>;
  adults: number;
  cabinClass?: CabinClass;
}): Promise<FlightOffer[]> {
  const body = {
    data: {
      slices: args.slices.map((s) => ({
        origin: s.origin,
        destination: s.destination,
        departure_date: s.departureDate,
      })),
      passengers: Array.from({ length: Math.max(1, args.adults) }, () => ({
        type: "adult" as const,
      })),
      ...(args.cabinClass ? { cabin_class: args.cabinClass } : {}),
    },
  };
  const json = await duffelRequest<{ data?: { offers?: RawOffer[] } }>(
    "/air/offer_requests?return_offers=true",
    { method: "POST", body },
  );
  const rawOffers = Array.isArray(json.data?.offers) ? json.data.offers : [];
  return rawOffers
    .map((o) => parseOffer(o))
    .filter((o): o is FlightOffer => o !== null);
}

// ---------------------------------------------------------------------
// Stays — hotel search
// ---------------------------------------------------------------------

export interface StayResult {
  id: string;
  name: string;
  rating: number | null;
  reviewScore: number | null;
  address: string | null;
  totalAmount: number | null;
  currency: string | null;
  /** Free-cancellation available on the cheapest rate, when reported. */
  freeCancellation: boolean | null;
}

function parseStay(raw: Record<string, unknown>): StayResult | null {
  const id = str(raw.id);
  const acc = (raw.accommodation ?? raw) as Record<string, unknown>;
  const name = str(acc.name);
  if (!id || !name) return null;
  const location = (acc.location ?? {}) as Record<string, unknown>;
  const address = (location.address ?? {}) as Record<string, unknown>;
  const addressParts = [str(address.line_one), str(address.city_name), str(address.country_code)]
    .filter(Boolean)
    .join(", ");
  // Cancellation: surfaced differently across Duffel Stays versions —
  // sniff both the flat flag and a cancellation_timeline on the
  // cheapest rate when present.
  let freeCancellation: boolean | null = null;
  const cheapestRate = (raw.cheapest_rate ?? acc.cheapest_rate ?? null) as Record<
    string,
    unknown
  > | null;
  if (cheapestRate) {
    const timeline = Array.isArray(cheapestRate.cancellation_timeline)
      ? (cheapestRate.cancellation_timeline as unknown[])
      : null;
    if (timeline) freeCancellation = timeline.length > 0;
  }
  return {
    id,
    name,
    rating: num(acc.rating),
    reviewScore: num(acc.review_score),
    address: addressParts || null,
    totalAmount: num(raw.cheapest_rate_total_amount ?? acc.cheapest_rate_total_amount),
    currency: str(raw.cheapest_rate_currency ?? acc.cheapest_rate_currency),
    freeCancellation,
  };
}

/** Hotel search around coordinates (from a resolved place). */
export async function duffelSearchStays(args: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  rooms?: number;
}): Promise<StayResult[]> {
  const body = {
    data: {
      location: {
        radius: Math.max(1, Math.min(50, Math.round(args.radiusKm ?? 5))),
        geographic_coordinates: {
          latitude: args.latitude,
          longitude: args.longitude,
        },
      },
      check_in_date: args.checkInDate,
      check_out_date: args.checkOutDate,
      guests: Array.from({ length: Math.max(1, args.adults) }, () => ({
        type: "adult" as const,
      })),
      rooms: Math.max(1, args.rooms ?? 1),
    },
  };
  const json = await duffelRequest<{ data?: { results?: Array<Record<string, unknown>> } }>(
    "/stays/search",
    { method: "POST", body },
  );
  const rows = Array.isArray(json.data?.results) ? json.data.results : [];
  return rows.map((r) => parseStay(r)).filter((s): s is StayResult => s !== null);
}
