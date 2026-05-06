import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { useCscLang } from "../DemoLangContext";
import { auditI, tDict } from "../citizen-i18n";
import { tt, formatRelative } from "@/data/citizen-services-seed";
import { Activity } from "lucide-react";
import { BRAND } from "../tokens";

export default function AuditLogView() {
  const { lang } = useCscLang();
  const t = tDict(auditI, lang);
  const { auditLog } = useCitizenServicesData();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 text-[10.5px] uppercase tracking-wide text-gray-500 font-semibold">
            <tr>
              <th className="text-start px-4 py-2.5">{lang === "en" ? "When" : "متى"}</th>
              <th className="text-start px-4 py-2.5">{lang === "en" ? "Actor" : "الفاعل"}</th>
              <th className="text-start px-4 py-2.5">{lang === "en" ? "Event" : "الحدث"}</th>
              <th className="text-start px-4 py-2.5">{lang === "en" ? "Case" : "القضية"}</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-8">{t.emptyText}</td></tr>
            ) : auditLog.map((e, i) => (
              <tr key={i} className="border-t border-gray-50">
                <td className="px-4 py-2 text-gray-500">{formatRelative(e.at, undefined, lang)}</td>
                <td className="px-4 py-2 text-gray-700"><span className="inline-flex items-center gap-1.5"><Activity size={11} style={{ color: BRAND }} />{tt(e.actor, lang)}</span></td>
                <td className="px-4 py-2 text-gray-700">{tt(e.event, lang)}</td>
                <td className="px-4 py-2 text-gray-500 font-mono text-[11px]">{e.caseId ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
