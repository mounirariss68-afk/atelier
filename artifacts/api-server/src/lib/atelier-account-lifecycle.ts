/**
 * Account lifecycle (Task #627).
 *
 * One source of truth for the three account lifecycle transitions, shared
 * by the HTTP routes (UI buttons) and the chat capabilities so both
 * surfaces behave identically:
 *
 *   - archiveAccount   — reversible. Sets status='archived' (keeps
 *                        deletedAt NULL so the workspace still resolves to
 *                        a read-only page) and cascades the account's open
 *                        opportunities (soft-delete) and active
 *                        engagements (plmStage→'closed') to a dormant
 *                        terminal state. The PRIOR state of every cascaded
 *                        child is recorded in the `account.archive` audit
 *                        payload so a later restore reverts precisely.
 *   - restoreAccount   — inverse of archive. Reads the most recent
 *                        `account.archive` audit event and reverts the
 *                        children it recorded, then flips status back to
 *                        'active'.
 *   - permanentlyDeleteAccount — the true destructive path. Soft-deletes
 *                        (stamps deletedAt, removing it from every list and
 *                        404-ing the workspace) AND purges every document
 *                        scoped to the account + its engagements. Blocked
 *                        when financial records (invoices / timesheets)
 *                        exist unless an explicit override is supplied.
 *
 * Every helper is org-scoped and idempotent: re-running a transition on a
 * target that is already in the destination state is a success no-op with
 * a human-readable status, never a raw not_found. Role gating lives in the
 * callers (route guards + capability requiredRoles), not here.
 */

import { and, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierEngagements,
  atelierOpportunities,
  atelierInvoice,
  atelierTimesheetEntries,
  atelierAuditEvents,
  atelierPaneAItems,
} from "@workspace/db";
import { purgeAttachmentsByScope } from "./atelier-cli/attachments/index.js";
import { purgeDocumentsByScope } from "./atelier-documents.js";

export interface LifecycleActor {
  id: string;
  name: string;
  orgId: string;
}

// Opportunity plmStage values that are already terminal — these are not
// cascaded by archive (they are already "done") and not reactivated on
// restore. Mirrors the openOpps filter in accountRoutes.summariseAccount.
const TERMINAL_OPP_STAGES = new Set(["contract", "lost", "no_decision", "withdrawn"]);
// Engagement plmStage that represents a closed engagement.
const ENGAGEMENT_CLOSED_STAGE = "closed";
// Task #8 — engagement stages that are already terminal. Archive must not
// clobber these (legacy rows may carry "won"/"lost"), and restore must not
// reactivate them. Mirrors the activeEngs filter in accountRoutes.
const ENGAGEMENT_TERMINAL_STAGES = ["closed", "won", "lost"];

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export interface LifecycleAccount {
  id: string;
  name: string;
  status: string;
  deletedAt: Date | null;
  orgId: string;
}

/**
 * Load an account by id WITHOUT filtering on deletedAt, so callers can
 * distinguish "already removed" (row exists, deletedAt set) from
 * "never existed / wrong tenant" (no row). Org-scoped.
 */
export async function loadAccountAnyState(
  orgId: string,
  accountId: string,
): Promise<LifecycleAccount | null> {
  const [row] = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      status: atelierAccounts.status,
      deletedAt: atelierAccounts.deletedAt,
      orgId: atelierAccounts.orgId,
    })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, accountId), eq(atelierAccounts.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * Count the financial records (invoices + timesheet entries) linked to an
 * account. Invoices link directly via accountId OR via one of the account's
 * engagements; timesheet entries link only via engagementId. Soft-deleted
 * rows are excluded. Used to block permanent deletion when money records
 * exist.
 */
export async function accountFinancialFootprint(
  orgId: string,
  accountId: string,
): Promise<{ invoices: number; timesheets: number; hasAny: boolean }> {
  const engRows = await db
    .select({ id: atelierEngagements.id })
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, accountId),
        eq(atelierEngagements.orgId, orgId),
      ),
    );
  const engIds = engRows.map((e) => e.id);

  const invoiceRows = await db
    .select({ id: atelierInvoice.id, accountId: atelierInvoice.accountId, engagementId: atelierInvoice.engagementId })
    .from(atelierInvoice)
    .where(and(eq(atelierInvoice.orgId, orgId), isNull(atelierInvoice.deletedAt)));
  const invoices = invoiceRows.filter(
    (r) =>
      r.accountId === accountId ||
      (r.engagementId != null && engIds.includes(r.engagementId)),
  ).length;

  let timesheets = 0;
  if (engIds.length > 0) {
    const tsRows = await db
      .select({ id: atelierTimesheetEntries.id })
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.orgId, orgId),
          isNull(atelierTimesheetEntries.deletedAt),
          inArray(atelierTimesheetEntries.engagementId, engIds),
        ),
      );
    timesheets = tsRows.length;
  }

  return { invoices, timesheets, hasAny: invoices + timesheets > 0 };
}

// Shape of the cascade snapshot stored in the account.archive audit payload
// and read back by restore.
interface ArchiveCascade {
  engagements: Array<{ id: string; priorStage: string }>;
  opportunities: string[];
}

async function writeAudit(
  actor: LifecycleActor,
  accountId: string,
  action: string,
  payload: Record<string, unknown>,
  summary: string,
): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: actor.orgId,
      entityType: "account",
      entityId: accountId,
      actorType: "human",
      actorId: actor.id,
      actorLabel: actor.name,
      action,
      payload,
      payloadSummary: summary,
    });
  } catch {
    // Audit must never break the write itself.
  }
}

export type ArchiveResult =
  | { status: "archived"; accountName: string; cascade: { engagements: number; opportunities: number } }
  | { status: "already_archived"; accountName: string }
  | { status: "not_found" };

/**
 * Reversible archive. Idempotent: archiving an already-archived account is a
 * success no-op.
 */
export async function archiveAccount(
  actor: LifecycleActor,
  accountId: string,
): Promise<ArchiveResult> {
  const acc = await loadAccountAnyState(actor.orgId, accountId);
  if (!acc || acc.deletedAt) return { status: "not_found" };
  if (acc.status === "archived") {
    return { status: "already_archived", accountName: acc.name };
  }

  const now = new Date();

  // Cascade: active engagements → closed (record prior stage for restore).
  const engRows = await db
    .select({ id: atelierEngagements.id, stage: atelierEngagements.plmStage })
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, acc.id),
        eq(atelierEngagements.orgId, actor.orgId),
        isNull(atelierEngagements.deletedAt),
        notInArray(atelierEngagements.plmStage, ENGAGEMENT_TERMINAL_STAGES),
      ),
    );
  for (const e of engRows) {
    await db
      .update(atelierEngagements)
      .set({ plmStage: ENGAGEMENT_CLOSED_STAGE, updatedAt: now })
      .where(and(eq(atelierEngagements.id, e.id), eq(atelierEngagements.orgId, actor.orgId)));
  }
  // Resolve dashboard (Pane A) cards pointing at the engagements we just
  // closed so "What needs me today" never keeps a card for a dormant
  // engagement (same pattern as the opportunity orphan defenses).
  if (engRows.length > 0) {
    await db
      .update(atelierPaneAItems)
      .set({ resolvedAt: now, updatedAt: now })
      .where(
        and(
          eq(atelierPaneAItems.orgId, actor.orgId),
          eq(atelierPaneAItems.hrefKind, "engagement"),
          inArray(
            atelierPaneAItems.hrefTargetId,
            engRows.map((e) => e.id),
          ),
          isNull(atelierPaneAItems.resolvedAt),
        ),
      );
  }

  // Cascade: open opportunities → soft-deleted (reversible via deletedAt).
  const oppRows = await db
    .select({ id: atelierOpportunities.id, stage: atelierOpportunities.salesStage })
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.accountId, acc.id),
        eq(atelierOpportunities.orgId, actor.orgId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const cascadedOppIds: string[] = [];
  for (const o of oppRows) {
    if (TERMINAL_OPP_STAGES.has(o.stage as string)) continue;
    await db
      .update(atelierOpportunities)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(atelierOpportunities.id, o.id), eq(atelierOpportunities.orgId, actor.orgId)));
    cascadedOppIds.push(o.id);
  }

  await db
    .update(atelierAccounts)
    .set({ status: "archived", updatedAt: now })
    .where(and(eq(atelierAccounts.id, acc.id), eq(atelierAccounts.orgId, actor.orgId)));

  const cascade: ArchiveCascade = {
    engagements: engRows.map((e) => ({ id: e.id, priorStage: e.stage as string })),
    opportunities: cascadedOppIds,
  };
  await writeAudit(
    actor,
    acc.id,
    "account.archive",
    { accountName: acc.name, cascade },
    `Archived account ${acc.name}`,
  );

  return {
    status: "archived",
    accountName: acc.name,
    cascade: { engagements: engRows.length, opportunities: cascadedOppIds.length },
  };
}

export type RestoreResult =
  | { status: "restored"; accountName: string; cascade: { engagements: number; opportunities: number } }
  | { status: "not_archived"; accountName: string }
  | { status: "not_found" };

/**
 * Inverse of archive. Reverts the cascaded children recorded in the most
 * recent account.archive audit event, then flips status back to active.
 * Idempotent: restoring a non-archived account is a success no-op.
 */
export async function restoreAccount(
  actor: LifecycleActor,
  accountId: string,
): Promise<RestoreResult> {
  const acc = await loadAccountAnyState(actor.orgId, accountId);
  if (!acc || acc.deletedAt) return { status: "not_found" };
  if (acc.status !== "archived") {
    return { status: "not_archived", accountName: acc.name };
  }

  const now = new Date();

  // Find the cascade snapshot from the latest archive event.
  const [evt] = await db
    .select({ payload: atelierAuditEvents.payload })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.orgId, actor.orgId),
        eq(atelierAuditEvents.entityType, "account"),
        eq(atelierAuditEvents.entityId, acc.id),
        eq(atelierAuditEvents.action, "account.archive"),
      ),
    )
    .orderBy(desc(atelierAuditEvents.createdAt))
    .limit(1);

  const cascade = ((evt?.payload as { cascade?: ArchiveCascade } | null)?.cascade) ?? {
    engagements: [],
    opportunities: [],
  };

  let engReverted = 0;
  for (const e of cascade.engagements ?? []) {
    // Only revert engagements we closed AND that are still closed (don't
    // clobber a stage a partner intentionally changed post-archive).
    const res = await db
      .update(atelierEngagements)
      .set({ plmStage: e.priorStage, updatedAt: now })
      .where(
        and(
          eq(atelierEngagements.id, e.id),
          eq(atelierEngagements.orgId, actor.orgId),
          eq(atelierEngagements.plmStage, ENGAGEMENT_CLOSED_STAGE),
        ),
      )
      .returning({ id: atelierEngagements.id });
    engReverted += res.length;
  }

  let oppReverted = 0;
  for (const oppId of cascade.opportunities ?? []) {
    const res = await db
      .update(atelierOpportunities)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(atelierOpportunities.id, oppId),
          eq(atelierOpportunities.orgId, actor.orgId),
        ),
      )
      .returning({ id: atelierOpportunities.id });
    oppReverted += res.length;
  }

  await db
    .update(atelierAccounts)
    .set({ status: "active", updatedAt: now })
    .where(and(eq(atelierAccounts.id, acc.id), eq(atelierAccounts.orgId, actor.orgId)));

  await writeAudit(
    actor,
    acc.id,
    "account.restore",
    { accountName: acc.name, reverted: { engagements: engReverted, opportunities: oppReverted } },
    `Restored account ${acc.name}`,
  );

  return {
    status: "restored",
    accountName: acc.name,
    cascade: { engagements: engReverted, opportunities: oppReverted },
  };
}

export type PermanentDeleteResult =
  | { status: "deleted"; accountName: string }
  | { status: "already_removed"; accountName: string }
  | { status: "blocked"; accountName: string; financial: { invoices: number; timesheets: number } }
  | { status: "not_found" };

/**
 * True destructive path. Soft-deletes (deletedAt) + purges documents.
 * Blocked when financial records exist unless `override` is true.
 * Idempotent: an already-removed account is a success no-op.
 */
export async function permanentlyDeleteAccount(
  actor: LifecycleActor,
  accountId: string,
  opts: { override?: boolean } = {},
): Promise<PermanentDeleteResult> {
  const acc = await loadAccountAnyState(actor.orgId, accountId);
  if (!acc) return { status: "not_found" };
  if (acc.deletedAt) return { status: "already_removed", accountName: acc.name };

  const footprint = await accountFinancialFootprint(actor.orgId, acc.id);
  if (footprint.hasAny && !opts.override) {
    return {
      status: "blocked",
      accountName: acc.name,
      financial: { invoices: footprint.invoices, timesheets: footprint.timesheets },
    };
  }

  const now = new Date();
  await db
    .update(atelierAccounts)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(atelierAccounts.id, acc.id), eq(atelierAccounts.orgId, actor.orgId)));

  await writeAudit(
    actor,
    acc.id,
    "account.delete",
    {
      accountName: acc.name,
      override: opts.override === true,
      financial: { invoices: footprint.invoices, timesheets: footprint.timesheets },
    },
    `Permanently deleted account ${acc.name}`,
  );

  // Parent-entity deletion lifecycle: purge every document scoped to the
  // account, plus documents scoped to the account's engagements (engagements
  // are only ever closed, never hard-deleted, so their docs are reclaimed via
  // the owning account's deletion). Removes blobs + chunk vectors so retrieval
  // can never surface a document whose parent no longer exists.
  const engRows = await db
    .select({ id: atelierEngagements.id })
    .from(atelierEngagements)
    .where(
      and(eq(atelierEngagements.accountId, acc.id), eq(atelierEngagements.orgId, actor.orgId)),
    );
  await purgeAttachmentsByScope({
    orgId: actor.orgId,
    accountId: acc.id,
    actorId: actor.id,
    actorLabel: actor.name,
  });
  for (const eng of engRows) {
    await purgeAttachmentsByScope({
      orgId: actor.orgId,
      engagementId: eng.id,
      actorId: actor.id,
      actorLabel: actor.name,
    });
  }

  // Task #61 — Document Library: purge library documents (metadata,
  // versions, blobs, chunk vectors) scoped to this account or any of
  // its engagements.
  await purgeDocumentsByScope({
    orgId: actor.orgId,
    accountId: acc.id,
    actorId: actor.id,
    actorLabel: actor.name,
  });
  for (const eng of engRows) {
    await purgeDocumentsByScope({
      orgId: actor.orgId,
      engagementId: eng.id,
      actorId: actor.id,
      actorLabel: actor.name,
    });
  }

  return { status: "deleted", accountName: acc.name };
}
