import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  ScatterChart, Scatter, ZAxis, Legend,
} from "recharts";
import {
  GitCompareArrows, ChevronDown, ChevronRight, Star, Zap,
  TrendingUp, TrendingDown, Minus, Shield, Award, Package,
  Search, SlidersHorizontal, ArrowUpDown, Eye,
} from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import { useDemoLang } from "../DemoLangContext";
import { comparison } from "../demo-i18n";
import {
  COMPETITOR_BRANDS, CATEGORY_LABELS, getCategoryLabel, getProductName,
  getProductSpecs, getSubcategoryLabel, getPriceTierLabel,
  type ProductCategory, type ArcelikProduct, type CompetitorPrice,
} from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";

const BRAND_COLORS: Record<string, string> = {
  Vestel: "#2563eb", Regal: "#7c3aed", Bosch: "#059669",
  Siemens: "#0891b2", Profilo: "#d97706", Samsung: "#1d4ed8",
  LG: "#dc2626", "Electrolux/AEG": "#4f46e5",
};

const fmt = (n: number) => "₺" + n.toLocaleString("tr-TR");

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-gray-400 text-[11px] flex items-center gap-0.5"><Minus size={11} /> 0%</span>;
  const isNeg = delta < 0;
  return (
    <span className={`text-[11px] font-semibold flex items-center gap-0.5 ${isNeg ? "text-red-600" : "text-green-600"}`}>
      {isNeg ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
      {delta > 0 ? "+" : ""}{delta}%
    </span>
  );
}

function FeatureTag({ label }: { label: string }) {
  return <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] rounded-full">{label}</span>;
}

function ProductCard({ product, competitors, lang }: {
  product: ArcelikProduct;
  competitors: CompetitorPrice[];
  lang: "tr" | "en";
}) {
  const [expanded, setExpanded] = useState(false);
  const t = comparison[lang];
  const specs = getProductSpecs(product);

  const cheapest = competitors.length > 0 ? Math.min(...competitors.map(c => c.competitorPrice)) : product.tsfPrice;
  const mostExpensive = competitors.length > 0 ? Math.max(...competitors.map(c => c.competitorPrice)) : product.tsfPrice;
  const avgCompPrice = competitors.length > 0 ? Math.round(competitors.reduce((s, c) => s + c.competitorPrice, 0) / competitors.length) : 0;
  const pricePosition = avgCompPrice > 0 ? Math.round(((product.tsfPrice - avgCompPrice) / avgCompPrice) * 100) : 0;

  const barData = [
    { name: "Arçelik", price: product.tsfPrice, fill: "#E30613" },
    ...competitors.map(c => ({
      name: c.brand,
      price: c.competitorPrice,
      fill: BRAND_COLORS[c.brand] || "#6b7280",
    })),
  ].sort((a, b) => a.price - b.price);

  return (
    <motion.div
      layout
      className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
    >
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-[#E30613] bg-red-50 px-2 py-0.5 rounded-full">
                {getCategoryLabel(product.category, lang)}
              </span>
              <span className="text-[10px] text-gray-400">
                {getSubcategoryLabel(product.subcategory, lang)}
              </span>
            </div>
            <h3 className="font-bold text-[#0E2841] text-sm truncate">{getProductName(product, lang)}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{product.modelCode}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-bold text-lg text-[#0E2841]">{fmt(product.tsfPrice)}</p>
            <DeltaBadge delta={pricePosition} />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Package size={10} />
            <span>{specs.capacity}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Zap size={10} />
            <span>{product.energyClass}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Shield size={10} />
            <span>{specs.warrantyYears} {t.yearWarranty}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <GitCompareArrows size={10} />
            <span>{competitors.length} {t.competitors}</span>
          </div>
          <div className="ml-auto">
            {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-100"
          >
            <div className="p-4 space-y-4">
              {specs.smartFeatures.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {specs.smartFeatures.map((f, i) => <FeatureTag key={i} label={f} />)}
                </div>
              )}

              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ left: 60, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tickFormatter={(v) => `₺${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={55} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="price" radius={[0, 4, 4, 0]}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t.competitorDetails}</p>
                <div className="divide-y divide-gray-50">
                  {competitors.map((c) => {
                    const arcelikProduct = product;
                    const gap = arcelikProduct.tsfPrice > 0 ? Math.round(((c.competitorPrice - arcelikProduct.tsfPrice) / arcelikProduct.tsfPrice) * 100) : 0;
                    return (
                      <div key={c.id} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[c.brand] || "#6b7280" }} />
                          <span className="text-[11px] font-semibold text-gray-700">{c.brand}</span>
                          <span className="text-[10px] text-gray-400">{c.competitorModel}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-semibold">{fmt(c.competitorPrice)}</span>
                          <DeltaBadge delta={gap} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-gray-500">{t.cheapestComp}</p>
                  <p className="text-sm font-bold text-green-600">{fmt(cheapest)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-gray-500">{t.arcelikPrice}</p>
                  <p className="text-sm font-bold text-[#0E2841]">{fmt(product.tsfPrice)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-[10px] text-gray-500">{t.mostExpComp}</p>
                  <p className="text-sm font-bold text-red-600">{fmt(mostExpensive)}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type SortKey = "name" | "price" | "delta" | "competitors";

export default function ProductComparisonView() {
  const { filters } = useDashboardFilters();
  const { lang } = useDemoLang();
  const t = comparison[lang];
  const { products, competitorPrices } = useArcelikData();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("delta");
  const [sortAsc, setSortAsc] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "scatter">("cards");

  const filteredProducts = useMemo(() => {
    let list = products;
    if (filters.categories.length > 0) list = list.filter(p => filters.categories.includes(p.category));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => getProductName(p, lang).toLowerCase().includes(q) || p.modelCode.toLowerCase().includes(q));
    }
    return list;
  }, [products, filters.categories, search]);

  const productWithComps = useMemo(() => {
    return filteredProducts.map(p => {
      let comps = competitorPrices.filter(c => c.arcelikEquivalentId === p.id);
      if (filters.competitors.length > 0) {
        comps = comps.filter(c => filters.competitors.includes(c.brand.toLowerCase()));
      }
      const avgDelta = comps.length > 0
        ? Math.round(comps.reduce((s, c) => s + c.priceDeltaPercent, 0) / comps.length)
        : 0;
      return { product: p, competitors: comps, avgDelta };
    }).filter(x => x.competitors.length > 0);
  }, [filteredProducts, competitorPrices, filters.competitors]);

  const sorted = useMemo(() => {
    const list = [...productWithComps];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = getProductName(a.product, lang).localeCompare(getProductName(b.product, lang)); break;
        case "price": cmp = a.product.tsfPrice - b.product.tsfPrice; break;
        case "delta": cmp = Math.abs(b.avgDelta) - Math.abs(a.avgDelta); break;
        case "competitors": cmp = b.competitors.length - a.competitors.length; break;
      }
      return sortAsc ? -cmp : cmp;
    });
    return list;
  }, [productWithComps, sortKey, sortAsc]);

  const scatterData = useMemo(() => {
    return productWithComps.map(x => ({
      name: getProductName(x.product, lang),
      arcelikPrice: x.product.tsfPrice / 1000,
      avgCompPrice: x.competitors.length > 0
        ? Math.round(x.competitors.reduce((s, c) => s + c.competitorPrice, 0) / x.competitors.length) / 1000
        : x.product.tsfPrice / 1000,
      size: x.competitors.length * 20 + 40,
      category: getCategoryLabel(x.product.category, lang),
    }));
  }, [productWithComps, lang]);

  const summaryStats = useMemo(() => {
    const totalProducts = productWithComps.length;
    const cheaperCount = productWithComps.filter(x => x.avgDelta < 0).length;
    const expensiveCount = productWithComps.filter(x => x.avgDelta > 0).length;
    const avgGap = totalProducts > 0 ? Math.round(productWithComps.reduce((s, x) => s + x.avgDelta, 0) / totalProducts) : 0;
    return { totalProducts, cheaperCount, expensiveCount, avgGap };
  }, [productWithComps]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
            <GitCompareArrows size={20} /> {t.title}
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("cards")}
            className={`px-3 py-1.5 text-[11px] rounded-lg transition-colors ${viewMode === "cards" ? "bg-[#0E2841] text-white" : "bg-gray-100 text-gray-600"}`}
          >
            {t.cardView}
          </button>
          <button
            onClick={() => setViewMode("scatter")}
            className={`px-3 py-1.5 text-[11px] rounded-lg transition-colors ${viewMode === "scatter" ? "bg-[#0E2841] text-white" : "bg-gray-100 text-gray-600"}`}
          >
            {t.scatterView}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.totalTracked}</p>
          <p className="text-xl font-bold text-[#0E2841]">{summaryStats.totalProducts}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.cheaperThanComp}</p>
          <p className="text-xl font-bold text-green-600">{summaryStats.cheaperCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.moreExpThanComp}</p>
          <p className="text-xl font-bold text-red-600">{summaryStats.expensiveCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.avgGap}</p>
          <p className={`text-xl font-bold ${summaryStats.avgGap >= 0 ? "text-green-600" : "text-red-600"}`}>
            {summaryStats.avgGap > 0 ? "+" : ""}{summaryStats.avgGap}%
          </p>
        </div>
      </div>

      {viewMode === "scatter" ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-[#0E2841] mb-3">{t.priceMap}</h3>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  type="number" dataKey="arcelikPrice" name={t.arcelikPriceAxis}
                  tick={{ fontSize: 10 }} label={{ value: t.arcelikPriceAxis, position: "bottom", fontSize: 11 }}
                  tickFormatter={(v) => `₺${v}k`}
                />
                <YAxis
                  type="number" dataKey="avgCompPrice" name={t.compPriceAxis}
                  tick={{ fontSize: 10 }} label={{ value: t.compPriceAxis, angle: -90, position: "insideLeft", fontSize: 11 }}
                  tickFormatter={(v) => `₺${v}k`}
                />
                <ZAxis type="number" dataKey="size" range={[40, 200]} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white shadow-lg rounded-lg p-3 border text-[11px]">
                        <p className="font-bold text-[#0E2841]">{d.name}</p>
                        <p className="text-gray-500">{d.category}</p>
                        <p>Arçelik: ₺{d.arcelikPrice}k</p>
                        <p>{t.compAvg}: ₺{d.avgCompPrice}k</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#E30613" fillOpacity={0.6} />
                <Legend />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 text-center">{t.scatterHint}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-[#0E2841]"
              />
            </div>
            <div className="flex items-center gap-1">
              {(["name", "price", "delta", "competitors"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`px-2 py-1.5 text-[10px] rounded-lg flex items-center gap-0.5 transition-colors ${
                    sortKey === key ? "bg-[#0E2841] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {t[`sort_${key}` as keyof typeof t] || key}
                  {sortKey === key && <ArrowUpDown size={10} />}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sorted.map(({ product, competitors }) => (
              <ProductCard
                key={product.id}
                product={product}
                competitors={competitors}
                lang={lang}
              />
            ))}
          </div>

          {sorted.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <GitCompareArrows size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t.noResults}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
