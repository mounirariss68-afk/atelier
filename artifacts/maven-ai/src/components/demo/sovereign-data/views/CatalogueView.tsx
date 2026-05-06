import { useMemo, useState } from "react";
import { Database, ClipboardCheck, Activity, ShieldCheck, Ban, Filter, ArrowRight, Sparkles } from "lucide-react";
import { useSdsLang, useSdsT } from "../DemoLangContext";
import { catalogue, shell, approvals as approvalsDict } from "../sovereign-i18n";
import { useSdsData } from "@/hooks/useSovereignDataData";
import { getKpis } from "@/data/sovereign-data-agent";
import { classificationColor, statusColor, fmtFreshness, type Classification, type ProductStatus } from "@/data/sovereign-data-seed";
import { BRAND, BRAND_INK } from "../tokens";
import { useToast } from "@/hooks/use-toast";
import type { RecStatus } from "@/data/sovereign-data-agent";

interface Props {
  onOpenProduct: (id: string) => void;
  onOpenView: (view: string) => void;
}

export default function CatalogueView({ onOpenProduct, onOpenView }: Props) {
  const { lang } = useSdsLang();
  const t = useSdsT();
  const isAr = lang === "ar";
  const { products, recommendations, setRecommendationStatus } = useSdsData();
  const { toast } = useToast();

  const [classFilter, setClassFilter] = useState<Classification | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ProductStatus | "all">("all");

  const kpis = useMemo(() => getKpis(), []);

  const visible = products.filter(
    (p) =>
      (classFilter === "all" || p.classification === classFilter) &&
      (statusFilter === "all" || p.status === statusFilter),
  );
  const pendingRecs = recommendations.filter((r) => r.status === "pending").slice(0, 5);

  const act = (id: string, status: RecStatus) => {
    setRecommendationStatus(id, status);
    const titleKey = status === "approved" ? "toastApprovedTitle" : status === "edited" ? "toastEditedTitle" : "toastRejectedTitle";
    const descKey = status === "approved" ? "toastApprovedDesc" : status === "edited" ? "toastEditedDesc" : "toastRejectedDesc";
    toast({ title: t(titleKey, approvalsDict), description: t(descKey, approvalsDict) });
  };

  const tiles = [
    { icon: <Database size={16} />, label: t("kpiActive", catalogue), value: String(kpis.active), sub: t("kpiActiveSub", catalogue), tone: BRAND },
    { icon: <ClipboardCheck size={16} />, label: t("kpiPending", catalogue), value: String(kpis.pending), sub: t("kpiPendingSub", catalogue), tone: "#F59E0B" },
    { icon: <Activity size={16} />, label: t("kpiLineage", catalogue), value: `${kpis.lineageAvg}%`, sub: t("kpiLineageSub", catalogue), tone: "#156082" },
    { icon: <ShieldCheck size={16} />, label: t("kpiPdpl", catalogue), value: `${kpis.pdplPass}/${kpis.pdplTotal}`, sub: t("kpiPdplSub", catalogue), tone: "#196B24" },
    { icon: <Ban size={16} />, label: t("kpiBlocked", catalogue), value: String(kpis.blockedSinks), sub: t("kpiBlockedSub", catalogue), tone: "#D9534F" },
  ];

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", catalogue)}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", catalogue)}</p>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <Filter size={14} className="text-gray-500" />
          <div className="flex items-center gap-1">
            <span className="text-gray-500">{t("filterClassification", catalogue)}:</span>
            {(["all", "public", "internal", "sensitive", "restricted"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setClassFilter(c)}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${classFilter === c ? "text-white" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
                style={classFilter === c ? { background: BRAND_INK, borderColor: BRAND_INK } : undefined}
              >
                {c === "all" ? t("all", shell) : t(`class${c.charAt(0).toUpperCase()}${c.slice(1)}`, catalogue)}
              </button>
            ))}
          </div>
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

      {/* Hero 1 — Catalogue heatmap */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("heroCatalogueTitle", catalogue)}</h2>
            <p className="text-xs text-gray-500">{t("heroCatalogueSub", catalogue)}</p>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500">{t("filterStatus", catalogue)}:</span>
            {(["all", "active", "pending", "draft", "blocked", "deprecated"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusFilter === s ? "text-white" : "bg-white text-gray-600 border-gray-200"}`}
                style={statusFilter === s ? { background: BRAND_INK, borderColor: BRAND_INK } : undefined}
              >
                {s === "all" ? t("all", shell) : t(`status${s.charAt(0).toUpperCase()}${s.slice(1)}`, catalogue)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpenProduct(p.id)}
              className={`relative text-start bg-gray-50 hover:bg-white border rounded-xl p-3 transition-colors ${p.isScenarioActive ? "border-[color:var(--brand)] ring-2 ring-[color:var(--brand)]/20" : "border-gray-200 hover:border-gray-300"}`}
              style={{ ["--brand" as never]: BRAND }}
            >
              {p.isScenarioActive && (
                <span className="absolute -top-1 -end-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full text-white animate-pulse" style={{ background: BRAND }}>
                  <Sparkles size={9} className="inline -mt-0.5" /> LIVE
                </span>
              )}
              <div className="flex items-center justify-between mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: statusColor(p.status) }} />
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: classificationColor(p.classification) }}>
                  {t(`class${p.classification.charAt(0).toUpperCase()}${p.classification.slice(1)}`, catalogue)}
                </span>
              </div>
              <p className="text-[12px] font-bold leading-tight" style={{ color: BRAND_INK }}>{p.name[lang]}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{p.ownerOrg[lang]}</p>
              <div className="mt-2 flex items-center gap-1">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full" style={{ width: `${p.lineageCoverage}%`, background: BRAND }} />
                </div>
                <span className="text-[10px] text-gray-500 font-semibold">{p.lineageCoverage}%</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-500">
                <span>{fmtFreshness(p.freshnessMin, lang)}</span>
                <span>{p.pdplPass}/{p.pdplTotal} PDPL</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Hero 2 — Active pipeline runs */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("heroPipelineTitle", catalogue)}</h2>
            <p className="text-xs text-gray-500">{t("heroPipelineSub", catalogue)}</p>
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{lang === "ar" ? "لوحة مشاعر المواطنين" : "Citizen Sentiment Dashboard"}</p>
            <span className="text-[10px] text-gray-500">· {lang === "ar" ? "اكتمل 11:54" : "complete 11:54"}</span>
            <button
              onClick={() => onOpenProduct("citizen-sentiment-dashboard")}
              className="ms-auto text-[10px] font-semibold flex items-center gap-1"
              style={{ color: BRAND }}
            >
              {t("open", catalogue)} <ArrowRight size={10} className="rtl:rotate-180" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-1.5">
            {[
              { n: 1, label: lang === "ar" ? "تحليل" : "Profile" },
              { n: 2, label: lang === "ar" ? "كيانات" : "NER" },
              { n: 3, label: lang === "ar" ? "مخطط" : "DAG" },
              { n: 4, label: lang === "ar" ? "نسب" : "Lineage" },
              { n: 5, label: lang === "ar" ? "عقد" : "Contract" },
              { n: 6, label: lang === "ar" ? "موافقات" : "Sign-offs" },
            ].map((s, i) => (
              <div key={s.n} className={`bg-white border rounded-lg p-2 text-center ${i === 5 ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <p className="text-[9px] uppercase font-bold text-gray-500">{s.n}</p>
                <p className="text-[10px] font-semibold mt-0.5" style={{ color: BRAND_INK }}>{s.label}</p>
                <p className="text-[9px] mt-0.5" style={{ color: i === 5 ? "#B45309" : "#196B24" }}>{i === 5 ? (lang === "ar" ? "بانتظار" : "pending") : "✓"}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Hero 3 — Decision queue */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("heroQueueTitle", catalogue)}</h2>
            <p className="text-xs text-gray-500">{t("heroQueueSub", catalogue)}</p>
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
                  <p className="text-[10px] text-gray-500 mt-1">{r.confidence}% {lang === "ar" ? "ثقة" : "confidence"}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => act(r.id, "approved")} className="px-2.5 py-1 text-[10px] font-bold text-white rounded-lg" style={{ background: BRAND }}>{lang === "ar" ? "موافقة" : "Approve"}</button>
                  <button onClick={() => act(r.id, "edited")} className="px-2.5 py-1 text-[10px] font-bold text-gray-700 bg-white border border-gray-200 rounded-lg">{lang === "ar" ? "تعديل" : "Edit"}</button>
                  <button onClick={() => act(r.id, "rejected")} className="px-2.5 py-1 text-[10px] font-bold text-gray-500">{lang === "ar" ? "تجاهل" : "Dismiss"}</button>
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
