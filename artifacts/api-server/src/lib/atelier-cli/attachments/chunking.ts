/**
 * Task #575 — Token-aware chunking + digest.
 *
 * Splits normalised text into stable, model-friendly windows keyed by an
 * immutable `chunkId` (`<attachmentId>#cNNN`). Windows are sized by
 * *tokens* (measured with the embedding model's own tokenizer) rather
 * than characters, so a chunk never exceeds the model context window and
 * the embedder never silently truncates content. There is no fixed
 * chunk cap — long documents produce as many chunks as needed.
 *
 * Strategy: segment the text into paragraphs → sentences → word groups
 * (each carrying char offsets), then greedily pack segments up to
 * TARGET_TOKENS with a TARGET-relative OVERLAP_TOKENS carry-over so
 * adjacent chunks share context. `chunkDocument` is async because token
 * counting loads the vendored tokenizer.
 */

import { countTokens, MODEL_MAX_TOKENS } from "../embeddings.js";

const TARGET_TOKENS = 220; // headroom under MODEL_MAX_TOKENS (256)
const OVERLAP_TOKENS = 30;

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

interface Segment {
  text: string;
  start: number;
  end: number;
  tokens: number;
}

function summarise(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "(empty)";
  const m = trimmed.match(/^([^\n.!?]{8,200}[.!?])/);
  if (m) return m[1].trim();
  return trimmed.slice(0, 120).replace(/\s+\S*$/, "") + (trimmed.length > 120 ? "…" : "");
}

/** Split a region [start,end) of `text` into pieces on a regex, keeping
 * char offsets. Empty/whitespace-only pieces are dropped. */
function splitWithOffsets(
  text: string,
  start: number,
  end: number,
  re: RegExp,
): Array<{ text: string; start: number; end: number }> {
  const region = text.slice(start, end);
  const out: Array<{ text: string; start: number; end: number }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = r.exec(region)) !== null) {
    const piece = region.slice(last, m.index);
    if (piece.trim().length > 0) out.push({ text: piece, start: start + last, end: start + m.index });
    last = m.index + m[0].length;
    if (m[0].length === 0) r.lastIndex++; // guard zero-width
  }
  const tail = region.slice(last);
  if (tail.trim().length > 0) out.push({ text: tail, start: start + last, end });
  return out;
}

/**
 * Build leaf segments small enough to pack. Paragraphs → sentences →
 * word groups, recursing only when a piece exceeds TARGET_TOKENS.
 */
async function buildSegments(text: string): Promise<Segment[]> {
  const paras = splitWithOffsets(text, 0, text.length, /\n{2,}/);
  const segments: Segment[] = [];
  for (const para of paras) {
    const tk = await countTokens(para.text);
    if (tk <= TARGET_TOKENS) {
      segments.push({ ...para, tokens: tk });
      continue;
    }
    const sentences = splitWithOffsets(text, para.start, para.end, /(?<=[.!?])\s+/);
    for (const sent of sentences) {
      const stk = await countTokens(sent.text);
      if (stk <= TARGET_TOKENS) {
        segments.push({ ...sent, tokens: stk });
        continue;
      }
      // Sentence still too big — split on whitespace into word groups.
      const words = splitWithOffsets(text, sent.start, sent.end, /\s+/);
      let acc: Array<{ text: string; start: number; end: number }> = [];
      const flush = async () => {
        if (acc.length === 0) return;
        const s = acc[0].start;
        const e = acc[acc.length - 1].end;
        segments.push({ text: text.slice(s, e), start: s, end: e, tokens: await countTokens(text.slice(s, e)) });
        acc = [];
      };
      for (const w of words) {
        acc.push(w);
        const cur = text.slice(acc[0].start, acc[acc.length - 1].end);
        if ((await countTokens(cur)) >= TARGET_TOKENS) await flush();
      }
      await flush();
    }
  }
  return segments;
}

export async function chunkDocument(args: {
  attachmentId: string;
  text: string;
}): Promise<{ chunks: DocChunk[]; digest: DocDigest }> {
  const text = args.text ?? "";
  if (text.trim().length === 0) {
    return {
      chunks: [],
      digest: { toc: `# ${args.attachmentId} — 0 chunks (empty document)`, chunkSummaries: [] },
    };
  }

  const segments = await buildSegments(text);
  const chunks: DocChunk[] = [];
  let idx = 0;
  let current: Segment[] = [];
  let currentTokens = 0;

  const finalize = (): void => {
    if (current.length === 0) return;
    const charStart = current[0].start;
    const charEnd = current[current.length - 1].end;
    const body = text.slice(charStart, charEnd);
    chunks.push({
      chunkId: `${args.attachmentId}#c${String(idx).padStart(3, "0")}`,
      charStart,
      charEnd,
      summary: summarise(body),
      text: body,
    });
    idx++;
  };

  for (const seg of segments) {
    if (currentTokens + seg.tokens > TARGET_TOKENS && current.length > 0) {
      finalize();
      // Seed the next chunk with trailing segments for overlap. Always
      // carry at least the last segment so consecutive chunks overlap
      // (paragraph gaps would otherwise leave a hole between charEnd and
      // the next charStart, breaking the overlap invariant).
      const carry: Segment[] = [];
      let carryTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (carry.length > 0 && carryTokens + current[i].tokens > OVERLAP_TOKENS) break;
        carry.unshift(current[i]);
        carryTokens += current[i].tokens;
      }
      current = carry;
      currentTokens = carryTokens;
    }
    current.push(seg);
    currentTokens += seg.tokens;
  }
  finalize();

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
