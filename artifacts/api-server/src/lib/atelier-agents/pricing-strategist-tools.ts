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
import { db, atelierRateCards, atelierRateCardRows } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export interface KnowledgeHit {
  id: string;
  title: string;
  snippet: string;
  source: "playbook" | "case_study" | "internal_memo";
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
    costPerHourUsd: number;
    billRatePerHourUsd: number;
    utilisationPct: number;
    overheadMultiplier: number;
  }>;
}

/**
 * `knowledge.search` — qualitative deal precedent + playbook lookup.
 * Currently backed by a static corpus seeded from the AICo playbooks; the
 * shape is stable so a vector backend can swap in without changing the
 * strategist runner.
 */
export function knowledgeSearch(query: string): KnowledgeHit[] {
  const corpus: KnowledgeHit[] = [
    {
      id: "kb_pricing_001",
      title: "Discount precedent compounds across renewals",
      snippet:
        "Discounts above 10% on the first engagement reset the anchor for renewal pricing in 78% of accounts (AICo 2024-2026 win/loss).",
      source: "playbook",
    },
    {
      id: "kb_pricing_002",
      title: "Outcome-based pricing — when to lead",
      snippet:
        "Outcome-based works when the buyer has executive sponsorship and a numeric KPI; otherwise revert to fixed fee with a tight scope.",
      source: "playbook",
    },
    {
      id: "kb_pricing_003",
      title: "Retainers preserve margin via blend",
      snippet:
        "Quarterly retainers with a senior-led core and leveraged delivery hold 8-12 pts more margin than equivalent T&M structures.",
      source: "case_study",
    },
  ];
  const q = query.toLowerCase();
  return corpus.filter((h) => h.title.toLowerCase().includes(q) || h.snippet.toLowerCase().includes(q) || q.length === 0).slice(0, 3);
}

/**
 * `pricing_rules.lookup` — structured pricing guardrails. Each rule is
 * the AICo Partner-board's policy text; the strategist may cite them
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
      costPerHourUsd: r.costPerHourUsd,
      billRatePerHourUsd: r.billRatePerHourUsd,
      utilisationPct: r.utilisationPct,
      overheadMultiplier: r.overheadMultiplier,
    })),
  };
}
