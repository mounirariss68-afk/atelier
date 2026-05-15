/**
 * Atelier Chat retriever — embedding helper.
 *
 * IMPORTANT: this module does NOT call any LLM. It produces a fixed-
 * dimension numeric vector that the capability retriever uses to rank
 * tools by cosine similarity before handing the surfaced set to
 * Claude Sonnet. The actual reasoning + enrichment for every chat turn
 * is done by Sonnet via the Anthropic SDK (see modelStep / runAgent).
 *
 * Previously this used OpenAI `text-embedding-3-small`, but the
 * Replit AI Integrations OpenAI proxy does not expose `/embeddings`
 * (returns INVALID_ENDPOINT) and we don't want to require a separate
 * third-party key just for tool ranking. So we compute a deterministic
 * hashed-bigram vector locally — same dimension contract, fully
 * offline, no provider call, no silent fallback. Tool rankings are
 * stable across runs (same input → same vector).
 */

const PROVIDER_ID = "local:hashed-bigram";
const DIM = 1536;

export interface EmbeddingResult {
  vec: number[];
  provider: string;
  dim: number;
}

/** Stable provider id (used as cache key on `atelier_capability_embeddings`). */
export function currentProvider(): string {
  return PROVIDER_ID;
}

/** Embed a single text. Pure function — no I/O. */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const trimmed = (text ?? "").slice(0, 8_000).trim().toLowerCase();
  if (!trimmed) {
    return { vec: new Array<number>(DIM).fill(0), provider: PROVIDER_ID, dim: DIM };
  }
  return { vec: hashedBigramVector(trimmed), provider: PROVIDER_ID, dim: DIM };
}

/** Batched embed. Sequential to match the previous contract. */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  const out: EmbeddingResult[] = [];
  for (const t of texts) out.push(await embedText(t));
  return out;
}

/**
 * Deterministic hashed-bigram vector. Tokenize on whitespace, take all
 * unigrams + adjacent-pair bigrams, FNV-1a hash each token into a
 * bucket, then L2-normalize so cosine works as a cheap relevance signal.
 */
function hashedBigramVector(text: string): number[] {
  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const vec = new Array<number>(DIM).fill(0);
  const bump = (term: string, weight: number): void => {
    const h = fnv1a(term) % DIM;
    vec[h] += weight;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    bump(tokens[i], 1);
    if (i + 1 < tokens.length) bump(`${tokens[i]} ${tokens[i + 1]}`, 1.5);
  }
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIM; i += 1) vec[i] /= norm;
  }
  return vec;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
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
