import { logger } from "./logger";

export interface EmailArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
  /**
   * Explicit from-address (already validated by the caller). When absent,
   * the general fallback chain applies (RESEND_FROM → connector →
   * onboarding default).
   */
  from?: string;
}

interface ResendCredentials {
  apiKey: string;
  fromEmail?: string;
}

let cachedCreds: { creds: ResendCredentials | null; fetchedAt: number } | null = null;
const CRED_CACHE_MS = 5 * 60 * 1000;

async function fetchConnectorCredentials(): Promise<ResendCredentials | null> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? `repl ${process.env["REPL_IDENTITY"]}`
    : process.env["WEB_REPL_RENEWAL"]
      ? `depl ${process.env["WEB_REPL_RENEWAL"]}`
      : null;
  if (!hostname || !xReplitToken) return null;
  try {
    const resp = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN: xReplitToken,
        },
      },
    );
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Resend connector lookup failed");
      return null;
    }
    const data = (await resp.json()) as {
      items?: { settings?: { api_key?: string; from_email?: string } }[];
    };
    const settings = data.items?.[0]?.settings;
    if (!settings?.api_key) return null;
    return { apiKey: settings.api_key, fromEmail: settings.from_email };
  } catch (err) {
    logger.warn({ err }, "Resend connector lookup error");
    return null;
  }
}

async function getResendCredentials(): Promise<ResendCredentials | null> {
  const now = Date.now();
  if (cachedCreds && now - cachedCreds.fetchedAt < CRED_CACHE_MS) {
    return cachedCreds.creds;
  }
  let creds = await fetchConnectorCredentials();
  if (!creds) {
    const envKey = process.env["RESEND_API_KEY"];
    if (envKey) creds = { apiKey: envKey };
  }
  cachedCreds = { creds, fetchedAt: now };
  return creds;
}

export async function getEmailDeliveryStatus(): Promise<{ configured: boolean; via: string }> {
  const creds = await getResendCredentials();
  return creds
    ? { configured: true, via: "resend" }
    : { configured: false, via: "log-only" };
}

const FROM_RE = /^(?:[^<>]*<\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+(?:\s*>)?$/;

function pickFromAddress(...candidates: (string | undefined)[]): string {
  return firstValidFromAddress(...candidates) ?? "Cognirise <onboarding@resend.dev>";
}

/** First syntactically valid from-address among the candidates, else null. */
export function firstValidFromAddress(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    if (c && FROM_RE.test(c.trim())) return c.trim();
    if (c) logger.warn({ value: "<redacted>" }, "Ignoring malformed email from-address candidate");
  }
  return null;
}

/**
 * Task #514 — the Cognirise-branded sender for signer-facing emails
 * (e-sign invites). Unlike the general chain, this NEVER falls back to
 * the onboarding/dev default: RESEND_BRANDED_FROM → RESEND_FROM →
 * connector from_email, each validated; null when none is a valid
 * address. Callers must treat null as "cannot deliver branded email".
 */
export async function getBrandedFromAddress(): Promise<string | null> {
  const creds = await getResendCredentials();
  return firstValidFromAddress(
    process.env["RESEND_BRANDED_FROM"],
    process.env["RESEND_FROM"],
    creds?.fromEmail,
  );
}

export async function sendEmail(args: EmailArgs): Promise<{ ok: boolean; via: string }> {
  const creds = await getResendCredentials();
  if (!creds) {
    logger.warn(
      { to: args.to, subject: args.subject },
      "Email NOT delivered: no Resend connection or RESEND_API_KEY configured (log-only mode)",
    );
    return { ok: true, via: "log-only" };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from ?? pickFromAddress(process.env["RESEND_FROM"], creds.fromEmail),
        to: [args.to],
        subject: args.subject,
        html: args.html,
        attachments: args.attachments,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      logger.warn({ status: resp.status, body: txt }, "Resend email send failed; falling back to log");
      return { ok: false, via: "log-only" };
    }
    return { ok: true, via: "resend" };
  } catch (err) {
    logger.warn({ err }, "Email send error");
    return { ok: false, via: "log-only" };
  }
}
