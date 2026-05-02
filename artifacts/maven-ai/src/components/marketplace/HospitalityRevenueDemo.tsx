import { useMemo, useState } from "react";
import { Hotel, RotateCcw } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";

interface RoomType {
  id: string;
  name: { en: string; ar: string };
  baseRate: number;
  capacity: number;
  pickup: number; // 0..1 baseline
}

interface EventOverlay {
  id: string;
  name: { en: string; ar: string };
  active: boolean;
  multiplier: number;
}

interface ChannelMix {
  ota: number;
  direct: number;
  corporate: number;
}

const ROOMS: RoomType[] = [
  { id: "deluxe", name: { en: "Deluxe King", ar: "ديلوكس كينغ" }, baseRate: 950, capacity: 60, pickup: 0.62 },
  { id: "suite", name: { en: "Junior Suite", ar: "جونيور سويت" }, baseRate: 1700, capacity: 30, pickup: 0.55 },
  { id: "club", name: { en: "Club Lounge access", ar: "كلوب لاونج" }, baseRate: 2400, capacity: 20, pickup: 0.5 },
];

const EVENT_INIT: EventOverlay[] = [
  { id: "riyadh-season", name: { en: "Riyadh Season", ar: "موسم الرياض" }, active: true, multiplier: 1.32 },
  { id: "f1", name: { en: "F1 Grand Prix", ar: "سباق F1" }, active: false, multiplier: 1.5 },
  { id: "hajj", name: { en: "Hajj cohorts", ar: "حجاج بيت الله" }, active: false, multiplier: 1.18 },
  { id: "expo", name: { en: "EXPO-class event", ar: "فعالية بحجم إكسبو" }, active: false, multiplier: 1.45 },
];

const COMP_INIT = 880; // competitor rate baseline
const MIX_INIT: ChannelMix = { ota: 45, direct: 30, corporate: 25 };

const COPY = {
  eyebrow: { en: "Hospitality Revenue Optimizer", ar: "محسّن إيرادات الضيافة" },
  title: {
    en: "Property-level rate, length-of-stay, and channel-mix — with the assumption stack visible.",
    ar: "السعر وطول الإقامة ومزيج القنوات على مستوى الفندق — مع كشف حزمة الافتراضات.",
  },
  intro: {
    en: "Toggle event overlays, retune the channel mix, and the rate recommendation per room-type and the projected RevPAR re-compute live.",
    ar: "بدّل طبقات الأحداث، أعِد ضبط مزيج القنوات، وأعِد حساب التوصية لكل نوع غرفة وRevPAR المتوقّع فوراً.",
  },
  reset: { en: "Reset to baseline", ar: "إعادة إلى الأساس" },
  events: { en: "Event overlays", ar: "طبقات الأحداث" },
  channelMix: { en: "Channel mix (must total 100%)", ar: "مزيج القنوات (يجب أن يبلغ 100%)" },
  ota: { en: "OTA", ar: "OTA" },
  direct: { en: "Direct", ar: "مباشر" },
  corporate: { en: "Corporate", ar: "شركات" },
  comp: { en: "Competitor benchmark (AED)", ar: "معيار المنافس (درهم)" },
  losMin: { en: "Min length of stay (nights)", ar: "أدنى طول إقامة (ليالٍ)" },
  rateBoard: { en: "Rate recommendation board", ar: "لوحة توصيات الأسعار" },
  baseRate: { en: "Base rate", ar: "السعر الأساس" },
  recommended: { en: "Recommended", ar: "موصى" },
  delta: { en: "vs comp", ar: "مقابل المنافس" },
  occ: { en: "Forecast occupancy", ar: "إشغال متوقّع" },
  revpar: { en: "Forecast RevPAR", ar: "RevPAR المتوقّع" },
  blended: { en: "Blended margin", ar: "هامش مزجي" },
  totalUplift: { en: "Total uplift vs baseline", ar: "إجمالي الزيادة مقابل الأساس" },
  blendedNote: {
    en: "Channel margin assumptions: OTA 75%, Direct 92%, Corporate 85% net of commissions and contracted rates.",
    ar: "افتراضات هامش القناة: OTA 75%، المباشر 92%، الشركات 85% بعد العمولات والأسعار المتعاقد عليها.",
  },
};

const CHANNEL_MARGIN = { ota: 0.75, direct: 0.92, corporate: 0.85 };

export default function HospitalityRevenueDemo() {
  const { lang } = useLang();
  const [events, setEvents] = useState<EventOverlay[]>(() => EVENT_INIT.map((e) => ({ ...e })));
  const [mix, setMix] = useState<ChannelMix>({ ...MIX_INIT });
  const [comp, setComp] = useState<number>(COMP_INIT);
  const [los, setLos] = useState<number>(2);

  const reset = () => {
    setEvents(EVENT_INIT.map((e) => ({ ...e })));
    setMix({ ...MIX_INIT });
    setComp(COMP_INIT);
    setLos(2);
  };

  const eventMultiplier = useMemo(() => {
    return events.filter((e) => e.active).reduce((m, e) => m * e.multiplier, 1);
  }, [events]);

  const losPenalty = los >= 3 ? 0.94 : los >= 2 ? 1 : 1.06; // shorter LOS = price up

  const board = useMemo(() => {
    return ROOMS.map((r) => {
      const pickup = Math.min(0.98, r.pickup * (eventMultiplier > 1 ? 1.15 : 1));
      const recommended = Math.round(r.baseRate * eventMultiplier * losPenalty);
      const occRooms = Math.round(r.capacity * pickup);
      const channelRevenue =
        recommended * occRooms *
        (mix.ota / 100 * CHANNEL_MARGIN.ota + mix.direct / 100 * CHANNEL_MARGIN.direct + mix.corporate / 100 * CHANNEL_MARGIN.corporate);
      const revpar = channelRevenue / r.capacity;
      const baselineRevpar =
        r.baseRate * r.pickup *
        (MIX_INIT.ota / 100 * CHANNEL_MARGIN.ota + MIX_INIT.direct / 100 * CHANNEL_MARGIN.direct + MIX_INIT.corporate / 100 * CHANNEL_MARGIN.corporate);
      return {
        ...r,
        pickup,
        recommended,
        occRooms,
        revpar,
        baselineRevpar,
        delta: comp > 0 ? ((recommended - comp) / comp) * 100 : 0,
      };
    });
  }, [eventMultiplier, losPenalty, mix, comp]);

  const totals = useMemo(() => {
    const newRev = board.reduce((s, r) => s + r.revpar * r.capacity, 0);
    const baseRev = board.reduce((s, r) => s + r.baselineRevpar * r.capacity, 0);
    const totalRooms = ROOMS.reduce((s, r) => s + r.capacity, 0);
    return {
      revparTotal: totalRooms > 0 ? newRev / totalRooms : 0,
      uplift: baseRev > 0 ? (newRev - baseRev) / baseRev : 0,
      blendedMargin:
        mix.ota / 100 * CHANNEL_MARGIN.ota + mix.direct / 100 * CHANNEL_MARGIN.direct + mix.corporate / 100 * CHANNEL_MARGIN.corporate,
    };
  }, [board, mix]);

  const mixTotal = mix.ota + mix.direct + mix.corporate;
  const mixOk = Math.abs(mixTotal - 100) < 0.5;

  const trace: AgentLogEntry[] = useMemo(() => {
    const activeEvents = events.filter((e) => e.active).length;
    return [
      { agentId: "event-tagger", line: lang === "ar" ? `${activeEvents} حدث نشط، مضاعف الأحداث ×${eventMultiplier.toFixed(2)}.` : `${activeEvents} active event(s); event multiplier ×${eventMultiplier.toFixed(2)}.` },
      { agentId: "demand-modeller", line: lang === "ar" ? `حدّث توقّع الإقبال لكل من ${ROOMS.length} أنواع غرف.` : `Updated pickup forecast for all ${ROOMS.length} room types.` },
      { agentId: "competitor-rate-watcher", line: lang === "ar" ? `معيار المنافس: ${comp} درهم.` : `Comp benchmark anchored at AED ${comp}.` },
      { agentId: "rate-recommender", line: lang === "ar" ? `سعّر الغرف بزيادة إجمالية ${(totals.uplift * 100).toFixed(1)}% فوق الأساس.` : `Re-priced rooms with ${(totals.uplift * 100).toFixed(1)}% total uplift vs baseline.` },
      { agentId: "channel-mix-tuner", line: mixOk ? (lang === "ar" ? `مزيج القنوات متوازن (هامش مزجي ${(totals.blendedMargin * 100).toFixed(0)}%).` : `Channel mix balanced (blended margin ${(totals.blendedMargin * 100).toFixed(0)}%).`) : (lang === "ar" ? `مزيج القنوات غير صحيح (${mixTotal}%).` : `Channel mix off-target at ${mixTotal}% — flagged.`) },
    ];
  }, [events, eventMultiplier, comp, totals, mixOk, mixTotal, lang]);

  return (
    <DemoShell
      slug="hospitality-revenue-optimizer"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#F5A623"
      Icon={Hotel}
      note={COPY.blendedNote}
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
          <Tile
            label={tStr(COPY.revpar, lang)}
            value={`AED ${totals.revparTotal.toFixed(0)}`}
            color="#0E2841"
          />
          <Tile
            label={tStr(COPY.totalUplift, lang)}
            value={`${totals.uplift >= 0 ? "+" : ""}${(totals.uplift * 100).toFixed(1)}%`}
            color={totals.uplift >= 0 ? "#196B24" : "#B91C1C"}
          />
          <Tile
            label={tStr(COPY.blended, lang)}
            value={`${(totals.blendedMargin * 100).toFixed(1)}%`}
            color="#F5A623"
          />
        </div>
      </section>

      {/* Controls */}
      <section className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
              {tStr(COPY.events, lang)}
            </p>
            <div className="space-y-2">
              {events.map((e, idx) => (
                <button
                  key={e.id}
                  onClick={() =>
                    setEvents((prev) => prev.map((x, i) => (i === idx ? { ...x, active: !x.active } : x)))
                  }
                  className={`w-full text-start bg-white rounded-xl border-2 p-3 transition-colors ${
                    e.active ? "border-[#F5A623]" : "border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <p className="font-bold text-[#0E2841] text-sm">{tStr(e.name, lang)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    ×{e.multiplier.toFixed(2)} · {e.active ? "ON" : "OFF"}
                  </p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
              {tStr(COPY.channelMix, lang)}
            </p>
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <ChannelSlider
                label={tStr(COPY.ota, lang)}
                value={mix.ota}
                color="#B91C1C"
                onChange={(v) => setMix((m) => ({ ...m, ota: v }))}
              />
              <ChannelSlider
                label={tStr(COPY.direct, lang)}
                value={mix.direct}
                color="#196B24"
                onChange={(v) => setMix((m) => ({ ...m, direct: v }))}
              />
              <ChannelSlider
                label={tStr(COPY.corporate, lang)}
                value={mix.corporate}
                color="#156082"
                onChange={(v) => setMix((m) => ({ ...m, corporate: v }))}
              />
              <div className="text-xs font-bold uppercase tracking-widest pt-1" style={{ color: mixOk ? "#196B24" : "#B91C1C" }}>
                {tStr({ en: "Total", ar: "المجموع" }, lang)}: {mixTotal.toFixed(0)}%{" "}
                {mixOk ? "✓" : tStr({ en: "(must be 100%)", ar: "(يجب أن يبلغ 100%)" }, lang)}
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                {tStr(COPY.comp, lang)}
              </p>
              <input
                type="range"
                min={500}
                max={1500}
                step={10}
                value={comp}
                onChange={(e) => setComp(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: "#0E2841" }}
              />
              <p className="text-base font-bold text-[#0E2841]">AED {comp}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                {tStr(COPY.losMin, lang)}
              </p>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={los}
                onChange={(e) => setLos(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: "#F5A623" }}
              />
              <p className="text-base font-bold text-[#0E2841]">{los}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Rate board */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.rateBoard, lang)}
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {board.map((r) => {
              const deltaColor = r.delta >= 0 ? "#196B24" : "#B91C1C";
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-gray-100 p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {tStr(COPY.baseRate, lang)}: AED {r.baseRate}
                  </p>
                  <p className="font-bold text-[#0E2841] text-lg leading-tight mb-3">
                    {tStr(r.name, lang)}
                  </p>
                  <p className="text-3xl font-extrabold text-[#F5A623] mb-1">AED {r.recommended}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">
                    {tStr(COPY.recommended, lang)}
                    <span className="ms-2 inline-flex items-center gap-1" style={{ color: deltaColor }}>
                      {r.delta >= 0 ? "↑" : "↓"} {Math.abs(r.delta).toFixed(0)}% {tStr(COPY.delta, lang)}
                    </span>
                  </p>
                  <Stat label={tStr(COPY.occ, lang)} value={`${Math.round(r.pickup * 100)}%`} />
                  <Stat label={tStr(COPY.revpar, lang)} value={`AED ${r.revpar.toFixed(0)}`} />
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="hospitality-revenue-optimizer" log={trace} accent="#F5A623" />
        </div>
      </section>
    </DemoShell>
  );
}

function ChannelSlider({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest mb-1">
        <span style={{ color }}>{label}</span>
        <span className="text-[#0E2841]">{value.toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: color }}
      />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-base font-bold text-[#0E2841]">{value}</p>
    </div>
  );
}
