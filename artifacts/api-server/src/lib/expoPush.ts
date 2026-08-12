/**
 * Task #1010 — Expo push sender for device notifications.
 *
 * Thin wrapper over the Expo push HTTP API (no SDK dependency). Used by
 * the personal-task reminder tick to mirror in-app self-notification
 * cards onto registered devices. Design constraints:
 *   - Fire-and-forget from callers' perspective, but failures are logged
 *     loudly (never silently swallowed into fake success).
 *   - Skipped entirely under NODE_ENV=test (offline test runs).
 *   - Tokens Expo reports as DeviceNotRegistered are pruned from the
 *     registry so dead devices stop accumulating.
 */
import { db, atelierPushTokens, atelierUsers } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Overridable for offline probes/tests (mirrors the MS_*_BASE_URL stub
// pattern). Read at call time so a probe can point the sender at a local
// stub after module load.
function expoPushUrl(): string {
  const base = process.env.EXPO_PUSH_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/--/api/v2/push/send` : "https://exp.host/--/api/v2/push/send";
}
const CHUNK = 100;

export interface PushMessage {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Task #1017 — per-category push preferences.
//
// Every self-notification kind maps onto ONE coarse category so users can
// opt out of a whole family of alerts without a per-kind wall of toggles.
// Preferences live on atelier_users.push_notification_prefs as an opt-OUT
// record: a missing key means enabled. Unknown/new kinds fall into
// "other" so a future kind can never bypass the preference layer.
// ---------------------------------------------------------------------
export const PUSH_CATEGORIES = [
  "tasks",
  "expenses",
  "timesheets",
  "approvals",
  "agreements",
  "other",
] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export function pushCategoryForKind(kind: string): PushCategory {
  if (kind === "personal_task_due") return "tasks";
  if (kind.startsWith("expense_") || kind === "engagement_expense_budget") return "expenses";
  if (kind.startsWith("timesheet_")) return "timesheets";
  if (
    kind.startsWith("ea_") ||
    kind.startsWith("leave_") ||
    kind === "bank_change"
  )
    return "approvals";
  if (kind.startsWith("agreement_") || kind === "contract_archived" || kind === "contract_signature_requested")
    return "agreements";
  return "other";
}

/** Merge stored opt-outs over the all-enabled default. */
export function resolvePushCategoryPrefs(
  stored: Record<string, boolean> | null | undefined,
): Record<PushCategory, boolean> {
  const out = {} as Record<PushCategory, boolean>;
  for (const c of PUSH_CATEGORIES) out[c] = stored?.[c] !== false;
  return out;
}

/**
 * Mirror ONE self-notification card to the owner's registered devices.
 *
 * Callers must pass the id of a card they just INSERTED (i.e. the insert
 * returned a row) — that keeps push idempotent on exactly the same key as
 * the in-app card: a card that already existed never re-pushes. Honors the
 * owner's per-category opt-out and never throws (a push hiccup must not
 * break the caller's write).
 */
export async function mirrorSelfNotificationPush(card: {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
}): Promise<{ sent: number; skipped: boolean }> {
  try {
    const category = pushCategoryForKind(card.kind);
    const [owner] = await db
      .select({ prefs: atelierUsers.pushNotificationPrefs })
      .from(atelierUsers)
      .where(eq(atelierUsers.id, card.userId));
    if (owner && resolvePushCategoryPrefs(owner.prefs)[category] === false) {
      return { sent: 0, skipped: true };
    }
    const tokens = await db
      .select()
      .from(atelierPushTokens)
      .where(eq(atelierPushTokens.userId, card.userId));
    if (!tokens.length) return { sent: 0, skipped: false };
    const res = await sendExpoPushMessages(
      tokens.map((t) => ({
        to: t.token,
        title: card.title,
        body: card.body ?? "",
        data: { href: card.href ?? null, kind: card.kind, notificationId: card.id },
      })),
    );
    return { sent: res.sent, skipped: false };
  } catch (err) {
    console.warn("[push] mirror failed for card", card.id, err);
    return { sent: 0, skipped: false };
  }
}

export function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

/** Send push messages; prunes tokens Expo says are dead. */
export async function sendExpoPushMessages(messages: PushMessage[]): Promise<{ sent: number; pruned: number }> {
  if (!messages.length) return { sent: 0, pruned: 0 };
  // Offline test runs never hit the network — unless a probe explicitly
  // points the sender at a local stub via EXPO_PUSH_BASE_URL.
  if (process.env.NODE_ENV === "test" && !process.env.EXPO_PUSH_BASE_URL) return { sent: 0, pruned: 0 };
  let sent = 0;
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(expoPushUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data ?? {},
            sound: "default",
            priority: "high",
            channelId: "task-reminders",
          })),
        ),
      });
      if (!res.ok) {
        console.warn("[push] expo push send failed:", res.status, await res.text().catch(() => ""));
        continue;
      }
      const payload = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
      const tickets = payload.data ?? [];
      tickets.forEach((t, idx) => {
        if (t.status === "ok") {
          sent++;
        } else if (t.details?.error === "DeviceNotRegistered") {
          deadTokens.push(chunk[idx]!.to);
        } else {
          console.warn("[push] ticket error:", t.details?.error ?? "unknown", "for token", chunk[idx]!.to.slice(0, 24));
        }
      });
    } catch (err) {
      console.warn("[push] expo push send threw:", err);
    }
  }
  if (deadTokens.length) {
    try {
      await db.delete(atelierPushTokens).where(inArray(atelierPushTokens.token, deadTokens));
    } catch (err) {
      console.warn("[push] failed pruning dead tokens:", err);
    }
  }
  return { sent, pruned: deadTokens.length };
}
