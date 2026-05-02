import { useMemo, useState } from "react";
import { Activity, RotateCcw, AlertTriangle, ShieldAlert, Radio } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

type Severity = "p1" | "p2" | "p3";

interface Incident {
  id: string;
  title: { en: string; ar: string };
  region: string;
  severity: Severity;
  customersImpacted: number;
  csatDelta: number; // pts
  recentChanges: number;
  recommendation: { en: string; ar: string };
  evidence: { en: string; ar: string }[];
  regulatorThreshold: number;
  acknowledged: boolean;
}

const SAMPLE: Incident[] = [
  {
    id: "inc-ruh-1",
    title: { en: "RAN cluster degradation — Riyadh North", ar: "تدهور مجموعة RAN — شمال الرياض" },
    region: "Riyadh",
    severity: "p1",
    customersImpacted: 84_000,
    csatDelta: -7,
    recentChanges: 3,
    recommendation: {
      en: "Roll back the Vendor-A baseband patch deployed at 22:14; correlation score 0.92 with the alarm chain.",
      ar: "تراجع عن تحديث المورّد A للقاعدة المنشور 22:14؛ ارتباط 0.92 مع سلسلة الإنذارات.",
    },
    evidence: [
      { en: "12 cells in alarm cluster CL-RUH-N (S1 link drops)", ar: "12 خلية ضمن CL-RUH-N (انقطاع رابط S1)" },
      { en: "Change CR-2026-1118 deployed 22:14, alarms began 22:21", ar: "التغيير CR-2026-1118 نُشر 22:14، الإنذارات بدأت 22:21" },
      { en: "Care contacts up 320% in last 30 minutes", ar: "اتصالات الخدمة ارتفعت 320% آخر 30 دقيقة" },
    ],
    regulatorThreshold: 50_000,
    acknowledged: false,
  },
  {
    id: "inc-jed-1",
    title: { en: "Transport ring flap — Jeddah corniche", ar: "تذبذب حلقة النقل — كورنيش جدة" },
    region: "Jeddah",
    severity: "p2",
    customersImpacted: 18_000,
    csatDelta: -3,
    recentChanges: 1,
    recommendation: {
      en: "Hold pending verification — fault isolated to fibre span FB-JED-22; field crew dispatched.",
      ar: "تعليق ريثما يتم التحقّق — العطل معزول إلى مقطع ألياف FB-JED-22؛ تم إرسال الفنيين.",
    },
    evidence: [
      { en: "OTDR trace shows attenuation spike at km 14.2", ar: "تتبّع OTDR يُظهر ارتفاع توهين عند الكم 14.2" },
      { en: "Redundant ring carrying load — service holding", ar: "الحلقة الاحتياطية تحمل الحمل — الخدمة مستقرّة" },
    ],
    regulatorThreshold: 50_000,
    acknowledged: false,
  },
  {
    id: "inc-dxb-1",
    title: { en: "5G Core slice latency — Downtown Dubai", ar: "زمن استجابة شريحة 5G — وسط دبي" },
    region: "Dubai",
    severity: "p2",
    customersImpacted: 32_000,
    csatDelta: -4,
    recentChanges: 2,
    recommendation: {
      en: "Scale UPF instances 4 → 6 in DBI-AZ-2; expected to clear in 8 minutes.",
      ar: "توسيع نسخ UPF من 4 إلى 6 في DBI-AZ-2؛ يُتوقع الحلّ خلال 8 دقائق.",
    },
    evidence: [
      { en: "P95 latency 184 ms vs SLA 60 ms", ar: "P95 الزمن 184 ميلي ثانية مقابل SLA 60" },
      { en: "Slice utilisation 92% — capacity ceiling reached", ar: "استخدام الشريحة 92% — وصل سقف السعة" },
    ],
    regulatorThreshold: 50_000,
    acknowledged: false,
  },
  {
    id: "inc-dmm-1",
    title: { en: "Dammam BSS care queue spike", ar: "ارتفاع طوابير خدمة عملاء الدمام" },
    region: "Dammam",
    severity: "p3",
    customersImpacted: 6_500,
    csatDelta: -2,
    recentChanges: 0,
    recommendation: {
      en: "Likely social cause (Hajj-week travel) — keep monitoring; no network-side action recommended.",
      ar: "سبب اجتماعي محتمل (سفر أسبوع الحج) — المتابعة، لا يوصى بأي إجراء على الشبكة.",
    },
    evidence: [
      { en: "No matching alarm cluster", ar: "لا توجد مجموعة إنذارات مطابقة" },
      { en: "Geo-correlation matches public events calendar", ar: "الارتباط الجغرافي يطابق تقويم الفعاليات العامة" },
    ],
    regulatorThreshold: 50_000,
    acknowledged: false,
  },
];

const SEV_COLOR: Record<Severity, string> = {
  p1: "#B91C1C",
  p2: "#F5A623",
  p3: "#156082",
};

const COPY = {
  eyebrow: { en: "Network Ops Agent", ar: "وكيل عمليات الشبكة" },
  title: {
    en: "Live triage — what's hurting customers right now?",
    ar: "فرز حيّ — ما الذي يؤثّر على العملاء الآن؟",
  },
  intro: {
    en: "Click an incident to acknowledge it; raise or lower the impact estimate to see how the regulator-notification flag and the recommended action shift. The agent never executes a change.",
    ar: "اضغط حادثة لإقرارها؛ ارفع أو اخفض تقدير الأثر لترى كيف ينتقل علم إشعار المنظّم والإجراء الموصى به. لا ينفّذ الوكيل أي تغيير.",
  },
  reset: { en: "Reset incidents", ar: "إعادة الحوادث" },
  open: { en: "Open incidents", ar: "حوادث مفتوحة" },
  acknowledged: { en: "Acknowledged", ar: "مُقرّة" },
  affected: { en: "Customers affected (rolling)", ar: "العملاء المتأثرون" },
  notify: { en: "Regulator-notifiable", ar: "تستوجب إشعار المنظّم" },
  notifyNote: {
    en: "Threshold: 50,000 affected customers within a 60-minute window per CITC/TRA guidance.",
    ar: "العتبة: 50,000 عميل متأثر خلال 60 دقيقة حسب توجيه CITC/TRA.",
  },
  triage: { en: "Triage queue", ar: "طابور الفرز" },
  evidence: { en: "Evidence chain", ar: "سلسلة الأدلة" },
  recommend: { en: "Recommended action", ar: "الإجراء الموصى به" },
  acknowledge: { en: "Acknowledge", ar: "أقِرّ" },
  reactivate: { en: "Re-open", ar: "إعادة فتح" },
  raise: { en: "+10k impact", ar: "+10k أثر" },
  lower: { en: "−10k impact", ar: "−10k أثر" },
  changes: { en: "recent changes", ar: "تغييرات حديثة" },
  csat: { en: "CSAT delta", ar: "تغيّر رضا العملاء" },
};

export default function NetworkOpsDemo() {
  const { lang } = useLang();
  const [items, setItems] = useState<Incident[]>(() => SAMPLE.map((s) => ({ ...s })));

  const totals = useMemo(() => {
    const open = items.filter((i) => !i.acknowledged);
    const totalAffected = items.reduce((s, i) => s + i.customersImpacted, 0);
    const notifiable = items.some((i) => i.customersImpacted >= i.regulatorThreshold);
    const ack = items.length - open.length;
    return { openCount: open.length, totalAffected, notifiable, ack };
  }, [items]);

  const reset = () => setItems(SAMPLE.map((s) => ({ ...s })));

  const adjust = (id: string, delta: number) =>
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, customersImpacted: Math.max(0, i.customersImpacted + delta) } : i,
      ),
    );

  const ack = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, acknowledged: !i.acknowledged } : i)));

  const sorted = [...items].sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return Number(a.acknowledged) - Number(b.acknowledged);
    if (a.severity !== b.severity) return a.severity.localeCompare(b.severity);
    return b.customersImpacted - a.customersImpacted;
  });

  return (
    <DemoShell
      slug="network-ops-agent"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#156082"
      Icon={Activity}
      note={COPY.notifyNote}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Tiles */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-4 gap-4">
          <Tile label={tStr(COPY.open, lang)} value={String(totals.openCount)} color="#B91C1C" icon={<AlertTriangle size={16} />} />
          <Tile label={tStr(COPY.acknowledged, lang)} value={String(totals.ack)} color="#196B24" icon={<Activity size={16} />} />
          <Tile label={tStr(COPY.affected, lang)} value={totals.totalAffected.toLocaleString("en-US")} color="#0E2841" icon={<Radio size={16} />} />
          <Tile
            label={tStr(COPY.notify, lang)}
            value={totals.notifiable ? tStr({ en: "Yes — file now", ar: "نعم — أبلغ الآن" }, lang) : tStr({ en: "Not yet", ar: "ليس بعد" }, lang)}
            color={totals.notifiable ? "#B91C1C" : "#196B24"}
            icon={<ShieldAlert size={16} />}
          />
        </div>
      </section>

      {/* Triage queue */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            {tStr(COPY.triage, lang)}
          </p>
          {sorted.map((i) => {
            const breach = i.customersImpacted >= i.regulatorThreshold;
            return (
              <div
                key={i.id}
                className={`bg-white rounded-2xl border-2 ${
                  i.acknowledged ? "border-gray-200 opacity-70" : "border-transparent"
                } overflow-hidden`}
              >
                <div className="px-5 pt-4 pb-2 flex flex-wrap items-center gap-2 border-b border-gray-100">
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: SEV_COLOR[i.severity] }}
                  >
                    {i.severity.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {i.region}
                  </span>
                  <h3 className="font-bold text-[#0E2841] flex-1 min-w-0">{tStr(i.title, lang)}</h3>
                  {breach && (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#B91C1C] text-white inline-flex items-center gap-1">
                      <ShieldAlert size={10} /> {tStr(COPY.notify, lang)}
                    </span>
                  )}
                </div>
                <div className="grid lg:grid-cols-3 gap-5 p-5">
                  <div className="space-y-2">
                    <Stat label={tStr(COPY.affected, lang)} value={i.customersImpacted.toLocaleString("en-US")} />
                    <Stat
                      label={tStr(COPY.csat, lang)}
                      value={`${i.csatDelta > 0 ? "+" : ""}${i.csatDelta} pts`}
                    />
                    <Stat
                      label={tStr({ en: "Recent changes", ar: "تغييرات حديثة" }, lang)}
                      value={`${i.recentChanges} ${tStr(COPY.changes, lang)}`}
                    />
                  </div>
                  <div className="lg:col-span-2 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-1">
                        {tStr(COPY.recommend, lang)}
                      </p>
                      <p className="text-sm text-[#0E2841] leading-relaxed">
                        {tStr(i.recommendation, lang)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                        {tStr(COPY.evidence, lang)}
                      </p>
                      <ul className="text-xs text-gray-600 space-y-1">
                        {i.evidence.map((e, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-[#156082]" />
                            <span>{tStr(e, lang)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-gray-100 bg-[#F8F9FA] flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => ack(i.id)}
                    className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded transition-colors ${
                      i.acknowledged
                        ? "border border-[#156082] text-[#156082] hover:bg-[#156082] hover:text-white"
                        : "bg-[#0E2841] text-white hover:bg-[#156082]"
                    }`}
                  >
                    {i.acknowledged ? tStr(COPY.reactivate, lang) : tStr(COPY.acknowledge, lang)}
                  </button>
                  <button
                    onClick={() => adjust(i.id, 10_000)}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded border border-gray-200 hover:border-[#B91C1C] hover:text-[#B91C1C] text-gray-600"
                  >
                    {tStr(COPY.raise, lang)}
                  </button>
                  <button
                    onClick={() => adjust(i.id, -10_000)}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded border border-gray-200 hover:border-[#196B24] hover:text-[#196B24] text-gray-600"
                  >
                    {tStr(COPY.lower, lang)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </DemoShell>
  );
}

function Tile({
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
      <p className="text-2xl font-extrabold leading-tight" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-base font-bold text-[#0E2841]">{value}</p>
    </div>
  );
}
