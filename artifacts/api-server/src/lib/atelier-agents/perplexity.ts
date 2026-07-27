/**
 * Task #687 — Perplexity web-research client (Replit Perplexity connector).
 *
 * Retrieval layer for the web-research agents: each call performs one
 * web-grounded Perplexity query and returns the answer text plus citation
 * URLs. Claude then synthesises the retrieved dossier into each agent's
 * existing JSON contract (see callResearchJson in runner.ts).
 *
 * Failure policy: a missing/broken connection FAILS LOUDLY with a typed
 * PerplexityConnectionError — never a silent fallback. The runner's failRun
 * persists the message onto the agent-run row so the UI shows why.
 *
 * Testing: when ATELIER_PERPLEXITY_BASE_URL is set (stub server, mirroring
 * the stub-Anthropic probe pattern), requests go straight to that base URL
 * with plain fetch — no connector involved, fully offline.
 */

export class PerplexityConnectionError extends Error {
  constructor(detail: string) {
    super(`Perplexity research is unavailable: ${detail}`);
    this.name = "PerplexityConnectionError";
  }
}

export interface PerplexityCitation {
  url: string;
  title?: string;
}

export interface PerplexityQueryResult {
  query: string;
  answer: string;
  citations: PerplexityCitation[];
}

const DEFAULT_MODEL = () => process.env.ATELIER_PERPLEXITY_MODEL ?? "sonar-pro";

type ChatCompletionShape = {
  choices?: Array<{ message?: { content?: unknown } }>;
  citations?: unknown;
  search_results?: unknown;
};

function parseCitations(json: ChatCompletionShape): PerplexityCitation[] {
  const out: PerplexityCitation[] = [];
  const seen = new Set<string>();
  const push = (url: unknown, title?: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
    });
  };
  if (Array.isArray(json.search_results)) {
    for (const r of json.search_results as Array<{ url?: unknown; title?: unknown }>) {
      push(r?.url, r?.title);
    }
  }
  if (Array.isArray(json.citations)) {
    for (const c of json.citations as unknown[]) push(c);
  }
  return out;
}

/**
 * One web-grounded Perplexity query → { answer, citations }.
 * Throws PerplexityConnectionError on any transport/connection/API failure.
 */
export async function perplexitySearch(
  query: string,
  opts?: {
    model?: string;
    /** Restrict retrieval to recent sources (press monitoring etc.). */
    searchRecencyFilter?: "day" | "week" | "month" | "year";
  },
): Promise<PerplexityQueryResult> {
  const body = {
    model: opts?.model ?? DEFAULT_MODEL(),
    messages: [
      {
        role: "system",
        content:
          "You are a factual web-research assistant. Answer with dense, specific, sourced facts (names, titles, figures, dates). Prefer primary/official sources.",
      },
      { role: "user", content: query },
    ],
    ...(opts?.searchRecencyFilter
      ? { search_recency_filter: opts.searchRecencyFilter }
      : {}),
  };

  let res: Response;
  try {
    const stubBase = process.env.ATELIER_PERPLEXITY_BASE_URL;
    if (stubBase) {
      // Test stub path — offline probes point this at a local stub server.
      res = await fetch(`${stubBase.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      // Replit Perplexity connector — the SDK proxies to the Perplexity API
      // and injects the API key. Never cache the client (tokens rotate).
      const { ReplitConnectors } = await import("@replit/connectors-sdk");
      const connectors = new ReplitConnectors();
      res = (await connectors.proxy("perplexity", "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })) as Response;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PerplexityConnectionError(
      `connection failed (${msg}). Check the Replit Perplexity connector is set up and authorized.`,
    );
  }
  if (!res.ok) {
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new PerplexityConnectionError(
      `API returned HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
    );
  }
  let json: ChatCompletionShape;
  try {
    json = (await res.json()) as ChatCompletionShape;
  } catch {
    throw new PerplexityConnectionError("API returned a non-JSON response body");
  }
  const content = json.choices?.[0]?.message?.content;
  const answer = typeof content === "string" ? content.trim() : "";
  if (!answer) {
    throw new PerplexityConnectionError(
      "API response contained no answer text (unexpected response shape)",
    );
  }
  return { query, answer, citations: parseCitations(json) };
}

export interface PerplexityDossier {
  /** Markdown research dossier fed to Claude for synthesis. */
  dossier: string;
  /** Deduped citation URLs across all queries. */
  citations: PerplexityCitation[];
  queryCount: number;
}

/**
 * Run the agent's retrieval queries sequentially and assemble a citation-
 * annotated dossier. `onPhase` receives progress breadcrumbs for the run row
 * / chat transcript. Any query failure propagates (fail loud, no fallback).
 */
export async function perplexityResearch(args: {
  queries: string[];
  searchRecencyFilter?: "day" | "week" | "month" | "year";
  onPhase?: (pct: number, message: string, data?: Record<string, unknown>) => void;
}): Promise<PerplexityDossier> {
  const queries = args.queries.map((q) => q.trim()).filter(Boolean).slice(0, 8);
  if (queries.length === 0) {
    throw new PerplexityConnectionError("no research queries were provided");
  }
  const sections: string[] = [];
  const citations: PerplexityCitation[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < queries.length; i++) {
    args.onPhase?.(
      15 + Math.round((i / queries.length) * 40),
      `Searching the web (${i + 1}/${queries.length})`,
    );
    const r = await perplexitySearch(queries[i], {
      searchRecencyFilter: args.searchRecencyFilter,
    });
    for (const c of r.citations) {
      if (!seen.has(c.url)) {
        seen.add(c.url);
        citations.push(c);
      }
    }
    const sources =
      r.citations.length > 0
        ? r.citations
            .map((c, j) => `  [${j + 1}] ${c.title ? `${c.title} — ` : ""}${c.url}`)
            .join("\n")
        : "  (no sources returned)";
    sections.push(
      `### Research query ${i + 1}: ${r.query}\n${r.answer}\n\nSources:\n${sources}`,
    );
    args.onPhase?.(
      15 + Math.round(((i + 1) / queries.length) * 40),
      `Read ${citations.length} source${citations.length === 1 ? "" : "s"}`,
      { sources: citations.slice(0, 40) },
    );
  }
  return { dossier: sections.join("\n\n"), citations, queryCount: queries.length };
}
