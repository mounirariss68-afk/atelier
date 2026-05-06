import type { BiText } from "@/lib/sim/types";
import knowledgeScenario from "@/lib/sim/scenarios/enterprise-knowledge-concierge";
import { PERSONAS, SOURCES, visibleSourcesFor, type PersonaId, type Source } from "./enterprise-knowledge-seed";

export type Severity = "critical" | "high" | "medium" | "info";
export type RecStatus = "pending" | "approved" | "rejected" | "edited";

export type AgentId = "orch" | "perm" | "ret" | "draft" | "audit" | "conf";

export interface ConsoleAgent {
  id: AgentId;
  name: BiText;
  role: BiText;
  color: string;
}

// Mirror the scenario agents so chat badges are consistent with the cockpit.
export const CONSOLE_AGENTS: ConsoleAgent[] = knowledgeScenario.agents.map((a) => ({
  id: a.id as AgentId,
  name: a.name,
  role: a.role,
  color: a.color ?? "#5C8CA8",
}));

export function agentById(id: AgentId): ConsoleAgent | undefined {
  return CONSOLE_AGENTS.find((a) => a.id === id);
}

export interface AgentRecommendation {
  id: string;
  agentId: AgentId;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: Severity;
  recommendedAction: BiText;
  alternateActions: BiText[];
  status: RecStatus;
  generatedAt: string;
  isCheckpoint?: boolean;
  checkpointHuman?: BiText;
  /** When the rec maps to a scenario checkpoint, store the id to wire approve/edit/reject. */
  checkpointId?: string;
}

export interface AgentAlert {
  id: string;
  agentId: AgentId;
  severity: Severity;
  title: BiText;
  detail: BiText;
  receivedAt: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  personaId: PersonaId;
  question: BiText;
  visibleCount: number;
  citedCount: number;
  withheldCount: number;
  confidence: number | null;
  action: "answered" | "refused" | "escalated";
}

const NOW = new Date("2026-05-05T11:08:00Z");
const isoMinutesAgo = (m: number) => {
  const d = new Date(NOW);
  d.setMinutes(d.getMinutes() - m);
  return d.toISOString();
};
const isoHoursAgo = (h: number) => {
  const d = new Date(NOW);
  d.setHours(d.getHours() - h);
  return d.toISOString();
};

// ─── Recommendations ────────────────────────────────────────────────────

export function generateRecommendations(): AgentRecommendation[] {
  const cp = knowledgeScenario.checkpoints[0];
  return [
    {
      id: "rec-cp-compliance-withhold",
      agentId: "orch",
      title: { en: "Approve persona-aware reply + book re-classification review", ar: "موافقة على الردّ + حجز مراجعة التصنيف" },
      rationale: cp.rationale,
      confidence: 96,
      severity: "high",
      recommendedAction: cp.options[0].label,
      alternateActions: [cp.options[1].label, cp.options[2].label],
      status: "pending",
      generatedAt: isoMinutesAgo(8),
      isCheckpoint: true,
      checkpointHuman: cp.human,
      checkpointId: cp.id,
    },
    {
      id: "rec-d-001",
      agentId: "perm",
      title: { en: "Re-classify 3 Treasury sources from Confidential → Internal", ar: "إعادة تصنيف 3 مصادر خزينة من سرّي → داخلي" },
      rationale: {
        en: "Permission Filter logged 17 hidden-but-relevant matches against the same 3 Treasury notes. Re-classifying widens visibility to FP&A without breaching policy.",
        ar: "سجّل فلتر الصلاحيات 17 تطابقاً مخفيّاً ضد 3 ملاحظات للخزينة. إعادة التصنيف توسّع الرؤية للتخطيط دون انتهاك السياسة.",
      },
      confidence: 88, severity: "medium",
      recommendedAction: { en: "Approve re-classification", ar: "موافقة على إعادة التصنيف" },
      alternateActions: [{ en: "Defer to next steward review", ar: "تأجيل لمراجعة الحارس القادمة" }],
      status: "pending", generatedAt: isoHoursAgo(3),
    },
    {
      id: "rec-d-002",
      agentId: "audit",
      title: { en: "Mark 4 sources stale — last update > 180 days", ar: "تعليم 4 مصادر قديمة — آخر تحديث > 180 يوماً" },
      rationale: {
        en: "Citation Auditor flagged 4 sources that still appear in answers but have not been updated in 6+ months. Recommend asking owners to refresh.",
        ar: "رصد مدقّق الاستشهاد 4 مصادر تظهر في الإجابات دون تحديث لأكثر من 6 أشهر. يُوصى بطلب تحديث.",
      },
      confidence: 92, severity: "medium",
      recommendedAction: { en: "Notify owners + flag in source library", ar: "إشعار المالكين + تعليم المكتبة" },
      alternateActions: [{ en: "Suppress from answers until refreshed", ar: "إخفاء من الإجابات حتى التحديث" }],
      status: "pending", generatedAt: isoHoursAgo(6),
    },
    {
      id: "rec-d-003",
      agentId: "conf",
      title: { en: "Raise refusal threshold from 80% → 85% for Legal queries", ar: "رفع عتبة الرفض من 80% إلى 85% للأسئلة القانونيّة" },
      rationale: {
        en: "Confidence Scorer found 6 borderline answers (80-84%) on legal-adjacent questions in the last 30 days. Tightening the threshold is safer than retraining.",
        ar: "وجد مصنّف الثقة 6 إجابات حدّية (80-84%) على أسئلة قانونيّة. تشديد العتبة أأمن من إعادة التدريب.",
      },
      confidence: 79, severity: "info",
      recommendedAction: { en: "Apply new threshold for legal-tagged questions", ar: "تطبيق العتبة الجديدة للأسئلة المُعلَّمة قانونيّاً" },
      alternateActions: [{ en: "Keep at 80% and monitor", ar: "إبقاء 80% مع المراقبة" }],
      status: "approved", generatedAt: isoHoursAgo(20),
    },
  ];
}

// ─── Alerts ──────────────────────────────────────────────────────────────

export function generateAlerts(): AgentAlert[] {
  return [
    {
      id: "a1", agentId: "perm", severity: "high",
      title: { en: "2 sources withheld on the EGP question", ar: "حجب مصدرين في سؤال الجنيه" },
      detail: { en: "Permission Filter hid 2 legal-privileged sources from the CFO's view. Compliance review pending.", ar: "أخفى الفلتر مصدرَين قانونيَّين عن المدير المالي. مراجعة الامتثال معلّقة." },
      receivedAt: isoMinutesAgo(8),
    },
    {
      id: "a2", agentId: "audit", severity: "medium",
      title: { en: "4 cited sources are >180 days old", ar: "4 مصادر مستشهَد بها أقدم من 180 يوماً" },
      detail: { en: "Citation Auditor recommends asking owners to refresh.", ar: "يوصي المدقّق بطلب تحديث المصادر." },
      receivedAt: isoHoursAgo(6),
    },
    {
      id: "a3", agentId: "conf", severity: "info",
      title: { en: "Refusal rate steady at 7% (junior persona)", ar: "معدّل الرفض ثابت 7% (الشخصية المبتدئة)" },
      detail: { en: "Within the policy band; no action required.", ar: "ضمن النطاق؛ لا إجراء مطلوب." },
      receivedAt: isoHoursAgo(20),
    },
    {
      id: "a4", agentId: "perm", severity: "critical",
      title: { en: "External consultant attempted Treasury query", ar: "حاول استشاري خارجي الوصول لاستعلام خزينة" },
      detail: { en: "Permission Filter blocked and escalated. No leak.", ar: "الفلتر منع وصعّد. لا تسريب." },
      receivedAt: isoHoursAgo(2),
    },
  ];
}

// ─── Audit log ───────────────────────────────────────────────────────────

export function generateAuditLog(): AuditEntry[] {
  return [
    {
      id: "Q-2026-114", ts: isoMinutesAgo(8), personaId: "cfo",
      question: { en: "What is our exposure to the EGP move on receivables?", ar: "ما تعرّضنا للجنيه على الذمم؟" },
      visibleCount: 22, citedCount: 5, withheldCount: 2, confidence: 84, action: "answered",
    },
    {
      id: "Q-2026-113", ts: isoMinutesAgo(45), personaId: "junior",
      question: { en: "Same EGP exposure question (re-run as Junior Analyst)", ar: "إعادة سؤال الجنيه كمحلّل مبتدئ" },
      visibleCount: 8, citedCount: 0, withheldCount: 6, confidence: null, action: "refused",
    },
    {
      id: "Q-2026-112", ts: isoHoursAgo(2), personaId: "treasury",
      question: { en: "Are we within hedging policy on EGP?", ar: "هل نحن ضمن سياسة التحوّط للجنيه؟" },
      visibleCount: 14, citedCount: 4, withheldCount: 1, confidence: 89, action: "answered",
    },
    {
      id: "Q-2026-111", ts: isoHoursAgo(3), personaId: "legal",
      question: { en: "Status of the Cairo Metro arbitration prep", ar: "حالة تحضير تحكيم مترو القاهرة" },
      visibleCount: 24, citedCount: 3, withheldCount: 0, confidence: 91, action: "answered",
    },
    {
      id: "Q-2026-110", ts: isoHoursAgo(4), personaId: "consultant",
      question: { en: "Egypt receivables breakdown", ar: "تفصيل ذمم مصر" },
      visibleCount: 4, citedCount: 0, withheldCount: 8, confidence: null, action: "refused",
    },
    {
      id: "Q-2026-109", ts: isoHoursAgo(6), personaId: "cfo",
      question: { en: "Q1 IFRS-9 ECL movement", ar: "حركة IFRS-9 للربع الأول" },
      visibleCount: 22, citedCount: 4, withheldCount: 0, confidence: 93, action: "answered",
    },
    {
      id: "Q-2026-108", ts: isoHoursAgo(8), personaId: "junior",
      question: { en: "Where do I find the AR ageing report?", ar: "أين تقرير تقادم الذمم؟" },
      visibleCount: 8, citedCount: 1, withheldCount: 0, confidence: 81, action: "answered",
    },
    {
      id: "Q-2026-107", ts: isoHoursAgo(10), personaId: "treasury",
      question: { en: "Trapped cash in Egypt — current?", ar: "نقد محتجز في مصر — حالياً؟" },
      visibleCount: 14, citedCount: 2, withheldCount: 0, confidence: 95, action: "answered",
    },
    {
      id: "Q-2026-106", ts: isoHoursAgo(20), personaId: "junior",
      question: { en: "Forward me Treasury weekly note", ar: "أرسل لي ملخّص الخزينة الأسبوعي" },
      visibleCount: 8, citedCount: 0, withheldCount: 1, confidence: null, action: "escalated",
    },
  ];
}

// ─── Knowledge ops summaries ─────────────────────────────────────────────

export function topQuestions() {
  return [
    { en: "EGP exposure on receivables", ar: "تعرّض الجنيه على الذمم", count: 11 },
    { en: "AR ageing — Egypt B2G", ar: "تقادم الذمم — الفرع المصري", count: 8 },
    { en: "Hedging policy compliance", ar: "الامتثال لسياسة التحوّط", count: 7 },
    { en: "IFRS-9 ECL movement Q1", ar: "حركة IFRS-9 للربع 1", count: 5 },
    { en: "Trapped cash by country", ar: "النقد المحتجز حسب الدولة", count: 4 },
  ];
}

export function refusalRateByPersona(): { personaId: PersonaId; rate: number }[] {
  return [
    { personaId: "cfo", rate: 0 },
    { personaId: "treasury", rate: 4 },
    { personaId: "legal", rate: 2 },
    { personaId: "junior", rate: 28 },
    { personaId: "consultant", rate: 41 },
  ];
}

export function topCitedSources(): { id: string; citations: number }[] {
  return [
    { id: "treasury-weekly-2026-04-28", citations: 38 },
    { id: "fx-hedging-policy-v3", citations: 27 },
    { id: "ar-ageing-april-2026", citations: 24 },
    { id: "ifrs9-ecl-run-q1-2026", citations: 19 },
    { id: "egp-exposure-ledger-q1", citations: 16 },
    { id: "treasury-runbook-egp", citations: 12 },
  ];
}

export function staleSources(): { id: string; daysOld: number }[] {
  const today = new Date("2026-05-05");
  return SOURCES.filter((s) => {
    const ageMs = today.getTime() - new Date(s.updatedAt).getTime();
    const days = Math.round(ageMs / (1000 * 60 * 60 * 24));
    return days >= 180;
  })
    .map((s) => {
      const ageMs = today.getTime() - new Date(s.updatedAt).getTime();
      return { id: s.id, daysOld: Math.round(ageMs / (1000 * 60 * 60 * 24)) };
    })
    .sort((a, b) => b.daysOld - a.daysOld);
}

// ─── KPIs ────────────────────────────────────────────────────────────────

export function kpiVisibleCount(personaId: PersonaId): number {
  return visibleSourcesFor(personaId).length;
}

export function kpiTotalSources(): number {
  return SOURCES.length;
}

export function withheldFor(personaId: PersonaId, sourceIds: string[]): Source[] {
  const persona = PERSONAS.find((p) => p.id === personaId)!;
  return sourceIds
    .map((id) => SOURCES.find((s) => s.id === id))
    .filter((s): s is Source => !!s)
    .filter((s) => !s.aclGroups.some((g) => persona.aclGroups.includes(g)));
}
