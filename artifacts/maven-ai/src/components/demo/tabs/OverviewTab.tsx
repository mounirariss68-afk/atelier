import { Sparkles, Users, Wrench, GitBranch, Target } from "lucide-react";
import type { Scenario } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

interface Props {
  scenario: Scenario;
}

export default function OverviewTab({ scenario }: Props) {
  const { lang } = useLang();
  return (
    <div className="space-y-6">
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-2">
          {tStr({ en: "What this demo shows", ar: "ماذا يعرض هذا العرض" }, lang)}
        </p>
        <p className="text-base text-gray-700 leading-relaxed">
          {tStr(scenario.description, lang)}
        </p>
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-start gap-3">
          <Sparkles size={16} className="text-[#156082] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600 leading-relaxed">
            <span className="font-bold text-[#0E2841]">
              {tStr({ en: "Trigger:", ar: "المحفّز:" }, lang)}
            </span>{" "}
            {tStr(scenario.trigger, lang)}
          </p>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <Card
          icon={<Users size={16} className="text-[#156082]" />}
          title={{ en: "Agent cast", ar: "فريق الوكلاء" }}
          count={scenario.agents.length}
        >
          <ul className="space-y-2">
            {scenario.agents.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span
                  className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: a.color }}
                />
                <div>
                  <span className="font-bold text-[#0E2841]">{tStr(a.name, lang)}</span>
                  <span className="text-gray-500"> — {tStr(a.role, lang)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          icon={<Wrench size={16} className="text-[#156082]" />}
          title={{ en: "Tools the agents call", ar: "الأدوات التي يستدعيها الوكلاء" }}
          count={scenario.tools.length}
        >
          <ul className="space-y-2">
            {scenario.tools.map((t) => (
              <li key={t.name} className="text-sm">
                <code className="font-mono font-bold text-[#156082]">{t.name}()</code>
                <span className="text-gray-500"> — {tStr(t.description, lang)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          icon={<GitBranch size={16} className="text-[#156082]" />}
          title={{ en: "Autonomous workflows", ar: "سير عمل ذاتي" }}
          count={scenario.workflows.length}
        >
          <ul className="space-y-3">
            {scenario.workflows.map((w) => (
              <li key={w.id}>
                <p className="text-sm font-bold text-[#0E2841]">{tStr(w.name, lang)}</p>
                <p className="text-xs text-gray-500 leading-snug">
                  {tStr(w.description, lang)}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          icon={<Target size={16} className="text-[#156082]" />}
          title={{ en: "KPIs in this demo", ar: "مؤشرات الأداء" }}
          count={scenario.kpis.length}
        >
          <ul className="space-y-2">
            {scenario.kpis.map((k) => (
              <li key={k.id} className="flex justify-between gap-3 text-sm">
                <span className="text-gray-600">{tStr(k.label, lang)}</span>
                <span className="font-bold font-mono text-[#0E2841]">{k.initial}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: { en: string; ar: string };
  count: number;
  children: React.ReactNode;
}) {
  const { lang } = useLang();
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0E2841]">
            {tStr(title, lang)}
          </p>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}
