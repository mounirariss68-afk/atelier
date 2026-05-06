import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, Target, ClipboardCheck, ListChecks, Sparkles,
  ScrollText, Bot, Bell, ChevronLeft, ChevronRight, Filter, AlertTriangle,
  ArrowLeftRight, LogOut,
} from "lucide-react";
import Logo from "@/components/Logo";
import { ValueRealizationDataProvider } from "@/hooks/useValueRealizationData";
import { DemoLangProvider, useDemoLang, tBi } from "./DemoLangContext";
import { shell, t as tr } from "./value-realization-i18n";
import { generateAlerts, generateRecommendations } from "@/data/value-realization-agent";
import { PERSONA, BUSINESS_UNITS } from "@/data/value-realization-seed";
import { BRAND, NAVY, CANVAS, SEMANTIC } from "./tokens";
import PortfolioView from "./views/PortfolioView";
import InitiativeDetailView from "./views/InitiativeDetailView";
import ApprovalsView from "./views/ApprovalsView";
import ChaseQueueView from "./views/ChaseQueueView";
import WhatIfView from "./views/WhatIfView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";

type ViewId = "portfolio" | "initiative" | "approvals" | "chase" | "whatif" | "audit";

const NAV_ITEMS: { id: ViewId; icon: typeof LayoutDashboard; labelKey: string; badgeKey?: string }[] = [
  { id: "portfolio", icon: LayoutDashboard, labelKey: "navPortfolio" },
  { id: "initiative", icon: Target, labelKey: "navInitiative" },
  { id: "approvals", icon: ClipboardCheck, labelKey: "navApprovals", badgeKey: "aiBadge" },
  { id: "chase", icon: ListChecks, labelKey: "navChase" },
  { id: "whatif", icon: Sparkles, labelKey: "navWhatif", badgeKey: "newBadge" },
  { id: "audit", icon: ScrollText, labelKey: "navAudit" },
];

interface BenefitsCockpitProps {
  marketplaceSlug: string;
  /** Optional callback when the user clicks "Switch view" — typically used
   * to navigate back to the marketplace launch picker.
   */
  onSwitchView?: () => void;
}

export default function BenefitsCockpit(props: BenefitsCockpitProps) {
  return (
    <DemoLangProvider>
      <ValueRealizationDataProvider>
        <CockpitShell {...props} />
      </ValueRealizationDataProvider>
    </DemoLangProvider>
  );
}

function CockpitShell({ marketplaceSlug, onSwitchView }: BenefitsCockpitProps) {
  const { lang, setLang } = useDemoLang();
  const dir = lang === "ar" ? "rtl" : "ltr";
  const [view, setView] = useState<ViewId>("portfolio");
  const [pickedInitiative, setPickedInitiative] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filterBu, setFilterBu] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const alerts = generateAlerts();
  const pendingRecs = generateRecommendations().filter((r) => r.status === "pending").length;
  const urgentAlerts = alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;

  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
    return () => {
      document.documentElement.removeAttribute("dir");
      document.documentElement.removeAttribute("lang");
    };
  }, [dir, lang]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const goInitiative = (id: string) => {
    setPickedInitiative(id);
    setView("initiative");
  };

  return (
    <div dir={dir} className="h-screen flex flex-col" style={{ background: CANVAS, color: NAVY }} data-testid="benefits-cockpit">
      {/* Top bar */}
      <header className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3 z-20" style={{ background: NAVY }}>
        <Link href={`/marketplace/${marketplaceSlug}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white" data-testid="link-back-marketplace">
          <ChevronLeft size={14} /> {tr(shell, "back", lang)}
        </Link>
        <Logo className="h-5 w-auto text-white" />
        <div className="h-5 w-px bg-white/20" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: BRAND }}>{tr(shell, "brandTag", lang)}</p>
          <p className="text-xs font-semibold truncate">{tr(shell, "platformTitle", lang)}</p>
        </div>

        {/* Approvals shortcut */}
        <button
          onClick={() => setView("approvals")}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-white"
          style={{ background: BRAND }}
          data-testid="button-pending-approvals"
        >
          {pendingRecs} {tr(shell, "pendingApprovals", lang)}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative p-2 hover:bg-white/10 rounded-lg"
            aria-label={tr(shell, "notifications", lang)}
            data-testid="button-notifications"
          >
            <Bell size={16} />
            {urgentAlerts > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: SEMANTIC.critical }}>
                {urgentAlerts}
              </span>
            )}
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                className={`absolute ${lang === "ar" ? "left-0" : "right-0"} top-12 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden`}
                data-testid="panel-notifications"
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: NAVY }}>
                    <AlertTriangle size={14} style={{ color: SEMANTIC.critical }} /> {tr(shell, "notifications", lang)}
                  </h3>
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                    {urgentAlerts} {tr(shell, "urgent", lang)}
                  </span>
                </div>
                <ul className="max-h-80 overflow-y-auto">
                  {alerts.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => {
                          setNotifOpen(false);
                          if (a.navTarget === "initiative" && a.initiativeId) goInitiative(a.initiativeId);
                          else if (a.navTarget === "approvals") setView("approvals");
                          else if (a.navTarget === "chase") setView("chase");
                          else if (a.navTarget === "audit") setView("audit");
                          else setView("portfolio");
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 flex items-start gap-2"
                        data-testid={`notif-${a.id}`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background: a.severity === "critical" ? SEMANTIC.critical : a.severity === "high" ? SEMANTIC.attention : "#9CA3AF" }}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold" style={{ color: NAVY }}>{tBi(a.title, lang)}</p>
                          <p className="text-[11px] text-gray-600 mt-0.5">{tBi(a.detail, lang)}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Lang toggle */}
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-white/20 hover:bg-white/10"
          data-testid="button-lang-toggle"
        >
          {lang === "en" ? "AR" : "EN"}
        </button>

        {onSwitchView && (
          <button onClick={onSwitchView} className="p-2 hover:bg-white/10 rounded-lg" aria-label={tr(shell, "switchView", lang)} data-testid="button-switch-view">
            <ArrowLeftRight size={14} />
          </button>
        )}

        {/* Persona */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/20">
          <div className="w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: BRAND }}>
            {PERSONA.initials}
          </div>
          <div className="hidden md:block leading-tight">
            <p className="text-[11px] font-semibold">{tBi(PERSONA.name, lang)}</p>
            <p className="text-[9px] text-gray-300">{tBi(PERSONA.title, lang)}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`flex-shrink-0 bg-white ${lang === "ar" ? "border-l" : "border-r"} border-gray-200 transition-all duration-200 ${sidebarCollapsed ? "w-14" : "w-56"}`}
          data-testid="sidebar"
        >
          <nav className="p-2 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "text-white" : "hover:bg-gray-100 text-gray-700"}`}
                  style={active ? { background: BRAND } : {}}
                  data-testid={`nav-${item.id}`}
                  title={tr(shell, item.labelKey, lang)}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 text-left font-semibold">{tr(shell, item.labelKey, lang)}</span>
                      {item.badgeKey && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: active ? "rgba(255,255,255,0.2)" : "#E8F2EA", color: active ? "#FFFFFF" : BRAND }}>
                          {tr(shell, item.badgeKey, lang)}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </nav>
          <div className={`p-2 border-t border-gray-100 ${sidebarCollapsed ? "" : "flex items-center justify-between"}`}>
            <button
              onClick={() => setSidebarCollapsed((s) => !s)}
              className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
              data-testid="button-toggle-sidebar"
              aria-label={sidebarCollapsed ? tr(shell, "expandMenu", lang) : tr(shell, "collapseMenu", lang)}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              {!sidebarCollapsed && <span>{tr(shell, "collapseMenu", lang)}</span>}
            </button>
            {!sidebarCollapsed && (
              <Link href={`/marketplace/${marketplaceSlug}`} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 px-2 py-1.5" data-testid="link-logout">
                <LogOut size={12} />
              </Link>
            )}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto">
          {/* Filter bar */}
          {(view === "portfolio" || view === "chase") && (
            <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-3 flex-wrap" data-testid="filter-bar">
              <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5"><Filter size={12} />{tr(shell, "filters", lang)}</span>
              <FilterSelect label={tr(shell, "bu", lang)} value={filterBu} onChange={setFilterBu} options={[
                { value: "all", label: tr(shell, "allBus", lang) },
                ...BUSINESS_UNITS.map((b) => ({ value: b.id, label: tBi(b.name, lang) })),
              ]} testId="filter-bu" />
              <FilterSelect label={tr(shell, "typeLabel", lang)} value={filterType} onChange={setFilterType} options={[
                { value: "all", label: tr(shell, "allTypes", lang) },
                { value: "cost-out", label: tr(shell, "typeCostOut", lang) },
                { value: "revenue", label: tr(shell, "typeRevenue", lang) },
                { value: "risk", label: tr(shell, "typeRisk", lang) },
                { value: "experience", label: tr(shell, "typeExperience", lang) },
              ]} testId="filter-type" />
              <FilterSelect label={tr(shell, "statusLabel", lang)} value={filterStatus} onChange={setFilterStatus} options={[
                { value: "all", label: tr(shell, "allStatuses", lang) },
                { value: "idea", label: tr(shell, "statusIdea", lang) },
                { value: "pilot", label: tr(shell, "statusPilot", lang) },
                { value: "scaling", label: tr(shell, "statusScaling", lang) },
                { value: "in-production", label: tr(shell, "statusInProduction", lang) },
              ]} testId="filter-status" />
            </div>
          )}

          <div className="p-5">
            {view === "portfolio" && (
              <PortfolioView
                filterBu={filterBu}
                filterType={filterType}
                filterStatus={filterStatus}
                onSelectInitiative={goInitiative}
                onJumpApprovals={() => setView("approvals")}
                onJumpChase={() => setView("chase")}
              />
            )}
            {view === "initiative" && (
              <InitiativeDetailView
                initiativeId={pickedInitiative}
                onBack={() => setView("portfolio")}
                onSelectInitiative={goInitiative}
              />
            )}
            {view === "approvals" && <ApprovalsView onSelectInitiative={goInitiative} />}
            {view === "chase" && <ChaseQueueView onSelectInitiative={goInitiative} />}
            {view === "whatif" && <WhatIfView />}
            {view === "audit" && <AuditLogView onSelectInitiative={goInitiative} />}
          </div>
        </main>
      </div>

      {/* AI chat FAB */}
      <button
        onClick={() => setChatOpen(true)}
        className={`fixed bottom-6 ${lang === "ar" ? "left-6" : "right-6"} z-40 px-4 py-3 rounded-full text-white font-bold text-sm shadow-2xl flex items-center gap-2`}
        style={{ background: BRAND }}
        data-testid="button-ai-chat-open"
      >
        <Bot size={16} /> {tr(shell, "fabAskAi", lang)}
      </button>

      <AnimatePresence>
        {chatOpen && (
          <AiChat
            onClose={() => setChatOpen(false)}
            onNavigate={(v, initiativeId) => {
              if (v === "initiative" && initiativeId) goInitiative(initiativeId);
              else {
                if (initiativeId) setPickedInitiative(initiativeId);
                setView(v);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; testId: string;
}) {
  return (
    <label className="text-[11px] flex items-center gap-1.5">
      <span className="text-gray-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white"
        data-testid={testId}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
