/**
 * Helper to author a minimal but valid Scenario for tools whose full
 * autonomous run hasn't been scripted yet. Renders the cockpit, agents,
 * workflows, KPIs, and a 4-event illustrative trace — enough that the
 * Launch button leads to a real, defensible page rather than a 404.
 *
 * The flagship demos (value-realization, tender-response-studio) author
 * their full Scenario directly. Others use this helper until their
 * scripted run is checked in.
 */

import type { Scenario, BiText, SimAgent, KpiDef, WorkflowDef } from "../types";

export interface SkeletonInput {
  slug: string;
  toolTitle: BiText;
  accent: string;
  description: BiText;
  buyer: BiText;
  trigger: BiText;
  agents: SimAgent[];
  workflows: WorkflowDef[];
  kpis: KpiDef[];
}

export function skeletonScenario(input: SkeletonInput): Scenario {
  const orchestrator = input.agents.find((a) => a.kind === "orchestrator") ?? input.agents[0];
  const specialist = input.agents.find((a) => a.id !== orchestrator.id) ?? orchestrator;

  return {
    slug: input.slug,
    toolTitle: input.toolTitle,
    accent: input.accent,
    description: input.description,
    buyer: input.buyer,
    trigger: input.trigger,
    agents: input.agents,
    tools: [
      {
        name: "fetch_context",
        description: {
          en: "Pulls the relevant context from connected systems.",
          ar: "يجلب السياق ذا الصلة من الأنظمة المتّصلة.",
        },
      },
      {
        name: "draft_artifact",
        description: {
          en: "Drafts the deliverable in the buyer's house style.",
          ar: "يصوغ المخرج بأسلوب المشتري.",
        },
      },
    ],
    checkpoints: [
      {
        id: "approve",
        human: input.buyer,
        question: {
          en: "Approve the draft and let the agent ship it?",
          ar: "هل توافق على المسودّة وتسمح للوكيل بإرسالها؟",
        },
        rationale: {
          en: "The orchestrator paused before any irreversible action. Pick approve to ship; pick send-back for the specialist to revise.",
          ar: "توقّف المنسّق قبل أيّ إجراء لا رجعة فيه. اختر الموافقة للإرسال أو الإعادة كي يراجعها الأخصائي.",
        },
        options: [
          { id: "approve", label: { en: "Approve & ship", ar: "موافقة وإرسال" }, recommended: true },
          { id: "send-back", label: { en: "Send back for revision", ar: "إعادة للمراجعة" } },
        ],
      },
    ],
    workflows: input.workflows,
    kpis: input.kpis,
    initialInbox: [],
    initialWorkspace: [],
    events: [
      {
        id: "e1",
        kind: "think",
        agentId: orchestrator.id,
        label: {
          en: "Plan the run end-to-end",
          ar: "تخطيط التشغيل من البداية للنهاية",
        },
        detail: {
          en: "The orchestrator chooses the workflow, picks the specialists it will call, and sets the success criteria.",
          ar: "يختار المنسّق سير العمل والأخصائيين الذين سيستدعيهم ويضع معايير النجاح.",
        },
      },
      {
        id: "e2",
        kind: "tool-call",
        agentId: specialist.id,
        toolName: "fetch_context",
        label: {
          en: "Pull source-of-truth context",
          ar: "جلب السياق المرجعي",
        },
        toolResult: {
          en: "12 records loaded — schema validated.",
          ar: "تحميل 12 سجلًا — تم التحقق من البنية.",
        },
      },
      {
        id: "e3",
        kind: "tool-call",
        agentId: specialist.id,
        toolName: "draft_artifact",
        label: {
          en: "Draft the deliverable",
          ar: "صياغة المخرج",
        },
      },
      {
        id: "e4",
        kind: "checkpoint",
        agentId: orchestrator.id,
        checkpointId: "approve",
        label: {
          en: "Pause for human approval",
          ar: "توقف لطلب موافقة بشرية",
        },
      },
      {
        id: "e5",
        kind: "complete",
        agentId: orchestrator.id,
        label: {
          en: "Run complete — artifact shipped, audit log closed.",
          ar: "اكتمل التشغيل — تم تسليم المخرج وإغلاق السجل.",
        },
      },
    ],
  };
}
