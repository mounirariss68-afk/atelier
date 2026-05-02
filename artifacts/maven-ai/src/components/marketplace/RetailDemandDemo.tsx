import { useMemo, useState } from "react";
import { BarChart3, RotateCcw } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

interface Sku {
  id: string;
  name: { en: string; ar: string };
  category: { en: string; ar: string };
  baseWeekly: number;
  ramadanLift: number; // multiplier for Ramadan
  schoolLift: number;
  summerLift: number;
  promoLift: number; // applied during promo windows
  onHand: number;
}

const SKUS: Sku[] = [
  {
    id: "sku-dates",
    name: { en: "Premium Saudi dates 1kg", ar: "تمر سعودي ممتاز 1 كغ" },
    category: { en: "Grocery", ar: "بقالة" },
    baseWeekly: 4200,
    ramadanLift: 3.4,
    schoolLift: 1.0,
    summerLift: 0.7,
    promoLift: 1.6,
    onHand: 14000,
  },
  {
    id: "sku-water",
    name: { en: "5L water bundle (4-pack)", ar: "حزمة مياه 5 لتر (4 قطع)" },
    category: { en: "Beverages", ar: "مشروبات" },
    baseWeekly: 9800,
    ramadanLift: 1.6,
    schoolLift: 1.1,
    summerLift: 1.9,
    promoLift: 1.3,
    onHand: 21000,
  },
  {
    id: "sku-stationery",
    name: { en: "Back-to-school stationery kit", ar: "حقيبة قرطاسية مدرسية" },
    category: { en: "Seasonal", ar: "موسمي" },
    baseWeekly: 1200,
    ramadanLift: 0.8,
    schoolLift: 4.5,
    summerLift: 0.4,
    promoLift: 1.4,
    onHand: 3500,
  },
  {
    id: "sku-icecream",
    name: { en: "Family ice-cream tub 1L", ar: "مثلجات عائلية 1 لتر" },
    category: { en: "Frozen", ar: "مجمّدات" },
    baseWeekly: 3300,
    ramadanLift: 1.3,
    schoolLift: 1.0,
    summerLift: 2.6,
    promoLift: 1.5,
    onHand: 6200,
  },
  {
    id: "sku-tea",
    name: { en: "Karak tea blend 500g", ar: "خلطة شاي كرك 500غ" },
    category: { en: "Grocery", ar: "بقالة" },
    baseWeekly: 2800,
    ramadanLift: 2.1,
    schoolLift: 1.0,
    summerLift: 0.9,
    promoLift: 1.4,
    onHand: 5900,
  },
];

const COPY = {
  eyebrow: { en: "Retail Demand Forecaster", ar: "متنبّئ طلب التجزئة" },
  title: {
    en: "GCC seasonality, modeled — Ramadan, schools, summer.",
    ar: "موسمية الخليج بنموذج — رمضان، المدارس، الصيف.",
  },
  intro: {
    en: "Toggle the seasonal overlays and the promo cadence. Each SKU's 26-week forecast cone, allocation suggestion, and projected stock-out date re-render instantly.",
    ar: "بدّل طبقات الموسمية وإيقاع العروض. يُعاد رسم مخروط 26 أسبوعاً واقتراح التخصيص وتاريخ نفاد المخزون لكل صنف فوراً.",
  },
  reset: { en: "Reset overlays", ar: "إعادة الطبقات" },
  overlays: { en: "Seasonal overlays", ar: "طبقات الموسمية" },
  ramadan: { en: "Ramadan", ar: "رمضان" },
  schools: { en: "School return", ar: "عودة المدارس" },
  summer: { en: "Summer exodus", ar: "نزوح الصيف" },
  promo: { en: "Promo window", ar: "نافذة العرض" },
  promoSetting: { en: "Promo aggressiveness", ar: "حدّة العرض" },
  forecast: { en: "26-week forecast", ar: "تنبؤ 26 أسبوعاً" },
  alloc: { en: "Allocation per cluster", ar: "التخصيص لكل تجمّع" },
  stockout: { en: "Projected stock-out", ar: "نفاد المخزون المتوقّع" },
  weeks: { en: "wks", ar: "أسبوع" },
  units: { en: "units / wk", ar: "وحدة / أسبوع" },
  promoLift: { en: "Promo lift", ar: "رفع العروض" },
  margin: { en: "Margin impact", ar: "أثر الهامش" },
  baseWeekly: { en: "Base weekly", ar: "أساس أسبوعي" },
  cluster: { en: "Cluster", ar: "تجمّع" },
};

const CLUSTERS = [
  { id: "ruh", name: { en: "Riyadh", ar: "الرياض" }, weight: 0.36 },
  { id: "jed", name: { en: "Jeddah", ar: "جدة" }, weight: 0.22 },
  { id: "dxb", name: { en: "Dubai", ar: "دبي" }, weight: 0.28 },
  { id: "dmm", name: { en: "Dammam", ar: "الدمام" }, weight: 0.14 },
];

interface Overlay {
  ramadan: boolean;
  schools: boolean;
  summer: boolean;
  promo: number; // 0-1
}

const INIT: Overlay = { ramadan: true, schools: false, summer: false, promo: 0.5 };

export default function RetailDemandDemo() {
  const { lang } = useLang();
  const [overlay, setOverlay] = useState<Overlay>({ ...INIT });

  const reset = () => setOverlay({ ...INIT });

  const liftFor = (s: Sku): number => {
    let mult = 1;
    if (overlay.ramadan) mult *= s.ramadanLift;
    if (overlay.schools) mult *= s.schoolLift;
    if (overlay.summer) mult *= s.summerLift;
    mult *= 1 + overlay.promo * (s.promoLift - 1);
    return mult;
  };

  const summary = useMemo(() => {
    let totalForecast = 0;
    let totalBase = 0;
    for (const s of SKUS) {
      totalBase += s.baseWeekly * 26;
      totalForecast += s.baseWeekly * liftFor(s) * 26;
    }
    return { totalForecast, totalBase, lift: totalBase > 0 ? (totalForecast - totalBase) / totalBase : 0 };
  }, [overlay]);

  return (
    <DemoShell
      slug="retail-demand-forecaster"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#196B24"
      Icon={BarChart3}
      note={{
        en: "Sample data is illustrative — modeled on hypermarket × pantry-staples demand patterns across the GCC.",
        ar: "بيانات عيّنة توضيحية — مبنيّة على أنماط طلب الهايبرماركت والاحتياجات الأساسية في الخليج.",
      }}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Overlays */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.overlays, lang)}
          </p>
          <div className="grid md:grid-cols-4 gap-3">
            <Toggle
              label={tStr(COPY.ramadan, lang)}
              active={overlay.ramadan}
              color="#F5A623"
              onClick={() => setOverlay((o) => ({ ...o, ramadan: !o.ramadan }))}
            />
            <Toggle
              label={tStr(COPY.schools, lang)}
              active={overlay.schools}
              color="#156082"
              onClick={() => setOverlay((o) => ({ ...o, schools: !o.schools }))}
            />
            <Toggle
              label={tStr(COPY.summer, lang)}
              active={overlay.summer}
              color="#0F9ED5"
              onClick={() => setOverlay((o) => ({ ...o, summer: !o.summer }))}
            />
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                {tStr(COPY.promoSetting, lang)}
              </p>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={overlay.promo}
                onChange={(e) => setOverlay((o) => ({ ...o, promo: Number(e.target.value) }))}
                className="w-full"
                style={{ accentColor: "#196B24" }}
              />
              <p className="text-xs font-bold text-[#196B24] mt-1">{Math.round(overlay.promo * 100)}%</p>
            </div>
          </div>
          <div className="mt-6 grid sm:grid-cols-3 gap-4">
            <Tile
              label={tStr({ en: "26-wk forecast (units)", ar: "تنبؤ 26 أسبوعاً (وحدة)" }, lang)}
              value={Math.round(summary.totalForecast).toLocaleString("en-US")}
              color="#196B24"
            />
            <Tile
              label={tStr({ en: "Lift vs base", ar: "رفع مقابل الأساس" }, lang)}
              value={`${summary.lift >= 0 ? "+" : ""}${Math.round(summary.lift * 100)}%`}
              color={summary.lift >= 0 ? "#196B24" : "#B91C1C"}
            />
            <Tile
              label={tStr({ en: "Base weekly (5 SKUs)", ar: "الأساس الأسبوعي (5 أصناف)" }, lang)}
              value={SKUS.reduce((s, x) => s + x.baseWeekly, 0).toLocaleString("en-US")}
              color="#0E2841"
            />
          </div>
        </div>
      </section>

      {/* SKU forecasts */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-5">
          {SKUS.map((s) => {
            const lift = liftFor(s);
            const weekly = s.baseWeekly * lift;
            const stockoutWeeks = weekly > 0 ? s.onHand / weekly : 99;
            const cone = generateCone(s.baseWeekly, lift);
            return (
              <div
                key={s.id}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden grid lg:grid-cols-12 gap-0"
              >
                <div className="lg:col-span-3 p-5 border-b lg:border-b-0 lg:border-e border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {tStr(s.category, lang)}
                  </p>
                  <p className="font-bold text-[#0E2841] text-base leading-tight mb-3">
                    {tStr(s.name, lang)}
                  </p>
                  <Stat label={tStr(COPY.baseWeekly, lang)} value={s.baseWeekly.toLocaleString("en-US")} />
                  <Stat label={tStr(COPY.units, lang)} value={Math.round(weekly).toLocaleString("en-US")} />
                  <Stat
                    label={tStr(COPY.stockout, lang)}
                    value={`${stockoutWeeks.toFixed(1)} ${tStr(COPY.weeks, lang)}`}
                    color={stockoutWeeks < 4 ? "#B91C1C" : stockoutWeeks < 8 ? "#F5A623" : "#196B24"}
                  />
                </div>
                <div className="lg:col-span-6 p-5 border-b lg:border-b-0 lg:border-e border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                    {tStr(COPY.forecast, lang)}
                  </p>
                  <Cone points={cone} />
                </div>
                <div className="lg:col-span-3 p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                    {tStr(COPY.alloc, lang)}
                  </p>
                  <ul className="space-y-2">
                    {CLUSTERS.map((c) => (
                      <li key={c.id} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#0E2841] w-16">
                          {tStr(c.name, lang)}
                        </span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#196B24]"
                            style={{ width: `${c.weight * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-[#0E2841] w-12 text-end">
                          {Math.round(weekly * c.weight).toLocaleString("en-US")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </DemoShell>
  );
}

function generateCone(base: number, lift: number): number[] {
  const out: number[] = [];
  for (let w = 0; w < 26; w++) {
    const wave = 1 + 0.08 * Math.sin((w / 26) * Math.PI * 2);
    out.push(base * lift * wave);
  }
  return out;
}

function Cone({ points }: { points: number[] }) {
  const W = 600;
  const H = 120;
  const PAD = 8;
  const max = Math.max(...points, 1) * 1.1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - v / max) * (H - PAD * 2);

  const central = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const upper = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p * 1.18).toFixed(1)}`).join(" ");
  const lower = points
    .map((p, i) => `${i === points.length - 1 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p * 0.82).toFixed(1)}`)
    .reverse()
    .join(" ");
  const fill = `${upper} ${lower} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="forecast cone">
      <path d={fill} fill="#196B24" opacity={0.12} />
      <path d={central} stroke="#196B24" strokeWidth={2} fill="none" />
    </svg>
  );
}

function Toggle({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-2xl border-2 p-4 text-start transition-colors ${
        active ? "" : "border-gray-100"
      }`}
      style={{ borderColor: active ? color : undefined }}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
        {active ? "ON" : "OFF"}
      </p>
      <p className="text-base font-bold mt-1" style={{ color: active ? color : "#0E2841" }}>
        {label}
      </p>
    </button>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      <p className="text-2xl font-extrabold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-base font-bold" style={{ color: color ?? "#0E2841" }}>
        {value}
      </p>
    </div>
  );
}
