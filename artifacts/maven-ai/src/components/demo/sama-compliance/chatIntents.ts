import type { DemoLang } from "./DemoLangContext";
import {
  buildSeedObligations, buildSeedControls, buildSeedReturns, buildSeedCirculars,
  DOMAIN_LABEL,
} from "@/data/sama-compliance-seed";

export type ChatAgentId = "orch" | "monitor" | "policy" | "memo" | "evidence";

export type ChatResponseType = "text" | "metric" | "metric-grid" | "table" | "list" | "doc" | "chart";

export interface ChatResponse {
  agent: ChatAgentId;
  type: ChatResponseType;
  text: string;
  data?: Record<string, unknown>;
  navigate?: { view: string; id?: string };
}

interface Intent {
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

const pick = (lang: DemoLang, en: string, ar: string) => (lang === "ar" ? ar : en);

const INTENTS: Intent[] = [
  {
    patterns: [/sama.*chang|chang.*week|new.*circul|تغيّر.*أسبوع|سامة|ساما.*غيّر/i],
    handler: (lang) => ({
      agent: "monitor",
      type: "list",
      text: pick(lang,
        "SAMA published CRU-2026-04 last Saturday. Highlights:",
        "نشرت ساما CRU-2026-04 السبت الماضي. أبرز ما تغيّر:"),
      data: {
        items: [
          pick(lang,
            "§4.1 Privileged-access reviews → quarterly to monthly (CR-014).",
            "§4.1 مراجعات الصلاحيات الحسّاسة → ربعي إلى شهري (CR-014)."),
          pick(lang,
            "§4.2 SaaS connectors must be auto-discovered + attested weekly (CR-027).",
            "§4.2 موصلات SaaS: اكتشاف آلي + إقرار أسبوعي (CR-027)."),
          pick(lang,
            "§4.3 Identity attestation cycle 180d → 90d (CR-082).",
            "§4.3 تواتر إقرار الهويّة 180 → 90 يوماً (CR-082)."),
          pick(lang,
            "14 net-new obligations · 7 evidence-format reformats · effective 2026-06-02.",
            "14 التزاماً جديداً · 7 إعادات صياغة للأدلّة · السريان 2026-06-02."),
        ],
      },
      navigate: { view: "circular", id: "CRU-2026-04" },
    }),
  },
  {
    patterns: [/control.*fail|fail.*control|failing|degraded|متعثّر|متدهور|إخفاق/i],
    handler: (lang) => {
      const failing = buildSeedControls()
        .filter((c) => c.lastTestResult === "fail" || c.lastTestResult === "overdue")
        .slice(0, 8);
      return {
        agent: "policy",
        type: "table",
        text: pick(lang,
          `${failing.length} controls are failing or overdue right now.`,
          `${failing.length} ضوابط متعثّرة أو متأخرة الآن.`),
        data: {
          headers: [
            pick(lang, "Control", "الضابط"),
            pick(lang, "Title", "العنوان"),
            pick(lang, "Owner", "المسؤول"),
            pick(lang, "Result", "النتيجة"),
          ],
          rows: failing.map((c) => [
            c.id,
            lang === "ar" ? c.titleAr : c.titleEn,
            c.ownerName,
            c.lastTestResult,
          ]),
        },
        navigate: { view: "controls" },
      };
    },
  },
  {
    patterns: [/qfr|section.*4|return.*draft|قسم.*4|مسودّة|مسوّدة/i],
    handler: (lang) => ({
      agent: "memo",
      type: "doc",
      text: pick(lang,
        "Here's the Section 4 (Capital Adequacy) draft for QFR-2026-Q2.",
        "هذه مسودّة القسم 4 (كفاية رأس المال) من QFR-2026-Q2."),
      data: {
        title: pick(lang, "QFR-2026-Q2 · Section 4 — Capital Adequacy", "QFR-2026-Q2 · القسم 4 — كفاية رأس المال"),
        body: [
          pick(lang,
            "Tier-1 capital ratio held at 16.4%, 220 bps above the SAMA minimum.",
            "نسبة رأس المال الأساسي عند 16.4%، أعلى بـ 220 نقطة من الحد الأدنى."),
          pick(lang,
            "Counter-cyclical buffer activated at 0.5% in line with SAMA guidance from 2026-Q1.",
            "تفعيل احتياطي مكافحة التقلّبات عند 0.5% وفق توجيه ساما للربع الأول 2026."),
          pick(lang,
            "RWA growth of 3.1% QoQ, driven by corporate-banking origination and Treasury HQLA reweighting.",
            "نمو الأصول المرجحة 3.1% فصلياً بفعل صيرفة الشركات وإعادة ترجيح الخزينة."),
          pick(lang,
            "Suggested edit (agent): tighten paragraph 3 to specify activation date.",
            "تعديل مقترح (وكيل): تشديد الفقرة 3 لتحديد تاريخ التفعيل."),
        ],
      },
      navigate: { view: "returns", id: "QFR-2026-Q2" },
    }),
  },
  {
    patterns: [/aml|where.*stand.*aml|غسل.*أموال|aml.*status/i],
    handler: (lang) => {
      const oblig = buildSeedObligations().filter((o) => o.domain === "aml");
      const red = oblig.filter((o) => o.rag === "red").length;
      const amber = oblig.filter((o) => o.rag === "amber").length;
      return {
        agent: "monitor",
        type: "metric-grid",
        text: pick(lang,
          "AML obligations are mostly green; one threshold change is queued for your sign-off.",
          "معظم التزامات مكافحة غسل الأموال خضراء؛ تغيير حدّ واحد بانتظار التوقيع."),
        data: {
          tiles: [
            { label: pick(lang, "Active AML obligations", "التزامات AML نشطة"), value: String(oblig.length) },
            { label: pick(lang, "Red", "أحمر"), value: String(red) },
            { label: pick(lang, "Amber", "أصفر"), value: String(amber) },
            { label: pick(lang, "Returns next 30 days", "إيداعات خلال 30 يوماً"), value: "2" },
          ],
        },
        navigate: { view: "register" },
      };
    },
  },
  {
    patterns: [/own.*control|who.*own|control.*owner|من يملك|مسؤول.*ضابط/i],
    handler: (lang) => {
      const target = buildSeedControls().find((c) => c.id === "CR-014") ?? buildSeedControls()[0];
      return {
        agent: "policy",
        type: "metric",
        text: pick(lang,
          `${target.id} is owned by ${target.ownerName}.`,
          `${target.id} يملكه ${target.ownerName}.`),
        data: {
          value: target.ownerName,
          sub: pick(lang, target.ownerTitleEn, target.ownerTitleAr),
          extra: pick(lang, `Last tested ${target.lastTestedAt.slice(0, 10)} · result ${target.lastTestResult}.`,
                            `آخر اختبار ${target.lastTestedAt.slice(0, 10)} · النتيجة ${target.lastTestResult}.`),
        },
      };
    },
  },
  {
    patterns: [/forecast.*effort|effort.*new.*circul|cost.*circul|جهد.*تعميم|تكلفة/i],
    handler: (lang) => ({
      agent: "memo",
      type: "list",
      text: pick(lang,
        "Effort forecast for CRU-2026-04 (21-day plan):",
        "توقّع الجهد لـ CRU-2026-04 (خطة 21 يوماً):"),
      data: {
        items: [
          pick(lang, "Identity Office: 14 person-days (PAM cadence rollout).", "مكتب الهويّات: 14 يوم عمل (PAM)."),
          pick(lang, "CISO Office: 9 person-days (SaaS auto-discovery rollout).", "مكتب أمن المعلومات: 9 أيام عمل (اكتشاف SaaS)."),
          pick(lang, "HR Tech: 6 person-days (attestation interval reconfig).", "تقنية الموارد: 6 أيام عمل (إعادة ضبط التواتر)."),
          pick(lang, "Internal Audit clearance window: 3 days.", "نافذة إجازة التدقيق: 3 أيام."),
          pick(lang, "Estimated all-in cost: ~SAR 280K, no external vendor spend.", "التكلفة التقديرية: ~280 ألف ر.س بدون موردين خارجيين."),
        ],
      },
    }),
  },
  {
    patterns: [/board|brief|risk.*meeting|مجلس|إيجاز|اجتماع/i],
    handler: (lang) => ({
      agent: "orch",
      type: "text",
      text: pick(lang,
        "Board brief — week of 4 May 2026.\n\n• 240 active obligations across 7 domains; 12 in red.\n• CRU-2026-04 ingested overnight: 14 new obligations, 3 control changes drafted, 47-artefact evidence pack staged.\n• 12 returns due in next 30 days; 9 are above 80% agent-readiness.\n• 7 decisions awaiting CRO sign-off.\n• Compliance Conductor recommends approving the 21-day remediation plan and clearing the AML-MTR April return.",
        "إيجاز المجلس — أسبوع 4 مايو 2026.\n\n• 240 التزاماً نشطاً عبر 7 مجالات؛ 12 منها بالأحمر.\n• استلام CRU-2026-04 ليلاً: 14 التزاماً جديداً و3 تغييرات ضوابط و47 قطعة دليل.\n• 12 إيداعاً خلال 30 يوماً؛ 9 منها فوق 80% من الجاهزية.\n• 7 قرارات بانتظار توقيع المدير.\n• يوصي المنسّق باعتماد خطة 21 يوماً وإجازة تقرير AML-MTR لأبريل."),
    }),
  },
  {
    patterns: [/calendar|returns?.*due|upcoming|تقويم|إيداع/i],
    handler: (lang) => ({
      agent: "orch",
      type: "table",
      text: pick(lang, "Switching to the Returns calendar.", "الانتقال إلى تقويم الإيداعات."),
      data: {
        headers: [
          pick(lang, "Return", "الإيداع"),
          pick(lang, "Due", "الاستحقاق"),
          pick(lang, "Readiness", "الجاهزية"),
        ],
        rows: buildSeedReturns().slice(0, 6).map((r) => [
          r.id,
          r.dueDate,
          `${r.agentReadiness}%`,
        ]),
      },
      navigate: { view: "returns" },
    }),
  },
  {
    patterns: [/heatmap|domain|business.*line|خريطة|مجال/i],
    handler: (lang) => ({
      agent: "policy",
      type: "text",
      text: pick(lang,
        "Domain × business-line heatmap is on the obligations register home — the Cyber Resilience row is the one to watch this week.",
        "خريطة المجال × خط الأعمال على صفحة الالتزامات — راقبي صف المرونة السيبرانية هذا الأسبوع."),
      navigate: { view: "register" },
    }),
  },
  {
    patterns: [/^hi$|^hello$|hey|good morning|مرحبا|أهلا|صباح/i],
    handler: (lang) => ({
      agent: "orch",
      type: "text",
      text: pick(lang,
        "Hello Noura. Try one of the quick prompts below or ask about an obligation, control, return, or circular.",
        "أهلاً نورا. جرّبي أحد الاقتراحات أدناه أو اسألي عن التزام أو ضابط أو إيداع أو تعميم."),
    }),
  },
];

const FALLBACK_DOMAINS = Object.keys(DOMAIN_LABEL);

export function matchSamaIntent(query: string, lang: DemoLang): ChatResponse {
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(query))) return intent.handler(lang);
  }
  return {
    agent: "orch",
    type: "text",
    text: pick(lang,
      `I can answer about SAMA changes, failing controls, the QFR draft, AML status, control owners, the returns calendar, or board briefs. Domains tracked: ${FALLBACK_DOMAINS.join(", ")}.`,
      `أستطيع الإجابة عن تغييرات ساما والضوابط المتعثّرة ومسوّدة QFR ووضع AML وملّاك الضوابط وتقويم الإيداعات. المجالات: ${FALLBACK_DOMAINS.join(", ")}.`),
  };
}
