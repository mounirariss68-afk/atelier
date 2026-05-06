import type { DemoLang } from "./DemoLangContext";
import {
  generateRecommendations, generateCascades, generateMemo, getKpis,
  silentSlippers, blockingMatrix, generateDecisionPack,
} from "@/data/programme-war-room-agent";
import { PROGRAMMES, programmeById, fmtAed } from "@/data/programme-war-room-seed";

export type ChatAgent = "orch" | "watcher" | "raid" | "etc" | "drafter" | "critic";
export type ChatResponseType = "text" | "table" | "list" | "chart" | "memo" | "navigate";

export interface ChatResponse {
  agent: ChatAgent;
  text: string;
  type: ChatResponseType;
  data?: Record<string, unknown>;
}

interface Intent {
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

function pick(lang: DemoLang, en: string, ar: string) {
  return lang === "en" ? en : ar;
}

const INTENTS: Intent[] = [
  // 1. Brief me on the ERP slip
  {
    patterns: [/erp.*(slip|brief|status)/i, /brief.*erp/i, /oracle/i, /erp/i, /erp.*تأخّر|تأخّر.*erp|Oracle/i, /لخّص.*erp|brief.*برنامج/i],
    handler: (lang) => ({
      agent: "watcher",
      type: "list",
      text: pick(lang,
        "ERP slip — 28 days. Vendor patch v2.4 (data migration) failed UAT round 3 on 2 May. Three pieces of evidence:",
        "تأخّر ERP — 28 يوماً. فشل التصحيح v2.4 (هجرة البيانات) في الجولة 3 من UAT يوم 2 مايو. ثلاث أدلّة:"),
      data: {
        items: [
          pick(lang, "Slip Detector: 14d added this week, RAG flipped Amber → Red.", "راصد التأخّر: +14 يوماً هذا الأسبوع، تحوّل أصفر → أحمر."),
          pick(lang, "Evidence Compiler: 3 UAT defects (severity-1) on bank-reconciliation flow.", "مُجمّع الأدلة: 3 عيوب UAT حرجة في مسار التسوية البنكية."),
          pick(lang, "Dependency Critic: cascade hits Customer 360 (+18d) and Network Modernisation (+12d).", "ناقد الاعتمادية: التتالي يضرب Customer 360 (+18) وتحديث الشبكة (+12)."),
        ],
      },
    }),
  },
  // 2. Cheapest way out
  {
    patterns: [/cheap|lowest cost|best option|way out/i, /options?/i, /أوفر|أقل تكلفة|خيار/i, /ما الخيار/i],
    handler: (lang) => {
      const opts = generateDecisionPack("erp-oracle");
      return {
        agent: "drafter",
        type: "table",
        text: pick(lang,
          "Three drafted decisions for the ERP slip. Decision Drafter recommends scope-cut.",
          "ثلاثة قرارات مسوّدة لتأخّر ERP. كاتب القرارات يوصي بخفض النطاق."),
        data: {
          headers: [
            pick(lang, "Option", "الخيار"),
            pick(lang, "Cost", "التكلفة"),
            pick(lang, "Risk", "المخاطر"),
            pick(lang, "Time-to-recover", "زمن الاستعادة"),
          ],
          rows: opts.map((o) => [
            (o.recommended ? "★ " : "") + o.label[lang],
            o.cost[lang],
            o.risk[lang],
            o.timeToRecover[lang],
          ]),
        },
      };
    },
  },
  // 3. Downstream impact
  {
    patterns: [/downstream|cascade|impact|متسلسل|تتالي|أثر/i],
    handler: (lang) => {
      const cascades = generateCascades();
      const erp = cascades.find((c) => c.sourceId === "erp-oracle")!;
      return {
        agent: "critic",
        type: "list",
        text: pick(lang,
          "ERP slip cascades to 3 downstream programmes. Hit dates from Dependency Critic:",
          "التأخّر يتسلسل إلى 3 برامج تابعة. مواعيد التأثير من ناقد الاعتمادية:"),
        data: {
          items: erp.downstream.map((d) => `${d.name[lang]} — ${d.hitDate} · ${d.impact[lang]}`),
        },
      };
    },
  },
  // 4. Draft Steerco memo
  {
    patterns: [/draft.*memo|steerco|breach memo|مذكّرة|اللجنة/i],
    handler: (lang) => {
      const memo = generateMemo("erp-oracle")!;
      return {
        agent: "drafter",
        type: "memo",
        text: pick(lang, "Steerco breach memo (read-only draft from Memo Writer):", "مذكّرة اللجنة (مسوّدة من كاتب المذكّرات):"),
        data: {
          title: memo.title[lang],
          paragraphs: memo.body.map((b) => b[lang]),
        },
      };
    },
  },
  // 5. Contingency burn
  {
    patterns: [/contingency|burn|احتياطي|أستهلك|burn rate/i],
    handler: (lang) => {
      const sorted = [...PROGRAMMES].sort((a, b) => b.contingencyBurnedAed - a.contingencyBurnedAed).slice(0, 6);
      return {
        agent: "etc",
        type: "chart",
        text: pick(lang,
          `Top contingency burners (AED). Total burned ${fmtAed(getKpis().burned, "en")} of ${fmtAed(getKpis().envelope, "en")}.`,
          `أعلى استهلاك للاحتياطي (درهم). إجمالي ${fmtAed(getKpis().burned, "en")} من ${fmtAed(getKpis().envelope, "en")}.`),
        data: {
          chartType: "bar",
          chartData: sorted.map((p) => ({ name: p.name[lang].split(" ").slice(0, 2).join(" "), value: Math.round(p.contingencyBurnedAed / 100_000) / 10 })),
          label: pick(lang, "AED M burned", "مليون درهم مستهلك"),
        },
      };
    },
  },
  // 6. Silent slips
  {
    patterns: [/silent|slipping silent|hidden|صامت|خفي/i],
    handler: (lang) => {
      const list = silentSlippers();
      return {
        agent: "watcher",
        type: "list",
        text: pick(lang,
          `${list.length} programme(s) with rising slip-day rates not yet RAG-flipped:`,
          `${list.length} برنامج بمعدل تأخّر يرتفع دون تحويل الحالة:`),
        data: {
          items: list.map((p) => `${p.name[lang]} — ${p.weeklySlipDelta}d this week (RAG ${p.rag})`),
        },
      };
    },
  },
  // 7. Who is blocking what
  {
    patterns: [/who.*block|blocking|vendors?|partners?|من يعطّل|تعطّل|الموردين/i],
    handler: (lang) => {
      const matrix = blockingMatrix();
      return {
        agent: "raid",
        type: "table",
        text: pick(lang,
          "Blocking matrix from RAID Classifier:",
          "مصفوفة المعطّلين من مصنّف RAID:"),
        data: {
          headers: [pick(lang, "Party", "الجهة"), pick(lang, "Programmes", "البرامج"), pick(lang, "Issue", "المشكلة")],
          rows: matrix.map((m) => [m.party[lang], m.programmes.map((p) => p[lang]).join(", "), m.issue[lang]]),
        },
      };
    },
  },
  // 8. Open dependency map for ERP
  {
    patterns: [/open.*dependency|dependency map|graph|خريطة|الاعتماديات|افتح.*خريطة/i],
    handler: (lang) => ({
      agent: "orch",
      type: "navigate",
      text: pick(lang,
        "Opening the Dependency map zoomed to Oracle ERP — slipping nodes pulse red.",
        "فتح خريطة الاعتماديات مع التركيز على Oracle ERP — العقد المتأخّرة تنبض بالأحمر."),
      data: { view: "dependency", focus: "erp-oracle" },
    }),
  },
  // 9. Greeting
  {
    patterns: [/^\s*(hi|hello|hey|good morning|salam)/i, /مرحب|أهلا|السلام|صباح/i],
    handler: (lang) => ({
      agent: "orch",
      type: "text",
      text: pick(lang,
        "Good morning, Mariam. The ERP slip is the headline today; everything else is one click away.",
        "صباح الخير مريم. تأخّر ERP هو عنوان اليوم؛ بقيّة المحفظة على بُعد ضغطة."),
    }),
  },
];

export function matchPwrIntent(input: string, lang: DemoLang): ChatResponse {
  const text = input.trim();
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(text))) {
      return intent.handler(lang);
    }
  }
  return {
    agent: "orch",
    type: "text",
    text: pick(lang,
      "I can brief you on ERP, draft the memo, show downstream impact, list silent slips, or open the dependency map. Pick one of the prompts above.",
      "يمكنني تلخيص ERP، صياغة المذكّرة، عرض التأثير، أو فتح خريطة الاعتماديات. اختاري من المقترحات أعلاه."),
  };
}
