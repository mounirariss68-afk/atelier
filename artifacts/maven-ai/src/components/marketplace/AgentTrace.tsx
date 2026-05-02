import { Bot, ArrowRight } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import { getAgentCast } from "@workspace/maven-content";

const COPY = {
  title: { en: "Agent reasoning trace", ar: "أثر تفكير الوكلاء" },
  caption: {
    en: "Each step below names the specific agent doing the work and what it just produced from your inputs above. The agents and their handoffs are documented in the explainer.",
    ar: "تذكر كل خطوة أدناه اسم الوكيل المسؤول وما أنتجه للتو من مدخلاتك أعلاه. الوكلاء وانتقالاتهم موثّقة في المُفسِّر.",
  },
  unknown: { en: "Agent", ar: "وكيل" },
};

export interface AgentLogEntry {
  /** Must match an agent id in the tool's cast. */
  agentId: string;
  /** Already-translated dynamic line that reflects the current scenario. */
  line: string;
}

interface AgentTraceProps {
  slug: string;
  log: AgentLogEntry[];
  /** Optional override accent (defaults to teal). */
  accent?: string;
}

export default function AgentTrace({ slug, log, accent = "#156082" }: AgentTraceProps) {
  const { lang } = useLang();
  const cast = getAgentCast(slug);

  return (
    <section className="rounded-2xl border border-gray-200 bg-gradient-to-br from-[#F8FAFC] to-white p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-widest mb-1"
            style={{ color: accent }}
          >
            {tStr(COPY.title, lang)}
          </p>
          <p className="text-xs text-gray-500 leading-relaxed max-w-2xl">
            {tStr(COPY.caption, lang)}
          </p>
        </div>
      </div>
      <ol className="space-y-2.5">
        {log.map((entry, i) => {
          const agent = cast?.agents.find((a) => a.id === entry.agentId);
          const name = agent ? tStr(agent.name, lang) : tStr(COPY.unknown, lang);
          return (
            <li
              key={i}
              className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 px-3 py-2.5"
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold"
                style={{ backgroundColor: accent }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <Bot size={12} style={{ color: accent }} />
                  <span className="font-bold text-[13px] text-[#0E2841]">{name}</span>
                  <ArrowRight size={11} className="text-gray-300 rtl:rotate-180" />
                </div>
                <p className="text-sm text-gray-700 leading-snug">{entry.line}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
