import { defineAgent, z, type Agent, type HumanCheckpoint } from "./types.js";
import type { ZodTypeAny } from "zod";

/**
 * THE ATELIER — agent registry.
 *
 * 🟡 IMPORTANT: every entry below is a contract with a real runner, prompt,
 * route, and UI mount. Read `artifacts/atelier/AGENT_STANDARD.md` before
 * adding, removing, or changing any agent. The standard defines:
 *   - the four agent kinds (Drafter / Sentinel / Analyst / Rule-based)
 *   - the locked file layout
 *   - the lifecycle contract enforced by `runAgent(...)`
 *   - the storage rules (atelier_agent_runs, atelier_audit_events, …)
 *   - the Definition of Done checklist every agent task must pass
 *
 * Statuses:
 *   - `mvp`        — ships end-to-end in the v3 walkthrough; runner + prompt
 *                    + schema + UI are real.
 *   - `registered` — runner + prompt exist but coverage is partial (e.g.
 *                    no Atelier UI surface yet, or fixtures missing).
 *   - `stub`       — catalog placeholder; runner not yet implemented.
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

// Shared confidence enum used across most agent outputs.
const Confidence = z.enum(["green", "amber", "red"]);

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
  systemPromptRef: "prompts/pursuit_scout/v1.md",
  inputSchema: z.object({
    accountName: z.string().min(2),
    accountCountry: z.string().optional(),
    accountSector: z.string().optional(),
    opportunityName: z.string().optional(),
    contextBlurb: z.string().optional(),
  }),
  outputSchema: z.object({
    accountSnapshot: z.object({
      oneLiner: z.string(),
      scaleHint: z.string(),
      recentMoves: z.array(z.string()),
    }),
    buyerLandscape: z.object({
      likelyBuyers: z.array(z.object({ title: z.string(), rationale: z.string() })),
      powerMap: z.string(),
    }),
    fiveCDraft: z.object({
      client: z.string(),
      competition: z.string(),
      capability: z.string(),
      capacity: z.string(),
      contract: z.string(),
    }),
    openQuestions: z.array(z.string()),
    facts: z.array(
      z.object({
        id: z.string().optional(),
        topic: z.string(),
        statement: z.string(),
        sourceUrl: z.string().optional(),
        sourceTitle: z.string().optional(),
        snippet: z.string().optional(),
        confidence: Confidence,
      }),
    ),
    confidence: Confidence,
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
  systemPromptRef: "prompts/pov_author/v1.md",
  // POV Author is a 2-step chain (outline → draft). Input/output documented
  // here is the *outline* phase; the draft phase shape lives in the runner.
  inputSchema: z.object({
    opportunityId: z.string(),
    audience: z.string(),
    objective: z.string(),
    promotedFacts: z.array(z.object({ id: z.string(), statement: z.string() })),
  }),
  outputSchema: z.object({
    title: z.string(),
    thesis: z.string(),
    sections: z.array(
      z.object({
        id: z.string(),
        heading: z.string(),
        intent: z.string(),
        factIds: z.array(z.string()),
      }),
    ),
  }),
  tools: ["knowledge.search", "web_search", "html.generate"],
  guardrails: [
    "Pyramid structure enforced",
    "Every section bound to ≥1 evidence row",
    "AICo brand chrome locked",
  ],
  humanCheckpoints: [
    leadCheck("Engagement Lead approves outline"),
    partnerCheck("Partner approves before client send"),
  ],
  evals: [
    { id: "ev_evidence", description: "Every section bound to evidence", threshold: 1 },
    { id: "ev_brand_chrome", description: "Brand chrome present", threshold: 1 },
  ],
});

// POV Author Phase B — generates the full HTML draft from the approved outline.
// Split out from POVAuthor so runAgent can validate each phase against its
// own input/output contract per AGENT_STANDARD.md §6 (multi-step chains).
export const POVDraft = defineAgent({
  id: "ag_pov_draft",
  name: "POV Draft",
  group: "Front of House",
  stage: "Shape",
  purpose: "Renders the approved POV outline into a brand-correct HTML draft with citations bound.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/pov_author/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    opportunityName: z.string().optional(),
    outline: z.unknown(),
    promotedFacts: z.array(z.object({ id: z.string(), statement: z.string() }).passthrough()),
  }),
  outputSchema: z.object({
    sections: z.array(z.object({}).passthrough()),
    html: z.string(),
    citationCoverage: z.number(),
    voiceFlags: z.array(z.unknown()).optional(),
    wordCount: z.number().optional(),
  }).passthrough(),
  tools: ["knowledge.search", "html.generate"],
  guardrails: [
    "Citations rendered for every sourced statement",
    "AICo brand chrome locked",
  ],
  humanCheckpoints: [partnerCheck("Partner approves before client send")],
  evals: [
    { id: "ev_coverage", description: "Citation coverage ≥ 0.8", threshold: 0.8 },
  ],
});

// Task #297 — Brand Profile Writer (Front of House). Canonical source of
// firm brand copy: tagline, mission, boilerplate, differentiators, proof
// points, legal entities, contact block. Other agents (Proposal Composer,
// POV Author, Case Study Picker) consume the published profile rather
// than writing firm boilerplate themselves.
export const BrandProfileWriter = defineAgent({
  id: "ag_brand_profile_writer",
  name: "Brand Profile Writer",
  group: "Front of House",
  stage: "Cross-cutting",
  purpose: "Canonical source of firm brand copy (tagline, mission, boilerplate, differentiators).",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "mvp",
  systemPromptRef: "prompts/brand_profile_writer/v1.md",
  inputSchema: z.object({
    firmName: z.string(),
    existingProfile: z.unknown().nullable().optional(),
    userBrief: z.string().nullable().optional(),
    evidenceCorpus: z.array(z.object({
      id: z.string(),
      kind: z.string(),
      snippet: z.string(),
    })).optional(),
  }),
  outputSchema: z.object({
    firmName: z.string(),
    tagline: z.string(),
    missionStatement: z.string(),
    voiceAttributes: z.array(z.string()),
    principles: z.array(z.object({ name: z.string(), description: z.string() })),
    boilerplateShort: z.string(),
    boilerplateLong: z.string(),
    capabilitiesPitch: z.string(),
    differentiators: z.array(z.string()),
    proofPoints: z.array(z.object({ label: z.string(), metric: z.string() })),
    legalEntities: z.array(z.object({ name: z.string(), jurisdiction: z.string() })),
    contactBlock: z.string(),
    brandColors: z.object({
      primary: z.string().optional(),
      ink: z.string().optional(),
      gold: z.string().optional(),
    }).optional(),
  }).passthrough(),
  tools: ["knowledge.search"],
  guardrails: [
    "Boilerplate-short ≤ 500 chars; boilerplate-long ≤ 1500 chars",
    "Every differentiator must be concrete and observable",
    "Every proof point cites a metric — never inventory unverified claims",
  ],
  humanCheckpoints: [
    {
      id: "cp_publish",
      label: "Founding partner / HR publishes the version",
      decider: "partner",
      blocking: true,
    },
  ],
  evals: [
    { id: "ev_short_len", description: "boilerplateShort ≤ 500 chars", threshold: 1 },
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
  systemPromptRef: "prompts/proposal_composer/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    opportunityName: z.string().optional(),
    sectionsRequired: z.array(z.string()).optional(),
    teamProposed: z.array(z.unknown()).optional(),
    pricingIntent: z.unknown().optional(),
    rfpRequirements: z.array(z.unknown()).optional(),
    curatedWinThemes: z.array(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    title: z.string(),
    sections: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        ownerAgent: z.string().optional(),
        status: z.string(),
        content: z.string(),
        citations: z.array(z.string()).optional(),
      }).passthrough(),
    ),
    pricingModel: z.unknown().optional(),
    winThemes: z.array(z.string()).optional(),
    complianceMatrix: z.array(
      z.object({ requirement: z.string(), status: z.enum(["green", "amber", "red"]) }).passthrough(),
    ),
    complianceOverall: z.enum(["green", "amber", "red"]),
  }).passthrough(),
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
  systemPromptRef: "prompts/meeting_scribe/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    opportunityName: z.string().optional(),
    transcript: z.string().min(1),
    context: z.string().optional(),
    kind: z.enum(["discovery", "workshop", "steering", "kickoff"]).optional(),
    priorBrief: z.unknown().optional(),
  }),
  outputSchema: z.object({
    title: z.string(),
    attendees: z.array(z.object({ name: z.string(), org: z.enum(["client", "aico", "unknown"]) })),
    summary: z.string(),
    decisions: z.array(
      z.object({
        id: z.string(),
        statement: z.string(),
        decidedBy: z.string(),
        confidence: Confidence,
      }),
    ),
    actionItems: z.array(
      z.object({
        id: z.string(),
        owner: z.string(),
        statement: z.string(),
        due: z.string().nullable(),
      }),
    ),
    openQuestions: z.array(z.string()),
    fiveCDelta: z.object({
      client: z.string(),
      competition: z.string(),
      capability: z.string(),
      capacity: z.string(),
      contract: z.string(),
    }),
    suggestedPrototypeBrief: z
      .object({
        audience: z.string(),
        problem: z.string(),
        agenticThesis: z.string(),
        demos: z.array(z.string()),
      })
      .nullable()
      .optional(),
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
  systemPromptRef: "prompts/charter_architect/v1.md",
  inputSchema: z.object({
    engagementId: z.string(),
    engagementName: z.string().optional(),
    accountName: z.string().optional(),
    wonProposalSummary: z.string().min(1),
    kickoffTranscriptExcerpt: z.string().optional(),
  }),
  outputSchema: z.object({
    charter: z.object({
      objectives: z.array(z.unknown()),
      scope: z.unknown(),
      outOfScope: z.unknown(),
      successMetrics: z.array(z.unknown()),
      governance: z.unknown(),
      valueHypothesis: z.unknown(),
    }),
    hypothesisTree: z.unknown(),
    raidBaseline: z.array(z.unknown()).optional(),
    proposedWorkstreams: z.array(z.unknown()).optional(),
    meceFlags: z.array(z.string()).optional(),
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
  systemPromptRef: "prompts/agent_architect/v1.md",
  inputSchema: z.object({
    engagementId: z.string(),
    engagementName: z.string().optional(),
    scopeHint: z.string().optional(),
    source: z.string().min(1),
    depth: z.enum(["sketch", "design"]).optional(),
  }),
  outputSchema: z.object({
    processDiagramMermaid: z.string(),
    steps: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        currentOwner: z.string(),
        category: z.string(),
        agentifiable: z.union([z.boolean(), z.enum(["yes", "partial", "no"])]),
        rationale: z.string(),
      }).passthrough(),
    ),
    candidateAgents: z.array(z.object({}).passthrough()),
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
  systemPromptRef: "prompts/prototype_forge/v1.md",
  inputSchema: z.object({
    engagementId: z.string().nullable().optional(),
    engagementName: z.string().optional(),
    opportunityId: z.string().nullable().optional(),
    targetLabel: z.string().optional(),
    agentDesign: z.unknown().optional(),
    contextNotes: z.string().nullable().optional(),
    brief: z.unknown().optional(),
  }).passthrough(),
  outputSchema: z.object({
    replitPromptMd: z.string().optional(),
    replitPrompt: z.string().optional(),
    buildPlan: z.array(z.unknown()).optional(),
    demoStoryboard: z.array(z.unknown()).optional(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    nonNegotiables: z.array(z.string()).optional(),
  }).passthrough(),
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
  systemPromptRef: "prompts/synthesis_critic/v1.md",
  inputSchema: z.object({
    engagementId: z.string().optional(),
    deliverableId: z.string(),
    deliverableName: z.string().optional(),
    body: z.string().min(1),
    hypothesisTree: z.unknown().optional(),
    audience: z.string().optional(),
  }),
  outputSchema: z.object({
    issues: z.array(
      z.object({
        type: z.string(),
        severity: z.enum(["low", "med", "high", "green", "amber", "red"]),
        location: z.string().optional(),
        description: z.string(),
        suggestion: z.string().optional(),
      }).passthrough(),
    ),
    pyramid_score: z.number().optional(),
    evidence_coverage_pct: z.number().optional(),
    off_hypothesis_sections: z.array(z.string()).optional(),
    readiness: z.enum(["green", "amber", "red"]),
  }).passthrough(),
  tools: ["knowledge.search", "file.read"],
  guardrails: [
    "Critic does not edit; only flags",
    "Send-to-client blocked unless GREEN or Partner override logged",
  ],
  humanCheckpoints: [leadCheck("Engagement Lead reviews issues")],
  evals: [{ id: "ev_no_edit", description: "Critic output does not contain edits", threshold: 1 }],
});

// ============== 7 POST-MVP AGENTS RECONCILED FROM CODE ==============
//
// These agents were built and shipped without registry entries. Schemas
// below mirror what the runner functions in `runner.ts` actually emit
// (read the runner before changing any of these — the registry is now a
// load-bearing contract, not aspirational documentation).

export const BurnSentinel = defineAgent({
  id: "ag_burn_sentinel",
  name: "Burn Sentinel",
  group: "Deliver",
  stage: "Deliver",
  purpose:
    "Hourly sweep that flags engagements crossing 60/80/100% of planned hours and writes Pane A alerts to the Engagement Lead.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "mvp",
  systemPromptRef: "prompts/burn_sentinel/v1.md",
  inputSchema: z.object({
    force: z.boolean().optional(),
  }),
  outputSchema: z.object({
    alertsWritten: z.number().int().nonnegative(),
    engagementsScanned: z.number().int().nonnegative(),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Each (engagement, threshold band) fires at most once",
    "Active PLM stages only (mobilize, deliver, compound)",
    "Burn alerts always flow through Pane A, never email-only",
  ],
  humanCheckpoints: [leadCheck("Engagement Lead acknowledges burn alert")],
  evals: [
    {
      id: "ev_dedupe",
      description: "Re-running the tick produces zero new alerts when state is unchanged",
      threshold: 1,
    },
  ],
});

export const UtilizationAnalyst = defineAgent({
  id: "ag_utilization_analyst",
  name: "Utilization Analyst",
  group: "Personal",
  stage: "Cross-cutting",
  purpose:
    "Narrates utilization snapshots (person / engagement / firm) into headline + risks + actions, with explicit refusal when the numeric block is stale.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "mvp",
  systemPromptRef: "prompts/utilization_analyst/v1.md",
  inputSchema: z.object({
    view: z.enum(["person", "engagement", "firm"]),
    targetId: z.string(),
    targetLabel: z.string(),
    period: z.string(),
    numericBlock: z.record(z.string(), z.unknown()).nullable(),
    computedAt: z.string().nullable().optional(),
  }),
  outputSchema: z.object({
    refusal: z.string().nullable(),
    headline: z.string().nullable(),
    narrative: z.string().nullable(),
    risks: z.array(
      z.object({
        id: z.string(),
        severity: z.enum(["amber", "red"]),
        statement: z.string(),
      }),
    ),
    actions: z.array(z.object({ id: z.string(), action: z.string(), owner: z.string() })),
    confidence: Confidence,
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Refuse to narrate if numeric block is missing or older than 24h",
    "Numbers are never invented — narrative is bounded by the block",
  ],
  humanCheckpoints: [],
  evals: [
    { id: "ev_refusal", description: "Returns refusal=non-null when block is stale", threshold: 1 },
  ],
});

export const ExpenseAuditor = defineAgent({
  id: "ag_expense_auditor",
  name: "Expense Auditor",
  group: "Quality",
  stage: "Cross-cutting",
  purpose:
    "Classifies expense submissions, computes VAT (KSA / UAE / zero-rated), determines client-billability against the contract digest, and proposes markup.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "mvp",
  systemPromptRef: "prompts/expense_auditor/v1.md",
  inputSchema: z.object({
    expenseId: z.string(),
    ocr: z
      .object({
        merchant: z.string().optional(),
        date: z.string().optional(),
        total: z.number().optional(),
        tax: z.number().optional(),
        currency: z.string().optional(),
        country: z.string().optional(),
        category: z.string().optional(),
        rawText: z.string().optional(),
        confidence: Confidence.optional(),
      })
      .nullable(),
    contractDigest: z
      .object({
        expensesClause: z.boolean().optional(),
        expenseMarkupCapPct: z.number().optional(),
        permittedCategories: z.array(z.string()).optional(),
        summary: z.string().optional(),
      })
      .nullable(),
    draft: z.object({
      amount: z.number(),
      currency: z.string(),
      country: z.string().optional(),
      category: z.string().optional(),
      engagementId: z.string().nullable().optional(),
    }),
  }),
  outputSchema: z.object({
    category: z.enum([
      "flight",
      "hotel",
      "meal",
      "gift",
      "software",
      "mileage",
      "per_diem",
      "taxi",
      "other",
    ]),
    vatTreatment: z.enum(["ksa_15", "uae_5", "zero_rated_export", "none"]),
    vatAmount: z.number(),
    clientBillable: z.boolean(),
    markupPct: z.number(),
    summary: z.string(),
    ocrConfidence: Confidence,
    refused: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  tools: ["ocr.read", "knowledge.search"],
  guardrails: [
    "Refuse on OCR confidence=red; require human entry",
    "Markup capped at engagement contract value",
    "Billability requires explicit contract clause",
  ],
  humanCheckpoints: [leadCheck("Engagement Lead approves billable expense")],
  evals: [
    {
      id: "ev_refuse_low_ocr",
      description: "refused=true when ocr.confidence is missing or red",
      threshold: 1,
    },
  ],
});

export const PricingStrategist = defineAgent({
  id: "ag_pricing_strategist",
  name: "Pricing Strategist",
  group: "Front of House",
  stage: "Pursue",
  purpose:
    "Builds primary + alternative pricing structures, narrates the deal with talking points and risks, and surfaces partner-override / two-partner triggers.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "mvp",
  systemPromptRef: "prompts/pricing_strategist/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    pricing: z.object({
      id: z.string(),
      teamMix: z.unknown(),
      durationWeeks: z.number(),
      pricingModel: z.string(),
      rateCardId: z.string(),
    }),
    policy: z.object({
      targetMarginPct: z.number(),
      partnerOverrideMarginPct: z.number().optional(),
      twoPartnerMarginPct: z.number().optional(),
    }),
    primaryIntent: z.string().optional(),
    alternativeLenses: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    primary: z.object({
      pricingModel: z.string(),
      durationWeeks: z.number(),
      teamMix: z.array(z.unknown()),
      cost: z.number(),
      price: z.number(),
      marginPct: z.number(),
      marginLockStatus: z.enum(["green", "amber", "red"]),
      narrative: z.string(),
    }),
    alternatives: z.array(
      z.object({
        pricingModel: z.string(),
        durationWeeks: z.number(),
        teamMix: z.array(z.unknown()),
        cost: z.number(),
        price: z.number(),
        marginPct: z.number(),
        marginLockStatus: z.enum(["green", "amber", "red"]),
        story: z.string(),
      }),
    ),
    talkingPoints: z.array(z.string()),
    risks: z.array(z.string()),
    marginLockChip: z.enum(["green", "amber", "red"]),
    partnerOverrideRequired: z.boolean(),
    twoPartnerRequired: z.boolean(),
    confidence: Confidence.optional(),
    source: z.enum(["claude", "mock_config", "mock_fallback"]).optional(),
    runId: z.string().optional(),
  }).passthrough(),
  tools: ["knowledge.search", "pricing_rules.lookup", "rate_card.read"],
  guardrails: [
    "Numeric pricing math NEVER delegated to the LLM — owned by lib/atelier-pricing",
    "Sub-target margin requires Partner override; sub-floor margin requires two Partners",
    "Tool evidence (rate card, pricing rules) attached to every brief",
  ],
  humanCheckpoints: [
    partnerCheck("Partner reviews pricing brief"),
    partnerCheck("Second Partner countersign on RED margin"),
  ],
  evals: [
    {
      id: "ev_math_match",
      description: "Primary structure margin matches deterministic computePricing output",
      threshold: 1,
    },
  ],
});

export const WinLossInterviewer = defineAgent({
  id: "ag_win_loss_interviewer",
  name: "Win/Loss Interviewer",
  group: "Quality",
  stage: "Cross-cutting",
  purpose:
    "Synthesises a buyer debrief into authentic reasons, hidden competitor, themes with evidence quotes, and Atelier lesson candidates.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "mvp",
  systemPromptRef: "prompts/win_loss_interviewer/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    opportunityName: z.string().optional(),
    outcome: z.enum(["won", "lost", "no_decision", "withdrawn"]),
    sellerPerceivedReasons: z.array(z.string()).optional(),
    buyerTranscript: z.string().min(1),
  }),
  outputSchema: z.object({
    buyerAuthenticReasons: z.array(z.string()),
    hiddenCompetitor: z.enum(["direct", "partner_firm", "status_quo", "inhouse", "unknown"]),
    themes: z.array(
      z.object({
        name: z.string(),
        tag: z.string(),
        evidenceQuote: z.string(),
        polarity: z.enum(["win", "loss"]),
      }),
    ),
    whatWeWouldDoDifferently: z.string(),
    suggestedAtelierLessons: z.array(
      z.object({
        title: z.string(),
        abstract: z.string(),
        kind: z.enum(["learning", "framework", "case_study"]),
      }),
    ),
    confidence: Confidence,
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Every theme must include a verbatim evidence quote",
    "Hidden competitor field is required (use `unknown` if absent)",
  ],
  humanCheckpoints: [leadCheck("Engagement Lead reviews debrief before lesson promotion")],
  evals: [
    { id: "ev_quote", description: "Every theme has a non-empty evidenceQuote", threshold: 1 },
  ],
});

export const CaseStudyPicker = defineAgent({
  id: "ag_case_study_picker",
  name: "Case Study Picker",
  group: "Front of House",
  stage: "Pursue",
  purpose:
    "Selects the top-N most relevant case studies for an opportunity from the Atelier corpus and explains the rationale.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/case_study_picker/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    opportunityContext: z.string(),
    candidatePool: z.array(
      z.object({
        id: z.string(),
        client: z.string().optional(),
        sector: z.string().optional(),
        outcome: z.string().optional(),
        metric: z.string().optional(),
      }),
    ),
    n: z.number().int().min(1).max(10).optional(),
  }),
  outputSchema: z.object({
    selectedIds: z.array(z.string()),
    rationale: z.string(),
    top3: z.array(
      z.object({
        id: z.string(),
        client: z.string(),
        sector: z.string(),
        outcome: z.string(),
        metric: z.string(),
      }),
    ),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Selections must come from the supplied candidatePool — no inventing",
    "Rationale references at least one concrete evidence dimension",
  ],
  humanCheckpoints: [leadCheck("Engagement Lead approves chosen case studies")],
  evals: [
    { id: "ev_in_pool", description: "Every selectedId exists in candidatePool", threshold: 1 },
  ],
});

export const ThemeCurator = defineAgent({
  id: "ag_theme_curator",
  name: "Theme Curator",
  group: "Quality",
  stage: "Cross-cutting",
  purpose:
    "Rolls up Win/Loss debrief themes into firm-wide themes, surfaces emergent patterns, and proposes which open opportunities they should be applied to.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/theme_curator/v1.md",
  inputSchema: z.object({
    debriefThemes: z.array(z.unknown()),
    openOpportunityIds: z.array(z.string()),
  }),
  outputSchema: z.object({
    upsertThemes: z.array(
      z.object({
        tag: z.string(),
        name: z.string(),
        description: z.string(),
        polarity: z.enum(["win", "loss"]),
        contributingDebriefIds: z.array(z.string()),
        positioningLine: z.string(),
        offeringTags: z.array(z.string()).optional(),
        sectorTags: z.array(z.string()).optional(),
      }).passthrough(),
    ),
    emergentThemes: z.array(
      z.object({
        tag: z.string(),
        name: z.string(),
        supportingQuotes: z.array(z.string()),
      }),
    ),
    openProposalSuggestions: z.array(
      z.object({
        opportunityId: z.string(),
        themeTag: z.string(),
        rationale: z.string(),
      }),
    ),
    confidence: Confidence,
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Emergent themes must cite ≥2 supporting debriefs",
    "Open-proposal suggestions tied to a real openOpportunityId",
  ],
  humanCheckpoints: [partnerCheck("Partner curates Atelier theme catalog")],
  evals: [
    { id: "ev_emergent_support", description: "Emergent themes have ≥2 supportingQuotes", threshold: 1 },
  ],
});

// ====================== v5 — 15 NEW AGENTS (Task #355) ======================
//
// 15 v5 agents introduced by Task #306 prompts. Each has a `run<X>` function
// in artifacts/api-server/src/lib/atelier-agents/runner.ts composed via
// runAgent() and is reachable through the generic
// POST /api/atelier/agents/:agentId/run dispatcher. Output schemas are
// kept lenient (`.passthrough()`) so prompt evolution doesn't break the
// validation gate; the prompt files remain the strict shape contract.

const v5Output = (extra: Record<string, ZodTypeAny> = {}) =>
  z.object({ confidence: Confidence, ...extra }).passthrough();

// --- Press / publishing ---

export const LinkedInComposer = defineAgent({
  id: "ag_linkedin_composer",
  name: "LinkedIn Composer",
  group: "Front of House",
  stage: "Compound",
  purpose: "Drafts a LinkedIn post in a named Partner's voice from a cleared internal artifact.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/linkedin_composer/v1.md",
  inputSchema: z.object({
    partnerId: z.string(),
    sourceArtifactId: z.string(),
    sourceArtifactKind: z.string(),
    targetLength: z.enum(["short", "medium", "long"]).optional(),
  }).passthrough(),
  outputSchema: v5Output({ partnerId: z.string(), variants: z.array(z.unknown()) }),
  tools: ["knowledge.search"],
  guardrails: [
    "Never quote unredacted client names",
    "Respect Partner voice profile",
    "Max 3 hashtags; no engagement bait",
  ],
  humanCheckpoints: [partnerCheck("Partner approves the post")],
  evals: [{ id: "ev_voice_match", description: "voiceMatchScore ≥ 0.75", threshold: 1 }],
});

export const PressMonitor = defineAgent({
  id: "ag_press_monitor",
  name: "Press Monitor",
  group: "Front of House",
  stage: "Compound",
  purpose: "Daily web scan for AICo, Partner, and competitor mentions; weekly digest to Partner inbox.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/press_monitor/v1.md",
  inputSchema: z.object({
    lookbackDays: z.number().int().min(1).max(90).optional(),
    watchlistPartners: z.array(z.string()).optional(),
    watchlistCompetitors: z.array(z.string()).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    aicoMentions: z.array(z.unknown()),
    competitorThemes: z.array(z.unknown()),
  }),
  tools: ["web_search"],
  guardrails: ["Cite every mention", "Dedupe by canonical URL", "Never aggregate paywalled excerpts"],
  humanCheckpoints: [],
  evals: [{ id: "ev_cite_all", description: "Every mention has a URL", threshold: 1 }],
});

export const FieldNotesScheduler = defineAgent({
  id: "ag_field_notes_scheduler",
  name: "Field Notes Scheduler",
  group: "Front of House",
  stage: "Compound",
  purpose: "Assembles + schedules the monthly Field Notes newsletter from cleared artifacts.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/field_notes_scheduler/v1.md",
  inputSchema: z.object({
    issueMonth: z.string(),
    subscriberSegment: z.string().optional(),
    candidateArtifactIds: z.array(z.string()).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    issueId: z.string(),
    subjectLine: z.string(),
    sections: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: ["Never include uncleared artifact", "Subject line < 60 chars"],
  humanCheckpoints: [partnerCheck("Partner approves the issue")],
  evals: [{ id: "ev_subject_len", description: "subjectLine ≤ 60 chars", threshold: 1 }],
});

// --- Alliances ---

export const AllianceChoreographer = defineAgent({
  id: "ag_alliance_choreographer",
  name: "Alliance Choreographer",
  group: "Front of House",
  stage: "Pursue",
  purpose: "Drives joint pursuits with partner firms — split, comms cadence, conflict-of-interest checks.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/alliance_choreographer/v1.md",
  inputSchema: z.object({
    opportunityId: z.string(),
    partnerFirmId: z.string(),
    leadParty: z.enum(["aico", "partner"]).optional(),
    proposedSplitPct: z.number().min(0).max(100).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    opportunityId: z.string(),
    partnerFirmId: z.string(),
    split: z.unknown(),
    conflicts: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: ["Flag split outside 50–70% band", "Require signed alliance letter", "Cite every conflict signal"],
  humanCheckpoints: [partnerCheck("Partner approves split"), partnerCheck("Partner approves alliance letter")],
  evals: [{ id: "ev_conflict_cited", description: "Every conflict has evidence", threshold: 1 }],
});

export const CertificationTracker = defineAgent({
  id: "ag_certification_tracker",
  name: "Certification Tracker",
  group: "Personal",
  stage: "Cross-cutting",
  purpose: "Tracks platform certs (AWS/Azure/GCP/Anthropic/Databricks/Snowflake) and books renewals.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/certification_tracker/v1.md",
  inputSchema: z.object({
    lookbackDays: z.number().int().optional(),
    lookaheadDays: z.number().int().optional(),
    firmPartnerTiers: z.array(z.unknown()).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    lapsing: z.array(z.unknown()),
    lapsed: z.array(z.unknown()),
    partnerTierImpact: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: ["Never self-attest a lapsed cert", "Flag partner-tier at risk", "Cite every renewal window"],
  humanCheckpoints: [{ id: "cp_hr", label: "HR approves exam booking", decider: "partner", blocking: true }],
  evals: [{ id: "ev_no_self_attest", description: "lapsed certs are flagged blocker=true", threshold: 1 }],
});

// --- Studio (recruiting) ---

export const InterviewDesigner = defineAgent({
  id: "ag_interview_designer",
  name: "Interview Designer",
  group: "Personal",
  stage: "Cross-cutting",
  purpose: "Designs interview panel, scorecard, and (for AI Engineer roles) take-home prompt.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/interview_designer/v1.md",
  inputSchema: z.object({
    roleId: z.string(),
    roleLevel: z.string().optional(),
    candidateId: z.string().optional(),
  }).passthrough(),
  outputSchema: v5Output({
    roleId: z.string(),
    panel: z.array(z.unknown()),
    scorecard: z.unknown(),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Never ask protected-class questions",
    "Same panel questions per (role, level)",
    "Take-home under 4 hours; calibrated scorecard anchors",
  ],
  humanCheckpoints: [{ id: "cp_hm", label: "Hiring manager approves panel", decider: "partner", blocking: true }],
  evals: [{ id: "ev_take_home_4h", description: "takeHome.estHours ≤ 4", threshold: 1 }],
});

export const ReferenceCaller = defineAgent({
  id: "ag_reference_caller",
  name: "Reference Caller",
  group: "Personal",
  stage: "Cross-cutting",
  purpose: "Structured reference summary from a transcribed live call or async-video reference.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/reference_caller/v1.md",
  inputSchema: z.object({
    candidateId: z.string(),
    referenceId: z.string(),
    roleId: z.string(),
    callTranscriptOrVideoId: z.string(),
  }).passthrough(),
  outputSchema: v5Output({
    candidateId: z.string(),
    referenceId: z.string(),
    summary: z.unknown(),
    consentVerified: z.boolean().optional(),
  }),
  tools: ["transcribe.audio"],
  guardrails: [
    "Never record without consent_verified=true",
    "Extract only from transcript",
    "Flag inconsistencies with resume",
  ],
  humanCheckpoints: [{ id: "cp_recruiter", label: "Recruiter approves summary", decider: "partner", blocking: true }],
  evals: [{ id: "ev_consent", description: "consentVerified=true required to publish", threshold: 1 }],
});

export const OfferComposer = defineAgent({
  id: "ag_offer_composer",
  name: "Offer Composer",
  group: "Personal",
  stage: "Cross-cutting",
  purpose: "Drafts the offer letter + comp narrative for an approved candidate.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/offer_composer/v1.md",
  inputSchema: z.object({
    candidateId: z.string(),
    roleId: z.string(),
    approvedCompBandId: z.string(),
    startDate: z.string().optional(),
  }).passthrough(),
  outputSchema: v5Output({
    candidateId: z.string(),
    roleId: z.string(),
    letterMarkdown: z.string(),
    compNarrative: z.unknown(),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Never exceed approved comp band",
    "Jurisdiction-compliant letter template",
    "Partner sign-off required above band",
  ],
  humanCheckpoints: [partnerCheck("Partner approves offer"), { id: "cp_finance", label: "Finance counter-signs", decider: "partner", blocking: true }],
  evals: [{ id: "ev_in_band", description: "totalAtTarget within approved band", threshold: 1 }],
});

// --- Guardhouse (security & compliance) ---

export const ComplianceSentinel = defineAgent({
  id: "ag_compliance_sentinel",
  name: "Compliance Sentinel",
  group: "Quality",
  stage: "Cross-cutting",
  purpose: "Maintains SOC2 Type II + ISO 27001 control posture; collects evidence; flags gaps.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/compliance_sentinel/v1.md",
  inputSchema: z.object({
    controlFramework: z.enum(["soc2_type2", "iso27001"]).optional(),
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
  }).passthrough(),
  outputSchema: v5Output({
    framework: z.string(),
    controls: z.array(z.unknown()),
    gaps: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: ["Never fabricate evidence", "Cite collection query", "Flag stale evidence (>30d)"],
  humanCheckpoints: [{ id: "cp_compliance", label: "Compliance Officer attests", decider: "partner", blocking: true }],
  evals: [{ id: "ev_no_fabricate", description: "Each control has an evidenceArtifactId or status=gap", threshold: 1 }],
});

export const IncidentResponder = defineAgent({
  id: "ag_incident_responder",
  name: "Incident Responder",
  group: "Quality",
  stage: "Cross-cutting",
  purpose: "Drives an incident from page → post-mortem; preserves chain-of-custody.",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/incident_responder/v1.md",
  inputSchema: z.object({
    incidentId: z.string(),
    severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
    triggerKind: z.string().optional(),
    initialSignal: z.string().optional(),
  }).passthrough(),
  outputSchema: v5Output({
    incidentId: z.string(),
    severity: z.string(),
    phase: z.string(),
    timeline: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Never overwrite audit chain",
    "Cite every action with actor + timestamp",
    "Sev1 — Partner paged within 15 min",
    "Customer comms only after legal review",
  ],
  humanCheckpoints: [
    { id: "cp_oncall", label: "On-call acknowledges", decider: "partner", blocking: true },
    partnerCheck("Partner approves customer comms"),
    { id: "cp_close", label: "Compliance Officer closes", decider: "partner", blocking: true },
  ],
  evals: [{ id: "ev_timeline_attribution", description: "Every timeline entry has actor + ts", threshold: 1 }],
});

export const DsarConcierge = defineAgent({
  id: "ag_dsar_concierge",
  name: "DSAR Concierge",
  group: "Quality",
  stage: "Cross-cutting",
  purpose: "Drives a Data Subject Access Request through statutory windows (KSA PDPL / UAE DIFC / GDPR).",
  model: "claude-sonnet-4-6",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/dsar_concierge/v1.md",
  inputSchema: z.object({
    dsarId: z.string(),
    jurisdiction: z.enum(["ksa_pdpl", "uae_difc", "gdpr", "other"]),
    subjectIdentifier: z.string(),
    requestKind: z.enum(["access", "rectify", "delete", "portability", "object"]),
  }).passthrough(),
  outputSchema: v5Output({
    dsarId: z.string(),
    jurisdiction: z.string(),
    phase: z.string(),
    statutoryDueAt: z.string(),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Never disclose third-party PII",
    "Identity verification required before discovery",
    "Flag when due in <5 days",
    "Redact via corpus PII classifier",
  ],
  humanCheckpoints: [
    { id: "cp_id_verify", label: "Compliance Officer verifies identity", decider: "partner", blocking: true },
    { id: "cp_resp", label: "Compliance Officer approves response", decider: "partner", blocking: true },
  ],
  evals: [{ id: "ev_due_clock", description: "statutoryDueAt set on every run", threshold: 1 }],
});

export const BackupAuditor = defineAgent({
  id: "ag_backup_auditor",
  name: "Backup Auditor",
  group: "Quality",
  stage: "Cross-cutting",
  purpose: "Verifies backups across primary stores and runs quarterly restore drills.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/backup_auditor/v1.md",
  inputSchema: z.object({
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
    primaryStores: z.array(z.unknown()).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    stores: z.array(z.unknown()),
    restoreDrill: z.unknown(),
    alerts: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: ["Never skip restore drill on red flag", "Flag missed window within 24h", "Cite backup-log artifact id"],
  humanCheckpoints: [{ id: "cp_compliance", label: "Compliance Officer reviews drill", decider: "partner", blocking: true }],
  evals: [{ id: "ev_drill", description: "restoreDrill.performedAt set", threshold: 1 }],
});

// --- IP / Asset catalog ---

export const IpSteward = defineAgent({
  id: "ag_ip_steward",
  name: "IP Steward",
  group: "Atelier",
  stage: "Compound",
  purpose: "Tracks ownership, freshness, and licensing of internal IP assets.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/ip_steward/v1.md",
  inputSchema: z.object({
    lookbackDays: z.number().int().optional(),
    assetKinds: z.array(z.string()).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    freshnessNags: z.array(z.unknown()),
    unlicensedAssets: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Never change owner without owner acknowledge",
    "Flag unlicensed repo",
    "Flag engagement use without grant",
  ],
  humanCheckpoints: [{ id: "cp_owner", label: "Owner acknowledges freshness nag", decider: "partner", blocking: true }],
  evals: [{ id: "ev_owner_ack", description: "ownerSwapRequests require ack", threshold: 1 }],
});

export const OssComplianceSentinel = defineAgent({
  id: "ag_oss_compliance_sentinel",
  name: "OSS Compliance Sentinel",
  group: "Quality",
  stage: "Cross-cutting",
  purpose: "Walks dependency manifests, classifies licenses, and flags incompatibilities pre-ship.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/oss_compliance_sentinel/v1.md",
  inputSchema: z.object({
    repoId: z.string(),
    manifestPaths: z.array(z.string()).optional(),
  }).passthrough(),
  outputSchema: v5Output({
    repoId: z.string(),
    dependencies: z.array(z.unknown()),
    blockers: z.array(z.unknown()),
  }),
  tools: ["knowledge.search"],
  guardrails: [
    "Block copyleft in proprietary engagement",
    "Block unknown license",
    "Cite license source URL",
  ],
  humanCheckpoints: [{ id: "cp_eng_lead", label: "Engineering Lead approves exception", decider: "engagement_lead", blocking: true }],
  evals: [{ id: "ev_no_unknown", description: "No license=unknown lands as ok", threshold: 1 }],
});

export const DemoEnvironmentCurator = defineAgent({
  id: "ag_demo_environment_curator",
  name: "Demo Environment Curator",
  group: "Atelier",
  stage: "Compound",
  purpose: "Sub-agent of IP Steward — keeps live demos reachable, fresh, and on-script.",
  model: "claude-haiku-4-5",
  starred: false,
  status: "registered",
  systemPromptRef: "prompts/demo_environment_curator/v1.md",
  inputSchema: z.object({
    demoId: z.string(),
    canonicalScriptId: z.string().optional(),
  }).passthrough(),
  outputSchema: v5Output({
    demoId: z.string(),
    url: z.string().optional(),
    freshness: z.enum(["fresh", "stale", "broken"]).optional(),
  }),
  tools: ["web_search"],
  guardrails: [
    "Never modify demo environment",
    "Capture screenshot with redacted PII",
    "Flag uptime < 99% (30d)",
  ],
  humanCheckpoints: [{ id: "cp_owner", label: "Owner acknowledges drift", decider: "partner", blocking: true }],
  evals: [{ id: "ev_uptime", description: "uptime30d present", threshold: 1 }],
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
  // MVP — fully wired end-to-end
  PursuitScout,
  POVAuthor,
  POVDraft,
  BrandProfileWriter,
  ProposalComposer,
  MeetingScribe,
  CharterArchitect,
  AgentArchitect,
  PrototypeForge,
  SynthesisCritic,
  // Reconciled post-MVP — runner + prompt + UI exist
  BurnSentinel,
  UtilizationAnalyst,
  ExpenseAuditor,
  PricingStrategist,
  WinLossInterviewer,
  CaseStudyPicker,
  ThemeCurator,
  // v5 — 15 new agents (Task #355) — runner + prompt + dispatch route
  LinkedInComposer,
  PressMonitor,
  FieldNotesScheduler,
  AllianceChoreographer,
  CertificationTracker,
  InterviewDesigner,
  ReferenceCaller,
  OfferComposer,
  ComplianceSentinel,
  IncidentResponder,
  DsarConcierge,
  BackupAuditor,
  IpSteward,
  OssComplianceSentinel,
  DemoEnvironmentCurator,
  // Registered stubs — catalog only, await implementation
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

/**
 * Look up an agent by id. Accepts either the canonical `ag_<snake>` form
 * or the legacy bare `<snake>` form used by some pre-standard runners.
 */
export function getAgent(id: string): Agent | undefined {
  if (AGENT_BY_ID[id]) return AGENT_BY_ID[id];
  if (!id.startsWith("ag_")) return AGENT_BY_ID[`ag_${id}`];
  return undefined;
}
