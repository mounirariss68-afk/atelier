import * as React from "react";
import { Link, useLocation } from "wouter";
import Logo from "@/components/ui/Logo";
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
import { ChevronRight, ChevronLeft, Activity, Bell, FileText, ExternalLink, X as XIcon, Sparkles, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { ConfidenceChip } from "../ui/primitives";
import { ManagePicker, LensSectionTabs } from "@/components/layout/ManagePicker";
import {
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { CommandBar } from "@/components/cli/CommandBar";
import { CliContext } from "@/components/cli/cli-context";
import { s as cliS } from "@/components/cli/locale";
import type { CliLocale } from "@/components/cli/types";
import { emitCliOpened } from "@/components/cli/telemetry";
import { derivePageContext } from "@/components/cli/pageContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ChangePasswordDialog } from "@/components/layout/ChangePasswordDialog";

/**
 * Task #497 — light/dark mode toggle. Sits in the right-side utility
 * cluster of the TopNav next to the notification bell. Inherits the
 * same icon-button styling so it matches visually.
 */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="text-text-mute hover:text-text transition-colors"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export function TopNav() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [changePwOpen, setChangePwOpen] = React.useState(false);
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

  // Task #368 — Manage shell. The flat 10-item nav was collapsing into three
  // muddled concepts (managed entities · firm IP/ops · personal landing).
  // The top bar now reads: Logo · Home · ManagePicker · (lens section tabs,
  // rendered by the active lens page itself) · CLI · Bell · Avatar.
  // Firm-IP / ops items (Atelier, Press, Guardhouse, Reports, Wallet,
  // Settings, Admin) moved into the avatar → Firm submenu. Underlying
  // routes for old top-nav entries still resolve so deep-links don't die
  // (see comments in App.tsx on `/crm`, `/opportunities`, `/engagements`,
  // `/studio`, `/roster`, `/ledger`, `/wallet`, `/alliances`, `/agents`,
  // `/finance`, `/pricing`, `/atelier`, `/press`, `/guardhouse`).
  const homeItem = { href: "/", label: "Home", badge: pendingApprovals } as
    { href: string; label: string; badge?: number };
  const isHomeActive = location === "/";
  const isFirmAdmin = me?.role === "founding_partner" || me?.role === "hr";

  // Items shown under avatar → Firm submenu. Admin Console is gated to the
  // same roles as before (founding_partner | hr).
  const firmMenuItems: Array<{ href: string; label: string; gated?: boolean }> = [
    { href: "/atelier", label: "Atelier" },
    { href: "/press", label: "Press" },
    { href: "/guardhouse", label: "Guardhouse" },
    { href: "/reports", label: "Reports" },
    { href: "/wallet", label: "Wallet" },
    { href: "/settings", label: "Settings" },
    { href: "/admin", label: "Admin", gated: true },
  ];

  return (
    <header className="atelier-topnav sticky top-0 z-40 w-full border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="flex h-14 items-center px-4 md:px-6 gap-6">
        <Link href="/" className="flex items-center gap-3">
          <Logo size="sm" />
          <span className="hidden sm:inline font-mono text-[10px] tracking-wider text-text-faint normal-case">
            Atelier
          </span>
        </Link>
        
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
          <Link
            href={homeItem.href}
            className={cn(
              "transition-colors hover:text-gold inline-flex items-center gap-1.5",
              isHomeActive ? "text-gold" : "text-text-mute",
            )}
          >
            {homeItem.label}
            {homeItem.badge && homeItem.badge > 0 ? (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-semibold bg-gold/20 text-gold border border-gold/40"
                title={`${homeItem.badge} pending approval${homeItem.badge === 1 ? "" : "s"}`}
                data-testid="nav-badge-home-approvals"
              >
                {homeItem.badge}
              </span>
            ) : null}
          </Link>
          {/* Contextual lens-section tabs slot. Renders the active lens's
              default sections; each lens task replaces these with its own
              lifecycle-shaped tabs. Always visible (including on Home) so
              the menu doesn't appear empty on first load. */}
          <LensSectionTabs userId={me?.id ?? null} role={me?.role ?? null} />
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <ManagePicker userId={me?.id ?? null} role={me?.role ?? null} />
          <ThemeToggle />
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
                  {/* Task #368 — Firm submenu groups items that don't belong
                      to a managed entity lens (firm IP, ops, settings).
                      Old top-nav entries for these were removed. */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      data-testid="avatar-firm-submenu"
                      className="focus:bg-bg-elevate-2 focus:text-text cursor-pointer"
                    >
                      Firm
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="w-48 bg-bg-elevate border-border text-text">
                        <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
                          Firm
                        </DropdownMenuLabel>
                        {firmMenuItems.map((item) => {
                          if (item.gated && !isFirmAdmin) return null;
                          return (
                            <DropdownMenuItem
                              key={item.href}
                              asChild
                              className="focus:bg-bg-elevate-2 focus:text-text cursor-pointer"
                            >
                              <Link href={item.href}>{item.label}</Link>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    onClick={() => setChangePwOpen(true)}
                    data-testid="menu-change-password"
                    className="focus:bg-bg-elevate-2 focus:text-text cursor-pointer"
                  >
                    Change Password
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void logout()}
                    data-testid="menu-sign-out"
                    className="focus:bg-bg-elevate-2 focus:text-danger cursor-pointer mt-1 border-t border-border-soft"
                  >
                    Sign Out
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </header>
  );
}

type RailTabValue = "agent" | "activity" | "reports";

/** Task #515 — user-resizable rail. Width is in CSS px and is clamped
 * to [RAIL_MIN_WIDTH, RAIL_MAX_WIDTH] (or 60% of viewport, whichever
 * is smaller, on the upper bound). The collapsed icon strip is a
 * separate fixed 48px (3rem) and ignores the stored width. */
export const RAIL_MIN_WIDTH = 320;
export const RAIL_MAX_WIDTH = 720;
export const RAIL_DEFAULT_WIDTH = 320;
export const RAIL_COLLAPSED_WIDTH = 48; // matches w-12 (3rem)
const RAIL_STORAGE_KEY = "atelier-rail-width";

export function clampRailWidth(n: number, viewportW?: number): number {
  if (!Number.isFinite(n)) return RAIL_DEFAULT_WIDTH;
  const vp = typeof viewportW === "number" && viewportW > 0 ? viewportW : 1280;
  const upper = Math.min(RAIL_MAX_WIDTH, Math.floor(vp * 0.6));
  const lo = Math.min(RAIL_MIN_WIDTH, upper);
  return Math.max(lo, Math.min(upper, Math.round(n)));
}

/** Pure helper: compute the new rail width while the user drags the
 * left-edge handle. The rail is anchored to the right edge, so dragging
 * LEFT (negative deltaX) WIDENS the rail. Exported for unit tests. */
export function computeRailDragWidth(
  startWidth: number,
  deltaX: number,
  viewportW: number,
): number {
  return clampRailWidth(startWidth - deltaX, viewportW);
}

/** Pure helper: keyboard handler for the rail resize separator.
 * Returns the next clamped width, or `null` if the key is not a
 * recognised resize key (caller should not preventDefault). Convention:
 * Home → minimum width (start of range), End → maximum (end of range);
 * ArrowLeft widens by 16px (rail anchored right), ArrowRight shrinks. */
export function applyRailKeyAction(
  key: string,
  currentWidth: number,
  viewportW: number,
): number | null {
  const upper = Math.min(RAIL_MAX_WIDTH, Math.floor(viewportW * 0.6));
  switch (key) {
    case "ArrowLeft":
      return clampRailWidth(currentWidth + 16, viewportW);
    case "ArrowRight":
      return clampRailWidth(currentWidth - 16, viewportW);
    case "Home":
      return RAIL_MIN_WIDTH;
    case "End":
      return upper;
    default:
      return null;
  }
}

export function loadRailWidth(): number {
  if (typeof window === "undefined") return RAIL_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(RAIL_STORAGE_KEY);
    if (!raw) return RAIL_DEFAULT_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return RAIL_DEFAULT_WIDTH;
    return clampRailWidth(n, window.innerWidth);
  } catch {
    return RAIL_DEFAULT_WIDTH;
  }
}

const RailContext = React.createContext<{
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** Task #501 — active rail tab; lifted to context so the assistant
   * entry points can switch to the Agent tab. */
  tab: RailTabValue;
  setTab: (t: RailTabValue) => void;
  /** Task #515 — current rail width in CSS px (expanded only). */
  width: number;
  setWidth: (n: number) => void;
}>({
  collapsed: false,
  setCollapsed: () => {},
  tab: "agent",
  setTab: () => {},
  width: RAIL_DEFAULT_WIDTH,
  setWidth: () => {},
});

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

type RailTab = "agent" | "activity" | "reports";

export function RightRail() {
  // Task #501 — Agent is now the first rail tab and the default
  // selection. Tab + collapse state is lifted into RailContext so
  // entry points (⌘K, Home input, sparkles bubble, deep-links) can
  // open the rail directly to the Agent tab via openCli().
  const { collapsed, setCollapsed, tab, setTab, width, setWidth } =
    React.useContext(RailContext);

  // Task #515 — drag-to-resize. Pointer events on the left-edge handle
  // update width with rAF coalescing so we don't dispatch a setState per
  // mousemove. The handle is also keyboard-operable: Left/Right nudge by
  // 16px, Home/End jump to clamp bounds.
  const dragRef = React.useRef<{ raf: number | null; nextW: number | null }>({
    raf: null,
    nextW: null,
  });
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      const next = computeRailDragWidth(startW, ev.clientX - startX, window.innerWidth);
      dragRef.current.nextW = next;
      if (dragRef.current.raf == null) {
        dragRef.current.raf = requestAnimationFrame(() => {
          dragRef.current.raf = null;
          if (dragRef.current.nextW != null) setWidth(dragRef.current.nextW);
        });
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (dragRef.current.raf != null) {
        cancelAnimationFrame(dragRef.current.raf);
        dragRef.current.raf = null;
      }
      const final = computeRailDragWidth(startW, ev.clientX - startX, window.innerWidth);
      setWidth(final);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const vp = typeof window !== "undefined" ? window.innerWidth : 1280;
    const next = applyRailKeyAction(e.key, width, vp);
    if (next != null) {
      e.preventDefault();
      setWidth(next);
    }
  };
  const cliTriggerRef = React.useContext(CliContext).triggerRef;
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
        "fixed right-0 top-14 bottom-0 z-30 border-l border-border bg-bg-deep/80 backdrop-blur flex flex-col",
        collapsed ? "transition-[width] duration-300 ease-[--ease] w-12" : "",
      )}
      style={collapsed ? undefined : { width: `${width}px` }}
      data-testid="right-rail"
      data-rail-width={collapsed ? RAIL_COLLAPSED_WIDTH : width}
    >
      {/* Task #515 — drag handle on the left edge (only when expanded). */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent rail"
          aria-valuemin={RAIL_MIN_WIDTH}
          aria-valuemax={
            typeof window !== "undefined"
              ? Math.min(RAIL_MAX_WIDTH, Math.floor(window.innerWidth * 0.6))
              : RAIL_MAX_WIDTH
          }
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onKeyDown={onHandleKey}
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-40",
            "hover:bg-gold/40 focus:bg-gold/60 focus:outline-none transition-colors",
            "before:content-[''] before:absolute before:inset-y-0 before:-left-2 before:-right-2",
          )}
          data-testid="right-rail-resize-handle"
        />
      )}
      <div className="flex items-center justify-between p-3 border-b border-border">
        {!collapsed && (
          // Task #501 — Tab strip: Agent (conversational AI) is the
          // primary, default-selected tab; Activity is the live agent
          // feed; Reports is the saved-report list.
          <div className="flex items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-widest">
            <button
              ref={(el) => { if (cliTriggerRef) cliTriggerRef.current = el; }}
              type="button"
              onClick={() => setTab("agent")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
                tab === "agent" ? "text-gold bg-bg-elevate-2" : "text-text-mute hover:text-text",
              )}
              data-testid="rail-tab-agent"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Agent
            </button>
            <button
              type="button"
              onClick={() => setTab("activity")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
                tab === "activity" ? "text-gold bg-bg-elevate-2" : "text-text-mute hover:text-text",
              )}
              data-testid="rail-tab-activity"
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
              data-testid="rail-tab-reports"
            >
              <FileText className="w-3.5 h-3.5" />
              Reports
            </button>
          </div>
        )}
        {collapsed && (
          <div className="w-full flex justify-center relative">
            <Sparkles className="w-4 h-4 text-text-mute" />
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

      {/* Task #501 — when the Agent tab is active, the embedded
       * CommandBar fills the rail body (it manages its own scroll &
       * composer). Activity/Reports keep the padded scroll area. */}
      {!collapsed && tab === "agent" && (
        <div className="flex-1 min-h-0">
          <CommandBar embedded />
        </div>
      )}
      <div
        className={cn(
          "flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3",
          (!collapsed && tab === "agent") && "hidden",
        )}
      >
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

/**
 * Task #342 — bottom-right floating chat bubble. Visible on every page
 * except `/cli`, dismissible per session (sessionStorage), respects
 * safe-area insets on tablet, and threads the floating-bubble source
 * into the cli.opened telemetry. Hidden on the sign-in route too via
 * the parent guard in Shell.
 */
function FloatingCliBubble() {
  const [location] = useLocation();
  const cli = React.useContext(CliContext);
  // Right rail is fixed-position on the right edge: w-12 (3rem) when
  // collapsed, w-80 (20rem) when expanded. We read its state so the
  // bubble can park to the *inside* of the rail instead of underneath
  // it. RTL flips the rail-collision side too because the rail itself
  // mirrors via `right-0` on the parent — when locale is RTL the rail
  // visually sits on the left, so the bubble offsets accordingly.
  const { collapsed: railCollapsed, width: railWidth } = React.useContext(RailContext);
  // Toast viewport (`components/ui/toast.tsx` Viewport): fixed bottom-0
  // right-0 on sm+, max-w-[420px] with p-4. When at least one toast is
  // active, lift the bubble above that lane so it doesn't sit on top
  // of dismissable notifications. We subscribe to the toast store via
  // the same hook the toaster uses; re-renders are cheap and bounded.
  const { toasts } = useToast();
  const hasToasts = toasts.length > 0;
  const locale: CliLocale =
    typeof window !== "undefined"
      ? ((window.localStorage.getItem("atelier-cli-locale") as CliLocale) ?? "en")
      : "en";
  const dir = locale === "ar" ? "rtl" : "ltr";
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem("atelier-cli-bubble-dismissed") === "1";
    } catch {
      return false;
    }
  });
  // Task #342 — restoration path. Whenever the panel transitions from
  // open → closed, re-read sessionStorage: the header / ⌘K opener
  // clears the dismissal key as part of the open() call, so once the
  // user closes the bar the bubble re-appears for the rest of the
  // session. (Without this re-sync, the locally-cached `dismissed`
  // state from the initial mount would leave the bubble hidden.)
  React.useEffect(() => {
    if (cli.open) return;
    try {
      const stored =
        window.sessionStorage.getItem("atelier-cli-bubble-dismissed") === "1";
      setDismissed(stored);
    } catch {
      /* ignore */
    }
  }, [cli.open]);
  // Hide on the assistant route itself (matches /cli + nested deep-links).
  if (location.startsWith("/cli")) return null;
  if (dismissed) return null;
  if (cli.open) return null; // don't compete with the open panel
  const handleClick = () => cli.openCli({ source: "floating_bubble" });
  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      window.sessionStorage.setItem("atelier-cli-bubble-dismissed", "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };
  // Compute side-offset to clear the right rail. Task #515 — rail is
  // user-resizable, so we read the live width from RailContext rather
  // than hard-coding the previous w-80 (20rem).
  const railOffsetPx = railCollapsed ? RAIL_COLLAPSED_WIDTH : railWidth;
  const sideStyle: React.CSSProperties = dir === "rtl"
    ? { left: `calc(${railOffsetPx}px + 1.5rem)` }
    : { right: `calc(${railOffsetPx}px + 1.5rem)` };
  // Bottom offset: clear the toast lane (toasts cap around 5–6rem tall
  // each, but most show one at a time; 6rem is a safe baseline) plus
  // the safe-area inset on tablets.
  const bottomStyle: React.CSSProperties = {
    bottom: hasToasts ? "calc(6.5rem + env(safe-area-inset-bottom))" : "calc(1.5rem + env(safe-area-inset-bottom))",
  };
  return (
    <div
      dir={dir}
      style={{ ...sideStyle, ...bottomStyle }}
      className={cn(
        "fixed z-30 flex items-center",
        // Smooth re-park when the rail collapses/expands or a toast
        // pops in/out — disabled under reduced motion.
        "transition-[bottom,right,left] duration-200 motion-reduce:transition-none",
      )}
      data-testid="cli-floating-bubble-wrap"
      data-rail-collapsed={railCollapsed ? "1" : "0"}
      data-toasts-active={hasToasts ? "1" : "0"}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={cliS("floatingBubbleLabel", locale)}
        title={cliS("floatingBubbleLabel", locale)}
        className={cn(
          "group relative inline-flex items-center gap-2 rounded-full",
          "bg-gold text-bg-deep shadow-2xl shadow-black/40",
          "px-4 py-3 hover:bg-gold/90 transition-colors",
          "motion-reduce:transition-none",
          "focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-bg-deep",
        )}
        data-testid="cli-floating-bubble"
      >
        <Sparkles className="w-5 h-5" aria-hidden />
        <span className="hidden sm:inline text-sm font-semibold">
          {cliS("askAtelier", locale)}
        </span>
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={cliS("floatingBubbleDismiss", locale)}
        title={cliS("floatingBubbleDismiss", locale)}
        className={cn(
          "ml-1 inline-flex items-center justify-center w-6 h-6 rounded-full",
          "bg-bg-elevate text-text-mute hover:text-text border border-border",
          "shadow-md focus:outline-none focus:ring-2 focus:ring-gold",
        )}
        data-testid="cli-floating-bubble-dismiss"
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isSignIn = location === "/sign-in";

  const [collapsed, setCollapsed] = React.useState(false);
  // Task #501 — Agent is the default rail tab. The conversational AI
  // is open whenever the rail is expanded AND the Agent tab is active;
  // we no longer track a separate `cliOpen` flag or render a modal.
  const [tab, setTab] = React.useState<RailTabValue>("agent");
  // Task #515 — user-resizable rail width, persisted in localStorage.
  const [railWidth, setRailWidthState] = React.useState<number>(() =>
    typeof window === "undefined" ? RAIL_DEFAULT_WIDTH : loadRailWidth(),
  );
  const setRailWidth = React.useCallback((n: number) => {
    const vp = typeof window !== "undefined" ? window.innerWidth : 1280;
    const clamped = clampRailWidth(n, vp);
    setRailWidthState(clamped);
    try {
      window.localStorage.setItem("atelier-rail-width", String(clamped));
    } catch {
      /* storage unavailable */
    }
  }, []);
  // Re-clamp on viewport resize so an aggressive width on a small
  // screen doesn't push past the 60% cap after the window shrinks.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setRailWidthState((w) => clampRailWidth(w, window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const cliTriggerRef = React.useRef<HTMLElement | null>(null);
  const cliOpen = !collapsed && tab === "agent";
  // Hydration handoff: /cli page enqueues a request, CommandBar drains
  // it on mount/effect. Held in a ref so producer side doesn't trigger
  // re-renders.
  const hydrationRef = React.useRef<import("@/components/cli/cli-context").CliHydrationRequest | null>(null);
  const injectTurnRef = React.useRef<((t: import("@/components/cli/types").CliTurn) => void) | null>(null);

  // Task #501 — opening the CLI now means: switch the rail to the
  // Agent tab and uncollapse it. Closing means collapsing the rail.
  const openAgentTab = React.useCallback(() => {
    setTab("agent");
    setCollapsed(false);
  }, []);
  const closeAgentTab = React.useCallback(() => {
    setCollapsed(true);
  }, []);

  const cliCtxValue = React.useMemo(
    () => ({
      open: cliOpen,
      setOpen: (v: boolean) => {
        if (v) openAgentTab();
        else closeAgentTab();
      },
      toggle: () => {
        if (cliOpen) closeAgentTab();
        else openAgentTab();
      },
      triggerRef: cliTriggerRef,
      requestHydration: (req: import("@/components/cli/cli-context").CliHydrationRequest) => {
        hydrationRef.current = req;
        openAgentTab();
      },
      consumeHydration: () => {
        const v = hydrationRef.current;
        hydrationRef.current = null;
        return v;
      },
      registerInjectTurn: (fn: (t: import("@/components/cli/types").CliTurn) => void) => {
        injectTurnRef.current = fn;
      },
      // Task #342 — single instrumented opener used by every launcher.
      // Forwards an optional prefill prompt via the hydration queue so
      // the user's in-progress text lands in the composer.
      openCli: (opts: import("@/components/cli/cli-context").CliOpenOptions) => {
        const surface = derivePageContext(
          typeof window !== "undefined" ? window.location.pathname : "/",
        ).surface;
        emitCliOpened(opts.source, { prompt: opts.prompt ?? null, surface });
        if (opts.prompt) {
          hydrationRef.current = { prompt: opts.prompt };
        }
        // Task #342 — using the header (or the ⌘K shortcut) is an
        // explicit re-engagement signal: it should *restore* the
        // floating bubble for the rest of the session, undoing any
        // earlier per-session dismissal. Other entry points (slash,
        // deep link, home input/chip, the bubble itself) leave the
        // dismissal untouched.
        if (opts.source === "header" || opts.source === "shortcut") {
          try {
            window.sessionStorage.removeItem("atelier-cli-bubble-dismissed");
          } catch {
            /* ignore */
          }
        }
        openAgentTab();
      },
    }),
    [cliOpen, openAgentTab, closeAgentTab],
  );

  // Global ⌘K / Ctrl+K binding. Stays mounted across pages so the bar
  // is reachable from anywhere; ignored on the sign-in route.
  React.useEffect(() => {
    if (isSignIn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Task #342 — emit cli.opened on each ⌘K open so we can
        // attribute opens via keyboard separately from the header click.
        if (cliOpen) {
          closeAgentTab();
        } else {
          const surface = derivePageContext(window.location.pathname).surface;
          emitCliOpened("shortcut", { surface });
          openAgentTab();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSignIn, cliOpen, openAgentTab, closeAgentTab]);

  const railCtxValue = React.useMemo(
    () => ({ collapsed, setCollapsed, tab, setTab, width: railWidth, setWidth: setRailWidth }),
    [collapsed, tab, railWidth, setRailWidth],
  );

  if (isSignIn) {
    return <div className="min-h-screen flex flex-col">{children}</div>;
  }

  return (
    <CliContext.Provider
      value={cliCtxValue}
    >
      <RailContext.Provider value={railCtxValue}>
        <div className="min-h-screen flex flex-col relative">
          <TopNav />
          <div className="flex flex-1">
            <main
              className={cn(
                "flex-1 w-full pb-20",
                collapsed ? "pr-12 transition-[padding] duration-300" : "pr-12",
              )}
              style={
                collapsed
                  ? undefined
                  : { paddingRight: `max(3rem, ${railWidth}px)` }
              }
            >
              {children}
            </main>
            <RightRail />
          </div>
          <FloatingCliBubble />
        </div>
      </RailContext.Provider>
    </CliContext.Provider>
  );
}
