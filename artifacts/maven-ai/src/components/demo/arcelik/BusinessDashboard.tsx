import { useState } from "react";
import { Link } from "wouter";
import { AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Radar, Megaphone, SlidersHorizontal,
  CalendarRange, Bot, Bell, LogOut, ChevronLeft, ChevronRight,
  X, Filter, Brain,
} from "lucide-react";
import Logo from "@/components/Logo";
import { DashboardProvider, useDashboardFilters, type Period } from "./DashboardContext";
import { cities, COMPETITOR_BRANDS, CATEGORY_LABELS, type ProductCategory } from "@/data/arcelik-seed";
import { generateAlerts } from "@/data/arcelik-agent";
import DashboardView from "./views/DashboardView";
import CompetitorRadarView from "./views/CompetitorRadarView";
import CampaignStudioView from "./views/CampaignStudioView";
import SimulatorView from "./views/SimulatorView";
import CalendarView from "./views/CalendarView";
import AgentDecisionsView from "./views/AgentDecisionsView";
import AiChat from "./AiChat";

type ViewId = "dashboard" | "radar" | "campaign" | "simulator" | "calendar" | "decisions";

const NAV_ITEMS: { id: ViewId; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "dashboard", label: "Gösterge Paneli", icon: LayoutDashboard },
  { id: "decisions", label: "Ajan Kararları", icon: Brain, badge: "AI" },
  { id: "radar", label: "Rakip Radarı", icon: Radar },
  { id: "campaign", label: "Kampanya Stüdyosu", icon: Megaphone },
  { id: "simulator", label: "Fiyat Simülatörü", icon: SlidersHorizontal },
  { id: "calendar", label: "Promosyon Takvimi", icon: CalendarRange },
];

const PERIOD_LABELS: Record<Period, string> = {
  "this-week": "Bu Hafta",
  "this-month": "Bu Ay",
  "3-months": "Son 3 Ay",
  "6-months": "Son 6 Ay",
};

function Shell() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { filters, update } = useDashboardFilters();

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
          <p className="text-xs font-semibold truncate">Fiyat İstihbarat Platformu</p>
        </div>
        <button
          onClick={() => setView("decisions")}
          className="relative p-2 hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Bildirimler"
        >
          <Bell size={16} />
          <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-[#E30613] text-[9px] font-bold flex items-center justify-center animate-pulse">
            {generateAlerts().filter((a) => a.severity === "critical" || a.severity === "high").length}
          </span>
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10">
          <div className="w-7 h-7 rounded-full bg-[#E30613] flex items-center justify-center text-[10px] font-bold">ED</div>
          <div className="hidden md:block text-xs">
            <div className="font-semibold leading-tight">Elif Demir</div>
            <div className="text-gray-400 text-[10px] leading-tight">Fiyatlandırma Direktörü</div>
          </div>
        </div>
        <Link
          href="/marketplace/arcelik-fiyat-istihbarati"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <LogOut size={14} />
          <span className="hidden md:inline">Çıkış</span>
        </Link>
      </header>

      <div className="flex-1 min-h-0 flex">
        <nav className={`flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 ${sidebarCollapsed ? "w-[52px]" : "w-52"}`}>
          <div className="flex-1 py-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                    active
                      ? "bg-[#E30613]/5 text-[#E30613] border-l-[3px] border-[#E30613]"
                      : "text-gray-500 hover:bg-gray-50 hover:text-[#0E2841] border-l-[3px] border-transparent"
                  }`}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon size={17} className="flex-shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
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
              title={sidebarCollapsed ? "AI Asistan" : undefined}
            >
              <Bot size={17} className="flex-shrink-0" />
              {!sidebarCollapsed && <span>AI Asistan</span>}
              {!sidebarCollapsed && (
                <span className="ml-auto text-[9px] font-bold bg-[#F5A623] text-white px-1.5 py-0.5 rounded-full">AI</span>
              )}
            </button>
          </div>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-3 border-t border-gray-100 text-gray-400 hover:text-gray-600 flex justify-center transition-colors"
            aria-label={sidebarCollapsed ? "Menüyü genişlet" : "Menüyü daralt"}
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
              Filtreler
            </button>
            <div className="h-4 w-px bg-gray-200" />
            {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
              <button
                key={p}
                onClick={() => update({ period: p })}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filters.period === p
                    ? "bg-[#E30613] text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
            {filters.cities.length > 0 && (
              <span className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                {filters.cities.length} şehir
                <button onClick={() => update({ cities: [] })} className="hover:text-blue-900" aria-label="Şehir filtresini temizle"><X size={10} /></button>
              </span>
            )}
            {filters.categories.length > 0 && (
              <span className="text-[11px] bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                {filters.categories.length} kategori
                <button onClick={() => update({ categories: [] })} className="hover:text-green-900" aria-label="Kategori filtresini temizle"><X size={10} /></button>
              </span>
            )}
            {filters.competitors.length > 0 && (
              <span className="text-[11px] bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                {filters.competitors.length} rakip
                <button onClick={() => update({ competitors: [] })} className="hover:text-orange-900" aria-label="Rakip filtresini temizle"><X size={10} /></button>
              </span>
            )}
          </div>

          {filtersOpen && (
            <div className="bg-white border-b border-gray-200 px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 mb-2 block uppercase tracking-wide">Şehir</label>
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
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 mb-2 block uppercase tracking-wide">Kategori</label>
                <div className="flex flex-wrap gap-1">
                  {(Object.entries(CATEGORY_LABELS) as [ProductCategory, string][]).map(([id, label]) => (
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
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 mb-2 block uppercase tracking-wide">Rakip</label>
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
      <Shell />
    </DashboardProvider>
  );
}
