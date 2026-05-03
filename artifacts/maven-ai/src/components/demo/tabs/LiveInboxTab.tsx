import { Inbox, Mail, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { InboxItem, SimState } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

const STATUS_META = {
  new: { icon: Mail, color: "#156082", label: { en: "New", ar: "جديد" } },
  "in-progress": {
    icon: Clock,
    color: "#F5A623",
    label: { en: "In progress", ar: "قيد المعالجة" },
  },
  "awaiting-human": {
    icon: AlertCircle,
    color: "#D9534F",
    label: { en: "Awaiting human", ar: "بانتظار الإنسان" },
  },
  resolved: {
    icon: CheckCircle2,
    color: "#196B24",
    label: { en: "Resolved", ar: "مكتمل" },
  },
} as const;

export default function LiveInboxTab({ state }: { state: SimState }) {
  const { lang } = useLang();
  if (state.inbox.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
        <Inbox size={28} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm">
          {tStr(
            {
              en: "Inbox is empty. Press Play — incoming items will land here as the orchestrator picks them up.",
              ar: "صندوق الوارد فارغ. اضغط تشغيل — ستظهر العناصر هنا عندما يلتقطها المنسّق.",
            },
            lang,
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {state.inbox.map((item) => (
        <InboxRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const { lang } = useLang();
  const meta = STATUS_META[item.status];
  const Icon = meta.icon;
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4 flex gap-4 hover:border-gray-300 transition-colors"
      style={item.accent ? { borderLeft: `3px solid ${item.accent}` } : undefined}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: meta.color + "22" }}
      >
        <Icon size={16} style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <p className="text-sm font-bold text-[#0E2841] truncate">
            {tStr(item.subject, lang)}
          </p>
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            {item.receivedAt}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-2">{tStr(item.source, lang)}</p>
        <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">
          {tStr(item.preview, lang)}
        </p>
        <div className="mt-2">
          <span
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ backgroundColor: meta.color + "1A", color: meta.color }}
          >
            {tStr(meta.label, lang)}
          </span>
        </div>
      </div>
    </div>
  );
}
