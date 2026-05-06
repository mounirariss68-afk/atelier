// SAMA Compliance Sentinel — agent-derived recommendations and alerts.
// Pulls from the seed + scenario file and produces user-facing surface
// shapes for the CRO console.

import type { BiText } from "./sama-compliance-seed";
import samaScenario from "@/lib/sim/scenarios/sama-compliance-sentinel";

export type Severity = "critical" | "high" | "medium" | "info";

export interface AgentRecommendation {
  id: string;
  agentId: string;
  agentName: BiText;
  agentColor: string;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: Severity;
  recordType: "obligation" | "control" | "circular" | "return" | "evidence";
  recordId: string;
  recommendedAction: BiText;
  alternateActions: BiText[];
  generatedAt: string;
  checkpointId?: string;
}

export interface ConsoleAlert {
  id: string;
  severity: Severity;
  title: BiText;
  detail: BiText;
  href?: { view: string; id?: string };
  timestamp: string;
}

function agentMeta(id: string) {
  const a = samaScenario.agents.find((x) => x.id === id);
  return {
    name: a?.name ?? { en: id, ar: id },
    color: a?.color ?? "#0E2841",
  };
}

export function generateRecommendations(): AgentRecommendation[] {
  const out: AgentRecommendation[] = [];

  // 1-3: scenario checkpoints surfaced as recommendations
  for (const cp of samaScenario.checkpoints) {
    const rec = cp.options.find((o) => o.recommended) ?? cp.options[0];
    const others = cp.options.filter((o) => o !== rec).map((o) => o.label);
    out.push({
      id: `rec-${cp.id}`,
      agentId: "orch",
      agentName: agentMeta("orch").name,
      agentColor: agentMeta("orch").color,
      title: cp.question,
      rationale: cp.rationale,
      confidence: 96,
      severity: "critical",
      recordType: "circular",
      recordId: "CRU-2026-04",
      recommendedAction: rec.label,
      alternateActions: others,
      generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      checkpointId: cp.id,
    });
  }

  // 4: control changes (3 from CRU-2026-04)
  out.push({
    id: "rec-cr-014",
    agentId: "policy",
    agentName: agentMeta("policy").name,
    agentColor: agentMeta("policy").color,
    title: { en: "Approve CR-014 cadence change (quarterly → monthly)", ar: "اعتماد تغيير CR-014 (ربعي → شهري)" },
    rationale: {
      en: "CRU-2026-04 §4.1 requires monthly privileged-access review. Drafted change auto-tightens cadence; rollback risk low — Identity team confirms capacity.",
      ar: "تتطلب الفقرة §4.1 من CRU-2026-04 مراجعة شهرية للصلاحيات. التغيير يضبط التواتر تلقائياً؛ مخاطر التراجع منخفضة.",
    },
    confidence: 94,
    severity: "high",
    recordType: "control",
    recordId: "CR-014",
    recommendedAction: { en: "Approve cadence change", ar: "اعتماد التغيير" },
    alternateActions: [{ en: "Defer one cycle", ar: "تأجيل دورة واحدة" }],
    generatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  });
  out.push({
    id: "rec-cr-027",
    agentId: "policy",
    agentName: agentMeta("policy").name,
    agentColor: agentMeta("policy").color,
    title: { en: "Approve CR-027 SaaS auto-discovery + weekly attestation", ar: "اعتماد CR-027: اكتشاف SaaS + إقرار أسبوعي" },
    rationale: {
      en: "Sets up auto-discovery scanner for SaaS connectors and converts manual quarterly attestation to weekly. CISO Office is the new owner; tooling already in pilot.",
      ar: "يضبط ماسحاً للاكتشاف الآلي ويحوّل الإقرار اليدوي الربعي إلى أسبوعي. الأداة قيد التجربة.",
    },
    confidence: 91,
    severity: "high",
    recordType: "control",
    recordId: "CR-027",
    recommendedAction: { en: "Approve change", ar: "اعتماد التغيير" },
    alternateActions: [{ en: "Approve attestation only; defer auto-discovery", ar: "اعتماد الإقرار فقط وتأجيل الاكتشاف" }],
    generatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  });
  out.push({
    id: "rec-cr-082",
    agentId: "policy",
    agentName: agentMeta("policy").name,
    agentColor: agentMeta("policy").color,
    title: { en: "Approve CR-082 attestation interval 180d → 90d", ar: "اعتماد CR-082: الإقرار 180 → 90 يوماً" },
    rationale: {
      en: "Required by CRU-2026-04 §4.3. HR Tech confirms identity-store can support tighter cycles.",
      ar: "وفق الفقرة §4.3 من CRU-2026-04. تقنية الموارد تؤكّد الجاهزية.",
    },
    confidence: 93,
    severity: "high",
    recordType: "control",
    recordId: "CR-082",
    recommendedAction: { en: "Approve interval", ar: "اعتماد التواتر" },
    alternateActions: [{ en: "Approve 120d compromise", ar: "تسوية عند 120 يوماً" }],
    generatedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  });

  // 5: QFR Section 4 sign-off
  out.push({
    id: "rec-qfr-sec4",
    agentId: "memo",
    agentName: agentMeta("memo").name,
    agentColor: agentMeta("memo").color,
    title: { en: "Sign Section 4 of QFR-2026-Q2 (Capital Adequacy)", ar: "توقيع القسم 4 من QFR-2026-Q2" },
    rationale: {
      en: "Drafted commentary aligns with the latest CCR figures. Suggested edit: tighten paragraph 3 on counter-cyclical buffer activation.",
      ar: "السرد يتوافق مع أحدث الأرقام. تعديل مقترح: تشديد الفقرة 3 حول تفعيل احتياطي مكافحة التقلبات.",
    },
    confidence: 88,
    severity: "high",
    recordType: "return",
    recordId: "QFR-2026-Q2",
    recommendedAction: { en: "Apply edit & sign", ar: "تطبيق التعديل والتوقيع" },
    alternateActions: [
      { en: "Sign as drafted", ar: "توقيع كما هو" },
      { en: "Send back to Drafter", ar: "إعادة للكاتب" },
    ],
    generatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  });

  // 6: AML threshold tweak
  out.push({
    id: "rec-aml-thr",
    agentId: "monitor",
    agentName: agentMeta("monitor").name,
    agentColor: agentMeta("monitor").color,
    title: { en: "Tighten AML-MTR threshold (corporate wires SAR 250K → 200K)", ar: "تشديد حدّ AML-MTR (الحوالات الشركات: 250 → 200 ألف ر.س)" },
    rationale: {
      en: "False-negative rate has trended up over the last 6 weeks. Tightening retains 96% precision while lifting recall by 4pp.",
      ar: "ارتفاع معدل السلبيات الكاذبة خلال 6 أسابيع. التشديد يرفع الاسترداد 4 نقاط مع إبقاء الدقّة 96%.",
    },
    confidence: 81,
    severity: "medium",
    recordType: "control",
    recordId: "CR-018",
    recommendedAction: { en: "Approve threshold", ar: "اعتماد الحدّ" },
    alternateActions: [{ en: "A/B test 1 week", ar: "اختبار A/B لأسبوع" }],
    generatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  });

  // 7: PDPL cross-border attestation kickoff
  out.push({
    id: "rec-pdpl-cbt",
    agentId: "memo",
    agentName: agentMeta("memo").name,
    agentColor: agentMeta("memo").color,
    title: { en: "Start PDPL cross-border attestation drafting (Q2)", ar: "بدء صياغة إقرار النقل عبر الحدود (Q2)" },
    rationale: {
      en: "Effective 2026-07-01; current readiness 12%. Recommend kicking off with vendor list refresh now to avoid Q2 crunch.",
      ar: "السريان 2026-07-01؛ الجاهزية الحالية 12%. يُوصى بالبدء بتحديث قائمة الموردين فوراً.",
    },
    confidence: 84,
    severity: "medium",
    recordType: "return",
    recordId: "PDPL-CBT-2026-Q2",
    recommendedAction: { en: "Kick off drafting", ar: "بدء الصياغة" },
    alternateActions: [{ en: "Wait 2 weeks", ar: "تأجيل أسبوعين" }],
    generatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  });

  return out;
}

export function generateAlerts(): ConsoleAlert[] {
  return [
    {
      id: "al-001",
      severity: "critical",
      title: { en: "CRU-2026-04 ingested overnight", ar: "تمّ استلام CRU-2026-04 ليلاً" },
      detail: { en: "14 obligations + 3 control changes drafted. CRO sign-off required.", ar: "14 التزاماً و3 تغييرات ضوابط مسوّدة. يتطلب اعتماد المدير." },
      href: { view: "approvals" },
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
    {
      id: "al-002",
      severity: "critical",
      title: { en: "3 controls newly degraded", ar: "تدهور 3 ضوابط جديدة" },
      detail: { en: "CR-014, CR-027, CR-082 flipped Red after CRU-2026-04 mapping.", ar: "تحوّل CR-014 و CR-027 و CR-082 إلى الأحمر." },
      href: { view: "controls" },
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    },
    {
      id: "al-003",
      severity: "high",
      title: { en: "AML-MTR April return ready", ar: "تقرير AML-MTR لأبريل جاهز" },
      detail: { en: "Agent readiness 96%. Due in 8 days.", ar: "جاهزية الوكيل 96%. الموعد بعد 8 أيام." },
      href: { view: "returns" },
      timestamp: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    },
    {
      id: "al-004",
      severity: "high",
      title: { en: "QFR-2026-Q2 Section 4 awaits sign-off", ar: "القسم 4 من QFR-2026-Q2 بانتظار التوقيع" },
      detail: { en: "Capital Adequacy commentary drafted. Suggested 1-paragraph edit.", ar: "السرد مسوّد. تعديل مقترح من فقرة واحدة." },
      href: { view: "approvals" },
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "al-005",
      severity: "medium",
      title: { en: "PDPL-2026-02 cross-border returns due in 35 days", ar: "إقرارات PDPL-2026-02 مستحقّة بعد 35 يوماً" },
      detail: { en: "Drafting not yet started. Vendor list refresh recommended.", ar: "لم تبدأ الصياغة. يُوصى بتحديث قائمة الموردين." },
      href: { view: "returns" },
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    },
  ];
}
