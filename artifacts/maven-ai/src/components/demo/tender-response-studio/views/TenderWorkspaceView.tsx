import { useMemo, useState } from "react";
import { ChevronRight, FileText, AlertCircle, CheckCircle2, Clock, RotateCcw, Lock, Search } from "lucide-react";
import { useTenderResponseData } from "@/hooks/useTenderResponseData";
import { useTenderDemoLang, useTenderDemoT } from "../DemoLangContext";
import { tender as i18n } from "../tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY, SEM } from "../tokens";
import { formatSAR, daysUntil, getSme, type AnswerStatus } from "@/data/tender-response-seed";
import { useToast } from "@/hooks/use-toast";

const STATUS_KEY: Record<AnswerStatus, string> = {
  drafted: "statusDrafted", "sme-review": "statusSmeReview", approved: "statusApproved",
  "needs-rework": "statusNeedsRework", blocked: "statusBlocked",
};
const STATUS_COLOR: Record<AnswerStatus, string> = {
  drafted: SEM.info, "sme-review": SEM.ai, approved: SEM.ok,
  "needs-rework": SEM.warn, blocked: SEM.bad,
};
const STATUS_ICON: Record<AnswerStatus, React.ReactNode> = {
  drafted: <FileText size={11} />, "sme-review": <Clock size={11} />, approved: <CheckCircle2 size={11} />,
  "needs-rework": <RotateCcw size={11} />, blocked: <Lock size={11} />,
};

const SECTIONS: { id: string; label: { en: string; ar: string } }[] = [
  { id: "S1-Cover", label: { en: "S1 · Cover", ar: "S1 · غلاف" } },
  { id: "S2-Past", label: { en: "S2 · Past performance", ar: "S2 · السوابق" } },
  { id: "S3-Technical", label: { en: "S3 · Technical", ar: "S3 · تقني" } },
  { id: "S4-Security", label: { en: "S4 · Security", ar: "S4 · أمن" } },
  { id: "S5-Commercial", label: { en: "S5 · Commercial", ar: "S5 · تجاري" } },
  { id: "S6-Compliance", label: { en: "S6 · Compliance", ar: "S6 · امتثال" } },
  { id: "S7-Partner", label: { en: "S7 · Partner", ar: "S7 · شركاء" } },
];

export default function TenderWorkspaceView() {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const { activeTender, activeQuestions, smes } = useTenderResponseData();
  const { toast } = useToast();
  const [section, setSection] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return activeQuestions.filter((qq) =>
      (section === "all" || qq.section === section) &&
      (status === "all" || qq.status === status) &&
      (!q || qq.prompt.en.toLowerCase().includes(q.toLowerCase()) || qq.prompt.ar.includes(q))
    );
  }, [activeQuestions, section, status, q]);

  const byStatus = (s: AnswerStatus) => activeQuestions.filter((q) => q.status === s).length;
  const days = daysUntil(activeTender.dueAt);

  const sectionProgress = SECTIONS.map((s) => {
    const inSec = activeQuestions.filter((qq) => qq.section === s.id);
    const approved = inSec.filter((qq) => qq.status === "approved").length;
    return { ...s, total: inSec.length, approved, pct: Math.round((approved / Math.max(1, inSec.length)) * 100) };
  });

  return (
    <div className="space-y-5">
      {/* Tender header */}
      <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#A6E2AF" }}>
              {activeTender.rfpRef} · {activeTender.buyer[lang]}
            </p>
            <h2 className="mt-1 text-xl font-extrabold">{t("title", i18n)}</h2>
            <p className="mt-1 text-[12px] text-gray-200 max-w-3xl">{t("subtitle", i18n)}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Pill label={lang === "ar" ? "القيمة" : "Value"} value={formatSAR(activeTender.totalValueSAR, lang)} />
            <Pill label={lang === "ar" ? "تقديم" : "Due"} value={`D-${days}`} accent={days <= 4 ? SEM.bad : BRAND} />
            <Pill label={lang === "ar" ? "جدارة" : "Fit"} value={`${activeTender.fitScore}%`} />
            <Pill label={lang === "ar" ? "صفحات" : "Pages"} value={`${activeTender.pages}`} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
          {(["approved", "sme-review", "drafted", "needs-rework", "blocked"] as AnswerStatus[]).map((s) => (
            <div key={s} className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between">
                <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: "#cbd5e1" }}>{t(STATUS_KEY[s], i18n)}</p>
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              </div>
              <p className="text-lg font-extrabold mt-0.5">{byStatus(s)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section progress */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: NAVY }}>{lang === "ar" ? "تقدّم الأقسام" : "Section progress"}</h3>
        <div className="grid md:grid-cols-7 grid-cols-2 gap-2">
          {sectionProgress.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(section === s.id ? "all" : s.id)}
              className={`rounded-lg p-2.5 text-start border transition-colors ${section === s.id ? "border-emerald-300 bg-emerald-50" : "border-gray-100 hover:border-gray-300"}`}
            >
              <p className="text-[10px] font-bold truncate" style={{ color: NAVY }}>{s.label[lang]}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">{s.approved}/{s.total} ✓</p>
              <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: BRAND }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters + search */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 ms-2.5 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={lang === "ar" ? "بحث في الأسئلة…" : "Search prompts…"}
              className="w-full ps-8 pe-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-gray-500">{t("filterStatus", i18n)}:</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-200 rounded-md px-2 py-1 text-[11px] font-medium">
              <option value="all">{t("filterAll", i18n)}</option>
              <option value="approved">{t("statusApproved", i18n)}</option>
              <option value="sme-review">{t("statusSmeReview", i18n)}</option>
              <option value="drafted">{t("statusDrafted", i18n)}</option>
              <option value="needs-rework">{t("statusNeedsRework", i18n)}</option>
              <option value="blocked">{t("statusBlocked", i18n)}</option>
            </select>
          </div>
          <span className="text-[11px] text-gray-500 ms-auto">{filtered.length} {lang === "ar" ? "إجابة" : "answers"}</span>
        </div>

        {/* Question list */}
        <div className="divide-y divide-gray-50">
          {filtered.map((qq) => {
            const sme = getSme(qq.smeOwner);
            const sec = SECTIONS.find((s) => s.id === qq.section);
            return (
              <div key={qq.id} className="py-3 flex items-start gap-3">
                <span className="text-[10px] font-extrabold mt-0.5 w-12 text-gray-400">{qq.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>{sec?.label[lang]}</span>
                    <span
                      className="text-[10px] font-extrabold px-2 py-0.5 rounded-full inline-flex items-center gap-1 text-white"
                      style={{ background: STATUS_COLOR[qq.status] }}
                    >
                      {STATUS_ICON[qq.status]}
                      {t(STATUS_KEY[qq.status], i18n)}
                    </span>
                    {qq.flag && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-50 text-amber-700">
                        <AlertCircle size={11} />{t("flag", i18n)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] font-semibold" style={{ color: NAVY }}>{qq.prompt[lang]}</p>
                  {qq.flag && <p className="mt-1 text-[11px] text-amber-700">{qq.flag[lang]}</p>}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
                    <span>{t("draftedBy", i18n)}: <b style={{ color: NAVY }}>{qq.draftAgent}</b></span>
                    <span>{t("smeOwner", i18n)}: {sme && (
                      <span className="inline-flex items-center gap-1 ms-0.5">
                        <span className="w-3.5 h-3.5 rounded-full text-white text-[7px] font-extrabold inline-flex items-center justify-center" style={{ background: sme.color }}>{sme.initials}</span>
                        <b style={{ color: NAVY }}>{sme.name[lang]}</b>
                      </span>
                    )}</span>
                    <span>{qq.wordCount} {t("words", i18n)}</span>
                    <span>{qq.citationsFromLibrary} {t("cites", i18n)}</span>
                    <span className="text-emerald-600 font-bold">{t("confidence", i18n)} {qq.confidence}%</span>
                    {qq.precedentAnswerId && <span className="text-violet-600">{t("precedent", i18n)} {qq.precedentAnswerId}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {qq.status !== "approved" && (
                    <button
                      onClick={() => toast({ title: lang === "ar" ? "تمّ الاعتماد" : "Answer approved", description: qq.id })}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-md text-white"
                      style={{ background: BRAND }}
                    >
                      {t("approveAnswer", i18n)}
                    </button>
                  )}
                  <button
                    onClick={() => toast({ title: lang === "ar" ? "أُعيدت للخبير" : "Sent back to SME", description: qq.id })}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    {t("reworkAnswer", i18n)}
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">{lang === "ar" ? "لا نتائج" : "No matches"}</p>}
        </div>
      </div>

      {/* SME load */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: NAVY }}>{t("smeLoadTitle", i18n)}</h3>
        <div className="space-y-2">
          {smes.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full text-white text-[10px] font-extrabold flex-shrink-0 inline-flex items-center justify-center" style={{ background: s.color }}>{s.initials}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold truncate" style={{ color: NAVY }}>{s.name[lang]}</p>
                <p className="text-[10px] text-gray-500 truncate">{s.role[lang]}</p>
              </div>
              <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(s.load / 12) * 100}%`, background: s.color }} />
              </div>
              <span className="text-[11px] font-extrabold w-10 text-end" style={{ color: NAVY }}>{s.load}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="px-3 py-1.5 rounded-lg text-white" style={{ background: accent ?? "rgba(255,255,255,0.12)" }}>
      <p className="text-[9px] uppercase tracking-widest font-bold opacity-80">{label}</p>
      <p className="text-[12px] font-extrabold">{value}</p>
    </div>
  );
}
