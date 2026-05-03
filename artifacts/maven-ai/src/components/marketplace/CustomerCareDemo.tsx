import { useMemo, useState } from "react";
import { Headphones, RotateCcw, MessageSquare, AlertTriangle } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";

interface Channel {
  id: string;
  name: { en: string; ar: string };
  volume: number;
  containment: number; // 0..1
  csat: number; // 0..100
  qaPass: number; // 0..1
  costPerContact: number;
}

interface Conversation {
  id: string;
  channel: string;
  intent: { en: string; ar: string };
  steps: { who: "customer" | "agent" | "human"; text: { en: string; ar: string } }[];
  qa: { passed: boolean; reason: { en: string; ar: string } };
  escalation: { en: string; ar: string } | null;
}

const INIT_CH: Channel[] = [
  { id: "voice", name: { en: "Voice (IVR)", ar: "صوت (IVR)" }, volume: 8200, containment: 0.42, csat: 71, qaPass: 0.86, costPerContact: 9.6 },
  { id: "chat", name: { en: "Web chat", ar: "دردشة الموقع" }, volume: 14500, containment: 0.71, csat: 78, qaPass: 0.91, costPerContact: 1.4 },
  { id: "wapp", name: { en: "WhatsApp", ar: "واتساب" }, volume: 22300, containment: 0.74, csat: 80, qaPass: 0.93, costPerContact: 1.1 },
  { id: "email", name: { en: "Email", ar: "البريد" }, volume: 6800, containment: 0.55, csat: 68, qaPass: 0.84, costPerContact: 4.2 },
];

const CONVS: Conversation[] = [
  {
    id: "c1",
    channel: "wapp",
    intent: { en: "Reset SIM PIN", ar: "إعادة ضبط رمز الشريحة" },
    steps: [
      { who: "customer", text: { en: "I locked my SIM, can't make calls.", ar: "قفل لي شريحة، ما أقدر أتصل." } },
      { who: "agent", text: { en: "I can help. Verify your registered ID number — last 4 digits.", ar: "أقدر أساعدك. أكّد آخر 4 أرقام من رقم الهوية المسجّل." } },
      { who: "customer", text: { en: "1234", ar: "1234" } },
      { who: "agent", text: { en: "Your PUK is sent to your registered email and a backup SMS to your alt number.", ar: "أرسلت رمز PUK إلى بريدك المسجّل ورسالة احتياطية إلى رقمك البديل." } },
    ],
    qa: { passed: true, reason: { en: "Identity verified, no policy breach, citation present.", ar: "التحقّق من الهوية تمّ، لا مخالفة، المرجع موجود." } },
    escalation: null,
  },
  {
    id: "c2",
    channel: "voice",
    intent: { en: "Disputed roaming charge", ar: "نزاع رسوم تجوال" },
    steps: [
      { who: "customer", text: { en: "There's a 480 dirham roaming charge I don't recognise.", ar: "في رسوم تجوال 480 درهم ما أعرفها." } },
      { who: "agent", text: { en: "I see the data session in Jordan on Apr 17. I'll book a callback with our roaming desk within 2 hours.", ar: "أرى جلسة بيانات في الأردن 17 أبريل. سأحجز معاودة من مكتب التجوال خلال ساعتين." } },
      { who: "human", text: { en: "[handoff to billing specialist]", ar: "[تحويل إلى أخصائي الفوترة]" } },
    ],
    qa: { passed: false, reason: { en: "Missing required disclosure on dispute timeline (10 business days).", ar: "إفصاح مفقود حول جدول المعالجة (10 أيام عمل)." } },
    escalation: { en: "Routed to human billing specialist (policy: charge > 250 AED disputed)", ar: "حُوّلت لأخصائي فوترة بشري (السياسة: نزاع > 250 درهم)" },
  },
  {
    id: "c3",
    channel: "chat",
    intent: { en: "Plan upgrade question", ar: "ترقية باقة" },
    steps: [
      { who: "customer", text: { en: "Which plan gives me 50GB and includes a Netflix bundle?", ar: "أي باقة تعطيني 50GB مع نتفليكس؟" } },
      { who: "agent", text: { en: "Plan 'Smart Plus' has 60GB + Netflix Standard for AED 199/month. Want me to draft an upgrade request for review?", ar: "الباقة «سمارت بلس» 60GB + نتفليكس ستاندرد بـ 199 درهم/شهر. هل أصوغ طلب ترقية للمراجعة؟" } },
      { who: "customer", text: { en: "Yes please.", ar: "نعم من فضلك." } },
      { who: "agent", text: { en: "Drafted. You'll receive a confirmation SMS — review and reply YES to confirm.", ar: "تم الصياغة. ستستلم رسالة تأكيد — راجع وردّ بـ YES للتأكيد." } },
    ],
    qa: { passed: true, reason: { en: "Confirmation step kept the customer in control of the change.", ar: "خطوة التأكيد أبقت المتحكم القرار للعميل." } },
    escalation: null,
  },
];

const COPY = {
  eyebrow: { en: "Customer Care Multi-Agent", ar: "وكلاء خدمة العملاء" },
  title: {
    en: "Voice + chat + WhatsApp + email — one orchestrator, full QA trail.",
    ar: "صوت + دردشة + واتساب + بريد — منسّق واحد بسجل ضمان جودة كامل.",
  },
  intro: {
    en: "Boost containment per channel and the cost-per-contact, weekly volume, and CSAT recompute. Click a conversation to see the QA pass/fail with the policy citation.",
    ar: "ارفع نسبة الاحتواء لكل قناة فيُعاد حساب التكلفة لكل اتصال والحجم الأسبوعي وCSAT. اضغط محادثة لرؤية نتيجة ضمان الجودة مع مرجع السياسة.",
  },
  reset: { en: "Reset channels", ar: "إعادة القنوات" },
  scoreboard: { en: "Channel scoreboard", ar: "لوحة القنوات" },
  containment: { en: "Containment", ar: "الاحتواء" },
  volume: { en: "Weekly volume", ar: "الحجم الأسبوعي" },
  csat: { en: "CSAT", ar: "CSAT" },
  qa: { en: "QA pass", ar: "نجاح الجودة" },
  cpc: { en: "Cost per contact", ar: "تكلفة الاتصال" },
  raise: { en: "+5pp", ar: "+5pp" },
  lower: { en: "−5pp", ar: "−5pp" },
  conversations: { en: "Sample conversations", ar: "محادثات عيّنة" },
  qaPassed: { en: "QA passed", ar: "نجاح الجودة" },
  qaFailed: { en: "QA failed", ar: "إخفاق الجودة" },
  why: { en: "Reason", ar: "السبب" },
  escalation: { en: "Escalation", ar: "التصعيد" },
  totals: { en: "Operations totals (this week)", ar: "إجماليات التشغيل (هذا الأسبوع)" },
  contained: { en: "Contained by agent", ar: "محتوى بالوكيل" },
  toHuman: { en: "Routed to human", ar: "محوَّل لإنسان" },
  spend: { en: "Estimated weekly spend", ar: "الإنفاق الأسبوعي المقدّر" },
};

export default function CustomerCareDemo() {
  const { lang } = useLang();
  const [channels, setChannels] = useState<Channel[]>(() => INIT_CH.map((c) => ({ ...c })));
  const [picked, setPicked] = useState<string>("c2");

  const reset = () => setChannels(INIT_CH.map((c) => ({ ...c })));
  const adjust = (id: string, key: keyof Channel, delta: number) =>
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const nv = Math.max(0, Math.min(1, (c[key] as number) + delta));
        return { ...c, [key]: nv };
      }),
    );

  const totals = useMemo(() => {
    let contained = 0;
    let toHuman = 0;
    let spend = 0;
    let totalVol = 0;
    let weightedCsat = 0;
    for (const c of channels) {
      const cont = c.volume * c.containment;
      contained += cont;
      toHuman += c.volume - cont;
      spend += (c.volume - cont * 0.4) * c.costPerContact; // human cost dominates
      totalVol += c.volume;
      weightedCsat += c.csat * c.volume;
    }
    return {
      contained,
      toHuman,
      spend,
      avgCsat: totalVol > 0 ? weightedCsat / totalVol : 0,
      total: totalVol,
    };
  }, [channels]);

  const selected = CONVS.find((c) => c.id === picked) ?? CONVS[0];

  const trace: AgentLogEntry[] = useMemo(() => {
    const failed = CONVS.filter((c) => !c.qa.passed).length;
    return [
      { agentId: "intent-router", line: lang === "ar" ? `وجّه ${Math.round(totals.total).toLocaleString()} اتصالاً أسبوعياً عبر 4 قنوات.` : `Routed ${Math.round(totals.total).toLocaleString()} weekly contacts across 4 channels.` },
      { agentId: "resolution-agent", line: lang === "ar" ? `احتوى ${Math.round(totals.contained).toLocaleString()} وحوّل ${Math.round(totals.toHuman).toLocaleString()} لإنسان.` : `Contained ${Math.round(totals.contained).toLocaleString()}; handed ${Math.round(totals.toHuman).toLocaleString()} to humans.` },
      { agentId: "qa-critic", line: lang === "ar" ? `راجع المحادثات؛ ${failed} فشلت في ضمان الجودة.` : `Reviewed conversations; ${failed} failed QA.` },
      { agentId: "cost-telemetry", line: lang === "ar" ? `الإنفاق الأسبوعي المقدّر: ${Math.round(totals.spend).toLocaleString()} درهم.` : `Estimated weekly spend: AED ${Math.round(totals.spend).toLocaleString()}.` },
    ];
  }, [totals, lang]);

  return (
    <DemoShell
      slug="customer-care-hive"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#0F9ED5"
      Icon={Headphones}
      note={{
        en: "Agents draft, contain, and route. The QA reviewer sees every conversation. The agent never closes a billing dispute on its own.",
        ar: "تُصوغ الوكلاء وتحتوي وتوجّه. يرى مراجع الجودة كل محادثة. لا يغلق الوكيل نزاع فاتورة من تلقاء نفسه.",
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
      {/* Totals */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.totals, lang)}
          </p>
          <div className="grid sm:grid-cols-4 gap-4">
            <Tile
              label={tStr(COPY.contained, lang)}
              value={Math.round(totals.contained).toLocaleString("en-US")}
              sub={`${((totals.contained / totals.total) * 100).toFixed(0)}%`}
              color="#196B24"
            />
            <Tile
              label={tStr(COPY.toHuman, lang)}
              value={Math.round(totals.toHuman).toLocaleString("en-US")}
              color="#F5A623"
            />
            <Tile
              label={tStr({ en: "Blended CSAT", ar: "CSAT مزجي" }, lang)}
              value={`${totals.avgCsat.toFixed(1)}%`}
              color="#0F9ED5"
            />
            <Tile
              label={tStr(COPY.spend, lang)}
              value={`AED ${Math.round(totals.spend).toLocaleString("en-US")}`}
              color="#0E2841"
            />
          </div>
        </div>
      </section>

      {/* Scoreboard */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.scoreboard, lang)}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {channels.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-5">
                <p className="font-bold text-[#0E2841] text-base">{tStr(c.name, lang)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1 mb-3">
                  {tStr(COPY.volume, lang)}: {c.volume.toLocaleString("en-US")}
                </p>
                <Bar label={tStr(COPY.containment, lang)} value={c.containment * 100} />
                <Bar label={tStr(COPY.csat, lang)} value={c.csat} />
                <Bar label={tStr(COPY.qa, lang)} value={c.qaPass * 100} />
                <p className="text-xs font-bold text-[#0E2841] mt-2">
                  {tStr(COPY.cpc, lang)}: AED {c.costPerContact.toFixed(2)}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => adjust(c.id, "containment", 0.05)}
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-200 hover:border-[#196B24] hover:text-[#196B24] text-gray-500"
                  >
                    {tStr(COPY.raise, lang)}
                  </button>
                  <button
                    onClick={() => adjust(c.id, "containment", -0.05)}
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-200 hover:border-[#B91C1C] hover:text-[#B91C1C] text-gray-500"
                  >
                    {tStr(COPY.lower, lang)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Conversations */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-3 gap-5">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
              {tStr(COPY.conversations, lang)}
            </p>
            {CONVS.map((c) => {
              const active = picked === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setPicked(c.id)}
                  className={`w-full text-start bg-white rounded-2xl border-2 p-3 transition-colors ${
                    active ? "border-[#0F9ED5]" : "border-transparent hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {tStr(channels.find((x) => x.id === c.channel)!.name, lang)}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full text-white ms-auto"
                      style={{ backgroundColor: c.qa.passed ? "#196B24" : "#B91C1C" }}
                    >
                      {c.qa.passed ? "QA ✓" : "QA ✗"}
                    </span>
                  </div>
                  <p className="font-bold text-[#0E2841] text-sm">{tStr(c.intent, lang)}</p>
                </button>
              );
            })}
          </div>
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <MessageSquare size={16} className="text-[#0F9ED5]" />
              <p className="font-bold text-[#0E2841]">{tStr(selected.intent, lang)}</p>
              <span
                className="ms-auto text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: selected.qa.passed ? "#196B24" : "#B91C1C" }}
              >
                {selected.qa.passed ? tStr(COPY.qaPassed, lang) : tStr(COPY.qaFailed, lang)}
              </span>
            </div>
            <div className="p-5 space-y-3 text-sm">
              {selected.steps.map((s, i) => (
                <div
                  key={i}
                  className={`max-w-[80%] rounded-2xl px-4 py-2 leading-relaxed ${
                    s.who === "customer"
                      ? "bg-gray-100 text-gray-800 me-auto"
                      : s.who === "agent"
                        ? "bg-[#0F9ED5]/10 text-[#0E2841] ms-auto"
                        : "bg-[#F5A623]/15 text-[#0E2841] ms-auto"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">
                    {s.who}
                  </p>
                  {tStr(s.text, lang)}
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-[#F8F9FA] text-xs text-gray-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-[#F5A623]" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {tStr(COPY.why, lang)}
                </p>
                <p>{tStr(selected.qa.reason, lang)}</p>
                {selected.escalation && (
                  <p className="mt-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                      {tStr(COPY.escalation, lang)}:
                    </span>{" "}
                    {tStr(selected.escalation, lang)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="customer-care-hive" log={trace} accent="#0F9ED5" />
        </div>
      </section>
    </DemoShell>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const color = value >= 75 ? "#196B24" : value >= 55 ? "#F5A623" : "#B91C1C";
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">
        <span>{label}</span>
        <span style={{ color }}>{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      <p className="text-2xl font-extrabold leading-tight" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">{sub}</p>}
    </div>
  );
}
