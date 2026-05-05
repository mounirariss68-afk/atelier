import type { DemoLang } from "./DemoLangContext";
import { getTasamaDataSnapshot, isTasamaDataReady } from "@/hooks/useTasamaData";
import {
  generatePayrollRecommendations,
  generatePayrollAlerts,
  generateAgentPerformanceScores,
  generateDecisionAnalytics,
  generateClientSummaries,
  generateOperationsDigest,
  generateQuickStats,
  PAYROLL_PLAYBOOKS,
} from "@/data/tasama-agent";
import { formatSAR, getAgentName, getSaudizationBandLabel, getCalendarEventName } from "@/data/tasama-seed";

export type ChatAgent = "analyst" | "compliance" | "payroll";
export type ChatResponseType = "text" | "metric" | "table" | "list" | "analysis" | "chart";

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

function safeData() {
  if (!isTasamaDataReady()) return null;
  return getTasamaDataSnapshot();
}

const INTENTS: Intent[] = [
  // 1. Greetings
  {
    patterns: [/^\s*(hi|hello|hey|good morning|good day)\b/i, /مرحب|أهلا|السلام|صباح|مساء/],
    handler: (lang) => ({
      agent: "analyst",
      type: "text",
      text: pick(
        lang,
        "Hello, Faisal. 👋 Today: 12 recommendations pending (1 critical — Mohammad Al-Ghamdi SAR 196,450 settlement), April GOSI ready to file (SAR 54,340), and Vertex Tech is in the Yellow Saudization band. What can I dig into?",
        "مرحبًا فيصل. 👋 اليوم: 12 توصية معلّقة (1 حرجة — تسوية محمد الغامدي 196,450 ريال)، تأمينات أبريل جاهزة للتقديم (54,340 ريال)، وVertex في النطاق الأصفر. ماذا تريد أن أبحث؟"
      ),
    }),
  },

  // 2. Pending approvals / what needs my approval
  {
    patterns: [
      /pending\s+(approv|recommend|decision)/i, /what.*need.*approv/i, /awaiting.*approv/i, /approv.*queue/i,
      /موافق|اعتماد|قرار|في الانتظار|معلّق/, /ما الذي يحتاج/,
    ],
    handler: (lang) => {
      const recs = generatePayrollRecommendations().filter((r) => r.status === "pending");
      const crit = recs.filter((r) => r.severity === "critical");
      const high = recs.filter((r) => r.severity === "high");
      const med = recs.filter((r) => r.severity === "medium");
      return {
        agent: "analyst",
        type: "analysis",
        text: pick(
          lang,
          `${recs.length} recommendations are awaiting your decision.\n\n🔴 Critical (${crit.length}):\n${crit.map((r) => `• ${r.title} — ${r.confidence}% conf.`).join("\n") || "—"}\n\n🟠 High (${high.length}):\n${high.map((r) => `• ${r.title}`).join("\n") || "—"}\n\n🟡 Medium (${med.length}):\n${med.map((r) => `• ${r.title}`).join("\n") || "—"}\n\n➡️ Open the Approval Queue to act on them.`,
          `${recs.length} توصية تنتظر قرارك.\n\n🔴 حرجة (${crit.length}):\n${crit.map((r) => `• ${r.title} — ثقة ${r.confidence}%`).join("\n") || "—"}\n\n🟠 مرتفعة (${high.length}):\n${high.map((r) => `• ${r.title}`).join("\n") || "—"}\n\n🟡 متوسطة (${med.length}):\n${med.map((r) => `• ${r.title}`).join("\n") || "—"}\n\n➡️ افتح قائمة الموافقات للتصرف.`
        ),
      };
    },
  },

  // 3. Mohammad / final settlement
  {
    patterns: [/mohammad|al-?ghamdi|final settlement|eosb/i, /محمد|الغامدي|نهاية الخدمة|التسوية/],
    handler: (lang) => ({
      agent: "payroll",
      type: "analysis",
      text: pick(
        lang,
        `🔴 Final settlement — Mohammad Al-Ghamdi (rec-001, confidence 99%)\n\n📊 Reasoning:\n1. Tenure: 12 yrs, 0 mo • unlimited contract • last basic+housing SAR 17,500\n2. Article 84: First 5 yrs × 0.5 = SAR 43,750. Remaining 7 yrs × 1.0 = SAR 122,500. EOSB total SAR 166,250.\n3. Leave encashment: 18 days × SAR 583.33 = SAR 10,500. April salary remaining SAR 19,700.\n\n💰 Total: SAR 196,450 (one-off, Mudad WPS within 5 business days of sign-off)\n📋 Compliance: Article 84 fully satisfied; no labour-court exposure.\n\n➡️ Awaiting Finance Controller approval in the Approval Queue.`,
        `🔴 التسوية النهائية — محمد الغامدي (rec-001، ثقة 99٪)\n\n📊 المنطق:\n1. الخدمة: 12 سنة • عقد غير محدد • آخر أساسي+سكن 17,500 ريال\n2. المادة 84: أول 5 سنوات × 0.5 = 43,750. المتبقية 7 سنوات × 1.0 = 122,500. الإجمالي 166,250 ريال.\n3. تعويض الإجازة: 18 يومًا × 583.33 = 10,500 ريال. راتب أبريل المتبقي 19,700 ريال.\n\n💰 الإجمالي: 196,450 ريال (دفعة واحدة، مُدد خلال 5 أيام عمل بعد التوقيع)\n📋 الامتثال: المادة 84 محققة بالكامل؛ لا تعرّض لمحاكم العمل.\n\n➡️ في انتظار المراقب المالي في قائمة الموافقات.`
      ),
    }),
  },

  // 4. Noura salary increase
  {
    patterns: [/noura|al-?salem|salary increase/i, /نورا|السالم|زيادة راتب|راتب نورا/],
    handler: (lang) => ({
      agent: "payroll",
      type: "metric",
      text: pick(
        lang,
        "Noura Al-Salem (Vertex Tech, Software Developer) — proposed SAR 15,000 → SAR 17,000 effective 1 May 2026. Lands at the 50th percentile vs Riyadh tech median. Marginal employer cost +SAR 2,280/mo (incl. GOSI re-base).",
        "نورا السالم (Vertex، مطورة برمجيات) — اقتراح 15,000 → 17,000 ريال اعتبارًا من 1 مايو 2026. تصل للمئين 50 مقارنة بمتوسط القطاع التقني بالرياض. التكلفة الإضافية +2,280 ريال/شهر."
      ),
      data: { value: "+SAR 2,280/mo", target: "SAR 17,000 basic", delta: "+13.3%", trend: "up" },
    }),
  },

  // 5. Vertex / Saudization
  {
    patterns: [/vertex|saudization|nitaqat|yellow band|سعودة|نطاقات|أصفر/i],
    handler: (lang) => ({
      agent: "compliance",
      type: "analysis",
      text: pick(
        lang,
        `🟠 Vertex Tech — Yellow band recovery (rec-003, 86% conf.)\n\n📊 Current Saudization: 50.0% (Yellow). 5 Saudi / 5 expat employees.\n📐 Q2 Nitaqat threshold: 56% for tech firms <50 employees.\n\n💡 Recommended path:\n• Hire 2 Saudi developers via HRDF Tamheer (subsidised 12-month OJT)\n• Net cost SAR 144K/yr (post-Tamheer subsidy)\n• Lifts ratio to 58.3% → exits Yellow into Green-Low\n\n⏰ Deadline: Q2 Nitaqat review on 1 Jul 2026 (66 days away).`,
        `🟠 Vertex — تعافي النطاق الأصفر (rec-003، ثقة 86٪)\n\n📊 السعودة الحالية: 50.0٪ (أصفر). 5 سعوديين / 5 وافدين.\n📐 حد Q2 نطاقات: 56٪ لشركات التقنية <50 موظفًا.\n\n💡 المسار الموصى به:\n• توظيف 2 مطورَين سعوديَّين عبر برنامج تمهير (مدعوم 12 شهرًا)\n• تكلفة صافية 144,000 ريال/سنة (بعد دعم تمهير)\n• ترفع النسبة إلى 58.3٪ → تخرج إلى الأخضر المنخفض\n\n⏰ الموعد: مراجعة Q2 نطاقات في 1 يوليو 2026 (66 يومًا).`
      ),
    }),
  },

  // 6. GOSI deadlines / filings
  {
    patterns: [/gosi|filing|تأمينات|تقديم|deadline.*gosi/i],
    handler: (lang) => {
      const data = safeData();
      const upcoming = data?.regulatoryCalendar.filter((c) => c.type === "upcoming" && c.eventType === "gosi-filing").slice(0, 4) ?? [];
      return {
        agent: "compliance",
        type: "list",
        text: pick(
          lang,
          `April 2026 GOSI filing is ready: 42 employees, employer SAR 41,890 + employee SAR 12,450 = SAR 54,340. Window closes 15 May 2026. 0 errors, 0 warnings — preserves the 18-month on-time streak.\n\nUpcoming GOSI deadlines:\n${upcoming.map((c) => `• ${c.dueDate} — ${c.nameEn}`).join("\n") || "—"}`,
          `تقديم تأمينات أبريل 2026 جاهز: 42 موظفًا، صاحب العمل 41,890 + الموظف 12,450 = 54,340 ريال. النافذة تغلق 15 مايو 2026. 0 أخطاء، 0 تحذيرات — يحافظ على سلسلة 18 شهرًا من الالتزام.\n\nمواعيد التأمينات القادمة:\n${upcoming.map((c) => `• ${c.dueDate} — ${c.nameAr}`).join("\n") || "—"}`
        ),
      };
    },
  },

  // 7. Mudad / WPS
  {
    patterns: [/mudad|wps|wage protection|bank transfer|مُدد|مدد|حماية الأجور/i],
    handler: (lang) => ({
      agent: "payroll",
      type: "text",
      text: pick(
        lang,
        "Mudad WPS status: April batch is staged for 28 Apr execution across 3 clients (42 payslips, SAR 612,840 net). All IBANs validated. Mohammad Al-Ghamdi's final settlement (SAR 196,450) will run as a separate WPS submission within 5 business days of Finance sign-off.",
        "حالة مُدد: دُفعة أبريل مُجهّزة للتنفيذ في 28 أبريل عبر 3 عملاء (42 قسيمة، 612,840 ريال صافي). جميع الآيبانات مُتحقّقة. تسوية محمد الغامدي (196,450 ريال) ستُنفّذ كتقديم منفصل خلال 5 أيام عمل بعد موافقة المالية."
      ),
    }),
  },

  // 8. Agent performance
  {
    patterns: [/agent.*perform|how.*agent|fleet.*health|أداء.*الوكلاء|كيف.*الوكلاء|أسطول/i],
    handler: (lang) => {
      const scores = generateAgentPerformanceScores();
      const healthy = scores.filter((s) => s.health === "healthy").length;
      const degraded = scores.filter((s) => s.health === "degraded").length;
      const warning = scores.filter((s) => s.health === "warning").length;
      const top = [...scores].sort((a, b) => b.compositeScore - a.compositeScore)[0];
      const bottom = [...scores].sort((a, b) => a.compositeScore - b.compositeScore)[0];
      return {
        agent: "analyst",
        type: "chart",
        text: pick(
          lang,
          `Fleet of 10 agents: ${healthy} healthy, ${degraded} degraded, ${warning} warning.\n\n🏆 Top: ${getAgentName(top.agentId, "en")} — ${top.compositeScore.toFixed(1)} composite\n⚠️ Watch: ${getAgentName(bottom.agentId, "en")} — ${bottom.compositeScore.toFixed(1)} composite\n\nFleet automation rate: ${generateDecisionAnalytics().automationRate}%`,
          `أسطول من 10 وكلاء: ${healthy} سليم، ${degraded} متراجع، ${warning} تحذير.\n\n🏆 الأعلى: ${getAgentName(top.agentId, "ar")} — ${top.compositeScore.toFixed(1)}\n⚠️ مراقبة: ${getAgentName(bottom.agentId, "ar")} — ${bottom.compositeScore.toFixed(1)}\n\nمعدل أتمتة الأسطول: ${generateDecisionAnalytics().automationRate}٪`
        ),
        data: {
          chartType: "bar",
          label: pick(lang, "Composite scores by agent", "النقاط المركّبة حسب الوكيل"),
          chartData: scores.slice(0, 6).map((s) => ({
            name: getAgentName(s.agentId, lang).split(" ").slice(0, 2).join(" "),
            value: s.compositeScore,
          })),
        },
      };
    },
  },

  // 9. Playbooks / automation
  {
    patterns: [/playbook|automation|active.*agent|أتمتة|كتاب.*التشغيل|نشاط.*الوكلاء/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "text",
      text: pick(
        lang,
        `${PAYROLL_PLAYBOOKS.length} playbooks are configured:\n\n${PAYROLL_PLAYBOOKS.map((p) => `⚡ ${p.name} — ${p.status}`).join("\n")}\n\nThe agent fleet executed 12 actions in the last 24 hours. Open the Operations Dashboard to see the live activity feed.`,
        `تم تكوين ${PAYROLL_PLAYBOOKS.length} كتب تشغيل:\n\n${PAYROLL_PLAYBOOKS.map((p) => `⚡ ${p.name} — ${p.status}`).join("\n")}\n\nنفّذ أسطول الوكلاء 12 إجراءً في آخر 24 ساعة. افتح لوحة العمليات لرؤية موجز النشاط المباشر.`
      ),
    }),
  },

  // 10. Client summary
  {
    patterns: [/client.*portfolio|all.*clients|client.*health|محفظة|كل العملاء|صحة العملاء/i],
    handler: (lang) => {
      const summaries = generateClientSummaries();
      return {
        agent: "analyst",
        type: "table",
        text: pick(
          lang,
          `Portfolio: ${summaries.length} clients managing ${summaries.reduce((s, x) => s + x.employeeCount, 0)} employees, total monthly payroll ${formatSAR(summaries.reduce((s, x) => s + x.monthlyGross, 0))}.`,
          `المحفظة: ${summaries.length} عميل، ${summaries.reduce((s, x) => s + x.employeeCount, 0)} موظفًا، إجمالي شهري ${formatSAR(summaries.reduce((s, x) => s + x.monthlyGross, 0))}.`
        ),
        data: {
          headers: lang === "en"
            ? ["Client", "Employees", "Monthly gross", "Saudization"]
            : ["العميل", "الموظفون", "إجمالي شهري", "السعودة"],
          rows: summaries.map((s) => [
            lang === "en" ? s.client.legalNameEn : s.client.legalNameAr,
            String(s.employeeCount),
            formatSAR(s.monthlyGross),
            `${s.saudizationPercent.toFixed(1)}% (${getSaudizationBandLabel(s.client.saudizationBand, lang)})`,
          ]),
        },
      };
    },
  },

  // 11. Operations digest
  {
    patterns: [/digest|summary|operations.*overview|ملخص|نظرة عامة|ملخّص العمليات/i],
    handler: (lang) => {
      const digest = generateOperationsDigest();
      const stats = generateQuickStats(lang);
      return {
        agent: "analyst",
        type: "text",
        text: pick(
          lang,
          `📊 ${digest.headline}\n\n${digest.bullets.map((b) => `• ${b}`).join("\n")}\n\nAutomation rate: ${(((stats.employeeCount - 5) / stats.employeeCount) * 100).toFixed(1)}% (estimate).`,
          `📊 ${digest.headline}\n\n${digest.bullets.map((b) => `• ${b}`).join("\n")}\n\nمعدل الأتمتة: ${(((stats.employeeCount - 5) / stats.employeeCount) * 100).toFixed(1)}٪ (تقدير).`
        ),
      };
    },
  },

  // 12. Aisha / maternity
  {
    patterns: [/aisha|al-?harbi|maternity|article 151|عائشة|الحربي|أمومة|المادة 151/i],
    handler: (lang) => ({
      agent: "payroll",
      type: "text",
      text: pick(
        lang,
        "Aisha Al-Harbi (Al-Nakhla, HR Coordinator): 70-day fully-paid maternity leave starts 15 May 2026 under Article 151. Payroll impact SAR 25,667 (May–Jul). Cover plan: existing junior coordinator absorbs admin. Approved on 22 Apr.",
        "عائشة الحربي (النخلة، منسقة موارد بشرية): إجازة أمومة 70 يومًا مدفوعة بالكامل تبدأ 15 مايو 2026 وفقًا للمادة 151. الأثر 25,667 ريال (مايو–يوليو). خطة التغطية: المنسقة المبتدئة الحالية. مُعتمدة في 22 أبريل."
      ),
    }),
  },

  // 13. Rajesh / iqama
  {
    patterns: [/rajesh|iqama|raji?sh|راجيش|إقامة|تجديد إقامة/i],
    handler: (lang) => ({
      agent: "compliance",
      type: "text",
      text: pick(
        lang,
        "Rajesh Kumar (Al-Nakhla, Civil Engineer): Iqama 2123456003 expires 15 Jul 2026 (80 days). Renewal window opens now (60-day rule). Documents prepared. Estimated processing time 3 business days. Also: contract renewal due in 60 days — letter ANK-HR-2026-0418 ready.",
        "راجيش كومار (النخلة، مهندس مدني): الإقامة 2123456003 تنتهي 15 يوليو 2026 (80 يومًا). نافذة التجديد مفتوحة الآن (قاعدة 60 يومًا). الوثائق جاهزة. الوقت المتوقع 3 أيام عمل. أيضًا: تجديد عقد خلال 60 يومًا — خطاب ANK-HR-2026-0418 جاهز."
      ),
    }),
  },

  // 14. Calibration / confidence
  {
    patterns: [/calibrat|confidence|reliab|معايرة|الثقة|موثوق/i],
    handler: (lang) => {
      const a = generateDecisionAnalytics();
      return {
        agent: "analyst",
        type: "chart",
        text: pick(
          lang,
          `AI confidence is well-calibrated: predicted vs actual outcomes are within 3pp across all buckets. The 95-100% bucket is slightly conservative (predicts 98, actual 97).`,
          `ثقة الذكاء الاصطناعي مُعايرة جيدًا: المتوقع مقابل الفعلي ضمن 3 نقاط مئوية في جميع النطاقات. نطاق 95-100% محافظ قليلًا (متوقع 98، فعلي 97).`
        ),
        data: {
          chartType: "line",
          label: pick(lang, "Predicted vs actual confidence", "الثقة المتوقعة مقابل الفعلية"),
          chartData: a.confidenceCalibrationCurve.map((c) => ({ name: c.bucket, value: c.actual })),
        },
      };
    },
  },

  // 15. Critical alerts
  {
    patterns: [/critical alert|alert|risk|warning|تنبيه|تحذير|مخاطرة|عاجل/i],
    handler: (lang) => {
      const alerts = generatePayrollAlerts().filter((a) => a.severity === "critical" || a.severity === "high").slice(0, 5);
      return {
        agent: "compliance",
        type: "list",
        text: pick(
          lang,
          `${alerts.length} critical/high alerts active:\n\n${alerts.map((a) => `${a.severity === "critical" ? "🔴" : "🟠"} ${a.title}\n   ${a.detail}`).join("\n\n")}`,
          `${alerts.length} تنبيه حرج/مرتفع نشط:\n\n${alerts.map((a) => `${a.severity === "critical" ? "🔴" : "🟠"} ${a.title}\n   ${a.detail}`).join("\n\n")}`
        ),
      };
    },
  },

  // 16. Simulator / what-if
  {
    patterns: [/simulat|what-?if|scenario|محاك|سيناريو|ماذا.*لو/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "text",
      text: pick(
        lang,
        `The Simulator has 6 pre-built AI scenarios you can load:\n\n• Hire 2 Saudi devs at Vertex (94% conf., exits Yellow → Green-Low)\n• Apply Noura salary increase (97% conf., +SAR 2,280/mo)\n• Model GOSI rate +1pp policy change (82% conf., fleet +SAR 4,475/mo)\n• Promote Saudi engineer (alternative path, 79% conf.)\n• Al-Nakhla 8% retention sweep (76% conf., +SAR 245K/yr)\n• Luma Retail to Green-High (91% conf., +1 Saudi hire)\n\nOpen the Payroll Simulator to load any of these.`,
        `يحتوي المحاكي على 6 سيناريوهات جاهزة:\n\n• توظيف 2 سعودي في Vertex (ثقة 94٪، يخرج من الأصفر للأخضر المنخفض)\n• تطبيق زيادة نورا (ثقة 97٪، +2,280 ريال/شهر)\n• محاكاة زيادة التأمينات +1 نقطة (ثقة 82٪، الأسطول +4,475 ريال/شهر)\n• ترقية مهندس سعودي (مسار بديل، ثقة 79٪)\n• كنس احتفاظ النخلة 8٪ (ثقة 76٪، +245 ألف ريال/سنة)\n• Luma إلى الأخضر المرتفع (ثقة 91٪، +1 سعودي)\n\nافتح المحاكي لتحميل أي منها.`
      ),
    }),
  },

  // 17. Compliance / calendar gaps
  {
    patterns: [/compliance|calendar|deadline|cluster|gap|workload|امتثال|تقويم|موعد|تجمّع|عبء/i],
    handler: (lang) => {
      const data = safeData();
      const upcoming = data?.regulatoryCalendar.filter((c) => c.type === "upcoming") ?? [];
      const filed = data?.regulatoryCalendar.filter((c) => c.type === "filed") ?? [];
      const byMonth: Record<number, number> = {};
      upcoming.forEach((c) => {
        const m = new Date(c.dueDate).getMonth() + 1;
        byMonth[m] = (byMonth[m] || 0) + 1;
      });
      const clusters = Object.entries(byMonth).filter(([, n]) => n >= 3).map(([m, n]) => `M${m} (${n})`);
      return {
        agent: "compliance",
        type: "text",
        text: pick(
          lang,
          `Compliance calendar: ${filed.length} filings completed, ${upcoming.length} upcoming.\n\n${clusters.length ? `⚠️ Workload clusters detected in: ${clusters.join(", ")}. Re-balance the cycle.\n` : "✅ No concurrent-deadline clusters detected.\n"}\nOn-time streak: 18 months. Open the Compliance Center for the full 12-month grid.`,
          `تقويم الامتثال: ${filed.length} تقديم مكتمل، ${upcoming.length} قادم.\n\n${clusters.length ? `⚠️ تم اكتشاف تجمّعات في: ${clusters.join(", ")}. أعد توزيع الدورة.\n` : "✅ لا توجد تجمّعات مواعيد متزامنة.\n"}\nسلسلة الالتزام: 18 شهرًا. افتح مركز الامتثال للشبكة الكاملة.`
        ),
      };
    },
  },
];

export function matchManagerIntent(query: string, lang: DemoLang): ChatResponse {
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(query))) {
      return intent.handler(lang);
    }
  }
  return {
    agent: "analyst",
    type: "text",
    text: lang === "en"
      ? "I don't have a focused answer for that, but I can help with: pending approvals, agent performance, GOSI/Mudad deadlines, Saudization bands, simulator scenarios, client health, or specific employees (e.g. Mohammad, Noura, Aisha, Rajesh)."
      : "لا أملك إجابة محددة لذلك، لكن يمكنني المساعدة في: الموافقات المعلّقة، أداء الوكلاء، مواعيد التأمينات/مُدد، نطاقات السعودة، سيناريوهات المحاكاة، صحة العملاء، أو موظفين محددين (مثل محمد، نورا، عائشة، راجيش).",
  };
}
