/**
 * DGE Effortless 2.0 — Agent Runner & Behavioural / UX Authority Contracts.
 *
 * Lightweight in-browser runtime that powers the six DGE demos. Every
 * agent action is checked against a typed BehaviouralContract — `mustNever`
 * actions are blocked and logged with `outcome: 'blocked'` even if a
 * scripted step tries to perform them. Every consequential action goes
 * through `requireHumanAuthorisation` and the response is logged to an
 * in-memory AuditEvent[] (swap for Postgres in production).
 *
 * Offline trace replayer loads from /dge-traces/<slug>.json so the
 * demonstrator works in any meeting room without internet or API keys.
 */
import type { BiText } from "@/lib/sim/types";

export type Hapa = "H1" | "H2" | "H3" | "H4" | "H5" | "H6";

export interface BehaviouralContract {
  may: string[];
  mayOnlyWithHuman: string[];
  mustNever: string[];
}

export interface UXAuthorityContract {
  /** Surfaces the agent is allowed to render in. */
  surfaces: Array<"citizen" | "operator" | "governance">;
  /** Persona roles that may authorise. */
  authorisers: BiText[];
}

export type AuditOutcome = "ok" | "blocked" | "pending" | "authorised";

export interface AuditEvent {
  id: string;
  ts: string;
  agent: BiText;
  action: BiText;
  detail?: BiText;
  hapa?: Hapa[];
  citations?: BiText[];
  human?: BiText;
  outcome: AuditOutcome;
}

export interface AgentStepEvent {
  id: string;
  agent: BiText;
  surface: "citizen" | "operator" | "governance";
  label: BiText;
  detail?: BiText;
  hapa?: Hapa[];
  citations?: BiText[];
  /** When set, the runner pauses and surfaces an AUTHORIZE card. */
  authorise?: {
    by: BiText;
    intent: BiText;
    commits: BiText;
  };
  /** When set, the runner attempts the action against the contract. */
  attempt?: {
    action: string;
    contract: BehaviouralContract;
  };
}

export interface OfflineTrace {
  slug: string;
  success: AgentStepEvent[];
  blocked: AgentStepEvent[];
}

let auditCounter = 0;

export function nowStamp(): string {
  const d = new Date();
  return d.toISOString().slice(11, 19);
}

/**
 * Enforce mustNever at the runner level: a forbidden action is
 * blocked and logged regardless of the script.
 */
export function checkContract(
  action: string,
  contract: BehaviouralContract,
): AuditOutcome {
  if (contract.mustNever.includes(action)) return "blocked";
  if (contract.mayOnlyWithHuman.includes(action)) return "pending";
  if (contract.may.includes(action)) return "ok";
  // Unknown actions default to blocked (deny by default).
  return "blocked";
}

export function makeAuditEvent(
  partial: Omit<AuditEvent, "id" | "ts">,
): AuditEvent {
  auditCounter += 1;
  return {
    id: `audit-${auditCounter}-${Date.now()}`,
    ts: nowStamp(),
    ...partial,
  };
}

export async function loadOfflineTrace(
  slug: string,
): Promise<OfflineTrace | null> {
  // Cast import.meta to silence "env may not be defined" on older TS.
  const base =
    (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ??
    "/";
  try {
    const res = await fetch(`${base}dge-traces/${slug}.json`);
    if (!res.ok) return null;
    return (await res.json()) as OfflineTrace;
  } catch {
    return null;
  }
}

/**
 * Whether the runner should source steps from the offline trace JSON.
 * Default ON — flip to OFF either via `?offline=off` query param or by
 * setting `VITE_DGE_OFFLINE=off` at build time. This is a hard
 * requirement of the demonstrator: meeting rooms with no internet
 * still get a faithful run.
 */
export function isOfflineMode(): boolean {
  // Build-time env switch.
  const envFlag = (import.meta as unknown as { env?: { VITE_DGE_OFFLINE?: string } })
    .env?.VITE_DGE_OFFLINE;
  if (envFlag === "off") return false;
  if (envFlag === "on") return true;
  // Run-time URL switch (overrides env when present).
  if (typeof window === "undefined") return true;
  const v = new URLSearchParams(window.location.search).get("offline");
  return v !== "off";
}

/**
 * Replay an offline trace as a runnable AgentStepEvent[]. The last
 * `success` step is converted into the AUTHORIZE pause (so the same
 * trace drives both the visualisation and the human-gating flow), and
 * every `blocked` step becomes a contract-attempt that the runner
 * verifies via checkContract → outcome: "blocked".
 */
export function traceToEvents(
  trace: OfflineTrace,
  authorise: { by: BiText; intent: BiText; commits: BiText; hapa?: Hapa[] },
  forbiddenContract: BehaviouralContract,
): AgentStepEvent[] {
  const successSteps = trace.success.slice(0, -1);
  const lastSuccess = trace.success[trace.success.length - 1];
  const out: AgentStepEvent[] = successSteps.map((s) => ({ ...s }));
  if (lastSuccess) {
    out.push({
      ...lastSuccess,
      authorise,
    });
  }
  // Each demo's forbidden contract lists its own `mustNever` action(s).
  // We attempt the first one so the runner proves THIS demo's specific
  // governance rule (e.g. nominate_without_citation, schedule_on_public
  // _holiday, publish_with_open_amber) — not a generic placeholder.
  const attemptAction = forbiddenContract.mustNever[0] ?? "unknown_action";
  for (const b of trace.blocked) {
    out.push({
      ...b,
      attempt: { action: attemptAction, contract: forbiddenContract },
    });
  }
  return out;
}
