import { useDemoLang, tBi } from "../DemoLangContext";
import { chase as cDict, t as tr } from "../value-realization-i18n";
import { generateChaseQueue, CONDUCTOR_AGENTS, type ChaseStage } from "@/data/value-realization-agent";
import { useValueRealizationData } from "@/hooks/useValueRealizationData";
import { BRAND_INK, NAVY, SEMANTIC } from "../tokens";

const STAGES: { id: ChaseStage; key: string }[] = [
  { id: "claim", key: "stageClaim" },
  { id: "evidence", key: "stageEvidence" },
  { id: "attribution", key: "stageAttribution" },
  { id: "rebaseline", key: "stageRebaseline" },
  { id: "escalation", key: "stageEscalation" },
];

export default function ChaseQueueView({ onSelectInitiative }: { onSelectInitiative: (id: string) => void }) {
  const { lang } = useDemoLang();
  const { initiatives } = useValueRealizationData();
  const queue = generateChaseQueue();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: NAVY }} data-testid="text-chase-title">{tr(cDict, "title", lang)}</h1>
        <p className="text-sm text-gray-500">{tr(cDict, "subtitle", lang)}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3" data-testid="chase-board">
        {STAGES.map((s) => {
          const items = queue.filter((q) => q.stage === s.id);
          return (
            <section key={s.id} className="bg-white border border-gray-200 rounded-xl p-3" data-testid={`stage-${s.id}`}>
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                <h3 className="text-sm font-bold" style={{ color: NAVY }}>{tr(cDict, s.key, lang)}</h3>
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <p className="text-[11px] text-gray-400 text-center py-4">{tr(cDict, "emptyStage", lang)}</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((c) => {
                    const init = initiatives.find((i) => i.id === c.initiativeId);
                    const a = CONDUCTOR_AGENTS.find((x) => x.id === c.agentId);
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => init && onSelectInitiative(init.id)}
                          className="w-full text-left p-2.5 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                          data-testid={`chase-${c.id}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className="text-xs font-semibold" style={{ color: NAVY }}>{tBi(c.label, lang)}</p>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={statusStyle(c.status, lang)}>
                              {tr(cDict, statusKey(c.status), lang)}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 line-clamp-2">{tBi(c.detail, lang)}</p>
                          <div className="mt-1.5 flex items-center justify-between text-[10px]">
                            <span className="font-semibold" style={{ color: a?.color }}>{a ? tBi(a.name, lang) : c.agentId}</span>
                            {init && <span className="text-gray-400 truncate max-w-[120px]">{tBi(init.name, lang)}</span>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function statusKey(s: string) {
  return s === "running" ? "statusRunning" : s === "queued" ? "statusQueued" : s === "done" ? "statusDone" : "statusBlocked";
}

function statusStyle(s: string, _lang: "en" | "ar"): React.CSSProperties {
  switch (s) {
    case "running": return { background: "#DBEAFE", color: "#1D4ED8" };
    case "queued": return { background: "#F3F4F6", color: "#4B5563" };
    case "done": return { background: "#D1FAE5", color: BRAND_INK };
    case "blocked": return { background: "#FEE2E2", color: SEMANTIC.critical };
    default: return {};
  }
}
