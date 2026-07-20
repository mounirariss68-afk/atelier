/**
 * Task #327 — Per-user Microsoft 365 connection + calendar.
 *
 * Self-scope routes (every persona may reach /me/*):
 *   GET    /me/msauth/start        → 302 to Microsoft sign-in (PKCE + signed state)
 *   GET    /me/msauth/callback     → code exchange, upsert connection, redirect to /me/profile
 *   GET    /me/msconnection        → connection status (never exposes tokens)
 *   DELETE /me/msconnection        → disconnect (deletes the row + tokens)
 *   GET    /me/calendar            → caller's calendar window w/ CRM contact matching
 *
 * Security properties:
 *  - The OAuth state is HMAC-signed, bound to the calling Atelier user id,
 *    and carried in a 10-minute httpOnly cookie together with the PKCE
 *    verifier — the callback rejects any mismatch.
 *  - Refresh tokens are AES-256-GCM encrypted at rest and never appear in
 *    any API response.
 *  - Contact→account matching is filtered through canSeeAccount so a
 *    meeting never leaks an account reference the viewer cannot open.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierMsConnections,
  atelierMsMeetingLogs,
  atelierActivities,
  atelierContacts,
  atelierAccounts,
  atelierAuditEvents,
} from "@workspace/db";
import {
  MS_SCOPES,
  MsAuthError,
  buildAuthorizeUrl,
  decryptToken,
  encryptToken,
  exchangeCode,
  getCalendarView,
  getMsProfile,
  makePkce,
  msConfigured,
  refreshTokens,
  signState,
  verifyState,
  type MsCalendarEvent,
} from "../../lib/msGraph.js";
import { runMsMeetingAutolog } from "../../lib/msMeetingAutolog.js";
import { canSeeAccount } from "./accountRoutes.js";
import { accessibleEngagementIds } from "./engagementRoutes.js";
import { assertAuditAction } from "./auditContract";
import crypto from "node:crypto";

const router: IRouter = Router();

const STATE_COOKIE = "atelier_ms_oauth";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

async function audit(args: {
  me: typeof atelierUsers.$inferSelect;
  action: string;
  entityId: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: args.me.orgId,
    entityType: "ms_connection",
    entityId: args.entityId,
    actorType: "human",
    actorId: args.me.id,
    actorLabel: args.me.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

/**
 * Redirect URI must exactly match the Entra app registration. We derive it
 * from the request's own host (behind the Replit proxy `x-forwarded-*` is
 * set and express `trust proxy` handles req.protocol).
 */
function redirectUri(req: Request): string {
  const host = req.get("host");
  const proto = req.protocol === "http" && host?.includes("localhost")
    ? "http"
    : "https";
  return `${proto}://${host}/api/atelier/me/msauth/callback`;
}

/** Where the browser lands after the flow (Me lens → Profile tab). */
function settingsRedirect(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/me/profile${qs ? `?${qs}` : ""}`;
}

async function loadConnection(me: typeof atelierUsers.$inferSelect) {
  const [row] = await db
    .select()
    .from(atelierMsConnections)
    .where(
      and(
        eq(atelierMsConnections.orgId, me.orgId),
        eq(atelierMsConnections.userId, me.id),
      ),
    );
  return row ?? null;
}

// ------------------------------------------------------------------
// GET /me/msauth/start — kick off the Microsoft sign-in
// ------------------------------------------------------------------
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.get("/me/msauth/start", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!msConfigured()) {
    res.redirect(settingsRedirect({ ms_error: "not-configured" }));
    return;
  }
  const { verifier, challenge } = makePkce();
  const state = signState({
    userId: me.id,
    nonce: crypto.randomBytes(16).toString("base64url"),
    codeVerifier: verifier,
    issuedAt: Date.now(),
  });
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/atelier/me/msauth",
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(
    buildAuthorizeUrl({
      redirectUri: redirectUri(req),
      state,
      codeChallenge: challenge,
    }),
  );
});

// ------------------------------------------------------------------
// GET /me/msauth/callback — exchange code, store encrypted tokens
// ------------------------------------------------------------------
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.get("/me/msauth/callback", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;

    // Microsoft-side error (user cancelled, admin consent missing, …)
    const oauthError = typeof req.query.error === "string" ? req.query.error : null;
    const oauthErrorDesc =
      typeof req.query.error_description === "string"
        ? req.query.error_description
        : "";
    if (oauthError) {
      const friendly = /AADSTS65001|AADSTS650052|consent_required/i.test(
        `${oauthError} ${oauthErrorDesc}`,
      )
        ? "admin-consent"
        : oauthError === "access_denied"
          ? "cancelled"
          : "oauth-failed";
      console.error(`[msauth] callback error: ${oauthError} ${oauthErrorDesc.slice(0, 300)}`);
      res.clearCookie(STATE_COOKIE, { path: "/api/atelier/me/msauth" });
      res.redirect(settingsRedirect({ ms_error: friendly }));
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const stateParam =
      typeof req.query.state === "string" ? req.query.state : null;
    const stateCookie = req.cookies?.[STATE_COOKIE] as string | undefined;
    res.clearCookie(STATE_COOKIE, { path: "/api/atelier/me/msauth" });

    const state = stateParam ? verifyState(stateParam) : null;
    // Constant-time compare of cookie vs returned state (defense in depth —
    // the HMAC in verifyState is the real integrity check).
    const cookieMatches =
      Boolean(stateCookie && stateParam) &&
      stateCookie!.length === stateParam!.length &&
      crypto.timingSafeEqual(Buffer.from(stateCookie!), Buffer.from(stateParam!));
    if (!code || !state || !cookieMatches) {
      res.redirect(settingsRedirect({ ms_error: "state-mismatch" }));
      return;
    }
    // Bind the flow to the persona that started it.
    if (state.userId !== me.id) {
      res.redirect(settingsRedirect({ ms_error: "state-mismatch" }));
      return;
    }

    let tokens;
    try {
      tokens = await exchangeCode({
        code,
        redirectUri: redirectUri(req),
        codeVerifier: state.codeVerifier,
      });
    } catch (e) {
      if (e instanceof MsAuthError && e.code === "admin-consent-required") {
        res.redirect(settingsRedirect({ ms_error: "admin-consent" }));
        return;
      }
      console.error("[msauth] token exchange failed", e);
      res.redirect(settingsRedirect({ ms_error: "oauth-failed" }));
      return;
    }
    if (!tokens.refreshToken) {
      // offline_access missing — nothing durable to store.
      res.redirect(settingsRedirect({ ms_error: "no-refresh-token" }));
      return;
    }

    let profile;
    try {
      profile = await getMsProfile(tokens.accessToken);
    } catch (e) {
      console.error("[msauth] /me profile fetch failed", e);
      res.redirect(settingsRedirect({ ms_error: "oauth-failed" }));
      return;
    }

    const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
    const enc = encryptToken(tokens.refreshToken);
    const existing = await loadConnection(me);
    const now = new Date();
    if (existing) {
      await db
        .update(atelierMsConnections)
        .set({
          msEmail: email,
          msOid: profile.id,
          msDisplayName: profile.displayName ?? null,
          encRefreshToken: enc,
          scopes: tokens.scopes.length ? tokens.scopes : MS_SCOPES,
          connectedAt: now,
          lastSyncedAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(atelierMsConnections.id, existing.id));
    } else {
      await db.insert(atelierMsConnections).values({
        id: rid("msc"),
        orgId: me.orgId,
        userId: me.id,
        msEmail: email,
        msOid: profile.id,
        msDisplayName: profile.displayName ?? null,
        encRefreshToken: enc,
        scopes: tokens.scopes.length ? tokens.scopes : MS_SCOPES,
        connectedAt: now,
        lastSyncedAt: now,
      });
    }
    await audit({
      me,
      action: "ms.connection.connected",
      entityId: existing?.id ?? me.id,
      payload: { msEmail: email },
      summary: `${me.name} connected Microsoft 365 (${email})`,
    });
    res.redirect(settingsRedirect({ ms: "connected" }));
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// GET /me/msconnection — status (no tokens, ever)
// ------------------------------------------------------------------
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.get("/me/msconnection", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const row = await loadConnection(me);
    res.json({
      configured: msConfigured(),
      connected: Boolean(row),
      msEmail: row?.msEmail ?? null,
      msDisplayName: row?.msDisplayName ?? null,
      connectedAt: row?.connectedAt?.toISOString() ?? null,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// DELETE /me/msconnection — disconnect (delete row + tokens)
// ------------------------------------------------------------------
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.delete("/me/msconnection", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const row = await loadConnection(me);
    if (!row) {
      res.json({ ok: true, disconnected: false });
      return;
    }
    // Microsoft v2 has no server-side refresh-token revocation endpoint for
    // confidential clients acting on delegated tokens; deleting the row
    // destroys our only copy, and the token expires on Microsoft's side.
    await db
      .delete(atelierMsConnections)
      .where(eq(atelierMsConnections.id, row.id));
    await audit({
      me,
      action: "ms.connection.disconnected",
      entityId: row.id,
      payload: { msEmail: row.msEmail },
      summary: `${me.name} disconnected Microsoft 365 (${row.msEmail})`,
    });
    res.json({ ok: true, disconnected: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// GET /me/calendar — the caller's own meetings + CRM matching
// ------------------------------------------------------------------
interface WireMeeting {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  joinUrl: string | null;
  webLink: string | null;
  organizerEmail: string | null;
  attendees: Array<{ email: string; name: string | null }>;
  matches: Array<{
    contactId: string;
    contactName: string;
    accountId: string;
    accountName: string;
  }>;
}

// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.get("/me/calendar", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!msConfigured()) {
      res.json({ configured: false, connected: false, meetings: [] });
      return;
    }
    const row = await loadConnection(me);
    if (!row) {
      res.json({ configured: true, connected: false, meetings: [] });
      return;
    }

    // Window: default this week (today .. +7 days), max 60 days.
    const now = new Date();
    const startQ = typeof req.query.start === "string" ? req.query.start : null;
    const endQ = typeof req.query.end === "string" ? req.query.end : null;
    const start = startQ ? new Date(startQ) : now;
    const end = endQ
      ? new Date(endQ)
      : new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start ||
      end.getTime() - start.getTime() > 60 * 24 * 3600 * 1000
    ) {
      res.status(400).json({ error: "invalid-window" });
      return;
    }
    const accountIdFilter =
      typeof req.query.accountId === "string" ? req.query.accountId : null;

    // Fresh access token from the stored refresh token (persist rotation).
    let events: MsCalendarEvent[];
    try {
      const tokens = await refreshTokens(decryptToken(row.encRefreshToken));
      if (tokens.refreshToken) {
        await db
          .update(atelierMsConnections)
          .set({
            encRefreshToken: encryptToken(tokens.refreshToken),
            lastSyncedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(atelierMsConnections.id, row.id));
      }
      events = await getCalendarView(
        tokens.accessToken,
        start.toISOString(),
        end.toISOString(),
      );
    } catch (e) {
      const detail =
        e instanceof MsAuthError ? e.code : "graph-unavailable";
      console.error("[msauth] calendar fetch failed", e);
      await db
        .update(atelierMsConnections)
        .set({ lastError: detail, updatedAt: new Date() })
        .where(eq(atelierMsConnections.id, row.id));
      res.status(502).json({
        error: "graph-unavailable",
        reason:
          detail === "refresh-failed" || detail === "admin-consent-required"
            ? "Your Microsoft 365 connection needs to be renewed. Disconnect and connect again."
            : "Microsoft 365 is unreachable right now. Try again shortly.",
        detail,
      });
      return;
    }

    const live = events.filter((ev) => !ev.isCancelled);

    // CRM matching: attendee email → contact → account (org-scoped),
    // filtered through canSeeAccount so no invisible account leaks.
    const attendeeEmails = new Set<string>();
    for (const ev of live) {
      for (const a of ev.attendees ?? []) {
        const addr = a.emailAddress?.address?.toLowerCase();
        if (addr && addr !== row.msEmail) attendeeEmails.add(addr);
      }
      const org = ev.organizer?.emailAddress?.address?.toLowerCase();
      if (org && org !== row.msEmail) attendeeEmails.add(org);
    }

    const contactByEmail = new Map<
      string,
      { contactId: string; contactName: string; accountId: string }
    >();
    const accountName = new Map<string, string>();
    if (attendeeEmails.size > 0) {
      const contacts = await db
        .select({
          id: atelierContacts.id,
          fullName: atelierContacts.fullName,
          email: atelierContacts.email,
          accountId: atelierContacts.accountId,
        })
        .from(atelierContacts)
        .where(
          and(
            eq(atelierContacts.orgId, me.orgId),
            isNull(atelierContacts.deletedAt),
          ),
        );
      const wanted = contacts.filter(
        (c) => c.email && attendeeEmails.has(c.email.trim().toLowerCase()),
      );
      const accIds = [...new Set(wanted.map((c) => c.accountId))];
      if (accIds.length > 0) {
        const access = await accessibleEngagementIds(me);
        const visible = new Set<string>();
        for (const id of accIds) {
          if (await canSeeAccount(access, me, id)) visible.add(id);
        }
        if (visible.size > 0) {
          const accounts = await db
            .select({ id: atelierAccounts.id, name: atelierAccounts.name })
            .from(atelierAccounts)
            .where(
              and(
                eq(atelierAccounts.orgId, me.orgId),
                inArray(atelierAccounts.id, [...visible]),
                isNull(atelierAccounts.deletedAt),
              ),
            );
          for (const a of accounts) accountName.set(a.id, a.name);
          for (const c of wanted) {
            if (!accountName.has(c.accountId)) continue;
            contactByEmail.set(c.email!.trim().toLowerCase(), {
              contactId: c.id,
              contactName: c.fullName,
              accountId: c.accountId,
            });
          }
        }
      }
    }

    const meetings: WireMeeting[] = [];
    for (const ev of live) {
      const attendees = (ev.attendees ?? [])
        .map((a) => ({
          email: a.emailAddress?.address?.toLowerCase() ?? "",
          name: a.emailAddress?.name ?? null,
        }))
        .filter((a) => a.email);
      const seen = new Set<string>();
      const matches: WireMeeting["matches"] = [];
      const candidateEmails = [
        ...attendees.map((a) => a.email),
        ev.organizer?.emailAddress?.address?.toLowerCase() ?? "",
      ];
      for (const email of candidateEmails) {
        const m = contactByEmail.get(email);
        if (!m || seen.has(m.contactId)) continue;
        seen.add(m.contactId);
        matches.push({
          ...m,
          accountName: accountName.get(m.accountId) ?? "",
        });
      }
      if (accountIdFilter && !matches.some((m) => m.accountId === accountIdFilter)) {
        continue;
      }
      // The wire contract promises valid ISO datetimes for start/end; a
      // Graph event without them can't be rendered meaningfully, so drop it
      // rather than emit empty strings that break Date parsing downstream.
      if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
      const startIso = `${ev.start.dateTime}${ev.start.dateTime.endsWith("Z") ? "" : "Z"}`;
      const endIso = `${ev.end.dateTime}${ev.end.dateTime.endsWith("Z") ? "" : "Z"}`;
      meetings.push({
        id: ev.id,
        subject: ev.subject ?? "(no subject)",
        start: startIso,
        end: endIso,
        isAllDay: Boolean(ev.isAllDay),
        location: ev.location?.displayName ?? null,
        joinUrl: ev.onlineMeeting?.joinUrl ?? ev.onlineMeetingUrl ?? null,
        webLink: ev.webLink ?? null,
        organizerEmail: ev.organizer?.emailAddress?.address?.toLowerCase() ?? null,
        attendees,
        matches,
      });
    }

    await db
      .update(atelierMsConnections)
      .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(atelierMsConnections.id, row.id));

    res.json({ configured: true, connected: true, meetings });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Task #336 — auto-logged meetings (self-scope: only the caller's own
// entries are visible / removable).
// ------------------------------------------------------------------

// GET /me/calendar/autolog — my auto-logged CRM entries (newest first).
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.get("/me/calendar/autolog", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierMsMeetingLogs)
      .where(
        and(
          eq(atelierMsMeetingLogs.orgId, me.orgId),
          eq(atelierMsMeetingLogs.userId, me.id),
          eq(atelierMsMeetingLogs.status, "logged"),
        ),
      );
    rows.sort((a, b) => b.meetingEnd.getTime() - a.meetingEnd.getTime());
    const accIds = [...new Set(rows.map((r) => r.accountId))];
    const names = new Map<string, string>();
    if (accIds.length > 0) {
      const accounts = await db
        .select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.orgId, me.orgId),
            inArray(atelierAccounts.id, accIds),
          ),
        );
      for (const a of accounts) names.set(a.id, a.name);
    }
    res.json({
      entries: rows.slice(0, 100).map((r) => ({
        id: r.id,
        subject: r.subject,
        accountId: r.accountId,
        accountName: names.get(r.accountId) ?? "",
        meetingStart: r.meetingStart.toISOString(),
        meetingEnd: r.meetingEnd.toISOString(),
        matchedContacts: r.matchedContacts,
        summarySource: r.summarySource,
        loggedAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /me/calendar/autolog/run — check my calendar for ended meetings now.
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.post("/me/calendar/autolog/run", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!msConfigured()) {
      res.status(400).json({ error: "not-configured" });
      return;
    }
    const row = await loadConnection(me);
    if (!row) {
      res.status(400).json({ error: "not-connected" });
      return;
    }
    const out = await runMsMeetingAutolog({ userId: me.id });
    if (out.errors > 0) {
      res.status(502).json({
        error: "graph-unavailable",
        reason:
          "Microsoft 365 could not be reached. Check your connection and try again.",
      });
      return;
    }
    res.json({
      ok: true,
      meetingsExamined: out.meetingsExamined,
      entriesCreated: out.entriesCreated,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /me/calendar/autolog/:logId — remove what was logged for me.
// Soft-deletes the CRM activity and marks the ledger row removed so the
// meeting never gets re-logged.
// @cli-skip: personal Microsoft 365 surface (self-scope, no CLI parity)
router.delete("/me/calendar/autolog/:logId", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [row] = await db
      .select()
      .from(atelierMsMeetingLogs)
      .where(
        and(
          eq(atelierMsMeetingLogs.id, req.params.logId),
          eq(atelierMsMeetingLogs.orgId, me.orgId),
          eq(atelierMsMeetingLogs.userId, me.id),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    if (row.status === "removed") {
      res.json({ ok: true, removed: false });
      return;
    }
    const now = new Date();
    await db
      .update(atelierActivities)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(atelierActivities.id, row.activityId),
          eq(atelierActivities.orgId, me.orgId),
          isNull(atelierActivities.deletedAt),
        ),
      );
    await db
      .update(atelierMsMeetingLogs)
      .set({ status: "removed", removedAt: now, updatedAt: now })
      .where(eq(atelierMsMeetingLogs.id, row.id));
    await audit({
      me,
      action: "ms.meeting.autolog_removed",
      entityId: row.activityId,
      payload: {
        logId: row.id,
        msEventId: row.msEventId,
        accountId: row.accountId,
        subject: row.subject,
      },
      summary: `${me.name} removed auto-logged meeting "${row.subject}"`,
    });
    res.json({ ok: true, removed: true });
  } catch (err) {
    next(err);
  }
});

export default router;
