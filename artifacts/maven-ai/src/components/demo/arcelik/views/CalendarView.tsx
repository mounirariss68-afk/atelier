import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarRange, AlertTriangle, CheckCircle2, Eye, ChevronDown, X, MapPin, Target, DollarSign, TrendingUp } from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import { useDemoLang } from "../DemoLangContext";
import { calendar } from "../demo-i18n";
import {
  promotionalCalendar, campaigns, cities, COMPETITOR_BRANDS, getCategoryLabel,
  type CalendarEntry,
} from "@/data/arcelik-seed";

const BRAND_COLORS: Record<string, string> = {
  "Arçelik": "#E30613",
  "Vestel": "#2563eb",
  "Bosch": "#059669",
  "Samsung": "#7c3aed",
  "Regal": "#d97706",
  "Siemens": "#0891b2",
  "Profilo": "#ea580c",
  "LG": "#dc2626",
};

function getBarSpan(entry: CalendarEntry): { start: number; end: number } {
  const s = entry.startMonth - 1;
  const e = entry.endMonth > entry.startMonth ? entry.endMonth - 1 : 11;
  return { start: s, end: e };
}

function findGaps(entries: CalendarEntry[]): number[] {
  const covered = new Set<number>();
  entries.filter((e) => e.brand !== "Arçelik").forEach((e) => {
    const { start, end } = getBarSpan(e);
    for (let m = start; m <= end; m++) covered.add(m);
  });
  const gaps: number[] = [];
  for (let m = 0; m < 12; m++) {
    if (!covered.has(m)) gaps.push(m);
  }
  return gaps;
}

export default function CalendarView() {
  const { filters } = useDashboardFilters();
  const { lang } = useDemoLang();
  const t = calendar[lang];
  const MONTHS = [
    t.monthJan, t.monthFeb, t.monthMar, t.monthApr, t.monthMay, t.monthJun,
    t.monthJul, t.monthAug, t.monthSep, t.monthOct, t.monthNov, t.monthDec,
  ];
  const [filterBrand, setFilterBrand] = useState<string>("all");
  const [hoveredEntry, setHoveredEntry] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null);

  const baseEntries = filters.competitors.length > 0
    ? promotionalCalendar.filter((e) =>
        e.brand === "Arçelik" || filters.competitors.some((cid) => {
          const b = COMPETITOR_BRANDS.find((cb) => cb.id === cid);
          return b && b.name === e.brand;
        })
      )
    : promotionalCalendar;

  const entries = filterBrand === "all"
    ? baseEntries
    : baseEntries.filter((e) => e.brand === filterBrand);

  const brands = [...new Set(promotionalCalendar.map((e) => e.brand))];
  const gaps = findGaps(promotionalCalendar);

  const arcelikEntries = entries.filter((e) => e.brand === "Arçelik");
  const competitorEntries = entries.filter((e) => e.brand !== "Arçelik");

  const matchedCampaign = useMemo(() => {
    if (!selectedEntry || selectedEntry.brand !== "Arçelik") return null;
    return campaigns.find((c) => {
      const words = selectedEntry.campaignName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => c.name.toLowerCase().includes(w));
    }) ?? null;
  }, [selectedEntry]);

  const handleRowClick = (entry: CalendarEntry) => {
    setSelectedEntry(entry);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
          <CalendarRange size={20} /> {t.title}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t.brand}</span>
          <div className="relative">
            <select
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 pr-8 appearance-none font-medium"
            >
              <option value="all">{t.all}</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[180px_repeat(12,1fr)] border-b border-gray-200 bg-gray-50/70">
              <div className="px-4 py-3 text-[11px] font-semibold text-gray-500">{t.campaignLabel}</div>
              {MONTHS.map((m, i) => (
                <div
                  key={m}
                  className={`px-2 py-3 text-[11px] font-semibold text-center ${
                    gaps.includes(i) ? "text-amber-600 bg-amber-50/50" : "text-gray-500"
                  }`}
                >
                  {m}
                  {gaps.includes(i) && <AlertTriangle size={10} className="inline ml-0.5 -mt-0.5" />}
                </div>
              ))}
            </div>

            {arcelikEntries.length > 0 && (
              <>
                <div className="grid grid-cols-[180px_repeat(12,1fr)] border-b border-gray-100 bg-red-50/30">
                  <div className="px-4 py-2 text-[10px] font-bold text-[#E30613] uppercase tracking-widest col-span-13">{t.legendArcelik}</div>
                </div>
                {arcelikEntries.map((entry, i) => {
                  const { start, end } = getBarSpan(entry);
                  const isHovered = hoveredEntry === entry.id;
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[180px_repeat(12,1fr)] border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                      onMouseEnter={() => setHoveredEntry(entry.id)}
                      onMouseLeave={() => setHoveredEntry(null)}
                      onClick={() => handleRowClick(entry)}
                    >
                      <div className="px-4 py-2.5 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[entry.brand] || "#6B7280" }} />
                        <span className="text-xs font-medium text-[#0E2841] truncate">{entry.campaignName}</span>
                        {entry.type === "confirmed" ? (
                          <CheckCircle2 size={11} className="text-green-500 flex-shrink-0" />
                        ) : (
                          <Eye size={11} className="text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      {MONTHS.map((_, mi) => (
                        <div key={mi} className="px-0.5 py-2.5 flex items-center">
                          {mi >= start && mi <= end && (
                            <div
                              className={`h-5 w-full rounded-sm transition-all ${isHovered ? "opacity-100" : "opacity-80"}`}
                              style={{
                                backgroundColor: BRAND_COLORS[entry.brand] || "#6B7280",
                                borderRadius: mi === start ? "4px 0 0 4px" : mi === end ? "0 4px 4px 0" : "0",
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </motion.div>
                  );
                })}
              </>
            )}

            {competitorEntries.length > 0 && (
              <>
                <div className="grid grid-cols-[180px_repeat(12,1fr)] border-b border-gray-100 bg-blue-50/30">
                  <div className="px-4 py-2 text-[10px] font-bold text-blue-700 uppercase tracking-widest col-span-13">{t.legendCompetitor}</div>
                </div>
                {competitorEntries.map((entry, i) => {
                  const { start, end } = getBarSpan(entry);
                  const isHovered = hoveredEntry === entry.id;
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[180px_repeat(12,1fr)] border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                      onMouseEnter={() => setHoveredEntry(entry.id)}
                      onMouseLeave={() => setHoveredEntry(null)}
                      onClick={() => handleRowClick(entry)}
                    >
                      <div className="px-4 py-2.5 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[entry.brand] || "#6B7280" }} />
                        <span className="text-xs font-medium text-gray-700 truncate">{entry.campaignName}</span>
                        {entry.type === "predicted" && <Eye size={11} className="text-amber-500 flex-shrink-0" />}
                      </div>
                      {MONTHS.map((_, mi) => (
                        <div key={mi} className="px-0.5 py-2.5 flex items-center">
                          {mi >= start && mi <= end && (
                            <div
                              className={`h-5 w-full transition-all ${isHovered ? "opacity-80" : "opacity-50"} ${entry.type === "predicted" ? "border border-dashed" : ""}`}
                              style={{
                                backgroundColor: entry.type === "predicted" ? "transparent" : (BRAND_COLORS[entry.brand] || "#6B7280"),
                                borderColor: BRAND_COLORS[entry.brand] || "#6B7280",
                                borderRadius: mi === start ? "4px 0 0 4px" : mi === end ? "0 4px 4px 0" : "0",
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </motion.div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {gaps.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-100 rounded-xl p-5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-800">{t.gapDetected}</p>
              <p className="text-xs text-amber-700 mt-1">
                <strong>{gaps.map((g) => MONTHS[g]).join(", ")}</strong> — {t.gapText}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      <div className="flex items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-green-500" /> {t.legendConfirmed}</div>
        <div className="flex items-center gap-1.5"><Eye size={12} className="text-amber-500" /> {t.legendPredicted}</div>
        <div className="flex items-center gap-1.5"><AlertTriangle size={12} className="text-amber-600" /> {t.legendGap}</div>
        {Object.entries(BRAND_COLORS).slice(0, 5).map(([brand, color]) => (
          <div key={brand} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            {brand}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {selectedEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end"
            onClick={() => setSelectedEntry(null)}
          >
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
            <motion.div
              initial={{ x: 420 }}
              animate={{ x: 0 }}
              exit={{ x: 420 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-[400px] bg-white shadow-2xl h-full overflow-y-auto"
            >
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: BRAND_COLORS[selectedEntry.brand] || "#6B7280" }} />
                  <h3 className="text-sm font-bold">{selectedEntry.campaignName}</h3>
                </div>
                <button onClick={() => setSelectedEntry(null)} className="p-1 hover:bg-gray-100 rounded-lg" aria-label={t.closeCampaignDetail}><X size={18} /></button>
              </div>
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] text-gray-500 uppercase">{t.detailBrand}</p>
                    <p className="text-sm font-bold text-[#0E2841]">{selectedEntry.brand}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] text-gray-500 uppercase">{t.detailStatus}</p>
                    <p className="text-sm font-bold flex items-center gap-1">
                      {selectedEntry.type === "confirmed" ? (
                        <><CheckCircle2 size={14} className="text-green-500" /> {t.statusConfirmed}</>
                      ) : (
                        <><Eye size={14} className="text-amber-500" /> {t.statusPredicted}</>
                      )}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] text-gray-500 uppercase">{t.detailStart}</p>
                    <p className="text-sm font-bold text-[#0E2841]">{MONTHS[selectedEntry.startMonth - 1]} 2026</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[10px] text-gray-500 uppercase">{t.detailEnd}</p>
                    <p className="text-sm font-bold text-[#0E2841]">{MONTHS[selectedEntry.endMonth - 1]} 2026</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2">{t.detailCategories}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedEntry.categories.map((cat) => (
                      <span key={cat} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                        {getCategoryLabel(cat, lang)}
                      </span>
                    ))}
                  </div>
                </div>

                {matchedCampaign && (
                  <>
                    <div className="border-t border-gray-100 pt-4">
                      <p className="text-xs font-bold text-gray-700 mb-2">{t.detailCampaignDetails}</p>
                      <p className="text-xs text-gray-600 leading-relaxed mb-3">{matchedCampaign.headline}</p>
                      <p className="text-[11px] text-gray-500 italic leading-relaxed">{matchedCampaign.bodyCopy}</p>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-gray-700 mb-2">{t.detailTargetSegment}</p>
                      <p className="text-xs text-gray-600">{matchedCampaign.targetSegment}</p>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-gray-700 mb-2">{t.detailDiscountDetail}</p>
                      <p className="text-xs text-gray-600">{matchedCampaign.discountDetail}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-green-50 rounded-xl p-3">
                        <p className="text-[10px] text-green-600 flex items-center gap-1"><TrendingUp size={10} /> {t.detailShareImpact}</p>
                        <p className="text-sm font-bold text-green-700">{matchedCampaign.projectedImpact.marketShareLift}</p>
                      </div>
                      <div className="bg-blue-50 rounded-xl p-3">
                        <p className="text-[10px] text-blue-600 flex items-center gap-1"><DollarSign size={10} /> {t.detailRevenue}</p>
                        <p className="text-sm font-bold text-blue-700">{matchedCampaign.projectedImpact.revenueDelta}</p>
                      </div>
                      <div className="bg-purple-50 rounded-xl p-3">
                        <p className="text-[10px] text-purple-600 flex items-center gap-1"><Target size={10} /> {t.detailMargin}</p>
                        <p className="text-sm font-bold text-purple-700">{matchedCampaign.projectedImpact.marginEffect}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1"><MapPin size={12} /> {t.detailTargetCities}</p>
                      <div className="flex flex-wrap gap-1">
                        {matchedCampaign.targetCities.map((cid) => {
                          const city = cities.find((c) => c.id === cid);
                          return city ? (
                            <span key={cid} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{city.name}</span>
                          ) : null;
                        })}
                      </div>
                    </div>

                    <div className="bg-blue-50 rounded-xl p-3">
                      <p className="text-[11px] font-semibold text-blue-700 mb-1">{t.detailPosMessage}</p>
                      <p className="text-[11px] text-blue-600">{matchedCampaign.dealerPosMessaging}</p>
                    </div>
                  </>
                )}

                {!matchedCampaign && selectedEntry.brand !== "Arçelik" && (
                  <div className="bg-amber-50 rounded-xl p-4">
                    <p className="text-xs font-bold text-amber-800 mb-1">{t.competitorIntel}</p>
                    <p className="text-[11px] text-amber-700">
                      {selectedEntry.brand} — {MONTHS[selectedEntry.startMonth - 1]} – {MONTHS[selectedEntry.endMonth - 1]} 2026
                      {selectedEntry.categories.map((c) => ` ${getCategoryLabel(c, lang)}`).join(",")}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
