import { useState } from "react";
import { Check, X as XIcon, Edit, Sparkles } from "lucide-react";
import { useDemoLang, tBi } from "../DemoLangContext";
import { approvals as aDict, t as tr } from "../value-realization-i18n";
import {
  generateRecommendations,
  generateScenarioCheckpointCards,
  CONDUCTOR_AGENTS,
  type RecommendationStatus,
} from "@/data/value-realization-agent";
import { useValueRealizationData } from "@/hooks/useValueRealizationData";
import { useToast } from "@/hooks/use-toast";
import { BRAND, BRAND_INK, NAVY, SEMANTIC } from "../tokens";

export default function ApprovalsView({ onSelectInitiative }: { onSelectInitiative: (id: string) => void }) {
  const { lang } = useDemoLang();
  const { initiatives } = useValueRealizationData();
  const { toast } = useToast();
  const recs = generateRecommendations();
  const checkpoints = generateScenarioCheckpointCards();
  const [statuses, setStatuses] = useState<Record<string, RecommendationStatus>>({});
  const [checkpointDecisions, setCheckpointDecisions] = useState<Record<string, string>>({});

  const setStatus = (id: string, s: RecommendationStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: s }));
    toast({
      title: s === "approved" ? tr(aDict, "toastApproved", lang) : tr(aDict, "toastDismissed", lang),
    });
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: NAVY }} data-testid="text-approvals-title">
          {tr(aDict, "title", lang)}
        </h1>
        <p className="text-sm text-gray-500">{tr(aDict, "subtitle", lang)}</p>
      </header>

      {/* Scenario checkpoints */}
      <section data-testid="section-checkpoints">
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: BRAND_INK }}>
          {tr(aDict, "sectionCheckpoints", lang)}
        </h2>
        <div className="space-y-3">
          {checkpoints.map((c) => {
            const init = initiatives.find((i) => i.id === c.initiativeId);
            const agent = CONDUCTOR_AGENTS.find((a) => a.id === c.agentId);
            const decided = checkpointDecisions[c.id];
            return (
              <div key={c.id} className="bg-white border-l-4 border border-gray-200 rounded-xl p-4" style={{ borderLeftColor: BRAND }} data-testid={`checkpoint-${c.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: agent?.color }}>{agent ? tBi(agent.name, lang) : ""}</p>
                    <h3 className="text-base font-bold mt-0.5" style={{ color: NAVY }}>{tBi(c.title, lang)}</h3>
                    {init && (
                      <button onClick={() => onSelectInitiative(init.id)} className="text-[11px] hover:underline" style={{ color: BRAND }}>
                        {tBi(init.name, lang)}
                      </button>
                    )}
                    <p className="text-sm mt-2" style={{ color: NAVY }}>{tBi(c.question, lang)}</p>
                    <p className="text-xs text-gray-600 mt-2">{tBi(c.rationale, lang)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {c.options.map((o) => {
                    const active = decided === o.id;
                    return (
                      <button
                        key={o.id}
                        onClick={() => {
                          setCheckpointDecisions((prev) => ({ ...prev, [c.id]: o.id }));
                          toast({ title: tBi(o.label, lang) });
                        }}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${active ? "text-white" : "bg-white text-gray-700 hover:border-gray-400"}`}
                        style={active ? { background: BRAND, borderColor: BRAND } : { borderColor: o.recommended ? BRAND : "#E5E7EB" }}
                        data-testid={`button-checkpoint-${c.id}-${o.id}`}
                      >
                        {o.recommended && <Sparkles size={10} className="inline mr-1" />}
                        {tBi(o.label, lang)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Agent recs */}
      <section data-testid="section-agent-recs">
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: BRAND_INK }}>
          {tr(aDict, "sectionRecs", lang)}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {recs.map((r) => {
            const init = initiatives.find((i) => i.id === r.initiativeId);
            const agent = CONDUCTOR_AGENTS.find((a) => a.id === r.agentId);
            const status = statuses[r.id] ?? "pending";
            const sevColor: Record<typeof r.severity, string> = {
              critical: SEMANTIC.critical,
              high: SEMANTIC.attention,
              medium: SEMANTIC.info,
              info: BRAND,
            };
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4" data-testid={`rec-${r.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sevColor[r.severity] }} />
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: agent?.color }}>{agent ? tBi(agent.name, lang) : ""}</p>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#E8F2EA", color: BRAND_INK }}>
                        {r.confidence}% {tr(aDict, "confidenceLabel", lang)}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold" style={{ color: NAVY }}>{tBi(r.title, lang)}</h3>
                    {init && (
                      <button onClick={() => onSelectInitiative(init.id)} className="text-[11px] hover:underline" style={{ color: BRAND }}>
                        {tBi(init.name, lang)}
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-xs text-gray-700">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{tr(aDict, "rationaleLabel", lang)}</p>
                    <p className="mt-0.5">{tBi(r.rationale, lang)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{tr(aDict, "actionLabel", lang)}</p>
                    <p className="mt-0.5 font-semibold" style={{ color: BRAND_INK }}>
                      <Sparkles size={10} className="inline mr-1" /> {tBi(r.recommendedAction, lang)}
                    </p>
                  </div>
                  {r.alternateActions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{tr(aDict, "altLabel", lang)}</p>
                      <ul className="mt-0.5 list-disc list-inside text-gray-600">
                        {r.alternateActions.map((a, idx) => <li key={idx}>{tBi(a, lang)}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {status === "pending" ? (
                    <div className="flex gap-2">
                      <button onClick={() => setStatus(r.id, "approved")} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white flex items-center gap-1" style={{ background: BRAND }} data-testid={`button-approve-${r.id}`}>
                        <Check size={12} /> {tr(aDict, "approve", lang)}
                      </button>
                      <button className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 flex items-center gap-1" data-testid={`button-edit-${r.id}`}>
                        <Edit size={12} /> {tr(aDict, "edit", lang)}
                      </button>
                      <button onClick={() => setStatus(r.id, "dismissed")} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 flex items-center gap-1 text-gray-600" data-testid={`button-dismiss-${r.id}`}>
                        <XIcon size={12} /> {tr(aDict, "dismiss", lang)}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-bold" style={{ color: status === "approved" ? BRAND_INK : "#9CA3AF" }}>
                      {status === "approved" ? tr(aDict, "statusApproved", lang) : tr(aDict, "statusDismissed", lang)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
