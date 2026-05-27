import { useState } from "react";
import { Bot, User } from "lucide-react";
import { useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { useProcurementDemoLang } from "../DemoLangContext";
import { audit as t } from "../procurement-i18n";
import { getAgent, type ProcurementAgentId } from "@/data/procurement-negotiation-agent";

type Filter = "all" | "agents" | "users";

export default function AuditLogView() {
  const { audit } = useProcurementData();
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const [filter, setFilter] = useState<Filter>("all");

  const items = audit.filter((a) => {
    if (filter === "agents") return a.actorKind === "agent";
    if (filter === "users") return a.actorKind === "user";
    return true;
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-[#0A1230]">{t.title[lang]}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.subtitle[lang]}</p>
      </header>

      <div className="flex gap-1.5">
        {(["all", "agents", "users"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${filter === f ? "bg-[#0A1230] text-white border-[#0A1230]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
            {f === "all" ? t.filterAll[lang] : f === "agents" ? t.filterAgents[lang] : t.filterUsers[lang]}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.ts[lang]}</th>
              <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.actor[lang]}</th>
              <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.action[lang]}</th>
              <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.ref[lang]}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const agent = a.actorKind === "agent" && a.agentId ? getAgent(a.agentId as ProcurementAgentId) : null;
              const ts = new Date(a.ts);
              return (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="px-3 py-2.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                    {ts.toLocaleString(isAr ? "ar-SA" : "en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-white" style={{ background: agent?.color ?? "#94a3b8" }}>
                        {a.actorKind === "agent" ? <Bot size={11} /> : <User size={11} />}
                      </div>
                      <span className="font-semibold text-[#0A1230]">{isAr ? a.actorAr : a.actorEn}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{isAr ? a.eventAr : a.eventEn}</td>
                  <td className="px-3 py-2.5 text-gray-500 font-mono text-[11px]">{a.refId ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
