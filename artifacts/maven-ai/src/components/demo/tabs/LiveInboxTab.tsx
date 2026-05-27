import {
  Inbox,
  Mail,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Info,
  ArrowRight,
} from "lucide-react";
import type {
  InboxActionKind,
  InboxItem,
  InboxSeverity,
  Scenario,
  SimState,
} from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";
import { useToast } from "@/hooks/use-toast";

const STATUS_META = {
  new: { icon: Mail, color: "#5B7CFF", label: { en: "New", ar: "جديد" } },
  "in-progress": {
    icon: Clock,
    color: "#C45BB8",
    label: { en: "In progress", ar: "قيد المعالجة" },
  },
  "awaiting-human": {
    icon: AlertCircle,
    color: "#D9534F",
    label: { en: "Awaiting human", ar: "بانتظار الإنسان" },
  },
  resolved: {
    icon: CheckCircle2,
    color: "#8A5BD6",
    label: { en: "Resolved", ar: "مكتمل" },
  },
} as const;

const SEVERITY_META: Record<
  InboxSeverity,
  { color: string; label: { en: string; ar: string }; icon: typeof AlertCircle }
> = {
  critical: {
    color: "#D9534F",
    label: { en: "Critical", ar: "حرج" },
    icon: AlertCircle,
  },
  warning: {
    color: "#C45BB8",
    label: { en: "Warning", ar: "تحذير" },
    icon: AlertTriangle,
  },
  info: { color: "#5B7CFF", label: { en: "Info", ar: "معلومات" }, icon: Info },
  new: { color: "#7C8A99", label: { en: "New", ar: "جديد" }, icon: Mail },
};

const ACTION_LABEL: Record<InboxActionKind, { en: string; ar: string }> = {
  "start-run": { en: "Start run", ar: "بدء التشغيل" },
  "view-calendar": { en: "View calendar", ar: "عرض التقويم" },
  "review-docs": { en: "Review documents", ar: "مراجعة الوثائق" },
  "view-report": { en: "View report", ar: "عرض التقرير" },
};

export default function LiveInboxTab({
  state,
  scenario,
}: {
  state: SimState;
  scenario?: Scenario;
}) {
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
        <InboxRow key={item.id} item={item} scenario={scenario} />
      ))}
    </div>
  );
}

function InboxRow({ item, scenario }: { item: InboxItem; scenario?: Scenario }) {
  const { lang } = useLang();
  const { toast } = useToast();
  const meta = STATUS_META[item.status];
  const Icon = meta.icon;

  const agent =
    item.agentId && scenario
      ? scenario.agents.find((a) => a.id === item.agentId)
      : undefined;

  const severity = item.severity;
  const sevMeta = severity ? SEVERITY_META[severity] : null;

  const action = item.action;
  const actionLabel = action ? ACTION_LABEL[action] : null;

  const handleAction = () => {
    if (!actionLabel) return;
    toast({
      title: tStr({ en: "Opening…", ar: "جارٍ الفتح…" }, lang),
      description: tStr(actionLabel, lang),
    });
  };

  return (
    <div
      className="group bg-white border border-gray-200 rounded-xl p-4 flex gap-4 hover:border-gray-300 transition-colors"
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
          <p className="text-sm font-bold text-[#0A1230] truncate">
            {tStr(item.subject, lang)}
          </p>
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            {item.receivedAt}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {agent && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: agent.color }}
              />
              {tStr(agent.name, lang)}
            </span>
          )}
          {agent && (
            <span className="text-gray-300">·</span>
          )}
          <p className="text-xs text-gray-500">{tStr(item.source, lang)}</p>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed line-clamp-2">
          {tStr(item.preview, lang)}
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {sevMeta ? (
            <span
              className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ backgroundColor: sevMeta.color + "1A", color: sevMeta.color }}
            >
              <sevMeta.icon size={10} />
              {tStr(sevMeta.label, lang)}
            </span>
          ) : (
            <span
              className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ backgroundColor: meta.color + "1A", color: meta.color }}
            >
              {tStr(meta.label, lang)}
            </span>
          )}
          {actionLabel && (
            <button
              type="button"
              onClick={handleAction}
              className="ms-auto text-[11px] font-semibold text-[#5B7CFF] hover:text-white hover:bg-[#5B7CFF] inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#5B7CFF]/40 transition-colors md:opacity-0 md:group-hover:opacity-100"
            >
              {tStr(actionLabel, lang)}
              <ArrowRight size={12} className="rtl:rotate-180" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
