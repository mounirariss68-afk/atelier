import type { DemoLang } from "./DemoLangContext";
import type { PersonaId } from "@/data/enterprise-knowledge-seed";
import type { AgentId } from "@/data/enterprise-knowledge-agent";

export type ChatResponseType =
  | "text"
  | "answer"      // grounded answer with citations + withholds + confidence
  | "refusal"     // defensible refusal with escalation CTA
  | "list"
  | "navigate"
  | "personaSwitch"
  | "escalation";

export interface CitedClaim {
  text: { en: string; ar: string };
  sourceIds: string[];
}

export interface ChatResponse {
  agent: AgentId;
  /** Optional secondary "audited by" / "scored by" agents shown in the byline. */
  bylineAgents?: AgentId[];
  type: ChatResponseType;
  text: string;
  data?: {
    items?: string[];
    claims?: CitedClaim[];
    consideredSourceIds?: string[];   // every source the agent retrieved (cited + withheld)
    citedSourceIds?: string[];        // sources that ended up cited in the answer
    withheldSourceIds?: string[];     // hidden-but-relevant
    confidence?: number;              // 0-100
    escalationTo?: { en: string; ar: string };
    refusalReason?: { en: string; ar: string };
    navigateTo?: string;
    switchPersonaTo?: PersonaId;
  };
}

interface Intent {
  patterns: RegExp[];
  handler: (lang: DemoLang, personaId: PersonaId) => ChatResponse;
}

function pick(lang: DemoLang, en: string, ar: string) {
  return lang === "en" ? en : ar;
}

// Sources used in the EGP exposure scripted answer
const EGP_CONSIDERED = [
  "treasury-weekly-2026-04-28",
  "fx-hedging-policy-v3",
  "ifrs9-ecl-run-q1-2026",
  "ar-ageing-april-2026",
  "cfo-board-pack-apr-qa",
  "egp-exposure-ledger-q1",
  "egp-litigation-memo-2026-04",      // legal-privileged → withheld for non-legal
  "jv-rescue-term-sheet-draft",       // legal-privileged → withheld for non-legal
];

const EGP_CITED_FOR_FINANCE = [
  "treasury-weekly-2026-04-28",
  "fx-hedging-policy-v3",
  "ifrs9-ecl-run-q1-2026",
  "ar-ageing-april-2026",
  "egp-exposure-ledger-q1",
];

function egpAnswer(lang: DemoLang, personaId: PersonaId): ChatResponse {
  // Decide who can answer this. CFO + Treasury get the full grounded answer;
  // Legal gets the legal-privileged angle; Junior + Consultant get a refusal.
  if (personaId === "cfo") {
    return {
      agent: "draft",
      bylineAgents: ["audit", "conf"],
      type: "answer",
      text: pick(lang,
        "Group exposure on EGP receivables is USD 18.4M as of 28 Apr — USD 11.2M hedged, USD 7.2M open in Egypt B2G. Q1 ECL uplift AED 4.6M.",
        "تعرّض المجموعة على ذمم الجنيه 18.4M$ في 28 أبريل — 11.2M متحوّط و7.2M مفتوح في الفرع المصري. رفع IFRS-9 للربع 1 = 4.6M درهم."),
      data: {
        claims: [
          {
            text: {
              en: "Group exposure to the EGP move on receivables is USD 18.4M as of 28 Apr [1], of which USD 11.2M is hedged via NDFs and USD 7.2M sits open in the Egypt B2G subsidiary [2].",
              ar: "تعرّض المجموعة 18.4M دولار في 28 أبريل [1]، منه 11.2M متحوّط عبر NDF و7.2M مفتوح في الفرع المصري [2].",
            },
            sourceIds: ["treasury-weekly-2026-04-28", "fx-hedging-policy-v3"],
          },
          {
            text: {
              en: "The Q1 ledger booked AED 4.6M IFRS-9 ECL uplift on the open exposure [3], driven by the Stage-2 trigger in Egypt B2G's 60-90d AR ageing band [4].",
              ar: "حجزت Q1 رفعاً 4.6M درهم بحسب IFRS-9 على التعرّض المفتوح [3]، مدفوعاً بالانتقال للمرحلة 2 في تقادم 60-90 يوماً [4].",
            },
            sourceIds: ["ifrs9-ecl-run-q1-2026", "ar-ageing-april-2026"],
          },
          {
            text: {
              en: "Disclosure: 2 sources matching this question are withheld for legal privilege ('EGP-litigation-memo-2026-04', 'JV-rescue-term-sheet-draft'). They may materially change the answer. Booking a Compliance review is recommended [5].",
              ar: "إفصاح: حُجب مصدران لسرّ قانوني ('مذكّرة تقاضي الجنيه'، 'مسوّدة شروط الإنقاذ'). قد يغيّران الإجابة. يُوصى بمراجعة الامتثال [5].",
            },
            sourceIds: ["egp-exposure-ledger-q1"],
          },
        ],
        consideredSourceIds: EGP_CONSIDERED,
        citedSourceIds: EGP_CITED_FOR_FINANCE,
        withheldSourceIds: ["egp-litigation-memo-2026-04", "jv-rescue-term-sheet-draft"],
        confidence: 84,
      },
    };
  }
  if (personaId === "treasury") {
    return {
      agent: "draft",
      bylineAgents: ["audit", "conf"],
      type: "answer",
      text: pick(lang,
        "USD 18.4M EGP receivables exposure as of 28 Apr — within hedging-policy thresholds. NDF coverage at 61%; Tier-1 runbook step (extend to 75%) is on the table given last week's 8% move.",
        "تعرّض ذمم الجنيه 18.4M$ في 28 أبريل — ضمن السياسة. تغطية NDF 61%؛ يُطرح تمديد إلى 75% بحسب الدليل بسبب حركة 8% الأسبوع الماضي."),
      data: {
        claims: [
          {
            text: {
              en: "Open exposure USD 7.2M after hedging [1]. Hedging policy v3 sets the weekly-report trigger at USD 5M [2].",
              ar: "التعرّض المفتوح 7.2M بعد التحوّط [1]. سياسة التحوّط v3 تحدّد عتبة التقرير الأسبوعي عند 5M [2].",
            },
            sourceIds: ["treasury-weekly-2026-04-28", "fx-hedging-policy-v3"],
          },
          {
            text: {
              en: "Tier-1 runbook response (extend NDF coverage to 75% within 5 working days) is triggered when EGP moves >5% in a week [3]. The 17 Apr 8% devaluation [4] has armed this trigger.",
              ar: "استجابة المستوى 1 (تمديد NDF إلى 75% خلال 5 أيام) تُفعَّل إذا تحرّك الجنيه >5% أسبوعياً [3]. ضعف 17 أبريل 8% [4] فعّل ذلك.",
            },
            sourceIds: ["treasury-runbook-egp", "eg-press-clipping-apr"],
          },
        ],
        consideredSourceIds: [
          "treasury-weekly-2026-04-28", "fx-hedging-policy-v3", "treasury-runbook-egp",
          "eg-press-clipping-apr", "weekly-cash-position-may-1",
          // AR ageing not in treasury ACL, so it's a withhold
          "ar-ageing-april-2026", "ifrs9-ecl-run-q1-2026",
        ],
        citedSourceIds: ["treasury-weekly-2026-04-28", "fx-hedging-policy-v3", "treasury-runbook-egp", "eg-press-clipping-apr"],
        withheldSourceIds: ["ar-ageing-april-2026", "ifrs9-ecl-run-q1-2026"].filter((id) => {
          // we'll let the rail compute true withholds vs ACL; keep what is hidden-but-relevant
          return false;
        }),
        confidence: 89,
      },
    };
  }
  if (personaId === "legal") {
    return {
      agent: "draft",
      bylineAgents: ["audit", "conf"],
      type: "answer",
      text: pick(lang,
        "From the legal angle, the EGP exposure on the Cairo Metro receivable is the live arbitration prep area. Litigation memo dated 18 Apr is the canonical source.",
        "من الزاوية القانونيّة، التعرّض على ذمّة مترو القاهرة منطقة تحضير التحكيم النشطة. مذكّرة 18 أبريل هي المرجع."),
      data: {
        claims: [
          {
            text: {
              en: "Litigation memo dated 18 Apr 2026 covers potential arbitration on the Cairo Metro receivable should EGP devaluation widen past 35% [1].",
              ar: "تغطّي مذكّرة 18 أبريل تحكيماً محتملاً على ذمّة المترو إذا اتّسع الانخفاض فوق 35% [1].",
            },
            sourceIds: ["egp-litigation-memo-2026-04"],
          },
          {
            text: {
              en: "JV rescue term-sheet draft (25 Apr) proposes absorbing open EGP exposure inside a co-funded SPV with the partner [2].",
              ar: "تقترح مسوّدة شروط الإنقاذ (25 أبريل) استيعاب التعرّض داخل كيان مشترك مع الشريك [2].",
            },
            sourceIds: ["jv-rescue-term-sheet-draft"],
          },
          {
            text: {
              en: "Operational baseline (USD 18.4M total exposure) sourced from the Treasury weekly note [3] and confirmed by the FX hedging policy thresholds [4].",
              ar: "الخط الأساس التشغيلي (18.4M$) من ملخّص الخزينة [3] ومؤكّد بحدود سياسة التحوّط [4].",
            },
            sourceIds: ["treasury-weekly-2026-04-28", "fx-hedging-policy-v3"],
          },
        ],
        consideredSourceIds: [
          "egp-litigation-memo-2026-04", "jv-rescue-term-sheet-draft",
          "treasury-weekly-2026-04-28", "fx-hedging-policy-v3", "macro-egp-report-mar-2026",
        ],
        citedSourceIds: ["egp-litigation-memo-2026-04", "jv-rescue-term-sheet-draft", "treasury-weekly-2026-04-28", "fx-hedging-policy-v3"],
        withheldSourceIds: [],
        confidence: 91,
      },
    };
  }
  // Junior analyst + consultant get a refusal
  return {
    agent: "conf",
    bylineAgents: ["perm"],
    type: "refusal",
    text: pick(lang,
      "I cannot answer this from your visible source set. The 6 sources I would have used (Treasury weekly, FX hedging policy, IFRS-9 ECL run, AR ageing, CFO board pack, EGP exposure ledger) are not visible to your persona. I can forward the question to your manager.",
      "لا أستطيع الإجابة من مصادرك المرئية. المصادر الـ 6 التي كنت سأستخدمها (ملخّص الخزينة، سياسة التحوّط، تشغيل IFRS-9، تقادم الذمم، حزمة المجلس، سجل التعرّض) غير متاحة لشخصيّتك. يمكنني إحالة السؤال إلى مديرك."),
    data: {
      consideredSourceIds: EGP_CONSIDERED,
      citedSourceIds: [],
      withheldSourceIds: [
        "treasury-weekly-2026-04-28", "fx-hedging-policy-v3", "ifrs9-ecl-run-q1-2026",
        "ar-ageing-april-2026", "cfo-board-pack-apr-qa", "egp-exposure-ledger-q1",
      ],
      refusalReason: {
        en: "Persona ACL does not include finance / treasury groups required for this question.",
        ar: "صلاحيات الشخصية لا تشمل مجموعات المالية / الخزينة المطلوبة لهذا السؤال.",
      },
      escalationTo: personaId === "consultant"
        ? { en: "Strategy desk lead", ar: "رئيس مكتب الاستراتيجية" }
        : { en: "Lina Haddad (CFO)", ar: "لينا حدّاد (المدير المالي)" },
    },
  };
}

const INTENTS: Intent[] = [
  // 1. EGP exposure
  {
    patterns: [/egp|egyptian|receivable.*egp|exposure.*egp|egp.*exposure|الجنيه|مصر/i],
    handler: egpAnswer,
  },
  // 2. Why are 2 sources hidden? — meta explainer
  {
    patterns: [/why.*hidden|why.*withh|2 sources hidden|withhold|why.*2|لماذا.*محجوب|لماذا.*حُجب|الإفصاح/i],
    handler: (lang) => ({
      agent: "perm",
      type: "text",
      text: pick(lang,
        "Two sources — the EGP litigation memo (18 Apr) and the JV rescue term-sheet draft — sit in the legal-privileged ACL group. Only General Counsel and the M&A team can see them. Policy: the agent must DISCLOSE the withhold (count + impact + recommended next step) without leaking the content. Compliance review is the named next step.",
        "مصدران — مذكّرة تقاضي الجنيه (18 أبريل) ومسوّدة شروط الإنقاذ — في مجموعة 'سرّ قانوني'. فقط المستشار العام وفريق الاندماجات يصلانها. السياسة: على الوكيل أن يُفصح عن الحجب (العدد والأثر والخطوة التالية) دون تسريب المحتوى. مراجعة الامتثال هي الخطوة المسمّاة."),
    }),
  },
  // 3. Brief me for the board
  {
    patterns: [/brief.*board|board.*brief|board pack|exec brief|للمجلس|ملخّص.*مجلس/i],
    handler: (lang) => ({
      agent: "draft",
      bylineAgents: ["conf"],
      type: "list",
      text: pick(lang,
        "Three-bullet board brief on the EGP exposure, ready to drop into the Tuesday pack:",
        "ملخّص مجلس من ثلاث نقاط، جاهز للحزمة:"),
      data: {
        items: [
          pick(lang,
            "Headline: USD 18.4M total exposure, USD 11.2M hedged, USD 7.2M open in Egypt B2G — within policy and actively monitored.",
            "العنوان: تعرّض إجمالي 18.4M$، منه 11.2M متحوّط و7.2M مفتوح في الفرع المصري — ضمن السياسة وقيد المراقبة."),
          pick(lang,
            "P&L: Q1 IFRS-9 ECL uplift AED 4.6M; tail risk if 17 Apr 8% devaluation continues into Q3.",
            "التأثير: رفع IFRS-9 للربع 1 = 4.6M درهم؛ خطر متطرّف إذا استمرّ ضعف 8% حتى Q3."),
          pick(lang,
            "Action ask: ratify the Compliance review on 2 legal-privileged sources that may change the answer.",
            "طلب القرار: إقرار مراجعة الامتثال لمصدرين قانونيَّين قد يغيّران الإجابة."),
        ],
      },
    }),
  },
  // 4. Show source library
  {
    patterns: [/source library|show.*sources|browse.*sources|مكتبة المصادر|اعرض.*المصادر/i],
    handler: (lang) => ({
      agent: "orch", type: "navigate",
      text: pick(lang, "Opening the Source library — filter by classification, owner, or visibility.", "فتح مكتبة المصادر — صفّ بالتصنيف والمالك والرؤية."),
      data: { navigateTo: "sources" },
    }),
  },
  // 5. Switch to Junior Analyst
  {
    patterns: [/switch.*junior|junior.*persona|change.*junior|تبديل.*مبتدئ|شخصية.*مبتدئ/i],
    handler: (lang) => ({
      agent: "orch", type: "personaSwitch",
      text: pick(lang,
        "Switching persona to Junior FP&A Analyst. Visible sources will drop from the CFO's 22 down to 8. Try re-running the EGP question to see the defensible refusal.",
        "تبديل الشخصية إلى محلّل تخطيط مبتدئ. ستنخفض المصادر المرئيّة من 22 إلى 8. أعد سؤال الجنيه لترى الرفض المبرّر."),
      data: { switchPersonaTo: "junior" },
    }),
  },
  // 6. Re-run as Junior — same as EGP, just hint
  {
    patterns: [/re-?run.*egp|re-?run.*junior|same question.*junior|إعادة.*مبتدئ|نفس.*مبتدئ/i],
    handler: (lang, personaId) => {
      if (personaId === "junior") return egpAnswer(lang, "junior");
      // tell the user to switch first
      return {
        agent: "orch", type: "personaSwitch",
        text: pick(lang,
          "Switching to Junior Analyst, then re-running…",
          "التبديل إلى محلّل مبتدئ ثم إعادة التشغيل…"),
        data: { switchPersonaTo: "junior" },
      };
    },
  },
  // 7. Escalate
  {
    patterns: [/escalate|forward.*manager|تصعيد|أحل.*مدير/i],
    handler: (lang, personaId) => ({
      agent: "orch", type: "escalation",
      text: pick(lang,
        "Forwarded to your manager with the question, your visible source list, and the 6 sources I would have used. They'll see it in their inbox in seconds.",
        "تمّت الإحالة إلى مديرك مع السؤال، ومصادرك المرئيّة، والمصادر الـ 6 التي كنت سأستخدمها. ستظهر في صندوق الوارد فوراً."),
      data: {
        escalationTo: personaId === "consultant"
          ? { en: "Strategy desk lead", ar: "رئيس مكتب الاستراتيجية" }
          : personaId === "junior"
            ? { en: "Lina Haddad (CFO)", ar: "لينا حدّاد (المدير المالي)" }
            : { en: "General Counsel", ar: "المستشار العام" },
      },
    }),
  },
  // 8. What did the Auditor flag?
  {
    patterns: [/auditor.*flag|audit.*flag|audit.*week|audit.*findings|ماذا.*المدقّق|مدقّق.*هذا الأسبوع|تدقيق/i],
    handler: (lang) => ({
      agent: "audit",
      type: "list",
      text: pick(lang,
        "Citation Auditor highlights, last 7 days:",
        "أبرز ما رصده مدقّق الاستشهاد آخر 7 أيام:"),
      data: {
        items: [
          pick(lang,
            "5 citations resolved cleanly on the EGP-exposure answer; no hallucinated sources.",
            "5 مراجع تحقّقت بنظافة على إجابة الجنيه؛ لا مصادر مفبركة."),
          pick(lang,
            "4 cited sources are >180 days old — owners notified to refresh.",
            "4 مصادر مستشهَد بها أقدم من 180 يوماً — أُشعر مالكوها بالتحديث."),
          pick(lang,
            "1 borderline confidence (84%) — Compliance review queued on the 2 withheld sources.",
            "ثقة حدّية واحدة (84%) — مراجعة الامتثال مجدولة للمصدرَين المحجوبَين."),
          pick(lang,
            "0 permission leaks across 312 answers — within policy.",
            "0 تسريبات صلاحيات عبر 312 إجابة — ضمن السياسة."),
        ],
      },
    }),
  },
  // Greeting
  {
    patterns: [/^\s*(hi|hello|hey|good morning|good afternoon|salam)/i, /مرحب|أهلا|السلام|صباح/i],
    handler: (lang, personaId) => ({
      agent: "orch",
      type: "text",
      text: pick(lang,
        `Hello. You're asking as ${personaId.toUpperCase()}. The headline today is the EGP exposure question and the 2 hidden sources sitting in Compliance review. Try the prompts below.`,
        `أهلاً. تسأل كـ ${personaId.toUpperCase()}. عنوان اليوم سؤال تعرّض الجنيه ومصدران محجوبان قيد مراجعة الامتثال. جرّب المقترحات أدناه.`),
    }),
  },
];

export function matchEkcIntent(input: string, lang: DemoLang, personaId: PersonaId): ChatResponse {
  const text = input.trim();
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(text))) {
      return intent.handler(lang, personaId);
    }
  }
  return {
    agent: "orch",
    type: "text",
    text: pick(lang,
      "I can answer the EGP exposure question, explain why sources are hidden, brief you for the board, switch persona, or escalate. Pick a quick prompt or rephrase.",
      "يمكنني الإجابة على سؤال تعرّض الجنيه، أو شرح سبب الحجب، أو تجهيز ملخّص للمجلس، أو تبديل الشخصية، أو التصعيد. اختر مقترحاً أو أعد الصياغة."),
  };
}
