/**
 * Task #846 — shared helpers for the two document-email tools
 * (`email_my_documents` / `email_company_documents`).
 *
 * A request like "send both my saudi visa and emirates id to X" can land
 * on either tool depending on the model's pick. Both tools therefore
 * share:
 *   - multi-document query splitting ("X and Y", commas, "+", Arabic و);
 *   - fuzzy per-term matchers for each domain (personal profile docs vs
 *     Document Library docs);
 *   - domain loaders so either tool can PROBE the other domain on a
 *     miss and hand off (mirrors the person cross-domain fallback,
 *     Task #469 — ACLs are applied before candidates are offered:
 *     personal docs are strictly self-scoped, library docs go through
 *     `canSeeDocument`, and self-only chat roles never reach the
 *     library probe at all — the callers enforce that gate).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierDocuments,
  atelierDocumentVersions,
  atelierPersonDocuments,
} from "@workspace/db";
import { canSeeDocument } from "../../routes/atelier/documentRoutes.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes";
import { resolveSelfSubject } from "./me-capabilities.js";
import type { ToolContext } from "./index.js";

export type OwnDocRow = typeof atelierPersonDocuments.$inferSelect;
export type LibDocRow = typeof atelierDocuments.$inferSelect;
export type LibVersionRow = typeof atelierDocumentVersions.$inferSelect;
export type LibPair = { doc: LibDocRow; version: LibVersionRow | null };

/** Normalize free text for fuzzy doc matching (lowercase, collapse
 *  separators so "national id" matches kind "national_id"). */
export function docMatchNorm(s: string): string {
  return s.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Split a free-text document query into independent terms:
 * "passport and visa", "passport, visa", "passport + visa",
 * "جواز و تأشيرة" all yield two terms. Single-term queries come back
 * as a one-element array, so callers can loop unconditionally.
 */
export function splitDocQueryTerms(query: string): string[] {
  // NOTE: `\b` does not work around Arabic letters (they are not `\w`),
  // so the standalone "و" conjunction is matched by whitespace instead.
  return String(query ?? "")
    .split(/\s*(?:,|\+|\band\b|\bet\b)\s*|\s+و\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Fuzzy-match one query term against the caller's OWN documents by
 * kind, title, or file name. Pure so probes can pin it.
 * (Moved from me-write-capabilities for Task #846; behavior unchanged.)
 */
export function matchOwnDocuments(docs: OwnDocRow[], term: string): OwnDocRow[] {
  const q = docMatchNorm(term);
  if (!q) return [];
  const broad = docs.filter((d) => {
    const kind = docMatchNorm(d.kind);
    const title = docMatchNorm(d.title ?? "");
    const fileName = docMatchNorm(d.fileName ?? "");
    return (
      kind === q ||
      q.includes(kind) ||
      kind.includes(q) ||
      (title !== "" && (title.includes(q) || q.includes(title))) ||
      (fileName !== "" && fileName.includes(q))
    );
  });
  if (broad.length <= 1) return broad;
  // Specificity pass: a query that names a document's exact title (or is
  // fully contained in it) should not fan out to every same-kind sibling
  // ("UAE Visa 2025" must not also match "UAE Visa 2026").
  const exactTitle = broad.filter((d) => docMatchNorm(d.title ?? "") === q);
  if (exactTitle.length > 0) return exactTitle;
  const titleHit = broad.filter((d) => {
    const title = docMatchNorm(d.title ?? "");
    return title !== "" && (title.includes(q) || q.includes(title));
  });
  if (titleHit.length > 0 && titleHit.length < broad.length) return titleHit;
  return broad;
}

/**
 * Fuzzy title/kind/file-name match over LIBRARY documents, with a
 * specificity pass so an exact-title query never fans out to
 * same-kind siblings. (Moved from document-email-capabilities for
 * Task #846; behavior unchanged.)
 */
export function matchLibraryDocuments(docs: LibPair[], term: string): LibPair[] {
  const q = docMatchNorm(term);
  if (!q) return [];
  const qTokens = q.split(" ").filter((t) => t.length > 2);
  const broad = docs.filter(({ doc, version }) => {
    const title = docMatchNorm(doc.title);
    const kind = docMatchNorm(doc.docKind ?? "");
    const fileName = docMatchNorm(version?.fileName ?? "");
    if (title.includes(q) || q.includes(title)) return true;
    if (kind && (kind === q || q.includes(kind) || kind.includes(q))) return true;
    if (fileName && fileName.includes(q)) return true;
    // Token overlap: "company registration certificate in Dubai" should
    // hit "Commercial Registration Certificate" — require most query
    // tokens to appear across title+kind+filename.
    if (qTokens.length >= 2) {
      const hay = `${title} ${kind} ${fileName}`;
      const hits = qTokens.filter((t) => hay.includes(t)).length;
      return hits >= Math.ceil(qTokens.length / 2) && hits >= 2;
    }
    return false;
  });
  if (broad.length <= 1) return broad;
  const exact = broad.filter(({ doc }) => docMatchNorm(doc.title) === q);
  if (exact.length > 0) return exact;
  const titleHit = broad.filter(({ doc }) => {
    const t = docMatchNorm(doc.title);
    return t.includes(q) || q.includes(t);
  });
  if (titleHit.length > 0 && titleHit.length < broad.length) return titleHit;
  return broad;
}

/**
 * Load the caller's OWN emailable person documents (self-scope only —
 * resolved strictly via the caller's session persona; photos and
 * biographies excluded). Returns null when the caller has no roster
 * record, i.e. the personal domain does not exist for them.
 */
export async function loadOwnEmailableDocs(ctx: ToolContext): Promise<OwnDocRow[] | null> {
  const subject = await resolveSelfSubject(ctx);
  const person = subject?.person;
  if (!person) return null;
  return (
    await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.personType, person.workerType),
          eq(atelierPersonDocuments.personId, person.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPersonDocuments.uploadedAt))
  ).filter((d) => d.kind !== "profile_photo" && d.kind !== "biography");
}

/**
 * Load the Document Library docs the caller is allowed to SEE
 * (`canSeeDocument`, same predicate as the Documents page), with each
 * doc's current version. ACL filtering happens here, BEFORE any
 * candidate capping or matching — restricted callers can never be
 * offered out-of-perimeter documents. Returns null when the caller's
 * login can't be resolved.
 *
 * NOTE — callers must gate on role first: self-only chat roles
 * (SELF_ONLY_CHAT_ROLES) must never invoke this from a chat tool.
 */
export async function loadVisibleLibraryPairs(ctx: ToolContext): Promise<LibPair[] | null> {
  const [meRow] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ctx.persona.id), eq(atelierUsers.orgId, ctx.persona.orgId)))
    .limit(1);
  if (!meRow) return null;
  const access = await accessibleEngagementIds(meRow);
  const allDocs = await db
    .select()
    .from(atelierDocuments)
    .where(
      and(
        eq(atelierDocuments.orgId, ctx.persona.orgId),
        eq(atelierDocuments.status, "active"),
        isNull(atelierDocuments.deletedAt),
      ),
    )
    .orderBy(desc(atelierDocuments.updatedAt))
    .limit(500);
  const visible: LibPair[] = [];
  for (const doc of allDocs) {
    if (!(await canSeeDocument(meRow, access, doc))) continue;
    let version: LibVersionRow | null = null;
    if (doc.currentVersionId) {
      const [v] = await db
        .select()
        .from(atelierDocumentVersions)
        .where(eq(atelierDocumentVersions.id, doc.currentVersionId))
        .limit(1);
      version = v ?? null;
    }
    visible.push({ doc, version });
  }
  return visible;
}

export type TermResolution<T> =
  | { kind: "all"; hits: T[] }
  | { kind: "ambiguous"; term: string; matches: T[] }
  | { kind: "miss"; term: string };

/**
 * Resolve every term to EXACTLY one candidate (deduped). Used by the
 * cross-domain probes: a handoff only happens when the other domain
 * resolves the whole query unambiguously (all-terms hit), so the
 * handed-off tool can proceed straight to its confirm card by ids.
 */
export function resolveTermsUnique<T>(
  terms: string[],
  matchFn: (term: string) => T[],
  idOf: (item: T) => string,
): TermResolution<T> {
  const seen = new Set<string>();
  const hits: T[] = [];
  for (const term of terms) {
    const m = matchFn(term);
    if (m.length === 0) return { kind: "miss", term };
    if (m.length > 1) return { kind: "ambiguous", term, matches: m };
    const id = idOf(m[0]!);
    if (!seen.has(id)) {
      seen.add(id);
      hits.push(m[0]!);
    }
  }
  return { kind: "all", hits };
}

/**
 * Passthrough of the email-shaped inputs (recipients, mode, subject,
 * message) when one document-email tool hands off to the other. The
 * receiving tool re-resolves recipients and re-runs its own guards —
 * only the document selection is pre-resolved (by ids).
 */
export function handoffEmailInput(
  input: Record<string, unknown>,
  documentIds: string[],
): Record<string, unknown> {
  return {
    documentIds,
    to: Array.isArray(input.to) ? input.to : [],
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
  };
}
