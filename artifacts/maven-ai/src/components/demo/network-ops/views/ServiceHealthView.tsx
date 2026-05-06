import { ShieldCheck, AlertTriangle, ShieldAlert } from "lucide-react";
import { useNocDemoLang, useNocDemoT } from "../DemoLangContext";
import { serviceHealth } from "../noc-i18n";
import { SERVICES, siteById } from "@/data/network-ops-seed";
import { BRAND } from "../tokens";

const STATUS_TONE: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode; key: string }> = {
  ok: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: <ShieldCheck size={12} />, key: "statusOk" },
  "at-risk": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", icon: <AlertTriangle size={12} />, key: "statusAtRisk" },
  breached: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", icon: <ShieldAlert size={12} />, key: "statusBreached" },
};

export default function ServiceHealthView() {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={20} style={{ color: BRAND }} />
          {t("title", serviceHealth)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", serviceHealth)}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {SERVICES.map((s) => {
          const tone = STATUS_TONE[s.status];
          const pctDelta = s.currentPct - s.slaPct;
          const headroom = Math.max(0, Math.min(100, ((s.currentPct - 99) / 1) * 100));
          return (
            <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t("customer", serviceHealth)}</p>
                  <p className="text-sm text-gray-700">{isAr ? s.customer.ar : s.customer.en}</p>
                  <h3 className="text-base font-extrabold text-gray-900 mt-1">{isAr ? s.name.ar : s.name.en}</h3>
                </div>
                <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-bold border ${tone.bg} ${tone.text} ${tone.border}`}>
                  {tone.icon}{t(tone.key, serviceHealth)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Box label={t("sla", serviceHealth)} value={`${s.slaPct}%`} />
                <Box label={t("current", serviceHealth)} value={`${s.currentPct}%`} accent={s.status === "ok" ? "#5BA98A" : s.status === "at-risk" ? "#F5A623" : "#D9534F"} />
                <Box label={t("creditAtRisk", serviceHealth)} value={`SAR ${s.monthlyCreditAtRisk.toLocaleString(isAr ? "ar-SA" : "en-US")}`} />
              </div>

              <div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${headroom}%`,
                      background: s.status === "ok" ? "#5BA98A" : s.status === "at-risk" ? "#F5A623" : "#D9534F",
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  {pctDelta >= 0 ? "+" : ""}{pctDelta.toFixed(2)}% {isAr ? "مقابل الاتفاقية" : "vs SLA"}
                </p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-1">{t("dependencies", serviceHealth)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {s.dependsOnSiteIds.map((id) => {
                    const site = siteById(id);
                    if (!site) return null;
                    return (
                      <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                        {isAr ? site.name.ar : site.name.en}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Box({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-2.5">
      <p className="text-[9px] uppercase tracking-widest font-bold text-gray-500">{label}</p>
      <p className="text-sm font-extrabold mt-1" style={{ color: accent ?? "#0E2841" }}>{value}</p>
    </div>
  );
}
