import type {
  ChatFrame,
  ChatTurnCore,
} from "../../../../lib/chat-core/src/types.js";
import * as mobileSemanticAdapter from "../../../atelier-mobile/lib/semanticAdapter.ts";
import * as webSemanticAdapter from "../../../atelier/src/components/cli/semanticAdapter.ts";
import {
  resolveClarificationReply,
  type PendingClarificationSpec,
} from "../../src/lib/atelier-cli/clarification-resolver.js";
import {
  isAlwaysIncludedTool,
  scoreCapabilityRows,
  selectRankedAdaptive,
  summaryTextFor,
} from "../../src/lib/atelier-cli/capability-retriever.js";
import {
  capabilitiesForPersona,
  type CapabilityEntry,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import {
  cosine,
  embedTexts,
  type EmbeddingResult,
} from "../../src/lib/atelier-cli/embeddings.js";
import { deterministicClassify } from "../../src/lib/atelier-cli/intent-router.js";
import { synthesizePresentation } from "../../src/lib/atelier-cli/presentation-registry.js";
import type { RiserEvalMetricV1 } from "@workspace/assistant-protocol";

export interface RiserEvalObservation {
  id: string;
  metric: RiserEvalMetricV1;
  capabilityId: string | null;
  severity: "one" | "two";
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

const observation = (
  value: Omit<RiserEvalObservation, "severity"> & {
    severity?: RiserEvalObservation["severity"];
  },
): RiserEvalObservation => ({ severity: "two", ...value });

function intentObservations(): RiserEvalObservation[] {
  const verbs = [
    ["read", "show"],
    ["create", "create"],
    ["update", "update"],
    ["link", "link"],
    ["delete", "delete"],
    ["transition", "move"],
    ["reset", "reset the"],
  ] as const;
  const kinds = [
    ["account", "account"],
    ["opportunity", "opportunity"],
    ["contact", "contact"],
    ["engagement", "engagement"],
    ["meeting", "meeting"],
    ["invoice", "invoice"],
    ["contract", "contract"],
  ] as const;
  return verbs.flatMap(([verb, opener]) =>
    kinds.map(([kind, noun]) => {
      const prompt =
        verb === "transition"
          ? `${opener} the ${noun} to won`
          : verb === "reset"
            ? `${opener} session about the ${noun}`
            : `${opener} the ${noun}`;
      const actual = deterministicClassify(prompt);
      return observation({
        id: `intent.${verb}.${kind}`,
        metric: "supported_intent_operation_accuracy",
        capabilityId: null,
        expected: { verb, kind },
        actual: { verb: actual.verb, kind: actual.kind },
        passed: actual.verb === verb && actual.kind === kind,
      });
    }),
  );
}

async function rankingObservations(seed: number): Promise<RiserEvalObservation[]> {
  const capabilities = capabilitiesForPersona({
    id: "__riser_eval__",
    name: "Riser evaluator",
    role: "founding_partner",
    orgId: "aico",
  } as never);
  const fixtures = capabilities
    .filter((capability) => !isAlwaysIncludedTool(capability.toolName))
    .flatMap((capability) =>
      (capability.representativePrompts?.en ?? []).map((prompt) => ({
        capability,
        prompt,
      })),
    )
    .sort((a, b) =>
      `${a.capability.id}:${a.prompt}`.localeCompare(
        `${b.capability.id}:${b.prompt}`,
      ),
    );
  const summaries = capabilities.map(summaryTextFor);
  const embedded = await embedTexts([
    ...summaries,
    ...fixtures.map((fixture) => fixture.prompt),
  ]);
  const capabilityVectors = embedded.slice(0, capabilities.length);
  const promptVectors = embedded.slice(capabilities.length);
  const toolRows = capabilities.map((capability, index) => ({
    capability,
    vector: capabilityVectors[index]!.vec,
  }));
  return fixtures.flatMap(({ capability, prompt }, index) => {
    const promptVector = promptVectors[index]!.vec;
    const candidates = toolRows
      .map((row) => ({
        tool: row.capability.toolName,
        score: cosine(promptVector, row.vector),
      }))
      .sort((a, b) =>
        b.score - a.score ||
        ((seed + index) % 2 === 0
          ? a.tool.localeCompare(b.tool)
          : b.tool.localeCompare(a.tool)),
      );
    const selected = selectRankedAdaptive(candidates, {
      baseBudget: 3,
      maxBudget: 3,
    });
    const rank = selected.indexOf(capability.toolName);
    return [
      observation({
        id: `ranking.${capability.id}.${index}.top1`,
        metric: "capability_top_1",
        capabilityId: capability.id,
        expected: { maxRank: 1 },
        actual: { prompt, rank: rank + 1, selected },
        passed: rank === 0,
      }),
      observation({
        id: `ranking.${capability.id}.${index}.top3`,
        metric: "capability_top_3",
        capabilityId: capability.id,
        expected: { maxRank: 3 },
        actual: { prompt, rank: rank + 1, selected },
        passed: rank >= 0 && rank < 3,
      }),
    ];
  }).flat();
}

async function abstentionObservations(): Promise<RiserEvalObservation[]> {
  const faults = ["provider-timeout", "model-load-failure", "invalid-provider-response"];
  const providerFaultRows = await Promise.all(
    faults.map(async (message) => {
      let actual: unknown = null;
      try {
        await scoreCapabilityRows({
          query: "show accounts",
          rows: [{ toolName: "account_list", vec: [1] }],
          eligibleNames: new Set(["account_list"]),
          embed: async (): Promise<EmbeddingResult> => {
            throw new Error(message);
          },
        });
      } catch (error) {
        actual = error instanceof Error ? error.message : String(error);
      }
      return observation({
        id: `provider-fault.${message}`,
        metric: "provider_unrelated_capability",
        capabilityId: null,
        severity: "one",
        expected: message,
        actual,
        passed: actual === message,
      });
    }),
  );
  const unsupportedPrompts = [
    "Paint a watercolor sunset",
    "Diagnose this medical rash",
    "Order a pizza to my house",
    "Change the office thermostat",
    "Write malware for a laptop",
    "Transfer cryptocurrency",
    "Control the conference-room lights",
    "Call an ambulance",
    "Buy concert tickets",
    "Unlock the building door",
    "Publish a social-media post",
    "Approve a personal bank loan",
  ];
  const unsupportedRows = unsupportedPrompts.map((prompt) => {
    const classified = deterministicClassify(prompt);
    return observation({
      id: `unsupported.${prompt.replaceAll(" ", "-")}`,
      metric: "unsupported_abstention",
      capabilityId: null,
      expected: { kind: "unknown" },
      actual: { verb: classified.verb, kind: classified.kind },
      passed: classified.kind === "unknown",
    });
  });
  return [...unsupportedRows, ...providerFaultRows];
}

function clarificationObservations(): RiserEvalObservation[] {
  const pending: PendingClarificationSpec = {
    tool: "travel_search_stays",
    field: "checkIn",
    question: "What is the check-in date?",
    partial: { city: "Istanbul" },
    fields: [{ field: "checkIn", label: "Check-in", inputType: "date" }],
  };
  const now = new Date("2026-07-29T04:00:00Z");
  const answerCases = [
    ["today", "2026-07-29"],
    ["tomorrow", "2026-07-30"],
    ["next tuesday", "2026-08-04"],
    ["in 3 days", "2026-08-01"],
    ["2027-03-02", "2027-03-02"],
    ["yesterday", "2026-07-28"],
    ["next monday", "2026-08-03"],
    ["in 2 days", "2026-07-31"],
    ["in 5 days", "2026-08-03"],
    ["2027-12-31", "2027-12-31"],
  ] as const;
  const freshCases = [
    "show all accounts",
    "create an invoice",
    "find the opportunity",
    "update my expense",
    "list all employees",
    "delete the draft contract",
    "schedule a meeting",
    "export the finance report",
    "approve the payment",
    "search the document library",
  ];
  const out: RiserEvalObservation[] = [];
  for (const [reply, expected] of answerCases) {
    const actual = resolveClarificationReply({
      reply,
      pending,
      facts: [],
      timezone: "Asia/Dubai",
      now,
    });
    out.push(observation({
      id: `clarification.answer.${reply.replaceAll(" ", "-")}`,
      metric: "clarification_precision",
      capabilityId: "travel.search_stays",
      expected: { kind: "values", value: expected },
      actual,
      passed:
        actual.kind === "values" &&
        actual.values.checkIn === expected,
    }));
  }
  for (const reply of freshCases) {
    const actual = resolveClarificationReply({
      reply,
      pending,
      facts: [],
      timezone: "Asia/Dubai",
      now,
    });
    out.push(observation({
      id: `clarification.fresh.${reply.replaceAll(" ", "-")}`,
      metric: "clarification_precision",
      capabilityId: "travel.search_stays",
      expected: { kind: "fresh_request" },
      actual,
      passed: actual.kind === "fresh_request",
    }));
  }
  return out;
}

const rosterList = {
  id: "roster.list",
  schemaVersion: 2,
  schemaHash: "123456789abc",
  module: "roster",
  toolName: "roster_list",
  description: "List the roster",
  slashAliases: {},
  inputSchema: {},
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  irreversible: false,
  surfaceOn: ["global"],
  source: "catalog",
  run: async () => ({ ok: true }),
} as CapabilityEntry;

const rosterPerson = {
  ...rosterList,
  id: "roster.person_detail",
  toolName: "person_detail",
  description: "Show a person",
  resultCard: "contact_card",
} as CapabilityEntry;

function presentationObservations(): RiserEvalObservation[] {
  const cases: Array<{
    id: string;
    capability: CapabilityEntry;
    prompt: string;
    intent: { verb: "read" | "update"; kind: "contact" | "invoice" };
    data: unknown;
    expectedCard: "ranked_list" | "contact_card" | null;
  }> = [
    { id: "list.items", capability: rosterList, prompt: "List all employees", intent: { verb: "read", kind: "contact" }, data: { items: [{ id: "p1", name: "Ada" }], total: 1 }, expectedCard: "ranked_list" },
    { id: "list.empty-meaningful", capability: rosterList, prompt: "Show all contacts", intent: { verb: "read", kind: "contact" }, data: { items: [], total: 0 }, expectedCard: "ranked_list" },
    { id: "list.directory", capability: rosterList, prompt: "Open the people directory", intent: { verb: "read", kind: "contact" }, data: { items: [{ email: "a@example.test" }] }, expectedCard: "ranked_list" },
    { id: "person.root-identity", capability: rosterPerson, prompt: "Who is Ada Lovelace?", intent: { verb: "read", kind: "contact" }, data: { id: "p1", name: "Ada Lovelace" }, expectedCard: "contact_card" },
    { id: "person.nested-identity", capability: rosterPerson, prompt: "Show contact Ada", intent: { verb: "read", kind: "contact" }, data: { person: { id: "p2", name: "Ada" } }, expectedCard: "contact_card" },
    { id: "list.non-list-prompt", capability: rosterList, prompt: "Who is the CEO?", intent: { verb: "read", kind: "contact" }, data: { items: [{ id: "p1" }] }, expectedCard: null },
    { id: "list.wrong-kind", capability: rosterList, prompt: "List all invoices", intent: { verb: "read", kind: "invoice" }, data: { items: [{ id: "p1" }] }, expectedCard: null },
    { id: "list.write-verb", capability: rosterList, prompt: "Update all employees", intent: { verb: "update", kind: "contact" }, data: { items: [{ id: "p1" }] }, expectedCard: null },
    { id: "list.malformed-row", capability: rosterList, prompt: "List all employees", intent: { verb: "read", kind: "contact" }, data: { items: [{}] }, expectedCard: null },
    { id: "person.no-identity", capability: rosterPerson, prompt: "Show contact details", intent: { verb: "read", kind: "contact" }, data: { person: { meta: {} } }, expectedCard: null },
  ];
  const relevance = cases.map((fixture, index) => {
    const actual = synthesizePresentation({
      turnId: `turn_presentation_${index}`,
      step: 0,
      prompt: fixture.prompt,
      intent: fixture.intent,
      capability: fixture.capability,
      data: fixture.data,
    });
    const actualCard = actual?.cardType ?? null;
    return observation({
      id: `presentation.${fixture.id}`,
      metric: "card_relevance_precision",
      capabilityId: fixture.capability.id,
      severity: "one",
      expected: fixture.expectedCard,
      actual: actualCard,
      passed: actualCard === fixture.expectedCard,
    });
  });
  const emptyCases = cases
    .filter((fixture) => fixture.expectedCard === null)
    .map((fixture) => {
      const actual = synthesizePresentation({
        turnId: `turn_empty_${fixture.id}`,
        step: 0,
        prompt: fixture.prompt,
        intent: fixture.intent,
        capability: fixture.capability,
        data: fixture.data,
      });
      return observation({
        id: `presentation.empty.${fixture.id}`,
        metric: "unexpected_empty_cards",
        capabilityId: fixture.capability.id,
        severity: "one",
        expected: null,
        actual: actual?.cardType ?? null,
        passed: actual === null,
      });
    });
  return [...relevance, ...emptyCases];
}

function parityObservations(): RiserEvalObservation[] {
  const freshTurn = (): ChatTurnCore => ({
    status: "streaming",
    text: "",
    trace: [],
    toolResults: [],
  });
  const frame = (type: string, data: Record<string, unknown>, sequence: number): ChatFrame =>
    ({
      type,
      data,
      receivedAt: sequence,
      protocolVersion: 1,
      presentationDataVersion: 1,
      mode: "semantic",
      turnId: "turn_eval",
      sequence,
      terminal: type === "final" || type === "error",
    }) as ChatFrame;
  const presentation = {
    id: "presentation:eval:0",
    answersIntentIds: ["intent:eval:0"],
    capabilityId: "roster.list",
    resultSourceId: "roster_list",
    relationship: "primary",
    cardType: "ranked_list",
    data: { items: [{ id: "p1", name: "Ada" }], total: 1 },
    minimumDataVersion: 1,
    relevanceReason: "The user explicitly requested this list.",
  };
  const proposedOutcome = {
    kind: "proposed",
    committed: false,
    navigateTo: { path: "/review", when: "on_propose" },
  };
  const committedOutcome = {
    kind: "committed",
    committed: true,
    navigateTo: { path: "/saved", when: "on_commit" },
  };
  const withOutcome = (
    value: ChatFrame,
    outcome: Record<string, unknown>,
  ): ChatFrame => ({ ...value, outcome } as ChatFrame);
  const corpus: ChatFrame[][] = [
    [frame("progress", { turnId: "turn_0" }, 0), frame("narration", { text: "Done" }, 1), frame("final", { status: "success" }, 2)],
    [frame("needs_clarification", { turnId: "turn_1", tool: "travel_search_stays", field: "checkIn", question: "Date?", partial: { city: "Istanbul" }, fields: [{ field: "checkIn", inputType: "date" }] }, 0)],
    [frame("error", { turnId: "turn_2", code: "internal", message: "boom" }, 0)],
    [withOutcome(frame("presentation", presentation, 0), { kind: "read", committed: false }), withOutcome(frame("final", { status: "success" }, 1), { kind: "read", committed: false })],
    [withOutcome(frame("needs_confirmation", { turnId: "turn_4", diff: {} }, 0), proposedOutcome), withOutcome(frame("final", { status: "success" }, 1), committedOutcome)],
    [frame("tool_result", { tool: "roster_list", ok: true, data: { items: [{ id: "p1" }] } }, 0), frame("final", { status: "success" }, 1)],
    [frame("tool_result", { tool: "roster_list", ok: true, data: { items: [{ id: "p1" }] } }, 0), withOutcome(frame("presentation", presentation, 1), { kind: "read", committed: false }), withOutcome(frame("final", { status: "success" }, 2), { kind: "read", committed: false })],
    [withOutcome(frame("needs_confirmation", { turnId: "turn_7", diff: {} }, 0), proposedOutcome), withOutcome(frame("final", { status: "success" }, 1), committedOutcome), withOutcome(frame("final", { status: "success" }, 1), committedOutcome)],
    [frame("presentation", presentation, 0), withOutcome(frame("final", { status: "success" }, 1), { kind: "read", committed: false })],
    [withOutcome(frame("presentation", { ...presentation, minimumDataVersion: 2 }, 0), { kind: "read", committed: false }), withOutcome(frame("final", { status: "success" }, 1), { kind: "read", committed: false })],
    [withOutcome(frame("presentation", { ...presentation, id: "", cardType: "unknown_card" }, 0), { kind: "read", committed: false }), withOutcome(frame("final", { status: "success" }, 1), { kind: "read", committed: false })],
    [frame("narration", { text: "Recovered" }, 2), frame("progress", { turnId: "turn_11" }, 0), frame("narration", { text: "Recovered" }, 2), frame("final", { status: "success" }, 3)],
  ];
  const mobileSnapshot =
    mobileSemanticAdapter.mobileSemanticSnapshot ??
    (
      mobileSemanticAdapter.default as
        | { mobileSemanticSnapshot?: typeof webSemanticAdapter.webSemanticSnapshot }
        | undefined
    )?.mobileSemanticSnapshot;
  return corpus.map((frames, index) => {
    const web = webSemanticAdapter.webSemanticSnapshot(freshTurn(), frames, {});
    const mobile = mobileSnapshot?.(freshTurn(), frames, {});
    return observation({
      id: `parity.${index}`,
      metric: "web_mobile_semantic_parity",
      capabilityId: null,
      severity: "one",
      expected: web,
      actual: mobile,
      passed: JSON.stringify(mobile) === JSON.stringify(web),
    });
  });
}

export async function collectPureRiserEvalObservations(
  seed = 1339,
): Promise<RiserEvalObservation[]> {
  return [
    ...intentObservations(),
    ...(await rankingObservations(seed)),
    ...(await abstentionObservations()),
    ...clarificationObservations(),
    ...presentationObservations(),
    ...parityObservations(),
  ];
}
