import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierWorkItems,
} from "@workspace/db";
import {
  aggregateWorkResult,
  executeServerOwnedCrmWork,
  type createServerOwnedCrmWorkflow,
} from "../assistant/workflow-runtime.js";
import { runAccountCartographer } from "./runner.js";
import { runExecutiveMapperAndQueue } from "./executive-mapper-chain.js";
import { queueCartographerResearch } from "../../routes/atelier/accountRoutes.js";

type Workflow = Awaited<ReturnType<typeof createServerOwnedCrmWorkflow>>;

type CrmAuthorization = {
  capabilityIds: string[];
  toolIds: string[];
  dataClasses: string[];
  policyVersion: string;
  obligations: string[];
  budgetLedgerId: string;
};

function accountIdFromLinks(links: string[]): string | null {
  const link = links.find((value) => value.startsWith("crm:account:"));
  return link?.slice("crm:account:".length) || null;
}

export async function executeAccountCrmWork(args: {
  workItemId: string;
  orgId: string;
  requesterId: string;
  workerId: string;
  authorization: CrmAuthorization;
}): Promise<boolean> {
  let anyCompleted = false;
  for (let pass = 0; pass < 3; pass++) {
    const completed = await executeServerOwnedCrmWork({
      orgId: args.orgId,
      workItemId: args.workItemId,
      workerId: args.workerId,
      authorization: async () => args.authorization,
      execute: async ({ input }) => {
      const value = input as { accountId?: string; operation?: string; focusOpportunityId?: string | null };
      if (!value.accountId) throw new Error("crm-account-id-missing");
      const [account] = await db.select().from(atelierAccounts).where(and(
        eq(atelierAccounts.id, value.accountId),
        eq(atelierAccounts.orgId, args.orgId),
        isNull(atelierAccounts.deletedAt),
      ));
      if (!account) throw new Error("crm-account-not-found");
      if (value.operation === "executive_mapper") {
        const result = await runExecutiveMapperAndQueue(account.id, args.requesterId);
        return { result: { ok: true, data: result }, usage: { costMicros: 0, toolCalls: 1, providerCalls: 1 } };
      }
      const { runId, output } = await runAccountCartographer({
        accountId: account.id,
        accountName: account.name,
        accountSector: account.sector,
        accountCountry: account.country,
        accountHqCity: account.hqCity ?? null,
        triggeredByUserId: args.requesterId,
        actorLabel: "Account Cartographer",
        focusOpportunityId: value.focusOpportunityId ?? null,
      });
      const proposedCount = await queueCartographerResearch({
        accountId: account.id,
        output,
        runId,
        trigger: "manual_refresh",
      });
      return {
        result: { ok: true, data: { runId, proposedCount } },
        usage: { costMicros: 0, toolCalls: 1, providerCalls: 1 },
      };
      },
    });
    anyCompleted = anyCompleted || completed;
    if (!completed) break;
  }
  await aggregateWorkResult({ orgId: args.orgId, workItemId: args.workItemId });
  const [settled] = await db
    .select({ status: atelierWorkItems.status })
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, args.workItemId));
  return anyCompleted && settled?.status === "succeeded";
}

export async function resumeAccountCrmWorkflow(args: {
  work: Workflow;
  orgId: string;
  requesterId: string;
  budgetLedgerId: string;
}): Promise<boolean> {
  return executeAccountCrmWork({
    workItemId: args.work.workItemId,
    orgId: args.orgId,
    requesterId: args.requesterId,
    workerId: `crm-account-worker:${args.work.workItemId}`,
    authorization: {
      capabilityIds: ["account.refresh_cartographer"],
      toolIds: ["account_refresh_cartographer"],
      dataClasses: ["account", "account_research", "contacts"],
      policyVersion: "riser-policy-v1",
      obligations: [],
      budgetLedgerId: args.budgetLedgerId,
    },
  });
}

/** Called at boot and by the scheduler. The persisted work item is the source
 * of truth; no in-memory launch closure is required for recovery. */
export async function recoverAccountCrmWorkflows(): Promise<number> {
  const rows = await db.select().from(atelierWorkItems).where(sql`
    ${atelierWorkItems.status} in ('planned','recovery_settling')
    and exists (
      select 1 from jsonb_array_elements_text(${atelierWorkItems.conversationLinks}) as link
      where link like 'crm:account:%'
    )
  `);
  let resumed = 0;
  for (const work of rows) {
    try {
      const accountId = accountIdFromLinks(work.conversationLinks);
      if (!accountId || !work.budgetLedgerId) continue;
      if (await executeAccountCrmWork({
        workItemId: work.id,
        orgId: work.orgId,
        requesterId: work.requesterId,
        workerId: `crm-account-recovery:${work.id}`,
        authorization: {
          capabilityIds: ["account.refresh_cartographer"],
          toolIds: ["account_refresh_cartographer"],
          dataClasses: ["account", "account_research", "contacts"],
          policyVersion: "riser-policy-v1",
          obligations: [],
          budgetLedgerId: work.budgetLedgerId,
        },
      })) resumed++;
    } catch (error) {
      console.warn(
        `[atelier] CRM account recovery failed for work ${work.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return resumed;
}
