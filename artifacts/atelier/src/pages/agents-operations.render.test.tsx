import assert from "node:assert/strict";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import {
  getAtelierGetAgentRunQueryKey,
  getAtelierGetAgentPromptQueryKey,
  getAtelierGetMeQueryKey,
  getAtelierListAgentRunsQueryKey,
  getAtelierListAgentsQueryKey,
} from "@workspace/api-client-react";
import Agents from "./Agents";
import AgentProfile from "./AgentProfile";
import AgentRun from "./AgentRun";

const agent = {
  id: "ag_operations_probe",
  name: "Operations Probe",
  group: "Operations",
  stage: "Deliver",
  purpose: "Proves the operations catalogue contract.",
  model: "test-model",
  starred: false,
  status: "mvp" as const,
  runsLast30d: 1,
  executable: true,
  tools: ["lookup"],
  guardrails: ["cite sources"],
  humanCheckpoints: [{ id: "cp_partner", label: "Partner approves the output", decider: "partner", blocking: true }],
  promptRef: "agent_operations_probe",
  inputs: [],
  outputs: [],
};

const run = {
  id: "run_operations_probe",
  agentId: agent.id,
  status: "complete" as const,
  message: "Operations probe completed",
  startedAt: "2026-09-20T00:00:00.000Z",
  targetLabel: "Probe target",
};

const detail = {
  ...run,
  progressPct: 100,
  durationMs: 1250,
  costUsd: 0.0123,
  sourcesCount: 1,
  output: { ok: true },
  humanDecisions: [{ decision: "approve", rationale: "Looks good", actorLabel: "Reviewer" }],
  steps: ["started", "completed"],
};

function render(path: string, Page: React.ComponentType, setup: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setup(client);
  return renderToString(
    <QueryClientProvider client={client}>
      <Router ssrPath={path}>
        <Page />
      </Router>
    </QueryClientProvider>,
  );
}

const catalogueHtml = render("/agents", Agents, (client) => {
  client.setQueryData(getAtelierListAgentsQueryKey(), [agent]);
});
assert.match(catalogueHtml, /Agent catalogue/);
assert.match(catalogueHtml, /href="\/agents\/ag_operations_probe"/);

const profileHtml = render(`/agents/${agent.id}`, AgentProfile, (client) => {
  client.setQueryData(getAtelierListAgentsQueryKey(), [agent]);
  client.setQueryData(getAtelierListAgentRunsQueryKey(agent.id), [run]);
  client.setQueryData(getAtelierGetMeQueryKey(), { id: "partner", role: "founding_partner" });
  client.setQueryData(getAtelierGetAgentPromptQueryKey(agent.id), {
    agentId: agent.id,
    body: "You are the operations probe.\nReturn grounded evidence.",
    source: "filesystem",
    baseRef: "prompts/agent_operations_probe/v1.md",
    version: 1,
    updatedAt: "2026-09-20T00:00:00.000Z",
  });
});
assert.match(profileHtml, /Tools/);
assert.match(profileHtml, /Guardrails/);
assert.match(profileHtml, /Human checkpoints/);
assert.match(profileHtml, /Partner approves the output/);
assert.match(profileHtml, /blocking/);
assert.doesNotMatch(profileHtml, /&quot;blocking&quot;/);
assert.match(profileHtml, /agent_operations_probe/);
assert.match(profileHtml, /You are the operations probe/);
assert.match(profileHtml, /Edit prompt/);
assert.match(profileHtml, /href="\/agents\/runs\/run_operations_probe"/);
assert.match(profileHtml, /Version.*1/, "the authoritative prompt version is rendered");

const failedRunHtml = render(`/agents/runs/${run.id}`, AgentRun, (client) => {
  client.setQueryData(getAtelierListAgentsQueryKey(), [agent]);
  client.setQueryData(getAtelierGetAgentRunQueryKey(run.id), {
    ...detail,
    status: "error",
    statusMessage: "Provider failed",
    output: undefined,
    humanDecisions: [],
  });
});
assert.match(failedRunHtml, /Provider failed/);
assert.match(failedRunHtml, /No output was recorded/);

const persistedDecisionHtml = render(`/agents/runs/${run.id}`, AgentRun, (client) => {
  client.setQueryData(getAtelierListAgentsQueryKey(), [agent]);
  client.setQueryData(getAtelierGetAgentRunQueryKey(run.id), detail);
});
assert.match(persistedDecisionHtml, /Decisions are stored with this run/);
assert.match(persistedDecisionHtml, /Reviewer/);
assert.match(persistedDecisionHtml, /disabled/);

console.log("agent operations UI probes ✓ — catalogue/profile/run evidence and persisted decisions render");