import { Zap, ArrowRight, UserCheck } from "lucide-react";
import type { Scenario, WorkflowStepDef } from "@/lib/sim/types";
import { useLang, tStr, type Lang } from "@/lib/lang";

export default function WorkflowsTab({ scenario }: { scenario: Scenario }) {
  const { lang } = useLang();
  const agentName = (id: string) =>
    scenario.agents.find((a) => a.id === id)?.name ?? { en: id, ar: id };
  const agentColor = (id: string) =>
    scenario.agents.find((a) => a.id === id)?.color ?? "#5B7CFF";
  return (
    <div className="space-y-5">
      {scenario.workflows.map((w) => (
        <section
          key={w.id}
          className="bg-white border border-gray-200 rounded-xl p-6"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-[#5B7CFF]/10 flex items-center justify-center flex-shrink-0">
              <Zap size={16} className="text-[#5B7CFF]" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold text-[#0A1230]">
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
                {renderStep(s, agentName, agentColor, lang)}
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

function renderStep(
  s: WorkflowStepDef,
  agentName: (id: string) => { en: string; ar: string },
  agentColor: (id: string) => string,
  lang: Lang,
) {
  if (s.kind === "checkpoint") {
    return (
      <div
        className="px-3 py-2 rounded-lg bg-[#FEF7E5]"
        style={{
          border: "1.5px dashed #C45BB8",
        }}
      >
        <div className="flex items-center gap-1.5">
          <UserCheck size={11} className="text-[#C45BB8]" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A3000]">
            {s.human ? tStr(s.human, lang) : tStr({ en: "Human", ar: "إنسان" }, lang)}
          </p>
        </div>
        <p className="text-xs text-[#0A1230] mt-0.5">{tStr(s.label, lang)}</p>
      </div>
    );
  }
  const id = s.agentId ?? "";
  return (
    <div
      className="px-3 py-2 rounded-lg border bg-white"
      style={{
        borderColor: agentColor(id) + "55",
        backgroundColor: agentColor(id) + "0D",
      }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: agentColor(id) }}
      >
        {tStr(agentName(id), lang)}
      </p>
      <p className="text-xs text-[#0A1230] mt-0.5">{tStr(s.label, lang)}</p>
    </div>
  );
}
