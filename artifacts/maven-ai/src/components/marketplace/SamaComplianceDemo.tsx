import { useMemo, useState } from "react";
import { ShieldCheck, RotateCcw, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";

type Status = "met" | "partial" | "gap";

interface Obligation {
  id: string;
  reg: "SAMA" | "PDPL" | "UAE-AI";
  clause: string;
  title: { en: string; ar: string };
  status: Status;
  evidenceFresh: number; // days since last refresh
  controlScore: number; // 0-100
  notes: { en: string; ar: string };
}

const SAMPLE: Obligation[] = [
  {
    id: "o1",
    reg: "SAMA",
    clause: "BCM 4.3",
    title: { en: "Business continuity testing for critical services", ar: "اختبار استمرارية الأعمال للخدمات الحرجة" },
    status: "met",
    evidenceFresh: 12,
    controlScore: 88,
    notes: { en: "Last full DR test completed Apr 2026; bilingual evidence pack on file.", ar: "آخر اختبار كامل للتعافي أبريل 2026؛ حزمة أدلة ثنائية اللغة محفوظة." },
  },
  {
    id: "o2",
    reg: "SAMA",
    clause: "ITGRC 6.1",
    title: { en: "Privileged access review cadence", ar: "وتيرة مراجعة الوصول المتميّز" },
    status: "partial",
    evidenceFresh: 41,
    controlScore: 64,
    notes: { en: "Quarterly review on schedule; 7 outliers in service-account population pending owner sign-off.", ar: "المراجعة الفصلية في موعدها؛ 7 شذوذات في حسابات الخدمة بانتظار توقيع المالك." },
  },
  {
    id: "o3",
    reg: "SAMA",
    clause: "CSF 3.3",
    title: { en: "Customer-data egress monitoring", ar: "مراقبة خروج بيانات العميل" },
    status: "gap",
    evidenceFresh: 90,
    controlScore: 38,
    notes: { en: "DLP coverage on email but not on collaboration channels; remediation plan drafted.", ar: "تغطية DLP للبريد دون قنوات التعاون؛ خطة معالجة مسوّدة." },
  },
  {
    id: "o4",
    reg: "PDPL",
    clause: "Art 12",
    title: { en: "Data-subject access request response window", ar: "نافذة الردّ على طلبات أصحاب البيانات" },
    status: "met",
    evidenceFresh: 6,
    controlScore: 92,
    notes: { en: "Median response 4.1 days; SLA 30 days. Bilingual templates in use.", ar: "الوسيط 4.1 أيام مقابل اتفاقية 30 يوماً. قوالب ثنائية اللغة." },
  },
  {
    id: "o5",
    reg: "PDPL",
    clause: "Art 18",
    title: { en: "Cross-border data-flow notification", ar: "إشعار تدفّق البيانات عبر الحدود" },
    status: "partial",
    evidenceFresh: 30,
    controlScore: 70,
    notes: { en: "Two SaaS vendors in scope; consent renewal pipeline configured but unverified.", ar: "اثنان من موردي SaaS ضمن النطاق؛ خط تجديد الموافقة مهيأ ولكن دون تحقق." },
  },
  {
    id: "o6",
    reg: "UAE-AI",
    clause: "Charter §4",
    title: { en: "AI model registry and explainability log", ar: "سجل نماذج الذكاء الاصطناعي وقابلية التفسير" },
    status: "met",
    evidenceFresh: 9,
    controlScore: 85,
    notes: { en: "Registry up to date with 14 models in production; explainability logs sampled monthly.", ar: "السجل محدّث بـ 14 نموذجاً في الإنتاج؛ سجلات التفسير تُعاين شهرياً." },
  },
  {
    id: "o7",
    reg: "UAE-AI",
    clause: "Charter §7",
    title: { en: "Human-in-the-loop on adverse decisions", ar: "إنسان في الحلقة على القرارات السلبية" },
    status: "gap",
    evidenceFresh: 60,
    controlScore: 45,
    notes: { en: "Two retail-credit decisioning agents lack human-review gating; UAT remediation in week 2.", ar: "وكيلا قرار للائتمان التجزئة بلا مراجعة بشرية؛ المعالجة في UAT الأسبوع الثاني." },
  },
];

const STATUS_META: Record<Status, { label: { en: string; ar: string }; color: string }> = {
  met: { label: { en: "Met", ar: "مُلتزم" }, color: "#196B24" },
  partial: { label: { en: "Partial", ar: "جزئي" }, color: "#F5A623" },
  gap: { label: { en: "Gap", ar: "فجوة" }, color: "#B91C1C" },
};

const REG_META: Record<Obligation["reg"], { label: { en: string; ar: string }; color: string }> = {
  SAMA: { label: { en: "SAMA", ar: "ساما" }, color: "#0E2841" },
  PDPL: { label: { en: "PDPL", ar: "حماية البيانات" }, color: "#156082" },
  "UAE-AI": { label: { en: "UAE AI Charter", ar: "ميثاق الإمارات للذكاء" }, color: "#0F9ED5" },
};

const COPY = {
  eyebrow: { en: "SAMA Compliance Agent", ar: "وكيل الامتثال لساما" },
  title: {
    en: "Inspection-ready evidence in minutes — not weeks.",
    ar: "أدلّة جاهزة للتفتيش خلال دقائق — لا أسابيع.",
  },
  intro: {
    en: "Cycle each obligation's status to see how the regulator dashboard recomputes. Filter by regulator to scope what would go into a single inspection pack.",
    ar: "بدّل حالة كل التزام لترى تحديث لوحة المنظّم. صفِّ حسب المنظّم لنطاق حزمة التفتيش الواحدة.",
  },
  reset: { en: "Reset register", ar: "إعادة السجل" },
  filterBy: { en: "Filter by regulator", ar: "تصفية حسب المنظّم" },
  all: { en: "All", ar: "الكل" },
  obligations: { en: "Obligations register", ar: "سجل الالتزامات" },
  control: { en: "Control score", ar: "درجة الضابط" },
  fresh: { en: "Last evidence", ar: "آخر دليل" },
  daysAgo: { en: "days ago", ar: "يوماً مضت" },
  pack: { en: "Inspection pack preview", ar: "معاينة حزمة التفتيش" },
  packNote: {
    en: "What the regulator sees: bilingual EN/AR coversheet, the obligation summary, and the citation trail per control.",
    ar: "ما يراه المنظّم: غلاف ثنائي اللغة، ملخّص الالتزام، وسلسلة المراجع لكل ضابط.",
  },
  cycle: { en: "Cycle status", ar: "بدّل الحالة" },
  scoreboard: { en: "Regulator scoreboard", ar: "لوحة المنظّم" },
};

const cycleStatus = (s: Status): Status => (s === "met" ? "partial" : s === "partial" ? "gap" : "met");

export default function SamaComplianceDemo() {
  const { lang } = useLang();
  const [items, setItems] = useState<Obligation[]>(() => SAMPLE.map((s) => ({ ...s })));
  const [filter, setFilter] = useState<"all" | Obligation["reg"]>("all");

  const filtered = filter === "all" ? items : items.filter((i) => i.reg === filter);

  const summary = useMemo(() => {
    const groups: Record<Obligation["reg"], { met: number; partial: number; gap: number; score: number; count: number }> = {
      SAMA: { met: 0, partial: 0, gap: 0, score: 0, count: 0 },
      PDPL: { met: 0, partial: 0, gap: 0, score: 0, count: 0 },
      "UAE-AI": { met: 0, partial: 0, gap: 0, score: 0, count: 0 },
    };
    for (const i of items) {
      groups[i.reg][i.status]++;
      groups[i.reg].score += i.controlScore;
      groups[i.reg].count++;
    }
    return groups;
  }, [items]);

  const reset = () => {
    setItems(SAMPLE.map((s) => ({ ...s })));
    setFilter("all");
  };

  const cycle = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: cycleStatus(i.status) } : i)));

  const trace: AgentLogEntry[] = useMemo(() => {
    const met = items.filter((i) => i.status === "met").length;
    const partial = items.filter((i) => i.status === "partial").length;
    const gap = items.filter((i) => i.status === "gap").length;
    const stale = items.filter((i) => i.evidenceFresh > 60).length;
    return [
      { agentId: "obligation-mapper", line: lang === "ar" ? `خرّط ${items.length} التزاماً عبر ساما، PDPL، وميثاق الإمارات.` : `Mapped ${items.length} obligations across SAMA, PDPL, and the UAE AI Charter.` },
      { agentId: "control-monitor", line: lang === "ar" ? `الحالة: ${met} مستوفى، ${partial} جزئي، ${gap} فجوة.` : `Control status: ${met} met, ${partial} partial, ${gap} gap.` },
      { agentId: "evidence-curator", line: lang === "ar" ? "حدّث سلسلة الأدلة لكل ضابط." : "Refreshed the evidence trail for every control." },
      { agentId: "degradation-detective", line: stale > 0 ? (lang === "ar" ? `${stale} ضابط بأدلّة أقدم من 60 يوماً.` : `${stale} control(s) carry evidence older than 60 days.`) : (lang === "ar" ? "لا يوجد ضوابط بأدلّة قديمة." : "No controls flagged for stale evidence.") },
      { agentId: "pack-compiler", line: filter === "all" ? (lang === "ar" ? "جمّع حزمة تفتيش لكل المنظّمين." : "Compiled an inspection pack for all regulators.") : (lang === "ar" ? `قصر الحزمة على ${filter}.` : `Scoped the inspection pack to ${filter}.`) },
    ];
  }, [items, filter, lang]);

  return (
    <DemoShell
      slug="sama-compliance-sentinel"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#0E2841"
      Icon={ShieldCheck}
      note={COPY.packNote}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Scoreboard */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.scoreboard, lang)}
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {(Object.keys(summary) as Array<Obligation["reg"]>).map((reg) => {
              const g = summary[reg];
              const score = g.count > 0 ? g.score / g.count : 0;
              const overall: Status = g.gap > 0 ? "gap" : g.partial > 0 ? "partial" : "met";
              return (
                <div key={reg} className="bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: REG_META[reg].color }}>
                      {tStr(REG_META[reg].label, lang)}
                    </p>
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: STATUS_META[overall].color }}
                    >
                      {tStr(STATUS_META[overall].label, lang)}
                    </span>
                  </div>
                  <p className="text-3xl font-extrabold text-[#0E2841] mb-1">{score.toFixed(0)}</p>
                  <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">
                    {tStr({ en: "avg control score", ar: "متوسط درجة الضابط" }, lang)}
                  </p>
                  <div className="flex gap-1 text-[10px] font-bold uppercase tracking-widest">
                    <Pip color="#196B24" label={`${g.met} ${tStr(STATUS_META.met.label, lang)}`} />
                    <Pip color="#F5A623" label={`${g.partial} ${tStr(STATUS_META.partial.label, lang)}`} />
                    <Pip color="#B91C1C" label={`${g.gap} ${tStr(STATUS_META.gap.label, lang)}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Filter */}
      <section className="py-6 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 me-2">
            {tStr(COPY.filterBy, lang)}
          </span>
          {(["all", "SAMA", "PDPL", "UAE-AI"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${
                filter === f
                  ? "bg-[#0E2841] text-white border-[#0E2841]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#0E2841]"
              }`}
            >
              {f === "all" ? tStr(COPY.all, lang) : tStr(REG_META[f].label, lang)}
            </button>
          ))}
        </div>
      </section>

      {/* Register */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            {tStr(COPY.obligations, lang)}
          </p>
          {filtered.map((o) => {
            const meta = STATUS_META[o.status];
            return (
              <div
                key={o.id}
                className="bg-white rounded-2xl border border-gray-100 p-5 grid lg:grid-cols-12 gap-4 items-center"
              >
                <div className="lg:col-span-5">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: REG_META[o.reg].color }}
                    >
                      {o.reg}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {o.clause}
                    </span>
                  </div>
                  <p className="font-bold text-[#0E2841] text-sm leading-tight">
                    {tStr(o.title, lang)}
                  </p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{tStr(o.notes, lang)}</p>
                </div>
                <div className="lg:col-span-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {tStr(COPY.control, lang)}
                  </p>
                  <p className="text-lg font-extrabold" style={{ color: meta.color }}>
                    {o.controlScore}
                  </p>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${o.controlScore}%`, background: meta.color }}
                    />
                  </div>
                </div>
                <div className="lg:col-span-2 flex items-center gap-2">
                  <FileText size={14} className="text-gray-400" />
                  <span className="text-xs text-gray-600">
                    {o.evidenceFresh} {tStr(COPY.daysAgo, lang)}
                  </span>
                </div>
                <div className="lg:col-span-2 flex items-center justify-end gap-2">
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {tStr(meta.label, lang)}
                  </span>
                </div>
                <button
                  onClick={() => cycle(o.id)}
                  className="lg:col-span-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 rounded border border-gray-200 hover:border-[#0E2841] hover:text-[#0E2841] text-gray-500"
                >
                  {tStr(COPY.cycle, lang)}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Inspection pack */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.pack, lang)}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-sm text-gray-700 leading-relaxed space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {tStr({ en: "Coversheet", ar: "غلاف" }, lang)}
            </p>
            <p>
              {tStr(
                {
                  en: `Filtered scope: ${filter === "all" ? "All regulators" : filter}. ${filtered.length} obligation(s).`,
                  ar: `النطاق المرشّح: ${filter === "all" ? "كل المنظّمين" : filter}. ${filtered.length} التزام.`,
                },
                lang,
              )}
            </p>
            <ul className="space-y-2">
              {filtered.slice(0, 5).map((o) => {
                const meta = STATUS_META[o.status];
                return (
                  <li key={o.id} className="flex items-start gap-3">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white mt-0.5"
                      style={{ backgroundColor: meta.color }}
                    >
                      {tStr(meta.label, lang)}
                    </span>
                    <span>
                      <span className="font-semibold text-[#0E2841]">
                        {o.reg} {o.clause}:
                      </span>{" "}
                      {tStr(o.title, lang)}
                    </span>
                  </li>
                );
              })}
              {filtered.length > 5 && (
                <li className="text-xs text-gray-400 italic">
                  … +{filtered.length - 5} {tStr({ en: "more obligations in the pack", ar: "التزامات إضافية في الحزمة" }, lang)}
                </li>
              )}
            </ul>
            <p className="text-xs text-gray-500 italic">
              {tStr(
                {
                  en: "Generated and citation-checked by the agent. The CRO signs the cover letter — the agent never files on the bank's behalf.",
                  ar: "أنشأها الوكيل بفحص المراجع. يوقّع كبير المخاطر الغلاف — لا يقدّم الوكيل أبداً نيابةً عن البنك.",
                },
                lang,
              )}
            </p>
          </div>
        </div>
      </section>
      <section className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="sama-compliance-sentinel" log={trace} accent="#0E2841" />
        </div>
      </section>
    </DemoShell>
  );
}

function Pip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-white inline-flex items-center gap-1"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

// silence unused warnings on icons we keep available for future tweaks
void AlertTriangle;
void CheckCircle2;
