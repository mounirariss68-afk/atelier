/**
 * Atelier Wallet — policy engine (Task #259).
 *
 * Pure-function evaluator that takes an expense draft (already converted
 * to USD) plus the active rule set and returns AMBER warnings + RED
 * blocks. Uses the most-specific rule per category (role + country >
 * role > country > global). Empty rule set returns "green" — the seed
 * always installs defaults so this only matters in dev.
 */

import { db, atelierExpensePolicies } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";

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

export async function loadActivePolicies(category: string) {
  return db
    .select()
    .from(atelierExpensePolicies)
    .where(
      and(
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

  const rules = await loadActivePolicies(draft.category);
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
 * Default policy seed (PRD §4.4). Idempotent on (category, role, country).
 * Re-callable from the seed script and from the wallet ops endpoint.
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
    capAmountUsd: 1500,
    capUnit: "per_trip",
    hardBlockAmountUsd: 5000,
    approvalThresholdUsd: 1500,
    flightClassMax: "economy",
    rationale: "Economy by default; partners may upgrade with rationale.",
  },
  {
    id: "pol_flight_partner",
    category: "flight",
    appliesToRole: "partner",
    appliesToCountry: null,
    capAmountUsd: 3500,
    capUnit: "per_trip",
    hardBlockAmountUsd: 8000,
    approvalThresholdUsd: 3500,
    flightClassMax: "business",
    rationale: "Partners may fly business on flights >4h.",
  },
  {
    id: "pol_hotel_default",
    category: "hotel",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 350,
    capUnit: "per_day",
    hardBlockAmountUsd: 1500,
    approvalThresholdUsd: 600,
    rationale: "$350/night cap GCC standard.",
  },
  {
    id: "pol_meal_default",
    category: "meal",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 75,
    capUnit: "per_day",
    hardBlockAmountUsd: 400,
    approvalThresholdUsd: 200,
    rationale: "Per-person meal cap; client meals exempt with attendees logged.",
  },
  {
    id: "pol_gift_default",
    category: "gift",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 150,
    capUnit: "per_item",
    hardBlockAmountUsd: 500,
    approvalThresholdUsd: 150,
    rationale: "Gifts above $500 are blocked — anti-bribery policy.",
  },
  {
    id: "pol_software_default",
    category: "software",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 100,
    capUnit: "per_month",
    approvalThresholdUsd: 100,
    rationale: "Software subscriptions over $100/mo need partner approval.",
  },
  {
    id: "pol_taxi_default",
    category: "taxi",
    appliesToRole: null,
    appliesToCountry: null,
    capAmountUsd: 100,
    capUnit: "per_trip",
    hardBlockAmountUsd: 300,
    rationale: "Use ride-share where possible.",
  },
];
