/**
 * Task #8 — shared Pursuit Scout persistence.
 *
 * Extracted from agentRoutes so the REST create route AND the chat
 * `opportunity_create` capability persist Scout briefs identically.
 * Validates the Scout output before it becomes the brief of record:
 * a structurally-valid-but-empty object (soft refusal) is skipped so a
 * blank brief never overwrites prior research.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierBriefs, atelierResearchFacts } from "@workspace/db";
import {
  applyCitationGuardrail,
  isScoutBriefEmpty,
  type PursuitScoutOutput,
} from "./runner.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export async function persistBriefAndFacts(
  oppId: string,
  runId: string,
  out: PursuitScoutOutput,
): Promise<{ persisted: boolean; reason?: "empty" }> {
  if (isScoutBriefEmpty(out)) {
    console.warn(`[atelier] scout produced an empty brief for ${oppId} — skipping persist`);
    return { persisted: false, reason: "empty" };
  }
  // Run facts through the citation guardrail so any claim without a real source
  // URL is confidence-downgraded (never silently promoted as green evidence).
  const guardedFacts = applyCitationGuardrail(out.facts ?? []);
  // Soft-delete prior briefs so the latest is the source of truth.
  await db
    .update(atelierBriefs)
    .set({ deletedAt: new Date() })
    .where(and(eq(atelierBriefs.opportunityId, oppId), isNull(atelierBriefs.deletedAt)));
  await db.insert(atelierBriefs).values({
    id: rid("brief"),
    opportunityId: oppId,
    runId,
    accountSnapshot: out.accountSnapshot,
    buyerLandscape: out.buyerLandscape,
    fiveCDraft: out.fiveCDraft,
    openQuestions: out.openQuestions ?? [],
    citations: guardedFacts,
    confidence: out.confidence ?? "amber",
  });
  // Insert facts (don't dedupe — run history is the audit). Every fact emitted
  // by the scout into the brief is by definition `included_in_brief=true`.
  if (guardedFacts.length) {
    await db.insert(atelierResearchFacts).values(
      guardedFacts.map((f) => ({
        id: f.id ?? rid("fact"),
        opportunityId: oppId,
        runId,
        topic: f.topic,
        statement: f.statement,
        sourceUrl: f.sourceUrl ?? null,
        sourceTitle: f.sourceTitle ?? null,
        snippet: f.snippet ?? null,
        confidence: f.confidence,
        retrievedAt: new Date(),
        includedInBrief: true,
      })),
    );
  }
  return { persisted: true };
}
