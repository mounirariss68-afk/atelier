import { useMemo, useState } from "react";
import { BookOpen, RotateCcw, Lock, FileText, ShieldCheck } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import DemoShell from "./DemoShell";
import AgentTrace, { type AgentLogEntry } from "./AgentTrace";

type Permission = "public" | "employee" | "manager" | "executive";
type Persona = "executive" | "manager" | "employee";

interface Source {
  id: string;
  title: { en: string; ar: string };
  permission: Permission;
  domain: string;
  excerpt: { en: string; ar: string };
}

interface Question {
  id: string;
  q: { en: string; ar: string };
  expectedSourceIds: string[];
  baseAnswer: { en: string; ar: string };
}

const SOURCES: Source[] = [
  {
    id: "s1",
    title: { en: "AI strategy white paper v3.1", ar: "ورقة استراتيجية الذكاء الاصطناعي 3.1" },
    permission: "employee",
    domain: "Strategy",
    excerpt: {
      en: "We will publish three flagship agents in 2026 and operate them under the sovereign-cloud charter.",
      ar: "سننشر ثلاثة وكلاء رئيسيين عام 2026 ونشغّلهم وفق ميثاق السحابة السيادية.",
    },
  },
  {
    id: "s2",
    title: { en: "Board pack — March 2026", ar: "عبوة المجلس — مارس 2026" },
    permission: "executive",
    domain: "Finance",
    excerpt: {
      en: "Q1 EBITDA AED 412M, +6% vs AOP. Capex envelope re-baselined at 280M for the year.",
      ar: "EBITDA الربع الأول 412 مليون، +6% مقابل AOP. غطاء الإنفاق الرأسمالي أُعيد إلى 280 مليوناً للسنة.",
    },
  },
  {
    id: "s3",
    title: { en: "Code of conduct (public)", ar: "ميثاق السلوك (عام)" },
    permission: "public",
    domain: "Governance",
    excerpt: {
      en: "All employees and partners adhere to a zero-tolerance policy on conflicts of interest.",
      ar: "يلتزم كل الموظفين والشركاء بسياسة لا تسامح مع تضارب المصالح.",
    },
  },
  {
    id: "s4",
    title: { en: "Manager's HR playbook", ar: "دليل HR للمديرين" },
    permission: "manager",
    domain: "People",
    excerpt: {
      en: "Salary review windows open in May and November; calibration uses the 5-band performance framework.",
      ar: "نافذتا مراجعة الرواتب في مايو ونوفمبر؛ المعايرة تستخدم إطار الأداء بخمس فئات.",
    },
  },
  {
    id: "s5",
    title: { en: "Customer service runbook (public)", ar: "كتاب تشغيل خدمة العملاء (عام)" },
    permission: "public",
    domain: "Service",
    excerpt: {
      en: "Tier-1 calls follow the 4-step verify–understand–resolve–confirm pattern.",
      ar: "مكالمات المستوى الأول تتبع النمط: تحقّق–فهم–حلّ–تأكيد.",
    },
  },
];

const QUESTIONS: Question[] = [
  {
    id: "q1",
    q: { en: "What's our AI strategy for 2026?", ar: "ما استراتيجية الذكاء الاصطناعي لعام 2026؟" },
    expectedSourceIds: ["s1"],
    baseAnswer: {
      en: "We will publish three flagship agents in 2026 and operate them under the sovereign-cloud charter — see source [s1].",
      ar: "سننشر ثلاثة وكلاء رئيسيين عام 2026 ونشغّلهم وفق ميثاق السحابة السيادية — راجع المصدر [s1].",
    },
  },
  {
    id: "q2",
    q: { en: "What was our Q1 EBITDA vs plan?", ar: "كيف كان EBITDA الربع الأول مقابل الخطة؟" },
    expectedSourceIds: ["s2"],
    baseAnswer: {
      en: "Q1 EBITDA AED 412M, 6% above AOP, with capex re-baselined to 280M for the year — board pack [s2].",
      ar: "EBITDA الربع الأول 412 مليون درهم، أعلى من AOP بـ 6%، مع إعادة معايرة الإنفاق إلى 280 مليوناً — عبوة المجلس [s2].",
    },
  },
  {
    id: "q3",
    q: { en: "When are the salary review windows?", ar: "متى نوافذ مراجعة الرواتب؟" },
    expectedSourceIds: ["s4"],
    baseAnswer: {
      en: "Salary reviews open in May and November and use the 5-band performance framework — manager playbook [s4].",
      ar: "نوافذ المراجعة في مايو ونوفمبر باستخدام إطار خمسة بنود — دليل المدير [s4].",
    },
  },
  {
    id: "q4",
    q: { en: "How do tier-1 calls work?", ar: "كيف تعمل مكالمات المستوى الأول؟" },
    expectedSourceIds: ["s5"],
    baseAnswer: {
      en: "Tier-1 follows the 4-step verify–understand–resolve–confirm pattern — runbook [s5].",
      ar: "المستوى الأول يتبع النمط: تحقّق–فهم–حلّ–تأكيد — كتاب التشغيل [s5].",
    },
  },
];

const PERMISSION_RANK: Record<Permission, number> = {
  public: 0,
  employee: 1,
  manager: 2,
  executive: 3,
};

const PERMISSION_COLOR: Record<Permission, string> = {
  public: "#196B24",
  employee: "#156082",
  manager: "#F5A623",
  executive: "#B91C1C",
};

const COPY = {
  eyebrow: { en: "Knowledge Memory Agent", ar: "وكيل ذاكرة المعرفة" },
  title: {
    en: "Cited answers — through the user's permission lens.",
    ar: "إجابات مع المراجع — من خلال صلاحية المستخدم.",
  },
  intro: {
    en: "Switch the asking persona and watch the same question return a different answer set: sources you cannot see are filtered out and the agent says so explicitly.",
    ar: "بدّل شخصية السائل وراقب أنّ السؤال نفسه يُعيد إجابة مختلفة: المصادر التي لا يحقّ لك رؤيتها تُستبعد ويصرّح الوكيل بذلك.",
  },
  reset: { en: "Reset", ar: "إعادة" },
  persona: { en: "Asking persona", ar: "شخصية السائل" },
  questions: { en: "Pick a question", ar: "اختر سؤالاً" },
  answer: { en: "Cited answer", ar: "إجابة بالمصادر" },
  filtered: { en: "Filtered for permission", ar: "تصفية حسب الصلاحية" },
  sources: { en: "Sources", ar: "المصادر" },
  coverage: { en: "Source coverage", ar: "تغطية المصادر" },
  visible: { en: "Visible to persona", ar: "مرئية للشخصية" },
  hidden: { en: "Hidden", ar: "مخفية" },
  noSources: { en: "No sources visible to this persona answer the question — refused with citation policy.", ar: "لا مصادر مرئية لهذه الشخصية تجيب على السؤال — رفض بسياسة الاستشهاد." },
  refused: { en: "I cannot answer this fully — the relevant source is restricted to a higher permission level.", ar: "لا أستطيع الإجابة كاملاً — المصدر ذو الصلة محدود لمستوى صلاحية أعلى." },
};

export default function KnowledgeMemoryDemo() {
  const { lang } = useLang();
  const [persona, setPersona] = useState<Persona>("manager");
  const [pickedQ, setPickedQ] = useState<string>("q2");

  const reset = () => {
    setPersona("manager");
    setPickedQ("q2");
  };

  const visibleSources = useMemo(() => {
    const personaRank = PERMISSION_RANK[persona === "employee" ? "employee" : persona === "manager" ? "manager" : "executive"];
    return SOURCES.filter((s) => PERMISSION_RANK[s.permission] <= personaRank);
  }, [persona]);

  const question = QUESTIONS.find((q) => q.id === pickedQ) ?? QUESTIONS[0];

  const visibleExpected = visibleSources.filter((s) => question.expectedSourceIds.includes(s.id));
  const hiddenExpected = SOURCES.filter(
    (s) => question.expectedSourceIds.includes(s.id) && !visibleSources.some((v) => v.id === s.id),
  );

  const personaLabel: Record<Persona, { en: string; ar: string }> = {
    executive: { en: "Executive", ar: "تنفيذي" },
    manager: { en: "Manager", ar: "مدير" },
    employee: { en: "Employee", ar: "موظف" },
  };

  const trace: AgentLogEntry[] = useMemo(() => {
    return [
      { agentId: "ingestor", line: lang === "ar" ? `فهرس ${SOURCES.length} مصدر معرفي.` : `Indexed ${SOURCES.length} knowledge sources.` },
      { agentId: "permission-filter", line: lang === "ar" ? `${visibleSources.length} مصدر مرئي لـ${tStr(personaLabel[persona], lang)}.` : `${visibleSources.length} sources visible to the ${tStr(personaLabel[persona], lang)} persona.` },
      { agentId: "semantic-retriever", line: lang === "ar" ? "استرجع المصادر المتوقّعة لهذا السؤال." : "Retrieved the expected sources for this question." },
      { agentId: "grounded-drafter", line: visibleExpected.length > 0 ? (lang === "ar" ? `صاغ إجابة بالاستشهادات من ${visibleExpected.length} مصدر مرئي.` : `Composed a cited answer from ${visibleExpected.length} visible source(s).`) : (lang === "ar" ? "رفض الإجابة — لا مصادر مرئية تجيب على السؤال." : "Refused the answer — no visible source covers this question.") },
      { agentId: "coverage-monitor", line: hiddenExpected.length > 0 ? (lang === "ar" ? `${hiddenExpected.length} مصدر متعلّق مخفي بسبب الصلاحية.` : `${hiddenExpected.length} relevant source(s) hidden by the permission lens.`) : (lang === "ar" ? "تغطية كاملة عند هذا المستوى." : "Full source coverage at this permission level.") },
    ];
  }, [persona, visibleSources, visibleExpected, hiddenExpected, lang]);

  return (
    <DemoShell
      slug="enterprise-knowledge-concierge"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      intro={COPY.intro}
      accent="#156082"
      Icon={BookOpen}
      note={{
        en: "The agent never invents sources. If a relevant source is not visible to the persona, the agent says so by name and refuses the answer.",
        ar: "لا يخترع الوكيل أبداً مصادر. إن لم يكن المصدر مرئياً للشخصية، يذكر ذلك صراحة ويرفض الإجابة.",
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
      {/* Persona selector */}
      <section className="py-10 bg-[#F8F9FA] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            {tStr(COPY.persona, lang)}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["executive", "manager", "employee"] as Persona[]).map((p) => {
              const active = persona === p;
              return (
                <button
                  key={p}
                  onClick={() => setPersona(p)}
                  className={`text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full border transition-colors ${
                    active
                      ? "bg-[#0E2841] text-white border-[#0E2841]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#0E2841]"
                  }`}
                >
                  {tStr(personaLabel[p], lang)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-3 inline-flex items-center gap-2">
            <Lock size={12} /> {tStr(COPY.visible, lang)}: {visibleSources.length} / {SOURCES.length}{" "}
            {tStr(COPY.sources, lang).toLowerCase()}
          </p>
        </div>
      </section>

      {/* Q + A */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
              {tStr(COPY.questions, lang)}
            </p>
            <div className="space-y-2">
              {QUESTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setPickedQ(q.id)}
                  className={`w-full text-start bg-white rounded-2xl border-2 p-3 text-sm transition-colors ${
                    pickedQ === q.id ? "border-[#0E2841]" : "border-transparent hover:border-gray-200"
                  }`}
                >
                  <p className="font-bold text-[#0E2841]">{tStr(q.q, lang)}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3 inline-flex items-center gap-2">
              <FileText size={14} /> {tStr(COPY.answer, lang)}
            </p>
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-700 leading-relaxed space-y-3">
              <p className="font-extrabold text-[#0E2841]">{tStr(question.q, lang)}</p>
              {visibleExpected.length === 0 ? (
                <>
                  <p className="text-[#B91C1C] font-bold">{tStr(COPY.refused, lang)}</p>
                  <p className="text-xs text-gray-500 italic">{tStr(COPY.noSources, lang)}</p>
                </>
              ) : (
                <p>{tStr(question.baseAnswer, lang)}</p>
              )}
              {hiddenExpected.length > 0 && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                  {tStr(COPY.hidden, lang)}: {hiddenExpected.map((h) => h.id).join(", ")} (
                  {tStr(COPY.filtered, lang)})
                </p>
              )}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  {tStr(COPY.sources, lang)}
                </p>
                <ul className="space-y-1.5 text-xs">
                  {visibleExpected.map((s) => (
                    <li key={s.id} className="flex items-start gap-2">
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white mt-0.5"
                        style={{ backgroundColor: PERMISSION_COLOR[s.permission] }}
                      >
                        {s.permission}
                      </span>
                      <span>
                        <span className="font-semibold text-[#0E2841]">[{s.id}]</span>{" "}
                        {tStr(s.title, lang)} — “{tStr(s.excerpt, lang)}”
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Coverage matrix */}
      <section className="py-10 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 inline-flex items-center gap-2">
            <ShieldCheck size={14} /> {tStr(COPY.coverage, lang)}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 bg-[#0E2841] text-white text-[10px] uppercase tracking-widest font-bold">
              <span className="col-span-1">id</span>
              <span className="col-span-4">{tStr({ en: "Title", ar: "العنوان" }, lang)}</span>
              <span className="col-span-2">{tStr({ en: "Permission", ar: "الصلاحية" }, lang)}</span>
              <span className="col-span-2">{tStr({ en: "Domain", ar: "النطاق" }, lang)}</span>
              <span className="col-span-3">{tStr({ en: "Persona view", ar: "عرض الشخصية" }, lang)}</span>
            </div>
            {SOURCES.map((s) => {
              const visible = visibleSources.some((v) => v.id === s.id);
              return (
                <div
                  key={s.id}
                  className="grid grid-cols-12 px-4 py-3 border-t border-gray-100 items-center text-xs text-gray-700"
                >
                  <span className="col-span-1 font-bold text-[#0E2841]">{s.id}</span>
                  <span className="col-span-4">{tStr(s.title, lang)}</span>
                  <span className="col-span-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: PERMISSION_COLOR[s.permission] }}
                    >
                      {s.permission}
                    </span>
                  </span>
                  <span className="col-span-2">{s.domain}</span>
                  <span className="col-span-3">
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: visible ? "#196B24" : "#94A3B8",
                        color: "white",
                      }}
                    >
                      {visible ? tStr(COPY.visible, lang) : tStr(COPY.hidden, lang)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AgentTrace slug="enterprise-knowledge-concierge" log={trace} accent="#156082" />
        </div>
      </section>
    </DemoShell>
  );
}
