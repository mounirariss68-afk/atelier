import { useState } from "react";
import { Search, Eye, EyeOff } from "lucide-react";
import { useEkcLang, useEkcT } from "../DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { sourceLibrary, sourceRail } from "../knowledge-i18n";
import { BRAND, BRAND_INK } from "../tokens";
import { isVisibleTo, type Classification } from "@/data/enterprise-knowledge-seed";

const CLASS_LABEL: Record<Classification, keyof typeof sourceRail> = {
  public: "classifPublic",
  internal: "classifInternal",
  confidential: "classifConfidential",
  "legal-privileged": "classifLegal",
};
const CLASS_COLOR: Record<Classification, string> = {
  public: "#6B7280",
  internal: "#3B82F6",
  confidential: "#F59E0B",
  "legal-privileged": "#E30613",
};

export default function SourceLibraryView() {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const { sources, personaId } = useEkcData();
  const [filter, setFilter] = useState<"all" | "visible" | "hidden">("all");
  const [query, setQuery] = useState("");

  const rows = sources
    .filter((s) => {
      const visible = isVisibleTo(s, personaId);
      if (filter === "visible") return visible;
      if (filter === "hidden") return !visible;
      return true;
    })
    .filter((s) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return s.title.en.toLowerCase().includes(q) || s.title.ar.includes(q) || s.owner.en.toLowerCase().includes(q);
    });

  const filterButtons: { id: typeof filter; label: string }[] = [
    { id: "all", label: t("filterAll", sourceLibrary) },
    { id: "visible", label: t("filterVisible", sourceLibrary) },
    { id: "hidden", label: t("filterHidden", sourceLibrary) },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", sourceLibrary)}</h1>
        <p className="text-[12px] text-gray-600 mt-0.5">{t("subtitle", sourceLibrary)}</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-1.5 flex-1 min-w-[200px]">
          <Search size={14} className="text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lang === "en" ? "Search sources…" : "ابحث في المصادر…"}
            className="flex-1 text-[12px] outline-none bg-transparent"
          />
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {filterButtons.map((b) => {
            const active = filter === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setFilter(b.id)}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition`}
                style={active ? { background: BRAND, color: "white" } : { color: "#6B7280" }}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-gray-50 text-start">
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colTitle", sourceLibrary)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colOwner", sourceLibrary)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colClass", sourceLibrary)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600 hidden md:table-cell">{t("colAcl", sourceLibrary)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600 hidden md:table-cell">{t("colUpdated", sourceLibrary)}</th>
              <th className="px-3 py-2 text-start font-bold text-gray-600">{t("colVisible", sourceLibrary)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const visible = isVisibleTo(s, personaId);
              return (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-3 py-2.5">
                    <p className="font-bold" style={{ color: BRAND_INK }}>{s.title[lang]}</p>
                    <p className="text-[11px] text-gray-500">{s.domain[lang]}</p>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{s.owner[lang]}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                      style={{ background: `${CLASS_COLOR[s.classification]}1A`, color: CLASS_COLOR[s.classification] }}
                    >
                      {t(CLASS_LABEL[s.classification], sourceRail)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 text-[11px] hidden md:table-cell">{s.aclGroups.join(", ")}</td>
                  <td className="px-3 py-2.5 text-gray-600 text-[11px] hidden md:table-cell">{s.updatedAt}</td>
                  <td className="px-3 py-2.5">
                    {visible ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "#10B981" }}>
                        <Eye size={12} /> {t("yes", sourceLibrary)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "#E30613" }}>
                        <EyeOff size={12} /> {t("no", sourceLibrary)}
                      </span>
                    )}
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
