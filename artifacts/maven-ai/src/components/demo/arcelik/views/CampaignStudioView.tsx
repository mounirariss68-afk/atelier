import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Target, MapPin, TrendingUp, Calendar, ChevronRight,
  Send, CheckCircle2, Clock, DollarSign, Edit3,
  Brain, Shield, Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDemoLang } from "../DemoLangContext";
import { campaign as campaignI18n } from "../demo-i18n";
import {
  CATEGORY_LABELS, getCategoryLabel, getCampaignField, getCityName, getProductName, getPromotionTypeLabel,
  type CampaignTemplate, type ProductCategory,
} from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";
import { generateCampaignSuggestions } from "@/data/arcelik-agent";

type Tab = "suggested" | "builder" | "history";

const MOCK_HISTORY_KEYS = [
  { id: "h1", nameKey: "histName1", status: "completed" as const, datesKey: "histDates1", lift: "+1.1%", revenue: "+₺38M", projected: { lift: "+1.2%", revenue: "+₺42M", margin: "-0.8%" }, actual: { lift: "+1.1%", revenue: "+₺38M", margin: "-0.7%" } },
  { id: "h2", nameKey: "histName2", status: "completed" as const, datesKey: "histDates2", lift: "+0.9%", revenue: "+₺28M", projected: { lift: "+1.0%", revenue: "+₺30M", margin: "-0.3%" }, actual: { lift: "+0.9%", revenue: "+₺28M", margin: "-0.4%" } },
  { id: "h3", nameKey: "histName3", status: "completed" as const, datesKey: "histDates3", lift: "+0.4%", revenue: "+₺12M", projected: { lift: "+0.5%", revenue: "+₺15M", margin: "+0.3%" }, actual: { lift: "+0.4%", revenue: "+₺12M", margin: "+0.2%" } },
  { id: "h4", nameKey: "histName4", status: "completed" as const, datesKey: "histDates4", lift: "+0.5%", revenue: "+₺22M", projected: { lift: "+0.4%", revenue: "+₺22M", margin: "-0.3%" }, actual: { lift: "+0.5%", revenue: "+₺22M", margin: "-0.2%" } },
];

function CampaignCard({ campaign, onLaunch }: { campaign: CampaignTemplate; onLaunch: () => void }) {
  const { lang } = useDemoLang();
  const t = campaignI18n[lang];
  const { cities } = useArcelikData();
  const [expanded, setExpanded] = useState(false);
  const targetCityNames = campaign.targetCities.map((id) => { const c = cities.find((c) => c.id === id); return c ? getCityName(c, lang) : null; }).filter(Boolean);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-[#E30613]/10 flex items-center justify-center">
              <Sparkles size={18} className="text-[#E30613]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#0A1230]">{getCampaignField(campaign, "name", lang)}</h4>
              <p className="text-[11px] text-gray-500">{getCampaignField(campaign, "targetSegment", lang)}</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Sparkles size={10} /> {t.aiRecommendation}
          </span>
        </div>

        <p className="text-xs text-gray-600 mb-3 line-clamp-2">{getCampaignField(campaign, "headline", lang)}</p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 flex items-center gap-1"><TrendingUp size={10} /> {t.marketShare}</p>
            <p className="text-sm font-bold text-green-600">{campaign.projectedImpact.marketShareLift}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 flex items-center gap-1"><DollarSign size={10} /> {t.revenue}</p>
            <p className="text-sm font-bold text-[#0A1230]">{campaign.projectedImpact.revenueDelta}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 flex items-center gap-1"><Target size={10} /> {t.marginImpact}</p>
            <p className={`text-sm font-bold ${campaign.projectedImpact.marginEffect.startsWith("-") ? "text-amber-600" : "text-green-600"}`}>
              {campaign.projectedImpact.marginEffect}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-3">
          <MapPin size={12} />
          <span className="truncate">{targetCityNames.join(", ")}</span>
        </div>

        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
            <div className="border-t border-gray-100 pt-3 space-y-2 text-xs text-gray-600">
              <p><strong>{t.discount}</strong> {getCampaignField(campaign, "discountDetail", lang)}</p>
              <p><strong>{t.tone}</strong> {getCampaignField(campaign, "messagingTone", lang)}</p>
              <p><strong>{t.duration}</strong> {getCampaignField(campaign, "durationPattern", lang)}</p>
              <p><strong>{t.categoriesLabel}</strong> {campaign.eligibleCategories.map((c) => getCategoryLabel(c, lang)).join(", ")}</p>
              <p className="text-gray-400 italic">{getCampaignField(campaign, "bodyCopy", lang)}</p>
              <div className="bg-blue-50 rounded-lg p-3 mt-2">
                <p className="text-[11px] font-semibold text-blue-700 mb-1">{t.dealerPosMessage}</p>
                <p className="text-[11px] text-blue-600">{getCampaignField(campaign, "dealerPosMessaging", lang)}</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50/50">
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-500 hover:text-[#0A1230] font-medium flex items-center gap-1">
          {expanded ? t.collapse : t.details}
          <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <button
          onClick={onLaunch}
          className="px-4 py-1.5 rounded-lg bg-[#E30613] text-white text-xs font-bold hover:bg-[#c00510] transition-colors flex items-center gap-1.5"
        >
          <Send size={12} /> {t.launchCampaign}
        </button>
      </div>
    </motion.div>
  );
}

function CampaignBuilder() {
  const { toast } = useToast();
  const { lang } = useDemoLang();
  const t = campaignI18n[lang];
  const { products, cities } = useArcelikData();
  const [name, setName] = useState("");
  const [selectedCats, setSelectedCats] = useState<ProductCategory[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [discount, setDiscount] = useState(10);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [promotionType, setPromotionType] = useState("indirim");
  const [startDate, setStartDate] = useState("2026-06-01");
  const [endDate, setEndDate] = useState("2026-06-30");
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [productTargetOpen, setProductTargetOpen] = useState(false);

  const eligibleProducts = useMemo(() => {
    if (selectedCats.length === 0) return [];
    return products.filter((p) => selectedCats.includes(p.category));
  }, [selectedCats]);

  const projectedImpact = {
    share: `+${(discount * 0.08).toFixed(1)}%`,
    revenue: `+₺${Math.round(discount * 3.5)}M`,
    margin: `${discount > 15 ? "-" : "+"}${(Math.abs(discount * 0.06 - 0.5)).toFixed(1)}%`,
  };

  const handleCreate = () => {
    const productInfo = selectedProductIds.length > 0 ? ` • ${selectedProductIds.length} ${t.selectedProductCount}` : "";
    toast({
      title: t.toastCreated,
      description: `"${name || t.newCampaignDefault}" (${getPromotionTypeLabel(promotionType, lang)})${productInfo} ${startDate} – ${endDate}`,
    });
    setName("");
    setSelectedCats([]);
    setSelectedProductIds([]);
    setProductTargetOpen(false);
    setDiscount(10);
    setSelectedCities([]);
    setPromotionType("indirim");
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
      <h3 className="text-sm font-bold flex items-center gap-2">
        <Edit3 size={16} className="text-[#C45BB8]" />
        {t.builderTitle}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t.campaignName}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.campaignNamePlaceholder}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 focus:border-[#E30613]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t.promoType}</label>
            <select
              value={promotionType}
              onChange={(e) => setPromotionType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 appearance-none"
            >
              <option value="indirim">{t.promoDiscount}</option>
              <option value="taksit">{t.promoInstallment}</option>
              <option value="trade-in">{t.promoTradeIn}</option>
              <option value="paket">{t.promoBundle}</option>
              <option value="hediye">{t.promoGift}</option>
              <option value="bolgesel">{t.promoRegional}</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t.dateRange}</label>
            <div className="flex gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E30613]/20" />
              <span className="text-gray-400 self-center text-xs">—</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E30613]/20" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t.categories}</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    setSelectedCats((prev) => {
                      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
                      setSelectedProductIds((pids) => pids.filter((pid) => {
                        const prod = products.find((p) => p.id === pid);
                        return prod && next.includes(prod.category);
                      }));
                      return next;
                    });
                  }}
                  className={`px-2.5 py-1 text-[11px] rounded-full border font-medium inline-flex items-center gap-1 ${
                    selectedCats.includes(id) ? "bg-[#E30613] text-white border-[#E30613]" : "border-gray-200 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {getCategoryLabel(id, lang)}
                  {selectedCats.includes(id) && (() => {
                    const count = selectedProductIds.filter(pid => {
                      const prod = products.find(p => p.id === pid);
                      return prod && prod.category === id;
                    }).length;
                    const total = products.filter(p => p.category === id).length;
                    return count > 0 ? (
                      <span className="bg-white/30 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{count}/{total}</span>
                    ) : null;
                  })()}
                </button>
              ))}
            </div>
          </div>

          {selectedCats.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setProductTargetOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1 w-full"
              >
                <Package size={12} />
                {t.targetProductsLabel}
                <ChevronRight size={12} className={`ml-auto transition-transform ${productTargetOpen ? "rotate-90" : ""}`} />
                {selectedProductIds.length > 0 && (
                  <span className="text-[10px] text-[#E30613] font-medium">{selectedProductIds.length} {t.selectedProductCount}</span>
                )}
              </button>
              {productTargetOpen && (
                <>
                  <p className="text-[10px] text-gray-400 mb-1.5">{t.targetProductsHint}</p>
                  <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-0.5">
                    {selectedCats.map((cat) => {
                      const catProds = eligibleProducts.filter((p) => p.category === cat);
                      if (catProds.length === 0) return null;
                      return (
                        <div key={cat}>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1 pt-1">{getCategoryLabel(cat, lang)}</p>
                          {catProds.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setSelectedProductIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
                              className={`w-full text-left px-2 py-1 text-[11px] rounded transition-colors ${
                                selectedProductIds.includes(p.id) ? "bg-[#E30613]/10 text-[#E30613] font-semibold" : "text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {getProductName(p, lang)}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {selectedProductIds.length > 0
                      ? `${selectedProductIds.length} ${t.selectedProductCount}`
                      : t.allProductsInCategory}
                  </p>
                </>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t.discountRate} %{discount}</label>
            <input
              type="range"
              min={5}
              max={30}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className="w-full accent-[#E30613]"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>%5</span>
              <span>%30</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">{t.targetCities}</label>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {cities.slice(0, 10).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCities((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                  className={`px-2 py-0.5 text-[11px] rounded-full border ${
                    selectedCities.includes(c.id) ? "bg-blue-500 text-white border-blue-500" : "border-gray-200 text-gray-600"
                  }`}
                >
                  {getCityName(c, lang)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gradient-to-br from-[#0A1230] to-[#1B2755] rounded-xl p-5 text-white">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">{t.estimatedImpact}</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300">{t.shareImpact}</span>
                <span className="text-lg font-extrabold text-green-400">{projectedImpact.share}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300">{t.revenueChange}</span>
                <span className="text-lg font-extrabold text-white">{projectedImpact.revenue}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300">{t.marginImpact}</span>
                <span className={`text-lg font-extrabold ${projectedImpact.margin.startsWith("-") ? "text-amber-400" : "text-green-400"}`}>
                  {projectedImpact.margin}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/10">
              <p className="text-[10px] text-gray-400">
                {getPromotionTypeLabel(promotionType, lang)} • {selectedCats.length || t.allLabel} {t.categorySummary}{selectedProductIds.length > 0 ? ` (${selectedProductIds.length} ${t.selectedProductCount})` : ""} × {selectedCities.length || t.allLabel} {t.citySummary} × %{discount} • {startDate} – {endDate}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setAiOptimizing(true);
              setTimeout(() => {
                setDiscount(Math.min(30, discount + 3));
                if (selectedCities.length === 0) setSelectedCities(["istanbul", "ankara", "izmir"]);
                setAiOptimizing(false);
                toast({ title: t.aiOptimizationDone, description: t.aiOptDesc });
              }, 2000);
            }}
            disabled={aiOptimizing}
            className="w-full py-2.5 rounded-xl border-2 border-[#C45BB8] text-[#C45BB8] font-bold text-sm hover:bg-[#C45BB8]/5 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Sparkles size={16} className={aiOptimizing ? "animate-spin" : ""} />
            {aiOptimizing ? t.optimizing : t.optimizeAI}
          </button>

          <button
            onClick={handleCreate}
            disabled={!name && selectedCats.length === 0}
            className="w-full py-3 rounded-xl bg-[#E30613] text-white font-bold text-sm hover:bg-[#c00510] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Send size={16} /> {t.createCampaign}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CampaignStudioView() {
  const { toast } = useToast();
  const { lang } = useDemoLang();
  const t = campaignI18n[lang];
  const { campaigns, cities, products } = useArcelikData();
  const [tab, setTab] = useState<Tab>("suggested");
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const handleLaunch = (campaignName: string) => {
    toast({
      title: t.toastLaunched,
      description: `"${campaignName}"`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-[#0A1230]">{t.title}</h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {([
            { id: "suggested" as Tab, label: t.tabAI, icon: Sparkles },
            { id: "builder" as Tab, label: t.tabBuilder, icon: Edit3 },
            { id: "history" as Tab, label: t.tabHistory, icon: Clock },
          ]).map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                tab === tb.id ? "bg-white text-[#0A1230] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <tb.icon size={13} /> {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "suggested" && (
        <>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-5">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <Brain size={15} className="text-[#E30613]" />
              <h3 className="text-sm font-bold text-[#0A1230]">{t.agentSuggestions}</h3>
              <span className="text-[9px] font-bold bg-[#E30613] text-white px-1.5 py-0.5 rounded-full ml-1">AI</span>
              <span className="text-[10px] text-gray-400 ml-auto">{t.autonomousResults}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {generateCampaignSuggestions().map((s) => (
                <div key={s.id} className="px-5 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                      <Sparkles size={14} className="text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0A1230] mb-0.5">{s.suggestion}</p>
                      <p className="text-xs text-gray-500 mb-1.5">{s.reasoning}</p>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-green-600 font-bold">{s.impact}</span>
                        <span className="text-gray-400 flex items-center gap-0.5"><Shield size={9} /> {t.confidence} %{s.confidence}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} onLaunch={() => handleLaunch(getCampaignField(c, "name", lang))} />
            ))}
          </div>
        </>
      )}

      {tab === "builder" && <CampaignBuilder />}

      {tab === "history" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-bold">{t.historyTitle}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {MOCK_HISTORY_KEYS.map((h, i) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="hover:bg-gray-50/50 cursor-pointer"
                onClick={() => setExpandedHistory(expandedHistory === h.id ? null : h.id)}
              >
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
                    <CheckCircle2 size={16} className="text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0A1230]">{t[h.nameKey]}</p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1"><Calendar size={10} /> {t[h.datesKey]}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-green-600">{h.lift} {t.shareIncrease}</p>
                    <p className="text-[11px] text-gray-500">{h.revenue} {t.revenueLabel}</p>
                  </div>
                  <ChevronRight size={14} className={`text-gray-400 transition-transform ${expandedHistory === h.id ? "rotate-90" : ""}`} />
                </div>
                <AnimatePresence>
                  {expandedHistory === h.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-4 pt-0">
                        <div className="bg-gray-50 rounded-xl p-4">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-3">{t.estimatedVsActual}</p>
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div>
                              <p className="text-gray-400 text-[10px] mb-1">{t.shareImpactLabel}</p>
                              <div className="space-y-0.5">
                                <p className="text-gray-500">{t.estimated} <strong>{h.projected.lift}</strong></p>
                                <p className="text-green-600">{t.actual} <strong>{h.actual.lift}</strong></p>
                              </div>
                            </div>
                            <div>
                              <p className="text-gray-400 text-[10px] mb-1">{t.revenueChangeLabel}</p>
                              <div className="space-y-0.5">
                                <p className="text-gray-500">{t.estimated} <strong>{h.projected.revenue}</strong></p>
                                <p className="text-green-600">{t.actual} <strong>{h.actual.revenue}</strong></p>
                              </div>
                            </div>
                            <div>
                              <p className="text-gray-400 text-[10px] mb-1">{t.marginImpactLabel}</p>
                              <div className="space-y-0.5">
                                <p className="text-gray-500">{t.estimated} <strong>{h.projected.margin}</strong></p>
                                <p className={h.actual.margin.startsWith("-") ? "text-amber-600" : "text-green-600"}>{t.actual} <strong>{h.actual.margin}</strong></p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
