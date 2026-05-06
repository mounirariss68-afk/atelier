import { useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, Target, ClipboardCheck, ListChecks, Sparkles,
  ScrollText, Bot, ChevronLeft, ChevronRight, Filter, LogOut,
} from "lucide-react";
import { ValueRealizationDataProvider } from "@/hooks/useValueRealizationData";
import { DemoLangProvider, useDemoLang, tBi } from "./DemoLangContext";
import { shell, t as tr } from "./value-realization-i18n";
import { generateAlerts, generateRecommendations } from "@/data/value-realization-agent";
import { PERSONA, BUSINESS_UNITS } from "@/data/value-realization-seed";
import { BRAND, NAVY, CANVAS } from "./tokens";
import DemoTopBar from "../DemoTopBar";
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

  const alerts = generateAlerts();
  const pendingRecs = generateRecommendations().filter((r) => r.status === "pending").length;
  const urgentAlerts = alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;

  const goInitiative = (id: string) => {
    setPickedInitiative(id);
    setView("initiative");
  };

  return (
    <div dir={dir} className="h-screen flex flex-col" style={{ background: CANVAS, color: NAVY }} data-testid="benefits-cockpit">
      <DemoTopBar
        marketplaceSlug={marketplaceSlug}
        accent={BRAND}
        brandTag={tr(shell, "brandTag", lang)}
        platformTitle={tr(shell, "platformTitle", lang)}
        backLabel={tr(shell, "back", lang)}
        lang={lang}
        setLang={setLang}

        persona={{
          initials: PERSONA.initials,
          name: tBi(PERSONA.name, lang),
          title: tBi(PERSONA.title, lang),
        }}
        actionButton={
          <button
            onClick={() => setView("approvals")}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-white"
            style={{ background: BRAND }}
            data-testid="button-pending-approvals"
          >
            {pendingRecs} {tr(shell, "pendingApprovals", lang)}
          </button>
        }
        notifications={{
          panelTitle: tr(shell, "notifications", lang),
          urgentLabel: tr(shell, "urgent", lang),
          unreadCount: urgentAlerts,
          items: alerts.map((a) => ({
            id: a.id,
            severity: a.severity,
            title: tBi(a.title, lang),
            detail: tBi(a.detail, lang),
            onClick: () => {
              if (a.navTarget === "initiative" && a.initiativeId) goInitiative(a.initiativeId);
              else if (a.navTarget === "approvals") setView("approvals");
              else if (a.navTarget === "chase") setView("chase");
              else if (a.navTarget === "audit") setView("audit");
              else setView("portfolio");
            },
          })),
        }}
        onSwitchView={onSwitchView}
        switchViewLabel={tr(shell, "switchView", lang)}
      />

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
