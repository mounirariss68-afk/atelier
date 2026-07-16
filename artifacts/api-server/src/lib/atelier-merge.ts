/**
 * Atelier — record merge (Task #640).
 *
 * Consolidates a duplicate account/contact into a chosen "survivor" record.
 * Task #632 added duplicate DETECTION (warn-and-link only); this is the
 * follow-up that lets a partner actually merge two records that turned out to
 * be the same entity.
 *
 * Merge semantics (both kinds):
 *   - Every child row that points at the duplicate is re-pointed to the
 *     survivor, so opportunities, contacts, engagements, activities, audit
 *     history, etc. are reunited under one record instead of staying split.
 *   - The duplicate is then SOFT-deleted (deletedAt stamped) — never hard
 *     deleted — so the merge is auditable and the duplicate drops out of every
 *     list / 404s its workspace exactly like an archived/deleted record.
 *   - A single `*.merge` audit event is written against the survivor recording
 *     what was absorbed and the per-table re-point counts.
 *
 * Every helper is org-scoped and idempotent: re-running a merge whose duplicate
 * is already removed is a success no-op (`already_merged`), never a raw crash.
 * Role gating lives in the callers (route guards), not here.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierContactRelationships,
  atelierOpportunities,
  atelierEngagements,
  atelierAccountInsights,
  atelierAccountTeamMembers,
  atelierAccountActions,
  atelierAccountRisks,
  atelierAccountGoalProgress,
  atelierActivities,
  atelierSalonWorkspaces,
  atelierSalonUsers,
  atelierInvoice,
  atelierCredentials,
  atelierAuditEvents,
  atelierAgentRuns,
} from "@workspace/db";

export interface MergeActor {
  id: string;
  name: string;
  orgId: string;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// Per-table re-point counts, surfaced to the caller + recorded in the audit
// payload so a partner can see exactly what the merge moved.
export type MergeCounts = Record<string, number>;

async function writeAudit(
  actor: MergeActor,
  entityType: "account" | "contact",
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  summary: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0] = db as never,
): Promise<void> {
  try {
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: actor.orgId,
      entityType,
      entityId,
      actorType: "human",
      actorId: actor.id,
      actorLabel: actor.name,
      action,
      payload,
      payloadSummary: summary,
    });
  } catch {
    // Audit must never break the merge itself.
  }
}

// ---------------------------------------------------------------------------
// ACCOUNT MERGE
// ---------------------------------------------------------------------------

export type MergeAccountResult =
  | {
      status: "merged";
      survivorName: string;
      duplicateName: string;
      counts: MergeCounts;
    }
  | { status: "already_merged"; survivorName: string; duplicateName: string }
  | { status: "same_record" }
  | { status: "not_found" };

interface MergeAccountRow {
  id: string;
  name: string;
  status: string;
  deletedAt: Date | null;
  orgId: string;
  parentAccountId: string | null;
}

async function loadAccountForMerge(
  orgId: string,
  id: string,
): Promise<MergeAccountRow | null> {
  const [row] = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      status: atelierAccounts.status,
      deletedAt: atelierAccounts.deletedAt,
      orgId: atelierAccounts.orgId,
      parentAccountId: atelierAccounts.parentAccountId,
    })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, id), eq(atelierAccounts.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * Merge `duplicateId` into `survivorId`. Both must be live accounts in the
 * actor's org. Re-points every child table that references the duplicate to the
 * survivor, fixes hierarchy pointers, then soft-deletes the duplicate.
 */
export async function mergeAccounts(
  actor: MergeActor,
  survivorId: string,
  duplicateId: string,
): Promise<MergeAccountResult> {
  if (survivorId === duplicateId) return { status: "same_record" };

  const survivor = await loadAccountForMerge(actor.orgId, survivorId);
  const duplicate = await loadAccountForMerge(actor.orgId, duplicateId);
  if (!survivor || !duplicate) return { status: "not_found" };
  // Survivor must be live; a soft-deleted survivor cannot absorb records.
  if (survivor.deletedAt) return { status: "not_found" };
  // Idempotent: the duplicate is already gone → nothing to do.
  if (duplicate.deletedAt) {
    return {
      status: "already_merged",
      survivorName: survivor.name,
      duplicateName: duplicate.name,
    };
  }

  const now = new Date();
  const counts: MergeCounts = {};

  await db.transaction(async (tx) => {
    const repoint = async (
      label: string,
      table:
        | typeof atelierContacts
        | typeof atelierContactRelationships
        | typeof atelierOpportunities
        | typeof atelierEngagements
        | typeof atelierAccountInsights
        | typeof atelierAccountTeamMembers
        | typeof atelierAccountActions
        | typeof atelierAccountRisks
        | typeof atelierAccountGoalProgress
        | typeof atelierActivities
        | typeof atelierSalonWorkspaces
        | typeof atelierSalonUsers
        | typeof atelierInvoice
        | typeof atelierCredentials,
    ) => {
      const moved = await tx
        .update(table)
        .set({ accountId: survivorId })
        .where(
          and(
            eq(table.accountId, duplicateId),
            eq(table.orgId, actor.orgId),
          ),
        )
        .returning({ id: table.id });
      if (moved.length > 0) counts[label] = moved.length;
    };

    await repoint("contacts", atelierContacts);
    await repoint("contactRelationships", atelierContactRelationships);
    await repoint("opportunities", atelierOpportunities);
    await repoint("engagements", atelierEngagements);
    await repoint("insights", atelierAccountInsights);
    await repoint("teamMembers", atelierAccountTeamMembers);
    await repoint("actions", atelierAccountActions);
    await repoint("risks", atelierAccountRisks);
    await repoint("goalProgress", atelierAccountGoalProgress);
    await repoint("activities", atelierActivities);
    // Account-scoped activities also carry the account id in parentId (the
    // schema invariant: parentId === accountId when parentType="account").
    // Re-point it too, otherwise the moved rows dangle at the soft-deleted
    // duplicate and break parentType/parentId reads.
    await tx
      .update(atelierActivities)
      .set({ parentId: survivorId })
      .where(
        and(
          eq(atelierActivities.orgId, actor.orgId),
          eq(atelierActivities.parentType, "account"),
          eq(atelierActivities.parentId, duplicateId),
        ),
      );
    await repoint("salonWorkspaces", atelierSalonWorkspaces);
    await repoint("salonUsers", atelierSalonUsers);
    await repoint("invoices", atelierInvoice);
    // Task #8 — credentials (case studies) reference accounts too; without
    // this they dangle at the soft-deleted duplicate and vanish from the
    // survivor's credential library.
    await repoint("credentials", atelierCredentials);

    // Hierarchy: any account whose parent is the duplicate now points at the
    // survivor, so the family tree stays intact.
    const reparented = await tx
      .update(atelierAccounts)
      .set({ parentAccountId: survivorId, updatedAt: now })
      .where(
        and(
          eq(atelierAccounts.parentAccountId, duplicateId),
          eq(atelierAccounts.orgId, actor.orgId),
        ),
      )
      .returning({ id: atelierAccounts.id });
    if (reparented.length > 0) counts.childAccounts = reparented.length;

    // Audit history + agent runs for the duplicate now belong to the survivor.
    const auditMoved = await tx
      .update(atelierAuditEvents)
      .set({ entityId: survivorId })
      .where(
        and(
          eq(atelierAuditEvents.orgId, actor.orgId),
          eq(atelierAuditEvents.entityType, "account"),
          eq(atelierAuditEvents.entityId, duplicateId),
        ),
      )
      .returning({ id: atelierAuditEvents.id });
    if (auditMoved.length > 0) counts.auditEvents = auditMoved.length;

    const runsMoved = await tx
      .update(atelierAgentRuns)
      .set({ targetId: survivorId })
      .where(
        and(
          eq(atelierAgentRuns.orgId, actor.orgId),
          eq(atelierAgentRuns.targetType, "account"),
          eq(atelierAgentRuns.targetId, duplicateId),
        ),
      )
      .returning({ id: atelierAgentRuns.id });
    if (runsMoved.length > 0) counts.agentRuns = runsMoved.length;

    // Guard: the survivor must never end up parented by the duplicate it just
    // absorbed (which is about to be soft-deleted) — that would dangle.
    if (survivor.parentAccountId === duplicateId) {
      await tx
        .update(atelierAccounts)
        .set({
          parentAccountId: duplicate.parentAccountId ?? null,
          updatedAt: now,
        })
        .where(eq(atelierAccounts.id, survivorId));
    }

    // Soft-delete the duplicate.
    await tx
      .update(atelierAccounts)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(atelierAccounts.id, duplicateId), eq(atelierAccounts.orgId, actor.orgId)));

    await writeAudit(
      actor,
      "account",
      survivorId,
      "account.merge",
      {
        survivorId,
        survivorName: survivor.name,
        duplicateId,
        duplicateName: duplicate.name,
        counts,
      },
      `${actor.name} merged "${duplicate.name}" into "${survivor.name}".`,
      tx,
    );
  });

  return {
    status: "merged",
    survivorName: survivor.name,
    duplicateName: duplicate.name,
    counts,
  };
}

// ---------------------------------------------------------------------------
// CONTACT MERGE
// ---------------------------------------------------------------------------

export type MergeContactResult =
  | {
      status: "merged";
      accountId: string;
      survivorName: string;
      duplicateName: string;
      counts: MergeCounts;
    }
  | {
      status: "already_merged";
      accountId: string;
      survivorName: string;
      duplicateName: string;
    }
  | { status: "same_record" }
  | { status: "different_accounts" }
  | { status: "not_found" };

interface MergeContactRow {
  id: string;
  fullName: string;
  accountId: string;
  orgId: string;
  deletedAt: Date | null;
}

async function loadContactForMerge(
  orgId: string,
  id: string,
): Promise<MergeContactRow | null> {
  const [row] = await db
    .select({
      id: atelierContacts.id,
      fullName: atelierContacts.fullName,
      accountId: atelierContacts.accountId,
      orgId: atelierContacts.orgId,
      deletedAt: atelierContacts.deletedAt,
    })
    .from(atelierContacts)
    .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * Merge `duplicateId` into `survivorId`. Both contacts must live on the SAME
 * account (a contact cannot be merged across accounts). Re-points relationship
 * edges + activities + audit history, dropping any self-loop edge the re-point
 * would create, then soft-deletes the duplicate contact.
 */
export async function mergeContacts(
  actor: MergeActor,
  survivorId: string,
  duplicateId: string,
): Promise<MergeContactResult> {
  if (survivorId === duplicateId) return { status: "same_record" };

  const survivor = await loadContactForMerge(actor.orgId, survivorId);
  const duplicate = await loadContactForMerge(actor.orgId, duplicateId);
  if (!survivor || !duplicate) return { status: "not_found" };
  if (survivor.deletedAt) return { status: "not_found" };
  if (survivor.accountId !== duplicate.accountId) {
    return { status: "different_accounts" };
  }
  if (duplicate.deletedAt) {
    return {
      status: "already_merged",
      accountId: survivor.accountId,
      survivorName: survivor.fullName,
      duplicateName: duplicate.fullName,
    };
  }

  const now = new Date();
  const counts: MergeCounts = {};
  const accountId = survivor.accountId;

  await db.transaction(async (tx) => {
    // Relationship edges: re-point both endpoints to the survivor.
    const fromMoved = await tx
      .update(atelierContactRelationships)
      .set({ fromContactId: survivorId })
      .where(
        and(
          eq(atelierContactRelationships.orgId, actor.orgId),
          eq(atelierContactRelationships.fromContactId, duplicateId),
        ),
      )
      .returning({ id: atelierContactRelationships.id });
    const toMoved = await tx
      .update(atelierContactRelationships)
      .set({ toContactId: survivorId })
      .where(
        and(
          eq(atelierContactRelationships.orgId, actor.orgId),
          eq(atelierContactRelationships.toContactId, duplicateId),
        ),
      )
      .returning({ id: atelierContactRelationships.id });
    const relMoved = fromMoved.length + toMoved.length;
    if (relMoved > 0) counts.relationships = relMoved;

    // Re-pointing can create a self-loop (an edge from the survivor to itself)
    // when the two contacts were already related — soft-delete those.
    const selfLoops = await tx
      .update(atelierContactRelationships)
      .set({ deletedAt: now })
      .where(
        and(
          eq(atelierContactRelationships.orgId, actor.orgId),
          eq(atelierContactRelationships.fromContactId, survivorId),
          eq(atelierContactRelationships.toContactId, survivorId),
          isNull(atelierContactRelationships.deletedAt),
        ),
      )
      .returning({ id: atelierContactRelationships.id });
    if (selfLoops.length > 0) counts.droppedSelfEdges = selfLoops.length;

    // Activities whose parent is the duplicate contact follow the survivor.
    const actMoved = await tx
      .update(atelierActivities)
      .set({ parentId: survivorId })
      .where(
        and(
          eq(atelierActivities.orgId, actor.orgId),
          eq(atelierActivities.parentType, "contact"),
          eq(atelierActivities.parentId, duplicateId),
        ),
      )
      .returning({ id: atelierActivities.id });
    if (actMoved.length > 0) counts.activities = actMoved.length;

    // Audit history for the duplicate contact now belongs to the survivor.
    const auditMoved = await tx
      .update(atelierAuditEvents)
      .set({ entityId: survivorId })
      .where(
        and(
          eq(atelierAuditEvents.orgId, actor.orgId),
          eq(atelierAuditEvents.entityType, "contact"),
          eq(atelierAuditEvents.entityId, duplicateId),
        ),
      )
      .returning({ id: atelierAuditEvents.id });
    if (auditMoved.length > 0) counts.auditEvents = auditMoved.length;

    // Soft-delete the duplicate contact.
    await tx
      .update(atelierContacts)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(atelierContacts.id, duplicateId), eq(atelierContacts.orgId, actor.orgId)));

    // Contact-merge history lives on the OWNING ACCOUNT's audit feed (mirrors
    // contact create/delete, which are account-scoped events).
    await writeAudit(
      actor,
      "account",
      accountId,
      "contact.merge",
      {
        accountId,
        survivorId,
        survivorName: survivor.fullName,
        duplicateId,
        duplicateName: duplicate.fullName,
        counts,
      },
      `${actor.name} merged contact "${duplicate.fullName}" into "${survivor.fullName}".`,
      tx,
    );
  });

  return {
    status: "merged",
    accountId,
    survivorName: survivor.fullName,
    duplicateName: duplicate.fullName,
    counts,
  };
}
