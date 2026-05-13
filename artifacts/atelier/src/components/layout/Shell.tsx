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
import { useQueryClient } from "@tanstack/react-query";
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
  const APPROVER_ROLES = new Set(["partner", "operations", "engagement_lead"]);
  const isApprover = !!me?.role && APPROVER_ROLES.has(me.role);
  // Pull a small count of timesheets currently waiting on the active
  // persona so the Home tab can show a peripheral cue (the badge that
  // used to live on the old Approvals nav item).
  const [pendingApprovals, setPendingApprovals] = React.useState<number>(0);
  React.useEffect(() => {
    if (!isApprover || !me?.role) { setPendingApprovals(0); return; }
    const stage = me.role === "partner" ? "lead_approved" : "submitted";
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
          <button className="text-text-mute hover:text-text transition-colors">
            <Search className="w-4 h-4" />
          </button>
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
                <div className="border-t border-border mt-1 pt-1">
                  <DropdownMenuItem asChild className="focus:bg-bg-elevate-2 focus:text-text cursor-pointer">
                    <Link href="/settings">Settings</Link>
                  </DropdownMenuItem>
                  {me.role === "partner" && (
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

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isSignIn = location === "/sign-in";

  const [collapsed, setCollapsed] = React.useState(false);

  if (isSignIn) {
    return <div className="min-h-screen flex flex-col">{children}</div>;
  }

  return (
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
      </div>
    </RailContext.Provider>
  );
}
