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
