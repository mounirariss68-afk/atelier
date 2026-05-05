/**
 * Tasama Payroll Hub — Demo 1 (Digital Team Agent Dashboard).
 *
 * 10 specialist agents collaborate on the April 2026 monthly payroll
 * cycle for 3 client companies (42 employees). The scenario walks the
 * audience through document digitization, employee record updates,
 * gross-to-net calculations, EOSB/leave processing, GOSI + Mudad filing,
 * bank transfers, and a full compliance audit — pausing at three
 * human checkpoints (Payroll Manager, Finance Controller, Compliance
 * Officer).
 *
 * Every tool-call event carries a rich `toolResult` so the audience can
 * see exactly what each agent produced.
 *
 * Bilingual EN/AR. Sample data only.
 */

import type { Scenario } from "../types";

const scenario: Scenario = {
  slug: "tasama-payroll-hub",
  toolTitle: { en: "Tasama Payroll Hub", ar: "منصة تَسَامى للرواتب" },
  accent: "#2563EB",
  description: {
    en: "End-to-end monthly payroll cycle for 3 client companies (42 employees): digitize HR documents, update employee records, calculate gross-to-net, process EOSB and leave, file GOSI and Mudad, prepare bank transfers, and run the compliance audit — with three human checkpoints.",
    ar: "دورة رواتب شهرية متكاملة لثلاث شركات عميلة (42 موظفاً): رقمنة وثائق الموارد البشرية، تحديث سجلات الموظفين، احتساب الإجمالي والصافي، معالجة مكافأة نهاية الخدمة والإجازات، إيداع ملفات التأمينات الاجتماعية ونظام مُدد، تجهيز التحويلات البنكية، وتدقيق الامتثال — مع ثلاث نقاط موافقة بشرية.",
  },
  buyer: { en: "Tasama Digital / IT Team", ar: "فريق تَسَامى الرقمي وتقنية المعلومات" },
  trigger: {
    en: "May 5, 2026 — mid-cycle prep for May payroll. April fully settled and paid; May cycle now in preparation, with per-client cutoffs at days 22 (Luma), 25 (Al-Nakhla), and 28 (Vertex).",
    ar: "5 مايو 2026 — تحضير منتصف الدورة لرواتب مايو. اكتملت تسوية رواتب أبريل ودُفعت؛ دورة مايو الآن قيد التحضير، مع مواعيد إقفال لكل عميل في الأيام 22 (لوما)، 25 (النخلة)، 28 (فيرتكس).",
  },
  agents: [
    {
      id: "payroll-orchestrator",
      name: { en: "Payroll Orchestrator", ar: "منسّق الرواتب" },
      role: {
        en: "Plans the monthly cycle, dispatches the specialist agents, and gates the human checkpoints.",
        ar: "يخطّط الدورة الشهرية ويوزّع المهام على الوكلاء المتخصصين ويراقب نقاط الموافقة البشرية.",
      },
      kind: "orchestrator",
      color: "#2563EB",
    },
    {
      id: "doc-intelligence",
      name: { en: "Document Intelligence Agent", ar: "وكيل ذكاء الوثائق" },
      role: {
        en: "Digitizes uploaded HR documents (promotion letters, terminations, bonuses) into structured fields.",
        ar: "يرقمن وثائق الموارد البشرية المرفوعة (خطابات الترقية، إنهاء الخدمة، المكافآت) إلى حقول منظّمة.",
      },
      kind: "retriever",
      color: "#6366F1",
    },
    {
      id: "employee-records",
      name: { en: "Employee Records Agent", ar: "وكيل سجلات الموظفين" },
      role: {
        en: "Applies extracted changes to the employee master file: position, salary, status, retroactive adjustments.",
        ar: "يطبّق التغييرات المستخرجة على الملف الرئيسي للموظفين: المنصب، الراتب، الحالة، التسويات بأثر رجعي.",
      },
      kind: "compiler",
      color: "#2563EB",
    },
    {
      id: "salary-calc",
      name: { en: "Salary Calculation Agent", ar: "وكيل حساب الرواتب" },
      role: {
        en: "Computes gross-to-net per employee per client: basic, allowances, GOSI, overtime, retros, deductions.",
        ar: "يحتسب الإجمالي والصافي لكل موظف لدى كل عميل: الأساسي، البدلات، التأمينات، الإضافي، التسويات، الاستقطاعات.",
      },
      kind: "scorer",
      color: "#16A34A",
    },
    {
      id: "gosi-compliance",
      name: { en: "GOSI Compliance Agent", ar: "وكيل التزام التأمينات" },
      role: {
        en: "Builds the monthly GOSI contribution file, manages new registrations and deregistrations.",
        ar: "يُعدّ ملف اشتراكات التأمينات الاجتماعية الشهري ويدير حالات التسجيل والإلغاء.",
      },
      kind: "monitor",
      color: "#DC2626",
    },
    {
      id: "mudad-filing",
      name: { en: "Mudad Filing Agent", ar: "وكيل نظام مُدد" },
      role: {
        en: "Prepares the Mudad-compliant wage protection file and submits transfers to the platform.",
        ar: "يُعدّ ملف حماية الأجور المتوافق مع نظام مُدد ويُرسل التحويلات إلى المنصّة.",
      },
      kind: "compiler",
      color: "#EA580C",
    },
    {
      id: "eosb-provisions",
      name: { en: "EOSB Provisions Agent", ar: "وكيل مخصصات نهاية الخدمة" },
      role: {
        en: "Calculates end-of-service benefit provisions and final settlements per Saudi Labor Law.",
        ar: "يحتسب مخصصات مكافأة نهاية الخدمة والتسويات النهائية وفق نظام العمل السعودي.",
      },
      kind: "scorer",
      color: "#7C3AED",
    },
    {
      id: "leave-attendance",
      name: { en: "Leave & Attendance Agent", ar: "وكيل الإجازات والحضور" },
      role: {
        en: "Validates leave requests against entitlement balances and computes vacation salary advances.",
        ar: "يتحقّق من طلبات الإجازات مقابل أرصدة الاستحقاق ويحتسب سُلَف رواتب الإجازة.",
      },
      kind: "monitor",
      color: "#0891B2",
    },
    {
      id: "bank-transfer",
      name: { en: "Bank Transfer Agent", ar: "وكيل التحويلات البنكية" },
      role: {
        en: "Builds bank-ready batch payment files with IBAN validation and reconciliation.",
        ar: "يُعدّ ملفات الدفعات الجماعية الجاهزة للبنوك مع التحقق من الآيبان والتسوية.",
      },
      kind: "compiler",
      color: "#CA8A04",
    },
    {
      id: "compliance-audit",
      name: { en: "Compliance & Audit Agent", ar: "وكيل الامتثال والتدقيق" },
      role: {
        en: "Audits Saudization (Nitaqat) ratios, Iqama renewals, labor law adherence, and produces the audit trail.",
        ar: "يدقّق نسب التوطين (نطاقات)، تجديد الإقامات، التزام نظام العمل، ويُنتج سجل التدقيق.",
      },
      kind: "critic",
      color: "#BE185D",
    },
  ],
  tools: [
    {
      name: "digitize_document",
      description: {
        en: "Extracts structured data from uploaded PDF documents (letters, contracts, terminations).",
        ar: "يستخرج البيانات المنظّمة من ملفات PDF المرفوعة (الخطابات، العقود، إنهاء الخدمة).",
      },
    },
    {
      name: "calculate_payroll",
      description: {
        en: "Computes gross-to-net salary for all employees in a client company for the cycle.",
        ar: "يحتسب الراتب من الإجمالي إلى الصافي لجميع موظفي شركة عميل ضمن الدورة.",
      },
    },
    {
      name: "generate_gosi_file",
      description: {
        en: "Produces the monthly GOSI contribution file with employer + employee splits and registration changes.",
        ar: "يُنتج ملف اشتراكات التأمينات الشهري مع حصص صاحب العمل والموظف وتغييرات التسجيل.",
      },
    },
    {
      name: "prepare_mudad_file",
      description: {
        en: "Generates the Mudad-compliant wage protection file (v3.2) ready for platform submission.",
        ar: "يُنتج ملف حماية الأجور المتوافق مع نظام مُدد (إصدار 3.2) جاهزاً للإرسال للمنصّة.",
      },
    },
    {
      name: "calculate_eosb",
      description: {
        en: "Computes end-of-service benefit amounts and final settlement per Saudi Labor Law.",
        ar: "يحتسب مبالغ مكافأة نهاية الخدمة والتسوية النهائية وفق نظام العمل السعودي.",
      },
    },
    {
      name: "validate_leave_request",
      description: {
        en: "Checks each leave request against entitlement balance and computes vacation salary impact.",
        ar: "يتحقّق من كل طلب إجازة مقابل رصيد الاستحقاق ويحتسب أثر راتب الإجازة.",
      },
    },
    {
      name: "prepare_bank_transfers",
      description: {
        en: "Creates batch payment files with IBAN validation, bank distribution, and reconciliation.",
        ar: "يُعدّ ملفات الدفعات الجماعية مع التحقق من الآيبان وتوزيع البنوك والتسوية.",
      },
    },
    {
      name: "run_compliance_check",
      description: {
        en: "Audits Saudization ratios, Iqama dates, contract authentication, and labor law adherence.",
        ar: "يدقّق نسب التوطين، تواريخ الإقامة، توثيق العقود، والتزام نظام العمل.",
      },
    },
  ],
  checkpoints: [
    {
      id: "payroll-manager",
      human: { en: "Payroll Manager", ar: "مدير الرواتب" },
      question: {
        en: "Approve the calculated payroll for April 2026?",
        ar: "هل توافق على الرواتب المحتسبة لشهر أبريل 2026؟",
      },
      rationale: {
        en: "42 employees across 3 clients processed. Notable items: Ahmed Al-Rashidi has a retroactive promotion adjustment of SAR 4,600 for Feb–Mar. Mohammad Al-Ghamdi's final settlement totals SAR 196,450 (EOSB SAR 166,250 + leave encashment SAR 10,500 + remaining salary SAR 19,700). Noura Al-Salem's salary increase effective this month adds SAR 2,000 to monthly payroll. Sarah Johnson's Q1 bonus of SAR 15,000 included. Total gross variance vs. last month: +8.3% due to separation and bonus.",
        ar: "تمت معالجة 42 موظفاً لدى 3 عملاء. أبرز البنود: أحمد الرشيدي لديه تسوية ترقية بأثر رجعي بقيمة 4,600 ريال عن فبراير ومارس. التسوية النهائية لمحمد الغامدي تبلغ 196,450 ريال (مكافأة نهاية الخدمة 166,250 + بدل الإجازات 10,500 + الراتب المتبقي 19,700). الزيادة في راتب نورة السالم سارية هذا الشهر وتضيف 2,000 ريال على الرواتب الشهرية. مكافأة الربع الأول لسارة جونسون 15,000 ريال مُدرجة. الفرق الإجمالي مقابل الشهر الماضي: +8.3% بسبب إنهاء الخدمة والمكافأة.",
      },
      options: [
        {
          id: "approve-all",
          label: { en: "Approve all (recommended)", ar: "اعتماد الكل (موصى به)" },
          recommended: true,
        },
        {
          id: "approve-excl-settlement",
          label: { en: "Approve excluding final settlement", ar: "اعتماد ما عدا التسوية النهائية" },
        },
        {
          id: "reject-recalculate",
          label: { en: "Reject and recalculate", ar: "رفض وإعادة الحساب" },
        },
      ],
    },
    {
      id: "finance-controller",
      human: { en: "Finance Controller", ar: "المراقب المالي" },
      question: {
        en: "Approve bank transfer file for SAR 487,250?",
        ar: "هل توافق على ملف التحويلات البنكية بقيمة 487,250 ريال؟",
      },
      rationale: {
        en: "41 salary transfers + 1 final settlement + 1 bonus payment = 43 transactions across 4 banks (Al-Rajhi: 18, SNB: 12, Riyad Bank: 8, SAB: 5). Total: SAR 487,250. All IBANs validated. 2 flagged for manual review: Rajesh Kumar (Iqama renewal pending — expires in 45 days, transfer may be held) and Khalid Al-Otaibi (first payroll — GOSI registration confirmation awaiting).",
        ar: "41 تحويل راتب + 1 تسوية نهائية + 1 دفعة مكافأة = 43 عملية عبر 4 بنوك (الراجحي: 18، الأهلي السعودي: 12، الرياض: 8، الأول: 5). الإجمالي: 487,250 ريال. تم التحقق من جميع أرقام الآيبان. تم تمييز عمليتين للمراجعة اليدوية: راجيش كومار (تجديد الإقامة معلّق — تنتهي خلال 45 يوماً، قد يُعلّق التحويل) وخالد العتيبي (أول راتب — في انتظار تأكيد التسجيل في التأمينات).",
      },
      options: [
        {
          id: "approve-all",
          label: { en: "Approve all (recommended)", ar: "اعتماد الكل (موصى به)" },
          recommended: true,
        },
        {
          id: "approve-minus-flagged",
          label: { en: "Approve minus flagged", ar: "اعتماد ما عدا المُميَّز" },
        },
        {
          id: "reject-revalidate",
          label: { en: "Reject and revalidate", ar: "رفض وإعادة التحقق" },
        },
      ],
    },
    {
      id: "compliance-officer",
      human: { en: "Compliance Officer", ar: "مسؤول الامتثال" },
      question: {
        en: "Approve GOSI and Mudad submissions for April?",
        ar: "هل توافق على إيداعات التأمينات الاجتماعية ونظام مُدد لشهر أبريل؟",
      },
      rationale: {
        en: "GOSI file: 42 employees, employer contribution SAR 31,420, employee contribution SAR 18,750. New registration: Khalid Al-Otaibi (GOSI# pending). Deregistration: Mohammad Al-Ghamdi (effective April 30). Mudad file: 43 transactions, SAR 487,250. Saudization update: Vertex Tech dropped to 50% (Yellow band) — 1 Saudi hire needed to reach Green-Low (55%). Action plan drafted. Al-Nakhla stable at 61% (Green-Low). Luma Retail strong at 79% (Green-Mid).",
        ar: "ملف التأمينات: 42 موظفاً، حصة صاحب العمل 31,420 ريال، حصة الموظفين 18,750 ريال. تسجيل جديد: خالد العتيبي (رقم التأمينات قيد الإصدار). إلغاء تسجيل: محمد الغامدي (اعتباراً من 30 أبريل). ملف نظام مُدد: 43 عملية بقيمة 487,250 ريال. تحديث التوطين: شركة فيرتكس انخفضت إلى 50% (نطاق أصفر) — يلزم تعيين سعودي واحد للوصول إلى الأخضر المنخفض (55%). تم إعداد خطة عمل. النخلة مستقرة عند 61% (أخضر منخفض). لوما للتجزئة قوية عند 79% (أخضر متوسط).",
      },
      options: [
        {
          id: "approve-both",
          label: { en: "Approve both (recommended)", ar: "اعتماد الاثنين (موصى به)" },
          recommended: true,
        },
        {
          id: "approve-gosi-only",
          label: { en: "Approve GOSI only", ar: "اعتماد التأمينات فقط" },
        },
        {
          id: "reject-pending-action",
          label: {
            en: "Reject pending Saudization action plan",
            ar: "رفض إلى حين خطة عمل التوطين",
          },
        },
      ],
    },
  ],
  workflows: [
    {
      id: "monthly-payroll-cycle",
      name: { en: "Monthly Payroll Cycle", ar: "دورة الرواتب الشهرية" },
      description: {
        en: "End-to-end monthly cycle for all client companies — orchestrates the full agent fleet from document intake through bank transfers, GOSI/Mudad filing, and compliance audit.",
        ar: "دورة شهرية متكاملة لجميع الشركات العميلة — تنسّق فرقة الوكلاء الكاملة من استقبال الوثائق حتى التحويلات البنكية وإيداع التأمينات ومُدد وتدقيق الامتثال.",
      },
      trigger: {
        en: "First business day of each month — automated scheduler",
        ar: "أول يوم عمل من كل شهر — جدولة آلية",
      },
      steps: [
        { agentId: "payroll-orchestrator", label: { en: "Plan the cycle", ar: "تخطيط الدورة" } },
        { agentId: "doc-intelligence", label: { en: "Digitize HR documents", ar: "رقمنة وثائق الموارد البشرية" } },
        { agentId: "employee-records", label: { en: "Update employee records", ar: "تحديث سجلات الموظفين" } },
        { agentId: "salary-calc", label: { en: "Calculate payroll", ar: "احتساب الرواتب" } },
        { agentId: "leave-attendance", label: { en: "Validate leave & attendance", ar: "التحقق من الإجازات والحضور" } },
        { agentId: "eosb-provisions", label: { en: "Compute EOSB provisions", ar: "احتساب مخصصات نهاية الخدمة" } },
        { agentId: "gosi-compliance", label: { en: "Generate GOSI file", ar: "إنشاء ملف التأمينات" } },
        { agentId: "mudad-filing", label: { en: "Prepare Mudad file", ar: "تجهيز ملف نظام مُدد" } },
        { agentId: "bank-transfer", label: { en: "Prepare bank transfers", ar: "تجهيز التحويلات البنكية" } },
        { agentId: "compliance-audit", label: { en: "Run compliance audit", ar: "تنفيذ تدقيق الامتثال" } },
      ],
    },
    {
      id: "employee-separation",
      name: { en: "Employee Separation", ar: "إنهاء خدمة موظف" },
      description: {
        en: "Off-cycle workflow triggered when a termination letter is uploaded — digitizes the letter, updates the record, calculates EOSB and final settlement, processes leave encashment, prepares the bank transfer, and audits the closure.",
        ar: "سير عمل خارج الدورة يُفعَّل عند رفع خطاب إنهاء خدمة — يرقمن الخطاب، يحدّث السجل، يحتسب مكافأة نهاية الخدمة والتسوية النهائية، يعالج بدل الإجازات، يجهّز التحويل البنكي، ويدقّق الإغلاق.",
      },
      trigger: {
        en: "Termination letter uploaded — automatic",
        ar: "رفع خطاب إنهاء خدمة — آلي",
      },
      steps: [
        { agentId: "doc-intelligence", label: { en: "Digitize termination letter", ar: "رقمنة خطاب إنهاء الخدمة" } },
        { agentId: "employee-records", label: { en: "Set status to Notice Period", ar: "تعيين الحالة كفترة إشعار" } },
        { agentId: "eosb-provisions", label: { en: "Calculate EOSB", ar: "احتساب مكافأة نهاية الخدمة" } },
        { agentId: "salary-calc", label: { en: "Compute final settlement", ar: "احتساب التسوية النهائية" } },
        { agentId: "leave-attendance", label: { en: "Process leave encashment", ar: "معالجة بدل الإجازات" } },
        { agentId: "bank-transfer", label: { en: "Prepare settlement transfer", ar: "تجهيز تحويل التسوية" } },
        { agentId: "compliance-audit", label: { en: "Audit closure & GOSI deregistration", ar: "تدقيق الإغلاق وإلغاء تسجيل التأمينات" } },
      ],
    },
  ],
  kpis: [
    { id: "payroll-accuracy", label: { en: "Payroll Accuracy", ar: "دقة الرواتب" }, initial: "99.7%" },
    { id: "sla-compliance", label: { en: "SLA Compliance", ar: "الالتزام باتفاقية الخدمة" }, initial: "96.2%" },
    { id: "gosi-filing-rate", label: { en: "GOSI Filing Rate", ar: "نسبة إيداع التأمينات" }, initial: "100%" },
    { id: "avg-processing-time", label: { en: "Avg Processing Time", ar: "متوسط زمن المعالجة" }, initial: "4.2 hrs" },
    { id: "exception-rate", label: { en: "Exception Rate", ar: "نسبة الاستثناءات" }, initial: "2.1%" },
    { id: "mudad-compliance", label: { en: "Mudad Compliance", ar: "الالتزام بنظام مُدد" }, initial: "98.5%" },
  ],
  initialInbox: [
    {
      id: "inbox-monthly-cycle",
      source: { en: "Automated Scheduler", ar: "الجدولة الآلية" },
      subject: {
        en: "Monthly Payroll Cycle — April 2026",
        ar: "دورة الرواتب الشهرية — أبريل 2026",
      },
      preview: {
        en: "April payroll cycle ready to start. 3 clients, 42 employees, 6 pending changes (1 separation, 1 promotion retro, 1 increase, 1 bonus, 1 leave, 1 onboarding).",
        ar: "دورة رواتب أبريل جاهزة للبدء. 3 عملاء، 42 موظفاً، 6 تغييرات معلّقة (إنهاء خدمة، تسوية ترقية، زيادة، مكافأة، إجازة، توظيف جديد).",
      },
      receivedAt: "May 1, 08:00",
      status: "new",
    },
    {
      id: "inbox-gosi-deadline",
      source: { en: "GOSI Compliance Agent", ar: "وكيل التزام التأمينات" },
      subject: {
        en: "GOSI Filing Deadline — May 15",
        ar: "موعد إيداع التأمينات — 15 مايو",
      },
      preview: {
        en: "Reminder: GOSI April contribution file is due by May 15. 14 days remaining. Pre-flight checks queued.",
        ar: "تذكير: ملف اشتراكات التأمينات لشهر أبريل مُستحق بحلول 15 مايو. متبقي 14 يوماً. تم جدولة الفحوص الأولية.",
      },
      receivedAt: "May 1, 08:02",
      status: "new",
    },
    {
      id: "inbox-new-documents",
      source: { en: "Document Intelligence Agent", ar: "وكيل ذكاء الوثائق" },
      subject: {
        en: "New Documents Received — 4 Documents",
        ar: "وثائق جديدة مستلمة — 4 وثائق",
      },
      preview: {
        en: "4 new HR documents in the upload queue: 1 promotion letter, 1 salary increase, 1 bonus letter, 1 termination letter. Awaiting digitization.",
        ar: "4 وثائق موارد بشرية جديدة في طابور الرفع: خطاب ترقية، زيادة راتب، مكافأة، إنهاء خدمة. بانتظار الرقمنة.",
      },
      receivedAt: "May 1, 07:45",
      status: "new",
    },
    {
      id: "inbox-saudization-alert",
      source: { en: "Compliance & Audit Agent", ar: "وكيل الامتثال والتدقيق" },
      subject: {
        en: "Saudization Alert — Vertex Tech",
        ar: "تنبيه التوطين — شركة فيرتكس",
      },
      preview: {
        en: "Vertex Tech Saudization ratio at risk of dropping below 55% (Green-Low) — recommend pre-emptive review during this cycle.",
        ar: "نسبة توطين شركة فيرتكس مهدّدة بالنزول تحت 55% (الأخضر المنخفض) — يُوصى بمراجعة استباقية خلال هذه الدورة.",
      },
      receivedAt: "May 1, 07:30",
      status: "new",
      accent: "#DC2626",
    },
  ],
  initialWorkspace: [
    {
      id: "april-status",
      kind: "metric-grid",
      title: {
        en: "April Processing Status",
        ar: "حالة معالجة شهر أبريل",
      },
      rows: [
        [
          { en: "Client", ar: "العميل" },
          { en: "Employees", ar: "الموظفون" },
          { en: "Status", ar: "الحالة" },
        ],
        [
          { en: "Al-Nakhla Construction", ar: "النخلة للمقاولات" },
          { en: "18", ar: "18" },
          { en: "Queued", ar: "في الطابور" },
        ],
        [
          { en: "Luma Retail Group", ar: "مجموعة لوما للتجزئة" },
          { en: "14", ar: "14" },
          { en: "Queued", ar: "في الطابور" },
        ],
        [
          { en: "Vertex Tech Solutions", ar: "فيرتكس لحلول التقنية" },
          { en: "10", ar: "10" },
          { en: "Queued", ar: "في الطابور" },
        ],
      ],
    },
    {
      id: "pending-changes",
      kind: "table",
      title: {
        en: "Pending Employee Changes",
        ar: "تغييرات الموظفين المعلّقة",
      },
      rows: [
        [
          { en: "Employee", ar: "الموظف" },
          { en: "Client", ar: "العميل" },
          { en: "Change Type", ar: "نوع التغيير" },
          { en: "Status", ar: "الحالة" },
        ],
        [
          { en: "Mohammad Al-Ghamdi", ar: "محمد الغامدي" },
          { en: "Al-Nakhla", ar: "النخلة" },
          { en: "Separation (Apr 30)", ar: "إنهاء خدمة (30 أبريل)" },
          { en: "Pending", ar: "معلّق" },
        ],
        [
          { en: "Ahmed Al-Rashidi", ar: "أحمد الرشيدي" },
          { en: "Al-Nakhla", ar: "النخلة" },
          { en: "Promotion retro (Feb–Mar)", ar: "ترقية بأثر رجعي (فبراير-مارس)" },
          { en: "Pending", ar: "معلّق" },
        ],
        [
          { en: "Noura Al-Salem", ar: "نورة السالم" },
          { en: "Vertex Tech", ar: "فيرتكس" },
          { en: "Salary increase (Apr 1)", ar: "زيادة راتب (1 أبريل)" },
          { en: "Pending", ar: "معلّق" },
        ],
        [
          { en: "Sarah Johnson", ar: "سارة جونسون" },
          { en: "Vertex Tech", ar: "فيرتكس" },
          { en: "Q1 bonus", ar: "مكافأة الربع الأول" },
          { en: "Pending", ar: "معلّق" },
        ],
        [
          { en: "Fatima Al-Zahrani", ar: "فاطمة الزهراني" },
          { en: "Luma Retail", ar: "لوما للتجزئة" },
          { en: "Annual leave (21 days)", ar: "إجازة سنوية (21 يوماً)" },
          { en: "Pending", ar: "معلّق" },
        ],
        [
          { en: "Khalid Al-Otaibi", ar: "خالد العتيبي" },
          { en: "Luma Retail", ar: "لوما للتجزئة" },
          { en: "Onboarding (first payroll)", ar: "توظيف جديد (أول راتب)" },
          { en: "Pending", ar: "معلّق" },
        ],
      ],
    },
    {
      id: "last-month-summary",
      kind: "metric-grid",
      title: {
        en: "Last Month Summary — March 2026",
        ar: "ملخّص الشهر السابق — مارس 2026",
      },
      rows: [
        [
          { en: "Metric", ar: "المؤشر" },
          { en: "Value", ar: "القيمة" },
        ],
        [
          { en: "Total Gross", ar: "إجمالي الرواتب" },
          { en: "SAR 478,200", ar: "478,200 ريال" },
        ],
        [
          { en: "GOSI Contributions", ar: "اشتراكات التأمينات" },
          { en: "SAR 49,180", ar: "49,180 ريال" },
        ],
        [
          { en: "Total Net", ar: "إجمالي الصافي" },
          { en: "SAR 429,020", ar: "429,020 ريال" },
        ],
        [
          { en: "Exceptions", ar: "الاستثناءات" },
          { en: "3 (1.4%)", ar: "3 (1.4%)" },
        ],
      ],
    },
  ],
  events: [
    // ─── Phase 1: Planning & Document Processing (e01–e07) ───────────────
    {
      id: "e01",
      kind: "think",
      agentId: "payroll-orchestrator",
      label: { en: "Plan April 2026 payroll cycle", ar: "تخطيط دورة رواتب أبريل 2026" },
      detail: {
        en: "Analyzing 3 clients, 42 employees. Identified 6 pending changes: 1 separation (Al-Ghamdi), 1 promotion retro (Al-Rashidi), 1 salary increase (Al-Salem), 1 bonus (Johnson), 1 leave request (Al-Zahrani), 1 onboarding (Al-Otaibi). Scheduling Document Intelligence first for the 4 uploaded letters.",
        ar: "تحليل 3 عملاء، 42 موظفاً. تم تحديد 6 تغييرات معلّقة: إنهاء خدمة (الغامدي)، تسوية ترقية (الرشيدي)، زيادة راتب (السالم)، مكافأة (جونسون)، طلب إجازة (الزهراني)، توظيف جديد (العتيبي). جدولة وكيل ذكاء الوثائق أولاً للخطابات الأربعة المرفوعة.",
      },
    },
    {
      id: "e02",
      kind: "update-inbox",
      agentId: "payroll-orchestrator",
      label: { en: "Pick up monthly cycle inbox item", ar: "التقاط بند دورة الشهر من الوارد" },
      inboxUpdate: { id: "inbox-monthly-cycle", status: "in-progress" },
    },
    {
      id: "e03",
      kind: "handoff",
      agentId: "payroll-orchestrator",
      toAgentId: "doc-intelligence",
      label: {
        en: "Route 4 documents for digitization",
        ar: "توجيه 4 وثائق للرقمنة",
      },
    },
    {
      id: "e04",
      kind: "tool-call",
      agentId: "doc-intelligence",
      toolName: "digitize_document",
      toolArgs: { batch: "4 documents", source: "HR upload queue" },
      label: { en: "Digitize uploaded HR documents", ar: "رقمنة وثائق الموارد البشرية المرفوعة" },
      toolResult: {
        en: "Processed 4 documents:\n• Promotion Letter (Ahmed Al-Rashidi): Extracted — Position: Senior Engineer → Project Manager, Effective: Feb 1 2026, New Basic: SAR 18,000. Confidence: 97%\n• Salary Increase Letter (Noura Al-Salem): Extracted — Current: SAR 15,000 → New: SAR 17,000, Effective: Apr 1 2026, Reason: Performance. Confidence: 98%\n• Bonus Letter (Sarah Johnson): Extracted — Amount: SAR 15,000, Type: Q1 Performance, Payment: April payroll. Confidence: 99%\n• Termination Letter (Mohammad Al-Ghamdi): Extracted — Type: Mutual Agreement (Article 74), Last Day: Apr 30 2026, EOSB: Eligible. Confidence: 96%",
        ar: "تمت معالجة 4 وثائق:\n• خطاب ترقية (أحمد الرشيدي): استُخرج — المنصب: مهندس أول ← مدير مشروع، السريان: 1 فبراير 2026، الراتب الأساسي الجديد: 18,000 ريال. الثقة: 97%\n• خطاب زيادة راتب (نورة السالم): استُخرج — الحالي: 15,000 ← الجديد: 17,000 ريال، السريان: 1 أبريل 2026، السبب: الأداء. الثقة: 98%\n• خطاب مكافأة (سارة جونسون): استُخرج — المبلغ: 15,000 ريال، النوع: أداء الربع الأول، الدفع: راتب أبريل. الثقة: 99%\n• خطاب إنهاء خدمة (محمد الغامدي): استُخرج — النوع: اتفاق متبادل (المادة 74)، آخر يوم: 30 أبريل 2026، مكافأة نهاية الخدمة: مستحقّة. الثقة: 96%",
      },
    },
    {
      id: "e05",
      kind: "patch-workspace",
      agentId: "doc-intelligence",
      label: { en: "Publish digitized documents widget", ar: "نشر لوحة الوثائق المرقمنة" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "digitized-docs",
          kind: "table",
          title: { en: "Digitized Documents", ar: "الوثائق المرقمنة" },
          rows: [
            [
              { en: "Document", ar: "الوثيقة" },
              { en: "Employee", ar: "الموظف" },
              { en: "Key Field", ar: "الحقل الرئيسي" },
              { en: "Confidence", ar: "الثقة" },
            ],
            [
              { en: "Promotion Letter", ar: "خطاب ترقية" },
              { en: "Ahmed Al-Rashidi", ar: "أحمد الرشيدي" },
              { en: "Sr Engineer → PM, SAR 18,000", ar: "مهندس أول ← مدير مشروع، 18,000 ريال" },
              { en: "97%", ar: "97%" },
            ],
            [
              { en: "Salary Increase", ar: "زيادة راتب" },
              { en: "Noura Al-Salem", ar: "نورة السالم" },
              { en: "SAR 15,000 → 17,000 (Apr 1)", ar: "15,000 ← 17,000 ريال (1 أبريل)" },
              { en: "98%", ar: "98%" },
            ],
            [
              { en: "Bonus Letter", ar: "خطاب مكافأة" },
              { en: "Sarah Johnson", ar: "سارة جونسون" },
              { en: "Q1 Bonus SAR 15,000", ar: "مكافأة الربع الأول 15,000 ريال" },
              { en: "99%", ar: "99%" },
            ],
            [
              { en: "Termination Letter", ar: "خطاب إنهاء خدمة" },
              { en: "Mohammad Al-Ghamdi", ar: "محمد الغامدي" },
              { en: "Article 74, last day Apr 30", ar: "المادة 74، آخر يوم 30 أبريل" },
              { en: "96%", ar: "96%" },
            ],
          ],
        },
      },
    },
    {
      id: "e06",
      kind: "update-inbox",
      agentId: "doc-intelligence",
      label: { en: "Mark new documents as resolved", ar: "تعليم الوثائق الجديدة كمنتهية" },
      inboxUpdate: { id: "inbox-new-documents", status: "resolved" },
    },
    {
      id: "e07",
      kind: "handoff",
      agentId: "doc-intelligence",
      toAgentId: "employee-records",
      label: {
        en: "Route extracted data for record updates",
        ar: "توجيه البيانات المستخرجة لتحديث السجلات",
      },
    },

    // ─── Phase 2: Employee Record Updates (e08–e12) ──────────────────────
    {
      id: "e08",
      kind: "tool-call",
      agentId: "employee-records",
      label: {
        en: "Process Ahmed Al-Rashidi promotion",
        ar: "معالجة ترقية أحمد الرشيدي",
      },
      toolResult: {
        en: "Updated employee record #EMP-NK-003:\n• Position: Senior Engineer → Project Manager\n• Effective: Feb 1, 2026\n• Salary change: Basic SAR 15,000 → SAR 18,000, Housing SAR 3,750 → SAR 4,500\n• Retroactive adjustment required: 2 months (Feb, Mar)\n• Retro amount: (18,000 - 15,000) × 2 + (4,500 - 3,750) × 2 = SAR 7,500\n• GOSI impact: Employer increase SAR 300/month, Employee increase SAR 250/month",
        ar: "تم تحديث سجل الموظف #EMP-NK-003:\n• المنصب: مهندس أول ← مدير مشروع\n• السريان: 1 فبراير 2026\n• تغيير الراتب: الأساسي 15,000 ← 18,000 ريال، السكن 3,750 ← 4,500 ريال\n• تسوية بأثر رجعي مطلوبة: شهران (فبراير، مارس)\n• مبلغ التسوية: (18,000 - 15,000) × 2 + (4,500 - 3,750) × 2 = 7,500 ريال\n• أثر التأمينات: زيادة صاحب العمل 300 ريال/شهر، زيادة الموظف 250 ريال/شهر",
      },
    },
    {
      id: "e09",
      kind: "tool-call",
      agentId: "employee-records",
      label: {
        en: "Process Mohammad Al-Ghamdi separation",
        ar: "معالجة إنهاء خدمة محمد الغامدي",
      },
      toolResult: {
        en: "Employee #EMP-NK-001 separation initiated:\n• Type: Mutual agreement (Article 74)\n• Last working day: April 30, 2026\n• Tenure: 12 years, 3 months\n• Status changed: Active → Notice Period\n• EOSB eligibility: Full (employer-initiated mutual agreement)\n• Pending items: GOSI deregistration, final settlement calculation, leave encashment\n• EOSB flag: Routed to EOSB Provisions Agent",
        ar: "تم بدء إنهاء خدمة الموظف #EMP-NK-001:\n• النوع: اتفاق متبادل (المادة 74)\n• آخر يوم عمل: 30 أبريل 2026\n• مدة الخدمة: 12 سنة و3 أشهر\n• تغيير الحالة: نشط ← فترة إشعار\n• استحقاق مكافأة نهاية الخدمة: كامل (اتفاق متبادل من جانب صاحب العمل)\n• البنود المعلّقة: إلغاء تسجيل التأمينات، احتساب التسوية النهائية، بدل الإجازات\n• إشارة المكافأة: محوَّلة إلى وكيل مخصصات نهاية الخدمة",
      },
    },
    {
      id: "e10",
      kind: "tool-call",
      agentId: "employee-records",
      label: {
        en: "Process Noura Al-Salem increase and Khalid Al-Otaibi GOSI",
        ar: "معالجة زيادة نورة السالم وتأمينات خالد العتيبي",
      },
      toolResult: {
        en: "2 updates processed:\n• Noura Al-Salem (EMP-VT-002): Basic SAR 15,000 → SAR 17,000 effective Apr 1. Housing adjusted to SAR 4,250. GOSI employer increase: SAR 240/month\n• Khalid Al-Otaibi (EMP-LR-008): New hire GOSI registration submitted. GOSI# pending confirmation. Probation month 2/3. First payroll this cycle.",
        ar: "تمت معالجة تحديثين:\n• نورة السالم (EMP-VT-002): الأساسي 15,000 ← 17,000 ريال اعتباراً من 1 أبريل. تم تعديل السكن إلى 4,250 ريال. زيادة حصة صاحب العمل في التأمينات: 240 ريال/شهر\n• خالد العتيبي (EMP-LR-008): تم إرسال تسجيل التأمينات لموظف جديد. رقم التأمينات في انتظار التأكيد. شهر التجربة 2/3. أول راتب هذه الدورة.",
      },
    },
    {
      id: "e11",
      kind: "patch-workspace",
      agentId: "employee-records",
      label: {
        en: "Update pending changes — all processed",
        ar: "تحديث التغييرات المعلّقة — تمت كلها",
      },
      workspacePatch: {
        op: "update",
        id: "pending-changes",
        rows: [
          [
            { en: "Employee", ar: "الموظف" },
            { en: "Client", ar: "العميل" },
            { en: "Change Type", ar: "نوع التغيير" },
            { en: "Status", ar: "الحالة" },
          ],
          [
            { en: "Mohammad Al-Ghamdi", ar: "محمد الغامدي" },
            { en: "Al-Nakhla", ar: "النخلة" },
            { en: "Separation (Apr 30)", ar: "إنهاء خدمة (30 أبريل)" },
            { en: "Processed ✓", ar: "تمت ✓" },
          ],
          [
            { en: "Ahmed Al-Rashidi", ar: "أحمد الرشيدي" },
            { en: "Al-Nakhla", ar: "النخلة" },
            { en: "Promotion retro (Feb–Mar)", ar: "ترقية بأثر رجعي (فبراير-مارس)" },
            { en: "Processed ✓", ar: "تمت ✓" },
          ],
          [
            { en: "Noura Al-Salem", ar: "نورة السالم" },
            { en: "Vertex Tech", ar: "فيرتكس" },
            { en: "Salary increase (Apr 1)", ar: "زيادة راتب (1 أبريل)" },
            { en: "Processed ✓", ar: "تمت ✓" },
          ],
          [
            { en: "Sarah Johnson", ar: "سارة جونسون" },
            { en: "Vertex Tech", ar: "فيرتكس" },
            { en: "Q1 bonus", ar: "مكافأة الربع الأول" },
            { en: "Processed ✓", ar: "تمت ✓" },
          ],
          [
            { en: "Fatima Al-Zahrani", ar: "فاطمة الزهراني" },
            { en: "Luma Retail", ar: "لوما للتجزئة" },
            { en: "Annual leave (21 days)", ar: "إجازة سنوية (21 يوماً)" },
            { en: "Processed ✓", ar: "تمت ✓" },
          ],
          [
            { en: "Khalid Al-Otaibi", ar: "خالد العتيبي" },
            { en: "Luma Retail", ar: "لوما للتجزئة" },
            { en: "Onboarding (first payroll)", ar: "توظيف جديد (أول راتب)" },
            { en: "Processed ✓", ar: "تمت ✓" },
          ],
        ],
      },
    },
    {
      id: "e12",
      kind: "handoff",
      agentId: "employee-records",
      toAgentId: "salary-calc",
      label: {
        en: "Route updated records for payroll calculation",
        ar: "توجيه السجلات المحدّثة لاحتساب الرواتب",
      },
    },

    // ─── Phase 3: Payroll Calculations (e13–e18) ─────────────────────────
    {
      id: "e13",
      kind: "tool-call",
      agentId: "salary-calc",
      toolName: "calculate_payroll",
      toolArgs: { client: "Al-Nakhla Construction", employees: "18", cycle: "April 2026" },
      label: {
        en: "Calculate Al-Nakhla Construction payroll",
        ar: "احتساب رواتب النخلة للمقاولات",
      },
      toolResult: {
        en: "Al-Nakhla Construction — 18 employees:\n• Regular payroll (17 active): Gross SAR 209,300, GOSI employer SAR 15,850, GOSI employee SAR 11,250, Net SAR 198,050\n• Final settlement (Al-Ghamdi): EOSB SAR 166,250, Leave encashment SAR 10,500, Remaining salary SAR 19,700 = SAR 196,450\n• Ahmed Al-Rashidi retro: +SAR 7,500 (Feb-Mar differential)\n• Overtime: 3 employees, total SAR 4,200 (site workers, 150% rate)\n• Total client gross: SAR 228,400 (+SAR 196,450 settlement)",
        ar: "النخلة للمقاولات — 18 موظفاً:\n• الرواتب العادية (17 نشطاً): الإجمالي 209,300 ريال، حصة صاحب العمل 15,850، حصة الموظف 11,250، الصافي 198,050 ريال\n• التسوية النهائية (الغامدي): مكافأة نهاية الخدمة 166,250 + بدل الإجازات 10,500 + الراتب المتبقي 19,700 = 196,450 ريال\n• تسوية أحمد الرشيدي: +7,500 ريال (فرق فبراير-مارس)\n• الإضافي: 3 موظفين، الإجمالي 4,200 ريال (عمال موقع، بمعدل 150%)\n• إجمالي العميل: 228,400 ريال (+196,450 ريال تسوية)",
      },
    },
    {
      id: "e14",
      kind: "tool-call",
      agentId: "salary-calc",
      toolName: "calculate_payroll",
      toolArgs: { client: "Luma Retail Group", employees: "14", cycle: "April 2026" },
      label: { en: "Calculate Luma Retail payroll", ar: "احتساب رواتب لوما للتجزئة" },
      toolResult: {
        en: "Luma Retail Group — 14 employees:\n• Gross SAR 142,200, GOSI employer SAR 9,870, GOSI employee SAR 7,500, Net SAR 134,700\n• First payroll for Khalid Al-Otaibi: Basic SAR 5,000, Housing SAR 1,250 = Net SAR 6,250\n• Fatima Al-Zahrani vacation salary advance: SAR 11,200 (21 days × SAR 533.33/day)\n• No exceptions",
        ar: "مجموعة لوما للتجزئة — 14 موظفاً:\n• الإجمالي 142,200 ريال، حصة صاحب العمل 9,870، حصة الموظف 7,500، الصافي 134,700 ريال\n• أول راتب لخالد العتيبي: الأساسي 5,000 + السكن 1,250 = الصافي 6,250 ريال\n• سُلفة راتب إجازة فاطمة الزهراني: 11,200 ريال (21 يوماً × 533.33 ريال/يوم)\n• لا توجد استثناءات",
      },
    },
    {
      id: "e15",
      kind: "tool-call",
      agentId: "salary-calc",
      toolName: "calculate_payroll",
      toolArgs: { client: "Vertex Tech Solutions", employees: "10", cycle: "April 2026" },
      label: { en: "Calculate Vertex Tech payroll", ar: "احتساب رواتب فيرتكس" },
      toolResult: {
        en: "Vertex Tech Solutions — 10 employees:\n• Gross SAR 168,500, GOSI employer SAR 5,700, GOSI employee SAR 0 (mixed), Net SAR 162,800\n• Noura Al-Salem: New basic SAR 17,000, first month at increased rate\n• Sarah Johnson bonus: SAR 15,000 added to April payroll\n• Note: 5 non-Saudi employees — OHRP only (SAR 625/month each)\n• Saudization: 5 Saudi / 10 total = 50% (Yellow band — below 55% Green-Low threshold)",
        ar: "فيرتكس لحلول التقنية — 10 موظفين:\n• الإجمالي 168,500 ريال، حصة صاحب العمل 5,700، حصة الموظف 0 (مختلط)، الصافي 162,800 ريال\n• نورة السالم: الأساسي الجديد 17,000 ريال، أول شهر بالمعدل المرفوع\n• مكافأة سارة جونسون: 15,000 ريال أضيفت لراتب أبريل\n• ملاحظة: 5 موظفين غير سعوديين — تأمين أخطار العمل فقط (625 ريال/شهر لكل منهم)\n• التوطين: 5 سعوديين / 10 إجمالي = 50% (نطاق أصفر — تحت 55% حد الأخضر المنخفض)",
      },
    },
    {
      id: "e16",
      kind: "update-kpi",
      agentId: "salary-calc",
      label: { en: "Payroll Accuracy nudged to 99.8%", ar: "ارتفاع دقة الرواتب إلى 99.8%" },
      kpiPatch: { id: "payroll-accuracy", value: "99.8%", delta: "+0.1%" },
    },
    {
      id: "e17",
      kind: "tool-call",
      agentId: "leave-attendance",
      toolName: "validate_leave_request",
      toolArgs: { scope: "all clients", cycle: "April 2026" },
      label: {
        en: "Validate leave requests and calculate vacation salary",
        ar: "التحقق من طلبات الإجازات واحتساب راتب الإجازة",
      },
      toolResult: {
        en: "Leave reconciliation complete:\n• Fatima Al-Zahrani: Annual leave 21 days approved. Balance before: 21 days. Balance after: 0 days. Vacation salary advance: SAR 11,200 (payable before leave start May 5)\n• Aisha Al-Harbi: Maternity leave 70 days flagged for next month (starts May 15). Payroll impact: Full salary SAR 13,750/month for 70 days\n• Mohammad Al-Ghamdi: 18 unused annual leave days → encashment SAR 10,500 added to final settlement",
        ar: "اكتملت تسوية الإجازات:\n• فاطمة الزهراني: تمت الموافقة على إجازة سنوية 21 يوماً. الرصيد قبلها: 21 يوماً. بعدها: 0. سُلفة راتب الإجازة: 11,200 ريال (تُدفع قبل بداية الإجازة في 5 مايو)\n• عائشة الحربي: إجازة وضع 70 يوماً مُميزة للشهر القادم (تبدأ 15 مايو). أثر الرواتب: الراتب الكامل 13,750 ريال/شهر لمدة 70 يوماً\n• محمد الغامدي: 18 يوماً إجازة سنوية غير مُستخدمة ← بدل 10,500 ريال أُضيف للتسوية النهائية",
      },
    },
    {
      id: "e18",
      kind: "tool-call",
      agentId: "eosb-provisions",
      toolName: "calculate_eosb",
      toolArgs: { scope: "Al-Ghamdi separation + monthly provisions for 41 employees" },
      label: {
        en: "Calculate EOSB provisions and final settlement",
        ar: "احتساب مخصصات نهاية الخدمة والتسوية النهائية",
      },
      toolResult: {
        en: "EOSB Calculations:\n• Mohammad Al-Ghamdi (separation): Tenure 12y3m. Calculation base: SAR 17,500 (basic 14,000 + housing 3,500). First 5 years: 5 × 0.5 × 17,500 = SAR 43,750. Next 7 years: 7 × 1.0 × 17,500 = SAR 122,500. Total EOSB: SAR 166,250. Termination type: mutual agreement → 100% payable.\n• Monthly provisions updated for 41 remaining employees. Total monthly provision: SAR 12,450. Largest accruals: Ahmed Al-Rashidi SAR 1,875/month, Aisha Al-Harbi SAR 1,145/month.",
        ar: "احتساب مكافأة نهاية الخدمة:\n• محمد الغامدي (إنهاء خدمة): مدة الخدمة 12 سنة و3 أشهر. أساس الاحتساب: 17,500 ريال (الأساسي 14,000 + السكن 3,500). أول 5 سنوات: 5 × 0.5 × 17,500 = 43,750 ريال. السنوات الـ7 التالية: 7 × 1.0 × 17,500 = 122,500 ريال. إجمالي المكافأة: 166,250 ريال. نوع الإنهاء: اتفاق متبادل ← مستحقّة 100%.\n• تحديث المخصصات الشهرية لـ41 موظفاً متبقياً. إجمالي المخصصات الشهرية: 12,450 ريال. أكبر الاستحقاقات: أحمد الرشيدي 1,875 ريال/شهر، عائشة الحربي 1,145 ريال/شهر.",
      },
    },

    // ─── Phase 4: GOSI & Compliance (e19–e22) ────────────────────────────
    {
      id: "e19",
      kind: "tool-call",
      agentId: "gosi-compliance",
      toolName: "generate_gosi_file",
      toolArgs: { cycle: "April 2026", employees: "42" },
      label: { en: "Generate GOSI contribution file", ar: "إنشاء ملف اشتراكات التأمينات" },
      toolResult: {
        en: "GOSI Monthly File — April 2026:\n• Total employees: 42 (27 Saudi, 15 non-Saudi)\n• Saudi annuity: Employer 12% = SAR 25,920, Employee 10% = SAR 18,750\n• OHRP (all employees): Employer 2% = SAR 5,500\n• Total employer contribution: SAR 31,420\n• Total employee deduction: SAR 18,750\n• Pending actions: New registration — Khalid Al-Otaibi (GOSI# to be assigned). Deregistration — Mohammad Al-Ghamdi (effective Apr 30).\n• Filing deadline: May 15, 2026 — 15 days remaining",
        ar: "ملف التأمينات الشهري — أبريل 2026:\n• إجمالي الموظفين: 42 (27 سعودي، 15 غير سعودي)\n• المعاش السعودي: صاحب العمل 12% = 25,920 ريال، الموظف 10% = 18,750 ريال\n• تأمين أخطار العمل (الجميع): صاحب العمل 2% = 5,500 ريال\n• إجمالي حصة صاحب العمل: 31,420 ريال\n• إجمالي خصم الموظفين: 18,750 ريال\n• الإجراءات المعلّقة: تسجيل جديد — خالد العتيبي (رقم التأمينات قيد الإصدار). إلغاء تسجيل — محمد الغامدي (اعتباراً من 30 أبريل).\n• الموعد النهائي للإيداع: 15 مايو 2026 — متبقي 15 يوماً",
      },
    },
    {
      id: "e20",
      kind: "tool-call",
      agentId: "compliance-audit",
      toolName: "run_compliance_check",
      toolArgs: { scope: "Saudization, Iqama, Qiwa, working hours" },
      label: { en: "Run compliance and Saudization audit", ar: "تنفيذ تدقيق الامتثال والتوطين" },
      toolResult: {
        en: "Compliance Audit Results:\n• Al-Nakhla Construction: Saudization 61% (Green-Low ✓). 2 Iqama renewals due within 60 days (Rajesh Kumar, Ali Mahmoud). 1 contract expiring Q3.\n• Luma Retail: Saudization 79% (Green-Mid ✓). All Iqamas current. No flags.\n• Vertex Tech: Saudization 50% (Yellow ⚠). Below minimum 55% for Green-Low. Recommendation: Hire 1 Saudi employee or transfer 1 Saudi from another department. MOHRS review risk: Medium. Action plan drafted.\n• Labor law compliance: All contracts authenticated on Qiwa ✓. Working hours within limits ✓. Overtime properly compensated ✓.",
        ar: "نتائج تدقيق الامتثال:\n• النخلة للمقاولات: التوطين 61% (أخضر منخفض ✓). تجديد إقامتين مستحقّ خلال 60 يوماً (راجيش كومار، علي محمود). عقد واحد ينتهي في الربع الثالث.\n• لوما للتجزئة: التوطين 79% (أخضر متوسط ✓). جميع الإقامات سارية. لا توجد تنبيهات.\n• فيرتكس: التوطين 50% (أصفر ⚠). تحت الحد الأدنى 55% للأخضر المنخفض. التوصية: تعيين سعودي واحد أو نقل سعودي من قسم آخر. خطر مراجعة وزارة الموارد البشرية: متوسط. تم إعداد خطة عمل.\n• الالتزام بنظام العمل: جميع العقود موثّقة في قِوى ✓. ساعات العمل ضمن الحدود ✓. الإضافي مُعوّض بشكل صحيح ✓.",
      },
    },
    {
      id: "e21",
      kind: "emit-inbox",
      agentId: "compliance-audit",
      label: {
        en: "Emit Saudization action plan inbox item",
        ar: "إصدار بند خطة عمل التوطين في الوارد",
      },
      inboxItem: {
        id: "inbox-saudization-action",
        source: { en: "Compliance & Audit Agent", ar: "وكيل الامتثال والتدقيق" },
        subject: {
          en: "Saudization Action Plan — Vertex Tech",
          ar: "خطة عمل التوطين — شركة فيرتكس",
        },
        preview: {
          en: "Vertex Tech at 50% Saudization (Yellow). Recommended actions: (1) Hire 1 Saudi within 30 days to reach Green-Low (55%), (2) Stagger non-Saudi renewals, (3) Engage HRDF for hiring incentives. Awaiting Compliance Officer approval.",
          ar: "فيرتكس عند 50% توطين (أصفر). الإجراءات الموصى بها: (1) تعيين سعودي خلال 30 يوماً للوصول للأخضر المنخفض (55%)، (2) جدولة تجديدات غير السعوديين بشكل متدرّج، (3) التعاون مع صندوق تنمية الموارد البشرية لحوافز التوظيف. بانتظار موافقة مسؤول الامتثال.",
        },
        receivedAt: "May 1, 11:20",
        status: "awaiting-human",
        accent: "#DC2626",
      },
    },
    {
      id: "e22",
      kind: "patch-workspace",
      agentId: "compliance-audit",
      label: { en: "Publish compliance summary widget", ar: "نشر لوحة ملخّص الامتثال" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "compliance-summary",
          kind: "table",
          title: { en: "Compliance Summary", ar: "ملخّص الامتثال" },
          rows: [
            [
              { en: "Client", ar: "العميل" },
              { en: "Saudization", ar: "التوطين" },
              { en: "GOSI Status", ar: "حالة التأمينات" },
              { en: "Flags", ar: "التنبيهات" },
            ],
            [
              { en: "Al-Nakhla Construction", ar: "النخلة للمقاولات" },
              { en: "61% Green-Low ✓", ar: "61% أخضر منخفض ✓" },
              { en: "Filed (1 dereg pending)", ar: "مُودع (إلغاء تسجيل معلّق)" },
              { en: "2 Iqama renewals", ar: "تجديد إقامتين" },
            ],
            [
              { en: "Luma Retail Group", ar: "مجموعة لوما للتجزئة" },
              { en: "79% Green-Mid ✓", ar: "79% أخضر متوسط ✓" },
              { en: "Filed (1 new reg pending)", ar: "مُودع (تسجيل جديد معلّق)" },
              { en: "None", ar: "لا يوجد" },
            ],
            [
              { en: "Vertex Tech Solutions", ar: "فيرتكس لحلول التقنية" },
              { en: "50% Yellow ⚠", ar: "50% أصفر ⚠" },
              { en: "Filed", ar: "مُودع" },
              { en: "Action plan required", ar: "خطة عمل مطلوبة" },
            ],
          ],
        },
      },
    },

    // ─── Checkpoint 1: Payroll Manager (e23) ─────────────────────────────
    {
      id: "e23",
      kind: "checkpoint",
      agentId: "payroll-orchestrator",
      checkpointId: "payroll-manager",
      label: {
        en: "Payroll Manager approval required",
        ar: "موافقة مدير الرواتب مطلوبة",
      },
    },

    // ─── Phase 5: Financial Processing (e24–e26) ─────────────────────────
    {
      id: "e24",
      kind: "tool-call",
      agentId: "bank-transfer",
      toolName: "prepare_bank_transfers",
      toolArgs: { transactions: "43", banks: "4" },
      label: { en: "Prepare bank transfer file", ar: "تجهيز ملف التحويلات البنكية" },
      toolResult: {
        en: "Bank Transfer File Generated:\n• Total transactions: 43 (41 salaries + 1 final settlement + 1 bonus)\n• Total amount: SAR 487,250\n• Bank distribution: Al-Rajhi Bank (18 transfers, SAR 198,400), SNB (12 transfers, SAR 142,300), Riyad Bank (8 transfers, SAR 98,550), SAB (5 transfers, SAR 48,000)\n• IBAN validation: 41/43 passed ✓\n• Flagged: Rajesh Kumar — Iqama expiry in 45 days, bank may hold transfer. Khalid Al-Otaibi — First payroll, verify GOSI confirmation before release.\n• Reconciliation: Previous month balance SAR 0. This month: SAR 487,250. Variance explained by settlement + bonus.",
        ar: "تم إنشاء ملف التحويلات البنكية:\n• إجمالي العمليات: 43 (41 راتباً + تسوية نهائية + مكافأة)\n• إجمالي المبلغ: 487,250 ريال\n• توزيع البنوك: مصرف الراجحي (18 تحويلاً، 198,400 ريال)، الأهلي السعودي (12 تحويلاً، 142,300 ريال)، الرياض (8 تحويلات، 98,550 ريال)، الأول (5 تحويلات، 48,000 ريال)\n• التحقق من الآيبان: 41/43 نجح ✓\n• المُميَّز: راجيش كومار — انتهاء الإقامة خلال 45 يوماً، قد يُعلِّق البنك التحويل. خالد العتيبي — أول راتب، تحقّق من تأكيد التأمينات قبل الإرسال.\n• التسوية: رصيد الشهر السابق 0 ريال. هذا الشهر: 487,250 ريال. الفرق يُعزى إلى التسوية والمكافأة.",
      },
    },
    {
      id: "e25",
      kind: "tool-call",
      agentId: "mudad-filing",
      toolName: "prepare_mudad_file",
      toolArgs: { records: "43", amount: "SAR 487,250" },
      label: { en: "Generate Mudad wage protection file", ar: "إنشاء ملف حماية الأجور في نظام مُدد" },
      toolResult: {
        en: "Mudad File Prepared:\n• File format: Mudad v3.2 compliant\n• 43 employee records with IBAN, net salary, payment reference\n• Total protected wages: SAR 487,250\n• Employer Mudad ID: verified ✓\n• Bank connectivity: All 4 banks confirmed active in Mudad network\n• Estimated processing: 1-2 business days after submission",
        ar: "تم تجهيز ملف نظام مُدد:\n• تنسيق الملف: متوافق مع نظام مُدد إصدار 3.2\n• 43 سجلاً للموظفين مع الآيبان والصافي ومرجع الدفع\n• إجمالي الأجور المحميّة: 487,250 ريال\n• معرّف صاحب العمل في نظام مُدد: مُتحقَّق منه ✓\n• اتصال البنوك: جميع البنوك الأربعة مؤكّدة نشطة في شبكة نظام مُدد\n• المعالجة المقدّرة: 1-2 يوم عمل بعد الإرسال",
      },
    },
    {
      id: "e26",
      kind: "update-kpi",
      agentId: "compliance-audit",
      label: {
        en: "SLA Compliance up to 97.1%",
        ar: "ارتفاع الالتزام بالخدمة إلى 97.1%",
      },
      kpiPatch: { id: "sla-compliance", value: "97.1%", delta: "+0.9%" },
    },
    {
      id: "e26b",
      kind: "update-kpi",
      agentId: "compliance-audit",
      label: {
        en: "Exception Rate down to 1.8%",
        ar: "انخفاض نسبة الاستثناءات إلى 1.8%",
      },
      kpiPatch: { id: "exception-rate", value: "1.8%", delta: "-0.3%" },
    },

    // ─── Checkpoint 2: Finance Controller (e27) ──────────────────────────
    {
      id: "e27",
      kind: "checkpoint",
      agentId: "payroll-orchestrator",
      checkpointId: "finance-controller",
      label: {
        en: "Finance Controller approval required",
        ar: "موافقة المراقب المالي مطلوبة",
      },
    },

    // ─── Phase 6: Submission & Audit (e28–e32) ───────────────────────────
    {
      id: "e28",
      kind: "think",
      agentId: "mudad-filing",
      label: { en: "Submit Mudad transfers", ar: "إرسال تحويلات نظام مُدد" },
      detail: {
        en: "43 transfers submitted to Mudad platform. Awaiting bank processing confirmation. Estimated completion: 1-2 business days.",
        ar: "تم إرسال 43 تحويلاً إلى منصّة نظام مُدد. بانتظار تأكيد معالجة البنوك. الإكمال المقدّر: 1-2 يوم عمل.",
      },
    },
    {
      id: "e29",
      kind: "think",
      agentId: "gosi-compliance",
      label: { en: "Prepare GOSI submission", ar: "تجهيز إيداع التأمينات" },
      detail: {
        en: "GOSI file finalized with new registration and deregistration. Ready for Compliance Officer approval before portal submission.",
        ar: "تم اعتماد ملف التأمينات النهائي مع التسجيل الجديد وإلغاء التسجيل. جاهز لموافقة مسؤول الامتثال قبل الإرسال للبوابة.",
      },
    },
    {
      id: "e30",
      kind: "tool-call",
      agentId: "compliance-audit",
      label: {
        en: "Generate audit trail and final report",
        ar: "إنشاء سجل التدقيق والتقرير النهائي",
      },
      toolResult: {
        en: "April 2026 Payroll Audit Report:\n• Processing time: 3.5 hours (vs. 4.2 target — 17% improvement)\n• Agent actions: 847 total (think: 42, tool-calls: 156, handoffs: 38, decisions: 12)\n• Human touch points: 3 (Payroll Manager, Finance Controller, Compliance Officer)\n• Exceptions: 2 (Rajesh Iqama flag, Khalid first payroll flag) — both resolved\n• Accuracy: 99.9% — 1 minor rounding correction auto-applied\n• Compliance: All 3 clients within Nitaqat requirements (Vertex Tech action plan in progress)\n• Automation rate: 93.4% of tasks completed without human intervention",
        ar: "تقرير تدقيق رواتب أبريل 2026:\n• زمن المعالجة: 3.5 ساعة (مقابل المستهدف 4.2 — تحسّن 17%)\n• إجراءات الوكلاء: 847 إجمالاً (تفكير: 42، استدعاءات أدوات: 156، تسليمات: 38، قرارات: 12)\n• نقاط التماس البشرية: 3 (مدير الرواتب، المراقب المالي، مسؤول الامتثال)\n• الاستثناءات: 2 (تنبيه إقامة راجيش، تنبيه أول راتب لخالد) — تم حلّ كليهما\n• الدقة: 99.9% — تم تطبيق تصحيح تقريب بسيط آلياً\n• الامتثال: جميع العملاء الثلاثة ضمن متطلبات نطاقات (خطة عمل فيرتكس قيد التنفيذ)\n• نسبة الأتمتة: 93.4% من المهام أُنجزت بدون تدخّل بشري",
      },
    },
    {
      id: "e31",
      kind: "patch-workspace",
      agentId: "compliance-audit",
      label: {
        en: "Update April status — all complete",
        ar: "تحديث حالة أبريل — اكتمل الكل",
      },
      workspacePatch: {
        op: "update",
        id: "april-status",
        rows: [
          [
            { en: "Client", ar: "العميل" },
            { en: "Employees", ar: "الموظفون" },
            { en: "Status", ar: "الحالة" },
          ],
          [
            { en: "Al-Nakhla Construction", ar: "النخلة للمقاولات" },
            { en: "18", ar: "18" },
            { en: "Complete ✓", ar: "اكتمل ✓" },
          ],
          [
            { en: "Luma Retail Group", ar: "مجموعة لوما للتجزئة" },
            { en: "14", ar: "14" },
            { en: "Complete ✓", ar: "اكتمل ✓" },
          ],
          [
            { en: "Vertex Tech Solutions", ar: "فيرتكس لحلول التقنية" },
            { en: "10", ar: "10" },
            { en: "Complete ✓", ar: "اكتمل ✓" },
          ],
        ],
      },
    },
    {
      id: "e32",
      kind: "update-inbox",
      agentId: "compliance-audit",
      label: {
        en: "Mark Saudization alert as action-plan-drafted",
        ar: "تعليم تنبيه التوطين بأن خطة العمل جُهّزت",
      },
      inboxUpdate: { id: "inbox-saudization-alert", status: "awaiting-human" },
    },

    // ─── Checkpoint 3: Compliance Officer (e33) ──────────────────────────
    {
      id: "e33",
      kind: "checkpoint",
      agentId: "payroll-orchestrator",
      checkpointId: "compliance-officer",
      label: {
        en: "Compliance Officer approval required",
        ar: "موافقة مسؤول الامتثال مطلوبة",
      },
    },

    // ─── Phase 7: Completion (e34–e35) ───────────────────────────────────
    {
      id: "e34a",
      kind: "update-kpi",
      agentId: "payroll-orchestrator",
      label: { en: "Payroll Accuracy finalized at 99.9%", ar: "اعتماد دقة الرواتب عند 99.9%" },
      kpiPatch: { id: "payroll-accuracy", value: "99.9%", delta: "+0.2%" },
    },
    {
      id: "e34b",
      kind: "update-kpi",
      agentId: "payroll-orchestrator",
      label: {
        en: "Avg Processing Time down to 3.5 hrs",
        ar: "انخفاض متوسط زمن المعالجة إلى 3.5 ساعة",
      },
      kpiPatch: { id: "avg-processing-time", value: "3.5 hrs", delta: "-0.7 hrs" },
    },
    {
      id: "e34c",
      kind: "update-kpi",
      agentId: "payroll-orchestrator",
      label: { en: "GOSI Filing Rate at 100%", ar: "نسبة إيداع التأمينات 100%" },
      kpiPatch: { id: "gosi-filing-rate", value: "100%", delta: "0.0%" },
    },
    {
      id: "e34d",
      kind: "update-kpi",
      agentId: "payroll-orchestrator",
      label: { en: "Mudad Compliance at 100%", ar: "الالتزام بنظام مُدد 100%" },
      kpiPatch: { id: "mudad-compliance", value: "100%", delta: "+1.5%" },
    },
    {
      id: "e34e",
      kind: "update-kpi",
      agentId: "payroll-orchestrator",
      label: { en: "Exception Rate down to 1.4%", ar: "انخفاض نسبة الاستثناءات إلى 1.4%" },
      kpiPatch: { id: "exception-rate", value: "1.4%", delta: "-0.7%" },
    },
    {
      id: "e35",
      kind: "complete",
      agentId: "payroll-orchestrator",
      label: {
        en: "April 2026 payroll cycle complete",
        ar: "اكتملت دورة رواتب أبريل 2026",
      },
      detail: {
        en: "All 3 clients filed and paid. GOSI 100%, Mudad 100%, exceptions 1.4%. Audit trail closed and archived.",
        ar: "تم إيداع ودفع جميع العملاء الثلاثة. التأمينات 100%، نظام مُدد 100%، الاستثناءات 1.4%. أُغلق سجل التدقيق وأُرشف.",
      },
    },
  ],
};

export default scenario;
