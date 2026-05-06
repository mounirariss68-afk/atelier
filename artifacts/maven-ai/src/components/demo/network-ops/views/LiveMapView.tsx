import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, ShieldAlert, Users, Inbox, Map as MapIcon, TrendingUp } from "lucide-react";
import GccMap from "../GccMap";
import { useNocDemoLang, useNocDemoT } from "../DemoLangContext";
import { liveMap, shell } from "../noc-i18n";
import { INCIDENTS, SERVICES, computeKpis, siteById, type Incident } from "@/data/network-ops-seed";
import { BRAND, SEV_BG } from "../tokens";

const STATUS_COLOR: Record<string, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-red-500",
};

export default function LiveMapView({ onOpenIncident }: { onOpenIncident?: (id: string) => void }) {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";
  const k = useMemo(() => computeKpis(), []);
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>();
  const [hoverIncidentId, setHoverIncidentId] = useState<string | undefined>();
  const open = INCIDENTS.filter((i) => i.status !== "resolved");
  const selectedSite = selectedSiteId ? siteById(selectedSiteId) : undefined;

  // Customer-impact ticker: animate the headline impact number with a small live wobble
  const baseImpact = k.customersImpacted;
  const [tickerVal, setTickerVal] = useState(baseImpact);
  useEffect(() => {
    setTickerVal(baseImpact);
    const id = setInterval(() => {
      const wobble = Math.floor(Math.random() * 90) - 30; // small drift
      setTickerVal(baseImpact + wobble);
    }, 1500);
    return () => clearInterval(id);
  }, [baseImpact]);

  const highlightSiteIds = hoverIncidentId
    ? INCIDENTS.find((i) => i.id === hoverIncidentId)?.affectedSiteIds ?? []
    : [];

  const KPI_TILES = [
    { label: t("kpiP1", liveMap), value: k.p1, sub: t("kpiP2", liveMap) + ` ${k.p2} · ` + t("kpiP3", liveMap) + ` ${k.p3}`, icon: <AlertTriangle size={16} />, accent: "#D9534F" },
    { label: t("kpiMttr", liveMap), value: `${k.mttrMin} min`, sub: `${k.mttrDeltaPct}% ${isAr ? "مقارنة بالسابق" : "vs prior"}`, icon: <Clock size={16} />, accent: BRAND },
    { label: t("kpiSla", liveMap), value: k.slaAtRisk, sub: `${isAr ? "من" : "of"} 4`, icon: <ShieldAlert size={16} />, accent: "#F5A623" },
    { label: t("kpiCustomers", liveMap), value: k.customersImpacted.toLocaleString(isAr ? "ar-SA" : "en-US"), sub: t("impacted", liveMap), icon: <Users size={16} />, accent: BRAND },
    { label: t("kpiDecisions", liveMap), value: k.decisionsWaiting, sub: isAr ? "في قائمة الموافقات" : "in approvals", icon: <Inbox size={16} />, accent: "#5BA98A" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <MapIcon size={20} style={{ color: BRAND }} />
          {t("title", liveMap)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", liveMap)}</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {KPI_TILES.map((tile, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{tile.label}</p>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white" style={{ background: tile.accent }}>
                {tile.icon}
              </div>
            </div>
            <p className="text-2xl font-extrabold text-gray-900">{tile.value}</p>
            <p className="text-[11px] text-gray-500 mt-1">{tile.sub}</p>
          </div>
        ))}
      </div>

      {/* Map + incident list */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 min-h-[440px]">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold text-gray-500">
              {(["ok", "degraded", "down"] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[s]}`} />
                  {t(`legend${s.charAt(0).toUpperCase() + s.slice(1)}`, liveMap)}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-300" />{t("legendCore", liveMap)}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300" />{t("legendAggregation", liveMap)}</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" />{t("legendEdge", liveMap)}</span>
            </div>
          </div>
          <div className="h-[360px]">
            <GccMap
              selectedSiteId={selectedSiteId}
              onSelectSite={setSelectedSiteId}
              highlightedSiteIds={highlightSiteIds}
              isAr={isAr}
            />
          </div>

          {/* Service health rail */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2 flex items-center gap-1.5">
              <ShieldAlert size={11} style={{ color: BRAND }} />
              {t("serviceRail", liveMap)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SERVICES.map((s) => {
                const pct = Math.max(0, Math.min(100, ((s.currentPct - 99) / (100 - 99)) * 100));
                const barColor = s.status === "breached" ? "#D9534F" : s.status === "at-risk" ? "#F5A623" : "#5BA98A";
                return (
                  <div key={s.id} className="rounded-lg border border-gray-100 p-2 bg-gray-50/40">
                    <p className="text-[10px] font-bold text-gray-900 leading-snug truncate">{isAr ? s.name.ar : s.name.en}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                        <div className="h-full" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: barColor }}>
                        {s.currentPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col">
          {/* Customer-impact ticker */}
          <div className="rounded-xl p-3 mb-3" style={{ background: `${BRAND}10`, border: `1px solid ${BRAND}30` }}>
            <p className="text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5" style={{ color: BRAND }}>
              <TrendingUp size={11} />
              {t("impactTicker", liveMap)}
            </p>
            <p className="text-2xl font-extrabold text-gray-900 tabular-nums mt-1 transition-all">
              {tickerVal.toLocaleString(isAr ? "ar-SA" : "en-US")}
            </p>
            <p className="text-[10px] text-gray-500">{t("impactTickerSub", liveMap)}</p>
          </div>

          <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3">{t("incidentBoard", liveMap)}</p>
          <div className="space-y-2 flex-1 overflow-auto">
            {open.map((inc) => (
              <IncidentRow
                key={inc.id}
                inc={inc}
                isAr={isAr}
                onHover={setHoverIncidentId}
                onClick={() => onOpenIncident?.(inc.id)}
                t={t}
              />
            ))}
          </div>
          {selectedSite && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t("siteSummary", liveMap)}</p>
              <p className="text-sm font-bold text-gray-900 mt-1">{isAr ? selectedSite.name.ar : selectedSite.name.en}</p>
              <p className="text-[11px] text-gray-500">
                {isAr ? selectedSite.city.ar : selectedSite.city.en} · {selectedSite.type}
              </p>
              <p className="text-[11px] text-gray-700 mt-1">
                {selectedSite.customers.toLocaleString(isAr ? "ar-SA" : "en-US")} {t("customers", liveMap)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IncidentRow({ inc, isAr, onHover, onClick, t }: { inc: Incident; isAr: boolean; onHover: (id?: string) => void; onClick: () => void; t: (k: string, d: typeof shell) => string }) {
  return (
    <button
      onMouseEnter={() => onHover(inc.id)}
      onMouseLeave={() => onHover(undefined)}
      onClick={onClick}
      className="w-full text-start p-3 rounded-xl border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${SEV_BG[inc.severity]}`}>
          {t(`sev${inc.severity.toUpperCase()}`, shell)}
        </span>
        <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">
          {t(`status${inc.status.charAt(0).toUpperCase() + inc.status.slice(1)}`, shell)}
        </span>
        <span className="text-[9px] text-gray-400 ms-auto">{inc.id}</span>
      </div>
      <p className="text-xs font-bold text-gray-900 leading-snug">{isAr ? inc.title.ar : inc.title.en}</p>
      <p className="text-[10px] text-gray-500 mt-1">
        <Activity size={9} className="inline-block me-1" />
        {inc.affectedCustomers.toLocaleString(isAr ? "ar-SA" : "en-US")} {isAr ? "عميل" : "customers"}
      </p>
    </button>
  );
}
