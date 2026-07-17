/**
 * Task #333 — chrome strings + locale forwarding. Atelier is otherwise
 * English-only today; the CLI ships its own bilingual chrome so the
 * locale toggle works end-to-end without blocking on a global i18n
 * refactor. The toggled locale is also forwarded to the orchestrator
 * as a "respond in <locale>" instruction prepended to the user prompt.
 */

import type { CliLocale } from "./types";

type Bilingual = { en: string; ar: string };

export const STRINGS = {
  open: { en: "Open command bar", ar: "افتح شريط الأوامر" },
  close: { en: "Close (Esc)", ar: "إغلاق (Esc)" },
  placeholder: {
    en: "Ask The Atelier or type / for commands…",
    ar: "اسأل The Atelier أو اكتب / للأوامر…",
  },
  send: { en: "Send (Enter)", ar: "إرسال (Enter)" },
  newline: { en: "Shift+Enter for newline", ar: "Shift+Enter لسطر جديد" },
  attach: { en: "Attach files", ar: "إرفاق ملفات" },
  attachHint: {
    en: "Drop files here or paste — PDF, DOCX, XLSX, CSV, PNG, JPG",
    ar: "أسقط الملفات هنا أو الصق — PDF, DOCX, XLSX, CSV, PNG, JPG",
  },
  fileTooLarge: { en: "File too large (max 25 MB)", ar: "الملف كبير جدًا (الحد 25 م.ب.)" },
  fileTypeRejected: { en: "Unsupported file type", ar: "نوع الملف غير مدعوم" },
  thinking: { en: "Thinking…", ar: "يفكّر…" },
  proposedPlan: { en: "Proposed plan", ar: "الخطّة المقترحة" },
  confirm: { en: "Confirm", ar: "تأكيد" },
  confirming: { en: "Confirming…", ar: "جارٍ التأكيد…" },
  edit: { en: "Edit", ar: "تعديل" },
  cancel: { en: "Cancel", ar: "إلغاء" },
  typedNameLabel: {
    en: "This is irreversible. Type the entity name to confirm:",
    ar: "هذه عمليّة غير قابلة للتراجع. اكتب اسم الكيان للتأكيد:",
  },
  typedNameMismatch: { en: "Name does not match", ar: "الاسم غير مطابق" },
  showAll: { en: "Show all steps", ar: "عرض كل الخطوات" },
  collapseAll: { en: "Collapse", ar: "طي" },
  bulkSummary: {
    en: "{n} steps will run.",
    ar: "{n} خطوة ستُنفّذ.",
  },
  followUps: { en: "Follow-up", ar: "متابعة" },
  resultEntities: { en: "Touched", ar: "العناصر المتأثّرة" },
  viewAudit: { en: "View audit event", ar: "اعرض حدث التدقيق" },
  viewAgentRun: { en: "Open agent run", ar: "افتح تنفيذ الوكيل" },
  copyMarkdown: { en: "Copy markdown summary", ar: "انسخ ملخّص ماركداون" },
  copyJson: { en: "Copy plan as JSON", ar: "انسخ الخطّة JSON" },
  exportTranscript: { en: "Export transcript", ar: "تصدير السجلّ" },
  saveAsShortcut: { en: "Save as shortcut", ar: "احفظ كاختصار" },
  asyncHandoff: {
    en: "Job dispatched. We'll notify you in the Activity rail when it lands.",
    ar: "أُرسلت المهمّة. سنُعلمك في شريط النشاط عند الانتهاء.",
  },
  partialBanner: {
    en: "Stopped at step {n}. Resume or rollback below.",
    ar: "توقّف عند الخطوة {n}. استأنف أو راجع أدناه.",
  },
  resume: { en: "Resume from here", ar: "استأنف من هنا" },
  rollback: { en: "Rollback completed steps", ar: "تراجَع عن الخطوات المنجزة" },
  emptyHint: {
    en: "Try one of these to get started:",
    ar: "جرّب واحدًا من هذه للبدء:",
  },
  helpTitle: { en: "What you can ask", ar: "ما يمكنك طلبه" },
  helpHint: {
    en: "Slash commands and prompts are filtered to your role.",
    ar: "الأوامر والمطالبات مرشّحة لدور الشخصيّة.",
  },
  savedDrawerTitle: { en: "Saved prompts", ar: "المطالبات المحفوظة" },
  savedDrawerEmpty: {
    en: "No saved prompts yet. Save any prompt from a result card.",
    ar: "لا توجد مطالبات محفوظة بعد.",
  },
  savedRun: { en: "Run", ar: "تشغيل" },
  savedDelete: { en: "Delete", ar: "حذف" },
  savedSchemaWarning: {
    en: "Capability catalog has changed since this prompt was saved.",
    ar: "تغيّرت قائمة القدرات منذ حفظ هذه المطالبة.",
  },
  localeLabel: { en: "Language", ar: "اللغة" },
  asyncBadge: { en: "ASYNC", ar: "غير متزامن" },
  errorBadge: { en: "ERROR", ar: "خطأ" },
  cancelled: { en: "Cancelled", ar: "أُلغيت" },
  retry: { en: "Retry", ar: "أعِد المحاولة" },
  recallHint: { en: "↑ to recall last prompt", ar: "↑ لاستدعاء آخر مطالبة" },
  pickOne: { en: "Pick one to continue:", ar: "اختر واحدًا للمتابعة:" },
  // Task #342 — assistant discoverability strings.
  askAtelier: { en: "Ask Atelier", ar: "اسأل Atelier" },
  homeInputPlaceholder: {
    en: "Ask Atelier anything…",
    ar: "اسأل Atelier أي شيء…",
  },
  emptyConversational: {
    en: "Hi — what would you like to do?",
    ar: "مرحبًا — ماذا تودّ أن تفعل؟",
  },
  emptySlashHint: {
    en: "Tip: type / to browse all commands.",
    ar: "تلميح: اكتب / لتصفّح كل الأوامر.",
  },
  floatingBubbleLabel: {
    en: "Ask Atelier — chat with the assistant",
    ar: "اسأل Atelier — تحدّث مع المساعد",
  },
  floatingBubbleDismiss: {
    en: "Hide for this session",
    ar: "إخفاء لهذه الجلسة",
  },
  firstRunTooltipPartner: {
    en: "Ask Atelier in plain language — try \"Approve this week's timesheets\".",
    ar: "اسأل Atelier بلغة طبيعيّة — جرّب \"وافق على جداول الزمن لهذا الأسبوع\".",
  },
  firstRunTooltipDefault: {
    en: "Ask Atelier in plain language — try \"What's on my plate today?\".",
    ar: "اسأل Atelier بلغة طبيعيّة — جرّب \"ما المهام التي بانتظاري اليوم؟\".",
  },
  firstRunTooltipDismiss: { en: "Got it", ar: "فهمت" },
  clarificationTitle: {
    en: "I need a quick clarification",
    ar: "أحتاج إلى توضيح سريع",
  },
  clarificationSubmit: { en: "Send answer", ar: "إرسال الإجابة" },
  refusalTitle: {
    en: "I can't do that from here yet",
    ar: "لا أستطيع تنفيذ ذلك من هنا بعد",
  },
  refusalRequest: { en: "Request this capability", ar: "اطلب هذه الإمكانية" },
  refusalOpenPage: { en: "Open the right page", ar: "افتح الصفحة المناسبة" },
  refusalRequested: { en: "Request logged. Thanks.", ar: "تم تسجيل الطلب. شكرًا." },
  recapTitle: { en: "Catching you up", ar: "تذكير سريع" },
  recapDormantHours: { en: "Dormant {h}h", ar: "غير نشط {h} س" },
  // Task #498 — auto-nav toast strings.
  autoNavToastTitle: {
    en: "Jumped to {label}",
    ar: "انتقلت إلى {label}",
  },
  autoNavToastDescription: {
    en: "The assistant moved you here based on your last request.",
    ar: "نقلك المساعد إلى هنا بناءً على طلبك الأخير.",
  },
  // Task #626 — two clearly-worded outcomes: return to the previous
  // screen, or keep (stay on) the screen the assistant navigated to.
  autoNavGoBack: { en: "Go back", ar: "العودة" },
  autoNavStayHere: { en: "Stay here", ar: "ابقَ هنا" },
  // Task #573 — dependency-impact summary for destructive deletes.
  impactTitle: { en: "What this affects", ar: "ما الذي سيتأثّر" },
  impactNone: {
    en: "Nothing else references this. Safe to remove.",
    ar: "لا شيء آخر يشير إلى هذا. الإزالة آمنة.",
  },
  impactRetained: {
    en: "These stay in place but lose their link to this record:",
    ar: "تبقى هذه كما هي لكنها تفقد ارتباطها بهذا السجلّ:",
  },
  impactOpportunity: { en: "open opportunities", ar: "فرص مفتوحة" },
  impactEngagement: { en: "engagements", ar: "ارتباطات" },
  impactContact: { en: "contacts", ar: "جهات اتصال" },
  impactInvoice: { en: "invoices", ar: "فواتير" },
  impactContactRelationship: { en: "org-chart links", ar: "روابط الهيكل التنظيمي" },
  // Task #39 — duplicate-opportunity warning on the confirm card and
  // the friendly rejection card when a bare commit is blocked.
  dupWarnTitle: { en: "Possible duplicate", ar: "احتمال تكرار" },
  dupWarnExact: {
    en: "An open deal with this exact name already exists on this account. Confirming will create a second one anyway.",
    ar: "توجد بالفعل صفقة مفتوحة بهذا الاسم على هذا الحساب. التأكيد سينشئ صفقة ثانية على أي حال.",
  },
  dupWarnSimilar: {
    en: "Similar existing deals on this account:",
    ar: "صفقات مشابهة موجودة على هذا الحساب:",
  },
  dupRejectTitle: { en: "Duplicate deal blocked", ar: "تم حظر صفقة مكررة" },
  dupRejectBody: {
    en: "An open deal with this name already exists on this account, so nothing was created. Use the existing deal, or ask explicitly for a second one.",
    ar: "توجد بالفعل صفقة مفتوحة بهذا الاسم على هذا الحساب، لذلك لم يتم إنشاء شيء. استخدم الصفقة الموجودة أو اطلب صراحةً إنشاء صفقة ثانية.",
  },
  dupRejectOpen: { en: "Open existing deal", ar: "افتح الصفقة الموجودة" },
  dupStage: { en: "stage", ar: "المرحلة" },
  // Task #573 — Edit affordance on the confirm card.
  editHint: {
    en: "Edit reopens your request so you can adjust it.",
    ar: "يعيد التعديل فتح طلبك لتتمكّن من ضبطه.",
  },
} satisfies Record<string, Bilingual>;

export function s(key: keyof typeof STRINGS, locale: CliLocale): string {
  return STRINGS[key][locale];
}

/** Substitution helper for the `{n}` style placeholders above. */
export function sFmt(
  key: keyof typeof STRINGS,
  locale: CliLocale,
  vars: Record<string, string | number>,
): string {
  let out = STRINGS[key][locale];
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** "Respond in English." / "أجب بالعربية." — prepended to the user's prompt. */
export function localeInstruction(locale: CliLocale): string {
  return locale === "ar" ? "أجب بالعربيّة." : "Respond in English.";
}

/**
 * Inverse of localeInstruction — strips the known locale preamble (and
 * the trailing blank line that `submit` injects) from a wrapped prompt.
 * Used server-side to recover the raw user answer when the deterministic
 * clarification continuation merges it back into a tool input field.
 */
const LOCALE_PREAMBLES = ["Respond in English.", "أجب بالعربيّة.", "أجب بالعربية."] as const;
export function stripLocalePreamble(text: string): string {
  let t = text ?? "";
  for (const p of LOCALE_PREAMBLES) {
    if (t.startsWith(p)) {
      t = t.slice(p.length).replace(/^\r?\n+/, "");
      break;
    }
  }
  return t;
}
