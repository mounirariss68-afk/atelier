import { useState } from "react";
import { Star, Globe, AlertTriangle, X, Truck } from "lucide-react";
import { useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { useProcurementDemoLang } from "../DemoLangContext";
import { suppliers as t } from "../procurement-i18n";
import {
  totalForSupplier, tcoForSupplier, savingsPctVsBaseline, type Supplier,
} from "@/data/procurement-negotiation-seed";
import { BRAND, SEMANTIC } from "../tokens";

export default function SuppliersView() {
  const { suppliers } = useProcurementData();
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-[#0E2841]">{t.title[lang]}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.subtitle[lang]}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {suppliers.map((s) => (
          <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: BRAND }}>{s.code.slice(0, 2)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-[#0E2841] truncate">{isAr ? s.nameAr : s.nameEn}</h3>
                  {s.incumbent && <Star size={11} className="text-amber-500 fill-amber-500" />}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-gray-500">
                  <Globe size={10} />
                  <span>{isAr ? s.countryAr : s.countryEn}</span>
                </div>
              </div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${s.preQualified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {s.preQualified ? t.prequalified[lang] : t.notPrequalified[lang]}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <Stat label={t.otd[lang]} value={`${s.onTimeDeliveryPct}%`} good={s.onTimeDeliveryPct >= 92} />
              <Stat label={t.esg[lang]} value={`${s.esgScore}`} good={s.esgScore >= 75} warn={s.esgScore < 70} />
              <Stat label={t.payment[lang]} value={`${s.paymentTermsDays}d`} />
              <Stat label={t.leadTime[lang]} value={`${s.leadTimeDays}d`} good={s.leadTimeDays <= 14} />
            </div>

            {(isAr ? s.flagsAr : s.flagsEn).length > 0 && (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2">
                <AlertTriangle size={11} />
                <span className="line-clamp-1">{(isAr ? s.flagsAr : s.flagsEn).join(" · ")}</span>
              </div>
            )}

            <button onClick={() => setOpenId(s.id)} className="mt-3 text-[11px] font-bold hover:underline" style={{ color: BRAND }}>{t.open[lang]} →</button>
          </div>
        ))}
      </div>

      {openId && <SupplierDrawer supplier={suppliers.find((s) => s.id === openId)!} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value, good, warn }: { label: string; value: string; good?: boolean; warn?: boolean }) {
  const color = good ? SEMANTIC.good : warn ? SEMANTIC.warn : "#0E2841";
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function SupplierDrawer({ supplier: s, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const totalR3 = totalForSupplier(s.id, 3);
  const tco = tcoForSupplier(s.id, 3);
  const savings = savingsPctVsBaseline(totalR3);

  return (
    <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose}>
      <div className={`fixed top-0 bottom-0 ${isAr ? "left-0" : "right-0"} w-[440px] bg-white shadow-2xl overflow-y-auto`} onClick={(e) => e.stopPropagation()} dir={isAr ? "rtl" : "ltr"}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#0E2841]">{isAr ? s.nameAr : s.nameEn}</h3>
            <p className="text-[11px] text-gray-500">{isAr ? s.countryAr : s.countryEn} · {s.code}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 text-[12px] text-gray-700">{isAr ? s.preQualNotes.ar : s.preQualNotes.en}</div>
          <div className="grid grid-cols-3 gap-2">
            <Box label={isAr ? "إجمالي R3" : "Total R3"} value={`SAR ${(totalR3 / 1_000_000).toFixed(2)}M`} />
            <Box label={isAr ? "تكلفة شاملة" : "TCO"} value={`SAR ${(tco / 1_000_000).toFixed(2)}M`} />
            <Box label={isAr ? "وفورات" : "Savings"} value={`${savings.toFixed(1)}%`} />
          </div>
          <div>
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">{isAr ? "أداء التسليم" : "Performance"}</h4>
            <div className="space-y-2">
              <Row label={isAr ? "الالتزام بالتسليم" : "On-time delivery"} value={`${s.onTimeDeliveryPct}%`} />
              <Row label={isAr ? "نقاط الاستدامة" : "ESG score"} value={`${s.esgScore} / 100`} />
              <Row label={isAr ? "شروط الدفع" : "Payment terms"} value={`${s.paymentTermsDays} ${isAr ? "يوم" : "days"}`} />
              <Row label={isAr ? "زمن التسليم" : "Lead-time"} value={`${s.leadTimeDays} ${isAr ? "يوم" : "days"}`} />
              <Row label={isAr ? "الشحن (% من السعر)" : "Freight (% of price)"} value={`${s.freightPctOfPrice.toFixed(1)}%`} />
            </div>
          </div>
          {(isAr ? s.flagsAr : s.flagsEn).length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1.5"><AlertTriangle size={11} /> {isAr ? "تنبيهات" : "Flags"}</p>
              <ul className="text-[12px] text-amber-700 mt-1 list-disc list-inside">
                {(isAr ? s.flagsAr : s.flagsEn).map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold text-[#0E2841] mt-0.5">{value}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-[#0E2841]">{value}</span>
    </div>
  );
}
