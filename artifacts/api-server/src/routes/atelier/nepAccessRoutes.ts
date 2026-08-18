/**
 * Task #1297 — Non-Equity Partner access management.
 *
 * Founders/partners add or remove an NEP on an account (full-detail grant)
 * and invite or revoke an NEP on a specific opportunity (opportunity plus a
 * read-limited view of its parent account). Grants and invites are
 * soft-revoked and audited; re-adding after a revoke creates a fresh row.
 *
 * NEP-side visibility is enforced by lib/atelier-nep-access.ts through the
 * shared canSeeAccount / opportunity filters — these routes are the ONLY
 * write path for the grant tables.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierAuditEvents,
  atelierNepAccountGrants,
  atelierNepOppInvites,
  atelierOpportunities,
  atelierUsers,
} from "@workspace/db";
import { rid } from "../../lib/atelier-contracts.js";
import { isLeadership } from "./personaRoles";

const router: IRouter = Router();

function ensureLeader(req: Request, res: Response) {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!isLeadership(me.role)) {
    res.status(403).json({
      error: "partner-only",
      message: "Only founders/partners can manage non-equity partner access.",
    });
    return null;
  }
  return me;
}

async function loadNepUser(userId: string) {
  const [u] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, userId), isNull(atelierUsers.deletedAt)));
  if (!u || u.role !== "non_equity_partner") return null;
  return u;
}

async function audit(args: {
  me: { id: string; name: string };
  entityType: "account" | "opportunity";
  entityId: string;
  action: string;
  summary: string;
  payload: Record<string, unknown>;
}) {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.me.id,
    actorLabel: args.me.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ---------- account grants ----------

// List NEP grants on an account (leadership only; account page card).
// @cli-skip: leadership-only NEP access administration, not a chat surface
router.get("/accounts/:accountId/nep-access", async (req, res) => {
  const me = ensureLeader(req, res);
  if (!me) return;
  const rows = await db
    .select({
      id: atelierNepAccountGrants.id,
      userId: atelierNepAccountGrants.userId,
      createdAt: atelierNepAccountGrants.createdAt,
      createdByUserId: atelierNepAccountGrants.createdByUserId,
      userName: atelierUsers.name,
      userEmail: atelierUsers.email,
    })
    .from(atelierNepAccountGrants)
    .leftJoin(atelierUsers, eq(atelierUsers.id, atelierNepAccountGrants.userId))
    .where(
      and(
        eq(atelierNepAccountGrants.accountId, req.params.accountId as string),
        isNull(atelierNepAccountGrants.revokedAt),
      ),
    );
  // Also return the org's NEP logins so the add-picker needs no /users call.
  const neps = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.role, "non_equity_partner"), isNull(atelierUsers.deletedAt)));
  res.json({ grants: rows, nepUsers: neps });
});

// Grant an NEP full-detail access to an account. Idempotent.
// @cli-skip: leadership-only NEP access administration, not a chat surface
router.post("/accounts/:accountId/nep-access", async (req, res) => {
  const me = ensureLeader(req, res);
  if (!me) return;
  const accountId = req.params.accountId as string;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const [acct] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, accountId), isNull(atelierAccounts.deletedAt)));
  if (!acct) {
    res.status(404).json({ error: "account-not-found" });
    return;
  }
  const nepUser = userId ? await loadNepUser(userId) : null;
  if (!nepUser) {
    res.status(422).json({
      error: "not-a-nep-user",
      message: "userId must reference an active non-equity partner login.",
    });
    return;
  }
  const [existing] = await db
    .select({ id: atelierNepAccountGrants.id })
    .from(atelierNepAccountGrants)
    .where(
      and(
        eq(atelierNepAccountGrants.accountId, accountId),
        eq(atelierNepAccountGrants.userId, userId),
        isNull(atelierNepAccountGrants.revokedAt),
      ),
    );
  if (existing) {
    res.status(200).json({ ok: true, grantId: existing.id, alreadyGranted: true });
    return;
  }
  const id = rid("nepag");
  await db.insert(atelierNepAccountGrants).values({
    id,
    orgId: acct.orgId,
    userId,
    accountId,
    createdByUserId: me.id,
  });
  await audit({
    me,
    entityType: "account",
    entityId: accountId,
    action: "account.nep_access_granted",
    summary: `${me.name} granted ${nepUser.name} (non-equity partner) access to "${acct.brandName ?? acct.name}".`,
    payload: { grantId: id, userId, userName: nepUser.name },
  });
  res.status(201).json({ ok: true, grantId: id });
});

// Revoke an NEP's account grant (soft). Idempotent.
// @cli-skip: leadership-only NEP access administration, not a chat surface
router.delete("/accounts/:accountId/nep-access/:userId", async (req, res) => {
  const me = ensureLeader(req, res);
  if (!me) return;
  const accountId = req.params.accountId as string;
  const userId = req.params.userId as string;
  const rows = await db
    .update(atelierNepAccountGrants)
    .set({ revokedAt: new Date(), revokedByUserId: me.id })
    .where(
      and(
        eq(atelierNepAccountGrants.accountId, accountId),
        eq(atelierNepAccountGrants.userId, userId),
        isNull(atelierNepAccountGrants.revokedAt),
      ),
    )
    .returning({ id: atelierNepAccountGrants.id });
  if (rows.length > 0) {
    await audit({
      me,
      entityType: "account",
      entityId: accountId,
      action: "account.nep_access_revoked",
      summary: `${me.name} removed a non-equity partner's access to this account.`,
      payload: { userId, grantIds: rows.map((r) => r.id) },
    });
  }
  res.json({ ok: true, revoked: rows.length });
});

// ---------- opportunity invites ----------

// List NEP invites on an opportunity (leadership only; opportunity page).
// @cli-skip: leadership-only NEP access administration, not a chat surface
router.get("/opportunities/:oppId/nep-invites", async (req, res) => {
  const me = ensureLeader(req, res);
  if (!me) return;
  const rows = await db
    .select({
      id: atelierNepOppInvites.id,
      userId: atelierNepOppInvites.userId,
      createdAt: atelierNepOppInvites.createdAt,
      createdByUserId: atelierNepOppInvites.createdByUserId,
      userName: atelierUsers.name,
      userEmail: atelierUsers.email,
    })
    .from(atelierNepOppInvites)
    .leftJoin(atelierUsers, eq(atelierUsers.id, atelierNepOppInvites.userId))
    .where(
      and(
        eq(atelierNepOppInvites.opportunityId, req.params.oppId as string),
        isNull(atelierNepOppInvites.revokedAt),
      ),
    );
  const neps = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.role, "non_equity_partner"), isNull(atelierUsers.deletedAt)));
  res.json({ invites: rows, nepUsers: neps });
});

// Invite an NEP into an opportunity. Idempotent.
// @cli-skip: leadership-only NEP access administration, not a chat surface
router.post("/opportunities/:oppId/nep-invites", async (req, res) => {
  const me = ensureLeader(req, res);
  if (!me) return;
  const oppId = req.params.oppId as string;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, oppId), isNull(atelierOpportunities.deletedAt)));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const nepUser = userId ? await loadNepUser(userId) : null;
  if (!nepUser) {
    res.status(422).json({
      error: "not-a-nep-user",
      message: "userId must reference an active non-equity partner login.",
    });
    return;
  }
  const [existing] = await db
    .select({ id: atelierNepOppInvites.id })
    .from(atelierNepOppInvites)
    .where(
      and(
        eq(atelierNepOppInvites.opportunityId, oppId),
        eq(atelierNepOppInvites.userId, userId),
        isNull(atelierNepOppInvites.revokedAt),
      ),
    );
  if (existing) {
    res.status(200).json({ ok: true, inviteId: existing.id, alreadyInvited: true });
    return;
  }
  const id = rid("nepoi");
  await db.insert(atelierNepOppInvites).values({
    id,
    orgId: opp.orgId,
    userId,
    opportunityId: oppId,
    createdByUserId: me.id,
  });
  await audit({
    me,
    entityType: "opportunity",
    entityId: oppId,
    action: "opportunity.nep_invited",
    summary: `${me.name} invited ${nepUser.name} (non-equity partner) to "${opp.name}".`,
    payload: { inviteId: id, userId, userName: nepUser.name },
  });
  res.status(201).json({ ok: true, inviteId: id });
});

// Revoke an NEP's opportunity invite (soft). Idempotent.
// @cli-skip: leadership-only NEP access administration, not a chat surface
router.delete("/opportunities/:oppId/nep-invites/:userId", async (req, res) => {
  const me = ensureLeader(req, res);
  if (!me) return;
  const oppId = req.params.oppId as string;
  const userId = req.params.userId as string;
  const rows = await db
    .update(atelierNepOppInvites)
    .set({ revokedAt: new Date(), revokedByUserId: me.id })
    .where(
      and(
        eq(atelierNepOppInvites.opportunityId, oppId),
        eq(atelierNepOppInvites.userId, userId),
        isNull(atelierNepOppInvites.revokedAt),
      ),
    )
    .returning({ id: atelierNepOppInvites.id });
  if (rows.length > 0) {
    await audit({
      me,
      entityType: "opportunity",
      entityId: oppId,
      action: "opportunity.nep_invite_revoked",
      summary: `${me.name} revoked a non-equity partner's invite to this opportunity.`,
      payload: { userId, inviteIds: rows.map((r) => r.id) },
    });
  }
  res.json({ ok: true, revoked: rows.length });
});

export default router;
