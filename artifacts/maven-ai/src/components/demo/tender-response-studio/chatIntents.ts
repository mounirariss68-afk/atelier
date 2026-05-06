import type { DemoLang } from "./DemoLangContext";
import { TENDERS, ACTIVE_QUESTIONS, LIBRARY, COMPLIANCE_GATES, ACTIVE_TENDER_ID } from "@/data/tender-response-seed";
import { generateRecommendations, generateAlerts, generateKpis } from "@/data/tender-response-agent";

export type AgentId = "orch" | "qualifier" | "pricing" | "partner" | "legal" | "compiler" | "drafter" | "ingest";
export type ResponseType = "text" | "metric" | "table" | "list" | "chart" | "checkpoint";

export interface ChatResponse {
  agent: AgentId;
  text: string;
  type: ResponseType;
  data?: Record<string, unknown>;
}

interface Intent { patterns: RegExp[]; handler: (lang: DemoLang) => ChatResponse }

const pick = (lang: DemoLang, en: string, ar: string) => (lang === "ar" ? ar : en);

const INTENTS: Intent[] = [
  // Etimad / active tender block
  {
    patterns: [/etimad|lot.?3|active|نشطة|اعتماد|بلوك|blocking|block/i],
    handler: (lang) => {
      const t = TENDERS.find((x) => x.id === ACTIVE_TENDER_ID)!;
      return {
        agent: "orch",
        type: "list",
        text: pick(lang,
          `Etimad LOT-3 — 2 days to submit. Three blockers right now:\n\n🔴 Partner C silent at D+3 — alternative LoS draft ready to send\n🟠 Pricing floor at risk — base scenario margin 11.2% vs 10% floor\n🟠 Cross-section conflict — vendor footprint 14 (S3) vs 12 (S5)\n\n${t.questionsApproved}/${t.questionsTotal} answers SME-approved · 32 drafted overall.`,
          `اعتماد LOT-3 — يومان للتقديم. ثلاثة عوائق:\n\n🔴 الشريك ج صامت في اليوم 3\n🟠 حدّ التسعير معرّض — الأساس 11.2% مقابل 10%\n🟠 تعارض ادعاء البصمة 14 (S3) مقابل 12 (S5)\n\n${t.questionsApproved}/${t.questionsTotal} معتمدة.`),
      };
    },
  },
  // Pricing
  {
    patterns: [/pricing|price|adnoc|تسعير|سيناريو/i],
    handler: (lang) => ({
      agent: "pricing",
      type: "table",
      text: pick(lang,
        "ADNOC DT-4 pricing scenarios — base recommended (margin 12.4%, win prob 51%).",
        "سيناريوهات ADNOC DT-4 — الأساس موصى به (هامش 12.4%، احتمال 51%)."),
      data: {
        headers: pick(lang, "Scenario,Total,Margin,Win prob.", "السيناريو,الإجمالي,الهامش,الاحتمال").split(","),
        rows: [
          [pick(lang, "Aggressive", "طموح"), "SAR 84M", "9.1%", "67%"],
          [pick(lang, "Base (recommended)", "أساس (موصى)"), "SAR 88.5M", "12.4%", "51%"],
          [pick(lang, "Floor", "حدّ أدنى"), "SAR 95M", "15.0%", "28%"],
        ],
      },
    }),
  },
  // Compliance
  {
    patterns: [/compliance|score|gate|امتثال|بطاقة/i],
    handler: (lang) => {
      const pass = COMPLIANCE_GATES.filter((g) => g.status === "pass").length;
      const warn = COMPLIANCE_GATES.filter((g) => g.status === "warn").length;
      const fail = COMPLIANCE_GATES.filter((g) => g.status === "fail").length;
      const score = Math.round((pass / COMPLIANCE_GATES.length) * 100);
      return {
        agent: "legal",
        type: "metric",
        text: pick(lang,
          `Compliance score on Etimad LOT-3 sits at ${score}% — ${pass} gates passing, ${warn} warning, ${fail} failing. Submission is blocked until partner LoS lands.`,
          `درجة الامتثال ${score}% — ${pass} مارّة، ${warn} تحذير، ${fail} فاشلة. التقديم متوقّف.`),
        data: { value: `${score}%`, target: "100%", trend: fail > 0 ? "down" : "up", delta: `${pass}/${COMPLIANCE_GATES.length}` },
      };
    },
  },
  // Library
  {
    patterns: [/library|precedent|reuse|win.*rate|مكتبة|سابقة|فوز/i],
    handler: (lang) => {
      const top = [...LIBRARY].sort((a, b) => b.winRate - a.winRate).slice(0, 5);
      return {
        agent: "drafter",
        type: "table",
        text: pick(lang,
          `Top 5 library blocks by win rate — ${top[0].reusedCount} reuses on the leader.`,
          `أعلى 5 كتل بمعدّل الفوز.`),
        data: {
          headers: pick(lang, "Title,Category,Reused,Win", "العنوان,الفئة,استُخدم,فوز").split(","),
          rows: top.map((l) => [l.title[lang], l.category[lang], `${l.reusedCount}×`, `${l.winRate}%`]),
        },
      };
    },
  },
  // Partner
  {
    patterns: [/partner|los|شريك|رسالة/i],
    handler: (lang) => ({
      agent: "partner",
      type: "list",
      text: pick(lang,
        "Partner LoS status:\n\n✅ Partner A — sovereign cloud (signed D+1)\n✅ Partner B — managed security (signed D+2)\n🔴 Partner C — change-mgmt consultancy (silent D+3)\n\nRecommend: send draft LoS to alternative vendor today (84% confidence the alt accepts inside 24h).",
        "حالة الشركاء:\n\n✅ الشريك أ\n✅ الشريك ب\n🔴 الشريك ج صامت\n\nالتوصية: إرسال طلب رسالة دعم للبديل اليوم."),
    }),
  },
  // Pipeline / KPIs
  {
    patterns: [/pipeline|kpi|win.*rate|cycle|مسار|مؤشر/i],
    handler: (lang) => {
      const k = generateKpis();
      return {
        agent: "orch",
        type: "list",
        text: pick(lang,
          `Pipeline snapshot:\n\n• Active: ${k[0].value}\n• Pipeline value: ${k[1].value}\n• Win rate (12mo): ${k[2].value} (${k[2].delta.en})\n• RFP-to-submit cycle: ${k[3].value}\n• Defensible no-bid: ${k[4].value}`,
          `لمحة المسار:\n\n• النشطة: ${k[0].value}\n• القيمة: ${k[1].value}\n• الفوز: ${k[2].value}\n• الزمن: ${k[3].value}\n• الانسحاب: ${k[4].value}`),
      };
    },
  },
  // No-bid
  {
    patterns: [/no.?bid|riyadh|waste|انسحاب|نفايات/i],
    handler: (lang) => ({
      agent: "qualifier",
      type: "text",
      text: pick(lang,
        "Riyadh Municipality smart-waste IoT — Qualifier scores 58% fit. Past performance gap on municipal IoT and pricing floor breached at SAR 28M. Defensible NO-BID memo drafted, preserves Amana relationship.",
        "نفايات الرياض الذكية — جدارة 58%. مذكّرة انسحاب مبرّر مسوّدة."),
    }),
  },
  // SME load
  {
    patterns: [/sme|workload|owner|خبير|حمل/i],
    handler: (lang) => ({
      agent: "drafter",
      type: "list",
      text: pick(lang,
        "SME workload (open answers across 8 tenders):\n\n• Faisal (Architect) — 11 open\n• Khalid (you) — 9 open\n• Noura (Security) — 6 open\n• Omar (Pricing) — 5 open\n• Laila (Past performance) — 4 open\n• Rana (Legal) — 3 open\n\nFaisal is the bottleneck — recommend pulling 2 architecture answers to Noura.",
        "حمل الخبراء:\n\n• فيصل 11\n• خالد 9\n• نورة 6\n• عمر 5\n• ليلى 4\n• رنا 3"),
    }),
  },
  // Submit
  {
    patterns: [/submit|upload|تقديم|رفع/i],
    handler: (lang) => ({
      agent: "compiler",
      type: "text",
      text: pick(lang,
        "Etimad LOT-3 packet preview is 86 pages. I can stitch the final once partner C LoS lands and the §4.2/§1.1 conflict is reconciled. Estimated stitch + portal upload: 18 min.",
        "حزمة اعتماد LOT-3 معاينة 86 صفحة."),
    }),
  },
  // Greetings
  {
    patterns: [/^(hi|hello|hey|salam|مرحبا|أهلا|السلام)/i],
    handler: (lang) => ({
      agent: "orch",
      type: "text",
      text: pick(lang,
        "Hi Khalid — 8 active tenders, 3 pending checkpoints, Etimad LOT-3 due in 2 days. What would you like to look at first?",
        "مرحباً خالد — 8 مناقصات و 3 نقاط معلّقة. اعتماد LOT-3 خلال يومين."),
    }),
  },
];

export function matchIntent(message: string, lang: DemoLang): ChatResponse {
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(message))) return intent.handler(lang);
  }
  const recs = generateRecommendations();
  return {
    agent: "orch",
    type: "text",
    text: pick(lang,
      `I track 8 active tenders and ${recs.length} pending recommendations. Try asking: "Etimad LOT-3 status", "ADNOC pricing scenarios", "compliance score", or "library win rates".`,
      `أتابع 8 مناقصات و ${recs.length} توصية. جرّب: "حالة اعتماد"، "تسعير ADNOC"، "درجة الامتثال".`),
  };
}
