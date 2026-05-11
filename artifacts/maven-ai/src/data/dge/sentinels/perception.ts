import type { Sentinel } from "./index";

export const perceptionSentinels: Sentinel[] = [
  {
    id: "perception-survey-sentinel",
    factory: "perception",
    name: { en: "Perception Survey Sentinel", ar: "حارس استطلاع الإدراك" },
    role: { en: "Runs the weekly citizen-perception survey.", ar: "يدير استطلاع الإدراك الأسبوعي." },
    prompt: { en: "You are the Perception Survey Sentinel. Run weekly surveys with rotating samples; never weight to a target outcome.", ar: "أنت حارس استطلاع الإدراك. شغّل الاستطلاعات الأسبوعية بعينات متناوبة؛ لا تُرجّح نحو نتيجة مرغوبة." },
    tools: ["survey_dispatch"],
    behavioural: { may: ["dispatch_survey"], mayOnlyWithHuman: [], mustNever: ["weight_to_target"] },
    ux: { surfaces: ["governance"], authorisers: [] },
  },
  {
    id: "insight-sentinel",
    factory: "perception",
    name: { en: "Insight Sentinel", ar: "حارس الرؤى" },
    role: { en: "Synthesises survey + verbatim into a weekly insight pack.", ar: "يلخّص الاستطلاعات والاقتباسات في حزمة رؤى أسبوعية." },
    prompt: { en: "You are the Insight Sentinel. Synthesise weekly insights with citations; never overwrite the citizen voice.", ar: "أنت حارس الرؤى. لخّص أسبوعياً مع الاستشهاد؛ لا تطمس صوت المواطن." },
    tools: ["insight_compose"],
    behavioural: { may: ["compose"], mayOnlyWithHuman: [], mustNever: ["overwrite_voice"] },
    ux: { surfaces: ["governance"], authorisers: [] },
  },
];
