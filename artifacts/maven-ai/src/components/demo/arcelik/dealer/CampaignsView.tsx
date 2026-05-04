import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Tag, Target, Users, ChevronDown, ChevronUp, Megaphone, Gift, CheckCircle2 } from "lucide-react";
import { campaigns, dealers, getCategoryLabel } from "@/data/arcelik-seed";
import { useDemoLang } from "../DemoLangContext";
import { dealerCampaigns } from "../demo-i18n";

const DEALER = dealers[0];
const allForCity = campaigns.filter((c) => c.targetCities.includes(DEALER.city));

interface CampaignStatus {
  id: string;
  status: "active" | "completed" | "upcoming";
  endDate: string;
  daysLeft: number;
  sold: number;
  target: number;
}

interface CampaignStatusRow extends Omit<CampaignStatus, "endDate"> {
  endDateKey: string;
}

const CAMPAIGN_STATUS_ROWS: CampaignStatusRow[] = [
  { id: "eski-yeni", status: "active", endDateKey: "endDateUnlimited", daysLeft: 999, sold: 8, target: 15 },
  { id: "taksit", status: "active", endDateKey: "endDateTaksit", daysLeft: 88, sold: 22, target: 30 },
  { id: "enerji-verimlilik", status: "active", endDateKey: "endDateEnerji", daysLeft: 21, sold: 5, target: 10 },
  { id: "ramazan", status: "completed", endDateKey: "endDateRamazan", daysLeft: 0, sold: 18, target: 20 },
  { id: "yilbasi", status: "completed", endDateKey: "endDateYilbasi", daysLeft: 0, sold: 12, target: 15 },
  { id: "dugun-sezonu", status: "upcoming", endDateKey: "endDateDugun", daysLeft: 149, sold: 0, target: 25 },
  { id: "okula-donus", status: "upcoming", endDateKey: "endDateOkul", daysLeft: 134, sold: 0, target: 12 },
];

function getStatus(id: string) {
  return CAMPAIGN_STATUS_ROWS.find((s) => s.id === id) ?? { id, status: "active" as const, endDateKey: "", daysLeft: 30, sold: 0, target: 10 };
}

export default function CampaignsView() {
  const { lang } = useDemoLang();
  const t = dealerCampaigns[lang];
  const [showCompleted, setShowCompleted] = useState(false);

  const active = allForCity.filter((c) => { const s = getStatus(c.id); return s.status === "active"; });
  const completed = allForCity.filter((c) => { const s = getStatus(c.id); return s.status === "completed"; });
  const upcoming = allForCity.filter((c) => { const s = getStatus(c.id); return s.status === "upcoming"; });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">{t.title}</h1>

      <div className="space-y-4">
        {active.map((c, i) => {
          const st = getStatus(c.id);
          const progressPct = st.target > 0 ? Math.round((st.sold / st.target) * 100) : 0;
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase text-white bg-[#E30613] px-2 py-0.5 rounded-full">{t.active}</span>
                      {st.daysLeft < 999 && (
                        <span className="text-[10px] font-semibold text-amber-600 flex items-center gap-1"><Clock size={10} /> {st.daysLeft} {t.daysRemaining}</span>
                      )}
                      {st.daysLeft === 999 && <span className="text-[10px] font-semibold text-green-600">{t.unlimited}</span>}
                    </div>
                    <h3 className="text-sm font-bold">{c.name}</h3>
                  </div>
                  <Megaphone size={20} className="text-[#E30613] flex-shrink-0" />
                </div>
                <p className="text-xs text-gray-600 mb-3">{c.headline}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Clock size={13} className="text-gray-400" />
                      <span className="text-gray-500">{t.duration}</span>
                      <span className="font-semibold">{c.durationPattern}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Gift size={13} className="text-gray-400" />
                      <span className="text-gray-500">{t.discount}</span>
                      <span className="font-semibold text-[#E30613]">{c.discountDetail}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Users size={13} className="text-gray-400" />
                      <span className="text-gray-500">{t.target}</span>
                      <span className="font-semibold">{c.targetSegment}</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs">
                      <Tag size={13} className="text-gray-400 mt-0.5" />
                      <span className="text-gray-500">{t.productsLabel}</span>
                      <div className="flex flex-wrap gap-1">
                        {c.eligibleCategories.map((cat) => (
                          <span key={cat} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{getCategoryLabel(cat, lang)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Target size={13} className="text-gray-400" />
                      <span className="text-gray-500">{t.dealerTarget}</span>
                      <span className="font-semibold">{st.target} {t.dealerTargetDetail}</span>
                    </div>
                    <div>
                      <div className="flex items-end justify-between mb-1">
                        <span className="text-xs text-gray-500">{t.salesFromCampaign}</span>
                        <span className="text-xs font-bold">{st.sold} / {st.target}</span>
                      </div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#E30613] transition-all" style={{ width: `${Math.min(progressPct, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase text-gray-500">{t.materials}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="text-xs">
                      <span className="text-gray-400">{t.posMessage} </span>
                      <span className="text-gray-700">{c.dealerPosMessaging}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-400">{t.smsTemplate} </span>
                      <span className="text-gray-700">{c.dealerSmsNotification}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-gray-400">{t.socialMedia} </span>
                      <span className="text-gray-700">{c.bodyCopy}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-500 mb-3">{t.upcoming}</h2>
          <div className="space-y-3">
            {upcoming.map((c) => {
              return (
                <div key={c.id} className="bg-white rounded-xl border border-dashed border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{t.upcomingBadge}</span>
                    <span className="text-[10px] text-gray-400">{c.durationPattern}</span>
                  </div>
                  <h3 className="text-sm font-bold">{c.name}</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">{c.discountDetail}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <button onClick={() => setShowCompleted(!showCompleted)} className="flex items-center gap-2 text-sm font-bold text-gray-500 mb-3 hover:text-[#0E2841]">
            {showCompleted ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {t.completed} ({completed.length})
          </button>
          <AnimatePresence>
            {showCompleted && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden">
                {completed.map((c) => {
                  const st = getStatus(c.id);
                  return (
                    <div key={c.id} className="bg-gray-50 rounded-xl border border-gray-100 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className="text-green-500" />
                        <span className="text-[10px] font-bold uppercase text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{t.completedBadge}</span>
                        <span className="text-[10px] text-gray-400">{t.endDate} {t[st.endDateKey] || "—"}</span>
                      </div>
                      <h3 className="text-sm font-bold text-gray-600">{c.name}</h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">{t.result} {st.sold} / {st.target} {t.unitsSold} ({Math.round((st.sold / st.target) * 100)}%)</p>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
