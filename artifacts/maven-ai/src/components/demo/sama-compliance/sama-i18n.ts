import type { DemoLang } from "./DemoLangContext";

export type Dict = Record<string, Record<DemoLang, string>>;

export function useTrFactory(lang: DemoLang) {
  return (key: string, dict: Dict) => dict[key]?.[lang] ?? dict[key]?.en ?? key;
}

export const shell: Dict = {
  brandTag: { en: "SAMA Compliance Sentinel", ar: "حارس الامتثال" },
  platformTitle: { en: "CRO Obligations Console", ar: "قمرة الالتزامات لرئيس المخاطر" },
  back: { en: "Back", ar: "رجوع" },
  switchView: { en: "Agent Cockpit", ar: "قمرة الوكلاء" },
  logout: { en: "Log out", ar: "تسجيل الخروج" },
  notifications: { en: "Notifications", ar: "الإشعارات" },
  noAlerts: { en: "No alerts.", ar: "لا توجد إشعارات." },
  seeAll: { en: "See all in audit log →", ar: "عرض الكل في سجل التدقيق ←" },
  croName: { en: "Noura Al-Saif", ar: "نورا السيف" },
  croTitle: { en: "Chief Risk Officer", ar: "رئيس إدارة المخاطر" },
  croInitials: { en: "NS", ar: "ن.س" },
  navRegister: { en: "Obligations", ar: "الالتزامات" },
  navCircular: { en: "Circulars", ar: "التعاميم" },
  navApprovals: { en: "Approvals", ar: "الاعتمادات" },
  navControls: { en: "Controls Library", ar: "مكتبة الضوابط" },
  navReturns: { en: "Returns Calendar", ar: "تقويم الإيداعات" },
  navAudit: { en: "Audit Log", ar: "سجل التدقيق" },
  aiAssistant: { en: "AI Assistant", ar: "المساعد الذكي" },
  aiBadge: { en: "AI", ar: "ذكاء" },
  newBadge: { en: "NEW", ar: "جديد" },
  expandMenu: { en: "Expand", ar: "توسيع" },
  collapseMenu: { en: "Collapse", ar: "طيّ" },
  filters: { en: "Filters", ar: "المرشحات" },
  decisionsWaiting: { en: "decisions waiting on you", ar: "قرارات بانتظارك" },
  fabAskAi: { en: "Ask the agents", ar: "اسأل الوكلاء" },
};

export const kpis: Dict = {
  activeObligations: { en: "Active obligations", ar: "الالتزامات النشطة" },
  newCirculars: { en: "New circulars · this quarter", ar: "تعاميم جديدة · هذا الربع" },
  controlsFailing: { en: "Controls failing or overdue", ar: "ضوابط متعثّرة أو متأخرة" },
  returnsDue: { en: "Returns due in 30 days", ar: "إيداعات خلال 30 يوماً" },
  decisionsForMe: { en: "Decisions waiting on me", ar: "قرارات بانتظاري" },
  aedImpact: { en: "Cumulative SAR impact", ar: "الأثر التراكمي بالريال" },
};

export const register: Dict = {
  title: { en: "Obligations register", ar: "سجل الالتزامات" },
  subtitle: { en: "240 active obligations across 7 domains and 6 business lines.", ar: "240 التزاماً عبر 7 مجالات و6 خطوط أعمال." },
  whatChanged: { en: "What changed this week", ar: "ما تغيّر هذا الأسبوع" },
  heatmap: { en: "Domain × business line — RAG", ar: "المجال × خط الأعمال — التقييم" },
  recommendations: { en: "Recommendations stack", ar: "كومة التوصيات" },
  filterDomain: { en: "Domain", ar: "المجال" },
  filterRegulator: { en: "Regulator", ar: "المنظّم" },
  filterRag: { en: "RAG", ar: "التقييم" },
  search: { en: "Search obligations…", ar: "بحث في الالتزامات…" },
  all: { en: "All", ar: "الكل" },
  colId: { en: "ID", ar: "المعرّف" },
  colTitle: { en: "Title", ar: "العنوان" },
  colDomain: { en: "Domain", ar: "المجال" },
  colOwner: { en: "Owner", ar: "المسؤول" },
  colLastTested: { en: "Last test", ar: "آخر اختبار" },
  colRag: { en: "RAG", ar: "التقييم" },
  colRegulator: { en: "Regulator", ar: "المنظّم" },
  newPill: { en: "NEW", ar: "جديد" },
  changedPill: { en: "CHANGED", ar: "معدّل" },
  showing: { en: "Showing", ar: "عرض" },
  of: { en: "of", ar: "من" },
  obligations: { en: "obligations", ar: "التزاماً" },
  openDetail: { en: "Open in Circular detail →", ar: "فتح في تفاصيل التعميم ←" },
  approve: { en: "Approve", ar: "اعتماد" },
  edit: { en: "Edit", ar: "تعديل" },
  dismiss: { en: "Dismiss", ar: "تجاهل" },
  confidence: { en: "confidence", ar: "ثقة" },
};

export const circular: Dict = {
  title: { en: "Circular detail", ar: "تفاصيل التعميم" },
  selectCircular: { en: "Select circular:", ar: "اختر التعميم:" },
  paragraphs: { en: "Paragraphs", ar: "الفقرات" },
  obligationsTab: { en: "Obligations", ar: "الالتزامات" },
  controlsTab: { en: "Controls", ar: "الضوابط" },
  evidenceTab: { en: "Evidence", ar: "الأدلة" },
  paragraph: { en: "Paragraph", ar: "الفقرة" },
  newPara: { en: "NEW", ar: "جديد" },
  cockpitWidgets: { en: "Cockpit workspace (read-only)", ar: "قمرة العمل (قراءة فقط)" },
  impactMap: { en: "Impact map", ar: "خريطة الأثر" },
  controlChanges: { en: "Control-change diff", ar: "فرق تغييرات الضوابط" },
  evidencePack: { en: "Evidence pack", ar: "حزمة الأدلة" },
  returnSection: { en: "Return-section draft", ar: "مسودة قسم الإيداع" },
  whatChanged: { en: "What changed since last circular", ar: "ما تغيّر منذ التعميم السابق" },
  effective: { en: "Effective", ar: "السريان" },
  published: { en: "Published", ar: "النشر" },
};

export const approvals: Dict = {
  title: { en: "Approvals", ar: "الاعتمادات" },
  subtitle: { en: "Recommendations the agents need you to sign.", ar: "توصيات تحتاج توقيعك." },
  pending: { en: "Pending", ar: "بانتظار" },
  resolved: { en: "Resolved", ar: "تمّ" },
  approve: { en: "Approve", ar: "اعتماد" },
  reject: { en: "Reject", ar: "رفض" },
  edit: { en: "Edit", ar: "تعديل" },
  rationale: { en: "Rationale", ar: "المبرّر" },
  recommendedAction: { en: "Recommended action", ar: "الإجراء الموصى به" },
  alternatives: { en: "Alternatives", ar: "بدائل" },
  toastApproved: { en: "Approved.", ar: "تمّ الاعتماد." },
  toastRejected: { en: "Rejected.", ar: "تمّ الرفض." },
  toastEdited: { en: "Edited & approved.", ar: "تمّ التعديل والاعتماد." },
  noPending: { en: "Nothing pending — all caught up.", ar: "لا يوجد بانتظارك." },
  bySev: { en: "Severity", ar: "الأهمية" },
  all: { en: "All", ar: "الكل" },
};

export const controls: Dict = {
  title: { en: "Controls library", ar: "مكتبة الضوابط" },
  subtitle: { en: "80 controls — owners, frequency, last test, linked obligations.", ar: "80 ضابطاً — المسؤولون، التواتر، آخر اختبار، الالتزامات." },
  colId: { en: "Control", ar: "الضابط" },
  colOwner: { en: "Owner", ar: "المسؤول" },
  colFreq: { en: "Frequency", ar: "التواتر" },
  colLastTest: { en: "Last test", ar: "آخر اختبار" },
  colObligations: { en: "Linked", ar: "المرتبطة" },
  colEvidence: { en: "Evidence", ar: "الأدلة" },
  colRag: { en: "RAG", ar: "التقييم" },
  filterResult: { en: "Last test", ar: "آخر اختبار" },
  filterDomain: { en: "Domain", ar: "المجال" },
  pass: { en: "Pass", ar: "نجاح" },
  partial: { en: "Partial", ar: "جزئي" },
  fail: { en: "Fail", ar: "إخفاق" },
  overdue: { en: "Overdue", ar: "متأخر" },
};

export const returnsView: Dict = {
  title: { en: "Returns calendar", ar: "تقويم الإيداعات" },
  subtitle: { en: "Upcoming regulatory submissions, drafting status, and agent readiness.", ar: "الإيداعات القادمة وحالة الصياغة وجاهزية الوكلاء." },
  due: { en: "Due", ar: "الاستحقاق" },
  agentReadiness: { en: "Agent readiness", ar: "جاهزية الوكيل" },
  filed: { en: "Filed", ar: "مودَع" },
  ready: { en: "Ready", ar: "جاهز" },
  review: { en: "Review", ar: "مراجعة" },
  drafting: { en: "Drafting", ar: "صياغة" },
  notStarted: { en: "Not started", ar: "لم يبدأ" },
  daysOut: { en: "days", ar: "أيام" },
  daysLate: { en: "days late", ar: "أيام تأخر" },
  signRequired: { en: "Sign required", ar: "يتطلب توقيع" },
  preview: { en: "Preview", ar: "معاينة" },
  amountSar: { en: "Filing impact", ar: "أثر الإيداع" },
};

export const audit: Dict = {
  title: { en: "Audit log", ar: "سجل التدقيق" },
  subtitle: { en: "Every agent action and every override — what the CRO is accountable for.", ar: "كل فعل للوكيل وكل تجاوز." },
  filterCategory: { en: "Category", ar: "الفئة" },
  all: { en: "All", ar: "الكل" },
  ingest: { en: "Ingest", ar: "استلام" },
  map: { en: "Map", ar: "ربط" },
  draft: { en: "Draft", ar: "صياغة" },
  evidence: { en: "Evidence", ar: "أدلة" },
  approve: { en: "Approve", ar: "اعتماد" },
  override: { en: "Override", ar: "تجاوز" },
  file: { en: "File", ar: "إيداع" },
  system: { en: "System", ar: "نظام" },
  byAgent: { en: "Agent", ar: "وكيل" },
  byHuman: { en: "Human", ar: "بشري" },
};

export const aiChat: Dict = {
  headerTitle: { en: "Compliance Assistant", ar: "مساعد الامتثال" },
  headerSubtitle: { en: "Powered by Sentinel Conductor", ar: "مدعوم من منسّق الحارس" },
  welcome: {
    en: "Hi Noura — CRU-2026-04 was ingested overnight. 14 obligations and 3 control changes are queued for your sign-off. Ask me anything.",
    ar: "صباح الخير. تمّ استلام CRU-2026-04 ليلاً. 14 التزاماً و3 تغييرات ضوابط بانتظار توقيعك. اسألي عن أي شيء.",
  },
  prompt1: { en: "What did SAMA change this week?", ar: "ما الذي غيّرته ساما هذا الأسبوع؟" },
  prompt2: { en: "Which controls are failing right now?", ar: "ما الضوابط المتعثّرة الآن؟" },
  prompt3: { en: "Show Section 4 of QFR-2026-Q2", ar: "أرني القسم 4 من QFR-2026-Q2" },
  prompt4: { en: "Where do we stand on AML?", ar: "ما وضعنا في مكافحة غسل الأموال؟" },
  placeholder: { en: "Ask the assistant…", ar: "اسأل المساعد…" },
};
