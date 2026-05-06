import type { BiText } from "@/lib/sim/types";
import { PROGRAMMES, DEPENDENCIES, programmeById, type Programme, type Rag } from "./programme-war-room-seed";
import programmeWarRoom from "@/lib/sim/scenarios/programme-war-room";

export type Severity = "critical" | "high" | "medium" | "info";
export type RecStatus = "pending" | "approved" | "rejected" | "edited";

// ─── Console-specific personas (do NOT mutate the cockpit scenario) ─────
// The EPMO Command Console uses six named personas. They reuse the cockpit
// scenario IDs where possible so events still resolve, and add a Dependency
// Critic that is unique to the console story.
export interface ConsoleAgent { id: string; name: BiText; role: BiText; color: string; }

export const CONSOLE_AGENTS: ConsoleAgent[] = [
  { id: "orch",    name: { en: "Programme Conductor", ar: "موصّل البرنامج" },   role: { en: "Plans the run, gates the pack.",                                  ar: "يخطّط الجولة ويراقب العبوة." },                                color: "#156082" },
  { id: "watcher", name: { en: "Slip Detector",       ar: "كاشف التأخّر" },     role: { en: "Pulls Jira / MS Project / Confluence events.",                    ar: "يجلب أحداث جيرا والمشاريع وConfluence." },                       color: "#5C8CA8" },
  { id: "raid",    name: { en: "Evidence Compiler",   ar: "مُجمِّع الأدلة" },   role: { en: "Tags events as risk / assumption / issue / dependency.",          ar: "يصنّف الأحداث كمخاطرة/افتراض/مشكلة/اعتمادية." },                color: "#F5A623" },
  { id: "critic",  name: { en: "Dependency Critic",   ar: "ناقد الاعتماديات" }, role: { en: "Walks the dependency graph and flags downstream cascade impact.", ar: "يمشي في خريطة الاعتماديات ويرصد التأثير المتسلسل." },             color: "#E30613" },
  { id: "etc",     name: { en: "Decision Drafter",    ar: "كاتب القرارات" },    role: { en: "Recomputes ETC and drafts the decision options pack.",            ar: "يعيد حساب التقدير ويصوغ خيارات القرار." },                       color: "#5BA98A" },
  { id: "drafter", name: { en: "Memo Writer",         ar: "كاتب المذكّرات" },   role: { en: "Drafts the Steerco breach memo in house style.",                  ar: "يصوغ مذكّرات اللجنة بأسلوب المؤسسة." },                          color: "#196B24" },
];

export function consoleAgentById(id: string): ConsoleAgent | undefined {
  return CONSOLE_AGENTS.find((a) => a.id === id);
}

// ─── Console-specific checkpoints (3 task-required Steerco gates) ──────
export interface ConsoleCheckpoint {
  id: string;
  human: BiText;
  question: BiText;
  rationale: BiText;
  options: { id: string; label: BiText; recommended?: boolean }[];
  /** ID of the matching recommendation, used to wire approve/reject buttons. */
  recId: string;
}

export const CONSOLE_CHECKPOINTS: ConsoleCheckpoint[] = [
  {
    id: "erp-breach-memo",
    recId: "rec-cp-erp-breach-memo",
    human: { en: "EPMO Director", ar: "مديرة المكتب التنفيذي" },
    question: { en: "Sign the Steerco breach memo for Oracle ERP (28-day slip)?", ar: "هل توقّعين مذكّرة خرق اللجنة لـ Oracle ERP (تأخّر 28 يوماً)؟" },
    rationale: {
      en: "Memo Writer compiled the breach narrative + cascade evidence + 3 decision options. Awaits EPMO Director signature before Tuesday's Steerco.",
      ar: "صاغ كاتب المذكّرات الرواية مع أدلة التتالي و3 خيارات. ينتظر توقيع مديرة المكتب قبل اللجنة يوم الثلاثاء.",
    },
    options: [
      { id: "sign", label: { en: "Sign and circulate to Steerco invitees", ar: "وقّعي وأرسلي للجنة" }, recommended: true },
      { id: "soften-c360", label: { en: "Soften the Customer 360 cascade language", ar: "تخفيف لغة تأثير Customer 360" } },
      { id: "send-back", label: { en: "Send back to drafter", ar: "إعادة إلى الكاتب" } },
    ],
  },
  {
    id: "erp-scope-cut",
    recId: "rec-cp-erp-scope-cut",
    human: { en: "EPMO Director + CFO", ar: "مديرة المكتب + المدير المالي" },
    question: { en: "Approve the scope-cut path (drop Procurement Phase 2)?", ar: "اعتماد مسار خفض النطاق (إسقاط المشتريات المرحلة 2)؟" },
    rationale: {
      en: "Decision Drafter compared three options. Scope-cut recovers 24 of 28 slip days, costs AED 0 contingency, transfers risk to a Q3 follow-on. Recommended over re-baseline (loses Steerco confidence) and contingency burn (depletes envelope).",
      ar: "قارن كاتب القرارات بين 3 خيارات. خفض النطاق يستعيد 24 يوماً من 28، بدون استخدام للاحتياطي، وينقل المخاطر إلى موجة Q3.",
    },
    options: [
      { id: "scope-cut", label: { en: "Sign scope-cut and route to CFO", ar: "وقّعي خفض النطاق وأرسلي للمدير المالي" }, recommended: true },
      { id: "rebaseline", label: { en: "Re-baseline ERP (push HCM go-live to August)", ar: "إعادة معايرة ERP (تأجيل HCM لأغسطس)" } },
      { id: "burn", label: { en: "Burn AED 6.4M contingency", ar: "استهلاك 6.4 مليون درهم احتياطي" } },
    ],
  },
  {
    id: "cascade-broadcast",
    recId: "rec-cp-cascade-broadcast",
    human: { en: "EPMO Director", ar: "مديرة المكتب التنفيذي" },
    question: { en: "Broadcast Oracle ERP slip cascade to Customer 360, Network Modernisation, Core Billing leads?", ar: "هل تُعلن تتالي تأخّر Oracle ERP على Customer 360 وتحديث الشبكة وتجديد الفوترة؟" },
    rationale: {
      en: "Dependency Critic walked the graph: 3 downstream programmes hit between May 12-22. Early notice lets workstream leads adjust resourcing before the dates land.",
      ar: "مشى ناقد الاعتماديات في الخريطة: 3 برامج مَجاذبة بين 12 و22 مايو. الإشعار المبكّر يتيح لقادة المسارات تعديل الموارد قبل المواعيد.",
    },
    options: [
      { id: "broadcast", label: { en: "Broadcast cascade now", ar: "أعلني التتالي الآن" }, recommended: true },
      { id: "phased", label: { en: "Phase the broadcast (CCO first, then CTO)", ar: "إعلان مرحلي (CCO أولاً ثم CTO)" } },
      { id: "hold", label: { en: "Hold until Steerco approves the memo", ar: "انتظري موافقة اللجنة على المذكّرة" } },
    ],
  },
];

export interface AgentRecommendation {
  id: string;
  agentId: string;
  programmeId: string;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: Severity;
  recommendedAction: BiText;
  alternateActions: BiText[];
  status: RecStatus;
  generatedAt: string;
  /** When true, this rec also represents a Steerco checkpoint card. */
  isCheckpoint?: boolean;
  checkpointHuman?: BiText;
}

export interface AgentAlert {
  id: string;
  agentId: string;
  programmeId: string;
  severity: Severity;
  title: BiText;
  detail: BiText;
  receivedAt: string;
}

export interface DecisionLogEntry {
  id: string;
  programmeId: string;
  decidedAt: string;
  decidedBy: BiText;
  agentId: string;
  agentRecommendation: BiText;
  humanChoice: BiText;
  rationale: BiText;
  matchesAgent: boolean;
}

export interface AuditEntry {
  id: string;
  agentId: string;
  programmeId: string;
  action: BiText;
  detail: BiText;
  timestamp: string;
}

export interface CascadeEntry {
  id: string;
  sourceId: string;
  source: BiText;
  downstream: { id: string; name: BiText; hitDate: string; impact: BiText }[];
}

export interface DecisionOption {
  id: string;
  label: BiText;
  cost: BiText;
  risk: BiText;
  timeToRecover: BiText;
  recommended?: boolean;
}

const NOW = new Date("2026-05-05T09:00:00Z");
const isoHoursAgo = (h: number) => {
  const d = new Date(NOW);
  d.setHours(d.getHours() - h);
  return d.toISOString();
};

// ─── Recommendations ────────────────────────────────────────────────────

export function generateRecommendations(): AgentRecommendation[] {
  const out: AgentRecommendation[] = [];

  // Steerco-grade checkpoint cards (3) — first three Approvals cards per spec
  out.push({
    id: "rec-cp-erp-breach-memo",
    agentId: "drafter",
    programmeId: "erp-oracle",
    title: { en: "Sign Steerco breach memo — Oracle ERP", ar: "توقيع مذكّرة خرق اللجنة — Oracle ERP" },
    rationale: {
      en: "ERP slip 28 days; Memo Writer compiled the breach narrative + cascade evidence + 3 decision options. Awaits EPMO Director signature before Tuesday's Steerco.",
      ar: "تأخّر ERP 28 يوماً؛ صاغ كاتب المذكّرات الرواية مع أدلة التتالي و3 خيارات. ينتظر توقيع مديرة المكتب قبل اللجنة يوم الثلاثاء.",
    },
    confidence: 96, severity: "critical",
    recommendedAction: { en: "Sign and circulate to Steerco invitees", ar: "وقّعي وأرسلي للجنة" },
    alternateActions: [
      { en: "Soften the Customer 360 cascade language", ar: "تخفيف لغة تأثير Customer 360" },
      { en: "Send back to drafter", ar: "إعادة إلى الكاتب" },
    ],
    status: "pending", generatedAt: isoHoursAgo(2),
    isCheckpoint: true, checkpointHuman: { en: "EPMO Director", ar: "مديرة المكتب التنفيذي" },
  });

  out.push({
    id: "rec-cp-erp-scope-cut",
    agentId: "etc",
    programmeId: "erp-oracle",
    title: { en: "Approve scope-cut path (drop Procurement Phase 2)", ar: "اعتماد خفض النطاق (إسقاط المشتريات المرحلة 2)" },
    rationale: {
      en: "Decision Drafter compared three options. Scope-cut recovers 24 of 28 slip days, costs AED 0 contingency, transfers risk to a Q3 follow-on. Recommended over re-baseline (loses Steerco confidence) and contingency burn (depletes envelope).",
      ar: "قارن كاتب القرارات بين 3 خيارات. خفض النطاق يستعيد 24 يوماً من 28، بدون استخدام للاحتياطي، وينقل المخاطر إلى موجة Q3. مفضّل على إعادة المعايرة (خسارة ثقة اللجنة) واستهلاك الاحتياطي (استنزاف الظرف).",
    },
    confidence: 89, severity: "critical",
    recommendedAction: { en: "Sign scope-cut and route to CFO", ar: "وقّعي خفض النطاق وأرسلي للمدير المالي" },
    alternateActions: [
      { en: "Re-baseline ERP (push HCM go-live to August)", ar: "إعادة معايرة ERP (تأجيل HCM لأغسطس)" },
      { en: "Burn AED 6.4M contingency", ar: "استهلاك 6.4 مليون درهم احتياطي" },
    ],
    status: "pending", generatedAt: isoHoursAgo(3),
    isCheckpoint: true, checkpointHuman: { en: "EPMO Director + CFO", ar: "مديرة المكتب + المدير المالي" },
  });

  out.push({
    id: "rec-cp-cascade-broadcast",
    agentId: "critic",
    programmeId: "customer360",
    title: { en: "Broadcast cascade-update to downstream PMs", ar: "بثّ تحديث التتالي لمدراء البرامج التابعة" },
    rationale: {
      en: "Once scope-cut is signed, Customer 360 + Network Modernisation PMs need a single, unified note: new dependency dates, what changes for them, and what doesn't. Conductor pre-drafted both notes from the cockpit run.",
      ar: "بعد توقيع خفض النطاق، يحتاج مدراء Customer 360 وتحديث الشبكة لمذكّرة موحّدة: المواعيد الجديدة وما يتغيّر وما يبقى. صاغ المنسّق المذكّرتين من جلسة الوكلاء.",
    },
    confidence: 92, severity: "high",
    recommendedAction: { en: "Send both notes (CC Steerco)", ar: "إرسال المذكّرتين مع نسخة للجنة" },
    alternateActions: [
      { en: "Hold until CFO confirms scope-cut", ar: "تأجيل حتى تأكيد المدير المالي" },
    ],
    status: "pending", generatedAt: isoHoursAgo(3),
    isCheckpoint: true, checkpointHuman: { en: "EPMO Director", ar: "مديرة المكتب التنفيذي" },
  });

  // Derived recs across other programmes
  out.push({
    id: "rec-d-001",
    agentId: "raid",
    programmeId: "data-foundation",
    title: { en: "Approve 14-day lineage sprint — Data Foundation", ar: "اعتماد موجة نسب 14 يوماً — أُسس البيانات" },
    rationale: {
      en: "RAID Classifier escalated lineage gap to Issue. Without action, Wave-2 reporting slips beyond Q2 close.",
      ar: "صعّد مصنّف RAID ثغرة النسب إلى مشكلة. بدون التدخّل سينزلق Wave-2 خارج إغلاق الربع.",
    },
    confidence: 87, severity: "high",
    recommendedAction: { en: "Approve sprint + DataOps overtime budget", ar: "اعتماد الموجة + ميزانية إضافيّة لـ DataOps" },
    alternateActions: [{ en: "Defer 1 sprint", ar: "تأجيل موجة واحدة" }],
    status: "pending", generatedAt: isoHoursAgo(6),
  });

  out.push({
    id: "rec-d-002",
    agentId: "etc",
    programmeId: "cloud-mig",
    title: { en: "Escalate CCoE sign-off to CIO — Cloud landing zone", ar: "تصعيد موافقة CCoE للمدير التقني" },
    rationale: {
      en: "ETC Re-baseliner shows 9 days awaiting CCoE. Sovereign-region delay blocks ERP cutover.",
      ar: "يُظهر معيد المعايرة 9 أيام انتظار من CCoE. تأخّر المنطقة السيادية يعطّل تحويل ERP.",
    },
    confidence: 84, severity: "high",
    recommendedAction: { en: "Email CIO with 48h SLA", ar: "إيميل للمدير التقني بمهلة 48 ساعة" },
    alternateActions: [{ en: "Continue waiting", ar: "متابعة الانتظار" }],
    status: "pending", generatedAt: isoHoursAgo(10),
  });

  out.push({
    id: "rec-d-003",
    agentId: "watcher",
    programmeId: "ai-productivity",
    title: { en: "Re-flag AI productivity to Amber — silent slip", ar: "إعادة تصنيف إنتاجية الذكاء إلى أصفر — تأخّر صامت" },
    rationale: {
      en: "Programme Watcher detected 6 day slip in 7 days but RAG was still Green. Now flipped Amber pending sponsor sign-off.",
      ar: "رصد المراقب تأخّراً 6 أيام خلال أسبوع رغم اللون الأخضر. الآن أصفر بانتظار توقيع الراعي.",
    },
    confidence: 91, severity: "medium",
    recommendedAction: { en: "Confirm Amber + notify CHRO", ar: "تأكيد الأصفر + إخطار مديرة الموارد البشرية" },
    alternateActions: [{ en: "Override back to Green", ar: "إرجاع للأخضر" }],
    status: "pending", generatedAt: isoHoursAgo(12),
  });

  out.push({
    id: "rec-d-004",
    agentId: "raid",
    programmeId: "b2b-portal",
    title: { en: "Re-baseline B2B portal Wave-1 (depends on Customer 360)", ar: "إعادة معايرة الموجة 1 للبوابة (تعتمد على Customer 360)" },
    rationale: { en: "Identity API now slipping into July; Wave-1 pilots cannot start without it.", ar: "واجهة الهوية تتأخّر إلى يوليو؛ لا يمكن بدء الموجة 1 بدونها." },
    confidence: 78, severity: "medium",
    recommendedAction: { en: "Re-baseline Wave-1 to Aug 5", ar: "إعادة معايرة الموجة 1 إلى 5 أغسطس" },
    alternateActions: [{ en: "Pilot on stub identity", ar: "تجربة باستخدام هوية بديلة" }],
    status: "pending", generatedAt: isoHoursAgo(14),
  });

  out.push({
    id: "rec-d-005",
    agentId: "etc",
    programmeId: "talent",
    title: { en: "Watchlist: Talent platform silent slip", ar: "قائمة مراقبة: تأخّر صامت في منصّة المواهب" },
    rationale: { en: "+1 day slip detected since last week despite Green. Move to weekly watch.", ar: "تأخّر يوم واحد منذ الأسبوع الماضي رغم الأخضر. للمراقبة الأسبوعيّة." },
    confidence: 72, severity: "info",
    recommendedAction: { en: "Add to watchlist", ar: "إضافة لقائمة المراقبة" },
    alternateActions: [{ en: "Ignore (within tolerance)", ar: "تجاهل ضمن النطاق" }],
    status: "approved", generatedAt: isoHoursAgo(36),
  });

  return out;
}

// ─── Alerts (used by notifications panel) ───────────────────────────────

export function generateAlerts(): AgentAlert[] {
  return [
    {
      id: "a1", agentId: "watcher", programmeId: "erp-oracle", severity: "critical",
      title: { en: "ERP slip widened to 28 days overnight", ar: "تأخّر ERP اتّسع إلى 28 يوماً ليلاً" },
      detail: { en: "Slip Detector flipped Oracle ERP to Red after vendor patch v2.4 failed UAT round 3.", ar: "حوّل راصد التأخّر برنامج Oracle إلى أحمر بعد فشل تصحيح المورد." },
      receivedAt: isoHoursAgo(2),
    },
    {
      id: "a2", agentId: "critic", programmeId: "customer360", severity: "high",
      title: { en: "Cascade hit: Customer 360 + Network Modernisation", ar: "أثر التتالي: Customer 360 + تحديث الشبكة" },
      detail: { en: "Dependency Critic computed 18d + 12d downstream impact; Wave-1 dates moved.", ar: "احتسب ناقد الاعتمادية 18 + 12 يوماً للأثر؛ تأجّلت مواعيد الموجة 1." },
      receivedAt: isoHoursAgo(2),
    },
    {
      id: "a3", agentId: "drafter", programmeId: "erp-oracle", severity: "high",
      title: { en: "Steerco breach memo drafted (read-only)", ar: "صياغة مذكّرة اللجنة (للقراءة فقط)" },
      detail: { en: "Memo Writer assembled the breach memo with 3 decision options; awaiting your signature.", ar: "جمع كاتب المذكّرات المذكّرة مع 3 خيارات؛ بانتظار توقيعكِ." },
      receivedAt: isoHoursAgo(3),
    },
    {
      id: "a4", agentId: "watcher", programmeId: "ai-productivity", severity: "medium",
      title: { en: "Silent slip flagged on AI productivity rollout", ar: "تأخّر صامت في إطلاق إنتاجية الذكاء" },
      detail: { en: "+6 days in 7 days; Watcher flipped to Amber.", ar: "+6 أيام خلال أسبوع؛ تحوّل المراقب للأصفر." },
      receivedAt: isoHoursAgo(12),
    },
    {
      id: "a5", agentId: "raid", programmeId: "data-foundation", severity: "high",
      title: { en: "Lineage gap escalated to Issue", ar: "تصعيد ثغرة النسب إلى مشكلة" },
      detail: { en: "RAID Classifier promoted lineage gap from Risk → Issue across 3 sources.", ar: "رفع مصنّف RAID ثغرة النسب من مخاطرة إلى مشكلة." },
      receivedAt: isoHoursAgo(6),
    },
  ];
}

// ─── Cascades ───────────────────────────────────────────────────────────

export function generateCascades(): CascadeEntry[] {
  return [
    {
      id: "c1", sourceId: "erp-oracle",
      source: { en: "Oracle ERP — 28d slip", ar: "Oracle ERP — تأخّر 28 يوماً" },
      downstream: [
        { id: "customer360", name: { en: "Customer 360", ar: "العميل 360" }, hitDate: "2026-06-05", impact: { en: "ERP master sync slips +18d", ar: "مزامنة سجل ERP تتأخّر 18 يوماً" } },
        { id: "network-mod", name: { en: "Network Modernisation", ar: "تحديث الشبكة" }, hitDate: "2026-06-12", impact: { en: "Asset master delays edge wave 2 by +12d", ar: "تأخّر سجل الأصول 12 يوماً" } },
        { id: "core-billing", name: { en: "Core billing", ar: "الفوترة الأساسيّة" }, hitDate: "2026-07-08", impact: { en: "GL contract slips +7d, tariff cutover at risk", ar: "عقد دفتر الأستاذ +7 أيام، تحويل التعرفة بخطر" } },
      ],
    },
    {
      id: "c2", sourceId: "data-foundation",
      source: { en: "Data foundation — 22d slip", ar: "أُسس البيانات — تأخّر 22 يوماً" },
      downstream: [
        { id: "customer360", name: { en: "Customer 360", ar: "العميل 360" }, hitDate: "2026-05-30", impact: { en: "Lineage of contact data delays Wave-1 cutover", ar: "نسب جهات الاتصال تؤجّل التحويل" } },
        { id: "ai-productivity", name: { en: "AI productivity", ar: "إنتاجية الذكاء" }, hitDate: "2026-06-18", impact: { en: "Document-AI training data unavailable", ar: "بيانات تدريب الذكاء غير متاحة" } },
      ],
    },
    {
      id: "c3", sourceId: "customer360",
      source: { en: "Customer 360 — 18d cascade", ar: "Customer 360 — تتالي 18 يوماً" },
      downstream: [
        { id: "b2b-portal", name: { en: "B2B portal", ar: "بوابة الأعمال" }, hitDate: "2026-08-05", impact: { en: "Identity API blocks Wave-1 enterprise pilots", ar: "واجهة الهوية تعطّل تجارب الموجة 1" } },
        { id: "omnichannel", name: { en: "Omnichannel care", ar: "خدمة متعدّدة القنوات" }, hitDate: "2026-06-25", impact: { en: "Identity API delay pushes WhatsApp BSP +7d", ar: "تأخّر واجهة الهوية يدفع واتساب 7 أيام" } },
      ],
    },
  ];
}

// ─── Decision pack for ERP (read-only embed in Programme detail) ────────

export function generateDecisionPack(programmeId: string): DecisionOption[] {
  if (programmeId !== "erp-oracle") return [];
  return [
    {
      id: "rebaseline",
      label: { en: "Re-baseline ERP", ar: "إعادة معايرة ERP" },
      cost: { en: "AED 0 contingency", ar: "0 درهم احتياطي" },
      risk: { en: "High — Steerco confidence loss", ar: "عالٍ — خسارة ثقة اللجنة" },
      timeToRecover: { en: "0 days (extends plan)", ar: "0 أيام (تمديد)" },
    },
    {
      id: "scope-cut",
      label: { en: "Scope-cut: drop Procurement Phase 2", ar: "خفض النطاق: إسقاط مشتريات المرحلة 2" },
      cost: { en: "AED 0 contingency · Q3 follow-on", ar: "0 درهم · موجة Q3 لاحقة" },
      risk: { en: "Medium — Procurement delay only", ar: "متوسّط — تأجيل المشتريات فقط" },
      timeToRecover: { en: "Recovers 24 of 28 slip days", ar: "يستعيد 24 من 28 يوماً" },
      recommended: true,
    },
    {
      id: "burn",
      label: { en: "Burn AED 6.4M contingency", ar: "استهلاك 6.4 مليون درهم احتياطي" },
      cost: { en: "AED 6.4M contingency", ar: "6.4 مليون درهم" },
      risk: { en: "High — depletes Q-end envelope", ar: "عالٍ — استنزاف الظرف" },
      timeToRecover: { en: "Recovers 28 of 28 slip days", ar: "يستعيد 28 من 28 يوماً" },
    },
  ];
}

// ─── Memo (read-only) ───────────────────────────────────────────────────

export function generateMemo(programmeId: string): { title: BiText; body: BiText[] } | null {
  if (programmeId !== "erp-oracle") return null;
  return {
    title: { en: "Steerco breach memo — Oracle ERP rollout", ar: "مذكّرة خرق اللجنة — Oracle ERP" },
    body: [
      { en: "1. Headline. Oracle ERP rollout is 28 days behind plan as of 5 May 2026. Vendor patch v2.4 (data migration) failed UAT round 3 on 2 May. Slip cascades to Customer 360 (+18d), Network Modernisation (+12d), and Core billing (+7d).", ar: "1. العنوان. تأخّر Oracle ERP 28 يوماً عن الخطّة في 5 مايو 2026. فشل التصحيح v2.4 للهجرة في الجولة الثالثة. تتالي التأخّر: Customer 360 (+18 يوماً)، تحديث الشبكة (+12)، الفوترة الأساسيّة (+7)." },
      { en: "2. Recommendation. Approve scope-cut path: drop Procurement Phase 2 from this release; recovers 24 of 28 slip days at zero contingency cost. Procurement Phase 2 deferred to Q3 follow-on (formal change request to follow).", ar: "2. التوصية. اعتماد خفض النطاق: إسقاط المشتريات المرحلة 2 من هذا الإصدار؛ يستعيد 24 من 28 يوماً بلا تكلفة احتياطي. المشتريات المرحلة 2 تؤجّل لموجة Q3." },
      { en: "3. Decision asks. (a) Sign scope-cut and route to CFO. (b) Authorise cascade-update broadcast to Customer 360 and Network Modernisation PMs. (c) Note: contingency envelope preserved at AED 2.3M post-action.", ar: "3. الطلبات. (أ) توقيع خفض النطاق وإرسال للمدير المالي. (ب) السماح ببثّ تحديث التتالي لمدراء البرامج. (ج) ملاحظة: ظرف الاحتياطي يبقى عند 2.3 مليون درهم." },
      { en: "Drafted by Memo Writer · sources: Slip Detector, Evidence Compiler, Dependency Critic, Decision Drafter (cockpit run 2026-05-05).", ar: "صاغها كاتب المذكّرات · المصادر: راصد التأخّر، مُجمّع الأدلة، ناقد الاعتمادية، كاتب القرارات." },
    ],
  };
}

// ─── Decision log (historical) ──────────────────────────────────────────

export function generateDecisionLog(): DecisionLogEntry[] {
  return [
    {
      id: "d-001", programmeId: "data-foundation",
      decidedAt: "2026-04-22T10:30:00Z",
      decidedBy: { en: "Mariam Saleh", ar: "مريم صالح" },
      agentId: "raid",
      agentRecommendation: { en: "Promote lineage gap to Issue + 14-day sprint", ar: "ترفيع ثغرة النسب لمشكلة + موجة 14 يوماً" },
      humanChoice: { en: "Promote to Issue + 14-day sprint", ar: "ترفيع لمشكلة + موجة 14 يوماً" },
      rationale: { en: "Aligned — sprint authorised, DataOps overtime approved.", ar: "متطابق — اعتُمدت الموجة وساعات DataOps." },
      matchesAgent: true,
    },
    {
      id: "d-002", programmeId: "ai-productivity",
      decidedAt: "2026-04-15T14:00:00Z",
      decidedBy: { en: "Mariam Saleh", ar: "مريم صالح" },
      agentId: "watcher",
      agentRecommendation: { en: "Flip RAG to Amber on Copilot pilot delay", ar: "تحويل الحالة للأصفر بسبب تأخّر Copilot" },
      humanChoice: { en: "Hold at Green pending CHRO conversation", ar: "الإبقاء على الأخضر بانتظار محادثة CHRO" },
      rationale: { en: "Override — sponsor preferred to keep optics until prerequisites confirmed.", ar: "تجاوز — فضّل الراعي الإبقاء حتى تأكيد المتطلبات." },
      matchesAgent: false,
    },
    {
      id: "d-003", programmeId: "core-billing",
      decidedAt: "2026-04-02T09:15:00Z",
      decidedBy: { en: "Mariam Saleh", ar: "مريم صالح" },
      agentId: "etc",
      agentRecommendation: { en: "Re-baseline tariff engine cutover by 14 days", ar: "إعادة معايرة تحويل محرك التعرفة 14 يوماً" },
      humanChoice: { en: "Re-baseline by 14 days", ar: "إعادة معايرة 14 يوماً" },
      rationale: { en: "Aligned — Amdocs confirmed tariff library refresh schedule.", ar: "متطابق — أكّدت Amdocs جدول تحديث المكتبة." },
      matchesAgent: true,
    },
    {
      id: "d-004", programmeId: "five-g",
      decidedAt: "2026-03-28T16:45:00Z",
      decidedBy: { en: "Mariam Saleh", ar: "مريم صالح" },
      agentId: "drafter",
      agentRecommendation: { en: "Defer Phase-2 sites to Q3", ar: "تأجيل مواقع المرحلة 2 للربع 3" },
      humanChoice: { en: "Approve Phase-2 sites with reduced footprint", ar: "اعتماد المواقع بنطاق مخفّض" },
      rationale: { en: "Override — CTO offered shared resource pool; risk acceptable.", ar: "تجاوز — قدّم المدير التقني فريقاً مشتركاً." },
      matchesAgent: false,
    },
    {
      id: "d-005", programmeId: "cybersec",
      decidedAt: "2026-03-12T11:00:00Z",
      decidedBy: { en: "Mariam Saleh", ar: "مريم صالح" },
      agentId: "raid",
      agentRecommendation: { en: "Close ZTNA risk — accept residual", ar: "إغلاق مخاطرة ZTNA — قبول المتبقّي" },
      humanChoice: { en: "Close — accept residual", ar: "إغلاق — قبول المتبقّي" },
      rationale: { en: "Aligned — controls evidence accepted by CISO.", ar: "متطابق — قُبلت الأدلة من CISO." },
      matchesAgent: true,
    },
  ];
}

// ─── Audit log (filtered to Mariam's ACL) ───────────────────────────────

export function generateAuditLog(): AuditEntry[] {
  // Pull from scenario events as the base + add some derived entries
  const out: AuditEntry[] = [];
  const events = programmeWarRoom.events;
  events.forEach((ev, i) => {
    if (ev.kind === "think" || ev.kind === "tool-call" || ev.kind === "patch-workspace" || ev.kind === "decision") {
      out.push({
        id: `audit-scn-${i}`,
        agentId: ev.agentId ?? "orch",
        programmeId: "erp-oracle",
        action: ev.label,
        detail: ev.toolResult ?? ev.detail ?? ev.label,
        timestamp: isoHoursAgo(8 - Math.floor(i / 3)),
      });
    }
  });
  // Add cross-programme audit lines
  out.push({
    id: "audit-x1", agentId: "watcher", programmeId: "ai-productivity",
    action: { en: "Flip RAG Green → Amber", ar: "تحويل الحالة من أخضر لأصفر" },
    detail: { en: "Slip-day rate exceeded silent threshold (6d in 7d)", ar: "تجاوز معدّل التأخّر الحدّ الصامت" },
    timestamp: isoHoursAgo(12),
  });
  out.push({
    id: "audit-x2", agentId: "raid", programmeId: "data-foundation",
    action: { en: "Promote Risk → Issue", ar: "ترفيع مخاطرة إلى مشكلة" },
    detail: { en: "Lineage gap on 3 source systems", ar: "ثغرة نسب على 3 أنظمة" },
    timestamp: isoHoursAgo(6),
  });
  out.push({
    id: "audit-x3", agentId: "etc", programmeId: "cloud-mig",
    action: { en: "Recompute ETC", ar: "إعادة احتساب التقدير" },
    detail: { en: "+9 days awaiting CCoE sovereign-region sign-off", ar: "+9 أيام بانتظار CCoE" },
    timestamp: isoHoursAgo(10),
  });
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ─── Aggregations consumed by KPI tiles + chat intents ──────────────────

export function getKpis() {
  const atRisk = PROGRAMMES.filter((p) => p.rag === "red").length;
  const totalSlip = PROGRAMMES.reduce((s, p) => s + p.slipDays, 0);
  const burned = PROGRAMMES.reduce((s, p) => s + p.contingencyBurnedAed, 0);
  const envelope = PROGRAMMES.reduce((s, p) => s + p.contingencyAed, 0);
  const decisions = generateRecommendations().filter((r) => r.status === "pending").length;
  const memos = 1; // ERP breach memo
  return { atRisk, totalSlip, burned, envelope, decisions, memos };
}

export function silentSlippers(): Programme[] {
  return PROGRAMMES.filter((p) => p.silentSlip);
}

export function blockingMatrix(): { party: BiText; programmes: BiText[]; issue: BiText }[] {
  const map = new Map<string, { party: BiText; programmes: BiText[]; issue: BiText }>();
  PROGRAMMES.forEach((p) => {
    if (!p.blockingParty || !p.blockingIssue) return;
    const key = p.blockingParty.en;
    const existing = map.get(key);
    if (existing) {
      existing.programmes.push(p.name);
    } else {
      map.set(key, { party: p.blockingParty, programmes: [p.name], issue: p.blockingIssue });
    }
  });
  return Array.from(map.values());
}

export function ragColor(rag: Rag): string {
  return rag === "red" ? "#E30613" : rag === "amber" ? "#F59E0B" : "#10B981";
}

export function programmeBlockingFor(toId: string): Programme[] {
  const sourceIds = DEPENDENCIES.filter((d) => d.toId === toId).map((d) => d.fromId);
  return sourceIds.map((id) => programmeById(id)).filter((p): p is Programme => Boolean(p));
}
