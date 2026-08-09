import type { Request } from "express";

/**
 * Task #820 — links we EMAIL (reset/activation) must never be built from an
 * attacker-controllable request Origin/Referer: a forged forgot-password
 * request could otherwise route a victim's live token through a hostile
 * domain. Only origins whose hostname matches one of the app's own domains
 * (REPLIT_DOMAINS — the deployment domains in production, the dev domain in
 * the workspace — plus REPLIT_DEV_DOMAIN) are trusted; anything else falls
 * back to the canonical first configured domain.
 */
function allowedHostnames(): Set<string> {
  const hosts = new Set<string>();
  for (const raw of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
    const h = raw.trim().toLowerCase();
    if (h) hosts.add(h);
  }
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim().toLowerCase();
  if (dev) hosts.add(dev);
  return hosts;
}

/** Canonical https origin from config, independent of the request. */
export function canonicalOrigin(): string | null {
  const first = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  if (first) return `https://${first}`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  return dev ? `https://${dev}` : null;
}

/**
 * The request's Origin/Referer, but ONLY when it points at one of our own
 * domains (preserves same-origin behavior behind the dev proxy); otherwise
 * the canonical configured origin, or null when nothing is configured.
 */
export function trustedRequestOrigin(req: Request): string | null {
  const allowed = allowedHostnames();
  for (const candidate of [req.get("origin"), req.get("referer")]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        allowed.has(parsed.hostname.toLowerCase())
      ) {
        return parsed.origin;
      }
    } catch {
      // ignore malformed headers
    }
  }
  return canonicalOrigin();
}
