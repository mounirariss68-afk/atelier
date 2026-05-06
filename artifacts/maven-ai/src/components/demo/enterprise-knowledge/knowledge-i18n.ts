import type { DemoLang } from "./DemoLangContext";

export type Dict = Record<string, Record<DemoLang, string>>;

export const shell: Dict = {
  brandTag: { en: "Enterprise Knowledge", ar: "معرفة المؤسسة" },
  platformTitle: { en: "Knowledge Concierge", ar: "كونسيرج المعرفة" },
  platformSub: { en: "v1 · chat", ar: "الإصدار 1 · دردشة" },
  back: { en: "Back to marketplace", ar: "العودة للسوق" },
  notifications: { en: "Notifications", ar: "الإشعارات" },
  personaInitials: { en: "MK", ar: "م ك" },
  personaName: { en: "Munira Khalid", ar: "منيرة خالد" },
  personaTitle: { en: "Knowledge Concierge", ar: "كونسيرج المعرفة" },
  navChat: { en: "Chat", ar: "الدردشة" },
  navSources: { en: "Source library", ar: "مكتبة المصادر" },
  navApprovals: { en: "Approvals", ar: "الموافقات" },
  navAudit: { en: "Audit drawer", ar: "سجل التدقيق" },
  navOps: { en: "Knowledge ops", ar: "إدارة المعرفة" },
  collapseMenu: { en: "Collapse menu", ar: "طي القائمة" },
  agentAlerts: { en: "Agent alerts", ar: "تنبيهات الوكلاء" },
  seeAllAlerts: { en: "Open Approvals →", ar: "فتح الموافقات →" },
  switchView: { en: "Switch to cockpit view", ar: "التبديل لعرض الوكلاء" },
  aiBadge: { en: "AI", ar: "AI" },
  newBadge: { en: "NEW", ar: "جديد" },
};

export const chat: Dict = {
  title: { en: "Concierge Conductor", ar: "منسّق الكونسيرج" },
  subtitle: { en: "Cited answers from your firm's memory", ar: "إجابات موثّقة من ذاكرة شركتك" },
  welcome: {
    en: "Hello. I'm the Knowledge Concierge. Ask anything in your remit — I'll cite every claim back to a source you're allowed to see, and openly disclose anything I had to withhold.",
    ar: "أهلاً. أنا كونسيرج المعرفة. اسأل عن أي شيء في صلاحياتك — سأستشهد بكل ادعاء بمصدر مسموح لك، وأُفصح عن أي شيء حُجب.",
  },
  placeholder: { en: "Ask about anything in your remit…", ar: "اسأل عن أي شيء في صلاحياتك…" },
  prompt1: { en: "What is our EGP exposure on receivables?", ar: "ما تعرّضنا في الجنيه المصري على الذمم؟" },
  prompt2: { en: "Why are 2 sources hidden?", ar: "لماذا حُجب مصدران؟" },
  prompt3: { en: "Brief me for the board", ar: "ملخّص للمجلس" },
  prompt4: { en: "Show me the source library", ar: "اعرض مكتبة المصادر" },
  prompt5: { en: "Switch to Junior Analyst persona", ar: "التبديل لشخصية المحلّل المبتدئ" },
  prompt6: { en: "Re-run the EGP question as Junior Analyst", ar: "إعادة سؤال EGP كمحلّل مبتدئ" },
  prompt7: { en: "Escalate to my manager", ar: "تصعيد إلى مديري" },
  prompt8: { en: "What did the Auditor flag this week?", ar: "ماذا رصد المدقّق هذا الأسبوع؟" },
  promptHedging: { en: "What's our NDF hedging coverage on EGP?", ar: "ما تغطية NDF للتحوّط على الجنيه؟" },
  promptArbitration: { en: "Brief me on the Cairo Metro arbitration prep", ar: "ملخّص تحضير تحكيم مترو القاهرة" },
  promptArAgeing: { en: "Show me the AR ageing report for Egypt", ar: "اعرض تقرير تقادم الذمم في مصر" },
  citationsLabel: { en: "Citations", ar: "المراجع" },
  withheldLabel: { en: "withheld", ar: "محجوب" },
  withheldOpen: { en: "Open disclosure", ar: "افتح الإفصاح" },
  confidenceLabel: { en: "confidence", ar: "ثقة" },
  authoredBy: { en: "Drafted by", ar: "صياغة" },
  auditedBy: { en: "audited by", ar: "تدقيق" },
  scoredBy: { en: "scored by", ar: "تصنيف" },
  refusal: { en: "Defensible refusal", ar: "رفض مبرّر" },
  escalateCta: { en: "Escalate to my manager", ar: "تصعيد إلى مديري" },
  openSource: { en: "Open source", ar: "فتح المصدر" },
  closeSource: { en: "Close", ar: "إغلاق" },
  passageLabel: { en: "Passage", ar: "المقطع" },
  withheldHeader: { en: "Withheld sources", ar: "المصادر المحجوبة" },
  withheldRationale: {
    en: "Hidden by Permission Filter because your persona does not hold the required ACL group. The Concierge still flagged that they would have changed the answer — that is the firm's policy.",
    ar: "حُجبت بواسطة فلتر الصلاحيات لأن شخصيّتك لا تملك مجموعة الصلاحيات المطلوبة. ما زال الكونسيرج يُشير إلى أنها كانت ستغيّر الإجابة — هذه سياسة الشركة.",
  },
  noAnswer: {
    en: "I cannot answer this from your visible source set. The 6 sources I would have used are not visible to your persona. You can escalate to your manager and I'll forward the question.",
    ar: "لا أستطيع الإجابة من مصادرك المرئية. المصادر الـ 6 التي كنت سأستخدمها غير متاحة لشخصيّتك. يمكنك التصعيد إلى مديرك وسأحيل السؤال.",
  },
};

export const sourceRail: Dict = {
  title: { en: "Sources considered", ar: "المصادر المعتبرة" },
  subtitle: { en: "What the Concierge looked at to answer", ar: "ما اطّلع عليه الكونسيرج للإجابة" },
  visibleLabel: { en: "Visible", ar: "مرئي" },
  withheldLabel: { en: "Withheld", ar: "محجوب" },
  consideredLabel: { en: "Considered for this answer", ar: "اعتُبر لهذه الإجابة" },
  emptyTitle: { en: "Ask a question to see sources", ar: "اطرح سؤالاً لترى المصادر" },
  emptyBody: { en: "Every answer lists every source the agent looked at — visible and withheld.", ar: "كل إجابة تعرض كل المصادر — المرئيّة والمحجوبة." },
  classifPublic: { en: "Public", ar: "عام" },
  classifInternal: { en: "Internal", ar: "داخلي" },
  classifConfidential: { en: "Confidential", ar: "سرّي" },
  classifLegal: { en: "Legal-privileged", ar: "سرّ قانوني" },
};

export const sourceDrawer: Dict = {
  fullDocument: { en: "Full source document", ar: "وثيقة المصدر كاملة" },
  citedPassage: { en: "Cited passage", ar: "المقطع المُستشهَد به" },
  highlightedInContext: {
    en: "The cited excerpt is highlighted in context within the full document.",
    ar: "المقطع المُستشهَد به مُظلَّل ضمن سياق الوثيقة الكاملة.",
  },
  metaOwner: { en: "Owner", ar: "المالك" },
  metaClassification: { en: "Classification", ar: "التصنيف" },
  metaUpdated: { en: "Last updated", ar: "آخر تحديث" },
  metaDomain: { en: "Domain", ar: "المجال" },
  withheldTitle: { en: "Withheld from your persona", ar: "محجوب عن شخصيّتك" },
  withheldBody: {
    en: "The Permission Filter is hiding the body of this document from you because your persona does not hold the required ACL group. Request access and the steward will review.",
    ar: "فلتر الصلاحيات يحجب نصّ هذه الوثيقة لأنّ شخصيّتك لا تملك مجموعة الصلاحيات المطلوبة. اطلب الصلاحية وسيراجع الحارس الطلب.",
  },
  requestAccess: { en: "Request access", ar: "اطلب صلاحية" },
  accessRequested: { en: "Access requested", ar: "تمّ إرسال الطلب" },
  accessRequestedBody: {
    en: "Your request has been logged in the audit drawer and forwarded to the document steward.",
    ar: "تمّ تسجيل طلبك في سجلّ التدقيق وأُحيل إلى حارس الوثيقة.",
  },
  close: { en: "Close", ar: "إغلاق" },
  requiredAcl: { en: "Required ACL groups", ar: "مجموعات الصلاحيات المطلوبة" },
};

export const personaSwitcher: Dict = {
  title: { en: "Asking as", ar: "السؤال كـ" },
  subtitle: { en: "Persona controls which sources you can see", ar: "الشخصية تحدّد المصادر المرئية" },
  visibleSources: { en: "sources visible", ar: "مصادر مرئية" },
  switchTo: { en: "Switch persona", ar: "تغيير الشخصية" },
};

export const sourceLibrary: Dict = {
  title: { en: "Source library", ar: "مكتبة المصادر" },
  subtitle: { en: "Every document the Concierge can reach. Filter by classification, owner, or visibility.", ar: "كل وثيقة يصلها الكونسيرج. صفّ بالتصنيف والمالك والرؤية." },
  filterAll: { en: "All", ar: "الكل" },
  filterVisible: { en: "Visible to me", ar: "مرئي لي" },
  filterHidden: { en: "Hidden from me", ar: "محجوب عنّي" },
  colTitle: { en: "Source", ar: "المصدر" },
  colOwner: { en: "Owner", ar: "المالك" },
  colClass: { en: "Classification", ar: "التصنيف" },
  colAcl: { en: "ACL groups", ar: "مجموعات الصلاحيات" },
  colUpdated: { en: "Updated", ar: "آخر تحديث" },
  colVisible: { en: "Visible to you?", ar: "مرئي لك؟" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
};

export const approvals: Dict = {
  title: { en: "Approvals", ar: "الموافقات" },
  subtitle: { en: "Compliance and steward decisions waiting on a human.", ar: "قرارات الامتثال والحراسة بانتظار إنسان." },
  scenarioCheckpoints: { en: "Scenario checkpoints", ar: "نقاط السيناريو" },
  scenarioCheckpointsSub: { en: "Pulled live from the Knowledge Concierge run.", ar: "مأخوذة مباشرة من تشغيل كونسيرج المعرفة." },
  derivedRecs: { en: "Derived recommendations", ar: "توصيات مُشتقّة" },
  rationale: { en: "Rationale", ar: "المنطق" },
  options: { en: "Options", ar: "الخيارات" },
  human: { en: "Decision owner", ar: "صاحب القرار" },
  approve: { en: "Approve", ar: "موافقة" },
  edit: { en: "Edit", ar: "تعديل" },
  reject: { en: "Reject", ar: "رفض" },
  resolved: { en: "Resolved", ar: "مكتمل" },
  toastApprovedTitle: { en: "Approved", ar: "تمّت الموافقة" },
  toastApprovedDesc: { en: "Decision logged to the audit trail.", ar: "تمّ تسجيل القرار في سجل التدقيق." },
  toastEditedTitle: { en: "Sent for edit", ar: "أُرسل للتعديل" },
  toastEditedDesc: { en: "Drafter notified to revise.", ar: "تم إخطار الكاتب بالتعديل." },
  toastRejectedTitle: { en: "Rejected", ar: "مرفوض" },
  toastRejectedDesc: { en: "Recommendation dismissed and logged.", ar: "تم رفض التوصية وتسجيلها." },
};

export const audit: Dict = {
  title: { en: "Audit drawer", ar: "سجل التدقيق" },
  subtitle: { en: "Every Q&A across personas — confidence, withholds, action taken.", ar: "كل سؤال وجواب عبر الشخصيات — الثقة، المحجوب، الإجراء المتّخذ." },
  filterAll: { en: "All personas", ar: "كل الشخصيات" },
  colWhen: { en: "When", ar: "متى" },
  colPersona: { en: "Persona", ar: "الشخصية" },
  colQuestion: { en: "Question", ar: "السؤال" },
  colVisible: { en: "Visible / 24", ar: "مرئي / 24" },
  colCited: { en: "Cited", ar: "استشهاد" },
  colWithheld: { en: "Withheld", ar: "محجوب" },
  colConfidence: { en: "Confidence", ar: "الثقة" },
  colAction: { en: "Action", ar: "الإجراء" },
  actionAnswered: { en: "Answered", ar: "أُجيب" },
  actionRefused: { en: "Refused", ar: "رُفض" },
  actionEscalated: { en: "Escalated", ar: "صُعِّد" },
};

export const ops: Dict = {
  title: { en: "Knowledge ops", ar: "إدارة المعرفة" },
  subtitle: { en: "Administrator surface for the Knowledge Concierge.", ar: "واجهة مسؤول لكونسيرج المعرفة." },
  topQuestionsTitle: { en: "Top questions this week", ar: "أبرز الأسئلة هذا الأسبوع" },
  refusalRateTitle: { en: "Refusal rate by persona", ar: "معدّل الرفض حسب الشخصية" },
  topCitedTitle: { en: "Top-cited sources", ar: "أكثر المصادر استشهاداً" },
  staleTitle: { en: "Sources flagged stale", ar: "مصادر يُشار إليها بأنها قديمة" },
  asks: { en: "asks", ar: "أسئلة" },
  refused: { en: "refusals", ar: "رفضات" },
  citations: { en: "citations", ar: "استشهادات" },
  daysOld: { en: "days since update", ar: "يوماً منذ التحديث" },
};

export const kpis: Dict = {
  visibleSources: { en: "Sources visible", ar: "مصادر مرئية" },
  visibleSourcesSub: { en: "to current persona", ar: "للشخصيّة الحالية" },
  groundedRate: { en: "Grounded answer rate", ar: "معدّل الإجابة المؤصّلة" },
  groundedRateSub: { en: "rolling 100 answers", ar: "آخر 100 إجابة" },
  refusalRate: { en: "Defensible refusal rate", ar: "معدّل الرفض المبرّر" },
  refusalRateSub: { en: "rolling, all personas", ar: "كل الشخصيات" },
  ttv: { en: "Avg time to answer", ar: "زمن الإجابة" },
  ttvSub: { en: "vs. 12 min human baseline", ar: "مقابل 12 دقيقة بشريّاً" },
  leaks: { en: "Permission leaks", ar: "تسريبات الصلاحيات" },
  leaksSub: { en: "target = 0", ar: "الهدف = 0" },
};
