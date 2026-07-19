/**
 * Task #327 — Microsoft Graph helper for per-user Microsoft 365 connections.
 *
 * Authorization-code + PKCE flow against a Cognirise app registration in
 * Microsoft Entra ID (single tenant, delegated permissions only). Each
 * Atelier user links their own account; we never request application-level
 * mailbox access.
 *
 * Refresh tokens are encrypted at rest with AES-256-GCM. The key is
 * derived (HKDF-SHA256) from MS_TOKEN_ENC_SECRET when set, otherwise from
 * SESSION_SECRET — both server-side secrets, never in source.
 *
 * MS_LOGIN_BASE_URL / MS_GRAPH_BASE_URL exist ONLY so the test harness can
 * point the flow at a local stub; production always uses the Microsoft
 * defaults.
 */
import crypto from "node:crypto";

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------
export const MS_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Calendars.Read",
];

export function msConfigured(): boolean {
  return Boolean(
    process.env.MS_CLIENT_ID &&
      process.env.MS_TENANT_ID &&
      process.env.MS_CLIENT_SECRET,
  );
}

function loginBase(): string {
  return (
    process.env.MS_LOGIN_BASE_URL?.replace(/\/$/, "") ||
    "https://login.microsoftonline.com"
  );
}

function graphBase(): string {
  return (
    process.env.MS_GRAPH_BASE_URL?.replace(/\/$/, "") ||
    "https://graph.microsoft.com/v1.0"
  );
}

function tokenEndpoint(): string {
  return `${loginBase()}/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
}

// ------------------------------------------------------------------
// Token encryption (AES-256-GCM, key via HKDF)
// ------------------------------------------------------------------
function encKey(): Buffer {
  const material =
    process.env.MS_TOKEN_ENC_SECRET || process.env.SESSION_SECRET;
  if (!material) {
    throw new Error(
      "ms-token-encryption: neither MS_TOKEN_ENC_SECRET nor SESSION_SECRET is set",
    );
  }
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(material, "utf8"),
      Buffer.alloc(0),
      "atelier-ms-refresh-token-v1",
      32,
    ),
  );
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptToken(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("ms-token-encryption: malformed ciphertext");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ------------------------------------------------------------------
// OAuth state — HMAC-signed, short-lived, bound to the Atelier user.
// Stored in an httpOnly cookie alongside the PKCE verifier so the
// callback can validate without a server-side session store.
// ------------------------------------------------------------------
function stateKey(): Buffer {
  return crypto
    .createHash("sha256")
    .update(`atelier-ms-oauth-state:${process.env.MS_TOKEN_ENC_SECRET || process.env.SESSION_SECRET || ""}`)
    .digest();
}

export interface MsOauthState {
  userId: string;
  nonce: string;
  codeVerifier: string;
  issuedAt: number; // epoch ms
}

export function signState(s: MsOauthState): string {
  const payload = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  const mac = crypto
    .createHmac("sha256", stateKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyState(token: string): MsOauthState | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = crypto
    .createHmac("sha256", stateKey())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as MsOauthState;
    if (!s.userId || !s.nonce || !s.codeVerifier) return null;
    if (Date.now() - s.issuedAt > 10 * 60 * 1000) return null; // 10 min
    return s;
  } catch {
    return null;
  }
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(
    `${loginBase()}/${process.env.MS_TENANT_ID}/oauth2/v2.0/authorize`,
  );
  u.searchParams.set("client_id", process.env.MS_CLIENT_ID ?? "");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MS_SCOPES.join(" "));
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// ------------------------------------------------------------------
// Token exchange / refresh
// ------------------------------------------------------------------
export interface MsTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
}

export class MsAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "admin-consent-required"
      | "token-exchange-failed"
      | "refresh-failed",
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "MsAuthError";
  }
}

function isAdminConsentError(body: string): boolean {
  // AADSTS65001: user/admin has not consented; AADSTS650052: app needs
  // permissions to a service the tenant admin has not approved.
  return /AADSTS65001|AADSTS650052|consent_required/i.test(body);
}

async function tokenRequest(
  params: Record<string, string>,
  kind: "token-exchange-failed" | "refresh-failed",
): Promise<MsTokenSet> {
  const resp = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID ?? "",
      client_secret: process.env.MS_CLIENT_SECRET ?? "",
      ...params,
    }).toString(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`[msGraph] ${kind}: HTTP ${resp.status} ${text.slice(0, 500)}`);
    if (isAdminConsentError(text)) {
      throw new MsAuthError(
        "Microsoft 365 admin consent required",
        "admin-consent-required",
        text.slice(0, 500),
      );
    }
    throw new MsAuthError(`Microsoft token request failed (${resp.status})`, kind, text.slice(0, 500));
  }
  const json = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? 3600,
    scopes: (json.scope ?? "").split(" ").filter(Boolean),
  };
}

export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<MsTokenSet> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
      scope: MS_SCOPES.join(" "),
    },
    "token-exchange-failed",
  );
}

export async function refreshTokens(refreshToken: string): Promise<MsTokenSet> {
  return tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPES.join(" "),
    },
    "refresh-failed",
  );
}

// ------------------------------------------------------------------
// Graph calls (delegated; the token only sees the caller's own data)
// ------------------------------------------------------------------
async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const resp = await fetch(`${graphBase()}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`[msGraph] GET ${path} → ${resp.status} ${text.slice(0, 300)}`);
    throw new Error(`graph-request-failed:${resp.status}`);
  }
  return JSON.parse(text) as T;
}

export interface MsProfile {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

export async function getMsProfile(accessToken: string): Promise<MsProfile> {
  return graphGet<MsProfile>(accessToken, "/me");
}

export interface MsCalendarEvent {
  id: string;
  subject?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    type?: string;
  }>;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  webLink?: string;
}

export async function getCalendarView(
  accessToken: string,
  startIso: string,
  endIso: string,
): Promise<MsCalendarEvent[]> {
  const qs = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $orderby: "start/dateTime",
    $top: "100",
    $select:
      "id,subject,isCancelled,isAllDay,start,end,location,onlineMeeting,onlineMeetingUrl,attendees,organizer,webLink",
  });
  const out: MsCalendarEvent[] = [];
  let path: string | null = `/me/calendarView?${qs.toString()}`;
  let guard = 0;
  while (path && guard < 5) {
    guard += 1;
    const page: { value: MsCalendarEvent[]; "@odata.nextLink"?: string } =
      await graphGet(accessToken, path);
    out.push(...(page.value ?? []));
    const next: string | undefined = page["@odata.nextLink"];
    path = next ? next.replace(graphBase(), "") : null;
    if (path && !path.startsWith("/")) path = null; // absolute foreign URL — stop
  }
  return out;
}
