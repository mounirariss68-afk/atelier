import { Truck, MapPin, User, Clock } from "lucide-react";
import { useNocDemoLang, useNocDemoT } from "../DemoLangContext";
import { fieldOps } from "../noc-i18n";
import { CREWS, INCIDENTS, type Crew } from "@/data/network-ops-seed";
import { BRAND } from "../tokens";

const STATUS_TONE: Record<Crew["status"], { bg: string; text: string; key: string }> = {
  available: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", key: "statusAvailable" },
  dispatched: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", key: "statusDispatched" },
  "on-site": { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", key: "statusOnSite" },
  returning: { bg: "bg-gray-50 border-gray-200", text: "text-gray-700", key: "statusReturning" },
};

export default function FieldOpsView() {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Truck size={20} style={{ color: BRAND }} />
          {t("title", fieldOps)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", fieldOps)}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {CREWS.map((c) => {
          const tone = STATUS_TONE[c.status];
          const inc = c.assignedIncidentId ? INCIDENTS.find((i) => i.id === c.assignedIncidentId) : undefined;
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">
                    <MapPin size={10} className="inline-block me-0.5" />
                    {isAr ? c.city.ar : c.city.en}
                  </p>
                  <h3 className="text-sm font-bold text-gray-900 mt-0.5">{isAr ? c.name.ar : c.name.en}</h3>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${tone.bg} ${tone.text}`}>
                  {t(tone.key, fieldOps)}
                </span>
              </div>

              <div className="text-[11px] text-gray-700 flex items-center gap-1.5">
                <User size={11} className="text-gray-400" />
                <span className="font-semibold">{t("lead", fieldOps)}:</span> {isAr ? c.lead.ar : c.lead.en}
              </div>

              {c.etaMin != null && (
                <div className="text-[11px] text-gray-700 flex items-center gap-1.5">
                  <Clock size={11} className="text-gray-400" />
                  <span className="font-semibold">{t("eta", fieldOps)}:</span> {c.etaMin} {isAr ? "د" : "min"}
                </div>
              )}

              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t("assignedTo", fieldOps)}</p>
                {inc ? (
                  <p className="text-xs text-gray-800 mt-1 font-semibold">{isAr ? inc.title.ar : inc.title.en}</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">{t("none", fieldOps)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
