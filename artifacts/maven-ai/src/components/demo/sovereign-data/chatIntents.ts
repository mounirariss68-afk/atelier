import type { DemoLang } from "./DemoLangContext";
import {
  generateRecommendations, getKpis, staleProducts, blockedProducts, ownersIndex,
} from "@/data/sovereign-data-agent";
import { DATA_PRODUCTS, productById, OBLIGATIONS, ACTIVE_LINEAGE_NODES } from "@/data/sovereign-data-seed";

export type ChatAgent = "orch" | "schema" | "ner" | "pipeline" | "lineage" | "contract";
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

function pick(lang: DemoLang, en: string, ar: string) { return lang === "en" ? en : ar; }

const INTENTS: Intent[] = [
  // 1. Brief on Citizen Sentiment
  {
    patterns: [/citizen.*sentiment|brief.*sentiment|active.*product|status.*sentiment/i, /لخّص.*مشاعر|مشاعر المواطنين|المنتج النشط/i],
    handler: (lang) => ({
      agent: "orch", type: "list",
      text: pick(lang,
        "Citizen Sentiment Dashboard — run complete at 11:54. 14,031 rows produced, sink-1 populated, sink-2 blocked. Three pieces of evidence:",
        "لوحة مشاعر المواطنين — اكتملت 11:54. 14,031 صفّاً، الأول معبّأ والثاني محجوب. ثلاثة أدلّة:"),
      data: {
        items: [
          pick(lang, "Schema Explorer: 4 sources profiled, 142 columns total, 1 stale classification refreshed.", "المستكشف: 4 مصادر، 142 عموداً، تصنيف قديم جُدِّد."),
          pick(lang, "Arabic NER: PII density 4.1% on contact-centre transcripts; classification raised to sensitive.", "الكيانات العربية: PII 4.1%؛ ترفيع التصنيف."),
          pick(lang, "Lineage Compiler: 14/14 PDPL controls passed; sink-2 (Frankfurt BI) blocked under Article 13.", "مسجّل النسب: 14/14 ضوابط PDPL؛ المصبّ الثاني محجوب وفق المادة 13."),
        ],
      },
    }),
  },
  // 2. Show blocked sinks
  {
    patterns: [/block(ed)?.*(sink|product)|sink.*block|frankfurt|محجوب|محجوبة|المصبّ/i],
    handler: (lang) => {
      const list = blockedProducts();
      return {
        agent: "lineage", type: "list",
        text: pick(lang,
          `${list.length} product(s) with at least one blocked sink. Lineage Compiler cites the obligation on each.`,
          `${list.length} منتج بمصبّ محجوب على الأقل.`),
        data: {
          items: list.slice(0, 8).map((p) => `${p.name[lang]} — ${p.blockedSinks} ${pick(lang, "blocked", "محجوب")}`),
        },
      };
    },
  },
  // 3. List PDPL obligations enforced
  {
    patterns: [/pdpl|ndmo|sdaia|obligation|clause|بند|التزام|PDPL/i],
    handler: (lang) => ({
      agent: "lineage", type: "table",
      text: pick(lang,
        "Obligations register — every named clause Lineage Compiler enforced this week.",
        "سجل الالتزامات — كل بند طبّقه مسجّل النسب هذا الأسبوع."),
      data: {
        headers: [pick(lang, "Framework", "الإطار"), pick(lang, "Clause", "البند"), pick(lang, "Topic", "الموضوع")],
        rows: OBLIGATIONS.slice(0, 8).map((o) => [o.framework, o.clause, o.topic[lang]]),
      },
    }),
  },
  // 4. Draft quality contract
  {
    patterns: [/draft.*contract|quality.*contract|sign.*contract|عقد|صُغ.*عقد|الجودة/i],
    handler: (lang) => {
      const p = productById("citizen-sentiment-dashboard")!;
      return {
        agent: "contract", type: "memo",
        text: pick(lang, "Quality contract draft from Quality Contract Drafter:", "مسوّدة عقد الجودة من كاتب العقد:"),
        data: {
          title: `${p.name[lang]} — ${pick(lang, "Quality Contract v1.0", "عقد الجودة 1.0")}`,
          paragraphs: [
            pick(lang,
              `Refresh ${p.contractRefresh.en}. Completeness ${p.contractCompleteness}. Latency ${p.contractLatency.en}.`,
              `تواتر ${p.contractRefresh.ar}. اكتمال ${p.contractCompleteness}. زمن ${p.contractLatency.ar}.`),
            pick(lang,
              "Classification: sensitive · citizen-PII. Retention: 90 days hot, 2 years archive. Residency: in-Kingdom only.",
              "تصنيف حسّاس. احتفاظ 90 يوماً حار وسنتان أرشيف. الإقامة داخل المملكة فقط."),
            pick(lang,
              "On-call owner: Layla Al-Otaibi (Ministry CX). Breach protocol: PDPL incident playbook v3. Two-person sign-off required.",
              "المسؤول: ليلى العتيبي (CX). بروتوكول الخرق: PDPL ن3. توقيع مزدوج مطلوب."),
          ],
        },
      };
    },
  },
  // 5. Open lineage map
  {
    patterns: [/open.*lineage|lineage.*map|graph|نسب|خريطة.*نسب|افتح.*نسب/i],
    handler: (lang) => ({
      agent: "orch", type: "navigate",
      text: pick(lang,
        "Opening the lineage map zoomed to Citizen Sentiment Dashboard — sink-2 highlighted in red.",
        "فتح خريطة النسب مع التركيز على لوحة مشاعر المواطنين — المصبّ الثاني بالأحمر."),
      data: { view: "lineage", focus: "citizen-sentiment-dashboard" },
    }),
  },
  // 6. Stale products
  {
    patterns: [/stale|old|outdated|قديم|متقادم|أي.*منتجات/i],
    handler: (lang) => {
      const list = staleProducts();
      return {
        agent: "schema", type: "list",
        text: pick(lang,
          `${list.length} active product(s) with freshness over 3 days:`,
          `${list.length} منتج نشط نضارته أكثر من 3 أيام:`),
        data: {
          items: list.map((p) => `${p.name[lang]} — ${Math.round(p.freshnessMin / 1440)}d`),
        },
      };
    },
  },
  // 7. Owners index
  {
    patterns: [/who.*own|owner|steward|من.*يملك|المالك|الحارس/i],
    handler: (lang) => {
      const idx = ownersIndex().slice(0, 8);
      return {
        agent: "orch", type: "table",
        text: pick(lang, "Top data stewards by product count:", "أبرز الحرّاس حسب عدد المنتجات:"),
        data: {
          headers: [pick(lang, "Steward", "الحارس"), pick(lang, "Org", "الجهة"), pick(lang, "Products", "المنتجات")],
          rows: idx.map((o) => [o.owner[lang], o.org[lang], String(o.productCount)]),
        },
      };
    },
  },
  // 8. Where am I waiting on humans
  {
    patterns: [/wait.*human|approval|pending|gate|أنتظر|بانتظار|الموافق/i],
    handler: (lang) => {
      const recs = generateRecommendations().filter((r) => r.status === "pending" && r.isCheckpoint);
      return {
        agent: "orch", type: "navigate",
        text: pick(lang,
          `${recs.length} human gate(s) open: ${recs.map((r) => r.checkpointHuman?.[lang]).join(", ")}. Opening Approvals.`,
          `${recs.length} نقطة بشرية مفتوحة. فتح الموافقات.`),
        data: { view: "approvals" },
      };
    },
  },
  // Greeting
  {
    patterns: [/^\s*(hi|hello|hey|good morning|salam)/i, /مرحب|أهلا|السلام|صباح/i],
    handler: (lang) => ({
      agent: "orch", type: "text",
      text: pick(lang,
        "Good morning, Mansour. Citizen Sentiment is the headline today — run complete, two gates waiting.",
        "صباح الخير منصور. مشاعر المواطنين عنوان اليوم — الجولة مكتملة، نقطتان بشريتان."),
    }),
  },
];

export function matchSdsIntent(input: string, lang: DemoLang): ChatResponse {
  const text = input.trim();
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(text))) {
      return intent.handler(lang);
    }
  }
  const k = getKpis();
  return {
    agent: "orch", type: "text",
    text: pick(lang,
      `I can brief Citizen Sentiment, list blocked sinks, draft contracts, open lineage, or list obligations. Right now: ${k.active} active products, ${k.pending} pending decisions, ${k.blockedSinks} blocked sinks named.`,
      `يمكنني تلخيص مشاعر المواطنين، أو عرض المحجوب، أو صياغة العقود. الآن: ${k.active} نشط، ${k.pending} بانتظار، ${k.blockedSinks} محجوب.`),
  };
}

export const _nodes = ACTIVE_LINEAGE_NODES;
