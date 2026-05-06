import { useDemoLang, tBi } from "../DemoLangContext";
import { audit as aDict, t as tr } from "../value-realization-i18n";
import { generateAuditLog, isVisibleToCfo, CONDUCTOR_AGENTS } from "@/data/value-realization-agent";
import { useValueRealizationData } from "@/hooks/useValueRealizationData";
import { NAVY } from "../tokens";

export default function AuditLogView({ onSelectInitiative }: { onSelectInitiative: (id: string) => void }) {
  const { lang } = useDemoLang();
  const { initiatives } = useValueRealizationData();
  const log = generateAuditLog().filter(isVisibleToCfo);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: NAVY }} data-testid="text-audit-title">{tr(aDict, "title", lang)}</h1>
        <p className="text-sm text-gray-500">{tr(aDict, "subtitle", lang)}</p>
      </header>

      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{tr(aDict, "th_ts", lang)}</th>
              <th className="px-3 py-2 text-left font-semibold">{tr(aDict, "th_actor", lang)}</th>
              <th className="px-3 py-2 text-left font-semibold">{tr(aDict, "th_action", lang)}</th>
              <th className="px-3 py-2 text-left font-semibold">{tr(aDict, "th_initiative", lang)}</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e) => {
              const init = e.initiativeId ? initiatives.find((i) => i.id === e.initiativeId) : null;
              const a = e.agentId !== "human" ? CONDUCTOR_AGENTS.find((x) => x.id === e.agentId) : null;
              return (
                <tr key={e.id} className="border-t border-gray-100" data-testid={`audit-${e.id}`}>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                    {new Date(e.ts).toLocaleString(lang === "ar" ? "ar-AE" : "en-AE", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-semibold" style={{ color: a?.color ?? NAVY }}>{tBi(e.actor, lang)}</p>
                    {a && <p className="text-[10px] text-gray-500">{tBi(a.role, lang)}</p>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <p className="font-semibold">{tBi(e.action, lang)}</p>
                    <p className="text-[10px] text-gray-500 line-clamp-1">{tBi(e.detail, lang)}</p>
                  </td>
                  <td className="px-3 py-2">
                    {init ? (
                      <button onClick={() => onSelectInitiative(init.id)} className="text-gray-700 hover:underline">{tBi(init.name, lang)}</button>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
