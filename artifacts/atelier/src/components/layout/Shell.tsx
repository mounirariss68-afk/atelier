import * as React from "react";
import { Link, useLocation } from "wouter";
import { FIRM_NAME } from "@/lib/firm";
import { 
  useAtelierGetMe, 
  useAtelierListPersonas, 
  useAtelierSwitchPersona,
  useAtelierGetActivity
} from "@workspace/api-client-react";
import { getAtelierGetMeQueryKey, getAtelierGetHomeQueryKey, getAtelierGetActivityQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronRight, ChevronLeft, Activity, Search, Bell, FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfidenceChip } from "../ui/primitives";
import { Progress } from "@/components/ui/progress";
import { CommandBar } from "@/components/cli/CommandBar";
import { CliContext } from "@/components/cli/cli-context";

export function TopNav() {
  const [location] = useLocation();
  const { data: me } = useAtelierGetMe();
  const { data: personas } = useAtelierListPersonas();
  const switchPersona = useAtelierSwitchPersona();
  const queryClient = useQueryClient();

  const handleSwitch = (personaId: string) => {
    switchPersona.mutate({ data: { personaId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAtelierGetMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAtelierGetHomeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAtelierGetActivityQueryKey() });
      }
    });
  };

  // Task #271 — Approvals, Ledger, Roster, Finance, Forecasts removed from
  // the top nav. Approvals now surface in Home → "What needs me today";
  // Ledger / Roster / Finance live in the Home → "Workspace" shelf;
  // Forecasts are an integrated tab inside Opportunities. The underlying
  // routes still resolve so deep-links from reports/dossiers don't die.
  // Task #292 — 9-persona model: founding_partner + partner sign off as
  // partners; senior_manager + finance act as lead approvers (replacing the
  // old engagement_lead persona and the operations split).
  const APPROVER_ROLES = new Set(["founding_partner", "partner", "senior_manager", "finance"]);
  const PARTNER_TIER = new Set(["founding_partner", "partner"]);
  const isApprover = !!me?.role && APPROVER_ROLES.has(me.role);
  // Pull a small count of timesheets currently waiting on the active
  // persona so the Home tab can show a peripheral cue (the badge that
  // used to live on the old Approvals nav item).
  const [pendingApprovals, setPendingApprovals] = React.useState<number>(0);
  React.useEffect(() => {
    if (!isApprover || !me?.role) { setPendingApprovals(0); return; }
    const stage = PARTNER_TIER.has(me.role) ? "lead_approved" : "submitted";
    let alive = true;
    void fetch(`/api/atelier/ledger/approvals?stage=${stage}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((j: { groups?: Array<{ weeks?: unknown[] }> }) => {
        if (!alive) return;
        const n = (j.groups ?? []).reduce((s, g) => s + (g.weeks?.length ?? 0), 0);
        setPendingApprovals(n);
      })
      .catch(() => { if (alive) setPendingApprovals(0); });
    return () => { alive = false; };
  }, [isApprover, me?.role]);

  const navItems = [
    { href: "/", label: "Home", badge: pendingApprovals },
    { href: "/crm", label: "Accounts" },
    { href: "/opportunities", label: "Opportunities" },
    { href: "/engagements", label: "Engagements" },
    { href: "/atelier", label: "Atelier" },
    { href: "/agents", label: "Agents" },
  ] as Array<{ href: string; label: string; badge?: number }>;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="flex h-14 items-center px-4 md:px-6 gap-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold tracking-widest text-text uppercase">
            {FIRM_NAME}
          </span>
        </Link>
        
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map(item => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "transition-colors hover:text-gold inline-flex items-center gap-1.5",
                  isActive ? "text-gold" : "text-text-mute"
                )}
              >
                {item.label}
                {item.badge && item.badge > 0 ? (
                  <span
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-semibold bg-gold/20 text-gold border border-gold/40"
                    title={`${item.badge} pending approval${item.badge === 1 ? "" : "s"}`}
                    data-testid="nav-badge-home-approvals"
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <CliTrigger />
          <button className="text-text-mute hover:text-text transition-colors">
            <Bell className="w-4 h-4" />
          </button>
          
          {me && personas && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 outline-none group">
                  <div className="flex flex-col items-end hidden sm:flex">
                    <span className="text-sm font-semibold text-text group-hover:text-gold transition-colors">{me.name}</span>
                    <span className="text-xs text-text-faint">{me.roleLabel}</span>
                  </div>
                  <Avatar className="h-8 w-8 border border-gold/50 group-hover:border-gold transition-colors">
                    <AvatarImage src={me.avatarUrl || ""} />
                    <AvatarFallback className="bg-bg-elevate-2 text-gold text-xs font-mono">{me.initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-bg-elevate border-border text-text">
                {/* Task #292 — persona switcher gated behind an env flag so
                    production builds default to the real auth identity and
                    only demo / dev builds expose the picker. */}
                {import.meta.env.VITE_ATELIER_PERSONA_SWITCHER === "true" && (
                  <>
                <div className="px-2 py-1.5 text-xs font-mono text-text-faint uppercase tracking-wider">
                  Switch Persona
                </div>
                {personas.map(p => (
                  <DropdownMenuItem 
                    key={p.id} 
                    onClick={() => handleSwitch(p.id)}
                    className="flex items-center gap-2 focus:bg-bg-elevate-2 focus:text-text cursor-pointer"
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={p.avatarUrl || ""} />
                      <AvatarFallback className="bg-bg-deep text-[10px]">{p.initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm">{p.name}</span>
                      <span className="text-xs text-text-mute">{p.roleLabel}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
                  </>
                )}
                <div className="border-t border-border mt-1 pt-1">
                  <DropdownMenuItem asChild className="focus:bg-bg-elevate-2 focus:text-text cursor-pointer">
                    <Link href="/settings">Settings</Link>
                  </DropdownMenuItem>
                  {(me.role === "founding_partner" || me.role === "hr") && (
                    <DropdownMenuItem asChild className="focus:bg-bg-elevate-2 focus:text-text cursor-pointer">
                      <Link href="/admin">Admin Console</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild className="focus:bg-bg-elevate-2 focus:text-danger cursor-pointer mt-1 border-t border-border-soft">
                    <Link href="/sign-in">Sign Out</Link>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}

const RailContext = React.createContext<{
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}>({ collapsed: false, setCollapsed: () => {} });

// Compact saved-reports list for the right rail "Reports" tab. Reads the
// same /api/atelier/reports endpoint the full Reports page uses, but renders
// only name + last-run + quick actions, plus a link to the full library.
interface RailReportRow {
  id: string;
  name: string;
  templateId: string;
  lastRunAt: string | null;
  schedule: string;
}

function ReportsRailPanel() {
  const [items, setItems] = React.useState<RailReportRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/atelier/reports", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j: { items: RailReportRow[] }) => {
        if (alive) setItems(j.items);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return <div className="text-xs text-danger font-mono p-3">Reports unavailable: {error}</div>;
  }
  if (!items) {
    return <div className="text-xs text-text-faint font-mono p-3">Loading reports…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="text-center text-text-faint text-sm italic py-8 px-3">
        No saved reports yet.
        <div className="mt-3">
          <Link
            href="/reports"
            className="text-xs font-mono uppercase tracking-wider text-gold hover:underline inline-flex items-center gap-1"
          >
            Open Report Library <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((r) => (
        <div
          key={r.id}
          className="bg-bg-elevate border border-border rounded-md p-2.5 text-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-text leading-tight truncate" title={r.name}>
              {r.name}
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint shrink-0">
              {r.schedule}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-text-faint">
            <span className="truncate" title={r.templateId}>
              {r.templateId}
            </span>
            <span>{r.lastRunAt ? new Date(r.lastRunAt).toLocaleDateString() : "never"}</span>
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-border-soft">
        <Link
          href="/reports"
          className="text-xs font-mono uppercase tracking-wider text-gold hover:underline inline-flex items-center gap-1"
        >
          Open Report Library <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

type RailTab = "activity" | "reports";

export function RightRail() {
  const { collapsed, setCollapsed } = React.useContext(RailContext);
  const [tab, setTab] = React.useState<RailTab>("activity");
  const { data: activities } = useAtelierGetActivity(
    { limit: 15 },
    {
      query: {
        refetchInterval: 5000,
        refetchIntervalInBackground: false,
        queryKey: getAtelierGetActivityQueryKey({ limit: 15 }),
      },
    },
  );

  // Task #333 — merge CLI sessions into the activity rail. Each
  // session is rendered as a "CLI" row alongside agent activity so the
  // user sees their command-bar history without leaving the rail.
  // Server endpoint added in Task #331; the orchestrator increments
  // turnCount on every committed turn.
  // Per-turn recent CLI activity: rendered inline with the agent
  // activity feed so each `cli_turn` is independently clickable and
  // deep-links to its result card. The /turns/recent endpoint joins
  // through atelier_cli_sessions so RBAC is enforced server-side.
  const { data: cliRecentData } = useQuery<{
    turns: Array<{
      id: string;
      sessionId: string;
      status: string;
      prompt: string;
      createdAt: string;
    }>;
  }>({
    queryKey: ["atelier-cli-turns-recent"],
    queryFn: async () => {
      const res = await fetch("/api/atelier/cli/turns/recent?limit=10", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("cli-turns-recent");
      return res.json();
    },
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  });
  const cliRecentTurns = cliRecentData?.turns ?? [];
  const cliCtx = React.useContext(CliContext);

  const activeCount = activities?.filter(a => a.status === 'running').length || 0;

  return (
    <aside 
      className={cn(
        "fixed right-0 top-14 bottom-0 z-30 border-l border-border bg-bg-deep/80 backdrop-blur transition-all duration-300 ease-[--ease] flex flex-col",
        collapsed ? "w-12" : "w-80"
      )}
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        {!collapsed && (
          // Tab strip: Activity is the primary tab (live agent feed); Reports
          // is the secondary tab (saved-report list, pulled from full library).
          <div className="flex items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-widest">
            <button
              type="button"
              onClick={() => setTab("activity")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
                tab === "activity" ? "text-gold bg-bg-elevate-2" : "text-text-mute hover:text-text",
              )}
            >
              <Activity className="w-3.5 h-3.5" />
              Activity
              {activeCount > 0 && (
                <span className="flex h-2 w-2 relative ml-0.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-gold"></span>
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("reports")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
                tab === "reports" ? "text-gold bg-bg-elevate-2" : "text-text-mute hover:text-text",
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              Reports
            </button>
          </div>
        )}
        {collapsed && (
          <div className="w-full flex justify-center relative">
            <Activity className="w-4 h-4 text-text-mute" />
            {activeCount > 0 && (
              <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-gold animate-pulse" />
            )}
          </div>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="text-text-mute hover:text-text transition-colors p-1"
        >
          {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {!collapsed && tab === "activity" && cliRecentTurns.length > 0 && (
          <div className="space-y-1.5" data-testid="cli-rail-turns">
            {cliRecentTurns.map((t) => {
              const statusTone =
                t.status === "success"
                  ? "bg-success/10 text-success"
                  : t.status === "partial"
                    ? "bg-warning/10 text-warning"
                    : t.status === "error"
                      ? "bg-danger/10 text-danger"
                      : t.status === "awaiting_confirmation"
                        ? "bg-gold/10 text-gold"
                        : t.status === "async_dispatched"
                          ? "bg-gold/10 text-gold"
                          : "bg-bg-elevate-2 text-text-mute";
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    cliCtx.requestHydration({ sessionId: t.sessionId, turnId: t.id })
                  }
                  className="w-full text-left bg-bg-elevate border border-border hover:border-gold/40 rounded-md p-2 animate-in fade-in zoom-in-95 duration-300"
                  data-testid="cli-rail-turn-row"
                  data-turn-status={t.status}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[10px] text-gold uppercase tracking-wider">
                      cli_turn
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-mono uppercase px-1.5 py-0.5 rounded",
                        statusTone,
                      )}
                    >
                      {t.status}
                    </span>
                  </div>
                  <p className="text-text leading-snug text-xs line-clamp-2">{t.prompt}</p>
                  <div className="text-[10px] font-mono text-text-faint mt-1">
                    {new Date(t.createdAt).toLocaleTimeString()}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {!collapsed && tab === "activity" && activities && activities.map(item => (
          <div key={item.id} className="bg-bg-elevate border border-border rounded-md p-3 text-sm animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs text-gold font-medium">{item.agentName}</span>
              <div className="flex items-center gap-1.5">
                {item.confidence && <ConfidenceChip value={item.confidence} />}
                <span className={cn(
                  "text-[10px] font-mono uppercase px-1.5 py-0.5 rounded",
                  item.status === 'running' ? "bg-bg-elevate-2 text-gold animate-pulse" :
                  item.status === 'complete' ? "bg-success/10 text-success" :
                  item.status === 'error' ? "bg-danger/10 text-danger" :
                  "bg-bg-elevate-2 text-text-mute"
                )}>
                  {item.status}
                </span>
              </div>
            </div>
            <p className="text-text-mute leading-snug mb-2">{item.message}</p>
            
            {item.progressPct != null && item.status === 'running' && (
              <Progress value={item.progressPct} className="h-1 bg-bg-deep mb-2" />
            )}

            <div className="flex items-center justify-between text-xs text-text-faint font-mono">
              <span className="truncate max-w-[160px]">{item.targetLabel || item.targetType}</span>
              <div className="flex items-center gap-2">
                {item.sourcesCount != null && item.sourcesCount > 0 && (
                  <span title={`${item.sourcesCount} sources cited`}>📚 {item.sourcesCount}</span>
                )}
                <span>{item.startedAt}</span>
              </div>
            </div>
          </div>
        ))}
        {!collapsed && tab === "activity" && activities?.length === 0 && (
          <div className="text-center text-text-faint text-sm italic py-8">
            No recent agent activity.
          </div>
        )}
        {!collapsed && tab === "reports" && <ReportsRailPanel />}
      </div>
    </aside>
  );
}

// Top-nav button that opens the CLI command bar. Lives inside the
// CliContext provider so the same trigger ref is used for focus restore
// when Esc closes the panel.
function CliTrigger() {
  const cli = React.useContext(CliContext);
  const setRef = (el: HTMLButtonElement | null) => {
    cli.triggerRef.current = el;
  };
  return (
    <button
      ref={setRef}
      type="button"
      onClick={() => cli.setOpen(true)}
      className="inline-flex items-center gap-1.5 text-text-mute hover:text-gold transition-colors px-2 py-1 rounded hover:bg-bg-elevate-2"
      title="Open command bar (⌘K)"
      aria-label="Open command bar"
      data-testid="cli-trigger"
    >
      <Search className="w-4 h-4" />
      <span className="hidden md:inline text-[10px] font-mono uppercase tracking-wider">
        ⌘K
      </span>
    </button>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isSignIn = location === "/sign-in";

  const [collapsed, setCollapsed] = React.useState(false);
  const [cliOpen, setCliOpen] = React.useState(false);
  const cliTriggerRef = React.useRef<HTMLElement | null>(null);
  // Hydration handoff: /cli page enqueues a request, CommandBar drains
  // it on mount/effect. Held in a ref so producer side doesn't trigger
  // re-renders.
  const hydrationRef = React.useRef<import("@/components/cli/cli-context").CliHydrationRequest | null>(null);
  const injectTurnRef = React.useRef<((t: import("@/components/cli/types").CliTurn) => void) | null>(null);
  const cliCtxValue = React.useMemo(
    () => ({
      open: cliOpen,
      setOpen: setCliOpen,
      toggle: () => setCliOpen((v) => !v),
      triggerRef: cliTriggerRef,
      requestHydration: (req: import("@/components/cli/cli-context").CliHydrationRequest) => {
        hydrationRef.current = req;
        setCliOpen(true);
        // If the bar is already mounted with a registered injectTurn,
        // we still leave the queue for it to drain via consumeHydration().
      },
      consumeHydration: () => {
        const v = hydrationRef.current;
        hydrationRef.current = null;
        return v;
      },
      registerInjectTurn: (fn: (t: import("@/components/cli/types").CliTurn) => void) => {
        injectTurnRef.current = fn;
      },
    }),
    [cliOpen],
  );

  // Global ⌘K / Ctrl+K binding. Stays mounted across pages so the bar
  // is reachable from anywhere; ignored on the sign-in route.
  React.useEffect(() => {
    if (isSignIn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCliOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSignIn]);

  if (isSignIn) {
    return <div className="min-h-screen flex flex-col">{children}</div>;
  }

  return (
    <CliContext.Provider
      value={cliCtxValue}
    >
      <RailContext.Provider value={{ collapsed, setCollapsed }}>
        <div className="min-h-screen flex flex-col relative">
          <TopNav />
          <div className="flex flex-1">
            <main
              className={cn(
                "flex-1 w-full pb-20 transition-all duration-300",
                collapsed ? "pr-12" : "pr-12 lg:pr-80",
              )}
            >
              {children}
            </main>
            <RightRail />
          </div>
          <CommandBar
            open={cliOpen}
            onClose={() => setCliOpen(false)}
            triggerRef={cliTriggerRef}
          />
        </div>
      </RailContext.Provider>
    </CliContext.Provider>
  );
}
