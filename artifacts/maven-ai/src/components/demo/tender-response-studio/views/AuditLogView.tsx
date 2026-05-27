import { useMemo, useState } from "react";
import { Bot, User, FileText, CheckCircle2, AlertCircle, Hand } from "lucide-react";
import { useTenderResponseData } from "@/hooks/useTenderResponseData";
import { useTenderDemoLang, useTenderDemoT } from "../DemoLangContext";
import { audit as i18n } from "../tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY } from "../tokens";
import type { AuditKind } from "@/data/tender-response-seed";

const KIND_KEY: Record<AuditKind, string> = {
  ingest: "kindIngest", qualify: "kindQualify", draft: "kindDraft", checkpoint: "kindCheckpoint",
  pricing: "kindPricing", partner: "kindPartner", legal: "kindLegal", compile: "kindCompile",
  submit: "kindSubmit", "human-decision": "kindHumanDecision",
};
const KIND_ICON: Record<AuditKind, React.ReactNode> = {
  ingest: <FileText size={12} />, qualify: <CheckCircle2 size={12} />, draft: <FileText size={12} />,
  checkpoint: <AlertCircle size={12} />, pricing: <FileText size={12} />, partner: <FileText size={12} />,
  legal: <FileText size={12} />, compile: <FileText size={12} />, submit: <CheckCircle2 size={12} />,
  "human-decision": <Hand size={12} />,
};

export default function AuditLogView() {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const { auditLog } = useTenderResponseData();
  const [kind, setKind] = useState<string>("all");

  const filtered = useMemo(() =>
    auditLog.filter((e) => kind === "all" || e.kind === kind)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [auditLog, kind]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#A6E2AF" }}>
          {auditLog.length} {lang === "ar" ? "حدث" : "events"}
        </p>
        <h2 className="mt-1 text-xl font-extrabold">{t("title", i18n)}</h2>
        <p className="mt-1 text-[12px] text-gray-200 max-w-3xl">{t("subtitle", i18n)}</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-3 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">{t("filterKind", i18n)}:</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="border border-gray-200 rounded-md px-2 py-1 text-[11px] font-medium">
          <option value="all">{t("allEvents", i18n)}</option>
          {(Object.keys(KIND_KEY) as AuditKind[]).map((k) => (
            <option key={k} value={k}>{t(KIND_KEY[k], i18n)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="space-y-1">
          {filtered.map((e) => {
            const isHuman = e.kind === "human-decision";
            return (
              <div key={e.id} className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg">
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white" style={{ background: isHuman ? "#0A1230" : BRAND }}>
                  {isHuman ? <User size={12} /> : <Bot size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest font-extrabold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>
                      {KIND_ICON[e.kind]}{t(KIND_KEY[e.kind], i18n)}
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: NAVY }}>
                      {isHuman ? `${e.actor ?? "—"} · ${t("human", i18n)}` : `${e.agent} · ${t("agent", i18n)}`}
                    </span>
                    <span className="ms-auto text-[10px] text-gray-400">
                      {new Date(e.timestamp).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] font-semibold" style={{ color: NAVY }}>{e.title[lang]}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">{e.detail[lang]}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
