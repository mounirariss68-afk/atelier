import { useMemo, useState } from "react";
import { usePwrLang, usePwrT } from "../DemoLangContext";
import { audit } from "../programme-i18n";
import { generateAuditLog } from "@/data/programme-war-room-agent";
import { programmeById } from "@/data/programme-war-room-seed";
import { BRAND_INK } from "../tokens";
import { CONSOLE_AGENTS } from "@/data/programme-war-room-agent";

export default function AuditLogView() {
  const { lang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const log = useMemo(() => generateAuditLog(), []);
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const filtered = agentFilter === "all" ? log : log.filter((l) => l.agentId === agentFilter);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", audit)}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", audit)}</p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <Pill onClick={() => setAgentFilter("all")} active={agentFilter === "all"}>{t("filterAll", audit)}</Pill>
        {CONSOLE_AGENTS.map((a) => (
          <Pill key={a.id} onClick={() => setAgentFilter(a.id)} active={agentFilter === a.id} color={a.color}>{a.name[lang]}</Pill>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("when", audit)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("agent", audit)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("programme", audit)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("action", audit)}</th>
              <th className="px-3 py-2 text-start font-semibold text-gray-600">{t("detail", audit)}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const agent = CONSOLE_AGENTS.find((a) => a.id === entry.agentId);
              const programme = programmeById(entry.programmeId);
              return (
                <tr key={entry.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(entry.timestamp).toLocaleString(isAr ? "ar-SA" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-3 py-2">
                    {agent && (<span className="inline-block px-2 py-0.5 rounded-full text-white text-[10px] font-semibold" style={{ background: agent.color }}>{agent.name[lang]}</span>)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{programme?.name[lang] ?? entry.programmeId}</td>
                  <td className="px-3 py-2 font-semibold text-gray-800">{entry.action[lang]}</td>
                  <td className="px-3 py-2 text-gray-600">{entry.detail[lang]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pill({ children, onClick, active, color }: { children: React.ReactNode; onClick: () => void; active: boolean; color?: string }) {
  return (
    <button onClick={onClick} className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border ${active ? "text-white" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`} style={active ? { background: color ?? BRAND_INK, borderColor: color ?? BRAND_INK } : undefined}>
      {children}
    </button>
  );
}
