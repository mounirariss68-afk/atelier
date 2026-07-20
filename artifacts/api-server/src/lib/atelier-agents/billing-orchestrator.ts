/**
 * Atelier — Billing Orchestrator agent runner (Task #429).
 *
 * Rule-based like the Bookkeeper: deterministic, idempotent, auditable.
 * One run = scan all active billing rules (optionally scoped to one
 * engagement) → materialise due triggers (idempotency keys make double
 * billing impossible) → draft an invoice per ready trigger. Held
 * triggers are left alone; empty T&M periods are skipped visibly.
 * The agent NEVER issues an invoice — issuing is a partner action on
 * the billing worklist.
 *
 * Entry points:
 *   - daily cron (scheduler.ts, BILLING_ORCHESTRATOR_CRON)
 *   - milestone mark-invoiceable event (revrecRoutes.ts, fire-and-forget)
 *   - manual "Run now" on the billing worklist (billingRoutes.ts)
 */

import { and, eq } from "drizzle-orm";
import { db, atelierBillingRule, atelierBillingTrigger } from "@workspace/db";
import { runAgent } from "./runAgent.js";
import {
  scanBillingTriggers,
  draftInvoiceForTrigger,
} from "../atelier-billing-engine.js";

export interface BillingOrchestratorInput {
  asOf?: string;
  engagementId?: string;
  source?: "cron" | "manual" | "milestone_event";
}

export interface BillingOrchestratorOutput {
  rulesScanned: number;
  candidatesFound: number;
  triggersCreated: number;
  invoicesDrafted: number;
  triggersSkipped: number;
  drafts: {
    triggerId: string;
    triggerType: string;
    engagementId: string;
    invoiceId: string | null;
    total: number;
    rationale: string;
  }[];
  rationaleSummary: string;
}

export async function runBillingOrchestrator(args: {
  orgId: string;
  input: BillingOrchestratorInput;
  triggeredByUserId: string | null;
  actorLabel?: string;
}): Promise<{ runId: string; output: BillingOrchestratorOutput }> {
  const { orgId } = args;
  const asOf = args.input.asOf ? new Date(`${args.input.asOf}T23:59:59Z`) : new Date();
  const res = await runAgent<BillingOrchestratorInput, BillingOrchestratorOutput>(
    {
      agentId: "ag_billing_orchestrator",
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: args.input.engagementId ? "engagement" : "org",
      targetId: args.input.engagementId ?? orgId,
      targetLabel: args.input.engagementId
        ? `Billing run — engagement ${args.input.engagementId}`
        : "Billing run — all engagements",
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      await ctx.progress(10, "Scanning billing rules for due triggers");
      const scan = await scanBillingTriggers({
        orgId,
        asOf,
        engagementId: args.input.engagementId,
      });

      await ctx.progress(40, "Drafting invoices for ready triggers");
      const readyWhere = [
        eq(atelierBillingTrigger.orgId, orgId),
        eq(atelierBillingTrigger.status, "ready"),
      ];
      if (args.input.engagementId) {
        readyWhere.push(eq(atelierBillingTrigger.engagementId, args.input.engagementId));
      }
      const ready = await db
        .select()
        .from(atelierBillingTrigger)
        .where(and(...readyWhere));

      const drafts: BillingOrchestratorOutput["drafts"] = [];
      let invoicesDrafted = 0;
      let triggersSkipped = 0;
      for (const trigger of ready) {
        const [rule] = await db
          .select()
          .from(atelierBillingRule)
          .where(eq(atelierBillingRule.id, trigger.ruleId));
        if (!rule || rule.status !== "active" || rule.deletedAt) {
          triggersSkipped++;
          drafts.push({
            triggerId: trigger.id,
            triggerType: trigger.triggerType,
            engagementId: trigger.engagementId,
            invoiceId: null,
            total: 0,
            rationale: "Rule paused or removed — trigger left untouched",
          });
          continue;
        }
        const result = await draftInvoiceForTrigger({
          trigger,
          rule,
          agentRunId: ctx.runId,
        });
        if (result.status === "drafted") {
          invoicesDrafted++;
          drafts.push({
            triggerId: trigger.id,
            triggerType: trigger.triggerType,
            engagementId: trigger.engagementId,
            invoiceId: result.invoiceId ?? null,
            total: result.total ?? 0,
            rationale: `Drafted ${result.lineCount ?? 0} line(s) from ${trigger.idempotencyKey}; awaiting partner approval`,
          });
        } else {
          triggersSkipped++;
          drafts.push({
            triggerId: trigger.id,
            triggerType: trigger.triggerType,
            engagementId: trigger.engagementId,
            invoiceId: null,
            total: 0,
            rationale: result.reason ?? "skipped",
          });
        }
      }

      await ctx.progress(90, "Summarising run");
      const output: BillingOrchestratorOutput = {
        rulesScanned: scan.rulesScanned,
        candidatesFound: scan.candidatesFound,
        triggersCreated: scan.triggersCreated,
        invoicesDrafted,
        triggersSkipped,
        drafts,
        rationaleSummary:
          `Scanned ${scan.rulesScanned} rule(s), materialised ${scan.triggersCreated} new trigger(s), ` +
          `drafted ${invoicesDrafted} invoice(s), skipped ${triggersSkipped}. ` +
          `Drafts require partner approval before issuing.`,
      };
      return { output, confidence: "green" };
    },
  );
  return { runId: res.runId, output: res.output };
}
