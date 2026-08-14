/**
 * Atelier Wallet — policy engine (Task #259).
 *
 * Pure-function evaluator that takes an expense draft (already converted
 * to USD) plus the active rule set and returns AMBER warnings + RED
 * blocks. Uses the most-specific rule per category (role + country >
 * role > country > global). Empty rule set returns "green" — the seed
 * always installs defaults so this only matters in dev.
 */

import { db, atelierExpensePolicies, atelierAuditEvents } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { rid } from "./atelier-contracts.js";

export interface PolicyFinding {
  ruleId: string;
  severity: "amber" | "red";
  category: string;
  message: string;
}

export interface PolicyOutcome {
  status: "green" | "amber" | "red";
  findings: PolicyFinding[];
  approvalRequired: boolean;
}

interface ExpenseDraft {
  orgId: string;
  category: string;
  usdAmount: number;
  amount: number;
  currency: string;
  country?: string | null;
  role?: string | null;
  flightClass?: string | null; // economy | premium_economy | business | first
}

const FLIGHT_CLASS_RANK: Record<string, number> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

export async function loadActivePolicies(orgId: string, category: string) {
  return db
    .select()
    .from(atelierExpensePolicies)
    .where(
      and(
        eq(atelierExpensePolicies.orgId, orgId),
        eq(atelierExpensePolicies.category, category),
        eq(atelierExpensePolicies.active, true),
        isNull(atelierExpensePolicies.deletedAt),
      ),
    );
}

export async function evaluateExpense(
  draft: ExpenseDraft,
): Promise<PolicyOutcome> {
  const findings: PolicyFinding[] = [];
  let approvalRequired = false;

  await ensureDefaultExpensePolicies(draft.orgId);
  const rules = await loadActivePolicies(draft.orgId, draft.category);
  // Score specificity so we apply the most specific cap.
  type Rule = (typeof rules)[number];
  function specificity(r: Rule): number {
    let s = 0;
    if (r.appliesToRole) s += 2;
    if (r.appliesToCountry) s += 1;
    return s;
  }
  function applies(r: Rule): boolean {
    // Strict scoping: a role-scoped rule only applies when the submitter
    // role is known AND matches; same for country. Unknown role/country
    // never matches a scoped rule (avoids partner-only caps leaking onto
    // employees when role isn't passed).
    if (r.appliesToRole) {
      if (!draft.role || r.appliesToRole !== draft.role) return false;
    }
    if (r.appliesToCountry) {
      if (!draft.country || r.appliesToCountry !== draft.country) return false;
    }
    return true;
  }
  const matched = rules.filter(applies).sort((a, b) => specificity(b) - specificity(a));
  const seenAxis = new Set<string>();

  for (const r of matched) {
    // Each "axis" (cap, hard_block, approval_threshold, flight_class) is
    // applied at most once — most-specific rule wins.
    if (r.hardBlockAmountUsd != null && !seenAxis.has("hard")) {
      seenAxis.add("hard");
      if (draft.usdAmount > r.hardBlockAmountUsd) {
        findings.push({
          ruleId: r.id,
          severity: "red",
          category: r.category,
          message: `${r.category} expense $${draft.usdAmount.toFixed(2)} exceeds hard block $${r.hardBlockAmountUsd.toFixed(2)}${r.rationale ? ` — ${r.rationale}` : ""}`,
        });
      }
    }
    if (r.capAmountUsd != null && !seenAxis.has("cap")) {
      seenAxis.add("cap");
      if (draft.usdAmount > r.capAmountUsd) {
        findings.push({
          ruleId: r.id,
          severity: "amber",
          category: r.category,
          message: `${r.category} expense $${draft.usdAmount.toFixed(2)} over policy cap $${r.capAmountUsd.toFixed(2)}${r.capUnit ? ` ${r.capUnit}` : ""} — override requires rationale.`,
        });
      }
    }
    if (r.flightClassMax && draft.flightClass && !seenAxis.has("class")) {
      seenAxis.add("class");
      const reqRank = FLIGHT_CLASS_RANK[draft.flightClass.toLowerCase()] ?? 0;
      const maxRank = FLIGHT_CLASS_RANK[r.flightClassMax.toLowerCase()] ?? 0;
      if (reqRank > maxRank) {
        const sev = reqRank - maxRank >= 2 ? "red" : "amber";
        findings.push({
          ruleId: r.id,
          severity: sev,
          category: r.category,
          message: `Flight class ${draft.flightClass} exceeds policy max ${r.flightClassMax}${r.rationale ? ` — ${r.rationale}` : ""}`,
        });
      }
    }
    if (r.approvalThresholdUsd != null && !seenAxis.has("approval")) {
      seenAxis.add("approval");
      if (draft.usdAmount > r.approvalThresholdUsd) {
        approvalRequired = true;
      }
    }
  }

  const status: PolicyOutcome["status"] = findings.some((f) => f.severity === "red")
    ? "red"
    : findings.length > 0
      ? "amber"
      : "green";
  return { status, findings, approvalRequired };
}

/**
 * Default policy seed — lean startup-mode expense policy for a small
 * professional-services firm (UAE/GCC base). Researched against
 * best-practice caps for sub-20-person consulting firms (2026):
 * trust-based, receipted, few rules, generous-but-capped, hard blocks
 * only where there is real compliance risk (anti-bribery gifts, runaway
 * travel spend). Idempotent on fixed ids; re-callable from the wallet
 * ops endpoint and the first-read auto-seed.
 */
export const DEFAULT_POLICIES: Array<{
  id: string;
  category: string;
  appliesToRole: string | null;
  appliesToCountry: string | null;
  capAmountUsd?: number;
  capUnit?: string;
  hardBlockAmountUsd?: number;
  approvalThresholdUsd?: number;
  flightClassMax?: string;
  rationale?: string;
}> = [
  {
    id: "pol_flight_default",
    category: "flight",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 1200,
    capUnit: "per_trip",
    hardBlockAmountUsd: 5000,
    approvalThresholdUsd: 1200,
    flightClassMax: "economy",
    rationale:
      "Economy with sensible routing. $1,200 covers most GCC + international round trips booked ahead; over that just needs a partner OK, not a ban.",
  },
  {
    id: "pol_flight_partner",
    category: "flight",
    appliesToRole: "partner",
    appliesToCountry: null,
    capAmountUsd: 2800,
    capUnit: "per_trip",
    hardBlockAmountUsd: 8000,
    approvalThresholdUsd: 2800,
    flightClassMax: "business",
    rationale:
      "Partners may fly business on long-haul (>4h) when client-facing the same day — use judgment; the firm's cash is your cash.",
  },
  {
    id: "pol_hotel_default",
    category: "hotel",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 220,
    capUnit: "per_day",
    hardBlockAmountUsd: 1200,
    approvalThresholdUsd: 400,
    rationale:
      "$220/night books a solid 4-star in Dubai, Riyadh or Doha. Peak-event weeks (GITEX, LEAP) can run higher — flag it and it will be approved.",
  },
  {
    id: "pol_meal_default",
    category: "meal",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 70,
    capUnit: "per_day",
    hardBlockAmountUsd: 400,
    approvalThresholdUsd: 150,
    rationale:
      "$70/day eats well on the road. Client meals with attendees logged are expected to run over — that's business development, not a violation.",
  },
  {
    id: "pol_taxi_default",
    category: "taxi",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 30,
    capUnit: "per_trip",
    hardBlockAmountUsd: 200,
    rationale:
      "Standard ride-hailing (Careem/Uber), not luxury tiers. Airport transfers fit in $30 in most GCC cities; longer runs just need a note.",
  },
  {
    id: "pol_gift_default",
    category: "gift",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 100,
    capUnit: "per_item",
    hardBlockAmountUsd: 300,
    approvalThresholdUsd: 100,
    rationale:
      "Hard compliance line: client gifts over $300 are blocked outright (UAE anti-bribery norms). Under $100 is fine; between, a partner signs off. Never cash or vouchers.",
  },
  {
    id: "pol_software_default",
    category: "software",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 50,
    capUnit: "per_month",
    approvalThresholdUsd: 50,
    rationale:
      "Self-serve tools under $50/mo — just buy what makes you faster. Over that, a partner checks we're not duplicating a seat we already pay for.",
  },
  {
    id: "pol_telecom_default",
    category: "telecom",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 60,
    capUnit: "per_month",
    approvalThresholdUsd: 100,
    rationale:
      "Mobile + data plans up to $60/mo reimbursed without questions; roaming bundles for travel weeks may push over — note the trip.",
  },
];

/**
 * Plain-language spirit of the policy — shown on the Policy page and
 * kept next to the rules so copy and caps evolve together.
 */
export const POLICY_PRINCIPLES =
  "Reasonable, receipted, client-first. Spend the firm's money like your own: book economy and mid-range, keep receipts, and log client attendees on meals. Going over a cap isn't a violation — add a note and it routes for a quick partner OK. The only hard stops are compliance ones, like large client gifts.";

/**
 * Default rules materialized for one org: per-org row ids (so two orgs
 * never collide on the primary key) with the org stamped explicitly.
 * "aico" keeps the legacy un-suffixed ids so re-seeding an org that was
 * seeded by the original seed endpoint stays conflict-idempotent.
 */
export function defaultPoliciesForOrg(orgId: string) {
  return DEFAULT_POLICIES.map((p) => ({
    ...p,
    id: orgId === "aico" ? p.id : `${p.id}__${orgId}`,
    orgId,
  }));
}

// Per-org memo of "this org has rules" — rows are only ever soft-deleted,
// so once any row (live or retired) exists the org can never be
// "never seeded" again and we can skip the existence probe.
const orgsWithPolicyRows = new Set<string>();

/**
 * First-read auto-seed: if NO policy row has ever existed for this org
 * (including retired ones), install the defaults with an audit entry.
 * Never touches an org that has edited or retired rules — any existing
 * row, live or soft-deleted, disables seeding entirely. Concurrency:
 * fixed per-org ids + onConflictDoNothing().returning() inside one
 * transaction mean overlapping first reads race harmlessly — only the
 * call whose insert actually landed rows writes the audit entry.
 */
export async function ensureDefaultExpensePolicies(orgId: string): Promise<void> {
  if (orgsWithPolicyRows.has(orgId)) return;
  const [existing] = await db
    .select({ id: atelierExpensePolicies.id })
    .from(atelierExpensePolicies)
    .where(eq(atelierExpensePolicies.orgId, orgId))
    .limit(1);
  if (existing) {
    orgsWithPolicyRows.add(orgId);
    return;
  }
  const values = defaultPoliciesForOrg(orgId);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(atelierExpensePolicies)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: atelierExpensePolicies.id });
    if (inserted.length === 0) return; // a concurrent call seeded first
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId,
      entityType: "wallet_policy",
      entityId: "all",
      actorType: "system",
      actorId: "system",
      actorLabel: "System",
      action: "wallet.policy.auto_seed",
      payload: { count: inserted.length, orgId },
      payloadSummary: `Auto-seeded ${inserted.length} default expense policy rules on first read.`,
    });
  });
  orgsWithPolicyRows.add(orgId);
}
