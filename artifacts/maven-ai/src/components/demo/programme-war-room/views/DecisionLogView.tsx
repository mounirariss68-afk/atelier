import { useMemo } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { usePwrLang, usePwrT } from "../DemoLangContext";
import { decisions } from "../programme-i18n";
import { generateDecisionLog } from "@/data/programme-war-room-agent";
import { programmeById } from "@/data/programme-war-room-seed";
import { BRAND_INK } from "../tokens";
import { CONSOLE_AGENTS } from "@/data/programme-war-room-agent";

export default function DecisionLogView() {
  const { lang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const log = useMemo(() => generateDecisionLog(), []);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", decisions)}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", decisions)}</p>
      </header>

      <div className="space-y-3">
        {log.map((entry) => {
          const programme = programmeById(entry.programmeId);
          const agent = CONSOLE_AGENTS.find((a) => a.id === entry.agentId);
          return (
            <div key={entry.id} className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[10px] text-gray-500">{programme?.name[lang]}</span>
                <span className="text-[10px] text-gray-400">·</span>
                <span className="text-[10px] text-gray-500">{new Date(entry.decidedAt).toLocaleDateString(isAr ? "ar-SA" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className="text-[10px] text-gray-400">·</span>
                <span className="text-[10px] text-gray-500">{t("decidedBy", decisions)}: {entry.decidedBy[lang]}</span>
                <span className="ms-auto flex items-center gap-1 text-[11px] font-bold">
                  {entry.matchesAgent ? (
                    <><CheckCircle2 size={12} className="text-emerald-600" /><span className="text-emerald-700">{t("match", decisions)}</span></>
                  ) : (
                    <><AlertCircle size={12} className="text-amber-600" /><span className="text-amber-700">{t("override", decisions)}</span></>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 font-semibold">
                    {t("recAgent", decisions)} {agent ? `(${agent.name[lang]})` : ""}
                  </p>
                  <p className="text-[12px] text-gray-800">{entry.agentRecommendation[lang]}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 font-semibold">{t("human", decisions)}</p>
                  <p className="text-[12px] text-gray-800">{entry.humanChoice[lang]}</p>
                </div>
              </div>

              <p className="text-[11px] text-gray-600 mt-2"><span className="font-semibold">{t("rationale", decisions)}:</span> {entry.rationale[lang]}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
