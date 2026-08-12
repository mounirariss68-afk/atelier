/**
 * Task #1022 — POV quality primitives (pure, no DB).
 *
 * Two concerns live here so they can be unit-tested deterministically:
 *
 * 1. FACT-POOL HYGIENE — near-duplicate detection across Scout/deep-research
 *    runs and staleness / low-confidence flags computed at read time. The
 *    fact rows themselves are never mutated; hygiene is a projection the
 *    review surfaces (Research tab, outline approval) render so partners
 *    approve evidence, not just statements.
 *
 * 2. DETERMINISTIC CITATION GATE — runs on the FINAL stylist HTML after the
 *    multi-pass draft chain. It parses every `<sup data-fact>` attribute and
 *    `[#factId]` marker itself, validates ids against the snapshotted,
 *    org-scoped fact set, computes coverage server-side (never trusting the
 *    model's self-report), sanitizes/repairs malformed citation markup, and
 *    reports per-section unsupported detail for actionable failures.
 *
 * The single enforced coverage threshold is POV_CITATION_COVERAGE_FLOOR.
 * The pov_author prompt states the same number — keep them in lockstep.
 */

// ── single source of truth for the coverage threshold ─────────────────────
export const POV_CITATION_COVERAGE_FLOOR = 0.8;

// A fact whose evidence was retrieved more than this many days ago is
// flagged stale during promotion review (it stays usable — partners decide).
export const FACT_STALE_DAYS = 180;

// ── fact hygiene ───────────────────────────────────────────────────────────

export interface FactHygieneFlags {
  stale: boolean;
  lowConfidence: boolean;
  unsourced: boolean;
  /** Task #1027 — set when a re-verify pass could not re-confirm the source. */
  sourceDead: boolean;
}

export function normalizeFactText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s%$.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeFactText(s).split(" ").filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Two statements are near-duplicates at ≥0.8 token Jaccard or exact normalized equality. */
export const FACT_DUPLICATE_JACCARD = 0.8;

/**
 * Detect near-duplicate facts across runs. Returns a map of duplicateId →
 * canonical id, where the canonical fact is the earliest one in the input
 * order (callers pass rows sorted oldest-first for stable canonicals, or
 * accept "first seen wins"). A promoted fact always wins canonical status
 * over an unpromoted one so review surfaces point at the copy in use.
 */
export function findNearDuplicateFacts(
  facts: Array<{ id: string; statement: string; promoted?: boolean }>,
): Map<string, string> {
  const dup = new Map<string, string>();
  const canonicals: Array<{ id: string; tokens: Set<string>; norm: string; promoted: boolean }> = [];
  for (const f of facts) {
    const norm = normalizeFactText(f.statement);
    const tokens = tokenSet(f.statement);
    let matched = false;
    for (const c of canonicals) {
      if (c.norm === norm || jaccard(c.tokens, tokens) >= FACT_DUPLICATE_JACCARD) {
        if (f.promoted && !c.promoted) {
          // Promoted copy becomes canonical; remap prior duplicates + the old canonical.
          for (const [k, v] of dup) if (v === c.id) dup.set(k, f.id);
          dup.set(c.id, f.id);
          c.id = f.id;
          c.promoted = true;
        } else {
          dup.set(f.id, c.id);
        }
        matched = true;
        break;
      }
    }
    if (!matched) canonicals.push({ id: f.id, tokens, norm, promoted: !!f.promoted });
  }
  return dup;
}

/** Staleness / confidence / sourcing flags for one fact, computed at read time. */
export function factHygieneFlags(
  f: {
    retrievedAt?: Date | string | null;
    createdAt: Date | string;
    confidence: string;
    sourceUrl?: string | null;
    sourceDeadAt?: Date | string | null;
  },
  now: Date = new Date(),
): FactHygieneFlags {
  const basis = f.retrievedAt ?? f.createdAt;
  const basisMs = basis instanceof Date ? basis.getTime() : new Date(basis).getTime();
  const ageDays = Number.isFinite(basisMs) ? (now.getTime() - basisMs) / 86_400_000 : 0;
  return {
    stale: ageDays > FACT_STALE_DAYS,
    lowConfidence: f.confidence !== "green",
    unsourced: !f.sourceUrl || !/^https?:\/\//i.test(f.sourceUrl),
    sourceDead: !!f.sourceDeadAt,
  };
}

// ── deterministic citation gate ────────────────────────────────────────────

export interface PovSectionForAudit {
  id: string;
  heading: string;
  body?: string;
  citationIds?: string[];
}

export interface PovSectionAudit {
  id: string;
  heading: string;
  validCitations: string[];
  invalidCitations: string[];
  supported: boolean;
}

export interface PovCitationAudit {
  /** Server-computed share of sections carrying ≥1 valid citation. */
  coverage: number;
  /** Final HTML with citation markup referencing unknown fact ids stripped. */
  sanitizedHtml: string;
  /** Sections likewise sanitized (bodies + citationIds filtered to valid ids). */
  sanitizedSections: Array<PovSectionForAudit & { citationIds: string[] }>;
  sections: PovSectionAudit[];
  /** Every fact id referenced anywhere that is NOT in the snapshot. */
  invalidFactIds: string[];
  unsupportedSections: Array<{ id: string; heading: string }>;
  passes: boolean;
}

const SUP_RE = /<sup\b[^>]*\bdata-fact\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>.*?<\/sup>/gis;
const MARKER_RE = /\[#\s*([A-Za-z0-9_\-]+)\s*\]/g;

function extractCitedIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(SUP_RE)) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    // Repair malformed multi-id attributes like data-fact="f1,f2" / "f1 f2".
    for (const id of raw.split(/[\s,;]+/).filter(Boolean)) ids.push(id);
  }
  for (const m of text.matchAll(MARKER_RE)) ids.push(m[1]);
  return ids;
}

function stripInvalidMarkup(text: string, valid: Set<string>): string {
  let out = text.replace(SUP_RE, (whole, d1, d2) => {
    const raw = ((d1 ?? d2 ?? "") as string).trim();
    const ids = raw.split(/[\s,;]+/).filter(Boolean);
    const kept = ids.filter((id) => valid.has(id));
    if (kept.length === 0) return "";
    if (kept.length === ids.length && kept.length === 1 && raw === kept[0]) return whole;
    // Repair: re-emit one well-formed sup per surviving id.
    return kept.map((id) => `<sup data-fact="${id}">${id.replace(/^f?_?/, "")}</sup>`).join("");
  });
  out = out.replace(MARKER_RE, (whole, id) => (valid.has(id) ? whole : ""));
  return out;
}

/** Decode the handful of HTML entities that commonly appear in headings. */
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function normalizeHeadingText(s: string): string {
  return decodeBasicEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Split the FINAL html into per-section segments by matching each section
 * heading against ACTUAL heading elements (<h1>–<h6>) in the document —
 * never a plain substring search, so a heading demoted to prose does not
 * count. Fail-closed `null` segment when:
 *  - no heading element carries the section's (normalized) text, or
 *  - more than one heading element carries it (duplicate → ambiguous), or
 *  - two sections resolve to the same heading element.
 * A section's segment runs from the end of its heading element to the start
 * of the next heading element claimed by another section (intra-section
 * subheads like <h3> do not cut a section short).
 */
function segmentFinalHtml(html: string, sections: PovSectionForAudit[]): Array<string | null> {
  const headingEls: Array<{ start: number; contentStart: number; text: string }> = [];
  // Contract: section headings in the final document are <h2> elements —
  // exactly. A section demoted to <h3> (or promoted to <h1>) is treated as
  // dropped and fails closed.
  for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2\s*>/gi)) {
    headingEls.push({
      start: m.index!,
      contentStart: m.index! + m[0].length,
      text: normalizeHeadingText(m[1] ?? ""),
    });
  }
  // Resolve each section to exactly one heading element.
  const resolved: Array<number | null> = sections.map((s) => {
    const want = normalizeHeadingText(s.heading ?? "");
    if (!want) return null;
    const hits = headingEls.map((h, i) => ({ h, i })).filter((x) => x.h.text === want);
    return hits.length === 1 ? hits[0].i : null; // missing or duplicated → fail-closed
  });
  // Two sections claiming the same element are both ambiguous.
  const claimCount = new Map<number, number>();
  for (const r of resolved) if (r != null) claimCount.set(r, (claimCount.get(r) ?? 0) + 1);
  const finalResolved = resolved.map((r) => (r != null && claimCount.get(r) === 1 ? r : null));
  const claimedStarts = finalResolved
    .filter((r): r is number => r != null)
    .map((r) => headingEls[r].start)
    .sort((a, b) => a - b);
  return finalResolved.map((r) => {
    if (r == null) return null;
    const from = headingEls[r].contentStart;
    const nextClaimed = claimedStarts.find((s) => s >= from);
    return html.slice(from, nextClaimed ?? html.length);
  });
}

/**
 * Audit the FINAL stylist output against the snapshotted fact set.
 * Coverage is computed here — the model's self-reported number is ignored —
 * and it is derived from citations present in the FINAL html, section by
 * section. If the stylist dropped the citations (or produced an unrelated
 * document), coverage collapses and the run fails, no matter how well the
 * first-pass sections were cited.
 */
export function auditPovCitations(args: {
  html: string;
  sections: PovSectionForAudit[];
  validFactIds: string[];
  floor?: number;
}): PovCitationAudit {
  const valid = new Set(args.validFactIds.filter(Boolean));
  const floor = args.floor ?? POV_CITATION_COVERAGE_FLOOR;
  const invalidSeen = new Set<string>();

  const htmlIds = extractCitedIds(args.html ?? "");
  for (const id of htmlIds) if (!valid.has(id)) invalidSeen.add(id);

  const segments = segmentFinalHtml(args.html ?? "", args.sections ?? []);

  const sectionAudits: PovSectionAudit[] = [];
  const sanitizedSections: Array<PovSectionForAudit & { citationIds: string[] }> = [];
  (args.sections ?? []).forEach((s, i) => {
    // Coverage basis: citations that actually appear in this section's slice
    // of the FINAL html. First-pass body/citationIds are only used for
    // sanitization and invalid-id reporting.
    const finalCited = new Set<string>(segments[i] == null ? [] : extractCitedIds(segments[i]!));
    const validCitations = [...finalCited].filter((id) => valid.has(id));
    const invalidCitations = [...finalCited].filter((id) => !valid.has(id));
    const bodyCited = new Set<string>([
      ...(s.citationIds ?? []).filter(Boolean),
      ...extractCitedIds(s.body ?? ""),
    ]);
    for (const id of bodyCited) if (!valid.has(id)) invalidSeen.add(id);
    for (const id of invalidCitations) invalidSeen.add(id);
    sectionAudits.push({
      id: s.id,
      heading: s.heading,
      validCitations,
      invalidCitations,
      supported: segments[i] != null && validCitations.length > 0,
    });
    sanitizedSections.push({
      ...s,
      body: stripInvalidMarkup(s.body ?? "", valid),
      citationIds: [...bodyCited].filter((id) => valid.has(id)),
    });
  });

  const total = sectionAudits.length;
  const coverage = total === 0 ? 0 : sectionAudits.filter((s) => s.supported).length / total;
  const unsupportedSections = sectionAudits
    .filter((s) => !s.supported)
    .map((s) => ({ id: s.id, heading: s.heading }));

  return {
    coverage,
    sanitizedHtml: stripInvalidMarkup(args.html ?? "", valid),
    sanitizedSections,
    sections: sectionAudits,
    invalidFactIds: [...invalidSeen],
    unsupportedSections,
    passes: total > 0 && coverage >= floor,
  };
}

/** Human-actionable failure message listing unsupported sections + bogus ids. */
export function describeCitationFailure(audit: PovCitationAudit): string {
  const parts: string[] = [
    `Citation coverage ${Math.round(audit.coverage * 100)}% is below the ${Math.round(POV_CITATION_COVERAGE_FLOOR * 100)}% floor.`,
  ];
  if (audit.unsupportedSections.length > 0) {
    parts.push(
      `Sections without a valid citation: ${audit.unsupportedSections
        .map((s) => `"${s.heading}"`)
        .join(", ")}.`,
    );
  }
  if (audit.invalidFactIds.length > 0) {
    parts.push(
      `Citations referencing unknown fact ids were removed: ${audit.invalidFactIds.slice(0, 8).join(", ")}.`,
    );
  }
  parts.push("Promote more facts or tighten the outline, then draft again.");
  return parts.join(" ");
}
