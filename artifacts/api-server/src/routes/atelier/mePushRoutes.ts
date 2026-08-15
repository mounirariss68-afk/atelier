/**
 * Task #1010 — device push token registration (Me lens, self-scope).
 *
 * The Expo mobile app opts a user in to reminder pushes by registering
 * its Expo push token here; opting out (or logging out) removes it.
 * Strictly self-scope: every write predicates on org + userId, and a
 * token registered by one user is re-owned on re-register (a device
 * that switches accounts must never keep pushing to the old owner).
 *
 * Not in the openapi spec (bespoke mobile-only surface) — the mobile
 * app uses raw fetch, matching /me/self-billing and /me/letters.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, atelierPushTokens } from "@workspace/db";
import type { atelierUsers } from "@workspace/db";
import { isExpoPushToken } from "../../lib/expoPush.js";

const router: Router = Router();
export default router;

type UserRow = typeof atelierUsers.$inferSelect;

function ensurePersona(req: any, res: any): UserRow | null {
  const me = req.atelierPersona as UserRow | undefined;
  if (!me) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  // Task #1173 — push-token registration is a mobile-only device surface,
  // and alliance_partner accounts are web-portal only. The central atelier
  // gate already 403s this role from any `/me/…` sub-path (it allows only
  // exact `/me`), so a partner can never reach here even by faking a "web"
  // client flag at login. This is a defense-in-depth restatement of that
  // boundary at the route itself: a mobile-only privilege must NEVER be
  // grantable to a partner, regardless of how the gate evolves.
  if (me.role === "alliance_partner") {
    res.status(403).json({
      error: "portal-web-only",
      message: "Partner accounts use the web portal — mobile device features are not available.",
    });
    return null;
  }
  return me;
}

// @cli-skip: device plumbing — parity-excluded (me-chat-parity.ts)
router.post("/me/push-tokens", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const platform = req.body?.platform === "ios" || req.body?.platform === "android" ? req.body.platform : "unknown";
    if (!token || !isExpoPushToken(token)) {
      res.status(400).json({ error: "invalid-body", detail: "token must be an Expo push token" });
      return;
    }
    // Upsert re-owns the token: a device that logs into a different
    // account moves its pushes to the new user.
    await db
      .insert(atelierPushTokens)
      .values({ token, orgId: me.orgId, userId: me.id, platform })
      .onConflictDoUpdate({
        target: atelierPushTokens.token,
        set: { orgId: me.orgId, userId: me.id, platform, updatedAt: new Date() },
      });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: device plumbing — parity-excluded (me-chat-parity.ts)
router.delete("/me/push-tokens", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      res.status(400).json({ error: "invalid-body", detail: "token required" });
      return;
    }
    // Ownership-in-WHERE: deleting someone else's token is a silent no-op.
    await db
      .delete(atelierPushTokens)
      .where(and(eq(atelierPushTokens.token, token), eq(atelierPushTokens.userId, me.id), eq(atelierPushTokens.orgId, me.orgId)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
