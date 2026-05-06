import type { BiText } from "@/lib/sim/types";

export type Classification = "public" | "internal" | "confidential" | "legal-privileged";

export interface Source {
  id: string;
  title: BiText;
  owner: BiText;
  classification: Classification;
  aclGroups: string[];
  updatedAt: string;
  domain: BiText;
  passage: BiText;
}

export interface Persona {
  id: PersonaId;
  name: BiText;
  role: BiText;
  initials: BiText;
  aclGroups: string[];
}

export type PersonaId = "cfo" | "junior" | "treasury" | "legal" | "consultant";

// 24 sources spanning Treasury, Legal, Finance, Audit, Strategy, HR, External
export const SOURCES: Source[] = [
  {
    id: "treasury-weekly-2026-04-28",
    title: { en: "Treasury weekly note · 28 Apr 2026", ar: "ملخّص الخزينة الأسبوعي · 28 أبريل" },
    owner: { en: "Group Treasurer", ar: "أمين الخزينة" },
    classification: "confidential", aclGroups: ["finance", "treasury", "exec"], updatedAt: "2026-04-28",
    domain: { en: "Treasury", ar: "الخزينة" },
    passage: {
      en: "Group exposure to the EGP move on receivables is USD 18.4M as of 28 Apr 2026, of which USD 11.2M is hedged via NDFs and USD 7.2M sits open in the Egypt B2G subsidiary. Hedging window closes 12 May.",
      ar: "تعرّض المجموعة للجنيه المصري على الذمم 18.4 مليون دولار في 28 أبريل، منها 11.2M متحوّط و7.2M مفتوح في الفرع المصري. نافذة التحوّط تُغلق 12 مايو.",
    },
  },
  {
    id: "fx-hedging-policy-v3",
    title: { en: "FX hedging policy v3", ar: "سياسة التحوّط على العملات v3" },
    owner: { en: "CFO Office", ar: "مكتب المدير المالي" },
    classification: "internal", aclGroups: ["finance", "treasury", "exec", "audit"], updatedAt: "2026-02-14",
    domain: { en: "Treasury", ar: "الخزينة" },
    passage: {
      en: "Open EGP exposure above USD 5M must be reported weekly to the CFO. The Egypt B2G subsidiary holds an exception (sovereign-counterparty) and reports monthly.",
      ar: "أي تعرّض مفتوح فوق 5M دولار يُبلّغ أسبوعياً للمدير المالي. الفرع المصري له استثناء ويُبلّغ شهريّاً.",
    },
  },
  {
    id: "ifrs9-ecl-run-q1-2026",
    title: { en: "IFRS-9 ECL run · Q1 2026", ar: "تشغيل IFRS-9 ECL · الربع 1" },
    owner: { en: "Group Controller", ar: "المراقب المالي" },
    classification: "confidential", aclGroups: ["finance", "audit", "exec"], updatedAt: "2026-04-12",
    domain: { en: "Finance", ar: "المالية" },
    passage: {
      en: "The Q1 ledger booked AED 4.6M IFRS-9 ECL uplift on the open EGP exposure. Stage-2 transition triggered by 30-day past-due in Egypt B2G.",
      ar: "حجزت Q1 رفعاً 4.6M درهم بحسب IFRS-9 على التعرّض المفتوح. الانتقال للمرحلة 2 بسبب تجاوز 30 يوماً في الفرع.",
    },
  },
  {
    id: "ar-ageing-april-2026",
    title: { en: "AR ageing report · April 2026", ar: "تقرير تقادم الذمم · أبريل" },
    owner: { en: "Credit Control", ar: "مراقبة الائتمان" },
    classification: "internal", aclGroups: ["finance", "audit", "treasury", "exec"], updatedAt: "2026-04-30",
    domain: { en: "Finance", ar: "المالية" },
    passage: {
      en: "Egypt B2G ageing: 60-90 days = USD 3.1M, 90+ days = USD 1.8M. Acceleration since 1 Apr correlates with the EGP devaluation.",
      ar: "تقادم الفرع المصري: 60-90 يوماً = 3.1M، 90+ يوماً = 1.8M. التسارع منذ 1 أبريل مرتبط بانخفاض الجنيه.",
    },
  },
  {
    id: "cfo-board-pack-apr-qa",
    title: { en: "CFO board pack · April Q&A annex", ar: "حزمة مجلس المدير المالي · أسئلة أبريل" },
    owner: { en: "CFO Office", ar: "مكتب المدير المالي" },
    classification: "confidential", aclGroups: ["finance", "exec"], updatedAt: "2026-04-22",
    domain: { en: "Finance", ar: "المالية" },
    passage: {
      en: "Board Q&A: 'On EGP, our position is materially hedged through May. Open exposure is concentrated in the Egypt B2G subsidiary and is being actively monitored.'",
      ar: "سؤال المجلس: 'موقفنا متحوّط جوهريّاً حتى مايو. التعرّض المفتوح مركّز في الفرع المصري ويُراقب.'",
    },
  },
  {
    id: "egp-exposure-ledger-q1",
    title: { en: "Q1 Egypt receivables ledger", ar: "سجل ذمم مصر للربع 1" },
    owner: { en: "Egypt CFO", ar: "المدير المالي – مصر" },
    classification: "confidential", aclGroups: ["finance", "treasury", "exec"], updatedAt: "2026-04-30",
    domain: { en: "Finance", ar: "المالية" },
    passage: {
      en: "Per-customer Egypt receivables, Q1 close: top three counterparties = MoH (USD 4.2M), MoE (USD 3.6M), Cairo Metro (USD 2.1M). All on government letters of credit.",
      ar: "ذمم العملاء بمصر، إقفال Q1: أعلى ثلاثة = الصحة 4.2M، التعليم 3.6M، مترو القاهرة 2.1M. كلّها بكفالات حكوميّة.",
    },
  },
  {
    id: "egp-litigation-memo-2026-04",
    title: { en: "EGP litigation memo · 18 Apr 2026", ar: "مذكّرة تقاضي الجنيه · 18 أبريل" },
    owner: { en: "General Counsel", ar: "المستشار العام" },
    classification: "legal-privileged", aclGroups: ["legal-privileged", "general-counsel"], updatedAt: "2026-04-18",
    domain: { en: "Legal", ar: "قانوني" },
    passage: {
      en: "[Legal-privileged content withheld from non-legal personas. Memo concerns potential arbitration on the Cairo Metro receivable should the EGP devaluation widen past 35%.]",
      ar: "[محتوى محجوب لغير القانونيين. تتعلّق المذكّرة بتحكيم محتمل على ذمّة المترو إذا اتّسع الانخفاض فوق 35%.]",
    },
  },
  {
    id: "jv-rescue-term-sheet-draft",
    title: { en: "JV rescue term-sheet (draft)", ar: "ورقة شروط إنقاذ المشروع المشترك (مسوّدة)" },
    owner: { en: "M&A Counsel", ar: "محامي الاندماجات" },
    classification: "legal-privileged", aclGroups: ["legal-privileged", "general-counsel", "m-and-a"], updatedAt: "2026-04-25",
    domain: { en: "Legal", ar: "قانوني" },
    passage: {
      en: "[Legal-privileged content withheld. Draft term-sheet for a partner buyout that would absorb the open EGP exposure inside a co-funded SPV.]",
      ar: "[محتوى محجوب. مسوّدة لشراء حصّة شريك تستوعب التعرّض في كيان مشترك.]",
    },
  },
  {
    id: "internal-audit-fx-controls-2025",
    title: { en: "Internal audit · FX controls 2025", ar: "تدقيق داخلي · ضوابط العملات 2025" },
    owner: { en: "Head of Internal Audit", ar: "رئيس التدقيق الداخلي" },
    classification: "confidential", aclGroups: ["audit", "exec"], updatedAt: "2026-01-30",
    domain: { en: "Audit", ar: "تدقيق" },
    passage: {
      en: "FX-policy compliance rated 'satisfactory' with one finding: weekly reporting cadence breached twice in Q4 2025. Remediation plan signed off Feb 2026.",
      ar: "الامتثال لسياسة العملات 'مُرضٍ' مع ملاحظة: خرق التقارير الأسبوعية مرّتين في Q4 2025. تمت معالجته فبراير 2026.",
    },
  },
  {
    id: "strategy-egypt-deck-q4-2025",
    title: { en: "Egypt strategy deck · Q4 2025", ar: "خطة مصر · الربع 4 2025" },
    owner: { en: "Chief Strategy Officer", ar: "كبير مسؤولي الاستراتيجية" },
    classification: "internal", aclGroups: ["strategy", "exec", "finance"], updatedAt: "2025-12-08",
    domain: { en: "Strategy", ar: "الاستراتيجية" },
    passage: {
      en: "Egypt is positioned as a 'managed-risk' market: capped open exposure, B2G concentration, EGP-denominated invoicing where possible.",
      ar: "تموضع مصر كسوق 'مخاطرة مُدارة': سقف للتعرّض، تركيز B2G، فوترة بالجنيه حين أمكن.",
    },
  },
  {
    id: "macro-egp-report-mar-2026",
    title: { en: "Macro report · EGP outlook · Mar 2026", ar: "تقرير اقتصاد كلّي · الجنيه · مارس 2026" },
    owner: { en: "Strategy desk", ar: "مكتب الاستراتيجية" },
    classification: "internal", aclGroups: ["strategy", "finance", "treasury", "exec"], updatedAt: "2026-03-04",
    domain: { en: "Strategy", ar: "الاستراتيجية" },
    passage: {
      en: "Base case: EGP weakens 12% by Q3, IMF tranche in June, secondary float plausible in Q4. Tail-risk: chaotic depreciation if Suez revenues drop.",
      ar: "السيناريو الأساس: ضعف 12% بحلول Q3، شريحة IMF في يونيو، وعوم ثانوي محتمل Q4. خطر متطرّف: انهيار إذا تراجعت إيرادات السويس.",
    },
  },
  {
    id: "egypt-org-chart-2026",
    title: { en: "Egypt org chart · 2026", ar: "هيكل تنظيم مصر · 2026" },
    owner: { en: "Egypt CFO", ar: "المدير المالي – مصر" },
    classification: "internal", aclGroups: ["finance", "hr", "exec"], updatedAt: "2026-01-15",
    domain: { en: "HR", ar: "موارد بشرية" },
    passage: {
      en: "32 staff in Cairo office. Treasury function reports dotted-line to Group Treasurer (Dubai).",
      ar: "32 موظفاً في مكتب القاهرة. الخزينة ترفع تبعيّة منقطّة لأمين الخزينة (دبي).",
    },
  },
  {
    id: "compliance-handbook-2026",
    title: { en: "Compliance handbook · 2026 ed.", ar: "دليل الامتثال · إصدار 2026" },
    owner: { en: "Chief Compliance Officer", ar: "كبير مسؤولي الامتثال" },
    classification: "public", aclGroups: ["all"], updatedAt: "2026-01-02",
    domain: { en: "Compliance", ar: "امتثال" },
    passage: {
      en: "All employees must complete annual sanctions training. EGP and IRR are flagged as 'enhanced-due-diligence' currencies.",
      ar: "كل الموظفين يجتازون تدريب العقوبات سنوياً. الجنيه والريال الإيراني عملات 'عناية معزّزة'.",
    },
  },
  {
    id: "code-of-conduct-2026",
    title: { en: "Code of conduct · 2026", ar: "ميثاق السلوك · 2026" },
    owner: { en: "HR", ar: "الموارد البشرية" },
    classification: "public", aclGroups: ["all"], updatedAt: "2026-01-02",
    domain: { en: "HR", ar: "موارد بشرية" },
    passage: {
      en: "Standard code of conduct, with section 12 covering inside-information handling.",
      ar: "ميثاق سلوك معياري، البند 12 عن التعامل مع المعلومات الداخليّة.",
    },
  },
  {
    id: "investor-day-may-2025",
    title: { en: "Investor day · May 2025 transcript", ar: "يوم المستثمر · مايو 2025" },
    owner: { en: "Investor Relations", ar: "علاقات المستثمرين" },
    classification: "public", aclGroups: ["all"], updatedAt: "2025-05-20",
    domain: { en: "Investor relations", ar: "علاقات المستثمرين" },
    passage: {
      en: "CFO commentary: 'Egypt is single-digit percent of group revenue, hedged where material.'",
      ar: "تعليق المدير المالي: 'مصر نسبة أحاديّة من إيرادات المجموعة، متحوّطة حيث يهم.'",
    },
  },
  {
    id: "annual-report-2025",
    title: { en: "Annual report · 2025", ar: "التقرير السنوي · 2025" },
    owner: { en: "CFO Office", ar: "مكتب المدير المالي" },
    classification: "public", aclGroups: ["all"], updatedAt: "2026-03-10",
    domain: { en: "Finance", ar: "المالية" },
    passage: {
      en: "Note 27 (FX risk): EGP exposure summarised at year-end as USD 14.1M open, USD 9.2M hedged.",
      ar: "الإيضاح 27: التعرّض على الجنيه نهاية السنة 14.1M مفتوح و9.2M متحوّط.",
    },
  },
  {
    id: "consultant-engagement-letter-q2",
    title: { en: "External consultant engagement · Q2 2026", ar: "خطاب تكليف الاستشاري · Q2" },
    owner: { en: "Strategy desk", ar: "مكتب الاستراتيجية" },
    classification: "internal", aclGroups: ["strategy", "external-consultant"], updatedAt: "2026-04-01",
    domain: { en: "Strategy", ar: "الاستراتيجية" },
    passage: {
      en: "Engagement scope: GCC market entry only. Egypt expressly out-of-scope for the consultant team.",
      ar: "نطاق التكليف: دخول أسواق الخليج فقط. مصر خارج النطاق بشكل صريح.",
    },
  },
  {
    id: "treasury-runbook-egp",
    title: { en: "Treasury runbook · EGP scenarios", ar: "دليل تشغيل الخزينة · سيناريوهات الجنيه" },
    owner: { en: "Group Treasurer", ar: "أمين الخزينة" },
    classification: "confidential", aclGroups: ["treasury", "finance", "exec"], updatedAt: "2026-03-22",
    domain: { en: "Treasury", ar: "الخزينة" },
    passage: {
      en: "Tier-1 response: extend NDF coverage to 75% of open balance within 5 working days if EGP moves >5% in a week.",
      ar: "استجابة المستوى 1: تمديد NDF لتغطية 75% خلال 5 أيام إذا تحرّك الجنيه أكثر من 5% أسبوعياً.",
    },
  },
  {
    id: "sox-narrative-fx",
    title: { en: "SOX narrative · FX process", ar: "سرد SOX · عملية العملات" },
    owner: { en: "Head of Internal Audit", ar: "رئيس التدقيق الداخلي" },
    classification: "internal", aclGroups: ["audit", "finance"], updatedAt: "2025-11-30",
    domain: { en: "Audit", ar: "تدقيق" },
    passage: {
      en: "Three-line-of-defence map for FX. Treasury executes, Finance records, Audit attests.",
      ar: "خريطة خطوط الدفاع الثلاث للعملات. الخزينة تنفّذ، المالية تسجّل، التدقيق يشهد.",
    },
  },
  {
    id: "tax-position-egypt-2026",
    title: { en: "Tax position memo · Egypt 2026", ar: "مذكّرة الموقف الضريبي · مصر 2026" },
    owner: { en: "Head of Tax", ar: "رئيس الضرائب" },
    classification: "confidential", aclGroups: ["finance", "tax", "exec"], updatedAt: "2026-02-28",
    domain: { en: "Tax", ar: "الضرائب" },
    passage: {
      en: "Withholding tax exposure on EGP receivables: 5% on royalties, 10% on dividends. Double-tax treaty with UAE applies.",
      ar: "ضريبة الاستقطاع على ذمم الجنيه: 5% للإتاوات و10% للأرباح. تطبيق اتفاقية تجنّب الازدواج مع الإمارات.",
    },
  },
  {
    id: "weekly-cash-position-may-1",
    title: { en: "Weekly cash position · 1 May 2026", ar: "موقف النقد الأسبوعي · 1 مايو" },
    owner: { en: "Group Treasurer", ar: "أمين الخزينة" },
    classification: "confidential", aclGroups: ["treasury", "finance", "exec"], updatedAt: "2026-05-01",
    domain: { en: "Treasury", ar: "الخزينة" },
    passage: {
      en: "Group cash USD 412M, of which USD 22M trapped in Egypt due to USD allocation backlog.",
      ar: "نقد المجموعة 412M$، منها 22M$ محتجزة في مصر بسبب تأخّر تخصيص الدولار.",
    },
  },
  {
    id: "eg-press-clipping-apr",
    title: { en: "Press clipping · EGP devaluation · April", ar: "مقال صحفي · انخفاض الجنيه · أبريل" },
    owner: { en: "Strategy desk", ar: "مكتب الاستراتيجية" },
    classification: "public", aclGroups: ["all"], updatedAt: "2026-04-19",
    domain: { en: "Strategy", ar: "الاستراتيجية" },
    passage: {
      en: "Reuters: Egyptian pound devalued a further 8% on 17 Apr after IMF mission concluded; secondary float discussed.",
      ar: "رويترز: الجنيه ضعف 8% إضافياً في 17 أبريل بعد مهمّة IMF؛ نقاش حول العوم الثانوي.",
    },
  },
  {
    id: "credit-policy-2026",
    title: { en: "Credit policy · 2026", ar: "سياسة الائتمان · 2026" },
    owner: { en: "Group Controller", ar: "المراقب المالي" },
    classification: "internal", aclGroups: ["finance", "audit"], updatedAt: "2026-01-18",
    domain: { en: "Finance", ar: "المالية" },
    passage: {
      en: "Government counterparties carry a default risk-weighting of 25% (vs. 100% for private). Egypt B2G classified accordingly.",
      ar: "الجهات الحكوميّة لها وزن مخاطر 25% (مقابل 100% للخاص). الفرع المصري يُصنّف وفقاً لذلك.",
    },
  },
  {
    id: "exec-comms-egp-talking-points",
    title: { en: "Exec comms · EGP talking points (draft)", ar: "تواصل تنفيذي · نقاط الجنيه (مسوّدة)" },
    owner: { en: "Communications", ar: "الاتصالات" },
    classification: "internal", aclGroups: ["exec", "finance", "comms"], updatedAt: "2026-04-29",
    domain: { en: "Communications", ar: "الاتصالات" },
    passage: {
      en: "Approved talking points for press: 'managed exposure, hedged where material, no impact to FY guidance'.",
      ar: "نقاط معتمدة للصحافة: 'تعرّض مُدار، متحوّط حيث يهم، لا أثر على التوجيه السنوي'.",
    },
  },
];

export const PERSONAS: Persona[] = [
  {
    id: "cfo",
    name: { en: "Lina Haddad", ar: "لينا حدّاد" },
    role: { en: "Chief Financial Officer", ar: "المدير المالي" },
    initials: { en: "LH", ar: "ل ح" },
    aclGroups: ["finance", "treasury", "exec", "audit", "tax", "strategy", "hr", "comms", "all"],
  },
  {
    id: "junior",
    name: { en: "Omar Faisal", ar: "عمر فيصل" },
    role: { en: "Junior FP&A Analyst", ar: "محلّل تخطيط مبتدئ" },
    initials: { en: "OF", ar: "ع ف" },
    aclGroups: ["all"],
  },
  {
    id: "treasury",
    name: { en: "Maya Khoury", ar: "مايا خوري" },
    role: { en: "Treasury Manager", ar: "مديرة الخزينة" },
    initials: { en: "MK", ar: "م خ" },
    aclGroups: ["treasury", "finance", "comms", "all"],
  },
  {
    id: "legal",
    name: { en: "Reem Abdullah", ar: "ريم عبدالله" },
    role: { en: "Legal Counsel", ar: "المستشار القانوني" },
    initials: { en: "RA", ar: "ر ع" },
    aclGroups: ["legal-privileged", "general-counsel", "m-and-a", "exec", "all"],
  },
  {
    id: "consultant",
    name: { en: "Yusuf Al-Rashid", ar: "يوسف الراشد" },
    role: { en: "External Consultant", ar: "استشاري خارجي" },
    initials: { en: "YR", ar: "ي ر" },
    aclGroups: ["external-consultant", "all"],
  },
];

export function visibleSourcesFor(personaId: PersonaId): Source[] {
  const persona = PERSONAS.find((p) => p.id === personaId)!;
  return SOURCES.filter((s) => s.aclGroups.some((g) => persona.aclGroups.includes(g)));
}

export function isVisibleTo(source: Source, personaId: PersonaId): boolean {
  const persona = PERSONAS.find((p) => p.id === personaId)!;
  return source.aclGroups.some((g) => persona.aclGroups.includes(g));
}

export function personaById(id: PersonaId): Persona {
  return PERSONAS.find((p) => p.id === id)!;
}

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}
