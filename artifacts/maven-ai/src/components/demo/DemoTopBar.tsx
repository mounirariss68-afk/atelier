import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  Bell,
  ArrowLeftRight,
  AlertTriangle,
} from "lucide-react";
import Logo from "@/components/Logo";

const NAVY = "#0E2841";
const SEV_CRITICAL = "#E30613";
const SEV_HIGH = "#F59E0B";
const SEV_NEUTRAL = "#9CA3AF";

export type DemoTopBarLang = "en" | "ar";

export interface DemoTopBarPersona {
  initials: string;
  name: string;
  title: string;
}

export type DemoTopBarSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export interface DemoTopBarNotificationItem {
  id: string;
  severity?: DemoTopBarSeverity;
  title: string;
  detail?: string;
  timestamp?: string;
  onClick?: () => void;
}

export interface DemoTopBarNotifications {
  /** Pre-translated notification items. */
  items: DemoTopBarNotificationItem[];
  /** Pre-translated header label, e.g. "Agent alerts". */
  panelTitle: string;
  /** Pre-translated count badge label, e.g. "urgent". When omitted, the
   *  bell badge still shows the number but the panel header omits the chip. */
  urgentLabel?: string;
  /** Override the unread/urgent badge count — defaults to items.length. */
  unreadCount?: number;
  /** Pre-translated empty-state copy. */
  emptyLabel?: string;
  /** Pre-translated "see all" footer label. */
  seeAllLabel?: string;
  onSeeAll?: () => void;
}

export interface DemoTopBarProps {
  /** Marketplace slug — used to wire the back chevron. */
  marketplaceSlug: string;
  /** Hex accent colour from `getDemoAccent(slug)`. */
  accent: string;
  /** Pre-translated short brand tag (e.g. "Value Realization"). */
  brandTag: string;
  /** Pre-translated platform title (e.g. "CFO Benefits Cockpit"). */
  platformTitle: string;
  /** Pre-translated tooltip/aria for the back chevron. */
  backLabel?: string;
  lang: DemoTopBarLang;
  setLang: (next: DemoTopBarLang) => void;
  persona: DemoTopBarPersona;
  /** Optional demo-specific shortcut button rendered before the bell. */
  actionButton?: ReactNode;
  /** Optional notifications dropdown. Omit to hide the bell entirely. */
  notifications?: DemoTopBarNotifications;
  /** Optional view-switcher (e.g. CFO ⇆ Agent cockpit). */
  onSwitchView?: () => void;
  /** Pre-translated tooltip/aria for the switch-view button. */
  switchViewLabel?: string;
  /** When true (default), the bar synchronises `<html dir lang>` with the
   *  active language so RTL chrome flips. Set false when the host already
   *  manages it (e.g. a parent provider). */
  manageDocumentDir?: boolean;
}

/**
 * Standardised navy top bar shared by every Maven AI marketplace demo.
 *
 * Layout (LTR; mirrored under RTL): back chevron → Maven logo → divider →
 * brand tag + platform title → optional action button → notifications bell
 * with dropdown → EN/AR pill → optional switch-view button → persona block.
 */
export default function DemoTopBar({
  marketplaceSlug,
  accent,
  brandTag,
  platformTitle,
  backLabel = "Back",
  lang,
  setLang,
  persona,
  actionButton,
  notifications,
  onSwitchView,
  switchViewLabel = "Switch view",
  manageDocumentDir = true,
}: DemoTopBarProps) {
  const isAr = lang === "ar";
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!manageDocumentDir) return;
    const html = document.documentElement;
    const prevDir = html.getAttribute("dir");
    const prevLang = html.getAttribute("lang");
    html.setAttribute("dir", isAr ? "rtl" : "ltr");
    html.setAttribute("lang", lang);
    return () => {
      if (prevDir !== null) html.setAttribute("dir", prevDir);
      else html.removeAttribute("dir");
      if (prevLang !== null) html.setAttribute("lang", prevLang);
      else html.removeAttribute("lang");
    };
  }, [isAr, lang, manageDocumentDir]);

  useEffect(() => {
    if (!notifOpen) return;
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [notifOpen]);

  const unread = notifications?.unreadCount ?? notifications?.items.length ?? 0;

  return (
    <header
      className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3 z-20"
      style={{ background: NAVY }}
      data-testid="demo-top-bar"
    >
      <Link
        href={`/marketplace/${marketplaceSlug}`}
        className="flex items-center gap-1 text-xs text-gray-300 hover:text-white"
        title={backLabel}
        data-testid="link-back-marketplace"
      >
        <ChevronLeft size={14} className={isAr ? "rotate-180" : ""} />
        <span className="hidden md:inline">{backLabel}</span>
      </Link>

      <Logo className="h-5 w-auto" />

      <div className="h-5 w-px bg-white/20" />

      <div className="flex-1 min-w-0">
        <p
          className="text-[10px] font-bold uppercase tracking-widest leading-tight"
          style={{ color: accent }}
        >
          {brandTag}
        </p>
        <p className="text-xs font-semibold truncate leading-tight">
          {platformTitle}
        </p>
      </div>

      {actionButton}

      {notifications && (
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            className="relative p-2 hover:bg-white/10 rounded-lg"
            aria-label={notifications.panelTitle}
            data-testid="button-notifications"
          >
            <Bell size={16} />
            {unread > 0 && (
              <span
                className={`absolute top-0.5 ${isAr ? "left-0.5" : "right-0.5"} min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center text-white`}
                style={{ background: SEV_CRITICAL }}
              >
                {unread}
              </span>
            )}
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className={`absolute ${isAr ? "left-0" : "right-0"} top-12 w-[360px] bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden text-[#0E2841]`}
                data-testid="panel-notifications"
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} style={{ color: SEV_CRITICAL }} />
                    {notifications.panelTitle}
                  </h3>
                  {unread > 0 && notifications.urgentLabel && (
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                      {unread} {notifications.urgentLabel}
                    </span>
                  )}
                </div>
                <ul className="max-h-80 overflow-y-auto">
                  {notifications.items.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-gray-400">
                      {notifications.emptyLabel ?? "—"}
                    </li>
                  )}
                  {notifications.items.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          a.onClick?.();
                        }}
                        className="w-full text-start px-4 py-3 hover:bg-gray-50 border-b border-gray-50 flex items-start gap-2"
                        data-testid={`notif-${a.id}`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{
                            background:
                              a.severity === "critical"
                                ? SEV_CRITICAL
                                : a.severity === "high"
                                  ? SEV_HIGH
                                  : SEV_NEUTRAL,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold leading-snug">
                            {a.title}
                          </p>
                          {a.detail && (
                            <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">
                              {a.detail}
                            </p>
                          )}
                          {a.timestamp && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {a.timestamp}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {notifications.onSeeAll && notifications.seeAllLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen(false);
                      notifications.onSeeAll?.();
                    }}
                    className="w-full px-4 py-2.5 text-center text-xs font-bold border-t border-gray-100 hover:bg-gray-50"
                    style={{ color: accent }}
                  >
                    {notifications.seeAllLabel}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <button
        type="button"
        onClick={() => setLang(isAr ? "en" : "ar")}
        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-white/20 hover:bg-white/10"
        data-testid="button-lang-toggle"
      >
        {isAr ? "EN" : "AR"}
      </button>

      {onSwitchView && (
        <button
          type="button"
          onClick={onSwitchView}
          className="p-2 hover:bg-white/10 rounded-lg"
          aria-label={switchViewLabel}
          title={switchViewLabel}
          data-testid="button-switch-view"
        >
          <ArrowLeftRight size={14} />
        </button>
      )}

      <div
        className={`flex items-center gap-2 ps-2 ${isAr ? "border-r" : "border-l"} border-white/20`}
      >
        <div
          className="w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
          style={{ background: accent }}
        >
          {persona.initials}
        </div>
        <div className="hidden md:block leading-tight">
          <p className="text-[11px] font-semibold">{persona.name}</p>
          <p className="text-[9px] text-gray-300">{persona.title}</p>
        </div>
      </div>

    </header>
  );
}
