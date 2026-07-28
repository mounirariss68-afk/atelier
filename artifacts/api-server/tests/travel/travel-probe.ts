/**
 * Task #706 / #715 / #716 — offline probe for the chat travel capabilities.
 *
 * Boots local provider stub servers (ATELIER_IGNAV_BASE_URL for
 * flights, ATELIER_STAYING_BASE_URL for hotels — mirroring the
 * stub-Anthropic / stub-Perplexity pattern) and exercises the three
 * travel tools directly through the capability registry — no database,
 * no app boot, fully offline.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/travel/travel-probe.ts
 *
 * Covers:
 *   1. return-trip search → round-trip endpoint, offers sorted by
 *      price, airline comparison, Google Flights handoff links
 *   2. free-text place resolution (Dubai → DXB) via /api/airports
 *   3. one-way (1-leg) search and multi-city (3-leg) per-leg combos,
 *      open-jaw 2-leg via the flexible search endpoint
 *   4. missing/invalid dates → clarification (no API call) and
 *      clarification resume with the original route intact (#715)
 *   5. unknown place → clarification
 *   6. defaults: immediate search with 1 adult / no cabin_class (#715)
 *   7. rich card payload: legs, stops, duration, carriers, next-day
 *      flag, AED display conversion with original preserved (#715)
 *   8. hotel search (free-text location, async 202 → poll → results)
 *      → priced, sorted, direct booking links, AED display
 *   9. hotels missing dates → multi-field clarification (inputType date)
 *  10. StayingAPI sandbox key → prominent test-data labeling (#715)
 *  11. Airbnb deep link builder (no network)
 *  12. missing provider keys + no stub → loud travel_unavailable
 *  13. persona gating: partner sees travel tools, board_observer and
 *      employee do not
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";

const requests: Array<{ method: string; url: string; body: unknown }> = [];

// --------------------------------------------------------------------
// Ignav flight stub
// --------------------------------------------------------------------

const mkSeg = (
  o: string,
  d: string,
  dep: string,
  arr: string,
  code: string,
  opName: string,
) => ({
  marketing_carrier_code: code,
  flight_number: "123",
  operating_carrier_name: opName,
  departure_airport: o,
  departure_time_local: dep,
  arrival_airport: d,
  arrival_time_local: arr,
  duration_minutes: 255,
});

type StubLeg = {
  o: string;
  d: string;
  dep: string;
  arr: string;
  durationMinutes?: number;
  opName?: string;
};

function itin(
  id: string,
  amount: number,
  carrier: [string, string],
  legs: StubLeg[],
  shape: "oneway" | "roundtrip" | "legs",
) {
  const legObjs = legs.map((l) => ({
    carrier: carrier[1],
    duration_minutes: l.durationMinutes ?? 255,
    segments: [mkSeg(l.o, l.d, l.dep, l.arr, carrier[0], l.opName ?? carrier[1])],
  }));
  const base = {
    price: { amount, currency: "USD", status: "verified" },
    cabin_class: "economy",
    requires_self_transfer: false,
    ignav_id: id,
  };
  if (shape === "oneway") return { ...base, outbound: legObjs[0] };
  if (shape === "roundtrip") return { ...base, outbound: legObjs[0], inbound: legObjs[1] };
  return { ...base, legs: legObjs };
}

const day = (date: string, time: string) => `${date}T${time}:00`;

const ignavStub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = req.url ?? "";
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method ?? "", url, body });
    res.setHeader("content-type", "application/json");
    if (url.startsWith("/api/airports")) {
      const q = decodeURIComponent(url.split("q=")[1]?.split("&")[0] ?? "").toLowerCase();
      if (q.includes("nowheresville")) {
        res.end(JSON.stringify([]));
        return;
      }
      if (q.includes("dubai")) {
        res.end(
          JSON.stringify([
            { code: "DXB", name: "Dubai International Airport", city: "Dubai", country: "AE" },
          ]),
        );
        return;
      }
      res.end(
        JSON.stringify([
          { code: "IST", name: "Istanbul Airport", city: "Istanbul", country: "TR" },
        ]),
      );
      return;
    }
    if (url.startsWith("/api/fares/one-way")) {
      const b = body as { origin: string; destination: string; departure_date: string };
      const leg = {
        o: b.origin,
        d: b.destination,
        dep: day(b.departure_date, "08:10"),
        arr: day(b.departure_date, "12:20"),
      };
      res.end(
        JSON.stringify({
          itineraries: [
            itin(`ek_${b.origin}`, 950, ["EK", "Emirates"], [leg], "oneway"),
            itin(`pc_${b.origin}`, 410.5, ["PC", "Pegasus"], [leg], "oneway"),
            itin(`tk_${b.origin}`, 610, ["TK", "Turkish Airlines"], [leg], "oneway"),
          ],
        }),
      );
      return;
    }
    if (url.startsWith("/api/fares/round-trip")) {
      const b = body as {
        origin: string;
        destination: string;
        departure_date: string;
        return_date: string;
      };
      const dayAfterReturn = `${b.return_date.slice(0, 8)}${String(
        Number(b.return_date.slice(8)) + 1,
      ).padStart(2, "0")}`;
      const out = (dep: string, arr: string, extra?: Partial<StubLeg>): StubLeg => ({
        o: b.origin,
        d: b.destination,
        dep: day(b.departure_date, dep),
        arr: day(b.departure_date, arr),
        ...extra,
      });
      const back = (dep: string, arrDate: string, arr: string, extra?: Partial<StubLeg>): StubLeg => ({
        o: b.destination,
        d: b.origin,
        dep: day(b.return_date, dep),
        arr: day(arrDate, arr),
        ...extra,
      });
      res.end(
        JSON.stringify({
          itineraries: [
            itin(
              "off_expensive",
              950,
              ["EK", "Emirates"],
              [out("08:10", "12:20"), back("14:00", b.return_date, "19:45")],
              "roundtrip",
            ),
            itin(
              "off_cheap",
              410.5,
              ["PC", "Pegasus"],
              [
                // Distinct operating carrier → "Pegasus · SunExpress".
                out("02:15", "06:30", { durationMinutes: 255, opName: "SunExpress" }),
                // Overnight return: arrives the next day.
                back("22:00", dayAfterReturn, "03:30", { durationMinutes: 330 }),
              ],
              "roundtrip",
            ),
            itin(
              "off_mid",
              610,
              ["TK", "Turkish Airlines"],
              [out("09:00", "13:15"), back("15:30", b.return_date, "21:00")],
              "roundtrip",
            ),
          ],
        }),
      );
      return;
    }
    if (url.startsWith("/api/fares/search")) {
      const b = body as { legs: Array<{ origin: string; destination: string; departure_date: string }> };
      const legs = b.legs.map((l) => ({
        o: l.origin,
        d: l.destination,
        dep: day(l.departure_date, "08:10"),
        arr: day(l.departure_date, "12:20"),
      }));
      res.end(
        JSON.stringify({
          itineraries: [
            itin("oj_ek", 880, ["EK", "Emirates"], legs, "legs"),
            itin("oj_tk", 640, ["TK", "Turkish Airlines"], legs, "legs"),
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
});

// --------------------------------------------------------------------
// StayingAPI hotel stub (async 202 → poll → completed)
// --------------------------------------------------------------------

const property = (
  id: string,
  name: string,
  total: number,
  nightly: number,
  star: number,
  guest: number,
  url: string,
) => ({
  id,
  platform: "booking",
  platformListingId: id,
  url,
  name,
  propertyType: "hotel",
  location: {
    lat: 41.03,
    lng: 28.98,
    city: "Istanbul",
    region: null,
    country: "TR",
    address: `${name} St, Istanbul`,
  },
  starRating: star,
  guestRating: guest,
  ratingScale: 10,
  price: {
    platform: "booking",
    listingId: id,
    currency: "USD",
    nightlyPrice: nightly,
    totalPrice: total,
    fees: { cleaning: null, service: null, taxes: null },
    nights: 4,
    occupancy: { adults: 1, children: 0, childAges: [] },
    source: "live",
    url,
  },
});

const stayingStub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = req.url ?? "";
    requests.push({ method: req.method ?? "", url, body: raw || null });
    res.setHeader("content-type", "application/json");
    if (url.startsWith("/search")) {
      // Async job path: 202 + pollUrl (as StayingAPI does for slow searches).
      res.statusCode = 202;
      res.setHeader("retry-after", "1");
      res.end(
        JSON.stringify({
          data: { jobId: "job_1", status: "pending", pollUrl: "/v1/jobs/job_1", estimatedSeconds: 1 },
          meta: { requestId: "r1", creditsCharged: 0 },
        }),
      );
      return;
    }
    if (url.startsWith("/jobs/job_1")) {
      res.end(
        JSON.stringify({
          data: {
            status: "completed",
            result: {
              data: [
                property("HTLPRICEY", "Grand Bosphorus Hotel", 1200, 300, 5, 9.1, "https://www.booking.com/hotel/tr/grand-bosphorus.html"),
                property("HTLCHEAP", "Taksim Business Inn", 480, 120, 4, 8.2, "https://www.booking.com/hotel/tr/taksim-business-inn.html"),
              ],
              meta: { requestId: "r1" },
            },
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
});

await Promise.all([
  new Promise<void>((resolve) => ignavStub.listen(0, resolve)),
  new Promise<void>((resolve) => stayingStub.listen(0, resolve)),
]);
const ignavUrl = `http://127.0.0.1:${(ignavStub.address() as AddressInfo).port}`;
const stayingUrl = `http://127.0.0.1:${(stayingStub.address() as AddressInfo).port}`;
process.env.ATELIER_IGNAV_BASE_URL = ignavUrl;
process.env.ATELIER_STAYING_BASE_URL = stayingUrl;
delete process.env.IGNAV_API_KEY;
delete process.env.STAYINGAPI_API_KEY;

// Load the capabilities AFTER the stubs are up.
await import("../../src/lib/atelier-cli/travel-capabilities.js");
const { findByToolName, capabilitiesForPersona } = await import(
  "../../src/lib/atelier-cli/capability-catalog.js"
);

const ctx = {
  persona: { id: "p_test", orgId: "aico", role: "partner", name: "Test Partner" },
  turnId: "t1",
  sessionId: "s1",
  stepIdx: 0,
} as unknown as Parameters<NonNullable<ReturnType<typeof findByToolName>>["run"]>[1];

const flights = findByToolName("travel_search_flights");
const stays = findByToolName("travel_search_stays");
const airbnb = findByToolName("travel_airbnb_link");
assert.ok(flights && stays && airbnb, "travel capabilities registered");

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`✓ ${name}`);
};

// 1+2. Return trip with free-text origin resolution → round-trip endpoint.
{
  requests.length = 0;
  const r = await flights.run(
    {
      segments: [
        { origin: "Dubai", destination: "IST", date: "2027-03-02" },
        { origin: "IST", destination: "DXB", date: "2027-03-06" },
      ],
      cabinClass: "economy",
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const data = r.data as Record<string, unknown>;
  const items = data.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 3);
  // Sorted cheapest-first across airlines.
  assert.deepEqual(
    items.map((i) => i.id),
    ["off_cheap", "off_mid", "off_expensive"],
  );
  assert.ok(String(items[0].label).includes("Pegasus"));
  assert.ok(String(items[0].href).startsWith("https://www.google.com/travel/flights?q="));
  assert.equal(items[0].cabin, "economy");
  assert.equal(items[0].stops, 0); // 2 segments over 2 slices
  const cmp = data.airlineComparison as Array<Record<string, unknown>>;
  assert.equal(cmp.length, 3);
  assert.equal(cmp[0].airline, "Pegasus");
  // Place resolution: "Dubai" resolved to DXB, mirrored legs → round-trip.
  const rt = requests.find((q) => q.url.startsWith("/api/fares/round-trip"));
  assert.ok(rt, "round-trip endpoint hit");
  const b = rt!.body as { origin: string; return_date: string };
  assert.equal(b.origin, "DXB");
  assert.equal(b.return_date, "2027-03-06");
  ok("return flight search: resolution, round-trip endpoint, comparison, sort, links");
}

// 3a. One-way search with defaults (#715): only segments provided →
// searches immediately, 1 adult, no cabin_class in the body.
{
  requests.length = 0;
  const r = await flights.run(
    { segments: [{ origin: "DXB", destination: "RUH", date: "2027-03-02" }] },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const ow = requests.find((q) => q.url.startsWith("/api/fares/one-way"));
  assert.ok(ow, "search ran immediately with defaults");
  const body = ow!.body as { adults: number; cabin_class?: string };
  assert.equal(body.adults, 1, "defaults to 1 adult");
  assert.equal(body.cabin_class, undefined, "no cabin_class sent when unspecified");
  const items = (r.data as { items: Array<Record<string, unknown>> }).items;
  assert.equal(items.length, 3);
  assert.equal(items[0].stops, 0);
  assert.equal((r.data as { tripType: string }).tripType, "one way");
  ok("one-way with defaults: immediate search, 1 adult, no cabin_class");
}

// 3b. Multi-city (3 legs) → per-leg searches combined honestly.
{
  requests.length = 0;
  const r = await flights.run(
    {
      segments: [
        { origin: "DXB", destination: "IST", date: "2027-03-02" },
        { origin: "IST", destination: "RUH", date: "2027-03-06" },
        { origin: "RUH", destination: "DXB", date: "2027-03-09" },
      ],
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(requests.filter((q) => q.url.startsWith("/api/fares/one-way")).length, 3);
  const data = r.data as Record<string, unknown>;
  assert.equal((data.slices as unknown[]).length, 3);
  assert.equal(data.tripType, "multi-city");
  const items = data.items as Array<Record<string, unknown>>;
  // Same-carrier combos across all 3 legs; cheapest = Pegasus 3×410.50.
  assert.ok(items.length >= 3);
  assert.ok(String(items[0].label).includes("Pegasus"));
  assert.equal(items[0].priceAmount, 1231.5);
  assert.equal(items[0].selfTransfer, true); // separate tickets per leg
  assert.ok(String(data.note).includes("self-transfer"));
  const cmp = data.airlineComparison as Array<Record<string, unknown>>;
  assert.ok(cmp.some((c) => c.airline === "Emirates"));
  ok("multi-city (3 legs): per-leg searches, same-carrier combos, honest self-transfer flag");
}

// 3c. Open-jaw 2 legs → flexible search endpoint.
{
  requests.length = 0;
  const r = await flights.run(
    {
      segments: [
        { origin: "DXB", destination: "IST", date: "2027-03-02" },
        { origin: "SAW", destination: "RUH", date: "2027-03-06" },
      ],
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(requests.some((q) => q.url.startsWith("/api/fares/search")));
  ok("open-jaw 2-leg trip uses the flexible search endpoint");
}

// 4. Missing date → clarification (no API call), then resume with the
// original route intact (#715).
{
  requests.length = 0;
  const r1 = await flights.run(
    { segments: [{ origin: "Dubai", destination: "IST", date: "sometime next week" }] },
    ctx,
  );
  assert.equal(r1.ok, false);
  assert.ok(r1.clarification, "clarification returned");
  assert.equal(r1.clarification!.field, "segments.0.date");
  assert.equal(r1.clarification!.fields?.[0]?.inputType, "date");
  assert.equal(requests.length, 0, "no API call before dates are known");
  const partial = r1.clarification!.partial as {
    segments: Array<{ origin: string; destination: string; date: string }>;
  };
  assert.equal(partial.segments[0].origin, "Dubai", "partial keeps the route");
  // Simulate the orchestrator's mergeClarificationAnswer for the dotted
  // field path segments.0.date, then re-run with the merged input.
  const merged = structuredClone(partial);
  merged.segments[0].date = "2027-03-02";
  const r2 = await flights.run(merged as never, ctx);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const ow = requests.find((q) => q.url.startsWith("/api/fares/one-way"));
  const owBody = ow!.body as { origin: string; destination: string };
  assert.equal(owBody.origin, "DXB", "original origin (Dubai→DXB) survived the clarification");
  assert.equal(owBody.destination, "IST", "original destination survived");
  ok("missing date → date-picker clarification; resume keeps original route");
}

// 5. Unknown place → clarification.
{
  const r = await flights.run(
    { segments: [{ origin: "Nowheresville", destination: "IST", date: "2027-03-02" }] },
    ctx,
  );
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "unknown_place");
  assert.ok(r.clarification);
  ok("unknown place → clarification");
}

// 6. Rich card payload + AED conversion (#715).
{
  const r = await flights.run(
    {
      segments: [
        { origin: "DXB", destination: "IST", date: "2027-03-02" },
        { origin: "IST", destination: "DXB", date: "2027-03-06" },
      ],
    },
    ctx,
  );
  assert.equal(r.ok, true);
  const data = r.data as Record<string, unknown>;
  assert.equal(data.tripType, "round trip");
  assert.equal(data.displayCurrency, "AED");
  assert.equal(data.testMode, false); // Ignav is live-only
  const items = data.items as Array<Record<string, unknown>>;
  const cheap = items[0]; // Pegasus 410.50 USD
  // AED conversion: 410.50 × 3.6725 ≈ 1500.56, original preserved.
  assert.equal(cheap.currency, "USD");
  assert.equal(cheap.priceAmount, 410.5);
  assert.ok(Math.abs((cheap.priceAedAmount as number) - 410.5 * 3.6725) < 0.01);
  assert.equal(cheap.priceAedApprox, true);
  assert.ok(String(cheap.label).includes("AED"), "label shows AED");
  assert.ok(String(data.note).includes("approximate exchange rate"));
  const flight = cheap.flight as Record<string, unknown>;
  assert.equal(flight.tripType, "round trip");
  const legs = flight.legs as Array<Record<string, unknown>>;
  assert.equal(legs.length, 2);
  // Outbound: DXB 02:15 → IST 06:30, non-stop, 4 hr 15 min, same day.
  const out = flight.outbound as Record<string, unknown>;
  assert.equal(out.departTime, "02:15");
  assert.equal(out.arriveTime, "06:30");
  assert.equal(out.originIata, "DXB");
  assert.equal(out.destinationIata, "IST");
  assert.equal(out.arrivesNextDay, false);
  assert.equal(out.stops, 0);
  assert.equal(out.stopsLabel, "Non-stop");
  assert.equal(out.durationMinutes, 255);
  assert.equal(out.durationLabel, "4 hr 15 min");
  // Marketing + distinct operating carrier both surfaced.
  assert.equal(out.carriersLabel, "Pegasus · SunExpress");
  // Return leg: IST 22:00 → DXB 03:30 next day.
  assert.equal(legs[1].arrivesNextDay, true);
  // Ignav fares carry no baggage allowance — honest null, never a guess.
  assert.equal(flight.checkedBags, null);
  const price = flight.price as Record<string, unknown>;
  assert.equal(price.currency, "USD");
  assert.equal(price.aedApprox, true);
  ok("rich card payload: legs, next-day flag, stops/duration, carriers, AED price");
}

// 7. Hotel search (free-text location, async 202 → poll → results).
{
  requests.length = 0;
  const r = await stays.run(
    { location: "Taksim, Istanbul", checkIn: "2027-03-02", checkOut: "2027-03-06" },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const data = r.data as Record<string, unknown>;
  const items = data.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "HTLCHEAP"); // cheapest first
  assert.equal(data.nights, 4);
  assert.equal(data.testMode, false);
  assert.equal(data.displayCurrency, "AED");
  assert.equal(items[0].reviewScore, 8.2);
  // AED conversion: 480 USD × 3.6725, original preserved.
  assert.ok(Math.abs((items[0].priceAedAmount as number) - 480 * 3.6725) < 0.01);
  assert.equal(items[0].currency, "USD");
  assert.ok(String(items[0].label).includes("AED"));
  assert.ok(String(items[0].nightly).includes("AED"));
  // Direct booking link from the platform, not a Google search guess.
  assert.ok(String(items[0].href).startsWith("https://www.booking.com/"));
  // Async flow: search then poll.
  assert.ok(requests.some((q) => q.url.startsWith("/search")));
  assert.ok(requests.some((q) => q.url.startsWith("/jobs/job_1")));
  const searchReq = requests.find((q) => q.url.startsWith("/search"))!;
  assert.ok(searchReq.url.includes("checkIn=2027-03-02"));
  assert.ok(decodeURIComponent(searchReq.url).includes("Taksim"));
  ok("hotel search: free-text location, 202→poll, price sort, AED display, direct links");
}

// 8. Hotels missing dates → multi-field clarification.
{
  const r = await stays.run({ location: "Taksim" }, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.clarification?.fields && r.clarification.fields.length === 2);
  // Contract-level check: every field entry matches the shared
  // clarification envelope (field + label strings, inputType "date"
  // recognised by @workspace/chat-core's ClarificationField).
  for (const f of r.clarification!.fields!) {
    assert.equal(typeof f.field, "string");
    assert.equal(typeof f.label, "string");
    assert.equal(f.inputType, "date");
  }
  assert.equal(r.clarification!.field, r.clarification!.fields![0].field);
  ok("hotels missing dates → multi-field clarification (contract shape)");
}

// 9. StayingAPI sandbox key → prominent test-data labeling (#715).
{
  process.env.STAYINGAPI_API_KEY = "stay_test_abc123";
  const rs = await stays.run(
    { location: "Taksim", checkIn: "2027-03-02", checkOut: "2027-03-06" },
    ctx,
  );
  assert.equal(rs.ok, true);
  const sd = rs.data as Record<string, unknown>;
  assert.equal(sd.testMode, true);
  assert.ok(/sandbox|test data/i.test(String(sd.note)), "hotel note flags sandbox data");
  assert.ok(String(sd.note).toLowerCase().includes("live stayingapi key"));
  delete process.env.STAYINGAPI_API_KEY;
  ok("sandbox StayingAPI key → test-data labeling on hotel results");
}

// 10. Airbnb deep link.
{
  const r = await airbnb.run(
    { location: "Kadıköy, Istanbul", checkIn: "2027-03-02", checkOut: "2027-03-06", adults: 2 },
    ctx,
  );
  assert.equal(r.ok, true);
  const items = (r.data as { items: Array<Record<string, unknown>> }).items;
  const href = String(items[0].href);
  assert.ok(href.startsWith("https://www.airbnb.com/s/"));
  assert.ok(href.includes("checkin=2027-03-02"));
  assert.ok(href.includes("checkout=2027-03-06"));
  assert.ok(href.includes("adults=2"));
  assert.ok(String((r.data as { note: string }).note).toLowerCase().includes("no public api"));
  ok("airbnb deep link builder");
}

// 11. No stubs + no keys → loud failure per provider.
{
  delete process.env.ATELIER_IGNAV_BASE_URL;
  delete process.env.ATELIER_STAYING_BASE_URL;
  delete process.env.IGNAV_API_KEY;
  delete process.env.STAYINGAPI_API_KEY;
  const rf = await flights.run(
    { segments: [{ origin: "DXB", destination: "IST", date: "2027-03-02" }] },
    ctx,
  );
  assert.equal(rf.ok, false);
  assert.equal(rf.errorCode, "travel_unavailable");
  assert.ok(String(rf.errorMessage).includes("IGNAV_API_KEY"));
  const rs = await stays.run(
    { location: "Taksim", checkIn: "2027-03-02", checkOut: "2027-03-06" },
    ctx,
  );
  assert.equal(rs.ok, false);
  assert.equal(rs.errorCode, "travel_unavailable");
  assert.ok(String(rs.errorMessage).includes("STAYINGAPI_API_KEY"));
  process.env.ATELIER_IGNAV_BASE_URL = ignavUrl;
  process.env.ATELIER_STAYING_BASE_URL = stayingUrl;
  ok("missing keys → loud travel_unavailable per provider (no silent stub data)");
}

// 12. Persona gating.
{
  const toolNames = (role: string) =>
    capabilitiesForPersona({ id: "p", orgId: "aico", role, name: "x" } as never).map(
      (e) => e.toolName,
    );
  assert.ok(toolNames("partner").includes("travel_search_flights"));
  assert.ok(!toolNames("board_observer").includes("travel_search_flights"));
  assert.ok(!toolNames("employee").includes("travel_search_flights"));
  ok("persona gating: partner yes, board_observer/employee no");
}

ignavStub.close();
stayingStub.close();
console.log(`\ntravel-probe: ${passed}/13 groups passed`);
