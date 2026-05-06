import { useState } from "react";
import { useEkcLang, useEkcT } from "../DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { kpis as kpiDict } from "../knowledge-i18n";
import { BRAND, BRAND_INK } from "../tokens";
import ChatThread from "../ChatThread";
import SourceRail from "../SourceRail";
import { kpiVisibleCount, kpiTotalSources } from "@/data/enterprise-knowledge-agent";

interface Props {
  onNavigate?: (view: string) => void;
}

export default function ChatView({ onNavigate }: Props) {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const { personaId } = useEkcData();
  const [considered, setConsidered] = useState<string[]>([]);
  const [cited, setCited] = useState<string[]>([]);

  const total = kpiTotalSources();
  const visibleNow = kpiVisibleCount(personaId);

  const tiles: { label: string; sub: string; value: string; valueColor?: string }[] = [
    { label: t("visibleSources", kpiDict), sub: t("visibleSourcesSub", kpiDict), value: `${visibleNow} / ${total}`, valueColor: BRAND },
    { label: t("groundedRate", kpiDict), sub: t("groundedRateSub", kpiDict), value: "96%", valueColor: "#10B981" },
    { label: t("refusalRate", kpiDict), sub: t("refusalRateSub", kpiDict), value: "100%", valueColor: "#10B981" },
    { label: t("ttv", kpiDict), sub: t("ttvSub", kpiDict), value: "3.4 s", valueColor: BRAND_INK },
    { label: t("leaks", kpiDict), sub: t("leaksSub", kpiDict), value: "0", valueColor: "#10B981" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
      {/* KPI strip */}
      <div className="flex-shrink-0 px-6 py-3 grid grid-cols-2 md:grid-cols-5 gap-2.5 bg-white border-b border-gray-200">
        {tiles.map((tile, i) => (
          <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">{tile.label}</p>
            <p className="text-[18px] font-extrabold leading-tight" style={{ color: tile.valueColor ?? BRAND_INK }}>{tile.value}</p>
            <p className="text-[10px] text-gray-500 truncate">{tile.sub}</p>
          </div>
        ))}
      </div>

      {/* Chat + rail */}
      <div className="flex-1 flex min-h-0">
        <ChatThread
          onConsideredChange={(c, ci) => { setConsidered(c); setCited(ci); }}
          onNavigate={onNavigate}
        />
        <SourceRail consideredSourceIds={considered} citedSourceIds={cited} />
      </div>
    </div>
  );
}
