/**
 * Task #872 — shared alliance-partner capability context for research agents.
 *
 * Builds a compact, size-capped context block describing the capability
 * domains of ACTIVE alliance partners (org-scoped, non-deleted,
 * partnershipStage === "agreed" — exploration/consideration firms are
 * excluded until they reach agreement). Injected into the Account
 * Cartographer and Pursuit Scout prompts so partner-attachable work is
 * spotted systematically.
 *
 * Deletion semantics: this is a READ-TIME filter. Archiving (soft-deleting)
 * a partner firm removes it from all future evaluations automatically;
 * previously persisted plans/briefs keep their historical partnerFit content
 * unchanged (they are snapshots, never re-derived).
 *
 * The block is advisory and capped so it never crowds out the core account
 * analysis: max firms, truncated summaries/domains, bounded total size.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierPartnerFirms } from "@workspace/db";

const MAX_FIRMS = 10;
const MAX_DOMAINS_PER_FIRM = 6;
const SUMMARY_CAP = 280;
const DOMAIN_DESC_CAP = 160;

export interface AllianceCapabilityContext {
  /** Prompt-ready block, or null when the org has no agreed partners. */
  block: string | null;
  /** Active (agreed, non-deleted) partner firm names — used as a
   * deterministic allowlist when normalising model partner-fit output. */
  firmNames: string[];
}

function clip(s: string, cap: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= cap ? t : `${t.slice(0, cap - 1)}…`;
}

export async function buildAllianceCapabilityContext(
  orgId: string,
): Promise<AllianceCapabilityContext> {
  const firms = await db
    .select({
      name: atelierPartnerFirms.name,
      speciality: atelierPartnerFirms.speciality,
      capabilityProfile: atelierPartnerFirms.capabilityProfile,
    })
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.orgId, orgId),
        isNull(atelierPartnerFirms.deletedAt),
        eq(atelierPartnerFirms.partnershipStage, "agreed"),
      ),
    )
    .orderBy(atelierPartnerFirms.name)
    .limit(MAX_FIRMS);

  if (firms.length === 0) return { block: null, firmNames: [] };

  const lines: string[] = [];
  for (const f of firms) {
    const profile = f.capabilityProfile as
      | {
          summary?: string;
          domains?: Array<{ label?: string; description?: string }>;
        }
      | null;
    const summary = clip(profile?.summary || f.speciality || "", SUMMARY_CAP);
    const domains = (profile?.domains ?? [])
      .slice(0, MAX_DOMAINS_PER_FIRM)
      .map((d) => {
        const label = (d.label ?? "").trim();
        if (!label) return null;
        const desc = clip(d.description ?? "", DOMAIN_DESC_CAP);
        return desc ? `${label}: ${desc}` : label;
      })
      .filter((s): s is string => !!s);
    lines.push(
      [
        `- ${f.name}${summary ? ` — ${summary}` : ""}`,
        ...domains.map((d) => `  • ${d}`),
      ].join("\n"),
    );
  }

  const block = [
    "Active alliance partners (capability registry):",
    ...lines,
  ].join("\n");
  return { block, firmNames: firms.map((f) => f.name) };
}

/**
 * Deterministic guard: keep only partner-fit entries that name an ACTIVE
 * alliance partner (case-insensitive), cap the list, and drop entries with
 * no rationale. The prompt asks the model to only flag material fits — this
 * is the safety net that does not depend on the model getting it right.
 */
export function filterPartnerFit<
  T extends { partnerName?: unknown; rationale?: unknown },
>(entries: unknown, activeFirmNames: string[], cap = 5): T[] {
  if (!Array.isArray(entries) || activeFirmNames.length === 0) return [];
  const allowed = new Set(activeFirmNames.map((n) => n.trim().toLowerCase()));
  return entries
    .filter(
      (e): e is T =>
        !!e &&
        typeof e === "object" &&
        typeof (e as T).partnerName === "string" &&
        allowed.has(((e as T).partnerName as string).trim().toLowerCase()) &&
        typeof (e as T).rationale === "string" &&
        ((e as T).rationale as string).trim().length > 0,
    )
    .slice(0, cap);
}
