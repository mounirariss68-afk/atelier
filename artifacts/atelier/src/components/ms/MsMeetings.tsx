// Task #327 — per-user Microsoft 365 connection + calendar surfaces.
//
// Three pieces share this file because they share one data source
// (GET /me/calendar) and one visual language:
//   - ConnectedAccountsCard  → Me lens profile card (connect / disconnect)
//   - MyMeetingsCard         → Home "My meetings" block (viewer's next 7 days)
//   - AccountUpcomingMeetings→ Account page block (viewer's meetings matched
//                              to that account's CRM contacts)
//
// The calendar is always the *viewer's own* — the server matches attendee
// emails against CRM contacts the viewer is allowed to see, so no extra
// client-side permission logic is needed here.
import React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMyMsConnection,
  useAtelierDisconnectMyMsConnection,
  getAtelierGetMyMsConnectionQueryKey,
  useAtelierGetMyCalendar,
  getAtelierGetMyCalendarQueryKey,
  type AtelierCalendarMeeting,
} from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, SectionLabel, PillButton, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Video, MapPin, Unplug, ExternalLink, RefreshCw, Trash2, Sparkles } from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

// Redirect error codes from the OAuth callback → human guidance. The server
// only ever emits these fixed codes (never raw AADSTS strings), but map
// defensively so an unknown code still reads sensibly.
const MS_ERROR_MESSAGES: Record<string, string> = {
  "admin-consent":
    "Your Microsoft 365 administrator needs to grant consent for the Atelier before you can connect. Please ask your admin to approve the Cognirise app in Microsoft Entra.",
  "not-configured":
    "Microsoft 365 sign-in isn't set up for this workspace yet. Ask an administrator to configure it.",
  "state-mismatch":
    "The sign-in attempt expired or didn't match this browser session. Please try connecting again.",
  "no-refresh-token":
    "Microsoft didn't return an offline-access token. Please try again and accept all requested permissions.",
  "oauth-failed": "Microsoft sign-in failed. Please try again.",
};

function msErrorMessage(code: string): string {
  return MS_ERROR_MESSAGES[code] ?? "Microsoft sign-in failed. Please try again.";
}

function fmtLastSynced(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function MeetingRow({ m, showMatches = true }: { m: AtelierCalendarMeeting; showMatches?: boolean }) {
  return (
    <div
      className="flex items-start gap-3 py-3 border-b border-border-soft last:border-b-0"
      data-testid={`meeting-row-${m.id}`}
    >
      <div className="shrink-0 w-24 text-xs font-mono text-text-faint pt-0.5">
        <div>{fmtDay(m.start)}</div>
        <div>{m.isAllDay ? "All day" : fmtTime(m.start)}</div>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-text font-medium truncate">{m.subject || "(no subject)"}</span>
          {m.joinUrl && (
            <a
              href={m.joinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
              data-testid={`meeting-join-${m.id}`}
            >
              <Video className="w-3.5 h-3.5" /> Join
            </a>
          )}
        </div>
        {m.location && !m.joinUrl && (
          <div className="flex items-center gap-1 text-xs text-text-mute">
            <MapPin className="w-3 h-3" /> {m.location}
          </div>
        )}
        {showMatches && m.matches.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {m.matches.map((match) => (
              <Link
                key={`${m.id}-${match.contactId}`}
                href={`/clients/accounts/${match.accountId}`}
                className="no-underline"
              >
                <MonoChip tone="gold" className="cursor-pointer">
                  {match.contactName} · {match.accountName}
                </MonoChip>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function windowIso(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Me lens — connect / disconnect Microsoft 365. */
export function ConnectedAccountsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmingDisconnect, setConfirmingDisconnect] = React.useState(false);
  const { data: conn, isPending } = useAtelierGetMyMsConnection();
  const disconnect = useAtelierDisconnectMyMsConnection({
    mutation: {
      onSuccess: () => {
        setConfirmingDisconnect(false);
        qc.invalidateQueries({ queryKey: getAtelierGetMyMsConnectionQueryKey() });
        toast({ title: "Microsoft 365 disconnected" });
      },
      onError: () =>
        toast({ title: "Could not disconnect", variant: "destructive" }),
    },
  });

  // Surface the OAuth outcome after the callback redirects back here.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ms") === "connected") {
      toast({ title: "Microsoft 365 connected" });
      qc.invalidateQueries({ queryKey: getAtelierGetMyMsConnectionQueryKey() });
    } else if (params.get("ms_error")) {
      toast({
        title: "Microsoft 365 connection failed",
        description: msErrorMessage(params.get("ms_error") ?? ""),
        variant: "destructive",
      });
    }
    if (params.has("ms") || params.has("ms_error")) {
      params.delete("ms");
      params.delete("ms_error");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-4" data-testid="me-connected-accounts-card">
      <SectionLabel>Connected accounts</SectionLabel>
      {isPending ? (
        <Skeleton className="h-16 mt-3 bg-bg-elevate" />
      ) : !conn?.configured ? (
        <p className="text-sm text-text-mute mt-3">
          Microsoft 365 sign-in isn't set up for this workspace yet. Ask an administrator to
          configure the Microsoft connection.
        </p>
      ) : conn.connected ? (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="min-w-0">
            <div className="text-sm text-text font-medium">Microsoft 365</div>
            <div className="text-xs text-text-mute truncate" data-testid="ms-connected-email">
              {conn.msDisplayName ? `${conn.msDisplayName} · ` : ""}
              {conn.msEmail}
            </div>
            <div className="text-xs text-text-faint font-mono mt-0.5" data-testid="ms-last-synced">
              {conn.lastSyncedAt
                ? `Last synced ${fmtLastSynced(conn.lastSyncedAt)}`
                : "Not synced yet"}
            </div>
            {conn.lastError && (
              <div className="text-xs text-red-400 mt-1">
                Connection needs attention: {conn.lastError}
              </div>
            )}
          </div>
          {confirmingDisconnect ? (
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs text-text-mute">Disconnect and delete stored tokens?</span>
              <PillButton
                variant="ghost"
                onClick={() => setConfirmingDisconnect(false)}
                disabled={disconnect.isPending}
                data-testid="button-ms-disconnect-cancel"
              >
                Keep
              </PillButton>
              <PillButton
                className="border-red-500/40 text-red-400"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                data-testid="button-ms-disconnect-confirm"
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </PillButton>
            </div>
          ) : (
            <PillButton
              variant="ghost"
              className="shrink-0"
              onClick={() => setConfirmingDisconnect(true)}
              data-testid="button-ms-disconnect"
            >
              <Unplug className="w-4 h-4 mr-1" /> Disconnect
            </PillButton>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-sm text-text-mute">
            Connect your Microsoft 365 account to see your Outlook calendar inside the Atelier.
          </p>
          <PillButton
            className="shrink-0"
            onClick={() => {
              window.location.href = `${API_BASE}/me/msauth/start`;
            }}
            data-testid="button-ms-connect"
          >
            <ExternalLink className="w-4 h-4 mr-1" /> Connect Microsoft 365
          </PillButton>
        </div>
      )}
    </Card>
  );
}

/** Home — the viewer's next 7 days of meetings, CRM-matched. */
export function MyMeetingsCard() {
  const { data: conn } = useAtelierGetMyMsConnection();
  const win = React.useMemo(() => windowIso(7), []);
  const { data, isPending, error } = useAtelierGetMyCalendar(win, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(win),
      enabled: Boolean(conn?.configured && conn?.connected),
      retry: false,
    },
  });

  // Nothing to show (and nothing to advertise) until MS is configured.
  if (!conn?.configured) return null;

  return (
    <div className="space-y-4" data-testid="home-my-meetings">
      <SectionLabel>
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-gold" /> My meetings
        </span>
      </SectionLabel>
      <Card className="p-5">
        {!conn.connected ? (
          <div className="text-sm text-text-mute">
            <Link href="/me/profile" className="text-gold hover:underline">
              Connect Microsoft 365
            </Link>{" "}
            to see your upcoming meetings here.
          </div>
        ) : isPending ? (
          <Skeleton className="h-24 bg-bg-elevate" />
        ) : error ? (
          <div className="text-sm text-text-mute">
            Couldn't load your calendar right now.{" "}
            <Link href="/me/profile" className="text-gold hover:underline">
              Check your Microsoft connection
            </Link>
            .
          </div>
        ) : (data?.meetings ?? []).length === 0 ? (
          <div className="text-sm text-text-mute font-mono">No meetings in the next 7 days.</div>
        ) : (
          <div>
            {(data?.meetings ?? []).slice(0, 8).map((m) => (
              <MeetingRow key={m.id} m={m} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// Task #336 — auto-logged meetings (Me lens). Bespoke /me/calendar/autolog
// routes are not in the OpenAPI spec, so this card uses raw fetch —
// consistent with other personal, non-codegen surfaces.
// ------------------------------------------------------------------
interface AutologEntry {
  id: string;
  subject: string;
  accountId: string;
  accountName: string;
  meetingStart: string;
  meetingEnd: string;
  matchedContacts: Array<{ contactId: string; contactName: string }>;
  summarySource: string;
  loggedAt: string;
}

async function fetchAutologEntries(): Promise<{ entries: AutologEntry[] }> {
  const r = await fetch(`${API_BASE}/me/calendar/autolog`, { credentials: "include" });
  if (!r.ok) throw new Error(`autolog-list-failed:${r.status}`);
  return r.json();
}

/** Me lens — what the auto-logger has recorded from my calendar. */
export function AutoLoggedMeetingsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: conn } = useAtelierGetMyMsConnection();
  const enabled = Boolean(conn?.configured && conn?.connected);
  const { data, isPending } = useQuery({
    queryKey: ["ms-autolog-entries"],
    queryFn: fetchAutologEntries,
    enabled,
    retry: false,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/me/calendar/autolog/run`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`autolog-run-failed:${r.status}`);
      return r.json() as Promise<{ entriesCreated: number; meetingsExamined: number }>;
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ["ms-autolog-entries"] });
      toast({
        title:
          out.entriesCreated > 0
            ? `Logged ${out.entriesCreated} meeting${out.entriesCreated === 1 ? "" : "s"} to the CRM`
            : "No new client meetings to log",
      });
    },
    onError: () =>
      toast({
        title: "Couldn't check your calendar",
        description: "Microsoft 365 may be unreachable. Try again shortly.",
        variant: "destructive",
      }),
  });

  const remove = useMutation({
    mutationFn: async (logId: string) => {
      const r = await fetch(`${API_BASE}/me/calendar/autolog/${logId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`autolog-remove-failed:${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ms-autolog-entries"] });
      toast({ title: "Removed from the account timeline" });
    },
    onError: () => toast({ title: "Couldn't remove the entry", variant: "destructive" }),
  });

  if (!enabled) return null;
  const entries = data?.entries ?? [];

  return (
    <Card className="p-4" data-testid="me-autologged-meetings-card">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Auto-logged meetings</SectionLabel>
        <PillButton
          variant="ghost"
          className="shrink-0"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          data-testid="button-autolog-run"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${runNow.isPending ? "animate-spin" : ""}`} />
          {runNow.isPending ? "Checking…" : "Check now"}
        </PillButton>
      </div>
      <p className="text-xs text-text-mute mt-1">
        Meetings with known client contacts are logged to the account timeline automatically
        after they end. Remove anything you don't want kept.
      </p>
      {isPending ? (
        <Skeleton className="h-16 mt-3 bg-bg-elevate" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-mute font-mono mt-3" data-testid="autolog-empty">
          Nothing has been auto-logged yet.
        </p>
      ) : (
        <div className="mt-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-3 py-3 border-b border-border-soft last:border-b-0"
              data-testid={`autolog-row-${e.id}`}
            >
              <div className="shrink-0 w-24 text-xs font-mono text-text-faint pt-0.5">
                <div>{fmtDay(e.meetingEnd)}</div>
                <div>{fmtTime(e.meetingEnd)}</div>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-text font-medium truncate">{e.subject}</span>
                  {e.summarySource === "ai" && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-gold"
                      title="Includes an AI summary"
                    >
                      <Sparkles className="w-3 h-3" /> AI note
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link href={`/clients/accounts/${e.accountId}`} className="no-underline">
                    <MonoChip tone="gold" className="cursor-pointer">
                      {e.accountName || "Account"}
                    </MonoChip>
                  </Link>
                  {e.matchedContacts.map((c) => (
                    <span key={c.contactId} className="text-xs text-text-mute">
                      {c.contactName}
                    </span>
                  ))}
                </div>
              </div>
              <PillButton
                variant="ghost"
                className="shrink-0 text-red-400"
                onClick={() => remove.mutate(e.id)}
                disabled={remove.isPending}
                data-testid={`button-autolog-remove-${e.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </PillButton>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Account page — the viewer's meetings matched to this account's contacts. */
export function AccountUpcomingMeetings({ accountId }: { accountId: string }) {
  const { data: conn } = useAtelierGetMyMsConnection();
  const win = React.useMemo(() => windowIso(30), []);
  const params = { ...win, accountId };
  const { data, isPending, error } = useAtelierGetMyCalendar(params, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(params),
      enabled: Boolean(conn?.configured && conn?.connected),
      retry: false,
    },
  });

  // Hidden entirely unless the viewer has a connection — this block is
  // personal ("your meetings with this account"), not account data.
  if (!conn?.configured || !conn.connected) return null;

  return (
    <Card className="p-6 space-y-4" data-testid="account-upcoming-meetings">
      <SectionLabel>
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-gold" /> Your upcoming meetings
        </span>
      </SectionLabel>
      {error ? (
        <p className="text-sm text-text-mute" data-testid="account-meetings-error">
          Couldn't load your calendar right now.{" "}
          <Link href="/me/profile" className="text-gold hover:underline">
            Check your Microsoft connection
          </Link>
          .
        </p>
      ) : isPending ? (
        <Skeleton className="h-16 bg-bg-elevate" />
      ) : (data?.meetings ?? []).length === 0 ? (
        <p className="text-sm text-text-mute font-mono">
          No meetings with this account's contacts in the next 30 days.
        </p>
      ) : (
        <div>
          {(data?.meetings ?? []).slice(0, 6).map((m) => (
            <MeetingRow key={m.id} m={m} showMatches={false} />
          ))}
        </div>
      )}
    </Card>
  );
}
