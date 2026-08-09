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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sendJoinerWelcomeEmail } from "../../lib/atelier-welcome-email";
import { trustedRequestOrigin } from "../../lib/auth/trusted-origin";
import { and, desc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierAccounts,
  atelierOpportunities,
  atelierActivities,
  atelierAuthCredentials,
  atelierAuditEvents,
  atelierLoginActivationTokens,
} from "@workspace/db";
import {
  AtelierAddJoinerBody,
  AtelierListJoinersResponse,
  AtelierDeactivateJoinerBody,
  AtelierDeactivateJoinerResponse,
  AtelierReactivateJoinerResponse,
  AtelierGetLeaverHandoverResponse,
  AtelierReassignLeaverItemsBody,
  AtelierReassignLeaverItemsResponse,
} from "@workspace/api-zod";
// Task #538 — unified person model: joiner names resolve to a structured
// person record; legacy fullName/initials are recomputed mirrors.
import {
  resolveStructuredNameInput,
  composeFullName,
  computeInitials,
  PersonNameValidationError,
  type StructuredName,
} from "../../lib/atelier-person-model";
import { writePerson } from "../../lib/atelier-person-sync";
import { hashPassword } from "../../lib/auth/passwords";
import { revokeAllSessions } from "../../lib/auth/session";
import { personaToWire } from "./personaCookie";
import { isFoundingPartner, isHr } from "./personaRoles";
import { emitSelfNotification } from "./meRoutes";
import { autoRevokeDelegationsForUser } from "./delegationRoutes";
import { createEosbSettlement } from "../../lib/atelier-payroll/payrollRun.js";
import {
  deprovisionMs,
  reactivateMs,
  ensureProvisioningRow,
  launchProvisioning,
  defaultProfileForWorkerType,
} from "../../lib/atelier-ms-provisioning";

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
    // Task #538 — structured name fields win when present; a bare fullName
    // is parsed through the shared particle/honorific parser. One of the
    // two must be provided.
    let structured: StructuredName | null = null;
    try {
      structured = resolveStructuredNameInput({
        fullName: parsed.data.fullName ?? undefined,
        honorific: parsed.data.honorific,
        firstName: parsed.data.firstName ?? undefined,
        middleName: parsed.data.middleName,
        lastName: parsed.data.lastName ?? undefined,
        preferredName: parsed.data.preferredName,
      });
    } catch (err) {
      if (err instanceof PersonNameValidationError) {
        res.status(400).json({ error: "invalid-body", message: err.message });
        return;
      }
      throw err;
    }
    if (!structured) {
      res.status(400).json({ error: "invalid-body", message: "A name (structured or full) is required." });
      return;
    }
    const fullName = composeFullName(structured);
    const email = parsed.data.email.trim().toLowerCase();
    const workerType = parsed.data.workerType;
    const title =
      parsed.data.title?.trim() ||
      (workerType === "employee" ? "Employee" : "Contractor");
    const startDate = parsed.data.startDate?.trim() || null;
    // Task #386 — EA designation on the roster record.
    const isExecutiveAssistant = parsed.data.isExecutiveAssistant === true;
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
    // Task #820 — no temporary passwords. The joiner gets an unusable
    // random credential hash + a single-use, 72-hour activation token so
    // they choose their own password (same pattern as the onboarding
    // create-login step).
    const activationToken = randomBytes(32).toString("hex");
    const activationTokenHash = createHash("sha256").update(activationToken).digest("hex");
    const activationExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    let personId = "";

    // Atomic onboarding: identity + roster record + credential + audit +
    // welcome card commit together or not at all — no half-created joiners
    // if any step fails mid-way.
    await db.transaction(async (tx) => {
      // Task #538 — the person record is the identity source of truth;
      // users/roster rows carry the legacy fullName mirror + personId link.
      const personWrite = await writePerson(tx, {
        orgId: me.orgId,
        personId: null,
        structured,
        sourceKind: workerType === "employee" ? "employee" : "contractor",
        createdByUserId: me.id,
      });
      await tx.insert(atelierUsers).values({
        id: userId,
        orgId: me.orgId,
        email,
        name: fullName,
        initials: computeInitials(structured),
        role,
        roleLabel,
        title,
        personId: personWrite.personId,
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
          preferredName: structured.preferredName ?? null,
          email,
          role,
          title,
          startDate,
          isExecutiveAssistant,
          personId: personWrite.personId,
        });
      } else {
        personId = rid("ct");
        await tx.insert(atelierContractors).values({
          id: personId,
          orgId: me.orgId,
          fullName,
          email,
          contractStart: startDate,
          isExecutiveAssistant,
          personId: personWrite.personId,
        });
      }

      await tx.insert(atelierAuthCredentials).values({
        email,
        userId,
        // Unusable random hash — sign-in is impossible until the joiner
        // activates their account and chooses a password.
        passwordHash: hashPassword(randomBytes(32).toString("hex")),
        // user_managed=true: the boot seed must never overwrite this hash.
        userManaged: true,
        mustChangePassword: true,
        // Task #59 — the forced-change screen shows first-time-welcome
        // copy (vs. partner-reset copy) based on this reason.
        mustChangeReason: "joiner",
      });

      await tx.insert(atelierLoginActivationTokens).values({
        tokenHash: activationTokenHash,
        email,
        userId,
        purpose: "activation",
        createdByUserId: me.id,
        expiresAt: activationExpiresAt,
      });

      await tx.insert(atelierAuditEvents).values({
        id: `audit_${randomUUID()}`,
        entityType: "joiner",
        entityId: userId,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "joiner_added",
        payload: { email, workerType, personId, title, isExecutiveAssistant },
        payloadSummary: `${me.name} added ${workerType} ${fullName} (${email}) with a one-time activation link`,
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

    // Task #628 — Microsoft 365 provisioning rides on onboarding but never
    // blocks it: the run fires in the background after commit, and any
    // tenant refusal lands on the ledger row + notifies founders/HR.
    // `skipMsProvisioning` is the "don't create an email address" tickbox;
    // it still records an explicit not_provisioned row for the profile UI.
    // Both fields ride outside the zod schema (unknown keys are stripped,
    // not rejected) so non-UI API callers stay compatible.
    const rawBody = req.body as {
      skipMsProvisioning?: unknown;
      msServiceProfile?: unknown;
    };
    const skipMsProvisioning = rawBody?.skipMsProvisioning === true;
    const msServiceProfile =
      rawBody?.msServiceProfile === "employee" || rawBody?.msServiceProfile === "contractor"
        ? rawBody.msServiceProfile
        : defaultProfileForWorkerType(workerType);
    try {
      await ensureProvisioningRow({
        orgId: me.orgId,
        personId,
        personType: workerType === "employee" ? "employee" : "contractor",
        userId,
        email,
        serviceProfile: msServiceProfile,
      });
      if (!skipMsProvisioning) {
        launchProvisioning({
          orgId: me.orgId,
          personId,
          actor: { id: me.id, name: me.name },
          serviceProfile: msServiceProfile,
        });
      }
    } catch (err) {
      console.error("[joiners] M365 provisioning launch failed (non-fatal):", err);
    }

    // Welcome email with login details — only after the transaction has
    // committed, and strictly best-effort: a delivery failure must never
    // fail or roll back the onboarding. The HR user sees the outcome so
    // they can share the temporary password manually when needed.
    // Task #820 — the emailed activation link must never be built from an
    // attacker-controllable Origin header: trustedRequestOrigin only honors
    // the app's own domains and otherwise falls back to the configured
    // canonical origin.
    const signInUrl: string | null = trustedRequestOrigin(req);
    const activationUrl = signInUrl
      ? `${signInUrl}/activate?token=${activationToken}`
      : `/activate?token=${activationToken}`;
    const welcomeEmail = await sendJoinerWelcomeEmail({
      fullName,
      email,
      activationUrl: signInUrl ? activationUrl : null,
      activationValidity: "72 hours",
      workerType,
      signInUrl,
      sender: { actor: { name: me.name, email: me.email } },
    });
    try {
      await db.insert(atelierAuditEvents).values({
        id: `audit_${randomUUID()}`,
        entityType: "joiner",
        entityId: userId,
        actorType: "system",
        actorId: "system",
        actorLabel: "System",
        action: "joiner_welcome_email",
        // Never the password — only the delivery outcome.
        payload: { email, workerType, status: welcomeEmail },
        payloadSummary:
          welcomeEmail === "sent"
            ? `Welcome email with login details sent to ${email}`
            : welcomeEmail === "not_configured"
              ? `Welcome email to ${email} skipped — email delivery is not configured`
              : `Welcome email to ${email} failed to send`,
      });
    } catch (err) {
      // Audit of the email attempt is best-effort too.
      console.error("[joiners] failed to audit welcome email attempt:", err);
    }

    const [user] = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.id, userId));
    // No generated zod const for this response (orval skips 201-with-secret
    // shapes); the OpenAPI schema still types the client.
    // The activation URL is returned once so HR can share it through a
    // secure channel when email delivery isn't configured. Single-use,
    // 72-hour token — never a password.
    res.status(201).json({
      user: personaToWire(user!),
      personId,
      activationUrl,
      activationExpiresAt: activationExpiresAt.toISOString(),
      welcomeEmail,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Task #60 — resolve the leaver's roster record. Employees link by
 * user_id FK; contractors link by email (their table has no user_id
 * column — the same rule resolveLinkedUserId / resolveSelfPerson use).
 */
async function resolveRoster(
  orgId: string,
  user: typeof atelierUsers.$inferSelect,
): Promise<
  | {
      personType: "employee" | "contractor";
      personId: string;
      status: string;
      endDate: string | null;
    }
  | null
> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, orgId),
        eq(atelierEmployees.userId, user.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) {
    return {
      personType: "employee",
      personId: emp.id,
      status: emp.status,
      endDate: emp.endDate ?? null,
    };
  }
  const email = user.email.trim().toLowerCase();
  const contractors = await db
    .select()
    .from(atelierContractors)
    .where(and(eq(atelierContractors.orgId, orgId), isNull(atelierContractors.deletedAt)));
  const ct = contractors.find((c) => c.email.trim().toLowerCase() === email);
  if (ct) {
    return {
      personType: "contractor",
      personId: ct.id,
      status: ct.status,
      endDate: ct.endDate ?? null,
    };
  }
  return null;
}

/** Terminal opportunity stages that no longer need a live owner handover. */
const TERMINAL_STAGES = ["lost", "no_decision", "withdrawn"];

/**
 * Task #60 — everything a leaver still owns: accounts (partner owner),
 * live opportunities (partner owner or engagement lead), and open tasks
 * (activity assignee). Org-scoped, soft-deletes excluded.
 */
async function buildHandover(
  orgId: string,
  user: typeof atelierUsers.$inferSelect,
): Promise<Record<string, unknown>> {
  const accounts = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      status: atelierAccounts.status,
    })
    .from(atelierAccounts)
    .where(
      and(
        eq(atelierAccounts.orgId, orgId),
        eq(atelierAccounts.partnerOwnerId, user.id),
        isNull(atelierAccounts.deletedAt),
        notInArray(atelierAccounts.status, ["archived"]),
      ),
    );

  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.orgId, orgId),
        or(
          eq(atelierOpportunities.partnerOwnerId, user.id),
          eq(atelierOpportunities.engagementLeadId, user.id),
        ),
        isNull(atelierOpportunities.deletedAt),
        notInArray(atelierOpportunities.salesStage, TERMINAL_STAGES),
      ),
    );

  const tasks = await db
    .select()
    .from(atelierActivities)
    .where(
      and(
        eq(atelierActivities.orgId, orgId),
        eq(atelierActivities.ownerId, user.id),
        eq(atelierActivities.status, "open"),
        isNull(atelierActivities.deletedAt),
      ),
    );

  // Resolve account names for opps/tasks in one pass.
  const nameByAccount = new Map(accounts.map((a) => [a.id, a.name]));
  const missing = [
    ...new Set(
      [...opps.map((o) => o.accountId), ...tasks.map((t) => t.accountId)].filter(
        (id) => !nameByAccount.has(id),
      ),
    ),
  ];
  if (missing.length > 0) {
    const rows = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.orgId, orgId),
          inArray(atelierAccounts.id, missing),
          isNull(atelierAccounts.deletedAt),
        ),
      );
    for (const r of rows) nameByAccount.set(r.id, r.name);
  }

  const roster = await resolveRoster(orgId, user);
  const wireOpps = opps.map((o) => ({
    id: o.id,
    name: o.name,
    accountId: o.accountId,
    accountName: nameByAccount.get(o.accountId) ?? o.accountId,
    salesStage: o.salesStage,
    roles: [
      ...(o.partnerOwnerId === user.id ? (["owner"] as const) : []),
      ...(o.engagementLeadId === user.id ? (["lead"] as const) : []),
    ],
  }));
  const wireTasks = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    accountId: t.accountId,
    accountName: nameByAccount.get(t.accountId) ?? t.accountId,
    dueDate: t.dueDate ?? null,
    status: t.status,
  }));
  return {
    userId: user.id,
    name: user.name,
    roster,
    accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)),
    opportunities: wireOpps.sort((a, b) => a.name.localeCompare(b.name)),
    tasks: wireTasks.sort((a, b) => a.title.localeCompare(b.title)),
    totalOwned: accounts.length + wireOpps.length + wireTasks.length,
  };
}

async function loadOrgUser(
  orgId: string,
  userId: string,
): Promise<typeof atelierUsers.$inferSelect | null> {
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.id, userId),
        eq(atelierUsers.orgId, orgId),
        isNull(atelierUsers.deletedAt),
      ),
    );
  return user ?? null;
}

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
  // Task #60 — deactivation may also mark the roster record as a leaver
  // (status=offboarded + end date). We stash the prior roster state in the
  // audit payload so reactivation can restore it precisely.
  const parsedBody = disabled
    ? AtelierDeactivateJoinerBody.safeParse(req.body ?? {})
    : null;
  if (parsedBody && !parsedBody.success) {
    res.status(400).json({ error: "invalid-body", details: parsedBody.error.flatten() });
    return;
  }
  const markLeaver = parsedBody?.data?.markLeaver === true;
  const endDate =
    parsedBody?.data?.endDate?.trim() || new Date().toISOString().slice(0, 10);

  await db
    .update(atelierAuthCredentials)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, cred.email));
  let delegationsRevoked = 0;
  if (disabled) {
    // Kill every live session immediately — a leaver's open tab dies now.
    await revokeAllSessions(userId);
    // Task #386 — dangling EA delegations are an audit hazard: deactivating
    // either party (partner or EA) auto-revokes every active grant they are
    // on. Reactivation does NOT restore them — the partner must re-grant.
    delegationsRevoked = await autoRevokeDelegationsForUser({
      orgId: me.orgId,
      userId,
      actor: me,
      targetName: user.name,
    });
  }

  let rosterPrior: Record<string, unknown> | null = null;
  let rosterMarked: Record<string, unknown> | null = null;
  if (disabled && markLeaver) {
    const roster = await resolveRoster(me.orgId, user);
    if (roster) {
      rosterPrior = {
        personType: roster.personType,
        personId: roster.personId,
        status: roster.status,
        endDate: roster.endDate,
      };
      if (roster.personType === "employee") {
        await db
          .update(atelierEmployees)
          .set({ status: "offboarded", endDate, updatedAt: new Date() })
          .where(eq(atelierEmployees.id, roster.personId));
      } else {
        await db
          .update(atelierContractors)
          .set({ status: "offboarded", endDate, updatedAt: new Date() })
          .where(eq(atelierContractors.id, roster.personId));
      }
      rosterMarked = { ...rosterPrior, newStatus: "offboarded", newEndDate: endDate };
      // Task #655 — leaver EOSB settlement rides on offboarding. For
      // employees in a statutory-covered country, draft the end-of-service
      // settlement so Finance reviews and settles it from Finance → Payroll.
      // Best-effort: incomplete roster data or an uncovered country never
      // blocks the deactivation — the outcome lands in the audit payload.
      if (roster.personType === "employee") {
        const eosbReason =
          typeof (req.body as { eosbReason?: string } | undefined)?.eosbReason === "string" &&
          ["resignation", "termination", "end_of_contract", "retirement", "death", "mutual"].includes(
            (req.body as { eosbReason: string }).eosbReason,
          )
            ? ((req.body as { eosbReason: string }).eosbReason as
                | "resignation" | "termination" | "end_of_contract" | "retirement" | "death" | "mutual")
            : "termination";
        try {
          const settlement = await createEosbSettlement({
            orgId: me.orgId,
            employeeId: roster.personId,
            leaveDate: endDate,
            reason: eosbReason,
            createdByUserId: me.id,
          });
          rosterMarked.eosbSettlement = { id: settlement.id, finalAmount: settlement.finalAmount, currency: settlement.currency, reason: eosbReason };
        } catch (err) {
          rosterMarked.eosbSettlement = { skipped: true, message: err instanceof Error ? err.message : String(err) };
        }
      }
    }
  }

  // Task #628 — Microsoft 365 offboarding rides on deactivation: block
  // tenant sign-in + revoke Microsoft sessions, and free the license when
  // HR chose "remove mailbox" (retain keeps the seat for handover). Always
  // best-effort: a Graph refusal never blocks the Atelier-side deactivation
  // (the ledger row is flagged and founders/HR get a card instead).
  const msMailboxAction: "retain" | "remove" =
    (req.body as { msMailboxAction?: string } | undefined)?.msMailboxAction === "remove"
      ? "remove"
      : "retain";
  let ms365: Record<string, unknown> | null = null;
  if (disabled) {
    const out = await deprovisionMs({
      orgId: me.orgId,
      userId,
      actor: { id: me.id, name: me.name },
      mailboxAction: msMailboxAction,
    });
    if (!("skipped" in out)) {
      ms365 = out.ok
        ? { blockedSignIn: out.blockedSignIn, licenseFreed: out.licenseFreed, mailboxRetained: out.mailboxRetained }
        : { error: out.error };
    }
  }

  let rosterRestored: Record<string, unknown> | null = null;
  if (!disabled) {
    // Task #628 — restore Microsoft sign-in (license re-assignment is
    // prompted separately when the seat was freed at offboarding).
    const out = await reactivateMs({
      orgId: me.orgId,
      userId,
      actor: { id: me.id, name: me.name },
    });
    if (!("skipped" in out)) {
      ms365 = out.ok ? { signInRestored: true, needsLicense: out.needsLicense } : { error: out.error };
    }
    // Reactivation reverses a prior leaver marking: find the most recent
    // deactivation audit that captured roster state and restore it.
    const events = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "joiner"),
          eq(atelierAuditEvents.entityId, userId),
          eq(atelierAuditEvents.action, "leaver_deactivated"),
        ),
      )
      .orderBy(desc(atelierAuditEvents.createdAt))
      .limit(1);
    const prior = (events[0]?.payload as { rosterPrior?: Record<string, unknown> } | null)
      ?.rosterPrior;
    if (prior && typeof prior.personId === "string") {
      const restoreStatus = typeof prior.status === "string" ? prior.status : "active";
      const restoreEnd = typeof prior.endDate === "string" ? prior.endDate : null;
      if (prior.personType === "employee") {
        await db
          .update(atelierEmployees)
          .set({ status: restoreStatus, endDate: restoreEnd, updatedAt: new Date() })
          .where(
            and(
              eq(atelierEmployees.id, prior.personId),
              eq(atelierEmployees.status, "offboarded"),
            ),
          );
      } else if (prior.personType === "contractor") {
        await db
          .update(atelierContractors)
          .set({ status: restoreStatus, endDate: restoreEnd, updatedAt: new Date() })
          .where(
            and(
              eq(atelierContractors.id, prior.personId),
              eq(atelierContractors.status, "offboarded"),
            ),
          );
      }
      rosterRestored = prior;
    }
  }

  await audit({
    actor: me,
    action: disabled ? "leaver_deactivated" : "leaver_reactivated",
    entityId: userId,
    payload: {
      email: cred.email,
      disabled,
      ...(delegationsRevoked > 0 ? { eaDelegationsRevoked: delegationsRevoked } : {}),
      ...(rosterPrior ? { rosterPrior, rosterMarked } : {}),
      ...(rosterRestored ? { rosterRestored } : {}),
      ...(ms365 ? { ms365, msMailboxAction: disabled ? msMailboxAction : undefined } : {}),
    },
    summary: disabled
      ? `${me.name} deactivated the login for ${user.name} (${cred.email}) and revoked all sessions${rosterMarked ? `; roster marked leaver (end date ${endDate})` : ""}`
      : `${me.name} reactivated the login for ${user.name} (${cred.email})${rosterRestored ? "; roster record restored" : ""}`,
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

// @cli-skip: HR admin surface; no CLI shape (Task #60)
router.get("/roster/joiners/:userId/handover", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const user = await loadOrgUser(me.orgId, String(req.params.userId));
    if (!user) {
      res.status(404).json({ error: "not-found", message: "No such user." });
      return;
    }
    const handover = await buildHandover(me.orgId, user);
    res.json(AtelierGetLeaverHandoverResponse.parse(handover));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin mutation; no CLI shape (Task #60)
router.post("/roster/joiners/:userId/handover/reassign", async (req, res, next) => {
  try {
    const me = ensureHrActor(req, res);
    if (!me) return;
    const leaver = await loadOrgUser(me.orgId, String(req.params.userId));
    if (!leaver) {
      res.status(404).json({ error: "not-found", message: "No such user." });
      return;
    }
    const parsed = AtelierReassignLeaverItemsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const toUserId = parsed.data.toUserId.trim();
    if (toUserId === leaver.id) {
      res.status(400).json({
        error: "invalid-target",
        message: "Items cannot be reassigned to the leaver themselves.",
      });
      return;
    }
    const target = await loadOrgUser(me.orgId, toUserId);
    if (!target) {
      res.status(404).json({ error: "target-not-found", message: "No such target user." });
      return;
    }
    // Refuse handover to a deactivated login — that just re-orphans the work.
    const [targetCred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.userId, target.id));
    if (targetCred?.disabled) {
      res.status(400).json({
        error: "target-deactivated",
        message: "Cannot reassign to a deactivated user.",
      });
      return;
    }

    // Resolve which items to move: either the explicit id lists, or — with
    // all=true — everything the leaver still owns right now.
    const current = (await buildHandover(me.orgId, leaver)) as {
      accounts: { id: string; name: string }[];
      opportunities: { id: string; name: string; roles: string[] }[];
      tasks: { id: string; title: string }[];
    };
    const wantAll = parsed.data.all === true;
    const ownedAccountIds = new Set(current.accounts.map((a) => a.id));
    const ownedOppIds = new Set(current.opportunities.map((o) => o.id));
    const ownedTaskIds = new Set(current.tasks.map((t) => t.id));
    const accountIds = (wantAll ? [...ownedAccountIds] : (parsed.data.accountIds ?? [])).filter(
      (id) => ownedAccountIds.has(id),
    );
    const opportunityIds = (wantAll ? [...ownedOppIds] : (parsed.data.opportunityIds ?? [])).filter(
      (id) => ownedOppIds.has(id),
    );
    const taskIds = (wantAll ? [...ownedTaskIds] : (parsed.data.taskIds ?? [])).filter((id) =>
      ownedTaskIds.has(id),
    );
    if (accountIds.length === 0 && opportunityIds.length === 0 && taskIds.length === 0) {
      res.status(400).json({
        error: "nothing-to-reassign",
        message: "None of the selected items are still owned by this user.",
      });
      return;
    }

    // Atomic handover: every selected item moves together, with one audit
    // row capturing exactly what moved (so it's reviewable + reversible by
    // re-running a reassignment back to the original owner).
    await db.transaction(async (tx) => {
      if (accountIds.length > 0) {
        await tx
          .update(atelierAccounts)
          .set({ partnerOwnerId: target.id, updatedAt: new Date() })
          .where(
            and(
              eq(atelierAccounts.orgId, me.orgId),
              inArray(atelierAccounts.id, accountIds),
              eq(atelierAccounts.partnerOwnerId, leaver.id),
            ),
          );
      }
      for (const oppId of opportunityIds) {
        const opp = current.opportunities.find((o) => o.id === oppId)!;
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (opp.roles.includes("owner")) patch.partnerOwnerId = target.id;
        if (opp.roles.includes("lead")) patch.engagementLeadId = target.id;
        await tx
          .update(atelierOpportunities)
          .set(patch)
          .where(
            and(
              eq(atelierOpportunities.orgId, me.orgId),
              eq(atelierOpportunities.id, oppId),
              // Guard against concurrent owner changes between the checklist
              // read and this update — only move it if the leaver still holds
              // a role on it.
              or(
                eq(atelierOpportunities.partnerOwnerId, leaver.id),
                eq(atelierOpportunities.engagementLeadId, leaver.id),
              ),
            ),
          );
      }
      if (taskIds.length > 0) {
        await tx
          .update(atelierActivities)
          .set({ ownerId: target.id, updatedAt: new Date() })
          .where(
            and(
              eq(atelierActivities.orgId, me.orgId),
              inArray(atelierActivities.id, taskIds),
              eq(atelierActivities.ownerId, leaver.id),
            ),
          );
      }
      await tx.insert(atelierAuditEvents).values({
        id: `audit_${randomUUID()}`,
        entityType: "joiner",
        entityId: leaver.id,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "leaver_handover_reassigned",
        payload: {
          fromUserId: leaver.id,
          toUserId: target.id,
          accountIds,
          opportunityIds,
          taskIds,
        },
        payloadSummary: `${me.name} reassigned ${accountIds.length} account(s), ${opportunityIds.length} opportunity(ies) and ${taskIds.length} task(s) from ${leaver.name} to ${target.name}`,
      });
    });

    const refreshed = await buildHandover(me.orgId, leaver);
    res.json(AtelierReassignLeaverItemsResponse.parse(refreshed));
  } catch (err) {
    next(err);
  }
});

export default router;
