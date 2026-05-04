import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, Radar, Megaphone, SlidersHorizontal,
  CalendarRange, Bot, Bell, LogOut, ChevronLeft, ChevronRight,
  X, Filter, Brain, AlertTriangle, GitCompareArrows, Crosshair,
  ArrowLeftRight,
} from "lucide-react";
import Logo from "@/components/Logo";
import { DashboardProvider, useDashboardFilters, type Period } from "./DashboardContext";
import { COMPETITOR_BRANDS, CATEGORY_LABELS, getCategoryLabel, getCityName, type ProductCategory } from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";
import { generateAlerts, type AgentAlert, type Severity } from "@/data/arcelik-agent";
import { DemoLangProvider, useDemoLang } from "./DemoLangContext";
import { shell } from "./demo-i18n";
import DashboardView from "./views/DashboardView";
import CompetitorRadarView from "./views/CompetitorRadarView";
import CampaignStudioView from "./views/CampaignStudioView";
import SimulatorView from "./views/SimulatorView";
import CalendarView from "./views/CalendarView";
import AgentDecisionsView from "./views/AgentDecisionsView";
import ProductComparisonView from "./views/ProductComparisonView";
import WhitespaceView from "./views/WhitespaceView";
import AiChat from "./AiChat";

type ViewId = "dashboard" | "radar" | "campaign" | "simulator" | "calendar" | "decisions" | "comparison" | "whitespace";

const NAV_ITEMS: { id: ViewId; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "decisions", icon: Brain, badge: "AI" },
  { id: "comparison", icon: GitCompareArrows },
  { id: "whitespace", icon: Crosshair, badge: "NEW" },
  { id: "radar", icon: Radar },
  { id: "campaign", icon: Megaphone },
  { id: "simulator", icon: SlidersHorizontal },
  { id: "calendar", icon: CalendarRange },
];

const NAV_LABEL_KEYS: Record<ViewId, string> = {
  dashboard: "navDashboard",
  decisions: "navDecisions",
  comparison: "navComparison",
  whitespace: "navWhitespace",
  radar: "navRadar",
  campaign: "navCampaign",
  simulator: "navSimulator",
  calendar: "navCalendar",
};

const PERIOD_LABEL_KEYS: Record<Period, string> = {
  "this-week": "periodThisWeek",
  "this-month": "periodThisMonth",
  "3-months": "period3Months",
  "6-months": "period6Months",
};

function Shell() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const { filters, update } = useDashboardFilters();
  const { lang, setLang } = useDemoLang();
  const t = shell[lang];
  const { cities } = useArcelikData();

  const agentAlerts = useMemo(() => generateAlerts(), []);
  const critHighAlerts = agentAlerts.filter((a) => a.severity === "critical" || a.severity === "high");

  const SEV_DOT: Record<Severity, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-gray-400" };
  const SEV_LABEL: Record<Severity, string> = { critical: t.sevCritical, high: t.sevHigh, medium: t.sevMedium, low: t.sevLow };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[#F4F6F8] text-[#0E2841]">
      <header className="flex-shrink-0 h-14 bg-[#0E2841] text-white flex items-center px-4 gap-3 z-20">
        <Link href="/marketplace/arcelik-fiyat-istihbarati" className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <ChevronLeft size={14} />
        </Link>
        <Logo className="h-5 w-auto text-white" />
        <div className="h-5 w-px bg-white/20" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#E30613]">Arçelik</p>
          <p className="text-xs font-semibold truncate">{t.platformTitle}</p>
        </div>
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label={t.notifications}
          >
            <Bell size={16} />
            <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-[#E30613] text-[9px] font-bold flex items-center justify-center animate-pulse">
              {critHighAlerts.length}
            </span>
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0E2841] flex items-center gap-1.5"><AlertTriangle size={14} className="text-[#E30613]" /> {t.agentAlerts}</h3>
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{critHighAlerts.length} {t.urgent}</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {agentAlerts.slice(0, 6).map((alert) => (
                    <button
                      key={alert.id}
                      onClick={() => { setView("decisions"); setNotifOpen(false); }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[alert.severity]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              alert.severity === "critical" ? "bg-red-100 text-red-700" : alert.severity === "high" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"
                            }`}>{SEV_LABEL[alert.severity]}</span>
                            <span className="text-[9px] text-gray-400 ml-auto">{alert.category}</span>
                          </div>
                          <p className="text-xs font-semibold text-[#0E2841] truncate">{alert.title}</p>
                          <p className="text-[11px] text-gray-500 truncate">{alert.detail}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setView("decisions"); setNotifOpen(false); }}
                  className="w-full px-4 py-2.5 text-center text-xs font-bold text-[#E30613] hover:bg-red-50 transition-colors border-t border-gray-100"
                >
                  {t.seeAllAlerts}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10">
          <div className="w-7 h-7 rounded-full bg-[#E30613] flex items-center justify-center text-[10px] font-bold">ED</div>
          <div className="hidden md:block text-xs">
            <div className="font-semibold leading-tight">Elif Demir</div>
            <div className="text-gray-400 text-[10px] leading-tight">{t.pricingDirector}</div>
          </div>
        </div>
        <div className="flex items-center bg-white/10 rounded-full p-0.5">
          <button onClick={() => setLang("tr")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === "tr" ? "bg-white text-[#0E2841]" : "text-white/60 hover:text-white"}`}>TR</button>
          <button onClick={() => setLang("en")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === "en" ? "bg-white text-[#0E2841]" : "text-white/60 hover:text-white"}`}>EN</button>
        </div>
        <Link
          href="/demo/arcelik-fiyat-istihbarati/bayi"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
          title={t.switchToDealer}
        >
          <ArrowLeftRight size={14} />
          <span className="hidden md:inline">{t.switchToDealer}</span>
        </Link>
        <Link
          href="/marketplace/arcelik-fiyat-istihbarati"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <LogOut size={14} />
          <span className="hidden md:inline">{t.logout}</span>
        </Link>
      </header>

      <div className="flex-1 min-h-0 flex">
        <nav className={`flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 ${sidebarCollapsed ? "w-[52px]" : "w-52"}`}>
          <div className="flex-1 py-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              const label = t[NAV_LABEL_KEYS[item.id]];
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                    active
                      ? "bg-[#E30613]/5 text-[#E30613] border-l-[3px] border-[#E30613]"
                      : "text-gray-500 hover:bg-gray-50 hover:text-[#0E2841] border-l-[3px] border-transparent"
                  }`}
                  title={sidebarCollapsed ? label : undefined}
                >
                  <Icon size={17} className="flex-shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{label}</span>}
                  {!sidebarCollapsed && item.badge && (
                    <span className="ml-auto text-[9px] font-bold bg-[#E30613] text-white px-1.5 py-0.5 rounded-full">{item.badge}</span>
                  )}
                </button>
              );
            })}
            <div className="h-px bg-gray-100 mx-3 my-2" />
            <button
              onClick={() => setChatOpen(true)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium transition-colors border-l-[3px] border-transparent ${
                chatOpen ? "text-[#F5A623] bg-[#F5A623]/5" : "text-gray-500 hover:bg-gray-50 hover:text-[#0E2841]"
              }`}
              title={sidebarCollapsed ? t.aiAssistant : undefined}
            >
              <Bot size={17} className="flex-shrink-0" />
              {!sidebarCollapsed && <span>{t.aiAssistant}</span>}
              {!sidebarCollapsed && (
                <span className="ml-auto text-[9px] font-bold bg-[#F5A623] text-white px-1.5 py-0.5 rounded-full">AI</span>
              )}
            </button>
          </div>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-3 border-t border-gray-100 text-gray-400 hover:text-gray-600 flex justify-center transition-colors"
            aria-label={sidebarCollapsed ? t.expandMenu : t.collapseMenu}
          >
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-200 px-5 py-2.5 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                filtersOpen ? "bg-[#0E2841] text-white" : "text-gray-500 hover:text-[#0E2841] hover:bg-gray-100"
              }`}
            >
              <Filter size={13} />
              {t.filters}
            </button>
            <div className="h-4 w-px bg-gray-200" />
            {(Object.keys(PERIOD_LABEL_KEYS) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => update({ period: p })}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filters.period === p
                    ? "bg-[#E30613] text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t[PERIOD_LABEL_KEYS[p]]}
              </button>
            ))}
            {filters.cities.length > 0 && (
              <span className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                {filters.cities.length} {t.cityCount}
                <button onClick={() => update({ cities: [] })} className="hover:text-blue-900" aria-label={t.clearCityFilter}><X size={10} /></button>
              </span>
            )}
            {filters.categories.length > 0 && (
              <span className="text-[11px] bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                {filters.categories.length} {t.categoryCount}
                <button onClick={() => update({ categories: [] })} className="hover:text-green-900" aria-label={t.clearCategoryFilter}><X size={10} /></button>
              </span>
            )}
            {filters.competitors.length > 0 && (
              <span className="text-[11px] bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                {filters.competitors.length} {t.competitorCount}
                <button onClick={() => update({ competitors: [] })} className="hover:text-orange-900" aria-label={t.clearCompetitorFilter}><X size={10} /></button>
              </span>
            )}
          </div>

          {filtersOpen && (
            <div className="bg-white border-b border-gray-200 px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 mb-2 block uppercase tracking-wide">{t.cityLabel}</label>
                <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                  {cities.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        const next = filters.cities.includes(c.id)
                          ? filters.cities.filter((x) => x !== c.id)
                          : [...filters.cities, c.id];
                        update({ cities: next });
                      }}
                      className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                        filters.cities.includes(c.id)
                          ? "bg-blue-500 text-white border-blue-500"
                          : "border-gray-200 text-gray-600 hover:border-blue-300"
                      }`}
                    >
                      {getCityName(c, lang)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 mb-2 block uppercase tracking-wide">{t.categoryLabel}</label>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((id) => (
                    <button
                      key={id}
                      onClick={() => {
                        const next = filters.categories.includes(id)
                          ? filters.categories.filter((x) => x !== id)
                          : [...filters.categories, id];
                        update({ categories: next });
                      }}
                      className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                        filters.categories.includes(id)
                          ? "bg-green-500 text-white border-green-500"
                          : "border-gray-200 text-gray-600 hover:border-green-300"
                      }`}
                    >
                      {getCategoryLabel(id, lang)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 mb-2 block uppercase tracking-wide">{t.competitorLabel}</label>
                <div className="flex flex-wrap gap-1">
                  {COMPETITOR_BRANDS.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        const next = filters.competitors.includes(b.id)
                          ? filters.competitors.filter((x) => x !== b.id)
                          : [...filters.competitors, b.id];
                        update({ competitors: next });
                      }}
                      className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                        filters.competitors.includes(b.id)
                          ? "bg-orange-500 text-white border-orange-500"
                          : "border-gray-200 text-gray-600 hover:border-orange-300"
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="p-5">
            {view === "dashboard" && <DashboardView />}
            {view === "decisions" && <AgentDecisionsView />}
            {view === "comparison" && <ProductComparisonView />}
            {view === "whitespace" && <WhitespaceView />}
            {view === "radar" && <CompetitorRadarView />}
            {view === "campaign" && <CampaignStudioView />}
            {view === "simulator" && <SimulatorView />}
            {view === "calendar" && <CalendarView />}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default function BusinessDashboard() {
  return (
    <DashboardProvider>
      <DemoLangProvider>
        <Shell />
      </DemoLangProvider>
    </DashboardProvider>
  );
}
