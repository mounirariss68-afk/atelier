import { useState, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { Search, ArrowRight } from "lucide-react";
import {
  insights, insightTitle, insightSummary,
  insightCategoryLabel, insightTypeLabel, insightDateLabel, insightReadTimeLabel,
  INSIGHT_CATEGORY_COLORS,
} from "@/data/content";
import { useLang, tStr } from "@/lib/lang";

const categories = ["All", "Agentic AI", "Data & Governance", "Legacy Modernization", "Industry Trends"];
const types = ["All Types", "Report", "Research Report", "Perspective", "Opinion", "Thought Leadership", "Technical Brief"];

const COPY = {
  eyebrow: { en: "Insights", ar: "رؤى", tr: "İçgörüler" },
  heroTitle: { en: "Research, perspectives, and analysis.", ar: "أبحاث، وجهات نظر، وتحليل.", tr: "Araştırma, perspektif ve analiz." },
  heroPara: { en: "Maven AI's team publishes original research and thought leadership on AI in the GCC — from governance frameworks to production deployment playbooks.", ar: "ينشر فريق Maven AI أبحاثاً أصلية وقيادة فكرية حول الذكاء الاصطناعي في الخليج — من أطر الحوكمة إلى أدلة النشر الإنتاجي.", tr: "Maven AI ekibi, Körfez'de AI üzerine özgün araştırmalar ve düşünce liderliği yayımlıyor — yönetişim çerçevelerinden üretim dağıtım kılavuzlarına kadar." },
  featured: { en: "Featured", ar: "مميّز", tr: "Öne çıkan" },
  readNow: { en: "Read now", ar: "اقرأ الآن", tr: "Şimdi oku" },
  searchPlaceholder: { en: "Search insights...", ar: "ابحث في الرؤى...", tr: "İçgörülerde ara..." },
  noMatch: { en: "No insights match your filters.", ar: "لا توجد رؤى تطابق المرشحات.", tr: "Filtrelerinize uyan içgörü yok." },
  clearFilters: { en: "Clear filters", ar: "مسح المرشحات", tr: "Filtreleri temizle" },
  read: { en: "Read", ar: "اقرأ", tr: "Oku" },
};

export default function Insights() {
  const { lang, dir } = useLang();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialCategory = params.get("category") || "All";

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [activeType, setActiveType] = useState("All Types");

  const filtered = useMemo(() => {
    return insights.filter((insight) => {
      const matchCat = activeCategory === "All" || insight.category === activeCategory;
      const matchType = activeType === "All Types" || insight.type === activeType;
      const t = insightTitle(insight, lang).toLowerCase();
      const s = insightSummary(insight, lang).toLowerCase();
      const matchQuery = !query || t.includes(query.toLowerCase()) || s.includes(query.toLowerCase());
      return matchCat && matchType && matchQuery;
    });
  }, [activeCategory, activeType, query, lang]);

  const featured = insights.filter((i) => i.featured)[0];

  const categoryColors = INSIGHT_CATEGORY_COLORS;

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">{tStr(COPY.eyebrow, lang)}</span>
          <h1 className="text-5xl font-extrabold text-white mt-3 mb-4 max-w-3xl leading-tight">
            {tStr(COPY.heroTitle, lang)}
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl">
            {tStr(COPY.heroPara, lang)}
          </p>
        </div>
      </section>

      {/* Featured */}
      {featured && (
        <section className="py-12 bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-bold text-[#F5A623] uppercase tracking-widest mb-5">{tStr(COPY.featured, lang)}</p>
            <Link href={`/insights/${featured.slug}`}>
              <div className="group grid lg:grid-cols-5 gap-8 items-center report-card border border-gray-100 rounded-2xl overflow-hidden cursor-pointer hover:shadow-xl hover:border-transparent transition-all">
                <div className="lg:col-span-2 h-72 lg:h-full bg-[#0E2841] relative overflow-hidden">
                  <img
                    src={featured.coverImage}
                    alt={insightTitle(featured, lang)}
                    className="w-full h-full object-cover opacity-70 group-hover:opacity-90 group-hover:scale-105 transition-all duration-500"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10" />
                </div>
                <div className="lg:col-span-3 p-8">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-bold px-3 py-1 rounded-full text-white" style={{ backgroundColor: categoryColors[featured.category] || "#156082" }}>
                      {insightTypeLabel(featured.type, lang)}
                    </span>
                    <span className="text-xs text-gray-400">{insightCategoryLabel(featured.category, lang)} · {insightDateLabel(featured.date, lang)}</span>
                  </div>
                  <h2 className="text-3xl font-extrabold text-[#0E2841] mb-4 group-hover:text-[#156082] transition-colors leading-snug">{insightTitle(featured, lang)}</h2>
                  <p className="text-gray-600 mb-6 leading-relaxed">{insightSummary(featured, lang)}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">{featured.author}</p>
                      <p className="text-xs text-gray-400">{insightReadTimeLabel(featured, lang)}</p>
                    </div>
                    <span className="inline-flex items-center gap-2 bg-[#0E2841] group-hover:bg-[#F5A623] text-white font-bold px-5 py-2.5 rounded-lg transition-colors text-sm">
                      {tStr(COPY.readNow, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="py-8 bg-[#F8F9FA] border-b border-gray-100 sticky top-20 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                    activeCategory === cat
                      ? "bg-[#0E2841] text-white shadow-sm"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841]"
                  }`}
                >
                  {insightCategoryLabel(cat, lang)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  placeholder={tStr(COPY.searchPlaceholder, lang)}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#156082] bg-white w-48"
                />
              </div>
              <select
                value={activeType}
                onChange={(e) => setActiveType(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#156082] bg-white text-gray-600"
              >
                {types.map((tt) => <option key={tt} value={tt}>{insightTypeLabel(tt, lang)}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="py-14 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-lg">{tStr(COPY.noMatch, lang)}</p>
              <button onClick={() => { setActiveCategory("All"); setActiveType("All Types"); setQuery(""); }} className="mt-4 text-[#156082] font-semibold hover:underline">
                {tStr(COPY.clearFilters, lang)}
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filtered.map((insight, i) => (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.4 }}
                  className="report-card group bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm cursor-pointer hover:shadow-lg hover:border-transparent transition-all"
                >
                  <Link href={`/insights/${insight.slug}`}>
                    <div className="h-44 bg-[#0E2841] relative overflow-hidden">
                      <img
                        src={insight.coverImage}
                        alt={insightTitle(insight, lang)}
                        className="w-full h-full object-cover opacity-70 group-hover:opacity-90 group-hover:scale-105 transition-all duration-500"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0E2841]/60 to-transparent" />
                      <div className="absolute bottom-3 left-3">
                        <span
                          className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
                          style={{ backgroundColor: categoryColors[insight.category] || "#156082" }}
                        >
                          {insightTypeLabel(insight.type, lang)}
                        </span>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold" style={{ color: categoryColors[insight.category] || "#156082" }}>{insightCategoryLabel(insight.category, lang)}</span>
                        <span className="text-gray-300 text-xs">·</span>
                        <span className="text-xs text-gray-400">{insightDateLabel(insight.date, lang)}</span>
                      </div>
                      <h3 className="font-bold text-[#0E2841] text-sm leading-snug mb-2 group-hover:text-[#156082] transition-colors line-clamp-3">
                        {insightTitle(insight, lang)}
                      </h3>
                      <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">{insightSummary(insight, lang)}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{insightReadTimeLabel(insight, lang)}</span>
                        <span className="text-xs font-semibold text-[#156082] group-hover:text-[#F5A623] transition-colors flex items-center gap-1">
                          {tStr(COPY.read, lang)} <ArrowRight size={12} className="rtl:-scale-x-100" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
