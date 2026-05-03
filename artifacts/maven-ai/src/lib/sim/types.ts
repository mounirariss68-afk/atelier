/**
 * Marketplace demo simulation — type definitions for the in-browser tick
 * engine that drives every "Launch interactive demo" experience.
 *
 * One Scenario per marketplace tool. The DemoExperience shell mounts a
 * shared cockpit (Overview / Live Inbox / Workflows / Workspace / KPIs /
 * Audit Log) and plays back the scenario's `events` deterministically,
 * advancing simulated state and prompting the user at human checkpoints.
 *
 * Bilingual EN/AR throughout. Sample/illustrative data only.
 */

export interface BiText {
  en: string;
  ar: string;
}

export type AgentKind =
  | "orchestrator"
  | "specialist"
  | "critic"
  | "retriever"
  | "drafter"
  | "scorer"
  | "monitor"
  | "router"
  | "compiler"
  | "human";

export interface SimAgent {
  id: string;
  name: BiText;
  /** One-line job description shown in the cockpit. */
  role: BiText;
  kind: AgentKind;
  /** Hex colour used for the swimlane and chips. */
  color: string;
}

export interface SimToolDef {
  /** Identifier the events reference, e.g. "search_jira". */
  name: string;
  description: BiText;
}

export interface SimCheckpointOption {
  id: string;
  label: BiText;
  /** When set, this option is the agent's recommendation. */
  recommended?: boolean;
}

export interface SimCheckpoint {
  id: string;
  /** Role of the human responsible (e.g. "PMO Lead"). */
  human: BiText;
  question: BiText;
  rationale: BiText;
  options: SimCheckpointOption[];
}

export interface InboxItem {
  id: string;
  source: BiText;
  subject: BiText;
  preview: BiText;
  /** Display label only — sample-data formatted. */
  receivedAt: string;
  status: "new" | "in-progress" | "awaiting-human" | "resolved";
  /** Optional accent override (otherwise scenario accent). */
  accent?: string;
}

export type WorkspaceWidgetKind = "doc" | "table" | "metric-grid" | "list";

export interface WorkspaceWidget {
  id: string;
  kind: WorkspaceWidgetKind;
  title: BiText;
  /** Free-form rows / paragraphs / metric entries — interpreted by the
   * Workspace tab based on `kind`. */
  rows: BiText[][];
}

export type WorkspacePatch =
  | { op: "add"; widget: WorkspaceWidget }
  | { op: "update"; id: string; rows: BiText[][] }
  | { op: "remove"; id: string };

export interface KpiDef {
  id: string;
  label: BiText;
  initial: string;
  /** Optional source citation for the KPI baseline. */
  source?: BiText;
}

export interface KpiValue {
  id: string;
  label: BiText;
  value: string;
  delta?: string;
  source?: BiText;
}

export interface WorkflowStepDef {
  agentId: string;
  label: BiText;
}

export interface WorkflowDef {
  id: string;
  name: BiText;
  description: BiText;
  trigger: BiText;
  steps: WorkflowStepDef[];
}

export type SimEventKind =
  | "think"
  | "tool-call"
  | "decision"
  | "handoff"
  | "checkpoint"
  | "emit-inbox"
  | "update-inbox"
  | "patch-workspace"
  | "update-kpi"
  | "complete";

export interface SimEvent {
  id: string;
  kind: SimEventKind;
  /** Acting agent (omitted for `complete`). */
  agentId?: string;
  /** Receiving agent for `handoff`. */
  toAgentId?: string;
  /** Cockpit headline — short. */
  label: BiText;
  /** Long-form rationale shown in the audit log. */
  detail?: BiText;
  /** Tool reference for `tool-call`. */
  toolName?: string;
  toolArgs?: Record<string, string>;
  toolResult?: BiText;
  /** For `checkpoint`. The engine pauses until the user picks an option. */
  checkpointId?: string;
  /** For `emit-inbox`. */
  inboxItem?: InboxItem;
  /** For `update-inbox`. */
  inboxUpdate?: { id: string; status: InboxItem["status"] };
  /** For `patch-workspace`. */
  workspacePatch?: WorkspacePatch;
  /** For `update-kpi`. */
  kpiPatch?: { id: string; value: string; delta?: string };
}

export interface Scenario {
  slug: string;
  toolTitle: BiText;
  accent: string;
  /** Shown on the Overview tab. */
  description: BiText;
  buyer: BiText;
  /** A single sentence describing the live trigger that kicks off the
   * scenario when the user presses Play. */
  trigger: BiText;
  agents: SimAgent[];
  tools: SimToolDef[];
  checkpoints: SimCheckpoint[];
  workflows: WorkflowDef[];
  kpis: KpiDef[];
  initialInbox: InboxItem[];
  initialWorkspace: WorkspaceWidget[];
  events: SimEvent[];
}

export interface SimState {
  status: "idle" | "playing" | "paused" | "awaiting-human" | "complete";
  cursor: number;
  speedMs: number;
  inbox: InboxItem[];
  workspace: WorkspaceWidget[];
  kpis: KpiValue[];
  /** Events that have been emitted (for cockpit + audit log). */
  trace: SimEvent[];
  pendingCheckpoint: SimCheckpoint | null;
  /** Recorded human decisions, keyed by checkpoint id → option id. */
  decisions: Record<string, string>;
}
