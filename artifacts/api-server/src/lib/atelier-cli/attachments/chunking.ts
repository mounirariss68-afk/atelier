/**
 * Task #334 — Deterministic chunking + digest.
 *
 * Splits the normalised text into stable, model-friendly windows
 * keyed by an immutable `chunkId`. The id is a function of the
 * attachment id + the chunk's character window only, so the
 * `fetch_document_chunk` tool sees stable ids across reads.
 *
 * Strategy: paragraph-aware ~1500-char windows with a 100-char
 * overlap. The summary is the first sentence of the chunk (or the
 * first 120 chars if no terminal punctuation). The digest TOC is
 * `# Document — N chunks` plus one line per chunk summary.
 */

const TARGET = 1500;
const OVERLAP = 100;
const MAX_CHUNKS = 64;

export interface DocChunk {
  chunkId: string;
  charStart: number;
  charEnd: number;
  summary: string;
  text: string;
}

export interface DocDigest {
  toc: string;
  chunkSummaries: Array<{ chunkId: string; summary: string }>;
}

function summarise(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "(empty)";
  // First sentence terminator wins; otherwise hard-cap at 120 chars.
  const m = trimmed.match(/^([^\n.!?]{8,200}[.!?])/);
  if (m) return m[1].trim();
  return trimmed.slice(0, 120).replace(/\s+\S*$/, "") + (trimmed.length > 120 ? "…" : "");
}

export function chunkDocument(args: {
  attachmentId: string;
  text: string;
}): { chunks: DocChunk[]; digest: DocDigest } {
  const text = args.text ?? "";
  if (text.length === 0) {
    return {
      chunks: [],
      digest: { toc: `# ${args.attachmentId} — 0 chunks (empty document)`, chunkSummaries: [] },
    };
  }
  const chunks: DocChunk[] = [];
  let cursor = 0;
  let idx = 0;
  while (cursor < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(cursor + TARGET, text.length);
    // Prefer a paragraph break within the last 300 chars of the window
    // so summaries land on real sentence boundaries.
    if (end < text.length) {
      const slice = text.slice(cursor, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (lastBreak > TARGET - 300) end = cursor + lastBreak + 1;
    }
    const slice = text.slice(cursor, end);
    const chunkId = `${args.attachmentId}#c${String(idx).padStart(3, "0")}`;
    chunks.push({
      chunkId,
      charStart: cursor,
      charEnd: end,
      summary: summarise(slice),
      text: slice,
    });
    if (end >= text.length) break;
    cursor = Math.max(end - OVERLAP, cursor + 1);
    idx++;
  }
  const digest: DocDigest = {
    toc: [
      `# ${args.attachmentId}`,
      `chunks: ${chunks.length}  chars: ${text.length}`,
      ...chunks.map((c) => `- ${c.chunkId} [${c.charStart}..${c.charEnd}] ${c.summary}`),
    ].join("\n"),
    chunkSummaries: chunks.map((c) => ({ chunkId: c.chunkId, summary: c.summary })),
  };
  return { chunks, digest };
}

/** Look up a chunk by its full id (`<attachmentId>#cNNN`). */
export function findChunkById(chunks: DocChunk[], chunkId: string): DocChunk | null {
  return chunks.find((c) => c.chunkId === chunkId) ?? null;
}
