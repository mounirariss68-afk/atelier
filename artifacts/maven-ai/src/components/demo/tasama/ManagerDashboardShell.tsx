import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Cpu, Inbox, Briefcase, ShieldCheck, SlidersHorizontal,
  Sparkles, Bell, ChevronLeft, ChevronRight, ArrowLeft, AlertTriangle, X,
  Filter, Wallet, FileText,
} from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang, useTasamaDemoT } from "./DemoLangContext";
import {
  TasamaDashboardProvider, useManagerFilters, type Period,
} from "./TasamaDashboardContext";
import { shell } from "./tasama-i18n";
import { generatePayrollAlerts, generatePayrollRecommendations } from "@/data/tasama-agent";
import OperationsDashboardView from "./views/OperationsDashboardView";
import AgentPerformanceView from "./views/AgentPerformanceView";
import ApprovalQueueView from "./views/ApprovalQueueView";
import ClientPortfolioView from "./views/ClientPortfolioView";
import ComplianceCenterView from "./views/ComplianceCenterView";
import PayrollSimulatorView from "./views/PayrollSimulatorView";
import ManagerChat from "./ManagerChat";
import type { PayrollRole } from "@/data/tasama-seed";

type ViewKey = "operations" | "agents" | "approvals" | "portfolio" | "compliance" | "simulator";

interface NavItem {
  key: ViewKey;
  labelKey: string;
  icon: React.ReactNode;
  badge?: "AI" | "NEW";
}

const NAV_ITEMS: NavItem[] = [
  { key: "operations", labelKey: "navOperations", icon: <LayoutDashboard size={18} /> },
  { key: "agents", labelKey: "navAgents", icon: <Cpu size={18} /> },
  { key: "approvals", labelKey: "navApprovals", icon: <Inbox size={18} />, badge: "AI" },
  { key: "portfolio", labelKey: "navPortfolio", icon: <Briefcase size={18} /> },
  { key: "compliance", labelKey: "navCompliance", icon: <ShieldCheck size={18} /> },
  { key: "simulator", labelKey: "navSimulator", icon: <SlidersHorizontal size={18} />, badge: "NEW" },
];

const ROLE_OPTIONS: { value: "all" | PayrollRole; labelKey: string; icon: React.ReactNode }[] = [
  { value: "all", labelKey: "allRoles", icon: <Filter size={11} /> },
  { value: "payroll-manager", labelKey: "rolePayrollManager", icon: <Wallet size={11} /> },
  { value: "finance-controller", labelKey: "roleFinanceController", icon: <FileText size={11} /> },
  { value: "compliance-officer", labelKey: "roleComplianceOfficer", icon: <ShieldCheck size={11} /> },
];

export default function ManagerDashboardShell() {
  return (
    <TasamaDashboardProvider>
      <ShellInner />
    </TasamaDashboardProvider>
  );
}

function ShellInner() {
  const { lang, setLang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const data = useTasamaData();
  const { filters, update } = useManagerFilters();

  const [view, setView] = useState<ViewKey>("operations");
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [fabHover, setFabHover] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // FIX 12 — html-level direction handling (RTL)
  useEffect(() => {
    const prevDir = document.documentElement.dir;
    const prevLang = document.documentElement.lang;
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    document.documentElement.lang = isAr ? "ar" : "en";
    return () => {
      document.documentElement.dir = prevDir || "ltr";
      document.documentElement.lang = prevLang || "en";
    };
  }, [isAr]);

  // alerts for notif dropdown
  const alerts = useMemo(() => generatePayrollAlerts().filter((a) => a.severity === "critical" || a.severity === "high").slice(0, 6), []);
  const pendingCount = useMemo(() => generatePayrollRecommendations().filter((r) => r.status === "pending").length, []);

  // Click-outside close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [notifOpen]);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-[#F4F6F8] flex">
      {/* Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 240 }}
        transition={{ duration: 0.2 }}
        className="bg-white border-gray-200 flex-shrink-0 flex flex-col z-30 sticky top-0 h-screen"
        style={{ borderInlineEndWidth: 1 }}
      >
        {/* Logo */}
        <div className="h-16 px-4 flex items-center gap-3 border-b border-gray-100">
          {collapsed ? (
            <img
              src={`${import.meta.env.BASE_URL}tasama-logo-dark.png`}
              alt="Tasama"
              className="h-7 w-auto object-contain flex-shrink-0"
            />
          ) : (
            <img
              src={`${import.meta.env.BASE_URL}tasama-logo-dark.png`}
              alt="Tasama · Business Services · تسامي لخدمات الأعمال"
              className="h-10 w-auto object-contain"
            />
          )}
        </div>

        {/* FIX 11 — Context switcher pill (top of sidebar) */}
        {!collapsed ? (
          <div className="px-3 pt-3">
            <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400 mb-1.5 px-1">
              {t("ctxSwitcherHint", shell)}
            </p>
            <div className="grid grid-cols-3 gap-1 bg-gray-100 rounded-lg p-0.5">
              {/* Operations — currently active (this view) — brand blue with white text */}
              <button
                className="text-[10px] font-bold px-2 py-1.5 rounded-md text-white shadow-sm truncate"
                style={{ background: "#2E4DA7" }}
                title={t("ctxOperations", shell)}
              >
                {t("ctxOperations", shell)}
              </button>
              <Link
                href="/demo/tasama-payroll-hub/client"
                className="text-[10px] font-bold px-2 py-1.5 rounded-md text-gray-700 hover:text-gray-900 hover:bg-white text-center truncate"
                title={t("ctxClientPortal", shell)}
              >
                {t("ctxClientPortal", shell)}
              </Link>
              <Link
                href="/demo/tasama-payroll-hub"
                className="text-[10px] font-bold px-2 py-1.5 rounded-md text-gray-700 hover:text-gray-900 hover:bg-white text-center truncate"
                title={t("ctxAgentOps", shell)}
              >
                {t("ctxAgentOps", shell)}
              </Link>
            </div>
          </div>
        ) : (
          /* FIX 11 — collapsed icon-only switcher */
          <div className="px-2 pt-3">
            <div className="flex flex-col gap-1 bg-gray-100 rounded-lg p-1">
              <button
                className="w-full h-8 rounded-md text-white flex items-center justify-center"
                style={{ background: "#2E4DA7" }}
                title={t("ctxOperations", shell)}
              >
                <LayoutDashboard size={14} />
              </button>
              <Link
                href="/demo/tasama-payroll-hub/client"
                className="w-full h-8 rounded-md text-gray-600 hover:text-gray-900 hover:bg-white flex items-center justify-center"
                title={t("ctxClientPortal", shell)}
              >
                <Briefcase size={14} />
              </Link>
              <Link
                href="/demo/tasama-payroll-hub"
                className="w-full h-8 rounded-md text-gray-600 hover:text-gray-900 hover:bg-white flex items-center justify-center"
                title={t("ctxAgentOps", shell)}
              >
                <Cpu size={14} />
              </Link>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors relative ${
                  active ? "bg-[#2E4DA7] text-white shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                title={collapsed ? t(item.labelKey, shell) : undefined}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {!collapsed && <span className="flex-1 text-start truncate">{t(item.labelKey, shell)}</span>}
                {!collapsed && item.badge && (
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-extrabold ${
                    item.badge === "AI"
                      ? (active ? "bg-white text-[#2E4DA7]" : "bg-blue-100 text-[#2E4DA7]")
                      : (active ? "bg-white text-[#6366F1]" : "bg-indigo-100 text-[#6366F1]")
                  }`}>
                    {item.badge === "AI" ? t("aiBadge", shell) : t("newBadge", shell)}
                  </span>
                )}
                {collapsed && item.badge && (
                  <span className={`absolute top-1 end-1 w-1.5 h-1.5 rounded-full ${item.badge === "AI" ? "bg-blue-400" : "bg-indigo-500"}`} />
                )}
              </button>
            );
          })}

          {/* FIX 10 — Sidebar AI Assistant entry (separate from FAB; same chat) */}
          <div className="pt-2 mt-2 border-t border-gray-100">
            <button
              onClick={() => setChatOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-[#2E4DA7] hover:bg-blue-50 transition-colors relative"
              title={collapsed ? t("aiAssistant", shell) : undefined}
            >
              <span className="flex-shrink-0"><Sparkles size={18} /></span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-start truncate">{t("aiAssistant", shell)}</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full font-extrabold bg-blue-100 text-[#2E4DA7]">
                    {t("aiBadge", shell)}
                  </span>
                </>
              )}
              {collapsed && <span className="absolute top-1 end-1 w-1.5 h-1.5 rounded-full bg-blue-400" />}
            </button>
          </div>
        </nav>

        {/* Footer / collapse */}
        <div className="px-3 py-3 border-t border-gray-100">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-50"
            title={collapsed ? t("expandMenu", shell) : t("collapseMenu", shell)}
          >
            {collapsed
              ? (isAr ? <ChevronLeft size={14} /> : <ChevronRight size={14} />)
              : (isAr ? <ChevronRight size={14} /> : <ChevronLeft size={14} />)}
          </button>
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-100 flex items-center px-6 gap-4 sticky top-0 z-20">
          <Link href="/marketplace/tasama-payroll-hub" className="text-gray-500 hover:text-[#2E4DA7] flex items-center gap-1.5 text-xs font-medium">
            <ArrowLeft size={14} className={isAr ? "rotate-180" : ""} />
            {t("back", shell)}
          </Link>
          <div className="h-6 w-px bg-gray-200" />
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-gray-900 truncate">{t("platformTitle", shell)}</h1>
            <p className="text-[10px] text-gray-500">{t(`nav${view.charAt(0).toUpperCase()}${view.slice(1)}`, shell)}</p>
          </div>
          <div className="flex-1" />

          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative w-9 h-9 rounded-lg hover:bg-gray-50 flex items-center justify-center text-gray-600"
              aria-label="Notifications"
            >
              <Bell size={16} />
              {alerts.length > 0 && (
                <span className="absolute top-1.5 end-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
              )}
            </button>
            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className={`absolute top-12 ${isAr ? "left-0" : "right-0"} w-[360px] bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50`}
                >
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{t("agentAlerts", shell)}</p>
                      <p className="text-[11px] text-gray-500">
                        {alerts.length} {t("urgent", shell)}
                      </p>
                    </div>
                    <button onClick={() => setNotifOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-50">
                    {alerts.map((a) => (
                      <div key={a.id} className="px-4 py-3 hover:bg-gray-50">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${a.severity === "critical" ? "text-red-500" : "text-orange-500"}`} />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-900">{a.title}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{a.detail}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setNotifOpen(false); setView("operations"); }}
                    className="w-full px-4 py-2.5 text-[11px] font-bold text-[#2E4DA7] hover:bg-blue-50 border-t border-gray-100"
                  >
                    {t("seeAllAlerts", shell)}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Lang */}
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
          >
            {lang === "en" ? "العربية" : "English"}
          </button>

          {/* User chip */}
          <div className="flex items-center gap-2.5 ps-3 border-s border-gray-200">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-extrabold" style={{ background: "linear-gradient(135deg, #1F3864, #2E4DA7)" }}>
              {t("managerInitials", shell)}
            </div>
            <div className="hidden md:block min-w-0">
              <p className="text-[11px] font-bold text-gray-900 truncate">{t("managerName", shell)}</p>
              <p className="text-[9px] text-gray-500 truncate">{t("managerTitle", shell)}</p>
            </div>
          </div>
        </header>

        {/* Sticky filter bar */}
        <div className="sticky top-16 z-10 bg-white/85 backdrop-blur border-b border-gray-100 px-6 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-gray-400">
            <Filter size={11} />{t("filters", shell)}
          </div>

          {/* Period chips */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(["this-week", "this-month", "3-months", "6-months"] as Period[]).map((p) => {
              const active = filters.period === p;
              const labelKey = p === "this-week" ? "periodThisWeek" : p === "this-month" ? "periodThisMonth" : p === "3-months" ? "period3Months" : "period6Months";
              return (
                <button
                  key={p}
                  onClick={() => update({ period: p })}
                  className={`px-3 py-1 rounded-md text-[11px] font-bold transition-colors ${
                    active ? "bg-white text-[#2E4DA7] shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {t(labelKey, shell)}
                </button>
              );
            })}
          </div>

          {/* Client filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-500">{t("clientLabel", shell)}:</span>
            <select
              value={filters.clientId}
              onChange={(e) => update({ clientId: e.target.value })}
              className="bg-white border border-gray-200 rounded-md px-2.5 py-1 text-[11px] font-medium"
            >
              <option value="all">{t("allClients", shell)}</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>{isAr ? c.legalNameAr : c.legalNameEn}</option>
              ))}
            </select>
          </div>

          {/* FIX 7 — Segmented role chip control (replaces select) */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-500">{t("roleLabel", shell)}:</span>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {ROLE_OPTIONS.map((opt) => {
                const active = filters.role === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => update({ role: opt.value })}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                      active ? "bg-white text-[#2E4DA7] shadow-sm" : "text-gray-600 hover:text-gray-900"
                    }`}
                    title={t(opt.labelKey, shell)}
                  >
                    {opt.icon}
                    <span className="hidden lg:inline">{t(opt.labelKey, shell)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ms-auto flex items-center gap-3 text-[11px] text-gray-500">
            <span>
              <span className="font-bold text-[#2E4DA7]">{pendingCount}</span> {t("pendingApprovals", shell)}
            </span>
          </div>
        </div>

        {/* View body */}
        <main className="flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full">
          {view === "operations" && (
            <OperationsDashboardView
              onOpenView={(v, opts) => {
                if (opts?.clientId) update({ clientId: opts.clientId });
                setView(v as ViewKey);
              }}
            />
          )}
          {view === "agents" && <AgentPerformanceView />}
          {view === "approvals" && <ApprovalQueueView />}
          {view === "portfolio" && <ClientPortfolioView />}
          {view === "compliance" && <ComplianceCenterView />}
          {view === "simulator" && <PayrollSimulatorView />}
        </main>

        {/* FIX 10 — Single AI entry FAB (bottom-right of main content) */}
        <button
          onClick={() => setChatOpen(true)}
          onMouseEnter={() => setFabHover(true)}
          onMouseLeave={() => setFabHover(false)}
          className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} z-40 inline-flex items-center gap-2 rounded-full shadow-lg text-white font-bold transition-all duration-200 ${
            fabHover ? "px-5 py-3.5 text-xs" : "px-3.5 py-3.5 text-sm"
          }`}
          style={{ background: "linear-gradient(135deg, #1F3864, #2E4DA7)", boxShadow: "0 10px 25px rgba(31, 56, 100, 0.35)" }}
          aria-label={t("fabAskAi", shell)}
          title={t("fabAskAi", shell)}
        >
          <Sparkles size={18} className="flex-shrink-0" />
          <AnimatePresence initial={false}>
            {fabHover && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {t("fabAskAi", shell)}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* AI Chat panel */}
      <AnimatePresence>
        {chatOpen && <ManagerChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
