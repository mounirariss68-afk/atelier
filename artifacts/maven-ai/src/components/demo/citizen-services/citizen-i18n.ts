import type { DemoLang } from "./DemoLangContext";

export type Dict = { en: Record<string, string>; ar: Record<string, string> };
export const tDict = (d: Dict, l: DemoLang) => d[l] ?? d.en;

export const shell: Dict = {
  en: {
    brandTag: "Citizen Services",
    toolTitle: "Concierge — Case Officer Console",
    nav_queue: "My queue",
    nav_workspace: "Case workspace",
    nav_approvals: "Approvals",
    nav_director: "Director view",
    nav_knowledge: "Knowledge",
    nav_audit: "Audit log",
    notifications: "Notifications",
    aiAssistant: "AI assistant",
    languageToggle: "Language",
    switchView: "Switch to cockpit",
    logout: "Log out",
    personaName: "Yousef Al-Harbi",
    personaRole: "Senior Case Officer",
  },
  ar: {
    brandTag: "خدمات المواطنين",
    toolTitle: "كونسيرج — قمرة موظف الخدمة",
    nav_queue: "قائمتي",
    nav_workspace: "ملف القضيّة",
    nav_approvals: "الاعتمادات",
    nav_director: "عرض المديرة",
    nav_knowledge: "المعرفة",
    nav_audit: "سجل التدقيق",
    notifications: "التنبيهات",
    aiAssistant: "المساعد الذكي",
    languageToggle: "اللغة",
    switchView: "التبديل إلى لوحة المراقبة",
    logout: "تسجيل الخروج",
    personaName: "يوسف الحربي",
    personaRole: "موظف خدمة أول",
  },
};

export const queue: Dict = {
  en: {
    title: "My queue",
    subtitle: "14 active cases · agent pre-work overnight",
    sla: "SLA",
    next: "Agent next step",
    citizen: "Citizen",
    service: "Service",
    minutesAgo: "min ago",
    hoursLeft: "h left",
    hoursOver: "h over",
    rail_title: "About to breach (top 3)",
    recs_title: "Awaiting your approval",
    open: "Open case",
  },
  ar: {
    title: "قائمتي",
    subtitle: "14 قضية نشطة · إعداد مسبق ليلاً",
    sla: "اتفاقية الخدمة",
    next: "الخطوة التالية",
    citizen: "المواطن",
    service: "الخدمة",
    minutesAgo: "د مضت",
    hoursLeft: "س متبقية",
    hoursOver: "س متأخرة",
    rail_title: "أوشكت على الخرق (أعلى 3)",
    recs_title: "بانتظار اعتمادك",
    open: "افتح القضية",
  },
};

export const workspace: Dict = {
  en: {
    title: "Case workspace",
    citizen360: "Citizen 360",
    timeline: "Cross-agency timeline",
    agentDrafts: "Agent drafts & next step",
    documents: "Documents & evidence",
    nationalId: "National ID",
    channel: "Preferred channel",
    region: "Region",
    pastInteractions: "Past interactions",
    approveSend: "Approve & send",
    edit: "Edit",
    dismiss: "Dismiss",
    bookInspection: "Book inspection",
    resolve: "Resolve case",
    sentToast: "Sent. Citizen acknowledged.",
    bookedToast: "Inspection booked. Internal note dispatched to inspector.",
    resolvedToast: "Case resolved. Will auto-reopen on inspection completion.",
    selectCase: "Select a case from the queue.",
    nextStep: "Next step",
  },
  ar: {
    title: "ملف القضيّة",
    citizen360: "بطاقة المواطن 360",
    timeline: "خط زمني عبر الجهات",
    agentDrafts: "مسوّدات الوكلاء والخطوة التالية",
    documents: "الوثائق والأدلة",
    nationalId: "رقم الهوية",
    channel: "القناة المفضّلة",
    region: "المنطقة",
    pastInteractions: "تفاعلات سابقة",
    approveSend: "اعتمد وأرسل",
    edit: "تعديل",
    dismiss: "تجاهل",
    bookInspection: "احجز التفتيش",
    resolve: "إغلاق القضية",
    sentToast: "تم الإرسال. ردّ المواطن بالاستلام.",
    bookedToast: "تم الحجز. أُرسلت الملاحظة الداخلية للمفتش.",
    resolvedToast: "أُغلقت القضيّة. ستفتح تلقائياً عند انتهاء التفتيش.",
    selectCase: "اختر قضية من القائمة.",
    nextStep: "الخطوة التالية",
  },
};

export const approvals: Dict = {
  en: { title: "Approvals", subtitle: "Agent-drafted decisions awaiting you", confidence: "confidence", approve: "Approve", edit: "Edit", dismiss: "Dismiss", emptyTitle: "All caught up", emptyBody: "No pending agent recommendations.", approvedToast: "Approved.", editedToast: "Sent to edit queue.", dismissedToast: "Dismissed." },
  ar: { title: "الاعتمادات", subtitle: "قرارات أعدّها الوكلاء بانتظارك",   confidence: "ثقة",       approve: "اعتمد",   edit: "تعديل",  dismiss: "تجاهل",   emptyTitle: "تم إنجاز الكل", emptyBody: "لا توصيات وكلاء قيد الانتظار.", approvedToast: "تم الاعتماد.", editedToast: "أُرسلت للتعديل.", dismissedToast: "تم التجاهل." },
};

export const director: Dict = {
  en: { title: "Director view", subtitle: "Services × regions heatmap and ministry volumes", heat_volume: "Volume", heat_ttr: "Avg TTR (h)", ministry_today: "Cross-agency volume today" },
  ar: { title: "عرض المديرة", subtitle: "خريطة الخدمات × المناطق وأحجام الجهات", heat_volume: "الحجم", heat_ttr: "متوسط زمن الإنجاز (س)", ministry_today: "الحجم عبر الجهات اليوم" },
};

export const knowledgeI: Dict = {
  en: { title: "Knowledge", subtitle: "Charters, SOPs and policies the agents cite", source: "Source", citations: "citations", relevantTo: "Relevant to" },
  ar: { title: "المعرفة", subtitle: "المواثيق والإجراءات والسياسات التي يستند إليها الوكلاء", source: "المصدر", citations: "استشهاداً", relevantTo: "ينطبق على" },
};

export const auditI: Dict = {
  en: { title: "Audit log", subtitle: "Agent + officer actions for governance", emptyText: "No audit entries yet." },
  ar: { title: "سجل التدقيق", subtitle: "إجراءات الوكلاء والموظف للحوكمة", emptyText: "لا قيود تدقيق بعد." },
};

export const chatI: Dict = {
  en: {
    headerTitle: "Concierge AI",
    headerSubtitle: "Bilingual — grounded in policy",
    welcome: "Yousef, I've pre-worked 12 of your 14 cases. CSC-2026-1421 is the highest priority. Ask me anything.",
    placeholder: "Ask about a case, citizen ID, or ministry…",
    p1: "Brief me on case CSC-2026-1421",
    p2: "Which cases will breach SLA in 24h?",
    p3: "Book the municipal inspection for the licence case",
    p4: "Draft an Arabic SMS to the citizen",
    p5: "Show me cases by ministry today",
    p6: "What's our average wait by service?",
  },
  ar: {
    headerTitle: "كونسيرج الذكي",
    headerSubtitle: "ثنائي اللغة — مستند على السياسات",
    welcome: "يوسف، أعددت 12 من قضاياك الـ14 مسبقاً. CSC-2026-1421 هي الأعلى أولوية. اسألني عن أي شيء.",
    placeholder: "اسأل عن قضية أو هوية مواطن أو جهة…",
    p1: "لخّص لي قضية CSC-2026-1421",
    p2: "أي قضايا ستخرق اتفاقية الخدمة خلال 24 ساعة؟",
    p3: "احجز التفتيش البلدي لقضية الرخصة",
    p4: "اكتب رسالة عربية للمواطن",
    p5: "اعرض القضايا حسب الجهة اليوم",
    p6: "ما متوسط الانتظار حسب الخدمة؟",
  },
};
