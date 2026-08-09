import type { Request, Response } from "express";
import { db, atelierAuthCredentials } from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  decryptTotpSecret,
  verifyTotpCode,
  consumeBackupCode,
  type BackupCodeRecord,
} from "./totp";
import {
  sessionTokenFromRequest,
  markSessionTotpVerified,
  lookupSession,
  type AuthSession,
} from "./session";

/** Freshness stamp: prefer the caller-provided value, else the live session. */
async function resolveSessionTotpVerifiedAt(
  req: Request,
  actor: { email: string; totpVerifiedAt?: Date | null },
): Promise<Date | null> {
  if (actor.totpVerifiedAt !== undefined) return actor.totpVerifiedAt;
  const token = sessionTokenFromRequest(req);
  const session = token ? await lookupSession(token) : null;
  return session && session.email === actor.email ? session.totpVerifiedAt : null;
}

/**
 * Task #821 — step-up verification for sensitive actions.
 *
 * When the acting user has 2FA enabled, sensitive routes (password change,
 * 2FA disable, partner resets/unlocks, account deactivation) require a FRESH
 * code: either the session passed a TOTP check within the window, or the
 * request body carries `totpCode` (a 6-digit TOTP or a backup code) which is
 * verified inline and stamps the session.
 *
 * Users without 2FA pass through unchanged (the password/role checks on the
 * route remain the gate).
 */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export type StepUpResult =
  | { ok: true; used: "none" | "fresh-session" | "totp" | "backup" }
  | { ok: false };

/**
 * Verify a raw TOTP/backup code against a credential row and persist the
 * anti-replay bookkeeping. Shared by login step 2, /2fa/verify and step-up.
 */
export async function verifyCredentialCode(
  cred: {
    email: string;
    totpEnabled: boolean;
    totpSecretEnc: string | null;
    totpLastStep: number | null;
    totpBackupCodes: unknown;
  },
  code: string,
): Promise<{ ok: boolean; method?: "totp" | "backup" }> {
  if (!cred.totpEnabled || !cred.totpSecretEnc) return { ok: false };
  const trimmed = String(code ?? "").trim();
  if (!trimmed) return { ok: false };
  const secret = decryptTotpSecret(cred.totpSecretEnc);
  if (secret) {
    const step = verifyTotpCode(secret, trimmed, cred.totpLastStep ?? null);
    if (step != null) {
      // Compare-and-swap: only the FIRST concurrent request may consume this
      // step. A parallel request that read the same stale totpLastStep loses
      // the conditional update and is rejected (single-use per 30s window).
      const claimed = await db
        .update(atelierAuthCredentials)
        .set({ totpLastStep: step, updatedAt: new Date() })
        .where(
          and(
            eq(atelierAuthCredentials.email, cred.email),
            or(
              isNull(atelierAuthCredentials.totpLastStep),
              lt(atelierAuthCredentials.totpLastStep, step),
            ),
          ),
        )
        .returning({ email: atelierAuthCredentials.email });
      if (claimed.length > 0) return { ok: true, method: "totp" };
      return { ok: false };
    }
  }
  const updated = consumeBackupCode(cred.totpBackupCodes as BackupCodeRecord[] | null, trimmed);
  if (updated) {
    // CAS on the whole backup-code array: if a concurrent request already
    // burned a code, the stored jsonb no longer matches and this one loses.
    const claimed = await db
      .update(atelierAuthCredentials)
      .set({ totpBackupCodes: updated, updatedAt: new Date() })
      .where(
        and(
          eq(atelierAuthCredentials.email, cred.email),
          sql`${atelierAuthCredentials.totpBackupCodes} = ${JSON.stringify(cred.totpBackupCodes)}::jsonb`,
        ),
      )
      .returning({ email: atelierAuthCredentials.email });
    if (claimed.length > 0) return { ok: true, method: "backup" };
    return { ok: false };
  }
  return { ok: false };
}

/**
 * Enforce step-up on a sensitive route. Writes the 403 response itself when
 * verification is missing/stale (error "step-up-required", so clients know
 * to prompt for a code and retry with `totpCode` in the body).
 */
export async function requireFreshTotp(
  req: Request,
  res: Response,
  session: Pick<AuthSession, "email" | "totpVerifiedAt">,
): Promise<StepUpResult> {
  return requireFreshTotpForActor(req, res, session);
}

/**
 * Variant for routes that resolve identity via persona (e.g. behind the
 * global gate) rather than holding an AuthSession: pass the actor's login
 * email; session freshness is honored when a session token is present.
 */
export async function requireFreshTotpForActor(
  req: Request,
  res: Response,
  actor: { email: string; totpVerifiedAt?: Date | null },
): Promise<StepUpResult> {
  const session = actor;
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, session.email));
  if (!cred || !cred.totpEnabled) return { ok: true, used: "none" };
  const inlineCode = String((req.body as { totpCode?: unknown })?.totpCode ?? "").trim();
  if (inlineCode) {
    const result = await verifyCredentialCode(cred, inlineCode);
    if (result.ok) {
      const token = sessionTokenFromRequest(req);
      if (token) await markSessionTotpVerified(token);
      return { ok: true, used: result.method! };
    }
    res.status(403).json({
      error: "step-up-invalid-code",
      message: "That verification code is incorrect or already used.",
    });
    return { ok: false };
  }
  const verifiedAt = await resolveSessionTotpVerifiedAt(req, session);
  if (verifiedAt && Date.now() - verifiedAt.getTime() < STEP_UP_WINDOW_MS) {
    return { ok: true, used: "fresh-session" };
  }
  res.status(403).json({
    error: "step-up-required",
    message: "This action requires a fresh two-factor code. Enter a code from your authenticator app.",
  });
  return { ok: false };
}
