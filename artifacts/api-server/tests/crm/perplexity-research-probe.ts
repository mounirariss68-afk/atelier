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
