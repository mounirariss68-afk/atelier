/**
 * Perplexity web-research client (direct API only).
 *
 * Retrieval layer for the web-research agents: each call performs one
 * web-grounded Perplexity query and returns the answer text plus citation
 * URLs. Claude then synthesises the retrieved dossier into each agent's
 * existing JSON contract (see callResearchJson in runner.ts).
 *
 * Transport has exactly two branches:
 *   1. ATELIER_PERPLEXITY_BASE_URL set → offline test stub (probe pattern).
 *   2. Otherwise → direct https://api.perplexity.ai with the
 *      PERPLEXITY_API_KEY secret as bearer auth. (The former Replit
 *      Perplexity connector proxy was removed — it 404'd platform-side.)
 *
 * Failure policy: a missing key or broken endpoint FAILS LOUDLY with a
 * typed PerplexityConnectionError — never a silent fallback. The runner's
 * failRun persists the message onto the agent-run row so the UI shows why.
 *
 * Resilience: every query is bounded by an env-tunable per-query timeout
 * (ATELIER_PERPLEXITY_TIMEOUT_MS, default 60s) so a hung call can never
 * orphan an agent run, and a 429/5xx response gets exactly one short-backoff
 * retry before failing loud.
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
  /** ISO-ish publication date when the search result carried one (Task #1022). */
  date?: string;
  /** Short source snippet when the search result carried one (Task #1022). */
  snippet?: string;
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
  const push = (url: unknown, title?: unknown, date?: unknown, snippet?: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
      date: typeof date === "string" && date.trim() ? date.trim() : undefined,
      snippet:
        typeof snippet === "string" && snippet.trim()
          ? snippet.trim().slice(0, 400)
          : undefined,
    });
  };
  if (Array.isArray(json.search_results)) {
    for (const r of json.search_results as Array<{
      url?: unknown;
      title?: unknown;
      date?: unknown;
      last_updated?: unknown;
      snippet?: unknown;
    }>) {
      push(r?.url, r?.title, r?.date ?? r?.last_updated, r?.snippet);
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
    /**
     * Task #771 — ISO date "YYYY-MM-DD" injected into the system prompt so
     * Perplexity knows today's date and can prioritise recent sources.
     * Falls back to ATELIER_PERPLEXITY_TODAY env var (useful for stubs), then
     * new Date().toISOString().slice(0, 10) at call time.
     */
    today?: string;
    /**
     * Task #1022 — restrict retrieval to specific domains (Perplexity
     * `search_domain_filter`; max 10 entries, "-domain" excludes).
     */
    searchDomainFilter?: string[];
  },
): Promise<PerplexityQueryResult> {
  const todayStr =
    opts?.today ??
    process.env.ATELIER_PERPLEXITY_TODAY ??
    new Date().toISOString().slice(0, 10);
  const body = {
    model: opts?.model ?? DEFAULT_MODEL(),
    messages: [
      {
        role: "system",
        content:
          `You are a factual web-research assistant. Today is ${todayStr}. ` +
          `Answer with dense, specific, sourced facts — names, titles, figures, and exact dates. ` +
          `State the date of each event or announcement where known. ` +
          `Prioritise the most recent information; prefer sources from ${todayStr.slice(0, 4)} ` +
          `and the preceding 12 months. Prefer primary and official sources.`,
      },
      { role: "user", content: query },
    ],
    ...(opts?.searchRecencyFilter
      ? { search_recency_filter: opts.searchRecencyFilter }
      : {}),
    ...(opts?.searchDomainFilter && opts.searchDomainFilter.length > 0
      ? { search_domain_filter: opts.searchDomainFilter.slice(0, 10) }
      : {}),
  };

  const payload = JSON.stringify(body);
  const stubBase = process.env.ATELIER_PERPLEXITY_BASE_URL;
  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (stubBase) {
    // Test stub path — offline probes point this at a local stub server.
    url = `${stubBase.replace(/\/$/, "")}/chat/completions`;
  } else {
    const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
    if (!apiKey) {
      throw new PerplexityConnectionError(
        "the PERPLEXITY_API_KEY secret is missing or blank. " +
          "Set the PERPLEXITY_API_KEY secret (a Perplexity API key) in this environment to enable web research.",
      );
    }
    url = "https://api.perplexity.ai/chat/completions";
    headers.authorization = `Bearer ${apiKey}`;
  }

  const timeoutMs = Math.max(
    1_000,
    Number(process.env.ATELIER_PERPLEXITY_TIMEOUT_MS ?? 60_000) || 60_000,
  );
  const retryBackoffMs = Math.max(
    0,
    Number(process.env.ATELIER_PERPLEXITY_RETRY_BACKOFF_MS ?? 2_000) || 0,
  );

  const attempt = async (): Promise<Response> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        throw new PerplexityConnectionError(
          `query timed out after ${timeoutMs}ms (tune via ATELIER_PERPLEXITY_TIMEOUT_MS).`,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new PerplexityConnectionError(`connection failed (${msg}).`);
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await attempt();
  if (res.status === 429 || res.status >= 500) {
    // Exactly one short-backoff retry on rate-limit / server errors; a
    // second failure propagates loudly below.
    await new Promise((r) => setTimeout(r, retryBackoffMs));
    res = await attempt();
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
 *
 * Task #771 additions:
 *  - `today` is injected into each Perplexity system prompt.
 *  - `recencyQueries` runs with search_recency_filter:"month" regardless of
 *    the global filter — used for focused recent-news queries.
 *  - `entityLabel` triggers an automatic supplemental recency query
 *    ("Latest news, announcements and milestones for <entity> as of <today>")
 *    generated in this shared layer so ALL callers benefit without per-agent
 *    changes. The auto-supplement only fires when capacity remains under the
 *    8-query cap and no caller-supplied recencyQueries already cover it.
 *  - Combined base + recency + auto-supplement is capped at 8; excess recency
 *    queries are silently dropped with a dev-mode warning.
 */
export async function perplexityResearch(args: {
  queries: string[];
  /** Run with search_recency_filter:"month" — focused recent-event queries. */
  recencyQueries?: string[];
  /**
   * Entity name (account/firm) used to auto-generate a shared supplemental
   * recency query in this layer so every caller gets at least one
   * month-filtered recent-news pass.
   */
  entityLabel?: string;
  searchRecencyFilter?: "day" | "week" | "month" | "year";
  /** ISO date "YYYY-MM-DD" passed to each perplexitySearch call. */
  today?: string;
  /**
   * Task #1022 — per-call query cap override (default 8, clamped 1–16).
   * POV deep research runs targeted per-angle queries and needs headroom
   * beyond the Scout's default.
   */
  maxQueries?: number;
  /** Task #1022 — restrict retrieval to specific domains (all queries). */
  searchDomainFilter?: string[];
  onPhase?: (pct: number, message: string, data?: Record<string, unknown>) => void;
}): Promise<PerplexityDossier> {
  const todayStr =
    args.today ??
    process.env.ATELIER_PERPLEXITY_TODAY ??
    new Date().toISOString().slice(0, 10);

  const baseQueries = args.queries.map((q) => q.trim()).filter(Boolean);
  if (baseQueries.length === 0) {
    throw new PerplexityConnectionError("no research queries were provided");
  }

  // Build the recency batch: caller-supplied recencyQueries + the shared
  // auto-supplement (if entityLabel provided and capacity allows).
  const callerRecency = (args.recencyQueries ?? []).map((q) => q.trim()).filter(Boolean);
  const autoSupplements: string[] = args.entityLabel
    ? [
        `Latest news, announcements and milestones for ${args.entityLabel} as of ${todayStr}`,
      ]
    : [];

  const cap = Math.max(1, Math.min(16, Math.round(args.maxQueries ?? 8)));
  const baseSliced = baseQueries.slice(0, cap);
  const remaining = Math.max(0, cap - baseSliced.length);
  const allRecency = [...callerRecency, ...autoSupplements];
  const recencySliced = allRecency.slice(0, remaining);

  if (allRecency.length > remaining && process.env.NODE_ENV !== "production") {
    console.warn(
      `[perplexityResearch] ${allRecency.length - remaining} recency ` +
        `query/queries truncated (${cap}-query cap reached after ${baseSliced.length} base queries).`,
    );
  }

  // Run everything sequentially; progress pct covers base + recency together.
  const allQueries: Array<{ q: string; recency: boolean }> = [
    ...baseSliced.map((q) => ({ q, recency: false })),
    ...recencySliced.map((q) => ({ q, recency: true })),
  ];
  const total = allQueries.length;

  const sections: string[] = [];
  const citations: PerplexityCitation[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < total; i++) {
    const { q, recency } = allQueries[i];
    args.onPhase?.(
      15 + Math.round((i / total) * 40),
      `Searching the web (${i + 1}/${total})`,
    );
    const r = await perplexitySearch(q, {
      searchRecencyFilter: recency ? "month" : args.searchRecencyFilter,
      today: todayStr,
      searchDomainFilter: args.searchDomainFilter,
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
            .map(
              (c, j) =>
                `  [${j + 1}] ${c.title ? `${c.title} — ` : ""}${c.url}${c.date ? ` (published ${c.date})` : ""}${c.snippet ? `\n      » ${c.snippet.slice(0, 200)}` : ""}`,
            )
            .join("\n")
        : "  (no sources returned)";
    sections.push(
      `### Research query ${i + 1}${recency ? " [recency-filtered]" : ""}: ${r.query}\n${r.answer}\n\nSources:\n${sources}`,
    );
    args.onPhase?.(
      15 + Math.round(((i + 1) / total) * 40),
      `Read ${citations.length} source${citations.length === 1 ? "" : "s"}`,
      { sources: citations.slice(0, 40) },
    );
  }
  return { dossier: sections.join("\n\n"), citations, queryCount: total };
}
