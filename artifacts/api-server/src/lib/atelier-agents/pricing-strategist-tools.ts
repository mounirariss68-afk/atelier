/**
 * Tool-contract stubs for the Pricing Strategist agent (Task #240).
 *
 * Per the agent spec, the strategist's narrative must be grounded in three
 * tool surfaces: `knowledge.search`, `pricing_rules.lookup`, and
 * `rate_card.read`. Numeric pricing math is owned by `lib/atelier-pricing`
 * and is *never* delegated to an LLM tool — these helpers only return
 * qualitative evidence that we attach to the strategist's output for
 * traceability and future auditing.
 *
 * The implementations here are deterministic and read directly from the
 * Atelier corpus + DB, so they are safe to invoke synchronously from the
 * strategist runner without an LLM round-trip.
 */
import { db, atelierRateCards, atelierRateCardRows, atelierWinLossDebriefs } from "@workspace/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

export interface KnowledgeHit {
  id: string;
  title: string;
  snippet: string;
  source: "win_loss_debrief";
  /** The debrief's opportunity, so the Partner can open the precedent. */
  opportunityId: string;
  outcome: string;
  publishedAt: string | null;
}
export interface PricingRule {
  id: string;
  name: string;
  appliesTo: string;
  text: string;
}
export interface RateCardSnapshot {
  cardId: string;
  name: string;
  geography: string | null;
  currency: string;
  rows: Array<{
    seniority: string;
    role: string;
    dayRateInternalCost: number;
    dayRateClientPrice: number;
    overheadPct: number;
  }>;
}

/**
 * `knowledge.search` — qualitative deal precedent lookup.
 *
 * Reads the firm's own published win/loss debriefs (themes and lessons
 * tagged by polarity) for the tenant, most recent first, and returns the
 * ones whose theme or lesson text mentions the query. Nothing here is
 * invented: a hit always points at a debrief row a Partner can open. When
 * the firm has no published debriefs yet the result is empty and the
 * strategist's narrative says so instead of citing precedent.
 */
export async function knowledgeSearch(
  query: string,
  opts: { orgId: string; opportunityId?: string | null; limit?: number },
): Promise<KnowledgeHit[]> {
  const limit = opts.limit ?? 3;
  const rows = await db
    .select({
      id: atelierWinLossDebriefs.id,
      opportunityId: atelierWinLossDebriefs.opportunityId,
      outcome: atelierWinLossDebriefs.outcome,
      themes: atelierWinLossDebriefs.themes,
      lessons: atelierWinLossDebriefs.suggestedAtelierLessons,
      publishedAt: atelierWinLossDebriefs.publishedAt,
    })
    .from(atelierWinLossDebriefs)
    .where(and(eq(atelierWinLossDebriefs.orgId, opts.orgId), isNotNull(atelierWinLossDebriefs.publishedAt)))
    .orderBy(desc(atelierWinLossDebriefs.publishedAt))
    .limit(50);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const hits: KnowledgeHit[] = [];
  for (const r of rows) {
    if (r.opportunityId === opts.opportunityId) continue; // the deal cannot be its own precedent
    const themes = (r.themes ?? []) as Array<{ name: string; tag: string; evidenceQuote: string; polarity: "win" | "loss" }>;
    const lessons = (r.lessons ?? []) as Array<{ title: string; summary: string; kind: string }>;
    const text = [
      ...themes.map((t) => `${t.name} ${t.tag} ${t.evidenceQuote}`),
      ...lessons.map((l) => `${l.title} ${l.summary}`),
    ]
      .join(" ")
      .toLowerCase();
    const relevant = terms.length === 0 || terms.some((t) => text.includes(t));
    if (!relevant) continue;
    const pricingThemes = themes.filter((t) => /pric|fee|discount|margin|rate|budget|cost/i.test(`${t.name} ${t.tag} ${t.evidenceQuote}`));
    const lead = pricingThemes[0] ?? themes[0];
    if (!lead) continue;
    hits.push({
      id: r.id,
      title: `${lead.polarity === "win" ? "Won" : "Lost"} — ${lead.name}`,
      snippet: lead.evidenceQuote || lessons[0]?.summary || `Outcome: ${r.outcome}`,
      source: "win_loss_debrief",
      opportunityId: r.opportunityId,
      outcome: r.outcome,
      publishedAt: r.publishedAt?.toISOString() ?? null,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * `pricing_rules.lookup` — structured pricing guardrails. Each rule is
 * the Cognirise Partner-board's policy text; the strategist may cite them
 * verbatim in talking points.
 */
export function pricingRulesLookup(_context: { pricingModel: string; marginPct: number; status: string }): PricingRule[] {
  return [
    {
      id: "rule_target_margin",
      name: "Target margin",
      appliesTo: "all",
      text: "Lead with structures that clear the 55% target. Anything below is a negotiation lever, not a default.",
    },
    {
      id: "rule_two_partner_red",
      name: "Two-Partner countersign on RED",
      appliesTo: "marginLockStatus:red",
      text: "Sub-45% margin requires a written rationale + countersign from a second Partner before send.",
    },
    {
      id: "rule_outcome_kpi",
      name: "Outcome-based requires KPI",
      appliesTo: "pricingModel:outcome_based",
      text: "Outcome pricing must land against a numeric, time-bound KPI co-signed by the client sponsor.",
    },
  ];
}

/**
 * `rate_card.read` — read-only snapshot of a rate card + its bands. Used
 * by the strategist runner to attach evidence of which card was applied.
 */
export async function rateCardRead(cardId: string): Promise<RateCardSnapshot | null> {
  const [card] = await db
    .select()
    .from(atelierRateCards)
    .where(and(eq(atelierRateCards.id, cardId), isNull(atelierRateCards.deletedAt)));
  if (!card) return null;
  const rows = await db
    .select()
    .from(atelierRateCardRows)
    .where(and(eq(atelierRateCardRows.rateCardId, cardId), isNull(atelierRateCardRows.deletedAt)));
  return {
    cardId: card.id,
    name: card.name,
    geography: card.geography,
    currency: card.currency,
    rows: rows.map((r) => ({
      seniority: r.seniority,
      role: r.role,
      dayRateInternalCost: r.dayRateInternalCost,
      dayRateClientPrice: r.dayRateClientPrice,
      overheadPct: r.overheadPct,
    })),
  };
}
