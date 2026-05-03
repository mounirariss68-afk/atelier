import { useMemo, useState } from "react";
import {
  ClipboardList,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TriangleAlert,
} from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";

type Rag = "red" | "amber" | "green";
type Trend = "up" | "down" | "flat";

interface Workstream {
  id: string;
  name: { en: string; ar: string };
  rag: Rag;
  trend: Trend;
  raidNew: number;
  raidClosed: number;
  etcDelta: number; // weeks vs baseline
  csat: number;
  asks: { en: string; ar: string };
}

const SAMPLE: Workstream[] = [
  {
    id: "platform",
    name: { en: "Core platform build", ar: "بناء المنصة الأساسية" },
    rag: "green",
    trend: "up",
    raidNew: 2,
    raidClosed: 6,
    etcDelta: -1,
    csat: 82,
    asks: {
      en: "Approve early UAT entry — saves two weeks against critical path.",
      ar: "اعتمد الدخول المبكر إلى اختبار القبول — يوفّر أسبوعين على المسار الحرج.",
    },
  },
  {
    id: "data",
    name: { en: "Data integration & migration", ar: "تكامل وترحيل البيانات" },
    rag: "amber",
    trend: "flat",
    raidNew: 5,
    raidClosed: 3,
    etcDelta: 2,
    csat: 64,
    asks: {
      en: "Decision needed: source-of-truth contract for customer master.",
      ar: "قرار مطلوب: عقد مصدر الحقيقة لبيانات العميل الرئيسية.",
    },
  },
  {
    id: "security",
    name: { en: "Security & sovereign hosting", ar: "الأمن والاستضافة السيادية" },
    rag: "amber",
    trend: "down",
    raidNew: 4,
    raidClosed: 1,
    etcDelta: 3,
    csat: 58,
    asks: {
      en: "Resolve regulator clarification on cross-border data flow.",
      ar: "حسم استيضاح المنظّم بشأن تدفّق البيانات عبر الحدود.",
    },
  },
  {
    id: "change",
    name: { en: "Change & rollout", ar: "إدارة التغيير والإطلاق" },
    rag: "red",
    trend: "down",
    raidNew: 7,
    raidClosed: 2,
    etcDelta: 5,
    csat: 42,
    asks: {
      en: "Re-baseline rollout: pilot region scope-cut from 9 → 5 sites.",
      ar: "إعادة معايرة الإطلاق: تقليص نطاق المنطقة التجريبية من 9 إلى 5 مواقع.",
    },
  },
  {
    id: "ops",
    name: { en: "Service operations readiness", ar: "جاهزية عمليات الخدمة" },
    rag: "green",
    trend: "up",
    raidNew: 1,
    raidClosed: 4,
    etcDelta: 0,
    csat: 78,
    asks: {
      en: "No ask this week — runbooks signed off by ops.",
      ar: "لا طلب هذا الأسبوع — تم اعتماد كتب التشغيل من العمليات.",
    },
  },
  {
    id: "vendor",
    name: { en: "Vendor & partner orchestration", ar: "تنسيق الشركاء والموردين" },
    rag: "amber",
    trend: "flat",
    raidNew: 3,
    raidClosed: 3,
    etcDelta: 1,
    csat: 70,
    asks: {
      en: "Confirm SI partner extension through cutover window.",
      ar: "تأكيد تمديد الشريك المتكامل خلال نافذة الانتقال.",
    },
  },
];

const COLOR: Record<Rag, string> = {
  green: "#196B24",
  amber: "#F5A623",
  red: "#B91C1C",
};

const COPY = {
  eyebrow: { en: "Programme Health", ar: "صحة البرنامج" },
  title: {
    en: "Steering pack draft, regenerated every Monday.",
    ar: "مسوّدة عبوة التوجيه، تُولَّد كل اثنين.",
  },
  intro: {
    en: "Toggle each workstream's RAG, edit the RAID delta, and watch the steering pack and the recommended ask re-render. Reset reloads the canonical Monday draft.",
    ar: "بدّل حالة كل مسار، عدّل تغيّرات RAID، وراقب تحديث عبوة التوجيه والطلب الموصى به فوراً. إعادة الضبط تُعيد المسوّدة القياسية ليوم الاثنين.",
  },
  reset: { en: "Reset to Monday draft", ar: "إعادة إلى مسوّدة الاثنين" },
  workstreams: { en: "Workstream heatmap", ar: "خريطة حرارية لمسارات العمل" },
  status: { en: "Status", ar: "الحالة" },
  raid: { en: "RAID delta this week", ar: "تغيّرات RAID هذا الأسبوع" },
  etc: { en: "ETC drift (wks)", ar: "انجراف التقدير (أسابيع)" },
  csat: { en: "Stakeholder CSAT", ar: "رضا أصحاب المصلحة" },
  ask: { en: "Recommended ask", ar: "الطلب الموصى به" },
  pack: { en: "Steering pack draft", ar: "مسوّدة عبوة التوجيه" },
  overall: { en: "Overall programme RAG", ar: "حالة البرنامج العامة" },
  drift: { en: "Forecast drift", ar: "انجراف التنبؤ" },
  topAsks: { en: "Top three asks for steering", ar: "أهم ثلاثة طلبات للتوجيه" },
  newOpen: { en: "new", ar: "جديدة" },
  closed: { en: "closed", ar: "مغلقة" },
  weeks: { en: "wks", ar: "أسبوع" },
  legend: {
    en: "Click a workstream chip to cycle through Green → Amber → Red. The pack regenerates instantly.",
    ar: "اضغط على شارة المسار لتدوير الحالة أخضر → أصفر → أحمر. تُعاد العبوة فوراً.",
  },
};

const cycle = (r: Rag): Rag => (r === "green" ? "amber" : r === "amber" ? "red" : "green");

export default function ProgrammeHealthDemo() {
  const { lang } = useLang();
  const [items, setItems] = useState<Workstream[]>(() => SAMPLE.map((s) => ({ ...s })));

  const overall = useMemo(() => {
    const reds = items.filter((i) => i.rag === "red").length;
    const ambers = items.filter((i) => i.rag === "amber").length;
    const drift = items.reduce((s, i) => s + i.etcDelta, 0);
    const newRisks = items.reduce((s, i) => s + i.raidNew, 0);
    const closed = items.reduce((s, i) => s + i.raidClosed, 0);
    const programmeRag: Rag = reds >= 2 ? "red" : reds === 1 || ambers >= 3 ? "amber" : "green";
    return { reds, ambers, drift, newRisks, closed, programmeRag };
  }, [items]);

  const topAsks = useMemo(() => {
    const score = (w: Workstream): number =>
      (w.rag === "red" ? 100 : w.rag === "amber" ? 50 : 0) +
      Math.max(0, w.etcDelta) * 5 +
      Math.max(0, w.raidNew - w.raidClosed) * 3;
    return [...items].sort((a, b) => score(b) - score(a)).slice(0, 3);
  }, [items]);

  const reset = () => setItems(SAMPLE.map((s) => ({ ...s })));

  const trace: AgentLogEntry[] = useMemo(() => {
    return [
      { agentId: "programme-watcher", line: lang === "ar" ? `يراقب ${items.length} مسار عمل، الحالة العامة ${overall.programmeRag.toUpperCase()}.` : `Watching ${items.length} workstreams; overall programme RAG ${overall.programmeRag.toUpperCase()}.` },
      { agentId: "raid-classifier", line: lang === "ar" ? `صنّف ${overall.newRisks} مخاطر جديدة و${overall.closed} مُغلقة هذا الأسبوع.` : `Classified ${overall.newRisks} new RAID items and ${overall.closed} closed this week.` },
      { agentId: "etc-recompiler", line: lang === "ar" ? `إجمالي انجراف التقدير ${overall.drift > 0 ? "+" : ""}${overall.drift} أسابيع.` : `Total estimate-to-complete drift: ${overall.drift > 0 ? "+" : ""}${overall.drift} weeks.` },
      { agentId: "steering-drafter", line: lang === "ar" ? "أعاد توليد عبوة التوجيه على المتغيّرات." : "Regenerated the steering pack on the latest deltas." },
      { agentId: "ask-extractor", line: lang === "ar" ? `استخرج أعلى ${topAsks.length} طلبات للتصعيد.` : `Extracted the top ${topAsks.length} asks for steering.` },
    ];
  }, [items, overall, topAsks, lang]);

  return (
    <DemoShell
      slug="programme-war-room"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#156082"
      Icon={ClipboardList}
      note={COPY.legend}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Overall metrics */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-4 gap-4">
          <Metric
            label={tStr(COPY.overall, lang)}
            value={overall.programmeRag.toUpperCase()}
            color={COLOR[overall.programmeRag]}
            icon={
              overall.programmeRag === "green" ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )
            }
          />
          <Metric
            label={tStr(COPY.drift, lang)}
            value={`${overall.drift > 0 ? "+" : ""}${overall.drift} ${tStr(COPY.weeks, lang)}`}
            color={overall.drift > 2 ? "#B91C1C" : overall.drift > 0 ? "#F5A623" : "#196B24"}
            icon={<Clock size={16} />}
          />
          <Metric
            label={tStr(COPY.raid, lang)}
            value={`+${overall.newRisks} / -${overall.closed}`}
            color="#0E2841"
            icon={<TriangleAlert size={16} />}
          />
          <Metric
            label={tStr({ en: "Stakeholder CSAT", ar: "رضا أصحاب المصلحة" }, lang)}
            value={`${Math.round(items.reduce((s, i) => s + i.csat, 0) / items.length)}%`}
            color="#156082"
            icon={<CheckCircle2 size={16} />}
          />
        </div>
      </section>

      {/* Workstreams */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.workstreams, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((w) => (
              <div
                key={w.id}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
              >
                <button
                  onClick={() => setItems((prev) => prev.map((i) => (i.id === w.id ? { ...i, rag: cycle(i.rag) } : i)))}
                  className="text-start px-5 pt-5 pb-3 flex items-center justify-between gap-2 group"
                  aria-label={tStr({ en: "Toggle status", ar: "تبديل الحالة" }, lang)}
                >
                  <h3 className="font-bold text-[#0E2841] leading-tight">{tStr(w.name, lang)}</h3>
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white group-hover:opacity-80 transition"
                    style={{ backgroundColor: COLOR[w.rag] }}
                  >
                    {w.rag}
                  </span>
                </button>
                <div className="px-5 pb-3 flex flex-wrap gap-3 text-xs text-gray-600">
                  <Stat
                    label={tStr(COPY.raid, lang)}
                    value={`+${w.raidNew} / -${w.raidClosed}`}
                  />
                  <Stat
                    label={tStr(COPY.etc, lang)}
                    value={`${w.etcDelta > 0 ? "+" : ""}${w.etcDelta}`}
                  />
                  <Stat label={tStr(COPY.csat, lang)} value={`${w.csat}%`} />
                </div>
                <div className="px-5 pb-4 flex items-center gap-2">
                  <button
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === w.id ? { ...i, raidNew: i.raidNew + 1 } : i,
                        ),
                      )
                    }
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-200 hover:border-[#0E2841] hover:text-[#0E2841] text-gray-500"
                  >
                    +1 {tStr(COPY.newOpen, lang)}
                  </button>
                  <button
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === w.id ? { ...i, raidClosed: i.raidClosed + 1 } : i,
                        ),
                      )
                    }
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-200 hover:border-[#196B24] hover:text-[#196B24] text-gray-500"
                  >
                    +1 {tStr(COPY.closed, lang)}
                  </button>
                  <button
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === w.id ? { ...i, etcDelta: i.etcDelta + 1 } : i,
                        ),
                      )
                    }
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-200 hover:border-[#B91C1C] hover:text-[#B91C1C] text-gray-500 ms-auto"
                  >
                    +1 {tStr(COPY.weeks, lang)}
                  </button>
                </div>
                <div
                  className="px-5 py-3 text-xs leading-relaxed border-t border-gray-100 bg-[#F8F9FA] text-gray-700"
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    {tStr(COPY.ask, lang)}
                  </p>
                  {tStr(w.asks, lang)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Steering pack draft */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.pack, lang)}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 p-8 leading-relaxed text-sm text-gray-700 space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {tStr({ en: "Programme status, week of 2026-05-04", ar: "حالة البرنامج، أسبوع 2026-05-04" }, lang)}
            </p>
            <p>
              {tStr(
                {
                  en: `Programme overall RAG is ${overall.programmeRag.toUpperCase()}. ${overall.reds} workstream(s) red, ${overall.ambers} amber. ETC drift since baseline: ${
                    overall.drift > 0 ? "+" : ""
                  }${overall.drift} weeks. RAID this week: ${overall.newRisks} new, ${overall.closed} closed.`,
                  ar: `حالة البرنامج العامة ${overall.programmeRag.toUpperCase()}. ${overall.reds} مسار أحمر و${overall.ambers} أصفر. انجراف التقدير منذ المعيار: ${
                    overall.drift > 0 ? "+" : ""
                  }${overall.drift} أسبوعاً. RAID هذا الأسبوع: ${overall.newRisks} جديدة و${overall.closed} مغلقة.`,
                },
                lang,
              )}
            </p>
            <div>
              <p className="font-bold text-[#0E2841] mb-2">{tStr(COPY.topAsks, lang)}</p>
              <ol className="list-decimal ms-6 space-y-2">
                {topAsks.map((w) => (
                  <li key={w.id}>
                    <span className="font-semibold">{tStr(w.name, lang)}:</span> {tStr(w.asks, lang)}
                  </li>
                ))}
              </ol>
            </div>
            <p className="text-xs text-gray-500 italic">
              {tStr(
                {
                  en: "Drafted by the agent. The PMO lead edits, signs, owns. The agent never sends this to the steering committee on its own.",
                  ar: "صياغة الوكيل. يحرّر قائد PMO ويوقّع ويتحمّل المسؤولية. لا يرسل الوكيل أبداً هذا إلى لجنة التوجيه من تلقاء نفسه.",
                },
                lang,
              )}
            </p>
          </div>
        </div>
      </section>
      <section className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="programme-war-room" log={trace} accent="#156082" />
        </div>
      </section>
    </DemoShell>
  );
}

function Metric({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
        <span style={{ color }}>{icon}</span>
        <span className="font-bold uppercase tracking-widest text-[10px]">{label}</span>
      </div>
      <p className="text-2xl font-extrabold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
      <span className="text-sm font-bold text-[#0E2841]">{value}</span>
    </div>
  );
}
