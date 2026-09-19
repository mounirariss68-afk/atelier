import assert from "node:assert/strict";
import {
  isClientVisibleCliFrameType,
  isManagedPresentationCard,
  isManagedPresentationCapability,
  synthesizePresentation,
} from "../../src/lib/atelier-cli/presentation-registry.js";
import type { CapabilityEntry } from "../../src/lib/atelier-cli/capability-catalog.js";

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

const base = {
  turnId: "turn_presentation",
  step: 0,
  intent: { verb: "read" as const, kind: "contact" as const },
  capability: rosterList,
};

assert.equal(isManagedPresentationCard("ranked_list"), true);
assert.equal(isClientVisibleCliFrameType("presentation"), true);
assert.equal(isClientVisibleCliFrameType("tool_result"), true);
assert.equal(isClientVisibleCliFrameType("tool_evidence"), false);
assert.equal(isManagedPresentationCapability(rosterList), true);
assert.equal(
  isManagedPresentationCapability({
    ...rosterList,
    id: "travel.search",
    module: "meta",
  }),
  false,
);
assert.equal(
  isManagedPresentationCapability({
    ...rosterList,
    id: "roster.update",
    isWrite: true,
  }),
  false,
);
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "Who is the CEO?",
    data: { items: [], total: 0 },
  }),
  null,
);
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "Show me the CEO",
    data: { items: [{ id: "person_1", name: "Unrelated" }], total: 1 },
  }),
  null,
);
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "Which person is CEO?",
    data: { items: [], total: 0 },
  }),
  null,
);
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "Who is the CEO?",
    data: { items: [{ id: "person_1", name: "Unrelated" }], total: 1 },
  }),
  null,
);
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "List all employees",
    data: { items: [{}], total: 1 },
  }),
  null,
);

const contactCard = {
  ...rosterList,
  id: "roster.person_detail",
  toolName: "person_detail",
  resultCard: "contact_card",
} as CapabilityEntry;
assert.equal(
  synthesizePresentation({
    ...base,
    capability: contactCard,
    prompt: "Who is the CEO?",
    data: { person: { id: "person_1", fullName: "A Person" } },
  })?.cardType,
  "contact_card",
);
const empty = synthesizePresentation({
  ...base,
  prompt: "List all employees",
  data: { items: [], total: 0 },
});
assert.equal(empty?.cardType, "ranked_list");
assert.equal(empty?.answersIntentIds[0], "intent:turn_presentation:0");
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "List all invoices",
    intent: { verb: "read", kind: "invoice" },
    data: { items: [{ id: "person_1" }], total: 1 },
  }),
  null,
);
assert.equal(
  synthesizePresentation({
    ...base,
    prompt: "List all employees",
    data: { rows: [] },
  }),
  null,
);

console.log("riser presentation probes passed");