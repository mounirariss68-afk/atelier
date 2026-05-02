import { useMemo, useState } from "react";
import { LineChart, RotateCcw, FileText } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

interface Driver {
  id: string;
  label: { en: string; ar: string };
  unit: string;
  baseline: number;
  value: number;
  min: number;
  max: number;
  step: number;
}

const INIT: Driver[] = [
  { id: "rev_growth", label: { en: "Revenue growth (FY)", ar: "نمو الإيرادات السنوي" }, unit: "%", baseline: 8, value: 8, min: -5, max: 25, step: 0.5 },
  { id: "gross_margin", label: { en: "Gross margin", ar: "الهامش الإجمالي" }, unit: "%", baseline: 42, value: 42, min: 25, max: 60, step: 0.5 },
  { id: "opex_inflation", label: { en: "Opex inflation", ar: "تضخّم النفقات التشغيلية" }, unit: "%", baseline: 4, value: 4, min: 0, max: 12, step: 0.25 },
  { id: "fx_aedusd", label: { en: "FX impact (USD basket)", ar: "أثر العملة (سلة الدولار)" }, unit: "%", baseline: 0, value: 0, min: -8, max: 8, step: 0.5 },
  { id: "capex", label: { en: "Capex envelope", ar: "غطاء الإنفاق الرأسمالي" }, unit: "M AED", baseline: 240, value: 240, min: 100, max: 600, step: 10 },
];

const BASE_REV_M = 1820; // M AED
const BASE_OPEX_M = 760;

const COPY = {
  eyebrow: { en: "FP&A Rolling Forecast Agent", ar: "وكيل تنبؤ FP&A المتجدد" },
  title: {
    en: "Move a driver, watch the forecast cone, the variance commentary, and the board flags re-render.",
    ar: "حرّك محرّكاً وراقب تحديث المخروط وتعليقات الفروق وأعلام مجلس الإدارة فوراً.",
  },
  intro: {
    en: "Adjust the five driver levers below. The 12-month rolling forecast cone shifts in real time, the agent rewrites the variance commentary, and the board pack flags update.",
    ar: "عدّل المحرّكات الخمسة أدناه. ينحاز مخروط التنبؤ المتجدد لـ12 شهراً فوراً، ويُعيد الوكيل صياغة تعليق الفروق، وتُحدَّث أعلام عبوة المجلس.",
  },
  reset: { en: "Reset to AOP", ar: "إعادة إلى الخطة السنوية" },
  drivers: { en: "Driver assumptions", ar: "افتراضات المحرّكات" },
  forecast: { en: "12-month rolling forecast", ar: "تنبؤ متجدد 12 شهراً" },
  rev: { en: "Revenue", ar: "الإيرادات" },
  ebitda: { en: "EBITDA", ar: "EBITDA" },
  variance: { en: "Variance vs AOP", ar: "الانحراف عن AOP" },
  margin: { en: "EBITDA margin", ar: "هامش EBITDA" },
  commentary: { en: "Variance commentary draft", ar: "مسوّدة تعليق الانحراف" },
  flags: { en: "Board pack flags", ar: "أعلام عبوة المجلس" },
  baseline: { en: "AOP", ar: "AOP" },
  current: { en: "Current view", ar: "العرض الحالي" },
  delta: { en: "Δ", ar: "Δ" },
  flagOk: { en: "On track", ar: "ضمن المسار" },
  flagWarn: { en: "Watch", ar: "للمتابعة" },
  flagRisk: { en: "At risk", ar: "في خطر" },
  noFlags: { en: "No flags raised at current driver settings.", ar: "لا أعلام مع الإعدادات الحالية." },
  hilNote: {
    en: "The agent drafts. The CFO signs. Numbers are illustrative — sized to a mid-cap GCC group's scale.",
    ar: "يصوغ الوكيل. يوقّع المدير المالي. الأرقام توضيحية بحجم مجموعة خليجية متوسطة.",
  },
};

function fmtM(v: number, lang: "en" | "ar"): string {
  return lang === "ar" ? `${v.toFixed(0)} مليون` : `AED ${v.toFixed(0)}M`;
}

export default function FpaRollingForecastDemo() {
  const { lang } = useLang();
  const [drivers, setDrivers] = useState<Driver[]>(() => INIT.map((d) => ({ ...d })));

  const reset = () => setDrivers(INIT.map((d) => ({ ...d })));
  const setDriver = (id: string, value: number) =>
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, value } : d)));

  const view = useMemo(() => {
    const get = (id: string) => drivers.find((d) => d.id === id)!.value;
    const baseGet = (id: string) => drivers.find((d) => d.id === id)!.baseline;

    const newRev = BASE_REV_M * (1 + get("rev_growth") / 100) * (1 + get("fx_aedusd") / 100);
    const baseRev = BASE_REV_M * (1 + baseGet("rev_growth") / 100);

    const newGm = newRev * (get("gross_margin") / 100);
    const baseGm = baseRev * (baseGet("gross_margin") / 100);

    const newOpex = BASE_OPEX_M * (1 + get("opex_inflation") / 100);
    const baseOpex = BASE_OPEX_M * (1 + baseGet("opex_inflation") / 100);

    const newEbitda = newGm - newOpex;
    const baseEbitda = baseGm - baseOpex;

    const newMargin = (newEbitda / newRev) * 100;
    const baseMargin = (baseEbitda / baseRev) * 100;

    return {
      newRev,
      newEbitda,
      newMargin,
      baseRev,
      baseEbitda,
      baseMargin,
      revVar: ((newRev - baseRev) / baseRev) * 100,
      ebitdaVar: ((newEbitda - baseEbitda) / baseEbitda) * 100,
    };
  }, [drivers]);

  const flags = useMemo(() => {
    const out: { tone: "ok" | "warn" | "risk"; text: { en: string; ar: string } }[] = [];
    if (view.revVar < -3)
      out.push({
        tone: "risk",
        text: {
          en: `Revenue ${view.revVar.toFixed(1)}% behind AOP — flag for board.`,
          ar: `الإيرادات متأخرة ${Math.abs(view.revVar).toFixed(1)}% عن AOP — علم للمجلس.`,
        },
      });
    if (view.ebitdaVar < -5)
      out.push({
        tone: "risk",
        text: {
          en: `EBITDA ${view.ebitdaVar.toFixed(1)}% below AOP — escalate cost actions.`,
          ar: `EBITDA دون AOP بـ ${Math.abs(view.ebitdaVar).toFixed(1)}% — تصعيد إجراءات التكاليف.`,
        },
      });
    if (view.newMargin < view.baseMargin - 1)
      out.push({
        tone: "warn",
        text: {
          en: `Margin compression of ${(view.baseMargin - view.newMargin).toFixed(1)} pts — re-test pricing levers.`,
          ar: `ضغط الهامش ${(view.baseMargin - view.newMargin).toFixed(1)} نقطة — أعد اختبار التسعير.`,
        },
      });
    const capex = drivers.find((d) => d.id === "capex")!;
    if (capex.value > capex.baseline * 1.2)
      out.push({
        tone: "warn",
        text: {
          en: `Capex now ${(((capex.value - capex.baseline) / capex.baseline) * 100).toFixed(0)}% above plan — finance cover required.`,
          ar: `الإنفاق الرأسمالي يفوق الخطة ${(((capex.value - capex.baseline) / capex.baseline) * 100).toFixed(0)}% — تغطية تمويلية مطلوبة.`,
        },
      });
    return out;
  }, [view, drivers]);

  const cone = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = 1 + 0.06 * Math.sin((m / 12) * Math.PI * 2);
      out.push((view.newRev / 12) * seasonal);
    }
    return out;
  }, [view]);

  const baselineCone = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = 1 + 0.06 * Math.sin((m / 12) * Math.PI * 2);
      out.push((view.baseRev / 12) * seasonal);
    }
    return out;
  }, [view]);

  return (
    <DemoShell
      slug="fpa-rolling-forecast"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#156082"
      Icon={LineChart}
      note={COPY.hilNote}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Top tiles */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-4 gap-4">
          <Tile
            label={tStr(COPY.rev, lang)}
            value={fmtM(view.newRev, lang)}
            sub={`${view.revVar > 0 ? "+" : ""}${view.revVar.toFixed(1)}% vs AOP`}
            subColor={view.revVar >= 0 ? "#196B24" : "#B91C1C"}
            color="#0E2841"
          />
          <Tile
            label={tStr(COPY.ebitda, lang)}
            value={fmtM(view.newEbitda, lang)}
            sub={`${view.ebitdaVar > 0 ? "+" : ""}${view.ebitdaVar.toFixed(1)}% vs AOP`}
            subColor={view.ebitdaVar >= 0 ? "#196B24" : "#B91C1C"}
            color="#156082"
          />
          <Tile
            label={tStr(COPY.margin, lang)}
            value={`${view.newMargin.toFixed(1)}%`}
            sub={`AOP ${view.baseMargin.toFixed(1)}%`}
            color="#196B24"
          />
          <Tile
            label={tStr({ en: "Board flags", ar: "أعلام المجلس" }, lang)}
            value={String(flags.length)}
            sub={flags.length === 0 ? tStr({ en: "Clean", ar: "نظيف" }, lang) : tStr({ en: "Action needed", ar: "إجراء مطلوب" }, lang)}
            subColor={flags.length === 0 ? "#196B24" : "#F5A623"}
            color={flags.length === 0 ? "#196B24" : "#B91C1C"}
          />
        </div>
      </section>

      {/* Drivers */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.drivers, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {drivers.map((d) => (
              <div key={d.id} className="bg-white rounded-2xl border border-gray-100 p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  {tStr(d.label, lang)}
                </p>
                <input
                  type="range"
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={d.value}
                  onChange={(e) => setDriver(d.id, Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#156082" }}
                />
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-lg font-extrabold text-[#0E2841]">
                    {d.value}
                    {d.unit}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {tStr(COPY.baseline, lang)} {d.baseline}
                    {d.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Forecast cone */}
      <section className="py-10 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.forecast, lang)}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <ForecastCone view={cone} baseline={baselineCone} />
            <div className="flex items-center gap-4 mt-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-0.5 bg-[#156082]" /> {tStr(COPY.current, lang)}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-gray-400" />{" "}
                {tStr(COPY.baseline, lang)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Commentary + Flags */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 inline-flex items-center gap-2">
              <FileText size={14} /> {tStr(COPY.commentary, lang)}
            </p>
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-700 leading-relaxed">
              <p className="font-extrabold text-[#0E2841] mb-2">
                {tStr(
                  {
                    en: `Forecast view: revenue ${fmtM(view.newRev, lang)} (${view.revVar > 0 ? "+" : ""}${view.revVar.toFixed(1)}% vs AOP)`,
                    ar: `العرض: الإيرادات ${fmtM(view.newRev, lang)} (${view.revVar > 0 ? "+" : ""}${view.revVar.toFixed(1)}% مقابل AOP)`,
                  },
                  lang,
                )}
              </p>
              <p>
                {tStr(
                  {
                    en: `EBITDA ${fmtM(view.newEbitda, lang)} (${view.ebitdaVar > 0 ? "+" : ""}${view.ebitdaVar.toFixed(1)}% vs AOP) at a ${view.newMargin.toFixed(1)}% margin. Drivers reflect updated growth, FX, and inflation assumptions; capex envelope tracking the latest investment council position. Sensitivity is concentrated in opex inflation and gross margin — a 1pt move on either materially alters the EBITDA path.`,
                    ar: `EBITDA ${fmtM(view.newEbitda, lang)} (${view.ebitdaVar > 0 ? "+" : ""}${view.ebitdaVar.toFixed(1)}% مقابل AOP) بهامش ${view.newMargin.toFixed(1)}%. تعكس المحرّكات تحديثات النمو والعملة والتضخّم؛ غطاء الإنفاق يتبع موقف مجلس الاستثمار الأخير. الحساسيات في تضخّم النفقات والهامش الإجمالي — تحرّك بنقطة واحدة يبدّل المسار جوهرياً.`,
                  },
                  lang,
                )}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
              {tStr(COPY.flags, lang)}
            </p>
            {flags.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-500 italic">
                {tStr(COPY.noFlags, lang)}
              </div>
            ) : (
              <div className="space-y-2">
                {flags.map((f, i) => {
                  const color = f.tone === "risk" ? "#B91C1C" : f.tone === "warn" ? "#F5A623" : "#196B24";
                  const label = f.tone === "risk" ? tStr(COPY.flagRisk, lang) : f.tone === "warn" ? tStr(COPY.flagWarn, lang) : tStr(COPY.flagOk, lang);
                  return (
                    <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3">
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white mt-0.5"
                        style={{ backgroundColor: color }}
                      >
                        {label}
                      </span>
                      <p className="text-sm text-gray-700 leading-relaxed flex-1">{tStr(f.text, lang)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </DemoShell>
  );
}

function ForecastCone({ view, baseline }: { view: number[]; baseline: number[] }) {
  const W = 720;
  const H = 180;
  const PAD = 12;
  const max = Math.max(...view, ...baseline) * 1.15;
  const x = (i: number) => PAD + (i / (view.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - v / max) * (H - PAD * 2);

  const central = view.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const upper = view.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p * 1.12).toFixed(1)}`).join(" ");
  const lower = view
    .map((p, i) => `${i === view.length - 1 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p * 0.88).toFixed(1)}`)
    .reverse()
    .join(" ");
  const fill = `${upper} ${lower} Z`;
  const baselinePath = baseline.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="forecast cone">
      <path d={fill} fill="#156082" opacity={0.12} />
      <path d={baselinePath} stroke="#94A3B8" strokeWidth={1.5} fill="none" strokeDasharray="6 4" />
      <path d={central} stroke="#156082" strokeWidth={2.5} fill="none" />
    </svg>
  );
}

function Tile({
  label,
  value,
  sub,
  color,
  subColor,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  subColor?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      <p className="text-2xl font-extrabold leading-tight" style={{ color }}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] font-bold mt-1" style={{ color: subColor ?? "#475569" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
