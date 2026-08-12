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
import { db, atelierPushTokens } from "@workspace/db";
import { inArray } from "drizzle-orm";

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
