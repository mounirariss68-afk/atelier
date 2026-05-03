import { Zap, ArrowRight } from "lucide-react";
import type { Scenario } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

export default function WorkflowsTab({ scenario }: { scenario: Scenario }) {
  const { lang } = useLang();
  const agentName = (id: string) =>
    scenario.agents.find((a) => a.id === id)?.name ?? { en: id, ar: id };
  const agentColor = (id: string) =>
    scenario.agents.find((a) => a.id === id)?.color ?? "#156082";
  return (
    <div className="space-y-5">
      {scenario.workflows.map((w) => (
        <section
          key={w.id}
          className="bg-white border border-gray-200 rounded-xl p-6"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-[#156082]/10 flex items-center justify-center flex-shrink-0">
              <Zap size={16} className="text-[#156082]" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold text-[#0E2841]">
                {tStr(w.name, lang)}
              </p>
              <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                {tStr(w.description, lang)}
              </p>
            </div>
          </div>
          <div className="bg-[#F8F9FA] border border-gray-100 rounded-lg p-3 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
              {tStr({ en: "Trigger", ar: "المحفّز" }, lang)}
            </p>
            <p className="text-sm text-gray-700">{tStr(w.trigger, lang)}</p>
          </div>
          <ol className="flex flex-wrap items-stretch gap-2">
            {w.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <div
                  className="px-3 py-2 rounded-lg border bg-white"
                  style={{
                    borderColor: agentColor(s.agentId) + "55",
                    backgroundColor: agentColor(s.agentId) + "0D",
                  }}
                >
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: agentColor(s.agentId) }}
                  >
                    {tStr(agentName(s.agentId), lang)}
                  </p>
                  <p className="text-xs text-[#0E2841] mt-0.5">
                    {tStr(s.label, lang)}
                  </p>
                </div>
                {i < w.steps.length - 1 && (
                  <ArrowRight
                    size={14}
                    className="text-gray-300 rtl:rotate-180 flex-shrink-0"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
