import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, Clock, FileText, Star } from "lucide-react";
import { usePwrLang, usePwrT } from "../DemoLangContext";
import { programmeDetail, portfolio } from "../programme-i18n";
import { usePwrData } from "@/hooks/useProgrammeWarRoomData";
import { generateCascades, generateDecisionPack, generateMemo, ragColor } from "@/data/programme-war-room-agent";
import { fmtAed } from "@/data/programme-war-room-seed";
import { BRAND, BRAND_INK } from "../tokens";

export default function ProgrammeDetailView() {
  const { lang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const { programmes, selectedProgrammeId, setSelectedProgrammeId } = usePwrData();
  const programme = programmes.find((p) => p.id === selectedProgrammeId) ?? programmes[0];

  const cascade = useMemo(() => generateCascades().find((c) => c.sourceId === programme.id), [programme.id]);
  const decisionPack = useMemo(() => generateDecisionPack(programme.id), [programme.id]);
  const memo = useMemo(() => generateMemo(programme.id), [programme.id]);

  const milestoneIcon = (status: string) => {
    if (status === "done") return <CheckCircle2 size={14} className="text-emerald-600" />;
    if (status === "slipping") return <AlertTriangle size={14} className="text-red-600" />;
    if (status === "at-risk") return <AlertTriangle size={14} className="text-amber-600" />;
    return <Clock size={14} className="text-gray-400" />;
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{programme.name[lang]}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{programme.sponsor[lang]} · {programme.vendor[lang]}</p>
        </div>
        <select
          value={programme.id}
          onChange={(e) => setSelectedProgrammeId(e.target.value)}
          className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
        >
          {programmes.map((p) => (<option key={p.id} value={p.id}>{p.name[lang]}</option>))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label={t("ragLabel", programmeDetail)} value={programme.rag.toUpperCase()} tone={ragColor(programme.rag)} />
        <Tile label={t("slipLabel", programmeDetail)} value={`${programme.slipDays}d`} tone="#E30613" />
        <Tile label={t("contingencyLabel", programmeDetail)} value={fmtAed(programme.contingencyBurnedAed, lang)} tone={BRAND} />
        <Tile label={t("budgetLabel", programmeDetail)} value={fmtAed(programme.budgetAed, lang)} tone={BRAND_INK} />
        <Tile label={t("vendorLabel", programmeDetail)} value={programme.vendor[lang]} tone="#5C8CA8" small />
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold mb-3" style={{ color: BRAND_INK }}>{t("milestonesTitle", programmeDetail)}</h2>
        <ul className="space-y-2">
          {programme.milestones.map((m) => (
            <li key={m.id} className="flex items-center gap-3 text-[12px]">
              {milestoneIcon(m.status)}
              <span className="flex-1 text-gray-800">{m.label[lang]}</span>
              <span className="text-gray-500">{m.due}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold mb-3" style={{ color: BRAND_INK }}>{t("evidenceTitle", programmeDetail)}</h2>
        <p className="text-xs text-gray-500 mb-3">{t("evidenceSub", programmeDetail)}</p>
        {programme.blockingIssue && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[12px] text-red-900">
            <p className="font-bold mb-0.5">{programme.blockingParty?.[lang]}</p>
            <p>{programme.blockingIssue[lang]}</p>
          </div>
        )}
        {!programme.blockingIssue && (
          <p className="text-xs text-gray-500">—</p>
        )}
      </section>

      {cascade && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("cascadeTitle", programmeDetail)}</h2>
          <p className="text-xs text-gray-500 mb-3">{t("cascadeSub", programmeDetail)}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {cascade.downstream.map((d) => (
              <div key={d.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{d.name[lang]}</p>
                <p className="text-[10px] text-gray-500">{d.hitDate}</p>
                <p className="text-[11px] text-gray-700 mt-1">{d.impact[lang]}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {decisionPack.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("decisionPackTitle", programmeDetail)}</h2>
          <p className="text-xs text-gray-500 mb-3">{t("decisionPackSub", programmeDetail)}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {decisionPack.map((o) => (
              <div key={o.id} className={`rounded-xl p-3 border ${o.recommended ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  {o.recommended && <Star size={12} className="text-emerald-700 fill-emerald-700" />}
                  <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{o.label[lang]}</p>
                </div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">{t("costLabel", programmeDetail)}</p>
                <p className="text-[11px] text-gray-800">{o.cost[lang]}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">{t("riskLabel", programmeDetail)}</p>
                <p className="text-[11px] text-gray-800">{o.risk[lang]}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-1">{t("timeLabel", programmeDetail)}</p>
                <p className="text-[11px] text-gray-800">{o.timeToRecover[lang]}</p>
                {o.recommended && (
                  <p className="text-[10px] font-bold text-emerald-700 mt-2">{t("recommended", programmeDetail)}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {memo && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={14} className="text-gray-500" />
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("memoTitle", programmeDetail)}</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">{t("memoBy", programmeDetail)}</p>
          <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-[13px] font-bold" style={{ color: BRAND_INK }}>{memo.title[lang]}</p>
            {memo.body.map((b, i) => (
              <p key={i} className="text-[12px] text-gray-800 leading-relaxed">{b[lang]}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, tone, small }: { label: string; value: string; tone: string; small?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-extrabold mt-0.5 ${small ? "text-[12px]" : "text-lg"}`} style={{ color: tone }}>{value}</p>
    </div>
  );
}
