import { useMemo, useState } from "react";
import { Battery, RotateCcw, BatteryWarning, AlertTriangle } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

interface Vehicle {
  id: string;
  fleet: string;
  city: string;
  model: string;
  ageMonths: number;
  cyclesPerWeek: number;
  fastChargePct: number; // 0..100
  ambientStress: number; // 0..1
  baselineSoH: number;
}

const FLEETS: Vehicle[] = [
  { id: "v1", fleet: "Riyadh Hailing", city: "Riyadh", model: "RX-5 sedan", ageMonths: 22, cyclesPerWeek: 24, fastChargePct: 60, ambientStress: 0.85, baselineSoH: 92 },
  { id: "v2", fleet: "Riyadh Hailing", city: "Riyadh", model: "RX-5 sedan", ageMonths: 14, cyclesPerWeek: 26, fastChargePct: 70, ambientStress: 0.85, baselineSoH: 95 },
  { id: "v3", fleet: "Dubai Logistics", city: "Dubai", model: "Van-220", ageMonths: 30, cyclesPerWeek: 18, fastChargePct: 40, ambientStress: 0.9, baselineSoH: 87 },
  { id: "v4", fleet: "Dubai Logistics", city: "Dubai", model: "Van-220", ageMonths: 8, cyclesPerWeek: 22, fastChargePct: 30, ambientStress: 0.9, baselineSoH: 97 },
  { id: "v5", fleet: "Doha Public Bus", city: "Doha", model: "Bus-12m", ageMonths: 36, cyclesPerWeek: 14, fastChargePct: 25, ambientStress: 0.95, baselineSoH: 84 },
  { id: "v6", fleet: "Doha Public Bus", city: "Doha", model: "Bus-12m", ageMonths: 20, cyclesPerWeek: 16, fastChargePct: 20, ambientStress: 0.95, baselineSoH: 91 },
  { id: "v7", fleet: "Kuwait Last-mile", city: "Kuwait City", model: "Mini-cargo", ageMonths: 12, cyclesPerWeek: 30, fastChargePct: 80, ambientStress: 0.92, baselineSoH: 93 },
  { id: "v8", fleet: "Kuwait Last-mile", city: "Kuwait City", model: "Mini-cargo", ageMonths: 26, cyclesPerWeek: 32, fastChargePct: 85, ambientStress: 0.92, baselineSoH: 86 },
];

interface Levers {
  cycleAdj: number; // -10..+10 cycles
  fastChargeAdj: number; // -50..+50 pp
  coolingMod: number; // -20..+20 (% effectiveness)
}

const INIT: Levers = { cycleAdj: 0, fastChargeAdj: 0, coolingMod: 0 };

const COPY = {
  eyebrow: { en: "EV Battery Health Agent", ar: "وكيل صحة بطاريات السيارات الكهربائية" },
  title: {
    en: "Predict-then-protect — every battery, every fleet, every week.",
    ar: "تنبّأ ثم احمِ — كل بطارية، كل أسطول، كل أسبوع.",
  },
  intro: {
    en: "Move the duty-cycle, fast-charge mix, and thermal-cooling levers. The State-of-Health forecast and the at-risk count update for the whole fleet — and the work order draft regenerates.",
    ar: "حرّك أشرطة دورة التشغيل ونسبة الشحن السريع والتبريد. يتغيّر تنبؤ صحة البطارية وعدد المركبات المعرّضة، وتُعاد كتابة مسوّدة أمر العمل.",
  },
  reset: { en: "Reset operating profile", ar: "إعادة الملف التشغيلي" },
  fleetMap: { en: "Fleet health map", ar: "خريطة صحة الأسطول" },
  levers: { en: "Operating levers", ar: "أشرطة التشغيل" },
  cycle: { en: "Duty cycle (Δ cycles/wk)", ar: "دورة التشغيل" },
  fast: { en: "Fast-charge mix (Δ pp)", ar: "خلط الشحن السريع" },
  cool: { en: "Thermal cooling effectiveness (Δ%)", ar: "فعالية التبريد" },
  soh: { en: "State of Health", ar: "صحة البطارية" },
  atRisk: { en: "At-risk vehicles (SoH < 85%)", ar: "مركبات معرّضة (أقل من 85%)" },
  avg: { en: "Avg fleet SoH", ar: "متوسط الأسطول" },
  workOrder: { en: "Work order draft", ar: "مسوّدة أمر العمل" },
  woNote: {
    en: "Generated for any vehicle below 85% SoH. The fleet manager prioritises and signs — the agent does not dispatch.",
    ar: "تُنشأ لكل مركبة دون 85%. يحدّد مدير الأسطول الأولوية ويوقّع — الوكيل لا يرسل الفنّيين.",
  },
  noWO: { en: "No vehicles currently below the 85% threshold.", ar: "لا توجد مركبات حالياً دون عتبة 85%." },
  vehicle: { en: "Vehicle", ar: "مركبة" },
  fleet: { en: "Fleet", ar: "الأسطول" },
  city: { en: "City", ar: "المدينة" },
  age: { en: "Age", ar: "العمر" },
  months: { en: "mo", ar: "شهر" },
  recommend: { en: "Recommended action", ar: "الإجراء الموصى به" },
};

function projectSoH(v: Vehicle, l: Levers): number {
  const cycles = Math.max(1, v.cyclesPerWeek + l.cycleAdj);
  const fast = Math.max(0, Math.min(100, v.fastChargePct + l.fastChargeAdj));
  const ambient = Math.max(0.5, v.ambientStress - l.coolingMod / 100);
  // Empirical-ish degradation model (illustrative):
  const degradation =
    0.06 * cycles * ambient + // cycle stress
    0.03 * (fast / 100) * cycles + // fast charge contribution
    0.4 * (ambient - 0.7); // baseline thermal stress
  const projected = v.baselineSoH - degradation;
  return Math.max(40, Math.min(100, projected));
}

export default function EvBatteryHealthDemo() {
  const { lang } = useLang();
  const [levers, setLevers] = useState<Levers>({ ...INIT });

  const reset = () => setLevers({ ...INIT });

  const fleet = useMemo(() => {
    return FLEETS.map((v) => ({ ...v, soh: projectSoH(v, levers) }));
  }, [levers]);

  const summary = useMemo(() => {
    const atRisk = fleet.filter((v) => v.soh < 85);
    const avg = fleet.reduce((s, v) => s + v.soh, 0) / fleet.length;
    const lowest = [...fleet].sort((a, b) => a.soh - b.soh)[0];
    return { atRiskCount: atRisk.length, avg, lowest };
  }, [fleet]);

  const workOrders = fleet.filter((v) => v.soh < 85).sort((a, b) => a.soh - b.soh);

  return (
    <DemoShell
      slug="ev-battery-health-agent"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#196B24"
      Icon={Battery}
      note={COPY.woNote}
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-3 gap-4">
          <Tile label={tStr(COPY.avg, lang)} value={`${summary.avg.toFixed(1)}%`} color="#196B24" />
          <Tile
            label={tStr(COPY.atRisk, lang)}
            value={`${summary.atRiskCount} / ${fleet.length}`}
            color={summary.atRiskCount > 0 ? "#B91C1C" : "#196B24"}
            icon={summary.atRiskCount > 0 ? <BatteryWarning size={16} /> : undefined}
          />
          <Tile
            label={tStr({ en: "Lowest SoH", ar: "أدنى صحة" }, lang)}
            value={`${summary.lowest.id.toUpperCase()} · ${summary.lowest.soh.toFixed(1)}%`}
            color="#0E2841"
            icon={<AlertTriangle size={16} />}
          />
        </div>
      </section>

      {/* Levers */}
      <section className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.levers, lang)}
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <LeverCard
              label={tStr(COPY.cycle, lang)}
              value={levers.cycleAdj}
              suffix=""
              min={-10}
              max={10}
              step={1}
              color="#0E2841"
              onChange={(v) => setLevers((l) => ({ ...l, cycleAdj: v }))}
            />
            <LeverCard
              label={tStr(COPY.fast, lang)}
              value={levers.fastChargeAdj}
              suffix=" pp"
              min={-50}
              max={50}
              step={5}
              color="#B91C1C"
              onChange={(v) => setLevers((l) => ({ ...l, fastChargeAdj: v }))}
            />
            <LeverCard
              label={tStr(COPY.cool, lang)}
              value={levers.coolingMod}
              suffix="%"
              min={-20}
              max={20}
              step={1}
              color="#0F9ED5"
              onChange={(v) => setLevers((l) => ({ ...l, coolingMod: v }))}
            />
          </div>
        </div>
      </section>

      {/* Fleet map */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.fleetMap, lang)}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[#0E2841] text-white text-[10px] uppercase tracking-widest font-bold">
              <span className="col-span-2">{tStr(COPY.vehicle, lang)}</span>
              <span className="col-span-2">{tStr(COPY.fleet, lang)}</span>
              <span className="col-span-1">{tStr(COPY.city, lang)}</span>
              <span className="col-span-2">{tStr({ en: "Model", ar: "الطراز" }, lang)}</span>
              <span className="col-span-1">{tStr(COPY.age, lang)}</span>
              <span className="col-span-4">{tStr(COPY.soh, lang)}</span>
            </div>
            {fleet
              .slice()
              .sort((a, b) => a.soh - b.soh)
              .map((v) => (
                <div
                  key={v.id}
                  className="grid grid-cols-12 px-4 py-3 border-t border-gray-100 items-center text-xs text-gray-700"
                >
                  <span className="col-span-2 font-bold text-[#0E2841]">{v.id.toUpperCase()}</span>
                  <span className="col-span-2">{v.fleet}</span>
                  <span className="col-span-1">{v.city}</span>
                  <span className="col-span-2">{v.model}</span>
                  <span className="col-span-1">
                    {v.ageMonths} {tStr(COPY.months, lang)}
                  </span>
                  <span className="col-span-4 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${v.soh}%`,
                          background: v.soh < 85 ? "#B91C1C" : v.soh < 92 ? "#F5A623" : "#196B24",
                        }}
                      />
                    </div>
                    <span
                      className="font-bold w-12 text-end"
                      style={{
                        color: v.soh < 85 ? "#B91C1C" : v.soh < 92 ? "#F5A623" : "#196B24",
                      }}
                    >
                      {v.soh.toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* Work orders */}
      <section className="py-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.workOrder, lang)}
          </p>
          {workOrders.length === 0 ? (
            <p className="text-sm text-gray-500 italic">{tStr(COPY.noWO, lang)}</p>
          ) : (
            <div className="space-y-3">
              {workOrders.map((v) => (
                <div
                  key={v.id}
                  className="bg-white rounded-2xl border border-gray-100 p-5 grid sm:grid-cols-12 gap-4 items-center"
                >
                  <div className="sm:col-span-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {v.fleet} · {v.city}
                    </p>
                    <p className="font-extrabold text-[#0E2841]">{v.id.toUpperCase()}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {tStr(COPY.soh, lang)}
                    </p>
                    <p className="text-lg font-bold" style={{ color: "#B91C1C" }}>
                      {v.soh.toFixed(1)}%
                    </p>
                  </div>
                  <div className="sm:col-span-7">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-1">
                      {tStr(COPY.recommend, lang)}
                    </p>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {tStr(
                        v.fastChargePct + levers.fastChargeAdj > 60
                          ? {
                              en: "Throttle DC fast-charge cap to 0.5C until next service; schedule cell-balancing pass within 7 days.",
                              ar: "خفّض سقف الشحن السريع إلى 0.5C حتى الصيانة القادمة؛ جدوِل موازنة الخلايا خلال 7 أيام.",
                            }
                          : v.ageMonths > 24
                            ? {
                                en: "Schedule pack inspection within 14 days; consider rotation to lower-duty route.",
                                ar: "جدوِل فحص الحزمة خلال 14 يوماً؛ ادرس التحويل إلى مسار أقل حدّة.",
                              }
                            : {
                                en: "Increase coolant flow setpoint by 5%; re-evaluate after 7 days.",
                                ar: "ارفع نقطة ضبط تدفّق المبرّد 5%؛ أعِد التقييم بعد 7 أيام.",
                              },
                        lang,
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </DemoShell>
  );
}

function LeverCard({
  label,
  value,
  suffix,
  min,
  max,
  step,
  color,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: color }}
      />
      <p className="text-base font-bold mt-1" style={{ color }}>
        {value > 0 ? "+" : ""}
        {value}
        {suffix}
      </p>
    </div>
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
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
        {icon ? <span style={{ color }}>{icon}</span> : null}
        <span className="font-bold uppercase tracking-widest text-[10px]">{label}</span>
      </div>
      <p className="text-2xl font-extrabold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
