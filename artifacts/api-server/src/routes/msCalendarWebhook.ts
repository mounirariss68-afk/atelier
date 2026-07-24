/**
 * Task #629 — Microsoft Graph change-notification webhook (calendar).
 *
 * Public (mounted before the global auth gate) but clientState-validated:
 * every notification must carry the per-subscription random secret we
 * generated at subscription time; anything else is dropped with 202 (Graph
 * treats non-2xx as delivery failure and retries — we never want retries
 * of junk).
 *
 * Contract with Graph:
 *  - Validation handshake: POST ?validationToken=... → echo the token as
 *    text/plain 200 within 10 seconds.
 *  - Notifications: respond 202 FAST, do the work async — the delta sync
 *    is enqueued per user (single-flight, burst-collapsing).
 */
import { Router, type IRouter } from "express";
import {
  enqueueCalendarSync,
  subscriptionByGraphId,
} from "../lib/msCalendarSync";

const router: IRouter = Router();

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
}

router.post("/", async (req, res) => {
  // Validation handshake (subscription create/renew).
  const validationToken =
    typeof req.query.validationToken === "string"
      ? req.query.validationToken
      : null;
  if (validationToken) {
    res.status(200).type("text/plain").send(validationToken);
    return;
  }

  // Acknowledge immediately; process after responding.
  res.status(202).json({ ok: true });

  const value = (req.body as { value?: GraphNotification[] } | undefined)?.value;
  if (!Array.isArray(value) || value.length === 0) return;

  // De-dupe per subscription within the batch.
  const bySub = new Map<string, GraphNotification>();
  for (const n of value) {
    if (n?.subscriptionId) bySub.set(n.subscriptionId, n);
  }
  for (const [subscriptionId, n] of bySub) {
    try {
      const sub = await subscriptionByGraphId(subscriptionId);
      if (!sub) continue; // unknown/stale subscription — ignore
      if (!n.clientState || n.clientState !== sub.clientState) {
        console.warn(
          `[mscal] webhook clientState mismatch for subscription ${subscriptionId} — dropped`,
        );
        continue;
      }
      enqueueCalendarSync(sub.userId, `webhook:${n.changeType ?? "unknown"}`);
    } catch (e) {
      console.error(`[mscal] webhook processing error: ${String(e).slice(0, 300)}`);
    }
  }
});

export default router;
