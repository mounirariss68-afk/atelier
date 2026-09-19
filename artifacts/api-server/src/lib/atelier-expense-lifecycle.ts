import { and, eq, ilike, isNull } from "drizzle-orm";
import { db, atelierUsers } from "@workspace/db";

export function normalizeContingencyType(value: unknown): "none" | "win" | "project_start" {
  return value === "win" || value === "project_win" ? "win" : value === "project_start" ? "project_start" : "none";
}
export function wireReimbursementTrigger(value: string | null | undefined): "not_applicable" | "project_win" | "project_start" {
  return value === "win" || value === "project_win" ? "project_win" : value === "project_start" ? "project_start" : "not_applicable";
}

export function isExpenseEconomicallyActive(expense: {
  contingencyStatus: string | null | undefined;
  directCostStatus?: string | null;
}): boolean {
  return (expense.contingencyStatus === "not_applicable" || expense.contingencyStatus === "activated") &&
    (expense.directCostStatus == null || expense.directCostStatus === "included");
}

export async function resolveExpenseBeneficiary(orgId: string, value: unknown): Promise<
  { beneficiary: { id: string; name: string }; ambiguous: false } |
  { beneficiary: null; ambiguous: boolean }
> {
  const requested = String(value ?? "").trim();
  if (!requested) return { beneficiary: null, ambiguous: false };
  const byId = await db.select({ id: atelierUsers.id, name: atelierUsers.name })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, orgId), eq(atelierUsers.id, requested), isNull(atelierUsers.deletedAt)));
  if (byId.length === 1) return { beneficiary: byId[0], ambiguous: false };
  const matches = await db.select({ id: atelierUsers.id, name: atelierUsers.name })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, orgId), ilike(atelierUsers.name, requested), isNull(atelierUsers.deletedAt)));
  return matches.length === 1
    ? { beneficiary: matches[0], ambiguous: false }
    : { beneficiary: null, ambiguous: matches.length > 1 };
}