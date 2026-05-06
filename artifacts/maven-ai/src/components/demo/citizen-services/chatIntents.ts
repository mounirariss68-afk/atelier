import type { DemoLang } from "./DemoLangContext";
import {
  ACTIVE_CASES, MINISTRIES, SERVICES, getCitizen, getCase, getMinistry, getService, tt,
} from "@/data/citizen-services-seed";
import { findCaseLike, casesBreachingIn, getMinistryVolume } from "@/data/citizen-services-agent";

export type ChatResponseType = "text" | "metric" | "list" | "table" | "chart" | "case-card" | "sms-card";

export interface ChatResponse {
  agent: "orch" | "policy" | "drafter" | "audit" | "conf" | "nlu";
  text: string;
  type: ChatResponseType;
  data?: Record<string, unknown>;
}

interface Intent { patterns: RegExp[]; handler: (lang: DemoLang) => ChatResponse }

const INTENTS: Intent[] = [
  {
    patterns: [/brief.*case/i, /case\s*csc[- ]?2026[- ]?\d{4}/i, /لخّص.*قضي/i, /قضي.*csc/i, /1421/],
    handler: (lang) => {
      const c = findCaseLike("1421") ?? ACTIVE_CASES[0];
      const cit = getCitizen(c.citizenId);
      const svc = getService(c.serviceId);
      const evidence = c.ministryTouchpoints.map((t) => {
        const m = getMinistry(t.ministryId);
        return `• ${m ? tt(m.short, lang) : t.ministryId} — ${tt(t.label, lang)} (${t.status})`;
      }).join("\n");
      return {
        agent: "orch",
        type: "case-card",
        text: lang === "en"
          ? `${c.id} — ${cit ? cit.name.en : ""} · ${svc ? svc.name.en : ""}\n\nEvidence pack:\n${evidence}\n\nNext step: ${c.agentNextStep.en}`
          : `${c.id} — ${cit ? cit.name.ar : ""} · ${svc ? svc.name.ar : ""}\n\nحزمة الأدلة:\n${evidence}\n\nالخطوة التالية: ${c.agentNextStep.ar}`,
        data: { caseId: c.id },
      };
    },
  },
  {
    patterns: [/breach.*sla/i, /sla.*24/i, /خرق.*خدمة/i, /24.*ساعة/i, /breach/i],
    handler: (lang) => {
      const list = casesBreachingIn(24);
      const headers = lang === "en" ? ["Case", "Service", "Hours left"] : ["القضية", "الخدمة", "ساعات متبقية"];
      const rows = list.map((c) => {
        const svc = getService(c.serviceId);
        const hLeft = Math.max(0, Math.round((Date.parse(c.slaDueAt) - Date.now()) / 3_600_000));
        return [c.id, svc ? tt(svc.name, lang) : c.serviceId, String(hLeft)];
      });
      return {
        agent: "conf",
        type: "table",
        text: lang === "en" ? `${list.length} case(s) at risk in next 24h.` : `${list.length} قضية في خطر خلال 24 ساعة.`,
        data: { headers, rows },
      };
    },
  },
  {
    patterns: [/book.*inspect/i, /municipal.*inspect/i, /احجز.*تفتيش/i, /تفتيش.*بلدي/i],
    handler: (lang) => ({
      agent: "orch",
      type: "case-card",
      text: lang === "en"
        ? "Recommended booking for CSC-2026-1421:\n• Tue 5 May 14:00 — Inspector Bandar\n• Site: Olaya district, ground-floor café 80 m²\n\nApprove from the Approvals tab to confirm and dispatch the internal note."
        : "الحجز الموصى به لـ CSC-2026-1421:\n• الثلاثاء 5 مايو 14:00 — المفتش بندر\n• الموقع: حي العليا، مقهى دور أرضي 80 م²\n\nاعتمد من تبويب الاعتمادات للتأكيد وإرسال الملاحظة الداخلية.",
      data: { caseId: "CSC-2026-1421" },
    }),
  },
  {
    patterns: [/draft.*sms/i, /draft.*arab/i, /اكتب.*رسالة/i, /مسوّدة.*رسالة/i],
    handler: (lang) => ({
      agent: "drafter",
      type: "sms-card",
      text: lang === "en" ? "Bilingual SMS draft (Najdi-tolerant):" : "مسوّدة رسالة ثنائية اللغة (متوافقة مع اللهجة النجدية):",
      data: {
        ar: "مرحباً أبو راشد — تجديد رخصتك التجارية مكتمل بنسبة 75%. الخطوة الأخيرة تفتيش بلدي، وقد حجزنا لك الثلاثاء 5 مايو 14:00. للتأكيد: https://gov.sa/insp/2026-1421",
        en: "Hello Mr Rashed — your commercial licence renewal is 75% complete. Final step: a municipal inspection. We've reserved Tue 5 May 14:00 for you. Confirm: https://gov.sa/insp/2026-1421",
      },
    }),
  },
  {
    patterns: [/cases.*by.*ministry/i, /ministry.*today/i, /قضايا.*جهة/i, /حسب.*جهة/i],
    handler: (lang) => {
      const data = getMinistryVolume();
      return {
        agent: "policy",
        type: "chart",
        text: lang === "en" ? "Cases touching each ministry today (active + resolved this week):" : "القضايا التي مرّت على كل جهة (نشطة + مغلقة هذا الأسبوع):",
        data: {
          chartType: "bar",
          chartData: data.map((d) => {
            const m = getMinistry(d.ministryId);
            return { name: m ? tt(m.short, lang) : d.ministryId, value: d.volume, color: d.color };
          }),
        },
      };
    },
  },
  {
    patterns: [/average.*wait/i, /avg.*wait/i, /average.*ttr/i, /متوسط.*انتظار/i, /متوسط.*خدمة/i],
    handler: (lang) => {
      const headers = lang === "en" ? ["Service", "Avg wait"] : ["الخدمة", "متوسط الانتظار"];
      const rows = SERVICES.map((s, i) => [tt(s.name, lang), `${10 + ((i * 7) % 18)}h ${10 + ((i * 5) % 50)}m`]);
      return {
        agent: "audit",
        type: "table",
        text: lang === "en" ? "Average citizen wait by service (rolling 7d):" : "متوسط انتظار المواطن حسب الخدمة (آخر 7 أيام):",
        data: { headers, rows },
      };
    },
  },
  {
    patterns: [/zatca.*escal/i, /who.*handles.*zatca/i, /من.*يتولى.*زكاة/i, /تصعيد.*زكاة/i],
    handler: (lang) => ({
      agent: "policy",
      type: "metric",
      text: lang === "en"
        ? "ZATCA escalations route to Mansour Al-Otaibi (Tax Liaison Desk). Avg response 3h 12m. Phone: x4129."
        : "تصعيدات الزكاة توجَّه إلى منصور العتيبي (مكتب اتصال الضرائب). متوسط الاستجابة 3س 12د. هاتف: x4129.",
      data: { value: "Mansour Al-Otaibi", target: "Tax Liaison Desk", trend: "neutral", delta: "3h 12m" },
    }),
  },
  {
    patterns: [/citizen 360/i, /citizen.*id\s*\d{4}/i, /open.*citizen/i, /بطاقة.*المواطن/i],
    handler: (lang) => {
      const c = ACTIVE_CASES[0];
      const cit = getCitizen(c.citizenId);
      if (!cit) return { agent: "nlu", type: "text", text: lang === "en" ? "No citizen matched." : "لم يُعثر على مواطن." };
      return {
        agent: "nlu",
        type: "list",
        text: lang === "en" ? `Citizen 360 — ${cit.name.en}` : `بطاقة المواطن — ${cit.name.ar}`,
        data: {
          items: [
            { k: lang === "en" ? "National ID" : "الهوية", v: cit.nationalId },
            { k: lang === "en" ? "Channel"     : "القناة", v: cit.channelPref },
            { k: lang === "en" ? "Past interactions" : "تفاعلات سابقة", v: String(cit.pastInteractions) },
            { k: lang === "en" ? "Open cases" : "قضايا مفتوحة", v: cit.openCaseIds.join(", ") },
          ],
        },
      };
    },
  },
  {
    patterns: [/hello/i, /\bhi\b/i, /good morning/i, /مرحبا/i, /السلام/i, /صباح/i],
    handler: (lang) => ({
      agent: "orch",
      type: "text",
      text: lang === "en"
        ? "Good morning Yousef. 12 of 14 cases were pre-worked overnight; CSC-2026-1421 needs your approval first. What would you like to look at?"
        : "صباح الخير يوسف. أُعدّت 12 من 14 قضية مسبقاً ليلاً؛ CSC-2026-1421 تحتاج اعتمادك أولاً. ماذا تريد أن نفتح؟",
    }),
  },
];

export function matchIntent(input: string, lang: DemoLang): ChatResponse {
  for (const i of INTENTS) {
    if (i.patterns.some((p) => p.test(input))) return i.handler(lang);
  }
  // Fallback: try to find any case mentioned
  const c = findCaseLike(input);
  if (c) {
    const cit = getCitizen(c.citizenId);
    const svc = getService(c.serviceId);
    return {
      agent: "orch",
      type: "case-card",
      text: lang === "en"
        ? `${c.id} — ${cit?.name.en ?? ""} · ${svc?.name.en ?? ""}\nStatus: ${c.status}\nNext step: ${c.agentNextStep.en}`
        : `${c.id} — ${cit?.name.ar ?? ""} · ${svc?.name.ar ?? ""}\nالحالة: ${c.status}\nالخطوة التالية: ${c.agentNextStep.ar}`,
      data: { caseId: c.id },
    };
  }
  return {
    agent: "orch",
    type: "text",
    text: lang === "en"
      ? "I can brief a case (e.g. \"CSC-2026-1421\"), list SLA-at-risk cases, draft an SMS, or show ministry volumes. What would you like?"
      : "أستطيع تلخيص قضية (مثل \"CSC-2026-1421\")، أو سرد القضايا المهدّدة، أو كتابة رسالة، أو عرض أحجام الجهات. كيف أساعدك؟",
  };
}
