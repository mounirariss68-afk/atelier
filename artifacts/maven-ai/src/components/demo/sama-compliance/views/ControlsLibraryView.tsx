import { useMemo, useState } from "react";
import { ShieldCheck, Search } from "lucide-react";
import { useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import { DOMAINS, DOMAIN_LABEL, ragBg, type ObligationDomain } from "@/data/sama-compliance-seed";
import { useSamaDemoLang } from "../DemoLangContext";
import { controls as controlsDict, useTrFactory } from "../sama-i18n";
import { BRAND, BRAND_INK } from "../tokens";

type Result = "all" | "pass" | "partial" | "fail" | "overdue";

const RESULT_BG: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  fail: "bg-red-100 text-red-700",
  overdue: "bg-orange-100 text-orange-700",
};

export default function ControlsLibraryView() {
  const { controls } = useSamaComplianceData();
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";

  const [result, setResult] = useState<Result>("all");
  const [domain, setDomain] = useState<"all" | ObligationDomain>("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return controls.filter((c) => {
      if (result !== "all" && c.lastTestResult !== result) return false;
      if (domain !== "all" && c.domain !== domain) return false;
      if (q.trim()) {
        const needle = q.toLowerCase();
        if (!`${c.id} ${c.titleEn} ${c.titleAr} ${c.ownerName}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [controls, result, domain, q]);

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: BRAND_INK }}>
          <ShieldCheck size={18} style={{ color: BRAND }} />
          {t("title", controlsDict)}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", controlsDict)}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-3" : "left-3"} text-gray-400`} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAr ? "بحث في الضوابط…" : "Search controls…"} className={`w-full ${isAr ? "pr-9 pl-3" : "pl-9 pr-3"} py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400`} />
        </div>
        <Pill label={t("filterDomain", controlsDict)} value={domain} onChange={(v) => setDomain(v as typeof domain)} options={[["all", isAr ? "الكل" : "All"], ...DOMAINS.map((d) => [d, DOMAIN_LABEL[d][lang] ?? DOMAIN_LABEL[d].en] as [string, string])]} />
        <Pill label={t("filterResult", controlsDict)} value={result} onChange={(v) => setResult(v as Result)} options={[["all", isAr ? "الكل" : "All"], ["pass", t("pass", controlsDict)], ["partial", t("partial", controlsDict)], ["fail", t("fail", controlsDict)], ["overdue", t("overdue", controlsDict)]]} />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">{t("colId", controlsDict)}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("colOwner", controlsDict)}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("colFreq", controlsDict)}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("colLastTest", controlsDict)}</th>
                <th className="px-3 py-2.5 text-center font-semibold">{t("colObligations", controlsDict)}</th>
                <th className="px-3 py-2.5 text-center font-semibold">{t("colEvidence", controlsDict)}</th>
                <th className="px-3 py-2.5 text-left font-semibold">{t("colRag", controlsDict)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.slice(0, 60).map((c) => (
                <tr key={c.id} className="hover:bg-amber-50/40">
                  <td className="px-3 py-2">
                    <p className="font-mono font-bold text-[11px]" style={{ color: BRAND_INK }}>{c.id}</p>
                    <p className="text-gray-700">{isAr ? c.titleAr : c.titleEn}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{c.ownerName}</p>
                    <p className="text-[10px] text-gray-500">{lang === "ar" ? c.ownerTitleAr : c.ownerTitleEn}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-600 capitalize">{c.frequency}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${RESULT_BG[c.lastTestResult] ?? "bg-gray-100 text-gray-700"}`}>{c.lastTestResult}</span>
                    <p className="text-[10px] text-gray-500 mt-0.5">{c.lastTestedAt.slice(0, 10)}</p>
                  </td>
                  <td className="px-3 py-2 text-center">{c.obligationIds.length}</td>
                  <td className="px-3 py-2 text-center">{c.evidenceCount}</td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ragBg(c.rag)}`}>{c.rag.toUpperCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
          {isAr ? "عرض" : "Showing"} {Math.min(60, filtered.length)} {isAr ? "من" : "of"} {filtered.length} · 80 {isAr ? "إجمالي" : "total"}
        </div>
      </div>
    </div>
  );
}

function Pill({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-semibold text-gray-500">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
