/**
 * Atelier CLI — local embedding model.
 *
 * IMPORTANT: this module does NOT call any LLM and makes NO network
 * calls. It runs a vendored, version-pinned sentence-transformer
 * (`Xenova/all-MiniLM-L6-v2`, 384-dim, int8-quantised ONNX) entirely
 * offline via `@huggingface/transformers` + onnxruntime-node. Weights
 * live under `artifacts/api-server/vendor/transformers-models/` and are
 * loaded with `allowRemoteModels = false`, so a boot never reaches out
 * to the Hugging Face hub.
 *
 * Generation/reasoning for every chat turn stays on Claude (see
 * modelStep / runTurn). This module only produces vectors used for:
 *   - capability (tool) ranking          [capability-retriever.ts]
 *   - entity ANN resolution              [entity-resolver.ts]
 *   - document-chunk semantic retrieval  [attachments/retrieval.ts]
 *
 * Failure to load the model throws — there is no silent fallback to a
 * hashed-bigram or zero vector, because a degraded embedding space
 * silently poisons retrieval quality.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  env as hfEnv,
  pipeline,
  type FeatureExtractionPipeline,
  AutoTokenizer,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";

/** Model id (also the on-disk vendor sub-path). */
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
/** Quantisation — must match the vendored onnx file (model_quantized.onnx). */
const DTYPE = "q8" as const;
/** Stable provider id; used as the cache key / invalidation token on
 * every embedding table. Bumping the model or dim MUST change this. */
export const EMBED_PROVIDER = `local:all-MiniLM-L6-v2`;
/** Output dimensionality of the model. */
export const EMBED_DIM = 384;
/** Model context window (tokens). Chunks must stay at/under this so the
 * embedder never silently truncates meaningful text. */
export const MODEL_MAX_TOKENS = 256;

export interface EmbeddingResult {
  vec: number[];
  provider: string;
  dim: number;
}

/**
 * Locate the vendored model directory by walking up from this module.
 * Works from TS source (`src/lib/atelier-cli`) and the bundled dist
 * build, mirroring rag-bootstrap's SQL resolution strategy.
 */
function resolveVendorCacheDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const probe = join("vendor", "transformers-models", ...MODEL_ID.split("/"), "config.json");
  let cursor = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(cursor, "vendor", "transformers-models");
    if (existsSync(join(cursor, probe))) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (process.env.ATELIER_REPO_ROOT) {
    const root = join(process.env.ATELIER_REPO_ROOT, "artifacts", "api-server", "vendor", "transformers-models");
    if (existsSync(join(root, ...MODEL_ID.split("/"), "config.json"))) return root;
  }
  throw new Error(
    `Vendored embedding model not found near ${here}. Expected ` +
      `vendor/transformers-models/${MODEL_ID}/config.json`,
  );
}

let configured = false;
function configureOffline(): void {
  if (configured) return;
  hfEnv.allowRemoteModels = false;
  hfEnv.allowLocalModels = true;
  hfEnv.cacheDir = resolveVendorCacheDir();
  // No browser cache; node-only.
  if (hfEnv.backends?.onnx?.wasm) {
    hfEnv.backends.onnx.wasm.numThreads = 1;
  }
  configured = true;
}

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;
let tokenizerPromise: Promise<PreTrainedTokenizer> | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    configureOffline();
    embedderPromise = pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE }).catch(
      (err) => {
        embedderPromise = null; // allow retry on next call
        throw new Error(
          `Failed to load local embedding model ${MODEL_ID}: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  }
  return embedderPromise;
}

async function getTokenizer(): Promise<PreTrainedTokenizer> {
  if (!tokenizerPromise) {
    configureOffline();
    tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID).catch((err) => {
      tokenizerPromise = null;
      throw new Error(
        `Failed to load tokenizer for ${MODEL_ID}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
  return tokenizerPromise;
}

/** Pre-load the model + tokenizer (used at boot to avoid first-request latency). */
export async function warmEmbedder(): Promise<void> {
  await Promise.all([getEmbedder(), getTokenizer()]);
}

/** Stable provider id (cache key on every embedding table). */
export function currentProvider(): string {
  return EMBED_PROVIDER;
}

/**
 * Count model tokens for a piece of text. Used by token-aware chunking
 * so no chunk exceeds the model context window.
 */
export async function countTokens(text: string): Promise<number> {
  const t = (text ?? "").trim();
  if (!t) return 0;
  const tok = await getTokenizer();
  const ids = tok.encode(t);
  return ids.length;
}

const ZERO = (): number[] => new Array<number>(EMBED_DIM).fill(0);

/** Embed a single text. Empty input → zero vector (never throws on empty). */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const t = (text ?? "").trim();
  if (!t) return { vec: ZERO(), provider: EMBED_PROVIDER, dim: EMBED_DIM };
  const [only] = await embedTexts([t]);
  return only;
}

const BATCH = 32;

/**
 * Batched embed. Runs the model over sub-batches of `BATCH` to bound
 * peak memory. Empty strings map to zero vectors so positions are kept
 * 1:1 with the input array.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  const out: EmbeddingResult[] = new Array(texts.length);

  // Pre-fill empties, gather the non-empty payload + original positions.
  const payload: string[] = [];
  const positions: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const t = (texts[i] ?? "").trim();
    if (!t) {
      out[i] = { vec: ZERO(), provider: EMBED_PROVIDER, dim: EMBED_DIM };
    } else {
      payload.push(t);
      positions.push(i);
    }
  }
  if (payload.length === 0) return out;

  const extractor = await getEmbedder();
  for (let start = 0; start < payload.length; start += BATCH) {
    const slice = payload.slice(start, start + BATCH);
    const tensor = await extractor(slice, { pooling: "mean", normalize: true });
    const dims = tensor.dims as number[];
    const rowLen = dims[dims.length - 1];
    const data = tensor.data as Float32Array | number[];
    for (let r = 0; r < slice.length; r++) {
      const offset = r * rowLen;
      const vec = Array.from(data.slice(offset, offset + rowLen) as ArrayLike<number>);
      out[positions[start + r]] = { vec, provider: EMBED_PROVIDER, dim: EMBED_DIM };
    }
  }
  return out;
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
