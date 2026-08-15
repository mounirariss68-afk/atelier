/**
 * Task #1193 — in-memory agent-launch visibility for the Background Work bell.
 *
 * The bell's feed (GET /me/background-jobs) reads durable `atelier_agent_runs`
 * rows, but Cartographer / Executive Mapper launches have a pre-row window:
 * the route returns 202 (or the create response) immediately while the run
 * row is only inserted once the async pipeline gets going (budget check,
 * account/contact loads, LLM warm-up). During that window the user who
 * kicked the run off saw nothing in the bell.
 *
 * This registry closes the gap: every launch path registers here
 * synchronously with the triggering user's id + a target label, and clears
 * the entry when the launch settles. The feed merges entries for the caller,
 * deduped against DB run rows / running jobs on the same target so nothing
 * shows twice once the durable row lands.
 *
 * Deliberately NOT durable — it only bridges the seconds before the run row
 * exists in THIS process; the run row remains the source of truth (with the
 * existing 2h freshness rule). Entries past the staleness cutoff are dropped
 * on read so a wedged launch can't spin in the bell forever.
 */
import { launchEntryIsStale } from "./run-staleness.js";

export interface AgentLaunchVisibilityEntry {
  agentId: string;
  targetId: string;
  targetLabel: string | null;
  /** The user who triggered the launch; null = system (never shown). */
  userId: string | null;
  startedAt: number;
}

const key = (agentId: string, targetId: string) => `${agentId}:${targetId}`;
const entries = new Map<string, AgentLaunchVisibilityEntry>();

/** Register (or refresh) an in-flight launch. Call synchronously at launch. */
export function noteAgentLaunch(entry: Omit<AgentLaunchVisibilityEntry, "startedAt">): void {
  entries.set(key(entry.agentId, entry.targetId), { ...entry, startedAt: Date.now() });
}

/** Backfill a label discovered after registration (e.g. account loaded later). */
export function updateAgentLaunchLabel(agentId: string, targetId: string, label: string): void {
  const e = entries.get(key(agentId, targetId));
  if (e) entries.set(key(agentId, targetId), { ...e, targetLabel: label });
}

/** Remove a settled launch (success or failure). Safe to call twice. */
export function clearAgentLaunch(agentId: string, targetId: string): void {
  entries.delete(key(agentId, targetId));
}

/** Live launches triggered by this user (stale entries are pruned on read). */
export function listAgentLaunchesForUser(userId: string): AgentLaunchVisibilityEntry[] {
  const out: AgentLaunchVisibilityEntry[] = [];
  for (const [k, e] of entries) {
    if (launchEntryIsStale(e.startedAt)) {
      entries.delete(k);
      continue;
    }
    if (e.userId === userId) out.push(e);
  }
  return out;
}
