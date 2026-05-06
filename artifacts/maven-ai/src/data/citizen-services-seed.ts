// Citizen Services Concierge — case-officer console seed.
//
// Scoped to a single Senior Case Officer (Yousef Al-Harbi) at the Citizen
// Services Authority. The data describes 14 active cases in his queue, 24
// resolved cases, plus the supporting domain (citizens, ministries, regions,
// services, agent recommendations, alerts, audit log).

export type Lang = "en" | "ar";

export interface BiText { en: string; ar: string }

// ─── Domain references ────────────────────────────────────────────────────

export interface Ministry {
  id: string;
  name: BiText;
  short: BiText;
  color: string;
}

export const MINISTRIES: Ministry[] = [
  { id: "moc",       name: { en: "Ministry of Commerce",     ar: "وزارة التجارة" },                short: { en: "MOC",       ar: "التجارة" },     color: "#5BA98A" },
  { id: "interior",  name: { en: "Ministry of Interior",     ar: "وزارة الداخلية" },               short: { en: "Interior",  ar: "الداخلية" },    color: "#156082" },
  { id: "zatca",     name: { en: "Zakat, Tax & Customs",     ar: "هيئة الزكاة والضريبة والجمارك" }, short: { en: "ZATCA",     ar: "الزكاة" },      color: "#F5A623" },
  { id: "riyadh-am", name: { en: "Riyadh Municipality",      ar: "أمانة منطقة الرياض" },           short: { en: "Riyadh AM", ar: "الأمانة" },     color: "#5C8CA8" },
  { id: "mol",       name: { en: "Ministry of Human Resources", ar: "وزارة الموارد البشرية" },     short: { en: "MHRSD",     ar: "الموارد" },     color: "#8B5CF6" },
];

export interface Region {
  id: string;
  name: BiText;
}

export const REGIONS: Region[] = [
  { id: "riyadh",   name: { en: "Riyadh",          ar: "الرياض" } },
  { id: "jeddah",   name: { en: "Jeddah & Makkah", ar: "جدة ومكة" } },
  { id: "eastern",  name: { en: "Eastern Province", ar: "المنطقة الشرقية" } },
  { id: "madinah",  name: { en: "Madinah",         ar: "المدينة المنورة" } },
];

export interface Service {
  id: string;
  name: BiText;
  ministryId: string;
  charterHours: number;
}

export const SERVICES: Service[] = [
  { id: "svc-comm-lic",   name: { en: "Commercial licence renewal", ar: "تجديد رخصة تجارية" },        ministryId: "moc",       charterHours: 72 },
  { id: "svc-family-visa",name: { en: "Family visit visa",          ar: "تأشيرة زيارة عائلية" },       ministryId: "interior",  charterHours: 96 },
  { id: "svc-traffic",    name: { en: "Traffic-fine appeal",        ar: "اعتراض على مخالفة مرورية" },  ministryId: "interior",  charterHours: 120 },
  { id: "svc-civil",      name: { en: "Civil-status update",        ar: "تحديث الأحوال المدنية" },    ministryId: "interior",  charterHours: 48 },
  { id: "svc-biz-reg",    name: { en: "New business registration",  ar: "تسجيل منشأة جديدة" },        ministryId: "moc",       charterHours: 168 },
  { id: "svc-zakat",      name: { en: "Zakat assessment review",    ar: "مراجعة احتساب الزكاة" },     ministryId: "zatca",     charterHours: 240 },
  { id: "svc-bldg",       name: { en: "Municipal building permit",  ar: "رخصة بناء بلدية" },          ministryId: "riyadh-am", charterHours: 336 },
  { id: "svc-saud",       name: { en: "Saudization band review",    ar: "مراجعة نطاقات السعودة" },    ministryId: "mol",       charterHours: 168 },
];

// ─── Citizens ──────────────────────────────────────────────────────────────

export interface Citizen {
  id: string;
  nationalId: string;
  name: BiText;
  channelPref: "whatsapp" | "sms" | "phone" | "email";
  phone: string;
  regionId: string;
  openCaseIds: string[];
  pastInteractions: number;
  preferredLang: Lang;
}

// ─── Cases ─────────────────────────────────────────────────────────────────

export type CaseStatus =
  | "agent-pre-worked"
  | "officer-review"
  | "awaiting-citizen"
  | "awaiting-ministry"
  | "in-progress"
  | "resolved";

export type CasePriority = "critical" | "high" | "medium" | "low";

export interface CrossAgencyTouchpoint {
  ministryId: string;
  status: "complete" | "in-progress" | "blocked" | "scheduled";
  label: BiText;
  at: string;        // ISO-ish display string
}

export interface AgentDraft {
  id: string;
  authorAgentId: string;          // matches scenario agent id
  kind: "sms" | "internal-note" | "next-step" | "action";
  title: BiText;
  bodyEn: string;
  bodyAr: string;
  confidence: number;             // 0–100
}

export interface Case {
  id: string;                     // CSC-2026-XXXX
  citizenId: string;
  serviceId: string;
  status: CaseStatus;
  priority: CasePriority;
  openedAt: string;               // ISO
  slaDueAt: string;               // ISO
  assignedOfficer: string;
  ministryTouchpoints: CrossAgencyTouchpoint[];
  agentNextStep: BiText;
  agentDrafts: AgentDraft[];
  preWorkedByAgent: boolean;
  history: { at: string; actor: BiText; event: BiText }[];
}

// Persona ─────────────────────────────────────────────────────────────────
export const OFFICER = {
  id: "officer-yousef",
  name: { en: "Yousef Al-Harbi", ar: "يوسف الحربي" } as BiText,
  role: { en: "Senior Case Officer", ar: "موظف خدمة أول" } as BiText,
  org: { en: "Citizen Services Authority", ar: "هيئة خدمات المواطنين" } as BiText,
  initials: { en: "YH", ar: "ي.ح" } as BiText,
};

export const DIRECTOR = {
  id: "director-noura",
  name: { en: "Noura Al-Saeed", ar: "نورة السعيد" } as BiText,
  role: { en: "Director · Citizen Services", ar: "مديرة · خدمات المواطنين" } as BiText,
};

// ─── Citizens (10 — covers the 14 cases via repeats for some heavy users) ─

export const CITIZENS: Citizen[] = [
  { id: "cit-1", nationalId: "1098 234 561", name: { en: "Rashed Al-Otaibi",      ar: "راشد العتيبي" },     channelPref: "whatsapp", phone: "+966 5x xxx 1184", regionId: "riyadh",  openCaseIds: ["CSC-2026-1421"], pastInteractions: 3,  preferredLang: "ar" },
  { id: "cit-2", nationalId: "1085 112 003", name: { en: "Mona Al-Qahtani",       ar: "منى القحطاني" },     channelPref: "sms",      phone: "+966 5x xxx 9220", regionId: "riyadh",  openCaseIds: ["CSC-2026-1418"], pastInteractions: 1,  preferredLang: "ar" },
  { id: "cit-3", nationalId: "2092 880 117", name: { en: "Khalid Bin Salem",      ar: "خالد بن سالم" },     channelPref: "phone",    phone: "+966 5x xxx 4471", regionId: "jeddah",  openCaseIds: ["CSC-2026-1417","CSC-2026-1411"], pastInteractions: 6, preferredLang: "ar" },
  { id: "cit-4", nationalId: "1067 545 902", name: { en: "Sara Al-Dosari",        ar: "سارة الدوسري" },     channelPref: "whatsapp", phone: "+966 5x xxx 7732", regionId: "eastern", openCaseIds: ["CSC-2026-1416"], pastInteractions: 2,  preferredLang: "en" },
  { id: "cit-5", nationalId: "1071 663 444", name: { en: "Faisal Al-Shamri",      ar: "فيصل الشمري" },      channelPref: "phone",    phone: "+966 5x xxx 5551", regionId: "riyadh",  openCaseIds: ["CSC-2026-1415"], pastInteractions: 0,  preferredLang: "ar" },
  { id: "cit-6", nationalId: "1099 220 808", name: { en: "Latifa Al-Mutairi",     ar: "لطيفة المطيري" },    channelPref: "whatsapp", phone: "+966 5x xxx 3320", regionId: "madinah", openCaseIds: ["CSC-2026-1414"], pastInteractions: 4,  preferredLang: "ar" },
  { id: "cit-7", nationalId: "1077 444 211", name: { en: "Ahmad Al-Ghamdi",       ar: "أحمد الغامدي" },     channelPref: "email",    phone: "+966 5x xxx 9911", regionId: "jeddah",  openCaseIds: ["CSC-2026-1413"], pastInteractions: 5,  preferredLang: "en" },
  { id: "cit-8", nationalId: "1080 333 776", name: { en: "Hessa Al-Anazi",        ar: "هصة العنزي" },       channelPref: "sms",      phone: "+966 5x xxx 6630", regionId: "eastern", openCaseIds: ["CSC-2026-1412"], pastInteractions: 1,  preferredLang: "ar" },
  { id: "cit-9", nationalId: "2061 117 902", name: { en: "Nasser Al-Harbi",       ar: "ناصر الحربي" },      channelPref: "phone",    phone: "+966 5x xxx 1112", regionId: "riyadh",  openCaseIds: ["CSC-2026-1410","CSC-2026-1409"], pastInteractions: 2, preferredLang: "ar" },
  { id: "cit-10",nationalId: "1093 224 664", name: { en: "Reem Al-Subaie",        ar: "ريم السبيعي" },      channelPref: "whatsapp", phone: "+966 5x xxx 8801", regionId: "riyadh",  openCaseIds: ["CSC-2026-1408","CSC-2026-1407"], pastInteractions: 7, preferredLang: "ar" },
];

// ─── Active queue (14 cases — sorted by SLA urgency, licence on top) ──────

const NOW_ISO = "2026-05-04T07:00:00.000Z";
const hoursAhead = (h: number) => new Date(Date.parse(NOW_ISO) + h * 3_600_000).toISOString();
const hoursAgo   = (h: number) => new Date(Date.parse(NOW_ISO) - h * 3_600_000).toISOString();

export const ACTIVE_CASES: Case[] = [
  {
    id: "CSC-2026-1421", citizenId: "cit-1", serviceId: "svc-comm-lic",
    status: "agent-pre-worked", priority: "high",
    openedAt: hoursAgo(60), slaDueAt: hoursAhead(8), assignedOfficer: OFFICER.id,
    preWorkedByAgent: true,
    ministryTouchpoints: [
      { ministryId: "moc",       status: "complete",    label: { en: "Commercial registry valid", ar: "السجل التجاري ساري" }, at: "Apr 30" },
      { ministryId: "interior",  status: "complete",    label: { en: "Citizen ID verified",       ar: "تم التحقق من الهوية" },  at: "May 1" },
      { ministryId: "zatca",     status: "complete",    label: { en: "Zakat clearance issued",    ar: "إخلاء طرف الزكاة" },     at: "May 3" },
      { ministryId: "riyadh-am", status: "scheduled",   label: { en: "Inspection bookable Tue 14:00", ar: "تفتيش متاح الثلاثاء 14:00" }, at: "May 4" },
    ],
    agentNextStep: {
      en: "3 of 4 prerequisites complete — book the municipal inspection for Tue 5 May 14:00 and confirm with the citizen by SMS.",
      ar: "اكتملت 3 من 4 متطلبات — احجز التفتيش البلدي الثلاثاء 5 مايو 14:00 وأبلغ المواطن برسالة نصية.",
    },
    agentDrafts: [
      {
        id: "draft-sms-1421", authorAgentId: "drafter", kind: "sms",
        title: { en: "Bilingual SMS to citizen (booking link)", ar: "رسالة نصية ثنائية اللغة للمواطن (رابط الحجز)" },
        bodyEn: "Hello Mr Rashed — your commercial licence renewal is 75% complete. The final step is a municipal inspection. We've reserved Tue 5 May at 14:00 for you. Confirm: https://gov.sa/insp/2026-1421",
        bodyAr: "مرحباً أبو راشد — تجديد رخصتك التجارية مكتمل بنسبة 75%. الخطوة الأخيرة تفتيش بلدي، وقد حجزنا لك الثلاثاء 5 مايو الساعة 14:00. للتأكيد: https://gov.sa/insp/2026-1421",
        confidence: 91,
      },
      {
        id: "draft-note-1421", authorAgentId: "drafter", kind: "internal-note",
        title: { en: "Internal note to inspector", ar: "ملاحظة داخلية للمفتش" },
        bodyEn: "Inspector Bandar — pre-worked case CSC-2026-1421. Citizen file, valid CR, ID and zakat clearance attached. Site is in Olaya district, ground-floor café 80 m². Please arrive 13:50.",
        bodyAr: "المفتش بندر — قضية مُعدّة مسبقاً CSC-2026-1421. ملف المواطن والسجل التجاري والهوية وإخلاء طرف الزكاة مرفقة. الموقع في حي العليا، مقهى دور أرضي 80 م². يرجى الحضور 13:50.",
        confidence: 96,
      },
    ],
    history: [
      { at: hoursAgo(60), actor: { en: "WhatsApp inbound", ar: "وارد واتساب" }, event: { en: "Citizen messaged about renewal delay.", ar: "رسالة من المواطن عن تأخر التجديد." } },
      { at: hoursAgo(48), actor: { en: "Service Conductor",  ar: "منسّق الخدمة" }, event: { en: "Cross-agency status pull launched.", ar: "بدء جلب الحالة عبر الجهات." } },
      { at: hoursAgo(2),  actor: { en: "Comms Drafter",       ar: "كاتب الردّ" },     event: { en: "SMS draft prepared.", ar: "تم إعداد مسوّدة الرسالة." } },
    ],
  },
  caseRow("CSC-2026-1418","cit-2","svc-civil",  "officer-review",   "high",     16,  ["interior"], "complete",  "Civil-status update on hold pending one ID-card photo refresh.", "تحديث الأحوال المدنية بانتظار تجديد صورة الهوية."),
  caseRow("CSC-2026-1417","cit-3","svc-family-visa","awaiting-ministry","high", 22, ["interior","interior"], "in-progress","Family-visit visa under MOI security review (3rd day of 5-day SLA).", "تأشيرة زيارة عائلية قيد المراجعة الأمنية (اليوم 3 من 5)."),
  caseRow("CSC-2026-1416","cit-4","svc-traffic","officer-review",   "medium",   30,  ["interior"], "blocked",   "Traffic-fine appeal — radar evidence pack incomplete from MOI.", "اعتراض على مخالفة — حزمة الرادار من الداخلية غير مكتملة."),
  caseRow("CSC-2026-1415","cit-5","svc-zakat",  "in-progress",      "medium",   38,  ["zatca"], "in-progress","Zakat-assessment review awaiting accountant submission.", "مراجعة الزكاة بانتظار تسليم المحاسب."),
  caseRow("CSC-2026-1414","cit-6","svc-bldg",   "awaiting-citizen", "medium",   46,  ["riyadh-am","riyadh-am"], "complete","Building permit issued — awaiting citizen e-signature.", "صدور رخصة البناء بانتظار توقيع المواطن إلكترونياً."),
  caseRow("CSC-2026-1413","cit-7","svc-biz-reg","officer-review",   "medium",   54,  ["moc","zatca"], "complete","New business registration — partner power-of-attorney needs review.", "تسجيل منشأة جديدة — وكالة شريك بحاجة لمراجعة."),
  caseRow("CSC-2026-1412","cit-8","svc-civil",  "agent-pre-worked", "low",      62,  ["interior"], "complete",  "Marriage-status update pre-worked — three signatures to confirm.", "تحديث الحالة الزوجية مُعدّ مسبقاً — ثلاثة توقيعات للتأكيد."),
  caseRow("CSC-2026-1411","cit-3","svc-saud",   "in-progress",      "low",      70,  ["mol"], "in-progress","Saudization band review for client's company — Q1 numbers compiling.", "مراجعة نطاق السعودة للشركة — تجميع أرقام الربع الأول."),
  caseRow("CSC-2026-1410","cit-9","svc-comm-lic","awaiting-citizen","low",      78,  ["moc","interior","zatca"], "complete","Commercial licence renewal — only payment confirmation pending.", "تجديد رخصة تجارية — تأكيد السداد فقط."),
  caseRow("CSC-2026-1409","cit-9","svc-traffic","agent-pre-worked", "low",      90,  ["interior"], "complete",  "Traffic-fine appeal — appeal pack drafted, ready to submit.", "اعتراض على مخالفة — تم تجهيز ملف الاعتراض."),
  caseRow("CSC-2026-1408","cit-10","svc-family-visa","in-progress","low",       96,  ["interior","interior"], "in-progress","Family visit visa — sponsorship documents in transit.", "تأشيرة زيارة — وثائق الكفالة قيد النقل."),
  caseRow("CSC-2026-1407","cit-10","svc-zakat","awaiting-ministry","low",      120, ["zatca"], "in-progress","Zakat reassessment — ZATCA queue position 14 of 32.", "إعادة احتساب الزكاة — الدور 14 من 32 لدى الزكاة."),
  caseRow("CSC-2026-1406","cit-2","svc-bldg",  "officer-review",   "low",      144, ["riyadh-am"], "in-progress","Permit extension request — drawings under review.", "طلب تمديد رخصة — المخططات قيد المراجعة."),
];

function caseRow(id: string, citizenId: string, serviceId: string,
  status: CaseStatus, priority: CasePriority, slaInHours: number,
  ministries: string[], primaryStatus: CrossAgencyTouchpoint["status"],
  nextStepEn: string, nextStepAr: string): Case {
  return {
    id, citizenId, serviceId, status, priority,
    openedAt: hoursAgo(slaInHours + 24),
    slaDueAt: hoursAhead(slaInHours),
    assignedOfficer: OFFICER.id,
    preWorkedByAgent: status === "agent-pre-worked",
    ministryTouchpoints: ministries.map((m, i) => ({
      ministryId: m,
      status: i === ministries.length - 1 ? primaryStatus : "complete",
      label: { en: "Status checked", ar: "تم التحقق من الحالة" },
      at: i === 0 ? "May 1" : i === 1 ? "May 2" : "May 3",
    })),
    agentNextStep: { en: nextStepEn, ar: nextStepAr },
    agentDrafts: [],
    history: [
      { at: hoursAgo(slaInHours + 24), actor: { en: "Inbound", ar: "وارد" }, event: { en: "Case opened.", ar: "فُتحت القضية." } },
    ],
  };
}

// ─── Resolved cases (for director heatmap and TTR averages) ───────────────

export interface ResolvedCase {
  id: string;
  serviceId: string;
  regionId: string;
  resolvedAt: string;
  ttrHours: number;
  satisfaction: 1 | 2 | 3 | 4 | 5;
  preWorked: boolean;
}

export const RESOLVED_CASES: ResolvedCase[] = (() => {
  const out: ResolvedCase[] = [];
  const ms = MINISTRIES.length, rs = REGIONS.length, svcs = SERVICES.length;
  for (let i = 0; i < 24; i++) {
    out.push({
      id: `CSC-2026-13${(i + 70).toString().padStart(2, "0")}`,
      serviceId: SERVICES[i % svcs].id,
      regionId:  REGIONS[i % rs].id,
      resolvedAt: hoursAgo(24 + i * 6),
      ttrHours: 18 + ((i * 7) % 60),
      satisfaction: ((i % 4) + 2) as 2 | 3 | 4 | 5,
      preWorked: i % 3 !== 0,
    });
    void ms;
  }
  return out;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────

export const tt = (b: BiText | undefined, lang: Lang) => (b ? b[lang] : "");

export function formatRelative(iso: string, now = NOW_ISO, lang: Lang = "en"): string {
  const ms = Date.parse(iso) - Date.parse(now);
  const h = Math.round(ms / 3_600_000);
  if (Math.abs(h) < 1) return lang === "en" ? "just now" : "الآن";
  if (h > 0)  return lang === "en" ? `in ${h}h` : `بعد ${h} س`;
  return lang === "en" ? `${-h}h ago` : `قبل ${-h} س`;
}

export function getCitizen(id: string): Citizen | undefined { return CITIZENS.find((c) => c.id === id); }
export function getService(id: string): Service | undefined { return SERVICES.find((s) => s.id === id); }
export function getMinistry(id: string): Ministry | undefined { return MINISTRIES.find((m) => m.id === id); }
export function getRegion(id: string): Region | undefined { return REGIONS.find((r) => r.id === id); }
export function getCase(id: string): Case | undefined { return ACTIVE_CASES.find((c) => c.id === id); }

// Agents (mirror of scenario file, kept here so chat + recs can render badges)
export const CSC_AGENTS = [
  { id: "orch",     name: { en: "Service Conductor",   ar: "منسّق الكونسيرج" }, color: "#5BA98A" },
  { id: "nlu",      name: { en: "Identity Verifier",   ar: "مُحقّق الهوية" },    color: "#156082" },
  { id: "policy",   name: { en: "Cross-agency Tracer", ar: "مُتعقّب الجهات" },   color: "#F5A623" },
  { id: "drafter",  name: { en: "Comms Drafter",       ar: "كاتب التواصل" },    color: "#5C8CA8" },
  { id: "conf",     name: { en: "Eligibility Checker", ar: "مُدقّق الأهلية" },   color: "#D9534F" },
  { id: "audit",    name: { en: "Closure Auditor",     ar: "مُدقّق الإغلاق" },   color: "#196B24" },
] as const;

export function getCscAgent(id: string) { return CSC_AGENTS.find((a) => a.id === id); }
