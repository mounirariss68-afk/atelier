import type { AgentCast } from "@workspace/cognirise-content";
import { useLang, tStr } from "@/lib/lang";

const KIND_COLORS: Record<string, string> = {
  planner: "#C45BB8",
  monitor: "#5C8CA8",
  retriever: "#5B7CFF",
  classifier: "#5BA98A",
  scorer: "#5BA98A",
  drafter: "#8A5BD6",
  critic: "#D9534F",
  router: "#5C8CA8",
  compiler: "#5BA98A",
};

/**
 * Inline SVG topology of an agent cast — orchestrator at the top,
 * specialists in a row beneath, human checkpoint(s) at the bottom.
 * Renders directly inside the marketplace detail page so a buyer can
 * see the agent topology before launching the interactive demo.
 */
export default function AgentTopologyDiagram({
  cast,
  accent,
}: {
  cast: AgentCast;
  accent: string;
}) {
  const { lang } = useLang();
  const agents = cast.agents;
  const humans = cast.humanCheckpoints;

  // Layout: first agent goes at the top as "orchestrator" anchor; the rest
  // wrap in a horizontal grid; humans render below as checkpoint nodes.
  const [first, ...rest] = agents;

  return (
    <div className="bg-[#0A1F33] rounded-2xl p-6 border border-white/5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-4">
        {tStr({ en: "Agent topology", ar: "طوبولوجيا الوكلاء" }, lang)}
      </p>

      {first && (
        <div className="flex justify-center mb-3">
          <Node agent={first} accent={accent} highlight />
        </div>
      )}

      {rest.length > 0 && (
        <>
          <div className="flex justify-center mb-3">
            <svg width="2" height="24" className="text-white/30">
              <line x1="1" y1="0" x2="1" y2="24" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rest.map((a) => (
              <Node key={a.id} agent={a} accent={accent} />
            ))}
          </div>
        </>
      )}

      {humans.length > 0 && (
        <>
          <div className="flex justify-center my-3">
            <svg width="2" height="24" className="text-white/30">
              <line x1="1" y1="0" x2="1" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {humans.map((h) => (
              <div
                key={h.id}
                className="px-4 py-3 rounded-lg border-2 border-dashed border-[#C45BB8]/50 bg-[#C45BB8]/10 text-center max-w-xs"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#C45BB8] mb-1">
                  {tStr({ en: "Human checkpoint", ar: "نقطة موافقة بشرية" }, lang)}
                </p>
                <p className="text-sm font-bold text-white">{tStr(h.name, lang)}</p>
                <p className="text-xs text-gray-300 mt-1 leading-snug">
                  {tStr(h.decision, lang)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {cast.rationale && (
        <p className="mt-5 pt-4 border-t border-white/10 text-xs text-gray-300 leading-relaxed">
          <span className="font-bold text-white">
            {tStr({ en: "Why agents and not one model: ", ar: "لماذا وكلاء وليس نموذجاً واحداً: " }, lang)}
          </span>
          {tStr(cast.rationale, lang)}
        </p>
      )}
    </div>
  );
}

function Node({
  agent,
  accent,
  highlight,
}: {
  agent: AgentCast["agents"][number];
  accent: string;
  highlight?: boolean;
}) {
  const { lang } = useLang();
  const color = highlight ? accent : KIND_COLORS[agent.kind] ?? "#5C8CA8";
  return (
    <div
      className="px-3 py-2 rounded-lg border bg-white/5"
      style={{
        borderColor: color + (highlight ? "AA" : "55"),
        boxShadow: highlight ? `0 0 0 2px ${color}33` : undefined,
      }}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: color }}
        />
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
          {agent.kind}
        </p>
      </div>
      <p className="text-sm font-bold text-white leading-snug">
        {tStr(agent.name, lang)}
      </p>
      <p className="text-[11px] text-gray-300 mt-0.5 leading-snug line-clamp-2">
        {tStr(agent.role, lang)}
      </p>
    </div>
  );
}
