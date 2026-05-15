/**
 * Task #411 — Embedding helper for the Atelier Chat RAG.
 *
 * OpenAI `text-embedding-3-small` (1536-dim). The orchestrator uses
 * cosine similarity over these vectors to rank the capability catalog
 * and entity neighbourhood for each turn. We hard-fail when the API key
 * is missing instead of silently degrading to a hashed-bigram fallback —
 * the previous fallback shipped wrong rankings under the rug, which is
 * exactly the kind of silent-mock behaviour Atelier is purging.
 */

const OPENAI_MODEL = "text-embedding-3-small";
const OPENAI_DIM = 1536;

export interface EmbeddingResult {
  vec: number[];
  provider: string;
  dim: number;
}

function openaiKey(): string {
  const key =
    process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "[atelier-cli/embeddings] OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) must be set. The retriever requires real embeddings; there is no fallback.",
    );
  }
  return key;
}

/** Provider id surfaced in the embedding rows. Stable for cache invalidation. */
export function currentProvider(): string {
  return `openai:${OPENAI_MODEL}`;
}

/** Embed a single text. Throws on failure — no silent fallback. */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const trimmed = (text ?? "").slice(0, 8_000).trim();
  if (!trimmed) {
    // Empty input → zero vector, but still tagged with the real provider.
    return { vec: new Array<number>(OPENAI_DIM).fill(0), provider: `openai:${OPENAI_MODEL}`, dim: OPENAI_DIM };
  }
  return embedOpenAI(trimmed, openaiKey());
}

/** Batched embed. Sequential to avoid hammering the proxy. */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  const out: EmbeddingResult[] = [];
  for (const t of texts) out.push(await embedText(t));
  return out;
}

async function embedOpenAI(text: string, key: string): Promise<EmbeddingResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input: text }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`openai embed ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { data: Array<{ embedding: number[] }> };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== OPENAI_DIM) {
      throw new Error("malformed openai embedding response");
    }
    return { vec, provider: `openai:${OPENAI_MODEL}`, dim: OPENAI_DIM };
  } finally {
    clearTimeout(timer);
  }
}

/** Cosine similarity. Both vectors must be the same length. */
export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
