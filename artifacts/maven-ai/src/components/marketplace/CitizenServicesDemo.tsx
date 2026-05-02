import { useMemo, useState } from "react";
import { Users, RotateCcw, ShieldCheck, FileText, ArrowRight } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";

interface Reply {
  agent: string;
  citation: { en: string; ar: string };
}

interface Scenario {
  id: string;
  title: { en: string; ar: string };
  intent: { en: string; ar: string };
  dialect: string;
  confidence: number; // 0-100
  utterance: { en: string; ar: string };
  reply: { en: string; ar: string };
  citation: { en: string; ar: string };
  escalate: boolean;
  escalationReason: { en: string; ar: string };
}

const SCENARIOS: Scenario[] = [
  {
    id: "renew-license",
    title: { en: "Renew commercial licence", ar: "تجديد رخصة تجارية" },
    intent: { en: "License renewal — SME", ar: "تجديد رخصة — منشأة صغيرة" },
    dialect: "khaleeji",
    confidence: 92,
    utterance: {
      en: "I need to renew my company's licence — it expires next month.",
      ar: "أبغى أجدد رخصة شركتي — تنتهي الشهر الجاي.",
    },
    reply: {
      en: "You can renew online if your trade name and lease tenancy contract are current. The fee is AED 1,200 plus market fees. Renewal is processed within two business days.",
      ar: "يمكنك التجديد إلكترونياً إذا كان الاسم التجاري وعقد الإيجار سارَيين. الرسوم 1,200 درهم بالإضافة إلى رسوم السوق. تتم المعالجة خلال يومَي عمل.",
    },
    citation: { en: "Service Catalogue v4.2 — §4.1 Commercial licence renewal", ar: "دليل الخدمات الإصدار 4.2 — البند 4.1 تجديد رخصة تجارية" },
    escalate: false,
    escalationReason: { en: "—", ar: "—" },
  },
  {
    id: "tenancy-dispute",
    title: { en: "Tenancy dispute — escalate", ar: "نزاع إيجار — تصعيد" },
    intent: { en: "Tenancy dispute — high sensitivity", ar: "نزاع إيجار — حساسية عالية" },
    dialect: "khaleeji",
    confidence: 67,
    utterance: {
      en: "My landlord raised the rent 40% with no notice — what are my rights?",
      ar: "مالك العقار رفع الإيجار 40% بدون إشعار — وش حقوقي؟",
    },
    reply: {
      en: "I will route you to a tenancy specialist. While I do that, here is the published rent-cap calculator and the dispute committee's intake form.",
      ar: "سأحوّلك إلى أخصائي تأجير. في أثناء ذلك، إليك حاسبة سقف الإيجار المنشورة ونموذج استلام لجنة الفصل.",
    },
    citation: { en: "Decree №43 of 2013 (Rent Cap) + Tenancy Disputes Committee intake", ar: "المرسوم رقم 43 لسنة 2013 (سقف الإيجار) + استلام لجنة فضّ نزاعات التأجير" },
    escalate: true,
    escalationReason: { en: "Confidence below 75% threshold + sensitive category", ar: "الثقة أقل من عتبة 75% + فئة حسّاسة" },
  },
  {
    id: "labor-card",
    title: { en: "Replace lost labour card", ar: "استبدال بطاقة عمل مفقودة" },
    intent: { en: "Document replacement", ar: "استبدال وثيقة" },
    dialect: "egyptian",
    confidence: 88,
    utterance: {
      en: "I lost my labour card — how do I get a new one?",
      ar: "ضيّعت بطاقة العمل — أعمل إيه عشان أطلع واحدة جديدة؟",
    },
    reply: {
      en: "File a lost-document report at any service centre, then submit form L-04 with your Emirates ID. The replacement card is issued within three working days for AED 200.",
      ar: "قدّم بلاغ فقدان في أي مركز خدمة، ثم أرفق نموذج L-04 مع الهوية الإماراتية. تُصدر البطاقة البديلة خلال ثلاثة أيام عمل برسوم 200 درهم.",
    },
    citation: { en: "Service Catalogue v4.2 — §11.7 Replacement of identity documents", ar: "دليل الخدمات 4.2 — البند 11.7 استبدال وثائق الهوية" },
    escalate: false,
    escalationReason: { en: "—", ar: "—" },
  },
  {
    id: "out-of-scope",
    title: { en: "Out-of-scope (refer)", ar: "خارج النطاق (تحويل)" },
    intent: { en: "Federal traffic fine — out of scope", ar: "مخالفة مرور اتحادية — خارج النطاق" },
    dialect: "levantine",
    confidence: 95,
    utterance: {
      en: "Can you waive my speeding ticket from yesterday?",
      ar: "ممكن تشطبلي مخالفة السرعة من أمس؟",
    },
    reply: {
      en: "Traffic fines are handled by the federal police portal — I cannot waive or amend them. I have prepared the direct link to their objection form.",
      ar: "تُدار مخالفات المرور عبر بوابة الشرطة الاتحادية — لا أستطيع شطبها أو تعديلها. أعددت لك الرابط المباشر لنموذج الاعتراض.",
    },
    citation: { en: "Out-of-scope policy §2.3 — Refer to federal authority", ar: "سياسة خارج النطاق البند 2.3 — التحويل إلى الجهة الاتحادية" },
    escalate: false,
    escalationReason: { en: "—", ar: "—" },
  },
];

const COPY = {
  eyebrow: { en: "Citizen Services Agent", ar: "وكيل خدمات المواطنين" },
  title: {
    en: "Bilingual EN/AR multi-turn agent — air-gapped, cited, regulator-defensible.",
    ar: "وكيل ثنائي اللغة معزول السيادة، يستشهد بالمصادر، وقابل للدفاع تنظيمياً.",
  },
  intro: {
    en: "Pick a citizen scenario, change the inferred dialect or confidence, and the agent's escalation logic re-evaluates instantly. Every reply carries a citation back to the published policy.",
    ar: "اختر سيناريو مواطن، عدّل اللهجة أو نسبة الثقة، وأعِد تقييم منطق التصعيد فوراً. كل ردّ يحمل مرجعاً للسياسة المنشورة.",
  },
  reset: { en: "Reset scenarios", ar: "إعادة ضبط" },
  conversations: { en: "Live conversations", ar: "محادثات حية" },
  intent: { en: "Intent", ar: "النية" },
  dialect: { en: "Dialect", ar: "اللهجة" },
  confidence: { en: "Confidence", ar: "الثقة" },
  citizen: { en: "Citizen", ar: "المواطن" },
  agent: { en: "Agent", ar: "الوكيل" },
  citation: { en: "Citation", ar: "المرجع" },
  decision: { en: "Routing decision", ar: "قرار التوجيه" },
  resolved: { en: "Resolved by agent", ar: "حلّها الوكيل" },
  escalated: { en: "Escalated to a human officer", ar: "مُحوَّلة إلى موظف بشري" },
  why: { en: "Why", ar: "السبب" },
  audit: { en: "Audit packet", ar: "حزمة التدقيق" },
  auditNote: {
    en: "Per-conversation packet a regulator can subpoena: prompt, dialect tag, confidence, citation, and the routing decision.",
    ar: "حزمة لكل محادثة يمكن للجهة التنظيمية طلبها: المطالبة، اللهجة، الثقة، المرجع، وقرار التوجيه.",
  },
  raise: { en: "Raise confidence", ar: "ارفع الثقة" },
  lower: { en: "Lower confidence", ar: "اخفض الثقة" },
  toggleEsc: { en: "Force escalation", ar: "فرض التصعيد" },
  rule: {
    en: "Rule: escalate to a human officer when confidence < 75% OR the intent falls into a sensitive category.",
    ar: "القاعدة: تصعيد إلى موظف بشري عند الثقة < 75% أو إذا كانت النية ضمن فئة حساسة.",
  },
};

const DIALECTS = ["khaleeji", "egyptian", "levantine", "msa"] as const;
type Dialect = (typeof DIALECTS)[number];

export default function CitizenServicesDemo() {
  const { lang } = useLang();
  const [scenarios, setScenarios] = useState<Scenario[]>(() => SCENARIOS.map((s) => ({ ...s })));

  const reset = () => setScenarios(SCENARIOS.map((s) => ({ ...s })));

  const summary = useMemo(() => {
    const escalated = scenarios.filter((s) => effectiveEscalate(s)).length;
    const resolved = scenarios.length - escalated;
    const avg = Math.round(scenarios.reduce((a, s) => a + s.confidence, 0) / scenarios.length);
    return { escalated, resolved, avg };
  }, [scenarios]);

  const updateConf = (id: string, delta: number) =>
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, confidence: Math.max(0, Math.min(100, s.confidence + delta)) } : s,
      ),
    );

  const cycleDialect = (id: string) =>
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const idx = DIALECTS.indexOf(s.dialect as Dialect);
        const next = DIALECTS[(idx + 1) % DIALECTS.length];
        return { ...s, dialect: next };
      }),
    );

  const toggleEscalate = (id: string) =>
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, escalate: !s.escalate } : s)));

  const trace: AgentLogEntry[] = useMemo(() => {
    const dialects = new Set(scenarios.map((s) => s.dialect)).size;
    return [
      { agentId: "dialect-tagger", line: lang === "ar" ? `رصد ${dialects} لهجة عبر ${scenarios.length} محادثة نشطة.` : `Detected ${dialects} dialect(s) across ${scenarios.length} active conversations.` },
      { agentId: "policy-retriever", line: lang === "ar" ? "سحب الاستشهاد بالسياسة لكل نية." : "Pulled the policy citation for each intent." },
      { agentId: "response-drafter", line: lang === "ar" ? `صاغ ردوداً ثنائية اللغة لـ${scenarios.length} مواطن.` : `Drafted bilingual replies for ${scenarios.length} citizens.` },
      { agentId: "confidence-scorer", line: lang === "ar" ? `متوسط الثقة ${summary.avg}%؛ ${summary.escalated} دون عتبة الـ75%.` : `Avg confidence ${summary.avg}%; ${summary.escalated} below the 75% threshold.` },
      { agentId: "audit-packetizer", line: lang === "ar" ? `أُغلقت ${scenarios.length} حزمة تدقيق جاهزة لأي طلب رقابي.` : `Sealed ${scenarios.length} audit packets ready for regulator subpoena.` },
    ];
  }, [scenarios, summary, lang]);

  return (
    <DemoShell
      slug="citizen-services-agent"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#0F9ED5"
      Icon={Users}
      note={COPY.rule}
      toolbar={
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-[#0E2841] hover:text-[#0E2841] transition-colors"
        >
          <RotateCcw size={14} /> {tStr(COPY.reset, lang)}
        </button>
      }
    >
      {/* Summary */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-3 gap-4">
          <Tile
            label={tStr(COPY.resolved, lang)}
            value={`${summary.resolved} / ${scenarios.length}`}
            color="#196B24"
            icon={<ShieldCheck size={16} />}
          />
          <Tile
            label={tStr(COPY.escalated, lang)}
            value={`${summary.escalated} / ${scenarios.length}`}
            color="#F5A623"
            icon={<ArrowRight size={16} />}
          />
          <Tile
            label={tStr({ en: "Avg confidence", ar: "متوسط الثقة" }, lang)}
            value={`${summary.avg}%`}
            color="#0F9ED5"
            icon={<FileText size={16} />}
          />
        </div>
      </section>

      {/* Conversations */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
            {tStr(COPY.conversations, lang)}
          </p>
          <div className="grid lg:grid-cols-2 gap-5">
            {scenarios.map((s) => {
              const escalated = effectiveEscalate(s);
              return (
                <div
                  key={s.id}
                  className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-[#0E2841] mb-1">{tStr(s.title, lang)}</h3>
                      <div className="flex flex-wrap gap-1.5">
                        <Pill label={tStr(COPY.intent, lang)} value={tStr(s.intent, lang)} />
                        <Pill
                          label={tStr(COPY.dialect, lang)}
                          value={s.dialect}
                          onClick={() => cycleDialect(s.id)}
                        />
                        <Pill
                          label={tStr(COPY.confidence, lang)}
                          value={`${s.confidence}%`}
                          color={s.confidence >= 75 ? "#196B24" : "#B91C1C"}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="p-5 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                        {tStr(COPY.citizen, lang)}
                      </p>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        “{tStr(s.utterance, lang)}”
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#0F9ED5] mb-1">
                        {tStr(COPY.agent, lang)}
                      </p>
                      <p className="text-sm text-[#0E2841] leading-relaxed">
                        {tStr(s.reply, lang)}
                      </p>
                    </div>
                    <div className="border-t border-gray-100 pt-3 text-xs text-gray-500 flex items-start gap-2">
                      <FileText size={14} className="mt-0.5 text-[#F5A623] flex-shrink-0" />
                      <span>
                        <span className="font-bold uppercase tracking-widest text-[10px] text-gray-400 me-1">
                          {tStr(COPY.citation, lang)}:
                        </span>
                        {tStr(s.citation, lang)}
                      </span>
                    </div>
                  </div>
                  <div className="px-5 py-3 bg-[#F8F9FA] flex items-center gap-3 border-t border-gray-100">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
                      style={{ backgroundColor: escalated ? "#F5A623" : "#196B24" }}
                    >
                      {escalated ? tStr(COPY.escalated, lang) : tStr(COPY.resolved, lang)}
                    </span>
                    {escalated && (
                      <span className="text-xs text-gray-500 truncate">
                        {tStr(COPY.why, lang)}: {effectiveReason(s, lang)}
                      </span>
                    )}
                    <div className="ms-auto flex items-center gap-1">
                      <SmallBtn onClick={() => updateConf(s.id, +5)} label="+5%" />
                      <SmallBtn onClick={() => updateConf(s.id, -10)} label="−10%" />
                      <SmallBtn
                        onClick={() => toggleEscalate(s.id)}
                        label={tStr(COPY.toggleEsc, lang)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Audit */}
      <section className="py-12 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            {tStr(COPY.audit, lang)}
          </p>
          <p className="text-xs text-gray-500 mb-4 max-w-3xl leading-relaxed">
            {tStr(COPY.auditNote, lang)}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden font-mono text-xs">
            <div className="grid grid-cols-12 px-4 py-2 bg-[#0E2841] text-white text-[10px] uppercase tracking-widest font-bold">
              <span className="col-span-3">{tStr(COPY.intent, lang)}</span>
              <span className="col-span-2">{tStr(COPY.dialect, lang)}</span>
              <span className="col-span-2">{tStr(COPY.confidence, lang)}</span>
              <span className="col-span-3">{tStr(COPY.citation, lang)}</span>
              <span className="col-span-2">{tStr(COPY.decision, lang)}</span>
            </div>
            {scenarios.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-12 px-4 py-2 border-t border-gray-100 text-gray-700 items-center"
              >
                <span className="col-span-3 truncate">{tStr(s.intent, lang)}</span>
                <span className="col-span-2">{s.dialect}</span>
                <span className="col-span-2">{s.confidence}%</span>
                <span className="col-span-3 truncate">{tStr(s.citation, lang)}</span>
                <span
                  className="col-span-2 font-bold text-[10px] uppercase tracking-widest"
                  style={{ color: effectiveEscalate(s) ? "#F5A623" : "#196B24" }}
                >
                  {effectiveEscalate(s) ? "escalate" : "resolve"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="citizen-services-agent" log={trace} accent="#0F9ED5" />
        </div>
      </section>
    </DemoShell>
  );
}

function effectiveEscalate(s: Scenario): boolean {
  return s.escalate || s.confidence < 75;
}

function effectiveReason(s: Scenario, lang: "en" | "ar"): string {
  if (s.confidence < 75) return tStr({ en: "Confidence below 75%", ar: "الثقة أقل من 75%" }, lang);
  return tStr(s.escalationReason, lang);
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
      <p className="text-2xl font-extrabold" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Pill({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: string;
  color?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
        onClick ? "hover:border-[#0E2841]" : ""
      }`}
      style={{ borderColor: color ?? "#E5E7EB", color: color ?? "#475569" }}
    >
      <span className="opacity-60">{label}:</span>
      <span>{value}</span>
    </Comp>
  );
}

function SmallBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border border-gray-200 hover:border-[#0E2841] hover:text-[#0E2841] text-gray-500"
    >
      {label}
    </button>
  );
}
