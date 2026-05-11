/**
 * The 8 Agentic Factories that power the DGE Effortless 2.0 ecosystem.
 * Sourced from the Publicis Sapient deck. Static narrative — the live
 * Stack panel reads from this registry.
 */
import type { BiText } from "@/lib/sim/types";

export interface Factory {
  id: string;
  name: BiText;
  promise: BiText;
  sentinels: BiText[];
}

export const FACTORIES: Factory[] = [
  {
    id: "catalogue-channel",
    name: { en: "Catalogue & Channel", ar: "الكتالوج والقناة" },
    promise: { en: "Always fresh, always reachable.", ar: "محدّث دائماً، يمكن الوصول إليه دائماً." },
    sentinels: [
      { en: "Catalog Sentinel", ar: "حارس الكتالوج" },
      { en: "Channel Sentinel", ar: "حارس القناة" },
      { en: "Validation Sentinel", ar: "حارس التحقق" },
      { en: "Migration Sentinel", ar: "حارس الترحيل" },
    ],
  },
  {
    id: "complaint-recovery",
    name: { en: "Complaint Recovery", ar: "استرداد الشكاوى" },
    promise: { en: "Heard. Resolved. Never repeats.", ar: "تُسمَع، تُحَلّ، لا تتكرر." },
    sentinels: [
      { en: "Intake Sentinel", ar: "حارس الاستلام" },
      { en: "Root-Cause Sentinel", ar: "حارس السبب الجذري" },
      { en: "Recovery Designer", ar: "مصمّم الاسترداد" },
      { en: "Mystery Shopper", ar: "المتسوّق السري" },
    ],
  },
  {
    id: "qr-feedback",
    name: { en: "QR Feedback & Effortless Makers", ar: "ملاحظات QR وصنّاع التجربة" },
    promise: { en: "Every voice counted. Every hero seen.", ar: "كل صوت محسوب. كل بطل مرئي." },
    sentinels: [
      { en: "QR Intake Sentinel", ar: "حارس استلام QR" },
      { en: "Quality Sentinel", ar: "حارس الجودة" },
      { en: "Theme Sentinel", ar: "حارس المواضيع" },
      { en: "Recognition Sentinel", ar: "حارس التقدير" },
    ],
  },
  {
    id: "red-team",
    name: { en: "Red Team Rapid Response", ar: "فريق الاستجابة السريعة" },
    promise: { en: "From outage to workshop in hours.", ar: "من العطل إلى ورشة العمل خلال ساعات." },
    sentinels: [
      { en: "Triage Sentinel", ar: "حارس الفرز" },
      { en: "Workshop Architect", ar: "مهندس الورشة" },
      { en: "Stakeholder Mapper", ar: "خرائط أصحاب المصلحة" },
      { en: "Brief Writer", ar: "كاتب الموجز" },
    ],
  },
  {
    id: "service-redesign",
    name: { en: "Service Redesign Co-Pilot", ar: "مساعد إعادة تصميم الخدمات" },
    promise: { en: "From research to ready-to-build in days.", ar: "من البحث إلى الجاهز للتنفيذ خلال أيام." },
    sentinels: [
      { en: "Research Sentinel", ar: "حارس البحث" },
      { en: "Journey Sentinel", ar: "حارس الرحلة" },
      { en: "Blueprint Sentinel", ar: "حارس المخطّط" },
      { en: "Action Plan Sentinel", ar: "حارس خطة العمل" },
      { en: "QA Gate Sentinel", ar: "بوابة الجودة" },
    ],
  },
  {
    id: "spokes-review",
    name: { en: "Spokes Review", ar: "مراجعة الجهات الفرعية" },
    promise: { en: "Coherent across 60 entities.", ar: "متناسق عبر 60 جهة." },
    sentinels: [
      { en: "Submission Reader", ar: "قارئ الإرسال" },
      { en: "Coherence Sentinel", ar: "حارس التناسق" },
      { en: "Principles Sentinel", ar: "حارس المبادئ" },
      { en: "Critique Drafter", ar: "كاتب النقد" },
    ],
  },
  {
    id: "perception",
    name: { en: "Perception & Insight", ar: "الإدراك والرؤية" },
    promise: { en: "Truth, told weekly.", ar: "الحقيقة، أسبوعياً." },
    sentinels: [
      { en: "Perception Survey Sentinel", ar: "حارس استطلاع الإدراك" },
      { en: "Insight Sentinel", ar: "حارس الرؤى" },
    ],
  },
  {
    id: "prototype",
    name: { en: "Prototype Factory", ar: "مصنع النماذج" },
    promise: { en: "From idea to clickable prototype overnight.", ar: "من الفكرة إلى نموذج قابل للنقر بين عشية وضحاها." },
    sentinels: [
      { en: "Prototype Generator", ar: "مولّد النماذج" },
      { en: "Prototype QA", ar: "ضمان جودة النموذج" },
    ],
  },
];

export const STACK_LINES: BiText[] = [
  { en: "Sapient Bodhi · agent orchestration", ar: "Sapient Bodhi · تنسيق الوكلاء" },
  { en: "Sapient Sustain · governance & guardrails", ar: "Sapient Sustain · الحوكمة والضوابط" },
  { en: "GPT-4o-mini → Claude Sonnet 4.6", ar: "GPT-4o-mini ← Claude Sonnet 4.6" },
  { en: "Falcon-Arabic · sovereign LLM", ar: "Falcon-Arabic · نموذج لغوي سيادي" },
  { en: "Azure UAE-North · Core42", ar: "Azure UAE-North · Core42" },
  { en: "DGE CX Hub · system of record", ar: "مركز تجربة العميل · نظام السجلات" },
];

export const PERSONAS: Array<{ id: string; name: BiText; role: BiText; initials: string }> = [
  { id: "aisha", name: { en: "Aisha", ar: "عائشة" }, role: { en: "Citizen", ar: "مواطنة" }, initials: "ع" },
  { id: "khalid", name: { en: "Khalid", ar: "خالد" }, role: { en: "Catalogue Operator", ar: "مشغّل الكتالوج" }, initials: "خ" },
  { id: "layla", name: { en: "Director Layla", ar: "المديرة ليلى" }, role: { en: "DGE CX Director", ar: "مديرة تجربة العميل" }, initials: "ل" },
  { id: "mariam", name: { en: "Mariam", ar: "مريم" }, role: { en: "Complaint Lead", ar: "قائدة الشكاوى" }, initials: "م" },
  { id: "saeed", name: { en: "Saeed", ar: "سعيد" }, role: { en: "Outlet Manager", ar: "مدير الفرع" }, initials: "س" },
  { id: "reem", name: { en: "Reem", ar: "ريم" }, role: { en: "Service Designer", ar: "مصمّمة خدمات" }, initials: "ر" },
  { id: "hala", name: { en: "Hala", ar: "هالة" }, role: { en: "Spokes Reviewer", ar: "مراجعة الجهات" }, initials: "ه" },
  { id: "faisal", name: { en: "Faisal", ar: "فيصل" }, role: { en: "Red Team Lead", ar: "قائد فريق الاستجابة" }, initials: "ف" },
];
