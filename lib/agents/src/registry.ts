import { defineAgent, z, type Agent, type HumanCheckpoint } from "./types.js";

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
