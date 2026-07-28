/**
 * Task #706 — offline probe for the chat travel capabilities.
 *
 * Boots a local Duffel stub server (ATELIER_DUFFEL_BASE_URL, mirroring
 * the stub-Anthropic / stub-Perplexity pattern) and exercises the three
 * travel tools directly through the capability registry — no database,
 * no app boot, fully offline.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/travel/travel-probe.ts
 *
 * Covers:
 *   1. multi-segment flight search → offers sorted by price, airline
 *      comparison, Google Flights handoff links
 *   2. free-text place resolution (Dubai → DXB) via /places/suggestions
 *   3. missing/invalid dates → clarification (no API call)
 *   4. unknown place → clarification
 *   5. stays search (Taksim → coords) → priced, sorted, handoff links
 *   6. stays missing dates → multi-field clarification
 *   7. Airbnb deep link builder (no network)
 *   8. missing DUFFEL_API_KEY + no stub → loud travel_unavailable
 *   9. persona gating: partner sees travel tools, board_observer and
 *      employee do not
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";

// Stub must be configured BEFORE the capability module loads (module
// reads env lazily per request, but keep the pattern consistent).
const requests: Array<{ method: string; url: string; body: unknown }> = [];

const stub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method ?? "", url: req.url ?? "", body });
    res.setHeader("content-type", "application/json");
    const url = req.url ?? "";
    if (url.startsWith("/places/suggestions")) {
      const q = decodeURIComponent(url.split("query=")[1] ?? "").toLowerCase();
      if (q.includes("nowheresville")) {
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (q.includes("dubai")) {
        res.end(
          JSON.stringify({
            data: [
              {
                id: "cit_dxb",
                type: "city",
                name: "Dubai",
                iata_code: "DXB",
                city_name: "Dubai",
                latitude: 25.2532,
                longitude: 55.3657,
              },
            ],
          }),
        );
        return;
      }
      // Taksim / Istanbul
      res.end(
        JSON.stringify({
          data: [
            {
              id: "cit_ist",
              type: "city",
              name: "Istanbul",
              iata_code: "IST",
              city_name: "Istanbul",
              latitude: 41.0369,
              longitude: 28.985,
            },
          ],
        }),
      );
      return;
    }
    if (url.startsWith("/air/offer_requests")) {
      const mkSeg = (o: string, d: string, dep: string, arr: string, carrier: [string, string]) => ({
        origin: { iata_code: o },
        destination: { iata_code: d },
        departing_at: dep,
        arriving_at: arr,
        marketing_carrier: { name: carrier[0], iata_code: carrier[1] },
        marketing_carrier_flight_number: "123",
        passengers: [
          { cabin_class: "economy", baggages: [{ type: "checked", quantity: 1 }] },
        ],
      });
      res.end(
        JSON.stringify({
          data: {
            offers: [
              {
                id: "off_expensive",
                total_amount: "950.00",
                total_currency: "USD",
                owner: { name: "Emirates", iata_code: "EK" },
                slices: [
                  { segments: [mkSeg("DXB", "IST", "2027-03-02T08:10:00", "2027-03-02T12:20:00", ["Emirates", "EK"])] },
                  { segments: [mkSeg("IST", "DXB", "2027-03-06T14:00:00", "2027-03-06T19:45:00", ["Emirates", "EK"])] },
                ],
              },
              {
                id: "off_cheap",
                total_amount: "410.50",
                total_currency: "USD",
                owner: { name: "Pegasus", iata_code: "PC" },
                slices: [
                  { segments: [mkSeg("DXB", "IST", "2027-03-02T02:15:00", "2027-03-02T06:30:00", ["Pegasus", "PC"])] },
                  { segments: [mkSeg("IST", "DXB", "2027-03-06T22:00:00", "2027-03-07T03:30:00", ["Pegasus", "PC"])] },
                ],
              },
              {
                id: "off_mid",
                total_amount: "610.00",
                total_currency: "USD",
                owner: { name: "Turkish Airlines", iata_code: "TK" },
                slices: [
                  { segments: [mkSeg("DXB", "IST", "2027-03-02T10:40:00", "2027-03-02T14:55:00", ["Turkish Airlines", "TK"])] },
                  { segments: [mkSeg("IST", "DXB", "2027-03-06T09:30:00", "2027-03-06T15:05:00", ["Turkish Airlines", "TK"])] },
                ],
              },
            ],
          },
        }),
      );
      return;
    }
    if (url.startsWith("/stays/search")) {
      res.end(
        JSON.stringify({
          data: {
            results: [
              {
                id: "sta_pricey",
                accommodation: {
                  name: "Grand Bosphorus Hotel",
                  rating: 5,
                  review_score: 9.1,
                  location: { address: { line_one: "1 Taksim Sq", city_name: "Istanbul", country_code: "TR" } },
                },
                cheapest_rate_total_amount: "1200.00",
                cheapest_rate_currency: "USD",
                cheapest_rate: { cancellation_timeline: [{ refund_amount: "1200.00" }] },
              },
              {
                id: "sta_cheap",
                accommodation: {
                  name: "Taksim Business Inn",
                  rating: 4,
                  review_score: 8.2,
                  location: { address: { line_one: "5 Istiklal Cd", city_name: "Istanbul", country_code: "TR" } },
                },
                cheapest_rate_total_amount: "480.00",
                cheapest_rate_currency: "USD",
                cheapest_rate: { cancellation_timeline: [] },
              },
            ],
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ errors: [{ message: "not found" }] }));
  });
});

await new Promise<void>((resolve) => stub.listen(0, resolve));
process.env.ATELIER_DUFFEL_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
delete process.env.DUFFEL_API_KEY;

// Load the capabilities AFTER the stub is up.
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

// 1+2. Multi-segment search with free-text origin resolution.
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
  assert.equal(items[0].checkedBags, 2); // 1 checked bag per segment × 2 slices
  const cmp = data.airlineComparison as Array<Record<string, unknown>>;
  assert.equal(cmp.length, 3);
  assert.equal(cmp[0].airline, "Pegasus");
  // Place resolution: the offer request was sent with DXB (resolved from "Dubai").
  const offerReq = requests.find((q) => q.url.startsWith("/air/offer_requests"));
  assert.ok(offerReq, "offer request hit the stub");
  const slices = (offerReq!.body as { data: { slices: Array<{ origin: string }> } }).data.slices;
  assert.equal(slices.length, 2);
  assert.equal(slices[0].origin, "DXB");
  ok("multi-segment flight search: resolution, comparison, sort, handoff links");
}

// 3. Missing date → clarification, no API call.
{
  requests.length = 0;
  const r = await flights.run(
    { segments: [{ origin: "DXB", destination: "IST", date: "sometime next week" }] },
    ctx,
  );
  assert.equal(r.ok, false);
  assert.ok(r.clarification, "clarification returned");
  assert.equal(r.clarification!.field, "segments.0.date");
  assert.equal(requests.length, 0, "no API call before dates are known");
  ok("missing flight date → clarification without API call");
}

// 4. Unknown place → clarification.
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

// 5. Stays search.
{
  const r = await stays.run(
    { location: "Taksim", checkIn: "2027-03-02", checkOut: "2027-03-06" },
    ctx,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const data = r.data as Record<string, unknown>;
  const items = data.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "sta_cheap"); // cheapest first
  assert.equal(items[0].cancellation, "non-refundable");
  assert.equal(items[1].cancellation, "free cancellation available");
  assert.equal(data.nights, 4);
  assert.ok(String(items[0].nightly).includes("120.00"));
  assert.ok(String(items[0].href).startsWith("https://www.google.com/travel/search?q="));
  ok("stays search: coords resolution, price sort, cancellation, nightly");
}

// 6. Stays missing dates → multi-field clarification.
{
  const r = await stays.run({ location: "Taksim" }, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.clarification?.fields && r.clarification.fields.length === 2);
  // Contract-level check: every field entry matches the shared
  // clarification envelope (field + label strings, optional inputType
  // recognised by @workspace/chat-core's ClarificationField).
  for (const f of r.clarification!.fields!) {
    assert.equal(typeof f.field, "string");
    assert.equal(typeof f.label, "string");
    assert.equal(f.inputType, "date");
  }
  assert.equal(r.clarification!.field, r.clarification!.fields![0].field);
  ok("stays missing dates → multi-field clarification (contract shape)");
}

// 7. Airbnb deep link.
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

// 8. No stub + no key → loud failure.
{
  delete process.env.ATELIER_DUFFEL_BASE_URL;
  delete process.env.DUFFEL_API_KEY;
  const r = await flights.run(
    { segments: [{ origin: "DXB", destination: "IST", date: "2027-03-02" }] },
    ctx,
  );
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "travel_unavailable");
  assert.ok(String(r.errorMessage).includes("DUFFEL_API_KEY"));
  process.env.ATELIER_DUFFEL_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  ok("missing key → loud travel_unavailable (no silent stub data)");
}

// 9. Persona gating.
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

stub.close();
console.log(`\ntravel-probe: ${passed}/8 groups passed`);
