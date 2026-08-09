import { db, atelierUsers, atelierAuthCredentials } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { sendEmail } from "./email";
import { buildCogniriseEmail } from "./cognirise-email-templates";
import { isDemoUser } from "./auth/demoReadOnly";
import { logger } from "./logger";

/**
 * Task #824 — proactive founder alerts for suspicious sign-in activity.
 *
 * A small set of high-signal auth events (account lockout, partner 2FA
 * reset, a burst of failed logins against one account or from one IP)
 * emails every founding partner of the affected org, with a deep link to
 * the Security Log console pre-filtered to the relevant person and day.
 *
 * All entry points are fire-and-forget: alerting must never delay or fail
 * a login response. Delivery is best-effort (sendEmail "log-only" means
 * NOT delivered — we log that outcome, nothing more we can do).
 */

export type SecurityAlertTrigger =
  | "account_locked"
  | "twofa_reset_by_partner"
  | "failed_login_burst";

// ---- debounce: one alert per (org, trigger, subject) per cooling window --
// A brute-force burst produces ONE email, not hundreds. In-memory is fine:
// a process restart at worst re-sends a single alert.
const ALERT_DEBOUNCE_MS = 30 * 60 * 1000;
const lastAlertAt = new Map<string, number>();

function debounceOk(key: string): boolean {
  const now = Date.now();
  const prev = lastAlertAt.get(key);
  if (prev && now - prev < ALERT_DEBOUNCE_MS) return false;
  lastAlertAt.set(key, now);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (lastAlertAt.size > 2000) {
    for (const [k, t] of lastAlertAt) {
      if (now - t >= ALERT_DEBOUNCE_MS) lastAlertAt.delete(k);
    }
  }
  return true;
}

/** Test-only: reset debounce + burst windows between probes. */
export function __resetSecurityAlertsForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  lastAlertAt.clear();
  failWindows.clear();
}

// Test-only observation hook: when set (NODE_ENV=test), alerts that pass
// the debounce report here INSTEAD of sending email, so probes can assert
// triggers/debounce/deep-links deterministically and fully offline.
type AlertProbe = (info: {
  trigger: SecurityAlertTrigger;
  targetEmail?: string;
  consoleUrl: string;
  recipients: string[];
}) => void;
let testProbe: AlertProbe | null = null;
export function __setSecurityAlertProbeForTests(fn: AlertProbe | null): void {
  if (process.env.NODE_ENV !== "test") return;
  testProbe = fn;
}

// ---- failed-login burst detection (sliding window per account and IP) ----
// The per-account lockout already fires at 5 consecutive wrong passwords,
// so the burst detector's job is the cases lockout misses: unknown emails
// and an attacker rotating target accounts from one IP.
const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_THRESHOLD = 8;
const failWindows = new Map<string, number[]>();

/**
 * Record one failed sign-in attempt. When the same account or the same IP
 * accumulates BURST_THRESHOLD failures inside the window, a (debounced)
 * founder alert goes out. Never throws.
 */
export function noteFailedLoginForAlerts(args: {
  email: string;
  ip: string;
  origin: string | null;
}): void {
  const now = Date.now();
  const keys: Array<{ key: string; subject: string }> = [];
  if (args.email) keys.push({ key: `email:${args.email}`, subject: args.email });
  if (args.ip && args.ip !== "unknown") keys.push({ key: `ip:${args.ip}`, subject: `IP ${args.ip}` });
  let alerted = false;
  for (const { key, subject } of keys) {
    const bucket = (failWindows.get(key) ?? []).filter((t) => now - t < BURST_WINDOW_MS);
    bucket.push(now);
    failWindows.set(key, bucket);
    // One attempt advances every window it belongs to, but raises at most
    // ONE alert — otherwise a single burst double-fires via account + IP.
    if (!alerted && bucket.length >= BURST_THRESHOLD) {
      alerted = true;
      void sendSecurityAlert({
        trigger: "failed_login_burst",
        targetEmail: args.email || undefined,
        ip: args.ip,
        origin: args.origin,
        debounceKey: key,
        detail: `${bucket.length} failed sign-in attempts for ${subject} within ${Math.round(BURST_WINDOW_MS / 60000)} minutes.`,
      }).catch((err) => logger.warn({ err }, "security alert (burst) failed"));
    }
  }
  // Opportunistic cleanup of stale windows.
  if (failWindows.size > 5000) {
    for (const [k, arr] of failWindows) {
      if (!arr.some((t) => now - t < BURST_WINDOW_MS)) failWindows.delete(k);
    }
  }
}

async function resolveOrgId(args: {
  targetUserId?: string;
  targetEmail?: string;
}): Promise<string | null> {
  let userId = args.targetUserId ?? null;
  if (!userId && args.targetEmail) {
    const [c] = await db
      .select({ userId: atelierAuthCredentials.userId })
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, args.targetEmail));
    userId = c?.userId ?? null;
  }
  if (!userId) return null;
  const [p] = await db
    .select({ orgId: atelierUsers.orgId })
    .from(atelierUsers)
    .where(eq(atelierUsers.id, userId));
  return p?.orgId ?? null;
}

const TRIGGER_COPY: Record<
  SecurityAlertTrigger,
  { subject: string; headline: (target: string) => string }
> = {
  account_locked: {
    subject: "Security alert: account locked after repeated failed sign-ins",
    headline: (t) =>
      `The account ${t} has been temporarily locked after repeated wrong-password attempts.`,
  },
  twofa_reset_by_partner: {
    subject: "Security alert: two-factor authentication was reset",
    headline: (t) => `Two-factor authentication was reset for ${t} by a founding partner.`,
  },
  failed_login_burst: {
    subject: "Security alert: burst of failed sign-in attempts",
    headline: (t) => `A burst of failed sign-in attempts was detected (${t}).`,
  },
};

/**
 * Email every founding partner of the affected org about a suspicious
 * sign-in event. Debounced per (org, trigger, subject). Never throws when
 * used fire-and-forget with .catch — all failures are logged.
 */
export async function sendSecurityAlert(args: {
  trigger: SecurityAlertTrigger;
  /** The account the event is about (used for org routing + deep link). */
  targetEmail?: string;
  targetUserId?: string;
  ip: string;
  /** Trusted request origin for building an absolute console link. */
  origin: string | null;
  /** Extra context line, e.g. burst counts or the acting partner. */
  detail?: string;
  /** Override debounce identity (bursts key on the sliding-window key). */
  debounceKey?: string;
}): Promise<void> {
  const orgId = await resolveOrgId(args);
  if (!orgId) {
    // Unknown-account noise (no tenant to route to) — the log still has it.
    logger.info({ trigger: args.trigger }, "security alert skipped: no org resolvable");
    return;
  }
  const subjectKey = args.debounceKey ?? args.targetEmail ?? args.ip;
  if (!debounceOk(`${orgId}:${args.trigger}:${subjectKey}`)) return;

  const founders = await db
    .select({
      email: atelierAuthCredentials.email,
      name: atelierUsers.name,
      userId: atelierUsers.id,
    })
    .from(atelierUsers)
    .innerJoin(atelierAuthCredentials, eq(atelierAuthCredentials.userId, atelierUsers.id))
    .where(
      and(
        eq(atelierUsers.orgId, orgId),
        eq(atelierUsers.role, "founding_partner"),
        isNull(atelierUsers.deletedAt),
        eq(atelierAuthCredentials.disabled, false),
      ),
    );
  const recipients = founders.filter((f) => !isDemoUser({ userId: f.userId, email: f.email }));
  if (recipients.length === 0) {
    logger.warn({ orgId, trigger: args.trigger }, "security alert: no founder recipients");
    return;
  }

  const copy = TRIGGER_COPY[args.trigger];
  const target = args.targetEmail ?? "an unknown account";
  const when = new Date();
  // Deep link: Security Log console pre-filtered to the person and the day
  // of the event (Admin.tsx reads these params on load).
  const day = when.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    securityTab: "auth",
    securityFrom: day,
    // Same-day end bound so the console opens to the incident's day, not
    // every event after it (the server treats a date-only `to` as inclusive).
    securityTo: day,
  });
  if (args.targetEmail) params.set("securityActor", args.targetEmail);
  const consoleUrl = `${args.origin ?? ""}/admin?${params.toString()}`;

  if (testProbe) {
    testProbe({
      trigger: args.trigger,
      targetEmail: args.targetEmail,
      consoleUrl,
      recipients: recipients.map((r) => r.email),
    });
    return;
  }

  const paragraphs = [
    copy.headline(target),
    ...(args.detail ? [args.detail] : []),
    `Source IP: ${args.ip} · Time: ${when.toISOString()}`,
    "Review the full sign-in trail in the Security Log console. No action has been taken beyond what is described above.",
  ];

  for (const r of recipients) {
    const firstName = r.name?.trim().split(/\s+/)[0];
    const { html, text, attachments } = buildCogniriseEmail({
      title: "Suspicious sign-in activity",
      greeting: firstName ? `Dear ${firstName},` : "Hello,",
      paragraphs,
      cta: { label: "Open the Security Log", url: consoleUrl },
    });
    try {
      const result = await sendEmail({
        to: r.email,
        subject: copy.subject,
        html,
        text,
        attachments,
        sender: "system",
      });
      if (!(result.ok && result.via === "resend")) {
        // log-only means NOT delivered (memory: sendEmail log-only semantics).
        logger.warn(
          { to: r.email, trigger: args.trigger, via: result.via },
          "security alert not delivered (email not configured)",
        );
      }
    } catch (err) {
      logger.warn({ err, to: r.email, trigger: args.trigger }, "security alert email failed");
    }
  }
}
