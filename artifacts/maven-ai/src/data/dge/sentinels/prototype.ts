import type { Sentinel } from "./index";

export const prototypeSentinels: Sentinel[] = [
  {
    id: "prototype-generator",
    factory: "prototype",
    name: { en: "Prototype Generator", ar: "مولّد النماذج" },
    role: { en: "Generates a clickable prototype from a journey + blueprint.", ar: "يولّد نموذجاً قابلاً للنقر من رحلة + مخطّط." },
    prompt: { en: "You are the Prototype Generator. Generate clickable prototypes; never deploy beyond the sandbox.", ar: "أنت مولّد النماذج. ولّد النماذج؛ لا تنشر خارج البيئة التجريبية." },
    tools: ["prototype_build"],
    behavioural: { may: ["generate"], mayOnlyWithHuman: [], mustNever: ["deploy_to_production"] },
    ux: { surfaces: ["operator"], authorisers: [] },
  },
  {
    id: "prototype-qa",
    factory: "prototype",
    name: { en: "Prototype QA", ar: "ضمان جودة النموذج" },
    role: { en: "Runs accessibility + bilingual QA on every prototype.", ar: "يشغّل اختبارات الوصول وثنائية اللغة." },
    prompt: { en: "You are the Prototype QA. Run a11y + bilingual checks; never sign off without both passing.", ar: "أنت ضمان جودة النموذج. شغّل فحص الوصول وثنائية اللغة؛ لا توقّع دون اجتيازهما." },
    tools: ["a11y_check", "bilingual_check"],
    behavioural: { may: ["test"], mayOnlyWithHuman: [], mustNever: ["signoff_without_both_pass"] },
    ux: { surfaces: ["operator", "governance"], authorisers: [] },
  },
];
