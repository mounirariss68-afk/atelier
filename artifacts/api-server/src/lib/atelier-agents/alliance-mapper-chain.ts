/**
 * Task #526 — shared Alliance Executive Mapper pipeline (mirrors
 * executive-mapper-chain.ts, but over partner firms): sweep the partner
 * firm's alliance-relevant leadership, build governed contact proposals,
 * and append them to the firm's pendingUpdates queue (audited). Used by:
 *   - the manual "Map alliance executives" route,
 *   - the auto-run chained after an Alliance Cartographer evaluation,
 *   - the chat "add alliance partner" flow.
 *
 * Runs on the global `db` on purpose — long LLM runs must not pin an
 * RLS connection (see atelier agent-run conventions).
 */

import { db, atelierPartnerFirms, atelierAgentRuns } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { agentRunIsFresh } from "./run-staleness.js";
import {
  runAllianceCartographer,
  buildAllianceCartographerProposals,
  runAllianceExecutiveMapper,
  buildAllianceMapperContactProposals,
  queuePartnerFirmProposals,
} from "./alliance-cartographer.js";
import type { AllianceRoleCoverageEntry } from "./alliance-roles.js";

async function loadFirm(id: string) {
  const [row] = await db
    .select()
    .from(atelierPartnerFirms)
    .where(and(eq(atelierPartnerFirms.id, id), isNull(atelierPartnerFirms.deletedAt)));
  return row ?? null;
}

// In-process claim set — race-safe within this single server process; the
// DB status check below covers runs visible across restarts.
const allianceMapperInFlight = new Set<string>();

export async function runAllianceMapperAndQueue(
  firmId: string,
  triggeredByUserId: string | null,
): Promise<{
  runId: string;
  proposedCount: number;
  openQuestions: string[];
  allianceRoleCoverage: AllianceRoleCoverageEntry[] | null;
}> {
  const firm = await loadFirm(firmId);
  if (!firm) throw new Error("partner-firm-not-found");

  if (allianceMapperInFlight.has(firm.id)) {
    throw new Error("alliance-mapper-already-running");
  }
  allianceMapperInFlight.add(firm.id);
  try {
    const [inFlight] = await db
      .select({ id: atelierAgentRuns.id })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, "alliance_executive_mapper"),
          eq(atelierAgentRuns.targetId, firm.id),
          eq(atelierAgentRuns.status, "running"),
          // Task #1046 — a stale "running" row (dead process) must not
          // block a relaunch forever.
          agentRunIsFresh(),
          isNull(atelierAgentRuns.deletedAt),
        ),
      )
      .limit(1);
    if (inFlight) throw new Error("alliance-mapper-already-running");

    const knownContacts = (firm.contacts ?? []).map((c) => ({
      fullName: c.name,
      title: c.role ?? null,
      linkedinUrl: null as string | null,
    }));

    const { runId, output } = await runAllianceExecutiveMapper({
      firmId: firm.id,
      firmName: firm.name,
      firmCountry: firm.country ?? firm.hqCountry ?? null,
      firmSpeciality: firm.speciality ?? null,
      knownContacts,
      triggeredByUserId,
      actorLabel: "Alliance Executive Mapper",
    });

    // Re-load for the freshest queue — the LLM run takes minutes and the
    // Cartographer persist or a partner edit may have touched the row.
    const fresh = (await loadFirm(firm.id)) ?? firm;
    const proposals = buildAllianceMapperContactProposals({ output, firm: fresh });
    const proposedCount = await queuePartnerFirmProposals({
      firmId: firm.id,
      proposals,
      actorId: "ag_alliance_executive_mapper",
      actorLabel: "Alliance Executive Mapper",
      runId,
    });

    return {
      runId,
      proposedCount,
      openQuestions: output.openQuestions,
      allianceRoleCoverage: output.allianceRoleCoverage ?? null,
    };
  } finally {
    allianceMapperInFlight.delete(firm.id);
  }
}

// ---------------------------------------------------------------------------
// Alliance Cartographer pipeline — evaluate, queue proposals, chain the mapper.
// ---------------------------------------------------------------------------

const allianceCartographerInFlight = new Set<string>();

export async function runAllianceCartographerAndQueue(
  firmId: string,
  triggeredByUserId: string | null,
  opts?: { contextNotes?: string | null; chainMapper?: boolean },
): Promise<{
  runId: string;
  proposedCount: number;
  verdict: "proceed" | "limited" | "decline";
  weightedTotal: number;
  ddOverall: string;
  openQuestions: string[];
}> {
  const firm = await loadFirm(firmId);
  if (!firm) throw new Error("partner-firm-not-found");

  if (allianceCartographerInFlight.has(firm.id)) {
    throw new Error("alliance-cartographer-already-running");
  }
  allianceCartographerInFlight.add(firm.id);
  try {
    const [inFlight] = await db
      .select({ id: atelierAgentRuns.id })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, "alliance_cartographer"),
          eq(atelierAgentRuns.targetId, firm.id),
          eq(atelierAgentRuns.status, "running"),
          agentRunIsFresh(),
          isNull(atelierAgentRuns.deletedAt),
        ),
      )
      .limit(1);
    if (inFlight) throw new Error("alliance-cartographer-already-running");

    const { runId, output } = await runAllianceCartographer({
      firmId: firm.id,
      firmName: firm.name,
      firmCountry: firm.country ?? firm.hqCountry ?? null,
      firmSpeciality: firm.speciality ?? null,
      firmKind: firm.kind ?? null,
      contextNotes: opts?.contextNotes ?? null,
      triggeredByUserId,
      actorLabel: "Alliance Cartographer",
    });

    // Re-load for the freshest queue/fields before diffing proposals.
    const fresh = (await loadFirm(firm.id)) ?? firm;
    const proposals = buildAllianceCartographerProposals({ output, firm: fresh });
    const proposedCount = await queuePartnerFirmProposals({
      firmId: firm.id,
      proposals,
      actorId: "ag_alliance_cartographer",
      actorLabel: "Alliance Cartographer",
      runId,
    });

    if (opts?.chainMapper !== false) {
      chainAllianceMapperAfterCartographer(firm.id, triggeredByUserId, firm.name);
    }

    return {
      runId,
      proposedCount,
      verdict: output.fitScorecard.verdict,
      weightedTotal: output.fitScorecard.weightedTotal,
      ddOverall: output.dueDiligence.overall,
      openQuestions: output.openQuestions,
    };
  } finally {
    allianceCartographerInFlight.delete(firm.id);
  }
}

/**
 * Fire-and-forget chain used after every successful Alliance Cartographer
 * evaluation. A failed / empty / already-running Mapper never breaks the
 * Cartographer result — it degrades to a console warning.
 */
export function chainAllianceMapperAfterCartographer(
  firmId: string,
  triggeredByUserId: string | null,
  firmLabel: string,
): void {
  void runAllianceMapperAndQueue(firmId, triggeredByUserId).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "alliance-mapper-already-running") return;
    console.warn(
      `[atelier] post-cartographer alliance mapper failed for ${firmLabel}`,
      msg,
    );
  });
}
