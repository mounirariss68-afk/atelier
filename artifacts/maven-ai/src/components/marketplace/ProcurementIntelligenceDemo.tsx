import { useMemo, useState } from "react";
import { ShoppingCart, RotateCcw, AlertTriangle, ShieldCheck } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

interface Category {
  id: string;
  name: { en: string; ar: string };
  spendAed: number;
  baselineSavingsPct: number;
  fxLeveragePct: number;
  consolidationPct: number;
  contractCycleDays: number;
}

interface Supplier {
  id: string;
  name: string;
  category: string;
  region: string;
  performance: number; // 0-100
  financial: number; // 0-100
  sanction: number; // 0-100 (100 = clean)
  esg: number; // 0-100
}

const CATEGORIES_INIT: Category[] = [
  { id: "it-services", name: { en: "IT services & SI", ar: "خدمات تقنية المعلومات" }, spendAed: 240_000_000, baselineSavingsPct: 6, fxLeveragePct: 3, consolidationPct: 4, contractCycleDays: 110 },
  { id: "facilities", name: { en: "Facilities & soft FM", ar: "المرافق والصيانة" }, spendAed: 96_000_000, baselineSavingsPct: 9, fxLeveragePct: 1, consolidationPct: 6, contractCycleDays: 75 },
  { id: "logistics", name: { en: "Logistics & freight", ar: "الخدمات اللوجستية" }, spendAed: 142_000_000, baselineSavingsPct: 5, fxLeveragePct: 8, consolidationPct: 3, contractCycleDays: 60 },
  { id: "marketing", name: { en: "Marketing & media", ar: "التسويق والإعلام" }, spendAed: 58_000_000, baselineSavingsPct: 11, fxLeveragePct: 2, consolidationPct: 5, contractCycleDays: 90 },
  { id: "professional", name: { en: "Professional services", ar: "خدمات استشارية" }, spendAed: 84_000_000, baselineSavingsPct: 7, fxLeveragePct: 1, consolidationPct: 8, contractCycleDays: 120 },
];

const SUPPLIERS: Supplier[] = [
  { id: "s1", name: "Atlas Tech Saudi", category: "it-services", region: "KSA", performance: 78, financial: 70, sanction: 100, esg: 60 },
  { id: "s2", name: "Gulf Facilities Co", category: "facilities", region: "UAE", performance: 65, financial: 55, sanction: 100, esg: 45 },
  { id: "s3", name: "Levant Freight Lines", category: "logistics", region: "Levant", performance: 72, financial: 40, sanction: 60, esg: 55 },
  { id: "s4", name: "Crescent Media Group", category: "marketing", region: "GCC", performance: 80, financial: 75, sanction: 100, esg: 70 },
  { id: "s5", name: "Al-Mawared Consulting", category: "professional", region: "GCC", performance: 84, financial: 80, sanction: 100, esg: 75 },
  { id: "s6", name: "DeltaSI Pakistan", category: "it-services", region: "South Asia", performance: 60, financial: 45, sanction: 80, esg: 35 },
];

const COPY = {
  eyebrow: { en: "Procurement Intelligence", ar: "ذكاء المشتريات" },
  title: {
    en: "Spend taxonomy, supplier risk, and a negotiation pre-read in one place.",
    ar: "تصنيف الإنفاق، مخاطر المورد، وملخّص تحضير التفاوض في مكان واحد.",
  },
  intro: {
    en: "Drag the savings, FX, and consolidation levers per category and the portfolio savings hypothesis re-renders. Click a supplier to read the auto-drafted negotiation pre-read.",
    ar: "اسحب أشرطة الوفورات والصرف الأجنبي والدمج لكل فئة، فتُعاد فرضية وفورات المحفظة. اضغط على مورد لقراءة مسودة تحضير التفاوض.",
  },
  reset: { en: "Reset to baseline", ar: "إعادة إلى الأساس" },
  spend: { en: "Annual spend", ar: "الإنفاق السنوي" },
  hypothesis: { en: "Realisable savings", ar: "وفورات قابلة للتحقيق" },
  cycle: { en: "Avg contract cycle", ar: "متوسط دورة العقد" },
  days: { en: "days", ar: "يوماً" },
  baseline: { en: "Baseline", ar: "الأساس" },
  fx: { en: "FX leverage", ar: "نفوذ سعر الصرف" },
  consolidation: { en: "Consolidation", ar: "الدمج" },
  total: { en: "Total saving %", ar: "إجمالي %" },
  riskTitle: { en: "Supplier risk dossiers", ar: "ملفات مخاطر الموردين" },
  perf: { en: "Performance", ar: "الأداء" },
  fin: { en: "Financial", ar: "المالي" },
  sanction: { en: "Sanction screen", ar: "فحص العقوبات" },
  esg: { en: "ESG", ar: "ESG" },
  riskScore: { en: "Risk score", ar: "درجة المخاطر" },
  preRead: { en: "Negotiation pre-read", ar: "ملخّص تحضير التفاوض" },
  buyerLeverage: { en: "Buyer leverage", ar: "نفوذ المشتري" },
  supplierLeverage: { en: "Supplier leverage", ar: "نفوذ المورد" },
  batna: { en: "BATNA", ar: "أفضل بديل" },
  totalSavings: { en: "Total realisable savings", ar: "إجمالي الوفورات الممكنة" },
  pickSupplier: { en: "Click a supplier above to draft the negotiation pre-read.", ar: "اضغط على مورد أعلاه لصياغة ملخّص التفاوض." },
  note: {
    en: "Sample data is illustrative — modeled after a multi-country GCC group's category structure so you can pressure-test the levers.",
    ar: "بيانات عيّنة توضيحية — مبنيّة على هيكل فئات لمجموعة خليجية متعددة الدول لاختبار الأشرطة.",
  },
};

function fmtAed(v: number, lang: "en" | "ar"): string {
  if (Math.abs(v) >= 1_000_000) return lang === "ar" ? `${(v / 1_000_000).toFixed(1)} مليون` : `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return lang === "ar" ? `${Math.round(v / 1_000)} ألف` : `AED ${Math.round(v / 1_000)}K`;
  return lang === "ar" ? String(Math.round(v)) : `AED ${Math.round(v)}`;
}

function riskScore(s: Supplier): number {
  return Math.round(0.35 * s.performance + 0.3 * s.financial + 0.2 * s.sanction + 0.15 * s.esg);
}

function riskBand(score: number): { label: { en: string; ar: string }; color: string } {
  if (score >= 75) return { label: { en: "Low", ar: "منخفض" }, color: "#196B24" };
  if (score >= 55) return { label: { en: "Medium", ar: "متوسط" }, color: "#F5A623" };
  return { label: { en: "High", ar: "مرتفع" }, color: "#B91C1C" };
}

export default function ProcurementIntelligenceDemo() {
  const { lang } = useLang();
  const [cats, setCats] = useState<Category[]>(() => CATEGORIES_INIT.map((c) => ({ ...c })));
  const [picked, setPicked] = useState<string | null>("s3");

  const totals = useMemo(() => {
    let spend = 0;
    let saving = 0;
    let cycle = 0;
    for (const c of cats) {
      spend += c.spendAed;
      saving += c.spendAed * (c.baselineSavingsPct + c.fxLeveragePct + c.consolidationPct) / 100;
      cycle += c.contractCycleDays;
    }
    return { spend, saving, savingPct: spend > 0 ? (saving / spend) * 100 : 0, avgCycle: cats.length ? cycle / cats.length : 0 };
  }, [cats]);

  const reset = () => setCats(CATEGORIES_INIT.map((c) => ({ ...c })));

  const updateCat = (id: string, key: keyof Category, value: number) =>
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: value } : c)));

  const supplier = picked ? SUPPLIERS.find((s) => s.id === picked) ?? null : null;

  return (
    <DemoShell
      slug="procurement-intelligence"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#196B24"
      Icon={ShoppingCart}
      note={COPY.note}
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-3 gap-4">
          <Tile label={tStr(COPY.spend, lang)} value={fmtAed(totals.spend, lang)} color="#0E2841" />
          <Tile
            label={tStr(COPY.totalSavings, lang)}
            value={`${fmtAed(totals.saving, lang)} (${totals.savingPct.toFixed(1)}%)`}
            color="#196B24"
          />
          <Tile
            label={tStr(COPY.cycle, lang)}
            value={`${totals.avgCycle.toFixed(0)} ${tStr(COPY.days, lang)}`}
            color="#156082"
          />
        </div>
      </section>

      {/* Category levers */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-3">
          <div className="grid grid-cols-12 gap-3 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <span className="col-span-3">{tStr({ en: "Category", ar: "الفئة" }, lang)}</span>
            <span className="col-span-2">{tStr(COPY.spend, lang)}</span>
            <span className="col-span-2 text-center">{tStr(COPY.baseline, lang)}</span>
            <span className="col-span-2 text-center">{tStr(COPY.fx, lang)}</span>
            <span className="col-span-2 text-center">{tStr(COPY.consolidation, lang)}</span>
            <span className="col-span-1 text-end">{tStr(COPY.total, lang)}</span>
          </div>
          {cats.map((c) => {
            const total = c.baselineSavingsPct + c.fxLeveragePct + c.consolidationPct;
            const totalAed = (c.spendAed * total) / 100;
            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-gray-100 p-4 grid grid-cols-12 gap-3 items-center"
              >
                <div className="col-span-3">
                  <p className="font-bold text-[#0E2841] text-sm leading-tight">{tStr(c.name, lang)}</p>
                  <p className="text-[10px] text-gray-500">
                    {tStr(COPY.cycle, lang)}: {c.contractCycleDays} {tStr(COPY.days, lang)}
                  </p>
                </div>
                <div className="col-span-2 text-sm font-semibold text-[#0E2841]">
                  {fmtAed(c.spendAed, lang)}
                </div>
                <Slider
                  className="col-span-2"
                  value={c.baselineSavingsPct}
                  onChange={(v) => updateCat(c.id, "baselineSavingsPct", v)}
                  color="#0E2841"
                />
                <Slider
                  className="col-span-2"
                  value={c.fxLeveragePct}
                  max={15}
                  onChange={(v) => updateCat(c.id, "fxLeveragePct", v)}
                  color="#156082"
                />
                <Slider
                  className="col-span-2"
                  value={c.consolidationPct}
                  max={15}
                  onChange={(v) => updateCat(c.id, "consolidationPct", v)}
                  color="#196B24"
                />
                <div className="col-span-1 text-end">
                  <p className="text-sm font-extrabold text-[#196B24]">{total.toFixed(1)}%</p>
                  <p className="text-[10px] text-gray-500">{fmtAed(totalAed, lang)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Supplier risk */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.riskTitle, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {SUPPLIERS.map((s) => {
              const score = riskScore(s);
              const band = riskBand(score);
              const active = picked === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setPicked(s.id)}
                  className={`text-start bg-white rounded-2xl border-2 p-4 transition-colors ${
                    active ? "border-[#0E2841]" : "border-transparent hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="font-bold text-[#0E2841] text-sm">{s.name}</p>
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: band.color }}
                    >
                      {tStr(band.label, lang)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mb-3">{s.region}</p>
                  <Bar label={tStr(COPY.perf, lang)} value={s.performance} />
                  <Bar label={tStr(COPY.fin, lang)} value={s.financial} />
                  <Bar label={tStr(COPY.sanction, lang)} value={s.sanction} />
                  <Bar label={tStr(COPY.esg, lang)} value={s.esg} />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-3">
                    {tStr(COPY.riskScore, lang)}:{" "}
                    <span className="text-[#0E2841] text-sm">{score}</span>
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pre-read */}
      <section className="py-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.preRead, lang)}
          </p>
          {!supplier ? (
            <p className="text-sm text-gray-500 italic">{tStr(COPY.pickSupplier, lang)}</p>
          ) : (
            <PreRead supplier={supplier} lang={lang} />
          )}
        </div>
      </section>
    </DemoShell>
  );
}

function PreRead({ supplier, lang }: { supplier: Supplier; lang: "en" | "ar" }) {
  const score = riskScore(supplier);
  const band = riskBand(score);
  const buyer: { en: string; ar: string }[] = [];
  if (supplier.financial < 60) buyer.push({ en: "Supplier financial fragility — push for tighter payment terms.", ar: "هشاشة مالية للمورد — اضغط لشروط دفع أصعب." });
  if (supplier.performance < 75) buyer.push({ en: "Performance below target — fold service-level penalties into the renewal.", ar: "أداء دون المستهدف — أدرج عقوبات مستوى الخدمة في التجديد." });
  if (supplier.sanction < 100) buyer.push({ en: "Sanction-screen yellow flag — request enhanced KYC and consider an alt source.", ar: "علامة صفراء في فحص العقوبات — اطلب تحقّق KYC معزّز ودرس مصدراً بديلاً." });
  if (buyer.length === 0) buyer.push({ en: "Volume aggregation across business units — single your spend behind one MSA.", ar: "تجميع الحجم عبر الوحدات — وحّد إنفاقك خلف عقد إطار واحد." });

  const sup: { en: string; ar: string }[] = [];
  if (supplier.performance >= 75) sup.push({ en: "Track record on the account — switching cost is real.", ar: "سجل أداء على الحساب — تكلفة التبديل حقيقية." });
  if (supplier.region === "GCC") sup.push({ en: "Local in-country value (ICV) helps your government scoring.", ar: "قيمة محلية ضمن البلد (ICV) ترفع تقييمك لدى الجهة." });
  sup.push({ en: "Embedded in your delivery teams — change management hurts.", ar: "متشابك مع فرق التسليم — تكلفة التغيير عالية." });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-8 space-y-4 text-sm text-gray-700 leading-relaxed">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-400 font-bold">
            {tStr({ en: "Pre-read for", ar: "تحضير لـ" }, lang)}
          </p>
          <p className="font-extrabold text-[#0E2841] text-lg">{supplier.name}</p>
        </div>
        <span
          className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full text-white"
          style={{ backgroundColor: band.color }}
        >
          {tStr({ en: "Risk", ar: "المخاطر" }, lang)}: {tStr(band.label, lang)} ({score})
        </span>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        <Block
          color="#196B24"
          icon={<ShieldCheck size={14} />}
          title={tStr({ en: "Buyer leverage", ar: "نفوذ المشتري" }, lang)}
          items={buyer.map((b) => tStr(b, lang))}
        />
        <Block
          color="#B91C1C"
          icon={<AlertTriangle size={14} />}
          title={tStr({ en: "Supplier leverage", ar: "نفوذ المورد" }, lang)}
          items={sup.map((b) => tStr(b, lang))}
        />
        <Block
          color="#F5A623"
          icon={<RotateCcw size={14} />}
          title={tStr({ en: "BATNA", ar: "أفضل بديل" }, lang)}
          items={[
            tStr({ en: "Two pre-screened alternates in the same category", ar: "اثنان من البدائل في الفئة نفسها" }, lang),
            tStr({ en: "RFP fast-track ready in 21 days", ar: "مسار مناقصة سريع جاهز خلال 21 يوماً" }, lang),
          ]}
        />
      </div>
    </div>
  );
}

function Block({
  title,
  items,
  color,
  icon,
}: {
  title: string;
  items: string[];
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <p
        className="text-[10px] font-bold uppercase tracking-widest mb-3 inline-flex items-center gap-1.5"
        style={{ color }}
      >
        {icon}
        {title}
      </p>
      <ul className="space-y-2 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: color }} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slider({
  value,
  max = 12,
  onChange,
  color,
  className,
}: {
  value: number;
  max?: number;
  onChange: (v: number) => void;
  color: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={max}
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-current"
          style={{ color }}
        />
        <span className="text-xs font-bold w-8 text-end" style={{ color }}>
          {value.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const color = value >= 75 ? "#196B24" : value >= 55 ? "#F5A623" : "#B91C1C";
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">
        <span>{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
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
