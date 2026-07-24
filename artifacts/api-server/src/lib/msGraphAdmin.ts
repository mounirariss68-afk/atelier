/**
 * Task #628 — Microsoft Graph ADMIN client (application permissions).
 *
 * Client-credentials flow against the same Cognirise app registration used
 * for the per-user delegated connections (msGraph.ts), but with a
 * completely separate token path: `scope=https://graph.microsoft.com/.default`
 * grants whatever APPLICATION permissions a tenant admin has consented to
 * (User.ReadWrite.All, Directory.ReadWrite.All / LicenseAssignment.ReadWrite.All).
 *
 * ONE-TIME ADMIN SETUP (founders, in Microsoft Entra admin center):
 *   1. Entra ID → App registrations → "Cognirise Atelier" → API permissions
 *   2. Add permission → Microsoft Graph → APPLICATION permissions:
 *        - User.ReadWrite.All        (create/update/block users)
 *        - Directory.ReadWrite.All   (license + directory management)
 *   3. Click "Grant admin consent for Cognirise".
 * Until that consent exists every call here fails with
 * code="admin-consent-required" — surfaced as a flagged manual step, never
 * a silent failure. GoDaddy-resold tenants additionally block some
 * operations outright; those surface as code="tenant-blocked".
 *
 * MS_LOGIN_BASE_URL / MS_GRAPH_BASE_URL exist ONLY for the test stub.
 */

export type MsAdminErrorCode =
  | "not-configured"
  | "admin-consent-required"
  | "tenant-blocked"
  | "graph-failed";

export class MsAdminError extends Error {
  constructor(
    message: string,
    public readonly code: MsAdminErrorCode,
    public readonly status?: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "MsAdminError";
  }
}

export function msAdminConfigured(): boolean {
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

// ------------------------------------------------------------------
// App token (cached until ~2 min before expiry)
// ------------------------------------------------------------------
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAppToken(): Promise<string> {
  if (!msAdminConfigured()) {
    throw new MsAdminError(
      "Microsoft 365 admin credentials are not configured",
      "not-configured",
    );
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 120_000) {
    return cachedToken.token;
  }
  const resp = await fetch(
    `${loginBase()}/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID ?? "",
        client_secret: process.env.MS_CLIENT_SECRET ?? "",
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    },
  );
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`[msGraphAdmin] app token failed: ${resp.status} ${text.slice(0, 400)}`);
    throw new MsAdminError(
      "Could not obtain a Microsoft application token",
      "graph-failed",
      resp.status,
      text.slice(0, 400),
    );
  }
  const json = JSON.parse(text) as { access_token: string; expires_in?: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

/** Test-only: drop the cached app token. */
export function __resetAppTokenCache(): void {
  cachedToken = null;
}

// ------------------------------------------------------------------
// Request helper — maps Graph refusals to structured errors
// ------------------------------------------------------------------
async function graphRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getAppToken();
  const resp = await fetch(`${graphBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  if (!resp.ok) {
    console.error(`[msGraphAdmin] ${method} ${path} → ${resp.status} ${text.slice(0, 400)}`);
    // Authorization_RequestDenied on an app-only token means the
    // application permission has not been admin-consented (or the
    // GoDaddy-managed tenant strips it). Both need founder action.
    if (
      resp.status === 401 ||
      /Authorization_RequestDenied|Insufficient privileges/i.test(text)
    ) {
      throw new MsAdminError(
        "Microsoft 365 admin consent is missing for user management. A founder must grant application permissions (User.ReadWrite.All, Directory.ReadWrite.All) in the Microsoft Entra admin center.",
        "admin-consent-required",
        resp.status,
        text.slice(0, 400),
      );
    }
    if (resp.status === 403) {
      throw new MsAdminError(
        "The Microsoft 365 tenant refused this operation (GoDaddy-managed tenants restrict some directory changes). Complete the step manually in the GoDaddy / Microsoft admin portal.",
        "tenant-blocked",
        resp.status,
        text.slice(0, 400),
      );
    }
    throw new MsAdminError(
      `Microsoft Graph request failed (${resp.status})`,
      "graph-failed",
      resp.status,
      text.slice(0, 400),
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// ------------------------------------------------------------------
// Users
// ------------------------------------------------------------------
export interface MsDirectoryUser {
  id: string;
  displayName?: string;
  givenName?: string | null;
  surname?: string | null;
  userPrincipalName?: string;
  mail?: string | null;
  accountEnabled?: boolean;
  assignedLicenses?: Array<{ skuId: string; disabledPlans: string[] }>;
}

const USER_SELECT =
  "$select=id,displayName,givenName,surname,userPrincipalName,mail,accountEnabled,assignedLicenses";

/** Pre-create existence check: look up a tenant user by UPN or mail. */
export async function findUserByEmail(
  email: string,
): Promise<MsDirectoryUser | null> {
  const esc = email.trim().toLowerCase().replace(/'/g, "''");
  const out = await graphRequest<{ value: MsDirectoryUser[] }>(
    "GET",
    `/users?$filter=userPrincipalName eq '${encodeURIComponent(esc)}' or mail eq '${encodeURIComponent(esc)}'&${USER_SELECT}`,
  );
  return out.value[0] ?? null;
}

export async function getUser(msUserId: string): Promise<MsDirectoryUser | null> {
  try {
    return await graphRequest<MsDirectoryUser>(
      "GET",
      `/users/${encodeURIComponent(msUserId)}?${USER_SELECT}`,
    );
  } catch (err) {
    if (err instanceof MsAdminError && err.status === 404) return null;
    throw err;
  }
}

export async function createUser(args: {
  displayName: string;
  givenName?: string | null;
  surname?: string | null;
  userPrincipalName: string;
  mailNickname: string;
  initialPassword: string;
  usageLocation?: string;
}): Promise<MsDirectoryUser> {
  return graphRequest<MsDirectoryUser>("POST", "/users", {
    accountEnabled: true,
    displayName: args.displayName,
    givenName: args.givenName || undefined,
    surname: args.surname || undefined,
    userPrincipalName: args.userPrincipalName,
    mailNickname: args.mailNickname,
    // License assignment requires a usage location; the firm operates
    // from Dubai (AE) — overridable later in the admin portal.
    usageLocation: args.usageLocation ?? "AE",
    passwordProfile: {
      password: args.initialPassword,
      forceChangePasswordNextSignIn: true,
    },
  });
}

export async function updateUser(
  msUserId: string,
  patch: {
    displayName?: string;
    givenName?: string | null;
    surname?: string | null;
    accountEnabled?: boolean;
  },
): Promise<void> {
  await graphRequest<void>(
    "PATCH",
    `/users/${encodeURIComponent(msUserId)}`,
    patch,
  );
}

/** Invalidate every refresh/session token the Microsoft user holds. */
export async function revokeMsSessions(msUserId: string): Promise<void> {
  await graphRequest<{ value?: boolean }>(
    "POST",
    `/users/${encodeURIComponent(msUserId)}/revokeSignInSessions`,
    {},
  );
}

export async function deleteUser(msUserId: string): Promise<void> {
  await graphRequest<void>("DELETE", `/users/${encodeURIComponent(msUserId)}`);
}

// ------------------------------------------------------------------
// Licenses
// ------------------------------------------------------------------
export interface MsSubscribedSku {
  skuId: string;
  skuPartNumber: string;
  capabilityStatus?: string;
  prepaidUnits: { enabled: number; suspended: number; warning: number };
  consumedUnits: number;
  servicePlans: Array<{
    servicePlanId: string;
    servicePlanName: string;
    provisioningStatus?: string;
    appliesTo?: string;
  }>;
}

export async function listSubscribedSkus(): Promise<MsSubscribedSku[]> {
  const out = await graphRequest<{ value: MsSubscribedSku[] }>(
    "GET",
    "/subscribedSkus",
  );
  return out.value ?? [];
}

export function skuHasSpareUnit(sku: MsSubscribedSku): boolean {
  return (
    (sku.capabilityStatus ?? "Enabled") === "Enabled" &&
    sku.prepaidUnits.enabled > sku.consumedUnits
  );
}

export async function assignLicense(
  msUserId: string,
  skuId: string,
  disabledPlans: string[],
): Promise<void> {
  await graphRequest<unknown>(
    "POST",
    `/users/${encodeURIComponent(msUserId)}/assignLicense`,
    {
      addLicenses: [{ skuId, disabledPlans }],
      removeLicenses: [],
    },
  );
}

export async function removeLicense(
  msUserId: string,
  skuId: string,
): Promise<void> {
  await graphRequest<unknown>(
    "POST",
    `/users/${encodeURIComponent(msUserId)}/assignLicense`,
    { addLicenses: [], removeLicenses: [skuId] },
  );
}
