import { useState } from "react";
import { History, Bot, User, Cpu } from "lucide-react";
import { useNocDemoLang, useNocDemoT } from "../DemoLangContext";
import { auditLog } from "../noc-i18n";
import { AUDIT, type AuditEntry } from "@/data/network-ops-seed";
import { BRAND } from "../tokens";

const KIND_TONE: Record<AuditEntry["kind"], { bg: string; text: string; icon: React.ReactNode; key: string }> = {
  agent: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", icon: <Bot size={11} />, key: "actorAgent" },
  human: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", icon: <User size={11} />, key: "actorHuman" },
  system: { bg: "bg-gray-100 border-gray-200", text: "text-gray-700", icon: <Cpu size={11} />, key: "actorSystem" },
};

type Filter = "all" | AuditEntry["kind"];

export default function AuditLogView() {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = [...AUDIT].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const filtered = filter === "all" ? sorted : sorted.filter((e) => e.kind === filter);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <History size={20} style={{ color: BRAND }} />
          {t("title", auditLog)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", auditLog)}</p>
      </div>

      <div className="flex bg-gray-100 rounded-xl p-1 w-fit">
        {(["all", "agent", "human", "system"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${filter === f ? "bg-white shadow-sm" : "text-gray-600"}`}
            style={filter === f ? { color: BRAND } : undefined}
          >
            {f === "all" ? t("filterAll", auditLog) : t(`actor${f.charAt(0).toUpperCase() + f.slice(1)}`, auditLog)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
        {filtered.map((e) => {
          const tone = KIND_TONE[e.kind];
          const d = new Date(e.ts);
          const ts = d.toLocaleString(isAr ? "ar-SA" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <div key={e.id} className="p-4 flex items-start gap-3">
              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border font-bold flex-shrink-0 ${tone.bg} ${tone.text}`}>
                {tone.icon}{t(tone.key, auditLog)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900">{isAr ? e.action.ar : e.action.en}</p>
                <p className="text-xs text-gray-600 mt-0.5">{isAr ? e.detail.ar : e.detail.en}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  <span className="font-semibold">{isAr ? e.actor.ar : e.actor.en}</span> · {ts}
                </p>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-10 text-center text-sm text-gray-500">{isAr ? "لا سجلات" : "No entries"}</div>
        )}
      </div>
    </div>
  );
}
