import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
  BarChart, Bar, Legend,
} from "recharts";
import {
  Crosshair, Lightbulb, TrendingUp, AlertTriangle,
  Target, Layers, Sparkles, Grid3x3, MapPin, ListChecks,
} from "lucide-react";
import { useDemoLang } from "../DemoLangContext";
import { whitespace } from "../demo-i18n";
import { TurkeyMap, CITY_POSITIONS } from "../TurkeyMap";
import {
  CATEGORY_LABELS, getCategoryLabel,
  getPriceTierLabel,
  type ProductCategory, type PriceTier,
  type ArcelikProduct, type CompetitorPrice, type CityData,
} from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";

const TIER_ORDER: PriceTier[] = ["entry", "mid", "premium"];
const TIER_COLORS: Record<PriceTier, string> = { entry: "#22c55e", mid: "#f59e0b", premium: "#8b5cf6" };
const CAT_COLORS: Record<string, string> = {
  buzdolabi: "#E30613", camasir: "#2563eb", bulasik: "#059669",
  firin: "#d97706", klima: "#0891b2", "kucuk-ev": "#7c3aed", "tv-elektronik": "#ec4899",
};

const tierFromPositioning = (pos: "value" | "mid" | "premium"): PriceTier =>
  pos === "value" ? "entry" : pos === "mid" ? "mid" : "premium";

const fmt = (n: number) => "₺" + n.toLocaleString("tr-TR");

interface GapOpportunity {
  id: string;
  category: ProductCategory;
  tier: PriceTier;
  gapType: "no-product" | "price-gap" | "competitor-dominated";
  title: string;
  description: string;
  estimatedRevenue: string;
  confidence: number;
  competitorCount: number;
  avgCompPrice: number;
  arcelikProductCount: number;
}

function findWhitespaceOpportunities(
  products: ArcelikProduct[],
  competitorPrices: CompetitorPrice[],
  lang: "tr" | "en",
): GapOpportunity[] {
  const cats = Object.keys(CATEGORY_LABELS) as ProductCategory[];
  const opportunities: GapOpportunity[] = [];

  for (const cat of cats) {
    const catProducts = products.filter(p => p.category === cat);
    const catComps = competitorPrices.filter(c => c.category === cat);

    for (const tier of TIER_ORDER) {
      const tierProducts = catProducts.filter(p => p.priceTier === tier);
      const tierComps = catComps.filter(c => tierFromPositioning(c.positioning) === tier);

      if (tierProducts.length === 0 && tierComps.length > 0) {
        const avgPrice = Math.round(tierComps.reduce((s, c) => s + c.competitorPrice, 0) / tierComps.length);
        opportunities.push({
          id: `gap-${cat}-${tier}`,
          category: cat,
          tier,
          gapType: "no-product",
          title: lang === "tr"
            ? `${getCategoryLabel(cat, "tr")} — ${getPriceTierLabel(tier, "tr")} Segment Boşluğu`
            : `${getCategoryLabel(cat, "en")} — ${getPriceTierLabel(tier, "en")} Segment Gap`,
          description: lang === "tr"
            ? `Bu segmentte Arçelik ürünü bulunmuyor. ${tierComps.length} rakip ürün mevcut.`
            : `No Arçelik product in this segment. ${tierComps.length} competitor products exist.`,
          estimatedRevenue: `+₺${Math.round(avgPrice * 0.05 / 1000)}M`,
          confidence: 85,
          competitorCount: tierComps.length,
          avgCompPrice: avgPrice,
          arcelikProductCount: 0,
        });
      }

      if (tierProducts.length > 0 && tierComps.length >= 3) {
        const avgArcelik = Math.round(tierProducts.reduce((s, p) => s + p.tsfPrice, 0) / tierProducts.length);
        const avgComp = Math.round(tierComps.reduce((s, c) => s + c.competitorPrice, 0) / tierComps.length);
        const gap = Math.round(((avgComp - avgArcelik) / avgArcelik) * 100);

        if (gap > 15) {
          opportunities.push({
            id: `pgap-${cat}-${tier}`,
            category: cat,
            tier,
            gapType: "price-gap",
            title: lang === "tr"
              ? `${getCategoryLabel(cat, "tr")} — Fiyat Artış Fırsatı`
              : `${getCategoryLabel(cat, "en")} — Price Increase Opportunity`,
            description: lang === "tr"
              ? `Rakipler ortalama %${gap} daha pahalı. Fiyat artışı alanı mevcut.`
              : `Competitors are ${gap}% more expensive on average. Room for price increase.`,
            estimatedRevenue: `+₺${Math.round(avgArcelik * gap * 0.001 / 1000)}M`,
            confidence: 78,
            competitorCount: tierComps.length,
            avgCompPrice: avgComp,
            arcelikProductCount: tierProducts.length,
          });
        }

        if (tierComps.length > tierProducts.length * 3) {
          opportunities.push({
            id: `dom-${cat}-${tier}`,
            category: cat,
            tier,
            gapType: "competitor-dominated",
            title: lang === "tr"
              ? `${getCategoryLabel(cat, "tr")} — Rakip Yoğunluğu Yüksek`
              : `${getCategoryLabel(cat, "en")} — High Competitor Density`,
            description: lang === "tr"
              ? `${tierComps.length} rakip vs ${tierProducts.length} Arçelik ürünü. Ürün çeşitliliği artırılabilir.`
              : `${tierComps.length} competitors vs ${tierProducts.length} Arçelik products. Product variety can be increased.`,
            estimatedRevenue: `+₺${Math.round(tierProducts.reduce((s, p) => s + p.tsfPrice, 0) * 0.03 / 1000)}M`,
            confidence: 72,
            competitorCount: tierComps.length,
            avgCompPrice: avgComp,
            arcelikProductCount: tierProducts.length,
          });
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.confidence - a.confidence);
}

interface MatrixCell {
  cat: ProductCategory;
  tier: PriceTier;
  arcelikCount: number;
  compCount: number;
  arcelikProducts: ArcelikProduct[];
  compPrices: CompetitorPrice[];
  density: "empty" | "low" | "mid" | "high";
}

function buildMatrix(products: ArcelikProduct[], competitorPrices: CompetitorPrice[]): MatrixCell[] {
  const cats = Object.keys(CATEGORY_LABELS) as ProductCategory[];
  const cells: MatrixCell[] = [];
  for (const cat of cats) {
    for (const tier of TIER_ORDER) {
      const arcelikProducts = products.filter(p => p.category === cat && p.priceTier === tier);
      const compPrices = competitorPrices.filter(c => c.category === cat && tierFromPositioning(c.positioning) === tier);
      let density: MatrixCell["density"] = "empty";
      if (arcelikProducts.length === 0) density = "empty";
      else if (arcelikProducts.length <= 2) density = "low";
      else if (arcelikProducts.length <= 5) density = "mid";
      else density = "high";
      cells.push({ cat, tier, arcelikCount: arcelikProducts.length, compCount: compPrices.length, arcelikProducts, compPrices, density });
    }
  }
  return cells;
}

const FEATURE_KEYWORDS: { tr: string; en: string; match: RegExp }[] = [
  { tr: "İnverter", en: "Inverter", match: /inverter|invertėr|i̇nverter/i },
  { tr: "Wi-Fi / Akıllı", en: "Wi-Fi / Smart", match: /wi-?fi|homewhiz|smart|akıllı|app/i },
  { tr: "A+++ Enerji", en: "A+++ Energy", match: /a\+\+\+|a3\+|en[ae]rji a\+\+\+/i },
  { tr: "Buharlı Yıkama", en: "Steam Wash", match: /buhar|steam/i },
  { tr: "No-Frost", en: "No-Frost", match: /no-?frost/i },
  { tr: "Dokunmatik Ekran", en: "Touchscreen", match: /dokunmatik|touch|tft|full[- ]touch/i },
  { tr: "Sessiz Çalışma", en: "Quiet Operation", match: /sessiz|quiet|silent|<?\s*\d{2}\s*db/i },
  { tr: "Hızlı Yıkama", en: "Quick Wash", match: /hızlı|quick|express/i },
  { tr: "Otomatik Buz", en: "Auto Ice", match: /buz makinesi|ice maker|otomatik buz/i },
  { tr: "Hava Temizleme", en: "Air Purify", match: /hava temizleme|air purif|ionizer|iyon/i },
];

interface FeatureCoverage {
  feature: string;
  arcelikTiers: Set<PriceTier>;
  compTiers: Set<PriceTier>;
}

function analyzeFeatureCoverage(
  products: ArcelikProduct[],
  competitorPrices: CompetitorPrice[],
  category: ProductCategory,
  lang: "tr" | "en",
): FeatureCoverage[] {
  const catProducts = products.filter(p => p.category === category);
  const catComps = competitorPrices.filter(c => c.category === category);

  return FEATURE_KEYWORDS.map(kw => {
    const arcelikTiers = new Set<PriceTier>();
    const compTiers = new Set<PriceTier>();
    for (const p of catProducts) {
      if (p.features.some(f => kw.match.test(f))) arcelikTiers.add(p.priceTier);
    }
    for (const c of catComps) {
      if (kw.match.test(c.note || "") || kw.match.test(c.competitorModel || "")) {
        compTiers.add(tierFromPositioning(c.positioning));
      }
    }
    return { feature: lang === "tr" ? kw.tr : kw.en, arcelikTiers, compTiers };
  });
}

interface CityOpportunity {
  city: CityData;
  score: number;
  level: "high" | "mid" | "low";
}

function scoreCities(cities: CityData[]): CityOpportunity[] {
  const popWeight: Record<CityData["populationTier"], number> = { "tier-1": 100, "tier-2": 65, "tier-3": 35 };
  return cities
    .map(city => {
      const popScore = popWeight[city.populationTier];
      const shareGap = Math.max(0, 100 - city.marketSharePercent);
      const compMax = city.competitorStrength.length > 0
        ? Math.max(...city.competitorStrength.map(c => c.strength))
        : 0;
      const score = Math.round((shareGap * 0.5 + popScore * 0.35 + compMax * 0.15));
      const level: CityOpportunity["level"] = score >= 80 ? "high" : score >= 60 ? "mid" : "low";
      return { city, score, level };
    })
    .sort((a, b) => b.score - a.score);
}

function OpportunityCard({ opp, lang }: { opp: GapOpportunity; lang: "tr" | "en" }) {
  const t = whitespace[lang];
  const typeConfig = {
    "no-product": { icon: Target, color: "text-red-600", bg: "bg-red-50", border: "border-red-200", label: t.gapNoProduct },
    "price-gap": { icon: TrendingUp, color: "text-green-600", bg: "bg-green-50", border: "border-green-200", label: t.gapPriceGap },
    "competitor-dominated": { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", label: t.gapCompDominated },
  };
  const cfg = typeConfig[opp.gapType];
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg bg-white/80 ${cfg.color}`}>
            <Icon size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[9px] font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[9px] text-gray-400 px-1.5 py-0.5 bg-white/60 rounded-full">
                {getPriceTierLabel(opp.tier, lang)}
              </span>
            </div>
            <h3 className="font-bold text-[#0E2841] text-sm">{opp.title}</h3>
            <p className="text-[11px] text-gray-600 mt-1">{opp.description}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-green-600">{opp.estimatedRevenue}</p>
          <p className="text-[10px] text-gray-500">{t.estRevenue}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/50">
        <div className="text-[10px] text-gray-600">
          <span className="font-semibold">{opp.competitorCount}</span> {t.competitorsInSegment}
        </div>
        {opp.avgCompPrice > 0 && (
          <div className="text-[10px] text-gray-600">
            {t.avgPrice}: <span className="font-semibold">{fmt(opp.avgCompPrice)}</span>
          </div>
        )}
        <div className="text-[10px] text-gray-600">
          {t.confidence}: <span className="font-semibold">%{opp.confidence}</span>
        </div>
        {opp.arcelikProductCount > 0 && (
          <div className="text-[10px] text-gray-600">
            Arçelik: <span className="font-semibold">{opp.arcelikProductCount}</span> {t.products}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function densityClass(d: MatrixCell["density"]): string {
  switch (d) {
    case "empty": return "bg-red-100 border-red-300 text-red-700";
    case "low": return "bg-amber-50 border-amber-200 text-amber-700";
    case "mid": return "bg-emerald-50 border-emerald-200 text-emerald-700";
    case "high": return "bg-emerald-100 border-emerald-300 text-emerald-800";
  }
}

function levelDotColor(level: CityOpportunity["level"]): string {
  return level === "high" ? "#dc2626" : level === "mid" ? "#f59e0b" : "#10b981";
}

export default function WhitespaceView() {
  const { lang } = useDemoLang();
  const t = whitespace[lang];
  const { products, competitorPrices, cities } = useArcelikData();
  const [selectedCat, setSelectedCat] = useState<ProductCategory | "all">("all");
  const [selectedCell, setSelectedCell] = useState<{ cat: ProductCategory; tier: PriceTier } | null>(null);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);

  const opportunities = useMemo(
    () => findWhitespaceOpportunities(products, competitorPrices, lang),
    [products, competitorPrices, lang],
  );

  const filteredOpps = useMemo(() => {
    if (selectedCat === "all") return opportunities;
    return opportunities.filter(o => o.category === selectedCat);
  }, [opportunities, selectedCat]);

  const matrix = useMemo(() => buildMatrix(products, competitorPrices), [products, competitorPrices]);

  const featureCategory: ProductCategory = selectedCat === "all" ? "buzdolabi" : selectedCat;
  const featureCoverage = useMemo(
    () => analyzeFeatureCoverage(products, competitorPrices, featureCategory, lang),
    [products, competitorPrices, featureCategory, lang],
  );

  const cityOpps = useMemo(() => scoreCities(cities), [cities]);
  const mappedCities = useMemo(
    () => cityOpps.filter(co => CITY_POSITIONS[co.city.id]),
    [cityOpps],
  );

  const bubbleData = useMemo(() => {
    const cats = Object.keys(CATEGORY_LABELS) as ProductCategory[];
    return cats.map(cat => {
      const catProducts = products.filter(p => p.category === cat);
      const catComps = competitorPrices.filter(c => c.category === cat);
      const arcelikCount = catProducts.length;
      const compCount = catComps.length;
      const avgPrice = catProducts.length > 0
        ? Math.round(catProducts.reduce((s, p) => s + p.tsfPrice, 0) / catProducts.length) / 1000
        : 0;
      const catOpps = opportunities.filter(o => o.category === cat);
      return {
        name: getCategoryLabel(cat, lang),
        cat,
        arcelikCount,
        compCount,
        avgPrice,
        opportunities: catOpps.length,
        size: catOpps.length * 30 + 50,
      };
    });
  }, [products, competitorPrices, opportunities, lang]);

  const tierDistribution = useMemo(() => {
    const cats = (selectedCat === "all" ? Object.keys(CATEGORY_LABELS) : [selectedCat]) as ProductCategory[];
    return cats.map(cat => {
      const catProducts = products.filter(p => p.category === cat);
      return {
        name: getCategoryLabel(cat, lang),
        entry: catProducts.filter(p => p.priceTier === "entry").length,
        mid: catProducts.filter(p => p.priceTier === "mid").length,
        premium: catProducts.filter(p => p.priceTier === "premium").length,
      };
    });
  }, [products, selectedCat, lang]);

  const totalRevenue = useMemo(() => {
    const nums = filteredOpps.map(o => {
      const m = o.estimatedRevenue.match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    });
    return nums.reduce((s, n) => s + n, 0);
  }, [filteredOpps]);

  const selectedCellData = useMemo(() => {
    if (!selectedCell) return null;
    return matrix.find(c => c.cat === selectedCell.cat && c.tier === selectedCell.tier) || null;
  }, [selectedCell, matrix]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
            <Crosshair size={20} /> {t.title}
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{t.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.totalOpps}</p>
          <p className="text-xl font-bold text-[#0E2841]">{filteredOpps.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.noProductGaps}</p>
          <p className="text-xl font-bold text-red-600">{filteredOpps.filter(o => o.gapType === "no-product").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.priceGaps}</p>
          <p className="text-xl font-bold text-green-600">{filteredOpps.filter(o => o.gapType === "price-gap").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">{t.estTotalRevenue}</p>
          <p className="text-xl font-bold text-green-600">+₺{totalRevenue}M</p>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setSelectedCat("all")}
          className={`px-3 py-1 text-[10px] rounded-full border transition-colors ${
            selectedCat === "all" ? "bg-[#0E2841] text-white border-[#0E2841]" : "border-gray-200 text-gray-600 hover:border-gray-400"
          }`}
        >
          {t.allCategories}
        </button>
        {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCat(cat)}
            className={`px-3 py-1 text-[10px] rounded-full border transition-colors ${
              selectedCat === cat ? "bg-[#0E2841] text-white border-[#0E2841]" : "border-gray-200 text-gray-600 hover:border-gray-400"
            }`}
          >
            {getCategoryLabel(cat, lang)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-[#0E2841] flex items-center gap-2">
                <Grid3x3 size={14} /> {t.matrixTitle}
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">{t.matrixSubtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-[9px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-100 border border-red-300" /> 0</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-50 border border-amber-200" /> {t.matrixDensityLow}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-50 border border-emerald-200" /> {t.matrixDensityMid}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-100 border border-emerald-300" /> {t.matrixDensityHigh}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-semibold text-gray-500 px-2 py-1"></th>
                  {TIER_ORDER.map(tier => (
                    <th key={tier} className="text-[10px] font-semibold text-gray-600 px-2 py-1 text-center">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIER_COLORS[tier] }} />
                        {getPriceTierLabel(tier, lang)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map(cat => (
                  <tr key={cat}>
                    <td className="text-[10px] font-semibold text-[#0E2841] pr-2 py-1 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: CAT_COLORS[cat] || "#6b7280" }} />
                        {getCategoryLabel(cat, lang)}
                      </span>
                    </td>
                    {TIER_ORDER.map(tier => {
                      const cell = matrix.find(c => c.cat === cat && c.tier === tier)!;
                      const isSelected = selectedCell?.cat === cat && selectedCell?.tier === tier;
                      return (
                        <td key={tier} className="p-0">
                          <button
                            onClick={() => setSelectedCell(isSelected ? null : { cat, tier })}
                            className={`w-full px-2 py-2 rounded border text-[10px] font-semibold transition-all ${densityClass(cell.density)} ${
                              isSelected ? "ring-2 ring-[#0E2841] ring-offset-1" : "hover:opacity-80"
                            }`}
                            title={`${t.matrixArcelikLabel}: ${cell.arcelikCount}, ${t.matrixCompLabel}: ${cell.compCount}`}
                          >
                            <div className="flex items-center justify-center gap-2">
                              <span>{cell.arcelikCount}</span>
                              <span className="text-[8px] opacity-60">/ {cell.compCount}</span>
                            </div>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-[#0E2841] mb-3 flex items-center gap-2">
            <Target size={14} /> {t.matrixSelectedHeader}
          </h3>
          {!selectedCellData && (
            <div className="text-center py-8 text-gray-400">
              <Grid3x3 size={28} className="mx-auto mb-2 opacity-50" />
              <p className="text-[11px]">{t.selectCellHint}</p>
            </div>
          )}
          {selectedCellData && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: CAT_COLORS[selectedCellData.cat] || "#6b7280" }}>
                  {getCategoryLabel(selectedCellData.cat, lang)}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style={{ color: TIER_COLORS[selectedCellData.tier], borderColor: TIER_COLORS[selectedCellData.tier] }}>
                  {getPriceTierLabel(selectedCellData.tier, lang)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-[9px] text-gray-500">{t.matrixArcelikLabel}</p>
                  <p className="text-base font-bold text-[#0E2841]">{selectedCellData.arcelikCount}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-[9px] text-gray-500">{t.matrixCompLabel}</p>
                  <p className="text-base font-bold text-[#0E2841]">{selectedCellData.compCount}</p>
                </div>
              </div>
              {selectedCellData.arcelikProducts.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-600 mb-1">{t.closestArcelikProducts}</p>
                  <ul className="space-y-1">
                    {selectedCellData.arcelikProducts.slice(0, 3).map(p => (
                      <li key={p.id} className="text-[10px] text-gray-700 flex justify-between gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="text-gray-500 shrink-0">{fmt(p.tsfPrice)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedCellData.compPrices.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-600 mb-1">{t.competitorsInCell}</p>
                  <ul className="space-y-1">
                    {selectedCellData.compPrices.slice(0, 3).map(c => (
                      <li key={c.id} className="text-[10px] text-gray-700 flex justify-between gap-2">
                        <span className="truncate"><span className="font-semibold">{c.brand}</span> · {c.competitorModel}</span>
                        <span className="text-gray-500 shrink-0">{fmt(c.competitorPrice)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedCellData.arcelikCount === 0 && (
                <p className="text-[10px] text-red-600 italic">{t.noProducts}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-[#0E2841] flex items-center gap-2">
              <ListChecks size={14} /> {t.featureTitle} —{" "}
              <span className="text-[12px] text-gray-600">{getCategoryLabel(featureCategory, lang)}</span>
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">{t.featureSubtitle}</p>
          </div>
          {selectedCat === "all" && (
            <p className="text-[10px] text-gray-400 italic">{t.featureSelectCategory}</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="text-left font-semibold py-2 px-2">{t.featureCol}</th>
                {TIER_ORDER.map(tier => (
                  <th key={tier} className="text-center font-semibold py-2 px-2">{getPriceTierLabel(tier, lang)}</th>
                ))}
                <th className="text-center font-semibold py-2 px-2">{t.featureUnservedHeader}</th>
              </tr>
            </thead>
            <tbody>
              {featureCoverage.map(fc => {
                const unservedTiers = TIER_ORDER.filter(tier => !fc.arcelikTiers.has(tier) && !fc.compTiers.has(tier));
                return (
                  <tr key={fc.feature} className="border-b border-gray-100">
                    <td className="py-2 px-2 font-medium text-[#0E2841]">{fc.feature}</td>
                    {TIER_ORDER.map(tier => {
                      const a = fc.arcelikTiers.has(tier);
                      const c = fc.compTiers.has(tier);
                      let bg = "bg-red-50 text-red-600 border-red-200";
                      let label = "—";
                      if (a) { bg = "bg-emerald-100 text-emerald-700 border-emerald-200"; label = "✓ A"; }
                      else if (c) { bg = "bg-amber-50 text-amber-700 border-amber-200"; label = "○ C"; }
                      return (
                        <td key={tier} className="py-1 px-1 text-center">
                          <span className={`inline-flex items-center justify-center w-12 px-2 py-0.5 rounded-full border text-[9px] font-semibold ${bg}`}>
                            {label}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 text-center">
                      {unservedTiers.length === 0 ? (
                        <span className="text-gray-400 text-[10px]">—</span>
                      ) : (
                        <span className="inline-flex flex-wrap gap-1 justify-center">
                          {unservedTiers.map(tier => (
                            <span key={tier} className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-semibold">
                              {getPriceTierLabel(tier, lang)}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 mt-3 text-[9px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-100 border border-emerald-200" /> {t.featureCoveredArcelik}</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-50 border border-amber-200" /> {t.featureCoveredCompOnly}</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-50 border border-red-200" /> {t.featureUnservedHeader}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-[#0E2841] flex items-center gap-2">
                <MapPin size={14} /> {t.geoTitle}
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">{t.geoSubtitle}</p>
            </div>
            <div className="flex items-center gap-2 text-[9px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600" /> {t.geoScoreHigh}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> {t.geoScoreMid}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {t.geoScoreLow}</span>
            </div>
          </div>
          <TurkeyMap viewBox="0 -10 650 205" className="w-full h-auto">
            {mappedCities.map(co => {
              const pos = CITY_POSITIONS[co.city.id];
              const r = co.level === "high" ? 6 : co.level === "mid" ? 4.5 : 3.5;
              const color = levelDotColor(co.level);
              const isHovered = hoveredCity === co.city.id;
              return (
                <g key={co.city.id} onMouseEnter={() => setHoveredCity(co.city.id)} onMouseLeave={() => setHoveredCity(null)} style={{ cursor: "pointer" }}>
                  <circle cx={pos.x} cy={pos.y} r={r + 3} fill={color} fillOpacity={0.18} />
                  <circle cx={pos.x} cy={pos.y} r={r} fill={color} fillOpacity={0.85} stroke="#fff" strokeWidth={0.6} />
                  {(isHovered || co.level === "high") && (
                    <text x={pos.x} y={pos.y - r - 1.5} textAnchor="middle" fontSize="3.6" fontWeight="700" fill="#0E2841">
                      {co.city.name}
                    </text>
                  )}
                  {isHovered && (
                    <g>
                      <rect x={pos.x + 8} y={pos.y - 12} width={48} height={20} rx={2} fill="#0E2841" fillOpacity={0.95} />
                      <text x={pos.x + 10} y={pos.y - 5} fontSize="3.5" fill="#fff" fontWeight="700">{co.city.name}</text>
                      <text x={pos.x + 10} y={pos.y - 0.5} fontSize="3" fill="#fff">{t.geoOppScore}: {co.score}</text>
                      <text x={pos.x + 10} y={pos.y + 4} fontSize="3" fill="#fff">{t.geoMarketShare}: %{co.city.marketSharePercent}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </TurkeyMap>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-[#0E2841] mb-3 flex items-center gap-2">
            <Sparkles size={14} /> {t.geoTopCities}
          </h3>
          <div className="space-y-2">
            {cityOpps.slice(0, 6).map(co => (
              <div
                key={co.city.id}
                onMouseEnter={() => setHoveredCity(co.city.id)}
                onMouseLeave={() => setHoveredCity(null)}
                className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-colors cursor-pointer ${
                  hoveredCity === co.city.id ? "border-[#0E2841] bg-gray-50" : "border-gray-100 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: levelDotColor(co.level) }} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#0E2841] truncate">{co.city.name}</p>
                    <p className="text-[9px] text-gray-500">
                      {t.geoMarketShare}: %{co.city.marketSharePercent} · {co.city.dealerCount} {t.geoDealers}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-bold text-[#0E2841]">{co.score}</p>
                  <p className="text-[9px] text-gray-400">/100</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-[#0E2841] mb-3 flex items-center gap-2">
            <Layers size={14} /> {t.tierDistTitle}
          </h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tierDistribution} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="entry" name={getPriceTierLabel("entry", lang)} fill={TIER_COLORS.entry} radius={[2, 2, 0, 0]} />
                <Bar dataKey="mid" name={getPriceTierLabel("mid", lang)} fill={TIER_COLORS.mid} radius={[2, 2, 0, 0]} />
                <Bar dataKey="premium" name={getPriceTierLabel("premium", lang)} fill={TIER_COLORS.premium} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-[#0E2841] mb-3 flex items-center gap-2">
            <Sparkles size={14} /> {t.oppMapTitle}
          </h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  type="number" dataKey="arcelikCount" name={t.arcelikProducts}
                  tick={{ fontSize: 10 }}
                  label={{ value: t.arcelikProducts, position: "bottom", fontSize: 10 }}
                />
                <YAxis
                  type="number" dataKey="compCount" name={t.compProducts}
                  tick={{ fontSize: 10 }}
                  label={{ value: t.compProducts, angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <ZAxis type="number" dataKey="size" range={[50, 300]} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white shadow-lg rounded-lg p-3 border text-[11px]">
                        <p className="font-bold text-[#0E2841]">{d.name}</p>
                        <p>Arçelik: {d.arcelikCount} {t.products}</p>
                        <p>{t.compProducts}: {d.compCount}</p>
                        <p>{t.opportunities}: {d.opportunities}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={bubbleData}>
                  {bubbleData.map((entry, i) => (
                    <Cell key={i} fill={CAT_COLORS[entry.cat] || "#6b7280"} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-[#0E2841] mb-3 flex items-center gap-2">
          <Lightbulb size={14} /> {t.oppListTitle}
          <span className="text-[10px] font-normal text-gray-500">({filteredOpps.length} {t.opportunities})</span>
        </h3>
        <div className="space-y-3">
          {filteredOpps.map(opp => (
            <OpportunityCard key={opp.id} opp={opp} lang={lang} />
          ))}
        </div>
        {filteredOpps.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Crosshair size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t.noOpportunities}</p>
          </div>
        )}
      </div>
    </div>
  );
}
