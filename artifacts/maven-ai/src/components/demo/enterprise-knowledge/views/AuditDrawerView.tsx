import { useState } from "react";
import { useEkcLang, useEkcT } from "../DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { audit } from "../knowledge-i18n";
import { BRAND, BRAND_INK } from "../tokens";
import { personaById, type PersonaId } from "@/data/enterprise-knowledge-seed";

const ACTION_COLOR: Record<string, string> = {
  answered: "#10B981", refused: "#E30613", escalated: "#F59E0B",
};

export default function AuditDrawerView() {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const { auditLog, personas } = useEkcData();
  const [filter, setFilter] = useState<"all" | PersonaId>("all");

  const rows = auditLog.filter((e) => filter === "all" || e.personaId === filter);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", audit)}</h1>
        <p className="text-[12px] text-gray-600 mt-0.5">{t("subtitle", audit)}</p>
      </div>

      <div className="flex flex-wrap gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-4 w-fit">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded-lg text-[11px] font-bold`}
          style={filter === "all" ? { background: BRAND, color: "white" } : { color: "#6B7280" }}
        >
          {t("filterAll", audit)}
        </button>
        {personas.map((p) => {
          const active = filter === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setFilter(p.id)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold`}
              style={active ? { background: BRAND, color: "white" } : { color: "#6B7280" }}
            >
              {p.role[lang]}
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colWhen", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colPersona", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colQuestion", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colVisible", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colCited", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colWithheld", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colConfidence", audit)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colAction", audit)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const p = personaById(e.personaId);
              const when = new Date(e.ts).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              });
              return (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-600 text-[11px]">{when}</td>
                  <td className="px-3 py-2">
                    <p className="font-bold text-[12px]" style={{ color: BRAND_INK }}>{p.name[lang]}</p>
                    <p className="text-[10px] text-gray-500">{p.role[lang]}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-700 max-w-[280px]">{e.question[lang]}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: BRAND_INK }}>{e.visibleCount}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: BRAND }}>{e.citedCount}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: e.withheldCount > 0 ? "#E30613" : "#9CA3AF" }}>{e.withheldCount}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: BRAND_INK }}>{e.confidence != null ? `${e.confidence}%` : "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                      style={{ background: `${ACTION_COLOR[e.action]}1A`, color: ACTION_COLOR[e.action] }}
                    >
                      {t(`action${e.action.charAt(0).toUpperCase()}${e.action.slice(1)}`, audit)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
