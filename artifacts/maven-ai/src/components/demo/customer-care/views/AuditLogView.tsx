import { motion } from "framer-motion";
import { Bot, User } from "lucide-react";
import { useCareLang } from "../DemoLangContext";
import { audit, tDict } from "../care-i18n";
import { ACCENT_AI } from "../tokens";
import { getAuditLog } from "@/data/customer-care-agent";
import { FOCUS_CONV_ID } from "@/data/customer-care-seed";

export default function AuditLogView() {
  const { lang } = useCareLang();
  const t = tDict(audit, lang);
  const entries = getAuditLog(FOCUS_CONV_ID);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.sub}</p>
        <p className="text-[10px] text-gray-400 font-mono mt-1">conv = {FOCUS_CONV_ID}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
            <tr><Th>{t.colTime}</Th><Th>{t.colActor}</Th><Th>{t.colAction}</Th><Th>{t.colDetail}</Th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {entries.map((e, i) => (
              <motion.tr key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                <Td><span className="font-mono text-[11px] text-gray-500">{e.ts}</span></Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    {e.isAi ? <Bot size={11} style={{ color: ACCENT_AI }} /> : <User size={11} className="text-gray-500" />}
                    <span className={`text-xs font-semibold ${e.isAi ? "" : "text-gray-700"}`} style={e.isAi ? { color: ACCENT_AI } : {}}>{lang === "en" ? e.actorEn : e.actorAr}</span>
                  </div>
                </Td>
                <Td><span className="text-xs text-gray-700">{lang === "en" ? e.actionEn : e.actionAr}</span></Td>
                <Td><span className="text-[11px] text-gray-500 leading-relaxed">{lang === "en" ? e.detailEn : e.detailAr}</span></Td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 text-start font-bold">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-3 py-2.5 align-top">{children}</td>; }
