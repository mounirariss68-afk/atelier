// ============================================================
// Task #631 — Unified Activity & Task timeline read model.
// ------------------------------------------------------------
// Assembles the account's first-class activities/tasks plus a merged,
// newest-first timeline that folds in human insights, logged meetings,
// opportunity stage moves, and agent runs that belong to the account
// (directly, or via one of its opportunities / engagements). Also produces
// the account's open-task roll-up with overdue flagging.
//
// Pure read helper: every write route rebuilds + returns this payload so the
// UI cache can be replaced in one shot (mirrors the account-plan pattern).
// ============================================================
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierActivities,
  atelierAccountInsights,
  atelierMeetings,
  atelierOpportunityStageTransitions,
  atelierAgentRuns,
  atelierOpportunities,
  atelierEngagements,
  atelierContacts,
  atelierUsers,
  atelierAgents,
} from "@workspace/db";

export type ActivityType = "task" | "call" | "email" | "meeting";
export type ActivityStatus = "open" | "done";
export type ActivityParentType = "account" | "contact" | "opportunity";

export interface ActivityWire {
  id: string;
  accountId: string;
  accountName: string | null;
  parentType: ActivityParentType;
  parentId: string;
  parentLabel: string | null;
  type: ActivityType;
  title: string;
  body: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string | null;
  dueDate: string | null;
  status: ActivityStatus;
  overdue: boolean;
  completedAt: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TimelineEntryKind =
  | "activity"
  | "insight"
  | "meeting"
  | "stage_move"
  | "agent_run";

export interface TimelineEntryWire {
  id: string;
  kind: TimelineEntryKind;
  subtype: string | null;
  title: string;
  detail: string | null;
  actorName: string | null;
  date: string;
  refKind: string | null;
  refId: string | null;
}

export interface AccountTimeline {
  accountId: string;
  activities: ActivityWire[];
  timeline: TimelineEntryWire[];
  openTasks: ActivityWire[];
  canManage?: boolean;
}

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  task: "Task",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
};
const INSIGHT_CATEGORY_LABEL: Record<string, string> = {
  relationship: "Relationship",
  risk: "Risk",
  competitive: "Competitive",
  opportunity: "Opportunity",
  general: "General",
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True when an open item's dueDate is strictly before today. */
export function isOverdue(
  status: string,
  dueDate: string | null | undefined,
): boolean {
  if (status !== "open" || !dueDate) return false;
  // dueDate is a free-text ISO-ish date; compare the YYYY-MM-DD prefix.
  return dueDate.slice(0, 10) < todayIso();
}

/**
 * Assemble the unified timeline + activity/task layer for an account.
 * `accountName` is stamped onto every activity (handy for cross-account
 * roll-ups; pass null when rendering inside a single account).
 */
export async function buildAccountTimeline(args: {
  accountId: string;
  accountName?: string | null;
}): Promise<AccountTimeline> {
  const { accountId } = args;
  const accountName = args.accountName ?? null;

  // Opportunities + engagements anchor the meeting / stage-move / agent-run
  // joins (those entities reference opportunity / engagement ids, not the
  // account directly).
  const [opps, engs] = await Promise.all([
    db
      .select({ id: atelierOpportunities.id, name: atelierOpportunities.name })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.accountId, accountId),
          isNull(atelierOpportunities.deletedAt),
        ),
      ),
    db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name })
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.accountId, accountId),
          isNull(atelierEngagements.deletedAt),
        ),
      ),
  ]);
  const oppIds = opps.map((o) => o.id);
  const engIds = engs.map((e) => e.id);
  const oppName = new Map(opps.map((o) => [o.id, o.name]));
  const engName = new Map(engs.map((e) => [e.id, e.name]));

  const [activityRows, insightRows, meetingRows, stageRows, runRows] =
    await Promise.all([
      db
        .select()
        .from(atelierActivities)
        .where(
          and(
            eq(atelierActivities.accountId, accountId),
            isNull(atelierActivities.deletedAt),
          ),
        )
        .orderBy(desc(atelierActivities.createdAt)),
      db
        .select()
        .from(atelierAccountInsights)
        .where(
          and(
            eq(atelierAccountInsights.accountId, accountId),
            isNull(atelierAccountInsights.deletedAt),
          ),
        )
        .orderBy(desc(atelierAccountInsights.createdAt)),
      oppIds.length || engIds.length
        ? db
            .select()
            .from(atelierMeetings)
            .where(
              and(
                inArray(atelierMeetings.parentId, [...oppIds, ...engIds]),
                isNull(atelierMeetings.deletedAt),
              ),
            )
            .orderBy(desc(atelierMeetings.createdAt))
        : Promise.resolve([] as (typeof atelierMeetings.$inferSelect)[]),
      oppIds.length
        ? db
            .select()
            .from(atelierOpportunityStageTransitions)
            .where(inArray(atelierOpportunityStageTransitions.opportunityId, oppIds))
            .orderBy(desc(atelierOpportunityStageTransitions.createdAt))
        : Promise.resolve(
            [] as (typeof atelierOpportunityStageTransitions.$inferSelect)[],
          ),
      (() => {
        const targets: Array<{ t: string; id: string }> = [
          { t: "account", id: accountId },
          ...oppIds.map((id) => ({ t: "opportunity", id })),
          ...engIds.map((id) => ({ t: "engagement", id })),
        ];
        const ids = targets.map((x) => x.id);
        return db
          .select()
          .from(atelierAgentRuns)
          .where(
            and(
              inArray(atelierAgentRuns.targetId, ids),
              isNull(atelierAgentRuns.deletedAt),
            ),
          )
          .orderBy(desc(atelierAgentRuns.createdAt));
      })(),
    ]);

  // Filter agent runs to the precise (targetType,targetId) pairs (the IN above
  // is broad because target ids could theoretically collide across types).
  const runTargetOk = (r: { targetType: string | null; targetId: string | null }) => {
    if (!r.targetId) return false;
    if (r.targetType === "account") return r.targetId === accountId;
    if (r.targetType === "opportunity") return oppIds.includes(r.targetId);
    if (r.targetType === "engagement") return engIds.includes(r.targetId);
    return false;
  };
  const runs = runRows.filter(runTargetOk);

  // Resolve names in batch: activity owners + creators, insight authors,
  // stage-move + meeting + agent-run actors, plus contact labels + agent names.
  const userIds = new Set<string>();
  for (const a of activityRows) {
    if (a.ownerId) userIds.add(a.ownerId);
    if (a.createdByUserId) userIds.add(a.createdByUserId);
  }
  for (const i of insightRows) userIds.add(i.authorId);
  for (const s of stageRows) if (s.transitionedByUserId) userIds.add(s.transitionedByUserId);
  for (const m of meetingRows) if (m.createdByUserId) userIds.add(m.createdByUserId);
  for (const r of runs) if (r.triggeredByUserId) userIds.add(r.triggeredByUserId);

  const contactParentIds = activityRows
    .filter((a) => a.parentType === "contact")
    .map((a) => a.parentId);

  const agentIds = Array.from(new Set(runs.map((r) => r.agentId)));

  const [users, contacts, agents] = await Promise.all([
    userIds.size
      ? db
          .select({ id: atelierUsers.id, name: atelierUsers.name, initials: atelierUsers.initials })
          .from(atelierUsers)
          .where(inArray(atelierUsers.id, Array.from(userIds)))
      : Promise.resolve([] as Array<{ id: string; name: string; initials: string | null }>),
    contactParentIds.length
      ? db
          .select({ id: atelierContacts.id, fullName: atelierContacts.fullName })
          .from(atelierContacts)
          .where(inArray(atelierContacts.id, contactParentIds))
      : Promise.resolve([] as Array<{ id: string; fullName: string }>),
    agentIds.length
      ? db
          .select({ id: atelierAgents.id, name: atelierAgents.name })
          .from(atelierAgents)
          .where(inArray(atelierAgents.id, agentIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const userName = (id: string | null | undefined) =>
    id ? users.find((u) => u.id === id)?.name ?? null : null;
  const userInitials = (id: string | null | undefined) => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u?.initials ?? initials(u?.name);
  };
  const contactName = (id: string) => contacts.find((c) => c.id === id)?.fullName ?? null;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  const parentLabel = (parentType: string, parentId: string): string | null => {
    if (parentType === "opportunity") return oppName.get(parentId) ?? null;
    if (parentType === "contact") return contactName(parentId);
    return null;
  };

  // ---- Activities (first-class) ----
  const activities: ActivityWire[] = activityRows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName,
    parentType: (r.parentType ?? "account") as ActivityParentType,
    parentId: r.parentId,
    parentLabel: parentLabel(r.parentType ?? "account", r.parentId),
    type: (r.type ?? "task") as ActivityType,
    title: r.title,
    body: r.body ?? null,
    ownerId: r.ownerId ?? null,
    ownerName: userName(r.ownerId),
    ownerInitials: userInitials(r.ownerId),
    dueDate: r.dueDate ?? null,
    status: (r.status ?? "open") as ActivityStatus,
    overdue: isOverdue(r.status ?? "open", r.dueDate),
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
    createdByUserId: r.createdByUserId ?? null,
    createdByName: userName(r.createdByUserId),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  }));

  // Open tasks roll-up: open activities, overdue-first, then by due date.
  const openTasks = activities
    .filter((a) => a.status === "open")
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const ad = a.dueDate ?? "9999-12-31";
      const bd = b.dueDate ?? "9999-12-31";
      if (ad !== bd) return ad.localeCompare(bd);
      return b.createdAt.localeCompare(a.createdAt);
    });

  // ---- Merged timeline ----
  const entries: TimelineEntryWire[] = [];

  for (const a of activities) {
    const owner = a.ownerName ? ` · ${a.ownerName}` : "";
    const where = a.parentLabel ? ` (${a.parentLabel})` : "";
    entries.push({
      id: `act:${a.id}`,
      kind: "activity",
      subtype: ACTIVITY_TYPE_LABEL[a.type] ?? a.type,
      title: a.title,
      detail:
        `${ACTIVITY_TYPE_LABEL[a.type] ?? a.type}${where}` +
        `${a.dueDate ? ` · due ${a.dueDate}` : ""}` +
        `${a.status === "done" ? " · done" : a.overdue ? " · overdue" : ""}` +
        owner,
      actorName: a.createdByName ?? a.ownerName,
      date: a.createdAt,
      refKind: "activity",
      refId: a.id,
    });
  }

  for (const i of insightRows) {
    entries.push({
      id: `ins:${i.id}`,
      kind: "insight",
      subtype: i.category ? INSIGHT_CATEGORY_LABEL[i.category] ?? i.category : null,
      title: i.body.length > 120 ? `${i.body.slice(0, 117)}…` : i.body,
      detail: i.category ? `${INSIGHT_CATEGORY_LABEL[i.category] ?? i.category} insight` : "Insight",
      actorName: userName(i.authorId),
      date: new Date(i.createdAt).toISOString(),
      refKind: "insight",
      refId: i.id,
    });
  }

  for (const m of meetingRows) {
    const parentNm =
      m.parentType === "opportunity"
        ? oppName.get(m.parentId)
        : engName.get(m.parentId);
    entries.push({
      id: `mtg:${m.id}`,
      kind: "meeting",
      subtype: m.kind ?? "meeting",
      title: m.title,
      detail:
        `${m.kind ?? "meeting"}${parentNm ? ` · ${parentNm}` : ""}` +
        `${m.date ? ` · ${m.date}` : ""}`,
      actorName: userName(m.createdByUserId),
      date: m.date
        ? new Date(m.date).toISOString()
        : new Date(m.createdAt).toISOString(),
      refKind: m.parentType,
      refId: m.parentId,
    });
  }

  for (const s of stageRows) {
    const nm = oppName.get(s.opportunityId);
    entries.push({
      id: `stg:${s.id}`,
      kind: "stage_move",
      subtype: s.toStage,
      title: `${nm ?? "Opportunity"} → ${s.toStage}`,
      detail:
        `${s.fromStage ? `${s.fromStage} → ` : "Created at "}${s.toStage}` +
        `${s.partnerOverride ? " · partner override" : ""}` +
        `${s.agentRecommended ? " · agent-recommended" : ""}`,
      actorName: userName(s.transitionedByUserId),
      date: new Date(s.createdAt).toISOString(),
      refKind: "opportunity",
      refId: s.opportunityId,
    });
  }

  for (const r of runs) {
    const targetNm =
      r.targetType === "opportunity"
        ? oppName.get(r.targetId ?? "")
        : r.targetType === "engagement"
          ? engName.get(r.targetId ?? "")
          : null;
    entries.push({
      id: `run:${r.id}`,
      kind: "agent_run",
      subtype: r.status ?? "run",
      title: `${agentName(r.agentId)}${r.status ? ` · ${r.status}` : ""}`,
      detail:
        `${r.targetLabel ?? targetNm ?? ""}` +
        `${r.confidence ? ` · ${r.confidence}` : ""}`.trim() || null,
      actorName: userName(r.triggeredByUserId) ?? agentName(r.agentId),
      date: new Date(r.createdAt).toISOString(),
      refKind: "agent_run",
      refId: r.id,
    });
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));

  return { accountId, activities, timeline: entries, openTasks };
}
