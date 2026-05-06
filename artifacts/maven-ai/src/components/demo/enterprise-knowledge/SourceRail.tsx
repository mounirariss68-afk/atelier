import { EyeOff, FileText, Lock } from "lucide-react";
import { useEkcLang, useEkcT } from "./DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { sourceRail } from "./knowledge-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import { sourceById, isVisibleTo, type Classification } from "@/data/enterprise-knowledge-seed";
import PersonaSwitcher from "./PersonaSwitcher";

interface Props {
  consideredSourceIds: string[];
  citedSourceIds: string[];
}

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

export default function SourceRail({ consideredSourceIds, citedSourceIds }: Props) {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const { personaId, setOpenSourceId } = useEkcData();

  const considered = consideredSourceIds
    .map((id) => sourceById(id))
    .filter((s): s is NonNullable<ReturnType<typeof sourceById>> => !!s);
  const visible = considered.filter((s) => isVisibleTo(s, personaId));
  const withheld = considered.filter((s) => !isVisibleTo(s, personaId));

  return (
    <aside className="w-[340px] flex-shrink-0 border-s border-gray-200 bg-white flex flex-col">
      <div className="p-4 border-b border-gray-100">
        <PersonaSwitcher />
      </div>

      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-[12px] font-extrabold" style={{ color: BRAND_INK }}>{t("title", sourceRail)}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{t("subtitle", sourceRail)}</p>
      </div>

      {considered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <FileText size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-[12px] font-bold text-gray-600">{t("emptyTitle", sourceRail)}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t("emptyBody", sourceRail)}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {visible.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-1 mb-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: BRAND }}>
                  {t("visibleLabel", sourceRail)}
                </p>
                <span className="text-[10px] font-semibold text-gray-500">{visible.length}</span>
              </div>
              <div className="space-y-1.5">
                {visible.map((s) => {
                  const isCited = citedSourceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setOpenSourceId(s.id)}
                      className="w-full text-start border rounded-xl p-2.5 transition border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {isCited ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white" style={{ background: BRAND }}>
                              {citedSourceIds.indexOf(s.id) + 1}
                            </span>
                          ) : (
                            <FileText size={14} className="text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold truncate" style={{ color: BRAND_INK }}>{s.title[lang]}</p>
                          <p className="text-[10px] text-gray-500 truncate">{s.owner[lang]} · {s.updatedAt}</p>
                          <span
                            className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                            style={{ background: `${CLASS_COLOR[s.classification]}1A`, color: CLASS_COLOR[s.classification] }}
                          >
                            {t(CLASS_LABEL[s.classification], sourceRail)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {withheld.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-1 mb-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#E30613" }}>
                  {t("withheldLabel", sourceRail)}
                </p>
                <span className="text-[10px] font-semibold text-gray-500">{withheld.length}</span>
              </div>
              <div className="space-y-1.5">
                {withheld.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setOpenSourceId(s.id)}
                    className="w-full text-start border border-gray-200 rounded-xl p-2.5 bg-[#FFF7F7] hover:bg-[#FFEFEF] transition"
                  >
                    <div className="flex items-start gap-2">
                      <Lock size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold truncate" style={{ color: BRAND_INK }}>{s.title[lang]}</p>
                        <p className="text-[10px] text-gray-500 truncate">{s.owner[lang]}</p>
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: "#FEE2E2", color: "#E30613" }}>
                          <EyeOff size={9} /> {t(CLASS_LABEL[s.classification], sourceRail)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
