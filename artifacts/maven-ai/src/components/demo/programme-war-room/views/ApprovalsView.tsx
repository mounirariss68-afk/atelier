import { useState } from "react";
import { Check, Edit3, X, Sparkles, ShieldCheck } from "lucide-react";
import { usePwrLang, usePwrT } from "../DemoLangContext";
import { approvals } from "../programme-i18n";
import { usePwrData } from "@/hooks/useProgrammeWarRoomData";
import { programmeById } from "@/data/programme-war-room-seed";
import { BRAND, BRAND_INK } from "../tokens";
import { useToast } from "@/hooks/use-toast";
import { CONSOLE_AGENTS, CONSOLE_CHECKPOINTS, type RecStatus } from "@/data/programme-war-room-agent";

export default function ApprovalsView() {
  const { lang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const { recommendations, setRecommendationStatus } = usePwrData();
  const [filter, setFilter] = useState<"all" | "checkpoint" | "derived">("all");
  const { toast } = useToast();

  const scenarioCheckpoints = CONSOLE_CHECKPOINTS;
  const derivedRecs = recommendations.filter((r) => !r.isCheckpoint);
  const checkpointRecs = recommendations.filter((r) => r.isCheckpoint);

  const showCheckpoints = filter === "all" || filter === "checkpoint";
  const showDerived = filter === "all" || filter === "derived";

  const act = (id: string, status: RecStatus) => {
    setRecommendationStatus(id, status);
    const titleKey = status === "approved" ? "toastApprovedTitle" : status === "edited" ? "toastEditedTitle" : "toastRejectedTitle";
    const descKey = status === "approved" ? "toastApprovedDesc" : status === "edited" ? "toastEditedDesc" : "toastRejectedDesc";
    toast({ title: t(titleKey, approvals), description: t(descKey, approvals) });
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", approvals)}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", approvals)}</p>
      </header>

      <div className="flex gap-1.5">
        {(["all", "checkpoint", "derived"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              filter === f ? "text-white" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
            style={filter === f ? { background: BRAND_INK, borderColor: BRAND_INK } : undefined}
          >
            {f === "all" ? t("filterAll", approvals) : f === "checkpoint" ? t("filterCheckpoint", approvals) : t("filterDerived", approvals)}
          </button>
        ))}
      </div>

      {showCheckpoints && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} style={{ color: BRAND }} />
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: BRAND_INK }}>{t("scenarioCheckpoints", approvals)}</h2>
            <span className="text-[10px] text-gray-500">{t("scenarioCheckpointsSub", approvals)}</span>
          </div>

          {scenarioCheckpoints.map((cp) => {
            const matchedRec = checkpointRecs.find((r) => r.id === cp.recId);
            const isResolved = matchedRec ? matchedRec.status !== "pending" : false;
            return (
              <div
                key={cp.id}
                className={`bg-white border rounded-2xl p-4 border-l-4 ${isResolved ? "opacity-60" : ""}`}
                style={{ borderInlineStartColor: BRAND }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: BRAND }}>
                        {t("filterCheckpoint", approvals)}
                      </span>
                      <span className="text-[10px] text-gray-500">{cp.human[lang]}</span>
                    </div>
                    <p className="text-[13px] font-bold" style={{ color: BRAND_INK }}>{cp.question[lang]}</p>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-2">{t("rationale", approvals)}</p>
                    <p className="text-[12px] text-gray-700 leading-relaxed">{cp.rationale[lang]}</p>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-2">{t("options", approvals)}</p>
                    <ul className="text-[12px] text-gray-700 list-disc ms-5 space-y-0.5">
                      {cp.options.map((o) => (
                        <li key={o.id} className={o.recommended ? "font-semibold" : undefined} style={o.recommended ? { color: BRAND_INK } : undefined}>
                          {o.label[lang]}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {!isResolved && matchedRec ? (
                      <>
                        <button onClick={() => act(matchedRec.id, "approved")} className="flex items-center gap-1 text-[11px] font-bold text-white px-3 py-1.5 rounded-lg" style={{ background: BRAND }}>
                          <Check size={12} /> {t("approve", approvals)}
                        </button>
                        <button onClick={() => act(matchedRec.id, "edited")} className="flex items-center gap-1 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-lg">
                          <Edit3 size={12} /> {t("edit", approvals)}
                        </button>
                        <button onClick={() => act(matchedRec.id, "rejected")} className="flex items-center gap-1 text-[11px] text-gray-500 px-3 py-1.5">
                          <X size={12} /> {t("reject", approvals)}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-700">✓ {t("resolved", approvals)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {checkpointRecs.filter((r) => !scenarioCheckpoints.some((cp) => cp.recId === r.id)).map((r) => {
            const programme = programmeById(r.programmeId);
            const agent = CONSOLE_AGENTS.find((a) => a.id === r.agentId);
            const isResolved = r.status !== "pending";
            return (
              <div key={r.id} className={`bg-white border rounded-2xl p-4 border-l-4 ${isResolved ? "opacity-60" : ""}`} style={{ borderInlineStartColor: BRAND }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: BRAND }}>
                        {t("filterCheckpoint", approvals)}
                      </span>
                      {agent && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white flex items-center gap-1" style={{ background: agent.color }}>
                          <Sparkles size={9} /> {agent.name[lang]}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500">{programme?.name[lang]}</span>
                      <span className="text-[10px] font-bold px-1.5 rounded text-emerald-700 bg-emerald-50">{r.confidence}%</span>
                    </div>
                    <p className="text-[13px] font-bold" style={{ color: BRAND_INK }}>{r.title[lang]}</p>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-2">{t("rationale", approvals)}</p>
                    <p className="text-[12px] text-gray-700 leading-relaxed">{r.rationale[lang]}</p>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-2">{t("options", approvals)}</p>
                    <ul className="text-[12px] text-gray-700 list-disc ms-5 space-y-0.5">
                      <li className="font-semibold" style={{ color: BRAND_INK }}>{r.recommendedAction[lang]}</li>
                      {r.alternateActions.map((a, i) => (<li key={i}>{a[lang]}</li>))}
                    </ul>
                    {r.checkpointHuman && (
                      <p className="text-[10px] text-gray-500 mt-2">{t("human", approvals)}: <span className="font-semibold">{r.checkpointHuman[lang]}</span></p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {!isResolved ? (
                      <>
                        <button onClick={() => act(r.id, "approved")} className="flex items-center gap-1 text-[11px] font-bold text-white px-3 py-1.5 rounded-lg" style={{ background: BRAND }}>
                          <Check size={12} /> {t("approve", approvals)}
                        </button>
                        <button onClick={() => act(r.id, "edited")} className="flex items-center gap-1 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-lg">
                          <Edit3 size={12} /> {t("edit", approvals)}
                        </button>
                        <button onClick={() => act(r.id, "rejected")} className="flex items-center gap-1 text-[11px] text-gray-500 px-3 py-1.5">
                          <X size={12} /> {t("reject", approvals)}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-700">✓ {t("resolved", approvals)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {showDerived && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 mt-2">
            <Sparkles size={14} className="text-gray-500" />
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: BRAND_INK }}>{t("derivedRecs", approvals)}</h2>
          </div>
          {derivedRecs.map((r) => {
            const programme = programmeById(r.programmeId);
            const agent = CONSOLE_AGENTS.find((a) => a.id === r.agentId);
            const isResolved = r.status !== "pending";
            return (
              <div key={r.id} className={`bg-white border border-gray-200 rounded-2xl p-4 ${isResolved ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {agent && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white flex items-center gap-1" style={{ background: agent.color }}>
                          <Sparkles size={9} /> {agent.name[lang]}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500">{programme?.name[lang]}</span>
                      <span className={`text-[10px] font-bold px-1.5 rounded ${r.confidence >= 90 ? "text-emerald-700 bg-emerald-50" : r.confidence >= 80 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50"}`}>
                        {r.confidence}%
                      </span>
                    </div>
                    <p className="text-[13px] font-bold" style={{ color: BRAND_INK }}>{r.title[lang]}</p>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-2">{t("rationale", approvals)}</p>
                    <p className="text-[12px] text-gray-700 leading-relaxed">{r.rationale[lang]}</p>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wide mt-2">{t("options", approvals)}</p>
                    <ul className="text-[12px] text-gray-700 list-disc ms-5 space-y-0.5">
                      <li className="font-semibold" style={{ color: BRAND_INK }}>{r.recommendedAction[lang]}</li>
                      {r.alternateActions.map((a, i) => (<li key={i}>{a[lang]}</li>))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {!isResolved ? (
                      <>
                        <button onClick={() => act(r.id, "approved")} className="flex items-center gap-1 text-[11px] font-bold text-white px-3 py-1.5 rounded-lg" style={{ background: BRAND }}>
                          <Check size={12} /> {t("approve", approvals)}
                        </button>
                        <button onClick={() => act(r.id, "edited")} className="flex items-center gap-1 text-[11px] font-bold text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-lg">
                          <Edit3 size={12} /> {t("edit", approvals)}
                        </button>
                        <button onClick={() => act(r.id, "rejected")} className="flex items-center gap-1 text-[11px] text-gray-500 px-3 py-1.5">
                          <X size={12} /> {t("reject", approvals)}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-700">✓ {t("resolved", approvals)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {derivedRecs.length === 0 && (
            <p className="text-center text-sm text-gray-500 py-8">{t("noItems", approvals)}</p>
          )}
        </section>
      )}
    </div>
  );
}
