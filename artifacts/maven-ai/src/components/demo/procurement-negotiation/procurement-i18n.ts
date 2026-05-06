import type { DemoLang } from "./DemoLangContext";

export type Dict = Record<string, Record<DemoLang, string>>;

export const shell: Dict = {
  brandTag:        { en: "PROCUREMENT NEGOTIATION", ar: "تفاوض المشتريات" },
  platformTitle:   { en: "Sourcing Desk", ar: "مكتب التوريد" },
  back:            { en: "Marketplace", ar: "السوق" },
  logout:          { en: "Logout", ar: "خروج" },
  switchView:      { en: "Switch view", ar: "تبديل العرض" },
  switchToCockpit: { en: "Switch to Agent Cockpit", ar: "التبديل إلى لوحة الوكلاء" },
  notifications:   { en: "Notifications", ar: "التنبيهات" },
  noNotifs:        { en: "No new alerts", ar: "لا تنبيهات جديدة" },
  collapse:        { en: "Collapse", ar: "طيّ" },
  expand:          { en: "Expand", ar: "فتح" },
  agentAlerts:     { en: "Agent alerts", ar: "تنبيهات الوكلاء" },

  navEvents:    { en: "Events", ar: "الأحداث" },
  navWorkspace: { en: "Event workspace", ar: "ساحة الحدث" },
  navApprovals: { en: "Approvals", ar: "الموافقات" },
  navSuppliers: { en: "Suppliers", ar: "الموردون" },
  navCounter:   { en: "Counter-bid composer", ar: "كاتب العرض المضادّ" },
  navAudit:     { en: "Audit log", ar: "سجل التدقيق" },
  aiAssistant:  { en: "AI assistant", ar: "المساعد الذكي" },
  aiBadge:      { en: "AI", ar: "AI" },

  // Persona block
  personaTagline: { en: "Thursday · 11:00 · Round 3 closed", ar: "الخميس · 11:00 · أُغلقت الجولة 3" },
};

export const events: Dict = {
  title:        { en: "Sourcing events", ar: "أحداث التوريد" },
  subtitle:     { en: "Active and recent events you own as Category Manager · Indirects.", ar: "الأحداث النشطة والأخيرة التي تتولّاها كمدير فئة المشتريات غير المباشرة." },
  open:         { en: "Open", ar: "فتح" },
  refId:        { en: "Reference", ar: "المرجع" },
  category:     { en: "Category", ar: "الفئة" },
  stage:        { en: "Stage", ar: "المرحلة" },
  baseline:     { en: "Baseline spend", ar: "الإنفاق الأساسي" },
  achieved:     { en: "Savings achieved", ar: "الوفورات المحققة" },
  target:       { en: "Target", ar: "الهدف" },
  suppliers:    { en: "Suppliers bidding", ar: "موردون متنافسون" },
  rounds:       { en: "Rounds", ar: "الجولات" },
  close:        { en: "Closes", ar: "يغلق" },
  stageDrafting:   { en: "Drafting", ar: "إعداد" },
  stageLive:       { en: "Live", ar: "مباشر" },
  stageEvaluating: { en: "Evaluating", ar: "قيد التقييم" },
  stageAwarded:    { en: "Awarded", ar: "مُرسى" },
  stageClosed:     { en: "Closed", ar: "مغلق" },

  kpiOpen:        { en: "Open events", ar: "الأحداث المفتوحة" },
  kpiYtd:         { en: "YTD savings", ar: "الوفورات السنوية" },
  kpiAuto:        { en: "Rounds autonomous", ar: "جولات مؤتمتة" },
  kpiSuppliers:   { en: "Suppliers competing", ar: "موردون منافسون" },
  kpiQueue:       { en: "Decisions waiting", ar: "قرارات بانتظاري" },

  recsTitle:    { en: "Agent recommendations", ar: "توصيات الوكلاء" },
  approve:      { en: "Approve", ar: "اعتماد" },
  edit:         { en: "Edit", ar: "تعديل" },
  dismiss:      { en: "Dismiss", ar: "تجاهل" },
  open2:        { en: "Open record", ar: "فتح السجلّ" },
  confidence:   { en: "Confidence", ar: "الثقة" },
};

export const workspace: Dict = {
  title:           { en: "MRO event workspace", ar: "ساحة حدث الصيانة" },
  subtitle:        { en: "Round 3 closed at 10:00. Bid matrix scored, allocation recommended.", ar: "أُغلقت الجولة 3 الساعة 10:00. تمّ تقييم العروض واقتراح الترسية." },
  bidMatrix:       { en: "Bid matrix", ar: "مصفوفة العروض" },
  bidMatrixSub:    { en: "Each cell coloured by % vs. baseline. Best price per row outlined.", ar: "كل خلية ملوّنة حسب % مقابل الأساس. أفضل سعر في كل صفّ مظلّل." },
  roundTimeline:   { en: "Round timeline", ar: "الخط الزمني للجولات" },
  roundTimelineSub:{ en: "Savings achieved each round vs. baseline.", ar: "الوفورات المحقّقة في كل جولة مقابل الأساس." },
  allocation:      { en: "Allocation panel", ar: "لوحة الترسية" },
  allocationSub:   { en: "Drag the slider to adjust the split between the top two suppliers.", ar: "اسحب لضبط التقسيم بين أفضل مُورّدَين." },
  viewPrice:       { en: "Price", ar: "السعر" },
  viewTco:         { en: "TCO", ar: "التكلفة الشاملة" },
  round:           { en: "Round", ar: "جولة" },
  participating:   { en: "participating", ar: "مشاركة" },
  baselineLine:    { en: "Baseline", ar: "الأساس" },
  best:            { en: "Best", ar: "الأفضل" },
  unit:            { en: "Unit price", ar: "سعر الوحدة" },
  share:           { en: "Share", ar: "الحصة" },
  landed:          { en: "Landed cost", ar: "التكلفة المُسلَّمة" },
  savingsVsBase:   { en: "Savings vs. baseline", ar: "وفورات مقابل الأساس" },
  awardMemo:       { en: "Award memo (draft)", ar: "مذكّرة الترسية (مسوّدة)" },
  signAward:       { en: "Sign award", ar: "اعتماد الترسية" },
  awardSigned:     { en: "Award signed · audit log updated", ar: "اعتُمدت الترسية · حُدّث سجلّ التدقيق" },
  scenarioDoneTitle: { en: "Scenario complete", ar: "اكتمل السيناريو" },
  scenarioDoneBody:  { en: "Award memo distributed to Legal, Finance, and the supplier shortlist.", ar: "وُزّعت مذكّرة الترسية على القانوني والمالي والقائمة المختصرة." },
  // Persona narrative
  storyHeader:  { en: "Faisal's morning", ar: "صباح فيصل" },
  storyBody:    { en: "Round 3 closed at 10:00. Award Critic recommends a 70/30 split. Toggle TCO to verify; tweak allocation if needed; sign the award memo.", ar: "أُغلقت الجولة 3 الساعة 10:00. يوصي ناقد الترسية بتقسيم 70/30. شغّل عرض التكلفة الشاملة للتحقّق؛ عدّل الترسية إن لزم؛ ثم اعتمد المذكّرة." },
};

export const approvals: Dict = {
  title:    { en: "Approvals · agent recommendations", ar: "الموافقات · توصيات الوكلاء" },
  subtitle: { en: "Decisions waiting on you. Each card was authored by one of the negotiation agents.", ar: "قرارات بانتظارك. كل بطاقة من تأليف أحد وكلاء التفاوض." },
  empty:    { en: "Inbox clear — no decisions waiting.", ar: "الصندوق فارغ — لا قرارات بانتظارك." },
  approved: { en: "Approved", ar: "تمّ الاعتماد" },
  rejected: { en: "Dismissed", ar: "تمّ التجاهل" },
  approve:  { en: "Approve", ar: "اعتماد" },
  edit:     { en: "Edit", ar: "تعديل" },
  reject:   { en: "Dismiss", ar: "تجاهل" },
  alternate:{ en: "Alternate options", ar: "خيارات بديلة" },
  toastApprovedTitle: { en: "Recommendation approved", ar: "تمّ اعتماد التوصية" },
  toastDismissedTitle:{ en: "Recommendation dismissed", ar: "تمّ تجاهل التوصية" },
};

export const suppliers: Dict = {
  title:    { en: "Supplier 360", ar: "ملف المورد 360" },
  subtitle: { en: "Cross-event supplier intelligence: pre-qualification, on-time delivery, ESG.", ar: "ذكاء الموردين عبر الأحداث: التأهيل، الالتزام بالتسليم، الاستدامة." },
  preQual:  { en: "Pre-qual", ar: "تأهيل" },
  prequalified: { en: "Pre-qualified", ar: "مؤهّل" },
  notPrequalified: { en: "Pre-qual incomplete", ar: "تأهيل ناقص" },
  otd:      { en: "On-time", ar: "التزام التسليم" },
  esg:      { en: "ESG", ar: "استدامة" },
  payment:  { en: "Payment", ar: "الدفع" },
  leadTime: { en: "Lead-time", ar: "زمن التسليم" },
  flags:    { en: "Flags", ar: "تنبيهات" },
  country:  { en: "Country", ar: "البلد" },
  incumbent:{ en: "Incumbent", ar: "المُورّد الحالي" },
  open:     { en: "Open scorecard", ar: "فتح البطاقة" },
};

export const counter: Dict = {
  title:    { en: "Counter-bid composer", ar: "كاتب العرض المضادّ" },
  subtitle: { en: "Drafts authored by the Counter-bid Drafter agent — review, edit, send.", ar: "مسودّات من تأليف وكيل العرض المضادّ — راجع، عدّل، أرسل." },
  to:       { en: "To", ar: "إلى" },
  subject:  { en: "Subject", ar: "الموضوع" },
  body:     { en: "Body", ar: "النص" },
  send:     { en: "Send counter-bid", ar: "إرسال العرض المضادّ" },
  saveDraft:{ en: "Save draft", ar: "حفظ المسوّدة" },
  sent:     { en: "Sent · supplier notified", ar: "أُرسل · تمّ إخطار المورد" },
  saved:    { en: "Draft saved", ar: "حُفظت المسوّدة" },
  draftedBy:{ en: "Drafted by", ar: "كاتب المسوّدة" },
  empty:    { en: "No counter-bid drafts pending.", ar: "لا مسودّات بانتظار الإرسال." },
};

export const audit: Dict = {
  title:    { en: "Audit log", ar: "سجلّ التدقيق" },
  subtitle: { en: "Every agent action and human approval, in chronological order — for governance review.", ar: "كل إجراء للوكلاء وكل اعتماد بشري بالترتيب الزمني — لمراجعة الحوكمة." },
  filterAll:{ en: "All",   ar: "الكل" },
  filterAgents:{ en: "Agents only", ar: "الوكلاء فقط" },
  filterUsers: { en: "Humans only", ar: "البشر فقط" },
  ts:       { en: "Time", ar: "الوقت" },
  actor:    { en: "Actor", ar: "الفاعل" },
  action:   { en: "Action", ar: "الإجراء" },
  ref:      { en: "Reference", ar: "المرجع" },
};

export const aiChat: Dict = {
  headerTitle: { en: "Negotiation Conductor", ar: "منسّق التفاوض" },
  headerSubtitle: { en: "Live across the MRO event", ar: "مباشر على حدث الصيانة" },
  welcome: { en: "I have the MRO Round 3 results loaded. Ask me about baseline savings, suppliers, allocation, or pre-qual issues.", ar: "نتائج الجولة 3 للصيانة جاهزة. اسألني عن الوفورات أو الموردين أو الترسية أو قضايا التأهيل." },
  placeholder: { en: "Ask about the MRO event…", ar: "اسأل عن حدث الصيانة…" },
  prompt1: { en: "Where are we vs. baseline?", ar: "أين نحن مقابل الأساس؟" },
  prompt2: { en: "Who improved most in R3?", ar: "من تحسّن أكثر في الجولة 3؟" },
  prompt3: { en: "Recommend the award", ar: "أوصِ بالترسية" },
  prompt4: { en: "Switch to TCO view", ar: "تحويل إلى التكلفة الشاملة" },
  prompt5: { en: "Draft counter for Supplier C", ar: "صياغة عرض مضادّ للمورد C" },
  prompt6: { en: "Any pre-qual issues?", ar: "هل هناك قضايا تأهيل؟" },
  prompt7: { en: "How much did we leave on the table?", ar: "كم تركنا على الطاولة؟" },
  prompt8: { en: "Brief me for the award meeting", ar: "تجهيز إيجاز اجتماع الترسية" },
};
