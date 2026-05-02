import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Printer,
  RotateCcw,
  TrendingUp,
  X,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lightbulb,
  FlaskConical,
  Rocket,
  ShieldAlert,
  HeartHandshake,
  PiggyBank,
  Sparkles,
  Network,
} from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import Gauge from "@/components/assessment/Gauge";
import AgentExplainer from "./AgentExplainer";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";
import { marketplaceTools } from "@/data/content";
import type {
  ValueRealizationInitiative,
  ValueInitiativeStatus,
  ValueInitiativeType,
} from "@workspace/maven-content";

const ACCENT = "#0F9ED5";
const NAVY = "#0E2841";
const AMBER = "#F5A623";
const RED = "#B91C1C";
const GREEN = "#196B24";
const SLATE = "#64748B";

// "Today" anchor for the time-series. Locked to the Maven AI demo date so the
// charts always look the same regardless of when a visitor opens the page.
const TODAY = new Date("2026-05-02T00:00:00Z");

const STATUSES: Array<{
  id: ValueInitiativeStatus;
  label: { en: string; ar: string };
  color: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "idea", label: { en: "Idea", ar: "فكرة" }, color: SLATE, icon: Lightbulb },
  { id: "pilot", label: { en: "Pilot", ar: "تجربة" }, color: ACCENT, icon: FlaskConical },
  { id: "scaling", label: { en: "Scaling", ar: "توسيع" }, color: AMBER, icon: Rocket },
  {
    id: "in-production",
    label: { en: "In production", ar: "في الإنتاج" },
    color: GREEN,
    icon: CheckCircle2,
  },
];

const TYPES: Array<{
  id: ValueInitiativeType;
  label: { en: string; ar: string };
  color: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  {
    id: "cost-out",
    label: { en: "Cost-out", ar: "خفض التكلفة" },
    color: NAVY,
    icon: PiggyBank,
  },
  { id: "revenue", label: { en: "Revenue", ar: "إيراد" }, color: GREEN, icon: TrendingUp },
  { id: "risk", label: { en: "Risk", ar: "مخاطر" }, color: RED, icon: ShieldAlert },
  {
    id: "experience",
    label: { en: "Experience", ar: "تجربة" },
    color: ACCENT,
    icon: HeartHandshake,
  },
];

const COPY = {
  back: { en: "Back to Marketplace", ar: "العودة إلى السوق" },
  liveBadge: { en: "Live demo", ar: "عرض تفاعلي" },
  eyebrow: { en: "Value Realization Tool", ar: "أداة تحقيق القيمة" },
  title: {
    en: "The CFO scoreboard for AI initiatives.",
    ar: "لوحة قياس المدير المالي لمبادرات الذكاء الاصطناعي.",
  },
  intro: {
    en: "Every initiative below shows what the business case promised, what the P&L is actually seeing, and the leakage hiding in pilots that have stalled. Edit any field — totals, the time-series and the leakage callout re-render on the spot. Reset reloads the sample portfolio.",
    ar: "تُظهر كل مبادرة أدناه ما وعدت به حالة العمل، وما يشهده فعلاً بيان الأرباح، والتسرّب الكامن في التجارب المتعثّرة. عدّل أي حقل — تُعاد المجاميع والسلسلة الزمنية وتنبيه التسرّب فوراً. اضغط إعادة الضبط لتحميل المحفظة العيّنة مرة أخرى.",
  },
  add: { en: "Add initiative", ar: "أضف مبادرة" },
  reset: { en: "Reset to sample", ar: "إعادة ضبط للنموذج" },
  print: { en: "Print summary", ar: "اطبع الملخص" },
  expected: { en: "Expected annual value", ar: "القيمة السنوية المتوقعة" },
  realized: { en: "Realised annual value", ar: "القيمة السنوية المحقّقة" },
  invested: { en: "Invested to date", ar: "الاستثمار حتى تاريخه" },
  realization: { en: "Realisation rate", ar: "معدل التحقيق" },
  roi: { en: "Portfolio ROI", ar: "العائد على المحفظة" },
  atRisk: { en: "Value at risk", ar: "القيمة المعرّضة للخطر" },
  ttv: { en: "Avg time to value", ar: "متوسط وقت تحقيق القيمة" },
  ttvDist: { en: "Time-to-value distribution", ar: "توزيع وقت تحقيق القيمة" },
  ttvAxis: { en: "months from kickoff to go-live", ar: "أشهر من الانطلاق إلى التشغيل" },
  trend: {
    en: "Realised vs expected, last 12 months",
    ar: "المحقّق مقابل المتوقع، آخر 12 شهراً",
  },
  trendNote: {
    en: "Annualised run-rate at month-end. Realised ramps up over the first three months after each go-live; planned go-lives in the future are excluded.",
    ar: "المعدّل السنوي بنهاية الشهر. تتصاعد القيمة المحققة خلال الأشهر الثلاثة الأولى بعد كل تشغيل؛ تُستبعد المبادرات التي ستنطلق مستقبلاً.",
  },
  months: { en: "months", ar: "شهر" },
  initiative: { en: "Initiative", ar: "المبادرة" },
  initiatives: { en: "Initiatives", ar: "المبادرات" },
  businessUnit: { en: "Business unit", ar: "وحدة العمل" },
  type: { en: "Type", ar: "النوع" },
  status: { en: "Status", ar: "الحالة" },
  goLive: { en: "Go-live", ar: "تاريخ الإطلاق" },
  kickoff: { en: "Kickoff", ar: "تاريخ الانطلاق" },
  edit: { en: "Edit", ar: "تعديل" },
  close: { en: "Close", ar: "إغلاق" },
  save: { en: "Save", ar: "حفظ" },
  remove: { en: "Remove initiative", ar: "حذف المبادرة" },
  confidence: { en: "Confidence", ar: "الثقة" },
  stalledTitle: {
    en: "Pilots stalled longer than 90 days",
    ar: "تجارب متوقفة أكثر من 90 يوماً",
  },
  stalledNote: {
    en: "Each card lists the value at risk if the pilot never reaches scale. Anything in pilot for more than 90 days appears here.",
    ar: "تعرض كل بطاقة القيمة المعرّضة للخطر إذا لم تنتقل التجربة إلى التوسع. كل ما هو في التجربة لأكثر من 90 يوماً يظهر هنا.",
  },
  noStalled: {
    en: "No pilot has been in this state for more than 90 days. Healthy.",
    ar: "لا توجد تجربة في هذه الحالة لأكثر من 90 يوماً. سليم.",
  },
  empty: { en: 'No initiatives yet — click "Add initiative".', ar: 'لا توجد مبادرات بعد — اضغط "أضف مبادرة".' },
  partner: { en: "Talk to a partner about your portfolio", ar: "تحدّث مع شريك حول محفظتك" },
  partnerCta: { en: "Open contact form", ar: "افتح نموذج التواصل" },
  service: {
    en: "Pair this with our Agentic AI Transformation service",
    ar: "اقرن هذا بخدمة التحوّل إلى الذكاء الاصطناعي العميل لدينا",
  },
  serviceCta: { en: "Read service brief", ar: "اقرأ موجز الخدمة" },
  diagnostic: {
    en: "Run the Use Case Value (UVR) diagnostic",
    ar: "شغّل تشخيص قيمة حالات الاستخدام (UVR)",
  },
  diagnosticCta: { en: "Start UVR", ar: "ابدأ UVR" },
  note: {
    en: "Sample data is illustrative — designed to look like a real GCC portfolio so you can stress-test the dashboard.",
    ar: "البيانات النموذجية توضيحية — مصمّمة لتبدو مثل محفظة خليجية حقيقية حتى تتمكن من اختبار اللوحة.",
  },
  fullscreen: { en: "Open initiative", ar: "افتح المبادرة" },
  daysInPilot: { en: "days in pilot", ar: "يوماً في التجربة" },
  flagPlanned: {
    en: "Go-live still in the future",
    ar: "تاريخ الإطلاق مستقبلي",
  },
};

// ---------- shared sample dataset ----------

const FLAGSHIP =
  marketplaceTools.find((t) => t.slug === "value-realization") ??
  (() => {
    throw new Error("[ValueRealizationDemo] missing value-realization in marketplaceTools");
  })();

if (!FLAGSHIP.samplePortfolio || FLAGSHIP.samplePortfolio.length === 0) {
  throw new Error("[ValueRealizationDemo] value-realization tool has no samplePortfolio");
}

const SAMPLE: ValueRealizationInitiative[] = FLAGSHIP.samplePortfolio.map((s) => ({ ...s }));

// ---------- formatters ----------

function fmtMoney(v: number, lang: "en" | "ar"): string {
  if (v === 0) return lang === "ar" ? "صفر" : "AED 0";
  if (Math.abs(v) >= 1_000_000) {
    const m = v / 1_000_000;
    const s = Math.abs(m) >= 10 ? m.toFixed(0) : m.toFixed(1);
    return lang === "ar" ? `${s} مليون` : `AED ${s}M`;
  }
  if (Math.abs(v) >= 1_000) {
    const k = v / 1_000;
    return lang === "ar" ? `${k.toFixed(0)} ألف` : `AED ${k.toFixed(0)}K`;
  }
  return lang === "ar" ? String(Math.round(v)) : `AED ${Math.round(v)}`;
}

function fmtPct(v: number): string {
  return `${Math.round(v)}%`;
}

function fmtSignedPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${Math.round(v)}%`;
}

function monthsBetween(a: Date, b: Date): number {
  const diffMs = b.getTime() - a.getTime();
  return diffMs / (1000 * 60 * 60 * 24 * 30.4375);
}

function daysBetween(a: Date, b: Date): number {
  const diffMs = b.getTime() - a.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function safeDate(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

// Linear ramp 0 -> 1 over the first three months after go-live.
function rampFactor(monthsSinceGoLive: number): number {
  if (monthsSinceGoLive <= 0) return 0;
  if (monthsSinceGoLive >= 3) return 1;
  return monthsSinceGoLive / 3;
}

// ---------- component ----------

export default function ValueRealizationDemo() {
  const { lang, dir } = useLang();
  const [items, setItems] = useState<ValueRealizationInitiative[]>(() =>
    SAMPLE.map((s) => ({ ...s })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const totals = useMemo(() => {
    const expected = items.reduce((s, i) => s + i.expectedAnnualValue, 0);
    const realized = items.reduce((s, i) => s + i.realizedAnnualValue, 0);
    const invested = items.reduce((s, i) => s + i.investedToDate, 0);
    const gap = Math.max(0, expected - realized);
    const realizationRate = expected > 0 ? (realized / expected) * 100 : 0;
    const roi = invested > 0 ? ((realized - invested) / invested) * 100 : 0;

    // Time-to-value across initiatives whose go-live is in the past.
    const shipped = items.filter(
      (i) => safeDate(i.goLiveDate).getTime() <= TODAY.getTime(),
    );
    const ttvSamples = shipped.map((i) =>
      Math.max(0, monthsBetween(safeDate(i.startDate), safeDate(i.goLiveDate))),
    );
    const ttv =
      ttvSamples.length > 0
        ? ttvSamples.reduce((s, n) => s + n, 0) / ttvSamples.length
        : 0;

    // Value at risk = expected − realised on every initiative whose status
    // hasn't reached "in-production" yet. The leakage section drills into the
    // 90-day pilot rule on top of this.
    const atRisk = items
      .filter((i) => i.status !== "in-production")
      .reduce((s, i) => s + Math.max(0, i.expectedAnnualValue - i.realizedAnnualValue), 0);

    return { expected, realized, invested, gap, realizationRate, roi, ttv, atRisk };
  }, [items]);

  // Realised vs expected over the trailing 12 months. Each month is the
  // annualised run-rate at month-end.
  const trend = useMemo(() => {
    const points: Array<{ label: string; expected: number; realized: number }> = [];
    for (let offset = 11; offset >= 0; offset--) {
      const monthEnd = new Date(
        Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - offset + 1, 0),
      );
      let expected = 0;
      let realized = 0;
      for (const i of items) {
        const goLive = safeDate(i.goLiveDate);
        if (goLive.getTime() > monthEnd.getTime()) continue; // not yet live
        expected += i.expectedAnnualValue;
        const monthsSince = monthsBetween(goLive, monthEnd);
        realized += i.realizedAnnualValue * rampFactor(monthsSince);
      }
      const label = monthEnd.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
      points.push({ label, expected, realized });
    }
    const max = Math.max(1, ...points.map((p) => Math.max(p.expected, p.realized)));
    return { points, max };
  }, [items]);

  // Histogram: months from kickoff to go-live, bucketed.
  const ttvDistribution = useMemo(() => {
    const buckets = [
      { id: "0-3", label: { en: "0–3", ar: "0-3" }, count: 0 },
      { id: "3-6", label: { en: "3–6", ar: "3-6" }, count: 0 },
      { id: "6-9", label: { en: "6–9", ar: "6-9" }, count: 0 },
      { id: "9-12", label: { en: "9–12", ar: "9-12" }, count: 0 },
      { id: "12+", label: { en: "12+", ar: "12+" }, count: 0 },
    ];
    for (const i of items) {
      const m = monthsBetween(safeDate(i.startDate), safeDate(i.goLiveDate));
      if (m < 3) buckets[0].count++;
      else if (m < 6) buckets[1].count++;
      else if (m < 9) buckets[2].count++;
      else if (m < 12) buckets[3].count++;
      else buckets[4].count++;
    }
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return { buckets, max };
  }, [items]);

  // Leakage rule: any initiative still flagged "pilot" for more than 90 days.
  const stalledPilots = useMemo(() => {
    const out: Array<{
      id: string;
      initiative: ValueRealizationInitiative;
      daysInPilot: number;
      valueAtRisk: number;
      futureGoLive: boolean;
    }> = [];
    for (const i of items) {
      if (i.status !== "pilot") continue;
      const days = daysBetween(safeDate(i.startDate), TODAY);
      if (days <= 90) continue;
      out.push({
        id: i.id,
        initiative: i,
        daysInPilot: days,
        valueAtRisk: Math.max(0, i.expectedAnnualValue - i.realizedAnnualValue),
        futureGoLive: safeDate(i.goLiveDate).getTime() > TODAY.getTime(),
      });
    }
    return out.sort((a, b) => b.valueAtRisk - a.valueAtRisk);
  }, [items]);

  const reset = () => {
    setItems(SAMPLE.map((s) => ({ ...s })));
    setEditingId(null);
  };

  const addNew = () => {
    const id = `i-${Date.now()}`;
    const today = TODAY.toISOString().slice(0, 10);
    const fresh: ValueRealizationInitiative = {
      id,
      name: { en: "New initiative", ar: "مبادرة جديدة" },
      businessUnit: { en: "Business unit", ar: "وحدة العمل" },
      type: "cost-out",
      investedToDate: 250_000,
      expectedAnnualValue: 1_000_000,
      realizedAnnualValue: 0,
      confidence: 50,
      status: "idea",
      startDate: today,
      goLiveDate: today,
    };
    setItems((prev) => [...prev, fresh]);
    setEditingId(id);
  };

  const update = (id: string, patch: Partial<ValueRealizationInitiative>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setEditingId(null);
  };

  const editing = items.find((i) => i.id === editingId) ?? null;

  const [explainerOpen, setExplainerOpen] = useState(false);

  const trace: AgentLogEntry[] = useMemo(() => {
    const live = items.filter((i) => i.status === "in-production" || i.status === "scaling").length;
    return [
      { agentId: "portfolio-watcher", line: lang === "ar" ? `يراقب ${items.length} مبادرة، ${live} منها في الإنتاج أو قيد التوسّع.` : `Watching ${items.length} initiatives; ${live} in production or scaling.` },
      { agentId: "uvr-scorer", line: lang === "ar" ? `معدّل تحقّق القيمة: ${totals.realizationRate.toFixed(0)}% (${(totals.realized / 1_000_000).toFixed(1)}م درهم محقّقة من ${(totals.expected / 1_000_000).toFixed(1)}م).` : `Unit value-realisation: ${totals.realizationRate.toFixed(0)}% (AED ${(totals.realized / 1_000_000).toFixed(1)}M realised vs AED ${(totals.expected / 1_000_000).toFixed(1)}M expected).` },
      { agentId: "leakage-detective", line: lang === "ar" ? `قيمة معرّضة (تسرّب): ${(totals.atRisk / 1_000_000).toFixed(1)}م درهم.` : `Value at risk (leakage): AED ${(totals.atRisk / 1_000_000).toFixed(1)}M across pre-production initiatives.` },
      { agentId: "cfo-narrator", line: lang === "ar" ? `صاغ السرد: عائد الاستثمار ${totals.roi >= 0 ? "+" : ""}${totals.roi.toFixed(0)}% بانتظار توقيع المدير المالي.` : `Drafted CFO narrative: ROI ${totals.roi >= 0 ? "+" : ""}${totals.roi.toFixed(0)}% — awaiting CFO sign-off.` },
    ];
  }, [items, totals, lang]);

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-14 sm:py-16 print:py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white mb-5 print:hidden"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
              style={{ backgroundColor: ACCENT }}
            >
              {tStr(COPY.eyebrow, lang)}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white text-[#0E2841]">
              {tStr(COPY.liveBadge, lang)}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight max-w-3xl mb-4">
            {tStr(COPY.title, lang)}
          </h1>
          <p className="text-base sm:text-lg text-gray-300 max-w-3xl leading-relaxed">
            {tStr(COPY.intro, lang)}
          </p>
        </div>
      </section>

      {/* Action bar */}
      <section className="bg-white border-b border-gray-100 py-4 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center gap-2 justify-between">
          <p className="text-xs text-gray-500 max-w-xl leading-relaxed">{tStr(COPY.note, lang)}</p>
          <div className="flex items-center gap-2 ms-auto">
            <button
              onClick={() => setExplainerOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
            >
              <Network size={14} /> {tStr({ en: "How does this work?", ar: "كيف يعمل هذا؟" }, lang)}
            </button>
            <button
              onClick={addNew}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-[#0E2841] text-[#0E2841] hover:bg-[#0E2841] hover:text-white transition-colors"
            >
              <Plus size={14} /> {tStr(COPY.add, lang)}
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
            >
              <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg bg-[#F5A623] text-white hover:bg-[#d4622a] transition-colors"
            >
              <Printer size={14} /> {tStr(COPY.print, lang)}
            </button>
          </div>
        </div>
      </section>

      {/* Top metrics */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 p-6 flex flex-col items-center text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
              {tStr(COPY.realization, lang)}
            </p>
            <Gauge
              score={Math.min(100, totals.realizationRate)}
              max={100}
              color={
                totals.realizationRate >= 80
                  ? GREEN
                  : totals.realizationRate >= 50
                  ? AMBER
                  : RED
              }
              label={fmtPct(totals.realizationRate)}
            />
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              {fmtMoney(totals.realized, lang)} / {fmtMoney(totals.expected, lang)}
            </p>
          </div>

          <div className="lg:col-span-4 grid grid-cols-1 gap-4">
            <MetricCard
              label={tStr(COPY.roi, lang)}
              value={fmtSignedPct(totals.roi)}
              accent={totals.roi >= 0 ? GREEN : RED}
              icon={<Sparkles size={16} />}
              note={`${fmtMoney(totals.realized - totals.invested, lang)} ${tStr(
                { en: "net of invested", ar: "صافي بعد الاستثمار" },
                lang,
              )}`}
            />
            <MetricCard
              label={tStr(COPY.invested, lang)}
              value={fmtMoney(totals.invested, lang)}
              accent={NAVY}
              icon={<TrendingUp size={16} />}
              note={`${items.length} ${tStr(COPY.initiatives, lang)}`}
            />
          </div>

          <div className="lg:col-span-4 grid grid-cols-1 gap-4">
            <MetricCard
              label={tStr(COPY.atRisk, lang)}
              value={fmtMoney(totals.atRisk, lang)}
              accent={RED}
              icon={<AlertTriangle size={16} />}
              note={`${items.filter((i) => i.status !== "in-production").length} ${tStr(
                { en: "not yet in production", ar: "لم تصل إلى الإنتاج بعد" },
                lang,
              )}`}
            />
            <MetricCard
              label={tStr(COPY.ttv, lang)}
              value={`${totals.ttv.toFixed(1)} ${tStr(COPY.months, lang)}`}
              accent={ACCENT}
              icon={<Clock size={16} />}
              note={tStr(
                {
                  en: "Across initiatives that have shipped.",
                  ar: "عبر المبادرات التي انطلقت.",
                },
                lang,
              )}
            />
          </div>
        </div>
      </section>

      {/* Realised vs expected over time */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            {tStr(COPY.trend, lang)}
          </p>
          <p className="text-xs text-gray-500 max-w-3xl mb-6 leading-relaxed">
            {tStr(COPY.trendNote, lang)}
          </p>
          <TrendChart points={trend.points} max={trend.max} lang={lang} />
        </div>
      </section>

      {/* Time-to-value distribution */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              {tStr(COPY.ttvDist, lang)}
            </p>
            <p className="text-3xl font-extrabold text-[#0E2841] mb-1">
              {totals.ttv.toFixed(1)} {tStr(COPY.months, lang)}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              {tStr(
                {
                  en: "Average across the portfolio. Each bar is the count of initiatives that fell into that band, kickoff → go-live.",
                  ar: "المتوسط عبر المحفظة. كل عمود هو عدد المبادرات في تلك الفئة، من الانطلاق إلى التشغيل.",
                },
                lang,
              )}
            </p>
          </div>
          <div className="lg:col-span-8">
            <div className="grid grid-cols-5 gap-3 items-end h-48">
              {ttvDistribution.buckets.map((b) => {
                const height = b.count > 0 ? (b.count / ttvDistribution.max) * 100 : 4;
                return (
                  <div key={b.id} className="flex flex-col items-center gap-2">
                    <div className="w-full bg-white border border-gray-100 rounded-t-xl flex items-end justify-center relative h-full">
                      <div
                        className="w-full rounded-t-xl"
                        style={{
                          height: `${height}%`,
                          background:
                            b.count > 0
                              ? `linear-gradient(180deg, ${AMBER}, ${NAVY})`
                              : "transparent",
                        }}
                      />
                      <span className="absolute top-2 text-[11px] font-extrabold text-[#0E2841]">
                        {b.count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-5 gap-3 mt-2">
              {ttvDistribution.buckets.map((b) => (
                <div key={b.id} className="text-center">
                  <p className="text-xs font-bold text-[#0E2841]">{tStr(b.label, lang)}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mt-2 text-center">
              {tStr(COPY.ttvAxis, lang)}
            </p>
          </div>
        </div>
      </section>

      {/* Initiative cards */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-5">
            {tStr(COPY.initiatives, lang)}
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">{tStr(COPY.empty, lang)}</p>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {items.map((i) => {
                const status = STATUSES.find((s) => s.id === i.status) ?? STATUSES[0];
                const type = TYPES.find((t) => t.id === i.type) ?? TYPES[0];
                const StatusIcon = status.icon;
                const TypeIcon = type.icon;
                const realizationPct =
                  i.expectedAnnualValue > 0
                    ? (i.realizedAnnualValue / i.expectedAnnualValue) * 100
                    : 0;
                return (
                  <motion.button
                    key={i.id}
                    layout
                    onClick={() => setEditingId(i.id)}
                    className="text-start bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-lg transition-all flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                          {tStr(i.businessUnit, lang)}
                        </p>
                        <h3 className="font-bold text-[#0E2841] leading-tight">
                          {tStr(i.name, lang)}
                        </h3>
                      </div>
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-white whitespace-nowrap inline-flex items-center gap-1"
                        style={{ backgroundColor: status.color }}
                      >
                        <StatusIcon size={10} />
                        {tStr(status.label, lang)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: type.color + "1A", color: type.color }}
                      >
                        <TypeIcon size={10} /> {tStr(type.label, lang)}
                      </span>
                      <span className="text-gray-400">
                        {tStr(COPY.goLive, lang)}: {i.goLiveDate}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Mini
                        label={tStr(COPY.expected, lang)}
                        value={fmtMoney(i.expectedAnnualValue, lang)}
                        color={NAVY}
                      />
                      <Mini
                        label={tStr(COPY.realized, lang)}
                        value={fmtMoney(i.realizedAnnualValue, lang)}
                        color={status.color}
                      />
                      <Mini
                        label={tStr(COPY.realization, lang)}
                        value={fmtPct(realizationPct)}
                        color={
                          realizationPct >= 80
                            ? GREEN
                            : realizationPct >= 50
                            ? AMBER
                            : RED
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span>
                        {tStr(COPY.invested, lang)}: {fmtMoney(i.investedToDate, lang)}
                      </span>
                      <span>
                        {tStr(COPY.confidence, lang)}: {Math.round(i.confidence)}%
                      </span>
                    </div>
                    <span className="text-xs font-bold text-[#156082] inline-flex items-center gap-1 mt-auto print:hidden">
                      {tStr(COPY.fullscreen, lang)}{" "}
                      <ArrowRight size={12} className="rtl:rotate-180" />
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 90-day pilot leakage */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 inline-flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-700" />
            {tStr(COPY.stalledTitle, lang)}
          </p>
          <p className="text-xs text-gray-500 max-w-3xl mb-5 leading-relaxed">
            {tStr(COPY.stalledNote, lang)}
          </p>
          {stalledPilots.length === 0 ? (
            <p className="text-sm text-gray-500">{tStr(COPY.noStalled, lang)}</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {stalledPilots.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-2xl border border-amber-200 p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                        {Math.round(s.daysInPilot)} {tStr(COPY.daysInPilot, lang)}
                      </p>
                      <h3 className="font-bold text-[#0E2841]">{tStr(s.initiative.name, lang)}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {tStr(s.initiative.businessUnit, lang)}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                      {tStr(COPY.atRisk, lang)}
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-extrabold text-[#B91C1C]">
                        {fmtMoney(s.valueAtRisk, lang)}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {tStr(COPY.kickoff, lang)}: {s.initiative.startDate} ·{" "}
                        {tStr(COPY.goLive, lang)}: {s.initiative.goLiveDate}
                        {s.futureGoLive && (
                          <>
                            {" "}
                            ·{" "}
                            <span className="text-amber-700 font-semibold">
                              {tStr(COPY.flagPlanned, lang)}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => setEditingId(s.id)}
                      className="text-xs font-bold uppercase tracking-widest text-[#156082] hover:text-[#0E2841] inline-flex items-center gap-1.5 print:hidden"
                    >
                      <Pencil size={12} />
                      {tStr(COPY.edit, lang)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="py-14 bg-gradient-to-br from-[#0E2841] to-[#156082] print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-3 gap-4">
          <Link
            href="/contact?topic=value-realization"
            className="p-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
              {tStr({ en: "Engage", ar: "ابدأ" }, lang)}
            </span>
            <span className="text-base font-bold text-white">{tStr(COPY.partner, lang)}</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#F5A623] mt-1">
              {tStr(COPY.partnerCta, lang)} <ArrowRight size={12} className="rtl:rotate-180" />
            </span>
          </Link>
          <Link
            href="/services/agentic-ai-transformation"
            className="p-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
              {tStr({ en: "Service", ar: "خدمة" }, lang)}
            </span>
            <span className="text-base font-bold text-white">{tStr(COPY.service, lang)}</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#F5A623] mt-1">
              {tStr(COPY.serviceCta, lang)} <ArrowRight size={12} className="rtl:rotate-180" />
            </span>
          </Link>
          <Link
            href="/assessments/uvr"
            className="p-5 bg-[#F5A623] hover:bg-[#d4622a] rounded-2xl transition-colors flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">
              {tStr({ en: "Diagnostic", ar: "تشخيص" }, lang)}
            </span>
            <span className="text-base font-bold text-white">{tStr(COPY.diagnostic, lang)}</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white mt-1">
              {tStr(COPY.diagnosticCta, lang)} <ArrowRight size={12} className="rtl:rotate-180" />
            </span>
          </Link>
        </div>
      </section>

      {/* Drawer */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 flex items-stretch justify-end print:hidden"
            onClick={() => setEditingId(null)}
          >
            <motion.div
              initial={{ x: dir === "rtl" ? "-100%" : "100%" }}
              animate={{ x: 0 }}
              exit={{ x: dir === "rtl" ? "-100%" : "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="w-full max-w-md bg-white h-full overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between z-10">
                <h3 className="font-bold text-[#0E2841]">{tStr(COPY.edit, lang)}</h3>
                <button
                  onClick={() => setEditingId(null)}
                  className="text-gray-400 hover:text-gray-700"
                  aria-label={tStr(COPY.close, lang)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <Field
                  label={tStr(COPY.initiative, lang)}
                  value={tStr(editing.name, lang)}
                  onChange={(v) =>
                    update(editing.id, {
                      name: lang === "ar" ? { ...editing.name, ar: v } : { ...editing.name, en: v },
                    })
                  }
                />
                <Field
                  label={tStr(COPY.businessUnit, lang)}
                  value={tStr(editing.businessUnit, lang)}
                  onChange={(v) =>
                    update(editing.id, {
                      businessUnit:
                        lang === "ar"
                          ? { ...editing.businessUnit, ar: v }
                          : { ...editing.businessUnit, en: v },
                    })
                  }
                />

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                    {tStr(COPY.type, lang)}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {TYPES.map((t) => {
                      const Icon = t.icon;
                      const active = editing.type === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => update(editing.id, { type: t.id })}
                          className={`text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors inline-flex items-center justify-center gap-1.5 ${
                            active
                              ? "text-white border-transparent"
                              : "border-gray-200 text-gray-600 hover:border-[#0E2841]"
                          }`}
                          style={active ? { backgroundColor: t.color } : undefined}
                        >
                          <Icon size={12} />
                          {tStr(t.label, lang)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                    {tStr(COPY.status, lang)}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {STATUSES.map((s) => {
                      const Icon = s.icon;
                      const active = editing.status === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => update(editing.id, { status: s.id })}
                          className={`text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border transition-colors inline-flex items-center justify-center gap-1.5 ${
                            active
                              ? "text-white border-transparent"
                              : "border-gray-200 text-gray-600 hover:border-[#0E2841]"
                          }`}
                          style={active ? { backgroundColor: s.color } : undefined}
                        >
                          <Icon size={12} />
                          {tStr(s.label, lang)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <NumberField
                  label={`${tStr(COPY.invested, lang)} (AED)`}
                  value={editing.investedToDate}
                  step={50_000}
                  min={0}
                  onChange={(v) => update(editing.id, { investedToDate: Math.max(0, v) })}
                />
                <NumberField
                  label={`${tStr(COPY.expected, lang)} (AED)`}
                  value={editing.expectedAnnualValue}
                  step={100_000}
                  min={0}
                  onChange={(v) => update(editing.id, { expectedAnnualValue: Math.max(0, v) })}
                />
                <NumberField
                  label={`${tStr(COPY.realized, lang)} (AED)`}
                  value={editing.realizedAnnualValue}
                  step={100_000}
                  min={0}
                  onChange={(v) => update(editing.id, { realizedAnnualValue: Math.max(0, v) })}
                />
                <NumberField
                  label={`${tStr(COPY.confidence, lang)} (%)`}
                  value={editing.confidence}
                  step={5}
                  min={0}
                  max={100}
                  onChange={(v) =>
                    update(editing.id, { confidence: clamp(v, 0, 100) })
                  }
                />
                <DateField
                  label={tStr(COPY.kickoff, lang)}
                  value={editing.startDate}
                  onChange={(v) => update(editing.id, { startDate: v })}
                />
                <DateField
                  label={tStr(COPY.goLive, lang)}
                  value={editing.goLiveDate}
                  onChange={(v) => update(editing.id, { goLiveDate: v })}
                />

                <div className="pt-3 flex items-center gap-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 bg-[#0E2841] text-white text-sm font-bold py-3 rounded-lg hover:bg-[#156082] transition-colors"
                  >
                    {tStr(COPY.save, lang)}
                  </button>
                  <button
                    onClick={() => remove(editing.id)}
                    className="text-xs font-bold uppercase tracking-widest text-red-700 hover:text-red-900 px-3 py-3"
                  >
                    {tStr(COPY.remove, lang)}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="py-12 bg-white border-t border-gray-100 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="value-realization" log={trace} accent={ACCENT} />
        </div>
      </section>

      <AgentExplainer
        slug="value-realization"
        open={explainerOpen}
        onClose={() => setExplainerOpen(false)}
      />
    </div>
  );
}

// ---------- subcomponents ----------

function MetricCard({
  label,
  value,
  accent,
  icon,
  note,
}: {
  label: string;
  value: string;
  accent: string;
  icon: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: accent + "1A", color: accent }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          {label}
        </p>
        <p className="text-2xl font-extrabold" style={{ color: accent }}>
          {value}
        </p>
        {note && <p className="text-[11px] text-gray-500 mt-1">{note}</p>}
      </div>
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 leading-tight">
        {label}
      </p>
      <p className="text-sm font-extrabold mt-0.5" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-[#0E2841]"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
        {label}
      </label>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-[#0E2841]"
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-[#0E2841]"
      />
    </div>
  );
}

function TrendChart({
  points,
  max,
  lang,
}: {
  points: Array<{ label: string; expected: number; realized: number }>;
  max: number;
  lang: "en" | "ar";
}) {
  const W = 800;
  const H = 240;
  const PAD_X = 40;
  const PAD_Y = 24;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const x = (idx: number) =>
    points.length === 1 ? PAD_X + innerW / 2 : PAD_X + (idx / (points.length - 1)) * innerW;
  const y = (v: number) => PAD_Y + innerH - (v / max) * innerH;

  const pathFor = (key: "expected" | "realized") =>
    points
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${x(idx).toFixed(1)} ${y(p[key]).toFixed(1)}`)
      .join(" ");

  const areaFor = (key: "expected" | "realized") => {
    if (points.length === 0) return "";
    const top = pathFor(key);
    return `${top} L ${x(points.length - 1).toFixed(1)} ${(PAD_Y + innerH).toFixed(1)} L ${x(0).toFixed(
      1,
    )} ${(PAD_Y + innerH).toFixed(1)} Z`;
  };

  const last = points[points.length - 1];

  return (
    <div className="bg-[#F8F9FA] rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center gap-4 mb-3 text-xs">
        <Legend color={NAVY} label={tStr({ en: "Expected", ar: "المتوقّع" }, lang)} />
        <Legend color={AMBER} label={tStr({ en: "Realised", ar: "المحقّق" }, lang)} />
        {last && (
          <span className="ms-auto text-gray-500">
            {tStr({ en: "Latest realised:", ar: "أحدث محقق:" }, lang)}{" "}
            <span className="font-extrabold text-[#0E2841]">{fmtMoney(last.realized, lang)}</span>
            {" / "}
            <span className="font-semibold">{fmtMoney(last.expected, lang)}</span>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="trend">
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={PAD_Y + innerH}
          y2={PAD_Y + innerH}
          stroke="#E5E7EB"
        />
        <path d={areaFor("expected")} fill={NAVY + "14"} />
        <path d={pathFor("expected")} stroke={NAVY} strokeWidth={2} fill="none" />
        <path d={areaFor("realized")} fill={AMBER + "26"} />
        <path d={pathFor("realized")} stroke={AMBER} strokeWidth={2.5} fill="none" />
        {points.map((p, idx) => (
          <circle key={idx} cx={x(idx)} cy={y(p.realized)} r={3} fill={AMBER} />
        ))}
      </svg>
      <div className="grid grid-cols-12 mt-1 text-[10px] uppercase tracking-widest font-bold text-gray-400">
        {points.map((p, idx) =>
          idx % 2 === 0 ? (
            <span key={idx} className="col-span-2 text-center">
              {p.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      <span className="font-semibold text-[#0E2841]">{label}</span>
    </span>
  );
}
