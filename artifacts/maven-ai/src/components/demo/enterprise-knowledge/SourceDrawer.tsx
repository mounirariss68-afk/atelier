import { useEffect, useRef } from "react";
import { Check, Lock, ShieldAlert, X } from "lucide-react";
import { useEkcLang, useEkcT } from "./DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { sourceDrawer } from "./knowledge-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import {
  fullBodyParts,
  isVisibleTo,
  sourceById,
  type Classification,
} from "@/data/enterprise-knowledge-seed";

const CLASS_LABEL: Record<Classification, { en: string; ar: string }> = {
  public: { en: "Public", ar: "عام" },
  internal: { en: "Internal", ar: "داخلي" },
  confidential: { en: "Confidential", ar: "سرّي" },
  "legal-privileged": { en: "Legal-privileged", ar: "سرّ قانوني" },
};

const CLASS_COLOR: Record<Classification, string> = {
  public: "#6B7280",
  internal: "#3B82F6",
  confidential: "#F59E0B",
  "legal-privileged": "#E30613",
};

export default function SourceDrawer() {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const isAr = lang === "ar";
  const {
    openSourceId,
    setOpenSourceId,
    personaId,
    accessRequestedIds,
    requestSourceAccess,
  } = useEkcData();

  const passageRef = useRef<HTMLSpanElement>(null);
  const source = openSourceId ? sourceById(openSourceId) : undefined;

  useEffect(() => {
    if (!source) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenSourceId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source, setOpenSourceId]);

  useEffect(() => {
    if (source && passageRef.current) {
      const el = passageRef.current;
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [openSourceId, source]);

  if (!source) return null;

  const visible = isVisibleTo(source, personaId);
  const requested = accessRequestedIds.includes(source.id);
  const classColor = CLASS_COLOR[source.classification];
  const classLabel = CLASS_LABEL[source.classification][lang];
  const parts = fullBodyParts(source, lang);

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={source.title[lang]}
      dir={isAr ? "rtl" : "ltr"}
    >
      <button
        type="button"
        aria-label={t("close", sourceDrawer)}
        onClick={() => setOpenSourceId(null)}
        className="flex-1 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        className={`w-full max-w-[560px] h-full bg-white shadow-2xl flex flex-col animate-in ${
          isAr ? "slide-in-from-left" : "slide-in-from-right"
        } duration-200`}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: BRAND }}>
              {t("fullDocument", sourceDrawer)}
            </p>
            <p className="text-[15px] font-extrabold mt-0.5 leading-snug" style={{ color: BRAND_INK }}>
              {source.title[lang]}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpenSourceId(null)}
            aria-label={t("close", sourceDrawer)}
            className="flex-shrink-0 w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Meta */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-gray-100 grid grid-cols-2 gap-x-4 gap-y-2 bg-gray-50">
          <Meta label={t("metaOwner", sourceDrawer)} value={source.owner[lang]} />
          <Meta label={t("metaDomain", sourceDrawer)} value={source.domain[lang]} />
          <Meta label={t("metaUpdated", sourceDrawer)} value={source.updatedAt} />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              {t("metaClassification", sourceDrawer)}
            </p>
            <span
              className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
              style={{ background: `${classColor}1A`, color: classColor }}
            >
              {classLabel}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {visible ? (
            <article className="text-[13px] leading-relaxed text-gray-800 whitespace-pre-line">
              <p className="text-[11px] text-gray-500 mb-3">
                {t("highlightedInContext", sourceDrawer)}
              </p>
              <span>{parts.intro}</span>
              <span
                ref={passageRef}
                className="inline rounded px-1 py-0.5 font-semibold"
                style={{ background: "#FEF3C7", color: BRAND_INK, boxShadow: "inset 0 -2px 0 #F59E0B" }}
                aria-label={t("citedPassage", sourceDrawer)}
              >
                {parts.passage}
              </span>
              <span>{parts.outro}</span>
            </article>
          ) : (
            <div className="bg-[#FFF7F7] border border-[#FECACA] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock size={14} style={{ color: "#E30613" }} />
                <p className="text-[12px] font-extrabold uppercase" style={{ color: "#E30613" }}>
                  {t("withheldTitle", sourceDrawer)}
                </p>
              </div>
              <p className="text-[12px] text-gray-700 leading-relaxed mb-3">
                {t("withheldBody", sourceDrawer)}
              </p>
              <div className="bg-white border border-[#FECACA] rounded-lg p-3 mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">
                  {t("requiredAcl", sourceDrawer)}
                </p>
                <p className="text-[11px] text-gray-700 font-mono">{source.aclGroups.join(", ")}</p>
              </div>
              {requested ? (
                <div className="flex items-start gap-2 bg-white border border-emerald-200 rounded-lg p-3">
                  <Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] font-extrabold text-emerald-700">
                      {t("accessRequested", sourceDrawer)}
                    </p>
                    <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                      {t("accessRequestedBody", sourceDrawer)}
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => requestSourceAccess(source.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-white"
                  style={{ background: BRAND_INK }}
                >
                  <ShieldAlert size={13} />
                  {t("requestAccess", sourceDrawer)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-[12px] text-gray-800 font-semibold mt-0.5 truncate">{value}</p>
    </div>
  );
}
