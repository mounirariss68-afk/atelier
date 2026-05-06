import type { DemoLang } from "./DemoLangContext";
import { INCIDENTS, SERVICES, CREWS, APPROVALS, computeKpis, siteById } from "@/data/network-ops-seed";

export type ChatAgent =
  | "conductor"
  | "correlator"
  | "topology-mapper"
  | "impact-translator"
  | "runbook-player"
  | "comms-drafter";
export type ChatResponseType = "text" | "metric" | "table" | "list" | "analysis" | "chart" | "draft" | "document";

export interface ChatResponse {
  agent: ChatAgent;
  text: string;
  type: ChatResponseType;
  data?: Record<string, unknown>;
}

interface Intent {
  id: string;
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

function pick(lang: DemoLang, en: string, ar: string) {
  return lang === "en" ? en : ar;
}

const SEV_RANK: Record<string, number> = { p1: 4, p2: 3, p3: 2, p4: 1 };

// 8 required intents
const INTENTS: Intent[] = [
  // Brief me on the fibre cut (3 evidence bullets)
  {
    id: "fibre-cut-brief",
    patterns: [
      /brief.*(fibre|fiber|cut|sharjah|incident|3041)/i,
      /sharjah|fibre|fiber|cut|inc-?2026-?3041|south.*feeder/i,
      /برّفني|اشرحي|لخّص.*(ألياف|قطع|الشارقة|3041)/,
      /شارقة|ألياف|قطع|جنوب/,
    ],
    handler: (lang) => {
      const inc = INCIDENTS.find((i) => i.id === "INC-2026-3041")!;
      return {
        agent: "topology-mapper",
        type: "analysis",
        text: pick(
          lang,
          `🔴 ${inc.title.en}\n\n📊 Reasoning:\n1. Telemetry: 4 cells in Sharjah-South show packet loss 9.4–14.2% — auto-detected 14:01:48.\n2. Topology: blast radius isolated to South-Sharjah feeder · 84,310 MSISDNs · 1 enterprise SLA (Sharjah Port Authority).\n3. Mitigation: rollback TX-NORTH-04 + re-route via TX-NORTH-09 restores 78% in ~6 min; 22% need field crew SHJ-1.\n\n⏱ Regulator clock: 16 min buffer remaining on the 30-min TDRA window.\n\n➡️ 4 approvals are waiting on you in the Approval queue.`,
          `🔴 ${inc.title.ar}\n\n📊 المنطق:\n1. القياس: 4 خلايا بفقد 9.4–14.2% — اكتشاف آلي 14:01:48.\n2. الطوبولوجيا: النطاق محصور بمغذّي جنوب الشارقة · 84,310 مشترك · اتفاقية واحدة (هيئة ميناء الشارقة).\n3. التخفيف: تراجع TX-NORTH-04 وإعادة التوجيه عبر TX-NORTH-09 يستعيد 78% خلال 6 دقائق؛ 22% بحاجة فريق SHJ-1.\n\n⏱ هامش المنظّم: 16 دقيقة على نافذة TDRA 30 دقيقة.\n\n➡️ 4 موافقات تنتظرك في قائمة الموافقات.`,
        ),
      };
    },
  },

  // 1. Worst incident right now
  {
    id: "worst-incident",
    patterns: [
      /worst|biggest|highest.*sev|priority.*one|p1.*now|what.*hurt|most.*urgent|headline/i,
      /أسوأ|أعلى|الأكبر|الأخطر|الأهم|عاجل|الأبرز|العنوان/,
    ],
    handler: (lang) => {
      const open = INCIDENTS.filter((i) => i.status !== "resolved");
      const worst = [...open].sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (b.affectedCustomers - a.affectedCustomers))[0];
      const sites = worst.affectedSiteIds.map((id) => siteById(id)?.name[lang] ?? id).join(" · ");
      const buf = worst.regulatorClock?.bufferMin;
      return {
        agent: "conductor",
        type: "metric",
        text: pick(
          lang,
          `Worst right now: ${worst.title.en} (${worst.severity.toUpperCase()}). ${worst.affectedCustomers.toLocaleString("en-US")} customers impacted across ${sites}. Status: ${worst.status}. ${buf ? `Regulator clock at ${buf} min buffer.` : ""}`,
          `الأسوأ الآن: ${worst.title.ar} (${worst.severity.toUpperCase()}). ${worst.affectedCustomers.toLocaleString("ar-SA")} عميلاً متأثّراً عبر ${sites}. الحالة: ${worst.status}. ${buf ? `هامش المنظّم ${buf} دقيقة.` : ""}`,
        ),
        data: {
          value: worst.severity.toUpperCase(),
          target: worst.id,
          trend: "down",
          delta: pick(lang, `${worst.affectedCustomers.toLocaleString("en-US")} customers`, `${worst.affectedCustomers.toLocaleString("ar-SA")} عميل`),
        },
      };
    },
  },

  // 2. Draft the public comms
  {
    id: "draft-comms",
    patterns: [
      /draft.*(comm|sms|message|notification|customer|status\s*page|notice)/i,
      /public\s*comm|status\s*page|customer\s*comm/i,
      /اكتب.*(رسال|إشعار|تواصل|بيان)/,
      /مسوّدة.*(رسال|إشعار|تواصل|بيان)/,
    ],
    handler: (lang) => ({
      agent: "comms-drafter",
      type: "draft",
      text: pick(
        lang,
        "Bilingual customer comms draft for the Sharjah-South incident, ready for your approval (apv-005).",
        "مسوّدة تواصل ثنائية اللغة لحادث جنوب الشارقة، جاهزة لاعتمادك (apv-005).",
      ),
      data: {
        channel: pick(lang, "SMS + email + status page", "SMS + بريد + صفحة الحالة"),
        audience: pick(lang, "84,310 affected MSISDNs · Sharjah Port Authority NOC", "84,310 مشترك متأثّر · NOC هيئة ميناء الشارقة"),
        bodyEn:
          "Sahara Telecom: We're aware of a service issue affecting mobile data and voice in South Sharjah since 14:01. Crews are on the way; we expect service restoration within ~32 minutes. We're applying a 5% goodwill credit automatically. Updates: status.saharatelecom.com",
        bodyAr:
          "صحارى تيليكوم: نعلم بوجود خلل في خدمات البيانات والصوت بجنوب الشارقة منذ الساعة 14:01. الفِرق في الطريق، ونتوقع استعادة الخدمة خلال ~32 دقيقة. سيتم احتساب رصيد حسن نية 5% تلقائياً. التحديثات: status.saharatelecom.com",
        approvalId: "apv-005",
      },
    }),
  },

  // 3. MTTR trend (line chart)
  {
    id: "mttr-trend",
    patterns: [
      /mttr|trend|mean.*time.*recover|time.*to.*resolve|chart|graph|history/i,
      /متوسّط.*استعاد|اتجاه|رسم|بياني|تاريخ.*حل/,
    ],
    handler: (lang) => ({
      agent: "conductor",
      type: "chart",
      text: pick(
        lang,
        "MTTR over the last 12 weeks. Down 38% vs the prior 12-week window — driven mostly by the agent-cast handling automated rollback within the regulator buffer.",
        "متوسّط زمن الاستعادة خلال آخر 12 أسبوعاً. انخفض 38% مقارنة بالنافذة السابقة — بفضل تنفيذ الوكلاء للتراجع الآلي ضمن هامش المنظّم.",
      ),
      data: {
        chart: "line",
        labelX: pick(lang, "Week", "أسبوع"),
        labelY: pick(lang, "MTTR (min)", "MTTR (دقيقة)"),
        series: [42, 39, 41, 36, 38, 33, 31, 29, 28, 26, 25, 24],
        deltaPct: -38,
      },
    }),
  },

  // 4. Silent errors / unalarmed risks
  {
    id: "silent-errors",
    patterns: [
      /silent|unalarmed|hidden|missing|not.*alarm|emerg|sneak|under.*radar|blind\s*spot/i,
      /صامت|خفي|مخفي|إنذار|غير\s*منبّه|تحت\s*الرادار/,
    ],
    handler: (lang) => ({
      agent: "correlator",
      type: "list",
      text: pick(
        lang,
        "Three signals are emerging without raised alarms — worth a look before they escalate:",
        "ثلاث إشارات ناشئة بدون إنذارات — تستحق نظرة قبل أن تتفاقم:",
      ),
      data: {
        items: [
          pick(lang,
            "DXB-CORE-01 ↔ SHJ-AGG-01 (L-020) at 78% utilisation, +9 pp week-on-week — capacity headroom shrinking.",
            "L-020 بين DXB-CORE-01 و SHJ-AGG-01 بنسبة 78% استخدام، +9 نقاط أسبوعياً — هامش السعة يتقلّص."),
          pick(lang,
            "RUH-EDGE-04 evening peak edging up to 71% (4-week trend) — pre-incident pattern matches Q1.",
            "ذروة مساء RUH-EDGE-04 ترتفع إلى 71% (اتجاه 4 أسابيع) — نمط ما قبل الحادث يطابق الربع الأول."),
          pick(lang,
            "L-025 microwave (DXB↔SHJ-EDGE-04) at 85% utilisation but no SLA dependency — quietly carrying Sharjah-South backup if the fibre cut widens.",
            "L-025 موجي (DXB↔SHJ-EDGE-04) بنسبة 85% بدون تبعية اتفاقية — يحمل احتياطي جنوب الشارقة بصمت."),
        ],
      },
    }),
  },

  // 5. Open post-mortem template
  {
    id: "post-mortem",
    patterns: [
      /post.?mortem|postmortem|after.?action|incident\s*report|rca\b|root.?cause.?doc|template/i,
      /تقرير.*حادث|ما\s*بعد\s*الحادث|قالب|نموذج/,
    ],
    handler: (lang) => ({
      agent: "conductor",
      type: "document",
      text: pick(
        lang,
        "Post-mortem template ready for INC-2026-3041. Pre-filled from the incident timeline, runbook, and audit log.",
        "قالب تقرير ما بعد الحادث جاهز لـ INC-2026-3041. مُعبّأ تلقائياً من الجدول الزمني ودليل الإجراءات وسجل التدقيق.",
      ),
      data: {
        title: pick(lang, "Post-mortem · INC-2026-3041 · Sharjah-South fibre cut", "ما بعد الحادث · INC-2026-3041 · قطع ألياف جنوب الشارقة"),
        sections: [
          pick(lang, "1. Summary — what happened", "1. ملخّص — ما الذي حدث"),
          pick(lang, "2. Customer impact (84,310 MSISDNs · 1 enterprise SLA)", "2. أثر العملاء (84,310 مشترك · اتفاقية واحدة)"),
          pick(lang, "3. Detection & timeline (auto-populated from agent cast)", "3. الكشف والجدول الزمني (مُعبّأ تلقائياً)"),
          pick(lang, "4. Root cause (fibre cut · feeder km-21)", "4. السبب الجذري (قطع ألياف · مغذّي كم 21)"),
          pick(lang, "5. Mitigation & restore", "5. التخفيف والاستعادة"),
          pick(lang, "6. Regulator engagement (TDRA MI-A2 filed)", "6. التواصل التنظيمي (إيداع TDRA MI-A2)"),
          pick(lang, "7. Action items & owners", "7. إجراءات ومالكوها"),
        ],
      },
    }),
  },

  // 6. Enterprise SLAs at risk (with customer list + breach ETA)
  {
    id: "sla-risk",
    patterns: [
      /sla|slo|service\s*level|breach|enterprise|customer.*risk|how\s*many.*sla/i,
      /اتفاقية|خرق|خدمة|عميل.*معرّض|كم.*اتفاقية/,
    ],
    handler: (lang) => {
      const atRisk = SERVICES.filter((s) => s.status !== "ok");
      const breachEta = (s: typeof SERVICES[number]) => {
        if (s.status === "breached") return pick(lang, "already breached", "مخروقة بالفعل");
        // crude ETA: how many more minutes of downtime at current trajectory before breaching
        const headroomPct = s.currentPct - s.slaPct;
        const minutes = Math.max(0, Math.round(headroomPct * 60));
        return pick(lang, `breach in ~${minutes} min if trend holds`, `خرق خلال ~${minutes} دقيقة عند الاتجاه الحالي`);
      };
      return {
        agent: "impact-translator",
        type: "table",
        text: pick(
          lang,
          `${atRisk.length} of ${SERVICES.length} enterprise SLAs are off-target right now. Detail per customer below.`,
          `${atRisk.length} من ${SERVICES.length} اتفاقيات أعمال خارج الهدف الآن. التفاصيل لكل عميل أدناه.`,
        ),
        data: {
          headersArr: lang === "en"
            ? ["Customer", "Service", "Now", "SLA", "Breach ETA", "Credit at risk"]
            : ["العميل", "الخدمة", "الحالي", "الاتفاقية", "وقت الخرق", "ائتمان معرّض"],
          rows: atRisk.map((s) => [
            pick(lang, s.customer.en, s.customer.ar),
            pick(lang, s.name.en, s.name.ar),
            `${s.currentPct.toFixed(2)}%`,
            `${s.slaPct.toFixed(2)}%`,
            breachEta(s),
            `SAR ${s.monthlyCreditAtRisk.toLocaleString(lang === "en" ? "en-US" : "ar-SA")}`,
          ]),
        },
      };
    },
  },

  // 7. Pending approvals
  {
    id: "approvals",
    patterns: [
      /pending\s*(approv|decision)|what.*need.*approv|approv.*queue|approval|decision.*wait|waiting\s*on\s*me/i,
      /موافق|اعتماد|قرار|بانتظار|معلّق/,
    ],
    handler: (lang) => {
      const rows = APPROVALS.map((a) => [
        a.severity.toUpperCase(),
        pick(lang, a.title.en, a.title.ar),
        `${a.confidence}%`,
      ]);
      return {
        agent: "conductor",
        type: "table",
        text: pick(
          lang,
          `${APPROVALS.length} approvals are awaiting your decision. The P1 items are all linked to the active Sharjah-South incident.`,
          `${APPROVALS.length} موافقات تنتظر قرارك. كل بنود P1 مرتبطة بحادث جنوب الشارقة النشط.`,
        ),
        data: {
          headersArr: lang === "en" ? ["Sev", "Title", "Conf"] : ["شدّة", "العنوان", "ثقة"],
          rows,
        },
      };
    },
  },

  // 8. Nearest crew (ETA-ranked table) / crew availability
  {
    id: "nearest-crew",
    patterns: [
      /near(est)?\s*crew|closest.*crew|who.*close|which.*crew.*sharjah|crew|field|dispatch|on.?site|truck|engineer|where\s*are\s*(we|teams)/i,
      /أقرب\s*فريق|أقرب|من\s*أقرب|فريق|ميداني|إرسال|في\s*الموقع|مهندس/,
    ],
    handler: (lang) => {
      const ranked = [...CREWS]
        .sort((a, b) => (a.etaMin ?? 999) - (b.etaMin ?? 999))
        .slice(0, 6);
      return {
        agent: "runbook-player",
        type: "table",
        text: pick(
          lang,
          `Nearest crews ranked by ETA. SHJ-1 is closest to the Sharjah-South fibre cut.`,
          `أقرب الفِرق مرتّبة حسب وقت الوصول. SHJ-1 الأقرب لقطع ألياف جنوب الشارقة.`,
        ),
        data: {
          headersArr: lang === "en"
            ? ["Crew", "City", "Status", "ETA", "Assigned"]
            : ["الفريق", "المدينة", "الحالة", "الوقت", "مُسند"],
          rows: ranked.map((c) => [
            pick(lang, c.name.en, c.name.ar),
            pick(lang, c.city.en, c.city.ar),
            c.status,
            c.etaMin != null ? `${c.etaMin} min` : "—",
            c.assignedIncidentId ?? "—",
          ]),
        },
      };
    },
  },
];

// Greeting + KPI shortcut, surfaced before the 8 main intents
const PRE_INTENTS: Intent[] = [
  {
    id: "greeting",
    patterns: [/^\s*(hi|hello|hey|good morning|good day)\b/i, /^\s*(مرحب|أهلا|السلام|صباح|مساء)/],
    handler: (lang) => {
      const k = computeKpis();
      return {
        agent: "conductor",
        type: "text",
        text: pick(
          lang,
          `Hello, Reem. 👋 ${k.p1} P1 · ${k.p2} P2 · ${k.p3} P3 open. ${k.customersImpacted.toLocaleString("en-US")} customers impacted, ${k.decisionsWaiting} decisions waiting on you. The Sharjah-South fibre cut is the headline.`,
          `مرحباً ريم. 👋 ${k.p1} P1 · ${k.p2} P2 · ${k.p3} P3 مفتوحة. ${k.customersImpacted.toLocaleString("ar-SA")} عميل متأثّر، ${k.decisionsWaiting} قرارات بانتظارك. قطع ألياف جنوب الشارقة هو العنوان.`,
        ),
      };
    },
  },
];

export function matchIntent(text: string, lang: DemoLang): ChatResponse {
  for (const intent of [...PRE_INTENTS, ...INTENTS]) {
    for (const pat of intent.patterns) {
      if (pat.test(text)) return intent.handler(lang);
    }
  }
  return {
    agent: "conductor",
    type: "text",
    text:
      lang === "en"
        ? "I can help with the worst incident, public comms drafts, MTTR trend, silent errors, post-mortems, SLAs at risk, pending approvals, and crew status. Try one of the suggestions below."
        : "أستطيع المساعدة بأسوأ حادث، مسوّدات التواصل، اتجاه MTTR، الأخطاء الصامتة، تقارير ما بعد الحادث، الاتفاقيات المعرّضة، الموافقات المعلّقة، وحالة الفِرق. جرّب أحد الاقتراحات.",
  };
}

export const INTENT_IDS = INTENTS.map((i) => i.id);
