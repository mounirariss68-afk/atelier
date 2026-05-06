import { useState } from "react";
import { motion } from "framer-motion";
import { MessageCircle, Mail, Phone, Filter, ExternalLink } from "lucide-react";
import { useCustomerCareData } from "@/hooks/useCustomerCareData";
import { useCareLang } from "../DemoLangContext";
import { queue, tDict } from "../care-i18n";
import { CHANNEL_COLOR } from "../tokens";
import {
  AISHA_ID, getCustomer, CHANNEL_LABEL, INTENT_LABEL, SENTIMENT_LABEL, PRIORITY_LABEL, tBi,
  type Channel, type Priority,
} from "@/data/customer-care-seed";

const CHANNEL_ICONS: Record<Channel, typeof MessageCircle> = {
  whatsapp: MessageCircle, webchat: MessageCircle, email: Mail, voice: Phone,
};

const PRIORITY_TONE: Record<Priority, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

export default function MyQueueView({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { lang } = useCareLang();
  const t = tDict(queue, lang);
  const data = useCustomerCareData();
  const [chFilter, setChFilter] = useState<Channel | "all">("all");
  const [prFilter, setPrFilter] = useState<Priority | "all">("all");

  const rows = data.conversations.filter((c) => {
    if (c.assignedAgentId !== AISHA_ID) return false;
    if (chFilter !== "all" && c.channel !== chFilter) return false;
    if (prFilter !== "all" && c.priority !== prFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.sub}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-gray-400" />
        <select value={chFilter} onChange={(e) => setChFilter(e.target.value as Channel | "all")} className="text-xs border border-gray-200 rounded-md px-2 py-1.5">
          <option value="all">{t.filterChannel}: {t.filterAll}</option>
          {(["whatsapp", "webchat", "email", "voice"] as Channel[]).map((c) => (
            <option key={c} value={c}>{tBi(CHANNEL_LABEL[c], lang)}</option>
          ))}
        </select>
        <select value={prFilter} onChange={(e) => setPrFilter(e.target.value as Priority | "all")} className="text-xs border border-gray-200 rounded-md px-2 py-1.5">
          <option value="all">{t.filterPriority}: {t.filterAll}</option>
          {(["critical", "high", "medium", "low"] as Priority[]).map((p) => (
            <option key={p} value={p}>{tBi(PRIORITY_LABEL[p], lang)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <Th>{t.colCustomer}</Th><Th>{t.colChannel}</Th><Th>{t.colIntent}</Th>
                <Th>{t.colSentiment}</Th><Th>{t.colPriority}</Th><Th>{t.colSla}</Th>
                <Th>{t.colLast}</Th><Th>&nbsp;</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((c, i) => {
                const cust = getCustomer(c.customerId);
                const Icon = CHANNEL_ICONS[c.channel];
                return (
                  <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="hover:bg-gray-50">
                    <Td><span className="font-semibold text-gray-800">{cust ? (lang === "en" ? cust.nameEn : cust.nameAr) : "—"}</span></Td>
                    <Td><span className="inline-flex items-center gap-1.5 text-xs"><Icon size={12} style={{ color: CHANNEL_COLOR[c.channel] }} />{tBi(CHANNEL_LABEL[c.channel], lang)}</span></Td>
                    <Td><span className="text-xs text-gray-600">{tBi(INTENT_LABEL[c.intent], lang)}</span></Td>
                    <Td><span className="text-xs text-gray-600">{tBi(SENTIMENT_LABEL[c.sentiment], lang)}</span></Td>
                    <Td><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${PRIORITY_TONE[c.priority]}`}>{tBi(PRIORITY_LABEL[c.priority], lang)}</span></Td>
                    <Td><span className={`text-xs font-semibold ${c.slaRemainMins <= 15 ? "text-red-600" : c.slaRemainMins <= 60 ? "text-amber-600" : "text-gray-500"}`}>{c.slaRemainMins}m</span></Td>
                    <Td><span className="text-[11px] text-gray-400">{c.lastTouchAgo}</span></Td>
                    <Td><button onClick={onOpenDesk} className="text-[11px] font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1">{t.open} <ExternalLink size={10} /></button></Td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 text-start font-bold">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-3 py-2.5">{children}</td>; }
