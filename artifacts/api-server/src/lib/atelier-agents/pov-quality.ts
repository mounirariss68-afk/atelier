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

/**
 * Task #1051 — outline section types. "evidence" sections carry the citation
 * burden (coverage floor applies to them); "positioning" sections are
 * client-facing framing (why-now, roadmap, About-Cognirise…) that must NOT
 * carry citations to unknown facts and must still resolve their heading in
 * the final HTML. The approved outline is the source of truth for types —
 * never the model-returned draft sections.
 */
export type PovSectionType = "evidence" | "positioning";

export interface PovOutlineTypeRef {
  id: string;
  type?: string | null;
  /** Heading from the approved outline — used for actionable missing-section errors. */
  heading?: string | null;
}

export interface PovSectionAudit {
  id: string;
  heading: string;
  /** Effective type used by the gate ("evidence" when the outline is untyped). */
  type: PovSectionType | "unknown";
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
  /**
   * Task #1051 — fail-closed section-type problems: a typed outline with a
   * missing/unknown type, or a positioning section whose heading is missing
   * from the final HTML or which smuggles citations to unknown fact ids.
   */
  sectionTypeIssues: Array<{ id: string; heading: string; issue: string }>;
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
  /**
   * Task #1051 — section types from the APPROVED outline, keyed by section
   * id. When ANY outline entry carries a type, typed mode is on: every draft
   * section must resolve to a valid outline type ("evidence"|"positioning")
   * or the run fails closed. When no entry carries a type (legacy outlines),
   * every section is treated as evidence — exactly the pre-#1051 behavior.
   */
  outlineTypes?: PovOutlineTypeRef[];
}): PovCitationAudit {
  const valid = new Set(args.validFactIds.filter(Boolean));
  const floor = args.floor ?? POV_CITATION_COVERAGE_FLOOR;
  const invalidSeen = new Set<string>();
  const typeById = new Map<string, string | null | undefined>(
    (args.outlineTypes ?? []).map((o) => [o.id, o.type]),
  );
  const typedMode = (args.outlineTypes ?? []).some((o) => o.type != null && o.type !== "");
  const sectionTypeIssues: Array<{ id: string; heading: string; issue: string }> = [];

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

    // Resolve the section's effective type from the approved outline.
    let effType: PovSectionType | "unknown";
    if (!typedMode) {
      effType = "evidence";
    } else {
      const raw = typeById.get(s.id);
      effType = raw === "evidence" || raw === "positioning" ? raw : "unknown";
      if (effType === "unknown") {
        sectionTypeIssues.push({
          id: s.id,
          heading: s.heading,
          issue: typeById.has(s.id)
            ? `missing or unknown section type "${String(raw ?? "")}"`
            : "section not present in the approved outline",
        });
      }
    }
    if (effType === "positioning") {
      // Positioning sections carry no citation burden, but they must still
      // resolve their heading in the final document and must carry ZERO
      // citation markers — even markers that resolve to the snapshot violate
      // the evidence/positioning separation (client-specific claims belong
      // in evidence sections).
      if (segments[i] == null) {
        sectionTypeIssues.push({ id: s.id, heading: s.heading, issue: "positioning section heading missing from final document" });
      }
      if (invalidCitations.length > 0) {
        sectionTypeIssues.push({
          id: s.id,
          heading: s.heading,
          issue: `positioning section cites unknown fact ids: ${invalidCitations.slice(0, 4).join(", ")}`,
        });
      } else if (validCitations.length > 0 || bodyCited.size > 0) {
        // The ban covers the DRAFT body too — a stylist that quietly drops
        // markers must not launder a positioning section that was written
        // against citations.
        sectionTypeIssues.push({
          id: s.id,
          heading: s.heading,
          issue: "positioning section must not carry citation markers — move cited claims into an evidence section",
        });
      }
    }
    sectionAudits.push({
      id: s.id,
      heading: s.heading,
      type: effType,
      validCitations,
      invalidCitations,
      supported:
        effType === "positioning"
          ? segments[i] != null && finalCited.size === 0
          : segments[i] != null && validCitations.length > 0,
    });
    sanitizedSections.push({
      ...s,
      body: stripInvalidMarkup(s.body ?? "", valid),
      citationIds: [...bodyCited].filter((id) => valid.has(id)),
    });
  });

  // Outline completeness: in typed mode the approved outline is the document
  // contract — every approved section must be drafted exactly once, its
  // drafted heading must match the approved heading, and the FINAL document
  // must carry exactly one <h2> for every approved section (evidence AND
  // positioning). A stylist that silently drops or rewrites an approved
  // section fails closed even when the coverage floor would still clear.
  if (typedMode) {
    const draftCounts = new Map<string, number>();
    const draftHeadings = new Map<string, string>();
    (args.sections ?? []).forEach((s) => {
      draftCounts.set(s.id, (draftCounts.get(s.id) ?? 0) + 1);
      draftHeadings.set(s.id, normalizeHeadingText(s.heading ?? ""));
    });
    const finalH2 = [...(args.html ?? "").matchAll(/<h2[^>]*>([\s\S]*?)<\/h2\s*>/gi)].map((m) =>
      normalizeHeadingText(m[1] ?? ""),
    );
    for (const o of args.outlineTypes ?? []) {
      const heading = o.heading ?? o.id;
      const n = draftCounts.get(o.id) ?? 0;
      if (n === 0) {
        sectionTypeIssues.push({ id: o.id, heading, issue: "approved outline section missing from the draft" });
      } else if (n > 1) {
        sectionTypeIssues.push({ id: o.id, heading, issue: `approved outline section drafted ${n} times` });
      }
      const wantHeading = normalizeHeadingText(o.heading ?? "");
      if (n > 0 && wantHeading && draftHeadings.get(o.id) !== wantHeading) {
        sectionTypeIssues.push({
          id: o.id,
          heading,
          issue: `drafted heading "${draftHeadings.get(o.id) ?? ""}" does not match the approved outline heading`,
        });
      }
      if (wantHeading) {
        const hits = finalH2.filter((t) => t === wantHeading).length;
        if (hits === 0) {
          sectionTypeIssues.push({ id: o.id, heading, issue: "approved section heading missing from the final document" });
        } else if (hits > 1) {
          sectionTypeIssues.push({ id: o.id, heading, issue: "approved section heading duplicated in the final document" });
        }
      }
    }
  }

  // Coverage is computed over the EVIDENCE subset only ("unknown" types are
  // counted as evidence so a mistyped section can never relax the floor).
  const evidenceAudits = sectionAudits.filter((s) => s.type !== "positioning");
  const evidenceTotal = evidenceAudits.length;
  const coverage =
    evidenceTotal === 0 ? 0 : evidenceAudits.filter((s) => s.supported).length / evidenceTotal;
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
    sectionTypeIssues,
    // A POV is still an evidence-backed argument: at least one evidence
    // section must exist, its subset must clear the floor, and every
    // section-type problem fails closed.
    passes: evidenceTotal > 0 && coverage >= floor && sectionTypeIssues.length === 0,
  };
}

/** Human-actionable failure message listing unsupported sections + bogus ids. */
export function describeCitationFailure(audit: PovCitationAudit): string {
  const parts: string[] = [];
  const evidenceCount = audit.sections.filter((s) => s.type !== "positioning").length;
  if (evidenceCount === 0) {
    parts.push("The document has no evidence sections — a POV needs at least one cited evidence section.");
  } else if (audit.coverage < POV_CITATION_COVERAGE_FLOOR) {
    parts.push(
      `Citation coverage ${Math.round(audit.coverage * 100)}% is below the ${Math.round(POV_CITATION_COVERAGE_FLOOR * 100)}% floor (computed over evidence sections).`,
    );
  }
  if (audit.sectionTypeIssues.length > 0) {
    parts.push(
      `Section-type problems: ${audit.sectionTypeIssues
        .map((s) => `"${s.heading}" — ${s.issue}`)
        .join("; ")}.`,
    );
  }
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
