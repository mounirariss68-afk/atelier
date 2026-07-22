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
import React, { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMyMsConnection,
  useAtelierDisconnectMyMsConnection,
  getAtelierGetMyMsConnectionQueryKey,
  useAtelierGetMyCalendar,
  getAtelierGetMyCalendarQueryKey,
  useAtelierGetAccountMeetingBrief,
  getAtelierGetAccountMeetingBriefQueryKey,
  type AtelierCalendarMeeting,
} from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, SectionLabel, PillButton, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarClock,
  Video,
  MapPin,
  Unplug,
  ExternalLink,
  RefreshCw,
  Trash2,
  Sparkles,
  FileText,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  List,
  Clock,
} from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

// Task #592 — per-browser preference for the Home meetings list/day toggle.
const MEETINGS_VIEW_STORAGE_KEY = "atelier-meetings-view";

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

// Stored-connection lastError codes → plain-language explanations. The raw
// code stays visible as secondary detail; these are the primary messages.
const MS_CONNECTION_ERROR_MESSAGES: Record<string, string> = {
  "admin-consent-required":
    "Your Microsoft 365 administrator needs to approve the app again. Reconnecting after approval fixes this.",
  "refresh-failed":
    "Your Microsoft sign-in expired or was revoked. Reconnecting fixes this — nothing else changes.",
  "graph-unavailable":
    "We couldn't reach Microsoft 365 last time we tried. If this keeps happening, reconnecting usually fixes it.",
};

function msConnectionErrorMessage(code: string): string {
  return (
    MS_CONNECTION_ERROR_MESSAGES[code] ??
    "Your Microsoft 365 connection isn't working right now. Reconnecting usually fixes this."
  );
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

function fmtDue(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const STAGE_LABELS: Record<string, string> = {
  suspect: "Suspect",
  prospect: "Prospect",
  convert: "Convert",
  runner: "Runner",
  contract: "Contract",
  lost: "Lost",
  no_decision: "No decision",
  withdrawn: "Withdrawn",
};

/**
 * Pre-meeting client briefing (Task #337) — deterministic snapshot of the
 * matched account: recent activity, open opportunities, outstanding
 * tasks/actions. Fetched lazily when the panel is opened.
 */
function MeetingBriefPanel({ meetingId, accountId }: { meetingId: string; accountId: string }) {
  const { data, isPending, error } = useAtelierGetAccountMeetingBrief(accountId, {
    query: {
      queryKey: getAtelierGetAccountMeetingBriefQueryKey(accountId),
      retry: false,
      staleTime: 60_000,
    },
  });

  if (isPending) {
    return <Skeleton className="h-16 mt-2 bg-bg-elevate" data-testid={`meeting-brief-loading-${meetingId}`} />;
  }
  if (error || !data) {
    return (
      <p className="text-xs text-text-mute mt-2" data-testid={`meeting-brief-error-${meetingId}`}>
        Couldn't load the briefing for this account right now.
      </p>
    );
  }

  const tasks = [
    ...data.openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      due: t.dueDate,
      overdue: t.overdue,
      who: t.ownerName ?? null,
      kind: "task" as const,
    })),
    ...data.openActions.map((a) => ({
      id: a.id,
      title: a.title,
      due: a.dueDate,
      overdue: a.overdue,
      who: a.ownerName ?? null,
      kind: "action" as const,
    })),
  ].slice(0, 6);

  return (
    <div
      className="mt-2 rounded-lg border border-border-soft bg-bg-soft p-3 space-y-3"
      data-testid={`meeting-brief-panel-${meetingId}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
          Pre-meeting brief · {data.accountName}
        </span>
        <Link
          href={`/clients/accounts/${data.accountId}`}
          className="text-xs text-gold hover:underline shrink-0"
          data-testid={`meeting-brief-open-account-${meetingId}`}
        >
          Open account
        </Link>
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
          Recent activity
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="text-xs text-text-mute font-mono">No recent activity on this account.</p>
        ) : (
          <ul className="space-y-1">
            {data.recentActivity.slice(0, 4).map((e) => (
              <li key={e.id} className="text-xs text-text-mute flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-text-faint shrink-0">
                  {new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span className="truncate">
                  {e.title}
                  {e.actorName ? ` — ${e.actorName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
          Open opportunities
        </div>
        {data.openOpportunities.length === 0 ? (
          <p className="text-xs text-text-mute font-mono">No open opportunities.</p>
        ) : (
          <ul className="space-y-1">
            {data.openOpportunities.slice(0, 4).map((o) => (
              <li key={o.id} className="text-xs text-text-mute flex items-baseline gap-2 min-w-0">
                <span className="truncate text-text">{o.name}</span>
                <MonoChip className="shrink-0">{STAGE_LABELS[o.salesStage] ?? o.salesStage}</MonoChip>
                <span className="font-mono text-text-faint shrink-0">
                  {fmtMoney(o.dealSizeHypothesis)} · {Math.round(o.probabilityPct)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
          Outstanding tasks
        </div>
        {tasks.length === 0 ? (
          <p className="text-xs text-text-mute font-mono">Nothing outstanding.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={`${t.kind}-${t.id}`} className="text-xs text-text-mute flex items-baseline gap-2 min-w-0">
                <span className="truncate">{t.title}</span>
                {t.who && <span className="text-text-faint shrink-0">{t.who}</span>}
                {t.due && (
                  <span
                    className={`font-mono shrink-0 ${t.overdue ? "text-danger" : "text-text-faint"}`}
                  >
                    {t.overdue ? "overdue · " : "due "}
                    {fmtDue(t.due)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Join links open in a new tab. window.open returns null when a popup
 * blocker (or an invalid URL) prevents the tab from opening — surface
 * that as a visible toast instead of failing silently (Task #555).
 */
function useJoinMeeting() {
  const { toast } = useToast();
  return React.useCallback(
    (url: string) => {
      let opened: Window | null = null;
      try {
        opened = window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        opened = null;
      }
      if (!opened) {
        toast({
          title: "Couldn't open the meeting link",
          description:
            "Your browser may have blocked the pop-up. Allow pop-ups for this site or copy the link from your calendar.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );
}

function JoinLink({ m }: { m: AtelierCalendarMeeting }) {
  const join = useJoinMeeting();
  if (!m.joinUrl) return null;
  return (
    <button
      type="button"
      onClick={() => join(m.joinUrl!)}
      className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
      data-testid={`meeting-join-${m.id}`}
    >
      <Video className="w-3.5 h-3.5" /> Join
    </button>
  );
}

// ------------------------------------------------------------------
// Task #559 — reschedule / cancel Atelier-booked internal meetings.
// Bespoke /me/calendar/internal/:id routes are not in the OpenAPI spec,
// so this uses raw fetch (same convention as the autolog card). The
// server PATCHes/DELETEs the organizer's real Outlook event first, so
// attendees get standard Outlook update/cancellation notices.
// ------------------------------------------------------------------

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function InternalMeetingManage({ m }: { m: AtelierCalendarMeeting }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"idle" | "reschedule" | "cancel">("idle");
  const [startLocal, setStartLocal] = React.useState(() => toLocalInputValue(m.start));
  const durationMs = React.useMemo(
    () => Math.max(15 * 60 * 1000, new Date(m.end).getTime() - new Date(m.start).getTime()),
    [m.start, m.end],
  );

  const invalidateCalendar = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" && String(q.queryKey[0]).includes("/me/calendar"),
    });

  const reschedule = useMutation({
    mutationFn: async () => {
      const start = new Date(startLocal);
      if (Number.isNaN(start.getTime())) throw new Error("invalid-date");
      const end = new Date(start.getTime() + durationMs);
      const r = await fetch(`${API_BASE}/me/calendar/internal/${m.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: start.toISOString(), end: end.toISOString() }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `reschedule-failed:${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      setMode("idle");
      invalidateCalendar();
      toast({ title: "Meeting rescheduled", description: "Attendees get an Outlook meeting update." });
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't reschedule the meeting",
        description: err.message === "invalid-date" ? "Pick a valid date and time." : err.message,
        variant: "destructive",
      }),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/me/calendar/internal/${m.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `cancel-failed:${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      invalidateCalendar();
      toast({ title: "Meeting cancelled", description: "Attendees get an Outlook cancellation notice." });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't cancel the meeting", description: err.message, variant: "destructive" }),
  });

  if (mode === "reschedule") {
    return (
      <div className="flex items-center gap-2 flex-wrap" data-testid={`meeting-reschedule-form-${m.id}`}>
        <input
          type="datetime-local"
          value={startLocal}
          onChange={(e) => setStartLocal(e.target.value)}
          className="text-xs bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text"
          data-testid={`meeting-reschedule-input-${m.id}`}
        />
        <PillButton
          className="shrink-0"
          onClick={() => reschedule.mutate()}
          disabled={reschedule.isPending}
          data-testid={`meeting-reschedule-save-${m.id}`}
        >
          {reschedule.isPending ? "Moving…" : "Move"}
        </PillButton>
        <PillButton
          variant="ghost"
          className="shrink-0"
          onClick={() => setMode("idle")}
          disabled={reschedule.isPending}
          data-testid={`meeting-reschedule-abort-${m.id}`}
        >
          Back
        </PillButton>
      </div>
    );
  }
  if (mode === "cancel") {
    return (
      <div className="flex items-center gap-2 flex-wrap" data-testid={`meeting-cancel-confirm-${m.id}`}>
        <span className="text-xs text-text-mute">Cancel this meeting? Attendees will be notified.</span>
        <PillButton
          variant="ghost"
          className="shrink-0"
          onClick={() => setMode("idle")}
          disabled={cancel.isPending}
          data-testid={`meeting-cancel-abort-${m.id}`}
        >
          Keep
        </PillButton>
        <PillButton
          className="shrink-0 border-red-500/40 text-red-400"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          data-testid={`meeting-cancel-confirm-button-${m.id}`}
        >
          {cancel.isPending ? "Cancelling…" : "Cancel meeting"}
        </PillButton>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setMode("reschedule")}
        className="text-xs text-gold hover:underline"
        data-testid={`meeting-reschedule-${m.id}`}
      >
        Reschedule
      </button>
      <button
        type="button"
        onClick={() => setMode("cancel")}
        className="text-xs text-red-400 hover:underline"
        data-testid={`meeting-cancel-${m.id}`}
      >
        Cancel
      </button>
    </div>
  );
}

function MeetingRow({ m, showMatches = true }: { m: AtelierCalendarMeeting; showMatches?: boolean }) {
  // One brief per matched account. Meetings usually match a single account;
  // when several are matched, the viewer picks which account to brief on.
  const uniqueAccounts = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const match of m.matches) {
      if (!seen.has(match.accountId)) seen.set(match.accountId, match.accountName);
    }
    return [...seen.entries()].map(([accountId, accountName]) => ({ accountId, accountName }));
  }, [m.matches]);
  const [briefAccountId, setBriefAccountId] = React.useState<string | null>(null);

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
          {m.internal && <MonoChip tone="gold">Internal</MonoChip>}
          {meetingKind(m) === "ooo" && <MonoChip tone="amber">Out of office</MonoChip>}
          {meetingKind(m) === "holiday" && <MonoChip>Holiday</MonoChip>}
          <JoinLink m={m} />
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
        {uniqueAccounts.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {uniqueAccounts.map((acc) => {
              const open = briefAccountId === acc.accountId;
              return (
                <button
                  key={`${m.id}-brief-${acc.accountId}`}
                  type="button"
                  onClick={() => setBriefAccountId(open ? null : acc.accountId)}
                  className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
                  data-testid={`meeting-brief-toggle-${m.id}-${acc.accountId}`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {uniqueAccounts.length > 1 ? `Briefing · ${acc.accountName}` : "Briefing"}
                  {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        )}
        {m.internal && m.canManage && <InternalMeetingManage m={m} />}
        {briefAccountId && <MeetingBriefPanel meetingId={m.id} accountId={briefAccountId} />}
      </div>
    </div>
  );
}

function windowIso(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ------------------------------------------------------------------
// Task #602 — "Away today" strip + public-holiday banners. The bespoke
// /roster/on-leave-today and /me/holidays routes are not in the OpenAPI
// spec, so these use raw fetch (same convention as the autolog card).
// The server also tags calendar rows with kind: "ooo" | "holiday".
// ------------------------------------------------------------------

type MeetingKind = "ooo" | "holiday" | undefined;
function meetingKind(m: AtelierCalendarMeeting): MeetingKind {
  const k = (m as { kind?: string }).kind;
  return k === "ooo" || k === "holiday" ? k : undefined;
}

interface AwayPerson {
  personId: string;
  personName: string;
  initials: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  returnDate: string;
}

interface HolidayItem {
  date: string;
  endDate: string;
  name: string;
  country: string;
  tentative: boolean;
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  unpaid: "Unpaid leave",
  parental: "Parental leave",
  compassionate: "Compassionate leave",
  other: "Leave",
};

function fmtDateShort(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Slim horizontally-scrollable strip of partners on approved leave for
 * the given date (default today). Avatar-initials chips; clicking one
 * shows the leave span and return date. The endpoint 403s for
 * non-partner viewers — treat any error as "hide". */
export function AwayTodayStrip({ date }: { date?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["roster-on-leave-today", date ?? "today"],
    queryFn: async (): Promise<{ date: string; away: AwayPerson[] } | null> => {
      const qs = date ? `?date=${date}` : "";
      const r = await fetch(`${API_BASE}/roster/on-leave-today${qs}`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
  const away = data?.away ?? [];
  if (away.length === 0) return null;
  const openPerson = away.find((a) => `${a.personId}-${a.startDate}` === openId) ?? null;
  return (
    <div
      className="rounded-lg border border-border-soft bg-bg-soft px-3 py-2"
      data-testid="away-today-strip"
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1.5">
        Away {date ? `on ${fmtDateShort(date)}` : "today"}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin]">
        {away.map((a) => {
          const key = `${a.personId}-${a.startDate}`;
          const open = openId === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setOpenId(open ? null : key)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs transition-colors ${
                open
                  ? "border-gold/60 bg-gold/10 text-text"
                  : "border-border-soft bg-bg-elevate text-text-mute hover:text-text"
              }`}
              data-testid={`away-chip-${a.personId}`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/20 text-[10px] font-semibold text-gold">
                {a.initials || a.personName.slice(0, 2).toUpperCase()}
              </span>
              <span className="whitespace-nowrap">{a.personName}</span>
            </button>
          );
        })}
      </div>
      {openPerson && (
        <div
          className="mt-2 rounded-md border border-border-soft bg-bg-elevate px-3 py-2 text-xs text-text-mute"
          data-testid="away-chip-detail"
        >
          <span className="text-text font-medium">{openPerson.personName}</span>{" "}
          — on leave {fmtDateShort(openPerson.startDate)} → {fmtDateShort(openPerson.endDate)},
          back {fmtDateShort(openPerson.returnDate)}
        </div>
      )}
    </div>
  );
}

/** Public-holiday banner for a date window (curated TR/MENA dataset).
 * The viewer's own market is highlighted in gold. */
export function HolidayBanner({ startDate, endDate }: { startDate: string; endDate: string }) {
  const { data } = useQuery({
    queryKey: ["me-holidays", startDate, endDate],
    queryFn: async (): Promise<{ viewerCountry: string | null; holidays: HolidayItem[] } | null> => {
      const r = await fetch(
        `${API_BASE}/me/holidays?start=${startDate}&end=${endDate}`,
        { credentials: "include" },
      );
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
    staleTime: 60 * 60_000,
  });
  const holidays = data?.holidays ?? [];
  const [expanded, setExpanded] = useState(false);
  if (holidays.length === 0) return null;
  const viewer = data?.viewerCountry ?? null;
  // The viewer's own market is shown up-front; the other 8 markets
  // collapse into a single expandable row to avoid clutter.
  const mine = viewer ? holidays.filter((h) => h.country === viewer) : holidays;
  const others = viewer ? holidays.filter((h) => h.country !== viewer) : [];
  const chip = (h: HolidayItem, highlight: boolean) => (
    <MonoChip
      key={`${h.country}-${h.date}-${h.name}`}
      tone={highlight ? "gold" : "default"}
      title={h.tentative ? "Date subject to moon sighting" : undefined}
      data-testid={`holiday-chip-${h.country}-${h.date}`}
    >
      {h.country} · {h.name}
      {h.endDate !== h.date
        ? ` (${fmtDateShort(h.date)}–${fmtDateShort(h.endDate)})`
        : ` (${fmtDateShort(h.date)})`}
      {h.tentative ? " *" : ""}
    </MonoChip>
  );
  return (
    <div
      className="rounded-lg border border-border-soft bg-bg-soft px-3 py-2"
      data-testid="holiday-banner"
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
        Public holidays
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {mine.map((h) => chip(h, Boolean(viewer)))}
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-bg-elevate px-2 py-0.5 text-[11px] font-mono text-text-mute hover:text-text transition-colors"
            data-testid="holiday-others-toggle"
          >
            {expanded ? "Hide" : `+${others.length} in other markets`}
          </button>
        )}
      </div>
      {expanded && others.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap" data-testid="holiday-others-row">
          {others.map((h) => chip(h, false))}
        </div>
      )}
    </div>
  );
}

function isoDateOnly(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ------------------------------------------------------------------
// Task #555 — day calendar view for the web Home meetings card, matching
// the mobile Meetings tab: full-day timeline with positioned meeting
// blocks plus a date navigator.
// ------------------------------------------------------------------

const HOUR_H = 56;

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayWindowIso(date: Date) {
  const start = startOfDay(date);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

interface TimedBlock {
  m: AtelierCalendarMeeting;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Position timed meetings for one day: clamp to day bounds, then greedy
 * column assignment inside each overlapping cluster. (Mirror of the
 * mobile layout algorithm.) */
function layoutDayBlocks(
  meetings: AtelierCalendarMeeting[],
  dayStart: Date,
): TimedBlock[] {
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 3600 * 1000;
  const items = meetings
    .map((m) => {
      const s = Math.max(new Date(m.start).getTime(), dayStartMs);
      const e = Math.min(new Date(m.end).getTime(), dayEndMs);
      const startMin = (s - dayStartMs) / 60000;
      const endMin = Math.max((e - dayStartMs) / 60000, startMin + 30);
      return { m, startMin, endMin, col: 0, cols: 1 };
    })
    .filter((x) => x.endMin > 0 && x.startMin < 24 * 60)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  let i = 0;
  while (i < items.length) {
    let clusterEnd = items[i].endMin;
    let j = i + 1;
    while (j < items.length && items[j].startMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[j].endMin);
      j += 1;
    }
    const cluster = items.slice(i, j);
    const colEnds: number[] = [];
    for (const ev of cluster) {
      let col = colEnds.findIndex((end) => end <= ev.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(ev.endMin);
      } else {
        colEnds[col] = ev.endMin;
      }
      ev.col = col;
    }
    for (const ev of cluster) ev.cols = colEnds.length;
    i = j;
  }

  return items.map((ev) => ({
    m: ev.m,
    top: (ev.startMin / 60) * HOUR_H,
    height: Math.max(((ev.endMin - ev.startMin) / 60) * HOUR_H, 26),
    col: ev.col,
    cols: ev.cols,
  }));
}

function DayNavigator({ date, onChange }: { date: Date; onChange: (d: Date) => void }) {
  const isToday = sameDay(date, new Date());
  const shift = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    onChange(startOfDay(d));
  };
  return (
    <div className="flex items-center gap-2" data-testid="meetings-day-navigator">
      <PillButton
        variant="ghost"
        className="shrink-0 px-2"
        onClick={() => shift(-1)}
        aria-label="Previous day"
        data-testid="button-meetings-prev-day"
      >
        <ChevronLeft className="w-4 h-4" />
      </PillButton>
      <div className="flex-1 text-center min-w-0">
        <div className="text-sm text-text font-medium" data-testid="meetings-day-label">
          {isToday
            ? "Today"
            : date.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
        </div>
        {!isToday && (
          <button
            type="button"
            className="text-xs text-gold hover:underline"
            onClick={() => onChange(startOfDay(new Date()))}
            data-testid="button-meetings-today"
          >
            Today
          </button>
        )}
      </div>
      <PillButton
        variant="ghost"
        className="shrink-0 px-2"
        onClick={() => shift(1)}
        aria-label="Next day"
        data-testid="button-meetings-next-day"
      >
        <ChevronRight className="w-4 h-4" />
      </PillButton>
    </div>
  );
}

function DayTimeline({
  meetings,
  date,
  selectedId,
  onSelect,
}: {
  meetings: AtelierCalendarMeeting[];
  date: Date;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const isToday = sameDay(date, new Date());
  const blocks = React.useMemo(
    () => layoutDayBlocks(meetings, startOfDay(date)),
    [meetings, date],
  );
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Scroll near the first meeting (or 8am on an empty day) so the viewer
  // isn't staring at midnight.
  React.useEffect(() => {
    let hour = 8;
    if (blocks.length > 0) {
      const first = Math.min(...blocks.map((b) => b.top / HOUR_H));
      hour = Math.max(0, Math.floor(first) - 1);
    }
    scrollRef.current?.scrollTo({ top: hour * HOUR_H });
  }, [date, blocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date();
  const nowTop = isToday ? ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H : null;

  const hourLabel = (h: number) => {
    const d = new Date(date);
    d.setHours(h, 0, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      ref={scrollRef}
      className="relative overflow-y-auto max-h-[480px] rounded-lg border border-border-soft"
      data-testid="meetings-day-timeline"
    >
      <div className="relative" style={{ height: 24 * HOUR_H }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            className="absolute left-0 right-0 flex items-start"
            style={{ top: h * HOUR_H }}
          >
            <span className="w-14 shrink-0 -translate-y-1.5 pr-2 text-right text-[10px] font-mono text-text-faint select-none">
              {hourLabel(h)}
            </span>
            <div className="flex-1 border-t border-border-soft" />
          </div>
        ))}

        {nowTop !== null && (
          <div
            className="absolute left-14 right-1 z-10 pointer-events-none"
            style={{ top: nowTop }}
            data-testid="meetings-now-line"
          >
            <div className="border-t-2 border-gold/70" />
          </div>
        )}

        {/* Lane area: blocks use % geometry relative to this container. */}
        <div className="absolute inset-y-0 left-14 right-1">
          {blocks.map(({ m, top, height, col, cols }) => {
            const selected = selectedId === m.id;
            const matched = m.matches.length > 0;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(selected ? null : m.id)}
                className="absolute text-left"
                style={{
                  top,
                  height,
                  left: `${(col / cols) * 100}%`,
                  width: `${100 / cols}%`,
                  paddingRight: col === cols - 1 ? 0 : 3,
                }}
                data-testid={`meeting-block-${m.id}`}
              >
                <div
                  className={`h-full overflow-hidden rounded-lg border px-2 py-1 ${
                    selected ? "border-gold" : "border-border-soft"
                  } ${matched ? "bg-gold/15" : "bg-bg-soft"} hover:border-gold/60 transition-colors`}
                >
                  <div className="text-xs text-text font-medium truncate">
                    {m.subject || "(no subject)"}
                  </div>
                  {height > 40 && (
                    <div className="text-[10px] font-mono text-text-faint truncate">
                      {fmtTime(m.start)} – {fmtTime(m.end)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Day view for the Home meetings card: navigator + all-day strip +
 * selected-meeting detail + positioned timeline. */
export function MeetingsDayView() {
  const [selectedDate, setSelectedDate] = React.useState(() => startOfDay(new Date()));
  const [selectedMeetingId, setSelectedMeetingId] = React.useState<string | null>(null);
  const dayWin = React.useMemo(() => dayWindowIso(selectedDate), [selectedDate]);
  const { data, isPending, error } = useAtelierGetMyCalendar(dayWin, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(dayWin),
      retry: false,
    },
  });

  const meetings = data?.meetings ?? [];
  const allDayMeetings = meetings.filter((m) => m.isAllDay);
  const timedMeetings = meetings.filter((m) => !m.isAllDay);
  const selectedMeeting = meetings.find((m) => m.id === selectedMeetingId) ?? null;

  return (
    <div className="space-y-3" data-testid="meetings-day-view">
      <DayNavigator
        date={selectedDate}
        onChange={(d) => {
          setSelectedDate(d);
          setSelectedMeetingId(null);
        }}
      />
      <AwayTodayStrip date={isoDateOnly(selectedDate)} />
      <HolidayBanner
        startDate={isoDateOnly(selectedDate)}
        endDate={isoDateOnly(selectedDate)}
      />
      {isPending ? (
        <Skeleton className="h-40 bg-bg-elevate" />
      ) : error ? (
        <div className="text-sm text-text-mute" data-testid="meetings-day-error">
          Couldn't load your calendar right now.{" "}
          <Link href="/me/profile" className="text-gold hover:underline">
            Check your Microsoft connection
          </Link>
          .
        </div>
      ) : (
        <>
          {allDayMeetings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
                All day
              </div>
              <div className="flex flex-col gap-1.5">
                {allDayMeetings.map((m) => {
                  const selected = selectedMeetingId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMeetingId(selected ? null : m.id)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm text-text ${
                        selected ? "border-gold" : "border-border-soft"
                      } ${
                        meetingKind(m) === "ooo"
                          ? "bg-amber-500/10"
                          : m.matches.length > 0
                            ? "bg-gold/15"
                            : "bg-bg-soft"
                      }`}
                      data-testid={`meeting-allday-${m.id}`}
                    >
                      <span className="truncate block">
                        {m.subject || "(no subject)"}
                        {meetingKind(m) === "ooo" && (
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-amber-400">
                            Out of office
                          </span>
                        )}
                        {meetingKind(m) === "holiday" && (
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-text-faint">
                            Holiday
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {selectedMeeting && (
            <div
              className="rounded-lg border border-border-soft bg-bg-soft px-3"
              data-testid="meetings-day-detail"
            >
              <MeetingRow m={selectedMeeting} />
            </div>
          )}
          {meetings.length === 0 && (
            <div className="text-sm text-text-mute font-mono" data-testid="meetings-day-empty">
              No meetings on this day.
            </div>
          )}
          <DayTimeline
            meetings={timedMeetings}
            date={selectedDate}
            selectedId={selectedMeetingId}
            onSelect={setSelectedMeetingId}
          />
        </>
      )}
    </div>
  );
}

/** Me lens — connect / disconnect Microsoft 365. */
export function ConnectedAccountsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmingDisconnect, setConfirmingDisconnect] = React.useState(false);
  const [reconnecting, setReconnecting] = React.useState(false);
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
  // One-click reconnect: clear the stale sign-in link, then immediately
  // restart the Microsoft sign-in flow (disconnect + connect in one step).
  const reconnect = useAtelierDisconnectMyMsConnection({
    mutation: {
      onSuccess: () => {
        window.location.href = `${API_BASE}/me/msauth/start`;
      },
      onError: () => {
        setReconnecting(false);
        toast({
          title: "Could not reconnect",
          description: "Please try again, or disconnect and connect manually.",
          variant: "destructive",
        });
      },
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
              <div className="mt-1" data-testid="ms-connection-error">
                <div className="text-xs text-red-400">
                  Connection needs attention: {msConnectionErrorMessage(conn.lastError)}
                </div>
                <div className="text-[10px] font-mono text-text-faint mt-0.5">
                  {conn.lastError}
                </div>
              </div>
            )}
            {/* Task #602 — connections made before the mailbox-settings
             * permission was added can't set Outlook auto-replies on
             * approved leave; a one-click reconnect grants it. */}
            {!conn.lastError &&
              (conn as { mailboxSettingsGranted?: boolean }).mailboxSettingsGranted === false && (
                <div className="mt-1" data-testid="ms-mailbox-scope-prompt">
                  <div className="text-xs text-amber-400">
                    Reconnect to enable automatic out-of-office replies when your leave is
                    approved — your connection predates this permission.
                  </div>
                </div>
              )}
          </div>
          {confirmingDisconnect ? (
            <div className="shrink-0 flex items-center gap-2 sm:max-w-sm">
              <span className="text-xs text-text-mute">
                This only removes this account's sign-in link to Microsoft 365. Your Microsoft
                app settings and admin consent are not affected — you can reconnect anytime.
              </span>
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
            <div className="shrink-0 flex flex-col items-stretch sm:items-end gap-2">
              {(conn.lastError ||
                (conn as { mailboxSettingsGranted?: boolean }).mailboxSettingsGranted ===
                  false) && (
                <>
                  <PillButton
                    className="shrink-0"
                    onClick={() => {
                      setReconnecting(true);
                      reconnect.mutate();
                    }}
                    disabled={reconnecting || reconnect.isPending}
                    data-testid="button-ms-reconnect"
                  >
                    <ExternalLink className="w-4 h-4 mr-1" />
                    {reconnecting || reconnect.isPending ? "Reconnecting…" : "Reconnect"}
                  </PillButton>
                  <span className="text-[10px] text-text-faint sm:text-right max-w-[220px]">
                    Reconnecting signs you in to Microsoft again — nothing else changes.
                  </span>
                </>
              )}
              <PillButton
                variant="ghost"
                className="shrink-0"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={reconnecting || reconnect.isPending}
                data-testid="button-ms-disconnect"
              >
                <Unplug className="w-4 h-4 mr-1" /> Disconnect
              </PillButton>
            </div>
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

/** Home — the viewer's next 7 days of meetings, CRM-matched, with a
 * list/day-timeline toggle matching the mobile Meetings tab. */
export function MyMeetingsCard() {
  const { data: conn } = useAtelierGetMyMsConnection();
  // Task #592 — remember the list/day choice per browser (like the theme
  // and rail-width preferences); invalid or missing values fall back to list.
  const [view, setView] = React.useState<"list" | "day">(() => {
    try {
      const raw = window.localStorage.getItem(MEETINGS_VIEW_STORAGE_KEY);
      return raw === "day" ? "day" : "list";
    } catch {
      return "list";
    }
  });
  const setViewPersisted = React.useCallback((v: "list" | "day") => {
    setView(v);
    try {
      window.localStorage.setItem(MEETINGS_VIEW_STORAGE_KEY, v);
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, []);
  const win = React.useMemo(() => windowIso(7), []);
  // Task #553 — fetch even when not connected: the server still returns
  // Atelier-booked internal meetings the viewer created or attends.
  // Task #555 — the day view runs its own per-day query, so the 7-day
  // list query only runs while the list view is active.
  const { data, isPending, error } = useAtelierGetMyCalendar(win, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(win),
      enabled: Boolean(conn) && view === "list",
      retry: false,
    },
  });

  if (!conn) return null;

  return (
    <div className="space-y-4" data-testid="home-my-meetings">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-gold" /> My meetings
          </span>
        </SectionLabel>
        <div
          className="flex items-center gap-0.5 rounded-full border border-border-soft bg-bg-soft p-0.5"
          data-testid="meetings-view-toggle"
        >
            {(["list", "day"] as const).map((v) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewPersisted(v)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors ${
                    active ? "bg-bg-elevate text-text" : "text-text-mute hover:text-text"
                  }`}
                  data-testid={`button-meetings-view-${v}`}
                >
                  {v === "list" ? <List className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {v === "list" ? "List" : "Day"}
                </button>
              );
            })}
        </div>
      </div>
      {view === "list" && (
        <>
          <AwayTodayStrip />
          <HolidayBanner
            startDate={isoDateOnly(new Date())}
            endDate={isoDateOnly(new Date(Date.now() + 7 * 24 * 3600 * 1000))}
          />
        </>
      )}
      <Card className="p-5">
        {conn.configured && !conn.connected && (
          <div className="text-sm text-text-mute mb-3">
            <Link href="/me/profile" className="text-gold hover:underline">
              Connect Microsoft 365
            </Link>{" "}
            to see your full Outlook calendar here.
          </div>
        )}
        {view === "day" ? (
          <MeetingsDayView />
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
