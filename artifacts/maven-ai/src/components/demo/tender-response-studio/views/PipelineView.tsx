import { Link } from "wouter";
import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, Clock, ArrowRight, Sparkles, ChevronRight, X } from "lucide-react";
import { useTenderResponseData } from "@/hooks/useTenderResponseData";
import { useTenderDemoLang, useTenderDemoT } from "../DemoLangContext";
import { pipeline as i18n } from "../tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY, SEM } from "../tokens";
import { generateRecommendations, generateKpis, deadlineRail, pipelineStats } from "@/data/tender-response-agent";
import { tenderProgress, formatSAR, type Tender } from "@/data/tender-response-seed";
import { useToast } from "@/hooks/use-toast";

const STAGE_ORDER: Tender["stage"][] = ["ingest", "qualify", "draft", "pricing", "partner", "legal", "compile", "submitted"];
const STAGE_KEY: Record<Tender["stage"], string> = {
  ingest: "stageIngest", qualify: "stageQualify", draft: "stageDraft", pricing: "stagePricing",
  partner: "stagePartner", legal: "stageLegal", compile: "stageCompile", submitted: "stageSubmitted",
};
const HEALTH_KEY: Record<Tender["health"], string> = {
  "on-track": "healthOnTrack", "at-risk": "healthAtRisk", blocked: "healthBlocked", won: "healthWon", lost: "healthLost",
};
const HEALTH_COLOR: Record<Tender["health"], string> = {
  "on-track": SEM.ok, "at-risk": SEM.warn, blocked: SEM.bad, won: BRAND, lost: "#6B7280",
};

interface Props { onOpenTender: (id: string) => void; onOpenView: (v: string) => void }

export default function PipelineView({ onOpenTender, onOpenView }: Props) {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const { tenders } = useTenderResponseData();
  const { toast } = useToast();

  const kpis = useMemo(() => generateKpis(lang), [lang]);
  const stats = useMemo(() => pipelineStats(), []);
  const rail = useMemo(() => deadlineRail(), []);
  const recs = useMemo(() => generateRecommendations().slice(0, 4), []);

  const byStage = STAGE_ORDER.map((s) => ({ stage: s, items: tenders.filter((t) => t.stage === s) }));

  return (
    <div className="space-y-6">
      {/* Hero digest */}
      <div className="rounded-2xl p-6 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#A6E2AF" }}>
          {t("title", i18n)}
        </p>
        <h2 className="mt-1 text-xl font-extrabold">{t("digestHeadline", i18n)}</h2>
        <ul className="mt-3 grid md:grid-cols-2 gap-1.5 text-[12px] text-gray-200">
          <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" style={{ color: BRAND }} />{t("digestBullet1", i18n)}</li>
          <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" style={{ color: BRAND }} />{t("digestBullet2", i18n)}</li>
          <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" style={{ color: BRAND }} />{t("digestBullet3", i18n)}</li>
          <li className="flex gap-1.5"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" style={{ color: BRAND }} />{t("digestBullet4", i18n)}</li>
        </ul>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.id} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{k.label[lang]}</p>
            <p className="mt-1 text-2xl font-extrabold" style={{ color: NAVY }}>{k.value}</p>
            <p className={`text-[11px] font-bold mt-1 ${k.trend === "up" ? "text-emerald-600" : k.trend === "down" ? "text-red-600" : "text-gray-500"}`}>
              {k.trend === "up" ? "▲" : k.trend === "down" ? "▼" : "•"} {k.delta[lang]}
            </p>
          </div>
        ))}
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<AlertTriangle size={14} />} color={SEM.warn} label={lang === "ar" ? "معرّض للخطر" : "At risk"} value={`${stats.atRisk} / ${stats.active}`} />
        <Stat icon={<CheckCircle2 size={14} />} color={SEM.ok} label={lang === "ar" ? "في الموعد" : "On track"} value={`${stats.onTrack} / ${stats.active}`} />
        <Stat icon={<Sparkles size={14} />} color={SEM.ai} label={lang === "ar" ? "موافقات معلّقة" : "Pending approvals"} value={`${stats.pendingApprovals}`} />
        <Stat icon={<Clock size={14} />} color={SEM.bad} label={lang === "ar" ? "رسائل ناقصة" : "LoS pending"} value={`${stats.losPending}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Kanban */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold" style={{ color: NAVY }}>{t("kanbanTitle", i18n)}</h3>
            <button onClick={() => onOpenView("tender")} className="text-[11px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: BRAND }}>
              {lang === "ar" ? "افتح الورشة" : "Open workspace"} <ArrowRight size={12} />
            </button>
          </div>
          <div className="overflow-x-auto -mx-4 px-4">
            <div className="flex gap-2 min-w-max pb-2">
              {byStage.map(({ stage, items }) => (
                <div key={stage} className="w-[200px] flex-shrink-0 bg-gray-50 rounded-xl p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t(STAGE_KEY[stage], i18n)}</p>
                    <span className="text-[10px] font-bold text-gray-400">{items.length}</span>
                  </div>
                  <div className="space-y-1.5 min-h-[40px]">
                    {items.map((tn) => (
                      <button
                        key={tn.id}
                        onClick={() => onOpenTender(tn.id)}
                        className="block w-full text-start bg-white rounded-lg p-2 border border-gray-100 hover:border-gray-300 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-[11px] font-bold leading-tight truncate" style={{ color: NAVY }}>
                            {tn.rfpRef}
                          </p>
                          <span className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: HEALTH_COLOR[tn.health] }} />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2 leading-tight">{tn.title[lang]}</p>
                        <div className="mt-1.5 flex items-center justify-between text-[9px]">
                          <span className="text-gray-500">{formatSAR(tn.totalValueSAR, lang)}</span>
                          <span className="font-bold" style={{ color: HEALTH_COLOR[tn.health] }}>{t(HEALTH_KEY[tn.health], i18n)}</span>
                        </div>
                      </button>
                    ))}
                    {items.length === 0 && <div className="text-center text-[10px] text-gray-300 py-2">—</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Deadline rail */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: NAVY }}>{t("deadlineTitle", i18n)}</h3>
          <div className="space-y-2.5">
            {rail.map((r) => {
              const urgent = r.days <= 4;
              return (
                <button key={r.id} onClick={() => onOpenTender(r.id)} className="w-full text-start rounded-lg p-2.5 hover:bg-gray-50 transition-colors border border-gray-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold truncate" style={{ color: NAVY }}>{r.rfpRef}</p>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${urgent ? "text-white" : ""}`} style={urgent ? { background: SEM.bad } : { background: BRAND_MUTED, color: BRAND_DARK }}>
                      {r.days >= 0 ? `D-${r.days}` : `D+${-r.days}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{r.title[lang]}</p>
                  <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${r.progress}%`, background: BRAND }} />
                  </div>
                  <p className="text-[9px] text-gray-400 mt-1">{r.progress}% {t("approved", i18n)} · {r.questionsDrafted}/{r.questionsTotal} {t("drafted", i18n)}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold inline-flex items-center gap-2" style={{ color: NAVY }}>
            <Sparkles size={14} style={{ color: BRAND }} />
            {t("recsTitle", i18n)}
          </h3>
          <button onClick={() => onOpenView("approvals")} className="text-[11px] font-bold hover:underline" style={{ color: BRAND }}>
            {lang === "ar" ? "كل الموافقات" : "All approvals →"}
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {recs.map((r) => (
            <div key={r.id} className="border border-gray-100 rounded-xl p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[9px] uppercase tracking-widest font-extrabold px-2 py-0.5 rounded-full" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>
                  {r.agentId}
                </span>
                <span className={`text-[9px] uppercase font-bold ${r.severity === "critical" ? "text-red-600" : r.severity === "high" ? "text-amber-600" : "text-gray-500"}`}>
                  {r.severity}
                </span>
              </div>
              <p className="text-[12px] font-bold leading-snug" style={{ color: NAVY }}>{r.title[lang]}</p>
              <p className="text-[11px] text-gray-600 mt-1 line-clamp-3 leading-snug">{r.rationale[lang]}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-gray-500">{t("confidence", i18n)} <b style={{ color: BRAND }}>{r.confidence}%</b></span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toast({ title: lang === "ar" ? "تمّ الاعتماد" : "Approved", description: r.recommendedAction[lang] })}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-md text-white"
                    style={{ background: BRAND }}
                  >
                    {t("approve", i18n)}
                  </button>
                  <Link
                    href="#"
                    onClick={(e) => { e.preventDefault(); onOpenTender(r.tenderId); }}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    {t("open", i18n)}
                  </Link>
                  <button
                    onClick={() => toast({ title: lang === "ar" ? "تجاهل" : "Dismissed" })}
                    className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: color }}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 truncate">{label}</p>
        <p className="text-sm font-extrabold" style={{ color: NAVY }}>{value}</p>
      </div>
    </div>
  );
}
