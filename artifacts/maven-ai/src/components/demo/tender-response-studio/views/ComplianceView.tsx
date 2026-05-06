import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Upload } from "lucide-react";
import { useTenderResponseData } from "@/hooks/useTenderResponseData";
import { useTenderDemoLang, useTenderDemoT } from "../DemoLangContext";
import { compliance as i18n } from "../tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY, SEM } from "../tokens";
import { useToast } from "@/hooks/use-toast";

const STATUS_META = {
  pass: { color: SEM.ok, icon: <CheckCircle2 size={14} />, key: "passing" },
  warn: { color: SEM.warn, icon: <AlertTriangle size={14} />, key: "warning" },
  fail: { color: SEM.bad, icon: <XCircle size={14} />, key: "failing" },
} as const;

export default function ComplianceView() {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const { complianceGates, activeTender } = useTenderResponseData();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [override, setOverride] = useState(false);

  const counts = useMemo(() => ({
    pass: complianceGates.filter((g) => g.status === "pass").length,
    warn: complianceGates.filter((g) => g.status === "warn").length,
    fail: complianceGates.filter((g) => g.status === "fail").length,
  }), [complianceGates]);
  const score = Math.round((counts.pass / complianceGates.length) * 100);
  const blocked = counts.fail > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#A6E2AF" }}>
          {activeTender.rfpRef}
        </p>
        <h2 className="mt-1 text-xl font-extrabold">{t("title", i18n)}</h2>
        <p className="mt-1 text-[12px] text-gray-200 max-w-3xl">{t("subtitle", i18n)}</p>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 md:col-span-1">
          <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{t("scoreLabel", i18n)}</p>
          <p className="mt-2 text-5xl font-extrabold" style={{ color: BRAND }}>{score}%</p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${score}%`, background: BRAND }} />
          </div>
        </div>
        {(["pass", "warn", "fail"] as const).map((s) => {
          const meta = STATUS_META[s];
          return (
            <div key={s} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-2 text-white inline-flex p-2 rounded-lg" style={{ background: meta.color }}>{meta.icon}</div>
              <p className="mt-2 text-3xl font-extrabold" style={{ color: NAVY }}>{counts[s]}</p>
              <p className="text-[11px] uppercase tracking-widest font-bold text-gray-500">{t(meta.key, i18n)}</p>
            </div>
          );
        })}
      </div>

      {/* Gates */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
              <th className="px-4 py-2 text-start">{t("category", i18n)}</th>
              <th className="px-4 py-2 text-start">{t("rule", i18n)}</th>
              <th className="px-4 py-2 text-start">{t("evidence", i18n)}</th>
              <th className="px-4 py-2 text-start">{t("agent", i18n)}</th>
              <th className="px-4 py-2 text-start">{t("status", i18n)}</th>
            </tr>
          </thead>
          <tbody>
            {complianceGates.map((g) => {
              const meta = STATUS_META[g.status];
              return (
                <tr key={g.id} className="border-t border-gray-50">
                  <td className="px-4 py-3 font-bold align-top" style={{ color: NAVY }}>{g.category[lang]}</td>
                  <td className="px-4 py-3 align-top text-gray-700">{g.rule[lang]}</td>
                  <td className="px-4 py-3 align-top text-gray-500 text-[11px]">{g.evidence[lang]}</td>
                  <td className="px-4 py-3 align-top">
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>{g.agent}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-white px-2 py-1 rounded-full" style={{ background: meta.color }}>
                      {meta.icon}{t(meta.key, i18n)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Submission gate */}
      <div className={`rounded-2xl border p-5 ${blocked && !override ? "border-red-200 bg-red-50" : submitted ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: submitted ? BRAND : blocked && !override ? SEM.bad : SEM.warn }}>
            <ShieldCheck size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold" style={{ color: NAVY }}>{t("releaseGate", i18n)}</p>
            <p className="text-[12px] text-gray-600 mt-0.5">
              {submitted ? t("submittedToast", i18n) : blocked ? t("releaseBlocked", i18n) : (lang === "ar" ? "جاهز للتقديم — راجع التحذيرات." : "Ready to submit — review warnings first.")}
            </p>
          </div>
          {!submitted && (
            <div className="flex items-center gap-2">
              {blocked && !override && (
                <button onClick={() => setOverride(true)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-100">
                  {t("forceRelease", i18n)}
                </button>
              )}
              <button
                disabled={blocked && !override}
                onClick={() => { setSubmitted(true); toast({ title: t("submittedToast", i18n) }); }}
                className="text-[11px] font-bold px-4 py-2 rounded-lg text-white inline-flex items-center gap-1.5 disabled:opacity-40"
                style={{ background: BRAND }}
              >
                <Upload size={12} />{t("submitPacket", i18n)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
