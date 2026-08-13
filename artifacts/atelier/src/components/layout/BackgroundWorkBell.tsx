/**
 * Task #1020 — global background-work indicator + notifications bell.
 *
 * Lives in the shell title bar (replaces the previously inert bell icon).
 * Shows, for the signed-in user only:
 *   - background jobs they started (POV drafts, receipt reads, pricing
 *     research, partner evaluations, merchant enrichment…) — running with
 *     a spinner, recently finished with a result link,
 *   - unread self-notification cards (same cards as the Me home), with
 *     dismiss + deep links.
 *
 * Polls GET /me/background-jobs (raw fetch — bespoke poll route, not in
 * the OpenAPI spec) every ~5s while something is running, lazily (~30s)
 * otherwise. When a job flips running → done/failed it fires a toast and
 * invalidates queries so open pages refresh with the new data.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierListMyNotifications,
  useAtelierDismissMyNotification,
  getAtelierListMyNotificationsQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface BackgroundJobWire {
  id: string;
  kind: string;
  label: string;
  status: "running" | "done" | "failed";
  error: string | null;
  resultHref: string | null;
  startedAt: string;
  finishedAt: string | null;
}

async function fetchJobs(): Promise<{ jobs: BackgroundJobWire[] }> {
  const res = await fetch("/api/atelier/me/background-jobs", { credentials: "include" });
  if (!res.ok) throw new Error("background-jobs");
  return res.json();
}

export function BackgroundWorkBell() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  // Terminal jobs the user has cleared locally (kept server-side ~6h).
  const [cleared, setCleared] = React.useState<Set<string>>(new Set);

  const { data } = useQuery({
    queryKey: ["atelier-background-jobs"],
    queryFn: fetchJobs,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((j) => j.status === "running") ? 5000 : 30000,
  });
  const jobs = React.useMemo(
    () => (data?.jobs ?? []).filter((j) => !cleared.has(j.id)),
    [data, cleared],
  );
  const running = jobs.filter((j) => j.status === "running");
  const finished = jobs.filter((j) => j.status !== "running");

  const { data: notifications } = useAtelierListMyNotifications({
    query: {
      queryKey: getAtelierListMyNotificationsQueryKey(),
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    },
  });
  const dismiss = useAtelierDismissMyNotification({
    mutation: {
      onSettled: () => qc.invalidateQueries({ queryKey: getAtelierListMyNotificationsQueryKey() }),
    },
  });
  const unread = notifications ?? [];

  // running → terminal transition detection: toast + refresh open pages.
  const prevStatuses = React.useRef<Map<string, string>>(new Map());
  React.useEffect(() => {
    if (!data) return;
    const prev = prevStatuses.current;
    for (const j of data.jobs) {
      const was = prev.get(j.id);
      if (was === "running" && j.status !== "running") {
        toast({
          title: j.status === "done" ? `Finished: ${j.label}` : `Failed: ${j.label}`,
          description:
            j.status === "done"
              ? j.resultHref
                ? "It's ready — open it from the bell at the top right."
                : "It's ready."
              : j.error ?? "Something went wrong — please try again.",
          variant: j.status === "failed" ? "destructive" : undefined,
        });
        // Whatever page is open, its data may have just changed.
        void qc.invalidateQueries();
      }
    }
    prevStatuses.current = new Map(data.jobs.map((j) => [j.id, j.status]));
  }, [data, toast, qc]);

  const badgeCount = running.length + unread.length;
  // Task #1048 — human breakdown of the count, used for the tooltip /
  // aria-label and the popover header ("2 running · 13 unread").
  const countBreakdown = [
    running.length > 0 ? `${running.length} running` : null,
    unread.length > 0 ? `${unread.length} unread` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Cap the rendered digits so the reserved badge slot has a bounded width.
  const badgeText = badgeCount > 99 ? "99+" : String(badgeCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Task #1048 — the badge used to hang off the bell's top-right
            corner with negative absolute offsets, so 2–3 digit counts
            spilled onto the neighbouring header controls. It now renders
            inline, inside a permanently reserved fixed-width slot next to
            the icon: nothing can overlap, and the slot exists whether or
            not a count is showing so neighbours never shift. */}
        <button
          className="flex items-center gap-1 text-text-mute hover:text-text transition-colors"
          data-testid="button-background-work-bell"
          aria-label={
            countBreakdown
              ? `Background work and notifications — ${countBreakdown}`
              : "Background work and notifications"
          }
          title={countBreakdown || undefined}
        >
          {running.length > 0 ? (
            <Loader2 className="w-4 h-4 animate-spin text-gold shrink-0" />
          ) : (
            <Bell className="w-4 h-4 shrink-0" />
          )}
          <span
            className={cn(
              "inline-flex w-[30px] h-4 items-center justify-center rounded-full text-[10px] font-mono font-semibold",
              badgeCount > 0
                ? "bg-gold/20 text-gold border border-gold/40"
                : "invisible",
            )}
            aria-hidden={badgeCount === 0}
            data-testid="badge-background-work-count"
          >
            {badgeCount > 0 ? badgeText : "0"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-bg-elevate border-border text-text">
        <div className="px-3 py-2 border-b border-card-border text-xs font-mono uppercase tracking-wider text-text-faint">
          Background work
          {countBreakdown && (
            <span
              className="ml-2 normal-case tracking-normal text-text-mute"
              data-testid="text-background-work-breakdown"
            >
              {countBreakdown}
            </span>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {running.length === 0 && finished.length === 0 && unread.length === 0 && (
            <div className="px-3 py-6 text-sm text-text-faint text-center">
              Nothing running right now.
            </div>
          )}
          {running.map((j) => (
            <div key={j.id} className="flex items-start gap-2 px-3 py-2.5 border-b border-card-border/60" data-testid={`job-running-${j.id}`}>
              <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin text-gold shrink-0" />
              <div className="min-w-0">
                <div className="text-sm truncate">{j.label}</div>
                <div className="text-xs text-text-faint">Working on it — you can keep using the app.</div>
              </div>
            </div>
          ))}
          {finished.map((j) => (
            <div key={j.id} className="flex items-start gap-2 px-3 py-2.5 border-b border-card-border/60" data-testid={`job-finished-${j.id}`}>
              {j.status === "done" ? (
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-success shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 mt-0.5 text-danger shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{j.label}</div>
                {j.status === "failed" && j.error && (
                  <div className="text-xs text-danger/80 line-clamp-2">{j.error}</div>
                )}
                {j.status === "done" && j.resultHref && (
                  <Link
                    href={j.resultHref}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
                  >
                    View result <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
              <button
                className="text-xs text-text-faint hover:text-text shrink-0"
                onClick={() => setCleared((s) => new Set(s).add(j.id))}
                data-testid={`button-clear-job-${j.id}`}
              >
                Clear
              </button>
            </div>
          ))}
          {unread.length > 0 && (
            <div className="px-3 py-2 border-b border-card-border text-xs font-mono uppercase tracking-wider text-text-faint">
              Notifications
            </div>
          )}
          {unread.map((n) => (
            <div key={n.id} className="flex items-start gap-2 px-3 py-2.5 border-b border-card-border/60" data-testid={`notification-${n.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{n.title}</div>
                {n.body && <div className="text-xs text-text-faint line-clamp-2">{n.body}</div>}
                {n.href && (
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
                  >
                    Open <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
              <button
                className={cn("text-xs text-text-faint hover:text-text shrink-0", dismiss.isPending && "opacity-50")}
                onClick={() => dismiss.mutate({ id: n.id })}
                data-testid={`button-dismiss-notification-${n.id}`}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
