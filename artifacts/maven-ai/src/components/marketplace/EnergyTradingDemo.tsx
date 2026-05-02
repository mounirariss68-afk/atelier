import { useMemo, useState } from "react";
import { TrendingUp, RotateCcw, ArrowUpRight, ArrowDownRight, FileText } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";

interface Idea {
  id: string;
  title: { en: string; ar: string };
  direction: "long" | "short";
  conviction: number; // 0-100
  riskBand: "low" | "medium" | "high";
  rationale: { en: string; ar: string };
  feeds: string[];
  exit: { en: string; ar: string };
  selected: boolean;
}

interface Feed {
  id: string;
  name: string;
  category: "price" | "weather" | "vessel" | "macro";
  reading: string;
  trend: "up" | "down" | "flat";
  reinforces: string[]; // idea ids
  weakens: string[];
}

const SAMPLE: Idea[] = [
  {
    id: "i1",
    title: { en: "Brent–Dubai spread compression", ar: "ضغط فرق سعر برنت-دبي" },
    direction: "long",
    conviction: 72,
    riskBand: "medium",
    rationale: {
      en: "Asian refining margin recovery + lighter Atlantic basin sour barrels supports a tighter spread into Q3. Watch tanker book for confirmation.",
      ar: "تعافي هوامش التكرير الآسيوية + برميل حامض أخفّ في حوض الأطلسي يدعم ضيق الفرق في الربع الثالث. راقب دفاتر الناقلات للتأكيد.",
    },
    feeds: ["f1", "f3"],
    exit: { en: "Stop on widening past USD 2.40 / bbl.", ar: "إيقاف عند الاتساع فوق 2.40 دولار / برميل." },
    selected: false,
  },
  {
    id: "i2",
    title: { en: "Murban prompt strength", ar: "قوة سعر مربان الفوري" },
    direction: "long",
    conviction: 64,
    riskBand: "medium",
    rationale: {
      en: "Adnoc allocations to Asian buyers tightening; floating storage off Fujairah down 12% week-on-week.",
      ar: "تخصيصات أدنوك للمشترين الآسيويين تتشدد؛ التخزين العائم قبالة الفجيرة منخفض 12% أسبوعياً.",
    },
    feeds: ["f3", "f4"],
    exit: { en: "Stop on Fujairah build > 8% week-on-week.", ar: "إيقاف عند ارتفاع تخزين الفجيرة > 8% أسبوعياً." },
    selected: false,
  },
  {
    id: "i3",
    title: { en: "Hurricane risk premium — US Gulf", ar: "علاوة مخاطر الأعاصير — الخليج الأمريكي" },
    direction: "long",
    conviction: 48,
    riskBand: "high",
    rationale: {
      en: "NOAA outlook moves into above-average bracket; refinery cluster exposure mirrors 2017 setup.",
      ar: "توقّع NOAA يدخل النطاق الأعلى من المتوسط؛ التعرّض الإنتاجي يحاكي 2017.",
    },
    feeds: ["f2"],
    exit: { en: "Stop if NOAA revises down before May 28.", ar: "إيقاف إذا خفّض NOAA توقعاته قبل 28 مايو." },
    selected: false,
  },
  {
    id: "i4",
    title: { en: "Henry Hub fade into shoulder", ar: "تراجع هنري هَب في الفترة الانتقالية" },
    direction: "short",
    conviction: 60,
    riskBand: "medium",
    rationale: {
      en: "Inventory build > 5-yr range, mild forecast for storage region; LNG export schedule lighter into June.",
      ar: "بناء المخزون فوق نطاق 5 سنوات، توقعات معتدلة لمناطق التخزين؛ جدول تصدير LNG أخفّ حتى يونيو.",
    },
    feeds: ["f1", "f2"],
    exit: { en: "Cover on Texas heatwave call > 95F sustained.", ar: "تغطية عند استمرار حرارة تكساس فوق 95 فهرنهايت." },
    selected: false,
  },
];

const FEEDS: Feed[] = [
  { id: "f1", name: "Brent / WTI / Dubai prices", category: "price", reading: "+0.4 / +0.6 / +0.2", trend: "up", reinforces: ["i1"], weakens: ["i4"] },
  { id: "f2", name: "NOAA Atlantic outlook", category: "weather", reading: "Above average", trend: "up", reinforces: ["i3"], weakens: [] },
  { id: "f3", name: "Tanker AIS positions", category: "vessel", reading: "Floating storage −12%", trend: "down", reinforces: ["i1", "i2"], weakens: [] },
  { id: "f4", name: "OPEC+ joint statement", category: "macro", reading: "Production cuts extended", trend: "up", reinforces: ["i2"], weakens: ["i4"] },
];

const RISK_COLOR: Record<Idea["riskBand"], string> = {
  low: "#196B24",
  medium: "#F5A623",
  high: "#B91C1C",
};

const COPY = {
  eyebrow: { en: "Energy Trading Copilot", ar: "مساعد تداول الطاقة" },
  title: {
    en: "Trade ideas with the rationale spelled out — never executes.",
    ar: "أفكار تداول مع تبرير صريح — لا ينفّذ أبداً.",
  },
  intro: {
    en: "Adjust each idea's conviction, then click Sign for memo to draft a one-page trade memo. Toggle a feed to see which ideas it reinforces or weakens. The agent never sends to the desk.",
    ar: "عدّل اقتناع كل فكرة، ثم اضغط «وقّع للمذكّرة» لصياغة مذكّرة من صفحة. بدّل مصدراً لترى الأفكار التي يدعمها أو يضعفها. الوكيل لا يرسل إلى المكتب.",
  },
  reset: { en: "Reset to morning brief", ar: "إعادة إلى التقرير الصباحي" },
  ideas: { en: "Today's trade ideas", ar: "أفكار التداول اليوم" },
  conviction: { en: "Conviction", ar: "الاقتناع" },
  risk: { en: "Risk band", ar: "نطاق المخاطر" },
  rationale: { en: "Rationale", ar: "التبرير" },
  exit: { en: "Exit trigger", ar: "محفّز الخروج" },
  long: { en: "LONG", ar: "شراء" },
  short: { en: "SHORT", ar: "بيع" },
  feedMonitor: { en: "Feed monitor", ar: "مراقب التدفقات" },
  reinforces: { en: "Reinforces", ar: "يدعم" },
  weakens: { en: "Weakens", ar: "يُضعف" },
  memoTitle: { en: "Trade memo draft", ar: "مسوّدة مذكّرة التداول" },
  memoEmpty: { en: "Sign one or more ideas above to draft the memo.", ar: "وقّع فكرة أو أكثر أعلاه لصياغة المذكّرة." },
  signMemo: { en: "Sign for memo", ar: "وقّع للمذكّرة" },
  unsign: { en: "Unsign", ar: "ألغِ التوقيع" },
  hil: { en: "Human-in-the-loop", ar: "إنسان في الحلقة" },
  hilNote: {
    en: "The agent writes the memo. The trader signs and acts. The agent never executes a trade — by design.",
    ar: "يكتب الوكيل المذكّرة. يوقّع المتداول ويتصرّف. الوكيل لا ينفّذ أي صفقة — بالتصميم.",
  },
};

export default function EnergyTradingDemo() {
  const { lang } = useLang();
  const [ideas, setIdeas] = useState<Idea[]>(() => SAMPLE.map((s) => ({ ...s })));

  const reset = () => setIdeas(SAMPLE.map((s) => ({ ...s })));
  const setConv = (id: string, c: number) =>
    setIdeas((prev) =>
      prev.map((i) => (i.id === id ? { ...i, conviction: Math.max(0, Math.min(100, c)) } : i)),
    );
  const toggleSign = (id: string) =>
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));

  const signed = ideas.filter((i) => i.selected);

  return (
    <DemoShell
      slug="energy-trading-copilot"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#E97132"
      Icon={TrendingUp}
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
      {/* Ideas */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.ideas, lang)}
          </p>
          <div className="grid md:grid-cols-2 gap-5">
            {ideas.map((i) => (
              <div
                key={i.id}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col"
              >
                <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-gray-100">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full text-white inline-flex items-center gap-1`}
                    style={{ backgroundColor: i.direction === "long" ? "#196B24" : "#B91C1C" }}
                  >
                    {i.direction === "long" ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {i.direction === "long" ? tStr(COPY.long, lang) : tStr(COPY.short, lang)}
                  </span>
                  <h3 className="font-bold text-[#0E2841] flex-1 leading-tight">
                    {tStr(i.title, lang)}
                  </h3>
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: RISK_COLOR[i.riskBand] }}
                  >
                    {i.riskBand}
                  </span>
                </div>
                <div className="p-5 flex-1 flex flex-col gap-3">
                  <div>
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                      <span>{tStr(COPY.conviction, lang)}</span>
                      <span style={{ color: RISK_COLOR[i.riskBand] }}>{i.conviction}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={i.conviction}
                      onChange={(e) => setConv(i.id, Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: RISK_COLOR[i.riskBand] }}
                    />
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{tStr(i.rationale, lang)}</p>
                  <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                      {tStr(COPY.exit, lang)}:
                    </span>{" "}
                    {tStr(i.exit, lang)}
                  </div>
                </div>
                <button
                  onClick={() => toggleSign(i.id)}
                  className={`text-[11px] font-bold uppercase tracking-widest py-3 transition-colors ${
                    i.selected
                      ? "bg-[#0E2841] text-white hover:bg-[#156082]"
                      : "bg-[#F8F9FA] text-[#0E2841] hover:bg-[#0E2841] hover:text-white"
                  }`}
                >
                  {i.selected ? tStr(COPY.unsign, lang) : tStr(COPY.signMemo, lang)}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feed monitor */}
      <section className="py-10 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.feedMonitor, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {FEEDS.map((f) => (
              <div key={f.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  {f.category}
                </p>
                <p className="font-bold text-[#0E2841] text-sm leading-tight mb-2">{f.name}</p>
                <p className="text-sm font-mono text-gray-700 mb-2">{f.reading}</p>
                <div className="flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-widest">
                  {f.reinforces.map((id) => (
                    <span
                      key={`r-${id}`}
                      className="px-2 py-0.5 rounded-full bg-[#196B24]/10 text-[#196B24]"
                    >
                      ↑ {id}
                    </span>
                  ))}
                  {f.weakens.map((id) => (
                    <span
                      key={`w-${id}`}
                      className="px-2 py-0.5 rounded-full bg-[#B91C1C]/10 text-[#B91C1C]"
                    >
                      ↓ {id}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Memo */}
      <section className="py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.memoTitle, lang)}
          </p>
          {signed.length === 0 ? (
            <p className="text-sm text-gray-500 italic">{tStr(COPY.memoEmpty, lang)}</p>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-sm text-gray-700 space-y-4 leading-relaxed">
              <div className="border-b border-gray-100 pb-3 flex items-center gap-2">
                <FileText size={16} className="text-[#0E2841]" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {tStr({ en: "Trade memo · 2026-05-04", ar: "مذكّرة تداول · 2026-05-04" }, lang)}
                </p>
                <span className="ms-auto text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#F5A623]/20 text-[#F5A623]">
                  {tStr(COPY.hil, lang)}
                </span>
              </div>
              {signed.map((i) => (
                <div key={i.id} className="border-b border-gray-100 last:border-0 pb-4 last:pb-0">
                  <p className="font-extrabold text-[#0E2841]">
                    {i.direction === "long" ? "↑" : "↓"} {tStr(i.title, lang)}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">
                    {tStr(COPY.conviction, lang)} {i.conviction}% · {tStr(COPY.risk, lang)}{" "}
                    <span style={{ color: RISK_COLOR[i.riskBand] }}>{i.riskBand}</span>
                  </p>
                  <p className="mt-2">{tStr(i.rationale, lang)}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    <span className="font-bold uppercase tracking-widest text-[10px] text-[#F5A623]">
                      {tStr(COPY.exit, lang)}:
                    </span>{" "}
                    {tStr(i.exit, lang)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </DemoShell>
  );
}
