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
      // Route "never-completes" searches (used by the timeout test) to a
      // separate job that always returns "pending".
      const loc = decodeURIComponent(
        new URLSearchParams(url.split("?")[1] ?? "").get("location") ?? "",
      );
      if (loc === "Timeout Test City") {
        res.statusCode = 202;
        res.setHeader("retry-after", "1");
        res.end(
          JSON.stringify({
            data: {
              jobId: "job_never",
              status: "pending",
              pollUrl: "/v1/jobs/job_never",
              estimatedSeconds: 999,
            },
            meta: { requestId: "r_never", creditsCharged: 0 },
          }),
        );
        return;
      }
      if (loc === "Hung Response City") {
        // Returns a 202 immediately; the poll job will hang (no response bytes).
        res.statusCode = 202;
        res.setHeader("retry-after", "1");
        res.end(
          JSON.stringify({
            data: {
              jobId: "job_hung",
              status: "pending",
              pollUrl: "/v1/jobs/job_hung",
              estimatedSeconds: 999,
            },
            meta: { requestId: "r_hung", creditsCharged: 0 },
          }),
        );
        return;
      }
      if (loc === "Bodyhang City") {
        // Returns a clean 202; the poll job will stall the body.
        res.statusCode = 202;
        res.setHeader("retry-after", "1");
        res.end(
          JSON.stringify({
            data: {
              jobId: "job_bodyhang",
              status: "pending",
              pollUrl: "/v1/jobs/job_bodyhang",
              estimatedSeconds: 999,
            },
            meta: { requestId: "r_bh", creditsCharged: 0 },
          }),
        );
        return;
      }
      if (loc === "Bodyhang Initial City") {
        // Sends the 202 status + headers then stalls the body mid-stream.
        // Tests that the initial-request body read is also deadline-bound.
        res.on("error", () => {});
        res.writeHead(202, { "content-type": "application/json", "retry-after": "1" });
        // Partial body — valid JSON never completes.
        res.write('{"data":{"jobId":"job_bi","status":"pending","pollUrl":"/v1/jobs/');
        const tBi = setTimeout(() => {
          try { res.end('job_bi","estimatedSeconds":999}}'); } catch { /* socket closed */ }
        }, 60_000);
        tBi.unref();
        req.once("close", () => clearTimeout(tBi));
        return;
      }
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
    // Never-completing job: always returns "pending" so the poll cap fires.
    if (url.startsWith("/jobs/job_never")) {
      res.end(JSON.stringify({ data: { status: "pending" } }));
      return;
    }
    // Hung job: server accepts the TCP connection and the full HTTP request,
    // but delays the response far beyond any test's poll cap. The client's
    // AbortSignal fires first; when the socket closes, the cleanup timer is
    // cancelled immediately via req.once("close"). The timer is unref'd so it
    // does not keep the Node.js event loop alive after the probe exits.
    if (url.startsWith("/jobs/job_hung")) {
      res.on("error", () => {}); // absorb write-after-close errors
      const t = setTimeout(() => {
        try { res.end(JSON.stringify({ data: { status: "pending" } })); } catch { /* socket already closed */ }
      }, 60_000);
      t.unref();
      req.once("close", () => clearTimeout(t));
      return;
    }
    // Body-hang job: server sends status + headers immediately, then writes a
    // partial JSON body and stalls — the response body never completes. Tests
    // that body reads are bounded by the same deadline AbortController.
    if (url.startsWith("/jobs/job_bodyhang")) {
      res.on("error", () => {});
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{"); // partial JSON — body never completed
      const tBh = setTimeout(() => {
        try { res.end("}"); } catch { /* socket already closed */ }
      }, 60_000);
      tBh.unref();
      req.once("close", () => clearTimeout(tBh));
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
// Disable keep-alive on both stubs so the Node.js HTTP server closes each
// connection after serving a response. Without this, undici reuses persistent
// connections; if the probe's hotel-timing tests (7b-7f) push the idle window
// past the default 5 s keepAliveTimeout, the next request to ignavStub would
// arrive on a stale socket and fail with a generic "fetch failed" error.
ignavStub.keepAliveTimeout = 0;
stayingStub.keepAliveTimeout = 0;
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

// 7b. Hotel search progress events — happy-path: at least "Searching hotels
// in …" and the polling step and "Ranking N hotels…" events are emitted.
{
  // Import the provider directly; the module is already cached by the
  // capability import above, so this is effectively free.
  const { stayingSearchHotels: searchHotels } = await import(
    "../../src/lib/atelier-agents/travel-providers.js"
  );
  const events: Array<{ pct: number; message: string }> = [];
  const results = await searchHotels({
    location: "Taksim, Istanbul",
    checkInDate: "2027-03-02",
    checkOutDate: "2027-03-06",
    adults: 1,
    progress: (pct, msg) => events.push({ pct, message: msg }),
  });
  assert.ok(results.length > 0, "happy-path returns results");
  assert.ok(events.length >= 2, `at least 2 progress events (got ${events.length})`);
  // First event: honest initial message mentioning the location.
  assert.ok(
    events[0].message.toLowerCase().includes("searching"),
    `first event should mention "searching" (got "${events[0].message}")`,
  );
  assert.ok(
    events[0].message.includes("Taksim"),
    `first event should name the location (got "${events[0].message}")`,
  );
  // At least one poll-step event during the async window.
  assert.ok(
    events.some((e) => e.message.toLowerCase().includes("still searching")),
    "a polling-step progress event was emitted",
  );
  // Final "Ranking N hotels…" event.
  assert.ok(
    events.some((e) => e.message.toLowerCase().includes("ranking")),
    "a ranking progress event was emitted",
  );
  // Progress percentages are monotonically non-decreasing.
  for (let i = 1; i < events.length; i++) {
    assert.ok(
      events[i].pct >= events[i - 1].pct,
      `progress pct not monotonic at index ${i}: ${events[i - 1].pct} → ${events[i].pct}`,
    );
  }
  ok("hotel search: progress events emitted in order during happy-path async poll");
}

// 7c. Hotel poll timeout — stub never completes → TravelConnectionError with
// a clear "timed out" message within the capped window; never empty results.
{
  const { stayingSearchHotels: searchHotels, TravelConnectionError: TCE } = await import(
    "../../src/lib/atelier-agents/travel-providers.js"
  );
  const start = Date.now();
  let caughtErr: unknown = null;
  try {
    await searchHotels({
      location: "Timeout Test City",
      checkInDate: "2027-03-02",
      checkOutDate: "2027-03-06",
      adults: 1,
      // Very short cap so the test completes in milliseconds, not seconds.
      pollCapMs: 350,
    });
  } catch (err) {
    caughtErr = err;
  }
  const elapsed = Date.now() - start;
  assert.ok(caughtErr !== null, "timeout path must throw, not return empty results");
  assert.ok(
    caughtErr instanceof TCE,
    `threw TravelConnectionError (got ${Object.prototype.toString.call(caughtErr)})`,
  );
  const msg = (caughtErr as Error).message;
  assert.ok(
    msg.toLowerCase().includes("timed out"),
    `error message must say "timed out" (got: "${msg}")`,
  );
  // Sanity: completed well within ~30 s thanks to the short cap.
  assert.ok(elapsed < 5_000, `timeout fired in ${elapsed} ms (expected < 5000 ms)`);
  ok("hotel poll timeout → loud TravelConnectionError within capped window (never empty)");
}

// 7d. Hung-response timeout: the poll HTTP fetch itself hangs — the server
// accepts the TCP connection and the request but never sends any response
// bytes. The AbortSignal (keyed to the remaining deadline budget) must fire
// and convert the abort into the same loud TravelConnectionError timeout
// message, well within the configured cap.
{
  const { stayingSearchHotels: searchHotels, TravelConnectionError: TCE } = await import(
    "../../src/lib/atelier-agents/travel-providers.js"
  );
  // pollCapMs: 1600 — the 1 s initial-wait sleep completes fine (~1 s
  // consumed), then the poll fetch to /jobs/job_hung hangs; the AbortSignal
  // fires with ~600 ms remaining and the error is thrown.
  const start = Date.now();
  let caughtErr: unknown = null;
  try {
    await searchHotels({
      location: "Hung Response City",
      checkInDate: "2027-03-02",
      checkOutDate: "2027-03-06",
      adults: 1,
      pollCapMs: 1600,
    });
  } catch (err) {
    caughtErr = err;
  }
  const elapsed = Date.now() - start;
  assert.ok(caughtErr !== null, "hung fetch must throw, not return empty results");
  assert.ok(
    caughtErr instanceof TCE,
    `threw TravelConnectionError (got ${Object.prototype.toString.call(caughtErr)})`,
  );
  const msg = (caughtErr as Error).message;
  assert.ok(
    msg.toLowerCase().includes("timed out"),
    `error message must say "timed out" (got: "${msg}")`,
  );
  // Must complete within the cap + a generous buffer — well under 4 s total.
  assert.ok(elapsed < 4_000, `hung-fetch timeout fired in ${elapsed} ms (expected < 4000 ms)`);
  ok("hotel poll: hung HTTP response → AbortSignal fires → loud TravelConnectionError within cap");
}

// 7e. Poll body-hang: server sends status + headers immediately but stalls the
// response body (partial JSON write, never ends). Under the old code res.json()
// would hang indefinitely once stayingFetch returned the Response. With the
// fix, res.text() is consumed inside stayingFetch under the same AbortController,
// so the body stall is bounded by the same deadline and throws the same loud
// TravelConnectionError timeout message.
{
  const { stayingSearchHotels: searchHotels, TravelConnectionError: TCE } = await import(
    "../../src/lib/atelier-agents/travel-providers.js"
  );
  // pollCapMs: 1600 — the 1 s sleep fires first, then the poll fetch to
  // /jobs/job_bodyhang starts. The server sends "200 OK" headers + '{'
  // but never completes the body; the AbortSignal fires after ~600 ms.
  const start = Date.now();
  let caughtErr: unknown = null;
  try {
    await searchHotels({
      location: "Bodyhang City",
      checkInDate: "2027-03-02",
      checkOutDate: "2027-03-06",
      adults: 1,
      pollCapMs: 1600,
    });
  } catch (err) {
    caughtErr = err;
  }
  const elapsed = Date.now() - start;
  assert.ok(caughtErr !== null, "poll body-hang must throw, not return empty results");
  assert.ok(
    caughtErr instanceof TCE,
    `threw TravelConnectionError (got ${Object.prototype.toString.call(caughtErr)})`,
  );
  const msg = (caughtErr as Error).message;
  assert.ok(
    msg.toLowerCase().includes("timed out"),
    `error message must say "timed out" (got: "${msg}")`,
  );
  assert.ok(elapsed < 4_000, `poll body-hang timeout fired in ${elapsed} ms (expected < 4000 ms)`);
  ok("hotel poll: stalled JSON body → AbortSignal fires on body read → loud TravelConnectionError within cap");
}

// 7f. Initial-request body-hang: the /search request itself returns 202 headers
// but stalls the body mid-stream. The initial stayingFetch in stayingRequest must
// be bounded by the same deadline AbortController, not just the poll fetches.
{
  const { stayingSearchHotels: searchHotels, TravelConnectionError: TCE } = await import(
    "../../src/lib/atelier-agents/travel-providers.js"
  );
  // Short cap — the very first /search fetch gets headers quickly but the body
  // never arrives; AbortSignal fires after ~500 ms (no sleep in this path).
  const start = Date.now();
  let caughtErr: unknown = null;
  try {
    await searchHotels({
      location: "Bodyhang Initial City",
      checkInDate: "2027-03-02",
      checkOutDate: "2027-03-06",
      adults: 1,
      pollCapMs: 500,
    });
  } catch (err) {
    caughtErr = err;
  }
  const elapsed = Date.now() - start;
  assert.ok(caughtErr !== null, "initial body-hang must throw, not return empty results");
  assert.ok(
    caughtErr instanceof TCE,
    `threw TravelConnectionError (got ${Object.prototype.toString.call(caughtErr)})`,
  );
  const msg = (caughtErr as Error).message;
  assert.ok(
    msg.toLowerCase().includes("timed out"),
    `error message must say "timed out" (got: "${msg}")`,
  );
  assert.ok(elapsed < 2_000, `initial body-hang timeout fired in ${elapsed} ms (expected < 2000 ms)`);
  ok("hotel search (initial): stalled JSON body → AbortSignal fires on body read → loud TravelConnectionError within cap");
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
  assert.ok(toolNames("partner").includes("travel_select_flight"));
  assert.ok(toolNames("partner").includes("travel_itinerary_summary"));
  assert.ok(!toolNames("board_observer").includes("travel_search_flights"));
  assert.ok(!toolNames("board_observer").includes("travel_select_flight"));
  assert.ok(!toolNames("employee").includes("travel_search_flights"));
  ok("persona gating: partner yes, board_observer/employee no");
}

// ────────────────────── Task #721 — guided booking flow ──────────────────────

const selectFlight = findByToolName("travel_select_flight");
const itinerarySummary = findByToolName("travel_itinerary_summary");
assert.ok(selectFlight && itinerarySummary, "guided-booking capabilities registered");

// 13. Server-side airline filter: name substring and IATA code both
// narrow the offers; the card can no longer disagree with the prose.
{
  const base = {
    segments: [
      { origin: "DXB", destination: "IST", date: "2027-03-02" },
      { origin: "IST", destination: "DXB", date: "2027-03-06" },
    ],
  };
  const byName = await flights.run({ ...base, airline: "turkish" }, ctx);
  assert.equal(byName.ok, true, JSON.stringify(byName));
  const nameItems = (byName.data as { items: Array<Record<string, unknown>> }).items;
  assert.equal(nameItems.length, 1);
  assert.ok(String(nameItems[0].label).includes("Turkish Airlines"));
  assert.equal((byName.data as { airlineFilter: string }).airlineFilter, "turkish");
  const byIata = await flights.run({ ...base, airline: "PC" }, ctx);
  assert.equal(byIata.ok, true);
  const iataItems = (byIata.data as { items: Array<Record<string, unknown>> }).items;
  assert.equal(iataItems.length, 1);
  assert.ok(String(iataItems[0].label).includes("Pegasus"));
  ok("airline filter: name substring + IATA code narrow offers server-side");
}

// 14. Airline filter with no matches → honest empty result listing the
// airlines that DO have offers (never silently unfiltered).
{
  const r = await flights.run(
    {
      segments: [{ origin: "DXB", destination: "IST", date: "2027-03-02" }],
      airline: "Qantas",
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const data = r.data as Record<string, unknown>;
  assert.equal((data.items as unknown[]).length, 0);
  assert.equal(data.total, 0);
  const avail = data.availableAirlines as string[];
  assert.deepEqual(avail, ["Emirates", "Pegasus", "Turkish Airlines"]);
  assert.ok(String(data.note).includes("Qantas"));
  assert.ok(String(data.note).includes("Emirates"));
  ok("airline filter miss → honest empty result + available airlines");
}

// 15. Flight numbers + airline logo ride the card payload; pageSize
// present for client-side paging (default fetch is now 20).
{
  requests.length = 0;
  const r = await flights.run(
    { segments: [{ origin: "DXB", destination: "IST", date: "2027-03-02" }] },
    ctx,
  );
  assert.equal(r.ok, true);
  const data = r.data as Record<string, unknown>;
  assert.equal(data.pageSize, 10);
  const ow = requests.find((q) => q.url.startsWith("/api/fares/one-way"));
  assert.ok(ow, "one-way endpoint hit");
  const item = (data.items as Array<Record<string, unknown>>)[0];
  const flight = item.flight as Record<string, unknown>;
  // Stub segments carry marketing code + bare flight_number "123" →
  // "PC 123" style label.
  const legs = flight.legs as Array<Record<string, unknown>>;
  assert.deepEqual(legs[0].flightNumbers, ["PC 123"]);
  assert.equal(legs[0].flightNumbersLabel, "PC 123");
  assert.equal(legs[0].logoUrl, "https://images.kiwi.com/airlines/64/PC.png");
  assert.equal(flight.logoUrl, "https://images.kiwi.com/airlines/64/PC.png");
  ok("cards carry flight numbers + airline logo URL; pageSize for paging");
}

// 16. Select a one-way flight → tool pauses to ask about a return
// flight (yes/no + date picker), preserving the picked offer in partial.
{
  const picked = {
    airline: "Pegasus",
    airlineIata: "PC",
    origin: "DXB",
    destination: "IST",
    date: "2027-03-02",
    departTime: "08:10",
    arriveTime: "12:20",
    flightNumbers: ["PC 123"],
    cabin: "economy",
    priceAmount: 410.5,
    currency: "USD",
    tripType: "one way",
  };
  const r1 = await selectFlight.run({ ...picked }, ctx);
  assert.equal(r1.ok, false);
  assert.equal(r1.errorCode, "return_choice_needed");
  const fields = r1.clarification!.fields!;
  assert.equal(fields[0].field, "addReturn");
  assert.deepEqual(fields[0].options, ["yes", "no"]);
  assert.equal(fields[1].field, "returnDate");
  assert.equal(fields[1].inputType, "date");
  const partial = r1.clarification!.partial as Record<string, unknown>;
  assert.equal(partial.airline, "Pegasus", "picked offer preserved in partial");

  // yes + date → confirmation card telling the model to search the return leg.
  const r2 = await selectFlight.run(
    { ...picked, addReturn: "yes", returnDate: "2027-03-06" },
    ctx,
  );
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const d2 = r2.data as Record<string, unknown>;
  assert.ok(String(d2.nextStep).includes("travel_search_flights"));
  assert.ok(String(d2.nextStep).includes("IST → DXB"));
  assert.ok(String(d2.nextStep).includes("2027-03-06"));
  const sel = d2.selection as Record<string, unknown>;
  assert.equal(sel.returnDate, "2027-03-06");
  assert.equal(sel.logoUrl, "https://images.kiwi.com/airlines/64/PC.png");
  // yes but no date → date clarification.
  const r3 = await selectFlight.run({ ...picked, addReturn: "yes" }, ctx);
  assert.equal(r3.ok, false);
  assert.equal(r3.errorCode, "return_date_needed");
  assert.equal(r3.clarification!.fields![0].inputType, "date");
  // no → wrap-up instruction.
  const r4 = await selectFlight.run({ ...picked, addReturn: "no" }, ctx);
  assert.equal(r4.ok, true);
  assert.ok(String((r4.data as { nextStep: string }).nextStep).includes("travel_itinerary_summary"));
  ok("select one-way flight → return-flight question, date flows, next steps");
}

// 17. Fare options are honest: no fare families, cabin alternatives only.
{
  const r = await selectFlight.run(
    {
      airline: "Emirates",
      origin: "DXB",
      destination: "IST",
      date: "2027-03-02",
      cabin: "economy",
      tripType: "round trip",
    },
    ctx,
  );
  assert.equal(r.ok, true);
  const fo = (r.data as { fareOptions: Record<string, unknown> }).fareOptions;
  assert.equal(fo.fareFamiliesAvailable, false);
  assert.deepEqual(fo.cabinAlternatives, ["business", "first"]);
  assert.ok(String(fo.note).includes("no branded-fare"));
  // Missing required fields fail loudly.
  const bad = await selectFlight.run({ airline: "Emirates" }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "missing_selection_fields");
  ok("fare options honest (cabin alternatives only); missing fields loud");
}

// 18. Itinerary summary: per-leg flight cards + AED grand total across
// currencies, handoff links, invalid-leg validation.
{
  const r = await itinerarySummary.run(
    {
      legs: [
        {
          airline: "Pegasus",
          airlineIata: "PC",
          flightNumbers: ["PC 123"],
          origin: "DXB",
          destination: "IST",
          date: "2027-03-02",
          departTime: "08:10",
          arriveTime: "12:20",
          cabin: "economy",
          stops: 0,
          durationLabel: "4 hr 15 min",
          priceAmount: 410.5,
          currency: "USD",
          href: "https://www.google.com/travel/flights?q=x",
        },
        {
          airline: "Turkish Airlines",
          airlineIata: "TK",
          origin: "IST",
          destination: "DXB",
          date: "2027-03-06",
          priceAmount: 500,
          currency: "EUR",
        },
      ],
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const data = r.data as Record<string, unknown>;
  const itin2 = data.itinerary as Record<string, unknown>;
  assert.equal(itin2.legCount, 2);
  // 410.50 USD × 3.6725 + 500 EUR × 3.98 = 1507.56 + 1990 ≈ 3498.
  assert.equal(itin2.totalAedAmount, 3498);
  assert.ok(String(itin2.totalDisplay).startsWith("AED 3,498"));
  assert.ok(String(itin2.totalDisplay).includes("USD 410.50"));
  assert.ok(String(itin2.totalDisplay).includes("EUR 500.00"));
  const items = data.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  const f0 = items[0].flight as Record<string, unknown>;
  const leg0 = (f0.legs as Array<Record<string, unknown>>)[0];
  assert.equal(leg0.flightNumbersLabel, "PC 123");
  assert.equal(leg0.logoUrl, "https://images.kiwi.com/airlines/64/PC.png");
  assert.equal(items[0].href, "https://www.google.com/travel/flights?q=x");
  // Second leg had no href → prefilled handoff link built.
  assert.ok(String(items[1].href).startsWith("https://www.google.com/travel/flights?q="));
  assert.ok(String(data.note).includes("total AED 3,498"));
  // Invalid leg → loud error.
  const bad = await itinerarySummary.run(
    { legs: [{ airline: "X", origin: "DXB", destination: "", date: "2027-03-02" }] },
    ctx,
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "invalid_leg");
  ok("itinerary summary: legs, logos, flight numbers, AED total, links, validation");
}

// ────────────────────── Task #745 — guided planner flow ──────────────────────

const planTrip = findByToolName("travel_plan_trip");
assert.ok(planTrip, "travel_plan_trip registered");

// 19. Planner prefill: everything stated rides the planner metadata,
// free text resolves to IATA, missing dates stay empty (still DB-free).
{
  requests.length = 0;
  const r = await planTrip.run(
    { origin: "Dubai", destination: "IST", departDate: "2027-03-02", returnDate: "2027-03-06", adults: 2, cabinClass: "business" },
    ctx,
  );
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "plan_confirmation_needed");
  const field = r.clarification!.fields![0] as Record<string, unknown>;
  assert.equal(field.field, "plan");
  assert.equal(field.inputType, "flight_planner");
  const planner = field.planner as Record<string, unknown>;
  assert.equal(planner.tripType, "return");
  assert.equal(planner.adults, 2);
  assert.equal(planner.cabinClass, "business");
  const segs = planner.segments as Array<Record<string, unknown>>;
  assert.equal(segs.length, 2);
  assert.equal((segs[0].origin as Record<string, unknown>).iata, "DXB");
  assert.equal((segs[0].destination as Record<string, unknown>).iata, "IST");
  assert.equal(segs[0].date, "2027-03-02");
  // Return leg mirrored.
  assert.equal((segs[1].origin as Record<string, unknown>).iata, "IST");
  assert.equal((segs[1].destination as Record<string, unknown>).iata, "DXB");
  assert.equal(segs[1].date, "2027-03-06");
  // No fares endpoint touched during prefill.
  assert.ok(!requests.some((q) => q.url.startsWith("/api/fares")), "prefill makes no fare calls");

  // One-way default when only one date; unknown place keeps raw text.
  const r2 = await planTrip.run({ origin: "nowheresville", destination: "RUH" }, ctx);
  assert.equal(r2.ok, false);
  const p2 = (r2.clarification!.fields![0] as Record<string, unknown>).planner as Record<string, unknown>;
  assert.equal(p2.tripType, "one_way");
  const seg2 = (p2.segments as Array<Record<string, unknown>>)[0];
  assert.equal((seg2.origin as Record<string, unknown>).iata, null);
  assert.equal((seg2.origin as Record<string, unknown>).text, "nowheresville");
  assert.equal(seg2.date, "");
  ok("planner prefill: tabs prefill, IATA resolution, mirrored return, no fare calls");
}

// 20. Planner confirm: JSON plan → validated + sequential script; bad
// plans fail loudly.
{
  const plan = {
    tripType: "multi_city",
    segments: [
      { origin: { text: "DXB", iata: "DXB" }, destination: { text: "IST", iata: "IST" }, date: "2027-03-02" },
      { origin: { text: "IST", iata: "IST" }, destination: { text: "RUH", iata: "RUH" }, date: "2027-03-06" },
    ],
    adults: 3,
    cabinClass: "economy",
  };
  const r = await planTrip.run({ plan: JSON.stringify(plan) }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = r.data as Record<string, unknown>;
  const confirmed = d.plan as Record<string, unknown>;
  assert.equal(confirmed.legCount, 2);
  assert.ok(String(d.nextStep).includes("legContext={legIndex:1, legCount:2}"));
  assert.ok(String(d.nextStep).includes('origin:"DXB"'));
  // >1 adult → traveller step mandated before the summary.
  assert.ok(String(d.nextStep).includes("list_travel_companions"));
  // 1 adult → no traveller step.
  const r1a = await planTrip.run(
    { plan: JSON.stringify({ ...plan, adults: 1 }) },
    ctx,
  );
  assert.ok(!String((r1a.data as Record<string, unknown>).nextStep).includes("list_travel_companions"));
  // Missing date → loud invalid_plan.
  const bad = await planTrip.run(
    { plan: JSON.stringify({ ...plan, segments: [{ origin: { iata: "DXB" }, destination: { iata: "IST" }, date: "" }] }) },
    ctx,
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "invalid_plan");
  // Return trip with a single segment → invalid.
  const bad2 = await planTrip.run(
    { plan: JSON.stringify({ tripType: "return", segments: plan.segments.slice(0, 1), adults: 1 }) },
    ctx,
  );
  assert.equal(bad2.ok, false);
  ok("planner confirm: sequential script, traveller step at >1 pax, loud invalid plans");
}

// 21. legContext rides search results and select; select with
// legContext never re-asks the add-return question.
{
  const r = await flights.run(
    {
      segments: [{ origin: "DXB", destination: "IST", date: "2027-03-02" }],
      legContext: { legIndex: 1, legCount: 2 },
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const lc = (r.data as Record<string, unknown>).legContext as Record<string, unknown>;
  assert.equal(lc.legIndex, 1);
  assert.equal(lc.legCount, 2);
  assert.equal(lc.label, "Leg 1 of 2 · DXB → IST");

  const pick = {
    airline: "Pegasus",
    origin: "DXB",
    destination: "IST",
    date: "2027-03-02",
    tripType: "one way",
  };
  const s1 = await selectFlight.run({ ...pick, legContext: { legIndex: 1, legCount: 2 } }, ctx);
  assert.equal(s1.ok, true, "planner-driven select skips add-return question");
  assert.ok(String((s1.data as Record<string, unknown>).nextStep).includes("legContext={legIndex:2, legCount:2}"));
  const s1lc = (s1.data as Record<string, unknown>).legContext as Record<string, unknown>;
  assert.equal(s1lc.label, "Leg 1 of 2 · DXB → IST");
  // Final leg → summary (with traveller reminder).
  const s2 = await selectFlight.run({ ...pick, legContext: { legIndex: 2, legCount: 2 } }, ctx);
  assert.ok(String((s2.data as Record<string, unknown>).nextStep).includes("travel_itinerary_summary"));
  // Ad-hoc one-way select (no legContext) still asks about the return.
  const s3 = await selectFlight.run({ ...pick }, ctx);
  assert.equal(s3.ok, false);
  assert.equal(s3.errorCode, "return_choice_needed");
  // Malformed legContext is ignored, not fatal.
  const s4 = await selectFlight.run({ ...pick, addReturn: "no", legContext: { legIndex: 0, legCount: -1 } }, ctx);
  assert.equal(s4.ok, true);
  ok("legContext: progress labels, sequential next steps, add-return only for ad-hoc one-way");
}

// 22. Itinerary travellers echo with kinds/relationships.
{
  const r = await itinerarySummary.run(
    {
      legs: [
        { airline: "Pegasus", origin: "DXB", destination: "IST", date: "2027-03-02", priceAmount: 400, currency: "USD" },
      ],
      adults: 3,
      travellers: [
        { name: "Test Partner", kind: "self" },
        { name: "Sara", kind: "dependent", relationship: "spouse" },
        { name: "Ali", kind: "colleague" },
        { name: "", kind: "colleague" }, // dropped
      ],
    },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const itin = (r.data as Record<string, unknown>).itinerary as Record<string, unknown>;
  const trav = itin.travellers as Array<Record<string, unknown>>;
  assert.equal(trav.length, 3);
  assert.deepEqual(trav[1], { name: "Sara", kind: "dependent", relationship: "spouse" });
  assert.ok(String((r.data as Record<string, unknown>).note).includes("travellers: Test Partner, Sara, Ali"));
  ok("itinerary summary: traveller list echoed with kinds + relationships");
}

// 23. Clarification sanitizer preserves the planner metadata (rehydrated
// planner cards must not lose their prefill) and drops malformed ones.
{
  const { sanitizeClarificationFields, sanitizePlannerMeta } = await import(
    "../../src/lib/atelier-cli/index.js"
  );
  const planner = {
    tripType: "return",
    segments: [
      { origin: { text: "Dubai", iata: "DXB", label: "Dubai — DXB" }, destination: { text: "IST", iata: "IST", label: "IST" }, date: "2027-03-02" },
      { origin: { text: "IST", iata: "IST" }, destination: { text: "Dubai", iata: "DXB" }, date: "" },
    ],
    adults: 2,
    cabinClass: "business",
  };
  const out = sanitizeClarificationFields([
    { field: "plan", label: "Trip plan", inputType: "flight_planner", planner },
  ])!;
  assert.ok(out[0].planner, "planner survives sanitization");
  const p = out[0].planner as Record<string, unknown>;
  assert.equal(p.tripType, "return");
  assert.equal((p.segments as unknown[]).length, 2);
  assert.equal(p.adults, 2);
  // Malformed planner dropped wholesale, field itself kept.
  assert.equal(sanitizePlannerMeta({ tripType: "teleport", segments: [] }), null);
  assert.equal(sanitizePlannerMeta({ tripType: "return", segments: [{ origin: null, destination: {}, date: "x" }] }), null);
  const out2 = sanitizeClarificationFields([
    { field: "plan", label: "Trip plan", inputType: "flight_planner", planner: { tripType: "nope" } },
  ])!;
  assert.equal(out2[0].planner, undefined);
  ok("clarification sanitizer keeps valid planner metadata, drops malformed");
}

// 24. Traveller scoping (pure filter): out-of-perimeter colleagues are
// excluded for reports-scoped viewers; full scope sees all active.
{
  const { scopeColleagues } = await import(
    "../../src/lib/atelier-cli/travel-companion-capabilities.js"
  );
  const persons = [
    { id: "a", status: "active" },
    { id: "b", status: "active" },
    { id: "c", status: "inactive" },
    { id: "self", status: "active" },
  ];
  const full = scopeColleagues(persons, { kind: "full" });
  assert.deepEqual(full.map((p) => p.id), ["a", "b", "self"]);
  const scoped = scopeColleagues(persons, {
    kind: "reports",
    personIds: new Set(["a"]),
    selfPersonId: "self",
  });
  assert.deepEqual(scoped.map((p) => p.id), ["a", "self"], "out-of-perimeter colleague excluded");
  // Persona gating: companions tool follows the travel perimeter.
  const toolNames = (role: string) =>
    capabilitiesForPersona({ id: "p", orgId: "aico", role, name: "x" } as never).map(
      (e) => e.toolName,
    );
  assert.ok(toolNames("partner").includes("list_travel_companions"));
  assert.ok(toolNames("partner").includes("travel_plan_trip"));
  assert.ok(!toolNames("employee").includes("list_travel_companions"));
  assert.ok(!toolNames("board_observer").includes("travel_plan_trip"));
  ok("traveller scoping filter + companions/planner persona gating");
}

// 25. Task #744 — saved travel preferences read-through. The tools stay
// DB-free: a registered resolver supplies the requester's preferences
// before providers run. No resolver (default in this probe) = no prefs.
{
  const prefsMod = await import("../../src/lib/atelier-cli/travel-preferences.js");
  const { setTravelPreferencesResolver } = prefsMod;
  try {
    setTravelPreferencesResolver(async () => ({
      preferredAirlines: ["EK", "Turkish Airlines"],
      preferredHotelChains: ["Marriott"],
      cabinClass: "business",
      seatPreference: "aisle",
      mealPreference: null,
      departureTimeWindow: "08:00-12:00",
      arrivalTimeWindow: null,
      notes: null,
    }));
    requests.length = 0;
    // No cabinClass in the input → saved preference becomes the default.
    const r = await flights.run(
      { segments: [{ origin: "DXB", destination: "RUH", date: "2027-03-02" }] },
      ctx,
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    const ow = requests.find((q) => q.url.startsWith("/api/fares/one-way"));
    const body = ow!.body as { cabin_class?: string };
    assert.equal(body.cabin_class, "business", "saved cabin preference applied");
    const data = r.data as Record<string, unknown>;
    assert.equal(data.cabinFromPreferences, "business");
    assert.ok(String(data.travelerPreferences ?? "").includes("EK"));
    assert.ok(String(data.note ?? "").toLowerCase().includes("business"));
    // Explicit input still wins over the saved preference.
    requests.length = 0;
    const r2 = await flights.run(
      {
        segments: [{ origin: "DXB", destination: "RUH", date: "2027-03-02" }],
        cabinClass: "economy",
      },
      ctx,
    );
    assert.equal(r2.ok, true, JSON.stringify(r2));
    const ow2 = requests.find((q) => q.url.startsWith("/api/fares/one-way"));
    assert.equal((ow2!.body as { cabin_class?: string }).cabin_class, "economy");
    assert.equal((r2.data as Record<string, unknown>).cabinFromPreferences, undefined);
    // Stays surface the hotel-chain preference note (never a silent filter).
    const rs = await stays.run(
      { location: "Taksim, Istanbul", checkIn: "2027-03-02", checkOut: "2027-03-06" },
      ctx,
    );
    assert.equal(rs.ok, true, JSON.stringify(rs));
    assert.ok(String((rs.data as Record<string, unknown>).travelerPreferences ?? "").includes("Marriott"));
    // Resolver removed → results carry no preference context at all.
    setTravelPreferencesResolver(null);
    requests.length = 0;
    const r3 = await flights.run(
      { segments: [{ origin: "DXB", destination: "RUH", date: "2027-03-02" }] },
      ctx,
    );
    assert.equal(r3.ok, true);
    const ow3 = requests.find((q) => q.url.startsWith("/api/fares/one-way"));
    assert.equal((ow3!.body as { cabin_class?: string }).cabin_class, undefined);
    assert.equal((r3.data as Record<string, unknown>).travelerPreferences, undefined);
    ok("saved preferences: cabin default, explicit input wins, notes on flights+stays, clean without resolver");
  } finally {
    setTravelPreferencesResolver(null);
  }
}

ignavStub.close();
stayingStub.close();
console.log(`\ntravel-probe: ${passed}/26 groups passed`);
