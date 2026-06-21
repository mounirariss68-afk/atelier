/**
 * Task #571 — Account planning & execution demo seed.
 *
 * Idempotent (insert-only via upsertById) demo data for the account plan
 * surface: a handful of account-level actions, an account risk register,
 * and goal-progress rows tied to the demo accounts' strategy objectives.
 * Mirrors the upsertById pattern in atelier-seed-l2c.ts; safe to call on
 * every cold start.
 */
import { eq, type InferInsertModel } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierAccounts,
  atelierAccountActions,
  atelierAccountRisks,
  atelierAccountGoalProgress,
} from "@workspace/db";
import { logger } from "./logger.js";

type WithIdColumn = PgTable & { id: PgColumn };

async function upsertById<T extends WithIdColumn>(
  table: T,
  rows: Array<InferInsertModel<T> & { id: string }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(table)
      .values(row as InferInsertModel<T>)
      .onConflictDoNothing({ target: (table as WithIdColumn).id });
  }
}

const ORG = "aico";
const OWNER = "p_mounir_ariss"; // founding_partner

const ACTIONS: Array<
  InferInsertModel<typeof atelierAccountActions> & { id: string }
> = [
  {
    id: "aca_dge_qbr",
    orgId: ORG,
    accountId: "acc_dge",
    title: "Schedule Q3 executive QBR with DGE undersecretary",
    detail:
      "Align on Effortless v2 roadmap and secure sponsorship for the AED expansion.",
    ownerId: OWNER,
    status: "in_progress",
    priority: "high",
    dueDate: "2026-07-15",
    source: "manual",
    createdByUserId: OWNER,
  },
  {
    id: "aca_dge_casestudy",
    orgId: ORG,
    accountId: "acc_dge",
    title: "Publish anonymised DGE case study",
    detail: "Drives credibility for the wider GCC public-sector pipeline.",
    ownerId: OWNER,
    status: "open",
    priority: "medium",
    dueDate: "2026-08-30",
    source: "manual",
    createdByUserId: OWNER,
  },
  {
    id: "aca_tasama_renewal",
    orgId: ORG,
    accountId: "acc_tasama",
    title: "Open Tasama BPO Phase 2 renewal conversation",
    detail: "Phase 1 wraps in Q4; secure a multi-year extension.",
    ownerId: OWNER,
    status: "open",
    priority: "high",
    dueDate: "2026-09-01",
    linkedObjectiveId: "obj_a",
    source: "manual",
    createdByUserId: OWNER,
  },
];

const RISKS: Array<
  InferInsertModel<typeof atelierAccountRisks> & { id: string }
> = [
  {
    id: "acr_dge_budget",
    orgId: ORG,
    accountId: "acc_dge",
    kind: "risk",
    severity: "amber",
    status: "mitigating",
    ownerId: OWNER,
    description:
      "FY27 public-sector budget cycle could delay the Effortless v2 expansion sign-off.",
    mitigation:
      "Pre-brief finance sponsor and stage the SOW so phase 1 value lands before the budget gate.",
    dueDate: "2026-08-01",
    createdByUserId: OWNER,
  },
  {
    id: "acr_tasama_singlethread",
    orgId: ORG,
    accountId: "acc_tasama",
    kind: "dependency",
    severity: "red",
    status: "open",
    ownerId: OWNER,
    description:
      "Relationship is single-threaded through the COO; no executive backup sponsor.",
    mitigation: "Map and cultivate a second economic buyer in the CFO org.",
    createdByUserId: OWNER,
  },
];

const GOAL_PROGRESS: Array<
  InferInsertModel<typeof atelierAccountGoalProgress> & { id: string }
> = [
  {
    id: "acg_tasama_obj_a",
    orgId: ORG,
    accountId: "acc_tasama",
    objectiveId: "obj_a",
    currentValue: "SAR 2.1M",
    status: "on_track",
    note: "Phase 1 milestones tracking to plan; renewal upside identified.",
    createdByUserId: OWNER,
  },
];

// Strategy objectives that the goal-progress rows above are tied to. The
// `accountStrategy` field is normally authored by a partner or proposed by the
// Account Cartographer agent, so it is empty on a cold/test seed. Without an
// objective record the goal-progress upsert route (PUT /accounts/:id/goals/
// :objectiveId) cannot resolve obj_a and returns "objective-not-found" (404).
// We backfill the referenced objective here so the linked goal-progress rows
// (and the CRM harness check) resolve against a real strategy objective.
const STRATEGY_OBJECTIVES: Array<{
  accountId: string;
  objective: {
    id: string;
    text: string;
    targetValue?: string | null;
    targetDate?: string | null;
  };
}> = [
  {
    accountId: "acc_tasama",
    objective: {
      id: "obj_a",
      text: "Secure a multi-year Phase 2 renewal and expand the agentic BPO footprint.",
      targetValue: "SAR 4M ARR",
      targetDate: "2026-12-31",
    },
  },
];

async function ensureStrategyObjectives(): Promise<void> {
  for (const { accountId, objective } of STRATEGY_OBJECTIVES) {
    const [account] = await db
      .select()
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, accountId));
    if (!account) continue;
    const strategy = account.accountStrategy ?? {
      objectives: [],
      targetServiceLines: [],
      winHypothesis: "",
      keyPlays: [],
    };
    const objectives = strategy.objectives ?? [];
    if (objectives.some((o) => o.id === objective.id)) continue;
    await db
      .update(atelierAccounts)
      .set({
        accountStrategy: { ...strategy, objectives: [...objectives, objective] },
        updatedAt: new Date(),
      })
      .where(eq(atelierAccounts.id, accountId));
  }
}

let accountPlanSeedPromise: Promise<void> | null = null;

export async function ensureAtelierAccountPlanSeed(): Promise<void> {
  if (accountPlanSeedPromise) return accountPlanSeedPromise;
  accountPlanSeedPromise = (async () => {
    await ensureStrategyObjectives();
    await upsertById(atelierAccountActions, ACTIONS);
    await upsertById(atelierAccountRisks, RISKS);
    await upsertById(atelierAccountGoalProgress, GOAL_PROGRESS);
    logger.info(
      { module: "atelier-seed-account-plan" },
      `Account-plan demo seed verified (${ACTIONS.length} actions, ${RISKS.length} risks, ${GOAL_PROGRESS.length} goal-progress).`,
    );
  })().catch((err) => {
    accountPlanSeedPromise = null; // allow retry on next call
    logger.error(
      { module: "atelier-seed-account-plan", err },
      "Account-plan demo seed failed",
    );
    throw err;
  });
  return accountPlanSeedPromise;
}
