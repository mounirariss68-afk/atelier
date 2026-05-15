/**
 * Task #411 — Embedding helper for the Atelier Chat RAG.
 *
 * Single switchable surface so the rest of the orchestrator never
 * cares which provider is on. Today we support:
 *
 *   - OpenAI `text-embedding-3-small` (1536-dim) when an API key is
 *     present in env (`OPENAI_API_KEY` or `AI_INTEGRATIONS_OPENAI_API_KEY`).
 *     The integrations proxy listed in the openai skill doesn't
 *     currently advertise embeddings; if it gains support, this helper
 *     picks it up automatically by routing through the same env var.
 *   - A deterministic "hashbow-768" fallback (768-dim hashed-bigram
 *     bag). Cheap, no network, good enough for short capability
 *     descriptions and entity labels — we use cosine similarity, and
 *     hashbow gives us coherent retrieval ordering on the inputs the
 *     orchestrator actually faces.
 *
 * The fallback exists so MOCK_MODE tests, fresh dev environments and
 * ANY upstream embedding outage never break the orchestrator: the
 * worst case is degraded ranking, not a missing tool list.
 */

import { createHash } from "node:crypto";

export interface EmbeddingResult {
  vec: number[];
  provider: string;
  dim: number;
}

const OPENAI_MODEL = "text-embedding-3-small";
const OPENAI_DIM = 1536;
const FALLBACK_DIM = 768;

/** Provider id surfaced in the embedding rows. Stable for cache invalidation. */
export function currentProvider(): string {
  return openaiKey() ? `openai:${OPENAI_MODEL}` : `fallback:hashbow-${FALLBACK_DIM}`;
}

function openaiKey(): string | null {
  return (
    process.env.OPENAI_API_KEY ??
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
    null
  );
}

/** Embed a single text. Always resolves — never throws. */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const trimmed = (text ?? "").slice(0, 8_000).trim();
  if (!trimmed) return { vec: zeroVec(FALLBACK_DIM), provider: `fallback:hashbow-${FALLBACK_DIM}`, dim: FALLBACK_DIM };
  const key = openaiKey();
  if (key) {
    try {
      return await embedOpenAI(trimmed, key);
    } catch {
      // Network / quota issue — degrade to fallback rather than break the turn.
    }
  }
  return embedFallback(trimmed);
}

/** Batched embed. Same fallback semantics. */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  // Sequential is fine — we only call this at boot for the catalog
  // and on entity write (one-at-a-time). Avoids hammering the proxy.
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
    if (!resp.ok) throw new Error(`openai embed ${resp.status}`);
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

/**
 * Deterministic hashed-bigram bag-of-words → unit vector. Coherent
 * cosine similarity for short inputs (capability descriptions, entity
 * names + secondary fields). Tokenisation is intentionally simple:
 *   - lowercase, ascii-only
 *   - whitespace + punctuation as separators
 *   - unigrams + bigrams hashed into FALLBACK_DIM buckets
 *   - L2-normalised
 */
export function embedFallback(text: string): EmbeddingResult {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const vec = new Array<number>(FALLBACK_DIM).fill(0);
  const bump = (key: string, w: number) => {
    const h = createHash("sha1").update(key).digest();
    const idx = (h.readUInt32BE(0) % FALLBACK_DIM + FALLBACK_DIM) % FALLBACK_DIM;
    vec[idx] += w;
  };
  for (const t of tokens) bump(t, 1);
  for (let i = 0; i < tokens.length - 1; i += 1) bump(`${tokens[i]} ${tokens[i + 1]}`, 0.5);
  // L2 normalise so cosine reduces to a dot product.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  }
  return { vec, provider: `fallback:hashbow-${FALLBACK_DIM}`, dim: FALLBACK_DIM };
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

function zeroVec(dim: number): number[] {
  return new Array<number>(dim).fill(0);
}
