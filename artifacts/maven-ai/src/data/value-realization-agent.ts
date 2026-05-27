/**
 * Value Realization — derived agent output (recommendations, alerts,
 * activity log) for the CFO Benefits Cockpit.
 *
 * The 6 named agents below mirror the cockpit demo's narrative agents:
 * - realization-conductor (orchestrator) → maps to scenario "orchestrator"
 * - claim-compiler → narrator/scorer hybrid
 * - evidence-auditor → watcher
 * - attribution-critic → detective
 * - rebaseline-drafter → narrator
 * - sponsor-escalator → orchestrator (escalation arm)
 */

import type { BiText } from "@/lib/sim/types";
import {
  INITIATIVES,
  SPONSORS,
  type Initiative,
  formatAED,
  gap,
  realisationPct,
} from "./value-realization-seed";
import valueRealizationScenario from "@/lib/sim/scenarios/value-realization";

export type ConductorAgentId =
  | "realization-conductor"
  | "claim-compiler"
  | "evidence-auditor"
  | "attribution-critic"
  | "rebaseline-drafter"
  | "sponsor-escalator";

export interface ConductorAgent {
  id: ConductorAgentId;
  name: BiText;
  role: BiText;
  color: string;
  /** Maps to the scenario agent id when one exists (for cross-linking). */
  scenarioAgentId?: string;
}

export const CONDUCTOR_AGENTS: ConductorAgent[] = [
  {
    id: "realization-conductor",
    name: { en: "Realization Conductor", ar: "منسّق تحقيق القيمة" },
    role: { en: "Plans the chase, coordinates specialists, gates approvals.", ar: "يخطّط مهمة المتابعة وينسّق المتخصّصين ويحرس الموافقات." },
    color: "#8A5BD6",
    scenarioAgentId: "orchestrator",
  },
  {
    id: "claim-compiler",
    name: { en: "Claim Compiler", ar: "مُجمِّع الادّعاءات" },
    role: { en: "Builds the realised-value claim with full provenance.", ar: "يبني ادّعاء القيمة المحققة مع المصدر الكامل." },
    color: "#3B82F6",
    scenarioAgentId: "scorer",
  },
  {
    id: "evidence-auditor",
    name: { en: "Evidence Auditor", ar: "مُدقّق الأدلّة" },
    role: { en: "Audits ERP, P&L and ticket data behind every claim.", ar: "يدقّق بيانات ERP والربح والخسارة والتذاكر خلف كل ادّعاء." },
    color: "#5B7CFF",
    scenarioAgentId: "watcher",
  },
  {
    id: "attribution-critic",
    name: { en: "Attribution Critic", ar: "ناقد الإسناد" },
    role: { en: "Tests counter-factuals, names the dominant cause of any gap.", ar: "يختبر الفرضيات البديلة ويحدّد السبب الغالب لأي فجوة." },
    color: "#D9534F",
    scenarioAgentId: "detective",
  },
  {
    id: "rebaseline-drafter",
    name: { en: "Re-baseline Drafter", ar: "كاتب إعادة الاحتساب" },
    role: { en: "Drafts the re-baseline memo for sponsor + CFO sign-off.", ar: "يصوغ مذكّرة إعادة الاحتساب لتوقيع الراعي والمدير المالي." },
    color: "#8A5BD6",
    scenarioAgentId: "narrator",
  },
  {
    id: "sponsor-escalator",
    name: { en: "Sponsor Escalator", ar: "مُصعّد الراعي" },
    role: { en: "Escalates blocked initiatives to the named sponsor.", ar: "يصعّد المبادرات المتعثّرة إلى الراعي المعني." },
    color: "#F59E0B",
    scenarioAgentId: "orchestrator",
  },
];

export function getConductorAgent(id: string): ConductorAgent | undefined {
  return CONDUCTOR_AGENTS.find((a) => a.id === id);
}

// ─── Recommendations ────────────────────────────────────────────────────

export type RecommendationKind =
  | "rebaseline"
  | "escalate"
  | "claim"
  | "evidence"
  | "attribution"
  | "celebrate";

export type RecommendationStatus = "pending" | "approved" | "dismissed";

export interface AgentRecommendation {
  id: string;
  agentId: ConductorAgentId;
  kind: RecommendationKind;
  initiativeId: string;
  title: BiText;
  rationale: BiText;
  recommendedAction: BiText;
  alternateActions: BiText[];
  /** 0-100 */
  confidence: number;
  severity: "critical" | "high" | "medium" | "info";
  status: RecommendationStatus;
  generatedAt: string;
}

/** 5 derived recommendations + the 2 scenario checkpoints will be merged
 * by the Approvals view. */
export function generateRecommendations(): AgentRecommendation[] {
  const byId = (id: string) => INITIATIVES.find((i) => i.id === id)!;
  return [
    {
      id: "rec-procurement-rescope",
      agentId: "rebaseline-drafter",
      kind: "rebaseline",
      initiativeId: "vr-procurement-intel",
      title: {
        en: "Re-baseline Procurement Intelligence to AED 22M",
        ar: "إعادة احتساب ذكاء المشتريات إلى 22 مليون درهم",
      },
      rationale: {
        en: "Realised AED 19M against an AED 35M promise — Attribution Critic blames scope creep on tail-spend categories. Re-scope to top-3 categories and re-promise AED 22M to keep the case credible.",
        ar: "تحقّق 19 مليون درهم مقابل وعد 35 — ناقد الإسناد يُرجع الفرق إلى تمدّد النطاق على فئات الإنفاق الذيلية. إعادة النطاق إلى أكبر 3 فئات وإعادة الوعد إلى 22 مليون للحفاظ على المصداقية.",
      },
      recommendedAction: { en: "Approve re-baseline at AED 22M", ar: "اعتماد إعادة الاحتساب عند 22 مليون درهم" },
      alternateActions: [
        { en: "Hold and request CPO meeting", ar: "تعليق وطلب اجتماع مع مدير المشتريات" },
        { en: "Reject, keep AED 35M target", ar: "رفض، الإبقاء على هدف 35 مليون" },
      ],
      confidence: 87,
      severity: "high",
      status: "pending",
      generatedAt: "2026-05-04T22:14:00Z",
    },
    {
      id: "rec-hospitality-escalate",
      agentId: "sponsor-escalator",
      kind: "escalate",
      initiativeId: "vr-hospitality-revenue",
      title: {
        en: "Escalate Hospitality Revenue to CDO — PDPL block, 142 days drift",
        ar: "تصعيد إيرادات الضيافة إلى رئيسة البيانات — حصار PDPL، انجراف 142 يومًا",
      },
      rationale: {
        en: "AED 19.8M parked for 142 days behind a PDPL data-sharing review. Sponsor Escalator recommends a 14-day unblocking sprint owned by the CDO.",
        ar: "19.8 مليون درهم متوقّفة 142 يومًا خلف مراجعة مشاركة البيانات حسب PDPL. يُوصي مُصعّد الراعي بسبرنت 14 يومًا تقوده رئيسة البيانات.",
      },
      recommendedAction: { en: "Send escalation to CDO with 14-day SLA", ar: "إرسال التصعيد لرئيسة البيانات بمهلة 14 يومًا" },
      alternateActions: [
        { en: "Pause the initiative for one quarter", ar: "إيقاف المبادرة لربع سنة" },
        { en: "Kill and write off invested AED", ar: "إنهاء وشطب المبلغ المُستثمر" },
      ],
      confidence: 92,
      severity: "critical",
      status: "pending",
      generatedAt: "2026-05-04T23:02:00Z",
    },
    {
      id: "rec-treasury-evidence",
      agentId: "evidence-auditor",
      kind: "evidence",
      initiativeId: "vr-treasury-cash",
      title: {
        en: "Reject Treasury Cash claim — evidence gap",
        ar: "رفض ادّعاء سيولة الخزينة — نقص أدلّة" ,
      },
      rationale: {
        en: "Treasury reported AED 600K realised but the bank reconciliation only supports AED 180K. Evidence Auditor recommends rejecting the run-rate claim until a clean June reconciliation is available.",
        ar: "أبلغت الخزينة عن تحقّق 600 ألف درهم لكنّ التسوية البنكية لا تدعم سوى 180 ألفًا. يُوصي مُدقّق الأدلّة برفض ادّعاء الوتيرة حتى تسوية شهر يونيو.",
      },
      recommendedAction: { en: "Reject the claim, set realised = AED 180K", ar: "رفض الادّعاء وضبط المحقّق على 180 ألف درهم" },
      alternateActions: [
        { en: "Accept the claim with footnote", ar: "قبول الادّعاء مع حاشية" },
        { en: "Defer to next month's close", ar: "تأجيل لإقفال الشهر القادم" },
      ],
      confidence: 81,
      severity: "high",
      status: "pending",
      generatedAt: "2026-05-04T19:48:00Z",
    },
    {
      id: "rec-personalisation-attribution",
      agentId: "attribution-critic",
      kind: "attribution",
      initiativeId: "vr-personalisation",
      title: {
        en: "Re-attribute Personalisation lift — only 38% causal",
        ar: "إعادة إسناد رفع التخصيص — 38% فقط سببيّ" ,
      },
      rationale: {
        en: "Attribution Critic ran a hold-out test against the seasonal control. Of the AED 4.8M run-rate, only AED 1.8M is causally attributable to the agent — the rest is the Ramadan lift.",
        ar: "نفّذ ناقد الإسناد اختبار مجموعة ضابطة. من 4.8 مليون درهم، 1.8 مليون فقط مُسنَدة سببيًا للوكيل — والباقي رفعة رمضان.",
      },
      recommendedAction: { en: "Adjust realised to AED 1.8M and footnote the seasonal share", ar: "تعديل المحقّق إلى 1.8 مليون مع حاشية للرفعة الموسمية" },
      alternateActions: [
        { en: "Keep current AED 4.8M figure", ar: "الإبقاء على رقم 4.8 مليون" },
        { en: "Run a second hold-out next month", ar: "تنفيذ اختبار مجموعة ضابطة الشهر القادم" },
      ],
      confidence: 78,
      severity: "medium",
      status: "pending",
      generatedAt: "2026-05-04T17:30:00Z",
    },
    {
      id: "rec-sama-celebrate",
      agentId: "claim-compiler",
      kind: "celebrate",
      initiativeId: "vr-sama-compliance",
      title: {
        en: "Promote SAMA Compliance as a board success story",
        ar: "ترشيح ساما كقصة نجاح للمجلس" ,
      },
      rationale: {
        en: "AED 7M run-rate against an AED 8.8M promise (80% realisation), 90% confidence, zero open audit findings. Claim Compiler suggests featuring it in Wednesday's board pack.",
        ar: "7 مليون درهم وتيرة مقابل وعد 8.8 (80% تحقّق)، ثقة 90%، صفر ملاحظات تدقيق مفتوحة. يقترح مُجمِّع الادّعاءات إبرازه في حزمة مجلس الأربعاء.",
      },
      recommendedAction: { en: "Add to board one-pager as exemplar", ar: "إضافة إلى صفحة المجلس كنموذج" },
      alternateActions: [
        { en: "Mention only in appendix", ar: "ذكر في الملحق فقط" },
        { en: "Skip — keep board focus on gaps", ar: "تخطّي — إبقاء التركيز على الفجوات" },
      ],
      confidence: 95,
      severity: "info",
      status: "pending",
      generatedAt: "2026-05-04T08:12:00Z",
    },
  ];
}

// ─── Alerts ─────────────────────────────────────────────────────────────

export interface PortfolioAlert {
  id: string;
  severity: "critical" | "high" | "medium" | "info";
  title: BiText;
  detail: BiText;
  initiativeId?: string;
  /** Where clicking the alert should land. */
  navTarget: "portfolio" | "approvals" | "chase" | "audit" | "initiative";
  generatedAt: string;
}

export function generateAlerts(): PortfolioAlert[] {
  return [
    {
      id: "alert-contact-centre",
      severity: "critical",
      title: { en: "Contact Centre 96 days drift", ar: "مركز الاتصال — انجراف 96 يومًا" },
      detail: { en: "Realised AED 6.4M of AED 18.5M promise; 65% gap. Re-baseline draft ready.", ar: "تحقّق 6.4 من 18.5 مليون درهم؛ فجوة 65%. مسوّدة إعادة احتساب جاهزة." },
      initiativeId: "vr-contact-centre",
      navTarget: "initiative",
      generatedAt: "2026-05-05T07:42:00Z",
    },
    {
      id: "alert-procurement",
      severity: "high",
      title: { en: "Procurement Intelligence — scope creep", ar: "ذكاء المشتريات — تمدّد نطاق" },
      detail: { en: "AED 16M short of plan. Attribution Critic blames tail-spend categories.", ar: "نقص 16 مليون درهم. يُرجع ناقد الإسناد ذلك إلى الفئات الذيلية." },
      initiativeId: "vr-procurement-intel",
      navTarget: "approvals",
      generatedAt: "2026-05-04T22:14:00Z",
    },
    {
      id: "alert-hospitality",
      severity: "critical",
      title: { en: "Hospitality Revenue — PDPL block", ar: "إيرادات الضيافة — حصار PDPL" },
      detail: { en: "AED 19.8M parked for 142 days. Escalation queued for CDO.", ar: "19.8 مليون درهم متوقّفة 142 يومًا. تصعيد لرئيسة البيانات." },
      initiativeId: "vr-hospitality-revenue",
      navTarget: "approvals",
      generatedAt: "2026-05-04T23:02:00Z",
    },
    {
      id: "alert-internal-audit",
      severity: "high",
      title: { en: "Internal-Audit Co-pilot stalled", ar: "مساعد التدقيق الداخلي متعثّر" },
      detail: { en: "124 days since pilot launch, zero realised value. Sponsor: CRO.", ar: "124 يومًا منذ إطلاق التجربة، صفر قيمة محقّقة. الراعي: رئيسة المخاطر." },
      initiativeId: "vr-internal-audit",
      navTarget: "chase",
      generatedAt: "2026-05-05T05:11:00Z",
    },
    {
      id: "alert-treasury",
      severity: "medium",
      title: { en: "Treasury Cash claim missing evidence", ar: "نقص أدلّة لادّعاء سيولة الخزينة" },
      detail: { en: "Reported AED 600K, only AED 180K reconciles. Awaiting your decision.", ar: "أُبلغ عن 600 ألف، تُسوّى 180 فقط. بانتظار قرارك." },
      initiativeId: "vr-treasury-cash",
      navTarget: "approvals",
      generatedAt: "2026-05-04T19:48:00Z",
    },
  ];
}

// ─── Activity / chase queue ─────────────────────────────────────────────

export type ChaseStage = "claim" | "evidence" | "attribution" | "rebaseline" | "escalation";

export interface ChaseItem {
  id: string;
  agentId: ConductorAgentId;
  initiativeId: string;
  stage: ChaseStage;
  label: BiText;
  detail: BiText;
  /** ISO timestamp. */
  ts: string;
  status: "running" | "queued" | "done" | "blocked";
}

export function generateChaseQueue(): ChaseItem[] {
  return [
    { id: "ch-1", agentId: "claim-compiler", initiativeId: "vr-contact-centre", stage: "claim", label: { en: "Compile contact-centre claim", ar: "تجميع ادّعاء مركز الاتصال" }, detail: { en: "Pulling AHT, FCR and deflection rate from Genesys + ServiceNow.", ar: "سحب AHT وFCR ومعدل التحويل من Genesys وServiceNow." }, ts: "2026-05-05T01:12:00Z", status: "done" },
    { id: "ch-2", agentId: "evidence-auditor", initiativeId: "vr-contact-centre", stage: "evidence", label: { en: "Audit P&L line for cost-out", ar: "تدقيق سطر الربح والخسارة لتخفيض التكلفة" }, detail: { en: "Reconciled AED 6.4M run-rate against H1 P&L and HR FTE register.", ar: "مطابقة 6.4 مليون درهم على بيانات الربح والخسارة وسجل الموظفين." }, ts: "2026-05-05T02:30:00Z", status: "done" },
    { id: "ch-3", agentId: "attribution-critic", initiativeId: "vr-contact-centre", stage: "attribution", label: { en: "Run hold-out for attribution", ar: "تنفيذ اختبار الإسناد" }, detail: { en: "84% of cost-out attributable to agent; 16% to org redesign in same quarter.", ar: "84% من التخفيض مُسنَد للوكيل؛ 16% لإعادة هيكلة المنظمة." }, ts: "2026-05-05T03:18:00Z", status: "done" },
    { id: "ch-4", agentId: "rebaseline-drafter", initiativeId: "vr-contact-centre", stage: "rebaseline", label: { en: "Draft re-baseline to AED 14M", ar: "صياغة إعادة احتساب إلى 14 مليون درهم" }, detail: { en: "New plan: AED 14M annual run-rate by Q4 with 60% adoption gate.", ar: "خطة جديدة: 14 مليون وتيرة سنوية مع بوابة تبنّي 60% بحلول الربع الرابع." }, ts: "2026-05-05T03:45:00Z", status: "running" },
    { id: "ch-5", agentId: "sponsor-escalator", initiativeId: "vr-hospitality-revenue", stage: "escalation", label: { en: "Draft escalation to CDO", ar: "صياغة تصعيد لرئيسة البيانات" }, detail: { en: "14-day unblocking sprint scope + named owners.", ar: "نطاق سبرنت 14 يومًا + مسؤولون مسمّون." }, ts: "2026-05-05T04:02:00Z", status: "queued" },
    { id: "ch-6", agentId: "claim-compiler", initiativeId: "vr-procurement-intel", stage: "claim", label: { en: "Re-compile procurement claim", ar: "إعادة تجميع ادّعاء المشتريات" }, detail: { en: "Splitting top-3 vs tail-spend so the re-baseline can be defended.", ar: "تقسيم أكبر 3 فئات مقابل الذيلية لتبرير إعادة الاحتساب." }, ts: "2026-05-05T04:58:00Z", status: "running" },
    { id: "ch-7", agentId: "evidence-auditor", initiativeId: "vr-treasury-cash", stage: "evidence", label: { en: "Audit Treasury reconciliation", ar: "تدقيق التسوية للخزينة" }, detail: { en: "Bank statements only support AED 180K of the AED 600K claim.", ar: "كشوف البنك تدعم 180 من 600 ألف درهم." }, ts: "2026-05-04T19:48:00Z", status: "blocked" },
    { id: "ch-8", agentId: "sponsor-escalator", initiativeId: "vr-internal-audit", stage: "escalation", label: { en: "Escalate Internal-Audit pilot to CRO", ar: "تصعيد تجربة التدقيق الداخلي لرئيسة المخاطر" }, detail: { en: "124 days no value. Recommend kill-or-scale decision this week.", ar: "124 يومًا بلا قيمة. يُوصى بقرار إنهاء أو توسيع هذا الأسبوع." }, ts: "2026-05-05T05:11:00Z", status: "queued" },
    { id: "ch-9", agentId: "attribution-critic", initiativeId: "vr-personalisation", stage: "attribution", label: { en: "Re-attribute personalisation lift", ar: "إعادة إسناد رفع التخصيص" }, detail: { en: "Hold-out shows 38% causal share — proposing AED 1.8M run-rate.", ar: "اختبار المجموعة الضابطة يُظهر 38% سببيًا — اقتراح 1.8 مليون وتيرة." }, ts: "2026-05-04T17:30:00Z", status: "done" },
  ];
}

// ─── Audit log ──────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  ts: string;
  agentId: ConductorAgentId | "human";
  actor: BiText;
  action: BiText;
  detail: BiText;
  initiativeId?: string;
}

export function generateAuditLog(): AuditEntry[] {
  // Build from chase + recommendations + a few human actions.
  const chase = generateChaseQueue();
  const recs = generateRecommendations();
  const out: AuditEntry[] = [];
  for (const c of chase) {
    const agent = getConductorAgent(c.agentId);
    out.push({
      id: `aud-${c.id}`,
      ts: c.ts,
      agentId: c.agentId,
      actor: agent?.name ?? { en: c.agentId, ar: c.agentId },
      action: c.label,
      detail: c.detail,
      initiativeId: c.initiativeId,
    });
  }
  for (const r of recs) {
    const agent = getConductorAgent(r.agentId);
    out.push({
      id: `aud-${r.id}`,
      ts: r.generatedAt,
      agentId: r.agentId,
      actor: agent?.name ?? { en: r.agentId, ar: r.agentId },
      action: { en: `Recommendation queued: ${r.title.en}`, ar: `توصية مُدرجة: ${r.title.ar}` },
      detail: r.rationale,
      initiativeId: r.initiativeId,
    });
  }
  out.push({
    id: "aud-human-1",
    ts: "2026-05-05T08:31:00Z",
    agentId: "human",
    actor: { en: "Layla Al-Otaibi", ar: "ليلى العتيبي" },
    action: { en: "Opened CFO Benefits Cockpit", ar: "فتحت قمرة المدير المالي" },
    detail: { en: "Login from BOM-OFFICE — locale en-AE.", ar: "دخول من المكتب الرئيسي — المحلية en-AE." },
  });
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}

// ─── Helpers used by AI chat ────────────────────────────────────────────

export interface PortfolioTotals {
  promised: number;
  realized: number;
  invested: number;
  gap: number;
  gapPct: number;
  atRiskCount: number;
}

export function totals(): PortfolioTotals {
  const promised = INITIATIVES.reduce((s, i) => s + i.promisedAnnual, 0);
  const realized = INITIATIVES.reduce((s, i) => s + i.realizedAnnual, 0);
  const invested = INITIATIVES.reduce((s, i) => s + i.invested, 0);
  const gapV = promised - realized;
  return {
    promised,
    realized,
    invested,
    gap: gapV,
    gapPct: promised > 0 ? Math.round((gapV / promised) * 100) : 0,
    atRiskCount: INITIATIVES.filter((i) => i.stalled || i.driftDays > 90).length,
  };
}

export function topStalled(limit = 5): Initiative[] {
  return [...INITIATIVES]
    .sort((a, b) => {
      // stalled first, then by gap desc.
      if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
      return gap(b) - gap(a);
    })
    .slice(0, limit);
}

export function sponsorBreakdown(): { sponsorId: string; stalledCount: number; gap: number }[] {
  const map = new Map<string, { stalledCount: number; gap: number }>();
  for (const i of INITIATIVES) {
    if (!i.stalled && i.driftDays < 60) continue;
    const prev = map.get(i.sponsorId) ?? { stalledCount: 0, gap: 0 };
    map.set(i.sponsorId, {
      stalledCount: prev.stalledCount + 1,
      gap: prev.gap + gap(i),
    });
  }
  return [...map.entries()]
    .map(([sponsorId, v]) => ({ sponsorId, ...v }))
    .sort((a, b) => b.gap - a.gap);
}

/** Re-export utilities for chat intents convenience. */
export { formatAED, gap, realisationPct };

/** The two scenario checkpoints (re-baseline + sponsor-escalation) — we
 * synthesise the second one because the canonical scenario only has one
 * checkpoint (`cfo-signoff`). The Approvals view renders both above the
 * 5 derived recommendations. */
export interface ScenarioCheckpointCard {
  id: string;
  scenarioCheckpointId?: string;
  agentId: ConductorAgentId;
  initiativeId: string;
  title: BiText;
  question: BiText;
  rationale: BiText;
  options: { id: string; label: BiText; recommended?: boolean }[];
}

export function generateScenarioCheckpointCards(): ScenarioCheckpointCard[] {
  const sc = valueRealizationScenario.checkpoints[0];
  return [
    {
      id: "ckpt-rebaseline-contact-centre",
      scenarioCheckpointId: sc?.id,
      agentId: "rebaseline-drafter",
      initiativeId: "vr-contact-centre",
      title: { en: "Re-baseline AI-Powered Contact Centre", ar: "إعادة احتساب مركز الاتصال المعزّز" },
      question: {
        en: "Approve re-baseline of the Contact Centre to AED 14M annual run-rate (from AED 18.5M)?",
        ar: "هل توافقين على إعادة احتساب مركز الاتصال إلى 14 مليون وتيرة سنوية (من 18.5)؟",
      },
      rationale: {
        en: "Re-baseline Drafter built the case from the audited claim and the 84% causal attribution. New gate: 60% adoption by Q3, AED 14M by Q4. Recommend approve.",
        ar: "بنى كاتب إعادة الاحتساب الحالة من الادّعاء المُدقّق والإسناد السببيّ 84%. بوابة جديدة: تبنّي 60% بحلول الربع الثالث و14 مليون بحلول الرابع. يُوصى بالموافقة.",
      },
      options: [
        { id: "approve", label: { en: "Approve re-baseline", ar: "اعتماد إعادة الاحتساب" }, recommended: true },
        { id: "edit", label: { en: "Edit and re-circulate", ar: "تعديل وإعادة التعميم" } },
        { id: "reject", label: { en: "Reject — keep AED 18.5M", ar: "رفض — الإبقاء على 18.5 مليون" } },
      ],
    },
    {
      id: "ckpt-escalate-hospitality",
      agentId: "sponsor-escalator",
      initiativeId: "vr-hospitality-revenue",
      title: { en: "Escalate Hospitality Revenue to CDO", ar: "تصعيد إيرادات الضيافة لرئيسة البيانات" },
      question: {
        en: "Send the 14-day PDPL unblocking escalation to the CDO?",
        ar: "هل ترسلين تصعيد فكّ حصار PDPL لمدّة 14 يومًا لرئيسة البيانات؟",
      },
      rationale: {
        en: "Sponsor Escalator drafted the escalation memo with named owners and the 14-day SLA. AED 19.8M is parked. Recommend send.",
        ar: "صاغ مُصعّد الراعي مذكّرة التصعيد مع المسؤولين المسمّين ومهلة 14 يومًا. 19.8 مليون متوقّفة. يُوصى بالإرسال.",
      },
      options: [
        { id: "send", label: { en: "Send escalation", ar: "إرسال التصعيد" }, recommended: true },
        { id: "soften", label: { en: "Soften and send", ar: "تخفيف ثم إرسال" } },
        { id: "hold", label: { en: "Hold for one week", ar: "تعليق لأسبوع" } },
      ],
    },
  ];
}

/** Convenience re-export of all sponsors for the chat intents. */
export { SPONSORS };

/** Pure helper used by the What-If view. Returns a forecasted realised AED
 * given a hypothetical adoption % and go-live shift in days. */
export function forecastRealised(initiative: Initiative, adoptionPct: number, goLiveShiftDays: number): number {
  // Realised scales linearly with adoption ratio vs current adoption.
  const adoptionRatio = initiative.adoption > 0 ? adoptionPct / initiative.adoption : adoptionPct / 50;
  // Each 30 days of go-live slip costs 8% of promised value (rough rule-of-thumb).
  const slipPenalty = Math.max(0, 1 - (goLiveShiftDays / 30) * 0.08);
  const projected = initiative.realizedAnnual * adoptionRatio * slipPenalty;
  // Cap at promised; floor at 0.
  return Math.max(0, Math.min(projected, initiative.promisedAnnual));
}

/** Initiatives whose realised data the persona is allowed to see — the
 * audit log uses this to filter rows not visible to the CFO (none in this
 * seed, but the hook is here for honesty). */
export function isVisibleToCfo(_entry: AuditEntry): boolean {
  return true;
}
