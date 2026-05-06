import { getValueRealizationSnapshot } from "@/hooks/useValueRealizationData";
import {
  totals,
  topStalled,
  sponsorBreakdown,
  generateRecommendations,
  generateChaseQueue,
  generateAuditLog,
  forecastRealised,
  formatAED,
  gap,
  realisationPct,
  CONDUCTOR_AGENTS,
  type ConductorAgentId,
} from "@/data/value-realization-agent";
import {
  getInitiative,
  getSponsor,
  PERSONA,
  type Initiative,
} from "@/data/value-realization-seed";
import type { DemoLang } from "./DemoLangContext";

export type ResponseType = "text" | "metric" | "table" | "list" | "rec-card" | "chart";

export type NavTarget = "portfolio" | "initiative" | "approvals" | "chase" | "whatif" | "audit";

export interface ChatNavigation {
  view: NavTarget;
  initiativeId?: string;
  /** Button label shown in the chat bubble. */
  cta: { en: string; ar: string };
}

export interface ChatResponse {
  agentId: ConductorAgentId;
  text: string;
  type: ResponseType;
  data?: Record<string, unknown>;
  /** Optional hook so the AI assistant can move the user into the
   * matching cockpit view rather than only replying with text. */
  navigate?: ChatNavigation;
}

interface Intent {
  id: string;
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

const pick = (lang: DemoLang, en: string, ar: string) => (lang === "ar" ? ar : en);

function snap() { return getValueRealizationSnapshot(); }

const INTENTS: Intent[] = [
  // 1 — overall realisation against the headline portfolio promise
  {
    id: "realisation-overall",
    patterns: [/how (am|are) (i|we) doing/i, /overall/i, /portfolio.*realis/i, /realis.*portfolio/i, /promise/i, /أين نحن/, /إجمالي/, /المجموع/, /الموعود/],
    handler: (lang) => {
      const t = totals();
      return {
        agentId: "claim-compiler",
        type: "metric",
        text: pick(lang,
          `You promised the board ${formatAED(t.promised)} of annual value across the portfolio. We're currently realising ${formatAED(t.realized)} run-rate — a ${t.gapPct}% gap of ${formatAED(t.gap)}. ${t.atRiskCount} initiatives are at risk and explain most of the shortfall.`,
          `وعدتِ المجلس بـ ${formatAED(t.promised)} قيمة سنوية عبر المحفظة. تحقّق حاليًا ${formatAED(t.realized)} وتيرة — فجوة ${t.gapPct}% تعادل ${formatAED(t.gap)}. ${t.atRiskCount} مبادرة معرّضة للخطر تفسّر معظم النقص.`),
        data: {
          value: formatAED(t.realized),
          target: formatAED(t.promised),
          delta: `-${formatAED(t.gap)}`,
          trend: "down",
        },
      };
    },
  },
  // 2 — stalled initiatives
  {
    id: "stalled",
    patterns: [/stall/i, /at risk/i, /metev/i, /which.*risk/i, /متعثّر/, /متعثر/, /خطر/],
    handler: (lang) => {
      const items = topStalled(5);
      const headers = lang === "ar"
        ? ["المبادرة", "الفجوة", "الانجراف"]
        : ["Initiative", "Gap", "Drift"];
      const rows = items.map((i) => [
        lang === "ar" ? i.name.ar : i.name.en,
        formatAED(gap(i)),
        i.driftDays > 0 ? `${i.driftDays}d` : "—",
      ]);
      return {
        agentId: "attribution-critic",
        type: "table",
        text: pick(lang,
          `Top 5 stalled initiatives by gap to promise. Hospitality Revenue and Procurement Intelligence carry the biggest dollars; Internal-Audit Co-pilot has been stalled longest.`,
          `أعلى 5 مبادرات متعثّرة حسب الفجوة. إيرادات الضيافة وذكاء المشتريات يحملان أكبر الأرقام؛ مساعد التدقيق الداخلي الأطول تعثّرًا.`),
        data: { headers, rows },
        navigate: { view: "chase", cta: { en: "Open the Chase Queue →", ar: "افتح طابور المتابعة ←" } },
      };
    },
  },
  // 3 — what did the conductor do overnight
  {
    id: "overnight",
    patterns: [/overnight/i, /last.*night/i, /what.*conduct.*do/i, /chase.*queue/i, /ليلًا/, /ليل/, /الليلة/, /متابعة/],
    handler: (lang) => {
      const queue = generateChaseQueue();
      const lines = queue.slice(0, 6).map((c) => {
        const agent = CONDUCTOR_AGENTS.find((a) => a.id === c.agentId);
        const aname = lang === "ar" ? agent?.name.ar : agent?.name.en;
        const lbl = lang === "ar" ? c.label.ar : c.label.en;
        return `• [${aname}] ${lbl}`;
      }).join("\n");
      return {
        agentId: "realization-conductor",
        type: "text",
        text: pick(lang,
          `Overnight, the Conductor ran 9 chase items across 5 initiatives:\n\n${lines}\n\nThe Re-baseline Drafter has the contact-centre memo in flight; the Sponsor Escalator has the hospitality escalation queued.`,
          `ليلًا، نفّذ المنسّق 9 مهامّ متابعة عبر 5 مبادرات:\n\n${lines}\n\nكاتب إعادة الاحتساب يُعدّ مذكّرة مركز الاتصال؛ ومُصعّد الراعي جاهز بتصعيد الضيافة.`),
        navigate: { view: "chase", cta: { en: "See the full chase board →", ar: "عرض لوح المتابعة الكامل ←" } },
      };
    },
  },
  // 4 — board brief
  {
    id: "board-brief",
    patterns: [/board/i, /brief/i, /wednesday/i, /one.?pager/i, /مجلس/, /حزمة/, /ملخّص/, /اربعاء/, /أربعاء/],
    handler: (lang) => {
      const t = totals();
      return {
        agentId: "claim-compiler",
        type: "rec-card",
        text: pick(lang,
          `Wednesday's board one-pager (draft):\n\n• Headline: AI portfolio realising ${formatAED(t.realized)} of ${formatAED(t.promised)} promised — ${t.gapPct}% gap, ${t.atRiskCount} initiatives flagged.\n• Win to feature: SAMA Compliance — 80% realised, zero open audit findings.\n• Asks: re-baseline Contact Centre to AED 14M; CDO to unblock Hospitality PDPL review in 14 days.\n\nClaim Compiler can hand you the slide draft with citations.`,
          `مسوّدة صفحة مجلس الأربعاء:\n\n• العنوان: المحفظة تحقّق ${formatAED(t.realized)} من ${formatAED(t.promised)} موعودًا — فجوة ${t.gapPct}%، ${t.atRiskCount} مبادرة مُعلّمة.\n• قصة النجاح: ساما — 80% تحقّق وصفر ملاحظات تدقيق مفتوحة.\n• الطلبات: إعادة احتساب مركز الاتصال إلى 14 مليون؛ تكليف رئيسة البيانات بفكّ حصار PDPL خلال 14 يومًا.\n\nبإمكان مُجمِّع الادّعاءات تسليمك مسوّدة الشريحة بالمصادر.`),
        navigate: { view: "approvals", cta: { en: "Review & sign in Approvals →", ar: "راجعي ووقّعي في الموافقات ←" } },
      };
    },
  },
  // 5 — sponsor breakdown
  {
    id: "sponsors-blocking",
    patterns: [/sponsor/i, /who.*blocking/i, /chase.*who/i, /راعي/, /يعرقل/, /يعرقلون/],
    handler: (lang) => {
      const sb = sponsorBreakdown();
      const headers = lang === "ar" ? ["الراعي", "متعثّرات", "فجوة"] : ["Sponsor", "Stalled", "Gap"];
      const rows = sb.map((s) => {
        const sp = getSponsor(s.sponsorId);
        return [
          lang === "ar" ? sp?.name.ar ?? "" : sp?.name.en ?? "",
          String(s.stalledCount),
          formatAED(s.gap),
        ];
      });
      return {
        agentId: "sponsor-escalator",
        type: "table",
        text: pick(lang,
          `Sponsor Escalator — leaders by stalled gap. Tariq Bin Saleh (CPO) and Mariam Al-Hashimi (CDO) are carrying the biggest blocked dollars right now.`,
          `مُصعّد الراعي — القادة حسب الفجوة المتعثّرة. طارق بن صالح (مدير المشتريات) ومريم الهاشمي (رئيسة البيانات) يحملان أكبر الأرقام المحظورة حاليًا.`),
        data: { headers, rows },
        navigate: { view: "portfolio", cta: { en: "Filter the portfolio →", ar: "تصفية المحفظة ←" } },
      };
    },
  },
  // 6 — Q2 forecast
  {
    id: "forecast",
    patterns: [/forecast/i, /q2/i, /if.*adoption/i, /what.*if/i, /توقّع/, /التبنّي/, /ماذا لو/],
    handler: (lang) => {
      const i = getInitiative("vr-contact-centre")!;
      const projected = forecastRealised(i, 35, 0);
      const upside = forecastRealised(i, 60, 0);
      return {
        agentId: "rebaseline-drafter",
        type: "chart",
        text: pick(lang,
          `If contact-centre adoption stays at 35%, the Q2 run-rate holds near ${formatAED(projected)}. Lifting adoption to 60% (the re-baseline gate) gets us to ${formatAED(upside)} — closing roughly half of the gap.`,
          `إذا ظلّ تبنّي مركز الاتصال 35%، تبقى الوتيرة قرب ${formatAED(projected)} في الربع الثاني. رفع التبنّي إلى 60% (بوابة إعادة الاحتساب) يصل بنا إلى ${formatAED(upside)} — يغلق نحو نصف الفجوة.`),
        data: {
          chartType: "bar",
          label: pick(lang, "Forecasted run-rate (AED)", "الوتيرة المتنبّأة (درهم)"),
          chartData: [
            { name: pick(lang, "Today", "اليوم"), value: Math.round(i.realizedAnnual / 1_000_000 * 10) / 10 },
            { name: pick(lang, "Q2 @ 35%", "الربع الثاني 35%"), value: Math.round(projected / 1_000_000 * 10) / 10 },
            { name: pick(lang, "Q2 @ 60%", "الربع الثاني 60%"), value: Math.round(upside / 1_000_000 * 10) / 10 },
            { name: pick(lang, "Promised", "الموعود"), value: Math.round(i.promisedAnnual / 1_000_000 * 10) / 10 },
          ],
        },
        navigate: { view: "whatif", initiativeId: i.id, cta: { en: "Open What-if simulator →", ar: "افتح محاكي ماذا-لو ←" } },
      };
    },
  },
  // 7 — audit log
  {
    id: "audit",
    patterns: [/audit/i, /log/i, /سجل/, /تدقيق/],
    handler: (lang) => {
      const log = generateAuditLog();
      const last = log.slice(0, 5);
      const lines = last.map((e) => {
        const a = lang === "ar" ? e.actor.ar : e.actor.en;
        const act = lang === "ar" ? e.action.ar : e.action.en;
        const ts = new Date(e.ts).toLocaleTimeString(lang === "ar" ? "ar-AE" : "en-AE", { hour: "2-digit", minute: "2-digit" });
        return `• ${ts} — ${a}: ${act}`;
      }).join("\n");
      return {
        agentId: "evidence-auditor",
        type: "text",
        text: pick(lang,
          `Last 5 audit events:\n\n${lines}\n\nFull log is one click away — Audit Log in the side nav.`,
          `آخر 5 أحداث:\n\n${lines}\n\nالسجل الكامل بنقرة — «سجل التدقيق» في القائمة الجانبية.`),
        navigate: { view: "audit", cta: { en: "Open the audit log →", ar: "افتح سجل التدقيق ←" } },
      };
    },
  },
  // 8 — re-baseline action
  {
    id: "rebaseline",
    patterns: [/re.?baseline/i, /contact.?centre/i, /contact.?center/i, /إعادة.*احتساب/, /مركز الاتصال/],
    handler: (lang) => {
      const recs = generateRecommendations();
      const r = recs.find((x) => x.kind === "rebaseline");
      const i = r ? getInitiative(r.initiativeId)! : snap().initiatives[0];
      return {
        agentId: "rebaseline-drafter",
        type: "rec-card",
        text: pick(lang,
          `The Re-baseline Drafter has a memo ready for ${i.name.en}: lower the annual target from ${formatAED(i.promisedAnnual)} to AED 14M with a 60% adoption gate by Q3. ${realisationPct(i)}% of the original plan has actually arrived in the P&L. Confidence on the new plan: 87%.\n\nGo to Approvals to sign or edit the memo.`,
          `لدى كاتب إعادة الاحتساب مذكّرة جاهزة لـ ${i.name.ar}: خفض الهدف السنوي من ${formatAED(i.promisedAnnual)} إلى 14 مليون درهم مع بوابة تبنّي 60% بحلول الربع الثالث. ${realisationPct(i)}% من الخطّة الأصلية وصلت فعلًا للربح والخسارة. الثقة في الخطة الجديدة: 87%.\n\nتفضّلي إلى الموافقات للتوقيع أو التعديل.`),
        navigate: { view: "approvals", initiativeId: i.id, cta: { en: "Open the re-baseline memo →", ar: "افتح مذكّرة إعادة الاحتساب ←" } },
      };
    },
  },
];

export const QUICK_PROMPT_KEYS = ["prompt1", "prompt2", "prompt3", "prompt4", "prompt5", "prompt6", "prompt7", "prompt8"] as const;

export function matchIntent(text: string, lang: DemoLang): ChatResponse {
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(text))) {
      return intent.handler(lang);
    }
  }
  // Fallback — friendly redirect.
  const t = totals();
  return {
    agentId: "realization-conductor",
    type: "text",
    text: pick(lang,
      `I couldn't pinpoint that one, ${PERSONA.name.en.split(" ")[0]}. Try asking about the AED 84M, stalled initiatives, what the Conductor did overnight, the board brief, sponsor blockers, a Q2 forecast, the audit log, or the contact-centre re-baseline.`,
      `لم أستطع تحديد ذلك، ${PERSONA.name.ar.split(" ")[0]}. جرّبي السؤال عن 84 مليون درهم، أو المتعثّرات، أو ما فعله المنسّق ليلًا، أو ملخّص المجلس، أو الرعاة المعرقلين، أو توقّع الربع الثاني، أو سجل التدقيق، أو إعادة احتساب مركز الاتصال.`),
  };
}
