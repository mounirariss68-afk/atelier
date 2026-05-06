import type { DemoLang } from "./DemoLangContext";
import { getProcurementSnapshot } from "@/hooks/useProcurementNegotiationData";
import {
  generateRoundSummaries, generateSupplierDeltas, generateAwardMemo,
  regretVsLowestPrice, RECOMMENDATIONS, type ProcurementAgentId,
} from "@/data/procurement-negotiation-agent";
import {
  totalForSupplier, totalBaseline, savingsPctVsBaseline, tcoForSupplier,
} from "@/data/procurement-negotiation-seed";

export type ResponseType =
  | "text" | "metric" | "metric-grid" | "table" | "list" | "chart" | "recommendation" | "memo";

export interface ChatResponse {
  agent: ProcurementAgentId;
  text: string;
  type: ResponseType;
  data?: Record<string, unknown>;
  // Side-effect to perform on the workspace shell when this response is
  // delivered: lets the chat actually drive workspace state (e.g. flip
  // the bid matrix to TCO mode, jump to the Counter-bid composer).
  effect?:
    | { kind: "set-cost-view"; view: "price" | "tco"; navigateTo?: NavTarget }
    | { kind: "navigate"; navigateTo: NavTarget };
}

export type NavTarget =
  | "events" | "workspace" | "approvals" | "suppliers" | "counter" | "audit";

interface Intent {
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

const fmtSARm = (n: number) => `SAR ${(n / 1_000_000).toFixed(2)}M`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const INTENTS: Intent[] = [
  {
    patterns: [/baseline|vs.?baseline|savings.*so far|أين نحن|الأساس|وفورات/i],
    handler: (lang) => {
      const rounds = generateRoundSummaries();
      const r3 = rounds[2];
      return {
        agent: "spend",
        type: "metric-grid",
        text: lang === "ar"
          ? `بعد الجولة 3 نحن عند ${fmtPct(r3.savingsPct)} مقابل الأساس (الهدف 6.0%). أفضل عرض إجمالي ${fmtSARm(r3.totalAt)} مقابل الأساس ${fmtSARm(totalBaseline())}.`
          : `After Round 3 we're at ${fmtPct(r3.savingsPct)} vs baseline (target 6.0%). Best aggregate is ${fmtSARm(r3.totalAt)} vs baseline ${fmtSARm(totalBaseline())}.`,
        data: {
          rows: [
            [lang === "ar" ? "الأساس" : "Baseline", fmtSARm(totalBaseline())],
            [lang === "ar" ? "أفضل R3" : "Best R3", fmtSARm(r3.totalAt)],
            [lang === "ar" ? "الوفورات" : "Savings", fmtPct(r3.savingsPct)],
            [lang === "ar" ? "الهدف" : "Target", "6.0%"],
          ],
        },
      };
    },
  },
  {
    patterns: [/improv.*r3|improv.*round 3|who improved|تحسّن|تحسن.*الجولة/i],
    handler: (lang) => {
      const deltas = generateSupplierDeltas().slice(0, 6);
      const { suppliers } = getProcurementSnapshot();
      const headers = lang === "ar"
        ? ["#", "المورد", "تحسّن R3", "وفورات"]
        : ["#", "Supplier", "R3 Δ vs R2", "Savings"];
      const rows = deltas.map((d, i) => {
        const s = suppliers.find((x) => x.id === d.supplierId)!;
        return [`${i + 1}`, lang === "ar" ? s.nameAr : s.nameEn, fmtPct(d.improvementPct), fmtPct(d.savingsVsBaseline)];
      });
      return {
        agent: "round",
        type: "table",
        text: lang === "ar" ? "أكثر الموردين تحسّناً في الجولة 3:" : "Suppliers ranked by R3 improvement vs R2:",
        data: { headers, rows },
      };
    },
  },
  {
    patterns: [/recommend.*award|award.*recommend|ترسية|أوصِ.*ترسية/i],
    handler: (lang) => {
      const rec = RECOMMENDATIONS.find((r) => r.recordType === "award")!;
      return {
        agent: "critic",
        type: "recommendation",
        text: lang === "ar" ? rec.titleAr : rec.titleEn,
        data: {
          rationale: lang === "ar" ? rec.rationaleAr : rec.rationaleEn,
          confidence: rec.confidence,
          action: lang === "ar" ? rec.recommendedActionAr : rec.recommendedActionEn,
        },
      };
    },
  },
  {
    patterns: [/tco|switch.*tco|total cost|التكلفة الشاملة/i],
    handler: (lang) => {
      const { suppliers } = getProcurementSnapshot();
      const headers = lang === "ar"
        ? ["المورد", "السعر R3", "التكلفة الشاملة", "Δ"]
        : ["Supplier", "R3 Price", "TCO", "Δ"];
      const rows = ["sup-a", "sup-b", "sup-c", "sup-l", "sup-d"].map((sid) => {
        const s = suppliers.find((x) => x.id === sid)!;
        const p = totalForSupplier(sid as string, 3);
        const tco = tcoForSupplier(sid as string, 3);
        return [
          lang === "ar" ? s.nameAr : s.nameEn,
          fmtSARm(p),
          fmtSARm(tco),
          `${(((tco - p) / p) * 100).toFixed(1)}%`,
        ];
      });
      return {
        agent: "tco",
        type: "table",
        text: lang === "ar"
          ? "تمّ التحويل إلى عرض التكلفة الشاملة في ساحة الحدث. الفروقات تشمل الشحن وشروط الدفع وزمن التسليم والاستدامة."
          : "Switched the workspace bid matrix to TCO view. Deltas include freight, payment terms, lead-time, and ESG adjustments.",
        data: { headers, rows },
        effect: { kind: "set-cost-view", view: "tco", navigateTo: "workspace" },
      };
    },
  },
  {
    patterns: [/draft.*counter|counter.*supplier|عرض مضادّ|مضادّ/i],
    handler: (lang) => {
      const { counterDrafts, suppliers } = getProcurementSnapshot();
      const draft = counterDrafts[0];
      const sup = suppliers.find((x) => x.id === draft.supplierId)!;
      return {
        agent: "drafter",
        type: "memo",
        text: lang === "ar"
          ? `صياغة العرض المضادّ لـ ${sup.nameAr} جاهزة في كاتب العرض المضادّ — افتح اللوحة لتحرير وإرسال.`
          : `Counter-bid for ${sup.nameEn} is staged in the Counter-bid composer — opening it now so you can edit and send.`,
        data: {
          subject: lang === "ar" ? draft.subjectAr : draft.subjectEn,
          bullets: [
            lang === "ar" ? "تخفيض 3.4% على البندَين LI-13 و LI-15" : "3.4% take-down on LI-13 and LI-15",
            lang === "ar" ? "زمن تسليم 14 يوماً على LI-03 و LI-21" : "14-day lead-time on LI-03 and LI-21",
            lang === "ar" ? "شروط دفع 60 يوماً صافي" : "Payment terms net-60",
          ],
          action: lang === "ar" ? "فتح كاتب العرض المضادّ" : "Open Counter-bid composer",
        },
        effect: { kind: "navigate", navigateTo: "counter" },
      };
    },
  },
  {
    patterns: [/pre.?qual|prequal|esg|تأهيل|استدامة/i],
    handler: (lang) => {
      const { suppliers } = getProcurementSnapshot();
      const flagged = suppliers.filter((s) => !s.preQualified || s.flagsEn.length > 0);
      return {
        agent: "critic",
        type: "list",
        text: lang === "ar" ? "موردون بحاجة لمراجعة التأهيل:" : "Suppliers requiring pre-qual review:",
        data: {
          items: flagged.map((s) => lang === "ar"
            ? `${s.nameAr} — ${s.preQualified ? s.flagsAr.join("، ") : "تأهيل ناقص"}`
            : `${s.nameEn} — ${s.preQualified ? s.flagsEn.join(", ") : "Pre-qual incomplete"}`),
        },
      };
    },
  },
  {
    patterns: [/regret|left on the table|table.*left|على الطاولة|تركنا/i],
    handler: (lang) => {
      const regret = regretVsLowestPrice();
      // Build a small bar series comparing the two scenarios so the chat
      // surfaces a chart (not just a number) for intent #7.
      const { suppliers } = getProcurementSnapshot();
      const top = suppliers.slice(0, 5).map((s) => ({
        label: s.code,
        value: Math.round(totalForSupplier(s.id, 3) / 1_000_000 * 10) / 10,
      }));
      return {
        agent: "spend",
        type: "chart",
        text: lang === "ar"
          ? `بالمقارنة مع التقسيم النظري على مستوى البنود (أقلّ سعر لكل بند) فإن الترسية الموصى بها تكلّف ${fmtSARm(regret)} إضافياً — وهو هامش متقبَّل لتجنّب 12 عقد منفصل. أدناه إجمالي عرض الجولة 3 لأبرز خمسة موردين (مليون ريال).`
          : `Vs. theoretical line-by-line lowest-price split, the recommended award costs ${fmtSARm(regret)} more — an acceptable premium to avoid 12 fragmented contracts. Below: R3 totals for the top five bidders (SAR millions).`,
        data: {
          headline: fmtSARm(regret),
          headlineLabel: lang === "ar" ? "هامش الترسية" : "Award premium",
          unit: lang === "ar" ? "مليون ريال" : "SAR M",
          bars: top,
        },
      };
    },
  },
  {
    patterns: [/brief.*meeting|award.*meeting|brief|إيجاز|اجتماع.*ترسية/i],
    handler: (lang) => {
      const memo = generateAwardMemo(lang);
      return {
        agent: "orch",
        type: "memo",
        text: memo.headline,
        data: { subject: memo.headline, bullets: memo.bullets },
      };
    },
  },
  {
    patterns: [/hello|^hi\b|hey|مرحبا|السلام/i],
    handler: (lang) => ({
      agent: "orch",
      type: "text",
      text: lang === "ar"
        ? "أهلاً فيصل. الجولة 3 من حدث الصيانة أُغلقت. اسألني عن الوفورات أو الترسية أو الموردين."
        : "Hello Faisal. Round 3 of the MRO event is closed. Ask me about savings, the recommended award, or suppliers.",
    }),
  },
];

export function matchIntent(query: string, lang: DemoLang): ChatResponse {
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(query))) {
      return intent.handler(lang);
    }
  }
  return {
    agent: "orch",
    type: "text",
    text: lang === "ar"
      ? "حاول طلب: \"الوفورات مقابل الأساس\"، \"أوصِ بالترسية\"، \"التكلفة الشاملة\"، \"تحسّن R3\"، \"تأهيل\"، أو \"إيجاز اجتماع الترسية\"."
      : "Try: \"savings vs baseline\", \"recommend the award\", \"switch to TCO\", \"who improved in R3\", \"pre-qual\", or \"brief me for the award meeting\".",
  };
}
