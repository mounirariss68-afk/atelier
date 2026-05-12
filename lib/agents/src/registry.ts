import { defineAgent, z, type Agent, type HumanCheckpoint } from "./types.js";

/**
 * THE ATELIER — 22-agent registry (spec §8).
 *
 * 8 starred MVP agents have full schemas and human checkpoints; the 14
 * non-starred agents are catalog stubs (also typed) so the registry feels
 * complete and the audit trail can already reference them. Deep prompt /
 * tool implementations land in follow-up tasks.
 */

const partnerCheck = (label = "Partner approves"): HumanCheckpoint => ({
  id: "cp_partner",
  label,
  decider: "partner",
  blocking: true,
});

const leadCheck = (label = "Engagement Lead approves"): HumanCheckpoint => ({
  id: "cp_lead",
  label,
  decider: "engagement_lead",
  blocking: true,
});

// ====================== 8 MVP STARRED AGENTS ======================

export const PursuitScout = defineAgent({
  id: "ag_pursuit_scout",
  name: "Pursuit Scout",
  group: "Front of House",
  stage: "Identify",
  purpose: "Live, citable opportunity briefs from one-line client + context inputs.",
  model: "claude-sonnet-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/pursuit_scout.md",
  inputSchema: z.object({
    accountName: z.string().min(2),
    contextHint: z.string().optional(),
  }),
  outputSchema: z.object({
    brief: z.string(),
    citations: z.array(z.object({ title: z.string(), url: z.string().url() })),
    dealSizeBand: z.tuple([z.number(), z.number()]),
    confidence: z.enum(["green", "amber", "red"]),
  }),
  tools: ["web_search", "knowledge.search", "file.read"],
  guardrails: [
    "Citations required on every claim",
    "Synthetic figures clearly watermarked",
    "Deal-size hypothesis is a band, never a single number",
  ],
  humanCheckpoints: [partnerCheck("Partner reviews and Approves / Edits / Rejects")],
  evals: [
    { id: "ev_citations", description: "≥1 citation per claim", threshold: 1 },
    { id: "ev_band", description: "Deal size returned as a numeric tuple", threshold: 1 },
  ],
});

export const POVAuthor = defineAgent({
  id: "ag_pov_author",
  name: "POV Author",
  group: "Front of House",
  stage: "Shape",
  purpose: "Brand-correct, citation-bound POV deliverables in HTML, ready for the client meeting.",
  model: "claude-sonnet-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/pov_author.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    angle: z.string().min(8),
    audience: z.string(),
  }),
  outputSchema: z.object({
    html: z.string(),
    sections: z.array(z.object({ heading: z.string(), evidenceIds: z.array(z.string()).min(1) })),
  }),
  tools: ["knowledge.search", "web_search", "html.generate"],
  guardrails: [
    "Pyramid structure enforced",
    "Every section bound to ≥1 evidence row",
    "AICo brand chrome locked",
  ],
  humanCheckpoints: [
    leadCheck("Engagement Lead approves prompt sheet"),
    partnerCheck("Partner approves before client send"),
  ],
  evals: [
    { id: "ev_evidence", description: "Every section bound to evidence", threshold: 1 },
    { id: "ev_brand_chrome", description: "Brand chrome present", threshold: 1 },
  ],
});

export const ProposalComposer = defineAgent({
  id: "ag_proposal_composer",
  name: "Proposal Composer",
  group: "Front of House",
  stage: "Pursue",
  purpose: "Formal proposal with workplan, team, pricing, terms, compliance matrix.",
  model: "claude-sonnet-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/proposal_composer.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    rfpUrl: z.string().url().optional(),
    targetMarginPct: z.number().min(0).max(100),
  }),
  outputSchema: z.object({
    docxUrl: z.string(),
    complianceMatrix: z.array(
      z.object({ requirement: z.string(), status: z.enum(["green", "amber", "red"]) }),
    ),
  }),
  tools: ["knowledge.search", "web_search", "file.read", "docx.generate"],
  guardrails: [
    "Every promise maps to a workplan deliverable",
    "Pricing must hit target margin or trigger Partner override",
    "Compliance matrix 100% green or rendered red",
  ],
  humanCheckpoints: [
    leadCheck("Section assignments confirmed"),
    partnerCheck("Pricing approved by Partner"),
    partnerCheck("Final Partner read"),
    {
      id: "cp_send",
      label: "Explicit Send-to-client click",
      decider: "engagement_lead",
      blocking: true,
    },
  ],
  evals: [
    { id: "ev_compliance_green", description: "Compliance matrix 100% green", threshold: 1 },
  ],
});

export const MeetingScribe = defineAgent({
  id: "ag_meeting_scribe",
  name: "Meeting Scribe",
  group: "Engagement Memory",
  stage: "Cross-cutting",
  purpose: "Turn a meeting recording or transcript into structured engagement memory.",
  model: "claude-haiku-4-5",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/meeting_scribe.md",
  inputSchema: z.object({
    engagementId: z.string(),
    audioUrl: z.string().url().optional(),
    transcriptText: z.string().optional(),
  }),
  outputSchema: z.object({
    summary: z.string(),
    actionItems: z.array(z.object({ owner: z.string(), text: z.string(), dueDate: z.string().optional() })),
    decisions: z.array(z.string()),
  }),
  tools: ["transcribe.audio", "knowledge.search", "web_search"],
  guardrails: [
    "Speaker attribution preserved or marked unclear",
    "Confidential terms flagged before any cross-engagement write",
  ],
  humanCheckpoints: [
    leadCheck("Summary + action items reviewed before push to engagement"),
  ],
  evals: [{ id: "ev_actions", description: "Every action item has an owner", threshold: 1 }],
});

export const CharterArchitect = defineAgent({
  id: "ag_charter_architect",
  name: "Charter Architect",
  group: "Mobilize",
  stage: "Mobilize",
  purpose: "Engagement charter and hypothesis tree within 24h of signature.",
  model: "claude-sonnet-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/charter_architect.md",
  inputSchema: z.object({
    engagementId: z.string(),
    signedSowText: z.string().min(50),
  }),
  outputSchema: z.object({
    charterMd: z.string(),
    hypothesisTree: z.object({ root: z.string(), children: z.array(z.unknown()) }),
  }),
  tools: ["knowledge.search", "file.read"],
  guardrails: [
    "Every objective paired with a measurable success metric",
    "Scope and out-of-scope MECE",
    "Hypothesis tree limited to 3 levels by default",
  ],
  humanCheckpoints: [leadCheck(), partnerCheck("Partner sign-off")],
  evals: [{ id: "ev_metrics", description: "Every objective has a metric", threshold: 1 }],
});

export const AgentArchitect = defineAgent({
  id: "ag_agent_architect",
  name: "Agent Architect",
  group: "Deliver",
  stage: "Deliver",
  purpose: "Process diagram + agentifiability annotations + candidate agent designs.",
  model: "claude-sonnet-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/agent_architect.md",
  inputSchema: z.object({
    engagementId: z.string(),
    processName: z.string(),
    stepNotes: z.array(z.string()).min(1),
  }),
  outputSchema: z.object({
    bpmnMermaid: z.string(),
    candidateAgents: z.array(z.object({ name: z.string(), purpose: z.string(), risk: z.enum(["low", "med", "high"]) })),
  }),
  tools: ["bpmn.render", "knowledge.search"],
  guardrails: [
    "Agentifiability classification includes rationale",
    "No candidate agent without a human checkpoint",
    "High-risk agents flagged for Partner attention",
  ],
  humanCheckpoints: [partnerCheck("Partner / Engagement Lead reviews each design")],
  evals: [{ id: "ev_human_cp", description: "Every candidate has a human checkpoint", threshold: 1 }],
});

export const PrototypeForge = defineAgent({
  id: "ag_prototype_forge",
  name: "Prototype Forge",
  group: "Deliver",
  stage: "Deliver",
  purpose: "Replit-ready build prompts (DGE Effortless pattern) for viable prototype ideas.",
  model: "claude-sonnet-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/prototype_forge.md",
  inputSchema: z.object({
    engagementId: z.string(),
    candidateAgentId: z.string(),
    brief: z.string().min(20),
  }),
  outputSchema: z.object({
    replitPrompt: z.string(),
    nonNegotiables: z.array(z.string()),
  }),
  tools: ["knowledge.search", "replit.scaffold"],
  guardrails: [
    "Generated prompts include AICo non-negotiables block",
    "No real client data without Partner approval",
  ],
  humanCheckpoints: [leadCheck("Lead approves brief"), partnerCheck("Partner approves the generated prompt")],
  evals: [{ id: "ev_nonneg", description: "Non-negotiables present", threshold: 1 }],
});

export const SynthesisCritic = defineAgent({
  id: "ag_synthesis_critic",
  name: "Synthesis Critic",
  group: "Quality",
  stage: "Cross-cutting",
  purpose: "Quality-gate every external deliverable before client release.",
  model: "claude-opus-4-6",
  starred: true,
  status: "mvp",
  systemPromptRef: "prompts/synthesis_critic.md",
  inputSchema: z.object({
    deliverableId: z.string(),
    contentText: z.string(),
  }),
  outputSchema: z.object({
    verdict: z.enum(["green", "amber", "red"]),
    issues: z.array(z.object({ severity: z.enum(["green", "amber", "red"]), text: z.string() })),
  }),
  tools: ["knowledge.search", "file.read"],
  guardrails: [
    "Critic does not edit; only flags",
    "Send-to-client blocked unless GREEN or Partner override logged",
  ],
  humanCheckpoints: [leadCheck("Engagement Lead reviews issues")],
  evals: [{ id: "ev_no_edit", description: "Critic output does not contain edits", threshold: 1 }],
});

// ====================== 14 REGISTERED STUB AGENTS ======================

const stubInput = z.object({}).passthrough();
const stubOutput = z.object({ note: z.string() });

const stub = (
  id: string,
  name: string,
  group: Agent["group"],
  stage: Agent["stage"],
  purpose: string,
  model = "claude-haiku-4-5",
): Agent =>
  defineAgent({
    id,
    name,
    group,
    stage,
    purpose,
    model,
    starred: false,
    status: "registered",
    systemPromptRef: `prompts/${id}.md`,
    inputSchema: stubInput,
    outputSchema: stubOutput,
    tools: ["knowledge.search"],
    guardrails: [],
    humanCheckpoints: [],
    evals: [],
  });

export const TriageAgent = stub("ag_triage", "Triage Agent", "Personal", "Cross-cutting", "Composes the persona's Pane A 'what needs me today' queue.");
export const RaidWatchdog = stub("ag_raid_watchdog", "RAID Watchdog", "Deliver", "Deliver", "Flags risks/assumptions/issues/dependencies on every engagement.");
export const KnowledgeConcierge = stub("ag_knowledge_concierge", "Knowledge Concierge", "Atelier", "Compound", "Answers firm-wide search with citations from the Atelier.", "claude-sonnet-4-6");
export const AtelierCurator = stub("ag_atelier_curator", "Atelier Curator", "Atelier", "Compound", "Identifies reusable IP candidates and proposes Atelier promotions.", "claude-sonnet-4-6");
export const PromptLibrarian = stub("ag_prompt_librarian", "Prompt Librarian", "Atelier", "Compound", "Curates and versions reusable prompts across the firm.");
export const DiagnosticMemoAuthor = stub("ag_diagnostic_memo", "Diagnostic Memo Author", "Front of House", "Shape", "Drafts diagnostic memos from discovery interviews.", "claude-sonnet-4-6");
export const WorkplanArchitect = stub("ag_workplan_architect", "Workplan Architect", "Mobilize", "Mobilize", "Generates engagement workplans with deliverables, owners, dates.", "claude-sonnet-4-6");
export const AdoptionCoach = stub("ag_adoption_coach", "Adoption Coach", "Deliver", "Deliver", "Coaches client teams through change-management plays.");
export const ValueCaseTracker = stub("ag_value_case_tracker", "Value Case Tracker", "Deliver", "Deliver", "Tracks realized value vs. business case across engagements.");
export const ComplianceReviewer = stub("ag_compliance_reviewer", "Compliance Reviewer", "Quality", "Cross-cutting", "Reviews proposals and deliverables for regulatory compliance.", "claude-sonnet-4-6");
export const PricingAnalyst = stub("ag_pricing_analyst", "Pricing Analyst", "Front of House", "Pursue", "Models pricing scenarios and margin sensitivity.");
export const BenchPlanner = stub("ag_bench_planner", "Bench Planner", "Personal", "Cross-cutting", "Plans staffing and bench utilisation across active engagements.");
export const BrandTranslator = stub("ag_brand_translator", "Brand Translator", "Quality", "Cross-cutting", "Rewrites drafts into AICo brand voice across EN/AR/TR.");
export const Storyboarder = stub("ag_storyboarder", "Storyboarder", "Front of House", "Shape", "Turns narratives into slide-ready storyboards.");

// ====================== REGISTRY ======================

export const ATELIER_AGENTS: Agent[] = [
  PursuitScout,
  POVAuthor,
  ProposalComposer,
  MeetingScribe,
  CharterArchitect,
  AgentArchitect,
  PrototypeForge,
  SynthesisCritic,
  TriageAgent,
  RaidWatchdog,
  KnowledgeConcierge,
  AtelierCurator,
  PromptLibrarian,
  DiagnosticMemoAuthor,
  WorkplanArchitect,
  AdoptionCoach,
  ValueCaseTracker,
  ComplianceReviewer,
  PricingAnalyst,
  BenchPlanner,
  BrandTranslator,
  Storyboarder,
];

export const AGENT_BY_ID: Record<string, Agent> = Object.fromEntries(
  ATELIER_AGENTS.map((a) => [a.id, a]),
);

export function getAgent(id: string): Agent | undefined {
  return AGENT_BY_ID[id];
}
