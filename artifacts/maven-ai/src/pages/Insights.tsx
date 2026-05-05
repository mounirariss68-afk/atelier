import { useState, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { Search, Filter, ArrowRight } from "lucide-react";
import { insights, insightTitle, insightSummary } from "@/data/content";
import { useLang } from "@/lib/lang";

const categories = ["All", "Agentic AI", "Data & Governance", "Legacy Modernization", "Industry Trends"];
const types = ["All Types", "Report", "Research Report", "Perspective", "Opinion", "Thought Leadership", "Technical Brief"];

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

  const categoryColors: Record<string, string> = {
    "Agentic AI": "#156082",
    "Data & Governance": "#F5A623",
    "Legacy Modernization": "#F5A623",
    "Industry Trends": "#196B24",
  };

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">Insights</span>
          <h1 className="text-5xl font-extrabold text-white mt-3 mb-4 max-w-3xl leading-tight">
            Research, perspectives, and analysis.
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl">
            Maven AI's team publishes original research and thought leadership on AI in the GCC — from governance frameworks to production deployment playbooks.
          </p>
        </div>
      </section>

      {/* Featured */}
      {featured && (
        <section className="py-12 bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-bold text-[#F5A623] uppercase tracking-widest mb-5">Featured</p>
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
                      {featured.type}
                    </span>
                    <span className="text-xs text-gray-400">{featured.category} · {featured.date}</span>
                  </div>
                  <h2 className="text-3xl font-extrabold text-[#0E2841] mb-4 group-hover:text-[#156082] transition-colors leading-snug">{insightTitle(featured, lang)}</h2>
                  <p className="text-gray-600 mb-6 leading-relaxed">{insightSummary(featured, lang)}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">{featured.author}</p>
                      <p className="text-xs text-gray-400">{featured.readTime}</p>
                    </div>
                    <span className="inline-flex items-center gap-2 bg-[#0E2841] group-hover:bg-[#F5A623] text-white font-bold px-5 py-2.5 rounded-lg transition-colors text-sm">
                      Read now <ArrowRight size={14} />
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
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  placeholder="Search insights..."
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
                {types.map((t) => <option key={t}>{t}</option>)}
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
              <p className="text-gray-400 text-lg">No insights match your filters.</p>
              <button onClick={() => { setActiveCategory("All"); setActiveType("All Types"); setQuery(""); }} className="mt-4 text-[#156082] font-semibold hover:underline">
                Clear filters
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
                          {insight.type}
                        </span>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold" style={{ color: categoryColors[insight.category] || "#156082" }}>{insight.category}</span>
                        <span className="text-gray-300 text-xs">·</span>
                        <span className="text-xs text-gray-400">{insight.date}</span>
                      </div>
                      <h3 className="font-bold text-[#0E2841] text-sm leading-snug mb-2 group-hover:text-[#156082] transition-colors line-clamp-3">
                        {insightTitle(insight, lang)}
                      </h3>
                      <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">{insightSummary(insight, lang)}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{insight.readTime}</span>
                        <span className="text-xs font-semibold text-[#156082] group-hover:text-[#F5A623] transition-colors flex items-center gap-1">
                          Read <ArrowRight size={12} />
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
