import { logger } from "./logger";

/** The human on whose behalf an email is sent (resolved from the session). */
export interface EmailActor {
  name?: string | null;
  email: string;
}

/**
 * Task #545 — every sendEmail caller must state WHO the email is from:
 * either the acting user (session identity; EA acting-for passes the
 * represented partner) or explicitly "system" for scheduler/agent sends
 * with no human actor. There is no silent default.
 */
export type EmailSender = { actor: EmailActor } | "system";

export interface EmailArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string; content_id?: string }[];
  /** Optional plain-text alternative body. */
  text?: string;
  /** Who this email is from — acting user or explicitly "system". */
  sender: EmailSender;
  /**
   * Explicit from-address override (already validated by the caller).
   * When absent, the from is resolved from `sender`.
   */
  from?: string;
  replyTo?: string;
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

// ---------------------------------------------------------------------------
// Task #545 — per-actor sender resolution.
//
// The set of domains this Resend account may send from is fetched live
// (GET /domains, status "verified") and cached. An actor whose email is on
// a verified domain sends as themselves: `Name <them@domain>`. Anyone else
// (e.g. a gmail login) cannot be the From — Resend would reject it — so the
// email goes out branded with the actor's name prefixed and their real
// address as Reply-To.
// ---------------------------------------------------------------------------

let cachedDomains: { domains: string[]; fetchedAt: number } | null = null;
const DOMAIN_CACHE_MS = 10 * 60 * 1000;

/** Resend API base — overridable for stub-server tests. */
function resendBase(): string {
  return process.env["RESEND_API_BASE_URL"] ?? "https://api.resend.com";
}

async function getVerifiedDomains(apiKey: string): Promise<string[]> {
  const now = Date.now();
  if (cachedDomains && now - cachedDomains.fetchedAt < DOMAIN_CACHE_MS) {
    return cachedDomains.domains;
  }
  try {
    const resp = await fetch(`${resendBase()}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Resend domains lookup failed");
      return cachedDomains?.domains ?? [];
    }
    const data = (await resp.json()) as {
      data?: { name?: string; status?: string }[];
    };
    const domains = (data.data ?? [])
      .filter((d) => d.status === "verified" && d.name)
      .map((d) => (d.name as string).toLowerCase());
    cachedDomains = { domains, fetchedAt: now };
    return domains;
  } catch (err) {
    logger.warn({ err }, "Resend domains lookup error");
    return cachedDomains?.domains ?? [];
  }
}

/** For tests: drop the credential + domain caches. */
export function __resetEmailCaches(): void {
  cachedCreds = null;
  cachedDomains = null;
}

function emailDomain(addr: string): string | null {
  const m = /@([^\s@<>]+)\s*>?\s*$/.exec(addr.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * RFC 5322/2047-safe display-name + address formatting. Non-ASCII names
 * (e.g. "Gökhan Güney") are B-encoded so they render correctly everywhere.
 */
export function formatFromHeader(name: string | null | undefined, email: string): string {
  const clean = (name ?? "").replace(/[\r\n<>]/g, "").trim();
  if (!clean) return email;
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7e]/.test(clean)) {
    return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?= <${email}>`;
  }
  if (/[^\w .'-]/.test(clean)) {
    return `"${clean.replace(/"/g, "'")}" <${email}>`;
  }
  return `${clean} <${email}>`;
}

interface ResolvedSender {
  from: string;
  replyTo?: string;
  /** True when the from is the actor's own verified-domain address. */
  asActor: boolean;
}

/**
 * Resolve the From (and Reply-To) for a sender. Exported so surfaces that
 * must pre-check deliverability (e-sign invites) can inspect the result.
 */
export async function resolveSender(sender: EmailSender): Promise<ResolvedSender> {
  const creds = await getResendCredentials();
  const branded =
    (await getBrandedFromAddress()) ??
    pickFromAddress(process.env["RESEND_FROM"], creds?.fromEmail);
  if (sender === "system") return { from: branded, asActor: false };
  const actor = sender.actor;
  const actorDomain = emailDomain(actor.email);
  if (creds && actorDomain) {
    const verified = await getVerifiedDomains(creds.apiKey);
    if (verified.includes(actorDomain)) {
      return { from: formatFromHeader(actor.name, actor.email), asActor: true };
    }
  }
  // Actor's domain is not verified — send branded, keep their name visible
  // and route replies to their real address.
  const brandedEmail = /<\s*([^<>\s]+)\s*>/.exec(branded)?.[1] ?? branded;
  const name = (actor.name ?? "").trim();
  return {
    from: formatFromHeader(name ? `${name} · Cognirise` : "Cognirise", brandedEmail),
    replyTo: actor.email,
    asActor: false,
  };
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
    const resolved = await resolveSender(args.sender);
    const resp = await fetch(`${resendBase()}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from ?? resolved.from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        attachments: args.attachments,
        reply_to: args.replyTo ?? resolved.replyTo,
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
