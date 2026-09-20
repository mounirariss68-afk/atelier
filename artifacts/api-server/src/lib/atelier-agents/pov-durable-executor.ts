import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierPovs,
  atelierPovVersions,
  atelierWorkItems,
  atelierWorkSteps,
  atelierWorkAttempts,
} from "@workspace/db";
import { runPovDraft, type AgentFact, type PovOutline } from "./runner.js";
import { buildPovBackgroundContext } from "./pov-grounding.js";
import { auditPovCitations, describeCitationFailure } from "./pov-quality.js";
import {
  completeBackgroundJob,
  failBackgroundJob,
} from "../background-jobs.js";
import {
  aggregateWorkResult,
  executeServerOwnedCrmWork,
} from "../assistant/workflow-runtime.js";
import { decryptAssistantValueAudited } from "../assistant/action-runtime.js";

async function insertVersion(values: {
  povId: string; body: string; sections: unknown; citations: unknown;
  citationCoverage: number; notes: string | null; createdByUserId: string;
  workItemId: string;
}) {
  const deterministicId = `povv_riser_${createHash("sha256")
    .update(values.workItemId)
    .digest("hex")
    .slice(0, 24)}`;
  const [existing] = await db.select({ id: atelierPovVersions.id, versionNumber: atelierPovVersions.versionNumber })
    .from(atelierPovVersions).where(eq(atelierPovVersions.id, deterministicId)).limit(1);
  if (existing) return { versionId: existing.id, versionNumber: existing.versionNumber };
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    const rows = await db.select({ versionNumber: atelierPovVersions.versionNumber })
      .from(atelierPovVersions).where(eq(atelierPovVersions.povId, values.povId));
    const versionNumber = rows.reduce((n, row) => Math.max(n, row.versionNumber), 0) + 1;
    try {
      await db.insert(atelierPovVersions).values({
        id: deterministicId, povId: values.povId, versionNumber, body: values.body,
        sections: values.sections as never, citations: values.citations as never,
        citationCoverage: values.citationCoverage,
        notes: values.notes,
        createdByUserId: values.createdByUserId,
      });
      return { versionId: deterministicId, versionNumber };
    } catch (error) {
      last = error;
      if ((error as { code?: string })?.code !== "23505") throw error;
      const [replayed] = await db
        .select({ id: atelierPovVersions.id, versionNumber: atelierPovVersions.versionNumber })
        .from(atelierPovVersions)
        .where(eq(atelierPovVersions.id, deterministicId))
        .limit(1);
      if (replayed) return { versionId: replayed.id, versionNumber: replayed.versionNumber };
    }
  }
  throw last instanceof Error ? last : new Error("pov-version-insert-conflict");
}

export async function executeDurablePovWork(args: {
  orgId: string;
  workItemId: string;
  workerId: string;
  jobId?: string;
  povId: string;
  opportunityName: string;
  outline: PovOutline;
  promotedFacts: AgentFact[];
  requesterId: string;
  requesterName: string;
  persona: { id: string; role: string; orgId: string };
  revisionFeedback?: string;
  priorDraftHtml?: string;
  baseVersionNumber?: number;
  title: string;
  revision: boolean;
  depth: "memo" | "full";
}): Promise<void> {
  try {
    const authorization = async () => ({
      capabilityIds: ["opportunity.draft_pov"],
      toolIds: ["opportunity_draft_pov"],
      dataClasses: ["opportunity", "pov", "research_facts"],
      policyVersion: "riser-policy-v1",
      obligations: [],
      budgetLedgerId: (await db.select({ budgetLedgerId: atelierWorkItems.budgetLedgerId })
        .from(atelierWorkItems).where(eq(atelierWorkItems.id, args.workItemId)))[0]?.budgetLedgerId ?? "",
    });
    const [initialWork] = await db
      .select({ status: atelierWorkItems.status })
      .from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, args.workItemId));
    let executed = initialWork?.status === "awaiting_aggregation";
    for (let pass = 0; pass < 3 && !executed; pass++) {
      executed = await executeServerOwnedCrmWork({
        orgId: args.orgId,
        workItemId: args.workItemId,
        workerId: args.workerId,
        authorization,
        execute: async () => {
        const grounding = await buildPovBackgroundContext({
          povId: args.povId,
          opportunityId: (await db.select({ opportunityId: atelierPovs.opportunityId })
            .from(atelierPovs).where(eq(atelierPovs.id, args.povId)))[0].opportunityId,
          orgId: args.persona.orgId,
          persona: args.persona,
          audience: args.outline.title,
          objective: args.outline.thesis,
        }).catch(() => ({ context: "", firmProfileIncluded: false }));
        const { runId, draft } = await runPovDraft({
          opportunityId: (await db.select({ opportunityId: atelierPovs.opportunityId })
            .from(atelierPovs).where(eq(atelierPovs.id, args.povId)))[0].opportunityId,
          opportunityName: args.opportunityName,
          outline: args.outline,
          promotedFacts: args.promotedFacts,
          triggeredByUserId: args.requesterId,
          actorLabel: args.revision
            ? "POV Author · Revision (Sections+Critic+Stylist)"
            : "POV Author · Sections+Critic+Stylist",
          revisionFeedback: args.revisionFeedback,
          priorDraftHtml: args.priorDraftHtml,
          backgroundContext: grounding.context || undefined,
          depth: args.depth,
        });
        const audit = auditPovCitations({
          html: draft.html, sections: draft.sections ?? [],
          validFactIds: args.promotedFacts.map((f) => f.id ?? "").filter(Boolean),
          outlineTypes: args.outline.sections.map((s) => ({ id: s.id, type: s.type, heading: s.heading })),
        });
        if (!audit.passes) throw new Error(describeCitationFailure(audit));
        const notes = [
          draft.voiceFlags?.join(" · ") || null,
          grounding.firmProfileIncluded ? null : "Firm profile unavailable — positioning sections use generic firm framing.",
        ].filter(Boolean).join(" · ") || null;
        const version = await insertVersion({
          povId: args.povId, body: audit.sanitizedHtml, sections: audit.sanitizedSections,
          citations: args.promotedFacts, citationCoverage: audit.coverage,
          notes, createdByUserId: args.requesterId,
          workItemId: args.workItemId,
        });
        await db.transaction(async (tx) => {
          await tx.update(atelierPovs).set({
            status: "drafted", currentVersionId: version.versionId, runId, updatedAt: new Date(),
          }).where(eq(atelierPovs.id, args.povId));
          if (args.revision) {
            const auditId = `aud_pov_riser_${createHash("sha256")
              .update(args.workItemId)
              .digest("hex")
              .slice(0, 24)}`;
            await tx.insert(atelierAuditEvents).values({
              id: auditId,
              entityType: "pov", entityId: args.povId, actorType: "human",
              actorId: args.requesterId, actorLabel: args.requesterName,
              action: "pov.revise",
              payload: {
                feedback: args.revisionFeedback,
                baseVersionNumber: args.baseVersionNumber,
                newVersionNumber: version.versionNumber,
              } as never,
              payloadSummary: `${args.requesterName} revised POV "${args.title}" → v${version.versionNumber}.`,
            }).onConflictDoNothing();
          }
        });
        return {
          result: { ok: true, data: { versionId: version.versionId, versionNumber: version.versionNumber } },
          evidence: args.promotedFacts,
          usage: { costMicros: 0, toolCalls: 1, providerCalls: 1 },
        };
        },
      });
      if (!executed) {
        const [current] = await db
          .select({ status: atelierWorkItems.status })
          .from(atelierWorkItems)
          .where(eq(atelierWorkItems.id, args.workItemId));
        if (!current || current.status !== "planned") break;
      }
    }
    if (!executed) {
      const [lastAttempt] = await db
        .select({ errorClass: atelierWorkAttempts.errorClass })
        .from(atelierWorkAttempts)
        .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
        .where(eq(atelierWorkSteps.workItemId, args.workItemId))
        .orderBy(desc(atelierWorkAttempts.attemptNumber))
        .limit(1);
      throw new Error(lastAttempt?.errorClass ?? "pov-work-attempt-not-executed");
    }
    await aggregateWorkResult({ orgId: args.orgId, workItemId: args.workItemId });
    const [settledWork] = await db
      .select({ status: atelierWorkItems.status })
      .from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, args.workItemId));
    if (settledWork?.status !== "succeeded") {
      throw new Error(`pov-work-not-succeeded:${settledWork?.status ?? "missing"}`);
    }
    const [pov] = await db.select({ opportunityId: atelierPovs.opportunityId })
      .from(atelierPovs).where(eq(atelierPovs.id, args.povId));
    const [version] = await db.select({ versionId: atelierPovs.currentVersionId, versionNumber: atelierPovVersions.versionNumber })
      .from(atelierPovs).leftJoin(atelierPovVersions, eq(atelierPovVersions.id, atelierPovs.currentVersionId))
      .where(eq(atelierPovs.id, args.povId)).orderBy(desc(atelierPovVersions.versionNumber));
    if (args.jobId) {
      await completeBackgroundJob(args.jobId, {
        result: { versionId: version?.versionId, versionNumber: version?.versionNumber },
        notifyTitle: `POV ${args.revision ? "revision" : "draft"} ready — "${args.title}"`,
        notifyBody: `Version ${version?.versionNumber ?? ""} is ready to review.`,
      });
    }
  } catch (error) {
    const [work] = await db.select({ status: atelierWorkItems.status })
      .from(atelierWorkItems).where(eq(atelierWorkItems.id, args.workItemId));
    if (work && ["failed", "cancelled", "compensated"].includes(work.status)) {
      if (args.jobId) {
        await failBackgroundJob(args.jobId, error instanceof Error ? error.message : String(error), {
          notifyTitle: `POV ${args.revision ? "revision" : "draft"} failed — "${args.title}"`,
        });
      }
    }
  }
}

/**
 * Boot-time reconciliation hook. The durable work row is the source of truth;
 * background-job rows are only the compatibility/status projection. Leases are
 * reaped by workflow-runtime before this hook is called, so a later worker can
 * safely claim the same fenced attempt. Keeping this query here also prevents
 * POV work from being mistaken for a generic delegated workflow.
 */
export async function discoverIncompletePovWork(): Promise<string[]> {
  const rows = await db.select({
    id: atelierWorkItems.id,
    links: atelierWorkItems.conversationLinks,
    status: atelierWorkItems.status,
  }).from(atelierWorkItems).where(
    inArray(atelierWorkItems.status, [
      "planned",
      "awaiting_aggregation",
      "recovery_settling",
    ]),
  );
  return rows
    .filter((row) => Array.isArray(row.links) && row.links.some(
      (link) => typeof link === "string" && link.startsWith("crm:pov:"),
    ))
    .map((row) => row.id);
}

export async function resumeIncompletePovWork(): Promise<number> {
  const ids = await discoverIncompletePovWork();
  let resumed = 0;
  for (const workItemId of ids) {
    try {
      const [work] = await db.select().from(atelierWorkItems).where(eq(atelierWorkItems.id, workItemId));
      const [step] = await db.select().from(atelierWorkSteps).where(eq(atelierWorkSteps.workItemId, workItemId));
      if (!work || !step) continue;
      const input = await decryptAssistantValueAudited({
        ciphertext: step.inputEncrypted, orgId: work.orgId, requesterId: work.requesterId,
        actorId: work.requesterId, resourceType: "work_step", resourceId: step.id,
        purpose: "resume_work_step",
      }) as {
        povId: string; opportunityName: string; outline: PovOutline; promotedFacts: AgentFact[];
        revision?: boolean; revisionFeedback?: string; priorDraftHtml?: string;
        baseVersionNumber?: number; requesterName: string; requesterRole?: string;
        depth?: "memo" | "full";
      };
      await executeDurablePovWork({
        orgId: work.orgId, workItemId, workerId: `pov-recovery:${work.requesterId}`,
        jobId: work.conversationLinks.find((v) => v.startsWith("correlation:"))?.slice(12),
        povId: input.povId, opportunityName: input.opportunityName, outline: input.outline,
        promotedFacts: input.promotedFacts, requesterId: work.requesterId,
        requesterName: input.requesterName,
        persona: {
          id: work.requesterId,
          role: input.requesterRole ?? "partner",
          orgId: work.orgId,
        },
        revision: input.revision === true, revisionFeedback: input.revisionFeedback,
        priorDraftHtml: input.priorDraftHtml, baseVersionNumber: input.baseVersionNumber,
        title: input.outline.title, depth: input.depth ?? "full",
      });
      resumed++;
    } catch (error) {
      console.warn(
        `[atelier] POV recovery failed for work ${workItemId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return resumed;
}