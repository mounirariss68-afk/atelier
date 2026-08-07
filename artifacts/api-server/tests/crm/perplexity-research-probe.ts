/**
 * Task #687 — Perplexity research layer probe (fully offline).
 *
 * Asserts, with BOTH providers stubbed locally (no live LLM / Perplexity):
 *   1. Default provider is "perplexity": callResearchJson runs retrieval
 *      against the Perplexity stub (ATELIER_PERPLEXITY_BASE_URL, mirroring
 *      the stub-Anthropic pattern), then synthesises via the Anthropic stub.
 *      The dossier (answer + source URLs) is embedded in the Claude prompt
 *      and citationUrls come from the Perplexity search_results.
 *   2. ATELIER_RESEARCH_PROVIDER=anthropic keeps the legacy web_search path
 *      (request body carries the web_search tool; Perplexity never called).
 *   3. Fail-loud: an unreachable Perplexity endpoint throws
 *      PerplexityConnectionError — no silent fallback to the LLM-only path
 *      (the Anthropic stub must NOT be hit).
 *   4. Unknown provider value throws loudly.
 *   5. API error status (e.g. 400) surfaces as PerplexityConnectionError
 *      with a body snippet.
 *   6. Missing PERPLEXITY_API_KEY (no stub base URL) → actionable error.
 *   7. Slow endpoint → per-query timeout error (ATELIER_PERPLEXITY_TIMEOUT_MS).
 *   8. 429-then-200 → one retry, query succeeds.
 *
 * Run: pnpm exec tsx tests/crm/perplexity-research-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const SYNTH_OUTPUT = {
  summary: "Probe Co is a mid-size logistics firm.",
  facts: [
    {
      topic: "scale",
      statement: "Probe Co employs ~1,200 people.",
      sourceUrl: "https://example.test/profile",
      confidence: "green",
    },
  ],
};

async function main() {
  // --- stub Anthropic server (SSE for messages.stream) ---
  const anthropicRequests: string[] = [];
  const anthropicStub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      anthropicRequests.push(body);
      const text = JSON.stringify(SYNTH_OUTPUT);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const ev = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", {
        type: "message_start",
        message: {
          id: "msg_pplxprobe",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      ev("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      ev("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      });
      ev("content_block_stop", { type: "content_block_stop", index: 0 });
      ev("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 20 },
      });
      ev("message_stop", { type: "message_stop" });
      res.end();
    });
  });
  anthropicStub.listen(0);
  await new Promise<void>((r) => anthropicStub.once("listening", () => r()));
  const anthropicPort = (anthropicStub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "pplxprobe-stub-key";

  // --- stub Perplexity server (/chat/completions) ---
  const perplexityRequests: string[] = [];
  const perplexityStub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      perplexityRequests.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "pplx_stub",
          model: "sonar-pro",
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "Probe Co is a Dubai logistics firm with roughly 1,200 employees.",
              },
            },
          ],
          search_results: [
            { title: "Probe Co profile", url: "https://example.test/profile" },
            { title: "Probe Co news", url: "https://example.test/news" },
          ],
          citations: ["https://example.test/profile", "https://example.test/news"],
        }),
      );
    });
  });
  perplexityStub.listen(0);
  await new Promise<void>((r) => perplexityStub.once("listening", () => r()));
  const perplexityPort = (perplexityStub.address() as AddressInfo).port;
  process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${perplexityPort}`;
  delete process.env.ATELIER_RESEARCH_PROVIDER;

  const runner = await import("../../src/lib/atelier-agents/runner.js");
  const { PerplexityConnectionError } = await import(
    "../../src/lib/atelier-agents/perplexity.js"
  );

  try {
    // ---- 1. Default = Perplexity retrieval → Claude synthesis ----
    check("provider defaults to perplexity", runner.researchProvider() === "perplexity");
    const r1 = await runner.callResearchJson<typeof SYNTH_OUTPUT>(
      "claude-sonnet-4-5",
      "You are a research agent.",
      JSON.stringify({ accountName: "Probe Co" }),
      { researchQueries: ["Probe Co company profile", "Probe Co leadership"] },
    );
    check("synthesised value matches contract", r1.value?.summary === SYNTH_OUTPUT.summary);
    check(
      "citations come from Perplexity search_results",
      r1.citationUrls.length === 2 &&
        r1.citationUrls[0].url === "https://example.test/profile" &&
        r1.citationUrls[0].title === "Probe Co profile",
      r1.citationUrls,
    );
    check(
      "one Perplexity call per retrieval query",
      perplexityRequests.length === 2,
      perplexityRequests.length,
    );
    const claudeBody = anthropicRequests[anthropicRequests.length - 1] ?? "";
    check(
      "dossier (answer + sources) embedded in the Claude prompt",
      claudeBody.includes("Web research dossier") &&
        claudeBody.includes("Dubai logistics firm") &&
        claudeBody.includes("https://example.test/profile"),
    );
    check(
      "synthesis call carries no web_search tool",
      !claudeBody.includes("web_search"),
    );
    check("cost includes both stages", r1.costUsd > 0);

    // ---- 2. ATELIER_RESEARCH_PROVIDER=anthropic keeps the legacy path ----
    const pplxCallsBefore = perplexityRequests.length;
    const anthCallsBefore = anthropicRequests.length;
    process.env.ATELIER_RESEARCH_PROVIDER = "anthropic";
    const r2 = await runner.callResearchJson<typeof SYNTH_OUTPUT>(
      "claude-sonnet-4-5",
      "You are a research agent.",
      JSON.stringify({ accountName: "Probe Co" }),
      { researchQueries: ["Probe Co company profile"] },
    );
    check("anthropic mode returns the contract shape", r2.value?.summary === SYNTH_OUTPUT.summary);
    check(
      "anthropic mode skips Perplexity entirely",
      perplexityRequests.length === pplxCallsBefore,
    );
    const legacyBody = anthropicRequests[anthropicRequests.length - 1] ?? "";
    check(
      "anthropic mode uses the web_search tool path",
      anthropicRequests.length === anthCallsBefore + 1 && legacyBody.includes("web_search"),
    );
    delete process.env.ATELIER_RESEARCH_PROVIDER;

    // ---- 3. Fail-loud: broken Perplexity endpoint, no silent fallback ----
    const anthCallsBefore3 = anthropicRequests.length;
    process.env.ATELIER_PERPLEXITY_BASE_URL = "http://127.0.0.1:59999/nope";
    let thrown: unknown = null;
    try {
      await runner.callResearchJson(
        "claude-sonnet-4-5",
        "You are a research agent.",
        "{}",
        { researchQueries: ["anything"] },
      );
    } catch (err) {
      thrown = err;
    }
    check(
      "broken connection throws PerplexityConnectionError",
      thrown instanceof PerplexityConnectionError,
      thrown,
    );
    check(
      "no silent fallback — Claude never called on retrieval failure",
      anthropicRequests.length === anthCallsBefore3,
    );
    process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${perplexityPort}`;

    // ---- 4. Unknown provider throws loudly ----
    process.env.ATELIER_RESEARCH_PROVIDER = "bing";
    let badProvider: unknown = null;
    try {
      runner.researchProvider();
    } catch (err) {
      badProvider = err;
    }
    check("unknown provider value throws", badProvider instanceof Error);
    delete process.env.ATELIER_RESEARCH_PROVIDER;

    const { perplexitySearch } = await import(
      "../../src/lib/atelier-agents/perplexity.js"
    );

    // ---- 5. API error status surfaces with body snippet ----
    const errorStub = createServer((req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad model name" }));
    });
    errorStub.listen(0);
    await new Promise<void>((r) => errorStub.once("listening", () => r()));
    process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${(errorStub.address() as AddressInfo).port}`;
    let apiErr: unknown = null;
    try {
      await perplexitySearch("anything");
    } catch (err) {
      apiErr = err;
    }
    errorStub.close();
    check(
      "API error status surfaces with body snippet",
      apiErr instanceof PerplexityConnectionError &&
        apiErr.message.includes("HTTP 400") &&
        apiErr.message.includes("bad model name"),
      apiErr,
    );

    // ---- 6. Missing PERPLEXITY_API_KEY → actionable error ----
    const savedBase = process.env.ATELIER_PERPLEXITY_BASE_URL;
    const savedKey = process.env.PERPLEXITY_API_KEY;
    delete process.env.ATELIER_PERPLEXITY_BASE_URL;
    delete process.env.PERPLEXITY_API_KEY;
    let keyErr: unknown = null;
    try {
      await perplexitySearch("anything");
    } catch (err) {
      keyErr = err;
    }
    check(
      "missing PERPLEXITY_API_KEY fails loudly with actionable message",
      keyErr instanceof PerplexityConnectionError &&
        keyErr.message.includes("PERPLEXITY_API_KEY"),
      keyErr,
    );
    process.env.ATELIER_PERPLEXITY_BASE_URL = savedBase;
    if (savedKey !== undefined) process.env.PERPLEXITY_API_KEY = savedKey;

    // ---- 7. Slow endpoint → per-query timeout error ----
    const slowStub = createServer((_req, _res) => {
      /* never responds */
    });
    slowStub.listen(0);
    await new Promise<void>((r) => slowStub.once("listening", () => r()));
    process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${(slowStub.address() as AddressInfo).port}`;
    process.env.ATELIER_PERPLEXITY_TIMEOUT_MS = "1000";
    let slowErr: unknown = null;
    const slowStart = Date.now();
    try {
      await perplexitySearch("anything");
    } catch (err) {
      slowErr = err;
    }
    slowStub.close();
    delete process.env.ATELIER_PERPLEXITY_TIMEOUT_MS;
    check(
      "slow endpoint surfaces the per-query timeout as connection error",
      slowErr instanceof PerplexityConnectionError &&
        slowErr.message.includes("timed out") &&
        Date.now() - slowStart < 10_000,
      slowErr,
    );

    // ---- 8. 429-then-200 → one retry, success ----
    let flakyHits = 0;
    const flakyStub = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        flakyHits++;
        if (flakyHits === 1) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "rate limited" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Retry answer." } }],
            search_results: [{ title: "Src", url: "https://example.test/retry" }],
          }),
        );
      });
    });
    flakyStub.listen(0);
    await new Promise<void>((r) => flakyStub.once("listening", () => r()));
    process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${(flakyStub.address() as AddressInfo).port}`;
    process.env.ATELIER_PERPLEXITY_RETRY_BACKOFF_MS = "10";
    let retryResult: Awaited<ReturnType<typeof perplexitySearch>> | null = null;
    let retryErr: unknown = null;
    try {
      retryResult = await perplexitySearch("anything");
    } catch (err) {
      retryErr = err;
    }
    flakyStub.close();
    delete process.env.ATELIER_PERPLEXITY_RETRY_BACKOFF_MS;
    check(
      "429-then-200 retries once and succeeds",
      flakyHits === 2 && retryResult?.answer === "Retry answer.",
      retryErr ?? { flakyHits, retryResult },
    );
    process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${perplexityPort}`;

    // ---- 9. Date-anchored system prompt (Task #771) ----
    // Set the env-var override so the date is deterministic regardless of
    // when the probe runs. perplexitySearch reads it at call time.
    process.env.ATELIER_PERPLEXITY_TODAY = "2026-08-01";
    const pplxBeforeDate = perplexityRequests.length;
    await perplexitySearch("Probe Co latest news");
    const dateReqBody = JSON.parse(perplexityRequests[pplxBeforeDate] ?? "{}") as {
      messages?: Array<{ role: string; content: string }>;
    };
    const sysContent = dateReqBody.messages?.[0]?.content ?? "";
    check(
      "system prompt includes today's date (ATELIER_PERPLEXITY_TODAY)",
      sysContent.includes("Today is 2026-08-01"),
      { sysContent: sysContent.slice(0, 200) },
    );
    check(
      "system prompt instructs model to prioritise recent info",
      sysContent.includes("Prioritise the most recent information"),
      { sysContent: sysContent.slice(0, 200) },
    );
    delete process.env.ATELIER_PERPLEXITY_TODAY;

    // ---- 10. recencyQueries get search_recency_filter:"month" (Task #771) ----
    const pplxBeforeRecency = perplexityRequests.length;
    await runner.callResearchJson<typeof SYNTH_OUTPUT>(
      "claude-sonnet-4-5",
      "You are a research agent.",
      JSON.stringify({ accountName: "Probe Co" }),
      {
        researchQueries: ["Probe Co company profile"],
        recencyQueries: ["Probe Co recent announcements"],
      },
    );
    // 2 base Perplexity calls expected: 1 base + 1 recency
    // (entityLabel auto-supplement would push to 3 — no entityLabel here, so 2)
    const recencyCallCount = perplexityRequests.length - pplxBeforeRecency;
    check(
      "recencyQueries fires an extra Perplexity call",
      recencyCallCount >= 2,
      { recencyCallCount },
    );
    const baseBody = JSON.parse(perplexityRequests[pplxBeforeRecency] ?? "{}") as {
      search_recency_filter?: string;
    };
    const recencyBody = JSON.parse(perplexityRequests[pplxBeforeRecency + 1] ?? "{}") as {
      search_recency_filter?: string;
    };
    check(
      "base query has no search_recency_filter",
      !("search_recency_filter" in baseBody),
      baseBody,
    );
    check(
      "recency query carries search_recency_filter:month",
      recencyBody.search_recency_filter === "month",
      recencyBody,
    );

    // ---- 11. entityLabel auto-supplement fires with month filter (Task #771) ----
    const pplxBeforeAuto = perplexityRequests.length;
    await runner.callResearchJson<typeof SYNTH_OUTPUT>(
      "claude-sonnet-4-5",
      "You are a research agent.",
      JSON.stringify({ accountName: "Probe Co" }),
      {
        researchQueries: ["Probe Co company profile"],
        entityLabel: "Probe Co",
      },
    );
    const autoCallCount = perplexityRequests.length - pplxBeforeAuto;
    check(
      "entityLabel triggers auto-supplement: 2 Perplexity calls (1 base + 1 auto)",
      autoCallCount === 2,
      { autoCallCount },
    );
    const autoBody = JSON.parse(perplexityRequests[pplxBeforeAuto + 1] ?? "{}") as {
      search_recency_filter?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    check(
      "auto-supplement carries search_recency_filter:month",
      autoBody.search_recency_filter === "month",
      autoBody,
    );
    check(
      "auto-supplement query mentions entity name",
      (autoBody.messages?.[1]?.content ?? "").includes("Probe Co"),
      { query: autoBody.messages?.[1]?.content },
    );

    // ---- 12. Freshness self-check (pure — no stub needed) (Task #771) ----
    const { checkDossierFreshness } = await import(
      "../../src/lib/atelier-agents/brief-quality.js"
    );

    // Old dossier: only 2022/2023 content → potentiallyStale = true
    const oldDossier =
      "### Research query 1: Probe Co overview\n" +
      "In early 2022 Probe Co expanded into logistics. By 2023 they had 900 employees.";
    const staleResult = checkDossierFreshness(oldDossier, "2026-08-01");
    check(
      "old-dates dossier (2022/2023 only) is flagged potentiallyStale",
      staleResult.potentiallyStale === true,
      staleResult,
    );
    check(
      "latestYearFound is 2023 for old dossier",
      staleResult.latestYearFound === 2023,
      staleResult,
    );

    // Fresh dossier: contains 2026 → potentiallyStale = false
    const freshDossier =
      "### Research query 1: Probe Co overview\n" +
      "In July 2026 Probe Co announced a major partnership with a regional bank.";
    const freshResult = checkDossierFreshness(freshDossier, "2026-08-01");
    check(
      "fresh dossier (contains 2026) is not flagged potentiallyStale",
      freshResult.potentiallyStale === false,
      freshResult,
    );
    check(
      "latestYearFound is 2026 for fresh dossier",
      freshResult.latestYearFound === 2026,
      freshResult,
    );

    // Boundary: dossier with (currentYear - 1) = 2025 only → NOT stale
    // (threshold is latestYearFound < currentYear - 1, so 2025 is within window)
    const borderDossier = "Probe Co had revenues of AED 2.1B in 2025.";
    const borderResult = checkDossierFreshness(borderDossier, "2026-08-01");
    check(
      "dossier with only last-year dates (2025) is not flagged stale",
      borderResult.potentiallyStale === false,
      borderResult,
    );

    // Empty dossier → stale (no dates at all)
    const emptyResult = checkDossierFreshness("No dates mentioned here.", "2026-08-01");
    check(
      "dossier with no year markers is flagged potentiallyStale",
      emptyResult.potentiallyStale === true,
      emptyResult,
    );
    check(
      "latestYearFound is null for dossier with no years",
      emptyResult.latestYearFound === null,
      emptyResult,
    );

    // ---- 13. Brief-quality completeness payload exposes potentiallyStale (Task #771) ----
    // Verify that computeBriefCompleteness and computeAccountBriefCompleteness
    // actually SET potentiallyStale on the returned payload — not leave it as a
    // dead optional field — by scanning openQuestions for the STALENESS_OQ_MARKER.
    // This covers both the POST-run path (fresh result) and the GET path (persisted
    // openQuestions from atelierBriefs or atelierAccounts.research_brief).
    const { computeBriefCompleteness, computeAccountBriefCompleteness, STALENESS_OQ_MARKER } =
      await import("../../src/lib/atelier-agents/brief-quality.js");

    // Matches the actual Scout injection string (runner.ts) so the round-trip
    // tests below use a realistic openQuestions entry.
    const staleMarkerStr =
      STALENESS_OQ_MARKER +
      ": no content dated from this or the previous calendar year was found in the retrieved answers. Verify the account name and sector then re-run.";

    // 13a. computeBriefCompleteness with stale openQuestions → potentiallyStale true
    const scoutStaleCompleteness = computeBriefCompleteness(
      {
        accountSnapshot: null as unknown as undefined,
        buyerLandscape: null as unknown as undefined,
        fiveCDraft: null as unknown as undefined,
        openQuestions: [staleMarkerStr, "What is their AI budget?"],
      },
      [],
    );
    check(
      "computeBriefCompleteness: stale openQuestions → potentiallyStale true",
      scoutStaleCompleteness.potentiallyStale === true,
      scoutStaleCompleteness,
    );

    // 13b. computeBriefCompleteness without stale marker → potentiallyStale false
    const scoutFreshCompleteness = computeBriefCompleteness(
      {
        accountSnapshot: null as unknown as undefined,
        buyerLandscape: null as unknown as undefined,
        fiveCDraft: null as unknown as undefined,
        openQuestions: ["What is their AI budget?", "Who is the CIO?"],
      },
      [],
    );
    check(
      "computeBriefCompleteness: normal openQuestions → potentiallyStale false",
      scoutFreshCompleteness.potentiallyStale === false,
      scoutFreshCompleteness,
    );

    // 13c. computeBriefCompleteness with empty openQuestions → potentiallyStale false
    const scoutEmptyCompleteness = computeBriefCompleteness(
      { accountSnapshot: null as unknown as undefined, buyerLandscape: null as unknown as undefined, fiveCDraft: null as unknown as undefined, openQuestions: [] },
      [],
    );
    check(
      "computeBriefCompleteness: empty openQuestions → potentiallyStale false",
      scoutEmptyCompleteness.potentiallyStale === false,
      scoutEmptyCompleteness,
    );

    // 13d. Simulates persistence round-trip: openQuestions with marker survives DB
    // storage as a plain string array and is detected correctly on re-read.
    const persistedOpenQuestions: string[] = JSON.parse(
      JSON.stringify([staleMarkerStr, "Clarify the board composition."]),
    );
    const persisted = computeBriefCompleteness(
      { accountSnapshot: null as unknown as undefined, buyerLandscape: null as unknown as undefined, fiveCDraft: null as unknown as undefined, openQuestions: persistedOpenQuestions },
      [],
    );
    check(
      "computeBriefCompleteness: persisted stale marker → potentiallyStale true after JSON round-trip",
      persisted.potentiallyStale === true,
      persisted,
    );

    // 13e. computeAccountBriefCompleteness with stale openQuestions → potentiallyStale true
    const acctStaleCompleteness = computeAccountBriefCompleteness(
      { openQuestions: [staleMarkerStr] },
      [],
    );
    check(
      "computeAccountBriefCompleteness: stale openQuestions → potentiallyStale true",
      acctStaleCompleteness.potentiallyStale === true,
      acctStaleCompleteness,
    );

    // 13f. computeAccountBriefCompleteness without stale marker → potentiallyStale false
    const acctFreshCompleteness = computeAccountBriefCompleteness(
      { openQuestions: ["Is their digital transformation complete?"] },
      [],
    );
    check(
      "computeAccountBriefCompleteness: normal openQuestions → potentiallyStale false",
      acctFreshCompleteness.potentiallyStale === false,
      acctFreshCompleteness,
    );

    // 13g. Null brief (no researchBrief yet) → potentiallyStale false, not an error
    const acctNullCompleteness = computeAccountBriefCompleteness(null, []);
    check(
      "computeAccountBriefCompleteness: null brief → potentiallyStale false (no error)",
      acctNullCompleteness.potentiallyStale === false,
      acctNullCompleteness,
    );

    // ---- 14. E2E heading-exclusion regression (Task #771 correction round 2) ----
    //
    // The auto-supplement query heading looks like:
    //   "### Research query 2 [recency-filtered]: Latest news, announcements and
    //    milestones for Probe Co as of 2026-08-01"
    //
    // Before the fix, checkDossierFreshness scanned the WHOLE dossier string,
    // found "2026" in that heading, and returned potentiallyStale=false even
    // when every retrieved answer was old or undated. The fix strips lines
    // starting with "### Research query " before scanning.

    const { perplexityResearch } = await import(
      "../../src/lib/atelier-agents/perplexity.js"
    );

    // 14a. E2E stale: real perplexityResearch call with entityLabel — the stub
    // answer contains NO year ("Probe Co is a Dubai logistics firm with roughly
    // 1,200 employees.").  The auto-supplement heading adds "as of 2026-08-01";
    // after heading-line stripping that year must NOT count → potentiallyStale true.
    perplexityRequests.length = 0;
    const staleDossierResult = await perplexityResearch({
      queries: ["Probe Co company overview"],
      entityLabel: "Probe Co",
      today: "2026-08-01",
    });
    const staleE2E = checkDossierFreshness(staleDossierResult.dossier, "2026-08-01");
    check(
      "E2E stale: entityLabel heading year must NOT prevent potentiallyStale=true when answers are undated",
      staleE2E.potentiallyStale === true,
      {
        latestYearFound: staleE2E.latestYearFound,
        dossierSnippet: staleDossierResult.dossier.slice(0, 300),
      },
    );

    // 14b. Heading-year-only contamination guard (synthetic): year ONLY in the
    // "### Research query" heading line, answer text is undated → stale.
    const headingOnlyDossier =
      "### Research query 1 [recency-filtered]: Latest news for Probe Co as of 2026-08-01\n" +
      "Probe Co is a logistics company. No recent developments found.\n\n" +
      "Sources:\n  (no sources returned)";
    const headingOnlyResult = checkDossierFreshness(headingOnlyDossier, "2026-08-01");
    check(
      "heading-year-only: 2026 in heading line but not in answer → potentiallyStale=true",
      headingOnlyResult.potentiallyStale === true,
      headingOnlyResult,
    );

    // 14c. E2E fresh (synthetic): heading has "as of 2026-08-01" AND the answer
    // text also mentions "2026" → not stale (the answer year is what matters).
    const freshHeadingAndAnswerDossier =
      "### Research query 1 [recency-filtered]: Latest news for Probe Co as of 2026-08-01\n" +
      "In Q2 2026 Probe Co expanded its logistics network to Abu Dhabi.\n\n" +
      "Sources:\n  [1] Probe Co update — https://example.test/update";
    const freshE2E = checkDossierFreshness(freshHeadingAndAnswerDossier, "2026-08-01");
    check(
      "E2E fresh: answer text year (2026) correctly marks potentiallyStale=false",
      freshE2E.potentiallyStale === false,
      freshE2E,
    );

    // 14d. Multi-query dossier: heading of query 2 has current year in query
    // text but all answer sections are undated → potentiallyStale=true.
    const multiQueryDossier =
      "### Research query 1: Probe Co company overview\n" +
      "Probe Co is a logistics company founded in 2005.\n\n" +
      "Sources:\n  [1] About Probe Co — https://example.test/about\n\n" +
      "### Research query 2 [recency-filtered]: Latest news for Probe Co as of 2026-08-01\n" +
      "No major announcements found recently.\n\n" +
      "Sources:\n  (no sources returned)";
    const multiResult = checkDossierFreshness(multiQueryDossier, "2026-08-01");
    check(
      "multi-query: heading year excluded; only answer year (2005) found → potentiallyStale=true",
      multiResult.potentiallyStale === true,
      multiResult,
    );
    check(
      "multi-query: latestYearFound is 2005 (from answer), not 2026 (from heading)",
      multiResult.latestYearFound === 2005,
      multiResult,
    );

    // 14e. Citation-title/URL year contamination (Task #771 correction round 3):
    // answer text is undated/old but the Sources block contains a current-year
    // token in a citation title and a URL slug → must NOT prevent potentiallyStale=true.
    const citationYearDossier =
      "### Research query 1: Probe Co overview\n" +
      "Probe Co is a logistics company. No recent news found.\n\n" +
      "Sources:\n" +
      "  [1] 2026 Annual Report — https://example.test/reports/2026-annual-report\n" +
      "  [2] https://example.test/news-2026-recap";
    const citationYearResult = checkDossierFreshness(citationYearDossier, "2026-08-01");
    check(
      "citation-year: 2026 in source title/URL only → potentiallyStale=true (not falsely fresh)",
      citationYearResult.potentiallyStale === true,
      citationYearResult,
    );

    // 14f. Current-year in citation but ALSO in answer → fresh (answer wins).
    const citationAndAnswerYearDossier =
      "### Research query 1: Probe Co overview\n" +
      "In Q3 2026 Probe Co signed a major logistics contract.\n\n" +
      "Sources:\n" +
      "  [1] 2026 Annual Report — https://example.test/reports/2026-annual-report";
    const citationAndAnswerResult = checkDossierFreshness(citationAndAnswerYearDossier, "2026-08-01");
    check(
      "citation+answer-year: 2026 in both answer and source → potentiallyStale=false",
      citationAndAnswerResult.potentiallyStale === false,
      citationAndAnswerResult,
    );
  } finally {
    anthropicStub.close();
    perplexityStub.close();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
