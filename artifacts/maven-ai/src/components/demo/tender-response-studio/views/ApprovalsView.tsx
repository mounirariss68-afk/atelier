import { useMemo, useState } from "react";
import { CheckCircle2, X, Edit3, Sparkles, ChevronRight } from "lucide-react";
import { useTenderDemoLang, useTenderDemoT } from "../DemoLangContext";
import { approvals as i18n } from "../tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY, SEM } from "../tokens";
import { generateRecommendations } from "@/data/tender-response-agent";
import { useToast } from "@/hooks/use-toast";
import { TENDERS } from "@/data/tender-response-seed";

const CHECKPOINT_KEY = {
  "bid-no-bid": "checkpointBidNoBid",
  "pricing-signoff": "checkpointPricing",
  "legal-release": "checkpointLegal",
} as const;

const CHECKPOINT_COLOR: Record<string, string> = {
  "bid-no-bid": BRAND,
  "pricing-signoff": SEM.warn,
  "legal-release": SEM.bad,
};

export default function ApprovalsView() {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const { toast } = useToast();
  const recs = useMemo(() => generateRecommendations(), []);
  const [resolved, setResolved] = useState<Record<string, "approved" | "rejected" | undefined>>({});

  const checkpoints = recs.filter((r) => r.checkpointId);
  const inline = recs.filter((r) => !r.checkpointId);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#A6E2AF" }}>
          {t("title", i18n)}
        </p>
        <h2 className="mt-1 text-xl font-extrabold">{lang === "ar" ? "ثلاث نقاط بشرية تنتظر قرارك" : "Three human checkpoints waiting on you"}</h2>
        <p className="mt-1 text-[12px] text-gray-200 max-w-3xl">{t("subtitle", i18n)}</p>
      </div>

      {/* Three named checkpoints */}
      <div className="grid lg:grid-cols-3 gap-3">
        {(["bid-no-bid", "pricing-signoff", "legal-release"] as const).map((cp) => {
          const items = checkpoints.filter((r) => r.checkpointId === cp);
          return (
            <div key={cp} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: CHECKPOINT_COLOR[cp] }} />
                <h3 className="text-[12px] font-extrabold uppercase tracking-widest" style={{ color: NAVY }}>{t(CHECKPOINT_KEY[cp], i18n)}</h3>
                <span className="ms-auto text-[10px] font-bold text-gray-400">{items.length}</span>
              </div>
              <p className="text-[10px] text-gray-500">
                {cp === "bid-no-bid" && (lang === "ar" ? "تقرّر التقديم بناءً على التأهيل والقدرة." : "Decide bid vs no-bid based on Qualifier output.")}
                {cp === "pricing-signoff" && (lang === "ar" ? "اعتمد سيناريو التسعير قبل دخوله الحزمة." : "Approve a pricing scenario before it lands in the packet.")}
                {cp === "legal-release" && (lang === "ar" ? "أفرج الحزمة بعد حلّ تنبيهات القانوني." : "Release the packet after legal flags are resolved.")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Checkpoint cards */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: NAVY }}>{lang === "ar" ? "نقاط الموافقة" : "Open checkpoints"}</h3>
        <div className="space-y-3">
          {checkpoints.map((r) => {
            const tender = TENDERS.find((t) => t.id === r.tenderId);
            const state = resolved[r.id];
            return (
              <div key={r.id} className={`border rounded-xl p-4 transition-colors ${state ? "bg-gray-50 border-gray-100 opacity-70" : "border-gray-200"}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] uppercase tracking-widest font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: CHECKPOINT_COLOR[r.checkpointId!] }}>
                        {t(CHECKPOINT_KEY[r.checkpointId!], i18n)}
                      </span>
                      <span className="text-[10px] font-bold text-gray-500">{tender?.rfpRef}</span>
                      <span className="text-[10px] text-gray-400 truncate">{tender?.title[lang]}</span>
                      {state && (
                        <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${state === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"}`}>
                          {t("resolved", i18n)} · {state}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[14px] font-bold leading-snug" style={{ color: NAVY }}>{r.title[lang]}</p>
                  </div>
                  <span className="text-[10px] font-bold text-gray-500 whitespace-nowrap">
                    {t("recommended", i18n)} · <b style={{ color: BRAND }}>{r.confidence}%</b>
                  </span>
                </div>
                <div className="mt-2 grid md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{t("rationale", i18n)}</p>
                    <p className="text-[12px] text-gray-700 mt-1 leading-snug">{r.rationale[lang]}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{t("options", i18n)}</p>
                    <ul className="mt-1 space-y-1">
                      <li className="text-[12px] text-gray-700 flex items-start gap-1.5">
                        <ChevronRight size={11} className="mt-1 flex-shrink-0" style={{ color: BRAND }} />
                        <span><b style={{ color: BRAND }}>★</b> {r.recommendedAction[lang]}</span>
                      </li>
                      {r.alternateActions.map((alt, i) => (
                        <li key={i} className="text-[12px] text-gray-600 flex items-start gap-1.5">
                          <ChevronRight size={11} className="mt-1 flex-shrink-0 text-gray-300" />
                          <span>{alt[lang]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {!state && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => { setResolved((p) => ({ ...p, [r.id]: "approved" })); toast({ title: t("approvedToast", i18n), description: r.title[lang] }); }}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white inline-flex items-center gap-1.5"
                      style={{ background: BRAND }}
                    >
                      <CheckCircle2 size={12} />{t("approve", i18n)}
                    </button>
                    <button
                      onClick={() => toast({ title: lang === "ar" ? "افتح للتعديل" : "Open editor", description: r.title[lang] })}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"
                    >
                      <Edit3 size={12} />{t("edit", i18n)}
                    </button>
                    <button
                      onClick={() => { setResolved((p) => ({ ...p, [r.id]: "rejected" })); toast({ title: t("rejectedToast", i18n) }); }}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 inline-flex items-center gap-1.5"
                    >
                      <X size={12} />{t("reject", i18n)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {checkpoints.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">{t("noPending", i18n)}</p>}
        </div>
      </div>

      {/* Inline operational recs */}
      {inline.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-bold mb-3 inline-flex items-center gap-2" style={{ color: NAVY }}>
            <Sparkles size={14} style={{ color: BRAND }} />
            {lang === "ar" ? "توصيات تشغيلية" : "Operational recommendations"}
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            {inline.map((r) => (
              <div key={r.id} className="border border-gray-100 rounded-xl p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest font-extrabold px-2 py-0.5 rounded-full" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>{r.agentId}</span>
                  <span className="text-[10px] font-bold text-gray-500">{r.confidence}% {lang === "ar" ? "ثقة" : "conf."}</span>
                </div>
                <p className="text-[12px] font-bold" style={{ color: NAVY }}>{r.title[lang]}</p>
                <p className="text-[11px] text-gray-600 mt-1 leading-snug">{r.rationale[lang]}</p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => toast({ title: lang === "ar" ? "تمّ الاعتماد" : "Approved" })}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-md text-white"
                    style={{ background: BRAND }}
                  >
                    {t("approve", i18n)}
                  </button>
                  <button
                    onClick={() => toast({ title: lang === "ar" ? "تجاهل" : "Dismissed" })}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    {t("reject", i18n)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
