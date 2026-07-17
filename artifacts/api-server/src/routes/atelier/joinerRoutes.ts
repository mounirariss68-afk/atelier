/**
 * Atelier — Task #50: HR joiner lifecycle.
 *
 * Add-joiner (POST /roster/joiners): one call creates the roster record
 * (atelier_employees or atelier_contractors), the atelier_users identity,
 * and a login credential with a one-time temporary password. The password
 * is returned exactly once in the response and never persisted in
 * plaintext; the credential is created with user_managed=true (the boot
 * seed must never overwrite it — see atelier-seed-auth.ts) and
 * must_change_password=true (first login forces a rotation).
 *
 * Deactivate / reactivate: reversible leaver switch on the credential's
 * `disabled` flag. Deactivation also revokes every live session. The
 * atelier_users row is left untouched so history, audit rows and
 * attributions keep resolving.
 *
 * All routes gate on hr | founding_partner and are org-scoped to the
 * actor's org.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierAuthCredentials,
  atelierAuditEvents,
} from "@workspace/db";
import {
  AtelierAddJoinerBody,
  AtelierListJoinersResponse,
  AtelierDeactivateJoinerResponse,
  AtelierReactivateJoinerResponse,
} from "@workspace/api-zod";
import { hashPassword } from "../../lib/auth/passwords";
import { revokeAllSessions } from "../../lib/auth/session";
import { personaToWire } from "./personaCookie";
import { isFoundingPartner, isHr } from "./personaRoles";
import { emitSelfNotification } from "./meRoutes";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureHrActor(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!isHr(me.role) && !isFoundingPartner(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Only HR or a founding partner can manage joiners and leavers.",
    });
    return null;
  }
  return me;
}

function audit(args: {
  actor: typeof atelierUsers.$inferSelect;
  action: string;
  entityId: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<unknown> {
  return db.insert(atelierAuditEvents).values({
    id: `audit_${randomUUID()}`,
    entityType: "joiner",
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

/** Same shape as the partner password-reset temp password (auth/index.ts). */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `Join-${out}`;
}

function initialsOf(fullName: string): string {
  return (
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase())
      .slice(0, 2)
      .join("") || "??"
  );
}

async function joinerWire(
  orgId: string,
  user: typeof atelierUsers.$inferSelect,
): Promise<{
  userId: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  title: string;
  status: "active" | "deactivated";
  mustChangePassword: boolean;
}> {
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.userId, user.id));
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleLabel: user.roleLabel,
    title: user.title,
    status: cred?.disabled ? "deactivated" : "active",
    mustChangePassword: cred?.mustChangePassword ?? false,
  };
}

// @cli-skip: HR admin surface; no CLI shape (Task #50)
router.get("/roster/joiners", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    // Only users who actually hold a login credential — this panel manages
    // access, not the full roster (that's /roster/people).
    const creds = await db.select().from(atelierAuthCredentials);
    const out = [];
    for (const c of creds) {
      const [u] = await db
        .select()
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.id, c.userId),
            eq(atelierUsers.orgId, me.orgId),
            isNull(atelierUsers.deletedAt),
          ),
        );
      if (!u) continue;
      out.push({
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        roleLabel: u.roleLabel,
        title: u.title,
        status: (c.disabled ? "deactivated" : "active") as "active" | "deactivated",
        mustChangePassword: c.mustChangePassword,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    res.json(AtelierListJoinersResponse.parse(out));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin mutation returning a one-time secret; no CLI shape (Task #50)
router.post("/roster/joiners", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const parsed = AtelierAddJoinerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const fullName = parsed.data.fullName.trim();
    const email = parsed.data.email.trim().toLowerCase();
    const workerType = parsed.data.workerType;
    const title =
      parsed.data.title?.trim() ||
      (workerType === "employee" ? "Employee" : "Contractor");
    const startDate = parsed.data.startDate?.trim() || null;
    if (!fullName || !email.includes("@")) {
      res.status(400).json({ error: "invalid-body", message: "A full name and a valid email are required." });
      return;
    }

    // Uniqueness: one login per email; one user row per email in this org.
    const [existingCred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, email));
    if (existingCred) {
      res.status(409).json({ error: "email-taken", message: "A login already exists for that email." });
      return;
    }
    const users = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.orgId, me.orgId), isNull(atelierUsers.deletedAt)));
    if (users.some((u) => u.email.trim().toLowerCase() === email)) {
      res.status(409).json({ error: "email-taken", message: "A user already exists with that email." });
      return;
    }

    const userId = rid("p_joiner");
    const role = workerType === "employee" ? "employee" : "contractor";
    const roleLabel = workerType === "employee" ? "Employee" : "Contractor";
    const tempPassword = generateTempPassword();
    let personId = "";

    // Atomic onboarding: identity + roster record + credential + audit +
    // welcome card commit together or not at all — no half-created joiners
    // if any step fails mid-way.
    await db.transaction(async (tx) => {
      await tx.insert(atelierUsers).values({
        id: userId,
        orgId: me.orgId,
        email,
        name: fullName,
        initials: initialsOf(fullName),
        role,
        roleLabel,
        title,
      });

      // Roster record, linked to the identity: employees by user_id FK,
      // contractors by email (their table has no user_id column — the same
      // rule resolveLinkedUserId / resolveSelfPerson use).
      if (workerType === "employee") {
        personId = rid("emp");
        await tx.insert(atelierEmployees).values({
          id: personId,
          orgId: me.orgId,
          userId,
          fullName,
          email,
          role,
          title,
          startDate,
        });
      } else {
        personId = rid("ct");
        await tx.insert(atelierContractors).values({
          id: personId,
          orgId: me.orgId,
          fullName,
          email,
          contractStart: startDate,
        });
      }

      await tx.insert(atelierAuthCredentials).values({
        email,
        userId,
        passwordHash: hashPassword(tempPassword),
        // user_managed=true: the boot seed must never overwrite this hash.
        userManaged: true,
        // First login forces an immediate password rotation.
        mustChangePassword: true,
      });

      await tx.insert(atelierAuditEvents).values({
        id: `audit_${randomUUID()}`,
        entityType: "joiner",
        entityId: userId,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "joiner_added",
        payload: { email, workerType, personId, title },
        payloadSummary: `${me.name} added ${workerType} ${fullName} (${email}) with a temporary login`,
      });

      // Welcome card on the new joiner's Me home.
      await emitSelfNotification(
        {
          orgId: me.orgId,
          userId,
          kind: "welcome",
          title: "Welcome to Cognirise",
          body: "Your workspace is ready. Start by reviewing your profile, then explore your Time and Expenses tabs.",
          href: "/me/profile",
        },
        tx,
      );
    });

    const [user] = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.id, userId));
    // No generated zod const for this response (orval skips 201-with-secret
    // shapes); the OpenAPI schema still types the client.
    res.status(201).json({
      user: personaToWire(user!),
      personId,
      tempPassword,
    });
  } catch (err) {
    next(err);
  }
});

async function setDisabled(
  req: Request,
  res: Response,
  disabled: boolean,
): Promise<void> {
  const me = ensureHrActor(req, res);
  if (!me) return;
  const userId = String(req.params.userId);
  if (userId === me.id) {
    res.status(400).json({
      error: "cannot-deactivate-self",
      message: "You cannot deactivate your own login.",
    });
    return;
  }
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.id, userId),
        eq(atelierUsers.orgId, me.orgId),
        isNull(atelierUsers.deletedAt),
      ),
    );
  if (!user) {
    res.status(404).json({ error: "not-found", message: "No such user." });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.userId, userId));
  if (!cred) {
    res.status(404).json({ error: "no-credential", message: "That user has no login to deactivate." });
    return;
  }
  // Only HR may not touch founders — deactivating a founding partner needs
  // to be another founding partner (two-founder firm; last-founder guard).
  if (user.role === "founding_partner" && !isFoundingPartner(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Only a founding partner can deactivate another founding partner.",
    });
    return;
  }
  await db
    .update(atelierAuthCredentials)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, cred.email));
  if (disabled) {
    // Kill every live session immediately — a leaver's open tab dies now.
    await revokeAllSessions(userId);
  }
  await audit({
    actor: me,
    action: disabled ? "leaver_deactivated" : "leaver_reactivated",
    entityId: userId,
    payload: { email: cred.email, disabled },
    summary: disabled
      ? `${me.name} deactivated the login for ${user.name} (${cred.email}) and revoked all sessions`
      : `${me.name} reactivated the login for ${user.name} (${cred.email})`,
  });
  const wire = await joinerWire(me.orgId, user);
  res.json(
    (disabled ? AtelierDeactivateJoinerResponse : AtelierReactivateJoinerResponse).parse(wire),
  );
}

// @cli-skip: HR admin mutation; no CLI shape (Task #50)
router.post("/roster/joiners/:userId/deactivate", (req, res, next) => {
  setDisabled(req, res, true).catch(next);
});

// @cli-skip: HR admin mutation; no CLI shape (Task #50)
router.post("/roster/joiners/:userId/reactivate", (req, res, next) => {
  setDisabled(req, res, false).catch(next);
});

export default router;
