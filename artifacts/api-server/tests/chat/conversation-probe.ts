/**
 * Task #742 — conversation-level chat reliability harness.
 *
 * Drives MULTI-TURN conversations through the REAL orchestrator (the
 * in-process POST /cli/turn SSE endpoint on an isolated scratch DB)
 * with a scripted stub Anthropic server and offline travel-provider
 * stubs. Per-domain probes test single tools; this suite pins the
 * conversation-level contracts that kept regressing:
 *
 *   S1. 2026-07-29 hotel-dates conversation (verbatim archetype):
 *       flights stated dates → hotels ask → "5 nights" → real search.
 *       Exactly ONE clarification round; facts stated earlier reused.
 *   S2. Referential answer: "same dates I specified" resolves from
 *       session facts; then a DOUBLE-SEND of the same answer (second
 *       tab / SSE retry) gets "already answered" and NO second search.
 *   S3. "confirmed" while a clarification is pending EXECUTES the
 *       pending tool (no post-confirm dead end / generic help).
 *   S4. A fresh request while pending NEVER silently drops the
 *       question: source turn stays resumable and is answerable later.
 *   S5. Locale answers: Arabic-Indic "٥ ليال" and Turkish "5 gece"
 *       resolve to typed dates in the provider request body.
 *   S6. LLM outage mid-clarification: deterministic continuation still
 *       works (typed date answer), unparsed answers degrade to an
 *       honest re-ask — never an error, never a dropped question.
 *   S7. Self-only persona isolation: employees get 403 on /cli/turn
 *       and session facts never load across users.
 *
 * Fails loudly on re-ask loops (same field asked twice after a valid
 * answer) and dead ends (no final frame / error status).
 *
 * Run: pnpm --filter @workspace/api-server run test:chat-convo
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
// Deterministic resolver paths; the outage scenario re-enables the LLM.
process.env.ATELIER_CLI_RESOLVER_LLM = "on";
process.env.ATELIER_CLI_FACTS_MODE = "on";
process.env.ATELIER_CLI_CLARIFICATION_RESOLVER = "on";

import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++;
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail)?.slice(0, 600) : "");
  }
}

const TAG = `probe742_${Date.now()}`;

// ---------------------------------------------------------------------
// Travel provider stubs (Ignav flights + StayingAPI hotels) — offline.
// ---------------------------------------------------------------------

const stayingSearches: Array<Record<string, unknown>> = [];

const ignavStub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = req.url ?? "";
    const body = raw ? JSON.parse(raw) : null;
    res.setHeader("content-type", "application/json");
    if (url.startsWith("/api/airports")) {
      const q = decodeURIComponent(url.split("q=")[1]?.split("&")[0] ?? "").toLowerCase();
      const hit = q.includes("dubai")
        ? { code: "DXB", name: "Dubai International Airport", city: "Dubai", country: "AE" }
        : { code: "IST", name: "Istanbul Airport", city: "Istanbul", country: "TR" };
      res.end(JSON.stringify([hit]));
      return;
    }
    if (url.startsWith("/api/fares/round-trip") || url.startsWith("/api/fares/one-way")) {
      const b = body as { origin: string; destination: string; departure_date: string; return_date?: string };
      const leg = (o: string, d: string, date: string) => ({
        carrier: "Emirates",
        duration_minutes: 255,
        segments: [
          {
            marketing_carrier_code: "EK",
            flight_number: "123",
            operating_carrier_name: "Emirates",
            departure_airport: o,
            departure_time_local: `${date}T08:10:00`,
            arrival_airport: d,
            arrival_time_local: `${date}T12:20:00`,
            duration_minutes: 255,
          },
        ],
      });
      const itin: Record<string, unknown> = {
        price: { amount: 900, currency: "USD", status: "verified" },
        cabin_class: "economy",
        requires_self_transfer: false,
        ignav_id: "off_1",
        outbound: leg(b.origin, b.destination, b.departure_date),
      };
      if (b.return_date) itin.inbound = leg(b.destination, b.origin, b.return_date);
      res.end(JSON.stringify({ itineraries: [itin] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
});

const stayingStub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");
    if (url.startsWith("/search")) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw || "{}");
      } catch {}
      // GET-style query params variant:
      if (Object.keys(parsed).length === 0 && url.includes("?")) {
        parsed = Object.fromEntries(new URL(`http://x${url}`).searchParams.entries());
      }
      stayingSearches.push(parsed);
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
                {
                  id: "HTL1",
                  platform: "booking",
                  platformListingId: "HTL1",
                  url: "https://www.booking.com/hotel/tr/grand.html",
                  name: "Grand Probe Hotel",
                  propertyType: "hotel",
                  location: { lat: 41.03, lng: 28.98, city: "Istanbul", region: null, country: "TR", address: "Probe St" },
                  starRating: 5,
                  guestRating: 9.0,
                  ratingScale: 10,
                  price: {
                    platform: "booking",
                    listingId: "HTL1",
                    currency: "USD",
                    nightlyPrice: 200,
                    totalPrice: 1000,
                    fees: { cleaning: null, service: null, taxes: null },
                    nights: 5,
                    occupancy: { adults: 1, children: 0, childAges: [] },
                    source: "live",
                    url: "https://www.booking.com/hotel/tr/grand.html",
                  },
                },
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

// ---------------------------------------------------------------------
// Scriptable stub Anthropic server (must exist before app import).
// ---------------------------------------------------------------------

let anthropicOutage = false;

const anthropicStub = createServer((req, res) => {
  let body = "";
  req.on("data", (ch) => (body += ch));
  req.on("end", () => {
    if (anthropicOutage) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "api_error", message: "stubbed outage" } }));
      return;
    }
    let parsed: any = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {}
    const systemText = Array.isArray(parsed.system)
      ? parsed.system.map((b: any) => b?.text ?? "").join("\n")
      : String(parsed.system ?? "");
    const messages: any[] = Array.isArray(parsed.messages) ? parsed.messages : [];
    const send = (content: unknown[], stop: string) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `msg_${TAG}`,
          type: "message",
          role: "assistant",
          model: parsed.model ?? "claude-haiku-4-5",
          content,
          stop_reason: stop,
          stop_sequence: null,
          usage: { input_tokens: 25, output_tokens: 25 },
        }),
      );
    };
    if (systemText.startsWith("You are an intent router")) {
      send([{ type: "text", text: JSON.stringify({ verb: "read", kind: "other", entityHints: [], confidence: 0.9 }) }], "end_turn");
      return;
    }
    if (systemText.includes("title chat conversations")) {
      send([{ type: "text", text: "Probe conversation" }], "end_turn");
      return;
    }
    const hasToolResult = messages.some(
      (m) => Array.isArray(m?.content) && m.content.some((b: any) => b?.type === "tool_result"),
    );
    if (hasToolResult) {
      send([{ type: "text", text: "Here is what I found." }], "end_turn");
      return;
    }
    const lastUser = [...messages].reverse().find((m) => m?.role === "user");
    const promptText = Array.isArray(lastUser?.content)
      ? lastUser.content.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join(" ")
      : String(lastUser?.content ?? "");
    if (/find flights/i.test(promptText)) {
      send(
        [
          {
            type: "tool_use",
            id: `tu_${TAG}_f`,
            name: "travel_search_flights",
            input: {
              segments: [
                { origin: "Dubai", destination: "IST", date: "2027-03-02" },
                { origin: "IST", destination: "DXB", date: "2027-03-07" },
              ],
            },
          },
        ],
        "tool_use",
      );
      return;
    }
    if (/hotels in istanbul/i.test(promptText)) {
      send(
        [
          {
            type: "tool_use",
            id: `tu_${TAG}_h`,
            name: "travel_search_stays",
            input: { location: "Istanbul" },
          },
        ],
        "tool_use",
      );
      return;
    }
    send([{ type: "text", text: "Okay — here's what I can tell you." }], "end_turn");
  });
});

await Promise.all([
  new Promise<void>((r) => ignavStub.listen(0, r)),
  new Promise<void>((r) => stayingStub.listen(0, r)),
  new Promise<void>((r) => anthropicStub.listen(0, r)),
]);
process.env.ATELIER_IGNAV_BASE_URL = `http://127.0.0.1:${(ignavStub.address() as AddressInfo).port}`;
process.env.ATELIER_STAYING_BASE_URL = `http://127.0.0.1:${(stayingStub.address() as AddressInfo).port}`;
delete process.env.IGNAV_API_KEY;
delete process.env.STAYINGAPI_API_KEY;
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropicStub.address() as AddressInfo).port}`;
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = `${TAG}-stub-key`;

// ---------------------------------------------------------------------
// Boot app in-process on the scratch DB.
// ---------------------------------------------------------------------

const D = await import("@workspace/db");
const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns, atelierCliSessionFacts, atelierAuditEvents } =
  D as any;
const { eq, inArray } = await import("drizzle-orm");
const { loadSessionFacts } = await import("../../src/lib/atelier-cli/session-facts.js");
const appMod = await import("../../src/app.js");
const app = appMod.default;

const ORG = "aico";
const FP = `u_${TAG}_fp`;
const EMP = `u_${TAG}_emp`;

await db.insert(atelierUsers).values([
  {
    id: FP,
    orgId: ORG,
    email: `${TAG}.fp@cognirise.ai`,
    name: "Probe FP",
    initials: "PF",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: ["*"],
  },
  {
    id: EMP,
    orgId: ORG,
    email: `${TAG}.emp@cognirise.ai`,
    name: "Probe Employee",
    initials: "PE",
    role: "employee",
    roleLabel: "Employee",
    title: "Analyst",
    permissions: [],
  },
]);

const server = app.listen(0);
await new Promise<void>((r) => server.once("listening", () => r()));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

interface Frame {
  event: string;
  data: any;
}

const sessionIds = new Set<string>();
const turnIds = new Set<string>();

async function postTurn(args: {
  who?: string;
  prompt: string;
  sessionId?: string | null;
  continuesTurnId?: string | null;
}): Promise<{ status: number; frames: Frame[]; turnId: string | null; sessionId: string | null }> {
  const res = await fetch(`${BASE}/cli/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `atelier_persona=${args.who ?? FP}` },
    body: JSON.stringify({
      prompt: args.prompt,
      sessionId: args.sessionId ?? undefined,
      continuesTurnId: args.continuesTurnId ?? undefined,
      timezone: "Asia/Dubai",
    }),
  });
  const raw = await res.text();
  const frames: Frame[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const evLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!evLine || !dataLine) continue;
    let data: any = {};
    try {
      data = JSON.parse(dataLine.slice("data:".length).trim());
    } catch {}
    frames.push({ event: evLine.slice("event:".length).trim(), data });
  }
  let turnId: string | null = null;
  for (const f of frames) if (typeof f.data?.turnId === "string") turnId = f.data.turnId;
  let sessionId: string | null = null;
  if (turnId) {
    turnIds.add(turnId);
    const [row] = await db
      .select({ sessionId: atelierCliTurns.sessionId })
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, turnId))
      .limit(1);
    sessionId = row?.sessionId ?? null;
    if (sessionId) sessionIds.add(sessionId);
  }
  return { status: res.status, frames, turnId, sessionId };
}

const framesOf = (fs: Frame[], type: string) => fs.filter((f) => f.event === type);
const finalOf = (fs: Frame[]) => fs.find((f) => f.event === "final");
const clarOf = (fs: Frame[]) => [...fs].reverse().find((f) => f.event === "needs_clarification");
/** Dead-end guard: every turn must end with a final frame and a sane status. */
const assertAlive = (label: string, fs: Frame[]) => {
  const fin = finalOf(fs);
  check(
    `${label}: has final frame`,
    !!fin,
    fs.map((f) => (f.event === "error" ? { error: f.data } : f.event)),
  );
  if (fin) {
    check(
      `${label}: status not error`,
      fin.data?.status !== "error",
      { status: fin.data?.status, message: fin.data?.statusMessage },
    );
  }
};

async function waitForFacts(sessionId: string, min = 1, timeoutMs = 8000): Promise<number> {
  const start = Date.now();
  for (;;) {
    const rows = await db
      .select({ id: atelierCliSessionFacts.id })
      .from(atelierCliSessionFacts)
      .where(eq(atelierCliSessionFacts.sessionId, sessionId));
    if (rows.length >= min) return rows.length;
    if (Date.now() - start > timeoutMs) return rows.length;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function turnStatus(turnId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: atelierCliTurns.status })
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.id, turnId))
    .limit(1);
  return row?.status ?? null;
}

/** Start a session with real flight dates so facts carry an anchor. */
async function seedFlightFacts(label: string): Promise<{ sessionId: string }> {
  const t1 = await postTurn({ prompt: "Find flights from Dubai to Istanbul on 2027-03-02 returning 2027-03-07" });
  assertAlive(`${label}/flights`, t1.frames);
  const toolOk = framesOf(t1.frames, "tool_result").some(
    (f) => f.data?.tool === "travel_search_flights" && f.data?.ok === true,
  );
  check(`${label}/flights: travel_search_flights ran ok`, toolOk);
  const n = await waitForFacts(t1.sessionId!, 2);
  check(`${label}/flights: session facts ingested`, n >= 2, { factCount: n });
  return { sessionId: t1.sessionId! };
}

/** Ask for hotels → expect the dates clarification. */
async function askHotels(label: string, sessionId: string) {
  const t = await postTurn({ prompt: "find me hotels in istanbul", sessionId });
  const cl = clarOf(t.frames);
  check(`${label}/hotels: asks for dates`, !!cl && String(cl.data?.tool) === "travel_search_stays", cl?.data);
  const fieldNames = ((cl?.data?.fields as any[]) ?? []).map((f) => f.field);
  check(`${label}/hotels: asks checkIn+checkOut`, fieldNames.includes("checkIn") && fieldNames.includes("checkOut"), fieldNames);
  return { turnId: t.turnId!, frames: t.frames };
}

try {
  // =====================================================================
  // S1 — 2026-07-29 verbatim: "5 nights" resolves from stated flight
  // dates; exactly ONE clarification round then the real search runs.
  // =====================================================================
  {
    const { sessionId } = await seedFlightFacts("S1");
    const ask = await askHotels("S1", sessionId);
    const before = stayingSearches.length;
    const t3 = await postTurn({ prompt: "5 nights", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S1/answer", t3.frames);
    const stayOk = framesOf(t3.frames, "tool_result").some(
      (f) => f.data?.tool === "travel_search_stays" && f.data?.ok === true,
    );
    check("S1: '5 nights' → real hotel search ran", stayOk, t3.frames.map((f) => f.event));
    check("S1: no re-ask after the answer", !clarOf(t3.frames), clarOf(t3.frames)?.data);
    check("S1: exactly one provider search", stayingSearches.length === before + 1, stayingSearches.length - before);
    const s = stayingSearches[stayingSearches.length - 1] ?? {};
    const sBody = JSON.stringify(s);
    check("S1: dates typed from facts (2027-03-02 → 2027-03-07)", sBody.includes("2027-03-02") && sBody.includes("2027-03-07"), s);
    // Conversation-level: ONE clarification round total.
    const rows = await db
      .select({ frames: atelierCliTurns.frames })
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.sessionId, sessionId));
    const clarCount = rows
      .flatMap((r: any) => (Array.isArray(r.frames) ? r.frames : []))
      .filter((f: any) => f?.type === "needs_clarification").length;
    check("S1: exactly ONE clarification round in the whole conversation", clarCount === 1, clarCount);
  }

  // =====================================================================
  // S2 — referential answer + double-send (exactly-once consumption).
  // =====================================================================
  {
    const { sessionId } = await seedFlightFacts("S2");
    const ask = await askHotels("S2", sessionId);
    const before = stayingSearches.length;
    const t3 = await postTurn({ prompt: "same dates I specified", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S2/answer", t3.frames);
    const stayOk = framesOf(t3.frames, "tool_result").some(
      (f) => f.data?.tool === "travel_search_stays" && f.data?.ok === true,
    );
    check("S2: 'same dates I specified' → search ran", stayOk);
    check("S2: one provider search", stayingSearches.length === before + 1);
    // Double-send: same continuesTurnId again (second tab / SSE retry).
    const t4 = await postTurn({ prompt: "same dates I specified", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S2/double-send", t4.frames);
    const alreadyNarr = framesOf(t4.frames, "narration").some((f) =>
      String(f.data?.text ?? "").toLowerCase().includes("already answered"),
    );
    check("S2: duplicate answer → explicit 'already answered'", alreadyNarr, framesOf(t4.frames, "narration").map((f) => f.data?.text));
    check("S2: duplicate answer → NO second search", stayingSearches.length === before + 1, stayingSearches.length - before);
  }

  // =====================================================================
  // S3 — "confirmed" executes the pending tool (no dead end).
  // =====================================================================
  {
    const { sessionId } = await seedFlightFacts("S3");
    const ask = await askHotels("S3", sessionId);
    const before = stayingSearches.length;
    const t3 = await postTurn({ prompt: "confirmed", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S3/confirmed", t3.frames);
    const stayOk = framesOf(t3.frames, "tool_result").some(
      (f) => f.data?.tool === "travel_search_stays" && f.data?.ok === true,
    );
    check("S3: 'confirmed' executes the search (no generic help)", stayOk, t3.frames.map((f) => f.event));
    check("S3: no post-confirm dead-end re-ask", !clarOf(t3.frames));
    check("S3: provider searched once", stayingSearches.length === before + 1);
  }

  // =====================================================================
  // S4 — fresh request never silently drops the pending question.
  // =====================================================================
  {
    const { sessionId } = await seedFlightFacts("S4");
    const ask = await askHotels("S4", sessionId);
    // Fresh command WITHOUT continuesTurnId supersedes...
    const t3 = await postTurn({ prompt: "show my meetings for today", sessionId });
    assertAlive("S4/fresh-request", t3.frames);
    // ...but the source turn stays RESUMABLE (not retired/cancelled).
    const st = await turnStatus(ask.turnId);
    check("S4: superseded question stays resumable", st === "awaiting_clarification", st);
    // Answering it later by explicit continuation still works.
    const before = stayingSearches.length;
    const t4 = await postTurn({ prompt: "same dates I specified", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S4/late-answer", t4.frames);
    const stayOk = framesOf(t4.frames, "tool_result").some(
      (f) => f.data?.tool === "travel_search_stays" && f.data?.ok === true,
    );
    check("S4: late answer to superseded question still resolves", stayOk);
    check("S4: search ran once", stayingSearches.length === before + 1);
  }

  // =====================================================================
  // S5 — Arabic/Turkish locale answers resolve to typed dates.
  // =====================================================================
  {
    const { sessionId } = await seedFlightFacts("S5-ar");
    const ask = await askHotels("S5-ar", sessionId);
    const before = stayingSearches.length;
    const t3 = await postTurn({ prompt: "٥ ليال", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S5/arabic", t3.frames);
    check(
      "S5: Arabic-Indic '٥ ليال' → search with typed dates",
      stayingSearches.length === before + 1 && JSON.stringify(stayingSearches[stayingSearches.length - 1]).includes("2027-03-07"),
      stayingSearches[stayingSearches.length - 1],
    );
  }
  {
    const { sessionId } = await seedFlightFacts("S5-tr");
    const ask = await askHotels("S5-tr", sessionId);
    const before = stayingSearches.length;
    const t3 = await postTurn({ prompt: "5 gece", sessionId, continuesTurnId: ask.turnId });
    assertAlive("S5/turkish", t3.frames);
    check("S5: Turkish '5 gece' → search ran", stayingSearches.length === before + 1);
  }

  // =====================================================================
  // S6 — LLM outage mid-clarification: deterministic paths survive.
  // =====================================================================
  {
    const { sessionId } = await seedFlightFacts("S6");
    const ask = await askHotels("S6", sessionId);
    anthropicOutage = true;
    try {
      // Unparsed answer → LLM assist fails (500) → degrades to raw merge
      // → tool re-asks. NEVER an error, NEVER a dropped question.
      const t3 = await postTurn({ prompt: "hmm the usual I guess", sessionId, continuesTurnId: ask.turnId });
      assertAlive("S6/outage-unparsed", t3.frames);
      const cl = clarOf(t3.frames);
      check("S6: outage + unparsed answer → honest re-ask (not error)", !!cl, t3.frames.map((f) => f.event));
      // Typed date answer resolves deterministically DURING the outage.
      const before = stayingSearches.length;
      const clTurnId = t3.turnId!;
      const t4 = await postTurn({ prompt: "same dates I specified", sessionId, continuesTurnId: clTurnId });
      assertAlive("S6/outage-typed", t4.frames);
      const stayOk = framesOf(t4.frames, "tool_result").some(
        (f) => f.data?.tool === "travel_search_stays" && f.data?.ok === true,
      );
      check("S6: typed answer resolves during outage", stayOk, t4.frames.map((f) => f.event));
      check("S6: search ran once during outage", stayingSearches.length === before + 1);
    } finally {
      anthropicOutage = false;
    }
  }

  // =====================================================================
  // S7 — self-only persona isolation.
  // =====================================================================
  {
    // Employee chat is allowed but clamped to me.* self-only tools — a
    // travel prompt must NOT reach the travel capability (no provider
    // call, no clarification about someone else's trip).
    const before = stayingSearches.length;
    const r = await postTurn({ who: EMP, prompt: "find me hotels in istanbul" });
    check("S7: employee turn completes (self-only clamp, not a crash)", r.status === 200 && !!finalOf(r.frames), {
      status: r.status,
      events: r.frames.map((f) => f.event),
    });
    check(
      "S7: employee never reaches travel tools",
      stayingSearches.length === before &&
        !framesOf(r.frames, "tool_result").some((f) => String(f.data?.tool ?? "").startsWith("travel_")),
    );
    // An employee cannot resume another user's clarification turn.
    const fpAsk = [...turnIds].length > 0 ? await seedFlightFacts("S7") : null;
    if (fpAsk) {
      const ask = await askHotels("S7", fpAsk.sessionId);
      const hijack = await postTurn({ who: EMP, prompt: "5 nights", continuesTurnId: ask.turnId });
      const hijacked = framesOf(hijack.frames, "tool_result").some(
        (f) => f.data?.tool === "travel_search_stays" && f.data?.ok === true,
      );
      check("S7: employee cannot resume another user's clarification", !hijacked, hijack.frames.map((f) => f.event));
      const st = await turnStatus(ask.turnId);
      check("S7: FP's pending question untouched by the hijack attempt", st === "awaiting_clarification", st);
    }
    // Facts never load across users: pick any session with facts.
    const anySession = [...sessionIds][0];
    if (anySession) {
      const own = await loadSessionFacts({ orgId: ORG, userId: FP, sessionId: anySession });
      const other = await loadSessionFacts({ orgId: ORG, userId: EMP, sessionId: anySession });
      check("S7: owner sees session facts", own.length > 0, own.length);
      check("S7: another user sees ZERO facts for the same session", other.length === 0, other.length);
    }
  }
} finally {
  // Cleanup (scratch DB, but keep it tidy for reuse) + __t sweep pattern.
  try {
    const tids = [...turnIds];
    if (tids.length > 0) {
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, tids));
      await db.delete(atelierCliTurns).where(inArray(atelierCliTurns.id, tids));
    }
    const sids = [...sessionIds];
    if (sids.length > 0) {
      await db.delete(atelierCliSessionFacts).where(inArray(atelierCliSessionFacts.sessionId, sids));
      await db.delete(atelierCliSessions).where(inArray(atelierCliSessions.id, sids));
    }
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP, EMP]));
  } catch (err) {
    console.error("cleanup failed", err);
  }
  server.close();
  ignavStub.close();
  stayingStub.close();
  anthropicStub.close();
  await pool.end().catch(() => {});
}

console.log(`\n[conversation-probe] pass=${passes} fail=${failures}`);
process.exit(failures > 0 ? 1 : 0);
