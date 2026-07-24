/**
 * Task #628 — Microsoft 365 provisioning engine for joiners/leavers.
 *
 * Orchestrates msGraphAdmin against the atelier_ms_provisioning ledger:
 *   - check-then-create-or-link: never double-creates a tenant user
 *   - license assignment with per-worker-type service profiles
 *     (employee = full bundle; contractor = email only, no Teams/SharePoint)
 *   - pending_license state + re-check when no spare seat exists
 *   - offboarding: block sign-in, revoke sessions, free license, with an
 *     explicit mailbox retain/remove choice
 *
 * Every run is idempotent and NEVER throws into its caller's request path:
 * failures land on the ledger row (status=blocked/pending_license +
 * lastError), are audited, and notify founders/HR when manual action is
 * needed. Runs are fired asynchronously (launch-map guarded) and polled
 * via the status route — Graph calls are never awaited inside an HTTP
 * request that created Atelier-side state.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierMsProvisioning,
  atelierEmployees,
  atelierContractors,
  atelierUsers,
  atelierAuditEvents,
} from "@workspace/db";
import {
  MsAdminError,
  msAdminConfigured,
  findUserByEmail,
  getUser,
  createUser,
  updateUser,
  revokeMsSessions,
  listSubscribedSkus,
  skuHasSpareUnit,
  assignLicense,
  removeLicense,
  type MsSubscribedSku,
} from "./msGraphAdmin";
import { emitSelfNotification } from "../routes/atelier/meRoutes";
import { logger } from "./logger";

export type MsServiceProfile = "employee" | "contractor";

/**
 * Service profiles — which service PLANS get disabled on the assigned
 * license, by servicePlanName keyword. The employee profile enables the
 * full bundle; the contractor profile is email-only: collaboration
 * surfaces (Teams, SharePoint/OneDrive, Sway, Yammer) are switched off.
 * Per-person overrides are edited from the profile page and stored on the
 * ledger row as explicit service-plan ids.
 */
export const PROFILE_DISABLED_PLAN_PATTERNS: Record<MsServiceProfile, RegExp[]> = {
  employee: [],
  contractor: [
    /^TEAMS/i,
    /^SHAREPOINT/i,
    /^ONEDRIVE/i,
    /^SWAY$/i,
    /^YAMMER/i,
    /^MCOSTANDARD/i, // Skype for Business Online
  ],
};

export function defaultProfileForWorkerType(
  workerType: string,
): MsServiceProfile {
  return workerType === "employee" ? "employee" : "contractor";
}

export function disabledPlansForProfile(
  sku: MsSubscribedSku,
  profile: MsServiceProfile,
): string[] {
  const patterns = PROFILE_DISABLED_PLAN_PATTERNS[profile];
  if (patterns.length === 0) return [];
  return sku.servicePlans
    .filter(
      (p) =>
        (p.appliesTo ?? "User") === "User" &&
        patterns.some((re) => re.test(p.servicePlanName)),
    )
    .map((p) => p.servicePlanId);
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type ProvRow = typeof atelierMsProvisioning.$inferSelect;

// ------------------------------------------------------------------
// Ledger helpers
// ------------------------------------------------------------------
export async function getProvisioningRow(
  orgId: string,
  personId: string,
): Promise<ProvRow | null> {
  const [row] = await db
    .select()
    .from(atelierMsProvisioning)
    .where(
      and(
        eq(atelierMsProvisioning.orgId, orgId),
        eq(atelierMsProvisioning.personId, personId),
      ),
    );
  return row ?? null;
}

export async function getProvisioningRowByUser(
  orgId: string,
  userId: string,
): Promise<ProvRow | null> {
  const [row] = await db
    .select()
    .from(atelierMsProvisioning)
    .where(
      and(
        eq(atelierMsProvisioning.orgId, orgId),
        eq(atelierMsProvisioning.userId, userId),
      ),
    );
  return row ?? null;
}

/** Idempotent upsert of the ledger row for a person. */
export async function ensureProvisioningRow(args: {
  orgId: string;
  personId: string;
  personType: "employee" | "contractor";
  userId?: string | null;
  email: string;
  serviceProfile?: MsServiceProfile;
}): Promise<ProvRow> {
  const existing = await getProvisioningRow(args.orgId, args.personId);
  if (existing) {
    const patch: Partial<typeof atelierMsProvisioning.$inferInsert> = {};
    if (args.userId && !existing.userId) patch.userId = args.userId;
    if (args.serviceProfile && existing.serviceProfile !== args.serviceProfile) {
      patch.serviceProfile = args.serviceProfile;
    }
    if (Object.keys(patch).length > 0) {
      await db
        .update(atelierMsProvisioning)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(atelierMsProvisioning.id, existing.id));
      return { ...existing, ...patch } as ProvRow;
    }
    return existing;
  }
  const row: typeof atelierMsProvisioning.$inferInsert = {
    id: rid("msp"),
    orgId: args.orgId,
    personId: args.personId,
    personType: args.personType,
    userId: args.userId ?? null,
    email: args.email.trim().toLowerCase(),
    status: "not_provisioned",
    serviceProfile:
      args.serviceProfile ?? defaultProfileForWorkerType(args.personType),
    disabledPlans: [],
  };
  await db.insert(atelierMsProvisioning).values(row);
  return (await getProvisioningRow(args.orgId, args.personId))!;
}

async function setRow(
  id: string,
  patch: Partial<typeof atelierMsProvisioning.$inferInsert>,
): Promise<void> {
  await db
    .update(atelierMsProvisioning)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(atelierMsProvisioning.id, id));
}

// ------------------------------------------------------------------
// Audit + admin notifications
// ------------------------------------------------------------------
async function auditMs(args: {
  personId: string;
  actor: { id: string; name: string } | "system";
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: `audit_${randomUUID()}`,
      entityType: "ms_provisioning",
      entityId: args.personId,
      actorType: args.actor === "system" ? "system" : "human",
      actorId: args.actor === "system" ? "system" : args.actor.id,
      actorLabel: args.actor === "system" ? "System" : args.actor.name,
      action: args.action,
      payload: args.payload,
      payloadSummary: args.summary,
    });
  } catch (err) {
    logger.warn({ err }, "[ms-provisioning] audit write failed");
  }
}

/** Card on every founder/HR Me home when a manual step is needed. */
export async function notifyMsAdmins(args: {
  orgId: string;
  title: string;
  body: string;
  href?: string | null;
}): Promise<void> {
  try {
    const admins = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.orgId, args.orgId),
          inArray(atelierUsers.role, ["founding_partner", "hr"]),
          isNull(atelierUsers.deletedAt),
        ),
      );
    for (const a of admins) {
      await emitSelfNotification({
        orgId: args.orgId,
        userId: a.id,
        kind: "ms_provisioning",
        title: args.title,
        body: args.body,
        href: args.href ?? null,
      });
    }
  } catch (err) {
    logger.warn({ err }, "[ms-provisioning] admin notification failed");
  }
}

// ------------------------------------------------------------------
// Launch map — one in-flight run per person (stale after 3 minutes)
// ------------------------------------------------------------------
const inflight = new Map<string, number>();

function claimRun(personId: string): boolean {
  const at = inflight.get(personId);
  if (at && Date.now() - at < 3 * 60_000) return false;
  inflight.set(personId, Date.now());
  return true;
}

function releaseRun(personId: string): void {
  inflight.delete(personId);
}

// ------------------------------------------------------------------
// Provisioning run (async — call via launchProvisioning)
// ------------------------------------------------------------------
export interface ProvisionOptions {
  orgId: string;
  personId: string;
  actor: { id: string; name: string } | "system";
  /** Override the stored profile for this run (persisted on the row). */
  serviceProfile?: MsServiceProfile;
  /** Explicit per-person plan overrides (service-plan ids to disable). */
  disabledPlanOverride?: string[] | null;
}

/**
 * Fire a provisioning run in the background. Returns false when a run for
 * this person is already in flight (the poll route reports progress).
 */
export function launchProvisioning(opts: ProvisionOptions): boolean {
  if (!claimRun(opts.personId)) return false;
  setImmediate(() => {
    runProvisioning(opts)
      .catch((err) =>
        logger.error({ err, personId: opts.personId }, "[ms-provisioning] run crashed"),
      )
      .finally(() => releaseRun(opts.personId));
  });
  return true;
}

/** Random initial password for created accounts (never stored/emailed —
 *  forceChangePasswordNextSignIn + GoDaddy's own reset flow govern first
 *  sign-in; we point HR to the GoDaddy password reset as the manual path). */
function initialMsPassword(): string {
  return `Cg!${randomBytes(18).toString("base64url")}`;
}

export async function runProvisioning(opts: ProvisionOptions): Promise<void> {
  const row = await getProvisioningRow(opts.orgId, opts.personId);
  if (!row) return;
  const actorLabel = opts.actor === "system" ? "System" : opts.actor.name;
  const profile = (opts.serviceProfile ?? row.serviceProfile) as MsServiceProfile;

  if (!msAdminConfigured()) {
    await setRow(row.id, {
      status: "blocked",
      lastError:
        "Microsoft 365 admin credentials are not configured (MS_CLIENT_ID / MS_TENANT_ID / MS_CLIENT_SECRET).",
    });
    return;
  }

  await setRow(row.id, {
    status: "provisioning",
    serviceProfile: profile,
    lastError: null,
  });

  try {
    // ---- 1. Pre-create existence check: link instead of create --------
    let msUser = row.msUserId ? await getUser(row.msUserId) : null;
    let linked = false;
    if (!msUser) {
      msUser = await findUserByEmail(row.email);
      linked = Boolean(msUser);
    } else {
      linked = row.status === "linked_existing";
    }
    let created = false;
    if (!msUser) {
      // ---- 2. Create the tenant user --------------------------------
      const person = await loadPersonNames(opts.orgId, row);
      const nickname =
        row.email.split("@")[0]!.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 60) ||
        `user${Date.now().toString(36)}`;
      msUser = await createUser({
        displayName: person.displayName,
        givenName: person.givenName,
        surname: person.surname,
        userPrincipalName: row.email,
        mailNickname: nickname,
        initialPassword: initialMsPassword(),
      });
      created = true;
    }

    await setRow(row.id, { msUserId: msUser.id, signInBlocked: "no" });

    // ---- 3. License: keep existing, else assign per profile ----------
    const hasLicense = (msUser.assignedLicenses ?? []).length > 0;
    let skuId = row.skuId;
    let disabledPlans = row.disabledPlans ?? [];
    let pendingLicense = false;
    if (!hasLicense) {
      const skus = await listSubscribedSkus();
      const spare = skus.find(skuHasSpareUnit);
      if (!spare) {
        pendingLicense = true;
      } else {
        skuId = spare.skuId;
        disabledPlans =
          opts.disabledPlanOverride ?? disabledPlansForProfile(spare, profile);
        await assignLicense(msUser.id, spare.skuId, disabledPlans);
      }
    } else {
      const existing = msUser.assignedLicenses![0]!;
      skuId = existing.skuId;
      disabledPlans = existing.disabledPlans ?? [];
    }

    const status = pendingLicense
      ? "pending_license"
      : linked && !created
        ? "linked_existing"
        : "provisioned";
    await setRow(row.id, {
      status,
      skuId: skuId ?? null,
      disabledPlans,
      licenseFreed: "no",
      lastError: pendingLicense
        ? "No spare Microsoft 365 license in the tenant. Buy or free a seat in the GoDaddy portal, then re-check."
        : null,
      provisionedAt: pendingLicense ? row.provisionedAt : new Date(),
    });
    await auditMs({
      personId: row.personId,
      actor: opts.actor,
      action: created
        ? "ms.account.created"
        : linked
          ? "ms.account.linked"
          : "ms.account.rechecked",
      payload: {
        email: row.email,
        msUserId: msUser.id,
        status,
        profile,
        skuId,
        disabledPlans,
      },
      summary: created
        ? `${actorLabel} created Microsoft 365 account ${row.email}${pendingLicense ? " (awaiting a license — buy/assign in GoDaddy)" : ` with the ${profile} service profile`}`
        : linked
          ? `${actorLabel} linked existing Microsoft 365 account ${row.email}`
          : `${actorLabel} re-checked Microsoft 365 provisioning for ${row.email}`,
    });
    if (pendingLicense) {
      await notifyMsAdmins({
        orgId: opts.orgId,
        title: "Microsoft 365 license needed",
        body: `${row.email} was created in Microsoft 365 but no license seat is available. Buy or free a seat in the GoDaddy portal, then use "Re-check" on the person's profile.`,
        href: personHref(row),
      });
    }
  } catch (err) {
    const { message, code } = describeMsError(err);
    await setRow(row.id, { status: "blocked", lastError: message });
    await auditMs({
      personId: row.personId,
      actor: opts.actor,
      action: "ms.provisioning.failed",
      payload: { email: row.email, code, error: message },
      summary: `Microsoft 365 provisioning for ${row.email} failed: ${message}`,
    });
    await notifyMsAdmins({
      orgId: opts.orgId,
      title: "Microsoft 365 provisioning needs attention",
      body: `${row.email}: ${message}`,
      href: personHref(row),
    });
  }
}

function personHref(row: ProvRow): string {
  return `/roster/people/${row.personId}`;
}

function describeMsError(err: unknown): { message: string; code: string } {
  if (err instanceof MsAdminError) {
    return { message: err.message, code: err.code };
  }
  return {
    message: err instanceof Error ? err.message : "Unknown Microsoft Graph failure",
    code: "unknown",
  };
}

async function loadPersonNames(
  orgId: string,
  row: ProvRow,
): Promise<{ displayName: string; givenName: string | null; surname: string | null }> {
  let fullName = "";
  let preferred: string | null = null;
  if (row.personType === "employee") {
    const [emp] = await db
      .select({ fullName: atelierEmployees.fullName, preferredName: atelierEmployees.preferredName })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, orgId), eq(atelierEmployees.id, row.personId)));
    fullName = emp?.fullName ?? "";
    preferred = emp?.preferredName ?? null;
  } else {
    const [ct] = await db
      .select({ fullName: atelierContractors.fullName })
      .from(atelierContractors)
      .where(and(eq(atelierContractors.orgId, orgId), eq(atelierContractors.id, row.personId)));
    fullName = ct?.fullName ?? "";
  }
  const display = fullName.trim() || row.email.split("@")[0]!;
  const parts = display.split(/\s+/);
  return {
    displayName: display,
    givenName: preferred ?? parts[0] ?? null,
    surname: parts.length > 1 ? parts[parts.length - 1]! : null,
  };
}

// ------------------------------------------------------------------
// Service-plan toggling (HR/founder, from the profile page)
// ------------------------------------------------------------------
export async function applyServicePlanChange(args: {
  orgId: string;
  personId: string;
  actor: { id: string; name: string };
  disabledPlans: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getProvisioningRow(args.orgId, args.personId);
  if (!row?.msUserId || !row.skuId) {
    return { ok: false, error: "No licensed Microsoft account to update." };
  }
  try {
    await assignLicense(row.msUserId, row.skuId, args.disabledPlans);
    await setRow(row.id, { disabledPlans: args.disabledPlans, lastError: null });
    await auditMs({
      personId: row.personId,
      actor: args.actor,
      action: "ms.services.updated",
      payload: { email: row.email, skuId: row.skuId, disabledPlans: args.disabledPlans },
      summary: `${args.actor.name} updated Microsoft 365 services for ${row.email} (${args.disabledPlans.length} plan(s) disabled)`,
    });
    return { ok: true };
  } catch (err) {
    const { message } = describeMsError(err);
    await setRow(row.id, { lastError: message });
    return { ok: false, error: message };
  }
}

// ------------------------------------------------------------------
// Name sync — called (fire-and-forget) after structured-name writes
// ------------------------------------------------------------------
export function syncMsDisplayName(args: {
  orgId: string;
  personIds: string[];
}): void {
  setImmediate(async () => {
    try {
      for (const personId of args.personIds) {
        const row = await getProvisioningRow(args.orgId, personId);
        if (!row?.msUserId) continue;
        if (!["provisioned", "linked_existing", "pending_license"].includes(row.status)) continue;
        const names = await loadPersonNames(args.orgId, row);
        await updateUser(row.msUserId, {
          displayName: names.displayName,
          givenName: names.givenName,
          surname: names.surname,
        });
        await auditMs({
          personId,
          actor: "system",
          action: "ms.account.name_synced",
          payload: { email: row.email, displayName: names.displayName },
          summary: `Microsoft 365 display name for ${row.email} synced to "${names.displayName}"`,
        });
      }
    } catch (err) {
      logger.warn({ err }, "[ms-provisioning] name sync failed (non-fatal)");
    }
  });
}

// ------------------------------------------------------------------
// Offboarding / reactivation
// ------------------------------------------------------------------
export async function deprovisionMs(args: {
  orgId: string;
  userId: string;
  actor: { id: string; name: string };
  /** retain = keep mailbox (license) for handover; remove = free the license. */
  mailboxAction: "retain" | "remove";
}): Promise<
  | { ok: true; blockedSignIn: boolean; licenseFreed: boolean; mailboxRetained: boolean }
  | { ok: false; error: string }
  | { ok: true; skipped: true }
> {
  const row = await getProvisioningRowByUser(args.orgId, args.userId);
  if (!row?.msUserId) return { ok: true, skipped: true };
  try {
    await updateUser(row.msUserId, { accountEnabled: false });
    try {
      await revokeMsSessions(row.msUserId);
    } catch (err) {
      // Session revocation failing must not stop the block — log and go on.
      logger.warn({ err }, "[ms-provisioning] revokeMsSessions failed (sign-in already blocked)");
    }
    let licenseFreed = false;
    if (args.mailboxAction === "remove" && row.skuId) {
      await removeLicense(row.msUserId, row.skuId);
      licenseFreed = true;
    }
    await setRow(row.id, {
      signInBlocked: "yes",
      mailboxRetained: args.mailboxAction === "retain" ? "yes" : "no",
      licenseFreed: licenseFreed ? "yes" : row.licenseFreed,
      status: args.mailboxAction === "remove" ? "deprovisioned" : row.status,
      lastError: null,
    });
    await auditMs({
      personId: row.personId,
      actor: args.actor,
      action: "ms.account.deprovisioned",
      payload: { email: row.email, mailboxAction: args.mailboxAction, licenseFreed },
      summary: `${args.actor.name} blocked Microsoft 365 sign-in for ${row.email}${licenseFreed ? " and freed the license" : " (mailbox retained for handover)"}`,
    });
    return {
      ok: true,
      blockedSignIn: true,
      licenseFreed,
      mailboxRetained: args.mailboxAction === "retain",
    };
  } catch (err) {
    const { message } = describeMsError(err);
    await setRow(row.id, { lastError: message });
    await auditMs({
      personId: row.personId,
      actor: args.actor,
      action: "ms.deprovisioning.failed",
      payload: { email: row.email, error: message },
      summary: `Blocking Microsoft 365 sign-in for ${row.email} failed: ${message}`,
    });
    await notifyMsAdmins({
      orgId: args.orgId,
      title: "Microsoft 365 offboarding needs attention",
      body: `${row.email}: sign-in could not be blocked automatically (${message}). Block the account manually in the GoDaddy / Microsoft admin portal.`,
      href: personHref(row),
    });
    return { ok: false, error: message };
  }
}

export async function reactivateMs(args: {
  orgId: string;
  userId: string;
  actor: { id: string; name: string };
}): Promise<
  | { ok: true; needsLicense: boolean }
  | { ok: false; error: string }
  | { ok: true; skipped: true }
> {
  const row = await getProvisioningRowByUser(args.orgId, args.userId);
  if (!row?.msUserId || row.signInBlocked !== "yes") return { ok: true, skipped: true };
  try {
    await updateUser(row.msUserId, { accountEnabled: true });
    const needsLicense = row.licenseFreed === "yes";
    await setRow(row.id, {
      signInBlocked: "no",
      mailboxRetained: "no",
      status: needsLicense ? "pending_license" : row.status === "deprovisioned" ? "pending_license" : row.status,
      lastError: needsLicense
        ? "Sign-in restored, but the license was freed at offboarding. Re-run provisioning to assign a seat."
        : null,
    });
    await auditMs({
      personId: row.personId,
      actor: args.actor,
      action: "ms.account.reactivated",
      payload: { email: row.email, needsLicense },
      summary: `${args.actor.name} restored Microsoft 365 sign-in for ${row.email}${needsLicense ? " (license must be re-assigned)" : ""}`,
    });
    if (needsLicense) {
      await notifyMsAdmins({
        orgId: args.orgId,
        title: "Microsoft 365 license needed after reactivation",
        body: `${row.email} can sign in again but has no license. Re-run provisioning from the person's profile once a seat is available.`,
        href: personHref(row),
      });
    }
    return { ok: true, needsLicense };
  } catch (err) {
    const { message } = describeMsError(err);
    await setRow(row.id, { lastError: message });
    return { ok: false, error: message };
  }
}

// ------------------------------------------------------------------
// Wire shape for the status routes/UI
// ------------------------------------------------------------------
export function provisioningToWire(row: ProvRow | null): {
  status: string;
  email: string | null;
  msUserId: string | null;
  serviceProfile: string | null;
  skuId: string | null;
  disabledPlans: string[];
  signInBlocked: boolean;
  mailboxRetained: boolean;
  licenseFreed: boolean;
  lastError: string | null;
  provisionedAt: string | null;
} {
  if (!row) {
    return {
      status: "not_provisioned",
      email: null,
      msUserId: null,
      serviceProfile: null,
      skuId: null,
      disabledPlans: [],
      signInBlocked: false,
      mailboxRetained: false,
      licenseFreed: false,
      lastError: null,
      provisionedAt: null,
    };
  }
  return {
    status: row.status,
    email: row.email,
    msUserId: row.msUserId,
    serviceProfile: row.serviceProfile,
    skuId: row.skuId,
    disabledPlans: row.disabledPlans ?? [],
    signInBlocked: row.signInBlocked === "yes",
    mailboxRetained: row.mailboxRetained === "yes",
    licenseFreed: row.licenseFreed === "yes",
    lastError: row.lastError,
    provisionedAt: row.provisionedAt?.toISOString() ?? null,
  };
}
