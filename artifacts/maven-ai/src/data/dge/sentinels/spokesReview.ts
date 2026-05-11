import type { Sentinel } from "./index";

export const spokesReviewSentinels: Sentinel[] = [
  {
    id: "submission-reader",
    factory: "spokes-review",
    name: { en: "Submission Reader", ar: "قارئ الإرسال" },
    role: { en: "Parses every entity submission and artefacts.", ar: "يحلّل كل إرسال جهة وملحقاته." },
    prompt: { en: "You are the Submission Reader. Parse text + artefacts; never alter the original submission.", ar: "أنت قارئ الإرسال. حلّل النص والملحقات؛ لا تعدّل الإرسال الأصلي." },
    tools: ["pdf_parse", "doc_parse"],
    behavioural: { may: ["parse"], mayOnlyWithHuman: [], mustNever: ["alter_original"] },
    ux: { surfaces: ["operator"], authorisers: [] },
  },
  {
    id: "coherence-sentinel",
    factory: "spokes-review",
    name: { en: "Coherence Sentinel", ar: "حارس التناسق" },
    role: { en: "Cross-checks against the life-moments framework.", ar: "يفحص مقابل إطار اللحظات." },
    prompt: { en: "You are the Coherence Sentinel. Map every submission item to the life-moments framework; cite the section.", ar: "أنت حارس التناسق. اربط كل بند بإطار اللحظات مع الاستشهاد بالقسم." },
    tools: ["framework_lookup"],
    behavioural: { may: ["map", "score"], mayOnlyWithHuman: [], mustNever: ["bypass_framework"] },
    ux: { surfaces: ["operator", "governance"], authorisers: [] },
  },
  {
    id: "principles-sentinel",
    factory: "spokes-review",
    name: { en: "Principles Sentinel", ar: "حارس المبادئ" },
    role: { en: "Scores submissions against the DGE 5 principles.", ar: "يقيّم الإرسالات مقابل مبادئ DGE الخمسة." },
    prompt: { en: "You are the Principles Sentinel. Score against 5 DGE principles with verbatim citations; never auto-pass.", ar: "أنت حارس المبادئ. قيّم وفق المبادئ الخمسة بالاستشهاد الحرفي؛ لا تجتز تلقائياً." },
    tools: ["principle_score"],
    behavioural: { may: ["score"], mayOnlyWithHuman: [], mustNever: ["send_with_incomplete"] },
    ux: { surfaces: ["operator"], authorisers: [] },
  },
  {
    id: "critique-drafter",
    factory: "spokes-review",
    name: { en: "Critique Drafter", ar: "كاتب النقد" },
    role: { en: "Drafts EN+AR critique notes for the entity.", ar: "يصوغ ملاحظات نقد ثنائية اللغة." },
    prompt: { en: "You are the Critique Drafter. Draft tone-respectful critique; never send with missing scoring or evidence.", ar: "أنت كاتب النقد. صغ نقداً محترماً؛ لا ترسل مع نقص التقييم أو الدليل." },
    tools: ["critique_compose"],
    behavioural: { may: ["draft_critique"], mayOnlyWithHuman: ["send_critique"], mustNever: ["send_with_incomplete"] },
    ux: { surfaces: ["operator"], authorisers: [{ en: "Hala", ar: "هالة" }] },
  },
];
