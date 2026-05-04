import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
  BarChart, Bar, Legend,
} from "recharts";
import {
  Crosshair, Lightbulb, TrendingUp, AlertTriangle,
  Target, Layers, ArrowRight, Sparkles,
} from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import { useDemoLang } from "../DemoLangContext";
import { whitespace } from "../demo-i18n";
import {
  COMPETITOR_BRANDS, CATEGORY_LABELS, getCategoryLabel,
  getSubcategoryLabel, getPriceTierLabel,
  type ProductCategory, type PriceTier,
} from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";

const TIER_ORDER: PriceTier[] = ["entry", "mid", "premium"];
const TIER_COLORS: Record<PriceTier, string> = { entry: "#22c55e", mid: "#f59e0b", premium: "#8b5cf6" };
const CAT_COLORS: Record<string, string> = {
  buzdolabi: "#E30613", camasir: "#2563eb", bulasik: "#059669",
  firin: "#d97706", klima: "#0891b2", "kucuk-ev": "#7c3aed", "tv-elektronik": "#ec4899",
};

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
  products: ReturnType<typeof useArcelikData>["products"],
  competitorPrices: ReturnType<typeof useArcelikData>["competitorPrices"],
  lang: "tr" | "en",
): GapOpportunity[] {
  const cats = Object.keys(CATEGORY_LABELS) as ProductCategory[];
  const opportunities: GapOpportunity[] = [];

  for (const cat of cats) {
    const catProducts = products.filter(p => p.category === cat);
    const catComps = competitorPrices.filter(c => c.category === cat);

    for (const tier of TIER_ORDER) {
      const tierProducts = catProducts.filter(p => p.priceTier === tier);
      const tierComps = catComps.filter(c => c.positioning === (tier === "entry" ? "value" : tier === "mid" ? "mid" : "premium"));

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

export default function WhitespaceView() {
  const { filters } = useDashboardFilters();
  const { lang } = useDemoLang();
  const t = whitespace[lang];
  const { products, competitorPrices } = useArcelikData();
  const [selectedCat, setSelectedCat] = useState<ProductCategory | "all">("all");

  const opportunities = useMemo(
    () => findWhitespaceOpportunities(products, competitorPrices, lang),
    [products, competitorPrices, lang],
  );

  const filteredOpps = useMemo(() => {
    if (selectedCat === "all") return opportunities;
    return opportunities.filter(o => o.category === selectedCat);
  }, [opportunities, selectedCat]);

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
