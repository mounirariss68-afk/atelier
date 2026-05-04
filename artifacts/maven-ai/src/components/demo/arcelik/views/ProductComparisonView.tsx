import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  LineChart, Line, Legend, ReferenceLine,
} from "recharts";
import {
  GitCompareArrows, Search, X, Check, Minus, Star, Zap, Award,
  Plus, TrendingUp, TrendingDown, Sparkles,
} from "lucide-react";
import { useDemoLang } from "../DemoLangContext";
import { comparison } from "../demo-i18n";
import {
  CATEGORY_LABELS, getCategoryLabel, getProductName, getProductSpecs,
  getSubcategoryLabel, getPriceTierLabel,
  type ProductCategory, type ArcelikProduct, type CompetitorPrice,
} from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";
import { usePriceHistory, type PriceHistoryRecord } from "@/hooks/usePriceHistory";

const MAX_SELECTED = 4;
const MIN_TO_COMPARE = 2;

const COMPARE_COLORS = ["#E30613", "#2563eb", "#059669", "#d97706"];

const ENERGY_RANK: Record<string, number> = {
  "A+++": 9, "A++": 8, "A+": 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1, G: 0,
};

type ItemKind = "arcelik" | "competitor";

interface ComparisonItem {
  key: string;
  kind: ItemKind;
  id: string;
  name: string;
  brand: string;
  modelCode: string;
  category: ProductCategory;
  subcategory: string | null;
  price: number;
  priceTier: "entry" | "mid" | "premium" | null;
  energyClass: string | null;
  features: string[];
  smartFeatures: string[];
  capacity: string;
  warrantyYears: number | null;
  historyRefId: string;
  historyRecordType: string;
}

const fmt = (n: number) => "₺" + n.toLocaleString("tr-TR");

function buildArcelikItem(p: ArcelikProduct, lang: "tr" | "en"): ComparisonItem {
  const specs = getProductSpecs(p);
  return {
    key: `a:${p.id}`,
    kind: "arcelik",
    id: p.id,
    name: getProductName(p, lang),
    brand: "Arçelik",
    modelCode: p.modelCode,
    category: p.category,
    subcategory: p.subcategory,
    price: p.tsfPrice,
    priceTier: p.priceTier,
    energyClass: p.energyClass,
    features: p.features,
    smartFeatures: specs.smartFeatures,
    capacity: specs.capacity,
    warrantyYears: specs.warrantyYears,
    historyRefId: p.id,
    // Must match the value persisted by api-server scraper.ts when
    // inserting into arcelikPriceHistoryTable (recordType: "product").
    historyRecordType: "product",
  };
}

function buildCompetitorItem(c: CompetitorPrice): ComparisonItem {
  return {
    key: `c:${c.id}`,
    kind: "competitor",
    id: c.id,
    name: `${c.brand} ${c.competitorModel}`,
    brand: c.brand,
    modelCode: c.competitorModel,
    category: c.category,
    subcategory: null,
    price: c.competitorPrice,
    priceTier: null,
    energyClass: null,
    features: [],
    smartFeatures: [],
    capacity: "—",
    warrantyYears: null,
    historyRefId: c.id,
    // Must match the value persisted by api-server scraper.ts when
    // inserting into arcelikPriceHistoryTable (recordType: "competitor").
    historyRecordType: "competitor",
  };
}

// Spec: features-per-TL, energy efficiency, and price tier positioning.
// Each component is normalized to 0-100 then combined as:
//   45% features-per-TL · 30% energy efficiency · 25% price-tier
// `maxFeaturesPerKTL` is the in-selection ceiling so the bar is
// relative to peers being compared, which reads more intuitively
// in a side-by-side view than an absolute scale.
const PRICE_TIER_VALUE_SCORE: Record<"entry" | "mid" | "premium", number> = {
  entry: 100,
  mid: 65,
  premium: 35,
};

function featuresPerKTL(item: ComparisonItem): number {
  if (item.price <= 0) return 0;
  return item.features.length / (item.price / 1000);
}

function computeValueScore(
  item: ComparisonItem,
  maxFeaturesPerKTL: number,
): number {
  // Features-per-TL component (0-100), normalized to top of selection
  const fpt = featuresPerKTL(item);
  const featuresPerTLComponent = maxFeaturesPerKTL > 0
    ? Math.min(100, (fpt / maxFeaturesPerKTL) * 100)
    : 0;

  // Energy efficiency component (0-100); unknown energy class → 50
  const energyComponent = item.energyClass
    ? ((ENERGY_RANK[item.energyClass.toUpperCase()] ?? 4) / 9) * 100
    : 50;

  // Price tier positioning (0-100): entry tier scores highest as a
  // "value" pick; competitors with no known tier default to 50
  const priceTierComponent = item.priceTier
    ? PRICE_TIER_VALUE_SCORE[item.priceTier]
    : 50;

  return Math.round(
    featuresPerTLComponent * 0.45 +
    energyComponent * 0.3 +
    priceTierComponent * 0.25,
  );
}

function MatrixCell({
  value,
  isBest,
  isWorst,
}: {
  value: string | number;
  isBest?: boolean;
  isWorst?: boolean;
}) {
  let cls = "text-gray-700";
  if (isBest) cls = "text-green-700 font-semibold";
  else if (isWorst) cls = "text-red-600";
  return (
    <td className={`px-3 py-2 text-[12px] border-t border-gray-100 ${cls}`}>
      <span className="inline-flex items-center gap-1">
        {isBest && <Star size={11} className="text-amber-500 fill-amber-400" />}
        {value}
      </span>
    </td>
  );
}

export default function ProductComparisonView() {
  const { lang } = useDemoLang();
  const t = comparison[lang];
  const { products, competitorPrices } = useArcelikData();
  const { data: priceHistoryAll } = usePriceHistory({ limit: 2000 });
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | "arcelik" | "competitor">("all");
  const [filterCategory, setFilterCategory] = useState<ProductCategory | "all">("all");
  const [filterTier, setFilterTier] = useState<"all" | "entry" | "mid" | "premium">("all");

  const allItems = useMemo<ComparisonItem[]>(() => {
    const a: ComparisonItem[] = products.map((p) => buildArcelikItem(p, lang));
    const c: ComparisonItem[] = competitorPrices.map(buildCompetitorItem);
    return [...a, ...c];
  }, [products, competitorPrices, lang]);

  const itemsByKey = useMemo(() => {
    const m = new Map<string, ComparisonItem>();
    for (const it of allItems) m.set(it.key, it);
    return m;
  }, [allItems]);

  const selectedItems = useMemo(
    () => selectedKeys.map((k) => itemsByKey.get(k)).filter((x): x is ComparisonItem => Boolean(x)),
    [selectedKeys, itemsByKey],
  );

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems
      .filter((it) => filterKind === "all" || it.kind === filterKind)
      .filter((it) => filterCategory === "all" || it.category === filterCategory)
      .filter((it) => filterTier === "all" || it.priceTier === filterTier)
      .filter((it) => {
        if (!q) return true;
        return (
          it.name.toLowerCase().includes(q) ||
          it.brand.toLowerCase().includes(q) ||
          it.modelCode.toLowerCase().includes(q)
        );
      })
      .slice(0, 80);
  }, [allItems, search, filterKind, filterCategory, filterTier]);

  function toggle(key: string) {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_SELECTED) return prev;
      return [...prev, key];
    });
  }

  // Category averages per category present in the selection
  const categoryAvgPrices = useMemo(() => {
    const map: Record<string, number> = {};
    const cats = new Set(selectedItems.map((s) => s.category));
    for (const cat of cats) {
      const arc = products.filter((p) => p.category === cat).map((p) => p.tsfPrice);
      const cmp = competitorPrices.filter((c) => c.category === cat).map((c) => c.competitorPrice);
      const all = [...arc, ...cmp];
      if (all.length > 0) {
        map[cat] = Math.round(all.reduce((s, x) => s + x, 0) / all.length);
      }
    }
    return map;
  }, [selectedItems, products, competitorPrices]);

  const maxFeaturesPerKTL = useMemo(() => {
    return selectedItems.reduce((m, it) => Math.max(m, featuresPerKTL(it)), 0);
  }, [selectedItems]);

  const valueScores = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of selectedItems) {
      map[it.key] = computeValueScore(it, maxFeaturesPerKTL);
    }
    return map;
  }, [selectedItems, maxFeaturesPerKTL]);

  // Union of features across selected items, for the per-feature matrix
  const featureUnion = useMemo(() => {
    const set = new Set<string>();
    for (const it of selectedItems) {
      for (const f of it.features) set.add(f);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [selectedItems]);

  // --- Chart data ---
  const pricePositionData = useMemo(() => {
    return selectedItems.map((it, idx) => {
      const avg = categoryAvgPrices[it.category] ?? it.price;
      const deltaPct = avg > 0 ? Math.round(((it.price - avg) / avg) * 100) : 0;
      return {
        name: it.name.length > 22 ? it.name.slice(0, 21) + "…" : it.name,
        delta: deltaPct,
        fill: COMPARE_COLORS[idx % COMPARE_COLORS.length],
      };
    });
  }, [selectedItems, categoryAvgPrices]);

  const valueChartData = useMemo(() => {
    return selectedItems.map((it, idx) => ({
      name: it.name.length > 22 ? it.name.slice(0, 21) + "…" : it.name,
      score: valueScores[it.key] ?? 0,
      fill: COMPARE_COLORS[idx % COMPARE_COLORS.length],
    }));
  }, [selectedItems, valueScores]);

  // Price history chart: pivot by date, one line per selected item
  const historyChartData = useMemo(() => {
    if (!priceHistoryAll || priceHistoryAll.length === 0 || selectedItems.length === 0) return [];
    const byBucket = new Map<string, Record<string, number | string>>();
    const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const it of selectedItems) {
      const records = (priceHistoryAll as PriceHistoryRecord[]).filter(
        (r) =>
          r.referenceId === it.historyRefId &&
          r.recordType === it.historyRecordType &&
          new Date(r.recordedAt).getTime() >= since,
      );
      // Group by day, take last price per day
      const dayMap = new Map<string, number>();
      for (const r of records) {
        const day = r.recordedAt.slice(0, 10);
        dayMap.set(day, r.price);
      }
      // Always seed the current price as the last data point for visibility
      const today = new Date().toISOString().slice(0, 10);
      if (!dayMap.has(today)) dayMap.set(today, it.price);

      for (const [day, price] of dayMap) {
        const row = byBucket.get(day) ?? { date: day };
        row[it.key] = price;
        byBucket.set(day, row);
      }
    }
    return Array.from(byBucket.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [priceHistoryAll, selectedItems]);

  const hasMeaningfulHistory = useMemo(() => {
    if (historyChartData.length < 2) return false;
    // require at least one item with >1 distinct price point
    return selectedItems.some((it) => {
      const vals = historyChartData
        .map((row) => row[it.key])
        .filter((v): v is number => typeof v === "number");
      const uniq = new Set(vals);
      return uniq.size >= 2;
    });
  }, [historyChartData, selectedItems]);

  const bestItem = useMemo(() => {
    if (selectedItems.length < MIN_TO_COMPARE) return null;
    return selectedItems.reduce<ComparisonItem | null>((best, it) => {
      const score = valueScores[it.key] ?? 0;
      if (!best) return it;
      const bestScore = valueScores[best.key] ?? 0;
      return score > bestScore ? it : best;
    }, null);
  }, [selectedItems, valueScores]);

  // --- Matrix best/worst markers ---
  function bestWorstByMax(values: (number | null)[]): { best: number; worst: number } {
    const nums = values.filter((v): v is number => v !== null);
    return { best: Math.max(...nums, -Infinity), worst: Math.min(...nums, Infinity) };
  }
  function bestWorstByMin(values: (number | null)[]): { best: number; worst: number } {
    const nums = values.filter((v): v is number => v !== null);
    return { best: Math.min(...nums, Infinity), worst: Math.max(...nums, -Infinity) };
  }

  const featureCounts = selectedItems.map((it) => it.features.length);
  const fcExt = bestWorstByMax(featureCounts);
  const prices = selectedItems.map((it) => it.price);
  const priceExt = bestWorstByMin(prices);
  const energyRanks = selectedItems.map((it) =>
    it.energyClass ? ENERGY_RANK[it.energyClass.toUpperCase()] ?? null : null,
  );
  const energyExt = bestWorstByMax(energyRanks);
  const warranties = selectedItems.map((it) => it.warrantyYears);
  const warrantyExt = bestWorstByMax(warranties);
  const valueArr = selectedItems.map((it) => valueScores[it.key] ?? 0);
  const valueExt = bestWorstByMax(valueArr);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
            <GitCompareArrows size={20} /> {t.title}
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            <span className="font-bold text-[#0E2841]">{selectedItems.length}</span>/{MAX_SELECTED} {t.selected}
          </span>
          {selectedItems.length > 0 && (
            <button
              onClick={() => setSelectedKeys([])}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1"
            >
              <X size={12} /> {t.clearSelection}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Selector */}
        <aside className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col h-[calc(100vh-220px)] min-h-[460px]">
          <div className="space-y-2 flex-shrink-0">
            <p className="text-[12px] font-bold text-[#0E2841]">{t.selectorTitle}</p>
            <p className="text-[10px] text-gray-500 leading-snug">{t.selectorHint}</p>

            <div className="relative mt-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-[#0E2841]"
              />
            </div>

            <div className="flex gap-1">
              {(["all", "arcelik", "competitor"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilterKind(k)}
                  className={`px-2 py-1 text-[10px] rounded-md font-medium transition-colors flex-1 ${
                    filterKind === k
                      ? "bg-[#0E2841] text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {k === "all" ? t.filterAll : k === "arcelik" ? t.filterArcelik : t.filterCompetitors}
                </button>
              ))}
            </div>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as ProductCategory | "all")}
              className="w-full px-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-[#0E2841]"
            >
              <option value="all">{t.filterAll}</option>
              {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((c) => (
                <option key={c} value={c}>{getCategoryLabel(c, lang)}</option>
              ))}
            </select>

            <select
              value={filterTier}
              onChange={(e) =>
                setFilterTier(e.target.value as "all" | "entry" | "mid" | "premium")
              }
              className="w-full px-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-[#0E2841]"
            >
              <option value="all">{t.filterTierAll}</option>
              {(["entry", "mid", "premium"] as const).map((tier) => (
                <option key={tier} value={tier}>
                  {getPriceTierLabel(tier, lang)}
                </option>
              ))}
            </select>
          </div>

          {selectedItems.length >= MAX_SELECTED && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mt-2 flex-shrink-0">
              {t.maxSelected}
            </p>
          )}

          <ul className="mt-3 space-y-1 overflow-y-auto flex-1 -mx-1 px-1">
            {filteredList.map((it) => {
              const isSelected = selectedKeys.includes(it.key);
              const disabled = !isSelected && selectedItems.length >= MAX_SELECTED;
              const idx = selectedKeys.indexOf(it.key);
              const accent = isSelected ? COMPARE_COLORS[idx % COMPARE_COLORS.length] : "transparent";
              return (
                <li key={it.key}>
                  <button
                    onClick={() => toggle(it.key)}
                    disabled={disabled}
                    className={`w-full text-left px-2 py-1.5 rounded-md flex items-start gap-2 text-[11px] transition-colors border-l-2 ${
                      isSelected
                        ? "bg-blue-50"
                        : disabled
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:bg-gray-50"
                    }`}
                    style={{ borderLeftColor: accent }}
                  >
                    <span
                      className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected ? "bg-[#0E2841] border-[#0E2841]" : "border-gray-300"
                      }`}
                    >
                      {isSelected && <Check size={9} className="text-white" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                            it.kind === "arcelik" ? "bg-red-100 text-[#E30613]" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {it.kind === "arcelik" ? t.arcelikBadge : it.brand}
                        </span>
                        <span className="text-[9px] text-gray-400 truncate">
                          {getCategoryLabel(it.category, lang)}
                        </span>
                      </div>
                      <p className="font-semibold text-[#0E2841] truncate mt-0.5">{it.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                        <span className="truncate">{it.modelCode}</span>
                        <span className="ml-auto font-semibold text-gray-700">{fmt(it.price)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {filteredList.length === 0 && (
              <li className="text-center text-[11px] text-gray-400 py-6">—</li>
            )}
          </ul>
        </aside>

        {/* Comparison area */}
        <section className="space-y-4">
          {selectedItems.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <GitCompareArrows size={36} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-bold text-[#0E2841]">{t.emptyTitle}</p>
              <p className="text-[12px] text-gray-500 mt-1">{t.emptySubtitle}</p>
            </div>
          )}

          {selectedItems.length === 1 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[12px] text-amber-800 flex items-center gap-2">
              <Plus size={14} /> {t.addAtLeastTwo}
            </div>
          )}

          {selectedItems.length >= MIN_TO_COMPARE && (
            <>
              {/* Overview cards */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-bold text-[#0E2841] mb-3">{t.overviewTitle}</h3>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${selectedItems.length}, minmax(0, 1fr))` }}
                >
                  {selectedItems.map((it, idx) => {
                    const accent = COMPARE_COLORS[idx % COMPARE_COLORS.length];
                    const score = valueScores[it.key] ?? 0;
                    return (
                      <div
                        key={it.key}
                        className="border border-gray-200 rounded-lg p-3 relative"
                        style={{ borderTopColor: accent, borderTopWidth: 3 }}
                      >
                        <button
                          onClick={() => toggle(it.key)}
                          className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
                          aria-label={t.removeFromSelection}
                        >
                          <X size={12} />
                        </button>
                        <div className="flex items-center gap-1 mb-1">
                          <span
                            className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${
                              it.kind === "arcelik"
                                ? "bg-red-100 text-[#E30613]"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {it.kind === "arcelik" ? t.arcelikBadge : t.competitorBadge}
                          </span>
                          <span className="text-[9px] text-gray-500">
                            {getCategoryLabel(it.category, lang)}
                          </span>
                        </div>
                        <p className="font-bold text-[12px] text-[#0E2841] leading-tight pr-4">
                          {it.name}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{it.brand} · {it.modelCode}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          <span className="text-gray-400">{t.fieldSubcategory}:</span>{" "}
                          <span className={it.subcategory ? "" : "text-gray-300"}>
                            {it.subcategory ? getSubcategoryLabel(it.subcategory, lang) : t.notAvailable}
                          </span>
                        </p>
                        <p className="text-lg font-bold text-[#0E2841] mt-2">{fmt(it.price)}</p>
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              it.priceTier
                                ? "bg-indigo-50 text-indigo-700"
                                : "bg-gray-50 text-gray-400"
                            }`}
                          >
                            {t.fieldPriceTier}:{" "}
                            {it.priceTier ? getPriceTierLabel(it.priceTier, lang) : t.notAvailable}
                          </span>
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              it.energyClass
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-50 text-gray-400"
                            }`}
                          >
                            {t.fieldEnergyClass}: {it.energyClass ?? t.notAvailable}
                          </span>
                          {it.capacity && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                              {it.capacity}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Sparkles size={11} className="text-amber-500" />
                          <span className="text-[10px] font-semibold text-gray-700">
                            {t.fieldValueScore}: {score}
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">
                            {t.fieldSmartFeatures}
                          </p>
                          {it.smartFeatures.length === 0 ? (
                            <p className="text-[10px] text-gray-400 leading-snug flex items-center gap-1">
                              <Minus size={10} className="flex-shrink-0" /> {t.notAvailable}
                            </p>
                          ) : (
                            <ul className="space-y-0.5">
                              {it.smartFeatures.slice(0, 4).map((f, i) => (
                                <li
                                  key={i}
                                  className="text-[10px] text-gray-700 leading-snug flex items-start gap-1"
                                >
                                  <Check size={9} className="text-green-600 mt-0.5 flex-shrink-0" />
                                  <span className="truncate">{f}</span>
                                </li>
                              ))}
                              {it.smartFeatures.length > 4 && (
                                <li className="text-[9px] text-gray-400 pl-3">
                                  +{it.smartFeatures.length - 4}
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Feature matrix */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-x-auto">
                <h3 className="text-sm font-bold text-[#0E2841] mb-3">{t.matrixTitle}</h3>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                      <th className="px-3 py-2 w-40">&nbsp;</th>
                      {selectedItems.map((it, idx) => (
                        <th
                          key={it.key}
                          className="px-3 py-2"
                          style={{ color: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                        >
                          {it.brand} · {it.modelCode}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldBrand}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell key={it.key} value={it.brand} />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldCategory}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell key={it.key} value={getCategoryLabel(it.category, lang)} />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldSubcategory}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell
                          key={it.key}
                          value={it.subcategory ? getSubcategoryLabel(it.subcategory, lang) : t.notAvailable}
                        />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldPrice}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell
                          key={it.key}
                          value={fmt(it.price)}
                          isBest={it.price === priceExt.best && priceExt.best !== priceExt.worst}
                          isWorst={it.price === priceExt.worst && priceExt.best !== priceExt.worst}
                        />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldPriceTier}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell
                          key={it.key}
                          value={it.priceTier ? getPriceTierLabel(it.priceTier, lang) : t.notAvailable}
                        />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldEnergyClass}</td>
                      {selectedItems.map((it, idx) => {
                        const rank = energyRanks[idx];
                        return (
                          <MatrixCell
                            key={it.key}
                            value={it.energyClass ?? t.notAvailable}
                            isBest={rank !== null && rank === energyExt.best && energyExt.best !== energyExt.worst}
                            isWorst={rank !== null && rank === energyExt.worst && energyExt.best !== energyExt.worst}
                          />
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldCapacity}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell key={it.key} value={it.capacity || t.notAvailable} />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldWarranty}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell
                          key={it.key}
                          value={it.warrantyYears ? `${it.warrantyYears} ${t.yearWarranty}` : t.notAvailable}
                          isBest={it.warrantyYears !== null && it.warrantyYears === warrantyExt.best && warrantyExt.best !== warrantyExt.worst}
                        />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldFeatureCount}</td>
                      {selectedItems.map((it) => (
                        <MatrixCell
                          key={it.key}
                          value={it.features.length}
                          isBest={it.features.length === fcExt.best && fcExt.best !== fcExt.worst}
                          isWorst={it.features.length === fcExt.worst && fcExt.best !== fcExt.worst}
                        />
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldSmartFeatures}</td>
                      {selectedItems.map((it) => (
                        <td key={it.key} className="px-3 py-2 border-t border-gray-100">
                          {it.smartFeatures.length === 0 ? (
                            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                              <Minus size={11} /> {t.notAvailable}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {it.smartFeatures.map((f, i) => (
                                <span
                                  key={i}
                                  className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] rounded-full"
                                >
                                  <Check size={9} className="inline mr-0.5" />
                                  {f}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-[11px] font-semibold text-gray-500 border-t border-gray-100">{t.fieldValueScore}</td>
                      {selectedItems.map((it, idx) => {
                        const score = valueScores[it.key] ?? 0;
                        return (
                          <MatrixCell
                            key={it.key}
                            value={score}
                            isBest={score === valueExt.best && valueExt.best !== valueExt.worst}
                            isWorst={score === valueExt.worst && valueExt.best !== valueExt.worst}
                          />
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Per-feature matrix: union of features as rows, check/dash per item */}
              {featureUnion.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-x-auto">
                  <h3 className="text-sm font-bold text-[#0E2841]">{t.perFeatureMatrixTitle}</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5 mb-3">{t.perFeatureMatrixHint}</p>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                        <th className="px-3 py-2 w-1/3">&nbsp;</th>
                        {selectedItems.map((it, idx) => (
                          <th
                            key={it.key}
                            className="px-3 py-2 text-center"
                            style={{ color: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                          >
                            {it.brand} · {it.modelCode}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {featureUnion.map((feature) => {
                        const presence = selectedItems.map((it) => it.features.includes(feature));
                        const presentCount = presence.filter(Boolean).length;
                        const isUniqueAdvantage = presentCount === 1 && selectedItems.length > 1;
                        return (
                          <tr key={feature}>
                            <td
                              className={`px-3 py-2 text-[11px] border-t border-gray-100 ${
                                isUniqueAdvantage ? "font-semibold text-[#0E2841]" : "text-gray-700"
                              }`}
                            >
                              {feature}
                              {isUniqueAdvantage && (
                                <Sparkles size={10} className="inline ml-1 text-amber-500" />
                              )}
                            </td>
                            {selectedItems.map((it, idx) => {
                              const has = it.features.includes(feature);
                              const accent = COMPARE_COLORS[idx % COMPARE_COLORS.length];
                              return (
                                <td
                                  key={it.key}
                                  className={`px-3 py-2 text-center border-t border-gray-100 ${
                                    has ? "bg-green-50/60" : ""
                                  }`}
                                >
                                  {has ? (
                                    <span
                                      title={t.featurePresent}
                                      className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                                      style={{ backgroundColor: `${accent}22`, color: accent }}
                                    >
                                      <Check size={12} strokeWidth={3} />
                                    </span>
                                  ) : (
                                    <span
                                      title={t.featureAbsent}
                                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-50 text-gray-300"
                                    >
                                      <Minus size={12} />
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Price position bar chart */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-bold text-[#0E2841] mb-1">{t.priceChartTitle}</h3>
                  <p className="text-[10px] text-gray-500 mb-2">{t.versusAvg} ({fmt(Math.round(Object.values(categoryAvgPrices).reduce((s, x) => s + x, 0) / Math.max(1, Object.keys(categoryAvgPrices).length)))})</p>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={pricePositionData} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`} />
                        <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                        <Bar dataKey="delta" radius={[4, 4, 0, 0]}>
                          {pricePositionData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Value score bar chart */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-bold text-[#0E2841] mb-1">{t.valueTitle}</h3>
                  <p className="text-[10px] text-gray-500 mb-2">{t.valueHint}</p>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={valueChartData} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                        <Tooltip formatter={(v: number) => `${v}/100`} />
                        <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                          {valueChartData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Price history overlay */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-bold text-[#0E2841] mb-3">{t.historyTitle}</h3>
                {hasMeaningfulHistory ? (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historyChartData} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₺${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {selectedItems.map((it, idx) => (
                          <Line
                            key={it.key}
                            type="monotone"
                            dataKey={it.key}
                            name={it.name.length > 28 ? it.name.slice(0, 27) + "…" : it.name}
                            stroke={COMPARE_COLORS[idx % COMPARE_COLORS.length]}
                            strokeWidth={2}
                            dot={{ r: 2 }}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[120px] flex items-center justify-center text-[12px] text-gray-400">
                    {t.historyEmpty}
                  </div>
                )}
              </div>

              {/* Best alternative recommendation */}
              <AnimatePresence>
                {bestItem && (
                  <motion.div
                    key={bestItem.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="bg-gradient-to-r from-amber-50 via-orange-50 to-yellow-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start"
                  >
                    <div className="bg-amber-400 text-white rounded-lg p-2 flex-shrink-0">
                      <Award size={20} />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-amber-900 uppercase tracking-wide mb-1">
                        {t.bestAlternativeTitle}
                      </p>
                      {(() => {
                        const avg = categoryAvgPrices[bestItem.category] ?? bestItem.price;
                        const deltaPct = avg > 0 ? Math.round(((bestItem.price - avg) / avg) * 100) : 0;
                        const pricePos =
                          deltaPct < -2
                            ? `%${Math.abs(deltaPct)} ${t.bestAlternativeBelow}`
                            : deltaPct > 2
                            ? `%${deltaPct} ${t.bestAlternativeAbove}`
                            : t.bestAlternativeOnPar;
                        const body = t.bestAlternativeBody
                          .replace("{name}", bestItem.name)
                          .replace("{pricePos}", pricePos)
                          .replace("{energy}", bestItem.energyClass ?? t.notAvailable)
                          .replace("{features}", String(bestItem.features.length));
                        return (
                          <p className="text-[12px] text-amber-900 leading-relaxed">{body}</p>
                        );
                      })()}
                      <div className="flex items-center gap-3 mt-2 text-[11px]">
                        <span className="font-bold text-amber-900">
                          {t.fieldValueScore}: {valueScores[bestItem.key]}/100
                        </span>
                        <span className="text-amber-700 inline-flex items-center gap-1">
                          {(categoryAvgPrices[bestItem.category] ?? bestItem.price) >= bestItem.price ? (
                            <TrendingDown size={11} />
                          ) : (
                            <TrendingUp size={11} />
                          )}
                          {fmt(bestItem.price)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
