import { useState } from "react";
import { useSdsLang, useSdsT } from "../DemoLangContext";
import { obligations as oblDict } from "../sovereign-i18n";
import { OBLIGATIONS } from "@/data/sovereign-data-seed";
import { BRAND, BRAND_INK } from "../tokens";

const FRAMEWORK_COLORS: Record<string, string> = {
  PDPL: "#0E2841", NDMO: "#156082", SDAIA: "#196B24",
};

export default function ObligationsRegisterView() {
  const { lang } = useSdsLang();
  const t = useSdsT();
  const isAr = lang === "ar";
  const [filter, setFilter] = useState<"all" | "PDPL" | "NDMO" | "SDAIA">("all");

  const visible = filter === "all" ? OBLIGATIONS : OBLIGATIONS.filter((o) => o.framework === filter);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", oblDict)}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", oblDict)}</p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {(["all", "PDPL", "NDMO", "SDAIA"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border ${filter === f ? "text-white" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
            style={filter === f ? { background: f === "all" ? BRAND_INK : FRAMEWORK_COLORS[f], borderColor: f === "all" ? BRAND_INK : FRAMEWORK_COLORS[f] } : undefined}
          >
            {f === "all" ? (lang === "ar" ? "الكل" : "All") : f}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("framework", oblDict)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("clause", oblDict)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("topic", oblDict)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("enforcement", oblDict)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("status", oblDict)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("lastEnforced", oblDict)}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o.id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <span className="inline-block px-2 py-0.5 rounded-full text-white text-[10px] font-semibold" style={{ background: FRAMEWORK_COLORS[o.framework] }}>
                    {o.framework}
                  </span>
                </td>
                <td className="px-3 py-2 font-semibold text-gray-800">{o.clause}</td>
                <td className="px-3 py-2 text-gray-700">{o.topic[lang]}</td>
                <td className="px-3 py-2 text-gray-600 max-w-md">{o.enforcement[lang]}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status === "active" ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"}`}>
                    {o.status === "active" ? (lang === "ar" ? "نشط" : "Active") : (lang === "ar" ? "للمراجعة" : "Review")}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 text-[11px]">
                  {o.lastEnforcedHrAgo === 0 ? (lang === "ar" ? "الآن" : "just now") : o.lastEnforcedHrAgo < 24 ? `${o.lastEnforcedHrAgo}h` : `${Math.round(o.lastEnforcedHrAgo / 24)}d`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-500" style={{ color: BRAND }}>
        {lang === "ar" ? "البيانات المعروضة من السجل الداخلي للالتزامات." : "Register surfaced from the in-enclave obligations store."}
      </p>
    </div>
  );
}
