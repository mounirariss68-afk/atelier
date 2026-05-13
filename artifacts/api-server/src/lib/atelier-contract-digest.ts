import { db, atelierEngagements } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export interface ContractDigest {
  expensesClause?: boolean;
  expenseMarkupCapPct?: number;
  permittedCategories?: string[];
  blockedCategories?: string[];
  amberCategories?: string[];
  summary?: string;
}

const DEFAULT_BLOCKED = ["alcohol", "personal", "fines"];
const DEFAULT_AMBER = ["entertainment", "gifts"];

export async function buildContractDigest(
  engagementId: string | null,
): Promise<ContractDigest | null> {
  if (!engagementId) return null;
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), isNull(atelierEngagements.deletedAt)));
  if (!eng) return null;
  if (eng.plmStage === "closed") {
    return {
      expensesClause: false,
      expenseMarkupCapPct: 0,
      permittedCategories: [],
      blockedCategories: DEFAULT_BLOCKED,
      amberCategories: DEFAULT_AMBER,
      summary: `${eng.name}: closed engagement — no expense pass-through.`,
    };
  }
  const charter = eng.charter ?? null;
  const charterText = charter
    ? [
        charter.governance ?? "",
        charter.valueHypothesis ?? "",
        ...(charter.scope ?? []),
        ...(charter.objectives ?? []),
        ...(charter.outOfScope ?? []),
      ]
        .join(" \n ")
        .toLowerCase()
    : "";
  const workstreamText = (eng.workstreams ?? [])
    .map((w) => `${w.name} ${w.lead}`)
    .join(" ")
    .toLowerCase();
  const haystack = `${charterText} ${workstreamText}`;
  let hasClause: boolean;
  let cap = 10;
  if (!charter) {
    hasClause = true;
  } else {
    const negated =
      /no\s+expense\s+pass[- ]through|expenses?\s+not\s+(reimbursed|billable)|firm[- ]overhead\s+only/.test(
        haystack,
      );
    const explicit =
      /(pass[- ]through|reimburs|t&e|travel\s*\+\s*expense|expense.*billable|expenses?\s+(at\s+cost|reimbursed|passed|billable))/.test(
        haystack,
      );
    hasClause = negated ? false : explicit;
    const capMatch = haystack.match(/markup\s*(?:of\s*)?(\d{1,2})\s*%/);
    if (capMatch) cap = Math.min(20, Number(capMatch[1]));
  }
  const base = ["flight", "hotel", "meal", "taxi", "per_diem", "mileage"];
  const extras: string[] = [];
  if (/\bgift\b/.test(haystack)) extras.push("gift");
  if (/\bsoftware\b|\bsubscription\b/.test(haystack)) extras.push("software");
  return {
    expensesClause: hasClause,
    expenseMarkupCapPct: hasClause ? cap : 0,
    permittedCategories: hasClause ? [...base, ...extras] : [],
    blockedCategories: DEFAULT_BLOCKED,
    amberCategories: DEFAULT_AMBER,
    summary: hasClause
      ? `${eng.name}: charter contains an expense pass-through clause (cap ${cap}%).`
      : `${eng.name}: charter has no explicit expense pass-through clause — firm-overhead by default.`,
  };
}
