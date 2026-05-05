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
  /** Optional cockpit-list placement hint. When set, the agent cockpit
   * renders an amber "Human checkpoint" divider row immediately after the
   * named agent in the agent legend column. */
  afterAgentId?: string;
}

export type InboxSeverity = "critical" | "warning" | "info" | "new";

export type InboxActionKind =
  | "start-run"
  | "view-calendar"
  | "review-docs"
  | "view-report";

export interface InboxItem {
  id: string;
  /** Optional id of the agent that emitted/owns this item. When present
   * the live inbox prefixes the source line with the agent's coloured
   * dot. */
  agentId?: string;
  source: BiText;
  subject: BiText;
  preview: BiText;
  /** Display label only — sample-data formatted. */
  receivedAt: string;
  status: "new" | "in-progress" | "awaiting-human" | "resolved";
  /** Optional accent override (otherwise scenario accent). */
  accent?: string;
  /** Optional severity tag — drives the coloured pill rendered next to
   * the status (CRITICAL / WARNING / INFO / NEW). Defaults to "new". */
  severity?: InboxSeverity;
  /** Optional contextual action button rendered on the inbox row. The
   * button is illustrative — clicking shows an "Opening…" toast. */
  action?: InboxActionKind;
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

/** Direction of "improvement" for a KPI — used to colour the trend arrow.
 *
 *  - `up`      higher is better (default). Positive delta → green up,
 *              negative delta → red down.
 *  - `down`    lower is better (e.g. error rate, processing time). A
 *              negative delta is good (green down arrow), a positive
 *              delta is bad (red up arrow).
 *  - `neutral` no preferred direction — always rendered grey.
 */
export type KpiImprovementDirection = "up" | "down" | "neutral";

export interface KpiDef {
  id: string;
  label: BiText;
  initial: string;
  /** Optional source citation for the KPI baseline. */
  source?: BiText;
  /** Initial trend delta to display before any `update-kpi` event has
   * fired. Lets the dashboard show meaningful month-over-month context
   * on first render. */
  initialDelta?: string;
  /** Per-KPI improvement direction. Defaults to "up" if omitted. */
  improvementDirection?: KpiImprovementDirection;
}

export interface KpiValue {
  id: string;
  label: BiText;
  value: string;
  delta?: string;
  source?: BiText;
  improvementDirection?: KpiImprovementDirection;
}

export interface WorkflowStepDef {
  /** Type of node. Defaults to "agent" if omitted, in which case
   * `agentId` is required. */
  kind?: "agent" | "checkpoint";
  /** Required when `kind` is "agent" (the default). */
  agentId?: string;
  label: BiText;
  /** Required when `kind` is "checkpoint" — the human role responsible
   * for the gate (e.g. "Payroll Manager"). */
  human?: BiText;
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
  /** Optional pre-seeded "previous run" audit history. When present the
   * Audit Log tab renders these entries above any current-run trace
   * with a grey-italic separator. They never advance the engine cursor
   * and never enable the Download JSON button. */
  previousRun?: {
    label: BiText;
    /** Optional label for the upcoming live run separator (defaults to
     * a generic "Current Run"). */
    currentLabel?: BiText;
    entries: SimEvent[];
  };
  /** Optional pre-run summary card data, surfaced in the cockpit's
   * right-hand pane while the engine is idle. */
  readyToRun?: {
    title: BiText;
    /** Header row + N data rows. The cockpit renders this as a small
     * summary table. */
    rows: BiText[][];
    triggerNote?: BiText;
  };
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
