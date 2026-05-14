/**
 * Task #333 — derive the orchestrator-side `pageContext` envelope and
 * the empty-state suggestion chips from the active wouter route.
 *
 * `pageContext` is forwarded to the server with every turn so resolvers
 * can prefer the entity the user is staring at when they say "this
 * engagement" / "the open opp" / "the receipt I just uploaded".
 *
 * Suggestions are a curated set of 3-5 prompts per page family. They're
 * intentionally hand-authored (rather than derived from the catalog)
 * because the right examples per page are a UX call, not a permissions
 * call — the catalog already filters at execution time.
 */

import type { CliLocale } from "./types";

export interface DerivedPageContext {
  currentPath: string;
  surface:
    | "home"
    | "crm"
    | "account_workspace"
    | "opportunity_workspace"
    | "engagement_dashboard"
    | "wallet"
    | "ledger"
    | "roster"
    | "agents"
    | "atelier"
    | "salon"
    | "global";
  activeAccountId?: string;
  activeOpportunityId?: string;
  activeEngagementId?: string;
  activePersonId?: string;
  activeExpenseId?: string;
  activeAgentId?: string;
}

export function derivePageContext(path: string): DerivedPageContext {
  // CRM: /crm or /crm/accounts/:id (defensive — single-segment is the list)
  const accMatch = path.match(/^\/(?:crm\/)?accounts?\/([^/]+)/) || path.match(/^\/account\/([^/]+)/);
  const oppMatch = path.match(/^\/opportunities\/([^/]+)/) || path.match(/^\/pipeline\/([^/]+)/);
  const engMatch = path.match(/^\/engagements?\/([^/]+)/);
  const personMatch = path.match(/^\/roster\/people\/([^/]+)/);
  const expenseMatch = path.match(/^\/wallet\/expenses\/([^/]+)/);
  const agentMatch = path.match(/^\/agents\/([^/]+)/);

  if (accMatch) {
    return { currentPath: path, surface: "account_workspace", activeAccountId: accMatch[1] };
  }
  if (oppMatch) {
    return {
      currentPath: path,
      surface: "opportunity_workspace",
      activeOpportunityId: oppMatch[1],
    };
  }
  if (engMatch) {
    return {
      currentPath: path,
      surface: "engagement_dashboard",
      activeEngagementId: engMatch[1],
    };
  }
  if (personMatch) {
    return { currentPath: path, surface: "roster", activePersonId: personMatch[1] };
  }
  if (expenseMatch) {
    return { currentPath: path, surface: "wallet", activeExpenseId: expenseMatch[1] };
  }
  if (agentMatch) {
    return { currentPath: path, surface: "agents", activeAgentId: agentMatch[1] };
  }
  if (path === "/") return { currentPath: path, surface: "home" };
  if (path.startsWith("/crm")) return { currentPath: path, surface: "crm" };
  if (path.startsWith("/opportunities") || path.startsWith("/pipeline"))
    return { currentPath: path, surface: "opportunity_workspace" };
  if (path.startsWith("/engagements")) return { currentPath: path, surface: "engagement_dashboard" };
  if (path.startsWith("/wallet")) return { currentPath: path, surface: "wallet" };
  if (path.startsWith("/ledger")) return { currentPath: path, surface: "ledger" };
  if (path.startsWith("/roster")) return { currentPath: path, surface: "roster" };
  if (path.startsWith("/agents")) return { currentPath: path, surface: "agents" };
  if (path.startsWith("/atelier")) return { currentPath: path, surface: "atelier" };
  if (path.startsWith("/salon")) return { currentPath: path, surface: "salon" };
  return { currentPath: path, surface: "global" };
}

interface Suggestion {
  en: string;
  ar: string;
}

const HOME: Suggestion[] = [
  { en: "What needs me today?", ar: "ما الذي يحتاج اهتمامي اليوم؟" },
  { en: "Show this week's utilization across the firm", ar: "اعرض استخدام الموارد لهذا الأسبوع" },
  { en: "Draft my Monday digest for the partners", ar: "أعدّ ملخّص الإثنين للشركاء" },
];

const CRM: Suggestion[] = [
  { en: "Find Tasama Holding and open the workspace", ar: "ابحث عن Tasama Holding وافتح مساحة العمل" },
  { en: "Create account 'Acme Industries', sector Manufacturing, country TR", ar: "أنشئ حساب 'Acme Industries' في قطاع التصنيع — تركيا" },
  { en: "List accounts touched in the last 30 days with no follow-up", ar: "اعرض الحسابات التي تواصلنا معها في 30 يومًا بدون متابعة" },
];

const ACCOUNT: Suggestion[] = [
  { en: "Summarize this account's relationship history", ar: "لخّص تاريخ العلاقة مع هذا الحساب" },
  { en: "Re-run Pursuit Scout on this account with the attached doc", ar: "أعد تشغيل Pursuit Scout على هذا الحساب بالمستند المرفق" },
  { en: "Move this account into Pursue stage", ar: "انقل هذا الحساب إلى مرحلة Pursue" },
];

const OPPORTUNITY: Suggestion[] = [
  { en: "Move this opportunity from Shape to Pursue", ar: "انقل هذه الفرصة من Shape إلى Pursue" },
  { en: "Run Pricing Strategist with 35% target margin", ar: "شغّل Pricing Strategist بهامش هدف 35%" },
  { en: "Mark won — record signed value and start engagement", ar: "حدِّد فائزة — سجّل قيمة العقد وابدأ الارتباط" },
  { en: "Generate a competitive landscape brief", ar: "أعدّ تحليل المشهد التنافسي" },
];

const ENGAGEMENT: Suggestion[] = [
  { en: "Add a red-rated risk: 'staffing gap on data lead'", ar: "أضف مخاطرة حمراء: 'نقص في قائد البيانات'" },
  { en: "Show this week's burn vs. plan", ar: "اعرض الاستهلاك مقابل الخطّة لهذا الأسبوع" },
  { en: "Draft the partner check-in note", ar: "أعدّ مذكّرة المتابعة للشريك" },
  { en: "Resume Pursuit Scout from last brief", ar: "تابع Pursuit Scout من آخر موجز" },
];

const WALLET: Suggestion[] = [
  { en: "Batch-create the 12 expenses from this receipt PDF", ar: "أنشئ النفقات الـ12 من هذا الإيصال PDF" },
  { en: "Show VAT-ineligible expenses this quarter", ar: "اعرض النفقات غير المؤهّلة لـ VAT هذا الربع" },
  { en: "Flag any expense over policy", ar: "ضع علامة على النفقات الخارجة عن السياسة" },
];

const LEDGER: Suggestion[] = [
  { en: "Approve all submitted timesheets for my team this week", ar: "وافق على جميع جداول الزمن المُقدَّمة هذا الأسبوع" },
  { en: "Show engagement economics for the top 5 active engagements", ar: "اعرض اقتصاديّات أعلى 5 ارتباطات نشطة" },
  { en: "List people under 60% utilization this month", ar: "اعرض الأشخاص بأقلّ من 60% استخدام هذا الشهر" },
];

const ROSTER: Suggestion[] = [
  { en: "Find people with Salesforce + Arabic in EMEA", ar: "ابحث عن أشخاص يجيدون Salesforce + العربيّة في الشرق الأوسط" },
  { en: "Start onboarding for new hire 'Layla Mansour'", ar: "ابدأ تأهيل التعيين الجديد 'ليلى منصور'" },
  { en: "Show people whose certifications expire in 90 days", ar: "اعرض الأشخاص الذين تنتهي شهاداتهم خلال 90 يومًا" },
];

const AGENTS: Suggestion[] = [
  { en: "Run Pursuit Scout on the open opps in Pursue", ar: "شغّل Pursuit Scout على الفرص المفتوحة في Pursue" },
  { en: "Show all blocked agent runs across the firm", ar: "اعرض كل تنفيذات الوكلاء المتوقّفة" },
  { en: "Schedule the Monday digest for every Monday at 7am", ar: "جدول ملخّص الإثنين كل إثنين الساعة 7 صباحًا" },
];

const ATELIER: Suggestion[] = [
  { en: "Show the prompt library", ar: "اعرض مكتبة المطالبات" },
  { en: "What can The Atelier do for me?", ar: "ماذا يستطيع The Atelier أن يفعل لي؟" },
];

const GLOBAL: Suggestion[] = [
  { en: "What needs me today?", ar: "ما الذي يحتاج اهتمامي اليوم؟" },
  { en: "Show recent activity across the firm", ar: "اعرض النشاط الأخير في الشركة" },
  { en: "Type / to see all commands", ar: "اكتب / لرؤية كل الأوامر" },
];

const BY_SURFACE: Record<DerivedPageContext["surface"], Suggestion[]> = {
  home: HOME,
  crm: CRM,
  account_workspace: ACCOUNT,
  opportunity_workspace: OPPORTUNITY,
  engagement_dashboard: ENGAGEMENT,
  wallet: WALLET,
  ledger: LEDGER,
  roster: ROSTER,
  agents: AGENTS,
  atelier: ATELIER,
  salon: GLOBAL,
  global: GLOBAL,
};

export function suggestionsFor(
  ctx: DerivedPageContext,
  locale: CliLocale,
): Array<{ en: string; ar: string; text: string }> {
  return BY_SURFACE[ctx.surface].map((s) => ({ ...s, text: s[locale] }));
}
