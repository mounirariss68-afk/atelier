import { Check, Edit3, X, ShieldCheck } from "lucide-react";
import { useEkcLang, useEkcT } from "../DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { approvals } from "../knowledge-i18n";
import { BRAND, BRAND_INK } from "../tokens";
import { agentById } from "@/data/enterprise-knowledge-agent";
import { useToast } from "@/hooks/use-toast";

const SEV_COLOR: Record<string, string> = {
  critical: "#E30613", high: "#F59E0B", medium: "#3B82F6", info: "#6B7280",
};

export default function ApprovalsView() {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const { recommendations, setRecommendationStatus } = useEkcData();
  const { toast } = useToast();

  const checkpoints = recommendations.filter((r) => r.isCheckpoint);
  const derived = recommendations.filter((r) => !r.isCheckpoint);

  const handle = (id: string, action: "approved" | "edited" | "rejected") => {
    setRecommendationStatus(id, action);
    const titleKey = action === "approved" ? "toastApprovedTitle" : action === "edited" ? "toastEditedTitle" : "toastRejectedTitle";
    const descKey = action === "approved" ? "toastApprovedDesc" : action === "edited" ? "toastEditedDesc" : "toastRejectedDesc";
    toast({ title: t(titleKey, approvals), description: t(descKey, approvals) });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", approvals)}</h1>
        <p className="text-[12px] text-gray-600 mt-0.5">{t("subtitle", approvals)}</p>
      </div>

      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BRAND }}>{t("scenarioCheckpoints", approvals)}</p>
        <p className="text-[11px] text-gray-500">{t("scenarioCheckpointsSub", approvals)}</p>
      </div>
      <div className="space-y-3 mb-6">
        {checkpoints.map((r) => (
          <Card key={r.id} rec={r} onAction={handle} t={t} lang={lang} />
        ))}
      </div>

      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BRAND }}>{t("derivedRecs", approvals)}</p>
      </div>
      <div className="space-y-3">
        {derived.map((r) => (
          <Card key={r.id} rec={r} onAction={handle} t={t} lang={lang} />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  rec: ReturnType<typeof useEkcData>["recommendations"][number];
  onAction: (id: string, action: "approved" | "edited" | "rejected") => void;
  t: (k: string, d: any) => string;
  lang: "en" | "ar";
}

function Card({ rec, onAction, t, lang }: CardProps) {
  const agent = agentById(rec.agentId);
  const resolved = rec.status !== "pending";
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white" style={{ background: agent?.color ?? BRAND }}>
          <ShieldCheck size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase" style={{ color: SEV_COLOR[rec.severity] ?? "#6B7280" }}>{rec.severity}</span>
            <span className="text-[10px] text-gray-400">·</span>
            <span className="text-[10px] font-bold text-gray-500">{agent?.name[lang]}</span>
            {rec.checkpointHuman && (
              <>
                <span className="text-[10px] text-gray-400">·</span>
                <span className="text-[10px] font-bold text-gray-500">{t("human", approvals)}: {rec.checkpointHuman[lang]}</span>
              </>
            )}
          </div>
          <p className="text-[14px] font-extrabold" style={{ color: BRAND_INK }}>{rec.title[lang]}</p>
        </div>
        <div className="text-end flex-shrink-0">
          <p className="text-[10px] text-gray-500">{lang === "en" ? "Confidence" : "ثقة"}</p>
          <p className="text-[14px] font-extrabold" style={{ color: BRAND }}>{rec.confidence}%</p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-3 mb-3">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">{t("rationale", approvals)}</p>
        <p className="text-[12px] text-gray-700 leading-relaxed">{rec.rationale[lang]}</p>
      </div>

      <div className="bg-gray-50 rounded-xl p-3 mb-3">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">{t("options", approvals)}</p>
        <ul className="space-y-1">
          <li className="text-[12px] flex gap-2">
            <span className="font-bold" style={{ color: BRAND }}>★</span>
            <span className="font-bold text-gray-800">{rec.recommendedAction[lang]}</span>
          </li>
          {rec.alternateActions.map((a, i) => (
            <li key={i} className="text-[12px] flex gap-2 text-gray-600">
              <span className="text-gray-400">·</span>
              <span>{a[lang]}</span>
            </li>
          ))}
        </ul>
      </div>

      {resolved ? (
        <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: "#10B981" }}>
          <Check size={14} /> {t("resolved", approvals)} ({rec.status})
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onAction(rec.id, "approved")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold text-white"
            style={{ background: BRAND_INK }}
          >
            <Check size={12} /> {t("approve", approvals)}
          </button>
          <button
            onClick={() => onAction(rec.id, "edited")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border border-gray-300 text-gray-700 bg-white"
          >
            <Edit3 size={12} /> {t("edit", approvals)}
          </button>
          <button
            onClick={() => onAction(rec.id, "rejected")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border border-gray-300 text-gray-700 bg-white"
          >
            <X size={12} /> {t("reject", approvals)}
          </button>
        </div>
      )}
    </div>
  );
}
