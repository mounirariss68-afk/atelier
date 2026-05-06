// Citizen Services Concierge — derives recommendations, alerts, KPIs from
// the seed. Pure functions, used by chat intents and recommendation cards.

import {
  ACTIVE_CASES, RESOLVED_CASES, OFFICER, MINISTRIES, REGIONS, SERVICES,
  type Case, type BiText,
} from "./citizen-services-seed";

export interface AgentRecommendation {
  id: string;
  agentId: string;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: "critical" | "high" | "medium" | "info";
  recordType: "case";
  recordId: string;
  recommendedAction: BiText;
  alternateActions: BiText[];
  generatedAt: string;
}

export interface CscAlert {
  id: string;
  severity: "critical" | "high" | "medium";
  title: BiText;
  sub: BiText;
  caseId?: string;
  at: string;
}

export function getRecommendations(): AgentRecommendation[] {
  const out: AgentRecommendation[] = [];
  // Featured rec: licence case
  const c1 = ACTIVE_CASES[0];
  out.push({
    id: "rec-1421-book",
    agentId: "orch",
    title: {
      en: `Book municipal inspection for ${c1.id} — Tue 5 May 14:00`,
      ar: `احجز التفتيش البلدي لـ ${c1.id} — الثلاثاء 5 مايو 14:00`,
    },
    rationale: {
      en: "3 of 4 prerequisites are complete (CR, ID, Zakat). Riyadh Municipality has Tue 14:00 free. Booking removes the only remaining blocker on a high-priority case.",
      ar: "اكتملت 3 من 4 متطلبات (السجل، الهوية، الزكاة). أمانة الرياض لديها موعد متاح الثلاثاء 14:00. الحجز يزيل العائق الوحيد المتبقي.",
    },
    confidence: 94,
    severity: "high",
    recordType: "case",
    recordId: c1.id,
    recommendedAction: { en: "Approve booking and send SMS", ar: "اعتمد الحجز وأرسل الرسالة" },
    alternateActions: [
      { en: "Edit time slot", ar: "تعديل الموعد" },
      { en: "Reassign to inspector queue", ar: "تحويل إلى قائمة المفتش" },
    ],
    generatedAt: c1.history[c1.history.length - 1].at,
  });
  // SMS draft approval
  out.push({
    id: "rec-1421-sms",
    agentId: "drafter",
    title: { en: `Approve bilingual SMS to citizen (${c1.id})`, ar: `اعتماد رسالة نصية ثنائية اللغة (${c1.id})` },
    rationale: {
      en: "Najdi-dialect-tolerant draft references the booking link and EN translation. Length 280 chars; passes ministry tone-of-voice gate.",
      ar: "مسوّدة بلهجة نجدية تتضمّن رابط الحجز والترجمة الإنجليزية. 280 حرفاً وتجتاز معايير نبرة الوزارة.",
    },
    confidence: 91,
    severity: "high",
    recordType: "case",
    recordId: c1.id,
    recommendedAction: { en: "Approve and send", ar: "اعتمد وأرسل" },
    alternateActions: [{ en: "Edit copy", ar: "تعديل النص" }, { en: "Switch to phone call", ar: "تحويل لمكالمة هاتفية" }],
    generatedAt: c1.history[c1.history.length - 1].at,
  });
  // Pre-worked civil-status case
  out.push({
    id: "rec-1412-close",
    agentId: "audit",
    title: { en: "Close CSC-2026-1412 — all signatures verified", ar: "إغلاق CSC-2026-1412 — جميع التوقيعات موثّقة" },
    rationale: {
      en: "Three signatures match the citizen's national-ID specimen at 99% similarity. Closure Auditor packet ready for sealing.",
      ar: "تطابقت التوقيعات الثلاثة مع نموذج الهوية بنسبة 99%. حزمة الإغلاق جاهزة للختم.",
    },
    confidence: 96,
    severity: "medium",
    recordType: "case",
    recordId: "CSC-2026-1412",
    recommendedAction: { en: "Approve closure", ar: "اعتمد الإغلاق" },
    alternateActions: [{ en: "Request second review", ar: "طلب مراجعة ثانية" }],
    generatedAt: "May 4 06:30",
  });
  // Escalation rec for blocked traffic appeal
  out.push({
    id: "rec-1416-esc",
    agentId: "policy",
    title: { en: "Escalate radar evidence request to MOI desk officer", ar: "تصعيد طلب أدلة الرادار إلى ضابط الداخلية" },
    rationale: {
      en: "MOI returned a partial pack twice. Tracer suggests a named-officer escalation rather than a third automated retry.",
      ar: "أعادت الداخلية حزمة جزئية مرتين. يوصي المتعقّب بتصعيد إلى ضابط محدَّد بدلاً من محاولة آلية ثالثة.",
    },
    confidence: 84,
    severity: "medium",
    recordType: "case",
    recordId: "CSC-2026-1416",
    recommendedAction: { en: "Escalate to Capt. Mansour", ar: "تصعيد إلى الرائد منصور" },
    alternateActions: [{ en: "Retry automated request", ar: "إعادة الطلب الآلي" }],
    generatedAt: "May 3 19:10",
  });
  return out;
}

export function getAlerts(): CscAlert[] {
  return [
    { id: "al-1", severity: "high",     title: { en: "CSC-2026-1421 SLA breach in 8h", ar: "خرق اتفاقية الخدمة CSC-2026-1421 خلال 8 ساعات" }, sub: { en: "Conductor pre-worked — your approval needed", ar: "تم الإعداد المسبق — بانتظار اعتمادك" }, caseId: "CSC-2026-1421", at: "07:14" },
    { id: "al-2", severity: "medium",   title: { en: "MOI returned partial radar pack (1416)", ar: "أعادت الداخلية حزمة رادار جزئية (1416)" }, sub: { en: "Tracer recommends escalation", ar: "يوصي المتعقّب بالتصعيد" }, caseId: "CSC-2026-1416", at: "Yesterday 19:10" },
    { id: "al-3", severity: "high",     title: { en: "12 cases auto-pre-worked overnight", ar: "12 قضية أُعدّت تلقائياً ليلاً" }, sub: { en: "Open the queue to review", ar: "افتح القائمة للمراجعة" }, at: "06:02" },
    { id: "al-4", severity: "medium",   title: { en: "Citizen Reem reactivated CSC-2026-1408", ar: "أعادت المواطنة ريم تفعيل CSC-2026-1408" }, sub: { en: "Sponsorship docs uploaded", ar: "تم رفع وثائق الكفالة" }, caseId: "CSC-2026-1408", at: "06:48" },
    { id: "al-5", severity: "critical", title: { en: "Director note: weekly heatmap is below target", ar: "ملاحظة المديرة: الخريطة الأسبوعية دون المستهدف" }, sub: { en: "Riyadh average TTR up 14%", ar: "متوسط زمن الإنجاز في الرياض ارتفع 14%" }, at: "06:00" },
  ];
}

// ─── KPIs ─────────────────────────────────────────────────────────────────

export interface OfficerKpi { id: string; label: BiText; value: string; sub: BiText }

export function getOfficerKpis(): OfficerKpi[] {
  const total = ACTIVE_CASES.length;
  const slaAtRisk = ACTIVE_CASES.filter((c) => Date.parse(c.slaDueAt) - Date.parse(c.openedAt) > 0 && (Date.parse(c.slaDueAt) - Date.now()) < 24 * 3_600_000 && c.status !== "resolved").length;
  const preWorked = ACTIVE_CASES.filter((c) => c.preWorkedByAgent).length;
  const decisionsWaiting = ACTIVE_CASES.filter((c) => c.status === "agent-pre-worked" || c.status === "officer-review").length;
  return [
    { id: "kpi-open",      label: { en: "Open cases assigned to me", ar: "القضايا المفتوحة لديّ" },        value: String(total),       sub: { en: `${OFFICER.name.en} · today`, ar: `${OFFICER.name.ar} · اليوم` } },
    { id: "kpi-sla",       label: { en: "SLA at risk (next 24h)",     ar: "خطر اتفاقية الخدمة (24 ساعة)" }, value: String(slaAtRisk),   sub: { en: "1 high, 1 medium",          ar: "1 حرج، 1 متوسط" } },
    { id: "kpi-preworked", label: { en: "Pre-worked by agents today", ar: "أُعدّت بالوكلاء اليوم" },         value: `${preWorked} / ${total}`, sub: { en: `${Math.round((preWorked / total) * 100)}% of queue`, ar: `${Math.round((preWorked / total) * 100)}% من القائمة` } },
    { id: "kpi-wait",      label: { en: "Avg citizen wait (7d)",      ar: "متوسط انتظار المواطن (7 أيام)" }, value: "11h 42m",            sub: { en: "−18% vs last week",         ar: "−18% عن الأسبوع الماضي" } },
    { id: "kpi-decision",  label: { en: "Decisions waiting on me",    ar: "قرارات بانتظاري" },              value: String(decisionsWaiting), sub: { en: "Approvals queue ready",  ar: "قائمة الاعتمادات جاهزة" } },
  ];
}

// ─── Director heatmap (services × regions) ────────────────────────────────

export interface HeatmapCell { serviceId: string; regionId: string; volume: number; ttrHours: number }

export function getDirectorHeatmap(): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (const s of SERVICES) {
    for (const r of REGIONS) {
      const items = RESOLVED_CASES.filter((c) => c.serviceId === s.id && c.regionId === r.id);
      const ttr = items.length ? Math.round(items.reduce((a, b) => a + b.ttrHours, 0) / items.length) : 0;
      cells.push({ serviceId: s.id, regionId: r.id, volume: items.length, ttrHours: ttr });
    }
  }
  return cells;
}

// ─── Cross-agency volume by ministry today ────────────────────────────────
export function getMinistryVolume(): { ministryId: string; volume: number; color: string }[] {
  return MINISTRIES.map((m) => ({
    ministryId: m.id,
    color: m.color,
    volume: ACTIVE_CASES.filter((c) => c.ministryTouchpoints.some((t) => t.ministryId === m.id)).length
         + RESOLVED_CASES.filter((c) => SERVICES.find((s) => s.id === c.serviceId)?.ministryId === m.id).length,
  }));
}

// ─── Audit log entries (officer + agents) ─────────────────────────────────
export interface AuditEntry { at: string; actor: BiText; agentId?: string; event: BiText; caseId?: string }

export function getAuditLog(): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const c of ACTIVE_CASES) {
    for (const h of c.history) {
      out.push({ at: h.at, actor: h.actor, event: h.event, caseId: c.id });
    }
  }
  // Sorted newest first by date string descending
  return out.sort((a, b) => (b.at > a.at ? 1 : -1));
}

// ─── Knowledge surface: charters and SOPs the agents cite ─────────────────
export interface KnowledgeRef {
  id: string;
  title: BiText;
  source: BiText;
  type: "charter" | "sop" | "policy" | "checklist";
  relevantTo: string[]; // service ids
  excerpt: BiText;
  citations: number;
}

export function getKnowledgeRefs(): KnowledgeRef[] {
  return [
    { id: "k1", type: "charter",   title: { en: "Citizen Charter — commercial licence", ar: "ميثاق المواطن — رخصة تجارية" }, source: { en: "Cabinet Decision 219/1444",      ar: "قرار مجلس الوزراء 219/1444" },     relevantTo: ["svc-comm-lic","svc-biz-reg"],                excerpt: { en: "Renewal must complete within 72h of complete file submission.", ar: "يجب إنجاز التجديد خلال 72 ساعة من اكتمال الملف." }, citations: 38 },
    { id: "k2", type: "sop",       title: { en: "Cross-agency status pull — SOP",       ar: "إجراء جلب حالة عبر الجهات" },      source: { en: "Authority SOP-014",              ar: "إجراء الهيئة 014" },               relevantTo: ["svc-comm-lic","svc-biz-reg","svc-bldg"],     excerpt: { en: "Conductor pulls MOC, MOI, ZATCA, AM in parallel; degrades gracefully on 5xx.", ar: "يجلب المنسّق التجارة والداخلية والزكاة والأمانة بالتوازي." }, citations: 96 },
    { id: "k3", type: "policy",    title: { en: "Citizen comms tone of voice",          ar: "نبرة التواصل مع المواطن" },         source: { en: "Comms Office Manual v3",         ar: "دليل مكتب الاتصال - الإصدار 3" },   relevantTo: SERVICES.map((s) => s.id),                     excerpt: { en: "Always greet by honorific; explain next step before any link.", ar: "ابدأ بالتحية الكريمة واشرح الخطوة قبل أي رابط." }, citations: 142 },
    { id: "k4", type: "checklist", title: { en: "Municipal inspection prerequisites",   ar: "متطلبات التفتيش البلدي" },          source: { en: "Riyadh AM Circular 88/2024",     ar: "تعميم أمانة الرياض 88/2024" },     relevantTo: ["svc-comm-lic","svc-bldg"],                   excerpt: { en: "Valid CR, ID, zakat clearance, civil-defence certificate.", ar: "سجل ساري، هوية، إخلاء طرف زكاة، شهادة دفاع مدني." }, citations: 27 },
    { id: "k5", type: "policy",    title: { en: "Family visit visa — security review",  ar: "تأشيرة زيارة عائلية — مراجعة أمنية" }, source: { en: "MOI Procedure Note 2025-11", ar: "مذكرة الداخلية 2025-11" },        relevantTo: ["svc-family-visa"],                            excerpt: { en: "Standard security review window: 5 working days.", ar: "نافذة المراجعة الأمنية: 5 أيام عمل." }, citations: 53 },
    { id: "k6", type: "sop",       title: { en: "Closure audit packet contents",        ar: "محتويات حزمة الإغلاق" },            source: { en: "Authority SOP-021",              ar: "إجراء الهيئة 021" },               relevantTo: SERVICES.map((s) => s.id),                     excerpt: { en: "Inbound, citations, drafts, decisions, SHA-256 hash.", ar: "الوارد، المراجع، المسوّدات، القرارات، تجزئة SHA-256." }, citations: 71 },
  ];
}

// ─── Helpers used by chat intents ─────────────────────────────────────────

export function findCaseLike(query: string): Case | undefined {
  const q = query.toLowerCase();
  return ACTIVE_CASES.find((c) =>
    c.id.toLowerCase().includes(q) ||
    q.includes(c.id.toLowerCase()) ||
    c.id.replace(/csc-2026-/i, "").includes(q.replace(/[^0-9]/g, "")),
  );
}

export function casesBreachingIn(hours: number): Case[] {
  const horizon = Date.now() + hours * 3_600_000;
  return ACTIVE_CASES.filter((c) => Date.parse(c.slaDueAt) <= horizon);
}
