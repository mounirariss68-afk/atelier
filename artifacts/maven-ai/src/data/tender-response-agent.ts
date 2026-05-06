// Bid Manager Studio — agent-output generators (recommendations, alerts,
// activity, KPIs). Pure functions over the tender-response seed.

import {
  TENDERS, ACTIVE_TENDER_ID, ACTIVE_QUESTIONS, COMPLIANCE_GATES, AUDIT_LOG,
  tenderProgress, daysUntil, getSme, type BiText, type Tender, type Lang,
} from "./tender-response-seed";

export type Severity = "critical" | "high" | "medium" | "info";

export interface BidRecommendation {
  id: string;
  agentId: "orch" | "ingest" | "qualifier" | "drafter" | "pricing" | "partner" | "legal" | "compiler";
  tenderId: string;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: Severity;
  recommendedAction: BiText;
  alternateActions: BiText[];
  generatedAt: string;
  recordType: "tender" | "answer" | "compliance" | "checkpoint";
  recordId: string;
  checkpointId?: "bid-no-bid" | "pricing-signoff" | "legal-release";
}

export function generateRecommendations(): BidRecommendation[] {
  return [
    {
      id: "rec-bidnobid-edu2",
      agentId: "qualifier",
      tenderId: "RFP-ETM-2026-EDU2",
      title: { en: "Bid on Ministry-of-Education student-services RFP", ar: "تقديم على مناقصة وزارة التعليم" },
      rationale: { en: "Fit-to-win 72%. Capability strong (4 prior ministry deliveries). Pricing headroom 18%. Partner LoS gap manageable.", ar: "جدارة 72%. قدرة قوية. هامش تسعير 18%." },
      confidence: 88,
      severity: "high",
      recommendedAction: { en: "Approve BID. Assign Faisal as solution lead, Laila on past-performance pack.", ar: "اعتماد التقديم. فيصل قائد الحل وليلى لحزمة السوابق." },
      alternateActions: [
        { en: "Bid on Lots 1+2 only (no Lot 3) — protects margin.", ar: "تقديم على الجزء 1+2 فقط — يحفظ الهامش." },
        { en: "No-bid memo — preserve capacity for ARAMCO CYB1.", ar: "مذكّرة انسحاب — توفير القدرة لـ ARAMCO." },
      ],
      generatedAt: "2026-05-04T16:20:00Z",
      recordType: "checkpoint", recordId: "RFP-ETM-2026-EDU2", checkpointId: "bid-no-bid",
    },
    {
      id: "rec-pricing-adnoc",
      agentId: "pricing",
      tenderId: "RFP-ADNOC-2026-DT4",
      title: { en: "Approve base SAR 88.5M for ADNOC DT-4", ar: "اعتماد الأساس 88.5M لـ ADNOC DT-4" },
      rationale: { en: "Base scenario margin 12.4% — comfortable above floor. Win prob 51% vs 28% for floor.", ar: "هامش الأساس 12.4% فوق الحدّ. احتمال 51% مقابل 28% للحدّ." },
      confidence: 91,
      severity: "high",
      recommendedAction: { en: "Approve base SAR 88.5M. Schedule CFO sign-off Tue 14:00.", ar: "اعتماد الأساس 88.5M. اجتماع المدير المالي الثلاثاء." },
      alternateActions: [
        { en: "Approve aggressive SAR 84M — boosts win prob to 67% but margin drops to 9.1%.", ar: "اعتماد الطموح 84M — احتمال 67% وهامش 9.1%." },
        { en: "Approve floor SAR 95M — protects 15.0% margin.", ar: "اعتماد الحدّ 95M — يحمي 15%." },
      ],
      generatedAt: "2026-05-04T11:45:00Z",
      recordType: "checkpoint", recordId: "RFP-ADNOC-2026-DT4", checkpointId: "pricing-signoff",
    },
    {
      id: "rec-legal-stc",
      agentId: "legal",
      tenderId: "RFP-STC-2026-NW7",
      title: { en: "Release stc NW-7 packet — 1 indemnity flag resolved", ar: "إفراج حزمة stc NW-7" },
      rationale: { en: "Library position 4.2c (capped indemnity) applied. No outstanding flags. Drafter accepted change.", ar: "طُبّق موقع 4.2ج. لا تنبيهات." },
      confidence: 95,
      severity: "high",
      recommendedAction: { en: "Release for upload. Schedule Etimad upload Sun 10:00.", ar: "إفراج للرفع. الرفع الأحد 10:00." },
      alternateActions: [
        { en: "Hold for second-pair-of-eyes review on 6.2 SLA cap.", ar: "تأجيل لمراجعة ثانية لـ 6.2 SLA." },
      ],
      generatedAt: "2026-05-04T15:10:00Z",
      recordType: "checkpoint", recordId: "RFP-STC-2026-NW7", checkpointId: "legal-release",
    },
    {
      id: "rec-partner-escalate",
      agentId: "partner",
      tenderId: ACTIVE_TENDER_ID,
      title: { en: "Escalate to alternative sovereign-cloud partner", ar: "تصعيد إلى بديل شريك السحابة السيادية" },
      rationale: { en: "Partner C silent at D+3. Alternative vendor pre-qualified, signed MNDA last quarter.", ar: "الشريك ج صامت في اليوم 3. البديل مؤهّل سابقاً." },
      confidence: 84,
      severity: "critical",
      recommendedAction: { en: "Send draft LoS request to alternative vendor today; copy account exec.", ar: "إرسال طلب رسالة دعم اليوم." },
      alternateActions: [
        { en: "Wait 24h — Partner C historically responds late.", ar: "انتظر 24 ساعة — الشريك ج يتأخّر عادة." },
        { en: "Drop to no-bid on Lot 3 — preserves capacity.", ar: "انسحاب من الجزء 3." },
      ],
      generatedAt: "2026-05-05T07:55:00Z",
      recordType: "tender", recordId: ACTIVE_TENDER_ID,
    },
    {
      id: "rec-conflict",
      agentId: "drafter",
      tenderId: ACTIVE_TENDER_ID,
      title: { en: "Reconcile vendor footprint conflict (S3 §4.2 vs S5 §1.1)", ar: "حلّ تعارض ادعاء البصمة" },
      rationale: { en: "S3 claims 14 in-Kingdom data centres; S5 references 12. Latest LCA data shows 14 — recommend updating S5.", ar: "S3 يدّعي 14؛ S5 يذكر 12. البيانات الأحدث 14." },
      confidence: 89,
      severity: "high",
      recommendedAction: { en: "Update S5 §1.1 to match S3 §4.2 (14 facilities). Re-run conflict pass.", ar: "تحديث S5 §1.1 إلى 14." },
      alternateActions: [
        { en: "Conservative 12 across both — lower local-content score.", ar: "12 في القسمين — درجة محتوى أدنى." },
      ],
      generatedAt: "2026-05-05T08:42:00Z",
      recordType: "answer", recordId: "Q-09",
    },
    {
      id: "rec-nobid-muni",
      agentId: "qualifier",
      tenderId: "RFP-MUNI-RIY-2026-WT1",
      title: { en: "Defensible NO-BID on Riyadh smart-waste IoT", ar: "انسحاب مبرّر — نفايات الرياض" },
      rationale: { en: "Fit-to-win 58%. Past performance gap on municipal IoT. Pricing floor breached at SAR 28M.", ar: "جدارة 58%. نقص في السوابق وكسر حدّ التسعير." },
      confidence: 92,
      severity: "medium",
      recommendedAction: { en: "Generate no-bid memo with rationale; preserve relationship with Amana.", ar: "مذكّرة انسحاب مع التبرير." },
      alternateActions: [
        { en: "Bid as junior partner under another integrator.", ar: "تقديم كشريك صغير." },
      ],
      generatedAt: "2026-05-04T18:00:00Z",
      recordType: "checkpoint", recordId: "RFP-MUNI-RIY-2026-WT1", checkpointId: "bid-no-bid",
    },
    {
      id: "rec-compile-aramco",
      agentId: "compiler",
      tenderId: "RFP-ARAMCO-2026-CYB1",
      title: { en: "Begin final compile for ARAMCO CYB-1 (248 pages)", ar: "بدء التجميع النهائي ARAMCO CYB-1" },
      rationale: { en: "52 of 54 answers SME-approved. Final 2 awaiting GC sign-off. Submission D-4.", ar: "52 من 54 معتمدة. تقديم D-4." },
      confidence: 90,
      severity: "info",
      recommendedAction: { en: "Stitch packet today; reserve Friday for portal upload rehearsal.", ar: "تجميع اليوم؛ تجربة الرفع الجمعة." },
      alternateActions: [],
      generatedAt: "2026-05-05T06:30:00Z",
      recordType: "tender", recordId: "RFP-ARAMCO-2026-CYB1",
    },
  ];
}

// ─── Alerts (notifications panel) ──────────────────────────────────────

export interface BidAlert {
  id: string;
  severity: "critical" | "high" | "medium";
  title: BiText;
  detail: BiText;
  timestamp: string;
  tenderId: string;
  view: "pipeline" | "tender" | "approvals" | "compliance" | "library" | "audit";
}

export function generateAlerts(): BidAlert[] {
  return [
    { id: "al-001", severity: "critical", title: { en: "Partner C silent on Etimad LOT-3 (D+3)", ar: "الشريك ج صامت — اعتماد LOT-3" }, detail: { en: "3rd LoS still missing — escalation drafted to alternative vendor.", ar: "رسالة الشريك الثالث مفقودة." }, timestamp: "2026-05-05T07:55:00Z", tenderId: ACTIVE_TENDER_ID, view: "tender" },
    { id: "al-002", severity: "critical", title: { en: "Pricing floor at risk on Etimad LOT-3", ar: "حدّ التسعير معرّض للخطر — اعتماد" }, detail: { en: "Base scenario margin 11.2% — only 1.2 pts above floor.", ar: "هامش 11.2% — 1.2 نقطة فوق الحدّ." }, timestamp: "2026-05-05T07:30:00Z", tenderId: ACTIVE_TENDER_ID, view: "compliance" },
    { id: "al-003", severity: "high", title: { en: "Cross-section conflict in S3 vs S5", ar: "تعارض S3 و S5" }, detail: { en: "Footprint claim 14 vs 12 — Drafter flagged for human reconciliation.", ar: "ادعاء البصمة 14 مقابل 12." }, timestamp: "2026-05-05T08:42:00Z", tenderId: ACTIVE_TENDER_ID, view: "tender" },
    { id: "al-004", severity: "high", title: { en: "ADNOC DT-4 awaiting CFO sign-off", ar: "ADNOC ينتظر اعتماد المدير المالي" }, detail: { en: "Pricing scenarios published — CFO sign-off scheduled Tue 14:00.", ar: "اجتماع الثلاثاء." }, timestamp: "2026-05-04T18:30:00Z", tenderId: "RFP-ADNOC-2026-DT4", view: "approvals" },
    { id: "al-005", severity: "high", title: { en: "stc NW-7 awaiting Legal release", ar: "stc NW-7 ينتظر الإفراج القانوني" }, detail: { en: "Indemnity 4.2 resolved; GC release pending.", ar: "حُلّ بند 4.2." }, timestamp: "2026-05-04T15:10:00Z", tenderId: "RFP-STC-2026-NW7", view: "approvals" },
    { id: "al-006", severity: "medium", title: { en: "Riyadh smart-waste — no-bid memo ready", ar: "النفايات الذكية — مذكّرة الانسحاب جاهزة" }, detail: { en: "Defensible no-bid drafted; preserve Amana relationship.", ar: "مذكّرة انسحاب مسوّدة." }, timestamp: "2026-05-04T18:00:00Z", tenderId: "RFP-MUNI-RIY-2026-WT1", view: "approvals" },
  ];
}

// ─── KPI tiles ─────────────────────────────────────────────────────────

export interface KpiTile {
  id: string;
  label: BiText;
  value: string;
  delta: BiText;
  trend: "up" | "down" | "flat";
}

export function generateKpis(_lang: Lang = "en"): KpiTile[] {
  const active = TENDERS.filter((t) => t.stage !== "submitted").length;
  const totalValue = TENDERS.filter((t) => t.stage !== "submitted").reduce((s, t) => s + t.totalValueSAR, 0);
  return [
    { id: "active", label: { en: "Active tenders", ar: "المناقصات النشطة" }, value: `${active}`, delta: { en: "+2 vs Apr", ar: "+2 مقابل أبريل" }, trend: "up" },
    { id: "value", label: { en: "Pipeline value", ar: "قيمة المسار" }, value: `SAR ${(totalValue / 1_000_000).toFixed(0)}M`, delta: { en: "+18% vs Apr", ar: "+18% مقابل أبريل" }, trend: "up" },
    { id: "win", label: { en: "Win rate (rolling 12)", ar: "معدّل الفوز (12 شهراً)" }, value: "31%", delta: { en: "+9 pts", ar: "+9 نقاط" }, trend: "up" },
    { id: "cycle", label: { en: "RFP-to-submit cycle", ar: "زمن الاستلام إلى التقديم" }, value: "12 days", delta: { en: "−2 days vs budget", ar: "−2 يوم" }, trend: "up" },
    { id: "nobid", label: { en: "Defensible no-bid rate", ar: "معدّل الانسحاب المبرّر" }, value: "35%", delta: { en: "+10 pts", ar: "+10 نقاط" }, trend: "up" },
  ];
}

// ─── Deadline rail (sorted) ────────────────────────────────────────────

export function deadlineRail() {
  return [...TENDERS]
    .filter((t) => t.stage !== "submitted")
    .map((t) => ({ ...t, days: daysUntil(t.dueAt), progress: tenderProgress(t) }))
    .sort((a, b) => a.days - b.days);
}

// ─── Quick stats for top of pipeline ──────────────────────────────────

export function pipelineStats() {
  const active = TENDERS.filter((t) => t.stage !== "submitted");
  const atRisk = active.filter((t) => t.health === "at-risk" || t.health === "blocked").length;
  const onTrack = active.filter((t) => t.health === "on-track").length;
  const won = TENDERS.filter((t) => t.health === "won").length;
  const totalAnswers = active.reduce((s, t) => s + t.questionsTotal, 0);
  const draftedAnswers = active.reduce((s, t) => s + t.questionsDrafted, 0);
  const pendingApprovals = generateRecommendations().length;
  const losPending = active.reduce((s, t) => s + (t.partnerLosRequired - t.partnerLosReceived), 0);
  return { active: active.length, atRisk, onTrack, won, totalAnswers, draftedAnswers, pendingApprovals, losPending };
}

export { COMPLIANCE_GATES, AUDIT_LOG };
