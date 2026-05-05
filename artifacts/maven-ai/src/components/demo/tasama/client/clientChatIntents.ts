import { getTasamaDataSnapshot } from "@/hooks/useTasamaData";
import {
  formatSAR,
  formatPercent,
  getMonthName,
  getEmployeeStatusLabel,
  getDocumentTypeLabel,
  getRequestTypeLabel,
  getNationalityLabel,
  getSaudizationBandLabel,
  getDepartmentLabel,
  computeGosi,
  type Lang,
  type TasamaEmployee,
  type Payslip,
  type PayrollRun,
  type ServiceRequest,
} from "@/data/tasama-seed";
import type { DemoLang } from "../DemoLangContext";

export type ChatResponseType =
  | "text"
  | "metric"
  | "table"
  | "list"
  | "progress"
  | "document-card";

export interface ChatResponse {
  text: string;
  type: ChatResponseType;
  data?: Record<string, unknown>;
}

interface ChatIntent {
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

const CLIENT_ID = "client-alnakhla";

function clientEmployees(): TasamaEmployee[] {
  return getTasamaDataSnapshot().employees.filter((e) => e.clientId === CLIENT_ID);
}

function latestPayrollRun(): PayrollRun | undefined {
  const runs = getTasamaDataSnapshot().payrollRuns.filter((r) => r.clientId === CLIENT_ID);
  return runs.sort((a, b) => (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth))[0];
}

function payslipsForRun(runId: string): Payslip[] {
  return getTasamaDataSnapshot().payslips.filter((p) => p.runId === runId);
}

function findEmployee(query: string): TasamaEmployee | undefined {
  const q = query.toLowerCase();
  return clientEmployees().find(
    (e) =>
      e.fullNameEn.toLowerCase().includes(q) ||
      e.fullNameAr.includes(query) ||
      e.id.toLowerCase().includes(q),
  );
}

const INTENTS: ChatIntent[] = [
  {
    patterns: [/payroll status/i, /this month.*payroll/i, /current payroll/i, /حالة الرواتب/i, /رواتب هذا الشهر/i],
    handler: (lang) => {
      const run = latestPayrollRun();
      if (!run) {
        return { type: "text", text: lang === "en" ? "No payroll runs yet." : "لا توجد دورات رواتب بعد." };
      }
      const period = `${getMonthName(run.periodMonth, lang as Lang)} ${run.periodYear}`;
      const statusLabel = run.status === "settled" ? (lang === "en" ? "Settled" : "تمت التسوية")
        : run.status === "approved" ? (lang === "en" ? "Approved" : "معتمد")
        : run.status === "filed" ? (lang === "en" ? "Filed" : "تم التقديم")
        : (lang === "en" ? "Draft" : "مسودة");
      return {
        type: "metric",
        text: lang === "en"
          ? `${period} payroll: ${statusLabel}\n\n• ${run.employeeCount} employees processed\n• Gross: ${formatSAR(run.totalGross)}\n• Net: ${formatSAR(run.totalNet)}\n• GOSI (employer + employee): ${formatSAR(run.totalGosiEmployer + run.totalGosiEmployee)}\n• Settled: ${run.settledAt ? new Date(run.settledAt).toLocaleDateString("en-US") : "—"}\n\nSee the Payroll tab for the full register.`
          : `رواتب ${period}: ${statusLabel}\n\n• تمت معالجة ${run.employeeCount} موظفًا\n• الإجمالي: ${formatSAR(run.totalGross)}\n• الصافي: ${formatSAR(run.totalNet)}\n• التأمينات (صاحب العمل + الموظف): ${formatSAR(run.totalGosiEmployer + run.totalGosiEmployee)}\n• تاريخ التسوية: ${run.settledAt ? new Date(run.settledAt).toLocaleDateString("ar-SA") : "—"}\n\nانتقل إلى تبويب الرواتب للسجل الكامل.`,
      };
    },
  },
  {
    patterns: [/how many employee/i, /employee count/i, /total employee/i, /كم موظف/i, /عدد الموظفين/i],
    handler: (lang) => {
      const list = clientEmployees();
      const saudi = list.filter((e) => e.isSaudi).length;
      const expat = list.length - saudi;
      const pct = list.length ? (saudi / list.length) * 100 : 0;
      return {
        type: "metric",
        text: lang === "en"
          ? `You have ${list.length} active employees:\n\n• Saudi: ${saudi}\n• Non-Saudi: ${expat}\n• Saudization: ${formatPercent(pct)}\n\nVisit the Employees tab for full details.`
          : `لديك ${list.length} موظف نشط:\n\n• سعودي: ${saudi}\n• غير سعودي: ${expat}\n• نسبة السعودة: ${formatPercent(pct)}\n\nانتقل إلى تبويب الموظفين للتفاصيل.`,
      };
    },
  },
  {
    patterns: [/upload.*document/i, /document.*upload/i, /add.*document/i, /digiti[sz]e/i, /رفع.*وثيقة/i, /وثيقة.*جديدة/i, /رقمنة/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "To upload a document:\n\n1. Open the Documents tab\n2. Click \"Upload Document\"\n3. Choose the document type and employee\n4. Drop your PDF\n\nThe Document Intelligence Agent will digitize it automatically — usually within 30 seconds — then surface a side-by-side viewer with per-field confidence so you can review before applying changes."
        : "لرفع وثيقة:\n\n1. افتح تبويب الوثائق\n2. اضغط \"رفع وثيقة\"\n3. اختر نوع الوثيقة والموظف\n4. أفلت ملف PDF\n\nسيقوم وكيل ذكاء الوثائق برقمنتها تلقائيًا — عادة خلال 30 ثانية — ثم يعرض عارضًا جنبًا إلى جنب مع ثقة لكل حقل لمراجعتها قبل التطبيق.",
    }),
  },
  {
    patterns: [/leave balance/i, /vacation/i, /annual leave/i, /رصيد.*إجازة/i, /إجازات/i],
    handler: (lang) => {
      const balances = getTasamaDataSnapshot().leaveBalances;
      const emps = clientEmployees();
      const rows = emps.slice(0, 5).map((e) => {
        const b = balances.find((lb) => lb.employeeId === e.id);
        return [
          lang === "en" ? e.fullNameEn : e.fullNameAr,
          String(b?.annualEntitlement ?? 30),
          String(b?.annualUsed ?? 0),
          String(b?.annualRemaining ?? 30),
        ];
      });
      return {
        type: "table",
        text: lang === "en" ? "Annual leave balances (top 5 employees):" : "أرصدة الإجازات السنوية (أول 5 موظفين):",
        data: {
          headers: lang === "en"
            ? ["Employee", "Entitled", "Used", "Remaining"]
            : ["الموظف", "المستحق", "المستخدم", "المتبقي"],
          rows,
        },
      };
    },
  },
  {
    patterns: [/gosi/i, /تأمينات/i, /اشتراك/i],
    handler: (lang) => {
      const run = latestPayrollRun();
      const upcoming = getTasamaDataSnapshot().regulatoryCalendar.find(
        (r) => r.eventType === "gosi-filing" && r.type === "upcoming" && (r.clientId === CLIENT_ID || r.clientId === null),
      );
      const due = upcoming ? new Date(upcoming.dueDate).toLocaleDateString(lang === "en" ? "en-US" : "ar-SA") : "—";
      return {
        type: "text",
        text: lang === "en"
          ? `GOSI snapshot:\n\n• Last cycle employer share: ${run ? formatSAR(run.totalGosiEmployer) : "—"}\n• Last cycle employee share: ${run ? formatSAR(run.totalGosiEmployee) : "—"}\n• Saudi employees pay 10% (annuity); employer pays 12% annuity + 2% OHRP. Non-Saudis: only 2% OHRP from employer.\n• Next filing deadline: ${due}\n\nThe GOSI Compliance Agent prepares filings monthly — you'll see them in the Processes tab.`
          : `لمحة عن التأمينات:\n\n• حصة صاحب العمل في الدورة الأخيرة: ${run ? formatSAR(run.totalGosiEmployer) : "—"}\n• حصة الموظف في الدورة الأخيرة: ${run ? formatSAR(run.totalGosiEmployee) : "—"}\n• السعوديون يدفعون 10% (راتب تقاعدي)؛ صاحب العمل 12% راتب تقاعدي + 2% أخطار مهنية. غير السعوديين: 2% فقط من صاحب العمل.\n• الموعد القادم: ${due}\n\nيُعدّ وكيل امتثال التأمينات الإقرارات شهريًا — تجدها في تبويب العمليات.`,
      };
    },
  },
  {
    patterns: [/saudization/i, /nitaqat/i, /سعودة/i, /نطاقات/i],
    handler: (lang) => {
      const client = getTasamaDataSnapshot().clients.find((c) => c.id === CLIENT_ID);
      if (!client) return { type: "text", text: lang === "en" ? "Client not found." : "العميل غير موجود." };
      return {
        type: "metric",
        text: lang === "en"
          ? `Saudization status:\n\n• Band: ${getSaudizationBandLabel(client.saudizationBand, "en")}\n• Saudi headcount: ${client.saudiCount} of ${client.employeeCount}\n• Saudi share: ${formatPercent(client.saudizationPercent)}\n\nMaintaining Green-Low keeps you eligible for HRDF support and visa quota. The Saudization Monitor Agent flags any drift weekly.`
          : `حالة السعودة:\n\n• النطاق: ${getSaudizationBandLabel(client.saudizationBand, "ar")}\n• عدد السعوديين: ${client.saudiCount} من ${client.employeeCount}\n• نسبة السعودة: ${formatPercent(client.saudizationPercent)}\n\nالبقاء في النطاق الأخضر المنخفض يحافظ على أهلية دعم هدف وحصص التأشيرات. يُنبّه وكيل مراقبة السعودة عن أي انحراف أسبوعيًا.`,
      };
    },
  },
  {
    patterns: [/ahmed|al.?rashidi|أحمد|الرشيدي/i],
    handler: (lang) => {
      const e = findEmployee("ahmed");
      if (!e) return { type: "text", text: lang === "en" ? "Ahmed not found." : "أحمد غير موجود." };
      const sc = getTasamaDataSnapshot().salaryComponents.find((s) => s.employeeId === e.id);
      return {
        type: "text",
        text: lang === "en"
          ? `${e.fullNameEn} (${e.id})\n\n• Position: ${e.role}\n• Department: ${getDepartmentLabel(e.department, "en")}\n• Status: ${getEmployeeStatusLabel(e.status, "en")}\n• Hired: ${new Date(e.hireDate).toLocaleDateString("en-US")} (${e.yearsOfService.toFixed(1)} yrs)\n• Nationality: ${getNationalityLabel(e.nationality, "en")}\n• Gross monthly: ${sc ? formatSAR(sc.grossMonthly) : "—"}\n\nA promotion letter from March 2026 has already been digitized for him. Open the Employees tab for the full record.`
          : `${e.fullNameAr} (${e.id})\n\n• المنصب: ${e.roleAr}\n• القسم: ${getDepartmentLabel(e.department, "ar")}\n• الحالة: ${getEmployeeStatusLabel(e.status, "ar")}\n• تاريخ التعيين: ${new Date(e.hireDate).toLocaleDateString("ar-SA")} (${e.yearsOfService.toFixed(1)} سنة)\n• الجنسية: ${getNationalityLabel(e.nationality, "ar")}\n• الإجمالي الشهري: ${sc ? formatSAR(sc.grossMonthly) : "—"}\n\nخطاب ترقيته من مارس 2026 تمت رقمنته بالفعل. افتح تبويب الموظفين لعرض السجل الكامل.`,
      };
    },
  },
  {
    patterns: [/mohammad|al.?ghamdi|محمد|الغامدي|separation|terminat/i],
    handler: (lang) => {
      const e = findEmployee("mohammad");
      if (!e) return { type: "text", text: lang === "en" ? "Mohammad not found." : "محمد غير موجود." };
      return {
        type: "text",
        text: lang === "en"
          ? `${e.fullNameEn} separation is in progress:\n\n• Termination letter digitized (97% confidence) by Document Intelligence Agent\n• EOSB calculation complete by EOSB Provision Agent — pending Finance approval\n• Final payroll line will be added to next cycle\n• GOSI deregistration scheduled by GOSI Compliance Agent\n\nTrack the full pipeline in the Processes tab.`
          : `فصل ${e.fullNameAr} قيد التنفيذ:\n\n• تمت رقمنة خطاب الإنهاء (بثقة 97%) بواسطة وكيل ذكاء الوثائق\n• اكتمل احتساب مكافأة نهاية الخدمة بواسطة وكيل المخصصات — بانتظار اعتماد المالية\n• ستضاف التسوية النهائية في دورة الرواتب القادمة\n• وكيل امتثال التأمينات سيقوم بإلغاء التسجيل\n\nتابع الدورة كاملة في تبويب العمليات.`,
      };
    },
  },
  {
    patterns: [/aisha|al.?qahtani|عائشة|القحطاني|maternity|أمومة/i],
    handler: (lang) => {
      const e = findEmployee("aisha");
      if (!e) return { type: "text", text: lang === "en" ? "Aisha not found." : "عائشة غير موجودة." };
      return {
        type: "text",
        text: lang === "en"
          ? `${e.fullNameEn} is on maternity leave:\n\n• 10 weeks fully paid (Saudi labor law Article 151)\n• Leave Management Agent paused her annual accrual and notified Payroll\n• Return-to-work date is auto-scheduled in the regulatory calendar\n• Payroll continues at full basic + housing for the leave period\n\nSee the Processes tab for the full timeline.`
          : `${e.fullNameAr} في إجازة أمومة:\n\n• 10 أسابيع مدفوعة بالكامل (المادة 151 من نظام العمل)\n• أوقف وكيل إدارة الإجازات تجميع رصيدها السنوي وأبلغ الرواتب\n• تاريخ العودة مجدول تلقائيًا في التقويم التنظيمي\n• تستمر الرواتب بالأساسي + السكن طوال فترة الإجازة\n\nانتقل إلى تبويب العمليات لعرض الجدول الزمني الكامل.`,
      };
    },
  },
  {
    patterns: [/rajesh|kumar|راجيش|كومار|iqama|إقامة/i],
    handler: (lang) => {
      const e = findEmployee("rajesh");
      if (!e) return { type: "text", text: lang === "en" ? "Rajesh not found." : "راجيش غير موجود." };
      const days = 45;
      return {
        type: "text",
        text: lang === "en"
          ? `${e.fullNameEn}'s Iqama (${e.iqamaNumber ?? "—"}) expires in ${days} days.\n\n• Saudization Monitor Agent flagged this on the regulatory calendar\n• Renewal cost is auto-scheduled into the May payroll cycle\n• You can submit the renewal request from the Service Requests tab — Client Communications Agent will route it to MOL\n\nAct before the deadline to avoid Mudad penalties.`
          : `إقامة ${e.fullNameAr} (${e.iqamaNumber ?? "—"}) تنتهي خلال ${days} يومًا.\n\n• وكيل مراقبة السعودة وضع تنبيهًا في التقويم التنظيمي\n• تم جدولة رسوم التجديد تلقائيًا في دورة رواتب مايو\n• يمكنك تقديم طلب التجديد من تبويب طلبات الخدمة — سيوجهه وكيل اتصالات العملاء إلى وزارة العمل\n\nبادر قبل الموعد لتفادي غرامات مُدد.`,
      };
    },
  },
  {
    patterns: [/salary certificate/i, /شهادة راتب/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "To request a salary certificate:\n\n1. Open Service Requests\n2. Click \"New Request\"\n3. Pick \"Salary Certificate\" and the employee\n\nThe Client Communications Agent generates the bilingual certificate (English + Arabic) within 1 hour, signed by the GM, and posts it back to your portal."
        : "لطلب شهادة راتب:\n\n1. افتح طلبات الخدمة\n2. اضغط \"طلب جديد\"\n3. اختر \"شهادة راتب\" والموظف\n\nيُنشئ وكيل اتصالات العملاء الشهادة الثنائية اللغة (عربي + إنجليزي) خلال ساعة، موقعة من المدير العام، ويعيدها إلى بوابتك.",
    }),
  },
  {
    patterns: [/agent/i, /وكيل/i, /وكلاء/i],
    handler: (lang) => ({
      type: "list",
      text: lang === "en"
        ? "Agents working for Al-Nakhla right now:\n\n• Payroll Orchestrator — runs the monthly cycle\n• Document Intelligence — digitizes uploaded PDFs\n• Salary Calculation — gross/net + retro adjustments\n• GOSI Compliance — monthly filings\n• Mudad/Bank Transfer — WPS execution\n• EOSB Provision — end-of-service accruals\n• Leave Management — balances + maternity\n• Saudization Monitor — Nitaqat band tracking\n• Performance & Audit — quality control\n• Client Communications — letters & certificates\n\nEach action shows the agent that performed it across the portal."
        : "الوكلاء الذين يعملون لشركة النخلة الآن:\n\n• منسّق الرواتب — يدير الدورة الشهرية\n• وكيل ذكاء الوثائق — يرقمن ملفات PDF المرفوعة\n• وكيل حساب الرواتب — الإجمالي/الصافي والتسويات\n• وكيل امتثال التأمينات — الإقرارات الشهرية\n• وكيل تحويلات مُدد — تنفيذ حماية الأجور\n• وكيل مكافأة نهاية الخدمة — المخصصات\n• وكيل إدارة الإجازات — الأرصدة والأمومة\n• وكيل مراقبة السعودة — تتبع نطاقات\n• وكيل الأداء والتدقيق — مراقبة الجودة\n• وكيل اتصالات العملاء — الخطابات والشهادات\n\nكل إجراء في البوابة يُظهر الوكيل الذي نفّذه.",
    }),
  },
  {
    patterns: [/hello|hi\b|hey|good morning|مرحبا|أهلا|سلام/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "Hello! I can answer questions about your payroll, employees, documents, leave, GOSI, and processes. Try a quick prompt below or ask in your own words."
        : "مرحبًا! يمكنني الإجابة عن أسئلة الرواتب والموظفين والوثائق والإجازات والتأمينات والعمليات. جرّب اقتراحًا سريعًا أدناه أو اسألني بأسلوبك.",
    }),
  },
  {
    patterns: [/help|what can you do|مساعدة|ماذا تستطيع/i],
    handler: (lang) => ({
      type: "list",
      text: lang === "en"
        ? "I can help with:\n\n• Payroll status and totals\n• Employee details and contracts\n• Document upload and digitization\n• Leave balances and maternity\n• GOSI and Saudization\n• Service requests (salary certificates, iqama renewal)\n• Active processes (separations, onboarding)\n\nJust ask in English or Arabic."
        : "يمكنني المساعدة في:\n\n• حالة الرواتب والإجماليات\n• تفاصيل الموظفين والعقود\n• رفع الوثائق ورقمنتها\n• أرصدة الإجازات والأمومة\n• التأمينات والسعودة\n• طلبات الخدمة (شهادات راتب، تجديد إقامة)\n• العمليات النشطة (الفصل، التأهيل)\n\nاسأل بالإنجليزية أو العربية.",
    }),
  },
];

export function matchClientIntent(query: string, lang: DemoLang): ChatResponse {
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(query))) {
      return intent.handler(lang);
    }
  }
  // generic employee-by-name fallback
  const tokens = query.trim().split(/\s+/);
  for (const t of tokens) {
    if (t.length >= 3) {
      const e = findEmployee(t);
      if (e) {
        return {
          type: "text",
          text: lang === "en"
            ? `${e.fullNameEn} — ${e.role}, ${getDepartmentLabel(e.department, "en")}.\nStatus: ${getEmployeeStatusLabel(e.status, "en")}.\nOpen the Employees tab for the full record.`
            : `${e.fullNameAr} — ${e.roleAr}، ${getDepartmentLabel(e.department, "ar")}.\nالحالة: ${getEmployeeStatusLabel(e.status, "ar")}.\nافتح تبويب الموظفين للسجل الكامل.`,
        };
      }
    }
  }
  return {
    type: "text",
    text: lang === "en"
      ? "I can help with payroll, employee, document, leave, or GOSI questions. Try one of the prompts below or ask about a specific employee by name."
      : "يمكنني المساعدة في أسئلة الرواتب أو الموظفين أو الوثائق أو الإجازات أو التأمينات. جرّب أحد الاقتراحات أو اسأل عن موظف بالاسم.",
  };
}
