// ============================================================
// Task #571 — Account planning & execution layer.
// ------------------------------------------------------------
// Read helpers that assemble the account plan (action plan, account risk
// register, and goal progress) from the three Task #571 stores plus the
// strategy objectives that live on atelier_accounts.account_strategy.
// These are surfaced inside the account workspace and the account-plan PDF.
// ============================================================
import { and, asc, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierAccountActions,
  atelierAccountRisks,
  atelierAccountGoalProgress,
  atelierUsers,
} from "@workspace/db";

export type AccountActionStatus =
  | "open"
  | "in_progress"
  | "done"
  | "cancelled";
export type AccountActionPriority = "high" | "medium" | "low";
export type AccountRiskKind = "risk" | "assumption" | "issue" | "dependency";
export type AccountRiskSeverity = "green" | "amber" | "red";
export type AccountRiskStatus = "open" | "mitigating" | "closed";
export type AccountGoalStatus =
  | "on_track"
  | "at_risk"
  | "off_track"
  | "achieved";

export interface AccountActionWire {
  id: string;
  accountId: string;
  title: string;
  detail: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string | null;
  status: AccountActionStatus;
  priority: AccountActionPriority;
  dueDate: string | null;
  linkedObjectiveId: string | null;
  linkedObjectiveText: string | null;
  linkedPlay: string | null;
  source: "manual" | "promoted";
  sourceRef: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRiskWire {
  id: string;
  accountId: string;
  kind: AccountRiskKind;
  severity: AccountRiskSeverity;
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string | null;
  status: AccountRiskStatus;
  dueDate: string | null;
  description: string;
  mitigation: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountGoalProgressWire {
  // The strategy objective id (stable key). Progress may not yet exist.
  objectiveId: string;
  text: string;
  targetValue: string | null;
  targetDate: string | null;
  // Live progress (null when the team has not recorded any yet).
  currentValue: string | null;
  status: AccountGoalStatus;
  note: string | null;
  updatedAt: string | null;
}

export interface AccountPlan {
  actionPlan: AccountActionWire[];
  riskRegister: AccountRiskWire[];
  goalProgress: AccountGoalProgressWire[];
}

type StrategyObjective = {
  id: string;
  text: string;
  targetValue?: string | null;
  targetDate?: string | null;
};

const ACTION_PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const RISK_SEVERITY_ORDER: Record<string, number> = {
  red: 0,
  amber: 1,
  green: 2,
};

function initials(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Assemble the full account plan for an account. Pass the account's
 * `account_strategy.objectives` so goal progress can be joined to the
 * objective text / target without a second account read.
 */
export async function buildAccountPlan(args: {
  accountId: string;
  objectives: StrategyObjective[];
}): Promise<AccountPlan> {
  const { accountId, objectives } = args;

  const [actionRows, riskRows, progressRows] = await Promise.all([
    db
      .select()
      .from(atelierAccountActions)
      .where(
        and(
          eq(atelierAccountActions.accountId, accountId),
          isNull(atelierAccountActions.deletedAt),
        ),
      )
      .orderBy(desc(atelierAccountActions.createdAt)),
    db
      .select()
      .from(atelierAccountRisks)
      .where(
        and(
          eq(atelierAccountRisks.accountId, accountId),
          isNull(atelierAccountRisks.deletedAt),
        ),
      )
      .orderBy(desc(atelierAccountRisks.createdAt)),
    db
      .select()
      .from(atelierAccountGoalProgress)
      .where(
        and(
          eq(atelierAccountGoalProgress.accountId, accountId),
          isNull(atelierAccountGoalProgress.deletedAt),
        ),
      )
      .orderBy(asc(atelierAccountGoalProgress.createdAt)),
  ]);

  // Resolve owner names for actions + risks in one query.
  const ownerIds = Array.from(
    new Set(
      [
        ...actionRows.map((r) => r.ownerId),
        ...riskRows.map((r) => r.ownerId),
      ].filter((x): x is string => !!x),
    ),
  );
  const owners = ownerIds.length
    ? await db
        .select({ id: atelierUsers.id, name: atelierUsers.name, initials: atelierUsers.initials })
        .from(atelierUsers)
        .where(inArray(atelierUsers.id, ownerIds))
    : [];
  const ownerName = (id: string | null) =>
    id ? owners.find((u) => u.id === id)?.name ?? null : null;
  const ownerInitials = (id: string | null) => {
    if (!id) return null;
    const u = owners.find((x) => x.id === id);
    return u?.initials ?? initials(u?.name);
  };

  const objectiveById = new Map(objectives.map((o) => [o.id, o]));

  const actionPlan: AccountActionWire[] = actionRows
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      title: r.title,
      detail: r.detail ?? null,
      ownerId: r.ownerId ?? null,
      ownerName: ownerName(r.ownerId ?? null),
      ownerInitials: ownerInitials(r.ownerId ?? null),
      status: (r.status ?? "open") as AccountActionStatus,
      priority: (r.priority ?? "medium") as AccountActionPriority,
      dueDate: r.dueDate ?? null,
      linkedObjectiveId: r.linkedObjectiveId ?? null,
      linkedObjectiveText: r.linkedObjectiveId
        ? objectiveById.get(r.linkedObjectiveId)?.text ?? null
        : null,
      linkedPlay: r.linkedPlay ?? null,
      source: (r.source ?? "manual") as "manual" | "promoted",
      sourceRef: r.sourceRef ?? null,
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }))
    .sort((a, b) => {
      // Open work first, then by priority, then newest.
      const aDone = a.status === "done" || a.status === "cancelled";
      const bDone = b.status === "done" || b.status === "cancelled";
      if (aDone !== bDone) return aDone ? 1 : -1;
      const pa = ACTION_PRIORITY_ORDER[a.priority] ?? 1;
      const pb = ACTION_PRIORITY_ORDER[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const riskRegister: AccountRiskWire[] = riskRows
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      kind: (r.kind ?? "risk") as AccountRiskKind,
      severity: (r.severity ?? "amber") as AccountRiskSeverity,
      ownerId: r.ownerId ?? null,
      ownerName: ownerName(r.ownerId ?? null),
      ownerInitials: ownerInitials(r.ownerId ?? null),
      status: (r.status ?? "open") as AccountRiskStatus,
      dueDate: r.dueDate ?? null,
      description: r.description,
      mitigation: r.mitigation ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }))
    .sort((a, b) => {
      // Open risks first, then by severity, then newest.
      const aClosed = a.status === "closed";
      const bClosed = b.status === "closed";
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      const sa = RISK_SEVERITY_ORDER[a.severity] ?? 1;
      const sb = RISK_SEVERITY_ORDER[b.severity] ?? 1;
      if (sa !== sb) return sa - sb;
      return b.createdAt.localeCompare(a.createdAt);
    });

  // Goal progress: one row per strategy objective (preserving strategy order),
  // joined to live progress where it exists.
  const progressByObjective = new Map(
    progressRows.map((r) => [r.objectiveId, r]),
  );
  const goalProgress: AccountGoalProgressWire[] = objectives.map((o) => {
    const p = progressByObjective.get(o.id);
    return {
      objectiveId: o.id,
      text: o.text,
      targetValue: o.targetValue ?? null,
      targetDate: o.targetDate ?? null,
      currentValue: p?.currentValue ?? null,
      status: (p?.status ?? "on_track") as AccountGoalStatus,
      note: p?.note ?? null,
      updatedAt: p ? new Date(p.updatedAt).toISOString() : null,
    };
  });

  return { actionPlan, riskRegister, goalProgress };
}
