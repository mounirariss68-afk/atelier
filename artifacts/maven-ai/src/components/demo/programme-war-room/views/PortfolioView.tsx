import { useMemo, useState } from "react";
import { AlertTriangle, TrendingDown, Wallet, FileSignature, Users, ArrowRight, Filter } from "lucide-react";
import { usePwrLang, usePwrT } from "../DemoLangContext";
import { portfolio, shell, approvals as approvalsDict } from "../programme-i18n";
import { usePwrData } from "@/hooks/useProgrammeWarRoomData";
import { getKpis, generateCascades, ragColor } from "@/data/programme-war-room-agent";
import { fmtAed, type Rag } from "@/data/programme-war-room-seed";
import { BRAND, BRAND_INK } from "../tokens";
import { useToast } from "@/hooks/use-toast";
import type { RecStatus } from "@/data/programme-war-room-agent";

interface Props {
  onOpenProgramme: (id: string) => void;
  onOpenView: (view: string) => void;
}

export default function PortfolioView({ onOpenProgramme, onOpenView }: Props) {
  const { lang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const { programmes, recommendations, setRecommendationStatus } = usePwrData();
  const { toast } = useToast();
  const act = (id: string, status: RecStatus) => {
    setRecommendationStatus(id, status);
    const titleKey = status === "approved" ? "toastApprovedTitle" : status === "edited" ? "toastEditedTitle" : "toastRejectedTitle";
    const descKey = status === "approved" ? "toastApprovedDesc" : status === "edited" ? "toastEditedDesc" : "toastRejectedDesc";
    toast({ title: t(titleKey, approvalsDict), description: t(descKey, approvalsDict) });
  };
  const kpis = useMemo(() => getKpis(), []);
  const cascades = useMemo(() => generateCascades(), []);
  const [ragFilter, setRagFilter] = useState<Rag | "all">("all");

  const visible = ragFilter === "all" ? programmes : programmes.filter((p) => p.rag === ragFilter);
  const pendingRecs = recommendations.filter((r) => r.status === "pending").slice(0, 5);

  const burnedPct = Math.round((kpis.burned / kpis.envelope) * 100);

  const tiles = [
    { icon: <AlertTriangle size={16} />, label: t("kpiAtRisk", portfolio), value: String(kpis.atRisk), sub: t("kpiAtRiskSub", portfolio), tone: "#E30613" },
    { icon: <TrendingDown size={16} />, label: t("kpiSlipDays", portfolio), value: String(kpis.totalSlip), sub: t("kpiSlipDaysSub", portfolio), tone: "#F59E0B" },
    { icon: <Wallet size={16} />, label: t("kpiContingency", portfolio), value: `${burnedPct}%`, sub: t("kpiContingencySub", portfolio), tone: BRAND },
    { icon: <Users size={16} />, label: t("kpiDecisions", portfolio), value: String(kpis.decisions), sub: t("kpiDecisionsSub", portfolio), tone: BRAND_INK },
    { icon: <FileSignature size={16} />, label: t("kpiMemos", portfolio), value: String(kpis.memos), sub: t("kpiMemosSub", portfolio), tone: "#10B981" },
  ];

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", portfolio)}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", portfolio)}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Filter size={14} className="text-gray-500" />
          <span className="text-gray-500">{t("ragLabel", shell)}:</span>
          {(["all", "red", "amber", "green"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRagFilter(r)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
                ragFilter === r ? "text-white" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
              style={ragFilter === r ? { background: BRAND_INK, borderColor: BRAND_INK } : undefined}
            >
              {r === "all" ? t("allRag", shell) : r === "red" ? t("ragRed", shell) : r === "amber" ? t("ragAmber", shell) : t("ragGreen", shell)}
            </button>
          ))}
        </div>
      </header>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map((tile, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white" style={{ background: tile.tone }}>
                {tile.icon}
              </div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{tile.label}</p>
            </div>
            <p className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{tile.value}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{tile.sub}</p>
          </div>
        ))}
      </div>

      {/* Hero widget 1 — Heatmap */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("heatmapTitle", portfolio)}</h2>
            <p className="text-xs text-gray-500">{t("heatmapSub", portfolio)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpenProgramme(p.id)}
              className="text-start bg-gray-50 hover:bg-white border border-gray-200 hover:border-gray-300 rounded-xl p-3 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: ragColor(p.rag) }} />
                {p.weeklySlipDelta > 0 && (
                  <span className="text-[10px] font-bold text-red-600">+{p.weeklySlipDelta}d</span>
                )}
              </div>
              <p className="text-[12px] font-bold leading-tight" style={{ color: BRAND_INK }}>{p.name[lang]}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{p.sponsor[lang]}</p>
              <div className="mt-2 flex items-center gap-1">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full" style={{ width: `${p.pctComplete}%`, background: ragColor(p.rag) }} />
                </div>
                <span className="text-[10px] text-gray-500 font-semibold">{p.pctComplete}%</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-500">
                <span>{p.slipDays > 0 ? `${p.slipDays}d ${t("cardSlip", portfolio)}` : "—"}</span>
                <span>{fmtAed(p.budgetAed, lang)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Hero widget 2 — Cascades */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-end justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("cascadeTitle", portfolio)}</h2>
          <p className="text-xs text-gray-500">{t("cascadeSub", portfolio)}</p>
        </div>
        <div className="space-y-3">
          {cascades.map((c) => (
            <div key={c.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{c.source[lang]}</p>
                <button
                  onClick={() => onOpenProgramme(c.sourceId)}
                  className="ms-auto text-[10px] text-gray-500 hover:text-[color:var(--brand)] flex items-center gap-1"
                  style={{ ["--brand" as never]: BRAND }}
                >
                  {t("open", portfolio)} <ArrowRight size={10} className="rtl:rotate-180" />
                </button>
              </div>
              <div className="flex flex-col md:flex-row gap-2">
                {c.downstream.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onOpenProgramme(d.id)}
                    className="flex-1 text-start bg-white border border-gray-200 hover:border-gray-300 rounded-lg p-2.5"
                  >
                    <p className="text-[11px] font-bold" style={{ color: BRAND_INK }}>{d.name[lang]}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{d.hitDate}</p>
                    <p className="text-[10px] text-gray-700 mt-1 leading-snug">{d.impact[lang]}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Hero widget 3 — Decision queue */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("decisionQueueTitle", portfolio)}</h2>
            <p className="text-xs text-gray-500">{t("decisionQueueSub", portfolio)}</p>
          </div>
          <button onClick={() => onOpenView("approvals")} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: BRAND }}>
            {t("seeAllAlerts", shell)}
          </button>
        </div>
        <div className="space-y-2">
          {pendingRecs.map((r) => (
            <div key={r.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{r.title[lang]}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{r.rationale[lang]}</p>
                  <p className="text-[10px] text-gray-500 mt-1">{r.confidence}% {t("confidence", portfolio)}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => act(r.id, "approved")} className="px-2.5 py-1 text-[10px] font-bold text-white rounded-lg" style={{ background: BRAND }}>{t("approve", portfolio)}</button>
                  <button onClick={() => act(r.id, "edited")} className="px-2.5 py-1 text-[10px] font-bold text-gray-700 bg-white border border-gray-200 rounded-lg">{t("edit", portfolio)}</button>
                  <button onClick={() => act(r.id, "rejected")} className="px-2.5 py-1 text-[10px] font-bold text-gray-500 hover:text-gray-700">{t("dismiss", portfolio)}</button>
                </div>
              </div>
            </div>
          ))}
          {pendingRecs.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">—</p>
          )}
        </div>
      </section>
    </div>
  );
}
